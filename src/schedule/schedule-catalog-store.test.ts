import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabaseScheduleRepository } from './schedule-catalog-store.js';
import { scheduleEventEquipment, scheduleEventParticipants, scheduleEvents } from '../infrastructure/database/schema.js';

const scheduleEventsTable = scheduleEvents as unknown;
const scheduleEventParticipantsTable = scheduleEventParticipants as unknown;
const scheduleEventEquipmentTable = scheduleEventEquipment as unknown;

test('createDatabaseScheduleRepository lists only scheduled events by default', async () => {
  const events: string[] = [];
  const repository = createDatabaseScheduleRepository({
    database: {
      select: () => ({
        from: (table: { [key: string]: unknown }) => ({
          where: () => (table as unknown) === scheduleEventEquipmentTable ? Promise.resolve([]) : ({
            orderBy: async () => {
              if ((table as unknown) !== scheduleEventsTable) {
                throw new Error('unexpected table');
              }

              events.push('list:scheduled');
              return [
                {
                  id: 1,
                  title: 'Terraforming Mars',
                  description: null,
                  startsAt: new Date('2026-04-05T16:00:00.000Z'),
                  durationMinutes: 180,
                  organizerTelegramUserId: 42,
                  createdByTelegramUserId: 42,
                  tableId: null,
                  catalogItemId: null,
                  attendanceMode: 'open',
                  isPublic: false,
                  initialOccupiedSeats: 0,
                  capacity: 5,
                  lifecycleStatus: 'scheduled',
                  createdAt: new Date('2026-04-04T10:00:00.000Z'),
                  updatedAt: new Date('2026-04-04T10:00:00.000Z'),
                  cancelledAt: null,
                  cancelledByTelegramUserId: null,
                  cancellationReason: null,
                },
              ];
            },
          }),
          orderBy: async () => {
            throw new Error('expected filtered listing to go through where()');
          },
        }),
      }),
    } as never,
  });

  const result = await repository.listEvents({ includeCancelled: false });

  assert.deepEqual(events, ['list:scheduled']);
  assert.deepEqual(result.map((event) => event.id), [1]);
  assert.equal(result[0]?.attendanceMode, 'open');
  assert.equal(result[0]?.isPublic, false);
  assert.equal(result[0]?.initialOccupiedSeats, 0);
});

test('createDatabaseScheduleRepository persists attendance mode, visibility, and initial occupied seats', async () => {
  const database = {
    execute: async () => undefined,
    select: () => ({ from: () => ({ where: async () => [] }) }),
      insert: (table: { [key: string]: unknown }) => {
        if ((table as unknown) !== scheduleEventsTable) {
          throw new Error('unexpected table');
        }

        return {
          values: (values: Record<string, unknown>) => {
            assert.equal(values.attendanceMode, 'open');
            assert.equal(values.isPublic, true);
            assert.equal(values.initialOccupiedSeats, 2);
            assert.equal(values.catalogItemId, null);

            return {
              returning: async () => [
                {
                  id: 9,
                  title: 'Open table',
                  description: null,
                  startsAt: new Date('2026-04-05T16:00:00.000Z'),
                  durationMinutes: 180,
                  organizerTelegramUserId: 42,
                  createdByTelegramUserId: 42,
                  tableId: null,
                  catalogItemId: null,
                  attendanceMode: 'open',
                  isPublic: true,
                  initialOccupiedSeats: 2,
                  capacity: 5,
                  lifecycleStatus: 'scheduled',
                  createdAt: new Date('2026-04-04T10:00:00.000Z'),
                  updatedAt: new Date('2026-04-04T10:00:00.000Z'),
                  cancelledAt: null,
                  cancelledByTelegramUserId: null,
                  cancellationReason: null,
                },
              ],
            };
          },
        };
      },
      transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(database),
    };
  const repository = createDatabaseScheduleRepository({ database: database as never });

  const event = await repository.createEvent({
    title: 'Open table',
    description: null,
    startsAt: '2026-04-05T16:00:00.000Z',
    durationMinutes: 180,
    organizerTelegramUserId: 42,
    createdByTelegramUserId: 42,
    tableId: null,
    attendanceMode: 'open',
    isPublic: true,
    initialOccupiedSeats: 2,
    capacity: 5,
  } as never);

  assert.equal(event.attendanceMode, 'open');
  assert.equal(event.isPublic, true);
  assert.equal(event.initialOccupiedSeats, 2);
});

