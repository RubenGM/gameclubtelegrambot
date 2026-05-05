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
  handleTelegramStorageCallback,
  handleTelegramStorageCommand,
  handleTelegramStorageMessage,
  handleTelegramStorageStartText,
  handleTelegramStorageText,
  storageCallbackPrefixes,
} from './storage-flow.js';
import { configureTelegramDeepLinks } from './deep-links.js';
import { toGrammyReplyOptions } from './runtime-boundary-registration.js';

function dangerButton(text: string) {
  return { text, semanticRole: 'danger' as const };
}

function createCategory(overrides: Partial<StorageCategoryRecord> = {}): StorageCategoryRecord {
  return {
    id: 7,
    slug: 'manuales',
    displayName: 'Manuales',
    parentCategoryId: null,
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
        parentCategoryId: input.parentCategoryId,
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
      const detail = {
        entry,
        category,
        messages,
        uploader: { telegramUserId: input.createdByTelegramUserId, username: 'adalovelace', displayName: 'Ada Lovelace' },
      } satisfies StorageEntryDetailRecord;
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
    async appendEntryMessages(input) {
      const existing = entries.find((entry) => entry.entry.id === input.entryId);
      if (!existing) {
        throw new Error(`Storage entry ${input.entryId} not found`);
      }
      const nextSortOrder = Math.max(-1, ...existing.messages.map((message) => message.sortOrder)) + 1;
      existing.messages.push(
        ...input.messages.map((message, index) => ({
          id: existing.messages.length + index + 1,
          entryId: input.entryId,
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
          sortOrder: nextSortOrder + index,
          createdAt: '2026-04-21T13:00:00.000Z',
        })),
      );
      existing.entry.updatedAt = '2026-04-21T13:00:00.000Z';
      return existing;
    },
    async updateEntryMetadata(input) {
      const existing = entries.find((entry) => entry.entry.id === input.entryId);
      if (!existing) {
        throw new Error(`Storage entry ${input.entryId} not found`);
      }
      existing.entry = {
        ...existing.entry,
        description: input.description,
        tags: input.tags,
        updatedAt: '2026-04-21T13:30:00.000Z',
      };
      return existing;
    },
    async updateEntryCategory(input) {
      const existing = entries.find((entry) => entry.entry.id === input.entryId);
      const category = categories.get(input.categoryId);
      if (!existing || !category) {
        throw new Error(`Storage entry ${input.entryId} or category ${input.categoryId} not found`);
      }
      existing.entry = {
        ...existing.entry,
        categoryId: input.categoryId,
        updatedAt: '2026-04-21T13:45:00.000Z',
      };
      existing.category = category;
      return existing;
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
    supportsForwardMessage = true,
    failForwardMessageAtCall,
    storageChat = { id: -100555, type: 'supergroup', title: 'Storage Club', isForum: true },
    storageBotMember = { status: 'administrator', canManageTopics: true },
    createdTopic = { chatId: -100555, name: 'Manuales', messageThreadId: 77 },
    failCreateForumTopic = false,
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
    supportsForwardMessage?: boolean;
    failForwardMessageAtCall?: number;
    storageChat?: { id: number; type: string; title?: string; isForum?: boolean };
    storageBotMember?: { status: string; canManageTopics?: boolean };
    createdTopic?: { chatId: number; name: string; messageThreadId: number };
    failCreateForumTopic?: boolean;
  } = {},
): {
  context: TelegramCommandHandlerContext & Record<string, unknown>;
  replies: Array<{ message: string; options?: TelegramReplyOptions }>;
  copiedMessages: Array<{ fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }>;
  forwardedMessages: Array<{ fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }>;
  mediaGroups: Array<{ chatId: number; media: Array<{ type: 'photo'; media: string; caption?: string }>; messageThreadId?: number }>;
  deletedMessages: Array<{ chatId: number; messageId: number }>;
  getCurrentSession: () => ConversationSessionRecord | null;
} {
  configureTelegramDeepLinks({ botUsername: 'cawatest_bot' });
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const copiedMessages: Array<{ fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }> = [];
  const forwardedMessages: Array<{ fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }> = [];
  const mediaGroups: Array<{ chatId: number; media: Array<{ type: 'photo'; media: string; caption?: string }>; messageThreadId?: number }> = [];
  const deletedMessages: Array<{ chatId: number; messageId: number }> = [];
  let currentSession: ConversationSessionRecord | null = null;
  let copiedMessageId = 900;
  let copyMessageCalls = 0;
  let forwardMessageCalls = 0;

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
        getMe: async () => ({ id: 1234, username: 'gameclub_test_bot' }),
        getChat: async () => storageChat,
        getChatMember: async () => storageBotMember,
        createForumTopic: async ({ chatId, name }: { chatId: number; name: string }) => {
          if (failCreateForumTopic) {
            throw new Error('topic failed');
          }
          return { ...createdTopic, chatId, name };
        },
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
        ...(supportsForwardMessage
          ? {
              forwardMessage: async ({ fromChatId, messageId, toChatId, messageThreadId }: { fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }) => {
                forwardMessageCalls += 1;
                if (failForwardMessageAtCall && forwardMessageCalls === failForwardMessageAtCall) {
                  throw new Error('forward failed');
                }
                forwardedMessages.push(messageThreadId === undefined ? { fromChatId, messageId, toChatId } : { fromChatId, messageId, toChatId, messageThreadId });
                copiedMessageId += 1;
                return { messageId: copiedMessageId };
              },
            }
          : {}),
        sendMediaGroup: async ({ chatId, media, messageThreadId }: { chatId: number; media: Array<{ type: 'photo'; media: string; caption?: string }>; messageThreadId?: number }) => {
          mediaGroups.push(messageThreadId === undefined ? { chatId, media } : { chatId, media, messageThreadId });
          return media.map((_, index) => ({ messageId: 1000 + index }));
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
    forwardedMessages,
    mediaGroups,
    deletedMessages,
    getCurrentSession: () => currentSession,
  };
}

test('handleTelegramStorageText opens the storage submenu from the command entry point', async () => {
  const { context, replies } = createContext(createRepository());

  await handleTelegramStorageCommand(context as never);

  assert.equal(
    replies[0]?.message,
    'Almacenamiento: elige una acción.\n\nCategorías disponibles:\n- <a href="https://t.me/cawatest_bot?start=storage_category_7"><b>Manuales</b></a>',
  );
  assert.equal(replies[0]?.options?.parseMode, 'HTML');
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
  assert.equal(
    replies.at(-1)?.message,
    'Almacenamiento: elige una acción.\n\nCategorías disponibles:\n- <a href="https://t.me/cawatest_bot?start=storage_category_7"><b>Manuales</b></a>',
  );

  context.messageText = 'Listar categorías';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal(replies.at(-1)?.options?.parseMode, 'HTML');
  assert.equal(replies.at(-1)?.message, 'Categorías disponibles:\n- <a href="https://t.me/cawatest_bot?start=storage_category_7"><b>Manuales</b></a>');
});

test('handleTelegramStorageText renders category tree links with local labels', async () => {
  const repository = createRepository([
    createCategory({ id: 7, slug: 'mutant', displayName: 'Mutant Chronicles' }),
    createCategory({ id: 8, slug: 'libros', displayName: 'Libros', parentCategoryId: 7, storageThreadId: 11 }),
  ]);
  const { context, replies } = createContext(repository, { canReadCategoryIds: [7, 8], canUploadCategoryIds: [7, 8] });

  context.messageText = 'Listar categorías';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal(
    replies.at(-1)?.message,
    [
      'Categorías disponibles:',
      '- <a href="https://t.me/cawatest_bot?start=storage_category_7"><b>Mutant Chronicles</b></a>',
      '  - <a href="https://t.me/cawatest_bot?start=storage_category_8"><b>Libros</b></a>',
    ].join('\n'),
  );
});

test('handleTelegramStorageText renders the full category path in entry detail', async () => {
  const repository = createRepository([
    createCategory({ id: 7, slug: 'rol', displayName: 'Rol' }),
    createCategory({ id: 8, slug: 'mutant', displayName: 'Mutant Chronicles', parentCategoryId: 7, storageThreadId: 11 }),
    createCategory({ id: 9, slug: 'libros', displayName: 'Libros', parentCategoryId: 8, storageThreadId: 12 }),
  ]);
  await repository.createEntry({
    categoryId: 9,
    createdByTelegramUserId: 42,
    sourceKind: 'dm_copy',
    description: 'Mutant Chronicles Capitol Sourcebook',
    tags: [],
    messages: [
      {
        storageChatId: -100123,
        storageMessageId: 900,
        storageThreadId: 12,
        telegramFileId: 'file-1',
        telegramFileUniqueId: 'unique-1',
        attachmentKind: 'document',
        caption: null,
        originalFileName: 'capitol.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1024,
        mediaGroupId: null,
        sortOrder: 0,
      },
    ],
  });
  const { context, replies } = createContext(repository, { canReadCategoryIds: [7, 8, 9], canUploadCategoryIds: [7, 8, 9] });

  context.messageText = '/start storage_entry_1';
  await handleTelegramStorageText(context as never);

  assert.match(
    replies[0]?.message ?? '',
    /<b>#1<\/b> · <a href="https:\/\/t\.me\/cawatest_bot\?start=storage_category_9">Rol \/ Mutant Chronicles \/ Libros<\/a>/,
  );
});

test('handleTelegramStorageText lists recent entries as clickable text links without copying attachments', async () => {
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
  const { context, replies, copiedMessages } = createContext(repository, { canReadCategoryIds: [7], canUploadCategoryIds: [7] });
  context.messageText = '/start storage_category_7';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal(replies.at(-1)?.options?.parseMode, 'HTML');
  assert.equal(
    replies.at(-1)?.message,
    [
      '<a href="https://t.me/cawatest_bot?start=storage_category_7"><b>Manuales</b></a>',
      '',
      'Entradas:',
      '- <a href="https://t.me/cawatest_bot?start=storage_entry_1">Manual de campana</a> · #rol, #pdf',
    ].join('\n'),
  );
  assert.deepEqual(copiedMessages, []);
});

test('handleTelegramStorageText lists category entries alphabetically by linked description', async () => {
  const repository = createRepository([createCategory()]);
  for (const description of ['Zeta dossier', 'Alpha manual', 'Beta appendix']) {
    await repository.createEntry({
      categoryId: 7,
      createdByTelegramUserId: 42,
      sourceKind: 'dm_copy',
      description,
      tags: [],
      messages: [
        {
          storageChatId: -100123,
          storageMessageId: 900,
          storageThreadId: 10,
          telegramFileId: 'file-1',
          telegramFileUniqueId: 'unique-1',
          attachmentKind: 'document',
          caption: null,
          originalFileName: `${description}.pdf`,
          mimeType: 'application/pdf',
          fileSizeBytes: 1024,
          mediaGroupId: null,
          sortOrder: 0,
        },
      ],
    });
  }
  const { context, replies } = createContext(repository, { canReadCategoryIds: [7], canUploadCategoryIds: [7] });

  context.messageText = '/start storage_category_7';
  await handleTelegramStorageText(context as never);

  assert.equal(
    replies.at(-1)?.message,
    [
      '<a href="https://t.me/cawatest_bot?start=storage_category_7"><b>Manuales</b></a>',
      '',
      'Entradas:',
      '- <a href="https://t.me/cawatest_bot?start=storage_entry_2">Alpha manual</a>',
      '- <a href="https://t.me/cawatest_bot?start=storage_entry_3">Beta appendix</a>',
      '- <a href="https://t.me/cawatest_bot?start=storage_entry_1">Zeta dossier</a>',
    ].join('\n'),
  );
});

test('handleTelegramStorageText opens a storage category from a deep link', async () => {
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
  const { context, replies, copiedMessages } = createContext(repository, { canReadCategoryIds: [7], canUploadCategoryIds: [7] });

  context.messageText = '/start storage_category_7';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal(replies[0]?.options?.parseMode, 'HTML');
  assert.equal(
    replies[0]?.message,
    [
      '<a href="https://t.me/cawatest_bot?start=storage_category_7"><b>Manuales</b></a>',
      '',
      'Entradas:',
      '- <a href="https://t.me/cawatest_bot?start=storage_entry_1">Manual de campana</a> · #rol, #pdf',
    ].join('\n'),
  );
  assert.deepEqual(copiedMessages, []);
});

test('handleTelegramStorageText shows categories directly in the storage menu', async () => {
  const { context, replies } = createContext(createRepository(), { canReadCategoryIds: [7], canUploadCategoryIds: [7] });
  context.messageText = 'Almacenamiento';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal(replies.at(-1)?.options?.parseMode, 'HTML');
  assert.match(replies.at(-1)?.message ?? '', /Categorías disponibles:/);
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
  assert.equal(replies.at(-1)?.options?.parseMode, 'HTML');
  assert.equal(replies.at(-1)?.message, 'Resultados:\n- <a href="https://t.me/cawatest_bot?start=storage_entry_1"><b>Manuales · #1</b></a> · Manual de campana · Adjuntos: 1 · #rol, #pdf');
});

test('handleTelegramStorageMessage lets admins create a storage category with guided chat selection', async () => {
  const repository = createRepository([]);
  const { context, replies, getCurrentSession } = createContext(repository, { isAdmin: true, canReadCategoryIds: [], canUploadCategoryIds: [] });

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);

  context.messageText = 'Crear categoría';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'create-category-name');

  context.messageText = 'Manuales';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'create-category-parent');

  context.messageText = 'Omitir';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'create-category-description');

  context.messageText = 'Documentacion del club';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'create-category-chat-select');
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [
    [
      {
        text: 'Compartir supergrupo de storage',
        semanticRole: 'primary',
        requestChat: {
          requestId: 41101,
          chatIsChannel: false,
          chatIsForum: true,
          botIsMember: true,
        },
      },
    ],
    [{ text: 'Entrada manual', semanticRole: 'secondary' }],
    [dangerButton('/cancel')],
  ]);

  context.sharedChat = { requestId: 41101, chatId: -100555, title: 'Storage Club' };
  const handled = await handleTelegramStorageMessage(context as never);

  assert.equal(handled, true);
  const categories = await repository.listCategories();
  assert.equal(categories.length, 1);
  assert.equal(categories[0]?.slug, 'manuales');
  assert.equal(categories[0]?.storageChatId, -100555);
  assert.equal(categories[0]?.storageThreadId, 77);
  assert.equal(replies.at(-2)?.message, 'Creando el topic de storage en Storage Club...');
  assert.equal(replies.at(-1)?.message, 'Categoría creada: Manuales (`manuales`). Supergrupo: Storage Club. Topic: Manuales.');
  assert.equal(getCurrentSession(), null);
});

