import test from 'node:test';
import assert from 'node:assert/strict';

import {
  roleGameMaterialDeliveries,
  roleGameMaterials,
  roleGameMembers,
  roleGames,
  roleGameSessions,
} from '../infrastructure/database/schema.js';
import { requestRoleGameSeat, type CreateRoleGameInput } from './role-game-catalog.js';
import { createDatabaseRoleGameRepository } from './role-game-catalog-store.js';

const roleGamesTable = roleGames as unknown;
const roleGameMembersTable = roleGameMembers as unknown;
const roleGameSessionsTable = roleGameSessions as unknown;
const roleGameMaterialsTable = roleGameMaterials as unknown;
const roleGameMaterialDeliveriesTable = roleGameMaterialDeliveries as unknown;

test('database role game repository creates and reads a campaign with primary GM in one transaction', async (t) => {
  const { database, seedUser, cleanup, steps, memberRows } = createRoleGameStoreFixture();
  t.after(cleanup);
  seedUser(42, 'Máster');

  const repository = createDatabaseRoleGameRepository({ database: database as never });
  const created = await repository.createGame(createCampaignInput());
  const loaded = await repository.findGameById(created.id);
  const primaryGm = memberRows[0];

  assert.equal(created.title, 'Masks of Nyarlathotep');
  assert.equal(loaded?.title, 'Masks of Nyarlathotep');
  assert.equal(primaryGm?.role, 'primary_gm');
  assert.equal(primaryGm?.status, 'confirmed');
  assert.equal(primaryGm?.telegramUserId, 42);
  assert.deepEqual(steps.slice(0, 3), ['transaction:start', 'insert:role_games', 'insert:role_game_members']);
});

test('database role game repository requestSeat auto-confirms until capacity and then waitlists', async (t) => {
  const { database, seedUser, cleanup } = createRoleGameStoreFixture();
  t.after(cleanup);
  seedUser(42, 'Máster');
  seedUser(100, 'Investigadora');
  seedUser(101, 'Ocultista');

  const repository = createDatabaseRoleGameRepository({ database: database as never });
  const game = await repository.createGame({
    ...createCampaignInput(),
    capacity: 1,
    acceptanceMode: 'auto_until_full',
  });

  const first = await requestRoleGameSeat({
    repository,
    gameId: game.id,
    telegramUserId: 100,
    actor: { telegramUserId: 100, isAdmin: false, isApproved: true },
  });
  const second = await requestRoleGameSeat({
    repository,
    gameId: game.id,
    telegramUserId: 101,
    actor: { telegramUserId: 101, isAdmin: false, isApproved: true },
  });

  assert.equal(first.status, 'confirmed');
  assert.equal(second.status, 'waitlisted');
});

test('database role game repository requestSeat uses a row lock before counting confirmed players', async (t) => {
  const { database, seedUser, cleanup, steps } = createRoleGameStoreFixture();
  t.after(cleanup);
  seedUser(42, 'Máster');
  seedUser(100, 'Investigadora');

  const repository = createDatabaseRoleGameRepository({ database: database as never });
  const game = await repository.createGame({
    ...createCampaignInput(),
    capacity: 1,
    acceptanceMode: 'auto_until_full',
  });

  await repository.requestSeat({
    roleGameId: game.id,
    telegramUserId: 100,
    actorTelegramUserId: 100,
    isExternal: false,
  });

  const lockIndex = steps.indexOf('select:role_games:for_update');
  const countIndex = steps.indexOf('count:confirmed_players');
  const insertIndex = steps.lastIndexOf('insert:role_game_members');
  assert.notEqual(lockIndex, -1);
  assert.notEqual(countIndex, -1);
  assert.ok(lockIndex < countIndex);
  assert.ok(countIndex < insertIndex);
});

