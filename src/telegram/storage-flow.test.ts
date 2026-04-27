import test from 'node:test';
import assert from 'node:assert/strict';

import type { ConversationSessionRecord } from './conversation-session.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import type {
  StorageCategoryRecord,
  StorageCategoryRepository,
  StorageEntryDetailRecord,
  StorageEntryMessageRecord,
  StorageEntryRecord,
} from '../storage/storage-catalog.js';
import type { StorageCategoryAccessRepository } from '../storage/storage-category-access-store.js';
import {
  __resetStorageTopicMediaGroupsForTests,
  __flushStorageTopicMediaGroupForTests,
  handleTelegramStorageCommand,
  handleTelegramStorageMessage,
  handleTelegramStorageText,
} from './storage-flow.js';

function dangerButton(text: string) {
  return { text, semanticRole: 'danger' as const };
}

function createCategory(overrides: Partial<StorageCategoryRecord> = {}): StorageCategoryRecord {
  return {
    id: 7,
    slug: 'manuales',
    displayName: 'Manuales',
    description: 'Documentacion',
    storageChatId: -100123,
    storageThreadId: 10,
    lifecycleStatus: 'active',
    createdAt: '2026-04-21T10:00:00.000Z',
    updatedAt: '2026-04-21T10:00:00.000Z',
    archivedAt: null,
    ...overrides,
  };
}

function createRepository(initialCategories: StorageCategoryRecord[] = [createCategory()]): StorageCategoryRepository & {
  __entries: StorageEntryDetailRecord[];
} {
  const categories = new Map<number, StorageCategoryRecord>(initialCategories.map((category) => [category.id, category]));
  const entries: StorageEntryDetailRecord[] = [];
  let nextEntryId = 1;

  return {
    __entries: entries,
    async createCategory(input) {
      const category = createCategory({
        id: Math.max(0, ...categories.keys()) + 1,
        slug: input.slug,
        displayName: input.displayName,
        description: input.description,
        storageChatId: input.storageChatId,
        storageThreadId: input.storageThreadId,
      });
      categories.set(category.id, category);
      return category;
    },
    async updateCategoryLifecycleStatus(input) {
      const existing = categories.get(input.categoryId);
      if (!existing) {
        throw new Error(`Storage category ${input.categoryId} not found`);
      }
      const updated = {
        ...existing,
        lifecycleStatus: input.lifecycleStatus,
        archivedAt: input.lifecycleStatus === 'archived' ? '2026-04-21T11:00:00.000Z' : null,
      };
      categories.set(updated.id, updated);
      return updated;
    },
    async findCategoryById(categoryId) {
      return categories.get(categoryId) ?? null;
    },
    async findCategoryByStorageThread(storageChatId, storageThreadId) {
      return Array.from(categories.values()).find(
        (category) => category.storageChatId === storageChatId && category.storageThreadId === storageThreadId,
      ) ?? null;
    },
    async listCategories() {
      return Array.from(categories.values());
    },
    async createEntry(input) {
      const category = categories.get(input.categoryId);
      if (!category) {
        throw new Error(`Storage category ${input.categoryId} not found`);
      }
      const entry: StorageEntryRecord = {
        id: nextEntryId,
        categoryId: input.categoryId,
        createdByTelegramUserId: input.createdByTelegramUserId,
        sourceKind: input.sourceKind,
        description: input.description,
        tags: input.tags,
        lifecycleStatus: 'active',
        createdAt: '2026-04-21T12:00:00.000Z',
        updatedAt: '2026-04-21T12:00:00.000Z',
        deletedAt: null,
        deletedByTelegramUserId: null,
      };
      const messages: StorageEntryMessageRecord[] = input.messages.map((message, index) => ({
        id: index + 1,
        entryId: nextEntryId,
        storageChatId: message.storageChatId,
        storageMessageId: message.storageMessageId,
        storageThreadId: message.storageThreadId,
        telegramFileId: message.telegramFileId ?? null,
        telegramFileUniqueId: message.telegramFileUniqueId ?? null,
        attachmentKind: message.attachmentKind,
        caption: message.caption ?? null,
        originalFileName: message.originalFileName ?? null,
        mimeType: message.mimeType ?? null,
        fileSizeBytes: message.fileSizeBytes ?? null,
        mediaGroupId: message.mediaGroupId ?? null,
        sortOrder: message.sortOrder,
        createdAt: '2026-04-21T12:00:00.000Z',
      }));
      const detail = { entry, category, messages } satisfies StorageEntryDetailRecord;
      entries.push(detail);
      nextEntryId += 1;
      return detail;
    },
    async updateEntryLifecycleStatus(input) {
      const existing = entries.find((entry) => entry.entry.id === input.entryId);
      if (!existing) {
        throw new Error(`Storage entry ${input.entryId} not found`);
      }
      existing.entry = {
        ...existing.entry,
        lifecycleStatus: input.lifecycleStatus,
        updatedAt: '2026-04-21T13:00:00.000Z',
        deletedAt: input.lifecycleStatus === 'deleted' ? '2026-04-21T13:00:00.000Z' : null,
        deletedByTelegramUserId: input.deletedByTelegramUserId ?? null,
      };
      return existing.entry;
    },
    async getEntryDetail(entryId) {
      return entries.find((entry) => entry.entry.id === entryId) ?? null;
    },
    async listEntryDetailsByCategory(categoryId) {
      return entries.filter((entry) => entry.entry.categoryId === categoryId && entry.entry.lifecycleStatus === 'active');
    },
    async searchEntryDetails({ categoryIds, query }) {
      const normalizedQuery = query.trim().toLowerCase();
      return entries.filter((entry) =>
        categoryIds.includes(entry.entry.categoryId) &&
        entry.entry.lifecycleStatus === 'active' &&
        (
          entry.entry.description?.toLowerCase().includes(normalizedQuery) ||
          entry.entry.tags.some((tag) => tag.includes(normalizedQuery)) ||
          entry.messages.some((message) => message.originalFileName?.toLowerCase().includes(normalizedQuery))
        ),
      );
    },
  };
}