test('handleTelegramStorageText keeps manual category creation as a fallback', async () => {
  const repository = createRepository([]);
  const { context, replies, getCurrentSession } = createContext(repository, { isAdmin: true, canReadCategoryIds: [], canUploadCategoryIds: [] });

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);

  for (const messageText of ['Crear categoría', 'Manuales', 'Omitir', 'Documentacion del club']) {
    context.messageText = messageText;
    await handleTelegramStorageText(context as never);
  }
  assert.equal(getCurrentSession()?.stepKey, 'create-category-chat-select');

  context.messageText = 'Entrada manual';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'create-category-chat-id');
  assert.equal(replies.at(-1)?.message, 'Escribe el chat id del supergrupo de storage.');

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

test('handleTelegramStorageText lets admins create a storage subcategory', async () => {
  const repository = createRepository([createCategory()]);
  const { context, replies } = createContext(repository, { isAdmin: true, canReadCategoryIds: [7], canUploadCategoryIds: [7] });

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);
  for (const messageText of ['Crear categoría', 'Monstruos']) {
    context.messageText = messageText;
    await handleTelegramStorageText(context as never);
  }
  assert.equal(replies.at(-1)?.options?.parseMode, 'HTML');
  assert.equal(replies.at(-1)?.message, 'Elige una categoría padre u Omitir.\nCategorías disponibles:\n- <a href="https://t.me/cawatest_bot?start=storage_category_7"><b>Manuales</b></a>');
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [
    [{ text: 'Omitir', semanticRole: 'success' }],
    [{ text: '/cancel', semanticRole: 'danger' }],
  ]);

  for (const messageText of ['/start storage_category_7', 'Bestiarios y tokens', 'Entrada manual', '-100123', '44']) {
    context.messageText = messageText;
    await handleTelegramStorageText(context as never);
  }

  const categories = await repository.listCategories();
  const created = categories.find((category) => category.slug === 'manuales_monstruos');
  assert.equal(created?.parentCategoryId, 7);
  assert.equal(created?.storageThreadId, 44);
});

