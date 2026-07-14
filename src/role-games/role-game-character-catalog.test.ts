import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canEditRoleGameCharacter,
  canRequestRoleGameCharacter,
  canViewRoleGameCharacter,
  canViewRoleGameCharacterAttachment,
  abandonRoleGameCharacter,
  approveRoleGameCharacterClaim,
  assignRoleGameCharacter,
  cancelRoleGameCharacterRequest,
  createRoleGameCharacter,
  normalizeRoleGameCharacterDraft,
  requestRoleGameCharacter,
  updateRoleGameCharacter,
  transferRoleGameCharacter,
  type RoleGameCharacterAttachmentRecord,
  type RoleGameCharacterRecord,
  type RoleGameCharacterRepository,
} from './role-game-character-catalog.js';
import type {
  RoleGameActor,
  RoleGameMemberRecord,
  RoleGameRecord,
  RoleGameRepository,
} from './role-game-catalog.js';

test('normalizeRoleGameCharacterDraft trims fields and accepts safe web URLs', () => {
  assert.deepEqual(normalizeRoleGameCharacterDraft({
    name: '  Nyra  ',
    description: ' Exploradora ',
    externalUrl: ' https://example.org/nyra ',
    visibility: 'players',
  }), {
    name: 'Nyra',
    description: 'Exploradora',
    externalUrl: 'https://example.org/nyra',
    visibility: 'players',
  });
});

test('normalizeRoleGameCharacterDraft rejects unsafe URLs and oversized fields', () => {
  assert.throws(() => normalizeRoleGameCharacterDraft({
    name: 'Nyra',
    description: null,
    externalUrl: 'javascript:alert(1)',
    visibility: 'players',
  }), /http or https/i);
  assert.throws(() => normalizeRoleGameCharacterDraft({
    name: 'x'.repeat(121),
    description: null,
    externalUrl: null,
    visibility: 'players',
  }), /120/);
  assert.throws(() => normalizeRoleGameCharacterDraft({
    name: 'Nyra',
    description: 'x'.repeat(3001),
    externalUrl: null,
    visibility: 'players',
  }), /3000/);
});

test('confirmed members of every role can own and edit their character', () => {
  const character = sampleCharacter({ assignedMemberId: 5, visibility: 'private' });
  for (const role of ['player', 'coorganizer', 'primary_gm'] as const) {
    const membership = sampleMember({ id: 5, role });
    const actor = sampleActor({ telegramUserId: membership.telegramUserId });
    assert.equal(canViewRoleGameCharacter(actor, sampleGame(), membership, character), true);
    assert.equal(canEditRoleGameCharacter(actor, sampleGame(), membership, character), true);
  }
});

test('public characters are visible to confirmed members but not visitors or historical members', () => {
  const character = sampleCharacter({ assignedMemberId: 8, visibility: 'players' });
  assert.equal(canViewRoleGameCharacter(sampleActor(), sampleGame(), sampleMember(), character), true);
  assert.equal(canViewRoleGameCharacter(sampleActor(), sampleGame(), null, character), false);
  assert.equal(canViewRoleGameCharacter(
    sampleActor(),
    sampleGame(),
    sampleMember({ status: 'left' }),
    character,
  ), false);
});

test('private unassigned characters are GM-only and cannot be requested', () => {
  const character = sampleCharacter({ assignedMemberId: null, visibility: 'private' });
  const actor = sampleActor();
  const membership = sampleMember();
  assert.equal(canViewRoleGameCharacter(actor, sampleGame(), membership, character), false);
  assert.equal(canRequestRoleGameCharacter(actor, sampleGame(), membership, character), false);

  const gm = sampleActor({ telegramUserId: 42 });
  assert.equal(canViewRoleGameCharacter(gm, sampleGame(), sampleMember({
    id: 9,
    telegramUserId: 42,
    role: 'primary_gm',
  }), character), true);
});

