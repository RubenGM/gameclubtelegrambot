import test from 'node:test';
import assert from 'node:assert/strict';

import type { AuditLogEventRecord, AuditLogRepository } from '../audit/audit-log.js';
import type { CatalogLookupCandidate, CatalogLookupService } from '../catalog/catalog-lookup-service.js';
import type {
  CatalogFamilyRecord,
  CatalogGroupRecord,
  CatalogItemRecord,
  CatalogMediaRecord,
  CatalogLoanRecord,
  CatalogLoanRepository,
  CatalogRepository,
} from '../catalog/catalog-model.js';
import type { MembershipAccessRepository, MembershipUserRecord } from '../membership/access-flow.js';
import { normalizeDisplayName } from '../membership/display-name.js';
import type { WikipediaBoardGameImportService } from '../catalog/wikipedia-boardgame-import-service.js';
import type { BoardGameGeekCollectionImportService } from '../catalog/wikipedia-boardgame-import-service.js';
import type { ConversationSessionRecord } from './conversation-session.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import {
  catalogAdminCallbackPrefixes,
  catalogAdminLabels,
  handleTelegramCatalogAdminCallback,
  handleTelegramCatalogAdminStartText,
  handleTelegramCatalogAdminText,
  type TelegramCatalogAdminContext,
} from './catalog-admin-flow.js';

function successButton(text: string) {
  return { text, semanticRole: 'success' as const };
}

function dangerButton(text: string) {
  return { text, semanticRole: 'danger' as const };
}

function buttonText(button: string | { text: string }): string {
  return typeof button === 'string' ? button : button.text;
}

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
  let nextFamilyId = Math.max(0, ...families.map((family) => family.id)) + 1;
  let nextItemId = Math.max(0, ...items.map((item) => item.id)) + 1;
  let nextMediaId = Math.max(0, ...media.map((entry) => entry.id)) + 1;

  return {
    async createFamily(input) {
      const createdAt = '2026-04-04T10:00:00.000Z';
      const family: CatalogFamilyRecord = {
        id: nextFamilyId,
        slug: input.slug,
        displayName: input.displayName,
        description: input.description,
        familyKind: input.familyKind,
        createdAt,
        updatedAt: createdAt,
      };
      nextFamilyId += 1;
      familyMap.set(family.id, family);
      return family;
    },
    async findFamilyById(familyId) {
      return familyMap.get(familyId) ?? null;
    },
    async listFamilies() {
      return Array.from(familyMap.values());
    },
    async createGroup() {
      throw new Error('not implemented');
    },
    async findGroupById(groupId) {
      return groupMap.get(groupId) ?? null;
    },
    async listGroups({ familyId }) {
      return Array.from(groupMap.values()).filter((group) => familyId === undefined || group.familyId === familyId);
    },
    async createItem(input) {
      const createdAt = '2026-04-04T10:00:00.000Z';
      const item: CatalogItemRecord = {
        id: nextItemId,
        familyId: input.familyId,
        groupId: input.groupId,
        itemType: input.itemType,
        displayName: input.displayName,
        originalName: input.originalName,
        description: input.description,
        language: input.language,
        publisher: input.publisher,
        publicationYear: input.publicationYear,
        playerCountMin: input.playerCountMin,
        playerCountMax: input.playerCountMax,
        recommendedAge: input.recommendedAge,
        playTimeMinutes: input.playTimeMinutes,
        externalRefs: input.externalRefs,
        metadata: input.metadata,
        lifecycleStatus: 'active',
        createdAt,
        updatedAt: createdAt,
        deactivatedAt: null,
      };
      nextItemId += 1;
      itemMap.set(item.id, item);
      return item;
    },
    async findItemById(itemId) {
      return itemMap.get(itemId) ?? null;
    },
    async listItems({ includeDeactivated }) {
      return Array.from(itemMap.values()).filter((item) => includeDeactivated || item.lifecycleStatus === 'active');
    },
    async updateItem(input) {
      const existing = itemMap.get(input.itemId);
      if (!existing) {
        throw new Error('unknown item');
      }
      const next: CatalogItemRecord = {
        ...existing,
        familyId: input.familyId,
        groupId: input.groupId,
        itemType: input.itemType,
        displayName: input.displayName,
        originalName: input.originalName,
        description: input.description,
        language: input.language,
        publisher: input.publisher,
        publicationYear: input.publicationYear,
        playerCountMin: input.playerCountMin,
        playerCountMax: input.playerCountMax,
        recommendedAge: input.recommendedAge,
        playTimeMinutes: input.playTimeMinutes,
        externalRefs: input.externalRefs,
        metadata: input.metadata,
        updatedAt: '2026-04-04T11:00:00.000Z',
      };
      itemMap.set(next.id, next);
      return next;
    },
    async deactivateItem({ itemId }) {
      const existing = itemMap.get(itemId);
      if (!existing) {
        throw new Error('unknown item');
      }
      const next: CatalogItemRecord = {
        ...existing,
        lifecycleStatus: 'deactivated',
        updatedAt: '2026-04-04T12:00:00.000Z',
        deactivatedAt: '2026-04-04T12:00:00.000Z',
      };
      itemMap.set(next.id, next);
      return next;
    },
    async createMedia(input): Promise<CatalogMediaRecord> {
      const entry: CatalogMediaRecord = {
        id: nextMediaId,
        familyId: input.familyId,
        itemId: input.itemId,
        mediaType: input.mediaType,
        url: input.url,
        altText: input.altText,
        sortOrder: input.sortOrder,
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      };
      nextMediaId += 1;
      mediaMap.set(entry.id, entry);
      return entry;
    },
    async listMedia({ familyId, itemId }) {
      return Array.from(mediaMap.values()).filter((entry) => {
        if (familyId !== undefined) {
          return entry.familyId === familyId;
        }
        if (itemId !== undefined) {
          return entry.itemId === itemId;
        }
        return true;
      });
    },
    async updateMedia(input) {
      const existing = mediaMap.get(input.mediaId);
      if (!existing) {
        throw new Error(`unknown media ${input.mediaId}`);
      }
      const next: CatalogMediaRecord = {
        ...existing,
        mediaType: input.mediaType,
        url: input.url,
        altText: input.altText,
        sortOrder: input.sortOrder,
        updatedAt: '2026-04-04T11:00:00.000Z',
      };
      mediaMap.set(next.id, next);
      return next;
    },
    async deleteMedia({ mediaId }) {
      return mediaMap.delete(mediaId);
    },
  };
}

function createAuditRepository(): AuditLogRepository & { __events: AuditLogEventRecord[] } {
  const events: AuditLogEventRecord[] = [];
  return {
    async appendEvent(input) {
      events.push({
        actorTelegramUserId: input.actorTelegramUserId,
        actionKey: input.actionKey,
        targetType: input.targetType,
        targetId: input.targetId,
        summary: input.summary,
        details: input.details ?? null,
        createdAt: '2026-04-04T10:00:00.000Z',
      });
    },
    __events: events,
  };
}

function createLoanRepository(initialLoans: CatalogLoanRecord[] = []): CatalogLoanRepository {
  const loans = new Map(initialLoans.map((loan) => [loan.id, loan]));

  return {
    async createLoan() { throw new Error('not implemented'); },
    async findLoanById(loanId) { return loans.get(loanId) ?? null; },
    async findActiveLoanByItemId(itemId) {
      return Array.from(loans.values()).find((loan) => loan.itemId === itemId && loan.returnedAt === null) ?? null;
    },
    async listActiveLoansByBorrower() { return []; },
    async listLoansByItem(itemId) { return Array.from(loans.values()).filter((loan) => loan.itemId === itemId); },
    async updateLoan() { throw new Error('not implemented'); },
    async closeLoan() { throw new Error('not implemented'); },
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
    async listRevocableUsers() { return []; },
    async listApprovedAdminUsers() { return []; },
    async findLatestRevocation() { return null; },
    async backfillDisplayNames() { return 0; },
    async appendStatusAuditLog() { throw new Error('not implemented'); },
    async approveMembershipRequest() { throw new Error('not implemented'); },
    async rejectMembershipRequest() { throw new Error('not implemented'); },
    async revokeMembershipAccess() { throw new Error('not implemented'); },
  };
}