function createContext(
  repository: StorageCategoryRepository,
  {
    isAdmin = false,
    canReadCategoryIds = [7],
    canUploadCategoryIds = [7],
    chatKind = 'private',
    chatId = 42,
    actorTelegramUserId = 42,
    actorStatus = 'approved',
    storageCategoryAccessRepository,
    failCopyMessageAtCall,
  }: {
    isAdmin?: boolean;
    canReadCategoryIds?: number[];
    canUploadCategoryIds?: number[];
    chatKind?: 'private' | 'group' | 'group-news';
    chatId?: number;
    actorTelegramUserId?: number;
    actorStatus?: 'pending' | 'approved' | 'blocked' | 'revoked';
    storageCategoryAccessRepository?: StorageCategoryAccessRepository;
    failCopyMessageAtCall?: number;
  } = {},
): {
  context: TelegramCommandHandlerContext & Record<string, unknown>;
  replies: Array<{ message: string; options?: TelegramReplyOptions }>;
  copiedMessages: Array<{ fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }>;
  deletedMessages: Array<{ chatId: number; messageId: number }>;
  getCurrentSession: () => ConversationSessionRecord | null;
} {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const copiedMessages: Array<{ fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }> = [];
  const deletedMessages: Array<{ chatId: number; messageId: number }> = [];
  let currentSession: ConversationSessionRecord | null = null;
  let copiedMessageId = 900;
  let copyMessageCalls = 0;

  const context = {
    from: { id: actorTelegramUserId, username: 'ada' },
    reply: async (message: string, options?: TelegramReplyOptions) => {
      replies.push(options ? { message, options } : { message });
    },
    runtime: {
      chat: { kind: chatKind, chatId },
      actor: {
        telegramUserId: actorTelegramUserId,
        status: actorStatus,
        isApproved: actorStatus === 'approved',
        isBlocked: actorStatus === 'blocked',
        isAdmin,
        permissions: [],
      },
      authorization: {
        authorize: (permissionKey: string, resource?: { type: string; id: string }) => ({
          allowed: resource
            ? permissionKey === 'storage.entry.read'
              ? canReadCategoryIds.includes(Number(resource.id))
              : canUploadCategoryIds.includes(Number(resource.id))
            : false,
          permissionKey,
          reason: 'test',
        }),
        can: (permissionKey: string, resource?: { type: string; id: string }) =>
          resource
            ? permissionKey === 'storage.entry.read'
              ? canReadCategoryIds.includes(Number(resource.id))
              : canUploadCategoryIds.includes(Number(resource.id))
            : false,
      },
      session: {
        get current() {
          return currentSession;
        },
        start: async ({ flowKey, stepKey, data = {} }: { flowKey: string; stepKey: string; data?: Record<string, unknown> }) => {
          currentSession = {
            key: `telegram.session:${chatId}:${actorTelegramUserId}`,
            flowKey,
            stepKey,
            data,
            createdAt: '2026-04-21T12:00:00.000Z',
            updatedAt: '2026-04-21T12:00:00.000Z',
            expiresAt: '2026-04-22T12:00:00.000Z',
          };
          return currentSession;
        },
        advance: async ({ stepKey, data }: { stepKey: string; data: Record<string, unknown> }) => {
          if (!currentSession) {
            throw new Error('No session');
          }
          currentSession = { ...currentSession, stepKey, data, updatedAt: '2026-04-21T12:05:00.000Z' };
          return currentSession;
        },
        cancel: async () => {
          currentSession = null;
          return true;
        },
      },
      bot: {
        language: 'es',
        publicName: 'Game Club Bot',
        clubName: 'Game Club',
        username: 'gameclub_test_bot',
        sendPrivateMessage: async () => {},
        copyMessage: async ({ fromChatId, messageId, toChatId, messageThreadId }: { fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }) => {
          copyMessageCalls += 1;
          if (failCopyMessageAtCall && copyMessageCalls === failCopyMessageAtCall) {
            throw new Error('copy failed');
          }
          copiedMessages.push(messageThreadId === undefined ? { fromChatId, messageId, toChatId } : { fromChatId, messageId, toChatId, messageThreadId });
          copiedMessageId += 1;
          return { messageId: copiedMessageId };
        },
        deleteMessage: async ({ chatId, messageId }: { chatId: number; messageId: number }) => {
          deletedMessages.push({ chatId, messageId });
        },
      },
      services: {
        database: {
          db: {
            insert: () => ({
              values: async () => undefined,
            }),
          },
        },
      },
    },
    storageRepository: repository,
    ...(storageCategoryAccessRepository ? { storageCategoryAccessRepository } : {}),
  } as unknown as TelegramCommandHandlerContext & Record<string, unknown>;

  return {
    context,
    replies,
    copiedMessages,
    deletedMessages,
    getCurrentSession: () => currentSession,
  };
}

