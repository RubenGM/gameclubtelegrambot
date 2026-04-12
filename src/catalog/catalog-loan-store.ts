import { and, desc, eq, isNull } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { catalogItems, catalogLoans } from '../infrastructure/database/schema.js';
import type { CatalogLoanRecord, CatalogLoanRepository } from './catalog-model.js';

const duplicateActiveLoanMessage = 'Aquest item ja esta prestat.';
const activeLoanConstraintName = 'catalog_loans_one_active_per_item';

export function createDatabaseCatalogLoanRepository({
  database,
}: {
  database: DatabaseConnection['db'];
}): CatalogLoanRepository {
  return {
    async createLoan(input) {
      return database.transaction(async (tx) => {
        const active = await findActiveLoanByItemIdUsing(tx, input.itemId);
        if (active) {
          throw new Error(duplicateActiveLoanMessage);
        }

        const item = await tx.select().from(catalogItems).where(eq(catalogItems.id, input.itemId));
        if (!item[0]) {
          throw new Error(`Catalog item ${input.itemId} not found`);
        }

        const now = new Date();
        let created;
        try {
          created = await tx
            .insert(catalogLoans)
            .values({
              itemId: input.itemId,
              borrowerTelegramUserId: input.borrowerTelegramUserId,
              borrowerDisplayName: input.borrowerDisplayName,
              loanedByTelegramUserId: input.loanedByTelegramUserId,
              dueAt: input.dueAt ? new Date(input.dueAt) : null,
              notes: input.notes,
              returnedAt: null,
              returnedByTelegramUserId: null,
              createdAt: now,
              updatedAt: now,
            })
            .returning();
        } catch (error) {
          if (isActiveLoanConstraintViolation(error)) {
            throw new Error(duplicateActiveLoanMessage);
          }

          throw error;
        }
        const row = created[0];
        if (!row) {
          throw new Error('Catalog loan insert did not return a row');
        }
        return mapCatalogLoanRow(row);
      });
    },
    async findLoanById(loanId) {
      const result = await database.select().from(catalogLoans).where(eq(catalogLoans.id, loanId));
      const row = result[0];
      return row ? mapCatalogLoanRow(row) : null;
    },
    async findActiveLoanByItemId(itemId) {
      return findActiveLoanByItemIdUsing(database, itemId);
    },
    async listActiveLoansByBorrower(borrowerTelegramUserId) {
      const rows = await database
        .select()
        .from(catalogLoans)
        .where(and(eq(catalogLoans.borrowerTelegramUserId, borrowerTelegramUserId), isNull(catalogLoans.returnedAt)))
        .orderBy(desc(catalogLoans.createdAt), desc(catalogLoans.id));
      return rows.map(mapCatalogLoanRow);
    },
    async listLoansByItem(itemId) {
      const rows = await database
        .select()
        .from(catalogLoans)
        .where(eq(catalogLoans.itemId, itemId))
        .orderBy(desc(catalogLoans.createdAt), desc(catalogLoans.id));
      return rows.map(mapCatalogLoanRow);
    },
    async updateLoan(input) {
      const updated = await database
        .update(catalogLoans)
        .set({
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          notes: input.notes,
          updatedAt: new Date(),
        })
        .where(and(eq(catalogLoans.id, input.loanId), isNull(catalogLoans.returnedAt)))
        .returning();
      const row = updated[0];
      if (!row) {
        throw new Error(`Catalog loan ${input.loanId} not found or already returned`);
      }
      return mapCatalogLoanRow(row);
    },
    async closeLoan(input) {
      const updated = await database
        .update(catalogLoans)
        .set({
          returnedAt: new Date(),
          returnedByTelegramUserId: input.returnedByTelegramUserId,
          updatedAt: new Date(),
        })
        .where(and(eq(catalogLoans.id, input.loanId), isNull(catalogLoans.returnedAt)))
        .returning();
      const updatedRow = updated[0];
      if (updatedRow) {
        return mapCatalogLoanRow(updatedRow);
      }

      const existing = await database.select().from(catalogLoans).where(eq(catalogLoans.id, input.loanId));
      const row = existing[0];
      if (!row) {
        throw new Error(`Catalog loan ${input.loanId} not found`);
      }

      return mapCatalogLoanRow(row);
    },
  };
}

function isActiveLoanConstraintViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = 'code' in error ? error.code : undefined;
  const constraint = 'constraint' in error ? error.constraint : undefined;
  return code === '23505' && constraint === activeLoanConstraintName;
}

async function findActiveLoanByItemIdUsing(
  database: DatabaseConnection['db'],
  itemId: number,
): Promise<CatalogLoanRecord | null> {
  const rows = await database
    .select()
    .from(catalogLoans)
    .where(and(eq(catalogLoans.itemId, itemId), isNull(catalogLoans.returnedAt)))
    .orderBy(desc(catalogLoans.createdAt), desc(catalogLoans.id));
  const row = rows[0];
  return row ? mapCatalogLoanRow(row) : null;
}

function mapCatalogLoanRow(row: typeof catalogLoans.$inferSelect): CatalogLoanRecord {
  return {
    id: row.id,
    itemId: row.itemId,
    borrowerTelegramUserId: row.borrowerTelegramUserId,
    borrowerDisplayName: row.borrowerDisplayName,
    loanedByTelegramUserId: row.loanedByTelegramUserId,
    dueAt: row.dueAt?.toISOString() ?? null,
    notes: row.notes,
    returnedAt: row.returnedAt?.toISOString() ?? null,
    returnedByTelegramUserId: row.returnedByTelegramUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
