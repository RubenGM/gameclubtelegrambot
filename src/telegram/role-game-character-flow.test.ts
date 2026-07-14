import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRoleGameCharacterButtonMap,
  buildVisibleRoleGameCharacterPage,
  handleTelegramRoleGameCharacterStartText,
  handleTelegramRoleGameCharacterText,
  isSupportedRoleGameCharacterAttachmentKind,
  openRoleGameCharacters,
  parseRoleGameCharacterStartPayload,
  roleGameCharacterPageSize,
  type TelegramRoleGameCharacterContext,
} from './role-game-character-flow.js';
import type { RoleGameCharacterRecord, RoleGameCharacterRepository } from '../role-games/role-game-character-catalog.js';
import type { RoleGameMemberRecord, RoleGameRecord, RoleGameRepository } from '../role-games/role-game-catalog.js';

function character(id: number, overrides: Partial<RoleGameCharacterRecord> = {}): RoleGameCharacterRecord {
  return {
    id,
    roleGameId: 7,
    assignedMemberId: null,
    name: `Character ${id}`,
    description: null,
    externalUrl: null,
    visibility: 'players',
    createdByTelegramUserId: 100,
    createdAt: '2026-07-14T10:00:00.000Z',
    updatedAt: '2026-07-14T10:00:00.000Z',
    assignedAt: null,
    unassignedAt: null,
    ...overrides,
  };
}

test('character pages contain six visible records and clamp stale pages', () => {
  const result = buildVisibleRoleGameCharacterPage({
    characters: Array.from({ length: 7 }, (_, index) => character(index + 1)),
    page: 99,
  });
  assert.equal(roleGameCharacterPageSize, 6);
  assert.equal(result.page, 2);
  assert.deepEqual(result.items.map((item) => item.id), [7]);
  assert.equal(result.total, 7);
});

test('duplicate character names use session-safe labels', () => {
  const result = buildRoleGameCharacterButtonMap([
    character(2, { name: 'Nyra' }),
    character(1, { name: 'Nyra' }),
    character(3, { name: 'Orin' }),
  ], []);
  assert.deepEqual(result, { 'Nyra · #2': 2, 'Nyra · #1': 1, Orin: 3 });
  assert.equal((result as Record<string, number>)['Nyra'], undefined);
});

test('reserved labels and fabricated buttons cannot select a character', () => {
  const result = buildRoleGameCharacterButtonMap([character(4, { name: 'Anterior' })], ['Anterior']);
  assert.deepEqual(result, { 'Anterior · #4': 4 });
  assert.equal((result as Record<string, number>)['Personaje inventado'], undefined);
});

test('character deep links only accept positive integer ids', () => {
  assert.equal(parseRoleGameCharacterStartPayload('/start role_character_42'), 42);
  assert.equal(parseRoleGameCharacterStartPayload('role_character_42'), 42);
  assert.equal(parseRoleGameCharacterStartPayload('/start role_character_0'), null);
  assert.equal(parseRoleGameCharacterStartPayload('/start role_character_42_more'), null);
  assert.equal(parseRoleGameCharacterStartPayload('/start role_game_42'), null);
});

test('character attachments accept every planned Telegram media kind and reject others', () => {
  for (const kind of ['document', 'photo', 'video', 'audio']) {
    assert.equal(isSupportedRoleGameCharacterAttachmentKind(kind), true);
  }
  assert.equal(isSupportedRoleGameCharacterAttachmentKind('text'), false);
  assert.equal(isSupportedRoleGameCharacterAttachmentKind('animation'), false);
});

const game: RoleGameRecord = {
  id: 7, type: 'campaign', status: 'active', title: 'La Crida', system: 'Cthulhu', description: null,
  visibility: 'members', publicJoinPolicy: 'members_only', entryMode: 'request', acceptanceMode: 'manual_review', capacity: 6,
  primaryGmTelegramUserId: 900, defaultDurationMinutes: 180, defaultTableId: null, defaultAttendanceMode: 'closed',
  defaultIsPublicScheduleEvent: false, autoAddConfirmedPlayers: true, allowPlayerManualScheduling: false,
  schedulingMode: 'manual', recurrenceRule: null, recurrenceWindowCount: 0, createdByTelegramUserId: 900,
  createdAt: '2026-07-14T10:00:00.000Z', updatedAt: '2026-07-14T10:00:00.000Z', closedAt: null,
};

function member(id: number, telegramUserId: number, overrides: Partial<RoleGameMemberRecord> = {}): RoleGameMemberRecord {
  return {
    id, roleGameId: game.id, telegramUserId, role: 'player', status: 'confirmed', isExternal: false,
    playerNote: null, requestedByTelegramUserId: null, createdAt: game.createdAt, updatedAt: game.updatedAt, ...overrides,
  };
}

function fakeRoleRepository(members: RoleGameMemberRecord[]): RoleGameRepository {
  return {
    findGameById: async (id: number) => id === game.id ? game : null,
    findMemberByTelegramUserId: async (_gameId: number, userId: number) => members.find((item) => item.telegramUserId === userId) ?? null,
    findMemberById: async (id: number) => members.find((item) => item.id === id) ?? null,
    listMembers: async () => members,
  } as unknown as RoleGameRepository;
}