test('handleTelegramStorageText opens the storage submenu from the command entry point', async () => {
  const { context, replies } = createContext(createRepository());

  await handleTelegramStorageCommand(context as never);

  assert.equal(replies[0]?.message, 'Almacenamiento: elige una acción.');
  assert.equal((replies[0]?.options?.replyKeyboard?.[0]?.[0] as { semanticRole?: string })?.semanticRole, 'primary');
  assert.deepEqual(replies[0]?.options?.replyKeyboard?.at(-1), ['Inicio', 'Ayuda']);
});

test('handleTelegramStorageText lists only categories the user can read', async () => {
  const repository = createRepository([
    createCategory({ id: 7, slug: 'manuales', displayName: 'Manuales' }),
    createCategory({ id: 8, slug: 'fotos', displayName: 'Fotos', storageThreadId: 11 }),
  ]);
  const { context, replies } = createContext(repository, { canReadCategoryIds: [7], canUploadCategoryIds: [7] });
  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);

  context.messageText = 'Listar categorías';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal(replies.at(-1)?.message, 'Categorías disponibles:\n- Manuales (`manuales`)');
});

test('handleTelegramStorageText lists recent entries for a chosen category', async () => {
  const repository = createRepository([createCategory()]);
  await repository.createEntry({
    categoryId: 7,
    createdByTelegramUserId: 42,
    sourceKind: 'dm_copy',
    description: 'Manual de campana',
    tags: ['rol', 'pdf'],
    messages: [
      {
        storageChatId: -100123,
        storageMessageId: 900,
        storageThreadId: 10,
        telegramFileId: 'file-1',
        telegramFileUniqueId: 'unique-1',
        attachmentKind: 'document',
        caption: null,
        originalFileName: 'manual.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1024,
        mediaGroupId: null,
        sortOrder: 0,
      },
    ],
  });
  const { context, replies } = createContext(repository, { canReadCategoryIds: [7], canUploadCategoryIds: [7] });
  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);

  context.messageText = 'Ver archivos';
  await handleTelegramStorageText(context as never);

  context.messageText = 'Manuales';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal(replies.at(-1)?.message, 'Manuales:\n- #1 Manual de campana · rol, pdf · 1 adjunto(s)');
});