test('handleTelegramStorageText builds category slugs from the full parent path', async () => {
  const repository = createRepository([
    createCategory({ id: 7, slug: 'rpg', displayName: 'RPG' }),
    createCategory({ id: 8, slug: 'rpg_books', displayName: 'Books', parentCategoryId: 7, storageThreadId: 11 }),
  ]);
  const { context } = createContext(repository, { isAdmin: true, canReadCategoryIds: [7, 8], canUploadCategoryIds: [7, 8] });

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);
  for (const messageText of ['Crear categoría', 'Dungeons and Dragons 5', 'Books', 'Omitir', 'Entrada manual', '-100123', '44']) {
    context.messageText = messageText;
    await handleTelegramStorageText(context as never);
  }

  const categories = await repository.listCategories();
  const created = categories.find((category) => category.slug === 'rpg_books_dungeonsanddragons5');
  assert.equal(created?.displayName, 'Dungeons and Dragons 5');
  assert.equal(created?.parentCategoryId, 8);
});

test('handleTelegramStorageText asks for a manual slug when the generated one already exists', async () => {
  const repository = createRepository([createCategory()]);
  const { context, replies, getCurrentSession } = createContext(repository, { isAdmin: true, canReadCategoryIds: [7], canUploadCategoryIds: [7] });

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);
  for (const messageText of ['Crear categoría', 'Manuales', 'Omitir']) {
    context.messageText = messageText;
    await handleTelegramStorageText(context as never);
  }

  assert.equal(getCurrentSession()?.stepKey, 'create-category-slug');
  assert.equal(replies.at(-1)?.message, 'No he podido generar un slug único. Escribe el slug de la categoría en minúsculas.');

  for (const messageText of ['manuales_extra', 'Omitir', 'Entrada manual', '-100123', '44']) {
    context.messageText = messageText;
    await handleTelegramStorageText(context as never);
  }

  const categories = await repository.listCategories();
  const created = categories.find((category) => category.slug === 'manuales_extra');
  assert.equal(created?.displayName, 'Manuales');
});

test('handleTelegramStorageMessage explains invalid guided storage chats', async () => {
  const repository = createRepository([]);
  const { context, replies, getCurrentSession } = createContext(repository, {
    isAdmin: true,
    canReadCategoryIds: [],
    canUploadCategoryIds: [],
    storageChat: { id: -100555, type: 'group', title: 'Grupo normal', isForum: false },
  });

  for (const messageText of ['Almacenamiento', 'Crear categoría', 'Manuales', 'Omitir', 'Documentacion del club']) {
    context.messageText = messageText;
    await handleTelegramStorageText(context as never);
  }

  context.sharedChat = { requestId: 41101, chatId: -100555, title: 'Grupo normal' };
  const handled = await handleTelegramStorageMessage(context as never);

  assert.equal(handled, true);
  assert.equal(getCurrentSession()?.stepKey, 'create-category-chat-select');
  assert.equal(replies.at(-1)?.message, 'El chat seleccionado debe ser un supergrupo.');
  assert.equal((await repository.listCategories()).length, 0);
});

test('handleTelegramStorageText uses cancel-only keyboards for storage category creation prompts', async () => {
  const repository = createRepository([]);
  const { context, replies, getCurrentSession } = createContext(repository, { isAdmin: true, canReadCategoryIds: [], canUploadCategoryIds: [] });

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);

  context.messageText = 'Crear categoría';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal(getCurrentSession()?.stepKey, 'create-category-name');
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
  assert.equal(replies.at(-1)?.options?.parseMode, 'HTML');
  assert.match(replies.at(-1)?.message ?? '', /<b>#1<\/b> · <a href="https:\/\/t\.me\/cawatest_bot\?start=storage_category_7">Manuales<\/a>/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /storage_entry_1"><b>#1<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Descripción:<\/b> Manual de campana/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /<b>Origen:<\/b>/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /<b>Adjuntos:<\/b>/);
  assert.equal(getCurrentSession(), null);
});

test('handleTelegramStorageText opens an entry detail from a deep link', async () => {
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
  const { context, replies, copiedMessages } = createContext(repository, { canReadCategoryIds: [7], canUploadCategoryIds: [7] });

  context.messageText = '/start storage_entry_1';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal(replies[0]?.options?.parseMode, 'HTML');
  assert.equal(replies[0]?.message.includes('Subido por'), false);
  assert.doesNotMatch(replies[0]?.message ?? '', /<b>Origen:<\/b>/);
  assert.doesNotMatch(replies[0]?.message ?? '', /<b>Adjuntos:<\/b>/);
  assert.deepEqual(copiedMessages, [{ fromChatId: -100123, messageId: 900, toChatId: 42 }]);
  assert.equal(replies.length, 1);
});