test('database role game repository requestSeat keeps manual-review requests pending', async (t) => {
  const { database, seedUser, cleanup } = createRoleGameStoreFixture();
  t.after(cleanup);
  seedUser(42, 'Máster');
  seedUser(100, 'Investigadora');

  const repository = createDatabaseRoleGameRepository({ database: database as never });
  const game = await repository.createGame(createCampaignInput());

  const member = await repository.requestSeat({
    roleGameId: game.id,
    telegramUserId: 100,
    actorTelegramUserId: 100,
    isExternal: false,
  });

  assert.equal(member.status, 'requested');
});

test('database role game repository confirms a seat atomically after locking its member and game', async (t) => {
  const { database, seedUser, cleanup, steps } = createRoleGameStoreFixture();
  t.after(cleanup);
  seedUser(42, 'Máster');
  seedUser(100, 'Investigadora');

  const repository = createDatabaseRoleGameRepository({ database: database as never });
  const game = await repository.createGame(createCampaignInput({ capacity: 2 }));
  const requested = await repository.createMember({
    roleGameId: game.id,
    telegramUserId: 100,
    role: 'player',
    status: 'requested',
    isExternal: false,
    requestedByTelegramUserId: 100,
  });
  steps.length = 0;

  const confirmed = await repository.confirmMemberSeat({
    memberId: requested.id,
    actorTelegramUserId: 42,
    expectedStatuses: ['requested'],
  });

  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.requestedByTelegramUserId, 42);
  const memberLockIndex = steps.indexOf('select:role_game_members:for_update');
  const gameLockIndex = steps.indexOf('select:role_games:for_update');
  const countIndex = steps.indexOf('count:confirmed_players');
  const updateIndex = steps.indexOf('update:role_game_members');
  assert.notEqual(memberLockIndex, -1);
  assert.notEqual(gameLockIndex, -1);
  assert.notEqual(countIndex, -1);
  assert.notEqual(updateIndex, -1);
  assert.ok(memberLockIndex < gameLockIndex);
  assert.ok(gameLockIndex < countIndex);
  assert.ok(countIndex < updateIndex);
});

test('database role game repository leaves a stale member row unchanged', async (t) => {
  const { database, seedUser, cleanup, steps } = createRoleGameStoreFixture();
  t.after(cleanup);
  seedUser(42, 'Máster');
  seedUser(100, 'Investigadora');

  const repository = createDatabaseRoleGameRepository({ database: database as never });
  const game = await repository.createGame(createCampaignInput());
  const confirmed = await repository.createMember({
    roleGameId: game.id,
    telegramUserId: 100,
    role: 'player',
    status: 'confirmed',
    isExternal: false,
    requestedByTelegramUserId: 100,
  });
  steps.length = 0;

  await assert.rejects(
    repository.confirmMemberSeat({
      memberId: confirmed.id,
      actorTelegramUserId: 42,
      expectedStatuses: ['requested'],
    }),
    /stale status/i,
  );

  assert.equal((await repository.findMemberById(confirmed.id))?.status, 'confirmed');
  assert.equal(steps.includes('update:role_game_members'), false);
});