test('handleTelegramStorageText shows cancel while choosing a storage category', async () => {
  const { context, replies } = createContext(createRepository(), { canReadCategoryIds: [7], canUploadCategoryIds: [7] });
  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);

  context.messageText = 'Ver archivos';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard?.at(-1), [dangerButton('/cancel')]);
});

test('handleTelegramStorageText searches entries inside readable categories', async () => {
  const repository = createRepository([createCategory()]);
  await repository.createEntry({
    categoryId: 7,
    createdByTelegramUserId: 42,
    sourceKind: 'dm_copy',
    description: 'Manual de campana',
    tags: ['rol', 'pdf'],
    messages: [
      {
        storageChatId: -100123,
        storageMessageId: 900,
        storageThreadId: 10,
        telegramFileId: 'file-1',
        telegramFileUniqueId: 'unique-1',
        attachmentKind: 'document',
        caption: null,
        originalFileName: 'manual.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1024,
        mediaGroupId: null,
        sortOrder: 0,
      },
    ],
  });
  const { context, replies } = createContext(repository, { canReadCategoryIds: [7], canUploadCategoryIds: [7] });
  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);

  context.messageText = 'Buscar archivos';
  await handleTelegramStorageText(context as never);

  context.messageText = 'manual';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal(replies.at(-1)?.message, 'Resultados:\n- Manuales · #1 Manual de campana');
});

test('handleTelegramStorageText lets admins create a storage category', async () => {
  const repository = createRepository([]);
  const { context, replies, getCurrentSession } = createContext(repository, { isAdmin: true, canReadCategoryIds: [], canUploadCategoryIds: [] });

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);

  context.messageText = 'Crear categoría';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'create-category-slug');

  context.messageText = 'manuales';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'create-category-name');

  context.messageText = 'Manuales';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'create-category-description');

  context.messageText = 'Documentacion del club';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'create-category-chat-id');

  context.messageText = '-100123';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'create-category-thread-id');

  context.messageText = '10';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  const categories = await repository.listCategories();
  assert.equal(categories.length, 1);
  assert.equal(categories[0]?.slug, 'manuales');
  assert.equal(categories[0]?.storageChatId, -100123);
  assert.equal(categories[0]?.storageThreadId, 10);
  assert.equal(replies.at(-1)?.message, 'Categoría creada: Manuales (`manuales`).');
  assert.equal(getCurrentSession(), null);
});

test('handleTelegramStorageText uses cancel-only keyboards for storage category creation prompts', async () => {
  const repository = createRepository([]);
  const { context, replies, getCurrentSession } = createContext(repository, { isAdmin: true, canReadCategoryIds: [], canUploadCategoryIds: [] });

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);

  context.messageText = 'Crear categoría';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal(getCurrentSession()?.stepKey, 'create-category-slug');
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [[dangerButton('/cancel')]]);
});

test('handleTelegramStorageText shows cancel while uploading attachments and optional metadata', async () => {
  const repository = createRepository([createCategory()]);
  const { context, replies, getCurrentSession } = createContext(repository, { canReadCategoryIds: [7], canUploadCategoryIds: [7] });

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Subir archivos';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Manuales';

  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal(getCurrentSession()?.stepKey, 'upload-media');
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard?.at(-1), [dangerButton('/cancel')]);
});

test('handleTelegramStorageText lets admins archive a storage category', async () => {
  const repository = createRepository([createCategory()]);
  const { context, replies, getCurrentSession } = createContext(repository, { isAdmin: true, canReadCategoryIds: [7], canUploadCategoryIds: [7] });

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);

  context.messageText = 'Archivar categoría';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'archive-category-select');

  context.messageText = 'Manuales';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  const category = await repository.findCategoryById(7);
  assert.equal(category?.lifecycleStatus, 'archived');
  assert.equal(replies.at(-1)?.message, 'Categoría archivada: Manuales.');
  assert.equal(getCurrentSession(), null);
});

