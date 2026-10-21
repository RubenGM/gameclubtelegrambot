import test from 'node:test';
import assert from 'node:assert/strict';
import type { CatalogItemRecord } from '../catalog/catalog-model.js';
import { buildCatalogGameCard, catalogGameTags, summarizeCatalogDescription } from './catalog-game-card.js';
import { buildTelegramRichDetailMessage } from './rich-detail-message.js';

function item(overrides: Partial<CatalogItemRecord> = {}): CatalogItemRecord {
  return { id: 1, displayName: 'Juego <Club> & Amigos', itemType: 'board-game', familyId: null, groupId: null, originalName: null, description: null, language: null, publisher: null, publicationYear: null, playerCountMin: 2, playerCountMax: 4, recommendedAge: 10, playTimeMinutes: 60, storagePosition: 'A&1', externalRefs: null, metadata: null, lifecycleStatus: 'active', createdAt: '', updatedAt: '', deactivatedAt: null, ...overrides };
}

for (const [language, tags, complexity, best] of [
  ['es', 'Construcción · Dados · Memoria', 'Complejidad', 'Mejor a'],
  ['ca', 'Construcció · Daus · Memòria', 'Complexitat', 'Millor a'],
  ['en', 'City Building · Dice Rolling · Memory', 'Complexity', 'Best with'],
] as const) {
  test(`game cards present full-width titles, description and existing BGG data in ${language}`, () => {
    const game = item({ description: 'Un juego de construcción con dados para toda la familia. Segunda frase.', publisher: 'Editorial no mostrada', createdAt: '2026-10-21T10:15:00Z', metadata: { categories: ['City Building', 'Dice'], mechanics: ['Dice Rolling', 'Memory', 'Worker Placement'], averageWeight: 2.1161, bestPlayerCounts: ['4'], averageRating: 9.9 } });
    const result = buildCatalogGameCard({ item: game, loan: null, language, startPayloadPrefix: 'catalog_read_item_' });
    assert.match(result.html, /^<h2><a[^>]+><b>Juego &lt;Club&gt; &amp; Amigos<\/b><\/a><\/h2><table>/);
    assert.match(result.html, /<tr><th>[^<]+:<\/th><td>2-4<\/td><\/tr>/);
    assert.match(result.html, /<tr><th>[^<]+:<\/th><td>60 min<\/td><\/tr>/);
    assert.match(result.html, /<tr><th>[^<]+:<\/th><td>10\+<\/td><\/tr>/);
    assert.ok(result.html.includes(tags));
    assert.ok(result.html.includes(`<th>${complexity}:</th><td>${language === 'en' ? '2.1' : '2,1'}/5</td>`));
    assert.ok(result.fallbackText.includes(`<b>${best}:</b> 4`));
    assert.match(result.html, /<td>Un juego de construcción con dados para toda la familia\.<\/td>/);
    assert.doesNotMatch(result.html, /<i>|Categories:|Categorías:|Mecánicas:|Segunda frase|<Club>/);
    assert.doesNotMatch(result.html, /Editorial no mostrada|2026-10-21|9[.,]9/);
    assert.match(result.fallbackText, /catalog_read_item_1/);
    assert.match(result.fallbackText, /A&amp;1/);
    assert.equal(game.description, 'Un juego de construcción con dados para toda la familia. Segunda frase.');
    const activityStyle = buildTelegramRichDetailMessage(game.displayName, result.fallbackText).html!;
    assert.equal(result.html.match(/<table>[\s\S]*?<\/table>/)?.[0], activityStyle.match(/<table>[\s\S]*?<\/table>/)?.[0]);
  });
}

test('previews retain Unicode and safely escape content after shortening', () => {
  const description = '¡Espacio! La humanidad ha observado el cosmos durante siglos y sigue explorando nuevos horizontes. Más información.';
  assert.match(summarizeCatalogDescription(description, 'es')!, /humanidad/);
  const long = summarizeCatalogDescription('🎲 '.repeat(200), 'es')!;
  assert.ok(Array.from(long).length <= 140);
  assert.ok(long.endsWith('…'));
  assert.doesNotMatch(long, /\uFFFD/);
  const result = buildCatalogGameCard({ item: item({ description: '<script>alert("hola")</script> & descripción.' }), loan: null, language: 'es', startPayloadPrefix: 'catalog_read_item_' });
  assert.match(result.html, /&lt;script&gt;/);
  assert.doesNotMatch(result.html, /<script>/);
});

test('malformed and absent metadata cannot invent complexity or optimal player counts', () => {
  for (const averageWeight of [null, 0, -1, 6, NaN, Infinity, '2.1']) {
    const result = buildCatalogGameCard({ item: item({ metadata: { averageWeight, bestPlayerCounts: ['0', '-1', '3<script>', '9', null, 4] } }), loan: null, language: 'es', startPayloadPrefix: 'catalog_read_item_' });
    assert.doesNotMatch(result.html, /Complejidad|Mejor a/);
  }
  assert.deepEqual(catalogGameTags(item({ metadata: { categories: ['Dice'], mechanics: ['Dice Rolling', 'Memory'] } }), 'es'), ['Dados', 'Memoria']);
  assert.deepEqual(catalogGameTags(item({ metadata: { categories: ['constructor'], mechanics: [42, null] } }), 'es'), ['constructor']);
});
