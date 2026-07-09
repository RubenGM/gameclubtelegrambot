import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canManageRoleGame,
  canManageRoleGameOperationally,
  canViewRoleGame,
  createRoleGame,
  requestRoleGameSeat,
  type CreateRoleGameInput,
  type RoleGameMemberRecord,
  type RoleGameRecord,
  type RoleGameRepository,
} from './role-game-catalog.js';

test('createRoleGame normalizes a member-visible campaign with primary GM', async () => {
  const repository = createMemoryRoleGameRepository();
  const game = await createRoleGame({
    repository,
    type: 'campaign',
    title: '  La Maldición   de Strahd  ',
    system: '  D&D   5e ',
    description: '  Campaña gótica   de larga duración  ',
    visibility: 'members',
    publicJoinPolicy: 'members_only',
    entryMode: 'request',
    acceptanceMode: 'manual_review',
    capacity: 5,
    primaryGmTelegramUserId: 42,
    createdByTelegramUserId: 42,
    defaultDurationMinutes: 180,
    defaultTableId: null,
    defaultAttendanceMode: 'closed',
    defaultIsPublicScheduleEvent: false,
    autoAddConfirmedPlayers: true,
    allowPlayerManualScheduling: true,
    schedulingMode: 'manual',
    recurrenceRule: null,
    recurrenceWindowCount: 0,
  });

  assert.equal(game.title, 'La Maldición de Strahd');
  assert.equal(game.system, 'D&D 5e');
  assert.equal(game.description, 'Campaña gótica de larga duración');
  assert.equal(game.primaryGmTelegramUserId, 42);
  assert.equal(game.status, 'active');
});

test('canManageRoleGame allows primary GM and admin only for full management', () => {
  const game = sampleGame({ primaryGmTelegramUserId: 42 });

  assert.equal(canManageRoleGame({ telegramUserId: 42, isAdmin: false }, game, null), true);
  assert.equal(canManageRoleGame({ telegramUserId: 99, isAdmin: true }, game, null), true);
  assert.equal(
    canManageRoleGame(
      { telegramUserId: 77, isAdmin: false },
      game,
      sampleMember({ telegramUserId: 77, role: 'coorganizer', status: 'confirmed' }),
    ),
    false,
  );
});

test('canManageRoleGameOperationally allows coorganizers', () => {
  const game = sampleGame({ primaryGmTelegramUserId: 42 });
  const coorganizer = sampleMember({ telegramUserId: 77, role: 'coorganizer', status: 'confirmed' });

  assert.equal(canManageRoleGameOperationally({ telegramUserId: 77, isAdmin: false }, game, coorganizer), true);
});

test('canViewRoleGame follows visibility and membership boundaries', () => {
  assert.equal(canViewRoleGame({ telegramUserId: 10, isAdmin: false, isApproved: true }, sampleGame({ visibility: 'members' }), null), true);
  assert.equal(canViewRoleGame({ telegramUserId: 10, isAdmin: false, isApproved: false }, sampleGame({ visibility: 'members' }), null), false);
  assert.equal(canViewRoleGame({ telegramUserId: 10, isAdmin: false }, sampleGame({ visibility: 'public' }), null), true);
  assert.equal(
    canViewRoleGame(
      { telegramUserId: 10, isAdmin: false, isApproved: false },
      sampleGame({ visibility: 'private' }),
      sampleMember({ telegramUserId: 10, role: 'player', status: 'confirmed' }),
    ),
    true,
  );
});

test('requestRoleGameSeat auto-confirms while capacity remains', async () => {
  const repository = createMemoryRoleGameRepository();
  const game = await repository.createGame(
    sampleCreateInput({
      capacity: 2,
      entryMode: 'request',
      acceptanceMode: 'auto_until_full',
    }),
  );

  const member = await requestRoleGameSeat({
    repository,
    gameId: game.id,
    telegramUserId: 100,
    actor: { telegramUserId: 100, isAdmin: false, isApproved: true },
  });

  assert.equal(member.status, 'confirmed');
});

