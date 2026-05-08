import test from 'node:test';
import assert from 'node:assert/strict';

import type { CatalogItemRecord, CatalogLoanRecord, CatalogLoanRepository, CatalogRepository } from '../catalog/catalog-model.js';
import type { ConversationSessionRecord } from './conversation-session.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import type { NewsGroupRecord, NewsGroupRepository } from '../news/news-group-catalog.js';
import {
  catalogLoanCallbackPrefixes,
  buildLoanDetailButtons,
  buildLoanItemButton,
  handleTelegramCatalogLoanCallback,
  handleTelegramCatalogLoanText,
} from './catalog-loan-flow.js';

function createCatalogRepository(items: CatalogItemRecord[]): CatalogRepository {
  const itemMap = new Map(items.map((item) => [item.id, item]));

  return {
    async createFamily() { throw new Error('not implemented'); },
    async findFamilyById() { return null; },
    async listFamilies() { return []; },
    async createGroup() { throw new Error('not implemented'); },
    async findGroupById() { return null; },
    async listGroups() { return []; },
    async createItem() { throw new Error('not implemented'); },
    async findItemById(itemId) { return itemMap.get(itemId) ?? null; },
    async listItems() { return Array.from(itemMap.values()); },
    async updateItem() { throw new Error('not implemented'); },
    async deactivateItem() { throw new Error('not implemented'); },
    async createMedia() { throw new Error('not implemented'); },
    async listMedia() { return []; },
    async updateMedia() { throw new Error('not implemented'); },
    async deleteMedia() { return false; },
  };
}

function createLoanRepository(initialLoans: CatalogLoanRecord[] = []): CatalogLoanRepository {
  const loans = new Map(initialLoans.map((loan) => [loan.id, loan]));
  let nextLoanId = Math.max(0, ...initialLoans.map((loan) => loan.id)) + 1;

  return {
    async createLoan(input) {
      const active = Array.from(loans.values()).find((loan) => loan.itemId === input.itemId && loan.returnedAt === null);
      if (active) {
        throw new Error('Aquest item ja esta prestat.');
      }

      const loan: CatalogLoanRecord = {
        id: nextLoanId,
        itemId: input.itemId,
        borrowerTelegramUserId: input.borrowerTelegramUserId,
        borrowerDisplayName: input.borrowerDisplayName,
        loanedByTelegramUserId: input.loanedByTelegramUserId,
        dueAt: input.dueAt,
        notes: input.notes,
        returnedAt: null,
        returnedByTelegramUserId: null,
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      };
      nextLoanId += 1;
      loans.set(loan.id, loan);
      return loan;
    },
    async findLoanById(loanId) {
      return loans.get(loanId) ?? null;
    },
    async findActiveLoanByItemId(itemId) {
      return Array.from(loans.values()).find((loan) => loan.itemId === itemId && loan.returnedAt === null) ?? null;
    },
    async listActiveLoansByBorrower(borrowerTelegramUserId) {
      return Array.from(loans.values()).filter((loan) => loan.borrowerTelegramUserId === borrowerTelegramUserId && loan.returnedAt === null);
    },
    async listLoansByItem(itemId) {
      return Array.from(loans.values()).filter((loan) => loan.itemId === itemId);
    },
    async updateLoan(input) {
      const existing = loans.get(input.loanId);
      if (!existing) {
        throw new Error(`Catalog loan ${input.loanId} not found`);
      }
      const next: CatalogLoanRecord = {
        ...existing,
        dueAt: input.dueAt,
        notes: input.notes,
        updatedAt: '2026-04-04T11:00:00.000Z',
      };
      loans.set(next.id, next);
      return next;
    },
    async closeLoan(input) {
      const existing = loans.get(input.loanId);
      if (!existing) {
        throw new Error(`Catalog loan ${input.loanId} not found`);
      }
      const next: CatalogLoanRecord = {
        ...existing,
        returnedAt: '2026-04-04T12:00:00.000Z',
        returnedByTelegramUserId: input.returnedByTelegramUserId,
        updatedAt: '2026-04-04T12:00:00.000Z',
      };
      loans.set(next.id, next);
      return next;
    },
  };
}

