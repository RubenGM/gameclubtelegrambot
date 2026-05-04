import test from 'node:test';
import assert from 'node:assert/strict';

import { lfgGroupAds, lfgPlayerAds } from '../infrastructure/database/schema.js';
import { createDatabaseLfgRepository } from './lfg-catalog-store.js';

const lfgGroupAdsTable = lfgGroupAds as unknown;
const lfgPlayerAdsTable = lfgPlayerAds as unknown;

test('createDatabaseLfgRepository upserts a new active player ad when none exists', async () => {
  const repository = createDatabaseLfgRepository({
    database: {
      select: () => ({
        from: (table: { [key: string]: unknown }) => {
          if ((table as unknown) !== lfgPlayerAdsTable && (table as unknown) !== lfgGroupAdsTable) {
            throw new Error('unexpected table');
          }
          return {
            leftJoin: () => ({
              where: () => ({
                orderBy: async () => [],
              }),
            }),
            where: () => ({
              orderBy: async () => [],
            }),
          };
        },
      }),
      insert: (table: { [key: string]: unknown }) => {
        assert.equal(table as unknown, lfgPlayerAdsTable);
        return {
          values: (values: Record<string, unknown>) => {
            assert.equal(values.telegramUserId, 42);
            assert.equal(values.displayName, 'Ada Lovelace');
            assert.equal(values.description, 'Eurogames mitjans els divendres');
            return {
              returning: async () => [
                {
                  id: 7,
                  telegramUserId: 42,
                  displayName: 'Ada Lovelace',
                  description: 'Eurogames mitjans els divendres',
                  status: 'active',
                  createdAt: new Date('2026-05-04T10:00:00.000Z'),
                  updatedAt: new Date('2026-05-04T10:00:00.000Z'),
                  resolvedAt: null,
                  cancelledAt: null,
                },
              ],
            };
          },
        };
      },
    } as never,
  });

  const ad = await repository.upsertActivePlayerAd({
    telegramUserId: 42,
    displayName: 'Ada Lovelace',
    description: 'Eurogames mitjans els divendres',
  });

  assert.equal(ad.id, 7);
  assert.equal(ad.status, 'active');
});

test('createDatabaseLfgRepository creates a group ad', async () => {
  const repository = createDatabaseLfgRepository({
    database: {
      insert: (table: { [key: string]: unknown }) => {
        assert.equal(table as unknown, lfgGroupAdsTable);
        return {
          values: (values: Record<string, unknown>) => {
            assert.equal(values.createdByTelegramUserId, 42);
            assert.equal(values.creatorDisplayName, 'Ada Lovelace');
            assert.equal(values.title, 'Dune Imperium');
            assert.equal(values.seatsAvailable, 2);
            return {
              returning: async () => [
                {
                  id: 8,
                  createdByTelegramUserId: 42,
                  creatorDisplayName: 'Ada Lovelace',
                  title: 'Dune Imperium',
                  description: 'Busquem dues persones per aquest divendres',
                  seatsAvailable: 2,
                  status: 'active',
                  createdAt: new Date('2026-05-04T11:00:00.000Z'),
                  updatedAt: new Date('2026-05-04T11:00:00.000Z'),
                  resolvedAt: null,
                  cancelledAt: null,
                },
              ],
            };
          },
        };
      },
    } as never,
  });

  const ad = await repository.createGroupAd({
    createdByTelegramUserId: 42,
    creatorDisplayName: 'Ada Lovelace',
    title: 'Dune Imperium',
    description: 'Busquem dues persones per aquest divendres',
    seatsAvailable: 2,
  });

  assert.equal(ad.id, 8);
  assert.equal(ad.seatsAvailable, 2);
});
