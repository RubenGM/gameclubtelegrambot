import test from 'node:test';
import assert from 'node:assert/strict';
import type { CatalogItemRecord } from '../catalog/catalog-model.js';
import { catalogGameMetadataFields } from './catalog-game-metadata.js';
import { formatCatalogGameMetadataLines } from './catalog-presentation.js';

function game(overrides: Partial<CatalogItemRecord> = {}): CatalogItemRecord {
  return { id: 1, displayName: 'Juego', originalName: 'Original', itemType: 'board-game', familyId: null, groupId: null, description: null, language: null, publisher: null, publicationYear: null, playerCountMin: 2, playerCountMax: 4, recommendedAge: null, playTimeMinutes: null, externalRefs: null, metadata: null, lifecycleStatus: 'active', createdAt: '', updatedAt: '', deactivatedAt: null, ...overrides };
}

for (const [language, categories, mechanics, complexity, best] of [
  ['es', 'Categorías', 'Mecánicas', '2,7/5', 'Mejor a'],
  ['ca', 'Categories', 'Mecàniques', '2,7/5', 'Millor a'],
  ['en', 'Categories', 'Mechanics', '2.7/5', 'Best with'],
] as const) {
  test(`complete game facts retain all categories, mechanics and public BGG metadata in ${language}`, () => {
    const item = game({ externalRefs: { boardGameGeekId: '123' }, metadata: {
      categories: ['Ancient', 'Dice', 'Unknown category'], mechanics: ['Dice Rolling', 'Income', 'Unknown mechanic'],
      averageWeight: 2.71, bestPlayerCounts: ['4', '2', '4'], recommendedPlayerCounts: ['3'],
      averageRating: 7.83, bayesAverage: 7.11, rank: 120, usersRated: 1500, numWeights: 81,
      designers: ['Diseñador'], artists: ['Artista'], publishers: ['Editorial'], families: ['Familia BGG'],
      alternateNames: ['Juego', 'Original', 'Otro nombre'], spanishNames: ['Otro nombre'],
      needsReview: true, source: 'boardgamegeek', nameMetadataVersion: 2,
    } });
    const fields = catalogGameMetadataFields(item, language);
    const values = Object.fromEntries(fields.map(({ label, value }) => [label, value]));
    assert.match(values[categories]!, /Unknown category/);
    assert.match(values[mechanics]!, /Unknown mechanic/);
    assert.ok(fields.some(({ value }) => value === complexity));
    assert.equal(values[best], '2, 4');
    for (const expected of ['3', '120', '1500', '81', 'Diseñador', 'Artista', 'Editorial', 'Familia BGG', 'Otro nombre']) {
      assert.ok(fields.some(({ value }) => value === expected), expected);
    }
    assert.deepEqual(fields.at(-1), { label: 'BoardGameGeek', value: 'BoardGameGeek', href: 'https://boardgamegeek.com/boardgame/123' });
    assert.doesNotMatch(JSON.stringify(fields), /needsReview|nameMetadataVersion|source|Original|"Juego"/);
    assert.deepEqual(catalogGameMetadataFields({ ...item, itemType: 'expansion' }, language), fields);
  });
}

test('missing, invalid and unrelated metadata stays out of the complete game detail', () => {
  assert.deepEqual(catalogGameMetadataFields(game(), 'es'), []);
  const metadata = { categories: [42, null, ' '], mechanics: 'Dice', averageWeight: 6, bestPlayerCounts: ['0', '1', '5', '3<script>', 4], recommendedPlayerCounts: ['9'], averageRating: NaN, bayesAverage: 11, rank: -1, usersRated: 1.5, numWeights: Infinity, designers: [null], boardGameGeekId: 'javascript:alert(1)', rawPrivateData: 'hidden' };
  assert.deepEqual(catalogGameMetadataFields(game({ metadata }), 'es'), []);
  assert.deepEqual(catalogGameMetadataFields(game({ itemType: 'book', metadata: { averageWeight: 2, categories: ['Dice'] } }), 'es'), []);
});

test('game detail escapes metadata and only constructs numeric BGG links', () => {
  const item = game({ externalRefs: { boardGameGeekId: '123" onclick="alert(1)' }, metadata: {
    designers: ['<script>& autor'], alternateNames: ['<b>Otro</b>'], categories: ['<a href="bad">'],
  } });
  const html = formatCatalogGameMetadataLines(item, 'es').join('\n');
  assert.match(html, /&lt;script&gt;&amp; autor/);
  assert.match(html, /&lt;b&gt;Otro&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<script>|<a href=|onclick/);
  assert.match(formatCatalogGameMetadataLines(game({ metadata: { boardGameGeekId: 123 } }), 'es').join(''), /href="https:\/\/boardgamegeek.com\/boardgame\/123"/);
});