test('confirmed members can request only public free characters from their game', () => {
  const actor = sampleActor();
  const membership = sampleMember();
  assert.equal(canRequestRoleGameCharacter(
    actor,
    sampleGame(),
    membership,
    sampleCharacter({ assignedMemberId: null, visibility: 'players' }),
  ), true);
  assert.equal(canRequestRoleGameCharacter(
    actor,
    sampleGame(),
    membership,
    sampleCharacter({ assignedMemberId: 8, visibility: 'players' }),
  ), false);
  assert.equal(canRequestRoleGameCharacter(
    actor,
    sampleGame(),
    membership,
    sampleCharacter({ roleGameId: 99, assignedMemberId: null, visibility: 'players' }),
  ), false);
});

test('private attachments stay hidden from other confirmed members', () => {
  const character = sampleCharacter({ assignedMemberId: 8, visibility: 'players' });
  const attachment = sampleAttachment({ visibility: 'private' });
  assert.equal(canViewRoleGameCharacterAttachment(
    sampleActor(),
    sampleGame(),
    sampleMember(),
    character,
    attachment,
  ), false);

  const owner = sampleMember({ id: 8, telegramUserId: 800 });
  assert.equal(canViewRoleGameCharacterAttachment(
    sampleActor({ telegramUserId: 800 }),
    sampleGame(),
    owner,
    character,
    attachment,
  ), true);
});

test('createRoleGameCharacter lets confirmed members create only for themselves', async () => {
  const game = sampleGame();
  const actorMembership = sampleMember();
  const createdInputs: unknown[] = [];
  const characterRepository = characterRepositoryStub({
    async createCharacter(input) {
      createdInputs.push(input);
      return sampleCharacter({
        assignedMemberId: input.assignedMemberId,
        name: input.name,
        description: input.description,
        externalUrl: input.externalUrl,
        visibility: input.visibility,
      });
    },
  });
  const roleGameRepository = roleGameRepositoryStub({
    game,
    members: [actorMembership, sampleMember({ id: 8, telegramUserId: 800 })],
  });

  const created = await createRoleGameCharacter({
    roleGameRepository,
    characterRepository,
    actor: sampleActor(),
    gameId: game.id,
    assignedMemberId: actorMembership.id,
    draft: {
      name: ' Nyra ',
      description: null,
      externalUrl: null,
      visibility: 'players',
    },
  });
  assert.equal(created.assignedMemberId, actorMembership.id);
  assert.equal(createdInputs.length, 1);

  await assert.rejects(() => createRoleGameCharacter({
    roleGameRepository,
    characterRepository,
    actor: sampleActor(),
    gameId: game.id,
    assignedMemberId: 8,
    draft: { name: 'Robado', description: null, externalUrl: null, visibility: 'players' },
  }), /permission/i);
});

test('createRoleGameCharacter lets a GM create for any confirmed role or leave the character free', async () => {
  const game = sampleGame();
  const gm = sampleMember({ id: 9, telegramUserId: 42, role: 'primary_gm' });
  const coorganizer = sampleMember({ id: 8, telegramUserId: 800, role: 'coorganizer' });
  const assignedMemberIds: Array<number | null> = [];
  const characterRepository = characterRepositoryStub({
    async createCharacter(input) {
      assignedMemberIds.push(input.assignedMemberId);
      return sampleCharacter({ assignedMemberId: input.assignedMemberId, visibility: input.visibility });
    },
  });
  const roleGameRepository = roleGameRepositoryStub({ game, members: [gm, coorganizer] });

  await createRoleGameCharacter({
    roleGameRepository,
    characterRepository,
    actor: sampleActor({ telegramUserId: 42 }),
    gameId: game.id,
    assignedMemberId: coorganizer.id,
    draft: { name: 'Escudo', description: null, externalUrl: null, visibility: 'private' },
  });
  await createRoleGameCharacter({
    roleGameRepository,
    characterRepository,
    actor: sampleActor({ telegramUserId: 42 }),
    gameId: game.id,
    assignedMemberId: null,
    draft: { name: 'Libre', description: null, externalUrl: null, visibility: 'players' },
  });

  assert.deepEqual(assignedMemberIds, [coorganizer.id, null]);
});

