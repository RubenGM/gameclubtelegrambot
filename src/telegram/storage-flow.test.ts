import test from 'node:test';
import assert from 'node:assert/strict';

import type { ConversationSessionRecord } from './conversation-session.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import type { AppMetadataSessionStorage } from './conversation-session-store.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import type { TelegramPhotoMediaInput } from './telegram-media.js';
import type {
  StorageCategoryRecord,
  StorageCategoryRepository,
  StorageEntryDetailRecord,
  StorageEntryMessageRecord,
  StorageEntryRecord,
} from '../storage/storage-catalog.js';
import type { StorageCategoryAccessRepository } from '../storage/storage-category-access-store.js';
import type {
  StorageCategorySubscriptionRecord,
  StorageCategorySubscriptionRepository,
} from '../storage/storage-category-subscription-store.js';
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

function successButton(text: string) {
  return { text, semanticRole: 'success' as const };
}

function secondaryButton(text: string) {
  return { text, semanticRole: 'secondary' as const };
}

function createMemoryMetadataStorage(initialValues: Record<string, string> = {}): AppMetadataSessionStorage & {
  __values: Map<string, string>;
} {
  const values = new Map(Object.entries(initialValues));
  return {
    __values: values,
    async get(key) {
      return values.get(key) ?? null;
    },
    async set(key, value) {
      values.set(key, value);
    },
    async delete(key) {
      return values.delete(key);
    },
    async listByPrefix(prefix) {
      return Array.from(values.entries())
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value }));
    },
  };
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
    categoryPurpose: 'user_uploads',
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
        categoryPurpose: input.categoryPurpose ?? 'user_uploads',
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
    async updateCategoryMetadata(input) {
      const existing = categories.get(input.categoryId);
      if (!existing) {
        throw new Error(`Storage category ${input.categoryId} not found`);
      }
      const updated = {
        ...existing,
        displayName: input.displayName,
        updatedAt: '2026-04-21T11:30:00.000Z',
      };
      categories.set(updated.id, updated);
      return updated;
    },
    async updateCategoryParent(input) {
      const existing = categories.get(input.categoryId);
      if (!existing) {
        throw new Error(`Storage category ${input.categoryId} not found`);
      }
      const updated = {
        ...existing,
        parentCategoryId: input.parentCategoryId,
        updatedAt: '2026-04-21T11:30:00.000Z',
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
          entry.category.displayName.toLowerCase().includes(normalizedQuery) ||
          entry.entry.tags.some((tag) => tag.includes(normalizedQuery)) ||
          entry.messages.some((message) => message.originalFileName?.toLowerCase().includes(normalizedQuery))
        ),
      );
    },
  };
}

function createSubscriptionRepository(initialSubscriptions: StorageCategorySubscriptionRecord[] = []): StorageCategorySubscriptionRepository & {
  __subscriptions: StorageCategorySubscriptionRecord[];
} {
  const subscriptions = [...initialSubscriptions];
  return {
    __subscriptions: subscriptions,
    async listSubscriptionsByUser(telegramUserId) {
      return subscriptions.filter((subscription) => subscription.telegramUserId === telegramUserId);
    },
    async upsertSubscription(input) {
      const existing = subscriptions.find(
        (subscription) => subscription.telegramUserId === input.telegramUserId && subscription.categoryId === input.categoryId,
      );
      if (existing) {
        existing.includeSubcategories = input.includeSubcategories;
        existing.updatedAt = '2026-04-21T13:00:00.000Z';
        return existing;
      }
      const subscription = {
        telegramUserId: input.telegramUserId,
        categoryId: input.categoryId,
        includeSubcategories: input.includeSubcategories,
        createdAt: '2026-04-21T12:00:00.000Z',
        updatedAt: '2026-04-21T12:00:00.000Z',
      } satisfies StorageCategorySubscriptionRecord;
      subscriptions.push(subscription);
      return subscription;
    },
    async deleteSubscription(input) {
      const index = subscriptions.findIndex(
        (subscription) => subscription.telegramUserId === input.telegramUserId && subscription.categoryId === input.categoryId,
      );
      if (index === -1) {
        return false;
      }
      subscriptions.splice(index, 1);
      return true;
    },
    async listSubscriptionsForEntryCategory(categoryId) {
      return subscriptions.filter((subscription) => subscription.categoryId === categoryId || subscription.includeSubcategories);
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
    storageCategorySubscriptionRepository,
    storageDefaultChatStore = createMemoryMetadataStorage(),
    failCopyMessageAtCall,
    supportsForwardMessage = true,
    failForwardMessageAtCall,
    storageChat = { id: -100555, type: 'supergroup', title: 'Storage Club', isForum: true },
    storageBotMember = { status: 'administrator', canManageTopics: true },
    createdTopic = { chatId: -100555, name: 'Manuales', messageThreadId: 77 },
    failCreateForumTopic = false,
    supportsEditMessageText = false,
    printingMode = 'disabled',
    canPrint = false,
  }: {
    isAdmin?: boolean;
    canReadCategoryIds?: number[];
    canUploadCategoryIds?: number[];
    chatKind?: 'private' | 'group' | 'group-news';
    chatId?: number;
    actorTelegramUserId?: number;
    actorStatus?: 'pending' | 'approved' | 'blocked' | 'revoked';
    storageCategoryAccessRepository?: StorageCategoryAccessRepository;
    storageCategorySubscriptionRepository?: StorageCategorySubscriptionRepository;
    storageDefaultChatStore?: AppMetadataSessionStorage;
    failCopyMessageAtCall?: number;
    supportsForwardMessage?: boolean;
    failForwardMessageAtCall?: number;
    storageChat?: { id: number; type: string; title?: string; isForum?: boolean };
    storageBotMember?: { status: string; canManageTopics?: boolean };
    createdTopic?: { chatId: number; name: string; messageThreadId: number };
    failCreateForumTopic?: boolean;
    supportsEditMessageText?: boolean;
    printingMode?: 'disabled' | 'enabled' | 'test';
    canPrint?: boolean;
  } = {},
): {
  context: TelegramCommandHandlerContext & Record<string, unknown>;
  replies: Array<{ message: string; options?: TelegramReplyOptions }>;
  editedMessages: Array<{ chatId: number; messageId: number; text: string; options?: TelegramReplyOptions }>;
  copiedMessages: Array<{ fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }>;
  forwardedMessages: Array<{ fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }>;
  mediaGroups: Array<{ chatId: number; media: TelegramPhotoMediaInput[]; messageThreadId?: number }>;
  deletedMessages: Array<{ chatId: number; messageId: number }>;
  privateMessages: Array<{ telegramUserId: number; message: string; options?: TelegramReplyOptions }>;
  getCurrentSession: () => ConversationSessionRecord | null;
} {
  configureTelegramDeepLinks({ botUsername: 'cawatest_bot' });
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const editedMessages: Array<{ chatId: number; messageId: number; text: string; options?: TelegramReplyOptions }> = [];
  const copiedMessages: Array<{ fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }> = [];
  const forwardedMessages: Array<{ fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }> = [];
  const mediaGroups: Array<{ chatId: number; media: TelegramPhotoMediaInput[]; messageThreadId?: number }> = [];
  const deletedMessages: Array<{ chatId: number; messageId: number }> = [];
  const privateMessages: Array<{ telegramUserId: number; message: string; options?: TelegramReplyOptions }> = [];
  let currentSession: ConversationSessionRecord | null = null;
  let copiedMessageId = 900;
  let copyMessageCalls = 0;
  let forwardMessageCalls = 0;
  const resolvedStorageCategorySubscriptionRepository = storageCategorySubscriptionRepository ?? createSubscriptionRepository();

  const context = {
    from: { id: actorTelegramUserId, username: 'ada' },
    reply: async (message: string, options?: TelegramReplyOptions) => {
      replies.push(options ? { message, options } : { message });
      return { message_id: replies.length };
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
            : permissionKey === 'printing.use' && canPrint,
          permissionKey,
          reason: 'test',
        }),
        can: (permissionKey: string, resource?: { type: string; id: string }) =>
          resource
            ? permissionKey === 'storage.entry.read'
              ? canReadCategoryIds.includes(Number(resource.id))
              : canUploadCategoryIds.includes(Number(resource.id))
            : permissionKey === 'printing.use' && canPrint,
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
        sendPrivateMessage: async (telegramUserId: number, message: string, options?: TelegramReplyOptions) => {
          privateMessages.push(options ? { telegramUserId, message, options } : { telegramUserId, message });
        },
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
        sendMediaGroup: async ({ chatId, media, messageThreadId }: { chatId: number; media: TelegramPhotoMediaInput[]; messageThreadId?: number }) => {
          mediaGroups.push(messageThreadId === undefined ? { chatId, media } : { chatId, media, messageThreadId });
          return media.map((_, index) => ({ messageId: 1000 + index }));
        },
        deleteMessage: async ({ chatId, messageId }: { chatId: number; messageId: number }) => {
          deletedMessages.push({ chatId, messageId });
        },
        ...(supportsEditMessageText
          ? {
              editMessageText: async ({ chatId, messageId, text, options }: { chatId: number; messageId: number; text: string; options?: TelegramReplyOptions }) => {
                editedMessages.push(options ? { chatId, messageId, text, options } : { chatId, messageId, text });
              },
            }
          : {}),
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
    printSettingsStore: {
      async getSettings() {
        return { mode: printingMode, cupsQueue: 'Virtual-PDF' };
      },
      async saveSettings() {},
    },
    ...(storageCategoryAccessRepository ? { storageCategoryAccessRepository } : {}),
    storageCategorySubscriptionRepository: resolvedStorageCategorySubscriptionRepository,
    storageDefaultChatStore,
  } as unknown as TelegramCommandHandlerContext & Record<string, unknown>;

  return {
    context,
    replies,
    editedMessages,
    copiedMessages,
    forwardedMessages,
    mediaGroups,
    deletedMessages,
    privateMessages,
    getCurrentSession: () => currentSession,
  };
}

