import test from 'node:test';
import assert from 'node:assert/strict';

import {
  changeGroupPurchaseParticipantStatus,
  createGroupPurchase,
  joinGroupPurchase,
  updateGroupPurchaseParticipantFieldValues,
  type GroupPurchaseDetailRecord,
  type GroupPurchaseParticipantFieldValueRecord,
  type GroupPurchaseParticipantRecord,
  type GroupPurchaseRecord,
  type GroupPurchaseRepository,
} from './group-purchase-catalog.js';

function createRepository(initialPurchases: GroupPurchaseRecord[] = []): GroupPurchaseRepository {
  const purchases = new Map<number, GroupPurchaseRecord>(initialPurchases.map((purchase) => [purchase.id, purchase]));
  const fields = new Map<number, GroupPurchaseDetailRecord['fields']>();
  const participants = new Map<string, GroupPurchaseParticipantRecord>();
  const fieldValues = new Map<string, GroupPurchaseParticipantFieldValueRecord[]>();
  let nextPurchaseId = Math.max(0, ...initialPurchases.map((purchase) => purchase.id)) + 1;

  return {
    async createPurchase(input) {
      const createdAt = '2026-04-20T10:00:00.000Z';
      const purchase: GroupPurchaseRecord = {
        id: nextPurchaseId,
        title: input.title,
        description: input.description,
        purchaseMode: input.purchaseMode,
        lifecycleStatus: 'open',
        createdByTelegramUserId: input.createdByTelegramUserId,
        joinDeadlineAt: input.joinDeadlineAt,
        confirmDeadlineAt: input.confirmDeadlineAt,
        totalPriceCents: input.totalPriceCents,
        unitPriceCents: input.unitPriceCents,
        unitLabel: input.unitLabel,
        allocationFieldKey: input.allocationFieldKey,
        createdAt,
        updatedAt: createdAt,
        cancelledAt: null,
      };

      const purchaseFields = input.fields.map((field, index) => ({
        id: index + 1,
        purchaseId: nextPurchaseId,
        fieldKey: field.fieldKey,
        label: field.label,
        fieldType: field.fieldType,
        isRequired: field.isRequired,
        sortOrder: field.sortOrder,
        config: field.config ?? null,
        affectsQuantity: field.affectsQuantity,
      }));

      purchases.set(nextPurchaseId, purchase);
      fields.set(nextPurchaseId, purchaseFields);
      nextPurchaseId += 1;

      return {
        purchase,
        fields: purchaseFields,
        participants: [],
      };
    },
    async updatePurchase(input) {
      const existing = purchases.get(input.purchaseId);
      if (!existing) {
        throw new Error(`Group purchase ${input.purchaseId} not found`);
      }

      const next: GroupPurchaseRecord = {
        ...existing,
        title: input.title,
        description: input.description,
        joinDeadlineAt: input.joinDeadlineAt,
        confirmDeadlineAt: input.confirmDeadlineAt,
        totalPriceCents: input.totalPriceCents,
        unitPriceCents: input.unitPriceCents,
        unitLabel: input.unitLabel,
        allocationFieldKey: input.allocationFieldKey,
        updatedAt: '2026-04-20T11:00:00.000Z',
      };

      purchases.set(next.id, next);
      return next;
    },
    async findPurchaseById(purchaseId) {
      return purchases.get(purchaseId) ?? null;
    },
    async listPurchases() {
      return Array.from(purchases.values());
    },
    async getPurchaseDetail(purchaseId) {
      const purchase = purchases.get(purchaseId);
      if (!purchase) {
        return null;
      }

      return {
        purchase,
        fields: fields.get(purchaseId) ?? [],
        participants: Array.from(participants.values()).filter((participant) => participant.purchaseId === purchaseId),
      };
    },
    async findParticipant(purchaseId, participantTelegramUserId) {
      return participants.get(`${purchaseId}:${participantTelegramUserId}`) ?? null;
    },
    async listParticipants(purchaseId) {
      return Array.from(participants.values()).filter((participant) => participant.purchaseId === purchaseId);
    },
    async upsertParticipant(input) {
      const existing = participants.get(`${input.purchaseId}:${input.participantTelegramUserId}`);
      const next: GroupPurchaseParticipantRecord = {
        purchaseId: input.purchaseId,
        participantTelegramUserId: input.participantTelegramUserId,
        status: input.status,
        joinedAt: existing?.joinedAt ?? '2026-04-20T12:00:00.000Z',
        updatedAt: '2026-04-20T12:30:00.000Z',
        removedAt: input.status === 'removed' ? '2026-04-20T12:30:00.000Z' : null,
        confirmedAt: input.status === 'confirmed' ? '2026-04-20T12:30:00.000Z' : existing?.confirmedAt ?? null,
        paidAt: input.status === 'paid' ? '2026-04-20T12:30:00.000Z' : existing?.paidAt ?? null,
        deliveredAt: input.status === 'delivered' ? '2026-04-20T12:30:00.000Z' : existing?.deliveredAt ?? null,
      };

      participants.set(`${input.purchaseId}:${input.participantTelegramUserId}`, next);
      return next;
    },
    async listParticipantFieldValues(purchaseId, participantTelegramUserId) {
      return fieldValues.get(`${purchaseId}:${participantTelegramUserId}`) ?? [];
    },
    async replaceParticipantFieldValues(input) {
      const nextValues = input.values.map((value) => ({
        purchaseId: input.purchaseId,
        participantTelegramUserId: input.participantTelegramUserId,
        fieldId: value.fieldId,
        value: value.value,
        updatedAt: '2026-04-20T12:45:00.000Z',
      } satisfies GroupPurchaseParticipantFieldValueRecord));
      fieldValues.set(`${input.purchaseId}:${input.participantTelegramUserId}`, nextValues);
      return nextValues;
    },
    async createMessage(input) {
      return {
        id: 1,
        purchaseId: input.purchaseId,
        authorTelegramUserId: input.authorTelegramUserId,
        body: input.body,
        createdAt: '2026-04-20T14:00:00.000Z',
      };
    },
  };
}

