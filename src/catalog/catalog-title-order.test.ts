import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogItemInitial, catalogItemSortTitle, compareCatalogItemTitles } from './catalog-title-order.js';

for (const title of ['La Iniciativa', 'El Imperio', 'Los Inseparables', 'Las Islas', 'Un Imperio', 'Una Isla', 'Unos Inseparables', 'Unas Islas', 'Els Inseparables', 'Les Illes', 'Uns Inseparables', 'Unes Illes', "L'Illa", 'L’illa', 'The Initiative', 'A Story', 'An Island']) {
  test(`game indexing ignores the leading article in ${title}`, () => {
    const item = { displayName: title, itemType: 'board-game' };
    assert.notEqual(catalogItemSortTitle(item), title);
    assert.equal(catalogItemInitial(item), catalogItemSortTitle(item).at(0)!.toUpperCase());
    assert.equal(item.displayName, title);
  });
}

test('article sorting preserves whole titles, internal articles, non-games, accents and punctuation buckets', () => {
  const names = ['La Iniciativa', 'Azul', 'The Island', 'El Dorado', 'Zooloretto'];
  const items = names.map((displayName) => ({ displayName, itemType: 'board-game' })).sort(compareCatalogItemTitles);
  assert.deepEqual(items.map((item) => item.displayName), ['Azul', 'El Dorado', 'La Iniciativa', 'The Island', 'Zooloretto']);
  for (const displayName of ['Anachrony', 'Unmatched', 'L.A.M.A.', 'La']) {
    assert.equal(catalogItemSortTitle({ displayName, itemType: 'board-game' }), displayName);
  }
  assert.equal(catalogItemSortTitle({ displayName: 'El Señor de los Anillos', itemType: 'board-game' }), 'Señor de los Anillos');
  assert.equal(catalogItemInitial({ displayName: 'La Iniciativa', itemType: 'book' }), 'L');
  assert.equal(catalogItemInitial({ displayName: 'La Isla', itemType: 'expansion' }), 'I');
  assert.equal(catalogItemInitial({ displayName: 'The Ánimal', itemType: 'board-game' }), 'A');
  assert.equal(catalogItemInitial({ displayName: 'El 1960', itemType: 'board-game' }), '#');
});