test('database role game repository changes only confirmed non-primary roles', async (t) => {
  const { database, seedUser, cleanup } = createRoleGameStoreFixture();
  t.after(cleanup);
  seedUser(42, 'Máster');
  seedUser(100, 'Investigadora');
  seedUser(101, 'Ocultista');

  const repository = createDatabaseRoleGameRepository({ database: database as never });
  const game = await repository.createGame(createCampaignInput());
  const primaryGm = await repository.findMemberByTelegramUserId(game.id, 42);
  assert.ok(primaryGm);
  const player = await repository.createMember({
    roleGameId: game.id,
    telegramUserId: 100,
    role: 'player',
    status: 'confirmed',
    isExternal: false,
    requestedByTelegramUserId: 42,
  });
  const unconfirmed = await repository.createMember({
    roleGameId: game.id,
    telegramUserId: 101,
    role: 'player',
    status: 'requested',
    isExternal: false,
    requestedByTelegramUserId: 101,
  });

  const promoted = await repository.setMemberRole({
    memberId: player.id,
    role: 'coorganizer',
    expectedRole: 'player',
    expectedStatus: 'confirmed',
    actorTelegramUserId: 42,
  });
  assert.equal(promoted.role, 'coorganizer');
  await assert.rejects(
    repository.setMemberRole({
      memberId: primaryGm.id,
      role: 'player',
      expectedRole: 'primary_gm',
      expectedStatus: 'confirmed',
      actorTelegramUserId: 42,
    }),
    /stale status/i,
  );
  await assert.rejects(
    repository.setMemberRole({
      memberId: unconfirmed.id,
      role: 'coorganizer',
      expectedRole: 'player',
      expectedStatus: 'confirmed',
      actorTelegramUserId: 42,
    }),
    /stale status/i,
  );
  assert.equal((await repository.findMemberById(primaryGm.id))?.role, 'primary_gm');
  assert.equal((await repository.findMemberById(unconfirmed.id))?.role, 'player');
});

test('database role game repository rejects a demotion when confirmed player capacity is full', async (t) => {
  const { database, seedUser, cleanup, steps } = createRoleGameStoreFixture();
  t.after(cleanup);
  seedUser(42, 'Máster');
  seedUser(100, 'Investigadora');
  seedUser(101, 'Coorganizadora');

  const repository = createDatabaseRoleGameRepository({ database: database as never });
  const game = await repository.createGame(createCampaignInput({ capacity: 1 }));
  await repository.createMember({
    roleGameId: game.id,
    telegramUserId: 100,
    role: 'player',
    status: 'confirmed',
    isExternal: false,
    requestedByTelegramUserId: 42,
  });
  const coorganizer = await repository.createMember({
    roleGameId: game.id,
    telegramUserId: 101,
    role: 'coorganizer',
    status: 'confirmed',
    isExternal: false,
    requestedByTelegramUserId: 42,
  });
  steps.length = 0;

  await assert.rejects(
    repository.setMemberRole({
      memberId: coorganizer.id,
      role: 'player',
      expectedRole: 'coorganizer',
      expectedStatus: 'confirmed',
      actorTelegramUserId: 42,
    }),
    /full/i,
  );

  assert.equal((await repository.findMemberById(coorganizer.id))?.role, 'coorganizer');
  const memberLockIndex = steps.indexOf('select:role_game_members:for_update');
  const gameLockIndex = steps.indexOf('select:role_games:for_update');
  const countIndex = steps.indexOf('count:confirmed_players');
  assert.notEqual(memberLockIndex, -1);
  assert.notEqual(gameLockIndex, -1);
  assert.notEqual(countIndex, -1);
  assert.ok(memberLockIndex < gameLockIndex);
  assert.ok(gameLockIndex < countIndex);
});

test('database role game repository compares expected source status and role before writes', async (t) => {
  const { database, seedUser, cleanup } = createRoleGameStoreFixture();
  t.after(cleanup);
  seedUser(42, 'Máster');
  seedUser(100, 'Investigadora');

  const repository = createDatabaseRoleGameRepository({ database: database as never });
  const game = await repository.createGame(createCampaignInput());
  const player = await repository.createMember({
    roleGameId: game.id,
    telegramUserId: 100,
    role: 'player',
    status: 'confirmed',
    isExternal: false,
    requestedByTelegramUserId: 42,
  });

  await assert.rejects(
    repository.setMemberStatus({
      memberId: player.id,
      status: 'removed',
      expectedStatus: 'requested',
      expectedRole: 'player',
      actorTelegramUserId: 42,
    }),
    /stale status/i,
  );
  await assert.rejects(
    repository.setMemberRole({
      memberId: player.id,
      role: 'coorganizer',
      expectedRole: 'coorganizer',
      expectedStatus: 'confirmed',
      actorTelegramUserId: 42,
    }),
    /stale status/i,
  );

  assert.deepEqual(
    {
      role: (await repository.findMemberById(player.id))?.role,
      status: (await repository.findMemberById(player.id))?.status,
    },
    { role: 'player', status: 'confirmed' },
  );
});

