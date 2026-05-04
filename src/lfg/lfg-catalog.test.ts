import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cancelLfgGroupAd,
  createLfgGroupAd,
  resolveLfgPlayerAd,
  updateLfgPlayerAd,
  upsertLfgPlayerAd,
  type LfgGroupAdRecord,
  type LfgPlayerAdRecord,
  type LfgRepository,
} from './lfg-catalog.js';

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
        username: null,
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
        creatorUsername: null,
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
      const next = {
        ...existing,
        title: input.title,
        description: input.description,
        seatsAvailable: input.seatsAvailable,
      };
      groupAds.set(next.id, next);
      return next;
    },
    async setPlayerAdStatus(input) {
      const existing = playerAds.get(input.adId);
      if (!existing) throw new Error('not found');
      const next = {
        ...existing,
        status: input.status,
        resolvedAt: input.status === 'resolved' ? '2026-05-04T12:00:00.000Z' : null,
        cancelledAt: input.status === 'cancelled' ? '2026-05-04T12:00:00.000Z' : null,
      } satisfies LfgPlayerAdRecord;
      playerAds.set(next.id, next);
      return next;
    },
    async setGroupAdStatus(input) {
      const existing = groupAds.get(input.adId);
      if (!existing) throw new Error('not found');
      const next = {
        ...existing,
        status: input.status,
        resolvedAt: input.status === 'resolved' ? '2026-05-04T12:00:00.000Z' : null,
        cancelledAt: input.status === 'cancelled' ? '2026-05-04T12:00:00.000Z' : null,
      } satisfies LfgGroupAdRecord;
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

test('upsertLfgPlayerAd normalizes and updates a single active player ad', async () => {
  const repository = createRepository();
  const first = await upsertLfgPlayerAd({
    repository,
    telegramUserId: 42,
    displayName: '  Ada   Lovelace  ',
    description: '  Prefer Eurogames   evenings  ',
  });
  const second = await upsertLfgPlayerAd({
    repository,
    telegramUserId: 42,
    displayName: 'Ada',
    description: 'Open to medium games on Fridays',
  });

  assert.equal(first.id, second.id);
  assert.equal(first.displayName, 'Ada Lovelace');
  assert.equal(second.description, 'Open to medium games on Fridays');
});

test('createLfgGroupAd validates title, description and seats', async () => {
  const repository = createRepository();
  await assert.rejects(
    () =>
      createLfgGroupAd({
        repository,
        createdByTelegramUserId: 42,
        creatorDisplayName: 'Ada',
        title: 'Go',
        description: 'Looking for two players',
        seatsAvailable: 2,
      }),
    /title/,
  );
  await assert.rejects(
    () =>
      createLfgGroupAd({
        repository,
        createdByTelegramUserId: 42,
        creatorDisplayName: 'Ada',
        title: 'Dune',
        description: 'short',
        seatsAvailable: 2,
      }),
    /description/,
  );
  await assert.rejects(
    () =>
      createLfgGroupAd({
        repository,
        createdByTelegramUserId: 42,
        creatorDisplayName: 'Ada',
        title: 'Dune',
        description: 'Looking for two players',
        seatsAvailable: 0,
      }),
    /seats/,
  );
});

test('status changes require ownership and active ads', async () => {
  const repository = createRepository();
  const playerAd = await upsertLfgPlayerAd({
    repository,
    telegramUserId: 42,
    displayName: 'Ada',
    description: 'Open to medium games on Fridays',
  });
  const resolved = await resolveLfgPlayerAd({ repository, adId: playerAd.id, actorTelegramUserId: 42 });

  assert.equal(resolved.status, 'resolved');
  await assert.rejects(
    () => updateLfgPlayerAd({ repository, adId: playerAd.id, telegramUserId: 42, displayName: 'Ada', description: 'Still looking' }),
    /not active/,
  );

  const groupAd = await createLfgGroupAd({
    repository,
    createdByTelegramUserId: 77,
    creatorDisplayName: 'Grace',
    title: 'Ark Nova',
    description: 'Need players for Sunday afternoon',
    seatsAvailable: null,
  });

  await assert.rejects(
    () => cancelLfgGroupAd({ repository, adId: groupAd.id, actorTelegramUserId: 42 }),
    /another user/,
  );
});
