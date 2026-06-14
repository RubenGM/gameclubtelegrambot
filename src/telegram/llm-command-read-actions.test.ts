import test from 'node:test';
import assert from 'node:assert/strict';

import type { CatalogItemRecord } from '../catalog/catalog-model.js';
import {
  inferCatalogQueryFromReplyContext,
  llmCommandDirectReadResultLimit,
  llmCommandGroupedReadResultLimit,
  selectCatalogRecommendationCandidateSet,
} from './llm-command-read-actions.js';

test('LLM read result limits show more direct results while keeping grouped search compact', () => {
  assert.equal(llmCommandDirectReadResultLimit, 12);
  assert.equal(llmCommandGroupedReadResultLimit, 5);
});

test('inferCatalogQueryFromReplyContext extracts the title from a replied catalog detail', () => {
  assert.equal(inferCatalogQueryFromReplyContext([
    'Catálogo / S',
    'Star Wars: Rebellion',
    '',
    'Disponibilidad: Disponible',
    'Jugadores: 2-4',
    'Duración: 240',
    '',
    'Ver detalles',
  ].join('\n')), 'Star Wars: Rebellion');
});

test('inferCatalogQueryFromReplyContext ignores catalog result lists', () => {
  assert.equal(inferCatalogQueryFromReplyContext([
    'Detalle del catálogo:',
    '',
    '1. 1960: The Making of the President - board-game',
  ].join('\n')), null);
});

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

test('selectCatalogRecommendationCandidateSet uses mechanics metadata for deck builder recommendations', () => {
  const result = selectCatalogRecommendationCandidateSet({
    items: [
      catalogItem({ id: 1, displayName: 'Codenames', playerCountMin: 2, playerCountMax: 8 }),
      catalogItem({
        id: 2,
        displayName: 'Baseball Highlights: 2045',
        playerCountMin: 1,
        playerCountMax: 4,
        metadata: { mechanics: ['Deck, Bag, and Pool Building', 'Hand Management'] },
      }),
    ],
    activeLoanItemIds: new Set(),
    query: 'deck builder',
    playerCount: 2,
    itemType: 'board-game',
    availableOnly: true,
  });

  assert.equal(result.mode, 'exact');
  assert.equal(result.candidates[0]?.item.displayName, 'Baseball Highlights: 2045');
});

test('selectCatalogRecommendationCandidateSet treats a named game as a recommendation reference instead of a hard filter', () => {
  const result = selectCatalogRecommendationCandidateSet({
    items: [
      catalogItem({
        id: 1,
        displayName: 'Terraforming Mars',
        playerCountMin: 1,
        playerCountMax: 5,
        metadata: { mechanics: ['Hand Management', 'Tile Placement', 'Tags'] },
      }),
      catalogItem({
        id: 2,
        displayName: 'Ark Nova',
        playerCountMin: 1,
        playerCountMax: 4,
        metadata: { mechanics: ['Hand Management', 'Tile Placement', 'Tags'] },
      }),
      catalogItem({
        id: 3,
        displayName: 'Codenames: Duet',
        playerCountMin: 2,
        playerCountMax: 2,
        metadata: { mechanics: ['Communication Limits', 'Cooperative Game'] },
      }),
    ],
    activeLoanItemIds: new Set(),
    query: 'Terraforming Mars',
    playerCount: 2,
    itemType: 'board-game',
    availableOnly: true,
  });

  assert.equal(result.mode, 'exact');
  assert.equal(result.candidates[0]?.item.displayName, 'Ark Nova');
  assert.equal(result.candidates.some((candidate) => candidate.item.displayName === 'Terraforming Mars'), false);
});

function catalogItem(input: {
  id: number;
  displayName: string;
  playerCountMin: number | null;
  playerCountMax: number | null;
  metadata?: Record<string, unknown> | null;
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
    metadata: input.metadata ?? null,
    lifecycleStatus: 'active',
    createdAt: now,
    updatedAt: now,
    deactivatedAt: null,
  };
}
