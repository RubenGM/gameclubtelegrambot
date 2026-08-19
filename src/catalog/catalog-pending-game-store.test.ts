import test from 'node:test';
import assert from 'node:assert/strict';

import { catalogPendingGames } from '../infrastructure/database/schema.js';
import {
  createDatabaseCatalogPendingGameRepository,
  normalizeCatalogPendingGameName,
} from './catalog-pending-game-store.js';

const pendingGamesTable = catalogPendingGames as unknown;

test('normalizeCatalogPendingGameName deduplicates punctuation, case and accents', () => {
  assert.equal(normalizeCatalogPendingGameName('  DÚNE: Immortality  '), 'dune immortality');
  assert.equal(normalizeCatalogPendingGameName('Dune – Immortality'), 'dune immortality');
});

test('createDatabaseCatalogPendingGameRepository persists and manages pending games', async () => {
  const row = {
    id: 7,
    normalizedName: 'coyote',
    displayName: 'Coyote',
    detectedByTelegramUserId: 99,
    detectedCount: 2,
    attemptCount: 1,
    lastFailureType: 'ambiguous',
    lastFailureMessage: null,
    candidates: ['Coyote (2003) [API #8172]'],
    lastAttemptAt: new Date('2026-08-18T18:05:00.000Z'),
    createdAt: new Date('2026-08-18T18:00:00.000Z'),
    updatedAt: new Date('2026-08-18T18:05:00.000Z'),
  };
  const inserted: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  let deleted = false;
  const repository = createDatabaseCatalogPendingGameRepository({
    database: {
      insert(table: unknown) {
        assert.equal(table, pendingGamesTable);
        return {
          values(values: Record<string, unknown>) {
            inserted.push(values);
            return {
              onConflictDoUpdate() {
                return { returning: async () => [row] };
              },
            };
          },
        };
      },
      select() {
        return {
          from(table: unknown) {
            assert.equal(table, pendingGamesTable);
            return {
              orderBy: async () => [row],
              where: () => ({ limit: async () => [row] }),
            };
          },
        };
      },
      update(table: unknown) {
        assert.equal(table, pendingGamesTable);
        return {
          set(values: Record<string, unknown>) {
            updated.push(values);
            return { where: () => ({ returning: async () => [row] }) };
          },
        };
      },
      delete(table: unknown) {
        assert.equal(table, pendingGamesTable);
        return {
          where() {
            deleted = true;
            return { returning: async () => [{ id: 7 }] };
          },
        };
      },
    } as never,
  });

  const upserted = await repository.upsertDetected({ displayName: 'Coyote', detectedByTelegramUserId: 99 });
  assert.equal(inserted[0]?.normalizedName, 'coyote');
  assert.equal(upserted.id, 7);
  assert.deepEqual((await repository.list())[0]?.candidates, ['Coyote (2003) [API #8172]']);
  assert.equal((await repository.findById(7))?.displayName, 'Coyote');

  const failed = await repository.recordAttemptFailure({
    displayName: 'Coyote',
    failureType: 'ambiguous',
    failureMessage: null,
    candidates: ['Coyote (2003) [API #8172]'],
  });
  assert.equal(updated[0]?.lastFailureType, 'ambiguous');
  assert.equal(failed?.attemptCount, 1);

  const corrected = await repository.recordAttemptFailureById({
    id: 7,
    displayName: 'Coyote 2003',
    failureType: 'no-match',
    failureMessage: 'Not found',
    candidates: [],
  });
  assert.equal(updated[1]?.displayName, 'Coyote 2003');
  assert.equal(updated[1]?.normalizedName, 'coyote 2003');
  assert.equal(updated[1]?.lastFailureType, 'no-match');
  assert.equal(corrected?.id, 7);

  assert.equal(await repository.deleteById(7), true);
  assert.equal(await repository.deleteByDisplayName('Coyote'), true);
  assert.equal(deleted, true);
});
