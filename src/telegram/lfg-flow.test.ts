import test from 'node:test';
import assert from 'node:assert/strict';

import type { LfgGroupAdRecord, LfgPlayerAdRecord, LfgRepository } from '../lfg/lfg-catalog.js';
import type { ConversationSessionRecord } from './conversation-session.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import { handleTelegramLfgCallback, handleTelegramLfgCommand, handleTelegramLfgText } from './lfg-flow.js';

function createRepository(): LfgRepository {
  const playerAds = new Map<number, LfgPlayerAdRecord>();
  const groupAds = new Map<number, LfgGroupAdRecord>();
  let nextId = 1;

  return {
    async upsertActivePlayerAd(input) {
      const existing = Array.from(playerAds.values()).find(
        (ad) => ad.telegramUserId === input.telegramUserId && ad.status === 'active',
      );
      const ad: LfgPlayerAdRecord = {
        id: existing?.id ?? nextId++,
        telegramUserId: input.telegramUserId,
        displayName: input.displayName,
        username: 'adalovelace',
        description: input.description,
        status: 'active',
        createdAt: existing?.createdAt ?? '2026-05-04T10:00:00.000Z',
        updatedAt: '2026-05-04T10:30:00.000Z',
        resolvedAt: null,
        cancelledAt: null,
      };
      playerAds.set(ad.id, ad);
      return ad;
    },
    async createGroupAd(input) {
      const ad: LfgGroupAdRecord = {
        id: nextId++,
        createdByTelegramUserId: input.createdByTelegramUserId,
        creatorDisplayName: input.creatorDisplayName,
        creatorUsername: 'adalovelace',
        title: input.title,
        description: input.description,
        seatsAvailable: input.seatsAvailable,
        status: 'active',
        createdAt: '2026-05-04T11:00:00.000Z',
        updatedAt: '2026-05-04T11:00:00.000Z',
        resolvedAt: null,
        cancelledAt: null,
      };
      groupAds.set(ad.id, ad);
      return ad;
    },
    async updatePlayerAd(input) {
      const existing = playerAds.get(input.adId);
      if (!existing) throw new Error('not found');
      const next = { ...existing, displayName: input.displayName, description: input.description };
      playerAds.set(next.id, next);
      return next;
    },
    async updateGroupAd(input) {
      const existing = groupAds.get(input.adId);
      if (!existing) throw new Error('not found');
      const next = { ...existing, title: input.title, description: input.description, seatsAvailable: input.seatsAvailable };
      groupAds.set(next.id, next);
      return next;
    },
    async setPlayerAdStatus(input) {
      const existing = playerAds.get(input.adId);
      if (!existing || existing.telegramUserId !== input.actorTelegramUserId || existing.status !== 'active') {
        throw new Error('not found');
      }
      const next = { ...existing, status: input.status } satisfies LfgPlayerAdRecord;
      playerAds.set(next.id, next);
      return next;
    },
    async setGroupAdStatus(input) {
      const existing = groupAds.get(input.adId);
      if (!existing || existing.createdByTelegramUserId !== input.actorTelegramUserId || existing.status !== 'active') {
        throw new Error('not found');
      }
      const next = { ...existing, status: input.status } satisfies LfgGroupAdRecord;
      groupAds.set(next.id, next);
      return next;
    },
    async listActivePlayerAds() {
      return Array.from(playerAds.values()).filter((ad) => ad.status === 'active');
    },
    async listActiveGroupAds() {
      return Array.from(groupAds.values()).filter((ad) => ad.status === 'active');
    },
    async listActiveAdsByUser(telegramUserId) {
      return {
        playerAds: Array.from(playerAds.values()).filter(
          (ad) => ad.telegramUserId === telegramUserId && ad.status === 'active',
        ),
        groupAds: Array.from(groupAds.values()).filter(
          (ad) => ad.createdByTelegramUserId === telegramUserId && ad.status === 'active',
        ),
      };
    },
    async findPlayerAdById(adId) {
      return playerAds.get(adId) ?? null;
    },
    async findGroupAdById(adId) {
      return groupAds.get(adId) ?? null;
    },
  };
}