test('database role game repository rejects direct status writes that would create a confirmed seat', async (t) => {
  const { database, seedUser, cleanup } = createRoleGameStoreFixture();
  t.after(cleanup);
  seedUser(42, 'Máster');
  seedUser(100, 'Investigadora');

  const repository = createDatabaseRoleGameRepository({ database: database as never });
  const game = await repository.createGame(createCampaignInput());
  const requested = await repository.createMember({
    roleGameId: game.id,
    telegramUserId: 100,
    role: 'player',
    status: 'requested',
    isExternal: false,
    requestedByTelegramUserId: 100,
  });

  await assert.rejects(repository.setMemberStatus({
    memberId: requested.id,
    status: 'confirmed',
    expectedStatus: 'requested',
    expectedRole: 'player',
    actorTelegramUserId: 42,
  }), /confirmMemberSeat/);
  assert.equal((await repository.findMemberById(requested.id))?.status, 'requested');
});

test('database role game repository updates game metadata and lists visible games for an actor', async (t) => {
  const { database, seedUser, cleanup } = createRoleGameStoreFixture();
  t.after(cleanup);
  seedUser(42, 'Máster');
  seedUser(100, 'Investigadora');
  seedUser(101, 'Visitante');

  const repository = createDatabaseRoleGameRepository({ database: database as never });
  const membersOnly = await repository.createGame(createCampaignInput());
  const publicGame = await repository.createGame({
    ...createCampaignInput(),
    title: 'Aventura abierta',
    visibility: 'public',
    primaryGmTelegramUserId: 42,
  });
  const privateGame = await repository.createGame({
    ...createCampaignInput(),
    title: 'Mesa secreta',
    visibility: 'private',
    primaryGmTelegramUserId: 42,
  });
  await repository.createOrUpdateMember({
    roleGameId: privateGame.id,
    telegramUserId: 100,
    role: 'player',
    status: 'confirmed',
    isExternal: false,
    characterName: 'Irene',
    playerNote: 'Prefiere investigación',
    requestedByTelegramUserId: 100,
  });

  const updated = await repository.updateGame({
    gameId: membersOnly.id,
    title: 'Masks ampliada',
    status: 'paused',
    visibility: 'private',
    capacity: 6,
  });
  const visibleToMember = await repository.listVisibleGames({
    actor: { telegramUserId: 100, isAdmin: false, isApproved: true },
  });
  const visibleToVisitor = await repository.listVisibleGames({
    actor: { telegramUserId: 101, isAdmin: false, isApproved: false },
  });

  assert.equal(updated.title, 'Masks ampliada');
  assert.equal(updated.status, 'paused');
  assert.equal(updated.capacity, 6);
  assert.deepEqual(
    visibleToMember.map((game) => game.id),
    [publicGame.id, privateGame.id],
  );
  assert.deepEqual(
    visibleToVisitor.map((game) => game.id),
    [publicGame.id],
  );
});

