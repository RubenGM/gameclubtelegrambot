import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabaseScheduleRepository } from './schedule-catalog-store.js';
import { scheduleEventParticipants, scheduleEvents } from '../infrastructure/database/schema.js';

const scheduleEventsTable = scheduleEvents as unknown;
const scheduleEventParticipantsTable = scheduleEventParticipants as unknown;

test('createDatabaseScheduleRepository lists only scheduled events by default', async () => {
  const events: string[] = [];
  const repository = createDatabaseScheduleRepository({
    database: {
      select: () => ({
        from: (table: { [key: string]: unknown }) => ({
          where: () => ({
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
                  attendanceMode: 'open',
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
  assert.equal(result[0]?.initialOccupiedSeats, 0);
});

test('createDatabaseScheduleRepository persists attendance mode and initial occupied seats', async () => {
  const repository = createDatabaseScheduleRepository({
    database: {
      insert: (table: { [key: string]: unknown }) => {
        if ((table as unknown) !== scheduleEventsTable) {
          throw new Error('unexpected table');
        }

        return {
          values: (values: Record<string, unknown>) => {
            assert.equal(values.attendanceMode, 'open');
            assert.equal(values.initialOccupiedSeats, 2);

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
                  attendanceMode: 'open',
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
    } as never,
  });

  const event = await repository.createEvent({
    title: 'Open table',
    description: null,
    startsAt: '2026-04-05T16:00:00.000Z',
    durationMinutes: 180,
    organizerTelegramUserId: 42,
    createdByTelegramUserId: 42,
    tableId: null,
    attendanceMode: 'open',
    initialOccupiedSeats: 2,
    capacity: 5,
  });

  assert.equal(event.attendanceMode, 'open');
  assert.equal(event.initialOccupiedSeats, 2);
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