test('createDatabaseScheduleRepository stores equipment assignments in the same transaction', async () => {
  const assignments: Array<{ scheduleEventId: number; equipmentId: number }> = [];
  const database = {
    execute: async () => undefined,
    select: () => ({ from: () => ({ where: async () => [] }) }),
    insert: (table: { [key: string]: unknown }) => {
      if ((table as unknown) === scheduleEventsTable) {
        return {
          values: () => ({
            returning: async () => [{
              id: 12,
              title: 'Partida con material',
              description: null,
              detailsMessageChatId: null,
              detailsMessageId: null,
              startsAt: new Date('2026-04-05T16:00:00.000Z'),
              durationMinutes: 180,
              organizerTelegramUserId: 42,
              createdByTelegramUserId: 42,
              tableId: null,
              catalogItemId: null,
              attendanceMode: 'closed',
              isPublic: false,
              initialOccupiedSeats: 0,
              capacity: 4,
              lifecycleStatus: 'scheduled',
              createdAt: new Date('2026-04-04T10:00:00.000Z'),
              updatedAt: new Date('2026-04-04T10:00:00.000Z'),
              cancelledAt: null,
              cancelledByTelegramUserId: null,
              cancellationReason: null,
            }],
          }),
        };
      }
      if ((table as unknown) === scheduleEventEquipmentTable) {
        return {
          values: async (values: Array<{ scheduleEventId: number; equipmentId: number }>) => {
            assignments.push(...values);
          },
        };
      }
      throw new Error('unexpected table');
    },
    transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(database),
  };
  const repository = createDatabaseScheduleRepository({ database: database as never });
  const event = await repository.createEvent({
    title: 'Partida con material',
    description: null,
    startsAt: '2026-04-05T16:00:00.000Z',
    durationMinutes: 180,
    organizerTelegramUserId: 42,
    createdByTelegramUserId: 42,
    tableId: null,
    equipmentIds: [2, 3],
    attendanceMode: 'closed',
    isPublic: false,
    initialOccupiedSeats: 0,
    capacity: 4,
  });

  assert.deepEqual(event.equipmentIds, [2, 3]);
  assert.deepEqual(assignments, [
    { scheduleEventId: 12, equipmentId: 2 },
    { scheduleEventId: 12, equipmentId: 3 },
  ]);
});

test('createDatabaseScheduleRepository can upsert participants preserving join and leave metadata', async () => {
  const repository = createDatabaseScheduleRepository({
    database: {
      insert: (table: { [key: string]: unknown }) => {
        if ((table as unknown) !== scheduleEventParticipantsTable) {
          throw new Error('unexpected table');
        }

        return {
          values: (values: Record<string, unknown>) => {
            assert.equal(values.scheduleEventId, 7);
            assert.equal(values.participantTelegramUserId, 42);
            assert.equal(values.status, 'removed');
            assert.equal(values.addedByTelegramUserId, 99);
            assert.equal(values.removedByTelegramUserId, 99);
            assert.ok(values.leftAt instanceof Date);
            assert.ok(values.updatedAt instanceof Date);

            return {
              onConflictDoUpdate: () => ({
                returning: async () => [
                  {
                    scheduleEventId: 7,
                    participantTelegramUserId: 42,
                    status: 'removed',
                    addedByTelegramUserId: 99,
                    removedByTelegramUserId: 99,
                    joinedAt: new Date('2026-04-04T10:00:00.000Z'),
                    updatedAt: new Date('2026-04-04T11:00:00.000Z'),
                    leftAt: new Date('2026-04-04T11:00:00.000Z'),
                  },
                ],
              }),
            };
          },
        };
      },
    } as never,
  });

  const participant = await repository.upsertParticipant({
    eventId: 7,
    participantTelegramUserId: 42,
    actorTelegramUserId: 99,
    status: 'removed',
  });

  assert.equal(participant.scheduleEventId, 7);
  assert.equal(participant.status, 'removed');
  assert.equal(participant.leftAt, '2026-04-04T11:00:00.000Z');
});

