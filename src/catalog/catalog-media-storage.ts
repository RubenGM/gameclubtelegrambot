import { createStorageCategory, createStorageEntry, type StorageCategoryRecord, type StorageCategoryRepository, type StorageEntryDetailRecord } from '../storage/storage-catalog.js';
import type { AppMetadataSessionStorage } from '../telegram/conversation-session-store.js';

export const catalogMediaStorageCategorySlug = 'catalog-media';
export const catalogMediaStorageEntryUrlPrefix = 'storage:entry:';

const storageDefaultChatMetadataKey = 'storage.default_chat';
const catalogMediaStorageCategoryName = 'Imagenes de catalogo';

export type CatalogMediaAttachmentInput = {
  fromChatId: number;
  messageId: number;
  attachmentKind: string;
  telegramFileId?: string | null;
  telegramFileUniqueId?: string | null;
  caption?: string | null;
  originalFileName?: string | null;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
  mediaGroupId?: string | null;
};

export type CatalogMediaStorageBot = {
  createForumTopic?(input: { chatId: number; name: string }): Promise<{ chatId: number; name: string; messageThreadId: number }>;
  copyMessage?(input: { fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }): Promise<{ messageId: number }>;
  forwardMessage?(input: { fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }): Promise<{ messageId: number }>;
  sendMediaGroup?(input: { chatId: number; media: Array<{ type: 'photo'; media: string; caption?: string }>; messageThreadId?: number }): Promise<Array<{ messageId: number }>>;
};

export type CatalogMediaStorageContext = {
  repository: StorageCategoryRepository;
  defaultChatStore: AppMetadataSessionStorage;
  bot: CatalogMediaStorageBot;
  actorTelegramUserId: number;
};

export type CatalogMediaStorageResult =
  | { ok: true; detail: StorageEntryDetailRecord; catalogMediaUrl: string }
  | { ok: false; reason: string };

export async function storeCatalogMediaAttachment(
  context: CatalogMediaStorageContext,
  input: {
    itemDisplayName: string;
    attachment: CatalogMediaAttachmentInput;
  },
): Promise<CatalogMediaStorageResult> {
  if (!isCatalogImageAttachment(input.attachment)) {
    return { ok: false, reason: 'unsupported-attachment' };
  }

  const category = await resolveCatalogMediaStorageCategory(context);
  if (!category.ok) {
    return category;
  }

  const copied = await copyCatalogMediaMessage(context.bot, {
    fromChatId: input.attachment.fromChatId,
    messageId: input.attachment.messageId,
    toChatId: category.category.storageChatId,
    messageThreadId: category.category.storageThreadId,
  });

  if (!copied) {
    return { ok: false, reason: 'copy-unavailable' };
  }

  const detail = await createStorageEntry({
    repository: context.repository,
    categoryId: category.category.id,
    createdByTelegramUserId: context.actorTelegramUserId,
    sourceKind: 'dm_copy',
    description: `Catalog media: ${input.itemDisplayName}`,
    tags: ['catalog', 'catalog-media'],
    messages: [
      {
        storageChatId: category.category.storageChatId,
        storageThreadId: category.category.storageThreadId,
        storageMessageId: copied.messageId,
        telegramFileId: input.attachment.telegramFileId ?? null,
        telegramFileUniqueId: input.attachment.telegramFileUniqueId ?? null,
        attachmentKind: 'photo',
        caption: input.attachment.caption ?? null,
        originalFileName: input.attachment.originalFileName ?? null,
        mimeType: input.attachment.mimeType ?? null,
        fileSizeBytes: input.attachment.fileSizeBytes ?? null,
        mediaGroupId: input.attachment.mediaGroupId ?? null,
        sortOrder: 0,
      },
    ],
  });

  return { ok: true, detail, catalogMediaUrl: buildCatalogStorageEntryUrl(detail.entry.id) };
}

