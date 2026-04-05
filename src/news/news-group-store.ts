import { and, asc, eq } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { newsGroupSubscriptions, newsGroups } from '../infrastructure/database/schema.js';
import type {
  NewsGroupRecord,
  NewsGroupRepository,
  NewsGroupSubscriptionRecord,
} from './news-group-catalog.js';

export function createDatabaseNewsGroupRepository({
  database,
}: {
  database: DatabaseConnection['db'];
}): NewsGroupRepository {
  return {
    async findGroupByChatId(chatId) {
      const result = await database.select().from(newsGroups).where(eq(newsGroups.chatId, chatId));
      const row = result[0];
      return row ? mapNewsGroupRow(row) : null;
    },
    async listGroups({ includeDisabled = false } = {}) {
      const query = database.select().from(newsGroups);
      const result = includeDisabled
        ? await query.orderBy(asc(newsGroups.chatId))
        : await query.where(eq(newsGroups.isEnabled, true)).orderBy(asc(newsGroups.chatId));

      return result.map(mapNewsGroupRow);
    },
    async upsertGroup(input) {
      const now = new Date();
      const created = await database
        .insert(newsGroups)
        .values({
          chatId: input.chatId,
          isEnabled: input.isEnabled,
          ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
          ...(input.isEnabled ? { enabledAt: now, disabledAt: null } : { disabledAt: now }),
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: newsGroups.chatId,
          set: {
            isEnabled: input.isEnabled,
            ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
            ...(input.isEnabled ? { enabledAt: now, disabledAt: null } : { disabledAt: now }),
            updatedAt: now,
          },
        })
        .returning();

      const row = created[0];
      if (!row) {
        throw new Error('News group insert did not return a row');
      }

      return mapNewsGroupRow(row);
    },
    async listSubscriptionsByChatId(chatId) {
      const result = await database
        .select()
        .from(newsGroupSubscriptions)
        .where(eq(newsGroupSubscriptions.chatId, chatId))
        .orderBy(asc(newsGroupSubscriptions.categoryKey));

      return result.map(mapNewsGroupSubscriptionRow);
    },
    async upsertSubscription(input) {
      const now = new Date();
      const created = await database
        .insert(newsGroupSubscriptions)
        .values({
          chatId: input.chatId,
          categoryKey: input.categoryKey,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [newsGroupSubscriptions.chatId, newsGroupSubscriptions.categoryKey],
          set: {
            updatedAt: now,
          },
        })
        .returning();

      const row = created[0];
      if (!row) {
        throw new Error('News group subscription insert did not return a row');
      }

      return mapNewsGroupSubscriptionRow(row);
    },
    async deleteSubscription({ chatId, categoryKey }) {
      const deleted = await database
        .delete(newsGroupSubscriptions)
        .where(
          and(
            eq(newsGroupSubscriptions.chatId, chatId),
            eq(newsGroupSubscriptions.categoryKey, categoryKey),
          ),
        )
        .returning({ chatId: newsGroupSubscriptions.chatId });

      return deleted.length > 0;
    },
    async listSubscribedGroupsByCategory(categoryKey) {
      const result = await database
        .select({
          chatId: newsGroups.chatId,
          isEnabled: newsGroups.isEnabled,
          metadata: newsGroups.metadata,
          createdAt: newsGroups.createdAt,
          updatedAt: newsGroups.updatedAt,
          enabledAt: newsGroups.enabledAt,
          disabledAt: newsGroups.disabledAt,
        })
        .from(newsGroupSubscriptions)
        .innerJoin(newsGroups, eq(newsGroupSubscriptions.chatId, newsGroups.chatId))
        .where(and(eq(newsGroupSubscriptions.categoryKey, categoryKey), eq(newsGroups.isEnabled, true)))
        .orderBy(asc(newsGroups.chatId));

      return result.map(mapNewsGroupRow);
    },
    async isNewsEnabledGroup(chatId) {
      const result = await database
        .select({ isEnabled: newsGroups.isEnabled })
        .from(newsGroups)
        .where(eq(newsGroups.chatId, chatId));

      return result[0]?.isEnabled === true;
    },
  };
}

function mapNewsGroupRow(row: typeof newsGroups.$inferSelect): NewsGroupRecord {
  return {
    chatId: row.chatId,
    isEnabled: row.isEnabled,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    enabledAt: row.enabledAt?.toISOString() ?? null,
    disabledAt: row.disabledAt?.toISOString() ?? null,
  };
}

function mapNewsGroupSubscriptionRow(row: typeof newsGroupSubscriptions.$inferSelect): NewsGroupSubscriptionRecord {
  return {
    chatId: row.chatId,
    categoryKey: row.categoryKey,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
