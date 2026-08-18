import test from 'node:test';
import assert from 'node:assert/strict';

import type { CatalogItemRecord } from '../catalog/catalog-model.js';
import {
  buildCatalogStoragePositionColumnOptions,
  buildCatalogStoragePositionRowOptions,
} from './catalog-admin-keyboards.js';
import {
  parseCatalogStoragePositionColumnInput,
  parseCatalogStoragePositionRowInput,
} from './catalog-admin-parsing.js';
import { formatMemberCatalogItemDetails } from './catalog-presentation.js';
import { formatCatalogBrowseItemLine } from './catalog-admin-list-formatting.js';

test('catalog position selector accepts row and column selection, direct codes, and clearing', () => {
  assert.deepEqual(parseCatalogStoragePositionRowInput('A', 'es'), { kind: 'row', row: 'A' });
  assert.deepEqual(parseCatalogStoragePositionRowInput(' b-12 ', 'es'), { kind: 'position', storagePosition: 'B12' });
  assert.deepEqual(parseCatalogStoragePositionRowInput('Omitir', 'es'), { kind: 'clear' });
  assert.equal(parseCatalogStoragePositionColumnInput('C', '7'), 'C7');
  assert.ok(parseCatalogStoragePositionRowInput('armario', 'es') instanceof Error);
  assert.ok(parseCatalogStoragePositionColumnInput('C', '0') instanceof Error);
});

test('catalog position selector exposes all rows and common columns through Telegram buttons', () => {
  const rowButtons = buildCatalogStoragePositionRowOptions('es').replyKeyboard?.flat().map(buttonText) ?? [];
  const columnButtons = buildCatalogStoragePositionColumnOptions('es').replyKeyboard?.flat().map(buttonText) ?? [];

  assert.ok(rowButtons.includes('A'));
  assert.ok(rowButtons.includes('Z'));
  assert.ok(rowButtons.includes('Omitir'));
  assert.ok(columnButtons.includes('1'));
  assert.ok(columnButtons.includes('20'));
});

test('member catalog details show the cabinet position when assigned', () => {
  const item: CatalogItemRecord = {
    id: 1,
    familyId: null,
    groupId: null,
    itemType: 'board-game',
    displayName: 'Root',
    originalName: null,
    description: null,
    language: null,
    publisher: null,
    publicationYear: null,
    playerCountMin: 2,
    playerCountMax: 4,
    recommendedAge: null,
    playTimeMinutes: null,
    storagePosition: 'B3',
    externalRefs: null,
    metadata: null,
    lifecycleStatus: 'active',
    createdAt: '2026-08-18T10:00:00.000Z',
    updatedAt: '2026-08-18T10:00:00.000Z',
    deactivatedAt: null,
  };

  const rendered = formatMemberCatalogItemDetails({
    item,
    family: null,
    group: null,
    media: [],
    language: 'es',
  });

  assert.match(rendered, /<b>Posición en el armario:<\/b> B3/);
});

test('catalog list lines show the position only for assigned items', () => {
  const positioned = formatCatalogBrowseItemLine({
    item: catalogItem({ storagePosition: 'B3' }),
    availableLabel: 'Disponible',
    positionLabel: 'Posición',
    startPayloadPrefix: 'catalog_admin_item_',
  });
  const unpositioned = formatCatalogBrowseItemLine({
    item: catalogItem({ storagePosition: null }),
    availableLabel: 'Disponible',
    positionLabel: 'Posición',
    startPayloadPrefix: 'catalog_admin_item_',
  });

  assert.match(positioned, /<i>Joc de taula · Posición B3 · Disponible<\/i>/);
  assert.match(unpositioned, /<i>Joc de taula · Disponible<\/i>/);
  assert.doesNotMatch(unpositioned, /Posición/);
});

function catalogItem(overrides: Partial<CatalogItemRecord> = {}): CatalogItemRecord {
  return {
    id: 1,
    familyId: null,
    groupId: null,
    itemType: 'board-game',
    displayName: 'Root',
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
    createdAt: '2026-08-18T10:00:00.000Z',
    updatedAt: '2026-08-18T10:00:00.000Z',
    deactivatedAt: null,
    ...overrides,
  };
}

function buttonText(button: string | { text: string }): string {
  return typeof button === 'string' ? button : button.text;
}
