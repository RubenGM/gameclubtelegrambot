import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabaseClubTableRepository } from './table-catalog-store.js';
import { clubTables } from '../infrastructure/database/schema.js';

const clubTablesTable = clubTables as unknown;

test('createDatabaseClubTableRepository lists only active tables by default', async () => {
  const events: string[] = [];
  const repository = createDatabaseClubTableRepository({
    database: {
      select: (_selection: Record<string, unknown>) => ({
        from: (table: { [key: string]: unknown }) => ({
          where: async () => {
            if ((table as unknown) !== clubTablesTable) {
              throw new Error('unexpected table');
            }

            events.push('list:active');
            return [
              {
                id: 1,
                displayName: 'Mesa TV',
                description: null,
                recommendedCapacity: 6,
                lifecycleStatus: 'active',
                createdAt: new Date('2026-04-04T10:00:00.000Z'),
                updatedAt: new Date('2026-04-04T10:00:00.000Z'),
                deactivatedAt: null,
              },
            ];
          },
          orderBy: async () => {
            throw new Error('expected active listing to go through where()');
          },
        }),
      }),
    } as never,
  });

  const tables = await repository.listTables({ includeDeactivated: false });

  assert.deepEqual(events, ['list:active']);
  assert.deepEqual(tables.map((table) => table.id), [1]);
});

test('createDatabaseClubTableRepository can include deactivated tables for historical lookups', async () => {
  const events: string[] = [];
  const repository = createDatabaseClubTableRepository({
    database: {
      select: (_selection: Record<string, unknown>) => ({
        from: (table: { [key: string]: unknown }) => ({
          where: async () => {
            throw new Error('expected full listing to avoid lifecycle filter');
          },
          orderBy: async () => {
            if ((table as unknown) !== clubTablesTable) {
              throw new Error('unexpected table');
            }

            events.push('list:all');
            return [
              {
                id: 1,
                displayName: 'Mesa TV',
                description: null,
                recommendedCapacity: 6,
                lifecycleStatus: 'active',
                createdAt: new Date('2026-04-04T10:00:00.000Z'),
                updatedAt: new Date('2026-04-04T10:00:00.000Z'),
                deactivatedAt: null,
              },
              {
                id: 2,
                displayName: 'Mesa auxiliar',
                description: null,
                recommendedCapacity: 4,
                lifecycleStatus: 'deactivated',
                createdAt: new Date('2026-04-04T10:00:00.000Z'),
                updatedAt: new Date('2026-04-04T12:00:00.000Z'),
                deactivatedAt: new Date('2026-04-04T12:00:00.000Z'),
              },
            ];
          },
        }),
      }),
    } as never,
  });

  const tables = await repository.listTables({ includeDeactivated: true });

  assert.deepEqual(events, ['list:all']);
  assert.deepEqual(tables.map((table) => table.lifecycleStatus), ['active', 'deactivated']);
});

test('createDatabaseClubTableRepository deactivates a table without deleting it', async () => {
  const repository = createDatabaseClubTableRepository({
    database: {
      update: (table: { [key: string]: unknown }) => {
        if ((table as unknown) !== clubTablesTable) {
          throw new Error('unexpected table');
        }

        return {
          set: (values: Record<string, unknown>) => {
            assert.equal(values.lifecycleStatus, 'deactivated');
            assert.ok(values.updatedAt instanceof Date);
            assert.ok(values.deactivatedAt instanceof Date);

            return {
              where: () => ({
                returning: async () => [
                  {
                    id: 7,
                    displayName: 'Mesa 7',
                    description: 'Prop de l entrada',
                    recommendedCapacity: 5,
                    lifecycleStatus: 'deactivated',
                    createdAt: new Date('2026-04-04T10:00:00.000Z'),
                    updatedAt: new Date('2026-04-04T12:00:00.000Z'),
                    deactivatedAt: new Date('2026-04-04T12:00:00.000Z'),
                  },
                ],
              }),
            };
          },
        };
      },
    } as never,
  });

  const table = await repository.deactivateTable({ tableId: 7 });

  assert.equal(table.id, 7);
  assert.equal(table.lifecycleStatus, 'deactivated');
  assert.equal(table.deactivatedAt, '2026-04-04T12:00:00.000Z');
});