function createContext({
  repository = createRepository(),
  catalogLoanRepository = createLoanRepository(),
  membershipRepository = createMembershipRepository(),
  auditRepository = createAuditRepository(),
  catalogLookupService,
  wikipediaBoardGameImportService,
  boardGameGeekCollectionImportService,
  isAdmin = true,
  language = 'ca',
}: {
  repository?: CatalogRepository;
  catalogLoanRepository?: CatalogLoanRepository;
  membershipRepository?: MembershipAccessRepository;
  auditRepository?: AuditLogRepository;
  catalogLookupService?: CatalogLookupService;
  wikipediaBoardGameImportService?: WikipediaBoardGameImportService;
  boardGameGeekCollectionImportService?: BoardGameGeekCollectionImportService;
  isAdmin?: boolean;
  language?: 'ca' | 'es' | 'en';
} = {}) {
  const replies: Array<{ message: string; options?: TelegramReplyOptions | undefined }> = [];
  let currentSession: { flowKey: string; stepKey: string; data: Record<string, unknown> } | null = null;

  const context: TelegramCatalogAdminContext = {
    reply: async (message: string, options?: TelegramReplyOptions) => {
      replies.push({ message, ...(options ? { options } : {}) });
    },
    runtime: {
      actor: {
        telegramUserId: 99,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin,
        permissions: [],
      },
      authorization: {
        authorize: (permissionKey: string) => ({ allowed: permissionKey === 'catalog.manage', permissionKey, reason: 'admin-override' }),
        can: (permissionKey: string) => permissionKey === 'catalog.manage',
      },
      session: {
        get current() {
          if (!currentSession) return null;
          return {
            key: 'telegram.session:1:99',
            flowKey: currentSession.flowKey,
            stepKey: currentSession.stepKey,
            data: currentSession.data,
            createdAt: '2026-04-04T10:00:00.000Z',
            updatedAt: '2026-04-04T10:00:00.000Z',
            expiresAt: '2026-04-05T10:00:00.000Z',
          } satisfies ConversationSessionRecord;
        },
        start: async ({ flowKey, stepKey, data = {} }: { flowKey: string; stepKey: string; data?: Record<string, unknown> }) => {
          currentSession = { flowKey, stepKey, data };
          return context.runtime.session.current!;
        },
        advance: async ({ stepKey, data }: { stepKey: string; data: Record<string, unknown> }) => {
          if (!currentSession) throw new Error('no session');
          currentSession = { flowKey: currentSession.flowKey, stepKey, data };
          return context.runtime.session.current!;
        },
        cancel: async () => {
          const hadSession = currentSession !== null;
          currentSession = null;
          return hadSession;
        },
      },
      chat: { kind: 'private', chatId: 1 },
      services: { database: { db: undefined as never } },
      bot: { publicName: 'Game Club Bot', clubName: 'Game Club', language, sendPrivateMessage: async () => {} },
    },
    catalogRepository: repository,
    catalogLoanRepository,
    membershipRepository,
    auditRepository,
    ...(catalogLookupService ? { catalogLookupService } : {}),
    ...(wikipediaBoardGameImportService ? { wikipediaBoardGameImportService } : {}),
    ...(boardGameGeekCollectionImportService ? { boardGameGeekCollectionImportService } : {}),
  };

  return { context, replies, getCurrentSession: () => currentSession };
}

test('handleTelegramCatalogAdminText opens the catalog admin menu', async () => {
  const { context, replies } = createContext();
  context.messageText = catalogAdminLabels.openMenu;

  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /No hi ha cap item de cataleg disponible ara mateix\./);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [
    [catalogAdminLabels.create, catalogAdminLabels.listBoardGames],
    [catalogAdminLabels.listBooks, catalogAdminLabels.listRpgBooks],
    [catalogAdminLabels.listExpansions, catalogAdminLabels.searchByName],
    [catalogAdminLabels.importBggCollection],
    [catalogAdminLabels.start],
  ]);
});

test('handleTelegramCatalogAdminText accepts Spanish catalog action buttons', async () => {
  const { context, replies } = createContext({ language: 'es' });

  context.messageText = 'Catalogo';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /No hay ningun item de catalogo disponible ahora mismo\./);

  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [
    [catalogAdminLabels.create, 'Listar juegos de mesa'],
    ['Listar libros', 'Listar libros RPG'],
    ['Listar expansiones', 'Buscar por nombre'],
    ['Importar colección BGG'],
    ['Inicio'],
  ]);

  context.messageText = 'Listar juegos de mesa';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  context.messageText = 'Listar libros';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  context.messageText = 'Listar libros RPG';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  context.messageText = 'Listar expansiones';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  context.messageText = 'Buscar por nombre';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Escribe el nombre, o parte del nombre,/);
});

test('handleTelegramCatalogAdminText rejects BGG collection import for non-admin members', async () => {
  const { context, replies, getCurrentSession } = createContext({ isAdmin: false, language: 'es' });

  context.messageText = 'Importar colección BGG';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /solo administradores|administrador/i);
});

