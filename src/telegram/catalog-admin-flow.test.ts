import test from 'node:test';
import assert from 'node:assert/strict';

import type { AuditLogEventRecord, AuditLogRepository } from '../audit/audit-log.js';
import type { CatalogLookupCandidate, CatalogLookupService } from '../catalog/catalog-lookup-service.js';
import type {
  CatalogFamilyRecord,
  CatalogGroupRecord,
  CatalogItemRecord,
  CatalogMediaRecord,
  CatalogRepository,
} from '../catalog/catalog-model.js';
import type { ConversationSessionRecord } from './conversation-session.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import {
  catalogAdminCallbackPrefixes,
  catalogAdminLabels,
  handleTelegramCatalogAdminCallback,
  handleTelegramCatalogAdminText,
  type TelegramCatalogAdminContext,
} from './catalog-admin-flow.js';

function createRepository({
  families = [],
  groups = [],
  items = [],
}: {
  families?: CatalogFamilyRecord[];
  groups?: CatalogGroupRecord[];
  items?: CatalogItemRecord[];
} = {}): CatalogRepository {
  const familyMap = new Map(families.map((family) => [family.id, family]));
  const groupMap = new Map(groups.map((group) => [group.id, group]));
  const itemMap = new Map(items.map((item) => [item.id, item]));
  let nextFamilyId = Math.max(0, ...families.map((family) => family.id)) + 1;
  let nextItemId = Math.max(0, ...items.map((item) => item.id)) + 1;

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
      return {
        id: 1,
        familyId: input.familyId,
        itemId: input.itemId,
        mediaType: input.mediaType,
        url: input.url,
        altText: input.altText,
        sortOrder: input.sortOrder,
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      };
    },
    async listMedia() {
      return [];
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

function createContext({
  repository = createRepository(),
  auditRepository = createAuditRepository(),
  catalogLookupService,
  isAdmin = true,
}: {
  repository?: CatalogRepository;
  auditRepository?: AuditLogRepository;
  catalogLookupService?: CatalogLookupService;
  isAdmin?: boolean;
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
      bot: { publicName: 'Game Club Bot', clubName: 'Game Club', language: 'ca', sendPrivateMessage: async () => {} },
    },
    catalogRepository: repository,
    auditRepository,
    ...(catalogLookupService ? { catalogLookupService } : {}),
  };

  return { context, replies, getCurrentSession: () => currentSession };
}

test('handleTelegramCatalogAdminText opens the catalog admin menu', async () => {
  const { context, replies } = createContext();
  context.messageText = catalogAdminLabels.openMenu;

  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(replies.at(-1)?.message, 'Gestio de cataleg: tria una accio.');
});

test('handleTelegramCatalogAdminText creates a board game with only the minimum fields', async () => {
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
  const { context, getCurrentSession, replies } = createContext({ repository, auditRepository });

  context.messageText = catalogAdminLabels.create;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.typeBoardGame;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Root';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Arkham Horror';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /Item de cataleg creat correctament: Root/);
  const created = await repository.findItemById(1);
  assert.equal(created?.displayName, 'Root');
  assert.equal(created?.itemType, 'board-game');
  assert.equal(created?.familyId, 7);
  assert.equal(created?.groupId, null);
  assert.equal(created?.publisher, null);
  assert.equal(created?.recommendedAge, null);
  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'catalog.item.created');
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
  assert.equal(getCurrentSession()?.stepKey, 'family');
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.[0]?.[0], 'Mundodisco');

  context.messageText = 'Mundodisco';
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
  assert.equal(getCurrentSession()?.stepKey, 'family');
  context.messageText = 'Dungeons and Dragons 5';
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
  context.messageText = catalogAdminLabels.noFamily;

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

  assert.match(replies.at(-1)?.message ?? '', /Escriu o tria una familia/);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard?.[0], ['Dungeons and Dragons 5', 'Call of Cthulhu']);
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.at(-2)?.[0], catalogAdminLabels.noFamily);

  context.messageText = 'Dungeons and Dragons 5';
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
  context.messageText = 'Shadowdark RPG';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  const families = await repository.listFamilies();
  const createdFamily = families.find((family) => family.displayName === 'Shadowdark RPG');
  assert.ok(createdFamily);
  assert.equal(createdFamily.familyKind, 'rpg-line');
  assert.equal(getCurrentSession(), null);
});

test('handleTelegramCatalogAdminCallback edits and deactivates existing items', async () => {
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
  const { context } = createContext({ repository, auditRepository });

  context.callbackData = `${catalogAdminCallbackPrefixes.edit}3`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  delete context.callbackData;
  context.messageText = 'Root Deluxe';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Leder Games';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = '2';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = '5';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = '10';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = '90';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = '{"bggId":1234}';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = '{"complexity":"medium"}';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.confirmEdit;
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.equal((await repository.findItemById(3))?.displayName, 'Root Deluxe');
  assert.equal((await repository.findItemById(3))?.publisher, 'Leder Games');
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

test('handleTelegramCatalogAdminText lists grouped catalog items and navigates from group to item detail', async () => {
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
        itemType: 'expansion',
        displayName: 'Dunwich Expansion',
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

  context.messageText = catalogAdminLabels.list;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Grup: Second Edition/);
  assert.match(replies.at(-1)?.message ?? '', /Arkham Horror Core Set/);

  context.callbackData = `${catalogAdminCallbackPrefixes.inspectGroup}11`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Second Edition/);
  assert.match(replies.at(-1)?.message ?? '', /Dunwich Expansion/);

  context.callbackData = `${catalogAdminCallbackPrefixes.inspect}4`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Grup: Second Edition/);
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

  assert.match(replies.at(-1)?.message ?? '', /Actiu/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Desactivat/);
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
  context.messageText = catalogAdminLabels.noFamily;

  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession(), null);

  const created = await repository.findItemById(1);
  assert.equal(created?.displayName, 'Monster Manual');
  assert.equal(created?.publisher, null);
  assert.equal(created?.externalRefs, null);
});
