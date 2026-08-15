import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createClubEquipment,
  deactivateClubEquipment,
  listClubEquipment,
  updateClubEquipmentMetadata,
  type ClubEquipmentRecord,
  type ClubEquipmentRepository,
} from './equipment-catalog.js';

function createRepository(): ClubEquipmentRepository {
  const records = new Map<number, ClubEquipmentRecord>();
  let nextId = 1;
  return {
    async createEquipment(input) {
      const now = '2026-08-16T10:00:00.000Z';
      const record: ClubEquipmentRecord = {
        id: nextId++,
        ...input,
        lifecycleStatus: 'active',
        createdAt: now,
        updatedAt: now,
        deactivatedAt: null,
      };
      records.set(record.id, record);
      return record;
    },
    async findEquipmentById(equipmentId) {
      return records.get(equipmentId) ?? null;
    },
    async listEquipment({ includeDeactivated }) {
      return Array.from(records.values()).filter((record) => includeDeactivated || record.lifecycleStatus === 'active');
    },
    async updateEquipment(input) {
      const current = records.get(input.equipmentId);
      if (!current) throw new Error('not found');
      const updated = { ...current, ...input, updatedAt: '2026-08-16T11:00:00.000Z' };
      records.set(updated.id, updated);
      return updated;
    },
    async deactivateEquipment({ equipmentId }) {
      const current = records.get(equipmentId);
      if (!current) throw new Error('not found');
      const updated: ClubEquipmentRecord = {
        ...current,
        lifecycleStatus: 'deactivated',
        updatedAt: '2026-08-16T12:00:00.000Z',
        deactivatedAt: '2026-08-16T12:00:00.000Z',
      };
      records.set(equipmentId, updated);
      return updated;
    },
  };
}

test('equipment catalog creates, updates, lists and deactivates equipment', async () => {
  const repository = createRepository();
  const created = await createClubEquipment({ repository, displayName: ' TV móvil ', description: ' Con ruedas ' });
  assert.equal(created.displayName, 'TV móvil');
  assert.equal(created.description, 'Con ruedas');

  const updated = await updateClubEquipmentMetadata({
    repository,
    equipmentId: created.id,
    displayName: 'TV móvil',
    description: null,
  });
  assert.equal(updated.description, null);
  assert.equal((await listClubEquipment({ repository })).length, 1);

  await deactivateClubEquipment({ repository, equipmentId: created.id });
  assert.equal((await listClubEquipment({ repository })).length, 0);
  assert.equal((await listClubEquipment({ repository, includeDeactivated: true })).length, 1);
});
