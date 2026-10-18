import assert from 'node:assert/strict';
import test from 'node:test';

import { catalogItemMatchesQuery, catalogItemNames, isUsableCatalogTitle, mergeCatalogNameMetadata, preserveCatalogDisplayName } from './catalog-names.js';

test('catalog searches Spanish, original and alternate names without accents or punctuation', () => {
  const item = {
    displayName: 'The Lord of the Rings',
    originalName: 'The Lord of the Rings',
    metadata: { spanishName: 'El Señor de los Anillos', alternateNames: ['Der Herr der Ringe', 'Señor: edición del club'] },
  };
  assert.equal(catalogItemMatchesQuery(item, 'senor anillos'), true);
  assert.equal(catalogItemMatchesQuery(item, 'Lord Rings'), true);
  assert.equal(catalogItemMatchesQuery(item, 'señor edicion'), true);
  assert.equal(catalogItemMatchesQuery(item, 'Herr Ringe'), true);
  assert.equal(catalogItemMatchesQuery(item, 'Catan'), false);
  assert.deepEqual(catalogItemNames(item), ['The Lord of the Rings', 'El Señor de los Anillos', 'Der Herr der Ringe', 'Señor: edición del club']);
});

test('provider refresh retains Spanish names and manual aliases while replacing provider fields', () => {
  assert.deepEqual(mergeCatalogNameMetadata(
    { spanishName: 'La isla prohibida', alternateNames: ['La isla del club'], obsolete: true },
    { source: 'boardgamegeek', alternateNames: ['Forbidden Island'], nameMetadataVersion: 2 },
  ), {
    source: 'boardgamegeek', alternateNames: ['La isla del club', 'Forbidden Island'],
    nameMetadataVersion: 2, spanishName: 'La isla prohibida', spanishNames: ['La isla prohibida'],
  });
  assert.equal(mergeCatalogNameMetadata(null, null), null);
});

test('confirmed Spanish provider names replace an uncustomized primary title and preserve custom titles', () => {
  const imported = { displayName: 'La isla prohibida', originalName: 'Forbidden Island' };
  assert.equal(preserveCatalogDisplayName({ displayName: 'Forbidden Island', originalName: 'Forbidden Island' }, imported), 'La isla prohibida');
  assert.equal(preserveCatalogDisplayName({ displayName: 'La isla del club', originalName: 'Forbidden Island' }, imported), 'La isla del club');
});

test('catalog title validation rejects edition labels while retaining commercial titles', () => {
  for (const label of ['Spanish edition', 'Spanish edition 2015', 'First Spanish edition', 'edición española',
    'Multilingual edition', 'English second edition', 'Primera edición castellana', 'Spanish edition (Devir)',
    'Spanish edition, small box', 'Spanish edition (with extra cards)', 'Second Spanish edition - Devir', '1.ª edición española']) {
    assert.equal(isUsableCatalogTitle(label, ['Devir']), false, label);
  }
  for (const title of ['La isla prohibida', 'Catan', 'El Señor de los Anillos', 'Spanish Main', 'First Contact', 'La isla prohibida (Spanish edition)']) {
    assert.equal(isUsableCatalogTitle(title), true, title);
  }
});

test('catalog name repair drops generic persisted aliases and replaces corrupted visible titles', () => {
  const previous = { displayName: 'Spanish edition 2015', originalName: 'Catan', metadata: {
    spanishName: 'Spanish edition', spanishNames: ['Spanish edition', 'Catán'],
    alternateNames: ['First Spanish edition', 'Los colonos de Catán'], nameMetadataVersion: 1,
  } };
  const imported = { displayName: 'Catan', originalName: 'Catan', metadata: { alternateNames: ['Catan'], nameMetadataVersion: 2 } };
  const metadata = mergeCatalogNameMetadata(previous.metadata, imported.metadata);
  assert.equal(metadata?.spanishName, 'Catán');
  assert.deepEqual(metadata?.alternateNames, ['Los colonos de Catán', 'Catan']);
  assert.equal(metadata?.nameMetadataVersion, 2);
  assert.equal(preserveCatalogDisplayName(previous, imported), 'Catan');
});