test('handleTelegramStorageText marks entries as missing source when Telegram copy fails', async () => {
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
  const { context, replies, getCurrentSession } = createContext(repository, {
    canReadCategoryIds: [7],
    canUploadCategoryIds: [7],
    failCopyMessageAtCall: 1,
  });

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Abrir entrada';
  await handleTelegramStorageText(context as never);
  context.messageText = '1';

  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal((await repository.getEntryDetail(1))?.entry.lifecycleStatus, 'missing_source');
  assert.equal(replies.at(-1)?.message, 'No he podido recuperar la entrada #1 desde Telegram. La he marcado como fuente perdida para que un admin la revise.');
  assert.equal(getCurrentSession(), null);
});

test('handleTelegramStorageText adds photos to an existing storage entry', async () => {
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

  context.messageText = 'Añadir imágenes';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'add-images-entry-id');

  context.messageText = '1';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'add-images-media');

  context.messageMedia = {
    attachmentKind: 'photo',
    fileId: 'photo-file-1',
    fileUniqueId: 'photo-unique-1',
    caption: 'Portada',
    originalFileName: null,
    mimeType: null,
    fileSizeBytes: 4096,
    mediaGroupId: null,
    messageId: 77,
  };
  delete context.messageText;
  await handleTelegramStorageMessage(context as never);
  assert.equal(replies.at(-1)?.message, 'Imagen añadida al lote actual. Total: 1.');

  context.messageText = 'Terminar adjuntos';
  delete context.messageMedia;
  const handled = await handleTelegramStorageText(context as never);

  const detail = await repository.getEntryDetail(1);
  assert.equal(handled, true);
  assert.equal(detail?.messages.length, 2);
  assert.equal(detail?.messages[1]?.attachmentKind, 'photo');
  assert.equal(detail?.messages[1]?.caption, 'Portada');
  assert.deepEqual(copiedMessages.at(-1), { fromChatId: 42, messageId: 77, toChatId: -100123, messageThreadId: 10 });
  assert.equal(replies.at(-1)?.message, 'Imágenes añadidas a la entrada #1. Total añadido: 1.');
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
  let handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal(getCurrentSession()?.stepKey, 'delete-entry-confirm');
  assert.equal(replies.at(-1)?.message, 'Escribe DELETE exactamente para eliminar la entrada #1.');
  assert.equal((await repository.getEntryDetail(1))?.entry.lifecycleStatus, 'active');

  context.messageText = 'delete';
  handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal(getCurrentSession()?.stepKey, 'delete-entry-confirm');
  assert.equal(replies.at(-1)?.message, 'La confirmación no coincide. Escribe DELETE exactamente para eliminar la entrada #1, o /cancel para salir.');
  assert.equal((await repository.getEntryDetail(1))?.entry.lifecycleStatus, 'active');

  context.messageText = 'DELETE';
  handled = await handleTelegramStorageText(context as never);

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

  context.messageText = '/start storage_category_7';
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

test('handleTelegramStorageText accepts a category deep link while choosing an upload category', async () => {
  const repository = createRepository([
    createCategory({ id: 7, slug: 'mutant', displayName: 'Mutant Chronicles' }),
    createCategory({ id: 8, slug: 'libros', displayName: 'Libros', parentCategoryId: 7, storageThreadId: 11 }),
  ]);
  const { context, replies, getCurrentSession } = createContext(repository, { canReadCategoryIds: [7, 8], canUploadCategoryIds: [7, 8] });

  context.messageText = 'Subir archivos';
  await handleTelegramStorageText(context as never);

  assert.equal(getCurrentSession()?.stepKey, 'upload-category');
  assert.match(replies.at(-1)?.message ?? '', /<b>Mutant Chronicles<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /  - <a href="https:\/\/t\.me\/cawatest_bot\?start=storage_category_8"><b>Libros<\/b><\/a>/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Mutant Chronicles \/ Libros/);

  context.messageText = '/start storage_category_8';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal(getCurrentSession()?.stepKey, 'upload-media');
  assert.equal(getCurrentSession()?.data.categoryId, 8);
  assert.equal(getCurrentSession()?.data.categoryDisplayName, 'Libros');
});

test('handleTelegramStorageStartText selects a category deep link while choosing an upload category', async () => {
  const repository = createRepository([
    createCategory({ id: 7, slug: 'mutant', displayName: 'Mutant Chronicles' }),
    createCategory({ id: 8, slug: 'libros', displayName: 'Libros', parentCategoryId: 7, storageThreadId: 11 }),
  ]);
  const { context, getCurrentSession } = createContext(repository, { canReadCategoryIds: [7, 8], canUploadCategoryIds: [7, 8] });

  context.messageText = 'Subir archivos';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'upload-category');

  context.messageText = '/start storage_category_8';
  const handled = await handleTelegramStorageStartText(context as never);

  assert.equal(handled, true);
  assert.equal(getCurrentSession()?.stepKey, 'upload-media');
  assert.equal(getCurrentSession()?.data.categoryId, 8);
});

test('handleTelegramStorageText hides archived categories from admins in category listing', async () => {
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
  assert.equal(replies.at(-1)?.options?.parseMode, 'HTML');
  assert.equal(
    replies.at(-1)?.message,
    [
      'Categorías disponibles:',
      '- <a href="https://t.me/cawatest_bot?start=storage_category_7"><b>Manuales</b></a>',
    ].join('\n'),
  );
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
      return { telegramUserId, username: 'ada', displayName: 'Ada Lovelace', status: 'approved', isAdmin: false };
    },
    async listApprovedUsers() {
      return [
        { telegramUserId: 77, username: 'ada', displayName: 'Ada Lovelace', status: 'approved', isAdmin: false },
      ];
    },
    async listCategoryAccessUsers() {
      return [];
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
  assert.equal(getCurrentSession()?.stepKey, 'grant-access-user');
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [
    ['Ada Lovelace (@ada) · 77'],
    [dangerButton('/cancel')],
  ]);

  context.messageText = 'Ada Lovelace (@ada) · 77';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.deepEqual(grants, [{ subjectTelegramUserId: 77, categoryId: 7, changedByTelegramUserId: 42 }]);
  assert.equal(replies.at(-1)?.message, 'Acceso concedido a Ada Lovelace (@ada) · 77 para Manuales.');
  assert.equal(getCurrentSession(), null);
});