test('handleTelegramCatalogAdminText imports a BGG collection and refreshes existing items', async () => {
  const repository = createRepository({
    items: [
      {
        id: 3,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Root old',
        originalName: 'Root old',
        description: 'old description',
        language: null,
        publisher: 'Old Publisher',
        publicationYear: 2017,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: 8,
        playTimeMinutes: 60,
        externalRefs: { boardGameGeekId: '101', boardGameGeekUrl: 'https://boardgamegeek.com/boardgame/101' },
        metadata: { source: 'boardgamegeek', boardGameGeekId: '101' },
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const auditRepository = createAuditRepository();
  const collectionCalls: string[] = [];
  const boardGameGeekCollectionImportService: BoardGameGeekCollectionImportService = {
    async listCollections(username) {
      return {
        ok: true,
        username,
        collections: [{ key: 'owned' }],
        canWriteCollectionName: true,
      };
    },
    async importCollection({ username, collectionKey }) {
      collectionCalls.push(`${username}:${collectionKey ?? 'manual'}`);
      return {
        ok: true,
        username,
        collectionKey: collectionKey ?? 'owned',
        totalCount: 2,
        items: [
          {
            familyId: null,
            groupId: null,
            itemType: 'board-game',
            displayName: 'Root',
            originalName: 'Root',
            description: 'Woodland war game',
            language: null,
            publisher: 'Leder Games',
            publicationYear: 2018,
            playerCountMin: 2,
            playerCountMax: 4,
            recommendedAge: 10,
            playTimeMinutes: 90,
            externalRefs: { boardGameGeekId: '101', boardGameGeekUrl: 'https://boardgamegeek.com/boardgame/101' },
            metadata: { source: 'boardgamegeek', boardGameGeekId: '101', imageUrl: 'https://example.com/root.jpg' },
          },
          {
            familyId: null,
            groupId: null,
            itemType: 'expansion',
            displayName: 'Riverfolk Expansion',
            originalName: 'Riverfolk Expansion',
            description: 'Root expansion',
            language: null,
            publisher: 'Leder Games',
            publicationYear: 2018,
            playerCountMin: 1,
            playerCountMax: 6,
            recommendedAge: 10,
            playTimeMinutes: 90,
            externalRefs: { boardGameGeekId: '202', boardGameGeekUrl: 'https://boardgamegeek.com/boardgame/202' },
            metadata: { source: 'boardgamegeek', boardGameGeekId: '202', imageUrl: 'https://example.com/riverfolk.jpg' },
          },
        ],
        errors: [],
      };
    },
    async importByUsername(username) {
      return {
        ok: true,
        username,
        collectionKey: 'owned',
        totalCount: 2,
        items: [
          {
            familyId: null,
            groupId: null,
            itemType: 'board-game',
            displayName: 'Root',
            originalName: 'Root',
            description: 'Woodland war game',
            language: null,
            publisher: 'Leder Games',
            publicationYear: 2018,
            playerCountMin: 2,
            playerCountMax: 4,
            recommendedAge: 10,
            playTimeMinutes: 90,
            externalRefs: { boardGameGeekId: '101', boardGameGeekUrl: 'https://boardgamegeek.com/boardgame/101' },
            metadata: { source: 'boardgamegeek', boardGameGeekId: '101', imageUrl: 'https://example.com/root.jpg' },
          },
          {
            familyId: null,
            groupId: null,
            itemType: 'expansion',
            displayName: 'Riverfolk Expansion',
            originalName: 'Riverfolk Expansion',
            description: 'Root expansion',
            language: null,
            publisher: 'Leder Games',
            publicationYear: 2018,
            playerCountMin: 1,
            playerCountMax: 6,
            recommendedAge: 10,
            playTimeMinutes: 90,
            externalRefs: { boardGameGeekId: '202', boardGameGeekUrl: 'https://boardgamegeek.com/boardgame/202' },
            metadata: { source: 'boardgamegeek', boardGameGeekId: '202', imageUrl: 'https://example.com/riverfolk.jpg' },
          },
        ],
        errors: [],
      };
    },
  };
  const { context, replies, getCurrentSession } = createContext({
    repository,
    auditRepository,
    boardGameGeekCollectionImportService,
  });

  context.messageText = catalogAdminLabels.importBggCollection;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.flowKey, 'catalog-admin-bgg-collection-import');
  assert.equal(getCurrentSession()?.stepKey, 'bgg-username');

  context.messageText = 'ruben';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  context.messageText = 'Propia';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.deepEqual(collectionCalls, ['ruben:owned']);
  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /ruben/);
  assert.match(replies.at(-1)?.message ?? '', /Creats:\s*1/i);
  assert.match(replies.at(-1)?.message ?? '', /Actualitzats:\s*1/i);
  assert.equal((await repository.findItemById(3))?.displayName, 'Root');
  assert.equal((await repository.findItemById(3))?.publisher, 'Leder Games');
  assert.equal((await repository.findItemById(3))?.recommendedAge, 10);
  assert.equal((await repository.findItemById(4))?.itemType, 'expansion');
  assert.equal((await repository.findItemById(4))?.displayName, 'Riverfolk Expansion');
  assert.equal(auditRepository.__events.filter((event) => event.actionKey === 'catalog.item.updated').length, 1);
  assert.equal(auditRepository.__events.filter((event) => event.actionKey === 'catalog.item.created').length, 1);
});

test('handleTelegramCatalogAdminText lists expansions from the catalog menu', async () => {
  const repository = createRepository({
    items: [
      {
        id: 7,
        familyId: null,
        groupId: null,
        itemType: 'expansion',
        displayName: 'Riverfolk Expansion',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: { boardGameGeekId: '202' },
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const { context, replies } = createContext({ repository, language: 'es' });

  context.messageText = 'Listar expansiones';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.match(replies.at(-1)?.message ?? '', /Riverfolk Expansion/);
});

test('handleTelegramCatalogAdminText lets approved non-admin members open the catalog menu and start creation', async () => {
  const { context, replies, getCurrentSession } = createContext({ isAdmin: false, language: 'es' });

  context.messageText = 'Catalogo';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /No hay ningun item de catalogo disponible ahora mismo\./);

  context.messageText = 'Crear item';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.flowKey, 'catalog-admin-create');
  assert.equal(getCurrentSession()?.stepKey, 'item-type');
});

test('handleTelegramCatalogAdminText accepts Spanish item type buttons when creating', async () => {
  const { context, getCurrentSession, replies } = createContext({ language: 'es' });

  context.messageText = 'Crear item';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [
    ['Juego de mesa'],
    ['Libro', 'Libro RPG'],
    ['Accesorio'],
    [dangerButton('/cancel')],
  ]);
  context.messageText = 'Juego de mesa';

  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'display-name');
  assert.match(replies.at(-1)?.message ?? '', /Escribe el nombre del item para buscar datos automaticamente en la API\./);
  assert.deepEqual(replies.at(-2)?.options?.replyKeyboard, [
    ['Juego de mesa'],
    ['Libro', 'Libro RPG'],
    ['Accesorio'],
    [dangerButton('/cancel')],
  ]);
});

test('handleTelegramCatalogAdminText creates a board game and opens edit mode immediately', async () => {
  const repository = createRepository({
    families: [
      {
        id: 7,
        slug: 'arkham-horror',
        displayName: 'Arkham Horror',
        description: null,
        familyKind: 'board-game-line',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
    ],
    groups: [
      {
        id: 11,
        familyId: 7,
        slug: 'base-line',
        displayName: 'Linia base',
        description: null,
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
    ],
  });
  const auditRepository = createAuditRepository();
  let importCalls: string[] = [];
  const wikipediaBoardGameImportService: WikipediaBoardGameImportService = {
    async importByTitle(title) {
      importCalls.push(title);
      return {
        ok: true,
        draft: {
          familyId: null,
          groupId: null,
          itemType: 'board-game',
          displayName: 'Root',
          originalName: 'Root',
          description: null,
          language: null,
          publisher: 'Dire Wolf',
          publicationYear: 2024,
          playerCountMin: 1,
          playerCountMax: 4,
          recommendedAge: null,
          playTimeMinutes: 60,
          externalRefs: {
            wikipediaUrl: 'https://en.wikipedia.org/wiki/Root_(board_game)',
          },
          metadata: {
            source: 'wikipedia',
            wikipediaUrl: 'https://en.wikipedia.org/wiki/Root_(board_game)',
            wikidataId: 'Q36910373',
            designers: ['Cole Wehrle'],
            illustrators: ['Kyle Ferrin'],
            genres: ['Board game'],
            notes: [],
            editionType: null,
          },
        },
      };
    },
  };
  const { context, getCurrentSession, replies } = createContext({ repository, auditRepository, wikipediaBoardGameImportService });

  context.messageText = catalogAdminLabels.create;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.typeBoardGame;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Escriu el nom de l item per buscar dades automaticament a l API/);

  context.messageText = 'Root';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.match(replies.at(-3)?.message ?? '', /Buscant.*API/);
  assert.match(replies.at(-2)?.message ?? '', /Importacio des de l API completada/);
  assert.match(replies.at(-1)?.message ?? '', /He importat dades externes per Root/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Resum de l item:<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Nom:<\/b>/);
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.[0]?.[0], catalogAdminLabels.editFieldDisplayName);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');
  assert.deepEqual(importCalls, ['Root']);

  context.messageText = catalogAdminLabels.editFieldPublisher;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Devir';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  context.messageText = catalogAdminLabels.confirmEdit;
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /Item de cataleg actualitzat correctament: Root/);
  const created = await repository.findItemById(1);
  assert.equal(created?.displayName, 'Root');
  assert.equal(created?.itemType, 'board-game');
  assert.equal(created?.familyId, null);
  assert.equal(created?.groupId, null);
  assert.equal(created?.publisher, 'Devir');
  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'catalog.item.updated');
});

