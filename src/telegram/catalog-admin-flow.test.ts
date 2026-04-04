import test from 'node:test';
import assert from 'node:assert/strict';

import type { AuditLogEventRecord, AuditLogRepository } from '../audit/audit-log.js';
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
  let nextItemId = Math.max(0, ...items.map((item) => item.id)) + 1;

  return {
    async createFamily() {
      throw new Error('not implemented');
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
  isAdmin = true,
}: {
  repository?: CatalogRepository;
  auditRepository?: AuditLogRepository;
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
  };

  return { context, replies, getCurrentSession: () => currentSession };
}

test('handleTelegramCatalogAdminText opens the catalog admin menu', async () => {
  const { context, replies } = createContext();
  context.messageText = catalogAdminLabels.openMenu;

  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(replies.at(-1)?.message, 'Gestio de cataleg: tria una accio.');
});

test('handleTelegramCatalogAdminText creates an item through keyboard-guided steps', async () => {
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
  context.messageText = 'Root';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.typeBoardGame;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.noFamily;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
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
  context.messageText = '2';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = '4';
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
  assert.match(replies.at(-1)?.message ?? '', /Item de cataleg creat correctament: Root/);
  const created = await repository.findItemById(1);
  assert.equal(created?.displayName, 'Root');
  assert.equal(created?.itemType, 'board-game');
  assert.equal(created?.groupId, null);
  assert.equal(created?.publisher, null);
  assert.equal(created?.recommendedAge, null);
  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'catalog.item.created');
});

test('handleTelegramCatalogAdminText keeps the player max step active when the range is invalid', async () => {
  const { context, replies, getCurrentSession } = createContext();

  context.messageText = catalogAdminLabels.create;
  await handleTelegramCatalogAdminText(context);
  context.messageText = 'Root';
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.typeBoardGame;
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.noFamily;
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.noGroup;
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.skipOptional;
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.skipOptional;
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.skipOptional;
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.skipOptional;
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.skipOptional;
  await handleTelegramCatalogAdminText(context);
  context.messageText = '4';
  await handleTelegramCatalogAdminText(context);
  context.messageText = '2';

  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'player-max');
  assert.equal(replies.at(-1)?.message, 'El maxim de jugadors no pot ser inferior al minim. Escriu un enter positiu valid o omet el camp.');
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

test('handleTelegramCatalogAdminText captures extended optional metadata on create', async () => {
  const repository = createRepository();
  const { context } = createContext({ repository });

  context.messageText = catalogAdminLabels.create;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Spirit Island';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.typeBoardGame;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.noFamily;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.noGroup;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Spirit Island';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Cooperatiu de defensa insular';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'CA';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Greater Than Games';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = '2017';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = '1';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = '4';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = '14';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = '120';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = '{"bggId":162886}';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = '{"weight":"high"}';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.confirmCreate;
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  const created = await repository.findItemById(1);
  assert.equal(created?.originalName, 'Spirit Island');
  assert.equal(created?.publisher, 'Greater Than Games');
  assert.equal(created?.recommendedAge, 14);
  assert.equal(created?.playTimeMinutes, 120);
  assert.deepEqual(created?.externalRefs, { bggId: 162886 });
  assert.deepEqual(created?.metadata, { weight: 'high' });
});

test('handleTelegramCatalogAdminText keeps JSON steps active when metadata is invalid', async () => {
  const { context, getCurrentSession, replies } = createContext();

  context.messageText = catalogAdminLabels.create;
  await handleTelegramCatalogAdminText(context);
  context.messageText = 'Root';
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.typeBoardGame;
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.noFamily;
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.noGroup;
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.skipOptional;
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.skipOptional;
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.skipOptional;
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.skipOptional;
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.skipOptional;
  await handleTelegramCatalogAdminText(context);
  context.messageText = '2';
  await handleTelegramCatalogAdminText(context);
  context.messageText = '4';
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.skipOptional;
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.skipOptional;
  await handleTelegramCatalogAdminText(context);
  context.messageText = '[]';

  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'external-refs');
  assert.equal(replies.at(-1)?.message, 'Les referencies externes han de ser un objecte JSON valid o omet el camp.');
});