function createContext({
  catalogRepository,
  catalogLoanRepository,
  loanSession = null,
  newsGroupRepository = createNewsGroupRepository(),
}: {
  catalogRepository: CatalogRepository;
  catalogLoanRepository: CatalogLoanRepository;
  loanSession?: ConversationSessionRecord | null;
  newsGroupRepository?: NewsGroupRepository;
}): {
  context: TelegramCommandHandlerContext;
  replies: Array<{ message: string; options?: TelegramReplyOptions }>;
  groupMessages: Array<{ chatId: number; message: string; options?: TelegramReplyOptions }>;
} {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  let current = loanSession;
  const groupMessages: Array<{ chatId: number; message: string; options?: TelegramReplyOptions }> = [];

  return {
    context: {
      reply: async (message: string, options?: TelegramReplyOptions) => {
        replies.push({ message, ...(options ? { options } : {}) });
      },
      runtime: {
        bot: {
          publicName: 'Game Club Bot',
          clubName: 'Game Club',
          sendPrivateMessage: async () => {},
          sendGroupMessage: async (chatId: number, message: string, options?: TelegramReplyOptions) => {
            groupMessages.push({ chatId, message, ...(options ? { options } : {}) });
          },
        },
        services: { database: { db: undefined as never } } as never,
        chat: { kind: 'private', chatId: 1 },
        actor: {
          telegramUserId: 7,
          status: 'approved',
          isApproved: true,
          isBlocked: false,
          isAdmin: false,
          permissions: [],
        },
        authorization: {
          authorize: () => ({ allowed: false, permissionKey: 'catalog.loan', reason: 'no-match' }),
          can: () => false,
        },
        session: {
          get current() {
            return current;
          },
          start: async ({ flowKey, stepKey, data = {} }: { flowKey: string; stepKey: string; data?: Record<string, unknown> }) => {
            current = {
              key: 'telegram.session:1:7',
              flowKey,
              stepKey,
              data,
              createdAt: '2026-04-04T10:00:00.000Z',
              updatedAt: '2026-04-04T10:00:00.000Z',
              expiresAt: '2026-04-05T10:00:00.000Z',
            };
            return current;
          },
          advance: async ({ stepKey, data }: { stepKey: string; data: Record<string, unknown> }) => {
            if (!current) {
              throw new Error('no session');
            }
            current = { ...current, stepKey, data, updatedAt: '2026-04-04T11:00:00.000Z' };
            return current;
          },
          cancel: async () => {
            current = null;
            return true;
          },
        },
        },
      catalogRepository,
      catalogLoanRepository,
      newsGroupRepository,
    } as unknown as TelegramCommandHandlerContext,
    replies,
    groupMessages,
  };
}

function createNewsGroupRepository(
  initialGroups: NewsGroupRecord[] = [],
  subscribedGroupsByCategory: Map<string, Set<number>> = new Map(),
): NewsGroupRepository {
  const groups = new Map(initialGroups.map((group) => [group.chatId, group]));

  return {
    async findGroupByChatId(chatId) {
      return groups.get(chatId) ?? null;
    },
    async listGroups({ includeDisabled } = {}) {
      return Array.from(groups.values()).filter((group) => includeDisabled || group.isEnabled);
    },
    async upsertGroup(input) {
      const now = '2026-04-04T10:00:00.000Z';
      const next = {
        chatId: input.chatId,
        isEnabled: input.isEnabled,
        metadata: input.metadata ?? null,
        createdAt: groups.get(input.chatId)?.createdAt ?? now,
        updatedAt: now,
        enabledAt: input.isEnabled ? now : null,
        disabledAt: input.isEnabled ? null : now,
      };
      groups.set(next.chatId, next);
      return next;
    },
    async listSubscriptionsByChatId(chatId) {
      return Array.from(subscriptionsForChat(chatId, subscribedGroupsByCategory)).map((categoryKey) => ({
        chatId,
        categoryKey,
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      }));
    },
    async upsertSubscription(input) {
      const next = new Set(subscribedGroupsByCategory.get(input.categoryKey) ?? []);
      next.add(input.chatId);
      subscribedGroupsByCategory.set(input.categoryKey, next);
      return {
        chatId: input.chatId,
        categoryKey: input.categoryKey,
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      };
    },
    async deleteSubscription(input) {
      const subscriptions = new Set(subscribedGroupsByCategory.get(input.categoryKey) ?? []);
      const deleted = subscriptions.delete(input.chatId);
      if (subscriptions.size === 0) {
        subscribedGroupsByCategory.delete(input.categoryKey);
      } else {
        subscribedGroupsByCategory.set(input.categoryKey, subscriptions);
      }
      return deleted;
    },
    async listSubscribedGroupsByCategory(categoryKey) {
      const chatIds = subscribedGroupsByCategory.get(categoryKey) ?? new Set<number>();
      return Array.from(groups.values()).filter((group) => group.isEnabled && chatIds.has(group.chatId));
    },
    async isNewsEnabledGroup(chatId) {
      return groups.get(chatId)?.isEnabled === true;
    },
  };

  function subscriptionsForChat(chatId: number, map: Map<string, Set<number>>): string[] {
    return Array.from(map.entries())
      .filter(([, chatIds]) => chatIds.has(chatId))
      .map(([categoryKey]) => categoryKey)
      .sort((left, right) => left.localeCompare(right));
  }
}

