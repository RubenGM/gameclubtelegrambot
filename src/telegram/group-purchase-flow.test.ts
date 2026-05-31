import test from 'node:test';
import assert from 'node:assert/strict';

import type { AuditLogEventRecord, AuditLogRepository } from '../audit/audit-log.js';
import type { NewsGroupRecord, NewsGroupRepository, NewsGroupSubscriptionRecord } from '../news/news-group-catalog.js';
import type {
  GroupPurchaseDetailRecord,
  GroupPurchaseFieldRecord,
  GroupPurchaseMessageRecord,
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
import { buildGroupPurchaseDateOptions } from './group-purchase-keyboards.js';

function successButton(text: string) {
  return { text, semanticRole: 'success' as const };
}

function dangerButton(text: string) {
  return { text, semanticRole: 'danger' as const };
}

function createRepository(initialPurchases: GroupPurchaseRecord[] = []): GroupPurchaseRepository {
  const purchases = new Map<number, GroupPurchaseRecord>(initialPurchases.map((purchase) => [purchase.id, purchase]));
  const fields = new Map<number, GroupPurchaseFieldRecord[]>();
  const participants = new Map<string, GroupPurchaseParticipantRecord>();
  const fieldValues = new Map<string, GroupPurchaseParticipantFieldValueRecord[]>();
  const messages = new Map<number, GroupPurchaseMessageRecord[]>();
  const userProfiles = new Map<number, { displayName: string; username: string | null }>([
    [7, { displayName: 'Rubén', username: 'RubenGM' }],
    [42, { displayName: 'Creador', username: 'creator' }],
    [77, { displayName: 'Participant 77', username: 'participant77' }],
    [88, { displayName: 'Participant 88', username: 'participant88' }],
  ]);
  let nextPurchaseId = Math.max(0, ...initialPurchases.map((purchase) => purchase.id)) + 1;
  let nextMessageId = 1;

  return {
    async createPurchase(input) {
      const purchaseId = nextPurchaseId;
      const createdAt = '2026-04-20T10:00:00.000Z';
      const purchase: GroupPurchaseRecord = {
        id: purchaseId,
        title: input.title,
        description: input.description,
        detailsMessageChatId: input.detailsMessageChatId ?? null,
        detailsMessageId: input.detailsMessageId ?? null,
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
    async updatePurchase(input) {
      const existing = purchases.get(input.purchaseId);
      if (!existing) {
        throw new Error(`Group purchase ${input.purchaseId} not found`);
      }
      const next: GroupPurchaseRecord = {
        ...existing,
        title: input.title,
        description: input.description,
        detailsMessageChatId: Object.hasOwn(input, 'detailsMessageChatId') ? input.detailsMessageChatId ?? null : existing.detailsMessageChatId,
        detailsMessageId: Object.hasOwn(input, 'detailsMessageId') ? input.detailsMessageId ?? null : existing.detailsMessageId,
        joinDeadlineAt: input.joinDeadlineAt,
        confirmDeadlineAt: input.confirmDeadlineAt,
        totalPriceCents: input.totalPriceCents,
        unitPriceCents: input.unitPriceCents,
        unitLabel: input.unitLabel,
        allocationFieldKey: input.allocationFieldKey,
        updatedAt: '2026-04-20T15:30:00.000Z',
      };
      purchases.set(next.id, next);
      return next;
    },
    async updatePurchaseLifecycleStatus(input) {
      const existing = purchases.get(input.purchaseId);
      if (!existing) {
        throw new Error(`Group purchase ${input.purchaseId} not found`);
      }
      const next: GroupPurchaseRecord = {
        ...existing,
        lifecycleStatus: input.lifecycleStatus,
        updatedAt: '2026-04-20T15:00:00.000Z',
        cancelledAt: input.lifecycleStatus === 'cancelled' ? '2026-04-20T15:00:00.000Z' : existing.cancelledAt,
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
        participantDisplayName: userProfiles.get(input.participantTelegramUserId)?.displayName ?? `Participant ${input.participantTelegramUserId}`,
        participantUsername: userProfiles.get(input.participantTelegramUserId)?.username ?? null,
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
    async createMessage(input) {
      const message: GroupPurchaseMessageRecord = {
        id: nextMessageId,
        purchaseId: input.purchaseId,
        authorTelegramUserId: input.authorTelegramUserId,
        body: input.body,
        createdAt: '2026-04-20T14:00:00.000Z',
      };
      nextMessageId += 1;
      messages.set(input.purchaseId, [...(messages.get(input.purchaseId) ?? []), message]);
      return message;
    },
  };
}

function createAuditRepository(): AuditLogRepository & { __events: AuditLogEventRecord[] } {
  const events: AuditLogEventRecord[] = [];
  return {
    __events: events,
    async appendEvent(input) {
      events.push({
        actorTelegramUserId: input.actorTelegramUserId,
        actionKey: input.actionKey,
        targetType: input.targetType,
        targetId: input.targetId,
        summary: input.summary,
        details: input.details ?? null,
        createdAt: '2026-04-20T14:30:00.000Z',
      });
    },
  };
}

function createNewsGroupRepository(initialGroups: NewsGroupRecord[] = []): NewsGroupRepository {
  return {
    async findGroupByChatId(chatId) {
      return initialGroups.find((group) => group.chatId === chatId) ?? null;
    },
    async listGroups({ includeDisabled = false } = {}) {
      return includeDisabled ? initialGroups : initialGroups.filter((group) => group.isEnabled);
    },
    async upsertGroup() {
      throw new Error('not implemented');
    },
    async listSubscriptionsByChatId(): Promise<NewsGroupSubscriptionRecord[]> {
      return [];
    },
    async upsertSubscription() {
      throw new Error('not implemented');
    },
    async deleteSubscription() {
      return false;
    },
    async listSubscribedGroupsByCategory() {
      return initialGroups.filter((group) => group.isEnabled).map((group) => ({ ...group, messageThreadId: null }));
    },
    async isNewsEnabledGroup(chatId) {
      return initialGroups.some((group) => group.chatId === chatId && group.isEnabled);
    },
  };
}

function createContext(
  repository: GroupPurchaseRepository,
  {
    auditRepository = createAuditRepository(),
    newsGroupRepository = createNewsGroupRepository(),
    actorTelegramUserId = 7,
    isAdmin = false,
  }: {
    auditRepository?: AuditLogRepository;
    newsGroupRepository?: NewsGroupRepository;
    actorTelegramUserId?: number;
    isAdmin?: boolean;
  } = {},
): {
  context: TelegramCommandHandlerContext;
  replies: Array<{ message: string; options?: TelegramReplyOptions }>;
  privateMessages: Array<{ telegramUserId: number; message: string; options?: TelegramReplyOptions }>;
  groupMessages: Array<{ chatId: number; messageId: number; message: string; options?: TelegramReplyOptions }>;
  forwardedMessages: Array<{ fromChatId: number; messageId: number; toChatId: number }>;
  deletedMessages: Array<{ chatId: number; messageId: number }>;
  getCurrentSession(): ConversationSessionRecord | null;
} {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const privateMessages: Array<{ telegramUserId: number; message: string; options?: TelegramReplyOptions }> = [];
  const groupMessages: Array<{ chatId: number; messageId: number; message: string; options?: TelegramReplyOptions }> = [];
  const forwardedMessages: Array<{ fromChatId: number; messageId: number; toChatId: number }> = [];
  const deletedMessages: Array<{ chatId: number; messageId: number }> = [];
  const metadataRecords = new Map<string, string>();
  let currentSession: ConversationSessionRecord | null = null;
  let nextGroupMessageId = 1000;

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
          sendPrivateMessage: async (telegramUserId: number, message: string, options?: TelegramReplyOptions) => {
            privateMessages.push({ telegramUserId, message, ...(options ? { options } : {}) });
          },
          sendGroupMessage: async (chatId: number, message: string, options?: TelegramReplyOptions) => {
            const messageId = nextGroupMessageId++;
            groupMessages.push({ chatId, messageId, message, ...(options ? { options } : {}) });
            return { messageId };
          },
          forwardMessage: async ({ fromChatId, messageId, toChatId }: { fromChatId: number; messageId: number; toChatId: number }) => {
            forwardedMessages.push({ fromChatId, messageId, toChatId });
            return { messageId: messageId + 1 };
          },
          deleteMessage: async ({ chatId, messageId }: { chatId: number; messageId: number }) => {
            deletedMessages.push({ chatId, messageId });
          },
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
          telegramUserId: actorTelegramUserId,
          status: 'approved',
          isApproved: true,
          isBlocked: false,
          isAdmin,
          permissions: [],
        },
        authorization: {
          authorize: () => ({ allowed: isAdmin, permissionKey: 'group_purchase.manage', reason: isAdmin ? 'admin-override' : 'no-match' }),
          can: () => isAdmin,
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
      groupPurchaseSnapshotStorage: {
        async get(key: string) {
          return metadataRecords.get(key) ?? null;
        },
        async set(key: string, value: string) {
          metadataRecords.set(key, value);
        },
        async delete(key: string) {
          return metadataRecords.delete(key);
        },
        async listByPrefix(prefix: string) {
          return Array.from(metadataRecords.entries())
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, value]) => ({ key, value }));
        },
      },
      auditRepository,
      newsGroupRepository,
    } as unknown as TelegramCommandHandlerContext,
    replies,
    privateMessages,
    groupMessages,
    forwardedMessages,
    deletedMessages,
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
    detailsMessageChatId: null,
    detailsMessageId: null,
    purchaseMode: 'per_item',
    lifecycleStatus: 'open',
    createdByTelegramUserId: 42,
    joinDeadlineAt: '2026-05-30T21:00:00.000Z',
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
      message: 'Compres conjuntes: tria una acció.',
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
      message: 'Compres conjuntes:\n- <a href="https://t.me/cawa_management_bot?start=group_purchase_7"><b>Pedido de dados</b></a> · Oberta · apuntar-se fins 30/05',
      options: {
        parseMode: 'HTML',
        replyKeyboard: [['Veure compres', 'Crear compra'], ['Inici', 'Ajuda']],
        resizeKeyboard: true,
        persistentKeyboard: true,
      },
    },
  ]);
});

