import test from 'node:test';
import assert from 'node:assert/strict';

import type { CatalogLoanRepository, CatalogLoanWithItemRecord } from './catalog-model.js';
import { sendDueCatalogLoanReminders, type CatalogLoanReminderRepository } from './catalog-loan-reminders.js';

const now = new Date('2026-05-09T10:00:00.000Z');

test('sendDueCatalogLoanReminders sends the first weekly reminder after seven days with a return button', async () => {
  const reminderRepository = createReminderRepository();
  const sent: Array<{ telegramUserId: number; message: string; options?: unknown }> = [];

  const result = await sendDueCatalogLoanReminders({
    catalogLoanRepository: createLoanRepository([
      createLoan({ id: 1, createdAt: '2026-05-02T09:00:00.000Z', dueAt: null, itemDisplayName: 'Catan' }),
    ]),
    reminderRepository,
    now,
    language: 'es',
    sendPrivateMessage: async (telegramUserId, message, options) => {
      sent.push({ telegramUserId, message, options });
    },
  });

  assert.deepEqual(result, { consideredLoans: 1, sentReminders: 1, skippedReminders: 0, failedReminders: 0 });
  assert.deepEqual(reminderRepository.records, [
    { loanId: 1, borrowerTelegramUserId: 77, reminderKind: 'weekly', leadHours: 168 },
  ]);
  assert.equal(sent[0]?.telegramUserId, 77);
  assert.match(sent[0]?.message ?? '', /Catan/);
  assert.match(sent[0]?.message ?? '', /Aún tienes/);
  assert.deepEqual(sent[0]?.options, {
    inlineKeyboard: [[{ text: '✅ Ya lo he devuelto', callbackData: 'catalog_loan:return:1' }]],
  });
});

test('sendDueCatalogLoanReminders sends one reminder for each reached week', async () => {
  const reminderRepository = createReminderRepository();
  const sent: string[] = [];

  const result = await sendDueCatalogLoanReminders({
    catalogLoanRepository: createLoanRepository([
      createLoan({ id: 2, createdAt: '2026-04-25T09:00:00.000Z', dueAt: '2026-05-08T09:00:00.000Z', itemDisplayName: 'Dune' }),
    ]),
    reminderRepository,
    now,
    language: 'en',
    sendPrivateMessage: async (_telegramUserId, message) => {
      sent.push(message);
    },
  });

  assert.deepEqual(result, { consideredLoans: 1, sentReminders: 1, skippedReminders: 0, failedReminders: 0 });
  assert.deepEqual(reminderRepository.records, [
    { loanId: 2, borrowerTelegramUserId: 77, reminderKind: 'weekly', leadHours: 336 },
  ]);
  assert.match(sent[0] ?? '', /was due back/);
});

test('sendDueCatalogLoanReminders skips reminders already recorded', async () => {
  const reminderRepository = createReminderRepository([
    { loanId: 1, borrowerTelegramUserId: 77, reminderKind: 'weekly', leadHours: 168 },
  ]);

  const result = await sendDueCatalogLoanReminders({
    catalogLoanRepository: createLoanRepository([
      createLoan({ id: 1, createdAt: '2026-05-02T09:00:00.000Z' }),
    ]),
    reminderRepository,
    now,
    language: 'ca',
    sendPrivateMessage: async () => {
      throw new Error('should not send');
    },
  });

  assert.deepEqual(result, { consideredLoans: 1, sentReminders: 0, skippedReminders: 1, failedReminders: 0 });
  assert.deepEqual(reminderRepository.records, [
    { loanId: 1, borrowerTelegramUserId: 77, reminderKind: 'weekly', leadHours: 168 },
  ]);
});

test('sendDueCatalogLoanReminders does not record failed sends and continues the batch', async () => {
  const reminderRepository = createReminderRepository();
  const sent: number[] = [];

  const result = await sendDueCatalogLoanReminders({
    catalogLoanRepository: createLoanRepository([
      createLoan({ id: 1, borrowerTelegramUserId: 77, createdAt: '2026-05-02T09:00:00.000Z' }),
      createLoan({ id: 2, borrowerTelegramUserId: 88, createdAt: '2026-05-02T09:00:00.000Z' }),
    ]),
    reminderRepository,
    now,
    language: 'ca',
    sendPrivateMessage: async (telegramUserId) => {
      if (telegramUserId === 77) {
        throw new Error('blocked');
      }
      sent.push(telegramUserId);
    },
  });

  assert.deepEqual(result, { consideredLoans: 2, sentReminders: 1, skippedReminders: 0, failedReminders: 1 });
  assert.deepEqual(sent, [88]);
  assert.deepEqual(reminderRepository.records, [
    { loanId: 2, borrowerTelegramUserId: 88, reminderKind: 'weekly', leadHours: 168 },
  ]);
});

test('sendDueCatalogLoanReminders skips loans younger than seven days', async () => {
  const reminderRepository = createReminderRepository();

  const result = await sendDueCatalogLoanReminders({
    catalogLoanRepository: createLoanRepository([
      createLoan({ id: 1, createdAt: '2026-05-03T10:00:00.000Z', dueAt: null }),
    ]),
    reminderRepository,
    now,
    language: 'ca',
    sendPrivateMessage: async () => {
      throw new Error('should not send');
    },
  });

  assert.deepEqual(result, { consideredLoans: 1, sentReminders: 0, skippedReminders: 1, failedReminders: 0 });
  assert.deepEqual(reminderRepository.records, []);
});

function createLoanRepository(loans: CatalogLoanWithItemRecord[]): CatalogLoanRepository {
  return {
    listActiveLoansWithItems: async () => loans,
  } as unknown as CatalogLoanRepository;
}

function createReminderRepository(
  initialRecords: Array<{ loanId: number; borrowerTelegramUserId: number; reminderKind: string; leadHours: number | null }> = [],
): CatalogLoanReminderRepository & {
  records: Array<{ loanId: number; borrowerTelegramUserId: number; reminderKind: string; leadHours: number | null }>;
} {
  const records = [...initialRecords];
  return {
    records,
    async hasReminderBeenSent(input) {
      return records.some((record) =>
        record.loanId === input.loanId &&
        record.borrowerTelegramUserId === input.borrowerTelegramUserId &&
        record.reminderKind === input.reminderKind &&
        record.leadHours === input.leadHours,
      );
    },
    async recordReminderSent(input) {
      records.push({
        loanId: input.loanId,
        borrowerTelegramUserId: input.borrowerTelegramUserId,
        reminderKind: input.reminderKind,
        leadHours: input.leadHours,
      });
    },
  };
}

function createLoan(input: Partial<CatalogLoanWithItemRecord>): CatalogLoanWithItemRecord {
  return {
    id: input.id ?? 1,
    itemId: input.itemId ?? 10,
    borrowerTelegramUserId: input.borrowerTelegramUserId ?? 77,
    borrowerDisplayName: input.borrowerDisplayName ?? 'Ada',
    loanedByTelegramUserId: input.loanedByTelegramUserId ?? 99,
    dueAt: input.dueAt === undefined ? '2026-05-10T09:00:00.000Z' : input.dueAt,
    notes: input.notes ?? null,
    returnedAt: input.returnedAt ?? null,
    returnedByTelegramUserId: input.returnedByTelegramUserId ?? null,
    createdAt: input.createdAt ?? '2026-05-01T10:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-05-01T10:00:00.000Z',
    itemDisplayName: input.itemDisplayName ?? 'Catan',
    itemLifecycleStatus: input.itemLifecycleStatus ?? 'active',
  };
}