test('handleTelegramCatalogAdminText localizes the wikipedia import handoff', async () => {
  const repository = createRepository();
  const wikipediaBoardGameImportService: WikipediaBoardGameImportService = {
    async importByTitle() {
      return {
        ok: true,
        draft: {
          familyId: null,
          groupId: null,
          itemType: 'board-game',
          displayName: 'A & B',
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
        },
      };
    },
  };
  const { context, replies, getCurrentSession } = createContext({ repository, wikipediaBoardGameImportService, language: 'es' });

  context.messageText = catalogAdminLabels.create;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Juego de mesa';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'A & B';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.equal(getCurrentSession()?.stepKey, 'select-field');
  assert.match(replies.at(-2)?.message ?? '', /Importacion desde la API completada/);
  assert.match(replies.at(-1)?.message ?? '', /He importado datos externos para A &amp; B\./);
  assert.match(replies.at(-1)?.message ?? '', /Elige un campo del teclado o guarda los cambios cuando hayas terminado\./);
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.[0]?.[0], 'Nombre visible');
  assert.equal(buttonText(replies.at(-1)?.options?.replyKeyboard?.at(-2)?.[0] as string | { text: string }), 'Guardar cambios');
});

test('handleTelegramCatalogAdminText shows a URL fallback when Wikipedia import fails', async () => {
  const repository = createRepository();
  const wikipediaBoardGameImportService: WikipediaBoardGameImportService = {
    async importByTitle() {
      return {
        ok: false,
        error: { type: 'connection', message: 'down' },
      };
    },
  };
  const { context, replies, getCurrentSession } = createContext({ repository, wikipediaBoardGameImportService });

  context.messageText = catalogAdminLabels.create;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.typeBoardGame;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Unknown Game';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.match(replies.at(-2)?.message ?? '', /Buscant.*API/);
  assert.match(replies.at(-1)?.message ?? '', /Enganxa una referencia manual valida/);
  assert.equal(buttonText(replies.at(-1)?.options?.replyKeyboard?.[0]?.[0] as string | { text: string }), catalogAdminLabels.skipLookupImport);
  assert.equal(getCurrentSession()?.stepKey, 'wikipedia-url');

  context.messageText = catalogAdminLabels.skipLookupImport;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');
  context.messageText = catalogAdminLabels.editFieldFamily;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'family');
  assert.match(replies.at(-1)?.message ?? '', /Escriu la familia del joc de taula/);
});

test('handleTelegramCatalogAdminText retries Wikipedia import when the user pastes a full url', async () => {
  const repository = createRepository();
  const importCalls: string[] = [];
  const wikipediaBoardGameImportService: WikipediaBoardGameImportService = {
    async importByTitle(title) {
      importCalls.push(title);
      if (title === 'Root (board game)') {
        return {
          ok: true,
          draft: {
            familyId: null,
            groupId: null,
            itemType: 'board-game',
            displayName: 'Root',
            originalName: 'Root',
            description: null,
            language: null,
            publisher: 'Dire Wolf',
            publicationYear: 2024,
            playerCountMin: 2,
            playerCountMax: 4,
            recommendedAge: 13,
            playTimeMinutes: 90,
            externalRefs: {
              wikipediaUrl: 'https://en.wikipedia.org/wiki/Root_(board_game)',
            },
            metadata: {
              source: 'wikipedia',
              wikipediaUrl: 'https://en.wikipedia.org/wiki/Root_(board_game)',
            },
          },
        };
      }
      return { ok: false, error: { type: 'not-found', message: 'No s ha trobat el joc a Wikipedia.' } };
    },
  };
  const { context, replies, getCurrentSession } = createContext({ repository, wikipediaBoardGameImportService });

  context.messageText = catalogAdminLabels.create;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.typeBoardGame;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Unknown Game';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  context.messageText = 'https://en.wikipedia.org/wiki/Root_(board_game)';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.deepEqual(importCalls, ['Unknown Game', 'Root (board game)']);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');
  assert.match(replies.at(-1)?.message ?? '', /He importat dades externes per Root/);
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.[0]?.[0], catalogAdminLabels.editFieldDisplayName);
});

test('handleTelegramCatalogAdminText lets the user choose among ambiguous Wikipedia candidates', async () => {
  const repository = createRepository();
  const importCalls: string[] = [];
  const wikipediaBoardGameImportService: WikipediaBoardGameImportService = {
    async importByTitle(title) {
      importCalls.push(title);
      if (title === 'Azul (board game)') {
        return {
          ok: true,
          draft: {
            familyId: null,
            groupId: null,
            itemType: 'board-game',
            displayName: 'Azul',
            originalName: 'Azul',
            description: null,
            language: null,
            publisher: 'Plan B Games',
            publicationYear: 2017,
            playerCountMin: 2,
            playerCountMax: 4,
            recommendedAge: 8,
            playTimeMinutes: 45,
            externalRefs: {
              wikipediaUrl: 'https://en.wikipedia.org/wiki/Azul_(board_game)',
            },
            metadata: {
              source: 'wikipedia',
              wikipediaUrl: 'https://en.wikipedia.org/wiki/Azul_(board_game)',
            },
          },
        };
      }

      return {
        ok: false,
        error: {
          type: 'ambiguous',
          message: 'He trobat diverses pàgines candidates a Wikipedia.',
          candidates: ['Azul', 'Azul (board game)', 'Azul: Summer Pavilion'],
        },
      };
    },
  };
  const { context, replies, getCurrentSession } = createContext({ repository, wikipediaBoardGameImportService });

  context.messageText = catalogAdminLabels.create;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.typeBoardGame;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Azul';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.equal(getCurrentSession()?.stepKey, 'wikipedia-candidate-choice');
  assert.match(replies.at(-1)?.message ?? '', /He trobat diverses pàgines candidates a Wikipedia/);
  assert.match(replies.at(-1)?.message ?? '', /Azul \(board game\)/);
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.[0]?.includes('Azul'), true);
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.flat().map((button) => buttonText(button as string | { text: string })).includes('Azul (board game)'), true);
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.flat().map((button) => buttonText(button as string | { text: string })).includes(catalogAdminLabels.skipLookupImport), true);

  context.messageText = 'Azul (board game)';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.deepEqual(importCalls, ['Azul', 'Azul (board game)']);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');
  assert.match(replies.at(-1)?.message ?? '', /He importat dades externes per Azul/);
});

