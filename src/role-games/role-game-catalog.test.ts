import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canViewRoleGameMaterial,
  createRoleGameMaterial,
  recordRoleGameMaterialDelivery,
  revealRoleGameMaterial,
  canManageRoleGame,
  canManageRoleGameOperationally,
  canViewRoleGame,
  createRoleGame,
  manageRoleGameMember,
  requestRoleGameSeat,
  resolveRoleGameSeatRequest,
  setRoleGameMemberStatus,
  type CreateRoleGameInput,
  type RoleGameMemberRecord,
  type RoleGameMaterialDeliveryRecord,
  type RoleGameMaterialRecord,
  type RoleGameRecord,
  type RoleGameRepository,
  type RoleGameSessionRecord,
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

test('canViewRoleGameMaterial keeps gm-only handouts hidden from players', () => {
  const game = sampleGame({ primaryGmTelegramUserId: 42 });
  const material = sampleMaterial({ roleGameId: game.id, visibility: 'gm_only' });
  const player = sampleMember({ roleGameId: game.id, telegramUserId: 100, role: 'player', status: 'confirmed' });
  const coorganizer = sampleMember({ roleGameId: game.id, telegramUserId: 77, role: 'coorganizer', status: 'confirmed' });

  assert.equal(canViewRoleGameMaterial({ telegramUserId: 42, isAdmin: false }, game, null, material), true);
  assert.equal(canViewRoleGameMaterial({ telegramUserId: 77, isAdmin: false }, game, coorganizer, material), true);
  assert.equal(canViewRoleGameMaterial({ telegramUserId: 100, isAdmin: false }, game, player, material), false);
  assert.equal(canViewRoleGameMaterial({ telegramUserId: 500, isAdmin: true }, game, null, material), true);
});

test('canViewRoleGameMaterial allows confirmed players after reveal', () => {
  const game = sampleGame({ primaryGmTelegramUserId: 42 });
  const material = sampleMaterial({ roleGameId: game.id, visibility: 'players', deliveryState: 'revealed' });
  const player = sampleMember({ roleGameId: game.id, telegramUserId: 100, role: 'player', status: 'confirmed' });
  const requested = sampleMember({ roleGameId: game.id, telegramUserId: 101, role: 'player', status: 'requested' });

  assert.equal(canViewRoleGameMaterial({ telegramUserId: 100, isAdmin: false }, game, player, material), true);
  assert.equal(canViewRoleGameMaterial({ telegramUserId: 101, isAdmin: false }, game, requested, material), false);
});

test('canViewRoleGameMaterial scopes external confirmed players to their game', () => {
  const game = sampleGame({ id: 7, primaryGmTelegramUserId: 42, visibility: 'public', publicJoinPolicy: 'members_and_external' });
  const material = sampleMaterial({ roleGameId: game.id, visibility: 'players', deliveryState: 'revealed' });
  const externalPlayer = sampleMember({ roleGameId: game.id, telegramUserId: 100, role: 'player', status: 'confirmed', isExternal: true });
  const otherGameMaterial = sampleMaterial({ roleGameId: 8, visibility: 'players', deliveryState: 'revealed' });

  assert.equal(canViewRoleGameMaterial({ telegramUserId: 100, isAdmin: false, isApproved: false }, game, externalPlayer, material), true);
  assert.equal(canViewRoleGameMaterial({ telegramUserId: 100, isAdmin: false, isApproved: false }, game, externalPlayer, otherGameMaterial), false);
});

test('createRoleGameMaterial normalizes gm-only material metadata', async () => {
  const repository = createMemoryRoleGameRepository();
  const material = await createRoleGameMaterial({
    repository,
    roleGameId: 7,
    internalStorageEntryId: 33,
    title: '  Mapa secreto   del templo  ',
    description: '  Sólo para dirección  ',
    visibility: 'gm_only',
    uploadedByTelegramUserId: 42,
  });

  assert.equal(material.title, 'Mapa secreto del templo');
  assert.equal(material.description, 'Sólo para dirección');
  assert.equal(material.deliveryState, 'not_sent');
});