test('handleTelegramStorageText opens the storage submenu from the command entry point', async () => {
  const { context, replies } = createContext(createRepository());

  await handleTelegramStorageCommand(context as never);

  assert.equal(
    replies[0]?.message,
    'Almacenamiento: elige una acción.\n\nCategorías disponibles:\n- <a href="https://t.me/cawatest_bot?start=storage_category_7"><b>Manuales</b></a> (vacía)',
  );
  assert.equal(replies[0]?.options?.parseMode, 'HTML');
  assert.equal(replies[0]?.options?.inlineKeyboard, undefined);
});

test('handleTelegramStorageText lists available categories for approved users', async () => {
  const repository = createRepository([
    createCategory({ id: 7, slug: 'manuales', displayName: 'Manuales' }),
    createCategory({ id: 8, slug: 'fotos', displayName: 'Fotos', storageThreadId: 11 }),
  ]);
  const { context, replies } = createContext(repository, { canReadCategoryIds: [7], canUploadCategoryIds: [7] });
  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);
  assert.equal(
    replies.at(-1)?.message,
    'Almacenamiento: elige una acción.\n\nCategorías disponibles:\n- <a href="https://t.me/cawatest_bot?start=storage_category_8"><b>Fotos</b></a> (vacía)\n- <a href="https://t.me/cawatest_bot?start=storage_category_7"><b>Manuales</b></a> (vacía)',
  );
  assert.equal(replies.at(-1)?.options?.inlineKeyboard, undefined);

  context.messageText = 'Listar categorías';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal(replies.at(-1)?.options?.parseMode, 'HTML');
  assert.equal(replies.at(-1)?.message, 'Categorías disponibles:\n- <a href="https://t.me/cawatest_bot?start=storage_category_8"><b>Fotos</b></a> (vacía)\n- <a href="https://t.me/cawatest_bot?start=storage_category_7"><b>Manuales</b></a> (vacía)');
  assert.equal(replies.at(-1)?.options?.inlineKeyboard, undefined);
});

test('handleTelegramStorageText subscribes a user to a storage category with subcategories', async () => {
  const repository = createRepository([
    createCategory({ id: 7, displayName: 'Manuales' }),
    createCategory({ id: 8, displayName: 'Reglamentos', parentCategoryId: 7 }),
  ]);
  const subscriptionRepository = createSubscriptionRepository();
  const { context, replies, getCurrentSession } = createContext(repository, {
    canReadCategoryIds: [7, 8],
    storageCategorySubscriptionRepository: subscriptionRepository,
  });

  context.messageText = 'Suscribir categoría';
  assert.equal(await handleTelegramStorageText(context as never), true);
  assert.equal(getCurrentSession()?.flowKey, 'storage-subscribe');

  context.messageText = 'Manuales';
  assert.equal(await handleTelegramStorageText(context as never), true);
  assert.equal(getCurrentSession()?.stepKey, 'subscribe-scope');

  context.messageText = 'Categoría y subcategorías';
  assert.equal(await handleTelegramStorageText(context as never), true);

  assert.deepEqual(subscriptionRepository.__subscriptions.map(({ telegramUserId, categoryId, includeSubcategories }) => ({
    telegramUserId,
    categoryId,
    includeSubcategories,
  })), [{ telegramUserId: 42, categoryId: 7, includeSubcategories: true }]);
  assert.equal(replies.at(-1)?.message, 'Suscripción guardada a Manuales y subcategorías.');
  assert.equal(getCurrentSession(), null);
});

test('persisting a private storage upload notifies subscribers with open and unsubscribe actions', async () => {
  const repository = createRepository();
  const subscriptionRepository = createSubscriptionRepository([
    {
      telegramUserId: 100,
      categoryId: 7,
      includeSubcategories: false,
      createdAt: '2026-04-21T12:00:00.000Z',
      updatedAt: '2026-04-21T12:00:00.000Z',
    },
  ]);
  const { context, privateMessages } = createContext(repository, {
    storageCategorySubscriptionRepository: subscriptionRepository,
  });

  context.messageText = 'Subir archivos';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Manuales';
  await handleTelegramStorageText(context as never);
  context.messageMedia = {
    attachmentKind: 'document',
    messageId: 55,
    fileId: 'file-1',
    fileUniqueId: 'unique-1',
    originalFileName: 'manual.pdf',
  };
  assert.equal(await handleTelegramStorageMessage(context as never), true);
  context.messageText = 'Terminar adjuntos';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Omitir';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Completar';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Completar sin tags';
  assert.equal(await handleTelegramStorageText(context as never), true);

  assert.equal(privateMessages.length, 1);
  assert.equal(privateMessages[0]?.telegramUserId, 100);
  assert.match(privateMessages[0]?.message ?? '', /Nuevo archivo en storage/);
  assert.deepEqual(privateMessages[0]?.options?.inlineKeyboard?.[0], [
    { text: 'Abrir entrada', url: 'https://t.me/cawatest_bot?start=storage_entry_1' },
    { text: 'Desuscribir', callbackData: `${storageCallbackPrefixes.unsubscribeCategory}7` },
  ]);
});

test('handleTelegramStorageCallback unsubscribes from notification messages', async () => {
  const subscriptionRepository = createSubscriptionRepository([
    {
      telegramUserId: 42,
      categoryId: 7,
      includeSubcategories: true,
      createdAt: '2026-04-21T12:00:00.000Z',
      updatedAt: '2026-04-21T12:00:00.000Z',
    },
  ]);
  const { context, replies } = createContext(createRepository(), {
    storageCategorySubscriptionRepository: subscriptionRepository,
  });

  context.callbackData = `${storageCallbackPrefixes.unsubscribeCategory}7`;
  assert.equal(await handleTelegramStorageCallback(context as never), true);

  assert.equal(subscriptionRepository.__subscriptions.length, 0);
  assert.equal(replies.at(-1)?.message, 'Suscripción eliminada de Manuales.');
});

test('handleTelegramStorageText renders only root category navigation links with aggregate summaries', async () => {
  const repository = createRepository([
    createCategory({ id: 7, slug: 'mutant', displayName: 'Mutant Chronicles' }),
    createCategory({ id: 8, slug: 'libros', displayName: 'Libros', parentCategoryId: 7, storageThreadId: 11 }),
  ]);
  await repository.createEntry({
    categoryId: 8,
    createdByTelegramUserId: 42,
    sourceKind: 'dm_copy',
    description: 'Guia del jugador',
    tags: [],
    messages: [
      {
        storageChatId: -1001,
        storageMessageId: 101,
        storageThreadId: 11,
        attachmentKind: 'document',
        caption: null,
        originalFileName: 'guia.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1024,
        mediaGroupId: null,
        sortOrder: 0,
      },
    ],
  });
  const { context, replies } = createContext(repository, { canReadCategoryIds: [7, 8], canUploadCategoryIds: [7, 8] });

  context.messageText = 'Listar categorías';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal(
    replies.at(-1)?.message,
    [
      'Categorías disponibles:',
      '- <a href="https://t.me/cawatest_bot?start=storage_category_7"><b>Mutant Chronicles</b></a> (1 subcategoría, 1 archivo)',
    ].join('\n'),
  );
  assert.equal(replies.at(-1)?.options?.inlineKeyboard, undefined);
});

test('handleTelegramStorageText opens a visible category from the reply keyboard name', async () => {
  const repository = createRepository([
    createCategory({ id: 7, slug: 'rol', displayName: 'Rol' }),
    createCategory({ id: 8, slug: 'cyberpunk', displayName: 'Cyberpunk 2020', parentCategoryId: 7, storageThreadId: 11 }),
  ]);
  const { context, replies, getCurrentSession } = createContext(repository, { canReadCategoryIds: [7, 8], canUploadCategoryIds: [7, 8] });

  context.messageText = 'Rol';
  assert.equal(await handleTelegramStorageText(context as never), true);

  assert.equal(getCurrentSession()?.flowKey, 'storage-category-view');
  assert.equal(getCurrentSession()?.data.categoryId, 7);
  assert.match(replies.at(-1)?.message ?? '', /^<a href="https:\/\/t\.me\/cawatest_bot\?start=storage_root">Almacenamiento<\/a> \/ <b>Rol<\/b>/);
  assert.equal(replies.at(-1)?.options?.inlineKeyboard, undefined);

  context.messageText = '/start storage_root';
  assert.equal(await handleTelegramStorageText(context as never), true);
  assert.match(replies.at(-1)?.message ?? '', /^Almacenamiento: elige una acción\./);
});