test('handleTelegramCatalogAdminText creates a regular book through lookup first and then family by name', async () => {
  const repository = createRepository({
    families: [
      {
        id: 1,
        slug: 'mundodisco',
        displayName: 'Mundodisco',
        description: null,
        familyKind: 'generic-line',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
    ],
    items: [
      {
        id: 8,
        familyId: 1,
        groupId: null,
        itemType: 'book',
        displayName: 'Guards! Guards!',
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
    ],
  });
  const catalogLookupService: CatalogLookupService = {
    async search(): Promise<CatalogLookupCandidate[]> {
      return [
        {
          source: 'open-library',
          sourceId: '/works/OL999W',
          title: 'El color de la magia',
          summary: 'Terry Pratchett · 1983',
          importedData: {
            originalName: 'The Colour of Magic',
            description: null,
            language: 'SPA',
            publisher: 'Debolsillo',
            publicationYear: 1983,
            externalRefs: {
              openLibraryKey: '/works/OL999W',
              openLibraryUrl: 'https://openlibrary.org/works/OL999W',
            },
            metadata: {
              source: 'open-library',
              author: 'Terry Pratchett',
            },
          },
        },
      ];
    },
  };
  const { context, replies, getCurrentSession } = createContext({ repository, catalogLookupService });

  context.messageText = catalogAdminLabels.create;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.[1]?.[0], catalogAdminLabels.typeBook);

  context.messageText = catalogAdminLabels.typeBook;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'El nom de la rosa';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.equal(getCurrentSession()?.stepKey, 'lookup-choice');
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.[0]?.[0], 'El color de la magia');

  context.messageText = 'El color de la magia';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'lookup-title-choice');

  context.messageText = catalogAdminLabels.useApiTitle;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.flat().includes(catalogAdminLabels.editFieldFamily), true);

  context.messageText = catalogAdminLabels.editFieldFamily;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'family');
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.[0]?.[0], 'Mundodisco');

  context.messageText = 'Mundodisco';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');

  context.messageText = catalogAdminLabels.editFieldGroup;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'group');

  context.messageText = catalogAdminLabels.noGroup;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.confirmCreate;
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.equal(getCurrentSession(), null);
  const created = await repository.findItemById(9);
  assert.equal(created?.itemType, 'book');
  assert.equal(created?.displayName, 'El color de la magia');
  assert.equal(created?.familyId, 1);
  assert.equal(created?.publisher, 'Debolsillo');
});

test('handleTelegramCatalogAdminText offers Open Library matches for rpg books and imports the selected one on confirmation', async () => {
  const lookupCalls: Array<{ itemType: string; query: string }> = [];
  const catalogLookupService: CatalogLookupService = {
    async search(input) {
      lookupCalls.push(input);
      return [
        {
          source: 'open-library',
          sourceId: '/works/OL123W',
          title: 'Player\'s Handbook',
          summary: 'Wizards RPG Team · Wizards of the Coast · 2024',
          importedData: {
            originalName: 'Player\'s Handbook: 2024 Edition',
            description: null,
            language: 'ENG',
            publisher: 'Wizards of the Coast',
            publicationYear: 2024,
            externalRefs: {
              openLibraryKey: '/works/OL123W',
              openLibraryUrl: 'https://openlibrary.org/works/OL123W',
            },
            metadata: {
              source: 'open-library',
              author: 'Wizards RPG Team',
            },
          },
        },
        {
          source: 'open-library',
          sourceId: '/works/OL456W',
          title: 'Player\'s Handbook Alt',
          summary: 'Alternate · 2014',
          importedData: {
            originalName: 'Player\'s Handbook Alt',
            description: null,
            language: 'ENG',
            publisher: 'Alternate Publisher',
            publicationYear: 2014,
            externalRefs: { openLibraryKey: '/works/OL456W', openLibraryUrl: 'https://openlibrary.org/works/OL456W' },
            metadata: { source: 'open-library' },
          },
        },
      ];
    },
  };
  const { context, replies, getCurrentSession } = createContext({ catalogLookupService });

  context.messageText = catalogAdminLabels.create;
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.typeRpgBook;
  await handleTelegramCatalogAdminText(context);
  context.messageText = 'Manual del jugador (2024)';
  await handleTelegramCatalogAdminText(context);

  assert.deepEqual(lookupCalls, [{ itemType: 'rpg-book', query: 'Manual del jugador (2024)' }]);
  assert.equal(getCurrentSession()?.stepKey, 'lookup-choice');
  assert.match(replies.at(-1)?.message ?? '', /He trobat aquestes coincidencies/);
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.[0]?.[0], 'Player\'s Handbook');

  context.messageText = 'Player\'s Handbook';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'lookup-title-choice');
  assert.match(replies.at(-1)?.message ?? '', /no coincideix exactament/);

  context.messageText = catalogAdminLabels.keepTypedTitle;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.flat().includes(catalogAdminLabels.editFieldFamily), true);

  context.messageText = catalogAdminLabels.editFieldFamily;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'family');
  context.messageText = 'Dungeons and Dragons 5';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');
  context.messageText = catalogAdminLabels.editFieldGroup;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'group');
  context.messageText = catalogAdminLabels.noGroup;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.confirmCreate;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /Item de cataleg creat correctament: Manual del jugador \(2024\)/);
});

test('handleTelegramCatalogAdminText lets lookup results be refined by author text', async () => {
  const lookupCalls: Array<{ itemType: string; query: string; author?: string }> = [];
  const catalogLookupService: CatalogLookupService = {
    async search(input) {
      lookupCalls.push(input);
      if (!input.author) {
        return [
          {
            source: 'open-library',
            sourceId: '/works/OL1W',
            title: 'The Very Hungry Caterpillar',
            summary: 'Eric Carle · 1969',
            importedData: {
              originalName: 'The Very Hungry Caterpillar',
              description: null,
              language: 'ENG',
              publisher: 'World Publishing',
              publicationYear: 1969,
              externalRefs: { openLibraryKey: '/works/OL1W', openLibraryUrl: 'https://openlibrary.org/works/OL1W' },
              metadata: { source: 'open-library', author: 'Eric Carle' },
            },
          },
        ];
      }
      return [
        {
          source: 'open-library',
          sourceId: '/works/OLEricW',
          title: 'Eric',
          summary: 'Terry Pratchett · 1990',
          importedData: {
            originalName: 'Eric',
            description: null,
            language: 'ENG',
            publisher: 'Victor Gollancz',
            publicationYear: 1990,
            externalRefs: { openLibraryKey: '/works/OLEricW', openLibraryUrl: 'https://openlibrary.org/works/OLEricW' },
            metadata: { source: 'open-library', author: 'Terry Pratchett' },
          },
        },
      ];
    },
  };
  const repository = createRepository();
  const { context, getCurrentSession, replies } = createContext({ repository, catalogLookupService });

  context.messageText = catalogAdminLabels.create;
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.typeBook;
  await handleTelegramCatalogAdminText(context);
  context.messageText = 'Eric';
  await handleTelegramCatalogAdminText(context);

  assert.equal(getCurrentSession()?.stepKey, 'lookup-choice');
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.at(-3)?.[0], catalogAdminLabels.refineLookupByAuthor);

  context.messageText = 'Terry Pratchett';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.deepEqual(lookupCalls, [
    { itemType: 'book', query: 'Eric' },
    { itemType: 'book', query: 'Eric', author: 'Terry Pratchett' },
  ]);
  assert.equal(getCurrentSession()?.stepKey, 'lookup-choice');
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.[0]?.[0], 'Eric');
});

test('handleTelegramCatalogAdminText creates an rpg book with minimum fields when Open Library is skipped', async () => {
  const repository = createRepository();
  const catalogLookupService: CatalogLookupService = {
    async search(): Promise<CatalogLookupCandidate[]> {
      return [
        {
          source: 'open-library',
          sourceId: '/works/OL123W',
          title: 'Player\'s Handbook',
          summary: 'Wizards RPG Team · Wizards of the Coast · 2024',
          importedData: {
            originalName: 'Player\'s Handbook',
            description: null,
            language: 'ENG',
            publisher: 'Wizards of the Coast',
            publicationYear: 2024,
            externalRefs: { openLibraryKey: '/works/OL123W', openLibraryUrl: 'https://openlibrary.org/works/OL123W' },
            metadata: { source: 'open-library' },
          },
        },
      ];
    },
  };
  const { context, getCurrentSession } = createContext({ repository, catalogLookupService });

  context.messageText = catalogAdminLabels.create;
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.typeRpgBook;
  await handleTelegramCatalogAdminText(context);
  context.messageText = 'Manual del jugador';
  await handleTelegramCatalogAdminText(context);
  context.messageText = 'No importar dades';
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.editFieldFamily;

  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'family');

  context.messageText = catalogAdminLabels.noFamily;

  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');
  context.messageText = catalogAdminLabels.editFieldGroup;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'group');
  context.messageText = catalogAdminLabels.noGroup;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.confirmCreate;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession(), null);

  const created = await repository.findItemById(1);
  assert.equal(created?.displayName, 'Manual del jugador');
  assert.equal(created?.originalName, null);
  assert.equal(created?.publisher, null);
  assert.equal(created?.externalRefs, null);
});

