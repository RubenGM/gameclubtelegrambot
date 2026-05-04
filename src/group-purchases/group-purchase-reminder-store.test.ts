import test from 'node:test';
import assert from 'node:assert/strict';

import { groupPurchaseReminders } from '../infrastructure/database/schema.js';
import { createDatabaseGroupPurchaseReminderRepository } from './group-purchase-reminder-store.js';

const remindersTable = groupPurchaseReminders as unknown;

test('createDatabaseGroupPurchaseReminderRepository checks and records sent reminders', async () => {
  const inserted: Record<string, unknown>[] = [];
  const repository = createDatabaseGroupPurchaseReminderRepository({
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

  assert.equal(await repository.hasReminderBeenSent({ purchaseId: 1, participantTelegramUserId: 77, reminderKind: 'confirm_deadline', leadHours: 24 }), false);
  await repository.recordReminderSent({
    purchaseId: 1,
    participantTelegramUserId: 77,
    reminderKind: 'confirm_deadline',
    leadHours: 24,
    sentAt: '2026-04-27T15:00:00.000Z',
  });

  assert.equal(inserted.length, 1);
  assert.equal(inserted[0]?.purchaseId, 1);
  assert.equal(inserted[0]?.participantTelegramUserId, 77);
  assert.equal(inserted[0]?.reminderKind, 'confirm_deadline');
  assert.equal(inserted[0]?.leadHours, 24);
  assert.deepEqual(inserted[0]?.sentAt, new Date('2026-04-27T15:00:00.000Z'));
});

test('createDatabaseGroupPurchaseReminderRepository reports existing reminders', async () => {
  const repository = createDatabaseGroupPurchaseReminderRepository({
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

  assert.equal(await repository.hasReminderBeenSent({ purchaseId: 1, participantTelegramUserId: 77, reminderKind: 'confirm_deadline', leadHours: 24 }), true);
});
