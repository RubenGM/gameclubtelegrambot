import test from 'node:test';
import assert from 'node:assert/strict';
import type { CatalogItemRecord } from '../catalog/catalog-model.js';
import { buildCatalogInitialBuckets, buildCatalogInitialIndex, replyWithCatalogInitialIndex } from './catalog-initial-index.js';
import type { TelegramRichMessageInput } from './rich-message-transport.js';

function item(id: number, displayName: string, itemType: CatalogItemRecord['itemType'] = 'board-game'): CatalogItemRecord {
  return { id, displayName, itemType, familyId: null, groupId: null, originalName: null, description: null, language: null, publisher: null, publicationYear: null, playerCountMin: null, playerCountMax: null, recommendedAge: null, playTimeMinutes: null, storagePosition: null, externalRefs: null, metadata: null, lifecycleStatus: 'active', createdAt: '', updatedAt: '', deactivatedAt: null };
}

const items = [item(1, 'Ázul'), item(2, 'Brass'), item(3, 'Catan', 'expansion'), item(4, 'Dune', 'rpg-book'), item(5, 'Dados', 'accessory'), item(6, '1960')];

test('catalog index preserves three-initial grouping, accent normalization and nonalphabetic deep links', () => {
  const buckets = buildCatalogInitialBuckets(items);
  assert.deepEqual(buckets.map((bucket) => bucket.initials), ['#AB', 'CD']);
  assert.equal(buckets.reduce((count, bucket) => count + bucket.items.length, 0), items.length);
  for (const prefix of ['catalog_read_letter_', 'catalog_admin_letters_']) {
    const result = buildCatalogInitialIndex({ buckets, totalCount: items.length, startPayloadPrefix: prefix, language: 'es' });
    assert.ok(result.richMessage.html?.includes(`?start=${prefix}hash_AB`));
    assert.ok(result.fallbackText.includes(`?start=${prefix}CD`));
    assert.match(result.richMessage.html!, /<table compact><tr><td valign="top"><a[^>]+><b># A B<\/b><\/a><\/td><td align="right">3 juegos<\/td>/);
    assert.match(result.richMessage.html!, /1 juego · 1 libro · 1 accesorio/);
    assert.equal((result.fallbackText.match(/6 artículos/g) ?? []).length, 1);
    assert.doesNotMatch(result.fallbackText, /- 3 artículos|Ázul|Catan|<table/);
    assert.equal(result.fallbackText.split('\n').filter((line) => line.startsWith('<a ')).length, 2);
  }
});

for (const [language, expected] of [['ca', '1 joc · 1 llibre · 1 accessori'], ['es', '1 juego · 1 libro · 1 accesorio'], ['en', '1 game · 1 book · 1 accessory']] as const) {
  test(`catalog index uses concise singular and plural type counts in ${language}`, () => {
    const result = buildCatalogInitialIndex({ buckets: buildCatalogInitialBuckets(items), totalCount: items.length, startPayloadPrefix: 'catalog_read_letter_', language, hint: 'Buscar <texto> & más', footerText: 'Page 1/2' });
    assert.ok(result.richMessage.html!.includes(expected));
    assert.match(result.richMessage.html!, /<\/table><footer>Page 1\/2<\/footer><footer>Buscar &lt;texto&gt; &amp; más<\/footer>$/);
    assert.match(result.fallbackText, /Buscar &lt;texto&gt; &amp; más$/);
    assert.doesNotMatch(result.richMessage.html!, /<texto>/);
  });
}

test('empty catalog index shows its empty state and no empty table', () => {
  const result = buildCatalogInitialIndex({ buckets: [], totalCount: 0, startPayloadPrefix: 'catalog_read_letter_', language: 'es' });
  assert.match(result.fallbackText, /0 artículos/);
  assert.match(result.fallbackText, /No hay/);
  assert.doesNotMatch(result.richMessage.html!, /<table/);
});

test('catalog index preserves the full fallback, keyboard, and topic with and without rich transport', async () => {
  const input = { buckets: buildCatalogInitialBuckets(items), totalCount: items.length, startPayloadPrefix: 'catalog_admin_letters_' };
  const options = { replyKeyboard: [['Buscar', 'Inicio']], persistentKeyboard: true };
  const expected = buildCatalogInitialIndex({ ...input, language: 'es' });
  const replies: unknown[] = [];
  const context = { reply: async (...args: unknown[]) => { replies.push(args); }, runtime: { chat: { chatId: -100, messageThreadId: 7 }, bot: { language: 'es' } } };
  await replyWithCatalogInitialIndex(context, input, options);
  assert.deepEqual(replies, [[expected.fallbackText, { ...options, parseMode: 'HTML' }]]);
  let sent: TelegramRichMessageInput | undefined;
  await replyWithCatalogInitialIndex({ ...context, runtime: { ...context.runtime, bot: { ...context.runtime.bot, sendRichMessage: async (message) => { sent = message; } } } }, input, options);
  assert.deepEqual(sent, { chatId: -100, messageThreadId: 7, ...expected, options: { ...options, parseMode: 'HTML' } });
});
