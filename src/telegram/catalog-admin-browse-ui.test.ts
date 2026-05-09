import test from 'node:test';
import assert from 'node:assert/strict';

import type { CatalogFamilyRecord, CatalogGroupRecord, CatalogItemRecord } from '../catalog/catalog-model.js';
import { formatCatalogAdminItemList } from './catalog-admin-browse-ui.js';
import { createTelegramI18n } from './i18n.js';

function family(id: number): CatalogFamilyRecord {
  return {
    id,
    slug: `family-${id}`,
    displayName: `Family ${id}`,
    description: null,
    familyKind: 'generic-line',
    createdAt: '2026-04-04T10:00:00.000Z',
    updatedAt: '2026-04-04T10:00:00.000Z',
  };
}

function group(id: number, familyId: number): CatalogGroupRecord {
  return {
    id,
    familyId,
    slug: `group-${id}`,
    displayName: `Group ${id}`,
    description: null,
    createdAt: '2026-04-04T10:00:00.000Z',
    updatedAt: '2026-04-04T10:00:00.000Z',
  };
}

function item(id: number, groupId: number, displayName = `Game ${String(id).padStart(3, '0')}`, itemType: CatalogItemRecord['itemType'] = 'board-game'): CatalogItemRecord {
  return {
    id,
    familyId: 1,
    groupId,
    itemType,
    displayName,
    originalName: null,
    description: null,
    language: null,
    publisher: null,
    publicationYear: null,
    playerCountMin: null,
    playerCountMax: null,
    recommendedAge: null,
    playTimeMinutes: null,
    externalRefs: null,
    metadata: null,
    lifecycleStatus: 'active',
    createdAt: '2026-04-04T10:00:00.000Z',
    updatedAt: '2026-04-04T10:00:00.000Z',
    deactivatedAt: null,
  };
}

test('formatCatalogAdminItemList groups admin lists by initial instead of families or groups', () => {
  const families = [family(1)];
  const groups = [group(1, 1)];
  const items = [
    item(1, 1, 'Ark Nova'),
    item(2, 1, 'Azul'),
    item(3, 1, 'A Wizard of Earthsea', 'book'),
    item(4, 1, 'Brass Birmingham'),
    item(5, 1, 'Carcassonne'),
    item(6, 1, 'Dune Imperium'),
    item(7, 1, '1960: The Making of the President'),
  ];
  const itemLines = new Map(items.map((entry) => [
    entry.id,
    `- <a href="https://t.me/cawa_management_bot?start=catalog_admin_item_${entry.id}"><b>${entry.displayName}</b></a> · Juego de mesa`,
  ]));

  const message = formatCatalogAdminItemList({
    texts: createTelegramI18n('ca').catalogAdmin,
    families,
    groups,
    items,
    itemLines,
    browseLettersPrefix: 'catalog_admin:browse_letters:',
  });

  assert.ok(message.length < 4096);
  assert.match(message, /<b># A B - 5 artículos<\/b>/);
  assert.match(message, /catalog_admin_letters_hash_AB/);
  assert.match(message, /4 juegos de mesa/);
  assert.match(message, /1 libro/);
  assert.match(message, /<b>C D - 2 artículos<\/b>/);
  assert.doesNotMatch(message, /Family 1/);
  assert.doesNotMatch(message, /Group 1/);
  assert.doesNotMatch(message, /Sin grupo/);
  assert.doesNotMatch(message, /Ark Nova/);

});