test('revealRoleGameMaterial makes a handout visible to players', async () => {
  const repository = createMemoryRoleGameRepository();
  const material = await repository.createMaterial({
    roleGameId: 7,
    internalStorageEntryId: 33,
    title: 'Mapa secreto',
    description: null,
    visibility: 'gm_only',
    deliveryState: 'not_sent',
    uploadedByTelegramUserId: 42,
  });

  const revealed = await revealRoleGameMaterial({ repository, materialId: material.id });

  assert.equal(revealed.visibility, 'players');
  assert.equal(revealed.deliveryState, 'revealed');
  assert.equal(revealed.revealedAt, '2026-07-09T12:10:00.000Z');
});

test('recordRoleGameMaterialDelivery persists sent and failed delivery attempts', async () => {
  const repository = createMemoryRoleGameRepository();

  const sent = await recordRoleGameMaterialDelivery({
    repository,
    roleGameMaterialId: 12,
    recipientTelegramUserId: 100,
    sentByTelegramUserId: 42,
    deliveryMode: 'send_only',
    status: 'sent',
    errorCode: null,
  });
  const failed = await recordRoleGameMaterialDelivery({
    repository,
    roleGameMaterialId: 12,
    recipientTelegramUserId: 101,
    sentByTelegramUserId: 42,
    deliveryMode: 'send_and_reveal',
    status: 'failed',
    errorCode: 'Forbidden',
  });

  assert.equal(sent.status, 'sent');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.errorCode, 'Forbidden');
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
      type: 'one_shot',
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

test('requestRoleGameSeat accepts only public one-shots for external actors', async () => {
  const repository = createMemoryRoleGameRepository();
  const oneShot = await repository.createGame(sampleCreateInput({
    type: 'one_shot',
    visibility: 'public',
    publicJoinPolicy: 'members_and_external',
    acceptanceMode: 'auto_until_full',
  }));
  const campaign = await repository.createGame(sampleCreateInput({
    type: 'campaign',
    title: 'Campaña abierta',
    visibility: 'public',
    publicJoinPolicy: 'members_and_external',
    acceptanceMode: 'auto_until_full',
  }));

  const member = await requestRoleGameSeat({
    repository,
    gameId: oneShot.id,
    telegramUserId: 100,
    actor: { telegramUserId: 100, isAdmin: false, isApproved: false },
  });

  assert.equal(member.status, 'confirmed');
  assert.equal(member.isExternal, true);
  await assert.rejects(
    requestRoleGameSeat({
      repository,
      gameId: campaign.id,
      telegramUserId: 101,
      actor: { telegramUserId: 101, isAdmin: false, isApproved: false },
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

test('setRoleGameMemberStatus normalizes and delegates status changes', async () => {
  const repository = createMemoryRoleGameRepository();
  const game = await repository.createGame(sampleCreateInput());
  const requested = await repository.createMember({
    roleGameId: game.id,
    telegramUserId: 100,
    role: 'player',
    status: 'requested',
    isExternal: false,
    requestedByTelegramUserId: 100,
  });

  const updated = await setRoleGameMemberStatus({
    repository,
    memberId: requested.id,
    status: 'confirmed',
    actorTelegramUserId: 42,
  });

  assert.equal(updated.status, 'confirmed');
});

test('manageRoleGameMember applies every allowed participant transition', async () => {
  const fullManager = { telegramUserId: 42, isAdmin: false, isApproved: true };
  const transitions = [
    { action: 'confirm', status: 'requested', role: 'player', expected: { status: 'confirmed', role: 'player' } },
    { action: 'confirm', status: 'invited', role: 'player', expected: { status: 'confirmed', role: 'player' } },
    { action: 'confirm', status: 'waitlisted', role: 'player', expected: { status: 'confirmed', role: 'player' } },
    { action: 'reject', status: 'requested', role: 'player', expected: { status: 'rejected', role: 'player' } },
    { action: 'remove', status: 'waitlisted', role: 'player', expected: { status: 'removed', role: 'player' } },
    { action: 'cancel_invitation', status: 'invited', role: 'player', expected: { status: 'removed', role: 'player' } },
    { action: 'promote', status: 'confirmed', role: 'player', expected: { status: 'confirmed', role: 'coorganizer' } },
    { action: 'demote', status: 'confirmed', role: 'coorganizer', expected: { status: 'confirmed', role: 'player' } },
  ] as const;

  for (const transition of transitions) {
    const repository = createMemoryRoleGameRepository();
    const game = await repository.createGame(sampleCreateInput());
    const member = await repository.createMember({
      roleGameId: game.id,
      telegramUserId: 100,
      role: transition.role,
      status: transition.status,
      isExternal: false,
      requestedByTelegramUserId: 100,
    });

    const updated = await manageRoleGameMember({
      repository,
      actor: fullManager,
      game,
      actorMembership: null,
      member,
      action: transition.action,
    });

    assert.equal(updated.status, transition.expected.status, `${transition.action} from ${transition.status}`);
    assert.equal(updated.role, transition.expected.role, `${transition.action} from ${transition.status}`);
  }
});

test('manageRoleGameMember lets coorganizers accept or reject requested players only', async () => {
  const repository = createMemoryRoleGameRepository();
  const game = await repository.createGame(sampleCreateInput());
  const coorganizer = await repository.createMember({
    roleGameId: game.id,
    telegramUserId: 77,
    role: 'coorganizer',
    status: 'confirmed',
    isExternal: false,
    requestedByTelegramUserId: 42,
  });

  for (const action of ['confirm', 'reject'] as const) {
    const member = await repository.createMember({
      roleGameId: game.id,
      telegramUserId: action === 'confirm' ? 100 : 101,
      role: 'player',
      status: 'requested',
      isExternal: false,
      requestedByTelegramUserId: 100,
    });
    const updated = await manageRoleGameMember({
      repository,
      actor: { telegramUserId: 77, isAdmin: false, isApproved: true },
      game,
      actorMembership: coorganizer,
      member,
      action,
    });
    assert.equal(updated.status, action === 'confirm' ? 'confirmed' : 'rejected');
  }
});

test('manageRoleGameMember reloads actor membership before a coorganizer rejects a request', async () => {
  const repository = createMemoryRoleGameRepository();
  const game = await repository.createGame(sampleCreateInput());
  const staleCoorganizer = await repository.createMember({
    roleGameId: game.id,
    telegramUserId: 77,
    role: 'coorganizer',
    status: 'confirmed',
    isExternal: false,
    requestedByTelegramUserId: 42,
  });
  const requested = await repository.createMember({
    roleGameId: game.id,
    telegramUserId: 100,
    role: 'player',
    status: 'requested',
    isExternal: false,
    requestedByTelegramUserId: 100,
  });
  await repository.setMemberStatus({
    memberId: staleCoorganizer.id,
    status: 'removed',
    actorTelegramUserId: 42,
  });

  await assert.rejects(
    manageRoleGameMember({
      repository,
      actor: { telegramUserId: 77, isAdmin: false, isApproved: true },
      game,
      actorMembership: staleCoorganizer,
      member: requested,
      action: 'reject',
    }),
    /permission/i,
  );
  assert.equal((await repository.findMemberById(requested.id))?.status, 'requested');
});

test('manageRoleGameMember rejects disallowed status transitions', async () => {
  const rejectedTransitions = [
    { action: 'reject', status: 'invited', role: 'player' },
    { action: 'remove', status: 'requested', role: 'player' },
    { action: 'cancel_invitation', status: 'waitlisted', role: 'player' },
    { action: 'promote', status: 'waitlisted', role: 'player' },
    { action: 'demote', status: 'confirmed', role: 'player' },
  ] as const;

  for (const transition of rejectedTransitions) {
    const repository = createMemoryRoleGameRepository();
    const game = await repository.createGame(sampleCreateInput());
    const member = await repository.createMember({
      roleGameId: game.id,
      telegramUserId: 100,
      role: transition.role,
      status: transition.status,
      isExternal: false,
      requestedByTelegramUserId: 100,
    });

    await assert.rejects(
      manageRoleGameMember({
        repository,
        actor: { telegramUserId: 42, isAdmin: false, isApproved: true },
        game,
        actorMembership: null,
        member,
        action: transition.action,
      }),
      /status|role|transition/i,
      `${transition.action} from ${transition.status}`,
    );
  }
});

test('manageRoleGameMember prevents coorganizers from changing roles, removing players, or confirming other statuses', async () => {
  const repository = createMemoryRoleGameRepository();
  const game = await repository.createGame(sampleCreateInput());
  const coorganizer = await repository.createMember({
    roleGameId: game.id,
    telegramUserId: 77,
    role: 'coorganizer',
    status: 'confirmed',
    isExternal: false,
    requestedByTelegramUserId: 42,
  });
  const player = await repository.createMember({
    roleGameId: game.id,
    telegramUserId: 100,
    role: 'player',
    status: 'confirmed',
    isExternal: false,
    requestedByTelegramUserId: 100,
  });

  for (const action of ['promote', 'remove'] as const) {
    await assert.rejects(
      manageRoleGameMember({
        repository,
        actor: { telegramUserId: 77, isAdmin: false, isApproved: true },
        game,
        actorMembership: coorganizer,
        member: player,
        action,
      }),
      /permission/i,
    );
  }
  const invited = await repository.createMember({
    roleGameId: game.id,
    telegramUserId: 101,
    role: 'player',
    status: 'invited',
    isExternal: false,
    requestedByTelegramUserId: 42,
  });
  await assert.rejects(
    manageRoleGameMember({
      repository,
      actor: { telegramUserId: 77, isAdmin: false, isApproved: true },
      game,
      actorMembership: coorganizer,
      member: invited,
      action: 'confirm',
    }),
    /permission/i,
  );
});

test('manageRoleGameMember protects primary GMs and validates the current member state', async () => {
  const repository = createMemoryRoleGameRepository();
  const game = await repository.createGame(sampleCreateInput({ capacity: 1 }));
  const primaryGm = await repository.findMemberByTelegramUserId(game.id, 42);
  assert.ok(primaryGm);

  await assert.rejects(
    manageRoleGameMember({
      repository,
      actor: { telegramUserId: 42, isAdmin: false, isApproved: true },
      game,
      actorMembership: null,
      member: primaryGm,
      action: 'remove',
    }),
    /primary GM/i,
  );

  const requested = await repository.createMember({
    roleGameId: game.id,
    telegramUserId: 100,
    role: 'player',
    status: 'requested',
    isExternal: false,
    requestedByTelegramUserId: 100,
  });
  await repository.createMember({
    roleGameId: game.id,
    telegramUserId: 101,
    role: 'player',
    status: 'confirmed',
    isExternal: false,
    requestedByTelegramUserId: 101,
  });

  await assert.rejects(
    manageRoleGameMember({
      repository,
      actor: { telegramUserId: 42, isAdmin: false, isApproved: true },
      game,
      actorMembership: null,
      member: requested,
      action: 'confirm',
    }),
    /full/i,
  );
  await repository.setMemberStatus({ memberId: requested.id, status: 'confirmed', actorTelegramUserId: 42 });
  await assert.rejects(
    manageRoleGameMember({
      repository,
      actor: { telegramUserId: 42, isAdmin: false, isApproved: true },
      game,
      actorMembership: null,
      member: requested,
      action: 'confirm',
    }),
    /stale status/i,
  );
});

test('manageRoleGameMember rejects members from another game', async () => {
  const repository = createMemoryRoleGameRepository();
  const game = await repository.createGame(sampleCreateInput());
  const otherGame = await repository.createGame(sampleCreateInput({ title: 'La otra mesa' }));
  const member = await repository.createMember({
    roleGameId: otherGame.id,
    telegramUserId: 100,
    role: 'player',
    status: 'requested',
    isExternal: false,
    requestedByTelegramUserId: 100,
  });

  await assert.rejects(
    manageRoleGameMember({
      repository,
      actor: { telegramUserId: 42, isAdmin: false, isApproved: true },
      game,
      actorMembership: null,
      member,
      action: 'confirm',
    }),
    /does not belong/i,
  );
});

test('resolveRoleGameSeatRequest confirms only pending player requests with capacity', async () => {
  const repository = createMemoryRoleGameRepository();
  const game = await repository.createGame(sampleCreateInput({ capacity: 2 }));
  const requested = await repository.createMember({
    roleGameId: game.id,
    telegramUserId: 100,
    role: 'player',
    status: 'requested',
    isExternal: false,
    requestedByTelegramUserId: 100,
  });

  const updated = await resolveRoleGameSeatRequest({
    repository,
    memberId: requested.id,
    status: 'confirmed',
    actorTelegramUserId: 42,
  });

  assert.equal(updated.status, 'confirmed');
});

test('resolveRoleGameSeatRequest rejects non-pending and full confirmations', async () => {
  const repository = createMemoryRoleGameRepository();
  const game = await repository.createGame(sampleCreateInput({ capacity: 1 }));
  await repository.createMember({
    roleGameId: game.id,
    telegramUserId: 101,
    role: 'player',
    status: 'confirmed',
    isExternal: false,
    requestedByTelegramUserId: 101,
  });
  const requested = await repository.createMember({
    roleGameId: game.id,
    telegramUserId: 100,
    role: 'player',
    status: 'requested',
    isExternal: false,
    requestedByTelegramUserId: 100,
  });
  const coorganizer = await repository.createMember({
    roleGameId: game.id,
    telegramUserId: 102,
    role: 'coorganizer',
    status: 'requested',
    isExternal: false,
    requestedByTelegramUserId: 102,
  });

  await assert.rejects(
    resolveRoleGameSeatRequest({
      repository,
      memberId: requested.id,
      status: 'confirmed',
      actorTelegramUserId: 42,
    }),
    /full/,
  );
  await assert.rejects(
    resolveRoleGameSeatRequest({
      repository,
      memberId: coorganizer.id,
      status: 'rejected',
      actorTelegramUserId: 42,
    }),
    /not a pending player request/,
  );
});

function createMemoryRoleGameRepository(): RoleGameRepository {
  const games = new Map<number, RoleGameRecord>();
  const members = new Map<number, RoleGameMemberRecord>();
  const sessionLinks = new Map<number, RoleGameSessionRecord>();
  const materials = new Map<number, RoleGameMaterialRecord>();
  const deliveries = new Map<number, RoleGameMaterialDeliveryRecord>();
  let nextGameId = 1;
  let nextMemberId = 1;
  let nextSessionLinkId = 1;
  let nextMaterialId = 1;
  let nextDeliveryId = 1;

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
    async updateGame(input) {
      const existing = games.get(input.gameId);
      if (!existing) {
        throw new Error(`Role game ${input.gameId} not found`);
      }
      const updated: RoleGameRecord = {
        ...existing,
        ...input,
        id: existing.id,
        updatedAt: '2026-07-09T12:10:00.000Z',
      };
      games.set(updated.id, updated);
      return updated;
    },
    async listVisibleGames(input) {
      return Array.from(games.values()).filter((game) => {
        const membership =
          Array.from(members.values()).find(
            (member) => member.roleGameId === game.id && member.telegramUserId === input.actor.telegramUserId,
          ) ?? null;
        return canViewRoleGame(input.actor, game, membership);
      });
    },
    async listGamesForUser(telegramUserId) {
      const roleGameIds = new Set(
        Array.from(members.values())
          .filter((member) => member.telegramUserId === telegramUserId)
          .map((member) => member.roleGameId),
      );
      return Array.from(games.values()).filter((game) => roleGameIds.has(game.id));
    },
    async createOrUpdateMember(input) {
      const existing =
        Array.from(members.values()).find(
          (member) => member.roleGameId === input.roleGameId && member.telegramUserId === input.telegramUserId,
        ) ?? null;
      if (!existing) {
        return this.createMember(input);
      }
      const updated: RoleGameMemberRecord = {
        ...existing,
        role: input.role,
        status: input.status,
        isExternal: input.isExternal,
        characterName: input.characterName ?? null,
        playerNote: input.playerNote ?? null,
        requestedByTelegramUserId: input.requestedByTelegramUserId,
        updatedAt: '2026-07-09T12:10:00.000Z',
      };
      members.set(updated.id, updated);
      return updated;
    },
    async findMember(gameId, telegramUserId) {
      return (
        Array.from(members.values()).find((member) => member.roleGameId === gameId && member.telegramUserId === telegramUserId) ?? null
      );
    },
    async findMemberByTelegramUserId(gameId, telegramUserId) {
      return (
        Array.from(members.values()).find((member) => member.roleGameId === gameId && member.telegramUserId === telegramUserId) ?? null
      );
    },
    async findMemberById(memberId) {
      return members.get(memberId) ?? null;
    },
    async listMembers(gameId) {
      return Array.from(members.values()).filter((member) => member.roleGameId === gameId);
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
        characterName: input.characterName ?? null,
        playerNote: input.playerNote ?? null,
        requestedByTelegramUserId: input.requestedByTelegramUserId,
        createdAt: now,
        updatedAt: now,
      };
      members.set(member.id, member);
      return member;
    },
    async createSessionLink(input) {
      const now = '2026-07-09T12:05:00.000Z';
      const link: RoleGameSessionRecord = {
        ...input,
        id: nextSessionLinkId++,
        createdAt: now,
      };
      sessionLinks.set(link.id, link);
      return link;
    },
    async listSessionLinks(gameId) {
      return Array.from(sessionLinks.values()).filter((link) => link.roleGameId === gameId);
    },
    async createMaterial(input) {
      const now = '2026-07-09T12:05:00.000Z';
      const material: RoleGameMaterialRecord = {
        ...input,
        id: nextMaterialId++,
        createdAt: now,
        updatedAt: now,
        revealedAt: null,
      };
      materials.set(material.id, material);
      return material;
    },
    async findMaterialById(materialId) {
      return materials.get(materialId) ?? null;
    },
    async listMaterials(gameId) {
      return Array.from(materials.values())
        .filter((material) => material.roleGameId === gameId)
        .sort((left, right) => left.id - right.id);
    },
    async updateMaterialVisibility(input) {
      const existing = materials.get(input.materialId);
      if (!existing) {
        throw new Error(`Role game material ${input.materialId} not found`);
      }
      const updated: RoleGameMaterialRecord = {
        ...existing,
        visibility: input.visibility,
        deliveryState: input.deliveryState,
        updatedAt: '2026-07-09T12:10:00.000Z',
        revealedAt: input.deliveryState === 'revealed' ? '2026-07-09T12:10:00.000Z' : null,
      };
      materials.set(updated.id, updated);
      return updated;
    },
    async createMaterialDelivery(input) {
      const delivery: RoleGameMaterialDeliveryRecord = {
        ...input,
        id: nextDeliveryId++,
        sentAt: '2026-07-09T12:05:00.000Z',
      };
      deliveries.set(delivery.id, delivery);
      return delivery;
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
    async confirmMemberSeat(input) {
      const existing = members.get(input.memberId);
      if (
        !existing ||
        existing.role !== 'player' ||
        !input.expectedStatuses.includes(existing.status as 'requested' | 'invited' | 'waitlisted')
      ) {
        throw new Error(`Role game member ${input.memberId} has stale status`);
      }
      const game = games.get(existing.roleGameId);
      if (!game) {
        throw new Error(`Role game ${existing.roleGameId} not found`);
      }
      const confirmedPlayers = Array.from(members.values()).filter(
        (member) => member.roleGameId === game.id && member.role === 'player' && member.status === 'confirmed',
      ).length;
      if (confirmedPlayers >= game.capacity) {
        throw new Error(`Role game ${game.id} is full`);
      }
      const updated: RoleGameMemberRecord = {
        ...existing,
        status: 'confirmed',
        requestedByTelegramUserId: input.actorTelegramUserId,
        updatedAt: '2026-07-09T12:10:00.000Z',
      };
      members.set(updated.id, updated);
      return updated;
    },
    async setMemberRole(input) {
      const existing = members.get(input.memberId);
      if (!existing || existing.status !== 'confirmed' || existing.role === 'primary_gm') {
        throw new Error(`Role game member ${input.memberId} has stale status`);
      }
      const updated: RoleGameMemberRecord = {
        ...existing,
        role: input.role,
        requestedByTelegramUserId: input.actorTelegramUserId,
        updatedAt: '2026-07-09T12:10:00.000Z',
      };
      members.set(updated.id, updated);
      return updated;
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

function sampleMaterial(overrides: Partial<RoleGameMaterialRecord> = {}): RoleGameMaterialRecord {
  return {
    id: 1,
    roleGameId: 1,
    internalStorageEntryId: 33,
    title: 'Mapa secreto',
    description: null,
    visibility: 'gm_only',
    deliveryState: 'not_sent',
    uploadedByTelegramUserId: 42,
    createdAt: '2026-07-09T12:00:00.000Z',
    updatedAt: '2026-07-09T12:00:00.000Z',
    revealedAt: null,
    ...overrides,
  };
}
