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

test('createDatabaseCatalogLoanRepository lists active loans joined with item data', async () => {
  const repository = createDatabaseCatalogLoanRepository({
    database: {
      select: (selection: Record<string, unknown>) => {
        assert.deepEqual(Object.keys(selection), ['loan', 'itemDisplayName', 'itemLifecycleStatus']);
        return {
          from: (table: { [key: string]: unknown }) => {
            if ((table as unknown) !== catalogLoansTable) {
              throw new Error('unexpected table');
            }
            return {
              innerJoin: (table: { [key: string]: unknown }) => {
                if ((table as unknown) !== catalogItemsTable) {
                  throw new Error('unexpected joined table');
                }
                return {
                  where: () => ({
                    orderBy: async () => [
                      {
                        loan: {
                          id: 10,
                          itemId: 7,
                          borrowerTelegramUserId: 101,
                          borrowerDisplayName: 'Ada',
                          loanedByTelegramUserId: 102,
                          dueAt: new Date('2026-04-09T00:00:00.000Z'),
                          notes: 'Box insert',
                          returnedAt: null,
                          returnedByTelegramUserId: null,
                          createdAt: new Date('2026-04-01T10:00:00.000Z'),
                          updatedAt: new Date('2026-04-01T10:00:00.000Z'),
                        },
                        itemDisplayName: 'Catan',
                        itemLifecycleStatus: 'deactivated',
                      },
                    ],
                  }),
                };
              },
            };
          },
        };
      },
    } as never,
  });

  const loans = await repository.listActiveLoansWithItems();

  assert.equal(loans.length, 1);
  assert.equal(loans[0]?.id, 10);
  assert.equal(loans[0]?.itemDisplayName, 'Catan');
  assert.equal(loans[0]?.itemLifecycleStatus, 'deactivated');
  assert.equal(loans[0]?.returnedAt, null);
  assert.equal(loans[0]?.dueAt, '2026-04-09T00:00:00.000Z');
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