test('database role game repository upserts members and lists games for a user', async (t) => {
  const { database, seedUser, cleanup } = createRoleGameStoreFixture();
  t.after(cleanup);
  seedUser(42, 'Máster');
  seedUser(100, 'Investigadora');

  const repository = createDatabaseRoleGameRepository({ database: database as never });
  const game = await repository.createGame(createCampaignInput());
  const created = await repository.createOrUpdateMember({
    roleGameId: game.id,
    telegramUserId: 100,
    role: 'player',
    status: 'requested',
    isExternal: false,
    characterName: null,
    playerNote: null,
    requestedByTelegramUserId: 100,
  });
  const updated = await repository.createOrUpdateMember({
    roleGameId: game.id,
    telegramUserId: 100,
    role: 'player',
    status: 'confirmed',
    isExternal: false,
    characterName: 'Dra. West',
    playerNote: 'Disponible viernes',
    requestedByTelegramUserId: 42,
  });
  const found = await repository.findMember(game.id, 100);
  const foundByAlias = await repository.findMemberByTelegramUserId(game.id, 100);
  const members = await repository.listMembers(game.id);
  const gamesForUser = await repository.listGamesForUser(100);

  assert.equal(updated.id, created.id);
  assert.equal(found?.status, 'confirmed');
  assert.equal(found?.characterName, 'Dra. West');
  assert.equal(foundByAlias?.id, updated.id);
  assert.deepEqual(
    members.map((member) => member.telegramUserId),
    [42, 100],
  );
  assert.deepEqual(
    gamesForUser.map((listedGame) => listedGame.id),
    [game.id],
  );
});

test('database role game repository prefers active membership over later history rows', async (t) => {
  const { database, seedUser, cleanup } = createRoleGameStoreFixture();
  t.after(cleanup);
  seedUser(42, 'Máster');
  seedUser(100, 'Investigadora');

  const repository = createDatabaseRoleGameRepository({ database: database as never });
  const privateGame = await repository.createGame({
    ...createCampaignInput(),
    visibility: 'private',
  });
  const active = await repository.createMember({
    roleGameId: privateGame.id,
    telegramUserId: 100,
    role: 'player',
    status: 'confirmed',
    isExternal: false,
    characterName: 'Dra. West',
    playerNote: null,
    requestedByTelegramUserId: 42,
  });
  await repository.createMember({
    roleGameId: privateGame.id,
    telegramUserId: 100,
    role: 'player',
    status: 'left',
    isExternal: false,
    characterName: null,
    playerNote: null,
    requestedByTelegramUserId: 100,
  });

  const found = await repository.findMember(privateGame.id, 100);
  const visibleGames = await repository.listVisibleGames({
    actor: { telegramUserId: 100, isAdmin: false, isApproved: false },
  });
  const gamesForUser = await repository.listGamesForUser(100);

  assert.equal(found?.id, active.id);
  assert.equal(found?.status, 'confirmed');
  assert.deepEqual(
    visibleGames.map((game) => game.id),
    [privateGame.id],
  );
  assert.deepEqual(
    gamesForUser.map((game) => game.id),
    [privateGame.id],
  );
});

test('database role game repository creates and lists session links', async (t) => {
  const { database, seedUser, cleanup } = createRoleGameStoreFixture();
  t.after(cleanup);
  seedUser(42, 'Máster');

  const repository = createDatabaseRoleGameRepository({ database: database as never });
  const game = await repository.createGame(createCampaignInput());
  const link = await repository.createSessionLink({
    roleGameId: game.id,
    scheduleEventId: 9001,
    source: 'manual',
    generatedForStartsAt: '2026-07-20T17:00:00.000Z',
    createdByTelegramUserId: 42,
  });
  const links = await repository.listSessionLinks(game.id);

  assert.equal(link.scheduleEventId, 9001);
  assert.equal(link.generatedForStartsAt, '2026-07-20T17:00:00.000Z');
  assert.deepEqual(
    links.map((listedLink) => listedLink.id),
    [link.id],
  );
});

