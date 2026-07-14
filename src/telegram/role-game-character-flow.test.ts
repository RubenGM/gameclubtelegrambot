import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildVisibleRoleGameCharacterPage,
  handleTelegramRoleGameCharacterStartText,
  handleTelegramRoleGameCharacterText,
  isSupportedRoleGameCharacterAttachmentKind,
  openRoleGameCharacters,
  parseRoleGameCharacterStartPayload,
  roleGameCharacterPageSize,
  type TelegramRoleGameCharacterContext,
} from './role-game-character-flow.js';
import type { RoleGameCharacterAttachmentRecord, RoleGameCharacterRecord, RoleGameCharacterRepository } from '../role-games/role-game-character-catalog.js';
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

function fakeCharacterRepository(initial: RoleGameCharacterRecord[] = [], portrait: RoleGameCharacterAttachmentRecord | null = null): RoleGameCharacterRepository {
  const characters = [...initial];
  return {
    createCharacter: async (input: Parameters<RoleGameCharacterRepository['createCharacter']>[0]) => {
      const created = character(characters.length + 1, { ...input, assignedAt: input.assignedMemberId ? game.createdAt : null });
      characters.push(created);
      return created;
    },
    findCharacterById: async (id: number) => characters.find((item) => item.id === id) ?? null,
    listCharacters: async () => [...characters],
    updateCharacter: async (input: Parameters<RoleGameCharacterRepository['updateCharacter']>[0]) => {
      const index = characters.findIndex((item) => item.id === input.characterId);
      const current = characters[index];
      if (!current || current.updatedAt !== input.expectedUpdatedAt) throw new Error('stale character');
      const updated = character(current.id, {
        ...current,
        name: input.name,
        description: input.description,
        externalUrl: input.externalUrl,
        visibility: input.visibility,
        updatedAt: '2026-07-14T10:01:00.000Z',
      });
      characters[index] = updated;
      return updated;
    },
    listAttachments: async () => [],
    findPortrait: async (characterId: number) => portrait?.characterId === characterId ? portrait : null,
    listClaimRequests: async () => [],
  } as unknown as RoleGameCharacterRepository;
}

