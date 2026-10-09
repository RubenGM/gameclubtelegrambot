import test from 'node:test';
import assert from 'node:assert/strict';
import type { CatalogItemRecord, CatalogLoanRecord } from '../catalog/catalog-model.js';
import { buildCatalogItemTable, sortCatalogTableEntries } from './catalog-item-table.js';

function item(id: number, displayName: string, overrides: Partial<CatalogItemRecord> = {}): CatalogItemRecord {
  return { id, displayName, itemType: 'board-game', familyId: null, groupId: null, originalName: null, description: null, language: null, publisher: null, publicationYear: null, playerCountMin: null, playerCountMax: null, recommendedAge: null, playTimeMinutes: null, storagePosition: null, externalRefs: null, metadata: null, lifecycleStatus: 'active', createdAt: '', updatedAt: '', deactivatedAt: null, ...overrides };
}
const loan: CatalogLoanRecord = { id: 1, itemId: 2, borrowerTelegramUserId: 7, borrowerDisplayName: 'Ana <Club>', loanedByTelegramUserId: 7, dueAt: null, notes: null, returnedAt: null, returnedByTelegramUserId: null, createdAt: '', updatedAt: '' };

test('catalog tables group types, put borrowed games first, and highlight them without availability/type columns', () => {
  const result = buildCatalogItemTable({ title: 'Catálogo', language: 'es', startPayloadPrefix: 'catalog_admin_item_', entries: [
    { item: item(1, 'Azul'), loan: null },
    { item: item(3, 'Libro', { itemType: 'rpg-book', publisher: 'Editorial & Amigos' }), loan: null },
    { item: item(2, 'Zeta <Club>', { playerCountMin: 2, playerCountMax: 4, playTimeMinutes: 45, storagePosition: 'A1', metadata: { categories: ['Economic', '<script>'], mechanics: ['Worker Placement'] } }), loan },
  ] });
  const html = result.richMessage.html!;
  assert.equal((html.match(/<table compact>/g) ?? []).length, 2);
  assert.ok(html.indexOf('Zeta') < html.indexOf('Azul'));
  assert.ok(html.indexOf('Azul') < html.indexOf('Libro</b>'));
  assert.match(html, /<mark><a[^>]+><b>Zeta &lt;Club&gt;<\/b><\/a><\/mark>/);
  assert.match(html, /<td>2-4<\/td><td>45 min<\/td>/);
  assert.match(html, /<td colspan="3">.*Ana &lt;Club&gt;.*A1.*Economic, &lt;script&gt;.*Worker Placement/);
  assert.match(html, /<h3>Libros<\/h3><table compact><tr><th>Título<\/th><th>Editorial<\/th>/);
  assert.doesNotMatch(html, /Disponible|Disponibilidad|Joc de taula|Llibre RPG|<script>/);
  assert.doesNotMatch(result.fallbackText, /<mark>|<table>|Disponible/);
  assert.match(result.fallbackText, /🟠 <a[^>]+><b>Zeta/);
});

test('catalog only renders populated sections and retains unknown player ranges without inventing metadata', () => {
  const { richMessage } = buildCatalogItemTable({ title: 'Games', language: 'en', startPayloadPrefix: 'catalog_read_item_', entries: [{ item: item(1, 'Unknown', { metadata: { categories: [42, null], mechanics: 'not an array' } }), loan: null }] });
  assert.match(richMessage.html!, /<td>—<\/td><td>—<\/td>/);
  assert.doesNotMatch(richMessage.html!, /Books|Accessories|Categories|Mechanics|colspan|<mark>/);
});

test('borrowed records sort ahead of alphabetical records before the caller paginates', () => {
  const entries = [{ item: item(1, 'A'), loan: null }, { item: item(2, 'Z'), loan }];
  assert.equal(sortCatalogTableEntries(entries).slice(0, 1)[0]?.item.id, 2);
  assert.equal(entries[0]?.item.id, 1);
});
