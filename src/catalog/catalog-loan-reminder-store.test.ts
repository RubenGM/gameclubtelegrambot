import test from 'node:test';
import assert from 'node:assert/strict';

import { catalogLoanReminders } from '../infrastructure/database/schema.js';
import { createDatabaseCatalogLoanReminderRepository } from './catalog-loan-reminder-store.js';

const remindersTable = catalogLoanReminders as unknown;

test('createDatabaseCatalogLoanReminderRepository checks and records sent reminders', async () => {
  const inserted: Record<string, unknown>[] = [];
  const repository = createDatabaseCatalogLoanReminderRepository({
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

  assert.equal(await repository.hasReminderBeenSent({ loanId: 1, borrowerTelegramUserId: 77, reminderKind: 'due_soon', leadHours: 24 }), false);
  await repository.recordReminderSent({
    loanId: 1,
    borrowerTelegramUserId: 77,
    reminderKind: 'due_soon',
    leadHours: 24,
    sentAt: '2026-05-09T10:00:00.000Z',
  });

  assert.equal(inserted.length, 1);
  assert.equal(inserted[0]?.loanId, 1);
  assert.equal(inserted[0]?.borrowerTelegramUserId, 77);
  assert.equal(inserted[0]?.reminderKind, 'due_soon');
  assert.equal(inserted[0]?.leadHours, 24);
  assert.deepEqual(inserted[0]?.sentAt, new Date('2026-05-09T10:00:00.000Z'));
});

test('createDatabaseCatalogLoanReminderRepository reports existing overdue reminders', async () => {
  const repository = createDatabaseCatalogLoanReminderRepository({
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

  assert.equal(await repository.hasReminderBeenSent({ loanId: 1, borrowerTelegramUserId: 77, reminderKind: 'overdue', leadHours: null }), true);
});
