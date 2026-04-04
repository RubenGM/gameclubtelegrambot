import { asc, eq } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { clubTables } from '../infrastructure/database/schema.js';
import type { ClubTableRecord, ClubTableRepository } from './table-catalog.js';

export function createDatabaseClubTableRepository({
  database,
}: {
  database: DatabaseConnection['db'];
}): ClubTableRepository {
  return {
    async createTable(input) {
      const created = await database
        .insert(clubTables)
        .values({
          displayName: input.displayName,
          description: input.description,
          recommendedCapacity: input.recommendedCapacity,
        })
        .returning();

      const row = created[0];
      if (!row) {
        throw new Error('Club table insert did not return a row');
      }

      return mapClubTableRow(row);
    },
    async findTableById(tableId) {
      const result = await database.select().from(clubTables).where(eq(clubTables.id, tableId));
      const row = result[0];
      return row ? mapClubTableRow(row) : null;
    },
    async listTables({ includeDeactivated }) {
      const result = includeDeactivated
        ? await database.select().from(clubTables).orderBy(asc(clubTables.displayName))
        : await database.select().from(clubTables).where(eq(clubTables.lifecycleStatus, 'active'));

      return result.map(mapClubTableRow);
    },
    async updateTable(input) {
      const updated = await database
        .update(clubTables)
        .set({
          displayName: input.displayName,
          description: input.description,
          recommendedCapacity: input.recommendedCapacity,
          updatedAt: new Date(),
        })
        .where(eq(clubTables.id, input.tableId))
        .returning();

      const row = updated[0];
      if (!row) {
        throw new Error(`Club table ${input.tableId} not found`);
      }

      return mapClubTableRow(row);
    },
    async deactivateTable({ tableId }) {
      const now = new Date();
      const updated = await database
        .update(clubTables)
        .set({
          lifecycleStatus: 'deactivated',
          updatedAt: now,
          deactivatedAt: now,
        })
        .where(eq(clubTables.id, tableId))
        .returning();

      const row = updated[0];
      if (!row) {
        throw new Error(`Club table ${tableId} not found`);
      }

      return mapClubTableRow(row);
    },
  };
}

function mapClubTableRow(row: typeof clubTables.$inferSelect): ClubTableRecord {
  return {
    id: row.id,
    displayName: row.displayName,
    description: row.description,
    recommendedCapacity: row.recommendedCapacity,
    lifecycleStatus: row.lifecycleStatus as ClubTableRecord['lifecycleStatus'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
  };
}