test('handleTelegramStorageText opens an entry by id and copies its attachments to private chat', async () => {
  const repository = createRepository([createCategory()]);
  await repository.createEntry({
    categoryId: 7,
    createdByTelegramUserId: 42,
    sourceKind: 'dm_copy',
    description: 'Manual de campana',
    tags: ['rol', 'pdf'],
    messages: [
      {
        storageChatId: -100123,
        storageMessageId: 900,
        storageThreadId: 10,
        telegramFileId: 'file-1',
        telegramFileUniqueId: 'unique-1',
        attachmentKind: 'document',
        caption: null,
        originalFileName: 'manual.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1024,
        mediaGroupId: null,
        sortOrder: 0,
      },
    ],
  });
  const { context, replies, copiedMessages, getCurrentSession } = createContext(repository, { canReadCategoryIds: [7], canUploadCategoryIds: [7] });

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);

  context.messageText = 'Abrir entrada';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'open-entry-id');

  context.messageText = '1';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal(copiedMessages.length, 1);
  assert.deepEqual(copiedMessages[0], { fromChatId: -100123, messageId: 900, toChatId: 42 });
  assert.equal(replies.at(-1)?.message, 'Entrada #1 de Manuales enviada con 1 adjunto(s).');
  assert.equal(getCurrentSession(), null);
});

test('handleTelegramStorageText lets admins logically delete an entry by id', async () => {
  const repository = createRepository([createCategory()]);
  await repository.createEntry({
    categoryId: 7,
    createdByTelegramUserId: 42,
    sourceKind: 'dm_copy',
    description: 'Manual de campana',
    tags: ['rol', 'pdf'],
    messages: [
      {
        storageChatId: -100123,
        storageMessageId: 900,
        storageThreadId: 10,
        telegramFileId: 'file-1',
        telegramFileUniqueId: 'unique-1',
        attachmentKind: 'document',
        caption: null,
        originalFileName: 'manual.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1024,
        mediaGroupId: null,
        sortOrder: 0,
      },
    ],
  });
  const { context, replies, getCurrentSession } = createContext(repository, { isAdmin: true, canReadCategoryIds: [7], canUploadCategoryIds: [7] });

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);

  context.messageText = 'Borrar entrada';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'delete-entry-id');

  context.messageText = '1';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  const detail = await repository.getEntryDetail(1);
  assert.equal(detail?.entry.lifecycleStatus, 'deleted');
  assert.equal(detail?.entry.deletedByTelegramUserId, 42);
  assert.equal(replies.at(-1)?.message, 'Entrada #1 borrada lógicamente.');
  assert.equal(getCurrentSession(), null);
});

test('handleTelegramStorageText hides logically deleted entries from normal listing', async () => {
  const repository = createRepository([createCategory()]);
  await repository.createEntry({
    categoryId: 7,
    createdByTelegramUserId: 42,
    sourceKind: 'dm_copy',
    description: 'Manual de campana',
    tags: ['rol', 'pdf'],
    messages: [
      {
        storageChatId: -100123,
        storageMessageId: 900,
        storageThreadId: 10,
        telegramFileId: 'file-1',
        telegramFileUniqueId: 'unique-1',
        attachmentKind: 'document',
        caption: null,
        originalFileName: 'manual.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1024,
        mediaGroupId: null,
        sortOrder: 0,
      },
    ],
  });
  await repository.updateEntryLifecycleStatus({ entryId: 1, lifecycleStatus: 'deleted', deletedByTelegramUserId: 42 });
  const { context, replies } = createContext(repository, { canReadCategoryIds: [7], canUploadCategoryIds: [7] });

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Ver archivos';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Manuales';

  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal(replies.at(-1)?.message, 'No hay ninguna entrada indexada en esta categoría.');
});

test('handleTelegramStorageText hides archived categories from normal category listings', async () => {
  const repository = createRepository([createCategory({ lifecycleStatus: 'archived', archivedAt: '2026-04-21T11:00:00.000Z' })]);
  const { context, replies } = createContext(repository, { canReadCategoryIds: [7], canUploadCategoryIds: [7] });

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Listar categorías';

  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal(replies.at(-1)?.message, 'No tienes ninguna categoría disponible para consultar.');
});

