import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import {
  storageCategories,
  storageEntries,
  storageEntryMessages,
} from '../infrastructure/database/schema.js';
import type {
  StorageCategoryRecord,
  StorageCategoryRepository,
  StorageEntryDetailRecord,
  StorageEntryMessageRecord,
  StorageEntryRecord,
} from './storage-catalog.js';

export function createDatabaseStorageRepository({
  database,
}: {
  database: DatabaseConnection['db'];
}): StorageCategoryRepository {
  return {
    async createCategory(input) {
      const inserted = await database
        .insert(storageCategories)
        .values({
          slug: input.slug,
          displayName: input.displayName,
          description: input.description,
          storageChatId: input.storageChatId,
          storageThreadId: input.storageThreadId,
        })
        .returning();

      const row = inserted[0];
      if (!row) {
        throw new Error('Storage category insert did not return a row');
      }
      return mapStorageCategoryRow(row);
    },
    async updateCategoryLifecycleStatus(input) {
      const now = new Date();
      const updated = await database
        .update(storageCategories)
        .set({
          lifecycleStatus: input.lifecycleStatus,
          updatedAt: now,
          archivedAt: input.lifecycleStatus === 'archived' ? now : null,
        })
        .where(eq(storageCategories.id, input.categoryId))
        .returning();

      const row = updated[0];
      if (!row) {
        throw new Error(`Storage category ${input.categoryId} not found`);
      }
      return mapStorageCategoryRow(row);
    },
    async findCategoryById(categoryId) {
      const rows = await database.select().from(storageCategories).where(eq(storageCategories.id, categoryId));
      const row = rows[0];
      return row ? mapStorageCategoryRow(row) : null;
    },
    async findCategoryByStorageThread(storageChatId, storageThreadId) {
      const rows = await database
        .select()
        .from(storageCategories)
        .where(and(eq(storageCategories.storageChatId, storageChatId), eq(storageCategories.storageThreadId, storageThreadId)));
      const row = rows[0];
      return row ? mapStorageCategoryRow(row) : null;
    },
    async listCategories() {
      const rows = await database.select().from(storageCategories).orderBy(asc(storageCategories.displayName), asc(storageCategories.id));
      return rows.map(mapStorageCategoryRow);
    },
    async createEntry(input) {
      return database.transaction(async (tx) => {
        const categoryRows = await tx.select().from(storageCategories).where(eq(storageCategories.id, input.categoryId));
        const categoryRow = categoryRows[0];
        if (!categoryRow) {
          throw new Error(`Storage category ${input.categoryId} not found`);
        }

        const createdEntries = await tx
          .insert(storageEntries)
          .values({
            categoryId: input.categoryId,
            createdByTelegramUserId: input.createdByTelegramUserId,
            sourceKind: input.sourceKind,
            description: input.description,
            tags: input.tags,
          })
          .returning();

        const entryRow = createdEntries[0];
        if (!entryRow) {
          throw new Error('Storage entry insert did not return a row');
        }

        const insertedMessages = input.messages.length === 0
          ? []
          : await tx
              .insert(storageEntryMessages)
              .values(
                input.messages.map((message) => ({
                  entryId: entryRow.id,
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
                })),
              )
              .returning();

        return {
          entry: mapStorageEntryRow(entryRow),
          category: mapStorageCategoryRow(categoryRow),
          messages: insertedMessages.map(mapStorageEntryMessageRow),
        } satisfies StorageEntryDetailRecord;
      });
    },
    async updateEntryLifecycleStatus(input) {
      const now = new Date();
      const updated = await database
        .update(storageEntries)
        .set({
          lifecycleStatus: input.lifecycleStatus,
          updatedAt: now,
          deletedAt: input.lifecycleStatus === 'deleted' ? now : null,
          deletedByTelegramUserId: input.lifecycleStatus === 'deleted' ? (input.deletedByTelegramUserId ?? null) : null,
        })
        .where(eq(storageEntries.id, input.entryId))
        .returning();

      const row = updated[0];
      if (!row) {
        throw new Error(`Storage entry ${input.entryId} not found`);
      }
      return mapStorageEntryRow(row);
    },
    async getEntryDetail(entryId) {
      const entryRows = await database.select().from(storageEntries).where(eq(storageEntries.id, entryId));
      const entryRow = entryRows[0];
      if (!entryRow) {
        return null;
      }

      const categoryRows = await database.select().from(storageCategories).where(eq(storageCategories.id, entryRow.categoryId));
      const categoryRow = categoryRows[0];
      if (!categoryRow) {
        throw new Error(`Storage category ${entryRow.categoryId} not found`);
      }

      const messageRows = await database
        .select()
        .from(storageEntryMessages)
        .where(eq(storageEntryMessages.entryId, entryId))
        .orderBy(asc(storageEntryMessages.sortOrder), asc(storageEntryMessages.id));

      return {
        entry: mapStorageEntryRow(entryRow),
        category: mapStorageCategoryRow(categoryRow),
        messages: messageRows.map(mapStorageEntryMessageRow),
      } satisfies StorageEntryDetailRecord;
    },
    async listEntryDetailsByCategory(categoryId) {
      const categoryRows = await database.select().from(storageCategories).where(eq(storageCategories.id, categoryId));
      const categoryRow = categoryRows[0];
      if (!categoryRow) {
        throw new Error(`Storage category ${categoryId} not found`);
      }

      const entryRows = await database
        .select()
        .from(storageEntries)
        .where(and(eq(storageEntries.categoryId, categoryId), eq(storageEntries.lifecycleStatus, 'active')))
        .orderBy(desc(storageEntries.createdAt), desc(storageEntries.id));

      const messageRows = entryRows.length === 0
        ? []
        : await database
            .select()
            .from(storageEntryMessages)
            .where(inArray(storageEntryMessages.entryId, entryRows.map((entry) => entry.id)))
            .orderBy(asc(storageEntryMessages.sortOrder), asc(storageEntryMessages.id));

      return buildStorageEntryDetails({
        entryRows,
        categoryRows: [categoryRow],
        messageRows,
      });
    },
    async searchEntryDetails({ categoryIds, query }) {
      const normalizedQuery = query.trim().toLowerCase();
      if (categoryIds.length === 0 || normalizedQuery.length === 0) {
        return [];
      }

      const entryRows = await database
        .select()
        .from(storageEntries)
        .where(and(inArray(storageEntries.categoryId, categoryIds), eq(storageEntries.lifecycleStatus, 'active')))
        .orderBy(desc(storageEntries.createdAt), desc(storageEntries.id));
      if (entryRows.length === 0) {
        return [];
      }

      const [categoryRows, messageRows] = await Promise.all([
        database.select().from(storageCategories).where(inArray(storageCategories.id, categoryIds)),
        database
          .select()
          .from(storageEntryMessages)
          .where(inArray(storageEntryMessages.entryId, entryRows.map((entry) => entry.id)))
          .orderBy(asc(storageEntryMessages.sortOrder), asc(storageEntryMessages.id)),
      ]);

      return buildStorageEntryDetails({ entryRows, categoryRows, messageRows }).filter((detail) => matchesStorageSearch(detail, normalizedQuery));
    },
  };
}

