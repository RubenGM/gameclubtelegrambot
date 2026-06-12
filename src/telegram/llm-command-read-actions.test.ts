import test from 'node:test';
import assert from 'node:assert/strict';

import type { CatalogItemRecord } from '../catalog/catalog-model.js';
import { selectCatalogRecommendationCandidateSet } from './llm-command-read-actions.js';

test('selectCatalogRecommendationCandidateSet returns exact available matches first', () => {
  const result = selectCatalogRecommendationCandidateSet({
    items: [
      catalogItem({ id: 1, displayName: 'Azul', playerCountMin: 2, playerCountMax: 4 }),
      catalogItem({ id: 2, displayName: 'Codenames', playerCountMin: 2, playerCountMax: 8 }),
    ],
    activeLoanItemIds: new Set([2]),
    query: null,
    playerCount: 4,
    itemType: 'board-game',
    availableOnly: true,
  });

  assert.equal(result.mode, 'exact');
  assert.deepEqual(result.candidates.map((candidate) => candidate.item.displayName), ['Azul']);
  assert.match(result.intro, /4 personas/);
});

test('selectCatalogRecommendationCandidateSet falls back to nearby player counts', () => {
  const result = selectCatalogRecommendationCandidateSet({
    items: [
      catalogItem({ id: 1, displayName: 'Three Player Game', playerCountMin: 3, playerCountMax: 3 }),
      catalogItem({ id: 2, displayName: 'Six Player Game', playerCountMin: 6, playerCountMax: 6 }),
    ],
    activeLoanItemIds: new Set(),
    query: null,
    playerCount: 4,
    itemType: 'board-game',
    availableOnly: true,
  });

  assert.equal(result.mode, 'nearby_players');
  assert.deepEqual(result.candidates.map((candidate) => candidate.item.displayName), ['Three Player Game']);
  assert.match(result.intro, /opciones cercanas/);
  assert.equal(result.candidates[0]?.matchNote, '(opción cercana por número de jugadores)');
});

test('selectCatalogRecommendationCandidateSet falls back to borrowed exact matches', () => {
  const result = selectCatalogRecommendationCandidateSet({
    items: [
      catalogItem({ id: 1, displayName: 'Borrowed Game', playerCountMin: 2, playerCountMax: 4 }),
    ],
    activeLoanItemIds: new Set([1]),
    query: null,
    playerCount: 4,
    itemType: 'board-game',
    availableOnly: true,
  });

  assert.equal(result.mode, 'borrowed');
  assert.equal(result.candidates[0]?.available, false);
  assert.match(result.intro, /están prestados/);
});

test('selectCatalogRecommendationCandidateSet falls back to missing player metadata', () => {
  const result = selectCatalogRecommendationCandidateSet({
    items: [
      catalogItem({ id: 1, displayName: 'Unknown Players', playerCountMin: null, playerCountMax: null }),
    ],
    activeLoanItemIds: new Set(),
    query: null,
    playerCount: 4,
    itemType: 'board-game',
    availableOnly: true,
  });

  assert.equal(result.mode, 'missing_player_metadata');
  assert.match(result.intro, /sin metadatos|no tienen ese dato/i);
  assert.equal(result.candidates[0]?.matchNote, '(sin metadatos de jugadores)');
});

function catalogItem(input: {
  id: number;
  displayName: string;
  playerCountMin: number | null;
  playerCountMax: number | null;
}): CatalogItemRecord {
  const now = new Date().toISOString();
  return {
    id: input.id,
    familyId: null,
    groupId: null,
    ownerTelegramUserId: null,
    itemType: 'board-game',
    displayName: input.displayName,
    originalName: null,
    description: null,
    language: null,
    publisher: null,
    publicationYear: null,
    playerCountMin: input.playerCountMin,
    playerCountMax: input.playerCountMax,
    recommendedAge: null,
    playTimeMinutes: null,
    externalRefs: null,
    metadata: null,
    lifecycleStatus: 'active',
    createdAt: now,
    updatedAt: now,
    deactivatedAt: null,
  };
}