test('createDatabaseScheduleRepository persists participant reminder preference', async () => {
  const repository = createDatabaseScheduleRepository({
    database: {
      insert: (table: { [key: string]: unknown }) => {
        if ((table as unknown) !== scheduleEventParticipantsTable) {
          throw new Error('unexpected table');
        }

        return {
          values: (values: Record<string, unknown>) => {
            assert.equal(values.reminderLeadHours, 2);
            assert.equal(values.reminderPreferenceConfigured, true);

            return {
              onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => {
                assert.equal(set.reminderLeadHours, 2);
                assert.equal(set.reminderPreferenceConfigured, true);

                return {
                  returning: async () => [
                    {
                      scheduleEventId: 7,
                      participantTelegramUserId: 42,
                      status: 'active',
                      addedByTelegramUserId: 99,
                      removedByTelegramUserId: null,
                      reminderLeadHours: 2,
                      reminderPreferenceConfigured: true,
                      joinedAt: new Date('2026-04-04T10:00:00.000Z'),
                      updatedAt: new Date('2026-04-04T11:00:00.000Z'),
                      leftAt: null,
                    },
                  ],
                };
              },
            };
          },
        };
      },
    } as never,
  });

  const participant = await repository.upsertParticipant({
    eventId: 7,
    participantTelegramUserId: 42,
    actorTelegramUserId: 99,
    status: 'active',
    reminderLeadHours: 2,
    reminderPreferenceConfigured: true,
  } as never);

  assert.equal(participant.reminderLeadHours, 2);
  assert.equal(participant.reminderPreferenceConfigured, true);
});

test('createDatabaseScheduleRepository persists participant role and guest count', async () => {
  const repository = createDatabaseScheduleRepository({
    database: {
      insert: (table: { [key: string]: unknown }) => {
        if ((table as unknown) !== scheduleEventParticipantsTable) {
          throw new Error('unexpected table');
        }

        return {
          values: (values: Record<string, unknown>) => {
            assert.equal(values.participationRole, 'player');
            assert.equal(values.companionCount, 1);
            assert.equal(values.spectatorCount, 2);

            return {
              onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => {
                assert.equal(set.participationRole, 'player');
                assert.equal(set.companionCount, 1);
                assert.equal(set.spectatorCount, 2);

                return {
                  returning: async () => [
                    {
                      scheduleEventId: 7,
                      participantTelegramUserId: 42,
                      status: 'active',
                      participationRole: 'player',
                      companionCount: 1,
                      spectatorCount: 2,
                      addedByTelegramUserId: 99,
                      removedByTelegramUserId: null,
                      joinedAt: new Date('2026-04-04T10:00:00.000Z'),
                      updatedAt: new Date('2026-04-04T11:00:00.000Z'),
                      leftAt: null,
                    },
                  ],
                };
              },
            };
          },
        };
      },
    } as never,
  });

  const participant = await repository.upsertParticipant({
    eventId: 7,
    participantTelegramUserId: 42,
    actorTelegramUserId: 99,
    status: 'active',
    participationRole: 'player',
    companionCount: 1,
    spectatorCount: 2,
  });

  assert.equal(participant.participationRole, 'player');
  assert.equal(participant.companionCount, 1);
  assert.equal(participant.spectatorCount, 2);
});



test('database rechecks priority inside a locked transaction before creating or rescheduling', async () => {
  const priority = {
    id: 7, title: 'Asamblea', description: null, detailsMessageChatId: null, detailsMessageId: null,
    startsAt: new Date('2026-04-05T16:00:00.000Z'), durationMinutes: 120,
    organizerTelegramUserId: 42, createdByTelegramUserId: 42, tableId: null, catalogItemId: null,
    attendanceMode: 'closed', isPublic: false, isPriority: true, priorityExplanation: 'Votación anual',
    initialOccupiedSeats: 0, capacity: 20, lifecycleStatus: 'scheduled', createdAt: new Date(), updatedAt: new Date(),
    cancelledAt: null, cancelledByTelegramUserId: null, cancellationReason: null,
  };
  const calls: string[] = [];
  const tx = {
    execute: async () => { calls.push('lock'); },
    select: () => ({ from: () => ({ where: async () => { calls.push('read'); return [priority, { ...priority, id: 8, isPriority: false, startsAt: new Date('2026-04-05T18:00:00.000Z') }]; } }) }),
    insert: () => { throw new Error('must not insert'); },
    update: () => { throw new Error('must not update'); },
  };
  const repository = createDatabaseScheduleRepository({ database: { transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(tx) } as never });
  const input = { title: 'Otra mesa', description: null, startsAt: '2026-04-05T17:00:00.000Z', durationMinutes: 60, organizerTelegramUserId: 42, createdByTelegramUserId: 42, tableId: 99, attendanceMode: 'closed' as const, isPublic: false, initialOccupiedSeats: 0, capacity: 4 };
  await assert.rejects(repository.createEvent(input), /club está reservado.*Votación anual/);
  await assert.rejects(repository.updateEvent({ ...input, eventId: 8 }), /club está reservado.*Votación anual/);
  assert.deepEqual(calls, ['lock', 'read', 'lock', 'read']);
});