test('handleTelegramStorageText omits zero values in category summaries', async () => {
  const repository = createRepository([
    createCategory({ id: 7, slug: 'adventures', displayName: 'Adventures' }),
  ]);
  await repository.createEntry({
    categoryId: 7,
    createdByTelegramUserId: 42,
    sourceKind: 'dm_copy',
    description: 'Night City Stories',
    tags: [],
    messages: [
      {
        storageChatId: -1001,
        storageMessageId: 101,
        storageThreadId: 10,
        attachmentKind: 'document',
        caption: null,
        originalFileName: 'night-city-stories.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1024,
        mediaGroupId: null,
        sortOrder: 0,
      },
    ],
  });
  const { context, replies } = createContext(repository, { canReadCategoryIds: [7], canUploadCategoryIds: [7] });

  context.messageText = 'Listar categorías';
  assert.equal(await handleTelegramStorageText(context as never), true);

  assert.equal(
    replies.at(-1)?.message,
    [
      'Categorías disponibles:',
      '- <a href="https://t.me/cawatest_bot?start=storage_category_7"><b>Adventures</b></a> (1 archivo)',
    ].join('\n'),
  );
});

test('handleTelegramStorageText renders child category summaries and direct files inside selected category', async () => {
  const repository = createRepository([
    createCategory({ id: 7, slug: 'stl', displayName: 'STL' }),
    createCategory({ id: 8, slug: 'star-wars', displayName: 'Star Wars', parentCategoryId: 7, storageThreadId: 11 }),
    createCategory({ id: 9, slug: 'legion', displayName: 'Legion', parentCategoryId: 8, storageThreadId: 12 }),
  ]);
  await repository.createEntry({
    categoryId: 7,
    createdByTelegramUserId: 42,
    sourceKind: 'dm_copy',
    description: 'Indice STL',
    tags: [],
    messages: [
      {
        storageChatId: -1001,
        storageMessageId: 101,
        storageThreadId: 10,
        attachmentKind: 'document',
        caption: null,
        originalFileName: 'indice.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1024,
        mediaGroupId: null,
        sortOrder: 0,
      },
    ],
  });
  await repository.createEntry({
    categoryId: 9,
    createdByTelegramUserId: 42,
    sourceKind: 'dm_copy',
    description: 'AT-ST',
    tags: [],
    messages: [
      {
        storageChatId: -1001,
        storageMessageId: 102,
        storageThreadId: 12,
        attachmentKind: 'document',
        caption: null,
        originalFileName: 'at-st.stl',
        mimeType: 'model/stl',
        fileSizeBytes: 1024,
        mediaGroupId: null,
        sortOrder: 0,
      },
    ],
  });
  const { context, replies } = createContext(repository, { canReadCategoryIds: [7, 8, 9], canUploadCategoryIds: [7, 8, 9] });

  context.messageText = '/start storage_category_7';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal(
    replies.at(-1)?.message,
    [
      '<a href="https://t.me/cawatest_bot?start=storage_root">Almacenamiento</a> / <b>STL</b>',
      '',
      'Subcategorías:',
      '- <a href="https://t.me/cawatest_bot?start=storage_category_8"><b>Star Wars</b></a> (1 subcategoría, 1 archivo)',
      '',
      'Entradas:',
      '- <a href="https://t.me/cawatest_bot?start=storage_entry_1">Indice STL</a>',
    ].join('\n'),
  );
});

test('handleTelegramStorageText shows clickable parent breadcrumbs and category actions', async () => {
  const repository = createRepository([
    createCategory({ id: 7, slug: 'stl', displayName: 'STL' }),
    createCategory({ id: 8, slug: 'star-wars', displayName: 'Star Wars', parentCategoryId: 7, storageThreadId: 11 }),
    createCategory({ id: 9, slug: 'legion', displayName: 'Legion', parentCategoryId: 8, storageThreadId: 12 }),
  ]);
  const { context, replies, getCurrentSession } = createContext(repository, {
    isAdmin: true,
    canReadCategoryIds: [7, 8, 9],
    canUploadCategoryIds: [7, 8, 9],
  });

  context.messageText = '/start storage_category_8';
  assert.equal(await handleTelegramStorageText(context as never), true);

  assert.match(
    replies.at(-1)?.message ?? '',
    /^<a href="https:\/\/t\.me\/cawatest_bot\?start=storage_root">Almacenamiento<\/a> \/ <a href="https:\/\/t\.me\/cawatest_bot\?start=storage_category_7">STL<\/a> \/ <b>Star Wars<\/b>/,
  );
  assert.equal(replies.at(-1)?.options?.inlineKeyboard, undefined);

  context.messageText = 'Renombrar categoría';
  assert.equal(await handleTelegramStorageText(context as never), true);
  assert.equal(getCurrentSession()?.flowKey, 'storage-rename-category');
  assert.equal(replies.at(-1)?.message, 'Escribe el nuevo nombre visible de la categoría.');

  context.messageText = 'Star Wars RPG';
  assert.equal(await handleTelegramStorageText(context as never), true);
  assert.equal(replies.at(-2)?.message, 'Categoría renombrada a Star Wars RPG.');
  assert.match(
    replies.at(-1)?.message ?? '',
    /^<a href="https:\/\/t\.me\/cawatest_bot\?start=storage_root">Almacenamiento<\/a> \/ <a href="https:\/\/t\.me\/cawatest_bot\?start=storage_category_7">STL<\/a> \/ <b>Star Wars RPG<\/b>/,
  );
});

test('handleTelegramStorageText lets admins change a category parent from the category detail', async () => {
  const repository = createRepository([
    createCategory({ id: 7, slug: 'stl', displayName: 'STL' }),
    createCategory({ id: 8, slug: 'star-wars', displayName: 'Star Wars', parentCategoryId: 7, storageThreadId: 11 }),
    createCategory({ id: 9, slug: 'legion', displayName: 'Legion', parentCategoryId: 8, storageThreadId: 12 }),
    createCategory({ id: 10, slug: 'malifaux', displayName: 'Malifaux', storageThreadId: 13 }),
  ]);
  const { context, replies, getCurrentSession } = createContext(repository, {
    isAdmin: true,
    canReadCategoryIds: [7, 8, 9, 10],
    canUploadCategoryIds: [7, 8, 9, 10],
  });

  context.messageText = '/start storage_category_9';
  assert.equal(await handleTelegramStorageText(context as never), true);
  assert.ok(
    replies.at(-1)?.options?.replyKeyboard?.flat().some((button) =>
      (typeof button === 'string' ? button : button.text) === 'Cambiar categoría padre',
    ),
  );

  context.messageText = 'Cambiar categoría padre';
  assert.equal(await handleTelegramStorageText(context as never), true);
  assert.equal(getCurrentSession()?.flowKey, 'storage-move-category-parent');
  assert.equal(getCurrentSession()?.stepKey, 'move-category-parent');
  assert.match(replies.at(-1)?.message ?? '', /Elige la nueva categoría padre de Legion\./);
  assert.match(replies.at(-1)?.message ?? '', /https:\/\/t\.me\/cawatest_bot\?start=storage_select_category_root/);
  assert.match(replies.at(-1)?.message ?? '', /https:\/\/t\.me\/cawatest_bot\?start=storage_select_category_7/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /start=storage_select_category_9/);
  assert.equal(replies.at(-1)?.options?.inlineKeyboard, undefined);

  context.messageText = '/start storage_select_category_7';
  assert.equal(await handleTelegramStorageStartText(context as never), true);

  const moved = await repository.findCategoryById(9);
  assert.equal(moved?.parentCategoryId, 7);
  assert.equal(replies.at(-2)?.message, 'Categoría Legion movida dentro de STL.');
  assert.match(
    replies.at(-1)?.message ?? '',
    /^<a href="https:\/\/t\.me\/cawatest_bot\?start=storage_root">Almacenamiento<\/a> \/ <a href="https:\/\/t\.me\/cawatest_bot\?start=storage_category_7">STL<\/a> \/ <b>Legion<\/b>/,
  );
});

