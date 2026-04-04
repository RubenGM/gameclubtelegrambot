import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createClubTable,
  deactivateClubTable,
  getClubTable,
  listClubTables,
  updateClubTableMetadata,
  type ClubTableRecord,
  type ClubTableRepository,
} from './table-catalog.js';

function createRepository(initialTables: ClubTableRecord[] = []): ClubTableRepository {
  const tables = new Map(initialTables.map((table) => [table.id, table]));
  let nextId = Math.max(0, ...initialTables.map((table) => table.id)) + 1;

  return {
    async createTable(input) {
      const createdAt = '2026-04-04T10:00:00.000Z';
      const next: ClubTableRecord = {
        id: nextId,
        displayName: input.displayName,
        description: input.description ?? null,
        recommendedCapacity: input.recommendedCapacity ?? null,
        lifecycleStatus: 'active',
        createdAt,
        updatedAt: createdAt,
        deactivatedAt: null,
      };
      nextId += 1;
      tables.set(next.id, next);
      return next;
    },
    async findTableById(tableId) {
      return tables.get(tableId) ?? null;
    },
    async listTables({ includeDeactivated }) {
      return Array.from(tables.values()).filter(
        (table) => includeDeactivated || table.lifecycleStatus === 'active',
      );
    },
    async updateTable(input) {
      const existing = tables.get(input.tableId);
      if (!existing) {
        throw new Error(`unknown table ${input.tableId}`);
      }

      const next: ClubTableRecord = {
        ...existing,
        displayName: input.displayName,
        description: input.description ?? null,
        recommendedCapacity: input.recommendedCapacity ?? null,
        updatedAt: '2026-04-04T11:00:00.000Z',
      };
      tables.set(existing.id, next);
      return next;
    },
    async deactivateTable({ tableId }) {
      const existing = tables.get(tableId);
      if (!existing) {
        throw new Error(`unknown table ${tableId}`);
      }

      const next: ClubTableRecord = {
        ...existing,
        lifecycleStatus: 'deactivated',
        updatedAt: '2026-04-04T12:00:00.000Z',
        deactivatedAt: existing.deactivatedAt ?? '2026-04-04T12:00:00.000Z',
      };
      tables.set(existing.id, next);
      return next;
    },
  };
}

test('createClubTable creates an active table with normalized optional metadata', async () => {
  const repository = createRepository();

  const table = await createClubTable({
    repository,
    displayName: 'Mesa TV',
    description: '  Taula gran prop del televisor  ',
    recommendedCapacity: 6,
  });

  assert.equal(table.id, 1);
  assert.equal(table.displayName, 'Mesa TV');
  assert.equal(table.description, 'Taula gran prop del televisor');
  assert.equal(table.recommendedCapacity, 6);
  assert.equal(table.lifecycleStatus, 'active');
  assert.equal(table.deactivatedAt, null);
});

test('createClubTable rejects non-positive recommended capacity', async () => {
  const repository = createRepository();

  await assert.rejects(
    () =>
      createClubTable({
        repository,
        displayName: 'Mesa petita',
        recommendedCapacity: 0,
      }),
    /La capacitat recomanada ha de ser un enter positiu/,
  );
});

test('listClubTables excludes deactivated tables by default and can include them for historical lookups', async () => {
  const repository = createRepository([
    {
      id: 1,
      displayName: 'Mesa TV',
      description: null,
      recommendedCapacity: 6,
      lifecycleStatus: 'active',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      deactivatedAt: null,
    },
    {
      id: 2,
      displayName: 'Mesa auxiliar',
      description: null,
      recommendedCapacity: 4,
      lifecycleStatus: 'deactivated',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T12:00:00.000Z',
      deactivatedAt: '2026-04-04T12:00:00.000Z',
    },
  ]);

  const activeOnly = await listClubTables({ repository });
  const allTables = await listClubTables({ repository, includeDeactivated: true });

  assert.deepEqual(activeOnly.map((table) => table.id), [1]);
  assert.deepEqual(allTables.map((table) => table.id), [1, 2]);
});

test('deactivateClubTable keeps the table referenceable for historical consumers', async () => {
  const repository = createRepository([
    {
      id: 7,
      displayName: 'Mesa 7',
      description: 'Prop de l entrada',
      recommendedCapacity: 5,
      lifecycleStatus: 'active',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      deactivatedAt: null,
    },
  ]);

  const deactivated = await deactivateClubTable({ repository, tableId: 7 });
  const historicalLookup = await getClubTable({ repository, tableId: 7 });

  assert.equal(deactivated.lifecycleStatus, 'deactivated');
  assert.match(deactivated.deactivatedAt ?? '', /^2026-04-04T12:00:00.000Z$/);
  assert.equal(historicalLookup?.id, 7);
  assert.equal(historicalLookup?.lifecycleStatus, 'deactivated');
});

test('updateClubTableMetadata preserves stable identity while updating metadata', async () => {
  const repository = createRepository([
    {
      id: 3,
      displayName: 'Mesa antiga',
      description: null,
      recommendedCapacity: 4,
      lifecycleStatus: 'active',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      deactivatedAt: null,
    },
  ]);

  const updated = await updateClubTableMetadata({
    repository,
    tableId: 3,
    displayName: 'Mesa principal',
    description: '  Nova descripcio  ',
    recommendedCapacity: 8,
  });

  assert.equal(updated.id, 3);
  assert.equal(updated.displayName, 'Mesa principal');
  assert.equal(updated.description, 'Nova descripcio');
  assert.equal(updated.recommendedCapacity, 8);
});
