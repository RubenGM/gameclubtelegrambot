import { and, asc, gt, inArray, isNull, notExists } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { catalogLoanNewsEvents } from '../infrastructure/database/schema.js';
import type {
  CatalogLoanNewsEventRecord,
  CatalogLoanNewsEventRepository,
} from './catalog-loan-news-event.js';

export function createDatabaseCatalogLoanNewsEventRepository({
  database,
}: {
  database: DatabaseConnection['db'];
}): CatalogLoanNewsEventRepository {
  return {
    async enqueue(input) {
      const inserted = await database
        .insert(catalogLoanNewsEvents)
        .values({
          categoryKey: input.categoryKey,
          action: input.action,
          itemId: input.itemId,
          itemDisplayName: input.itemDisplayName,
          userName: input.userName,
          occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
          publishedAt: null,
        })
        .returning();
      const row = inserted[0];
      if (!row) {
        throw new Error('Catalog loan news event insert did not return a row');
      }
      return mapCatalogLoanNewsEventRow(row);
    },

    async listPendingBatchReadyBefore(readyBefore) {
      const newerPendingEvent = database
        .select({ id: catalogLoanNewsEvents.id })
        .from(catalogLoanNewsEvents)
        .where(and(
          isNull(catalogLoanNewsEvents.publishedAt),
          gt(catalogLoanNewsEvents.occurredAt, new Date(readyBefore)),
        ));
      const rows = await database
        .select()
        .from(catalogLoanNewsEvents)
        .where(and(
          isNull(catalogLoanNewsEvents.publishedAt),
          notExists(newerPendingEvent),
        ))
        .orderBy(asc(catalogLoanNewsEvents.occurredAt), asc(catalogLoanNewsEvents.id));
      return rows.map(mapCatalogLoanNewsEventRow);
    },

    async markPublished({ eventIds, publishedAt }) {
      if (eventIds.length === 0) {
        return;
      }
      await database
        .update(catalogLoanNewsEvents)
        .set({ publishedAt: new Date(publishedAt) })
        .where(and(
          inArray(catalogLoanNewsEvents.id, eventIds),
          isNull(catalogLoanNewsEvents.publishedAt),
        ));
    },
  };
}

function mapCatalogLoanNewsEventRow(
  row: typeof catalogLoanNewsEvents.$inferSelect,
): CatalogLoanNewsEventRecord {
  return {
    id: row.id,
    categoryKey: row.categoryKey as CatalogLoanNewsEventRecord['categoryKey'],
    action: row.action as CatalogLoanNewsEventRecord['action'],
    itemId: row.itemId,
    itemDisplayName: row.itemDisplayName,
    userName: row.userName,
    occurredAt: row.occurredAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
  };
}