test('database role game repository creates materials, reveals visibility and records deliveries', async (t) => {
  const { database, seedUser, cleanup } = createRoleGameStoreFixture();
  t.after(cleanup);
  seedUser(42, 'Máster');
  seedUser(100, 'Investigadora');

  const repository = createDatabaseRoleGameRepository({ database: database as never });
  const game = await repository.createGame(createCampaignInput());
  const material = await repository.createMaterial({
    roleGameId: game.id,
    internalStorageEntryId: 7001,
    title: 'Pista del sótano',
    description: 'Sólo visible tras la escena inicial',
    visibility: 'gm_only',
    deliveryState: 'not_sent',
    uploadedByTelegramUserId: 42,
  });
  const loaded = await repository.findMaterialById(material.id);
  const listed = await repository.listMaterials(game.id);
  const revealed = await repository.updateMaterialVisibility({
    materialId: material.id,
    visibility: 'players',
    deliveryState: 'revealed',
  });
  const delivery = await repository.createMaterialDelivery({
    roleGameMaterialId: material.id,
    recipientTelegramUserId: 100,
    sentByTelegramUserId: 42,
    deliveryMode: 'send_and_reveal',
    status: 'sent',
    errorCode: null,
  });

  assert.equal(loaded?.title, 'Pista del sótano');
  assert.deepEqual(listed.map((listedMaterial) => listedMaterial.id), [material.id]);
  assert.equal(revealed.visibility, 'players');
  assert.equal(revealed.deliveryState, 'revealed');
  assert.ok(revealed.revealedAt);
  assert.equal(delivery.recipientTelegramUserId, 100);
  assert.equal(delivery.deliveryMode, 'send_and_reveal');
});

function createCampaignInput(overrides: Partial<CreateRoleGameInput> = {}): CreateRoleGameInput {
  return {
    type: 'campaign',
    title: 'Masks of Nyarlathotep',
    system: 'Call of Cthulhu',
    description: 'Campaña de investigación',
    visibility: 'members',
    publicJoinPolicy: 'members_only',
    entryMode: 'request',
    acceptanceMode: 'manual_review',
    capacity: 5,
    primaryGmTelegramUserId: 42,
    defaultDurationMinutes: 180,
    defaultTableId: null,
    defaultAttendanceMode: 'closed',
    defaultIsPublicScheduleEvent: false,
    autoAddConfirmedPlayers: true,
    allowPlayerManualScheduling: true,
    schedulingMode: 'manual',
    recurrenceRule: null,
    recurrenceWindowCount: 0,
    createdByTelegramUserId: 42,
    ...overrides,
  };
}