test('handleTelegramStorageText refuses to grant storage access to a non-approved user', async () => {
  const repository = createRepository([createCategory()]);
  const accessRepository: StorageCategoryAccessRepository = {
    async findUserByTelegramUserId(telegramUserId) {
      return { telegramUserId, username: 'ada', displayName: 'Ada Lovelace', status: 'pending', isAdmin: false };
    },
    async listApprovedUsers() {
      return [
        { telegramUserId: 77, username: 'ada', displayName: 'Ada Lovelace', status: 'approved', isAdmin: false },
      ];
    },
    async listCategoryAccessUsers() {
      return [];
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
  context.messageText = 'Ada Lovelace (@ada) · 77';

  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal(replies.at(-1)?.message, 'El usuario debe estar aprobado antes de recibir acceso a storage.');
  assert.equal(getCurrentSession()?.stepKey, 'grant-access-user');
});

test('handleTelegramStorageText lets admins revoke category access from a user', async () => {
  const repository = createRepository([createCategory()]);
  const revocations: Array<{ subjectTelegramUserId: number; categoryId: number; changedByTelegramUserId: number }> = [];
  const accessRepository: StorageCategoryAccessRepository = {
    async findUserByTelegramUserId(telegramUserId) {
      return { telegramUserId, username: 'ada', displayName: 'Ada Lovelace', status: 'approved', isAdmin: false };
    },
    async listApprovedUsers() {
      return [];
    },
    async listCategoryAccessUsers() {
      return [
        { telegramUserId: 77, username: 'ada', displayName: 'Ada Lovelace', status: 'approved', isAdmin: false },
      ];
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
  assert.equal(getCurrentSession()?.stepKey, 'revoke-access-user');

  context.messageText = 'Ada Lovelace (@ada) · 77';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.deepEqual(revocations, [{ subjectTelegramUserId: 77, categoryId: 7, changedByTelegramUserId: 42 }]);
  assert.equal(replies.at(-1)?.message, 'Acceso revocado a Ada Lovelace (@ada) · 77 para Manuales.');
  assert.equal(getCurrentSession(), null);
});

test('handleTelegramStorageText lets admins view direct category access', async () => {
  const repository = createRepository([createCategory()]);
  const accessRepository: StorageCategoryAccessRepository = {
    async findUserByTelegramUserId(telegramUserId) {
      return { telegramUserId, username: 'ada', displayName: 'Ada Lovelace', status: 'approved', isAdmin: false };
    },
    async listApprovedUsers() {
      return [];
    },
    async listCategoryAccessUsers() {
      return [
        { telegramUserId: 77, username: 'ada', displayName: 'Ada Lovelace', status: 'approved', isAdmin: false },
        { telegramUserId: 88, username: null, displayName: 'Grace Hopper', status: 'approved', isAdmin: false },
      ];
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
  context.messageText = 'Ver accesos';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'view-access-category');

  context.messageText = 'Manuales';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal(replies.at(-1)?.message, [
    'Usuarios con acceso directo a Manuales:',
    '- Ada Lovelace (@ada) · 77',
    '- Grace Hopper · 88',
  ].join('\n'));
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
  const { context, deletedMessages } = createContext(repository, { failCopyMessageAtCall: 2, supportsForwardMessage: false });

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
  context.messageText = 'Guardar juntos';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Aceptar';

  await assert.rejects(() => handleTelegramStorageText(context as never), /No se ha podido guardar la entrada en Telegram/);
  assert.equal(repository.__entries.length, 0);
  assert.deepEqual(deletedMessages, [{ chatId: -100123, messageId: 901 }]);
});

test('handleTelegramStorageText forwards large DM uploads to storage instead of copying them', async () => {
  const repository = createRepository([createCategory()]);
  const { context, copiedMessages, forwardedMessages } = createContext(repository);

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Subir archivos';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Manuales';
  await handleTelegramStorageText(context as never);

  context.messageMedia = {
    attachmentKind: 'document',
    fileId: 'private-file-large',
    fileUniqueId: 'private-unique-large',
    caption: null,
    originalFileName: 'large.zip',
    mimeType: 'application/zip',
    fileSizeBytes: 2 * 1024 * 1024 * 1024,
    mediaGroupId: null,
    messageId: 77,
  };
  delete context.messageText;
  await handleTelegramStorageMessage(context as never);

  context.messageText = 'Terminar adjuntos';
  delete context.messageMedia;
  await handleTelegramStorageText(context as never);
  context.messageText = 'Aceptar';
  await handleTelegramStorageText(context as never);

  assert.deepEqual(copiedMessages, []);
  assert.deepEqual(forwardedMessages, [{ fromChatId: 42, messageId: 77, toChatId: -100123, messageThreadId: 10 }]);
  assert.equal(repository.__entries[0]?.messages[0]?.storageMessageId, 901);
});

test('handleTelegramStorageText rejects DM uploads above Telegram storage limit when received', async () => {
  const repository = createRepository([createCategory()]);
  const { context, replies, copiedMessages, forwardedMessages, getCurrentSession } = createContext(repository);

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Subir archivos';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Manuales';
  await handleTelegramStorageText(context as never);

  context.messageMedia = {
    attachmentKind: 'document',
    fileId: 'private-file-too-large',
    fileUniqueId: 'private-unique-too-large',
    caption: null,
    originalFileName: 'too-large.zip',
    mimeType: 'application/zip',
    fileSizeBytes: (2 * 1024 * 1024 * 1024) + 1,
    mediaGroupId: null,
    messageId: 77,
  };
  delete context.messageText;
  const handled = await handleTelegramStorageMessage(context as never);

  assert.equal(handled, true);
  assert.equal(replies.at(-1)?.message, 'Este adjunto pesa 2048 MB. El límite máximo que el bot puede archivar es 2048 MB. Divídelo en partes más pequeñas.');
  assert.deepEqual(copiedMessages, []);
  assert.deepEqual(forwardedMessages, []);
  assert.deepEqual(getCurrentSession()?.data.messages, []);
});

test('handleTelegramStorageText falls back to forwarding when Telegram copy fails', async () => {
  const repository = createRepository([createCategory()]);
  const { context, copiedMessages, forwardedMessages } = createContext(repository, { failCopyMessageAtCall: 1 });

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Subir archivos';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Manuales';
  await handleTelegramStorageText(context as never);

  context.messageMedia = {
    attachmentKind: 'document',
    fileId: 'private-file',
    fileUniqueId: 'private-unique',
    caption: null,
    originalFileName: 'manual.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 1024,
    mediaGroupId: null,
    messageId: 77,
  };
  delete context.messageText;
  await handleTelegramStorageMessage(context as never);

  context.messageText = 'Terminar adjuntos';
  delete context.messageMedia;
  await handleTelegramStorageText(context as never);
  context.messageText = 'Aceptar';
  await handleTelegramStorageText(context as never);

  assert.deepEqual(copiedMessages, []);
  assert.deepEqual(forwardedMessages, [{ fromChatId: 42, messageId: 77, toChatId: -100123, messageThreadId: 10 }]);
  assert.equal(repository.__entries.length, 1);
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

test('handleTelegramStorageText edits storage entry metadata', async () => {
  const repository = createRepository([createCategory()]);
  await repository.createEntry({
    categoryId: 7,
    createdByTelegramUserId: 42,
    sourceKind: 'dm_copy',
    description: null,
    tags: [],
    messages: [{
      storageChatId: -100123,
      storageMessageId: 501,
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
    }],
  });
  const { context, replies, getCurrentSession } = createContext(repository);

  context.messageText = 'Editar detalles';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'edit-category');
  assert.match(replies.at(-1)?.message ?? '', /https:\/\/t\.me\/cawatest_bot\?start=storage_edit_category_7/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /https:\/\/t\.me\/cawatest_bot\?start=storage_category_7/);

  context.messageText = 'Manuales';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'edit-entry-select');
  assert.match(replies.at(-1)?.message ?? '', /https:\/\/t\.me\/cawatest_bot\?start=storage_edit_entry_1/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /https:\/\/t\.me\/cawatest_bot\?start=storage_entry_1/);

  context.messageText = '#1 - manual.pdf';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'edit-entry-action');

  context.messageText = 'Modificar descripción';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'edit-entry-description');

  context.messageText = 'Manual revisado';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'edit-entry-tags');

  context.messageText = '#rol #pdf';
  await handleTelegramStorageText(context as never);

  assert.equal(repository.__entries[0]?.entry.description, 'Manual revisado');
  assert.deepEqual(repository.__entries[0]?.entry.tags, ['rol', 'pdf']);
  assert.equal(replies.at(-1)?.message, 'Detalles actualizados en la entrada #1.\n\n¿Qué quieres modificar de esta entrada?');
  assert.equal(getCurrentSession()?.stepKey, 'edit-entry-action');

  context.messageText = 'Terminar edición';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession(), null);
  assert.equal(replies.at(-1)?.message, 'Almacenamiento: elige una acción.');
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard?.flat().map((button) => typeof button === 'string' ? button : button.text), [
    'Listar categorías',
    'Buscar archivos',
    'Abrir entrada',
    'Subir archivos',
    'Añadir imágenes',
    'Editar detalles',
    'Inicio',
    'Ayuda',
  ]);
});