function context({
  text,
  telegramUserId,
  members,
  characters,
  portrait,
  isAdmin = false,
}: {
  text: string;
  telegramUserId: number;
  members: RoleGameMemberRecord[];
  characters?: RoleGameCharacterRecord[];
  portrait?: RoleGameCharacterAttachmentRecord | null;
  isAdmin?: boolean;
}): TelegramRoleGameCharacterContext & { replies: Array<{ message: string; options?: { replyKeyboard?: Array<Array<{ text: string }>>; parseMode?: string } }>; copies: Array<{ fromChatId: number; messageId: number; toChatId: number }>; events: string[] } {
  let current: { flowKey: string; stepKey: string; data: Record<string, unknown> } | null = null;
  const replies: Array<{ message: string; options?: { replyKeyboard?: Array<Array<{ text: string }>>; parseMode?: string } }> = [];
  const copies: Array<{ fromChatId: number; messageId: number; toChatId: number }> = [];
  const events: string[] = [];
  const result = {
    messageText: text,
    reply: async (message: string, options?: object) => { events.push('detail'); replies.push({ message, ...(options ? { options } : {}) } as never); },
    replies,
    copies,
    events,
    roleGameRepository: fakeRoleRepository(members),
    characterRepository: fakeCharacterRepository(characters, portrait),
    storageRepository: {
      getEntryDetail: async (entryId: number) => entryId === portrait?.internalStorageEntryId ? ({ messages: [{ storageChatId: -1007, storageMessageId: 88 }] } as never) : null,
    } as never,
    membershipRepository: { findUserByTelegramUserId: async (id: number) => ({ telegramUserId: id, displayName: `User ${id}`, username: null }) },
    runtime: {
      bot: {
        language: 'es', publicName: 'Bot', clubName: 'Club', sendPrivateMessage: async () => undefined,
        copyMessage: async (input: { fromChatId: number; messageId: number; toChatId: number }) => { events.push('portrait'); copies.push(input); return { messageId: 99 }; },
      },
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
  assert.match(playerContext.replies.at(-1)?.message ?? '', /Mis personajes/);
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

test('every character list renders detail links in the message and keeps characters out of the reply keyboard', async () => {
  const player = member(7, 106);
  const assigned = character(21, { assignedMemberId: player.id, name: '<Strahd & compañía>' });
  const free = character(22, { assignedMemberId: null, name: 'Ireena' });

  for (const view of ['Mis personajes', 'Personajes de la campaña', 'Personajes sin asignar']) {
    const ctx = context({ text: view, telegramUserId: player.telegramUserId, members: [player], characters: [assigned, free] });
    await openRoleGameCharacters(ctx, game.id, 'es');
    assert.equal(await handleTelegramRoleGameCharacterText(ctx), true);

    const reply = ctx.replies.at(-1);
    assert.equal(reply?.options?.parseMode, 'HTML');
    assert.doesNotMatch(buttonLabels(ctx).join('\n'), /Strahd|Ireena/);
    assert.ok(buttonLabels(ctx).includes('Volver a la partida'));

    if (view !== 'Personajes sin asignar') {
      assert.match(
        reply?.message ?? '',
        /<a href="https:\/\/t\.me\/[^\"]+\?start=role_character_21"><b>&lt;Strahd &amp; compañía&gt;<\/b><\/a>/,
      );
    }
    if (view !== 'Mis personajes') {
      assert.match(reply?.message ?? '', /start=role_character_22"><b>Ireena<\/b><\/a> · Sin asignar/);
    }
  }
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
  assert.match(ctx.replies.at(-1)?.message ?? '', /foto o un documento de imagen/);
  ctx.messageText = 'Sin retrato'; await handleTelegramRoleGameCharacterText(ctx);
  ctx.messageText = 'Crear personaje'; await handleTelegramRoleGameCharacterText(ctx);
  assert.match(ctx.replies.at(-1)?.message ?? '', /Nyra/);
  assert.match(ctx.replies.at(-1)?.message ?? '', /User 103/);
});

test('character edit offers portrait upload as an editable field', async () => {
  const owner = member(9, 108);
  const editable = character(24, { assignedMemberId: owner.id, name: 'Ireena' });
  const ctx = context({ text: '/start role_character_24', telegramUserId: owner.telegramUserId, members: [owner], characters: [editable] });
  await handleTelegramRoleGameCharacterStartText(ctx);
  ctx.messageText = 'Editar personaje';
  assert.equal(await handleTelegramRoleGameCharacterText(ctx), true);
  assert.ok(buttonLabels(ctx).includes('Añadir o cambiar retrato'));
  ctx.messageText = 'Añadir o cambiar retrato';
  assert.equal(await handleTelegramRoleGameCharacterText(ctx), true);
  assert.match(ctx.replies.at(-1)?.message ?? '', /foto o un documento de imagen/);
});

test('character name edit persists after confirmation and renders the preview as HTML', async () => {
  const owner = member(10, 109);
  const editable = character(25, { assignedMemberId: owner.id, name: 'Strahd' });
  const ctx = context({ text: '/start role_character_25', telegramUserId: owner.telegramUserId, members: [owner], characters: [editable] });

  await handleTelegramRoleGameCharacterStartText(ctx);
  ctx.messageText = 'Editar personaje'; await handleTelegramRoleGameCharacterText(ctx);
  ctx.messageText = 'Nombre'; await handleTelegramRoleGameCharacterText(ctx);
  ctx.messageText = 'Strahd von Zarovich'; await handleTelegramRoleGameCharacterText(ctx);

  assert.equal(ctx.replies.at(-1)?.options?.parseMode, 'HTML');
  assert.match(ctx.replies.at(-1)?.message ?? '', /<b>Strahd von Zarovich<\/b>/);

  ctx.messageText = 'Confirmar acción';
  assert.equal(await handleTelegramRoleGameCharacterText(ctx), true);
  assert.match(ctx.replies.at(-1)?.message ?? '', /Personaje: Strahd von Zarovich/);
  assert.doesNotMatch(ctx.replies.at(-1)?.message ?? '', /Personaje: Strahd\n/);
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

test('character detail sends the stored portrait immediately after the detail message', async () => {
  const owner = member(8, 107);
  const portraitCharacter = character(23, { assignedMemberId: owner.id, name: 'Strahd' });
  const storedPortrait: RoleGameCharacterAttachmentRecord = {
    id: 70,
    characterId: portraitCharacter.id,
    internalStorageEntryId: 71,
    kind: 'portrait',
    visibility: 'players',
    uploadedByTelegramUserId: owner.telegramUserId,
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
    removedAt: null,
    removedByTelegramUserId: null,
  };
  const ctx = context({ text: '/start role_character_23', telegramUserId: owner.telegramUserId, members: [owner], characters: [portraitCharacter], portrait: storedPortrait });

  assert.equal(await handleTelegramRoleGameCharacterStartText(ctx), true);
  assert.deepEqual(ctx.events.slice(-2), ['detail', 'portrait']);
  assert.deepEqual(ctx.copies, [{ fromChatId: -1007, messageId: 88, toChatId: owner.telegramUserId }]);
});
