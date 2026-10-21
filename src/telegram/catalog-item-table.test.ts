import test from 'node:test';
import assert from 'node:assert/strict';
import type { CatalogItemRecord, CatalogLoanRecord } from '../catalog/catalog-model.js';
import { buildCatalogItemTable, replyWithCatalogItemTable, sortCatalogTableEntries } from './catalog-item-table.js';
import { isTelegramRichMessageWithinLimits } from './rich-message-limits.js';
import type { TelegramRichMessageInput } from './rich-message-transport.js';

function item(id: number, displayName: string, overrides: Partial<CatalogItemRecord> = {}): CatalogItemRecord {
  return { id, displayName, itemType: 'board-game', familyId: null, groupId: null, originalName: null, description: null, language: null, publisher: null, publicationYear: null, playerCountMin: null, playerCountMax: null, recommendedAge: null, playTimeMinutes: null, storagePosition: null, externalRefs: null, metadata: null, lifecycleStatus: 'active', createdAt: '', updatedAt: '', deactivatedAt: null, ...overrides };
}
const loan: CatalogLoanRecord = { id: 1, itemId: 2, borrowerTelegramUserId: 7, borrowerDisplayName: 'Ana <Club>', loanedByTelegramUserId: 7, dueAt: null, notes: null, returnedAt: null, returnedByTelegramUserId: null, createdAt: '', updatedAt: '' };

test('catalog tables group types, put borrowed games first, and highlight them without availability/type columns', () => {
  const result = buildCatalogItemTable({ title: 'Catálogo', language: 'es', startPayloadPrefix: 'catalog_admin_item_', entries: [
    { item: item(1, 'Azul'), loan: null },
    { item: item(3, 'Libro', { itemType: 'rpg-book', publisher: 'Editorial & Amigos' }), loan: null },
    { item: item(2, 'Zeta <Club>', { playerCountMin: 2, playerCountMax: 4, playTimeMinutes: 45, storagePosition: 'A1', metadata: { categories: ['Economic'], mechanics: ['Worker Placement', '<script>'] } }), loan },
  ] });
  const html = result.richMessage.html!;
  assert.equal((html.match(/<table compact>/g) ?? []).length, 1);
  assert.ok(html.indexOf('Zeta') < html.indexOf('Azul'));
  assert.ok(html.indexOf('Azul') < html.indexOf('Libro</b>'));
  assert.match(html, /<mark><a[^>]+><b>Zeta &lt;Club&gt;<\/b><\/a><\/mark>/);
  assert.match(html, /<th>Jugadores:<\/th><td>2-4<\/td>/);
  assert.match(html, /<th>Duración:<\/th><td>45 min<\/td>/);
  assert.match(html, /Economía · Colocación de trabajadores · &lt;script&gt;/);
  assert.match(html, /<th>Lo tiene:<\/th><td>🟠 Ana &lt;Club&gt;<\/td>/);
  assert.match(html, /<th>Ubicación:<\/th><td>A1<\/td>/);
  assert.match(html, /<h3>Libros<\/h3><table compact><tr><td align="left" valign="top">.*Libro.*<td align="right" valign="top">Editorial &amp; Amigos<\/td>/);
  assert.doesNotMatch(html, /Disponible|Disponibilidad|Joc de taula|Llibre RPG|<script>/);
  assert.doesNotMatch(result.fallbackText, /<mark>|<table>|Disponible/);
  assert.match(result.fallbackText, /🟠 <a[^>]+><b>Zeta/);
});

test('catalog only renders populated sections and omits unknown metrics without inventing metadata', () => {
  const { richMessage } = buildCatalogItemTable({ title: 'Games', language: 'en', startPayloadPrefix: 'catalog_read_item_', entries: [{ item: item(1, 'Unknown', { metadata: { categories: [42, null], mechanics: 'not an array' } }), loan: null }] });
  assert.match(richMessage.html!, /<h2><a[^>]+><b>Unknown<\/b><\/a><\/h2>/);
  assert.doesNotMatch(richMessage.html!, /👥|⏱|—/);
  assert.doesNotMatch(richMessage.html!, /Books|Accessories|Categories|Mechanics|colspan|<mark>/);
});

test('large initial buckets keep complete cards, order, topics and final navigation when split into rich messages', async () => {
  const entries = Array.from({ length: 50 }, (_, index) => ({ item: item(index + 1, `Juego ${index}`, { description: 'Una descripción muy extensa con Unicode 🎲 y más información. '.repeat(200), playerCountMin: 2, playerCountMax: 4, playTimeMinutes: 60, recommendedAge: 10, storagePosition: 'A3', metadata: { categories: ['City Building'], mechanics: ['Dice Rolling', 'Memory'], averageWeight: 2.1, bestPlayerCounts: ['4'] } }), loan: null }));
  entries.push({ item: item(99, 'A book', { itemType: 'book' }), loan: null }, { item: item(100, 'Accessory', { itemType: 'accessory' }), loan: null });
  const input = { title: 'Catálogo', language: 'es', entries, startPayloadPrefix: 'catalog_admin_item_', footerHtml: 'Página 1/1' };
  const result = buildCatalogItemTable(input);
  assert.equal(isTelegramRichMessageWithinLimits(result.richMessage), false);
  const sent: TelegramRichMessageInput[] = [];
  const options = { replyKeyboard: [['Inicio', 'Ayuda']], persistentKeyboard: true };
  await replyWithCatalogItemTable({ reply: async () => { assert.fail('Unexpected ordinary reply'); }, runtime: { chat: { chatId: -100, messageThreadId: 7 }, bot: { language: 'es', sendRichMessage: async (message) => { sent.push(message); } } } }, input, options);
  assert.ok(sent.length > 1);
  for (const [index, message] of sent.entries()) {
    assert.ok(isTelegramRichMessageWithinLimits(message.richMessage));
    assert.equal(message.messageThreadId, 7);
    if (index < sent.length - 1) {
      assert.equal(message.options?.replyKeyboard, undefined);
      assert.doesNotMatch(message.fallbackText, /Página 1\/1/);
    }
  }
  assert.deepEqual(sent.at(-1)?.options, { ...options, parseMode: 'HTML' });
  assert.match(sent.at(-1)?.fallbackText ?? '', /Página 1\/1$/);
  const links = (html: string) => Array.from(html.matchAll(/catalog_admin_item_(\d+)/g), (match) => match[1]);
  assert.deepEqual(sent.flatMap((message) => links(message.richMessage.html!)), links(result.richMessage.html!));
  assert.equal(new Set(sent.flatMap((message) => links(message.richMessage.html!))).size, entries.length);
});

test('borrowed records sort ahead of alphabetical records before the caller paginates', () => {
  const entries = [{ item: item(1, 'A'), loan: null }, { item: item(2, 'Z'), loan }];
  assert.equal(sortCatalogTableEntries(entries).slice(0, 1)[0]?.item.id, 2);
  assert.equal(entries[0]?.item.id, 1);
});

test('game sorting ignores articles without changing titles or borrowed-first priority', () => {
  const entries = [{ item: item(1, 'La Iniciativa'), loan: null }, { item: item(2, 'Zeta'), loan }, { item: item(3, 'La Isla'), loan: null }, { item: item(4, 'El Dorado'), loan: null }];
  assert.deepEqual(sortCatalogTableEntries(entries).map(({ item }) => item.displayName), ['Zeta', 'El Dorado', 'La Iniciativa', 'La Isla']);
});