test('handleTelegramStorageText moves an entry to another category with tree links', async () => {
  const repository = createRepository([
    createCategory({ id: 7, slug: 'manuales', displayName: 'Manuales' }),
    createCategory({ id: 8, slug: 'malifaux', displayName: 'Malifaux', storageThreadId: 11 }),
  ]);
  await repository.createEntry({
    categoryId: 7,
    createdByTelegramUserId: 42,
    sourceKind: 'dm_copy',
    description: 'Manual base',
    tags: [],
    messages: [{
      storageChatId: -100123,
      storageMessageId: 501,
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
    }],
  });
  const { context, replies, getCurrentSession } = createContext(repository, {
    canReadCategoryIds: [7, 8],
    canUploadCategoryIds: [7, 8],
  });

  context.messageText = '/start storage_edit_entry_1';
  await handleTelegramStorageStartText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'edit-entry-action');

  context.messageText = 'Mover categoría';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'edit-entry-move-category');
  assert.match(replies.at(-1)?.message ?? '', /Elige la nueva categoría de la entrada\./);
  assert.match(replies.at(-1)?.message ?? '', /https:\/\/t\.me\/cawatest_bot\?start=storage_category_8/);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard?.flat().map((button) => typeof button === 'string' ? button : button.text), ['/cancel']);

  context.messageText = '/start storage_category_8';
  await handleTelegramStorageStartText(context as never);

  assert.equal(repository.__entries[0]?.entry.categoryId, 8);
  assert.equal(repository.__entries[0]?.category.displayName, 'Malifaux');
  assert.equal(getCurrentSession()?.stepKey, 'edit-entry-action');
  assert.equal(replies.at(-1)?.message, 'Entrada #1 movida a Malifaux.\n\n¿Qué quieres modificar de esta entrada?');
});

test('handleTelegramStorageText opens editable entries from an edit category deep link', async () => {
  const repository = createRepository([createCategory()]);
  await repository.createEntry({
    categoryId: 7,
    createdByTelegramUserId: 42,
    sourceKind: 'dm_copy',
    description: 'Manual',
    tags: [],
    messages: [{
      storageChatId: -100123,
      storageMessageId: 501,
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
    }],
  });
  const { context, replies, getCurrentSession } = createContext(repository);

  context.messageText = '/start storage_edit_category_7';
  const handled = await handleTelegramStorageStartText(context as never);

  assert.equal(handled, true);
  assert.equal(getCurrentSession()?.flowKey, 'storage-edit-entry');
  assert.equal(getCurrentSession()?.stepKey, 'edit-entry-select');
  assert.match(replies.at(-1)?.message ?? '', /https:\/\/t\.me\/cawatest_bot\?start=storage_edit_entry_1/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /https:\/\/t\.me\/cawatest_bot\?start=storage_entry_1/);
});

test('handleTelegramStorageText starts metadata editing from an edit deep link', async () => {
  const repository = createRepository([createCategory()]);
  await repository.createEntry({
    categoryId: 7,
    createdByTelegramUserId: 42,
    sourceKind: 'dm_copy',
    description: null,
    tags: [],
    messages: [{
      storageChatId: -100123,
      storageMessageId: 501,
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
    }],
  });
  const { context, replies, getCurrentSession } = createContext(repository);

  context.messageText = '/start storage_edit_entry_1';
  const handled = await handleTelegramStorageStartText(context as never);

  assert.equal(handled, true);
  assert.equal(getCurrentSession()?.flowKey, 'storage-edit-entry');
  assert.equal(getCurrentSession()?.stepKey, 'edit-entry-action');
  assert.equal(replies.at(-1)?.message, '¿Qué quieres modificar de esta entrada?');
});

test('sendStorageEntryDetail hides uploader for regular users and sends photos as an album', async () => {
  const repository = createRepository([createCategory()]);
  await repository.createEntry({
    categoryId: 7,
    createdByTelegramUserId: 99,
    sourceKind: 'dm_copy',
    description: 'Galeria',
    tags: ['mapa'],
    messages: [
      {
        storageChatId: -100123,
        storageMessageId: 501,
        storageThreadId: 10,
        telegramFileId: 'photo-file-1',
        telegramFileUniqueId: 'photo-unique-1',
        attachmentKind: 'photo',
        caption: null,
        originalFileName: null,
        mimeType: null,
        fileSizeBytes: 100,
        mediaGroupId: null,
        sortOrder: 0,
      },
      {
        storageChatId: -100123,
        storageMessageId: 502,
        storageThreadId: 10,
        telegramFileId: 'photo-file-2',
        telegramFileUniqueId: 'photo-unique-2',
        attachmentKind: 'photo',
        caption: null,
        originalFileName: null,
        mimeType: null,
        fileSizeBytes: 100,
        mediaGroupId: null,
        sortOrder: 1,
      },
    ],
  });
  const { context, replies, copiedMessages, mediaGroups } = createContext(repository, { canReadCategoryIds: [7], canUploadCategoryIds: [] });

  context.messageText = '/start storage_entry_1';
  await handleTelegramStorageStartText(context as never);

  assert.equal(replies[0]?.message.includes('Subido por'), false);
  assert.equal(copiedMessages.length, 0);
  assert.equal(mediaGroups.length, 1);
  assert.deepEqual(mediaGroups[0]?.media, [
    { type: 'photo', media: 'photo-file-1' },
    { type: 'photo', media: 'photo-file-2' },
  ]);
  assert.equal(replies[0]?.options?.inlineKeyboard, undefined);
});