function createContext(repository: LfgRepository): {
  context: TelegramCommandHandlerContext & { lfgRepository: LfgRepository };
  replies: Array<{ message: string; options?: TelegramReplyOptions }>;
  getCurrentSession(): ConversationSessionRecord | null;
} {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  let currentSession: ConversationSessionRecord | null = null;

  return {
    context: {
      from: {
        id: 42,
        first_name: 'Ada',
        last_name: 'Lovelace',
        username: 'adalovelace',
      },
      reply: async (message: string, options?: TelegramReplyOptions) => {
        replies.push({ message, ...(options ? { options } : {}) });
      },
      runtime: {
        bot: {
          publicName: 'Game Club Bot',
          clubName: 'Game Club',
          language: 'ca',
          sendPrivateMessage: async () => undefined,
        },
        services: {
          database: {
            db: undefined as never,
          },
        } as never,
        chat: {
          kind: 'private',
          chatId: 1,
        },
        actor: {
          telegramUserId: 42,
          status: 'approved',
          isApproved: true,
          isBlocked: false,
          isAdmin: false,
          permissions: [],
        },
        authorization: {
          authorize: () => ({ allowed: false, permissionKey: 'lfg.manage', reason: 'no-match' }),
          can: () => false,
        },
        session: {
          get current() {
            return currentSession;
          },
          start: async ({ flowKey, stepKey, data = {} }: { flowKey: string; stepKey: string; data?: Record<string, unknown> }) => {
            currentSession = {
              key: 'telegram.session:1:42',
              flowKey,
              stepKey,
              data,
              createdAt: '2026-05-04T10:00:00.000Z',
              updatedAt: '2026-05-04T10:00:00.000Z',
              expiresAt: '2026-05-05T10:00:00.000Z',
            };
            return currentSession;
          },
          advance: async ({ stepKey, data }: { stepKey: string; data: Record<string, unknown> }) => {
            if (!currentSession) throw new Error('no active session');
            currentSession = { ...currentSession, stepKey, data, updatedAt: '2026-05-04T10:30:00.000Z' };
            return currentSession;
          },
          cancel: async () => {
            currentSession = null;
            return true;
          },
        },
      },
      lfgRepository: repository,
    },
    replies,
    getCurrentSession() {
      return currentSession;
    },
  };
}

test('handleTelegramLfgCommand opens the LFG submenu', async () => {
  const { context, replies } = createContext(createRepository());

  await handleTelegramLfgCommand(context);

  assert.equal(replies[0]?.message, 'LFG: tria una acció.');
  assert.deepEqual(replies[0]?.options?.replyKeyboard, [
    ['Jugadors buscant grup'],
    ['Grups buscant jugadors'],
    ['Busco grup', 'Busquem jugadors'],
    ['Els meus anuncis'],
    ['Tornar'],
    ['Inici', 'Ajuda'],
  ]);
});

test('handleTelegramLfgText returns from the LFG submenu to the main menu', async () => {
  const { context, replies } = createContext(createRepository());
  context.messageText = 'Tornar';

  const handled = await handleTelegramLfgText(context);

  assert.equal(handled, true);
  assert.equal(replies[0]?.message, 'Toca un botó del menú per continuar.');
  assert.deepEqual(replies[0]?.options?.replyKeyboard, [
    [{ text: 'Activitats', semanticRole: 'primary' }, { text: 'Taules', semanticRole: 'primary' }],
    [{ text: 'Catàleg', semanticRole: 'primary' }, { text: 'Emmagatzematge', semanticRole: 'primary' }],
    [{ text: 'Compres conjuntes', semanticRole: 'primary' }, { text: 'LFG', semanticRole: 'primary' }],
    [{ text: 'Idioma', semanticRole: 'secondary' }, { text: 'Ajuda', semanticRole: 'help' }],
  ]);
});

test('handleTelegramLfgText publishes a player ad through the confirmation flow', async () => {
  const repository = createRepository();
  const { context, replies, getCurrentSession } = createContext(repository);

  for (const messageText of ['Busco grup', 'Eurogames mitjans els divendres', 'Publicar anunci', 'Jugadors buscant grup']) {
    context.messageText = messageText;
    await handleTelegramLfgText(context);
  }

  assert.equal(getCurrentSession(), null);
  assert.equal(replies.at(-2)?.message, 'Anunci de jugador publicat correctament.');
  const ads = await repository.listActivePlayerAds();
  assert.equal(ads.length, 1);
  assert.equal(ads[0]?.displayName, 'Ada Lovelace');
  assert.match(replies.at(-1)?.message ?? '', /<a href="https:\/\/t\.me\/adalovelace"><b>Ada Lovelace \(@adalovelace\)<\/b><\/a>/);
});

test('handleTelegramLfgText publishes a group ad and lists it', async () => {
  const repository = createRepository();
  const { context, replies } = createContext(repository);

  for (const messageText of [
    'Busquem jugadors',
    'Dune Imperium',
    'Busquem dues persones per aquest divendres',
    '2',
    'Publicar anunci',
    'Grups buscant jugadors',
  ]) {
    context.messageText = messageText;
    await handleTelegramLfgText(context);
  }

  assert.equal(replies.at(-2)?.message, 'Anunci de grup publicat correctament.');
  assert.match(replies.at(-1)?.message ?? '', /Dune Imperium/);
  assert.match(replies.at(-1)?.message ?? '', /<a href="https:\/\/t\.me\/adalovelace">Ada Lovelace \(@adalovelace\)<\/a>/);
  assert.match(replies.at(-1)?.message ?? '', /Places: 2/);
});

test('handleTelegramLfgCallback resolves an owned player ad', async () => {
  const repository = createRepository();
  const { context, replies } = createContext(repository);
  await repository.upsertActivePlayerAd({
    telegramUserId: 42,
    displayName: 'Ada Lovelace',
    description: 'Eurogames mitjans els divendres',
  });

  context.callbackData = 'lfg:resolve_player:1';
  const handled = await handleTelegramLfgCallback(context);

  assert.equal(handled, true);
  assert.equal(replies[0]?.message, 'Anunci marcat com a resolt.');
  assert.equal((await repository.listActivePlayerAds()).length, 0);
});