function fakeCharacterRepository(initial: RoleGameCharacterRecord[] = []): RoleGameCharacterRepository {
  const characters = [...initial];
  return {
    createCharacter: async (input: Parameters<RoleGameCharacterRepository['createCharacter']>[0]) => {
      const created = character(characters.length + 1, { ...input, assignedAt: input.assignedMemberId ? game.createdAt : null });
      characters.push(created);
      return created;
    },
    findCharacterById: async (id: number) => characters.find((item) => item.id === id) ?? null,
    listCharacters: async () => [...characters],
    listAttachments: async () => [],
    listClaimRequests: async () => [],
  } as unknown as RoleGameCharacterRepository;
}

function context({
  text,
  telegramUserId,
  members,
  characters,
  isAdmin = false,
}: {
  text: string;
  telegramUserId: number;
  members: RoleGameMemberRecord[];
  characters?: RoleGameCharacterRecord[];
  isAdmin?: boolean;
}): TelegramRoleGameCharacterContext & { replies: Array<{ message: string; options?: { replyKeyboard?: Array<Array<{ text: string }>> } }> } {
  let current: { flowKey: string; stepKey: string; data: Record<string, unknown> } | null = null;
  const replies: Array<{ message: string; options?: { replyKeyboard?: Array<Array<{ text: string }>> } }> = [];
  const result = {
    messageText: text,
    reply: async (message: string, options?: object) => { replies.push({ message, ...(options ? { options } : {}) } as never); },
    replies,
    roleGameRepository: fakeRoleRepository(members),
    characterRepository: fakeCharacterRepository(characters),
    membershipRepository: { findUserByTelegramUserId: async (id: number) => ({ telegramUserId: id, displayName: `User ${id}`, username: null }) },
    runtime: {
      bot: { language: 'es', publicName: 'Bot', clubName: 'Club', sendPrivateMessage: async () => undefined },
      chat: { kind: 'private', chatId: telegramUserId },
      actor: { telegramUserId, isAdmin, isApproved: true, isBlocked: false },
      session: {
        get current() { return current; },
        start: async (value: typeof current) => { current = value; },
        advance: async (value: { stepKey: string; data: Record<string, unknown> }) => { if (current) current = { ...current, ...value }; },
        cancel: async () => { current = null; },
      },
      services: { database: { db: {} } },
    },
  };
  return result as unknown as ReturnType<typeof context>;
}

function buttonLabels(value: ReturnType<typeof context>): string[] {
  return value.replies.at(-1)?.options?.replyKeyboard?.flat().map((button) => button.text) ?? [];
}

test('confirmed players and operational GMs get the character section with role-specific actions', async () => {
  const player = member(1, 100);
  const playerContext = context({ text: 'Personajes', telegramUserId: 100, members: [player] });
  assert.equal(await openRoleGameCharacters(playerContext, game.id, 'es'), true);
  assert.ok(buttonLabels(playerContext).includes('Mis personajes'));
  assert.ok(!buttonLabels(playerContext).includes('Solicitudes de personaje'));

  const gm = member(2, 900, { role: 'primary_gm' });
  const gmContext = context({ text: 'Personajes', telegramUserId: 900, members: [gm] });
  assert.equal(await openRoleGameCharacters(gmContext, game.id, 'es'), true);
  assert.ok(buttonLabels(gmContext).includes('Solicitudes de personaje'));
  assert.ok(buttonLabels(gmContext).includes('Asignar personaje'));
});

test('visitors and historical members cannot open the character section', async () => {
  const historical = member(3, 101, { status: 'left' });
  assert.equal(await openRoleGameCharacters(context({ text: 'Personajes', telegramUserId: 101, members: [historical] }), game.id, 'es'), false);
  assert.equal(await openRoleGameCharacters(context({ text: 'Personajes', telegramUserId: 102, members: [] }), game.id, 'es'), false);
});

test('a player creation wizard always assigns the new character to that confirmed member', async () => {
  const player = member(4, 103);
  const ctx = context({ text: 'Crear personaje', telegramUserId: 103, members: [player] });
  await openRoleGameCharacters(ctx, game.id, 'es');
  await handleTelegramRoleGameCharacterText(ctx);
  ctx.messageText = 'Nyra'; await handleTelegramRoleGameCharacterText(ctx);
  ctx.messageText = 'Omitir'; await handleTelegramRoleGameCharacterText(ctx);
  ctx.messageText = 'Omitir'; await handleTelegramRoleGameCharacterText(ctx);
  ctx.messageText = 'jugadores'; await handleTelegramRoleGameCharacterText(ctx);
  ctx.messageText = 'Crear personaje'; await handleTelegramRoleGameCharacterText(ctx);
  assert.match(ctx.replies.at(-1)?.message ?? '', /Nyra/);
  assert.match(ctx.replies.at(-1)?.message ?? '', /User 103/);
});

test('private character deep links use a non-disclosing unavailable response for other players', async () => {
  const owner = member(5, 104);
  const other = member(6, 105);
  const privateCharacter = character(20, { assignedMemberId: owner.id, visibility: 'private', name: 'Secret' });
  const ctx = context({ text: '/start role_character_20', telegramUserId: other.telegramUserId, members: [owner, other], characters: [privateCharacter] });
  assert.equal(await handleTelegramRoleGameCharacterStartText(ctx), true);
  assert.doesNotMatch(ctx.replies.at(-1)?.message ?? '', /Secret/);
  assert.match(ctx.replies.at(-1)?.message ?? '', /no está disponible/);
});