test('handleTelegramStorageText starts subcategory creation from the current category', async () => {
  const repository = createRepository([
    createCategory({ id: 7, slug: 'stl', displayName: 'STL' }),
  ]);
  const { context, replies, getCurrentSession } = createContext(repository, {
    isAdmin: true,
    canReadCategoryIds: [7],
    canUploadCategoryIds: [7],
  });

  context.messageText = '/start storage_category_7';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Añadir subcategoría';
  assert.equal(await handleTelegramStorageText(context as never), true);
  context.messageText = 'Star Wars';
  assert.equal(await handleTelegramStorageText(context as never), true);

  assert.equal(getCurrentSession()?.flowKey, 'storage-create-category');
  assert.equal(getCurrentSession()?.stepKey, 'create-category-chat-select');
  assert.equal(getCurrentSession()?.data.parentCategoryId, 7);
  assert.equal(replies.at(-1)?.message, 'Comparte el supergrupo de storage. El bot creará automáticamente el topic de la categoría.');
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
      '<a href="https://t.me/cawatest_bot?start=storage_root">Almacenamiento</a> / <b>Manuales</b>',
      '',
      'Entradas:',
      '- <a href="https://t.me/cawatest_bot?start=storage_entry_1">Manual de campana</a>',
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
      '<a href="https://t.me/cawatest_bot?start=storage_root">Almacenamiento</a> / <b>Manuales</b>',
      '',
      'Entradas:',
      '- <a href="https://t.me/cawatest_bot?start=storage_entry_2">Alpha manual</a>',
      '- <a href="https://t.me/cawatest_bot?start=storage_entry_3">Beta appendix</a>',
      '- <a href="https://t.me/cawatest_bot?start=storage_entry_1">Zeta dossier</a>',
    ].join('\n'),
  );
});

test('handleTelegramStorageText paginates category entries with reply keyboard buttons', async () => {
  const repository = createRepository([createCategory()]);
  for (let index = 1; index <= 25; index += 1) {
    const description = `Manual ${String(index).padStart(2, '0')}`;
    await repository.createEntry({
      categoryId: 7,
      createdByTelegramUserId: 42,
      sourceKind: 'dm_copy',
      description,
      tags: [],
      messages: [
        {
          storageChatId: -100123,
          storageMessageId: 900 + index,
          storageThreadId: 10,
          telegramFileId: `file-${index}`,
          telegramFileUniqueId: `unique-${index}`,
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
  const { context, replies, getCurrentSession } = createContext(repository, { canReadCategoryIds: [7], canUploadCategoryIds: [7] });

  context.messageText = '/start storage_category_7';
  await handleTelegramStorageText(context as never);

  assert.match(replies.at(-1)?.message ?? '', /Mostrando 1-20 de 25\. Página 1\/2\./);
  assert.match(replies.at(-1)?.message ?? '', /Manual 20/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Manual 21/);
  assert.equal(replies.at(-1)?.options?.inlineKeyboard, undefined);
  assert.ok(replies.at(-1)?.options?.replyKeyboard?.flat().some((button) => (typeof button === 'string' ? button : button.text) === 'Ir a página'));
  assert.ok(replies.at(-1)?.options?.replyKeyboard?.flat().some((button) => (typeof button === 'string' ? button : button.text) === 'Siguiente'));

  context.messageText = 'Siguiente';
  await handleTelegramStorageText(context as never);

  assert.match(replies.at(-1)?.message ?? '', /Mostrando 21-25 de 25\. Página 2\/2\./);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Manual 20/);
  assert.match(replies.at(-1)?.message ?? '', /Manual 21/);
  assert.equal(replies.at(-1)?.options?.inlineKeyboard, undefined);
  assert.ok(replies.at(-1)?.options?.replyKeyboard?.flat().some((button) => (typeof button === 'string' ? button : button.text) === 'Anterior'));
  assert.ok(replies.at(-1)?.options?.replyKeyboard?.flat().some((button) => (typeof button === 'string' ? button : button.text) === 'Ir a página'));

  context.messageText = 'Anterior';
  await handleTelegramStorageText(context as never);
  assert.match(replies.at(-1)?.message ?? '', /Mostrando 1-20 de 25\. Página 1\/2\./);
  assert.match(replies.at(-1)?.message ?? '', /Manual 20/);

  context.callbackData = `${storageCallbackPrefixes.categoryGoToPage}7`;
  await handleTelegramStorageCallback(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'category-page-input');
  assert.equal(replies.at(-1)?.message, 'Escribe el número de página.');

  delete context.callbackData;
  context.messageText = '1';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.flowKey, 'storage-category-view');
  assert.match(replies.at(-1)?.message ?? '', /Mostrando 1-20 de 25\. Página 1\/2\./);
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
      '<a href="https://t.me/cawatest_bot?start=storage_root">Almacenamiento</a> / <b>Manuales</b>',
      '',
      'Entradas:',
      '- <a href="https://t.me/cawatest_bot?start=storage_entry_1">Manual de campana</a>',
    ].join('\n'),
  );
  assert.deepEqual(copiedMessages, []);
});

test('handleTelegramStorageMessage starts an upload when media arrives in a category view', async () => {
  const repository = createRepository([createCategory()]);
  const { context, replies, getCurrentSession } = createContext(repository, { canReadCategoryIds: [7], canUploadCategoryIds: [7] });

  context.messageText = '/start storage_category_7';
  assert.equal(await handleTelegramStorageText(context as never), true);
  assert.equal(getCurrentSession()?.flowKey, 'storage-category-view');

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

  assert.equal(await handleTelegramStorageMessage(context as never), true);
  const session = getCurrentSession();
  assert.equal(session?.flowKey, 'storage-upload');
  assert.equal(session?.stepKey, 'upload-media');
  assert.equal(session?.data.categoryId, 7);
  const messages = session?.data.messages;
  assert.equal(Array.isArray(messages), true);
  assert.deepEqual((messages as Array<{ fromMessageId: number }>).map((message) => message.fromMessageId), [77]);
  assert.equal(replies.at(-1)?.message, 'Adjunto añadido al lote actual. Total: 1.');
  assert.equal(session?.data.uploadReceiptMessageId, 2);
});

test('handleTelegramStorageMessage updates the upload batch receipt message', async () => {
  const repository = createRepository([createCategory()]);
  const { context, replies, editedMessages, getCurrentSession } = createContext(repository, {
    canReadCategoryIds: [7],
    canUploadCategoryIds: [7],
    supportsEditMessageText: true,
  });

  context.messageText = '/start storage_category_7';
  assert.equal(await handleTelegramStorageText(context as never), true);

  delete context.messageText;
  for (const messageId of [77, 78, 79]) {
    context.messageMedia = {
      attachmentKind: 'document',
      fileId: `private-file-${messageId}`,
      fileUniqueId: `private-unique-${messageId}`,
      caption: null,
      originalFileName: `manual-${messageId}.pdf`,
      mimeType: 'application/pdf',
      fileSizeBytes: 2048,
      mediaGroupId: null,
      messageId,
    };
    assert.equal(await handleTelegramStorageMessage(context as never), true);
  }

  assert.equal(replies.at(-1)?.message, 'Adjunto añadido al lote actual. Total: 1.');
  assert.equal(replies.length, 2);
  assert.deepEqual(editedMessages.map((message) => ({
    chatId: message.chatId,
    messageId: message.messageId,
    text: message.text,
    options: message.options,
  })), [
    { chatId: 42, messageId: 2, text: 'Adjunto añadido al lote actual. Total: 2.', options: undefined },
    { chatId: 42, messageId: 2, text: 'Adjunto añadido al lote actual. Total: 3.', options: undefined },
  ]);
  assert.equal(replies.at(-1)?.options, undefined);
  assert.equal(getCurrentSession()?.data.uploadReceiptMessageId, 2);
  assert.equal((getCurrentSession()?.data.messages as unknown[] | undefined)?.length, 3);
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
  assert.match(replies.at(-1)?.message ?? '', /Telegram no siempre puede buscar dentro del Storage archivado/);
  assert.match(replies.at(-1)?.message ?? '', /Puedes escribir tags con o sin #/);
  assert.equal(replies.at(-1)?.options?.inlineKeyboard, undefined);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard?.slice(0, 2), [
    [successButton('Buscar palabra o tag')],
    [secondaryButton('Explorar categorías')],
  ]);

  context.messageText = 'manual';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal(replies.at(-1)?.options?.parseMode, 'HTML');
  assert.equal(
    replies.at(-1)?.message,
    [
      'Resultados:',
      '',
      '<a href="https://t.me/cawatest_bot?start=storage_category_7"><b>Manuales</b></a>',
      '- <a href="https://t.me/cawatest_bot?start=storage_entry_1">Manual de campana</a> · <a href="https://t.me/cawatest_bot?start=storage_tag_rol">#rol (1 archivos)</a>, <a href="https://t.me/cawatest_bot?start=storage_tag_pdf">#pdf (1 archivos)</a>',
    ].join('\n'),
  );

  context.messageText = 'Buscar archivos';
  await handleTelegramStorageText(context as never);
  context.messageText = '#rol';
  await handleTelegramStorageText(context as never);
  assert.match(replies.at(-1)?.message ?? '', /Manual de campana/);

  context.messageText = 'Buscar archivos';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Manuales';
  await handleTelegramStorageText(context as never);
  assert.match(replies.at(-1)?.message ?? '', /Manual de campana/);
});

test('handleTelegramStorageText lists tags and opens tag results from deep links', async () => {
  const repository = createRepository([createCategory()]);
  await repository.createEntry({
    categoryId: 7,
    createdByTelegramUserId: 42,
    sourceKind: 'dm_copy',
    description: 'Manual de campana',
    tags: ['rol', 'pdf'],
    messages: [{
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
    }],
  });
  await repository.createEntry({
    categoryId: 7,
    createdByTelegramUserId: 43,
    sourceKind: 'dm_copy',
    description: 'Ficha de personaje',
    tags: ['rol'],
    messages: [{
      storageChatId: -100123,
      storageMessageId: 901,
      storageThreadId: 10,
      telegramFileId: 'file-2',
      telegramFileUniqueId: 'unique-2',
      attachmentKind: 'document',
      caption: null,
      originalFileName: 'ficha.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 2048,
      mediaGroupId: null,
      sortOrder: 0,
    }],
  });
  for (let index = 0; index < 19; index += 1) {
    await repository.createEntry({
      categoryId: 7,
      createdByTelegramUserId: 43,
      sourceKind: 'dm_copy',
      description: `Extra rol ${String(index + 1).padStart(2, '0')}`,
      tags: ['rol'],
      messages: [{
        storageChatId: -100123,
        storageMessageId: 1000 + index,
        storageThreadId: 10,
        telegramFileId: `file-extra-${index}`,
        telegramFileUniqueId: `unique-extra-${index}`,
        attachmentKind: 'document',
        caption: null,
        originalFileName: `extra-${index}.pdf`,
        mimeType: 'application/pdf',
        fileSizeBytes: 1024,
        mediaGroupId: null,
        sortOrder: 0,
      }],
    });
  }
  const { context, replies } = createContext(repository, { canReadCategoryIds: [7] });

  context.messageText = 'Listar tags';
  await handleTelegramStorageText(context as never);

  assert.equal(replies.at(-1)?.options?.parseMode, 'HTML');
  assert.equal(
    replies.at(-1)?.message,
    [
      'Tags disponibles:',
      '- <a href="https://t.me/cawatest_bot?start=storage_tag_rol">#rol (21 archivos)</a>',
      '- <a href="https://t.me/cawatest_bot?start=storage_tag_pdf">#pdf (1 archivos)</a>',
    ].join('\n'),
  );

  context.messageText = '/start storage_tag_rol';
  await handleTelegramStorageText(context as never);

  assert.equal(replies.at(-1)?.options?.parseMode, 'HTML');
  assert.match(replies.at(-1)?.message ?? '', /Archivos con <a href="https:\/\/t\.me\/cawatest_bot\?start=storage_tag_rol">#rol \(21 archivos\)<\/a>:/);
  assert.match(replies.at(-1)?.message ?? '', /Ficha de personaje/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Manual de campana/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /storage_tag_pdf/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /#pdf \(1 archivos\)/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /#rol \(21 archivos\).*Manual de campana/);
  assert.match(replies.at(-1)?.message ?? '', /Mostrando 1-20 de 21. Página 1\/2./);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard?.at(0)?.map((button) => typeof button === 'string' ? button : button.text), [
    'Ir a página',
    'Siguiente',
  ]);

  context.messageText = 'Siguiente';
  await handleTelegramStorageText(context as never);

  assert.match(replies.at(-1)?.message ?? '', /Mostrando 21-21 de 21. Página 2\/2./);
  assert.match(replies.at(-1)?.message ?? '', /Manual de campana/);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard?.at(0)?.map((button) => typeof button === 'string' ? button : button.text), [
    'Anterior',
    'Ir a página',
  ]);
});

test('handleTelegramStorageCallback lets owners add and remove entry tags', async () => {
  const repository = createRepository([createCategory()]);
  await repository.createEntry({
    categoryId: 7,
    createdByTelegramUserId: 42,
    sourceKind: 'dm_copy',
    description: 'Manual propio',
    tags: ['rol'],
    messages: [{
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
    }],
  });
  const { context, getCurrentSession } = createContext(repository, { canReadCategoryIds: [7], actorTelegramUserId: 42 });

  context.callbackData = `${storageCallbackPrefixes.addEntryTags}1`;
  await handleTelegramStorageCallback(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'add-entry-tags');

  delete context.callbackData;
  context.messageText = '#pdf #rol';
  await handleTelegramStorageText(context as never);
  assert.deepEqual(repository.__entries[0]?.entry.tags, ['pdf', 'rol']);

  context.callbackData = `${storageCallbackPrefixes.removeEntryTags}1`;
  delete context.messageText;
  await handleTelegramStorageCallback(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'remove-entry-tags');

  delete context.callbackData;
  context.messageText = '#rol';
  await handleTelegramStorageText(context as never);
  assert.deepEqual(repository.__entries[0]?.entry.tags, ['pdf']);
});

test('handleTelegramStorageText can scope searches to a selected category', async () => {
  const repository = createRepository([
    createCategory({ id: 7, slug: 'manuales', displayName: 'Manuales' }),
    createCategory({ id: 8, slug: 'mapas', displayName: 'Mapas', storageThreadId: 11 }),
    createCategory({ id: 9, slug: 'regionales', displayName: 'Regionales', parentCategoryId: 8, storageThreadId: 12 }),
  ]);
  for (const categoryId of [7, 8, 9]) {
    await repository.createEntry({
      categoryId,
      createdByTelegramUserId: 42,
      sourceKind: 'dm_copy',
      description: categoryId === 9 ? 'Manual regional' : 'Manual compartido',
      tags: [],
      messages: [{
        storageChatId: -100123,
        storageMessageId: 900 + categoryId,
        storageThreadId: categoryId === 7 ? 10 : categoryId === 8 ? 11 : 12,
        telegramFileId: `file-${categoryId}`,
        telegramFileUniqueId: `unique-${categoryId}`,
        attachmentKind: 'document',
        caption: null,
        originalFileName: `manual-${categoryId}.pdf`,
        mimeType: 'application/pdf',
        fileSizeBytes: 1024,
        mediaGroupId: null,
        sortOrder: 0,
      }],
    });
  }
  const { context, replies, getCurrentSession } = createContext(repository, { canReadCategoryIds: [7, 8, 9], canUploadCategoryIds: [7, 8, 9] });

  context.messageText = 'Buscar archivos';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Explorar categorías';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'search-scope');
  assert.match(replies.at(-1)?.message ?? '', /storage_select_category_7/);
  assert.match(replies.at(-1)?.message ?? '', /storage_select_category_8/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /storage_select_category_9/);

  context.messageText = '/start storage_select_category_8';
  await handleTelegramStorageStartText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'search-scope');
  assert.match(replies.at(-1)?.message ?? '', /<b>Mapas<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /storage_select_category_9/);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard?.flat().map((button) => typeof button === 'string' ? button : button.text), [
    'Buscar aquí',
    'Volver',
    '/cancel',
  ]);

  context.messageText = 'Buscar aquí';
  await handleTelegramStorageText(context as never);

  assert.equal(getCurrentSession()?.stepKey, 'search-query');
  assert.equal(replies.at(-1)?.message, 'Escribe el texto que quieres buscar en Mapas.');

  context.messageText = 'manual';
  await handleTelegramStorageText(context as never);

  assert.match(replies.at(-1)?.message ?? '', /<b>Mapas<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /Manual compartido/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Mapas \/ Regionales<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /Manual regional/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /<b>Manuales<\/b>/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /#1/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Adjuntos/);
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
  assert.equal(replies.at(-3)?.message, 'Creando el topic de storage en Storage Club...');
  assert.equal(replies.at(-2)?.message, 'Categoría creada: Manuales (`manuales`). Supergrupo: Storage Club. Topic: Manuales.');
  assert.equal(
    replies.at(-1)?.message,
    [
      '<a href="https://t.me/cawatest_bot?start=storage_root">Almacenamiento</a> / <b>Manuales</b>',
      '',
      'No hay ninguna entrada indexada en esta categoría.',
    ].join('\n'),
  );
  assert.equal(getCurrentSession()?.flowKey, 'storage-category-view');
});