test('handleTelegramStorageText hides archived categories from DM upload choices', async () => {
  const repository = createRepository([createCategory({ lifecycleStatus: 'archived', archivedAt: '2026-04-21T11:00:00.000Z' })]);
  const { context, replies, getCurrentSession } = createContext(repository, { canReadCategoryIds: [7], canUploadCategoryIds: [7] });

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Subir archivos';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal(getCurrentSession(), null);
  assert.equal(replies.at(-1)?.message, 'No hay categorías disponibles para esta acción.');
});

test('handleTelegramStorageText shows archived categories to admins in category listing', async () => {
  const repository = createRepository([
    createCategory(),
    createCategory({ id: 8, slug: 'historico', displayName: 'Historico', storageThreadId: 11, lifecycleStatus: 'archived', archivedAt: '2026-04-21T11:00:00.000Z' }),
  ]);
  const { context, replies } = createContext(repository, { isAdmin: true, canReadCategoryIds: [7, 8], canUploadCategoryIds: [7] });

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Listar categorías';

  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal(replies.at(-1)?.message, 'Categorías disponibles:\n- Manuales (`manuales`)\n- Historico (`historico`) [archived]');
});

test('handleTelegramStorageText lets admins reactivate an archived category', async () => {
  const repository = createRepository([createCategory({ lifecycleStatus: 'archived', archivedAt: '2026-04-21T11:00:00.000Z' })]);
  const { context, replies, getCurrentSession } = createContext(repository, { isAdmin: true, canReadCategoryIds: [7], canUploadCategoryIds: [] });

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);

  context.messageText = 'Reactivar categoría';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'reactivate-category-select');

  context.messageText = 'Manuales';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  const category = await repository.findCategoryById(7);
  assert.equal(category?.lifecycleStatus, 'active');
  assert.equal(replies.at(-1)?.message, 'Categoría reactivada: Manuales.');
  assert.equal(getCurrentSession(), null);
});

test('handleTelegramStorageText lets admins grant category access to a user', async () => {
  const repository = createRepository([createCategory()]);
  const grants: Array<{ subjectTelegramUserId: number; categoryId: number; changedByTelegramUserId: number }> = [];
  const accessRepository: StorageCategoryAccessRepository = {
    async findUserByTelegramUserId(telegramUserId) {
      return { telegramUserId, status: 'approved' };
    },
    async grantCategoryAccess(input) {
      grants.push(input);
    },
    async revokeCategoryAccess() {
      throw new Error('revoke not expected');
    },
  };
  const { context, replies, getCurrentSession } = createContext(repository, {
    isAdmin: true,
    storageCategoryAccessRepository: accessRepository,
  });

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Conceder acceso';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'grant-access-category');

  context.messageText = 'Manuales';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'grant-access-user-id');

  context.messageText = '77';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.deepEqual(grants, [{ subjectTelegramUserId: 77, categoryId: 7, changedByTelegramUserId: 42 }]);
  assert.equal(replies.at(-1)?.message, 'Acceso concedido a 77 para Manuales.');
  assert.equal(getCurrentSession(), null);
});

test('handleTelegramStorageText refuses to grant storage access to a non-approved user', async () => {
  const repository = createRepository([createCategory()]);
  const accessRepository: StorageCategoryAccessRepository = {
    async findUserByTelegramUserId(telegramUserId) {
      return { telegramUserId, status: 'pending' };
    },
    async grantCategoryAccess() {
      throw new Error('grant not expected');
    },
    async revokeCategoryAccess() {
      throw new Error('revoke not expected');
    },
  };
  const { context, replies, getCurrentSession } = createContext(repository, {
    isAdmin: true,
    storageCategoryAccessRepository: accessRepository,
  });

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Conceder acceso';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Manuales';
  await handleTelegramStorageText(context as never);
  context.messageText = '77';

  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal(replies.at(-1)?.message, 'El usuario debe estar aprobado antes de recibir acceso a storage.');
  assert.equal(getCurrentSession()?.stepKey, 'grant-access-user-id');
});

