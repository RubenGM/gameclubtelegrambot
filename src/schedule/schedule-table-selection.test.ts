import test from 'node:test';
import assert from 'node:assert/strict';

import type { ClubTableRecord, ClubTableRepository } from '../tables/table-catalog.js';
import {
  getScheduleTableCapacityAdvisories,
  requireSchedulableTableSelection,
  resolveScheduleTableReference,
} from './schedule-table-selection.js';

function createRepository(initialTables: ClubTableRecord[] = []): ClubTableRepository {
  const tables = new Map(initialTables.map((table) => [table.id, table]));

  return {
    async createTable() {
      throw new Error('not implemented');
    },
    async findTableById(tableId) {
      return tables.get(tableId) ?? null;
    },
    async listTables({ includeDeactivated }) {
      return Array.from(tables.values()).filter((table) => includeDeactivated || table.lifecycleStatus === 'active');
    },
    async updateTable() {
      throw new Error('not implemented');
    },
    async deactivateTable() {
      throw new Error('not implemented');
    },
  };
}

test('requireSchedulableTableSelection accepts active tables and keeps selection optional', async () => {
  const repository = createRepository([
    {
      id: 7,
      displayName: 'Mesa TV',
      description: null,
      recommendedCapacity: 6,
      lifecycleStatus: 'active',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      deactivatedAt: null,
    },
  ]);

  assert.equal((await requireSchedulableTableSelection({ repository, tableId: null }))?.id ?? null, null);
  assert.equal((await requireSchedulableTableSelection({ repository, tableId: 7 }))?.displayName, 'Mesa TV');
});

test('requireSchedulableTableSelection rejects deactivated tables for new schedule selections', async () => {
  const repository = createRepository([
    {
      id: 8,
      displayName: 'Mesa auxiliar',
      description: null,
      recommendedCapacity: 4,
      lifecycleStatus: 'deactivated',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T12:00:00.000Z',
      deactivatedAt: '2026-04-04T12:00:00.000Z',
    },
  ]);

  await assert.rejects(
    () => requireSchedulableTableSelection({ repository, tableId: 8 }),
    /La taula seleccionada ja no esta activa/,
  );
});

test('resolveScheduleTableReference keeps deactivated tables available for historical reads', async () => {
  const repository = createRepository([
    {
      id: 9,
      displayName: 'Mesa finestra',
      description: null,
      recommendedCapacity: 5,
      lifecycleStatus: 'deactivated',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T12:00:00.000Z',
      deactivatedAt: '2026-04-04T12:00:00.000Z',
    },
  ]);

  assert.equal((await resolveScheduleTableReference({ repository, tableId: 9 }))?.displayName, 'Mesa finestra');
});

test('getScheduleTableCapacityAdvisories reports only advisory capacity hints', async () => {
  assert.deepEqual(
    getScheduleTableCapacityAdvisories({
      requestedCapacity: 7,
      table: {
        id: 10,
        displayName: 'Mesa gran',
        description: null,
        recommendedCapacity: 6,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    }),
    ['La capacitat indicada supera la capacitat recomanada de la taula (6). Aixo es mostra com a avis, no bloqueja la reserva.'],
  );
});
