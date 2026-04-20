import test from 'node:test';
import assert from 'node:assert/strict';

import type {
  GroupPurchaseDetailRecord,
  GroupPurchaseFieldRecord,
  GroupPurchaseParticipantFieldValueRecord,
  GroupPurchaseParticipantRecord,
  GroupPurchaseRecord,
  GroupPurchaseRepository,
} from '../group-purchases/group-purchase-catalog.js';
import type { ConversationSessionRecord } from './conversation-session.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import {
  handleTelegramGroupPurchaseCallback,
  handleTelegramGroupPurchaseCommand,
  handleTelegramGroupPurchaseStartText,
  handleTelegramGroupPurchaseText,
} from './group-purchase-flow.js';

function createRepository(initialPurchases: GroupPurchaseRecord[] = []): GroupPurchaseRepository {
  const purchases = new Map<number, GroupPurchaseRecord>(initialPurchases.map((purchase) => [purchase.id, purchase]));
  const fields = new Map<number, GroupPurchaseFieldRecord[]>();
  const participants = new Map<string, GroupPurchaseParticipantRecord>();
  const fieldValues = new Map<string, GroupPurchaseParticipantFieldValueRecord[]>();
  let nextPurchaseId = Math.max(0, ...initialPurchases.map((purchase) => purchase.id)) + 1;

  return {
    async createPurchase(input) {
      const purchaseId = nextPurchaseId;
      const createdAt = '2026-04-20T10:00:00.000Z';
      const purchase: GroupPurchaseRecord = {
        id: purchaseId,
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
        purchaseId,
        fieldKey: field.fieldKey,
        label: field.label,
        fieldType: field.fieldType,
        isRequired: field.isRequired,
        sortOrder: field.sortOrder,
        config: field.config ?? null,
        affectsQuantity: field.affectsQuantity,
      } satisfies GroupPurchaseFieldRecord));

      purchases.set(purchaseId, purchase);
      fields.set(purchaseId, purchaseFields);
      nextPurchaseId += 1;

      return {
        purchase,
        fields: purchaseFields,
        participants: [],
      };
    },
    async updatePurchase() {
      throw new Error('not implemented');
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
      } satisfies GroupPurchaseDetailRecord;
    },
    async findParticipant(purchaseId, participantTelegramUserId) {
      return participants.get(`${purchaseId}:${participantTelegramUserId}`) ?? null;
    },
    async listParticipants(purchaseId) {
      return Array.from(participants.values()).filter((participant) => participant.purchaseId === purchaseId);
    },
    async upsertParticipant(input) {
      const existing = participants.get(`${input.purchaseId}:${input.participantTelegramUserId}`);
      const participant: GroupPurchaseParticipantRecord = {
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
      participants.set(`${input.purchaseId}:${input.participantTelegramUserId}`, participant);
      return participant;
    },
    async listParticipantFieldValues(purchaseId, participantTelegramUserId) {
      return fieldValues.get(`${purchaseId}:${participantTelegramUserId}`) ?? [];
    },
    async replaceParticipantFieldValues(input) {
      const values = input.values.map((value) => ({
        purchaseId: input.purchaseId,
        participantTelegramUserId: input.participantTelegramUserId,
        fieldId: value.fieldId,
        value: value.value,
        updatedAt: '2026-04-20T12:45:00.000Z',
      } satisfies GroupPurchaseParticipantFieldValueRecord));
      fieldValues.set(`${input.purchaseId}:${input.participantTelegramUserId}`, values);
      return values;
    },
  };
}