test('catalog loan callbacks create, list and return loans', async () => {
  const catalogRepository = createCatalogRepository([
    {
      id: 1,
      familyId: null,
      groupId: null,
      itemType: 'board-game',
      displayName: 'Game 1',
      originalName: null,
      description: null,
      language: null,
      publisher: null,
      publicationYear: null,
      playerCountMin: null,
      playerCountMax: null,
      recommendedAge: null,
      playTimeMinutes: null,
      externalRefs: null,
      metadata: null,
      lifecycleStatus: 'active',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      deactivatedAt: null,
    },
  ]);
  const catalogLoanRepository = createLoanRepository();
  const { context, replies } = createContext({ catalogRepository, catalogLoanRepository });
  context.callbackData = `${catalogLoanCallbackPrefixes.create}1`;
  context.from = { id: 7, first_name: 'Anna', username: 'anna' };

  await handleTelegramCatalogLoanCallback(context);

  assert.match(replies[0]?.message ?? '', /<b>Game 1<\/b>/);
  assert.ok(replies[0]?.options?.inlineKeyboard?.flat().some((button) => button.text === 'Retornar'));

  replies.length = 0;
  context.callbackData = catalogLoanCallbackPrefixes.openMyLoans;
  await handleTelegramCatalogLoanCallback(context);

  assert.match(replies[0]?.message ?? '', /Els meus préstecs:/);
  assert.match(replies[0]?.message ?? '', /Game 1/);

  replies.length = 0;
  context.callbackData = `${catalogLoanCallbackPrefixes.return}1`;
  await handleTelegramCatalogLoanCallback(context);

  assert.match(replies[0]?.message ?? '', /<b>Game 1<\/b>/);
  assert.ok(replies[0]?.options?.inlineKeyboard?.flat().some((button) => button.text === 'Prendre prestat'));
});

test('loan detail buttons use the updated borrow and delete labels', async () => {
  const loan: CatalogLoanRecord = {
    id: 7,
    itemId: 11,
    borrowerTelegramUserId: 99,
    borrowerDisplayName: 'Marta',
    loanedByTelegramUserId: 99,
    dueAt: null,
    notes: null,
    returnedAt: null,
    returnedByTelegramUserId: null,
    createdAt: '2026-04-04T10:00:00.000Z',
    updatedAt: '2026-04-04T10:00:00.000Z',
  };

  const availableRows = buildLoanDetailButtons({
    loan: null,
    itemId: 11,
    deleteCallbackData: 'catalog_admin:deactivate:11',
    language: 'ca',
  });

  assert.equal(availableRows[0]?.[0]?.text, 'Prendre prestat');
  assert.equal(availableRows[1]?.[0]?.text, 'Eliminar ítem');
  assert.equal(availableRows[2]?.[0]?.text, 'Veure préstecs');

  const borrowedRows = buildLoanDetailButtons({
    loan,
    itemId: 11,
    deleteCallbackData: 'catalog_admin:deactivate:11',
    language: 'en',
  });

  assert.equal(borrowedRows[0]?.[0]?.text, 'Return');
  assert.equal(borrowedRows[1]?.[0]?.text, 'Delete item');
  assert.equal(borrowedRows[2]?.[0]?.text, 'View loans');
  assert.equal(buildLoanItemButton(null, 11, 'Game 1', 'catalog_read:item:', 'es')[1]?.text, 'Tomar prestado');
  const spanishRows = buildLoanDetailButtons({
    loan: null,
    itemId: 11,
    deleteCallbackData: 'catalog_admin:deactivate:11',
    language: 'es',
  });

  assert.equal(spanishRows[0]?.[0]?.text, 'Tomar prestado');
  assert.equal(spanishRows[1]?.[0]?.text, 'Eliminar ítem');
  assert.equal(spanishRows[2]?.[0]?.text, 'Ver préstamos');
});