test('sendStorageEntryDetail hides uploader for admins', async () => {
  const repository = createRepository([createCategory()]);
  await repository.createEntry({
    categoryId: 7,
    createdByTelegramUserId: 42,
    sourceKind: 'dm_copy',
    description: 'Manual',
    tags: [],
    messages: [{
      storageChatId: -100123,
      storageMessageId: 501,
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
    }],
  });
  const { context, replies } = createContext(repository, { isAdmin: true });

  context.messageText = '/start storage_entry_1';
  await handleTelegramStorageStartText(context as never);

  assert.equal(replies[0]?.message.includes('Subido por'), false);
  assert.doesNotMatch(replies[0]?.message ?? '', /<b>Tags:<\/b> Sin tags/);
  assert.doesNotMatch(replies[0]?.message ?? '', /<b>Origen:<\/b>/);
  assert.doesNotMatch(replies[0]?.message ?? '', /<b>Adjuntos:<\/b>/);
  assert.deepEqual(replies[0]?.options?.inlineKeyboard, [
    [
      { text: 'Editar', callbackData: `${storageCallbackPrefixes.editEntry}1` },
      { text: 'Eliminar', callbackData: `${storageCallbackPrefixes.deleteEntry}1`, semanticRole: 'danger' },
    ],
  ]);
  assert.deepEqual(toGrammyReplyOptions(replies[0]?.options), {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: 'Editar', callback_data: `${storageCallbackPrefixes.editEntry}1` },
        { text: 'Eliminar', callback_data: `${storageCallbackPrefixes.deleteEntry}1` },
      ]],
    },
  });
});

test('sendStorageEntryDetail shows edit action to the original uploader', async () => {
  const repository = createRepository([createCategory()]);
  await repository.createEntry({
    categoryId: 7,
    createdByTelegramUserId: 42,
    sourceKind: 'dm_copy',
    description: 'Manual propio',
    tags: [],
    messages: [{
      storageChatId: -100123,
      storageMessageId: 501,
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
    }],
  });
  const { context, replies } = createContext(repository, { canReadCategoryIds: [7], canUploadCategoryIds: [] });

  context.messageText = '/start storage_entry_1';
  await handleTelegramStorageStartText(context as never);

  assert.deepEqual(replies[0]?.options?.inlineKeyboard, [
    [
      { text: 'Editar', callbackData: `${storageCallbackPrefixes.editEntry}1` },
      { text: 'Eliminar', callbackData: `${storageCallbackPrefixes.deleteEntry}1`, semanticRole: 'danger' },
    ],
  ]);
});

test('handleTelegramStorageCallback opens edit flow only for allowed users', async () => {
  const repository = createRepository([createCategory()]);
  await repository.createEntry({
    categoryId: 7,
    createdByTelegramUserId: 99,
    sourceKind: 'dm_copy',
    description: 'Manual ajeno',
    tags: [],
    messages: [{
      storageChatId: -100123,
      storageMessageId: 501,
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
    }],
  });
  const denied = createContext(repository, { canReadCategoryIds: [7], canUploadCategoryIds: [] });

  denied.context.callbackData = `${storageCallbackPrefixes.editEntry}1`;
  assert.equal(await handleTelegramStorageCallback(denied.context as never), true);
  assert.equal(denied.getCurrentSession(), null);
  assert.equal(denied.replies.at(-1)?.message, 'No existe ninguna entrada disponible con ese identificador.');

  const uploader = createContext(repository, { actorTelegramUserId: 99, canReadCategoryIds: [7], canUploadCategoryIds: [] });
  uploader.context.callbackData = `${storageCallbackPrefixes.editEntry}1`;
  assert.equal(await handleTelegramStorageCallback(uploader.context as never), true);
  assert.equal(uploader.getCurrentSession()?.flowKey, 'storage-edit-entry');
  assert.equal(uploader.getCurrentSession()?.stepKey, 'edit-entry-action');
  assert.equal(uploader.replies.at(-1)?.message, '¿Qué quieres modificar de esta entrada?');
});

test('handleTelegramStorageCallback deletes entries only for admins or the original uploader', async () => {
  const repository = createRepository([createCategory()]);
  await repository.createEntry({
    categoryId: 7,
    createdByTelegramUserId: 99,
    sourceKind: 'dm_copy',
    description: 'Manual propio',
    tags: [],
    messages: [{
      storageChatId: -100123,
      storageMessageId: 501,
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
    }],
  });

  const denied = createContext(repository, { canReadCategoryIds: [7], canUploadCategoryIds: [] });
  denied.context.callbackData = `${storageCallbackPrefixes.deleteEntry}1`;
  assert.equal(await handleTelegramStorageCallback(denied.context as never), true);
  assert.equal((await repository.getEntryDetail(1))?.entry.lifecycleStatus, 'active');
  assert.equal(denied.replies.at(-1)?.message, 'No existe ninguna entrada disponible con ese identificador.');

  const uploader = createContext(repository, { actorTelegramUserId: 99, canReadCategoryIds: [7], canUploadCategoryIds: [] });
  uploader.context.callbackData = `${storageCallbackPrefixes.deleteEntry}1`;
  assert.equal(await handleTelegramStorageCallback(uploader.context as never), true);
  assert.equal(uploader.getCurrentSession()?.stepKey, 'delete-entry-confirm');
  assert.equal(uploader.replies.at(-1)?.message, 'Escribe DELETE exactamente para eliminar la entrada #1.');
  assert.equal((await repository.getEntryDetail(1))?.entry.lifecycleStatus, 'active');

  delete uploader.context.callbackData;
  uploader.context.messageText = 'DELETE';
  assert.equal(await handleTelegramStorageText(uploader.context as never), true);
  assert.equal((await repository.getEntryDetail(1))?.entry.lifecycleStatus, 'deleted');
  assert.equal((await repository.getEntryDetail(1))?.entry.deletedByTelegramUserId, 99);
  assert.equal(uploader.replies.at(-1)?.message, 'Entrada #1 borrada lógicamente.');

  await repository.updateEntryLifecycleStatus({ entryId: 1, lifecycleStatus: 'active', deletedByTelegramUserId: null });
  const admin = createContext(repository, { isAdmin: true, actorTelegramUserId: 42 });
  admin.context.callbackData = `${storageCallbackPrefixes.deleteEntry}1`;
  assert.equal(await handleTelegramStorageCallback(admin.context as never), true);
  assert.equal((await repository.getEntryDetail(1))?.entry.lifecycleStatus, 'active');

  delete admin.context.callbackData;
  admin.context.messageText = 'DELETE';
  assert.equal(await handleTelegramStorageText(admin.context as never), true);
  assert.equal((await repository.getEntryDetail(1))?.entry.lifecycleStatus, 'deleted');
  assert.equal((await repository.getEntryDetail(1))?.entry.deletedByTelegramUserId, 42);
});