test('handleTelegramStorageMessage lets admins configure the default storage supergroup', async () => {
  const repository = createRepository([]);
  const metadataStore = createMemoryMetadataStorage();
  const { context, replies, getCurrentSession } = createContext(repository, {
    isAdmin: true,
    canReadCategoryIds: [],
    canUploadCategoryIds: [],
    storageDefaultChatStore: metadataStore,
  });

  context.messageText = 'Configurar supergrupo';
  assert.equal(await handleTelegramStorageText(context as never), true);
  assert.equal(getCurrentSession()?.flowKey, 'storage-default-chat');
  assert.equal(replies.at(-1)?.message, 'Comparte el supergrupo que Storage usará por defecto en las nuevas categorías.');
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
    [dangerButton('/cancel')],
  ]);

  context.sharedChat = { requestId: 41101, chatId: -100555, title: 'Storage Club' };
  assert.equal(await handleTelegramStorageMessage(context as never), true);

  const stored = JSON.parse(metadataStore.__values.get('storage.default_chat') ?? '{}') as { chatId?: number; chatTitle?: string };
  assert.equal(stored.chatId, -100555);
  assert.equal(stored.chatTitle, 'Storage Club');
  assert.equal(getCurrentSession(), null);
  assert.equal(replies.at(-1)?.message, 'Supergrupo por defecto de Storage guardado: Storage Club.');
});