export async function storeCatalogMediaExternalImage(
  context: CatalogMediaStorageContext,
  input: {
    itemDisplayName: string;
    imageUrl: string;
  },
): Promise<CatalogMediaStorageResult> {
  const normalizedUrl = input.imageUrl.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    return { ok: false, reason: 'invalid-url' };
  }

  const category = await resolveCatalogMediaStorageCategory(context);
  if (!category.ok) {
    return category;
  }

  if (!context.bot.sendMediaGroup) {
    return { ok: false, reason: 'send-media-unavailable' };
  }

  let sent: Array<{ messageId: number }>;
  try {
    sent = await context.bot.sendMediaGroup({
      chatId: category.category.storageChatId,
      messageThreadId: category.category.storageThreadId,
      media: [{ type: 'photo', media: normalizedUrl, caption: input.itemDisplayName }],
    });
  } catch {
    return { ok: false, reason: 'send-media-failed' };
  }

  const first = sent[0];
  if (!first) {
    return { ok: false, reason: 'send-media-empty' };
  }

  const detail = await createStorageEntry({
    repository: context.repository,
    categoryId: category.category.id,
    createdByTelegramUserId: context.actorTelegramUserId,
    sourceKind: 'dm_copy',
    description: `Catalog media: ${input.itemDisplayName}`,
    tags: ['catalog', 'catalog-media', 'external-import'],
    messages: [
      {
        storageChatId: category.category.storageChatId,
        storageThreadId: category.category.storageThreadId,
        storageMessageId: first.messageId,
        telegramFileId: null,
        telegramFileUniqueId: null,
        attachmentKind: 'photo',
        caption: input.itemDisplayName,
        originalFileName: null,
        mimeType: null,
        fileSizeBytes: null,
        mediaGroupId: null,
        sortOrder: 0,
      },
    ],
  });

  return { ok: true, detail, catalogMediaUrl: buildCatalogStorageEntryUrl(detail.entry.id) };
}

export function buildCatalogStorageEntryUrl(entryId: number): string {
  return `${catalogMediaStorageEntryUrlPrefix}${entryId}`;
}

export function parseCatalogStorageEntryUrl(value: string): number | null {
  if (!value.startsWith(catalogMediaStorageEntryUrlPrefix)) {
    return null;
  }
  const entryId = Number(value.slice(catalogMediaStorageEntryUrlPrefix.length));
  return Number.isInteger(entryId) && entryId > 0 ? entryId : null;
}

export function isCatalogImageAttachment(attachment: CatalogMediaAttachmentInput): boolean {
  return attachment.attachmentKind === 'photo'
    || (attachment.attachmentKind === 'document' && Boolean(attachment.mimeType?.startsWith('image/')));
}

async function resolveCatalogMediaStorageCategory(
  context: CatalogMediaStorageContext,
): Promise<{ ok: true; category: StorageCategoryRecord } | { ok: false; reason: string }> {
  const existing = (await context.repository.listCategories()).find(
    (category) => category.lifecycleStatus === 'active' && (
      category.categoryPurpose === 'catalog_media' || category.slug === catalogMediaStorageCategorySlug
    ),
  );
  if (existing) {
    return { ok: true, category: existing };
  }

  const defaultChat = await loadStorageDefaultChat(context.defaultChatStore);
  if (!defaultChat) {
    return { ok: false, reason: 'default-storage-chat-missing' };
  }
  if (!context.bot.createForumTopic) {
    return { ok: false, reason: 'create-topic-unavailable' };
  }

  const topic = await context.bot.createForumTopic({
    chatId: defaultChat.chatId,
    name: catalogMediaStorageCategoryName,
  });

  const category = await createStorageCategory({
    repository: context.repository,
    slug: catalogMediaStorageCategorySlug,
    displayName: catalogMediaStorageCategoryName,
    description: 'Imagenes internas usadas por fichas del catalogo.',
    parentCategoryId: null,
    storageChatId: defaultChat.chatId,
    storageThreadId: topic.messageThreadId,
    categoryPurpose: 'catalog_media',
  });
  return { ok: true, category };
}

async function loadStorageDefaultChat(storage: AppMetadataSessionStorage): Promise<{ chatId: number } | null> {
  const raw = await storage.get(storageDefaultChatMetadataKey);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { chatId?: unknown };
    return typeof parsed.chatId === 'number' && Number.isInteger(parsed.chatId) && parsed.chatId !== 0
      ? { chatId: parsed.chatId }
      : null;
  } catch {
    return null;
  }
}

async function copyCatalogMediaMessage(
  bot: CatalogMediaStorageBot,
  input: { fromChatId: number; messageId: number; toChatId: number; messageThreadId: number },
): Promise<{ messageId: number } | null> {
  if (bot.copyMessage) {
    try {
      return await bot.copyMessage(input);
    } catch {
      // Fall through to forwardMessage when copyMessage cannot copy this media.
    }
  }
  if (bot.forwardMessage) {
    return bot.forwardMessage(input);
  }
  return null;
}