function createRoleGameStoreFixture() {
  const steps: string[] = [];
  const users = new Set<number>();
  const games: Array<Record<string, unknown>> = [];
  const members: Array<Record<string, unknown>> = [];
  const sessionLinks: Array<Record<string, unknown>> = [];
  const materials: Array<Record<string, unknown>> = [];
  const deliveries: Array<Record<string, unknown>> = [];
  let nextGameId = 1;
  let nextMemberId = 1;
  let nextSessionLinkId = 1;
  let nextMaterialId = 1;
  let nextDeliveryId = 1;
  const now = new Date('2026-07-09T10:00:00.000Z');

  const seedUser = (telegramUserId: number, _displayName: string) => {
    users.add(telegramUserId);
  };

  const ensureSeededUser = (telegramUserId: unknown) => {
    if (typeof telegramUserId !== 'number') {
      throw new Error(`expected numeric Telegram user ID, got ${typeof telegramUserId}`);
    }
    assert.ok(users.has(telegramUserId), `expected user ${telegramUserId} to be seeded`);
  };

  const tx = {
    insert: (table: { [key: string]: unknown }) => ({
      values: (values: Record<string, unknown>) => {
        if ((table as unknown) === roleGamesTable) {
          steps.push('insert:role_games');
          ensureSeededUser(values.primaryGmTelegramUserId);
          ensureSeededUser(values.createdByTelegramUserId);
          return {
            returning: async () => {
              const row = {
                id: nextGameId++,
                status: 'active',
                closedAt: null,
                createdAt: now,
                updatedAt: now,
                ...values,
              };
              games.push(row);
              return [row];
            },
          };
        }

        if ((table as unknown) === roleGameMembersTable) {
          steps.push('insert:role_game_members');
          ensureSeededUser(values.telegramUserId);
          if (values.requestedByTelegramUserId !== null) {
            ensureSeededUser(values.requestedByTelegramUserId);
          }
          return {
            returning: async () => {
              const row = {
                id: nextMemberId++,
                characterName: null,
                playerNote: null,
                createdAt: now,
                updatedAt: now,
                ...values,
              };
              members.push(row);
              return [row];
            },
          };
        }

        if ((table as unknown) === roleGameSessionsTable) {
          steps.push('insert:role_game_sessions');
          ensureSeededUser(values.createdByTelegramUserId);
          return {
            returning: async () => {
              const row = {
                id: nextSessionLinkId++,
                createdAt: now,
                ...values,
                generatedForStartsAt: typeof values.generatedForStartsAt === 'string'
                  ? new Date(values.generatedForStartsAt)
                  : values.generatedForStartsAt,
              };
              sessionLinks.push(row);
              return [row];
            },
          };
        }

        if ((table as unknown) === roleGameMaterialsTable) {
          steps.push('insert:role_game_materials');
          ensureSeededUser(values.uploadedByTelegramUserId);
          return {
            returning: async () => {
              const row = {
                id: nextMaterialId++,
                createdAt: now,
                updatedAt: now,
                revealedAt: null,
                ...values,
              };
              materials.push(row);
              return [row];
            },
          };
        }

        if ((table as unknown) === roleGameMaterialDeliveriesTable) {
          steps.push('insert:role_game_material_deliveries');
          ensureSeededUser(values.recipientTelegramUserId);
          ensureSeededUser(values.sentByTelegramUserId);
          return {
            returning: async () => {
              const row = {
                id: nextDeliveryId++,
                sentAt: now,
                ...values,
              };
              deliveries.push(row);
              return [row];
            },
          };
        }

        throw new Error('unexpected insert table');
      },
    }),
    update: (table: { [key: string]: unknown }) => ({
      set: (values: Record<string, unknown>) => ({
        where: (condition: unknown) => ({
          returning: async () => {
            if ((table as unknown) === roleGamesTable) {
              const row = games[0];
              if (!row) {
                return [];
              }
              Object.assign(row, values);
              return [row];
            }
            if ((table as unknown) === roleGameMembersTable) {
              steps.push('update:role_game_members');
              const row = members.find((member) => matchesMemberWhere(condition, member));
              if (!row) {
                return [];
              }
              Object.assign(row, values);
              return [row];
            }
            if ((table as unknown) === roleGameMaterialsTable) {
              const row = materials[0];
              if (!row) {
                return [];
              }
              Object.assign(row, values);
              return [row];
            }
            throw new Error('unexpected update table');
          },
        }),
      }),
    }),
    select: (selection?: Record<string, unknown>) => ({
      from: (table: { [key: string]: unknown }) => {
        if ((table as unknown) === roleGamesTable) {
          return {
            where: () => ({
              limit: () => ({
                for: async (lockMode: string) => {
                  assert.equal(lockMode, 'update');
                  steps.push('select:role_games:for_update');
                  return [games.at(-1)];
                },
              }),
            }),
          };
        }

        if ((table as unknown) === roleGameMembersTable) {
          return {
            where: (condition: unknown) => {
              if (selection) {
                return Promise.resolve([
                  {
                    count: members.filter((member) => member.role === 'player' && member.status === 'confirmed').length,
                  },
                ]).then((rows) => {
                  steps.push('count:confirmed_players');
                  return rows;
                });
              }
              return {
                limit: () => ({
                  for: async (lockMode: string) => {
                    assert.equal(lockMode, 'update');
                    steps.push('select:role_game_members:for_update');
                    return members.filter((member) => matchesMemberWhere(condition, member));
                  },
                }),
                orderBy: async () => members.filter((member) => matchesMemberWhere(condition, member)),
              };
            },
          };
        }

        if ((table as unknown) === roleGameSessionsTable) {
          return {
            where: () => ({
              orderBy: async () => sessionLinks,
            }),
          };
        }

        if ((table as unknown) === roleGameMaterialsTable) {
          return {
            where: () => ({
              limit: async () => materials.slice(0, 1),
              orderBy: async () => materials,
            }),
          };
        }

        throw new Error('unexpected select table');
      },
    }),
  };

  const database = {
    transaction: async (handler: (transaction: typeof tx) => Promise<unknown>) => {
      steps.push('transaction:start');
      const result = await handler(tx);
      steps.push('transaction:commit');
      return result;
    },
    select: () => ({
      from: (table: { [key: string]: unknown }) => {
        if ((table as unknown) === roleGamesTable) {
          return {
            where: () => ({
              limit: async () => games.slice(-1),
              orderBy: async () => games,
            }),
            orderBy: async () => games,
          };
        }
        if ((table as unknown) === roleGameMembersTable) {
          return {
            where: (condition: unknown) => ({
              limit: async () => members.filter((member) => matchesMemberWhere(condition, member)),
              orderBy: async () => members.filter((member) => matchesMemberWhere(condition, member)),
            }),
            orderBy: async () => members,
          };
        }
        if ((table as unknown) === roleGameSessionsTable) {
          return {
            where: () => ({
              orderBy: async () => sessionLinks,
            }),
          };
        }
        if ((table as unknown) === roleGameMaterialsTable) {
          return {
            where: () => ({
              limit: async () => materials.slice(0, 1),
              orderBy: async () => materials,
            }),
          };
        }
        throw new Error('unexpected select table');
      },
    }),
    insert: tx.insert,
    update: tx.update,
  };

  return {
    database,
    seedUser,
    cleanup: () => {
      games.length = 0;
      members.length = 0;
      users.clear();
      sessionLinks.length = 0;
      materials.length = 0;
      deliveries.length = 0;
    },
    steps,
    memberRows: members,
  };
}