test('transferRoleGameCharacter reloads ownership and transfers atomically for a GM', async () => {
  const game = sampleGame();
  const gm = sampleMember({ id: 9, telegramUserId: 42, role: 'primary_gm' });
  const previousOwner = sampleMember({ id: 5 });
  const newOwner = sampleMember({ id: 8, telegramUserId: 800, role: 'coorganizer' });
  const character = sampleCharacter({ assignedMemberId: previousOwner.id });
  const transfers: unknown[] = [];
  const characterRepository = characterRepositoryStub({
    async findCharacterById() {
      return character;
    },
    async transferCharacter(input) {
      transfers.push(input);
      return { ...character, assignedMemberId: input.assignedMemberId };
    },
  });

  const transferred = await transferRoleGameCharacter({
    roleGameRepository: roleGameRepositoryStub({ game, members: [gm, previousOwner, newOwner] }),
    characterRepository,
    actor: sampleActor({ telegramUserId: 42 }),
    characterId: character.id,
    assignedMemberId: newOwner.id,
  });

  assert.equal(transferred.assignedMemberId, newOwner.id);
  assert.deepEqual(transfers, [{
    characterId: character.id,
    assignedMemberId: newOwner.id,
    expectedAssignedMemberId: previousOwner.id,
    actorTelegramUserId: 42,
  }]);
});

test('requestRoleGameCharacter creates a claim only after reloading a public free character', async () => {
  const game = sampleGame();
  const member = sampleMember();
  const character = sampleCharacter({ assignedMemberId: null, visibility: 'players' });
  const requested: unknown[] = [];
  const result = await requestRoleGameCharacter({
    roleGameRepository: roleGameRepositoryStub({ game, members: [member] }),
    characterRepository: characterRepositoryStub({
      async findCharacterById() {
        return character;
      },
      async createClaimRequest(input) {
        requested.push(input);
        return {
          id: 77,
          characterId: input.characterId,
          requestedByMemberId: input.requestedByMemberId,
          status: 'requested',
          resolvedByTelegramUserId: null,
          createdAt: '2026-07-14T10:00:00.000Z',
          updatedAt: '2026-07-14T10:00:00.000Z',
          resolvedAt: null,
        };
      },
    }),
    actor: sampleActor(),
    characterId: character.id,
  });

  assert.equal(result.status, 'requested');
  assert.deepEqual(requested, [{ characterId: character.id, requestedByMemberId: member.id }]);
});

test('assignRoleGameCharacter assigns a free character to any confirmed member for a GM', async () => {
  const game = sampleGame();
  const gm = sampleMember({ id: 9, telegramUserId: 42, role: 'primary_gm' });
  const target = sampleMember({ id: 8, telegramUserId: 800, role: 'coorganizer' });
  const character = sampleCharacter({ assignedMemberId: null });
  const assignments: unknown[] = [];
  const assigned = await assignRoleGameCharacter({
    roleGameRepository: roleGameRepositoryStub({ game, members: [gm, target] }),
    characterRepository: characterRepositoryStub({
      async findCharacterById() { return character; },
      async assignCharacter(input) {
        assignments.push(input);
        return { ...character, assignedMemberId: input.assignedMemberId };
      },
    }),
    actor: sampleActor({ telegramUserId: 42 }),
    characterId: character.id,
    assignedMemberId: target.id,
  });
  assert.equal(assigned.assignedMemberId, target.id);
  assert.equal(assignments.length, 1);
});

test('abandonRoleGameCharacter lets the current owner release a character', async () => {
  const game = sampleGame();
  const owner = sampleMember();
  const character = sampleCharacter({ assignedMemberId: owner.id });
  const abandoned = await abandonRoleGameCharacter({
    roleGameRepository: roleGameRepositoryStub({ game, members: [owner] }),
    characterRepository: characterRepositoryStub({
      async findCharacterById() { return character; },
      async unassignCharacter(input) {
        assert.equal(input.expectedAssignedMemberId, owner.id);
        return { ...character, assignedMemberId: null };
      },
    }),
    actor: sampleActor(),
    characterId: character.id,
  });
  assert.equal(abandoned.assignedMemberId, null);
});