test('handleTelegramStorageCallback lets the uploader add images from the edit flow', async () => {
  const repository = createRepository([createCategory()]);
  await repository.createEntry({
    categoryId: 7,
    createdByTelegramUserId: 42,
    sourceKind: 'dm_copy',
    description: 'Manual propio',
    tags: [],
    messages: [{
      storageChatId: -100123,
      storageMessageId: 501,
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
    }],
  });
  const { context, copiedMessages, getCurrentSession } = createContext(repository, { canReadCategoryIds: [7], canUploadCategoryIds: [] });

  context.callbackData = `${storageCallbackPrefixes.editEntry}1`;
  await handleTelegramStorageCallback(context as never);

  delete context.callbackData;
  context.messageText = 'Añadir imágenes';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'add-images-media');

  delete context.messageText;
  context.messageMedia = {
    attachmentKind: 'photo',
    fileId: 'photo-file',
    fileUniqueId: 'photo-unique',
    caption: null,
    originalFileName: null,
    mimeType: null,
    fileSizeBytes: 100,
    mediaGroupId: null,
    messageId: 777,
  };
  await handleTelegramStorageMessage(context as never);

  delete context.messageMedia;
  context.messageText = 'Terminar adjuntos';
  await handleTelegramStorageText(context as never);

  assert.equal(repository.__entries[0]?.messages.length, 2);
  assert.deepEqual(copiedMessages.at(-1), { fromChatId: 42, messageId: 777, toChatId: -100123, messageThreadId: 10 });
  assert.equal(getCurrentSession()?.stepKey, 'edit-entry-action');
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
  assert.equal(getCurrentSession()?.stepKey, 'upload-preview');
  assert.match(replies.at(-1)?.message ?? '', /Vista previa de la subida/);

  context.messageText = 'Modificar descripción';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'upload-description');
  context.messageText = 'Manual de campana';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'upload-preview');

  context.messageText = 'Aceptar';
  await handleTelegramStorageText(context as never);

  assert.equal(copiedMessages.length, 1);
  assert.deepEqual(copiedMessages[0], { fromChatId: 42, messageId: 77, toChatId: -100123, messageThreadId: 10 });
  assert.equal(repository.__entries.length, 1);
  assert.equal(repository.__entries[0]?.entry.description, 'Manual de campana');
  assert.deepEqual(repository.__entries[0]?.entry.tags, []);
  assert.equal(replies.at(-1)?.message, 'Archivo guardado en Manuales con 1 adjunto(s).');
  assert.equal(getCurrentSession(), null);
});

test('handleTelegramStorageText uses the normalized file name as the default upload description', async () => {
  const repository = createRepository([createCategory()]);
  const { context, replies, getCurrentSession } = createContext(repository);

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
    originalFileName: 'Manual_de_Campaña-final.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 2048,
    mediaGroupId: null,
    messageId: 77,
  };
  delete context.messageText;
  await handleTelegramStorageMessage(context as never);

  context.messageText = 'Terminar adjuntos';
  delete context.messageMedia;
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'upload-preview');
  assert.match(replies.at(-1)?.message ?? '', /Manual de Campana final/);

  context.messageText = 'Aceptar';
  await handleTelegramStorageText(context as never);

  assert.equal(repository.__entries[0]?.entry.description, 'Manual de Campana final');
  assert.deepEqual(repository.__entries[0]?.entry.tags, []);
  assert.equal(getCurrentSession(), null);
});

test('handleTelegramStorageText adds images to the upload draft from the preview', async () => {
  const repository = createRepository([createCategory()]);
  const { context, copiedMessages, getCurrentSession } = createContext(repository);

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
    originalFileName: 'manual.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 2048,
    mediaGroupId: null,
    messageId: 77,
  };
  delete context.messageText;
  await handleTelegramStorageMessage(context as never);

  context.messageText = 'Terminar adjuntos';
  delete context.messageMedia;
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'upload-preview');

  context.messageText = 'Añadir imágenes';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'upload-preview-images');

  context.messageMedia = {
    attachmentKind: 'photo',
    fileId: 'photo-file-1',
    fileUniqueId: 'photo-unique-1',
    caption: 'Portada',
    originalFileName: null,
    mimeType: null,
    fileSizeBytes: 4096,
    mediaGroupId: null,
    messageId: 78,
  };
  delete context.messageText;
  await handleTelegramStorageMessage(context as never);

  context.messageText = 'Terminar adjuntos';
  delete context.messageMedia;
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'upload-preview');

  context.messageText = 'Aceptar';
  await handleTelegramStorageText(context as never);

  assert.equal(repository.__entries.length, 1);
  assert.equal(repository.__entries[0]?.messages.length, 2);
  assert.equal(repository.__entries[0]?.messages[1]?.attachmentKind, 'photo');
  assert.equal(repository.__entries[0]?.messages[1]?.caption, 'Portada');
  assert.deepEqual(copiedMessages.map((message) => message.messageId), [77, 78]);
  assert.equal(getCurrentSession(), null);
});

test('handleTelegramStorageText asks whether multiple DM uploads should be stored together or separately', async () => {
  const repository = createRepository([createCategory()]);
  const { context, replies, copiedMessages, getCurrentSession } = createContext(repository);

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

  assert.equal(getCurrentSession()?.stepKey, 'upload-grouping');
  assert.equal(replies.at(-1)?.message, 'Has enviado más de un adjunto. ¿Quieres guardarlos juntos en una entrada o separados?');
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard?.slice(0, 2), [[{ text: 'Guardar juntos', semanticRole: 'success' }], [{ text: 'Guardar separados', semanticRole: 'secondary' }]]);

  context.messageText = 'Guardar separados';
  await handleTelegramStorageText(context as never);

  assert.equal(repository.__entries.length, 2);
  assert.equal(repository.__entries[0]?.entry.description, 'uno');
  assert.equal(repository.__entries[1]?.entry.description, 'dos');
  assert.equal(copiedMessages.length, 2);
  assert.equal(replies.at(-3)?.message, 'Guardando 1/2: uno.pdf');
  assert.equal(replies.at(-2)?.message, 'Guardando 2/2: dos.pdf');
  assert.equal(replies.at(-1)?.message, '2 archivo(s) guardado(s) por separado en Manuales.');
  assert.equal(getCurrentSession(), null);
});

test('handleTelegramStorageText reports partial progress when separate uploads fail', async () => {
  const repository = createRepository([createCategory()]);
  const { context, replies, copiedMessages, getCurrentSession } = createContext(repository, {
    failCopyMessageAtCall: 2,
    supportsForwardMessage: false,
  });

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
  context.messageText = 'Guardar separados';
  await handleTelegramStorageText(context as never);

  assert.equal(repository.__entries.length, 1);
  assert.equal(repository.__entries[0]?.entry.description, 'uno');
  assert.equal(copiedMessages.length, 1);
  assert.equal(replies.at(-3)?.message, 'Guardando 1/2: uno.pdf');
  assert.equal(replies.at(-2)?.message, 'Guardando 2/2: dos.pdf');
  assert.equal(replies.at(-1)?.message, 'Se han guardado 1/2 archivos. Ha fallado el 2: dos.pdf. El resto no se ha procesado; vuelve a subir solo los pendientes.');
  assert.equal(getCurrentSession(), null);
});