function matchesMemberWhere(condition: unknown, member: Record<string, unknown>): boolean {
  const comparisons = collectSqlComparisons(condition);
  return comparisons.length > 0 && comparisons.every(({ column, operator, value }) => {
    const memberValue = member[column === 'role_game_id' ? 'roleGameId' : column === 'telegram_user_id' ? 'telegramUserId' : column];
    return operator === '=' ? memberValue === value : memberValue !== value;
  });
}

function collectSqlComparisons(value: unknown): Array<{ column: string; operator: '=' | '<>'; value: unknown }> {
  if (!isSqlObject(value) || !Array.isArray(value.queryChunks)) {
    return [];
  }
  const chunks = value.queryChunks;
  const column = chunks.find(hasSqlName);
  const operator = chunks
    .filter(hasSqlArrayValue)
    .map((chunk) => chunk.value[0])
    .find((candidate): candidate is ' = ' | ' <> ' => candidate === ' = ' || candidate === ' <> ');
  const parameter = chunks.find(hasSqlParameterValue);
  const comparison =
    column && operator && parameter
      ? [{ column: column.name, operator: operator.trim() as '=' | '<>', value: parameter.value }]
      : [];
  return [...comparison, ...chunks.flatMap(collectSqlComparisons)];
}

interface SqlObject {
  queryChunks?: unknown[];
  name?: unknown;
  value?: unknown;
}

function isSqlObject(value: unknown): value is SqlObject {
  return typeof value === 'object' && value !== null;
}

function hasSqlName(value: unknown): value is SqlObject & { name: string } {
  return isSqlObject(value) && typeof value.name === 'string';
}

function hasSqlArrayValue(value: unknown): value is SqlObject & { value: unknown[] } {
  return isSqlObject(value) && Array.isArray(value.value);
}

function hasSqlParameterValue(value: unknown): value is SqlObject & { value: unknown } {
  return isSqlObject(value) && 'value' in value && !Array.isArray(value.value);
}