test('updateRoleGameCharacter normalizes edits after reloading owner permissions', async () => {
  const game = sampleGame();
  const owner = sampleMember();
  const character = sampleCharacter({ assignedMemberId: owner.id });
  const updated = await updateRoleGameCharacter({
    roleGameRepository: roleGameRepositoryStub({ game, members: [owner] }),
    characterRepository: characterRepositoryStub({
      async findCharacterById() { return character; },
      async updateCharacter(input) {
        return { ...character, ...input, updatedAt: '2026-07-14T10:01:00.000Z' };
      },
    }),
    actor: sampleActor(),
    characterId: character.id,
    draft: { name: ' Nyra II ', description: '', externalUrl: null, visibility: 'private' },
  });
  assert.equal(updated.name, 'Nyra II');
  assert.equal(updated.description, null);
  assert.equal(updated.visibility, 'private');
});

test('claim approval and cancellation revalidate manager and requester membership', async () => {
  const game = sampleGame();
  const requester = sampleMember();
  const gm = sampleMember({ id: 9, telegramUserId: 42, role: 'primary_gm' });
  const character = sampleCharacter({ assignedMemberId: null, visibility: 'players' });
  const claim = {
    id: 77,
    characterId: character.id,
    requestedByMemberId: requester.id,
    status: 'requested' as const,
    resolvedByTelegramUserId: null,
    createdAt: '2026-07-14T10:00:00.000Z',
    updatedAt: '2026-07-14T10:00:00.000Z',
    resolvedAt: null,
  };
  const resolved: string[] = [];
  const characterRepository = characterRepositoryStub({
    async findCharacterById() { return character; },
    async findClaimRequestById() { return claim; },
    async resolveClaimRequest(input) {
      resolved.push(input.status);
      return {
        request: { ...claim, status: input.status },
        character: { ...character, assignedMemberId: requester.id },
      };
    },
    async cancelClaimRequest(input) {
      resolved.push('cancelled');
      assert.equal(input.expectedStatus, 'requested');
      return { ...claim, status: 'cancelled' };
    },
  });
  const roleGameRepository = roleGameRepositoryStub({ game, members: [requester, gm] });

  const approved = await approveRoleGameCharacterClaim({
    roleGameRepository,
    characterRepository,
    actor: sampleActor({ telegramUserId: 42 }),
    requestId: claim.id,
  });
  assert.equal(approved.request.status, 'approved');

  const cancelled = await cancelRoleGameCharacterRequest({
    roleGameRepository,
    characterRepository,
    actor: sampleActor(),
    requestId: claim.id,
  });
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(resolved, ['approved', 'cancelled']);
});

function sampleActor(overrides: Partial<RoleGameActor> = {}): RoleGameActor {
  return { telegramUserId: 100, isAdmin: false, isApproved: true, ...overrides };
}

function sampleGame(overrides: Partial<RoleGameRecord> = {}): RoleGameRecord {
  return {
    id: 7,
    type: 'campaign',
    status: 'active',
    title: 'La campaña',
    system: 'D20',
    description: null,
    visibility: 'members',
    publicJoinPolicy: 'members_only',
    entryMode: 'request',
    acceptanceMode: 'manual_review',
    capacity: 6,
    primaryGmTelegramUserId: 42,
    defaultDurationMinutes: 180,
    defaultTableId: null,
    defaultAttendanceMode: 'closed',
    defaultIsPublicScheduleEvent: false,
    autoAddConfirmedPlayers: false,
    allowPlayerManualScheduling: false,
    schedulingMode: 'manual',
    recurrenceRule: null,
    recurrenceWindowCount: 0,
    createdByTelegramUserId: 42,
    createdAt: '2026-07-14T10:00:00.000Z',
    updatedAt: '2026-07-14T10:00:00.000Z',
    closedAt: null,
    ...overrides,
  };
}

