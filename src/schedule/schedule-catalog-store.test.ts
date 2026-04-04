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
          where: async () => {
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
                organizerTelegramUserId: 42,
                createdByTelegramUserId: 42,
                tableId: null,
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