test('handleTelegramStorageText lets admins revoke category access from a user', async () => {
  const repository = createRepository([createCategory()]);
  const revocations: Array<{ subjectTelegramUserId: number; categoryId: number; changedByTelegramUserId: number }> = [];
  const accessRepository: StorageCategoryAccessRepository = {
    async findUserByTelegramUserId(telegramUserId) {
      return { telegramUserId, status: 'approved' };
    },
    async grantCategoryAccess() {
      throw new Error('grant not expected');
    },
    async revokeCategoryAccess(input) {
      revocations.push(input);
    },
  };
  const { context, replies, getCurrentSession } = createContext(repository, {
    isAdmin: true,
    storageCategoryAccessRepository: accessRepository,
  });

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Revocar acceso';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'revoke-access-category');

  context.messageText = 'Manuales';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'revoke-access-user-id');

  context.messageText = '77';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.deepEqual(revocations, [{ subjectTelegramUserId: 77, categoryId: 7, changedByTelegramUserId: 42 }]);
  assert.equal(replies.at(-1)?.message, 'Acceso revocado a 77 para Manuales.');
  assert.equal(getCurrentSession(), null);
});

test('handleTelegramStorageMessage ignores topic uploads from non-approved users', async () => {
  const repository = createRepository([createCategory()]);
  const { context } = createContext(repository, {
    chatKind: 'group',
    chatId: -100123,
    canUploadCategoryIds: [7],
    canReadCategoryIds: [7],
    actorStatus: 'pending',
  });
  context.messageMedia = {
    attachmentKind: 'document',
    fileId: 'file-1',
    fileUniqueId: 'unique-1',
    caption: 'Manual revisado #rol #pdf',
    originalFileName: 'manual.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 1024,
    mediaGroupId: null,
    messageId: 501,
  };
  context.messageThreadId = 10;

  const handled = await handleTelegramStorageMessage(context as never);

  assert.equal(handled, false);
  assert.equal(repository.__entries.length, 0);
});

test('handleTelegramStorageText cleans copied topic messages when DM upload fails midway', async () => {
  const repository = createRepository([createCategory()]);
  const { context, deletedMessages } = createContext(repository, { failCopyMessageAtCall: 2 });

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Subir archivos';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Manuales';
  await handleTelegramStorageText(context as never);

  context.messageMedia = {
    attachmentKind: 'document',
    fileId: 'private-file-1',
    fileUniqueId: 'private-unique-1',
    caption: null,
    originalFileName: 'uno.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 100,
    mediaGroupId: null,
    messageId: 77,
  };
  delete context.messageText;
  await handleTelegramStorageMessage(context as never);

  context.messageMedia = {
    attachmentKind: 'document',
    fileId: 'private-file-2',
    fileUniqueId: 'private-unique-2',
    caption: null,
    originalFileName: 'dos.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 100,
    mediaGroupId: null,
    messageId: 78,
  };
  await handleTelegramStorageMessage(context as never);

  context.messageText = 'Terminar adjuntos';
  delete context.messageMedia;
  await handleTelegramStorageText(context as never);
  context.messageText = 'Omitir';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Omitir';

  await assert.rejects(() => handleTelegramStorageText(context as never), /No se ha podido guardar la entrada en Telegram/);
  assert.equal(repository.__entries.length, 0);
  assert.deepEqual(deletedMessages, [{ chatId: -100123, messageId: 901 }]);
});

test('handleTelegramStorageMessage groups topic uploads by media_group_id into one entry', async () => {
  __resetStorageTopicMediaGroupsForTests();
  const repository = createRepository([createCategory()]);
  const { context } = createContext(repository, { chatKind: 'group', chatId: -100123, canUploadCategoryIds: [7], canReadCategoryIds: [7] });

  context.messageMedia = {
    attachmentKind: 'photo',
    fileId: 'file-1',
    fileUniqueId: 'unique-1',
    caption: null,
    originalFileName: null,
    mimeType: null,
    fileSizeBytes: 100,
    mediaGroupId: 'album-1',
    messageId: 501,
  };
  context.messageThreadId = 10;
  await handleTelegramStorageMessage(context as never);

  context.messageMedia = {
    attachmentKind: 'document',
    fileId: 'file-2',
    fileUniqueId: 'unique-2',
    caption: 'Manual revisado #rol #pdf',
    originalFileName: 'manual.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 1024,
    mediaGroupId: 'album-1',
    messageId: 502,
  };
  await handleTelegramStorageMessage(context as never);

  assert.equal(repository.__entries.length, 0);

  await __flushStorageTopicMediaGroupForTests({
    chatId: -100123,
    threadId: 10,
    mediaGroupId: 'album-1',
  });

  assert.equal(repository.__entries.length, 1);
  assert.equal(repository.__entries[0]?.messages.length, 2);
  assert.equal(repository.__entries[0]?.entry.description, 'Manual revisado');
  assert.deepEqual(repository.__entries[0]?.entry.tags, ['rol', 'pdf']);
});