test('handleTelegramStorageText creates new categories in the configured default storage supergroup', async () => {
  const repository = createRepository([]);
  const metadataStore = createMemoryMetadataStorage({
    'storage.default_chat': JSON.stringify({
      chatId: -100555,
      chatTitle: 'Storage Club',
      updatedAt: '2026-04-21T12:00:00.000Z',
    }),
  });
  const { context, replies, getCurrentSession } = createContext(repository, {
    isAdmin: true,
    canReadCategoryIds: [],
    canUploadCategoryIds: [],
    storageDefaultChatStore: metadataStore,
  });

  context.messageText = 'Crear categoría';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Manuales';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Omitir';
  assert.equal(await handleTelegramStorageText(context as never), true);

  const categories = await repository.listCategories();
  assert.equal(categories.length, 1);
  assert.equal(categories[0]?.slug, 'manuales');
  assert.equal(categories[0]?.storageChatId, -100555);
  assert.equal(categories[0]?.storageThreadId, 77);
  assert.equal(replies.at(-3)?.message, 'Creando el topic de storage en Storage Club...');
  assert.equal(replies.at(-2)?.message, 'Categoría creada: Manuales (`manuales`). Supergrupo: Storage Club. Topic: Manuales.');
  assert.equal(getCurrentSession()?.flowKey, 'storage-category-view');
});

test('handleTelegramStorageText keeps manual category creation as a fallback', async () => {
  const repository = createRepository([]);
  const { context, replies, getCurrentSession } = createContext(repository, { isAdmin: true, canReadCategoryIds: [], canUploadCategoryIds: [] });

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);

  for (const messageText of ['Crear categoría', 'Manuales', 'Omitir']) {
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
  assert.equal(replies.at(-2)?.message, 'Categoría creada: Manuales (`manuales`).');
  assert.equal(
    replies.at(-1)?.message,
    [
      '<a href="https://t.me/cawatest_bot?start=storage_root">Almacenamiento</a> / <b>Manuales</b>',
      '',
      'No hay ninguna entrada indexada en esta categoría.',
    ].join('\n'),
  );
  assert.equal(getCurrentSession()?.flowKey, 'storage-category-view');
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
  assert.equal(replies.at(-1)?.message, 'Elige una categoría padre u Omitir.\nCategorías disponibles:\n- <a href="https://t.me/cawatest_bot?start=storage_select_category_7"><b>Manuales</b></a>');
  assert.equal(replies.at(-1)?.options?.inlineKeyboard, undefined);

  for (const messageText of ['/start storage_select_category_7', 'Entrada manual', '-100123', '44']) {
    context.messageText = messageText;
    await handleTelegramStorageText(context as never);
  }

  const categories = await repository.listCategories();
  const created = categories.find((category) => category.slug === 'manuales_monstruos');
  assert.equal(created?.parentCategoryId, 7);
  assert.equal(created?.storageThreadId, 44);
  assert.equal(replies.at(-2)?.message, 'Categoría creada: Monstruos (`manuales_monstruos`).');
  assert.equal(
    replies.at(-1)?.message,
    [
      '<a href="https://t.me/cawatest_bot?start=storage_root">Almacenamiento</a> / <a href="https://t.me/cawatest_bot?start=storage_category_7">Manuales</a> / <b>Monstruos</b>',
      '',
      'No hay ninguna entrada indexada en esta categoría.',
    ].join('\n'),
  );
});

test('handleTelegramStorageText builds category slugs from the full parent path', async () => {
  const repository = createRepository([
    createCategory({ id: 7, slug: 'rpg', displayName: 'RPG' }),
    createCategory({ id: 8, slug: 'rpg_books', displayName: 'Books', parentCategoryId: 7, storageThreadId: 11 }),
  ]);
  const { context } = createContext(repository, { isAdmin: true, canReadCategoryIds: [7, 8], canUploadCategoryIds: [7, 8] });

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);
  for (const messageText of ['Crear categoría', 'Dungeons and Dragons 5', 'Books', 'Entrada manual', '-100123', '44']) {
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

  for (const messageText of ['manuales_extra', 'Entrada manual', '-100123', '44']) {
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

  for (const messageText of ['Almacenamiento', 'Crear categoría', 'Manuales', 'Omitir']) {
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

  context.messageText = '/start storage_entry_1';

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
  assert.equal(
    replies.at(-1)?.message,
    [
      '<a href="https://t.me/cawatest_bot?start=storage_root">Almacenamiento</a> / <b>Manuales</b>',
      '',
      'No hay ninguna entrada indexada en esta categoría.',
    ].join('\n'),
  );
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
  assert.match(replies.at(-1)?.message ?? '', /storage_select_category_7"><b>Mutant Chronicles<\/b>/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /storage_select_category_8"><b>Libros<\/b>/);
  assert.equal(replies.at(-1)?.options?.inlineKeyboard, undefined);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Mutant Chronicles \/ Libros/);

  context.messageText = '/start storage_select_category_7';
  const handled = await handleTelegramStorageText(context as never);

  assert.equal(handled, true);
  assert.equal(getCurrentSession()?.stepKey, 'upload-category');
  assert.match(replies.at(-1)?.message ?? '', /Mutant Chronicles/);
  assert.match(replies.at(-1)?.message ?? '', /storage_select_category_8"><b>Libros<\/b>/);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard?.flat().map((button) => typeof button === 'string' ? button : button.text), [
    'Guardar aquí',
    'Volver',
    '/cancel',
  ]);

  context.messageText = '/start storage_select_category_8';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Guardar aquí';
  await handleTelegramStorageText(context as never);
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

  context.messageText = '/start storage_select_category_8';
  const handled = await handleTelegramStorageStartText(context as never);

  assert.equal(handled, true);
  assert.equal(getCurrentSession()?.stepKey, 'upload-category');
  context.messageText = 'Guardar aquí';
  await handleTelegramStorageText(context as never);
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
      '- <a href="https://t.me/cawatest_bot?start=storage_category_7"><b>Manuales</b></a> (vacía)',
    ].join('\n'),
  );
});

test('handleTelegramStorageText hides catalog media category from storage navigation', async () => {
  const repository = createRepository([
    createCategory(),
    createCategory({
      id: 8,
      slug: 'catalog-media',
      displayName: 'Imágenes de catálogo',
      storageThreadId: 11,
      categoryPurpose: 'user_uploads',
    }),
  ]);
  await repository.createEntry({
    categoryId: 8,
    createdByTelegramUserId: 42,
    sourceKind: 'dm_copy',
    description: 'Catalog media: Azul',
    tags: ['catalog', 'catalog-media'],
    messages: [{
      storageChatId: -100123,
      storageMessageId: 908,
      storageThreadId: 11,
      telegramFileId: 'catalog-file',
      telegramFileUniqueId: 'catalog-unique',
      attachmentKind: 'photo',
      caption: null,
      originalFileName: 'cover.jpg',
      mimeType: 'image/jpeg',
      fileSizeBytes: 1024,
      mediaGroupId: null,
      sortOrder: 0,
    }],
  });
  const { context, replies } = createContext(repository, {
    isAdmin: true,
    canReadCategoryIds: [7, 8],
    canUploadCategoryIds: [7, 8],
  });

  context.messageText = 'Almacenamiento';
  await handleTelegramStorageText(context as never);

  assert.match(replies.at(-1)?.message ?? '', /Manuales/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Imágenes de catálogo/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /storage_category_8/);

  context.messageText = 'Listar categorías';
  await handleTelegramStorageText(context as never);

  assert.match(replies.at(-1)?.message ?? '', /Manuales/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Imágenes de catálogo/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /storage_category_8/);

  context.messageText = 'Listar tags';
  await handleTelegramStorageText(context as never);

  assert.equal(replies.at(-1)?.message, 'Todavía no hay tags en ningún archivo visible.');
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
  context.messageText = 'Omitir';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Completar';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Completar sin tags';

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
  context.messageText = 'Omitir';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Completar';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Completar sin tags';
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
  context.messageText = 'Omitir';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Completar';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Completar sin tags';
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
  assert.equal(replies.at(-1)?.options?.inlineKeyboard, undefined);

  context.messageText = 'Manuales';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'edit-entry-select');
  assert.match(replies.at(-1)?.message ?? '', /https:\/\/t\.me\/cawatest_bot\?start=storage_edit_entry_1/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /https:\/\/t\.me\/cawatest_bot\?start=storage_entry_1/);

  context.messageText = '#1 - manual.pdf';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'edit-entry-action');

  context.messageText = 'Modificar nombre';
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
    'Listar tags',
    'Buscar archivos',
    'Mis suscripciones',
    'Suscribir categoría',
    'Desuscribir categoría',
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
    createCategory({ id: 8, slug: 'juegos', displayName: 'Juegos' }),
    createCategory({ id: 9, slug: 'malifaux', displayName: 'Malifaux', parentCategoryId: 8, storageThreadId: 11 }),
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
    canReadCategoryIds: [7, 8, 9],
    canUploadCategoryIds: [7, 8, 9],
  });

  context.messageText = '/start storage_edit_entry_1';
  await handleTelegramStorageStartText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'edit-entry-action');

  context.messageText = 'Mover categoría';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'edit-entry-move-category');
  assert.match(replies.at(-1)?.message ?? '', /Elige la nueva categoría de la entrada\./);
  assert.match(replies.at(-1)?.message ?? '', /https:\/\/t\.me\/cawatest_bot\?start=storage_select_category_8/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /storage_select_category_9/);
  assert.equal(replies.at(-1)?.options?.inlineKeyboard, undefined);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [[dangerButton('/cancel')]]);

  context.messageText = '/start storage_select_category_8';
  await handleTelegramStorageStartText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'edit-entry-move-category');
  assert.match(replies.at(-1)?.message ?? '', /<b>Juegos<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /https:\/\/t\.me\/cawatest_bot\?start=storage_select_category_9/);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [
    [successButton('Seleccionar Juegos')],
    [secondaryButton('Volver')],
    [dangerButton('/cancel')],
  ]);

  context.messageText = '/start storage_select_category_9';
  await handleTelegramStorageStartText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'edit-entry-move-category');
  assert.match(replies.at(-1)?.message ?? '', /<b>Juegos \/ Malifaux<\/b>/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /storage_select_category_8/);

  context.messageText = 'Seleccionar Malifaux';
  await handleTelegramStorageText(context as never);

  assert.equal(repository.__entries[0]?.entry.categoryId, 9);
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
    [
      { text: 'Añadir tags', callbackData: `${storageCallbackPrefixes.addEntryTags}1`, semanticRole: 'success' },
    ],
  ]);
  assert.deepEqual(toGrammyReplyOptions(replies[0]?.options), {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Editar', callback_data: `${storageCallbackPrefixes.editEntry}1` },
          { text: 'Eliminar', callback_data: `${storageCallbackPrefixes.deleteEntry}1` },
        ],
        [
          { text: 'Añadir tags', callback_data: `${storageCallbackPrefixes.addEntryTags}1` },
        ],
      ],
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
    [
      { text: 'Añadir tags', callbackData: `${storageCallbackPrefixes.addEntryTags}1`, semanticRole: 'success' },
    ],
  ]);
});

