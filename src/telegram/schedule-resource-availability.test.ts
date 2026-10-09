import test from 'node:test';
import assert from 'node:assert/strict';

import { buildScheduleResourceAvailability } from './schedule-resource-availability.js';
import type { ScheduleEventRecord } from '../schedule/schedule-catalog.js';
import type { ClubTableRecord } from '../tables/table-catalog.js';
import type { ClubEquipmentRecord } from '../equipment/equipment-catalog.js';

const tables: ClubTableRecord[] = [
  { id: 1, displayName: 'Taula A', description: null, recommendedCapacity: 4, lifecycleStatus: 'active', createdAt: '', updatedAt: '', deactivatedAt: null },
  { id: 2, displayName: 'Taula B', description: null, recommendedCapacity: 4, lifecycleStatus: 'active', createdAt: '', updatedAt: '', deactivatedAt: null },
  { id: 3, displayName: 'Taula inactiva', description: null, recommendedCapacity: 4, lifecycleStatus: 'deactivated', createdAt: '', updatedAt: '', deactivatedAt: '' },
];

const equipment: ClubEquipmentRecord[] = [
  { id: 10, displayName: 'Projector', description: null, lifecycleStatus: 'active', createdAt: '', updatedAt: '', deactivatedAt: null },
  { id: 11, displayName: 'Micròfon', description: null, lifecycleStatus: 'active', createdAt: '', updatedAt: '', deactivatedAt: null },
];

function event(overrides: Partial<ScheduleEventRecord> = {}): ScheduleEventRecord {
  return {
    id: 100,
    title: 'Partida',
    description: null,
    detailsMessageChatId: null,
    detailsMessageId: null,
    startsAt: '2026-10-12T18:00:00.000Z',
    durationMinutes: 60,
    organizerTelegramUserId: 1,
    createdByTelegramUserId: 1,
    tableId: 1,
    equipmentIds: [10],
    attendanceMode: 'open',
    isPublic: false,
    initialOccupiedSeats: 0,
    capacity: 4,
    lifecycleStatus: 'scheduled',
    createdAt: '',
    updatedAt: '',
    cancelledAt: null,
    cancelledByTelegramUserId: null,
    cancellationReason: null,
    ...overrides,
  };
}

test('marks only matching resources busy for half-open overlapping intervals', () => {
  const result = buildScheduleResourceAvailability({
    startsAt: '2026-10-12T18:30:00.000Z',
    durationMinutes: 60,
    tables,
    equipment,
    events: [
      event(),
      event({ id: 101, startsAt: '2026-10-12T19:30:00.000Z', tableId: 2, equipmentIds: [11] }),
    ],
  });

  assert.ok(result);
  assert.deepEqual(result.tables.map(({ id, busy, conflictingEventIds }) => ({ id, busy, conflictingEventIds })), [
    { id: 1, busy: true, conflictingEventIds: [100] },
    { id: 2, busy: false, conflictingEventIds: [] },
  ]);
  assert.deepEqual(result.equipment, [
    { id: 10, displayName: 'Projector', busy: true, conflictingEventIds: [100] },
    { id: 11, displayName: 'Micròfon', busy: false, conflictingEventIds: [] },
  ]);
});

test('ignores canceled records and the event being edited', () => {
  const result = buildScheduleResourceAvailability({
    startsAt: '2026-10-12T18:00:00.000Z',
    durationMinutes: 90,
    tables,
    equipment,
    excludeEventId: 100,
    events: [
      event(),
      event({ id: 101, lifecycleStatus: 'cancelled', cancelledAt: '2026-10-01T00:00:00.000Z' }),
    ],
  });

  assert.ok(result);
  assert.equal(result.tables[0]?.busy, false);
  assert.deepEqual(result.tables[0]?.conflictingEventIds, []);
  assert.equal(result.equipment[0]?.busy, false);
});

test('an overlapping priority event blocks every active club resource', () => {
  const result = buildScheduleResourceAvailability({
    startsAt: '2026-10-12T18:30:00.000Z',
    durationMinutes: 30,
    tables,
    equipment,
    events: [event({ id: 103, tableId: null, equipmentIds: [], isPriority: true })],
  });

  assert.ok(result);
  assert.deepEqual(result.tables.map(({ id, busy, conflictingEventIds }) => ({ id, busy, conflictingEventIds })), [
    { id: 1, busy: true, conflictingEventIds: [103] },
    { id: 2, busy: true, conflictingEventIds: [103] },
  ]);
  assert.deepEqual(result.equipment.map(({ id, busy, conflictingEventIds }) => ({ id, busy, conflictingEventIds })), [
    { id: 10, busy: true, conflictingEventIds: [103] },
    { id: 11, busy: true, conflictingEventIds: [103] },
  ]);
});

test('returns null for invalid draft intervals rather than claiming resources are free', () => {
  for (const [startsAt, durationMinutes] of [
    ['not-a-date', 60],
    ['2026-10-12T18:00:00.000Z', 0],
    ['2026-10-12T18:00:00.000Z', 1.5],
  ] as const) {
    assert.equal(buildScheduleResourceAvailability({ startsAt, durationMinutes, tables, equipment, events: [event()] }), null);
  }
});