function createContext(repository: GroupPurchaseRepository): {
  context: TelegramCommandHandlerContext;
  replies: Array<{ message: string; options?: TelegramReplyOptions }>;
  getCurrentSession(): ConversationSessionRecord | null;
} {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  let currentSession: ConversationSessionRecord | null = null;

  return {
    context: {
      messageText: undefined,
      reply: async (message: string, options?: TelegramReplyOptions) => {
        replies.push({ message, ...(options ? { options } : {}) });
      },
      runtime: {
        bot: {
          publicName: 'Game Club Bot',
          clubName: 'Game Club',
          language: 'ca',
          sendPrivateMessage: async () => {},
        },
        services: {
          database: {
            db: undefined as never,
          },
        } as never,
        chat: {
          kind: 'private',
          chatId: 1,
        },
        actor: {
          telegramUserId: 7,
          status: 'approved',
          isApproved: true,
          isBlocked: false,
          isAdmin: false,
          permissions: [],
        },
        authorization: {
          authorize: () => ({ allowed: false, permissionKey: 'group_purchase.manage', reason: 'no-match' }),
          can: () => false,
        },
        session: {
          get current() {
            return currentSession;
          },
          start: async ({ flowKey, stepKey, data = {} }: { flowKey: string; stepKey: string; data?: Record<string, unknown> }) => {
            currentSession = {
              key: 'telegram.session:1:7',
              flowKey,
              stepKey,
              data,
              createdAt: '2026-04-20T10:00:00.000Z',
              updatedAt: '2026-04-20T10:00:00.000Z',
              expiresAt: '2026-04-21T10:00:00.000Z',
            };
            return currentSession;
          },
          advance: async ({ stepKey, data }: { stepKey: string; data: Record<string, unknown> }) => {
            if (!currentSession) {
              throw new Error('no active session');
            }
            currentSession = {
              ...currentSession,
              stepKey,
              data,
              updatedAt: '2026-04-20T10:30:00.000Z',
            };
            return currentSession;
          },
          cancel: async () => {
            currentSession = null;
            return true;
          },
        },
      },
      groupPurchaseRepository: repository,
    } as unknown as TelegramCommandHandlerContext,
    replies,
    getCurrentSession() {
      return currentSession;
    },
  };
}

function buildPurchase(overrides: Partial<GroupPurchaseRecord> = {}): GroupPurchaseRecord {
  return {
    id: 7,
    title: 'Pedido de dados',
    description: 'Compra conjunta',
    purchaseMode: 'per_item',
    lifecycleStatus: 'open',
    createdByTelegramUserId: 42,
    joinDeadlineAt: '2026-04-30T21:00:00.000Z',
    confirmDeadlineAt: null,
    totalPriceCents: null,
    unitPriceCents: 125,
    unitLabel: 'dado',
    allocationFieldKey: null,
    createdAt: '2026-04-20T10:00:00.000Z',
    updatedAt: '2026-04-20T10:00:00.000Z',
    cancelledAt: null,
    ...overrides,
  };
}

test('handleTelegramGroupPurchaseText opens the group purchase submenu from the main menu action', async () => {
  const { context, replies } = createContext(createRepository());
  context.messageText = 'Compres conjuntes';

  const handled = await handleTelegramGroupPurchaseText(context);

  assert.equal(handled, true);
  assert.deepEqual(replies, [
    {
      message: 'Compres conjuntes: tria una accio.',
      options: {
        replyKeyboard: [['Veure compres', 'Crear compra'], ['Inici', 'Ajuda']],
        resizeKeyboard: true,
        persistentKeyboard: true,
      },
    },
  ]);
});

test('handleTelegramGroupPurchaseText lists purchases with deep links', async () => {
  const { context, replies } = createContext(createRepository([buildPurchase()]));
  context.messageText = 'Veure compres';

  const handled = await handleTelegramGroupPurchaseText(context);

  assert.equal(handled, true);
  assert.deepEqual(replies, [
    {
      message: 'Compres conjuntes:\n- <a href="https://t.me/cawatest_bot?start=group_purchase_7"><b>Pedido de dados</b></a> · Oberta · apuntar-se fins 30/04',
      options: {
        parseMode: 'HTML',
        replyKeyboard: [['Veure compres', 'Crear compra'], ['Inici', 'Ajuda']],
        resizeKeyboard: true,
        persistentKeyboard: true,
      },
    },
  ]);
});

