import { and, asc, eq, inArray } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { storageCategories, storageCategorySubscriptions } from '../infrastructure/database/schema.js';

export interface StorageCategorySubscriptionRecord {
  telegramUserId: number;
  categoryId: number;
  includeSubcategories: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StorageCategorySubscriptionRepository {
  listSubscriptionsByUser(telegramUserId: number): Promise<StorageCategorySubscriptionRecord[]>;
  upsertSubscription(input: {
    telegramUserId: number;
    categoryId: number;
    includeSubcategories: boolean;
  }): Promise<StorageCategorySubscriptionRecord>;
  deleteSubscription(input: {
    telegramUserId: number;
    categoryId: number;
  }): Promise<boolean>;
  listSubscriptionsForEntryCategory(categoryId: number): Promise<StorageCategorySubscriptionRecord[]>;
}

export function createDatabaseStorageCategorySubscriptionRepository({
  database,
}: {
  database: DatabaseConnection['db'];
}): StorageCategorySubscriptionRepository {
  return {
    async listSubscriptionsByUser(telegramUserId) {
      const rows = await database
        .select()
        .from(storageCategorySubscriptions)
        .where(eq(storageCategorySubscriptions.telegramUserId, telegramUserId))
        .orderBy(asc(storageCategorySubscriptions.categoryId));

      return rows.map(mapStorageCategorySubscriptionRow);
    },
    async upsertSubscription(input) {
      const now = new Date();
      const rows = await database
        .insert(storageCategorySubscriptions)
        .values({
          telegramUserId: input.telegramUserId,
          categoryId: input.categoryId,
          includeSubcategories: input.includeSubcategories,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [storageCategorySubscriptions.telegramUserId, storageCategorySubscriptions.categoryId],
          set: {
            includeSubcategories: input.includeSubcategories,
            updatedAt: now,
          },
        })
        .returning();

      const row = rows[0];
      if (!row) {
        throw new Error('Storage category subscription insert did not return a row');
      }
      return mapStorageCategorySubscriptionRow(row);
    },
    async deleteSubscription(input) {
      const deleted = await database
        .delete(storageCategorySubscriptions)
        .where(
          and(
            eq(storageCategorySubscriptions.telegramUserId, input.telegramUserId),
            eq(storageCategorySubscriptions.categoryId, input.categoryId),
          ),
        )
        .returning({ telegramUserId: storageCategorySubscriptions.telegramUserId });

      return deleted.length > 0;
    },
    async listSubscriptionsForEntryCategory(categoryId) {
      const categories = await database.select().from(storageCategories);
      const ancestorIds = collectAncestorIds(categoryId, categories.map((category) => ({
        id: category.id,
        parentCategoryId: category.parentCategoryId,
      })));
      const candidateIds = [categoryId, ...ancestorIds];
      const rows = await database
        .select()
        .from(storageCategorySubscriptions)
        .where(inArray(storageCategorySubscriptions.categoryId, candidateIds))
        .orderBy(asc(storageCategorySubscriptions.telegramUserId), asc(storageCategorySubscriptions.categoryId));

      const candidateIdSet = new Set(candidateIds);
      const matching = rows.filter((row) => candidateIdSet.has(row.categoryId) && (row.categoryId === categoryId || row.includeSubcategories));
      const byUser = new Map<number, StorageCategorySubscriptionRecord>();
      for (const row of matching) {
        if (!byUser.has(row.telegramUserId)) {
          byUser.set(row.telegramUserId, mapStorageCategorySubscriptionRow(row));
        }
      }
      return [...byUser.values()];
    },
  };
}

function collectAncestorIds(categoryId: number, categories: Array<{ id: number; parentCategoryId: number | null }>): number[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const ids: number[] = [];
  const visited = new Set<number>([categoryId]);
  let current = byId.get(categoryId);
  while (current?.parentCategoryId !== null && current?.parentCategoryId !== undefined) {
    const parentId = current.parentCategoryId;
    if (visited.has(parentId)) {
      break;
    }
    ids.push(parentId);
    visited.add(parentId);
    current = byId.get(parentId);
  }
  return ids;
}

function mapStorageCategorySubscriptionRow(row: typeof storageCategorySubscriptions.$inferSelect): StorageCategorySubscriptionRecord {
  return {
    telegramUserId: row.telegramUserId,
    categoryId: row.categoryId,
    includeSubcategories: row.includeSubcategories,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