test('catalog loan edit flow updates notes and due date', async () => {
  const catalogRepository = createCatalogRepository([
    {
      id: 1,
      familyId: null,
      groupId: null,
      itemType: 'board-game',
      displayName: 'Game 1',
      originalName: null,
      description: null,
      language: null,
      publisher: null,
      publicationYear: null,
      playerCountMin: null,
      playerCountMax: null,
      recommendedAge: null,
      playTimeMinutes: null,
      externalRefs: null,
      metadata: null,
      lifecycleStatus: 'active',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      deactivatedAt: null,
    },
  ]);
  const catalogLoanRepository = createLoanRepository([
    {
      id: 1,
      itemId: 1,
      borrowerTelegramUserId: 7,
      borrowerDisplayName: 'Anna',
      loanedByTelegramUserId: 7,
      dueAt: null,
      notes: null,
      returnedAt: null,
      returnedByTelegramUserId: null,
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
    },
  ]);
  const { context, replies } = createContext({ catalogRepository, catalogLoanRepository });
  context.callbackData = `${catalogLoanCallbackPrefixes.edit}1`;

  await handleTelegramCatalogLoanCallback(context);

  assert.match(replies[0]?.message ?? '', /introdueix les notes/);

  replies.length = 0;
  context.messageText = 'Passa-ho a la Marta';
  await handleTelegramCatalogLoanText(context);

  assert.match(replies[0]?.message ?? '', /Introdueix la data de retorn prevista/);

  replies.length = 0;
  context.messageText = '2026-04-11';
  await handleTelegramCatalogLoanText(context);

  assert.match(replies[0]?.message ?? '', /Préstec actualitzat\./);
});

test('catalog-loan notifications are sent only to subscribed news categories', async () => {
  const catalogRepository = createCatalogRepository([
    {
      id: 1,
      familyId: null,
      groupId: null,
      itemType: 'board-game',
      displayName: 'Game 1',
      originalName: null,
      description: null,
      language: null,
      publisher: null,
      publicationYear: null,
      playerCountMin: null,
      playerCountMax: null,
      recommendedAge: null,
      playTimeMinutes: null,
      externalRefs: null,
      metadata: null,
      lifecycleStatus: 'active',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      deactivatedAt: null,
    },
  ]);
  const catalogLoanRepository = createLoanRepository();
  const newsGroupRepository = createNewsGroupRepository(
    [
      {
        chatId: -200,
        isEnabled: true,
        metadata: null,
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        enabledAt: '2026-04-04T10:00:00.000Z',
        disabledAt: null,
      },
      {
        chatId: -201,
        isEnabled: true,
        metadata: null,
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        enabledAt: '2026-04-04T10:00:00.000Z',
        disabledAt: null,
      },
      {
        chatId: -202,
        isEnabled: false,
        metadata: null,
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        enabledAt: null,
        disabledAt: '2026-04-04T10:00:00.000Z',
      },
    ],
    new Map([
      ['catalog-loans:book', new Set([-201])],
    ]),
  );
  const { context, groupMessages } = createContext({
    catalogRepository,
    catalogLoanRepository,
    newsGroupRepository,
  });
  context.from = { id: 7, first_name: 'Anna', username: 'anna' };

  context.callbackData = `${catalogLoanCallbackPrefixes.create}1`;
  await handleTelegramCatalogLoanCallback(context);

  assert.equal(groupMessages.length, 1);
  assert.equal(groupMessages.at(-1)?.chatId, -200);
  assert.match(groupMessages.at(-1)?.message ?? '', /Anna ha pres prestat Game 1\./);

  context.callbackData = `${catalogLoanCallbackPrefixes.return}1`;
  await handleTelegramCatalogLoanCallback(context);

  assert.equal(groupMessages.length, 2);
  assert.equal(groupMessages.at(-1)?.chatId, -200);
  assert.match(groupMessages.at(-1)?.message ?? '', /Anna ha retornat Game 1\./);
  assert.notEqual(groupMessages.at(-1)?.chatId, -201);
  assert.notEqual(groupMessages.at(-1)?.chatId, -202);
});
