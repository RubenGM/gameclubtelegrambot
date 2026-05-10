import type { CatalogMediaRecord, CatalogRepository } from '../catalog/catalog-model.js';
import { parseCatalogStorageEntryUrl } from '../catalog/catalog-media-storage.js';
import { createDatabaseCatalogRepository } from '../catalog/catalog-store.js';
import { createDatabaseStorageRepository } from '../storage/storage-catalog-store.js';
import type { StorageCategoryRepository } from '../storage/storage-catalog.js';

type CatalogCoverContext = {
  catalogRepository?: CatalogRepository;
  storageRepository?: StorageCategoryRepository;
  runtime: {
    chat: {
      chatId: number;
    };
    services: {
      database: {
        db: unknown;
      };
    };
    bot: {
      copyMessage?(input: { fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }): Promise<{ messageId: number }>;
      forwardMessage?(input: { fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }): Promise<{ messageId: number }>;
      sendMediaGroup?(input: { chatId: number; media: Array<{ type: 'photo'; media: string; caption?: string }>; messageThreadId?: number }): Promise<Array<{ messageId: number }>>;
    };
  };
};

export async function sendCatalogItemCoverIfPresent(
  context: CatalogCoverContext,
  input: { itemId: number; media?: CatalogMediaRecord[] },
): Promise<boolean> {
  const media = input.media ?? await resolveCatalogRepository(context).listMedia({ itemId: input.itemId });
  const primary = media
    .filter((entry) => entry.itemId === input.itemId && entry.mediaType === 'image')
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id)[0];
  if (!primary) {
    return false;
  }

  const storageEntryId = parseCatalogStorageEntryUrl(primary.url);
  if (storageEntryId) {
    return tryCopyCatalogStorageCover(context, storageEntryId);
  }

  if (!/^https?:\/\//i.test(primary.url) || !context.runtime.bot.sendMediaGroup) {
    return false;
  }

  try {
    await context.runtime.bot.sendMediaGroup({
      chatId: context.runtime.chat.chatId,
      media: [{ type: 'photo', media: primary.url }],
    });
    return true;
  } catch {
    return false;
  }
}

async function tryCopyCatalogStorageCover(context: CatalogCoverContext, storageEntryId: number): Promise<boolean> {
  let detail;
  try {
    detail = await resolveStorageRepository(context).getEntryDetail(storageEntryId);
  } catch {
    return false;
  }
  const message = detail?.messages
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id)
    .find((candidate) => candidate.attachmentKind === 'photo' || candidate.mimeType?.startsWith('image/'));
  if (!message) {
    return false;
  }

  const input = {
    fromChatId: message.storageChatId,
    messageId: message.storageMessageId,
    toChatId: context.runtime.chat.chatId,
  };
  try {
    if (context.runtime.bot.copyMessage) {
      await context.runtime.bot.copyMessage(input);
      return true;
    }
  } catch {
    // Forward below when Telegram cannot copy this media.
  }

  if (!context.runtime.bot.forwardMessage) {
    return false;
  }
  try {
    await context.runtime.bot.forwardMessage(input);
    return true;
  } catch {
    return false;
  }
}

function resolveCatalogRepository(context: CatalogCoverContext): CatalogRepository {
  return context.catalogRepository ?? createDatabaseCatalogRepository({ database: context.runtime.services.database.db as never });
}

function resolveStorageRepository(context: CatalogCoverContext): StorageCategoryRepository {
  return context.storageRepository ?? createDatabaseStorageRepository({ database: context.runtime.services.database.db as never });
}
