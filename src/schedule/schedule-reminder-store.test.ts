import test from 'node:test';
import assert from 'node:assert/strict';

import { scheduleEventReminders } from '../infrastructure/database/schema.js';
import { createDatabaseScheduleEventReminderRepository } from './schedule-reminder-store.js';

const remindersTable = scheduleEventReminders as unknown;

test('createDatabaseScheduleEventReminderRepository checks and records sent reminders', async () => {
  const inserted: Record<string, unknown>[] = [];
  const repository = createDatabaseScheduleEventReminderRepository({
    database: {
      select: () => ({
        from: (table: { [key: string]: unknown }) => {
          assert.equal(table as unknown, remindersTable);
          return {
            where: () => ({
              limit: async () => [],
            }),
          };
        },
      }),
      insert: (table: { [key: string]: unknown }) => {
        assert.equal(table as unknown, remindersTable);
        return {
          values: async (value: Record<string, unknown>) => {
            inserted.push(value);
          },
        };
      },
    } as never,
  });

  assert.equal(await repository.hasReminderBeenSent({ scheduleEventId: 1, participantTelegramUserId: 77, leadHours: 24 }), false);
  await repository.recordReminderSent({
    scheduleEventId: 1,
    participantTelegramUserId: 77,
    leadHours: 24,
    sentAt: '2026-04-27T15:00:00.000Z',
  });

  assert.equal(inserted.length, 1);
  assert.equal(inserted[0]?.scheduleEventId, 1);
  assert.equal(inserted[0]?.participantTelegramUserId, 77);
  assert.equal(inserted[0]?.leadHours, 24);
  assert.deepEqual(inserted[0]?.sentAt, new Date('2026-04-27T15:00:00.000Z'));
});

test('createDatabaseScheduleEventReminderRepository reports existing reminders', async () => {
  const repository = createDatabaseScheduleEventReminderRepository({
    database: {
      select: () => ({
        from: (table: { [key: string]: unknown }) => {
          assert.equal(table as unknown, remindersTable);
          return {
            where: () => ({
              limit: async () => [{ id: 1 }],
            }),
          };
        },
      }),
    } as never,
  });

  assert.equal(await repository.hasReminderBeenSent({ scheduleEventId: 1, participantTelegramUserId: 77, leadHours: 24 }), true);
});