test('requestRoleGameSeat waitlists when auto-accept is full', async () => {
  const repository = createMemoryRoleGameRepository();
  const game = await repository.createGame(
    sampleCreateInput({
      capacity: 1,
      entryMode: 'request',
      acceptanceMode: 'auto_until_full',
    }),
  );
  await repository.createMember({
    roleGameId: game.id,
    telegramUserId: 101,
    role: 'player',
    status: 'confirmed',
    isExternal: false,
    requestedByTelegramUserId: 101,
  });

  const member = await requestRoleGameSeat({
    repository,
    gameId: game.id,
    telegramUserId: 100,
    actor: { telegramUserId: 100, isAdmin: false, isApproved: true },
  });

  assert.equal(member.status, 'waitlisted');
});

test('requestRoleGameSeat rejects non-approved actors for member-only games', async () => {
  const repository = createMemoryRoleGameRepository();
  const game = await repository.createGame(
    sampleCreateInput({
      visibility: 'members',
      publicJoinPolicy: 'members_only',
    }),
  );

  await assert.rejects(
    requestRoleGameSeat({
      repository,
      gameId: game.id,
      telegramUserId: 100,
      actor: { telegramUserId: 100, isAdmin: false, isApproved: false },
    }),
    /not visible/,
  );
});

test('requestRoleGameSeat requires public external access for unapproved actors', async () => {
  const repository = createMemoryRoleGameRepository();
  const game = await repository.createGame(
    sampleCreateInput({
      visibility: 'public',
      publicJoinPolicy: 'members_only',
    }),
  );

  await assert.rejects(
    requestRoleGameSeat({
      repository,
      gameId: game.id,
      telegramUserId: 100,
      actor: { telegramUserId: 100, isAdmin: false, isApproved: false },
    }),
    /does not accept external players/,
  );
});

test('requestRoleGameSeat delegates seat allocation to one repository operation', async () => {
  const repository = createMemoryRoleGameRepository();
  const game = await repository.createGame(
    sampleCreateInput({
      acceptanceMode: 'auto_until_full',
    }),
  );
  let countCalls = 0;
  let createCalls = 0;
  const guardedRepository: RoleGameRepository = {
    ...repository,
    async countConfirmedPlayers(gameId) {
      countCalls += 1;
      return repository.countConfirmedPlayers(gameId);
    },
    async createMember(input) {
      createCalls += 1;
      return repository.createMember(input);
    },
  };

  await requestRoleGameSeat({
    repository: guardedRepository,
    gameId: game.id,
    telegramUserId: 100,
    actor: { telegramUserId: 100, isAdmin: false, isApproved: true },
  });

  assert.equal(countCalls, 0);
  assert.equal(createCalls, 0);
});

