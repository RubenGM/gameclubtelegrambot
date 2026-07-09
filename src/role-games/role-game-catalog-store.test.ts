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

function createCampaignInput(): CreateRoleGameInput {
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
        where: () => ({
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
              const row = members.find((member) => member.telegramUserId === values.telegramUserId) ?? members.at(-1);
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
            where: () => {
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
                limit: async () => [],
                orderBy: async () => members,
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
            where: () => ({
              limit: async () => members.slice(-1),
              orderBy: async () => members,
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
