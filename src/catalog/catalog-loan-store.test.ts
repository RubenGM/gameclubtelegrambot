import test from 'node:test';
import assert from 'node:assert/strict';

import { catalogItems, catalogLoans } from '../infrastructure/database/schema.js';
import { createDatabaseCatalogLoanRepository } from './catalog-loan-store.js';

const catalogItemsTable = catalogItems as unknown;
const catalogLoansTable = catalogLoans as unknown;

test('createDatabaseCatalogLoanRepository maps active-loan unique violations to the friendly message', async () => {
  const repository = createDatabaseCatalogLoanRepository({
    database: {
      transaction: async (handler: (tx: Record<string, unknown>) => Promise<unknown>) =>
        handler({
          select: () => ({
            from: (table: { [key: string]: unknown }) => {
              if ((table as unknown) === catalogLoansTable) {
                return {
                  where: () => ({
                    orderBy: async () => [],
                  }),
                };
              }

              if ((table as unknown) === catalogItemsTable) {
                return {
                  where: async () => [{ id: 7 }],
                };
              }

              throw new Error('unexpected table');
            },
          }),
          insert: (table: { [key: string]: unknown }) => {
            if ((table as unknown) !== catalogLoansTable) {
              throw new Error('unexpected table');
            }

            return {
              values: () => ({
                returning: async () => {
                  throw {
                    code: '23505',
                    constraint: 'catalog_loans_one_active_per_item',
                  };
                },
              }),
            };
          },
        } as never),
    } as never,
  });

  await assert.rejects(
    () =>
      repository.createLoan({
        itemId: 7,
        borrowerTelegramUserId: 101,
        borrowerDisplayName: 'Ada',
        loanedByTelegramUserId: 102,
        dueAt: null,
        notes: null,
      }),
    /Aquest item ja esta prestat\./,
  );
});

test('createDatabaseCatalogLoanRepository closes an active loan through one conditional update', async () => {
  const updatedAt = new Date('2026-04-12T10:00:00.000Z');

  const repository = createDatabaseCatalogLoanRepository({
    database: {
      update: (table: { [key: string]: unknown }) => {
        if ((table as unknown) !== catalogLoansTable) {
          throw new Error('unexpected table');
        }

        return {
          set: (values: Record<string, unknown>) => {
            assert.equal(values.returnedByTelegramUserId, 200);
            assert.ok(values.returnedAt instanceof Date);
            assert.ok(values.updatedAt instanceof Date);

            return {
              where: () => ({
                returning: async () => [
                  {
                    id: 9,
                    itemId: 7,
                    borrowerTelegramUserId: 101,
                    borrowerDisplayName: 'Ada',
                    loanedByTelegramUserId: 102,
                    dueAt: null,
                    notes: null,
                    returnedAt: updatedAt,
                    returnedByTelegramUserId: 200,
                    createdAt: new Date('2026-04-11T10:00:00.000Z'),
                    updatedAt,
                  },
                ],
              }),
            };
          },
        };
      },
    } as never,
  });

  const loan = await repository.closeLoan({
    loanId: 9,
    returnedByTelegramUserId: 200,
  });

  assert.equal(loan.returnedByTelegramUserId, 200);
  assert.equal(loan.returnedAt, updatedAt.toISOString());
});

test('createDatabaseCatalogLoanRepository keeps duplicate close requests idempotent', async () => {
  const returnedAt = new Date('2026-04-12T10:00:00.000Z');

  const repository = createDatabaseCatalogLoanRepository({
    database: {
      update: (table: { [key: string]: unknown }) => {
        if ((table as unknown) !== catalogLoansTable) {
          throw new Error('unexpected table');
        }

        return {
          set: () => ({
            where: () => ({
              returning: async () => [],
            }),
          }),
        };
      },
      select: () => ({
        from: (table: { [key: string]: unknown }) => {
          if ((table as unknown) !== catalogLoansTable) {
            throw new Error('unexpected table');
          }

          return {
            where: async () => [
              {
                id: 9,
                itemId: 7,
                borrowerTelegramUserId: 101,
                borrowerDisplayName: 'Ada',
                loanedByTelegramUserId: 102,
                dueAt: null,
                notes: 'Handle carefully',
                returnedAt,
                returnedByTelegramUserId: 200,
                createdAt: new Date('2026-04-11T10:00:00.000Z'),
                updatedAt: returnedAt,
              },
            ],
          };
        },
      }),
    } as never,
  });

  const loan = await repository.closeLoan({
    loanId: 9,
    returnedByTelegramUserId: 201,
  });

  assert.equal(loan.returnedByTelegramUserId, 200);
  assert.equal(loan.returnedAt, returnedAt.toISOString());
  assert.equal(loan.notes, 'Handle carefully');
});

test('createDatabaseCatalogLoanRepository still throws when closing a missing loan', async () => {
  const repository = createDatabaseCatalogLoanRepository({
    database: {
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => [],
          }),
        }),
      }),
      select: () => ({
        from: () => ({
          where: async () => [],
        }),
      }),
    } as never,
  });

  await assert.rejects(
    () =>
      repository.closeLoan({
        loanId: 9,
        returnedByTelegramUserId: 200,
      }),
    /Catalog loan 9 not found/,
  );
});
