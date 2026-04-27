import test from 'node:test';
import assert from 'node:assert/strict';

import type {
  GroupPurchaseParticipantRecord,
  GroupPurchaseRecord,
  GroupPurchaseRepository,
} from './group-purchase-catalog.js';
import { sendDueGroupPurchaseReminders, type GroupPurchaseReminderRepository } from './group-purchase-reminders.js';

test('sendDueGroupPurchaseReminders sends confirmation reminders to interested participants inside the lead window', async () => {
  const sent: Array<{ telegramUserId: number; message: string }> = [];
  const reminderRepository = createReminderRepository();

  const result = await sendDueGroupPurchaseReminders({
    groupPurchaseRepository: createGroupPurchaseRepository({
      purchases: [
        createPurchase({ id: 1, title: 'Samarretes', confirmDeadlineAt: '2026-04-28T15:00:00.000Z' }),
        createPurchase({ id: 2, title: 'Too late', confirmDeadlineAt: '2026-04-29T15:00:00.000Z' }),
        createPurchase({ id: 3, title: 'Closed', confirmDeadlineAt: '2026-04-28T15:00:00.000Z', lifecycleStatus: 'closed' }),
      ],
      participants: [
        createParticipant({ purchaseId: 1, participantTelegramUserId: 77, status: 'interested' }),
        createParticipant({ purchaseId: 1, participantTelegramUserId: 88, status: 'confirmed' }),
        createParticipant({ purchaseId: 2, participantTelegramUserId: 99, status: 'interested' }),
        createParticipant({ purchaseId: 3, participantTelegramUserId: 111, status: 'interested' }),
      ],
    }),
    reminderRepository,
    now: new Date('2026-04-27T15:00:00.000Z'),
    leadHours: 24,
    language: 'ca',
    sendPrivateMessage: async (telegramUserId, message) => {
      sent.push({ telegramUserId, message });
    },
  });

  assert.deepEqual(sent, [
    { telegramUserId: 77, message: 'Recordatori: confirma la compra conjunta Samarretes abans del 28/04 a les 15:00.' },
  ]);
  assert.deepEqual(reminderRepository.records, [
    { purchaseId: 1, participantTelegramUserId: 77, reminderKind: 'confirm_deadline', leadHours: 24 },
  ]);
  assert.deepEqual(result, { consideredPurchases: 1, sentReminders: 1, skippedReminders: 1, failedReminders: 0 });
});

test('sendDueGroupPurchaseReminders skips reminders already recorded', async () => {
  const sent: Array<{ telegramUserId: number; message: string }> = [];
  const reminderRepository = createReminderRepository([
    { purchaseId: 1, participantTelegramUserId: 77, reminderKind: 'confirm_deadline', leadHours: 24 },
  ]);

  const result = await sendDueGroupPurchaseReminders({
    groupPurchaseRepository: createGroupPurchaseRepository({
      purchases: [createPurchase({ id: 1, title: 'Samarretes', confirmDeadlineAt: '2026-04-28T15:00:00.000Z' })],
      participants: [createParticipant({ purchaseId: 1, participantTelegramUserId: 77, status: 'interested' })],
    }),
    reminderRepository,
    now: new Date('2026-04-27T15:00:00.000Z'),
    leadHours: 24,
    language: 'ca',
    sendPrivateMessage: async (telegramUserId, message) => {
      sent.push({ telegramUserId, message });
    },
  });

  assert.deepEqual(sent, []);
  assert.deepEqual(reminderRepository.records, [
    { purchaseId: 1, participantTelegramUserId: 77, reminderKind: 'confirm_deadline', leadHours: 24 },
  ]);
  assert.deepEqual(result, { consideredPurchases: 1, sentReminders: 0, skippedReminders: 1, failedReminders: 0 });
});

