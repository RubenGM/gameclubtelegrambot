import { asc, desc, eq, sql } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { catalogPendingGames } from '../infrastructure/database/schema.js';

export type CatalogPendingGameFailureType = 'ambiguous' | 'no-match' | 'error';

export interface CatalogPendingGameRecord {
  id: number;
  normalizedName: string;
  displayName: string;
  detectedByTelegramUserId: number;
  detectedCount: number;
  attemptCount: number;
  lastFailureType: CatalogPendingGameFailureType | null;
  lastFailureMessage: string | null;
  candidates: string[];
  lastAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogPendingGameRepository {
  upsertDetected(input: {
    displayName: string;
    detectedByTelegramUserId: number;
  }): Promise<CatalogPendingGameRecord>;
  list(): Promise<CatalogPendingGameRecord[]>;
  findById(id: number): Promise<CatalogPendingGameRecord | null>;
  recordAttemptFailure(input: {
    displayName: string;
    failureType: CatalogPendingGameFailureType;
    failureMessage: string | null;
    candidates: string[];
  }): Promise<CatalogPendingGameRecord | null>;
  deleteById(id: number): Promise<boolean>;
  deleteByDisplayName(displayName: string): Promise<boolean>;
}

export function createDatabaseCatalogPendingGameRepository({
  database,
}: {
  database: DatabaseConnection['db'];
}): CatalogPendingGameRepository {
  return {
    async upsertDetected({ displayName, detectedByTelegramUserId }) {
      const normalizedName = normalizeCatalogPendingGameName(displayName);
      const now = new Date();
      const rows = await database
        .insert(catalogPendingGames)
        .values({
          normalizedName,
          displayName: displayName.trim(),
          detectedByTelegramUserId,
        })
        .onConflictDoUpdate({
          target: catalogPendingGames.normalizedName,
          set: {
            displayName: displayName.trim(),
            detectedByTelegramUserId,
            detectedCount: sql`${catalogPendingGames.detectedCount} + 1`,
            updatedAt: now,
          },
        })
        .returning();
      const row = rows[0];
      if (!row) {
        throw new Error('Catalog pending game upsert did not return a row');
      }
      return mapCatalogPendingGameRow(row);
    },
    async list() {
      const rows = await database
        .select()
        .from(catalogPendingGames)
        .orderBy(desc(catalogPendingGames.updatedAt), asc(catalogPendingGames.displayName));
      return rows.map(mapCatalogPendingGameRow);
    },
    async findById(id) {
      const rows = await database
        .select()
        .from(catalogPendingGames)
        .where(eq(catalogPendingGames.id, id))
        .limit(1);
      return rows[0] ? mapCatalogPendingGameRow(rows[0]) : null;
    },
    async recordAttemptFailure({ displayName, failureType, failureMessage, candidates }) {
      const rows = await database
        .update(catalogPendingGames)
        .set({
          attemptCount: sql`${catalogPendingGames.attemptCount} + 1`,
          lastFailureType: failureType,
          lastFailureMessage: failureMessage,
          candidates,
          lastAttemptAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(catalogPendingGames.normalizedName, normalizeCatalogPendingGameName(displayName)))
        .returning();
      return rows[0] ? mapCatalogPendingGameRow(rows[0]) : null;
    },
    async deleteById(id) {
      const rows = await database
        .delete(catalogPendingGames)
        .where(eq(catalogPendingGames.id, id))
        .returning({ id: catalogPendingGames.id });
      return rows.length > 0;
    },
    async deleteByDisplayName(displayName) {
      const rows = await database
        .delete(catalogPendingGames)
        .where(eq(catalogPendingGames.normalizedName, normalizeCatalogPendingGameName(displayName)))
        .returning({ id: catalogPendingGames.id });
      return rows.length > 0;
    },
  };
}

export function normalizeCatalogPendingGameName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function mapCatalogPendingGameRow(row: typeof catalogPendingGames.$inferSelect): CatalogPendingGameRecord {
  return {
    id: row.id,
    normalizedName: row.normalizedName,
    displayName: row.displayName,
    detectedByTelegramUserId: row.detectedByTelegramUserId,
    detectedCount: row.detectedCount,
    attemptCount: row.attemptCount,
    lastFailureType: row.lastFailureType as CatalogPendingGameFailureType | null,
    lastFailureMessage: row.lastFailureMessage,
    candidates: Array.isArray(row.candidates) ? row.candidates.filter((candidate): candidate is string => typeof candidate === 'string') : [],
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