test('handleTelegramCatalogAdminText lets rpg books pick a popular family or create a new one by name', async () => {
  const repository = createRepository({
    families: [
      {
        id: 3,
        slug: 'dungeons-and-dragons-5',
        displayName: 'Dungeons and Dragons 5',
        description: null,
        familyKind: 'rpg-line',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
      {
        id: 4,
        slug: 'call-of-cthulhu',
        displayName: 'Call of Cthulhu',
        description: null,
        familyKind: 'rpg-line',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
    ],
    items: [
      {
        id: 20,
        familyId: 3,
        groupId: null,
        itemType: 'rpg-book',
        displayName: 'Players Handbook',
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
      {
        id: 21,
        familyId: 3,
        groupId: null,
        itemType: 'rpg-book',
        displayName: 'Monster Manual',
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
      {
        id: 22,
        familyId: 4,
        groupId: null,
        itemType: 'rpg-book',
        displayName: 'Keeper Rulebook',
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
    ],
  });
  const catalogLookupService: CatalogLookupService = {
    async search() {
      return [];
    },
  };
  const { context, replies, getCurrentSession } = createContext({ repository, catalogLookupService });

  context.messageText = catalogAdminLabels.create;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.typeRpgBook;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Dungeon Master Guide';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.match(replies.at(-1)?.message ?? '', /Camp actualitzat\. Tria un altre camp o guarda els canvis\./);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');

  context.messageText = catalogAdminLabels.editFieldFamily;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Escriu o tria una familia/);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard?.[0], ['Dungeons and Dragons 5', 'Call of Cthulhu']);
  assert.equal(buttonText(replies.at(-1)?.options?.replyKeyboard?.at(-2)?.[0] as string | { text: string }), catalogAdminLabels.noFamily);

  context.messageText = 'Dungeons and Dragons 5';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');

  context.messageText = catalogAdminLabels.editFieldGroup;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'group');

  context.messageText = catalogAdminLabels.noGroup;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.confirmCreate;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession(), null);

  const createdWithExistingFamily = (await repository.listItems({ includeDeactivated: true }))
    .find((item) => item.displayName === 'Dungeon Master Guide');
  assert.equal(createdWithExistingFamily?.familyId, 3);
  assert.equal(createdWithExistingFamily?.groupId, null);

  context.messageText = catalogAdminLabels.create;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.typeRpgBook;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Xanathar Guide';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.editFieldFamily;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Shadowdark RPG';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');

  context.messageText = catalogAdminLabels.editFieldGroup;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'group');

  context.messageText = catalogAdminLabels.noGroup;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.confirmCreate;
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  const families = await repository.listFamilies();
  const createdFamily = families.find((family) => family.displayName === 'Shadowdark RPG');
  assert.ok(createdFamily);
  assert.equal(createdFamily.familyKind, 'rpg-line');
  assert.equal(getCurrentSession(), null);
});