function sampleMember(overrides: Partial<RoleGameMemberRecord> = {}): RoleGameMemberRecord {
  return {
    id: 5,
    roleGameId: 7,
    telegramUserId: 100,
    role: 'player',
    status: 'confirmed',
    isExternal: false,
    playerNote: null,
    requestedByTelegramUserId: null,
    createdAt: '2026-07-14T10:00:00.000Z',
    updatedAt: '2026-07-14T10:00:00.000Z',
    ...overrides,
  };
}

function sampleCharacter(overrides: Partial<RoleGameCharacterRecord> = {}): RoleGameCharacterRecord {
  return {
    id: 12,
    roleGameId: 7,
    assignedMemberId: 5,
    name: 'Nyra',
    description: null,
    externalUrl: null,
    visibility: 'players',
    createdByTelegramUserId: 100,
    createdAt: '2026-07-14T10:00:00.000Z',
    updatedAt: '2026-07-14T10:00:00.000Z',
    assignedAt: '2026-07-14T10:00:00.000Z',
    unassignedAt: null,
    ...overrides,
  };
}

function sampleAttachment(
  overrides: Partial<RoleGameCharacterAttachmentRecord> = {},
): RoleGameCharacterAttachmentRecord {
  return {
    id: 20,
    characterId: 12,
    internalStorageEntryId: 30,
    visibility: 'players',
    uploadedByTelegramUserId: 100,
    createdAt: '2026-07-14T10:00:00.000Z',
    updatedAt: '2026-07-14T10:00:00.000Z',
    removedAt: null,
    removedByTelegramUserId: null,
    ...overrides,
  };
}

function roleGameRepositoryStub({
  game,
  members,
}: {
  game: RoleGameRecord;
  members: RoleGameMemberRecord[];
}): RoleGameRepository {
  return {
    async findGameById(gameId) {
      return game.id === gameId ? game : null;
    },
    async findMemberByTelegramUserId(gameId, telegramUserId) {
      return members.find((member) => member.roleGameId === gameId && member.telegramUserId === telegramUserId) ?? null;
    },
    async findMemberById(memberId) {
      return members.find((member) => member.id === memberId) ?? null;
    },
  } as RoleGameRepository;
}

function characterRepositoryStub(
  overrides: Partial<RoleGameCharacterRepository>,
): RoleGameCharacterRepository {
  return {
    async createCharacter() {
      throw new Error('Unexpected createCharacter');
    },
    async findCharacterById() {
      return null;
    },
    async listCharacters() {
      return [];
    },
    async updateCharacter() {
      throw new Error('Unexpected updateCharacter');
    },
    async assignCharacter() {
      throw new Error('Unexpected assignCharacter');
    },
    async transferCharacter() {
      throw new Error('Unexpected transferCharacter');
    },
    async unassignCharacter() {
      throw new Error('Unexpected unassignCharacter');
    },
    async createAttachment() {
      throw new Error('Unexpected createAttachment');
    },
    async findAttachmentById() {
      return null;
    },
    async listAttachments() {
      return [];
    },
    async updateAttachmentVisibility() {
      throw new Error('Unexpected updateAttachmentVisibility');
    },
    async replaceAttachmentStorageEntry() {
      throw new Error('Unexpected replaceAttachmentStorageEntry');
    },
    async removeAttachment() {
      throw new Error('Unexpected removeAttachment');
    },
    async createClaimRequest() {
      throw new Error('Unexpected createClaimRequest');
    },
    async findClaimRequestById() {
      return null;
    },
    async listClaimRequests() {
      return [];
    },
    async resolveClaimRequest() {
      throw new Error('Unexpected resolveClaimRequest');
    },
    async cancelClaimRequest() {
      throw new Error('Unexpected cancelClaimRequest');
    },
    ...overrides,
  };
}