test('handleTelegramGroupPurchaseCommand opens the submenu from the command entry point', async () => {
  const { context, replies } = createContext(createRepository());
  context.messageText = '/group_purchases';

  await handleTelegramGroupPurchaseCommand(context);

  assert.equal(replies[0]?.message, 'Compres conjuntes: tria una accio.');
});

test('handleTelegramGroupPurchaseStartText opens purchase detail from /start payload', async () => {
  const { context, replies } = createContext(createRepository([buildPurchase()]));
  context.messageText = '/start group_purchase_7';

  const handled = await handleTelegramGroupPurchaseStartText(context);

  assert.equal(handled, true);
  assert.deepEqual(replies, [
    {
      message:
        '<a href="https://t.me/cawatest_bot?start=group_purchase_7"><b>Pedido de dados</b></a>\nMode: Per unitats\nEstat: Oberta\nDescripcio: Compra conjunta\nPreu unitari: 1.25 EUR\nUnitat: dado\nApuntar-se fins: 30/04',
      options: {
        parseMode: 'HTML',
        inlineKeyboard: [[{ text: 'Apuntar-me', callbackData: 'group_purchase:join:7' }]],
      },
    },
  ]);
});

test('handleTelegramGroupPurchaseText starts the create flow from the submenu action', async () => {
  const { context, replies, getCurrentSession } = createContext(createRepository());
  context.messageText = 'Crear compra';

  const handled = await handleTelegramGroupPurchaseText(context);

  assert.equal(handled, true);
  assert.equal(getCurrentSession()?.flowKey, 'group-purchase-create');
  assert.equal(getCurrentSession()?.stepKey, 'title');
  assert.deepEqual(replies.at(-1), {
    message: 'Escriu el titol visible de la compra conjunta.',
    options: {
      replyKeyboard: [['/cancel']],
      resizeKeyboard: true,
      persistentKeyboard: true,
    },
  });
});

test('handleTelegramGroupPurchaseText completes a per-item create flow and saves the purchase', async () => {
  const repository = createRepository();
  const { context, getCurrentSession } = createContext(repository);

  for (const messageText of [
    'Crear compra',
    'Pedido de dados',
    'Compra conjunta',
    'Per unitats',
    '1.25',
    'dado',
    'Ometre',
    'Ometre',
    'Afegir numero',
    'Cantidad',
    'Si',
    'Seguir',
    'Guardar compra',
  ]) {
    context.messageText = messageText;
    await handleTelegramGroupPurchaseText(context);
  }

  assert.equal(getCurrentSession(), null);
  const purchases = await repository.listPurchases();
  assert.equal(purchases.length, 1);
  assert.equal(purchases[0]?.title, 'Pedido de dados');
  assert.equal(purchases[0]?.unitPriceCents, 125);

  const detail = await repository.getPurchaseDetail(purchases[0]!.id);
  assert.equal(detail?.fields[0]?.fieldKey, 'cantidad');
  assert.equal(detail?.fields[0]?.affectsQuantity, true);
});

test('handleTelegramGroupPurchaseCallback starts the participant field flow when joining a purchase', async () => {
  const repository = createRepository();
  const created = await repository.createPurchase({
    title: 'Pedido de dados',
    description: 'Compra conjunta',
    purchaseMode: 'per_item',
    createdByTelegramUserId: 42,
    joinDeadlineAt: null,
    confirmDeadlineAt: '2026-04-30T21:00:00.000Z',
    totalPriceCents: null,
    unitPriceCents: 125,
    unitLabel: 'dado',
    allocationFieldKey: 'quantity',
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
    ],
  });
  const { context, replies, getCurrentSession } = createContext(repository);
  context.callbackData = `group_purchase:join:${created.purchase.id}`;

  const handled = await handleTelegramGroupPurchaseCallback(context);

  assert.equal(handled, true);
  assert.equal(getCurrentSession()?.flowKey, 'group-purchase-participant-fields');
  assert.equal(replies.at(-1)?.message, 'Cantidad');
});