test('handleTelegramCatalogAdminCallback edits items through a field menu and deactivates them afterwards', async () => {
  const repository = createRepository({
    items: [
      {
        id: 3,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Root',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const auditRepository = createAuditRepository();
  const { context, replies } = createContext({ repository, auditRepository });

  context.callbackData = `${catalogAdminCallbackPrefixes.edit}3`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  delete context.callbackData;
  assert.match(replies.at(-1)?.message ?? '', /Tria un camp del teclat o guarda els canvis quan hagis acabat/);

  context.messageText = catalogAdminLabels.editFieldDisplayName;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Root Deluxe';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  context.messageText = catalogAdminLabels.editFieldPublisher;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Leder Games';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  context.messageText = catalogAdminLabels.editFieldRecommendedAge;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = '10';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  context.messageText = catalogAdminLabels.editFieldPlayTimeMinutes;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = '90';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  context.messageText = catalogAdminLabels.editFieldExternalRefs;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = '{"bggId":1234}';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  context.messageText = catalogAdminLabels.editFieldMetadata;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = '{"complexity":"medium"}';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  context.messageText = 'Guardar canvis';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.equal((await repository.findItemById(3))?.displayName, 'Root Deluxe');
  assert.equal((await repository.findItemById(3))?.publisher, 'Leder Games');
  assert.equal((await repository.findItemById(3))?.playerCountMin, 2);
  assert.equal((await repository.findItemById(3))?.playerCountMax, 4);
  assert.equal((await repository.findItemById(3))?.recommendedAge, 10);
  assert.equal((await repository.findItemById(3))?.playTimeMinutes, 90);
  assert.deepEqual((await repository.findItemById(3))?.externalRefs, { bggId: 1234 });
  assert.deepEqual((await repository.findItemById(3))?.metadata, { complexity: 'medium' });
  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'catalog.item.updated');

  context.callbackData = `${catalogAdminCallbackPrefixes.deactivate}3`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  delete context.callbackData;
  context.messageText = catalogAdminLabels.confirmDeactivate;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal((await repository.findItemById(3))?.lifecycleStatus, 'deactivated');
  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'catalog.item.deactivated');
});

test('handleTelegramCatalogAdminText skips player prompts for books and clears legacy player counts on edit', async () => {
  const repository = createRepository({
    items: [
      {
        id: 5,
        familyId: null,
        groupId: null,
        itemType: 'book',
        displayName: 'Mort',
        originalName: null,
        description: null,
        language: null,
        publisher: 'Mai Mes',
        publicationYear: 2020,
        playerCountMin: 1,
        playerCountMax: 2,
        recommendedAge: null,
        playTimeMinutes: 180,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const { context, replies } = createContext({ repository });

  context.callbackData = `${catalogAdminCallbackPrefixes.edit}5`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  delete context.callbackData;
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Jugadors/);

  context.messageText = 'Guardar canvis';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Jugadors:/);

  assert.equal((await repository.findItemById(5))?.playerCountMin, null);
  assert.equal((await repository.findItemById(5))?.playerCountMax, null);
});

test('handleTelegramCatalogAdminText shows category browse and loan state', async () => {
  const repository = createRepository({
    families: [
      {
        id: 7,
        slug: 'arkham-horror',
        displayName: 'Arkham Horror',
        description: null,
        familyKind: 'board-game-line',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
    ],
    groups: [
      {
        id: 11,
        familyId: 7,
        slug: 'second-edition',
        displayName: 'Second Edition',
        description: 'Base i expansions',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
    ],
    items: [
      {
        id: 3,
        familyId: 7,
        groupId: 11,
        itemType: 'board-game',
        displayName: 'Arkham Horror Core Set',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 1,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
      {
        id: 4,
        familyId: 7,
        groupId: 11,
        itemType: 'board-game',
        displayName: 'Dunwich Companion',
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
      {
        id: 5,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Azul',
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
    ],
  });
  const catalogLoanRepository = createLoanRepository([
    {
      id: 21,
      itemId: 4,
      borrowerTelegramUserId: 77,
      borrowerDisplayName: 'Usuari 77',
      loanedByTelegramUserId: 99,
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
      telegramUserId: 77,
      displayName: 'Anna',
      status: 'approved',
      isAdmin: false,
    },
  ]);
  const { context, replies } = createContext({ repository, catalogLoanRepository, membershipRepository });

  context.messageText = catalogAdminLabels.listBoardGames;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Items de cataleg:/);
  assert.match(replies.at(-1)?.message ?? '', /Grup: Second Edition/);
  assert.match(replies.at(-1)?.message ?? '', /------/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Arkham Horror Core Set<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /<i>Disponible<\/i>/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Azul<\/b>/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Sin familia/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /#\d+/);
  assert.ok(replies.at(-1)?.options?.replyKeyboard?.flat().includes(catalogAdminLabels.searchByName));
  assert.ok(replies.at(-1)?.options?.inlineKeyboard?.flat().some((button) => button.callbackData === `${catalogAdminCallbackPrefixes.inspectGroup}11`));

  context.callbackData = `${catalogAdminCallbackPrefixes.browseFamily}7`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /<b>Categoria:<\/b> Arkham Horror/);
  assert.match(replies.at(-1)?.message ?? '', /Arkham Horror Core Set/);
  assert.equal(replies.at(-1)?.options?.inlineKeyboard?.flat().find((button) => button.text === 'Arkham Horror Core Set')?.callbackData, `${catalogAdminCallbackPrefixes.inspect}3`);
  assert.ok(replies.at(-1)?.options?.inlineKeyboard?.flat().some((button) => button.text === 'Azul'));

  context.callbackData = `${catalogAdminCallbackPrefixes.inspect}4`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /<b>Grup:<\/b> Second Edition/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Té:<\/b> Anna/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Des de:<\/b> 04\/04\/2026/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Sense valor/);
  assert.ok(replies.at(-1)?.options?.inlineKeyboard?.flat().some((button) => button.text === 'Retornar'));

  context.callbackData = `${catalogAdminCallbackPrefixes.inspect}5`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /<b>Azul<\/b>/);
});

test('handleTelegramCatalogAdminCallback shows item details without add media action', async () => {
  const repository = createRepository({
    items: [
      {
        id: 3,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Root',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const auditRepository = createAuditRepository();
  const { context, replies, getCurrentSession } = createContext({ repository, auditRepository, language: 'es' });

  context.callbackData = `${catalogAdminCallbackPrefixes.inspect}3`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Media:/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Descripcio:/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Sense valor/);
  const buttons = replies.at(-1)?.options?.inlineKeyboard?.flat() ?? [];
  assert.ok(buttons.some((button) => button.callbackData === `${catalogAdminCallbackPrefixes.edit}3`));
  assert.ok(buttons.some((button) => button.callbackData === `${catalogAdminCallbackPrefixes.createActivity}3`));
  assert.ok(buttons.some((button) => button.callbackData === `${catalogAdminCallbackPrefixes.deactivate}3`));
  assert.ok(buttons.some((button) => button.callbackData === 'catalog_loan:create:3'));
  assert.ok(buttons.some((button) => button.callbackData === 'catalog_loan:my_loans'));
  assert.ok(!buttons.some((button) => button.text === 'Afegir media'));
});

test('handleTelegramCatalogAdminCallback starts activity creation from a board game detail', async () => {
  const repository = createRepository({
    items: [
      {
        id: 3,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Root',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const { context, replies, getCurrentSession } = createContext({ repository, language: 'es' });

  context.callbackData = `${catalogAdminCallbackPrefixes.createActivity}3`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);

  assert.deepEqual(getCurrentSession(), {
    flowKey: 'schedule-create',
    stepKey: 'date',
    data: { title: 'Root' },
  });
  assert.match(replies.at(-1)?.message ?? '', /Escribe la fecha de inicio/i);
  assert.equal(replies.at(-1)?.options?.resizeKeyboard, true);
  assert.equal(replies.at(-1)?.options?.persistentKeyboard, true);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard?.at(-2), ['Volver']);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard?.at(-1), [dangerButton('/cancel')]);
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.slice(0, 3).every((row) => row.length === 2), true);
});

test('handleTelegramCatalogAdminCallback hides admin-only item actions for approved non-admin members', async () => {
  const repository = createRepository({
    items: [
      {
        id: 3,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Root',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
    media: [
      {
        id: 8,
        familyId: null,
        itemId: 3,
        mediaType: 'image',
        url: 'https://example.com/root.png',
        altText: 'Root cover',
        sortOrder: 0,
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
    ],
  });
  const { context, replies } = createContext({ repository, isAdmin: false, language: 'es' });

  context.callbackData = `${catalogAdminCallbackPrefixes.inspect}3`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);

  const buttons = replies.at(-1)?.options?.inlineKeyboard?.flat() ?? [];
  assert.ok(!buttons.some((button) => button.callbackData === `${catalogAdminCallbackPrefixes.edit}3`));
  assert.ok(!buttons.some((button) => button.callbackData === `${catalogAdminCallbackPrefixes.deactivate}3`));
  assert.ok(!buttons.some((button) => button.callbackData === `${catalogAdminCallbackPrefixes.editMedia}8`));
  assert.ok(!buttons.some((button) => button.callbackData === `${catalogAdminCallbackPrefixes.deleteMedia}8`));
  assert.ok(buttons.some((button) => button.callbackData === 'catalog_loan:create:3'));
  assert.ok(buttons.some((button) => button.callbackData === 'catalog_loan:my_loans'));
});

test('handleTelegramCatalogAdminCallback blocks non-admin edit and deactivate actions', async () => {
  const repository = createRepository({
    items: [
      {
        id: 3,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Root',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const { context, replies, getCurrentSession } = createContext({ repository, isAdmin: false });

  context.callbackData = `${catalogAdminCallbackPrefixes.edit}3`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /nomes esta disponible per a administradors del club/i);
  assert.equal(getCurrentSession(), null);

  context.callbackData = `${catalogAdminCallbackPrefixes.deactivate}3`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /nomes esta disponible per a administradors del club/i);
  assert.equal(getCurrentSession(), null);
});

test('handleTelegramCatalogAdminCallback lets admins edit and delete item media', async () => {
  const repository = createRepository({
    items: [
      {
        id: 3,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Root',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
    media: [
      {
        id: 8,
        familyId: null,
        itemId: 3,
        mediaType: 'image',
        url: 'https://example.com/root.jpg',
        altText: 'Portada',
        sortOrder: 0,
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
    ],
  });
  const auditRepository = createAuditRepository();
  const { context, replies, getCurrentSession } = createContext({ repository, auditRepository });

  context.callbackData = 'catalog_admin:edit_media:8';
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  delete context.callbackData;
  assert.equal(getCurrentSession()?.stepKey, 'media-type');

  context.messageText = 'Enllac';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'https://example.com/root';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Fitxa actualitzada';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = '3';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Guardar canvis media';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession(), null);
  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'catalog.media.updated');

  context.callbackData = `${catalogAdminCallbackPrefixes.inspect}3`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /link · https:\/\/example.com\/root/);

  context.callbackData = 'catalog_admin:delete_media:8';
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  delete context.callbackData;
  context.messageText = 'Confirmar eliminacio media';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'catalog.media.deleted');

  context.callbackData = `${catalogAdminCallbackPrefixes.inspect}3`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Media:/);
});

test('handleTelegramCatalogAdminText hides deactivated items from the normal catalog list', async () => {
  const repository = createRepository({
    items: [
      {
        id: 1,
        familyId: null,
        groupId: null,
        itemType: 'rpg-book',
        displayName: 'Actiu',
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
      {
        id: 2,
        familyId: null,
        groupId: null,
        itemType: 'rpg-book',
        displayName: 'Desactivat',
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
        lifecycleStatus: 'deactivated',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T12:00:00.000Z',
        deactivatedAt: '2026-04-04T12:00:00.000Z',
      },
    ],
  });
  const { context, replies } = createContext({ repository });

  context.messageText = catalogAdminLabels.list;
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Items de cataleg:/);
  assert.match(replies.at(-1)?.message ?? '', /Sense grup/);
  assert.match(replies.at(-1)?.message ?? '', /------/);
  assert.match(replies.at(-1)?.message ?? '', /<a href="https:\/\/t\.me\/cawatest_bot\?start=catalog_admin_item_1"><b>Actiu<\/b><\/a> · <i>Llibre RPG · Disponible<\/i>/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /#\d+/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Desactivat/);
});

test('handleTelegramCatalogAdminText groups standalone items under their family instead of Sense grup', async () => {
  const repository = createRepository({
    families: [
      {
        id: 1,
        slug: 'mundodisco',
        displayName: 'Mundodisco',
        description: null,
        familyKind: 'generic-line',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
    ],
    items: [
      {
        id: 2,
        familyId: 1,
        groupId: null,
        itemType: 'book',
        displayName: 'El color de la magia',
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
      {
        id: 3,
        familyId: 1,
        groupId: null,
        itemType: 'book',
        displayName: 'Mort',
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
    ],
  });
  const catalogLoanRepository = createLoanRepository([
    {
      id: 21,
      itemId: 3,
      borrowerTelegramUserId: 77,
      borrowerDisplayName: 'Anna',
      loanedByTelegramUserId: 99,
      dueAt: '2026-04-10T00:00:00.000Z',
      notes: null,
      returnedAt: null,
      returnedByTelegramUserId: null,
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
    },
  ]);
  const { context, replies } = createContext({ repository, catalogLoanRepository });

  context.messageText = catalogAdminLabels.openMenu;
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Items de cataleg:/);
  assert.match(replies.at(-1)?.message ?? '', /Familia: Mundodisco/);
  assert.match(replies.at(-1)?.message ?? '', /------/);
  assert.match(replies.at(-1)?.message ?? '', /<a href="https:\/\/t\.me\/cawatest_bot\?start=catalog_admin_item_2"><b>El color de la magia<\/b><\/a>/);
  assert.match(replies.at(-1)?.message ?? '', /<i>Llibre · Disponible<\/i>/);
  assert.match(replies.at(-1)?.message ?? '', /<a href="https:\/\/t\.me\/cawatest_bot\?start=catalog_admin_item_3"><b>Mort<\/b><\/a>/);
  assert.match(replies.at(-1)?.message ?? '', /<i>Llibre · Prestat a Anna · des de 04\/04\/2026<\/i>/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /#\d+/);
  assert.ok(replies.at(-1)?.options?.replyKeyboard?.flat().includes(catalogAdminLabels.searchByName));
  assert.equal(replies.at(-1)?.options?.inlineKeyboard?.flat().find((button) => button.text === 'El color de la magia')?.callbackData, `${catalogAdminCallbackPrefixes.inspect}2`);
  assert.equal(replies.at(-1)?.options?.inlineKeyboard?.flat().find((button) => button.text === 'Mort')?.callbackData, `${catalogAdminCallbackPrefixes.inspect}3`);

  context.callbackData = `${catalogAdminCallbackPrefixes.browseFamily}1`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /<b>Categoria:<\/b> Mundodisco/);
  assert.match(replies.at(-1)?.message ?? '', /Prestat a Anna/);
  assert.match(replies.at(-1)?.message ?? '', /des de 04\/04\/2026/);
  assert.ok(replies.at(-1)?.options?.inlineKeyboard?.flat().some((button) => button.text === 'Prendre prestat' || button.text === 'Retornar'));
});

test('handleTelegramCatalogAdminText can search catalog items by name', async () => {
  const repository = createRepository({
    families: [
      {
        id: 1,
        slug: 'mundodisco',
        displayName: 'Mundodisco',
        description: null,
        familyKind: 'generic-line',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
    ],
    items: [
      {
        id: 2,
        familyId: 1,
        groupId: null,
        itemType: 'book',
        displayName: 'El color de la magia',
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
      {
        id: 3,
        familyId: 1,
        groupId: null,
        itemType: 'book',
        displayName: 'Mort',
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
    ],
  });
  const catalogLoanRepository = createLoanRepository([
    {
      id: 31,
      itemId: 3,
      borrowerTelegramUserId: 55,
      borrowerDisplayName: 'Pau',
      loanedByTelegramUserId: 99,
      dueAt: null,
      notes: null,
      returnedAt: null,
      returnedByTelegramUserId: null,
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
    },
  ]);
  const { context, replies, getCurrentSession } = createContext({ repository, catalogLoanRepository });

  context.callbackData = catalogAdminCallbackPrefixes.browseSearch;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  delete context.callbackData;
  assert.equal(getCurrentSession()?.stepKey, 'search-query');

  context.messageText = 'Mort';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Resultats per a "Mort"/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Mort<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /<i>Llibre · Prestat a Pau · des de 04\/04\/2026<\/i>/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /#3/);
  assert.equal(replies.at(-1)?.options?.inlineKeyboard?.flat().find((button) => button.text === 'Mort')?.callbackData, `${catalogAdminCallbackPrefixes.inspect}3`);
  assert.ok(replies.at(-1)?.options?.inlineKeyboard?.flat().some((button) => button.text === 'Retornar'));
  assert.ok(!replies.at(-1)?.options?.inlineKeyboard?.flat().some((button) => button.text === 'Prendre prestat'));
});

test('handleTelegramCatalogAdminStartText opens an item detail from deep link payload', async () => {
  const repository = createRepository({
    items: [
      {
        id: 2,
        familyId: null,
        groupId: null,
        itemType: 'book',
        displayName: 'El color de la magia',
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
    ],
  });
  const { context, replies } = createContext({ repository });

  context.messageText = '/start catalog_admin_item_2';
  assert.equal(await handleTelegramCatalogAdminStartText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /<b>El color de la magia<\/b>/);
  const buttons = replies.at(-1)?.options?.inlineKeyboard?.flat() ?? [];
  assert.ok(buttons.some((button) => button.callbackData === `${catalogAdminCallbackPrefixes.edit}2`));
  assert.ok(buttons.some((button) => button.callbackData === `${catalogAdminCallbackPrefixes.deactivate}2`));
  assert.ok(!buttons.some((button) => button.text === 'Editar préstec'));
  assert.ok(!buttons.some((button) => button.text === 'Veure cataleg'));
});

test('handleTelegramCatalogAdminText falls back to minimum-field creation when lookup fails', async () => {
  const repository = createRepository();
  const catalogLookupService: CatalogLookupService = {
    async search() {
      throw new Error('lookup unavailable');
    },
  };
  const { context, getCurrentSession } = createContext({ repository, catalogLookupService });

  context.messageText = catalogAdminLabels.create;
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.typeRpgBook;
  await handleTelegramCatalogAdminText(context);
  context.messageText = 'Monster Manual';
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.editFieldFamily;

  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'family');

  context.messageText = catalogAdminLabels.noFamily;

  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');
  context.messageText = catalogAdminLabels.editFieldGroup;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'group');
  context.messageText = catalogAdminLabels.noGroup;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  for (let step = 0; step < 11; step += 1) {
    context.messageText = catalogAdminLabels.skipOptional;
    assert.equal(await handleTelegramCatalogAdminText(context), true);
  }
  context.messageText = catalogAdminLabels.confirmCreate;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession(), null);

  const created = await repository.findItemById(1);
  assert.equal(created?.displayName, 'Monster Manual');
  assert.equal(created?.publisher, null);
  assert.equal(created?.externalRefs, null);
});