test('sendStorageEntryDetail shows print action only to users with print permission', async () => {
  const repository = createRepository([createCategory()]);
  await repository.createEntry({
    categoryId: 7,
    createdByTelegramUserId: 99,
    sourceKind: 'dm_copy',
    description: 'Manual imprimible',
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

  const denied = createContext(repository, {
    canReadCategoryIds: [7],
    canUploadCategoryIds: [],
    printingMode: 'enabled',
    canPrint: false,
  });
  denied.context.messageText = '/start storage_entry_1';
  await handleTelegramStorageStartText(denied.context as never);
  assert.equal(Boolean(denied.replies[0]?.options?.inlineKeyboard?.flat().some((button) => button.text === 'Imprimir')), false);

  const allowed = createContext(repository, {
    canReadCategoryIds: [7],
    canUploadCategoryIds: [],
    printingMode: 'enabled',
    canPrint: true,
  });
  allowed.context.messageText = '/start storage_entry_1';
  await handleTelegramStorageStartText(allowed.context as never);
  assert.equal(allowed.replies[0]?.options?.inlineKeyboard?.flat().some((button) => button.text === 'Imprimir'), true);
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
  const { context, copiedMessages, editedMessages, getCurrentSession } = createContext(repository, {
    canReadCategoryIds: [7],
    canUploadCategoryIds: [],
    supportsEditMessageText: true,
  });

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
  const receiptMessageId = getCurrentSession()?.data.addImagesReceiptMessageId;
  assert.equal(receiptMessageId, 3);
  assert.equal(editedMessages.length, 0);

  context.messageMedia = {
    attachmentKind: 'photo',
    fileId: 'photo-file-2',
    fileUniqueId: 'photo-unique-2',
    caption: null,
    originalFileName: null,
    mimeType: null,
    fileSizeBytes: 100,
    mediaGroupId: null,
    messageId: 778,
  };
  await handleTelegramStorageMessage(context as never);
  assert.equal(editedMessages.at(-1)?.messageId, receiptMessageId);
  assert.match(editedMessages.at(-1)?.text ?? '', /Total: 2/);

  delete context.messageMedia;
  context.messageText = 'Terminar adjuntos';
  await handleTelegramStorageText(context as never);

  assert.equal(repository.__entries[0]?.messages.length, 3);
  assert.deepEqual(copiedMessages.at(-2), { fromChatId: 42, messageId: 777, toChatId: -100123, messageThreadId: 10 });
  assert.deepEqual(copiedMessages.at(-1), { fromChatId: 42, messageId: 778, toChatId: -100123, messageThreadId: 10 });
  assert.equal(getCurrentSession()?.stepKey, 'edit-entry-action');
});

test('handleTelegramStorageText collects a DM upload, copies it to the category topic and persists it', async () => {
  const repository = createRepository([createCategory()]);
  const { context, replies, editedMessages, copiedMessages, getCurrentSession } = createContext(repository, {
    supportsEditMessageText: true,
  });

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

  context.messageMedia = {
    attachmentKind: 'document',
    fileId: 'private-file-2',
    fileUniqueId: 'private-unique-2',
    caption: null,
    originalFileName: 'mapa.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 1024,
    mediaGroupId: null,
    messageId: 78,
  };
  await handleTelegramStorageMessage(context as never);

  context.messageText = 'Terminar adjuntos';
  delete context.messageMedia;
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'upload-grouping');
  context.messageText = 'Guardar juntos';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'upload-tags');
  context.messageText = '#rol #pdf';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'upload-preview');
  assert.match(replies.at(-1)?.message ?? '', /Vista previa de la subida/);
  assert.match(replies.at(-1)?.message ?? '', /#pdf \(0 archivos\)/);
  assert.match(replies.at(-1)?.message ?? '', /#rol \(0 archivos\)/);

  context.messageText = 'Modificar nombre';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'upload-description');
  context.messageText = 'Manual de campana';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'upload-preview');
  assert.match(replies.at(-1)?.message ?? '', /#pdf \(0 archivos\)/);
  assert.match(replies.at(-1)?.message ?? '', /#rol \(0 archivos\)/);

  context.messageText = 'Completar';
  await handleTelegramStorageText(context as never);

  assert.equal(copiedMessages.length, 2);
  assert.deepEqual(copiedMessages[0], { fromChatId: 42, messageId: 77, toChatId: -100123, messageThreadId: 10 });
  assert.deepEqual(copiedMessages[1], { fromChatId: 42, messageId: 78, toChatId: -100123, messageThreadId: 10 });
  assert.equal(repository.__entries.length, 1);
  assert.equal(repository.__entries[0]?.entry.description, 'Manual de campana');
  assert.deepEqual(repository.__entries[0]?.entry.tags, ['rol', 'pdf']);
  assert.match(replies.at(-1)?.message ?? '', /Subida en curso/);
  assert.match(replies.at(-1)?.message ?? '', /Copiando adjuntos al topic de Storage/);
  assert.equal(editedMessages.length, 7);
  assert.equal(editedMessages[0]?.text, 'Adjunto añadido al lote actual. Total: 2.');
  const uploadProgressEdits = editedMessages.slice(1);
  assert.match(uploadProgressEdits[0]?.text ?? '', /✅ campana\.pdf/);
  assert.match(uploadProgressEdits[0]?.text ?? '', /⏳ mapa\.pdf/);
  assert.match(uploadProgressEdits[1]?.text ?? '', /✅ mapa\.pdf/);
  assert.match(uploadProgressEdits[2]?.text ?? '', /Registrando la entrada en el índice/);
  assert.match(uploadProgressEdits[3]?.text ?? '', /Avisando suscripciones/);
  assert.match(uploadProgressEdits[4]?.text ?? '', /✅ Avisando suscripciones/);
  assert.equal(
    uploadProgressEdits[5]?.text,
    '<a href="https://t.me/cawatest_bot?start=storage_entry_1">Manual de campana</a> guardado en <a href="https://t.me/cawatest_bot?start=storage_category_7">Manuales</a> con 2 adjunto(s).',
  );
  assert.deepEqual(uploadProgressEdits[5]?.options?.replyKeyboard?.[0], [{ text: 'Listar categorías', semanticRole: 'primary' }]);
  assert.deepEqual(uploadProgressEdits[5]?.options?.replyKeyboard?.[4], [
    { text: 'Subir archivos', semanticRole: 'success' },
    { text: 'Añadir imágenes', semanticRole: 'success' },
  ]);
  assert.equal(uploadProgressEdits[5]?.options?.parseMode, 'HTML');
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Manual de campana/);
  assert.equal(getCurrentSession(), null);
});