test('sendDueGroupPurchaseReminders does not record failed sends', async () => {
  const reminderRepository = createReminderRepository();

  const result = await sendDueGroupPurchaseReminders({
    groupPurchaseRepository: createGroupPurchaseRepository({
      purchases: [createPurchase({ id: 1, title: 'Samarretes', confirmDeadlineAt: '2026-04-28T15:00:00.000Z' })],
      participants: [createParticipant({ purchaseId: 1, participantTelegramUserId: 77, status: 'interested' })],
    }),
    reminderRepository,
    now: new Date('2026-04-27T15:00:00.000Z'),
    leadHours: 24,
    language: 'ca',
    sendPrivateMessage: async () => {
      throw new Error('Telegram unavailable');
    },
  });

  assert.deepEqual(reminderRepository.records, []);
  assert.deepEqual(result, { consideredPurchases: 1, sentReminders: 0, skippedReminders: 0, failedReminders: 1 });
});

function createReminderRepository(
  initialRecords: Array<{ purchaseId: number; participantTelegramUserId: number; reminderKind: string; leadHours: number }> = [],
): GroupPurchaseReminderRepository & { records: Array<{ purchaseId: number; participantTelegramUserId: number; reminderKind: string; leadHours: number }> } {
  const records = initialRecords.slice();
  return {
    records,
    async hasReminderBeenSent(input) {
      return records.some((record) =>
        record.purchaseId === input.purchaseId &&
        record.participantTelegramUserId === input.participantTelegramUserId &&
        record.reminderKind === input.reminderKind &&
        record.leadHours === input.leadHours,
      );
    },
    async recordReminderSent(input) {
      records.push({
        purchaseId: input.purchaseId,
        participantTelegramUserId: input.participantTelegramUserId,
        reminderKind: input.reminderKind,
        leadHours: input.leadHours,
      });
    },
  };
}

function createGroupPurchaseRepository({
  purchases,
  participants,
}: {
  purchases: GroupPurchaseRecord[];
  participants: GroupPurchaseParticipantRecord[];
}): GroupPurchaseRepository {
  return {
    createPurchase: async () => undefined as never,
    updatePurchase: async () => undefined as never,
    updatePurchaseLifecycleStatus: async () => undefined as never,
    findPurchaseById: async (purchaseId) => purchases.find((purchase) => purchase.id === purchaseId) ?? null,
    listPurchases: async () => purchases,
    getPurchaseDetail: async () => null,
    findParticipant: async () => null,
    listParticipants: async (purchaseId) => participants.filter((participant) => participant.purchaseId === purchaseId),
    upsertParticipant: async () => undefined as never,
    listParticipantFieldValues: async () => [],
    replaceParticipantFieldValues: async () => [],
    createMessage: async () => undefined as never,
  };
}

function createPurchase(input: {
  id: number;
  title: string;
  confirmDeadlineAt: string | null;
  lifecycleStatus?: GroupPurchaseRecord['lifecycleStatus'];
}): GroupPurchaseRecord {
  return {
    id: input.id,
    title: input.title,
    description: null,
    purchaseMode: 'shared_cost',
    lifecycleStatus: input.lifecycleStatus ?? 'open',
    createdByTelegramUserId: 42,
    joinDeadlineAt: null,
    confirmDeadlineAt: input.confirmDeadlineAt,
    totalPriceCents: null,
    unitPriceCents: null,
    unitLabel: null,
    allocationFieldKey: null,
    createdAt: '2026-04-20T10:00:00.000Z',
    updatedAt: '2026-04-20T10:00:00.000Z',
    cancelledAt: null,
  };
}

function createParticipant(input: {
  purchaseId: number;
  participantTelegramUserId: number;
  status: GroupPurchaseParticipantRecord['status'];
}): GroupPurchaseParticipantRecord {
  return {
    purchaseId: input.purchaseId,
    participantTelegramUserId: input.participantTelegramUserId,
    participantDisplayName: null,
    participantUsername: null,
    status: input.status,
    joinedAt: '2026-04-20T10:00:00.000Z',
    updatedAt: '2026-04-20T10:00:00.000Z',
    removedAt: input.status === 'removed' ? '2026-04-21T10:00:00.000Z' : null,
    confirmedAt: input.status === 'confirmed' ? '2026-04-21T10:00:00.000Z' : null,
    paidAt: input.status === 'paid' ? '2026-04-21T10:00:00.000Z' : null,
    deliveredAt: input.status === 'delivered' ? '2026-04-21T10:00:00.000Z' : null,
  };
}
