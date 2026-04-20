import test from 'node:test';
import assert from 'node:assert/strict';

import type {
  GroupPurchaseDetailRecord,
  GroupPurchaseParticipantRecord,
  GroupPurchaseRecord,
  GroupPurchaseRepository,
} from '../group-purchases/group-purchase-catalog.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import {
  handleTelegramGroupPurchaseCommand,
  handleTelegramGroupPurchaseStartText,
  handleTelegramGroupPurchaseText,
} from './group-purchase-flow.js';

function createRepository(initialPurchases: GroupPurchaseRecord[] = []): GroupPurchaseRepository {
  const purchases = new Map<number, GroupPurchaseRecord>(initialPurchases.map((purchase) => [purchase.id, purchase]));
  const participants = new Map<number, GroupPurchaseParticipantRecord[]>();

  return {
    async createPurchase() {
      throw new Error('not implemented');
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
        fields: [],
        participants: participants.get(purchaseId) ?? [],
      } satisfies GroupPurchaseDetailRecord;
    },
    async findParticipant(purchaseId, participantTelegramUserId) {
      return (participants.get(purchaseId) ?? []).find((participant) => participant.participantTelegramUserId === participantTelegramUserId) ?? null;
    },
    async listParticipants(purchaseId) {
      return participants.get(purchaseId) ?? [];
    },
    async upsertParticipant() {
      throw new Error('not implemented');
    },
  };
}

function createContext(repository: GroupPurchaseRepository): {
  context: TelegramCommandHandlerContext;
  replies: Array<{ message: string; options?: TelegramReplyOptions }>;
} {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];

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
          current: null,
          start: async () => {
            throw new Error('not implemented');
          },
          advance: async () => {
            throw new Error('not implemented');
          },
          cancel: async () => false,
        },
      },
      groupPurchaseRepository: repository,
    } as unknown as TelegramCommandHandlerContext,
    replies,
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
      },
    },
  ]);
});