test('handleTelegramStorageText keeps large upload previews below Telegram message limits after tags', async () => {
  const repository = createRepository([createCategory()]);
  const { context, replies, getCurrentSession } = createContext(repository);

  context.messageText = 'Subir archivos';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Manuales';
  await handleTelegramStorageText(context as never);

  for (let index = 0; index < 25; index += 1) {
    context.messageMedia = {
      attachmentKind: 'photo',
      fileId: `private-file-${index}`,
      fileUniqueId: `private-unique-${index}`,
      caption: `Escenografia de Tatooine ${index} ${'detalle '.repeat(80)}`,
      originalFileName: null,
      mimeType: null,
      fileSizeBytes: 2048,
      mediaGroupId: null,
      messageId: 700 + index,
    };
    delete context.messageText;
    await handleTelegramStorageMessage(context as never);
  }

  context.messageText = 'Terminar adjuntos';
  delete context.messageMedia;
  await handleTelegramStorageText(context as never);
  context.messageText = 'Guardar juntos';
  await handleTelegramStorageText(context as never);
  context.messageText = 'tatooine, escenografía';
  await handleTelegramStorageText(context as never);

  assert.equal(getCurrentSession()?.stepKey, 'upload-preview');
  const preview = replies.at(-1)?.message ?? '';
  assert.ok(preview.length < 4096);
  assert.match(preview, /<b>Adjuntos:<\/b> 25/);
  assert.match(preview, /\.\.\. 13 adjunto\(s\) más en esta subida\./);
  assert.match(preview, /#tatooine/);
  assert.match(preview, /#escenografía/);
});

test('handleTelegramStorageMessage imports forwarded text messages into storage', async () => {
  const repository = createRepository([
    createCategory(),
    createCategory({ id: 8, slug: 'manuales-aventuras', displayName: 'Aventuras', parentCategoryId: 7, storageThreadId: 11 }),
  ]);
  const { context, replies, copiedMessages, getCurrentSession } = createContext(repository);

  context.messageText = 'Manual reenviado #rol\nhttps://t.me/spam_channel\nt.me/otro_canal';
  context.messageId = 501;
  context.isForwardedMessage = true;
  const handled = await handleTelegramStorageMessage(context as never);

  assert.equal(handled, true);
  assert.equal(getCurrentSession()?.flowKey, 'storage-forwarded-import');
  assert.equal(getCurrentSession()?.stepKey, 'forwarded-action');
  assert.equal(replies.at(-1)?.message, 'He recibido un mensaje reenviado. ¿Qué quieres hacer?');
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard?.flat().map((button) => typeof button === 'string' ? button : button.text), [
    'Añadir a almacenamiento',
    '/cancel',
  ]);

  context.isForwardedMessage = false;
  context.messageText = 'Añadir a almacenamiento';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'forwarded-category');
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Mostrando 50 de/);
  assert.match(replies.at(-1)?.message ?? '', /https:\/\/t\.me\/cawatest_bot\?start=storage_select_category_7/);

  context.messageText = 'Manuales';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'forwarded-category');
  assert.match(replies.at(-1)?.message ?? '', /Elige la categoría donde quieres guardar los archivos/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Manuales<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /storage_select_category_8/);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard?.flat().map((button) => typeof button === 'string' ? button : button.text), [
    'Seleccionar Manuales',
    'Volver',
    '/cancel',
  ]);

  context.messageText = 'Aventuras';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'forwarded-category');
  assert.match(replies.at(-1)?.message ?? '', /Manuales \/ Aventuras/);

  context.messageText = 'Seleccionar Aventuras';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'upload-tags');
  assert.deepEqual(getCurrentSession()?.data.tags, ['rol']);
  assert.equal(replies.at(-1)?.message, 'Escribe tags opcionales separados por espacios o comas; no hace falta poner #. Usa tags para detalles como monstruos, elfos, mammoth o pack. Elige Omitir si no quieres añadirlos.');
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard?.flat().map((button) => typeof button === 'string' ? button : button.text), [
    'Omitir',
    '/cancel',
  ]);

  context.messageText = 'Omitir';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'upload-preview');
  assert.match(replies.at(-1)?.message ?? '', /Manual reenviado/);
  assert.match(replies.at(-1)?.message ?? '', /#rol \(0 archivos\)/);

  context.messageText = 'Completar';
  await handleTelegramStorageText(context as never);

  assert.deepEqual(copiedMessages.at(0), { fromChatId: 42, messageId: 501, toChatId: -100123, messageThreadId: 11 });
  assert.equal(repository.__entries[0]?.entry.description, 'Manual reenviado');
  assert.equal(repository.__entries[0]?.entry.categoryId, 8);
  assert.deepEqual(repository.__entries[0]?.entry.tags, ['rol']);
  assert.equal(repository.__entries[0]?.messages[0]?.attachmentKind, 'text');
  assert.equal(repository.__entries[0]?.messages[0]?.caption, 'Manual reenviado #rol');
});

test('handleTelegramStorageMessage ignores forwarded text that only contains t.me links', async () => {
  const repository = createRepository([createCategory()]);
  const { context, replies, getCurrentSession } = createContext(repository);

  context.messageText = 'https://t.me/spam_channel';
  context.messageId = 501;
  context.isForwardedMessage = true;

  assert.equal(await handleTelegramStorageMessage(context as never), false);
  assert.equal(getCurrentSession(), null);
  assert.equal(replies.length, 0);
});

test('handleTelegramStorageMessage updates the forwarded batch receipt message', async () => {
  const repository = createRepository([createCategory()]);
  const { context, replies, editedMessages, getCurrentSession } = createContext(repository, { supportsEditMessageText: true });

  context.messageText = 'Manual 1 #rol';
  context.messageId = 501;
  context.isForwardedMessage = true;
  await handleTelegramStorageMessage(context as never);

  context.messageText = 'Manual 2 #rol';
  context.messageId = 502;
  await handleTelegramStorageMessage(context as never);

  assert.equal(replies.at(-1)?.message, 'Mensaje reenviado añadido al lote. Total: 2.');
  assert.equal(getCurrentSession()?.data.forwardedReceiptMessageId, 2);

  context.messageText = 'Manual 3 #rol';
  context.messageId = 503;
  await handleTelegramStorageMessage(context as never);

  assert.equal(replies.length, 2);
  assert.equal(editedMessages.at(-1)?.chatId, 42);
  assert.equal(editedMessages.at(-1)?.messageId, 2);
  assert.equal(editedMessages.at(-1)?.text, 'Mensaje reenviado añadido al lote. Total: 3.');
  assert.equal(editedMessages.at(-1)?.options, undefined);
  assert.equal(replies.at(-1)?.options, undefined);
  assert.equal(getCurrentSession()?.data.forwardedReceiptMessageId, 2);
  assert.equal((getCurrentSession()?.data.messages as unknown[] | undefined)?.length, 3);
});

test('handleTelegramStorageMessage uses forwarded media captions as upload description', async () => {
  const repository = createRepository([createCategory()]);
  const { context, replies, getCurrentSession } = createContext(repository);

  context.messageId = 601;
  context.isForwardedMessage = true;
  context.messageMedia = {
    attachmentKind: 'photo',
    fileId: 'photo-file',
    fileUniqueId: 'photo-unique',
    caption: 'Printable Scenery - Rise of the Halflings; Warlock\nhttps://t.me/spam_channel',
    originalFileName: null,
    mimeType: null,
    fileSizeBytes: 109 * 1024,
    mediaGroupId: null,
    messageId: 601,
  };
  await handleTelegramStorageMessage(context as never);

  context.isForwardedMessage = false;
  delete context.messageMedia;
  context.messageText = 'Añadir a almacenamiento';
  await handleTelegramStorageText(context as never);

  context.messageText = 'Manuales';
  await handleTelegramStorageText(context as never);

  context.messageText = 'Seleccionar Manuales';
  await handleTelegramStorageText(context as never);

  assert.equal(getCurrentSession()?.stepKey, 'upload-tags');
  context.messageText = 'Omitir';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'upload-preview');
  assert.match(replies.at(-1)?.message ?? '', /Nombre:<\/b> Printable Scenery - Rise of the Halflings; Warlock/);

  context.messageText = 'Completar';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Completar sin tags';
  await handleTelegramStorageText(context as never);

  assert.equal(repository.__entries[0]?.entry.description, 'Printable Scenery - Rise of the Halflings; Warlock');
  assert.equal(repository.__entries[0]?.messages[0]?.attachmentKind, 'photo');
  assert.equal(repository.__entries[0]?.messages[0]?.caption, 'Printable Scenery - Rise of the Halflings; Warlock');
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
  assert.equal(getCurrentSession()?.stepKey, 'upload-tags');
  context.messageText = 'Omitir';
  await handleTelegramStorageText(context as never);
  assert.equal(getCurrentSession()?.stepKey, 'upload-preview');
  assert.match(replies.at(-1)?.message ?? '', /Manual de Campana final/);

  context.messageText = 'Completar';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Completar sin tags';
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
  assert.equal(getCurrentSession()?.stepKey, 'upload-tags');
  context.messageText = 'Omitir';
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

  context.messageText = 'Completar';
  await handleTelegramStorageText(context as never);
  context.messageText = 'Completar sin tags';
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
  assert.equal(replies.at(-4)?.message, 'Guardando 1/2: uno.pdf');
  assert.equal(replies.at(-3)?.message, 'Guardando 2/2: dos.pdf');
  assert.equal(replies.at(-2)?.message, '2 archivo(s) guardado(s) por separado en Manuales.');
  assert.match(replies.at(-1)?.message ?? '', /uno/);
  assert.match(replies.at(-1)?.message ?? '', /dos/);
  assert.equal(getCurrentSession()?.flowKey, 'storage-category-view');
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