function createOpenPurchase(overrides: Partial<GroupPurchaseRecord> = {}): GroupPurchaseRecord {
  return {
    id: 7,
    title: 'Pedido de dados',
    description: 'Compra conjunta',
    purchaseMode: 'per_item',
    lifecycleStatus: 'open',
    createdByTelegramUserId: 42,
    joinDeadlineAt: null,
    confirmDeadlineAt: null,
    totalPriceCents: null,
    unitPriceCents: 120,
    unitLabel: 'dado',
    allocationFieldKey: null,
    createdAt: '2026-04-20T10:00:00.000Z',
    updatedAt: '2026-04-20T10:00:00.000Z',
    cancelledAt: null,
    ...overrides,
  };
}

test('createGroupPurchase trims text fields and creates a per-item purchase with a quantity field', async () => {
  const repository = createRepository();

  const detail = await createGroupPurchase({
    repository,
    title: '  Pedido de dados  ',
    description: '  Chessex opacos  ',
    purchaseMode: 'per_item',
    createdByTelegramUserId: 42,
    unitPriceCents: 125,
    unitLabel: ' dado ',
    fields: [
      {
        fieldKey: 'quantity',
        label: ' Cantidad ',
        fieldType: 'integer',
        isRequired: true,
        sortOrder: 0,
        config: { min: 1 },
        affectsQuantity: true,
      },
    ],
  });

  assert.equal(detail.purchase.title, 'Pedido de dados');
  assert.equal(detail.purchase.description, 'Chessex opacos');
  assert.equal(detail.purchase.unitLabel, 'dado');
  assert.equal(detail.fields[0]?.label, 'Cantidad');
  assert.equal(detail.fields[0]?.affectsQuantity, true);
});

test('createGroupPurchase rejects a per-item purchase without a quantity field', async () => {
  const repository = createRepository();

  await assert.rejects(
    () =>
      createGroupPurchase({
        repository,
        title: 'Pedido de dados',
        purchaseMode: 'per_item',
        createdByTelegramUserId: 42,
        fields: [
          {
            fieldKey: 'color',
            label: 'Color',
            fieldType: 'single_choice',
            isRequired: true,
            sortOrder: 0,
            config: { options: [{ value: 'blue', label: 'Azul' }] },
            affectsQuantity: false,
          },
        ],
      }),
    /Per-item purchases require exactly one integer quantity field/,
  );
});

