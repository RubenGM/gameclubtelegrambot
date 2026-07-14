import test from 'node:test';
import assert from 'node:assert/strict';

import type { CatalogItemRecord } from '../catalog/catalog-model.js';
import type { StorageCategoryRecord } from '../storage/storage-catalog.js';
import {
  storageCategories,
  storageEntries,
  storageEntryMessages,
  users,
} from '../infrastructure/database/schema.js';
import {
  buildStorageCategoryPath,
  executeTelegramLlmReadAction,
  inferCatalogQueryFromReplyContext,
  llmCommandDirectReadResultLimit,
  llmCommandGroupedReadResultLimit,
  normalizeStorageFileExtensionsForSearch,
  resolveStorageCategoryMatchIds,
  selectCatalogRecommendationCandidateSet,
} from './llm-command-read-actions.js';

const storageCategoriesTable = storageCategories as unknown;
const storageEntriesTable = storageEntries as unknown;
const storageEntryMessagesTable = storageEntryMessages as unknown;
const usersTable = users as unknown;

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

test('resolveStorageCategoryMatchIds expands matching storage categories to descendants', () => {
  const categories = [
    storageCategory({ id: 15, displayName: 'Archivos STL', slug: 'stl', parentCategoryId: null }),
    storageCategory({ id: 92, displayName: 'Anime', slug: 'anime', parentCategoryId: 15 }),
    storageCategory({ id: 93, displayName: 'Attack on Titan', slug: 'attack-on-titan', parentCategoryId: 92 }),
    storageCategory({ id: 94, displayName: 'Mikasa & Levi Diorama', slug: 'mikasa-levi-diorama', parentCategoryId: 93 }),
    storageCategory({ id: 109, displayName: 'Dragon Ball', slug: 'dragon-ball', parentCategoryId: 92 }),
  ];

  assert.deepEqual(
    resolveStorageCategoryMatchIds(categories, 'qué archivos STL tenemos de Attack on Titan?').sort((a, b) => a - b),
    [93, 94],
  );
});

test('buildStorageCategoryPath includes storage category ancestors for semantic filtering', () => {
  const categories = [
    storageCategory({ id: 15, displayName: 'Archivos STL', slug: 'stl', parentCategoryId: null }),
    storageCategory({ id: 92, displayName: 'Anime', slug: 'anime', parentCategoryId: 15 }),
    storageCategory({ id: 93, displayName: 'Attack on Titan', slug: 'attack-on-titan', parentCategoryId: 92 }),
    storageCategory({ id: 94, displayName: 'Mikasa & Levi Diorama', slug: 'mikasa-levi-diorama', parentCategoryId: 93 }),
  ];

  assert.deepEqual(buildStorageCategoryPath(94, categories), ['Archivos STL', 'Anime', 'Attack on Titan', 'Mikasa & Levi Diorama']);
});

test('normalizeStorageFileExtensionsForSearch treats STL as content type instead of literal file extension', () => {
  assert.deepEqual(normalizeStorageFileExtensionsForSearch(['.stl', 'PDF', ' zip ', 'rar', 'pdf']), ['pdf', 'zip', 'rar']);
});

test('executeTelegramLlmReadAction hides role game handouts from Storage search', async () => {
  const response = await executeTelegramLlmReadAction(createLlmReadContextWithStorageHandout() as never, {
    intent: 'storage.search',
    params: { query: 'villano' },
  });

  assert.doesNotMatch(response, /Secreto del villano|Handouts de rol|storage_entry_15/);
  assert.equal(response, 'Resultados de Storage: no hay resultados.');
});

test('executeTelegramLlmReadAction hides role game handouts from bot search Storage results', async () => {
  const response = await executeTelegramLlmReadAction(createLlmReadContextWithStorageHandout() as never, {
    intent: 'bot.search',
    params: { query: 'villano', sources: ['storage'] },
    userText: 'busca villano',
  });

  assert.doesNotMatch(response, /Secreto del villano|Handouts de rol|storage_entry_15/);
  assert.equal(response, 'No he encontrado resultados para villano en Storage.');
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

function storageCategory(input: {
  id: number;
  displayName: string;
  slug: string;
  parentCategoryId: number | null;
}): StorageCategoryRecord {
  const now = new Date().toISOString();
  return {
    id: input.id,
    displayName: input.displayName,
    slug: input.slug,
    parentCategoryId: input.parentCategoryId,
    description: null,
    storageChatId: -100,
    storageThreadId: input.id,
    categoryPurpose: 'user_uploads',
    lifecycleStatus: 'active',
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}

function createLlmReadContextWithStorageHandout() {
  const categoryRows = [
    storageCategoryRow({ id: 7, slug: 'manuales', displayName: 'Manuales', categoryPurpose: 'user_uploads' }),
    storageCategoryRow({ id: 8, slug: 'handouts', displayName: 'Handouts de rol', storageThreadId: 11, categoryPurpose: 'role_game_handouts' }),
  ];
  const entryRows = [
    {
      id: 15,
      categoryId: 8,
      createdByTelegramUserId: 42,
      sourceKind: 'dm_copy',
      description: 'Secreto del villano',
      tags: ['rol'],
      lifecycleStatus: 'active',
      createdAt: new Date('2026-04-21T12:00:00.000Z'),
      updatedAt: new Date('2026-04-21T12:00:00.000Z'),
      deletedAt: null,
      deletedByTelegramUserId: null,
    },
  ];
  const messageRows = [
    {
      id: 1,
      entryId: 15,
      storageChatId: -100123,
      storageMessageId: 900,
      storageThreadId: 11,
      telegramFileId: 'file-1',
      telegramFileUniqueId: 'unique-1',
      attachmentKind: 'document',
      caption: null,
      originalFileName: 'secreto-villano.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 1024,
      mediaGroupId: null,
      sortOrder: 0,
      createdAt: new Date('2026-04-21T12:00:00.000Z'),
    },
  ];

  return {
    runtime: {
      services: {
        database: {
          db: {
            select: () => ({
              from: (table: { [key: string]: unknown }) => {
                if ((table as unknown) === storageCategoriesTable) {
                  return {
                    orderBy: async () => categoryRows,
                    where: async () => categoryRows,
                  };
                }
                if ((table as unknown) === storageEntriesTable) {
                  return {
                    where: () => ({
                      orderBy: async () => entryRows,
                    }),
                  };
                }
                if ((table as unknown) === storageEntryMessagesTable) {
                  return {
                    where: () => ({
                      orderBy: async () => messageRows,
                    }),
                  };
                }
                if ((table as unknown) === usersTable) {
                  return {
                    where: async () => [],
                  };
                }
                throw new Error('unexpected table');
              },
            }),
          },
        },
      },
      chat: { kind: 'private', chatId: 42 },
      actor: {
        telegramUserId: 42,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin: false,
        permissions: [],
      },
    },
  };
}

function storageCategoryRow(input: {
  id: number;
  slug: string;
  displayName: string;
  storageThreadId?: number;
  categoryPurpose: string;
}) {
  return {
    id: input.id,
    slug: input.slug,
    displayName: input.displayName,
    parentCategoryId: null,
    description: null,
    storageChatId: -100123,
    storageThreadId: input.storageThreadId ?? 10,
    categoryPurpose: input.categoryPurpose,
    lifecycleStatus: 'active',
    createdAt: new Date('2026-04-21T10:00:00.000Z'),
    updatedAt: new Date('2026-04-21T10:00:00.000Z'),
    archivedAt: null,
  };
}