function buildStorageEntryDetails({
  entryRows,
  categoryRows,
  messageRows,
}: {
  entryRows: Array<typeof storageEntries.$inferSelect>;
  categoryRows: Array<typeof storageCategories.$inferSelect>;
  messageRows: Array<typeof storageEntryMessages.$inferSelect>;
}): StorageEntryDetailRecord[] {
  const categoryById = new Map(categoryRows.map((category) => [category.id, category]));
  const messagesByEntryId = new Map<number, Array<typeof storageEntryMessages.$inferSelect>>();

  for (const message of messageRows) {
    const messages = messagesByEntryId.get(message.entryId) ?? [];
    messages.push(message);
    messagesByEntryId.set(message.entryId, messages);
  }

  return entryRows.map((entry) => {
    const categoryRow = categoryById.get(entry.categoryId);
    if (!categoryRow) {
      throw new Error(`Storage category ${entry.categoryId} not found`);
    }

    return {
      entry: mapStorageEntryRow(entry),
      category: mapStorageCategoryRow(categoryRow),
      messages: (messagesByEntryId.get(entry.id) ?? []).map(mapStorageEntryMessageRow),
    } satisfies StorageEntryDetailRecord;
  });
}

async function loadEntryDetail(
  database: DatabaseConnection['db'],
  entryRow: typeof storageEntries.$inferSelect,
): Promise<StorageEntryDetailRecord> {
  const categoryRows = await database.select().from(storageCategories).where(eq(storageCategories.id, entryRow.categoryId));
  const categoryRow = categoryRows[0];
  if (!categoryRow) {
    throw new Error(`Storage category ${entryRow.categoryId} not found`);
  }

  const messageRows = await database
    .select()
    .from(storageEntryMessages)
    .where(eq(storageEntryMessages.entryId, entryRow.id))
    .orderBy(asc(storageEntryMessages.sortOrder), asc(storageEntryMessages.id));

  return {
    entry: mapStorageEntryRow(entryRow),
    category: mapStorageCategoryRow(categoryRow),
    messages: messageRows.map(mapStorageEntryMessageRow),
  } satisfies StorageEntryDetailRecord;
}

function matchesStorageSearch(detail: StorageEntryDetailRecord, normalizedQuery: string): boolean {
  return (
    detail.entry.description?.toLowerCase().includes(normalizedQuery) === true ||
    detail.entry.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery)) ||
    detail.messages.some((message) => message.originalFileName?.toLowerCase().includes(normalizedQuery) === true)
  );
}

function mapStorageCategoryRow(row: typeof storageCategories.$inferSelect): StorageCategoryRecord {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    description: row.description,
    storageChatId: row.storageChatId,
    storageThreadId: row.storageThreadId,
    lifecycleStatus: row.lifecycleStatus as StorageCategoryRecord['lifecycleStatus'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

function mapStorageEntryRow(row: typeof storageEntries.$inferSelect): StorageEntryRecord {
  return {
    id: row.id,
    categoryId: row.categoryId,
    createdByTelegramUserId: row.createdByTelegramUserId,
    sourceKind: row.sourceKind as StorageEntryRecord['sourceKind'],
    description: row.description,
    tags: ((row.tags as string[] | null) ?? []).map(String),
    lifecycleStatus: row.lifecycleStatus as StorageEntryRecord['lifecycleStatus'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
    deletedByTelegramUserId: row.deletedByTelegramUserId,
  };
}

function mapStorageEntryMessageRow(row: typeof storageEntryMessages.$inferSelect): StorageEntryMessageRecord {
  return {
    id: row.id,
    entryId: row.entryId,
    storageChatId: row.storageChatId,
    storageMessageId: row.storageMessageId,
    storageThreadId: row.storageThreadId,
    telegramFileId: row.telegramFileId,
    telegramFileUniqueId: row.telegramFileUniqueId,
    attachmentKind: row.attachmentKind as StorageEntryMessageRecord['attachmentKind'],
    caption: row.caption,
    originalFileName: row.originalFileName,
    mimeType: row.mimeType,
    fileSizeBytes: row.fileSizeBytes,
    mediaGroupId: row.mediaGroupId,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
  };
}