test('participant field flow saves answers and enables self confirmation', async () => {
  const repository = createRepository();
  const created = await repository.createPurchase({
    title: 'Pedido de dados',
    description: 'Compra conjunta',
    purchaseMode: 'per_item',
    createdByTelegramUserId: 42,
    joinDeadlineAt: null,
    confirmDeadlineAt: '2026-04-30T21:00:00.000Z',
    totalPriceCents: null,
    unitPriceCents: 125,
    unitLabel: 'dado',
    allocationFieldKey: 'quantity',
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
    ],
  });
  const { context, getCurrentSession } = createContext(repository);

  context.callbackData = `group_purchase:join:${created.purchase.id}`;
  await handleTelegramGroupPurchaseCallback(context);

  delete context.callbackData;
  context.messageText = '3';
  await handleTelegramGroupPurchaseText(context);

  assert.equal(getCurrentSession(), null);
  const participant = await repository.findParticipant(created.purchase.id, 7);
  assert.equal(participant?.status, 'interested');
  const values = await repository.listParticipantFieldValues(created.purchase.id, 7);
  assert.deepEqual(values.map((value) => value.value), [3]);

  delete context.messageText;
  context.callbackData = `group_purchase:confirm:${created.purchase.id}`;
  await handleTelegramGroupPurchaseCallback(context);

  const confirmed = await repository.findParticipant(created.purchase.id, 7);
  assert.equal(confirmed?.status, 'confirmed');
});

test('participant can reopen the field flow to edit their own answers', async () => {
  const repository = createRepository();
  const created = await repository.createPurchase({
    title: 'Pedido de dados',
    description: 'Compra conjunta',
    purchaseMode: 'per_item',
    createdByTelegramUserId: 42,
    joinDeadlineAt: null,
    confirmDeadlineAt: '2026-04-30T21:00:00.000Z',
    totalPriceCents: null,
    unitPriceCents: 125,
    unitLabel: 'dado',
    allocationFieldKey: 'quantity',
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
    ],
  });
  const { context } = createContext(repository);

  context.callbackData = `group_purchase:join:${created.purchase.id}`;
  await handleTelegramGroupPurchaseCallback(context);
  delete context.callbackData;
  context.messageText = '3';
  await handleTelegramGroupPurchaseText(context);

  delete context.messageText;
  context.callbackData = `group_purchase:edit_values:${created.purchase.id}`;
  await handleTelegramGroupPurchaseCallback(context);
  delete context.callbackData;
  context.messageText = '5';
  await handleTelegramGroupPurchaseText(context);

  const values = await repository.listParticipantFieldValues(created.purchase.id, 7);
  assert.deepEqual(values.map((value) => value.value), [5]);
});

test('participant can leave an active group purchase', async () => {
  const repository = createRepository();
  const created = await repository.createPurchase({
    title: 'Pedido de dados',
    description: 'Compra conjunta',
    purchaseMode: 'per_item',
    createdByTelegramUserId: 42,
    joinDeadlineAt: null,
    confirmDeadlineAt: '2026-04-30T21:00:00.000Z',
    totalPriceCents: null,
    unitPriceCents: 125,
    unitLabel: 'dado',
    allocationFieldKey: 'quantity',
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
    ],
  });
  const { context } = createContext(repository);

  context.callbackData = `group_purchase:join:${created.purchase.id}`;
  await handleTelegramGroupPurchaseCallback(context);
  delete context.callbackData;
  context.messageText = '3';
  await handleTelegramGroupPurchaseText(context);

  delete context.messageText;
  context.callbackData = `group_purchase:leave:${created.purchase.id}`;
  await handleTelegramGroupPurchaseCallback(context);

  const participant = await repository.findParticipant(created.purchase.id, 7);
  assert.equal(participant?.status, 'removed');
});
