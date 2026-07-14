import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canEditRoleGameCharacter,
  canRequestRoleGameCharacter,
  canViewRoleGameCharacter,
  canViewRoleGameCharacterAttachment,
  normalizeRoleGameCharacterDraft,
  type RoleGameCharacterAttachmentRecord,
  type RoleGameCharacterRecord,
} from './role-game-character-catalog.js';
import type { RoleGameActor, RoleGameMemberRecord, RoleGameRecord } from './role-game-catalog.js';

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