test('handleTelegramStorageMessage uses the first non-empty caption in album order', async () => {
  __resetStorageTopicMediaGroupsForTests();
  const repository = createRepository([createCategory()]);
  const { context } = createContext(repository, { chatKind: 'group', chatId: -100123, canUploadCategoryIds: [7], canReadCategoryIds: [7] });

  context.messageMedia = {
    attachmentKind: 'photo',
    fileId: 'file-1',
    fileUniqueId: 'unique-1',
    caption: 'Primer caption #uno',
    originalFileName: null,
    mimeType: null,
    fileSizeBytes: 100,
    mediaGroupId: 'album-2',
    messageId: 601,
  };
  context.messageThreadId = 10;
  await handleTelegramStorageMessage(context as never);

  context.messageMedia = {
    attachmentKind: 'document',
    fileId: 'file-2',
    fileUniqueId: 'unique-2',
    caption: 'Segundo caption #dos',
    originalFileName: 'manual.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 1024,
    mediaGroupId: 'album-2',
    messageId: 602,
  };
  await handleTelegramStorageMessage(context as never);

  await __flushStorageTopicMediaGroupForTests({
    chatId: -100123,
    threadId: 10,
    mediaGroupId: 'album-2',
  });

  assert.equal(repository.__entries.length, 1);
  assert.equal(repository.__entries[0]?.entry.description, 'Primer caption');
  assert.deepEqual(repository.__entries[0]?.entry.tags, ['uno']);
});

test('handleTelegramStorageMessage indexes a supported topic upload into the mapped category', async () => {
  const repository = createRepository([createCategory()]);
  const { context } = createContext(repository, { chatKind: 'group', chatId: -100123, canUploadCategoryIds: [7], canReadCategoryIds: [7] });
  context.messageMedia = {
    attachmentKind: 'document',
    fileId: 'file-1',
    fileUniqueId: 'unique-1',
    caption: 'Manual revisado #rol #pdf',
    originalFileName: 'manual.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 1024,
    mediaGroupId: null,
    messageId: 501,
  };
  context.messageThreadId = 10;

  const handled = await handleTelegramStorageMessage(context as never);

  assert.equal(handled, true);
  assert.equal(repository.__entries.length, 1);
  assert.equal(repository.__entries[0]?.entry.description, 'Manual revisado');
  assert.deepEqual(repository.__entries[0]?.entry.tags, ['rol', 'pdf']);
});

test('handleTelegramStorageText collects a DM upload, copies it to the category topic and persists it', async () => {
  const repository = createRepository([createCategory()]);
  const { context, replies, copiedMessages, getCurrentSession } = createContext(repository);

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);

  context.messageText = 'Subir archivos';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'upload-category');

  context.messageText = 'Manuales';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'upload-media');

  context.messageMedia = {
    attachmentKind: 'document',
    fileId: 'private-file-1',
    fileUniqueId: 'private-unique-1',
    caption: null,
    originalFileName: 'campana.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 2048,
    mediaGroupId: null,
    messageId: 77,
  };
  delete context.messageText;
  await handleTelegramStorageMessage(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'upload-media');

  context.messageText = 'Terminar adjuntos';
  delete context.messageMedia;
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'upload-description');

  context.messageText = 'Manual de campana';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'upload-tags');

  context.messageText = '#rol #pdf';
  await handleTelegramStorageText(context as never);

  assert.equal(copiedMessages.length, 1);
  assert.deepEqual(copiedMessages[0], { fromChatId: 42, messageId: 77, toChatId: -100123, messageThreadId: 10 });
  assert.equal(repository.__entries.length, 1);
  assert.equal(repository.__entries[0]?.entry.description, 'Manual de campana');
  assert.deepEqual(repository.__entries[0]?.entry.tags, ['rol', 'pdf']);
  assert.equal(replies.at(-1)?.message, 'Archivo guardado en Manuales con 1 adjunto(s).');
  assert.equal(getCurrentSession(), null);
});