test('handleTelegramGroupPurchaseText hides archived purchases from the default list', async () => {
  const { context, replies } = createContext(
    createRepository([
      buildPurchase({ id: 7, lifecycleStatus: 'open' }),
      buildPurchase({ id: 8, title: 'Compra antiga', lifecycleStatus: 'archived' }),
    ]),
  );
  context.messageText = 'Veure compres';

  const handled = await handleTelegramGroupPurchaseText(context);

  assert.equal(handled, true);
  assert.match(replies[0]?.message ?? '', /Pedido de dados/);
  assert.doesNotMatch(replies[0]?.message ?? '', /Compra antiga/);
});

test('handleTelegramGroupPurchaseCommand opens the submenu from the command entry point', async () => {
  const { context, replies } = createContext(createRepository());
  context.messageText = '/group_purchases';

  await handleTelegramGroupPurchaseCommand(context);

  assert.equal(replies[0]?.message, 'Compres conjuntes: tria una acció.');
});

test('handleTelegramGroupPurchaseStartText opens purchase detail from /start payload', async () => {
  const { context, replies } = createContext(createRepository([buildPurchase()]));
  context.messageText = '/start group_purchase_7';

  const handled = await handleTelegramGroupPurchaseStartText(context);

  assert.equal(handled, true);
  assert.deepEqual(replies, [
    {
      message:
        '<a href="https://t.me/cawa_management_bot?start=group_purchase_7"><b>Pedido de dados</b></a>\nMode: Per unitats\nEstat: Oberta\nDescripció: Compra conjunta\nPreu unitari: 1.25 EUR\nUnitat: dado\nApuntar-se fins: 30/05',
      options: {
        parseMode: 'HTML',
        inlineKeyboard: [
          [{ text: 'Apuntar-me com interessat', callbackData: 'group_purchase:join_interested:7' }],
          [{ text: 'Apuntar-me i confirmar', callbackData: 'group_purchase:join_confirmed:7' }],
        ],
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
    message: 'Escriu el títol visible de la compra conjunta.',
    options: {
      replyKeyboard: [[dangerButton('/cancel')]],
      resizeKeyboard: true,
      persistentKeyboard: true,
    },
  });
});

test('per-item create flow explains the visible unit with examples', async () => {
  const { context, replies } = createContext(createRepository());

  for (const messageText of ['Crear compra', 'Pedido de dados', 'Compra conjunta', 'Per unitats', '1.25']) {
    context.messageText = messageText;
    await handleTelegramGroupPurchaseText(context);
  }

  assert.deepEqual(replies.at(-1), {
    message: 'Escriu la unitat visible o tria Ometre. Exemples: dado, camiseta, sudadera.',
    options: {
      replyKeyboard: [[successButton('Ometre')], [dangerButton('/cancel')]],
      resizeKeyboard: true,
      persistentKeyboard: true,
    },
  });
});

test('create flow shows upcoming date shortcuts for join and confirm deadlines', async () => {
  const { context, replies } = createContext(createRepository());
  const expectedDateOptions = buildGroupPurchaseDateOptions('ca');

  for (const messageText of ['Crear compra', 'Pedido de dados', 'Compra conjunta', 'Per unitats', '1.25', 'dado']) {
    context.messageText = messageText;
    await handleTelegramGroupPurchaseText(context);
  }

  assert.deepEqual(replies.at(-1)?.options, expectedDateOptions);

  context.messageText = 'Dimarts, 05/05/2026';
  await handleTelegramGroupPurchaseText(context);

  assert.deepEqual(replies.at(-1)?.options, expectedDateOptions);
});

test('shared-cost create flow also shows upcoming date shortcuts for the join deadline', async () => {
  const { context, replies } = createContext(createRepository());

  for (const messageText of ['Crear compra', 'Juego conjunto', 'Compra compartida', 'Cost compartit', '50']) {
    context.messageText = messageText;
    await handleTelegramGroupPurchaseText(context);
  }

  assert.deepEqual(replies.at(-1)?.options, buildGroupPurchaseDateOptions('ca'));
});

test('create flow shows a summary before saving the purchase', async () => {
  const repository = createRepository();
  const { context, replies } = createContext(repository);

  for (const messageText of [
    'Crear compra',
    'Pedido de dados',
    'Compra conjunta',
    'Per unitats',
    '1.25',
    'dado',
    'Ometre',
    'Ometre',
    'Afegir número',
    'Cantidad',
    'Sí',
    'Seguir',
  ]) {
    context.messageText = messageText;
    await handleTelegramGroupPurchaseText(context);
  }

  assert.deepEqual(replies.at(-1), {
    message:
      'Revisa el resum abans de guardar:\n\nTitol: Pedido de dados\nDescripció: Compra conjunta\nMode: Per unitats\nPreu unitari: 1.25 EUR\nUnitat visible: dado\nData limit per apuntar-se: Sense data limit\nData limit per confirmar-se: Sense data limit\nCamps:\n- Cantidad (número, quantitat)',
    options: {
      replyKeyboard: [[successButton('Guardar compra')], [dangerButton('/cancel')]],
      resizeKeyboard: true,
      persistentKeyboard: true,
    },
  });
});

test('create flow does not let per-item purchases continue without a quantity field', async () => {
  const { context, replies, getCurrentSession } = createContext(createRepository());

  for (const messageText of [
    'Crear compra',
    'Pedido de dados',
    'Compra conjunta',
    'Per unitats',
    '1.25',
    'dado',
    'Ometre',
    'Ometre',
    'Afegir número',
    'Color',
    'No',
    'Seguir',
  ]) {
    context.messageText = messageText;
    await handleTelegramGroupPurchaseText(context);
  }

  assert.equal(getCurrentSession()?.stepKey, 'field-menu');
  assert.equal(replies.at(-1)?.message, 'En les compres per unitats cal un camp numèric que indiqui quantes unitats vol cada persona.');
});

test('shared-cost create flow can skip configurable fields and save directly', async () => {
  const repository = createRepository();
  const newsGroupRepository = createNewsGroupRepository([
    {
      chatId: -200,
      isEnabled: true,
      metadata: null,
      createdAt: '2026-04-20T10:00:00.000Z',
      updatedAt: '2026-04-20T10:00:00.000Z',
      enabledAt: '2026-04-20T10:00:00.000Z',
      disabledAt: null,
    },
  ]);
  const { context, getCurrentSession, groupMessages } = createContext(repository, { newsGroupRepository });

  for (const messageText of ['Crear compra', 'Juego conjunto', 'Compra compartida', 'Cost compartit', '50', 'Ometre', 'Ometre', 'Seguir', 'Guardar compra']) {
    context.messageText = messageText;
    await handleTelegramGroupPurchaseText(context);
  }

  assert.equal(getCurrentSession(), null);
  const purchases = await repository.listPurchases();
  assert.equal(purchases.length, 1);
  assert.equal(purchases[0]?.purchaseMode, 'shared_cost');
  assert.equal(groupMessages.length, 1);
  assert.equal(groupMessages[0]?.chatId, -200);
  assert.match(groupMessages[0]?.message ?? '', /Nueva compra conjunta disponible/);
  assert.match(groupMessages[0]?.message ?? '', /Juego conjunto/);
  assert.match(groupMessages[0]?.message ?? '', /Coste total: 50,00€/);
  assert.match(groupMessages[0]?.message ?? '', /Usuarios confirmados actualmente: 0/);
});

test('create flow stores a rich description message and publishes the open-description link', async () => {
  const repository = createRepository();
  const newsGroupRepository = createNewsGroupRepository([
    {
      chatId: -200,
      isEnabled: true,
      metadata: null,
      createdAt: '2026-04-20T10:00:00.000Z',
      updatedAt: '2026-04-20T10:00:00.000Z',
      enabledAt: '2026-04-20T10:00:00.000Z',
      disabledAt: null,
    },
  ]);
  const { context, groupMessages, forwardedMessages } = createContext(repository, { newsGroupRepository });

  context.messageText = 'Crear compra';
  await handleTelegramGroupPurchaseText(context);
  context.messageText = 'Tapetes personalizados';
  await handleTelegramGroupPurchaseText(context);
  delete context.messageText;
  context.messageId = 501;
  context.messageMedia = {
    attachmentKind: 'photo',
    fileId: 'photo-1',
    fileUniqueId: 'photo-u1',
    caption: 'Tapete con imagen de ejemplo',
    originalFileName: null,
    mimeType: null,
    fileSizeBytes: null,
    mediaGroupId: null,
    messageId: 501,
  };
  await handleTelegramGroupPurchaseText(context);
  delete context.messageMedia;

  for (const messageText of ['Cost compartit', '50', 'Ometre', 'Ometre', 'Seguir', 'Guardar compra']) {
    context.messageText = messageText;
    await handleTelegramGroupPurchaseText(context);
  }

  const purchases = await repository.listPurchases();
  assert.equal(purchases[0]?.description, 'Tapete con imagen de ejemplo');
  assert.equal(purchases[0]?.detailsMessageChatId, 1);
  assert.equal(purchases[0]?.detailsMessageId, 501);
  assert.doesNotMatch(groupMessages[0]?.message ?? '', /start=group_purchase_details_1/);
  assert.doesNotMatch(groupMessages[0]?.message ?? '', /Tapete con imagen de ejemplo/);
  assert.deepEqual(groupMessages[0]?.options?.inlineKeyboard, [
    [{ text: 'Detalle de compra conjunta', url: 'https://t.me/cawa_management_bot?start=group_purchase_1' }],
    [{ text: 'Descripción', url: 'https://t.me/cawa_management_bot?start=group_purchase_details_1' }],
    [{ text: 'Participar', url: 'https://t.me/cawa_management_bot?start=group_purchase_join_1' }],
  ]);

  context.messageText = '/start group_purchase_details_1';
  await handleTelegramGroupPurchaseStartText(context);

  assert.deepEqual(forwardedMessages, [{ fromChatId: 1, messageId: 501, toChatId: 1 }]);
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
    'Afegir número',
    'Cantidad',
    'Sí',
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
    confirmDeadlineAt: '2026-06-30T21:00:00.000Z',
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
    confirmDeadlineAt: '2026-06-30T21:00:00.000Z',
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

test('participant can join as confirmed and still complete required field answers', async () => {
  const repository = createRepository();
  const created = await repository.createPurchase({
    title: 'Pedido de dados',
    description: 'Compra conjunta',
    purchaseMode: 'per_item',
    createdByTelegramUserId: 42,
    joinDeadlineAt: null,
    confirmDeadlineAt: '2026-06-30T21:00:00.000Z',
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

  context.callbackData = `group_purchase:join_confirmed:${created.purchase.id}`;
  await handleTelegramGroupPurchaseCallback(context);

  delete context.callbackData;
  context.messageText = '10';
  await handleTelegramGroupPurchaseText(context);

  assert.equal(getCurrentSession(), null);
  const participant = await repository.findParticipant(created.purchase.id, 7);
  assert.equal(participant?.status, 'confirmed');
  const values = await repository.listParticipantFieldValues(created.purchase.id, 7);
  assert.deepEqual(values.map((value) => value.value), [10]);
});

test('participant can reopen the field flow to edit their own answers', async () => {
  const repository = createRepository();
  const created = await repository.createPurchase({
    title: 'Pedido de dados',
    description: 'Compra conjunta',
    purchaseMode: 'per_item',
    createdByTelegramUserId: 42,
    joinDeadlineAt: null,
    confirmDeadlineAt: '2026-06-30T21:00:00.000Z',
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
    confirmDeadlineAt: '2026-06-30T21:00:00.000Z',
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

test('creator detail view exposes participant management actions', async () => {
  const repository = createRepository([buildPurchase({ createdByTelegramUserId: 7 })]);
  const { context, replies } = createContext(repository);
  context.messageText = '/start group_purchase_7';

  await handleTelegramGroupPurchaseStartText(context);

  assert.deepEqual(replies[0]?.options?.inlineKeyboard, [
    [{ text: 'Apuntar-me com interessat', callbackData: 'group_purchase:join_interested:7' }],
    [{ text: 'Apuntar-me i confirmar', callbackData: 'group_purchase:join_confirmed:7' }],
    [{ text: 'Editar compra', callbackData: 'group_purchase:edit_purchase:7' }],
    [{ text: 'Editar descripció', callbackData: 'group_purchase:edit_description:7' }],
    [{ text: 'Gestionar participants', callbackData: 'group_purchase:manage_participants:7' }],
    [{ text: 'Cerrar compra', callbackData: 'group_purchase:lifecycle:7:closed' }, { text: 'Cancelar compra', callbackData: 'group_purchase:lifecycle:7:cancelled' }, { text: 'Archivar', callbackData: 'group_purchase:lifecycle:7:archived' }],
  ]);
});

test('participant without custom fields does not see the no-op edit values action', async () => {
  const repository = createRepository([buildPurchase({ id: 58 })]);
  await repository.upsertParticipant({ purchaseId: 58, participantTelegramUserId: 7, status: 'interested' });
  const { context, replies } = createContext(repository);
  context.messageText = '/start group_purchase_58';

  await handleTelegramGroupPurchaseStartText(context);

  assert.deepEqual(replies[0]?.options?.inlineKeyboard, [
    [{ text: 'Desapuntar-me', callbackData: 'group_purchase:leave:58' }],
    [{ text: 'Confirmar-me', callbackData: 'group_purchase:confirm:58' }],
  ]);
});

test('group purchase join deep link asks privately whether to confirm now', async () => {
  const repository = createRepository([buildPurchase({
    id: 59,
    title: 'Harmonies',
    purchaseMode: 'shared_cost',
    totalPriceCents: 4000,
    unitPriceCents: null,
    unitLabel: null,
  })]);
  const { context, replies } = createContext(repository);
  context.messageText = '/start group_purchase_join_59';

  await handleTelegramGroupPurchaseStartText(context);

  assert.match(replies[0]?.message ?? '', /Harmonies/);
  assert.match(replies[0]?.message ?? '', /confirmar tu participación ahora/);
  assert.deepEqual(replies[0]?.options?.inlineKeyboard, [
    [{ text: 'Confirmarme ahora', callbackData: 'group_purchase:join_confirmed:59' }],
    [{ text: 'Apuntarme sin confirmar', callbackData: 'group_purchase:join_interested:59' }],
    [{ text: 'Ver detalle', url: 'https://t.me/cawa_management_bot?start=group_purchase_59' }],
  ]);
});

test('creator can join their own shared-cost purchase without answering extra fields', async () => {
  const repository = createRepository();
  const created = await repository.createPurchase({
    title: 'Juego conjunto',
    description: 'Compra compartida',
    purchaseMode: 'shared_cost',
    createdByTelegramUserId: 7,
    joinDeadlineAt: null,
    confirmDeadlineAt: null,
    totalPriceCents: 5000,
    unitPriceCents: null,
    unitLabel: null,
    allocationFieldKey: null,
    fields: [],
  });
  const { context, getCurrentSession } = createContext(repository);

  context.callbackData = `group_purchase:join_interested:${created.purchase.id}`;
  await handleTelegramGroupPurchaseCallback(context);

  assert.equal(getCurrentSession(), null);
  const participant = await repository.findParticipant(created.purchase.id, 7);
  assert.equal(participant?.status, 'interested');
});

test('participant can join directly as confirmed when the purchase is open', async () => {
  const repository = createRepository();
  const created = await repository.createPurchase({
    title: 'Juego conjunto',
    description: 'Compra compartida',
    purchaseMode: 'shared_cost',
    createdByTelegramUserId: 42,
    joinDeadlineAt: null,
    confirmDeadlineAt: '2026-06-30T21:00:00.000Z',
    totalPriceCents: 5000,
    unitPriceCents: null,
    unitLabel: null,
    allocationFieldKey: null,
    fields: [],
  });
  const { context } = createContext(repository);

  context.callbackData = `group_purchase:join_confirmed:${created.purchase.id}`;
  await handleTelegramGroupPurchaseCallback(context);

  const participant = await repository.findParticipant(created.purchase.id, 7);
  assert.equal(participant?.status, 'confirmed');
});

test('creator can edit purchase title and description', async () => {
  const repository = createRepository([buildPurchase({ id: 51, createdByTelegramUserId: 7, description: 'Compra conjunta' })]);
  const auditRepository = createAuditRepository();
  const { context, getCurrentSession } = createContext(repository, { auditRepository });

  context.callbackData = 'group_purchase:edit_purchase:51';
  await handleTelegramGroupPurchaseCallback(context);

  assert.equal(getCurrentSession()?.flowKey, 'group-purchase-edit');
  assert.equal(getCurrentSession()?.stepKey, 'title');

  delete context.callbackData;
  context.messageText = 'Pedido de dados premium';
  await handleTelegramGroupPurchaseText(context);
  context.messageText = 'Nueva descripcion';
  await handleTelegramGroupPurchaseText(context);

  const purchase = await repository.findPurchaseById(51);
  assert.equal(purchase?.title, 'Pedido de dados premium');
  assert.equal(purchase?.description, 'Nueva descripcion');
  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'group_purchase.updated');
});

test('editing a purchase publishes the updated summary with its description link', async () => {
  const repository = createRepository([buildPurchase({
    id: 52,
    createdByTelegramUserId: 7,
    purchaseMode: 'shared_cost',
    detailsMessageChatId: 1,
    detailsMessageId: 555,
    totalPriceCents: 6000,
    unitPriceCents: null,
    unitLabel: null,
  })]);
  const newsGroupRepository = createNewsGroupRepository([
    {
      chatId: -200,
      isEnabled: true,
      metadata: null,
      createdAt: '2026-04-20T10:00:00.000Z',
      updatedAt: '2026-04-20T10:00:00.000Z',
      enabledAt: '2026-04-20T10:00:00.000Z',
      disabledAt: null,
    },
  ]);
  const { context, groupMessages, deletedMessages } = createContext(repository, { newsGroupRepository });

  context.callbackData = 'group_purchase:edit_purchase:52';
  await handleTelegramGroupPurchaseCallback(context);
  delete context.callbackData;
  context.messageText = 'Tapetes premium';
  await handleTelegramGroupPurchaseText(context);
  context.messageId = 777;
  context.messageText = 'Nueva descripcion con foto';
  await handleTelegramGroupPurchaseText(context);

  const purchase = await repository.findPurchaseById(52);
  assert.equal(purchase?.description, 'Nueva descripcion con foto');
  assert.equal(purchase?.detailsMessageId, 777);
  assert.deepEqual(deletedMessages, [{ chatId: 1, messageId: 555 }]);
  assert.equal(groupMessages.length, 1);
  assert.match(groupMessages[0]?.message ?? '', /Compra conjunta actualizada/);
  assert.doesNotMatch(groupMessages[0]?.message ?? '', /Nueva compra conjunta disponible/);
  assert.match(groupMessages[0]?.message ?? '', /Tapetes premium/);
  assert.doesNotMatch(groupMessages[0]?.message ?? '', /start=group_purchase_details_52/);
  assert.doesNotMatch(groupMessages[0]?.message ?? '', /Nueva descripcion con foto/);
  assert.deepEqual(groupMessages[0]?.options?.inlineKeyboard, [
    [{ text: 'Detalle de compra conjunta', url: 'https://t.me/cawa_management_bot?start=group_purchase_52' }],
    [{ text: 'Descripción', url: 'https://t.me/cawa_management_bot?start=group_purchase_details_52' }],
    [{ text: 'Participar', url: 'https://t.me/cawa_management_bot?start=group_purchase_join_52' }],
  ]);
});

test('creator can edit only the purchase description from the detail action', async () => {
  const repository = createRepository([buildPurchase({
    id: 54,
    title: 'Tapetes',
    createdByTelegramUserId: 7,
    description: 'Descripcion anterior',
    detailsMessageChatId: 1,
    detailsMessageId: 700,
  })]);
  const { context, deletedMessages } = createContext(repository);

  context.callbackData = 'group_purchase:edit_description:54';
  await handleTelegramGroupPurchaseCallback(context);
  delete context.callbackData;
  context.messageId = 701;
  context.messageText = 'Descripcion nueva';
  await handleTelegramGroupPurchaseText(context);

  const purchase = await repository.findPurchaseById(54);
  assert.equal(purchase?.title, 'Tapetes');
  assert.equal(purchase?.description, 'Descripcion nueva');
  assert.equal(purchase?.detailsMessageId, 701);
  assert.deepEqual(deletedMessages, [{ chatId: 1, messageId: 700 }]);
});

test('clearing a purchase description deletes the previous details message', async () => {
  const repository = createRepository([buildPurchase({
    id: 53,
    createdByTelegramUserId: 7,
    description: 'Descripcion anterior',
    detailsMessageChatId: 1,
    detailsMessageId: 600,
  })]);
  const { context, deletedMessages } = createContext(repository);

  context.callbackData = 'group_purchase:edit_purchase:53';
  await handleTelegramGroupPurchaseCallback(context);
  delete context.callbackData;
  context.messageText = 'Pedido sin descripcion';
  await handleTelegramGroupPurchaseText(context);
  context.messageText = 'Ometre';
  await handleTelegramGroupPurchaseText(context);

  const purchase = await repository.findPurchaseById(53);
  assert.equal(purchase?.description, null);
  assert.equal(purchase?.detailsMessageChatId, null);
  assert.equal(purchase?.detailsMessageId, null);
  assert.deepEqual(deletedMessages, [{ chatId: 1, messageId: 600 }]);
});

test('creator can mark a participant as paid from the management callbacks', async () => {
  const repository = createRepository([buildPurchase({ id: 21, createdByTelegramUserId: 7 })]);
  await repository.upsertParticipant({ purchaseId: 21, participantTelegramUserId: 77, status: 'confirmed' });
  const { context } = createContext(repository);

  context.callbackData = 'group_purchase:participant_status:21:77:paid';
  await handleTelegramGroupPurchaseCallback(context);

  const participant = await repository.findParticipant(21, 77);
  assert.equal(participant?.status, 'paid');
});

test('participant management message shows display name and captured values', async () => {
  const repository = createRepository([buildPurchase({ id: 22, createdByTelegramUserId: 7 })]);
  const created = await repository.createPurchase({
    title: 'Pedido de dados',
    description: 'Compra conjunta',
    purchaseMode: 'per_item',
    createdByTelegramUserId: 7,
    joinDeadlineAt: null,
    confirmDeadlineAt: null,
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
  await repository.upsertParticipant({ purchaseId: created.purchase.id, participantTelegramUserId: 77, status: 'interested' });
  await repository.replaceParticipantFieldValues({
    purchaseId: created.purchase.id,
    participantTelegramUserId: 77,
    values: [{ fieldId: 1, value: 3 }],
  });
  const { context, replies } = createContext(repository);

  context.callbackData = `group_purchase:manage_participants:${created.purchase.id}`;
  await handleTelegramGroupPurchaseCallback(context);

  assert.match(replies.at(-1)?.message ?? '', new RegExp(`https://t\\.me/cawa_management_bot\\?start=group_purchase_participant_${created.purchase.id}_77`));
  assert.match(replies.at(-1)?.message ?? '', /Participant 77/);
  assert.match(replies.at(-1)?.message ?? '', /Cantidad: 3/);
  assert.equal(replies.at(-1)?.options?.parseMode, 'HTML');
  assert.equal(replies.at(-1)?.options?.inlineKeyboard, undefined);
});

test('participant detail opened by deep link exposes direct paid and delivered actions', async () => {
  const repository = createRepository([buildPurchase({ id: 24, createdByTelegramUserId: 7 })]);
  await repository.upsertParticipant({ purchaseId: 24, participantTelegramUserId: 77, status: 'confirmed' });
  const { context, replies } = createContext(repository);

  context.messageText = '/start group_purchase_participant_24_77';
  await handleTelegramGroupPurchaseStartText(context);

  assert.match(replies.at(-1)?.message ?? '', /Participant 77/);
  assert.deepEqual(replies.at(-1)?.options?.inlineKeyboard, [
    [
      { text: 'Interessat: Participant 77', callbackData: 'group_purchase:participant_status:24:77:interested' },
      { text: 'Confirmat: Participant 77', callbackData: 'group_purchase:participant_status:24:77:confirmed' },
    ],
    [
      { text: 'Pagat: Participant 77', callbackData: 'group_purchase:participant_status:24:77:paid' },
      { text: 'Entregat: Participant 77', callbackData: 'group_purchase:participant_status:24:77:delivered' },
    ],
  ]);
});

test('participant status change returns to the participant management list with the updated status', async () => {
  const repository = createRepository([buildPurchase({ id: 25, createdByTelegramUserId: 7 })]);
  await repository.upsertParticipant({ purchaseId: 25, participantTelegramUserId: 77, status: 'confirmed' });
  const { context, replies } = createContext(repository);

  context.callbackData = 'group_purchase:participant_status:25:77:paid';
  await handleTelegramGroupPurchaseCallback(context);

  assert.match(replies.at(-1)?.message ?? '', /paid/i);
  assert.match(replies.at(-1)?.message ?? '', /Participants:/);
  assert.match(replies.at(-1)?.message ?? '', /Participant 77/);
  assert.equal(replies.at(-1)?.options?.inlineKeyboard, undefined);
});

test('shared-cost participant changes are published to enabled notification groups', async () => {
  const repository = createRepository([buildPurchase({
    id: 61,
    title: 'Juego conjunto',
    purchaseMode: 'shared_cost',
    createdByTelegramUserId: 42,
    joinDeadlineAt: null,
    confirmDeadlineAt: '2026-06-30T21:00:00.000Z',
    totalPriceCents: 5000,
    unitPriceCents: null,
    unitLabel: null,
  })]);
  const newsGroupRepository = createNewsGroupRepository([
    {
      chatId: -200,
      isEnabled: true,
      metadata: null,
      createdAt: '2026-04-20T10:00:00.000Z',
      updatedAt: '2026-04-20T10:00:00.000Z',
      enabledAt: '2026-04-20T10:00:00.000Z',
      disabledAt: null,
    },
  ]);
  const { context, groupMessages, deletedMessages } = createContext(repository, { newsGroupRepository });

  context.callbackData = 'group_purchase:join_interested:61';
  await handleTelegramGroupPurchaseCallback(context);
  context.callbackData = 'group_purchase:confirm:61';
  await handleTelegramGroupPurchaseCallback(context);
  context.callbackData = 'group_purchase:leave:61';
  await handleTelegramGroupPurchaseCallback(context);

  assert.equal(groupMessages.length, 3);
  assert.match(groupMessages[0]?.message ?? '', /Rubén se ha apuntado, a falta de confirmación/);
  assert.match(groupMessages[0]?.message ?? '', /Coste total: 50,00€/);
  assert.match(groupMessages[0]?.message ?? '', /Coste actual por persona: pendiente de confirmaciones/);
  assert.match(groupMessages[1]?.message ?? '', /Rubén ha confirmado su participación/);
  assert.match(groupMessages[1]?.message ?? '', /Coste total: 50,00€/);
  assert.match(groupMessages[1]?.message ?? '', /Coste actual por persona: 50,00€/);
  assert.match(groupMessages[1]?.message ?? '', /Usuarios confirmados actualmente: 1/);
  assert.deepEqual(groupMessages[1]?.options?.inlineKeyboard, [
    [{ text: 'Detalle de compra conjunta', url: 'https://t.me/cawa_management_bot?start=group_purchase_61' }],
    [{ text: 'Participar', url: 'https://t.me/cawa_management_bot?start=group_purchase_join_61' }],
  ]);
  assert.match(groupMessages[2]?.message ?? '', /Rubén se ha echado atrás/);
  assert.match(groupMessages[2]?.message ?? '', /Usuarios confirmados actualmente: 0/);
  assert.deepEqual(deletedMessages, [
    { chatId: -200, messageId: 1000 },
    { chatId: -200, messageId: 1001 },
  ]);
});

test('creator can close a purchase and leaves an audit trail', async () => {
  const repository = createRepository([buildPurchase({ id: 41, createdByTelegramUserId: 7 })]);
  const auditRepository = createAuditRepository();
  const { context } = createContext(repository, { auditRepository });

  context.callbackData = 'group_purchase:lifecycle:41:closed';
  await handleTelegramGroupPurchaseCallback(context);

  const purchase = await repository.findPurchaseById(41);
  assert.equal(purchase?.lifecycleStatus, 'closed');
  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'group_purchase.closed');
});

test('creator archiving a purchase returns to the group purchase submenu instead of reopening the detail', async () => {
  const repository = createRepository([buildPurchase({ id: 43, createdByTelegramUserId: 7 })]);
  const { context, replies } = createContext(repository);

  context.callbackData = 'group_purchase:lifecycle:43:archived';
  await handleTelegramGroupPurchaseCallback(context);

  assert.deepEqual(replies.at(-1), {
    message: 'Compres conjuntes: tria una acció.',
    options: {
      replyKeyboard: [['Veure compres', 'Crear compra'], ['Inici', 'Ajuda']],
      resizeKeyboard: true,
      persistentKeyboard: true,
    },
  });
});

test('manager status change notifies the affected participant privately', async () => {
  const repository = createRepository([buildPurchase({ id: 42, createdByTelegramUserId: 7 })]);
  await repository.upsertParticipant({ purchaseId: 42, participantTelegramUserId: 77, status: 'confirmed' });
  const auditRepository = createAuditRepository();
  const { context, privateMessages } = createContext(repository, { auditRepository });

  context.callbackData = 'group_purchase:participant_status:42:77:paid';
  await handleTelegramGroupPurchaseCallback(context);

  assert.equal(privateMessages.at(-1)?.telegramUserId, 77);
  assert.match(privateMessages.at(-1)?.message ?? '', /paid/i);
  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'group_purchase.participant_status_changed');
});