function createMemoryRoleGameRepository(): RoleGameRepository {
  const games = new Map<number, RoleGameRecord>();
  const members = new Map<number, RoleGameMemberRecord>();
  let nextGameId = 1;
  let nextMemberId = 1;

  return {
    async createGame(input) {
      const now = '2026-07-09T12:00:00.000Z';
      const game: RoleGameRecord = {
        ...input,
        id: nextGameId++,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        closedAt: null,
      };
      games.set(game.id, game);

      const primaryGm: RoleGameMemberRecord = {
        id: nextMemberId++,
        roleGameId: game.id,
        telegramUserId: input.primaryGmTelegramUserId,
        role: 'primary_gm',
        status: 'confirmed',
        isExternal: false,
        characterName: null,
        playerNote: null,
        requestedByTelegramUserId: input.createdByTelegramUserId,
        createdAt: now,
        updatedAt: now,
      };
      members.set(primaryGm.id, primaryGm);
      return game;
    },
    async findGameById(gameId) {
      return games.get(gameId) ?? null;
    },
    async findMemberByTelegramUserId(gameId, telegramUserId) {
      return (
        Array.from(members.values()).find((member) => member.roleGameId === gameId && member.telegramUserId === telegramUserId) ?? null
      );
    },
    async countConfirmedPlayers(gameId) {
      return Array.from(members.values()).filter(
        (member) => member.roleGameId === gameId && member.role === 'player' && member.status === 'confirmed',
      ).length;
    },
    async createMember(input) {
      const now = '2026-07-09T12:05:00.000Z';
      const member: RoleGameMemberRecord = {
        id: nextMemberId++,
        roleGameId: input.roleGameId,
        telegramUserId: input.telegramUserId,
        role: input.role,
        status: input.status,
        isExternal: input.isExternal,
        characterName: null,
        playerNote: null,
        requestedByTelegramUserId: input.requestedByTelegramUserId,
        createdAt: now,
        updatedAt: now,
      };
      members.set(member.id, member);
      return member;
    },
    async requestSeat(input) {
      const existing =
        Array.from(members.values()).find(
          (member) => member.roleGameId === input.roleGameId && member.telegramUserId === input.telegramUserId,
        ) ?? null;
      if (existing && ['invited', 'requested', 'confirmed', 'waitlisted'].includes(existing.status)) {
        return existing;
      }
      const game = games.get(input.roleGameId);
      if (!game) {
        throw new Error(`Role game ${input.roleGameId} not found`);
      }
      const confirmedPlayers = Array.from(members.values()).filter(
        (member) => member.roleGameId === input.roleGameId && member.role === 'player' && member.status === 'confirmed',
      ).length;
      const status =
        game.acceptanceMode === 'manual_review' ? 'requested' : confirmedPlayers < game.capacity ? 'confirmed' : 'waitlisted';
      const now = '2026-07-09T12:05:00.000Z';
      const member: RoleGameMemberRecord = {
        id: nextMemberId++,
        roleGameId: input.roleGameId,
        telegramUserId: input.telegramUserId,
        role: 'player',
        status,
        isExternal: input.isExternal,
        characterName: null,
        playerNote: null,
        requestedByTelegramUserId: input.actorTelegramUserId,
        createdAt: now,
        updatedAt: now,
      };
      members.set(member.id, member);
      return member;
    },
    async setMemberStatus(input) {
      const existing = members.get(input.memberId);
      if (!existing) {
        throw new Error(`Role game member ${input.memberId} not found`);
      }
      const next: RoleGameMemberRecord = {
        ...existing,
        status: input.status,
        updatedAt: '2026-07-09T12:10:00.000Z',
      };
      members.set(next.id, next);
      return next;
    },
  };
}

function sampleCreateInput(overrides: Partial<CreateRoleGameInput> = {}): CreateRoleGameInput {
  return {
    type: 'campaign',
    title: 'La Maldición de Strahd',
    system: 'D&D 5e',
    description: 'Campaña gótica de larga duración',
    visibility: 'members',
    publicJoinPolicy: 'members_only',
    entryMode: 'request',
    acceptanceMode: 'manual_review',
    capacity: 5,
    primaryGmTelegramUserId: 42,
    createdByTelegramUserId: 42,
    defaultDurationMinutes: 180,
    defaultTableId: null,
    defaultAttendanceMode: 'closed',
    defaultIsPublicScheduleEvent: false,
    autoAddConfirmedPlayers: true,
    allowPlayerManualScheduling: true,
    schedulingMode: 'manual',
    recurrenceRule: null,
    recurrenceWindowCount: 0,
    ...overrides,
  };
}

function sampleGame(overrides: Partial<RoleGameRecord> = {}): RoleGameRecord {
  return {
    id: 1,
    status: 'active',
    ...sampleCreateInput(),
    createdAt: '2026-07-09T12:00:00.000Z',
    updatedAt: '2026-07-09T12:00:00.000Z',
    closedAt: null,
    ...overrides,
  };
}

function sampleMember(overrides: Partial<RoleGameMemberRecord> = {}): RoleGameMemberRecord {
  return {
    id: 1,
    roleGameId: 1,
    telegramUserId: 42,
    role: 'player',
    status: 'confirmed',
    isExternal: false,
    characterName: null,
    playerNote: null,
    requestedByTelegramUserId: 42,
    createdAt: '2026-07-09T12:00:00.000Z',
    updatedAt: '2026-07-09T12:00:00.000Z',
    ...overrides,
  };
}
