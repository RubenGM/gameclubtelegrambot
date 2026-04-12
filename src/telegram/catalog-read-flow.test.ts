import test from 'node:test';
import assert from 'node:assert/strict';

import type { CatalogFamilyRecord, CatalogGroupRecord, CatalogItemRecord, CatalogLoanRecord, CatalogMediaRecord, CatalogLoanRepository, CatalogRepository } from '../catalog/catalog-model.js';
import type { MembershipAccessRepository, MembershipUserRecord } from '../membership/access-flow.js';
import { normalizeDisplayName } from '../membership/display-name.js';
import type { ConversationSessionRecord } from './conversation-session.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import {
  catalogReadCallbackPrefixes,
  handleTelegramCatalogReadCallback,
  handleTelegramCatalogReadCommand,
  handleTelegramCatalogReadText,
  handleTelegramCatalogReadStartText,
} from './catalog-read-flow.js';

function createRepository({
  families = [],
  groups = [],
  items = [],
  media = [],
}: {
  families?: CatalogFamilyRecord[];
  groups?: CatalogGroupRecord[];
  items?: CatalogItemRecord[];
  media?: CatalogMediaRecord[];
} = {}): CatalogRepository {
  const familyMap = new Map(families.map((family) => [family.id, family]));
  const groupMap = new Map(groups.map((group) => [group.id, group]));
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const mediaMap = new Map(media.map((entry) => [entry.id, entry]));

  return {
    async createFamily() { throw new Error('not implemented'); },
    async findFamilyById(familyId) { return familyMap.get(familyId) ?? null; },
    async listFamilies() { return Array.from(familyMap.values()); },
    async createGroup() { throw new Error('not implemented'); },
    async findGroupById(groupId) { return groupMap.get(groupId) ?? null; },
    async listGroups() { return Array.from(groupMap.values()); },
    async createItem() { throw new Error('not implemented'); },
    async findItemById(itemId) { return itemMap.get(itemId) ?? null; },
    async listItems({ includeDeactivated }) { return Array.from(itemMap.values()).filter((item) => includeDeactivated || item.lifecycleStatus === 'active'); },
    async updateItem() { throw new Error('not implemented'); },
    async deactivateItem() { throw new Error('not implemented'); },
    async createMedia() { throw new Error('not implemented'); },
    async listMedia() { return Array.from(mediaMap.values()); },
    async updateMedia() { throw new Error('not implemented'); },
    async deleteMedia() { throw new Error('not implemented'); },
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

function createMembershipRepository(users: MembershipUserRecord[] = []): MembershipAccessRepository {
  const userMap = new Map(users.map((user) => [user.telegramUserId, user]));

  return {
    async findUserByTelegramUserId(telegramUserId) {
      return userMap.get(telegramUserId) ?? null;
    },
    async syncUserProfile(input) {
      const existing = userMap.get(input.telegramUserId);
      if (!existing) {
        return null;
      }

      const next: MembershipUserRecord = {
        ...existing,
        ...(input.username !== undefined ? { username: input.username ?? null } : {}),
        displayName: normalizeDisplayName(input.displayName) ?? existing.displayName,
      };
      userMap.set(next.telegramUserId, next);
      return next;
    },
    async upsertPendingUser() { throw new Error('not implemented'); },
    async listPendingUsers() { return []; },
    async backfillDisplayNames() { return 0; },
    async appendStatusAuditLog() { throw new Error('not implemented'); },
    async approveMembershipRequest() { throw new Error('not implemented'); },
    async rejectMembershipRequest() { throw new Error('not implemented'); },
  };
}

function createContext(repository: CatalogRepository, loanRepository: CatalogLoanRepository = createLoanRepository(), membershipRepository: MembershipAccessRepository = createMembershipRepository()): {
  context: TelegramCommandHandlerContext;
  replies: Array<{ message: string; options?: TelegramReplyOptions }>;
} {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  let current: ConversationSessionRecord | null = null;

  return {
    context: {
      messageText: undefined,
      callbackData: undefined,
      reply: async (message: string, options?: TelegramReplyOptions) => {
        replies.push({ message, ...(options ? { options } : {}) });
      },
      runtime: {
        bot: {
          publicName: 'Game Club Bot',
          clubName: 'Game Club',
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
          authorize: () => ({ allowed: false, permissionKey: 'catalog.read', reason: 'no-match' }),
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
              throw new Error('not implemented');
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
      catalogRepository: repository,
      catalogLoanRepository: loanRepository,
      membershipRepository,
    } as unknown as TelegramCommandHandlerContext,
    replies,
  };
}

function buildFamily(id: number, name: string): CatalogFamilyRecord {
  return {
    id,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    displayName: name,
    description: null,
    familyKind: 'board-game-line',
    createdAt: '2026-04-04T10:00:00.000Z',
    updatedAt: '2026-04-04T10:00:00.000Z',
  };
}

function buildItem(id: number, displayName: string, overrides: Partial<CatalogItemRecord> = {}): CatalogItemRecord {
  return {
    id,
    familyId: overrides.familyId ?? null,
    groupId: overrides.groupId ?? null,
    itemType: overrides.itemType ?? 'board-game',
    displayName,
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
    metadata: overrides.metadata ?? null,
    lifecycleStatus: 'active',
    createdAt: '2026-04-04T10:00:00.000Z',
    updatedAt: '2026-04-04T10:00:00.000Z',
    deactivatedAt: null,
  };
}

test('handleTelegramCatalogReadCommand paginates the overview list', async () => {
  const repository = createRepository({
    families: [
      buildFamily(1, 'Alpha'),
      buildFamily(2, 'Bravo'),
      buildFamily(3, 'Charlie'),
      buildFamily(4, 'Delta'),
      buildFamily(5, 'Echo'),
      buildFamily(6, 'Foxtrot'),
    ],
  });
  const { context, replies } = createContext(repository);
  context.messageText = '/catalog_search';

  await handleTelegramCatalogReadCommand(context);

  assert.match(replies[0]?.message ?? '', /Pàgina 1\/2/);
  assert.match(replies[0]?.message ?? '', /- Alpha · 0 items/);
  assert.deepEqual(replies[0]?.options?.inlineKeyboard?.[5]?.[1]?.callbackData, 'catalog_read:page:next');

  replies.length = 0;
  context.callbackData = catalogReadCallbackPrefixes.pageNext;

  await handleTelegramCatalogReadCallback(context);

  assert.match(replies[0]?.message ?? '', /Pàgina 2\/2/);
  assert.match(replies[0]?.message ?? '', /- Foxtrot · 0 items/);
});

test('handleTelegramCatalogReadCommand escapes HTML-sensitive labels in the overview', async () => {
  const repository = createRepository({
    families: [buildFamily(1, 'Rock & Roll')],
    items: [buildItem(2, 'A < B')],
  });
  const { context, replies } = createContext(repository);
  context.messageText = '/catalog_search';

  await handleTelegramCatalogReadCommand(context);

  assert.match(replies[0]?.message ?? '', /Rock &amp; Roll/);
  assert.match(replies[0]?.message ?? '', /A &lt; B/);
  assert.match(replies[0]?.message ?? '', /&lt;text&gt;/);
});

test('handleTelegramCatalogReadCommand paginates searches and exposes loan status', async () => {
  const repository = createRepository({
    families: [buildFamily(1, 'Alpha')],
    groups: [
      {
        id: 2,
        familyId: 1,
        slug: 'core',
        displayName: 'Core',
        description: null,
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
    ],
    items: [
      buildItem(1, 'Game 1', { familyId: 1, groupId: 2, metadata: { loanStatus: 'loaned', borrowedBy: 'Marta', loanDueAt: '2026-04-10' } }),
      buildItem(2, 'Game 2', { familyId: 1, groupId: 2 }),
      buildItem(3, 'Game 3', { familyId: 1, groupId: 2 }),
      buildItem(4, 'Game 4', { familyId: 1, groupId: 2 }),
      buildItem(5, 'Game 5', { familyId: 1, groupId: 2 }),
      buildItem(6, 'Game 6', { familyId: 1, groupId: 2 }),
    ],
  });
  const loanRepository = createLoanRepository([
    {
      id: 1,
      itemId: 1,
      borrowerTelegramUserId: 99,
      borrowerDisplayName: 'Usuari 99',
      loanedByTelegramUserId: 7,
      dueAt: '2026-04-10T00:00:00.000Z',
      notes: null,
      returnedAt: null,
      returnedByTelegramUserId: null,
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
    },
  ]);
  const membershipRepository = createMembershipRepository([
    {
      telegramUserId: 99,
      displayName: 'Marta',
      status: 'approved',
      isAdmin: false,
    },
  ]);
  const { context, replies } = createContext(repository, loanRepository, membershipRepository);
  context.messageText = '/catalog_search Game';

  await handleTelegramCatalogReadCommand(context);

  assert.match(replies[0]?.message ?? '', /Resultats per a "Game"/);
  assert.match(replies[0]?.message ?? '', /Pàgina 1\/2/);
  assert.match(replies[0]?.message ?? '', /Prestat a Marta/);
  assert.match(replies[0]?.message ?? '', /<a href="https:\/\/t\.me\/cawatest_bot\?start=catalog_read_item_1"><b>Game 1<\/b><\/a>/);
  assert.equal(replies[0]?.options?.inlineKeyboard?.[0]?.[0]?.text, 'Game 1');
  assert.equal(replies[0]?.options?.inlineKeyboard?.[0]?.[1]?.text, 'Retornar');

  replies.length = 0;
  context.callbackData = `${catalogReadCallbackPrefixes.inspectItem}1`;

  await handleTelegramCatalogReadCallback(context);

  assert.match(replies[0]?.message ?? '', /<b>Disponibilitat:<\/b> En préstec/);
  assert.match(replies[0]?.message ?? '', /<b>Té:<\/b> Marta/);
  assert.match(replies[0]?.message ?? '', /<b>Retorn previst:<\/b> 10\/04\/2026/);
});

test('handleTelegramCatalogReadStartText opens linked item details from /start', async () => {
  const repository = createRepository({
    items: [
      buildItem(1, 'Game 1', { metadata: { loanStatus: 'loaned', borrowedBy: 'Marta', loanDueAt: '2026-04-10' } }),
    ],
  });
  const loanRepository = createLoanRepository([
    {
      id: 1,
      itemId: 1,
      borrowerTelegramUserId: 99,
      borrowerDisplayName: 'Usuari 99',
      loanedByTelegramUserId: 7,
      dueAt: '2026-04-10T00:00:00.000Z',
      notes: null,
      returnedAt: null,
      returnedByTelegramUserId: null,
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
    },
  ]);
  const { context, replies } = createContext(repository, loanRepository);
  context.messageText = '/start catalog_read_item_1';

  const handled = await handleTelegramCatalogReadStartText(context);

  assert.equal(handled, true);
  assert.equal(replies[0]?.options?.parseMode, 'HTML');
  assert.match(replies[0]?.message ?? '', /<b>Game 1<\/b>/);
});

test('handleTelegramCatalogReadText opens the catalog from the member keyboard action', async () => {
  const repository = createRepository({
    families: [buildFamily(1, 'Alpha')],
  });
  const { context, replies } = createContext(repository);
  context.messageText = 'Cataleg';

  const handled = await handleTelegramCatalogReadText(context);

  assert.equal(handled, true);
  assert.match(replies[0]?.message ?? '', /Alpha/);
  assert.equal(replies[0]?.options?.inlineKeyboard?.at(-1)?.[0]?.callbackData, catalogReadCallbackPrefixes.overview);
});