test('createGroupPurchase rejects multiple quantity-affecting fields', async () => {
  const repository = createRepository();

  await assert.rejects(
    () =>
      createGroupPurchase({
        repository,
        title: 'Pedido de ropa',
        purchaseMode: 'shared_cost',
        createdByTelegramUserId: 42,
        totalPriceCents: 5000,
        fields: [
          {
            fieldKey: 'hoodies',
            label: 'Sudaderas',
            fieldType: 'integer',
            isRequired: true,
            sortOrder: 0,
            config: { min: 0 },
            affectsQuantity: true,
          },
          {
            fieldKey: 'shirts',
            label: 'Camisetas',
            fieldType: 'integer',
            isRequired: true,
            sortOrder: 1,
            config: { min: 0 },
            affectsQuantity: true,
          },
        ],
      }),
    /Only one field can affect quantity or allocation/,
  );
});

test('joinGroupPurchase rejects purchases whose join deadline has expired', async () => {
  const repository = createRepository([
    createOpenPurchase({
      id: 11,
      joinDeadlineAt: '2026-04-20T09:59:59.000Z',
    }),
  ]);

  await assert.rejects(
    () =>
      joinGroupPurchase({
        repository,
        purchaseId: 11,
        participantTelegramUserId: 77,
        now: () => new Date('2026-04-20T10:00:00.000Z'),
      }),
    /Group purchase 11 is no longer accepting new participants/,
  );
});

test('changeGroupPurchaseParticipantStatus allows self confirmation before the deadline', async () => {
  const repository = createRepository([
    createOpenPurchase({
      id: 12,
      confirmDeadlineAt: '2026-04-20T15:00:00.000Z',
    }),
  ]);

  await joinGroupPurchase({
    repository,
    purchaseId: 12,
    participantTelegramUserId: 77,
    now: () => new Date('2026-04-20T10:00:00.000Z'),
  });

  const participant = await changeGroupPurchaseParticipantStatus({
    repository,
    purchaseId: 12,
    participantTelegramUserId: 77,
    actorRole: 'self',
    nextStatus: 'confirmed',
    now: () => new Date('2026-04-20T11:00:00.000Z'),
  });

  assert.equal(participant.status, 'confirmed');
  assert.equal(participant.confirmedAt, '2026-04-20T12:30:00.000Z');
});

test('changeGroupPurchaseParticipantStatus rejects self-service promotion to paid', async () => {
  const repository = createRepository([createOpenPurchase({ id: 13 })]);

  await joinGroupPurchase({
    repository,
    purchaseId: 13,
    participantTelegramUserId: 77,
  });

  await assert.rejects(
    () =>
      changeGroupPurchaseParticipantStatus({
        repository,
        purchaseId: 13,
        participantTelegramUserId: 77,
        actorRole: 'self',
        nextStatus: 'paid',
      }),
    /Only managers can set status paid/,
  );
});

test('updateGroupPurchaseParticipantFieldValues validates and stores participant answers by field key', async () => {
  const repository = createRepository();

  const created = await createGroupPurchase({
    repository,
    title: 'Pedido de dados',
    purchaseMode: 'per_item',
    createdByTelegramUserId: 42,
    fields: [
      {
        fieldKey: 'quantity',
        label: 'Cantidad',
        fieldType: 'integer',
        isRequired: true,
        sortOrder: 0,
        config: { min: 1 },
        affectsQuantity: true,
      },
      {
        fieldKey: 'color',
        label: 'Color',
        fieldType: 'single_choice',
        isRequired: true,
        sortOrder: 1,
        config: { options: [{ value: 'blue', label: 'Azul' }, { value: 'red', label: 'Rojo' }] },
        affectsQuantity: false,
      },
    ],
  });

  await joinGroupPurchase({
    repository,
    purchaseId: created.purchase.id,
    participantTelegramUserId: 77,
  });

  const values = await updateGroupPurchaseParticipantFieldValues({
    repository,
    purchaseId: created.purchase.id,
    participantTelegramUserId: 77,
    valuesByFieldKey: {
      quantity: '3',
      color: 'Azul',
    },
  });

  assert.deepEqual(values.map((value) => value.value), [3, 'blue']);
});
