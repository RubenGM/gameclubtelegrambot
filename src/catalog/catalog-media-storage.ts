import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { createStorageCategory, createStorageEntry, type StorageCategoryRecord, type StorageCategoryRepository, type StorageEntryDetailRecord } from '../storage/storage-catalog.js';
import type { AppMetadataSessionStorage } from '../telegram/conversation-session-store.js';
import type { TelegramPhotoMediaInput } from '../telegram/telegram-media.js';

export const catalogMediaStorageCategorySlug = 'catalog-media';
export const catalogMediaStorageEntryUrlPrefix = 'storage:entry:';

const storageDefaultChatMetadataKey = 'storage.default_chat';
const catalogMediaStorageCategoryName = 'Imagenes de catalogo';
const externalImageDownloadTimeoutMs = 30_000;
const externalImageMaxBytes = 15 * 1024 * 1024;

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
  sendMediaGroup?(input: { chatId: number; media: TelegramPhotoMediaInput[]; messageThreadId?: number }): Promise<Array<{ messageId: number }>>;
};

export type CatalogMediaExternalImageDownload = {
  filePath: string;
  mimeType: string | null;
  fileSizeBytes: number | null;
  originalFileName: string | null;
  cleanup(): Promise<void>;
};

export type CatalogMediaExternalImageProgressStep = 'download' | 'upload';
export type CatalogMediaExternalImageDownloader = (url: string) => Promise<CatalogMediaExternalImageDownload>;

export type CatalogMediaStorageContext = {
  repository: StorageCategoryRepository;
  defaultChatStore: AppMetadataSessionStorage;
  bot: CatalogMediaStorageBot;
  actorTelegramUserId: number;
  externalImageDownloader?: CatalogMediaExternalImageDownloader;
  onExternalImageProgress?: (step: CatalogMediaExternalImageProgressStep) => Promise<void> | void;
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

  let downloaded: CatalogMediaExternalImageDownload;
  const downloadStartedAt = Date.now();
  try {
    await context.onExternalImageProgress?.('download');
    downloaded = await (context.externalImageDownloader ?? downloadExternalImageToTemp)(normalizedUrl);
    console.info(JSON.stringify({
      event: 'catalog.external-image.download.completed',
      elapsedMs: Date.now() - downloadStartedAt,
      fileSizeBytes: downloaded.fileSizeBytes,
      mimeType: downloaded.mimeType,
    }));
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'catalog.external-image.download.failed',
      elapsedMs: Date.now() - downloadStartedAt,
      error: error instanceof Error ? error.message : String(error),
    }));
    return { ok: false, reason: 'download-failed' };
  }

  let sent: Array<{ messageId: number }>;
  const uploadStartedAt = Date.now();
  try {
    await context.onExternalImageProgress?.('upload');
    sent = await context.bot.sendMediaGroup({
      chatId: category.category.storageChatId,
      messageThreadId: category.category.storageThreadId,
      media: [{ type: 'photo', media: { filePath: downloaded.filePath }, caption: input.itemDisplayName }],
    });
    console.info(JSON.stringify({
      event: 'catalog.external-image.telegram-upload.completed',
      elapsedMs: Date.now() - uploadStartedAt,
      messages: sent.length,
    }));
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'catalog.external-image.telegram-upload.failed',
      elapsedMs: Date.now() - uploadStartedAt,
      error: error instanceof Error ? error.message : String(error),
    }));
    return { ok: false, reason: 'send-media-failed' };
  } finally {
    await cleanupExternalImageDownload(downloaded);
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
        originalFileName: downloaded.originalFileName,
        mimeType: downloaded.mimeType,
        fileSizeBytes: downloaded.fileSizeBytes,
        mediaGroupId: null,
        sortOrder: 0,
      },
    ],
  });

  return { ok: true, detail, catalogMediaUrl: buildCatalogStorageEntryUrl(detail.entry.id) };
}

async function cleanupExternalImageDownload(downloaded: CatalogMediaExternalImageDownload): Promise<void> {
  try {
    await downloaded.cleanup();
  } catch {
    // The media has already been handed to Telegram; temp cleanup should not change the catalog result.
  }
}

async function downloadExternalImageToTemp(url: string): Promise<CatalogMediaExternalImageDownload> {
  const response = await fetch(url, { signal: AbortSignal.timeout(externalImageDownloadTimeoutMs) });
  if (!response.ok) {
    throw new Error(`External image download failed with status ${response.status}`);
  }

  const mimeType = normalizeImageMimeType(response.headers.get('content-type'));
  if (!mimeType) {
    throw new Error('External URL did not return an image content type');
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > externalImageMaxBytes) {
    throw new Error('External image is too large');
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > externalImageMaxBytes) {
    throw new Error('External image is too large');
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'gameclub-catalog-image-'));
  const originalFileName = resolveExternalImageFileName(url, mimeType);
  const filePath = join(tempDir, originalFileName);
  await writeFile(filePath, bytes);

  return {
    filePath,
    mimeType,
    fileSizeBytes: bytes.length,
    originalFileName,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

function normalizeImageMimeType(value: string | null): string | null {
  const mimeType = value?.split(';')[0]?.trim().toLowerCase();
  return mimeType?.startsWith('image/') ? mimeType : null;
}

function resolveExternalImageFileName(url: string, mimeType: string): string {
  let rawName = 'cover';
  try {
    const parsed = new URL(url);
    rawName = basename(parsed.pathname) || rawName;
  } catch {
    rawName = 'cover';
  }
  const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'cover';
  if (/\.(jpe?g|png|webp)$/i.test(safeName)) {
    return safeName;
  }
  return `${safeName}${extensionForImageMimeType(mimeType)}`;
}

function extensionForImageMimeType(mimeType: string): string {
  switch (mimeType) {
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    default:
      return '.jpg';
  }
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
  const categories = context.repository.listAllCategoriesForInternalUse
    ? await context.repository.listAllCategoriesForInternalUse()
    : await context.repository.listCategories();
  const existing = categories.find(
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
