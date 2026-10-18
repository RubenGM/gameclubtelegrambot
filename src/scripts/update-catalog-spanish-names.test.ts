import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogItemRecord } from '../catalog/catalog-model.js';
import { updateCatalogSpanishNames } from './update-catalog-spanish-names.js';

function game(id: number, overrides: Partial<CatalogItemRecord> = {}): CatalogItemRecord {
  return {
    id, familyId: null, groupId: null, itemType: 'board-game', ownerTelegramUserId: 42,
    displayName: 'The Initiative', originalName: 'The Initiative', description: 'Manual description',
    language: 'ES', publisher: null, publicationYear: null, playerCountMin: 1, playerCountMax: 4,
    recommendedAge: null, playTimeMinutes: null, storagePosition: 'A1', externalRefs: { boardGameGeekId: 1 },
    metadata: { alternateNames: ['The Initiative', 'La Iniciativa'], manualField: true },
    lifecycleStatus: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', deactivatedAt: null,
    ...overrides,
  };
}

test('Spanish name maintenance changes visible names on all copies while retaining manual names and metadata', async () => {
  const items = [game(1), game(2), game(3, { displayName: 'La copia del club' })];
  const saved: Array<{ item: CatalogItemRecord; displayName: string; metadata: Record<string, unknown> }> = [];
  const summary = await updateCatalogSpanishNames({
    items, resolver: async (candidates) => new Map(candidates.map(({ id }) => [id, 'La Iniciativa'])),
    async save(update) { saved.push(update); return true; },
  });
  assert.equal(summary.renamed, 2);
  assert.deepEqual(saved.map(({ displayName }) => displayName), ['La Iniciativa', 'La Iniciativa', 'La copia del club']);
  for (const update of saved) {
    assert.deepEqual(Object.keys(update).sort(), ['displayName', 'item', 'metadata']);
    assert.equal(update.item.originalName, 'The Initiative');
    assert.equal(update.metadata.manualField, true);
    assert.equal(update.metadata.spanishName, 'La Iniciativa');
    assert.ok((update.metadata.alternateNames as string[]).includes('The Initiative'));
  }
});

test('maintenance skips already resolved games, books, inactive items and counts concurrent edits', async () => {
  const summary = await updateCatalogSpanishNames({
    items: [game(1, { metadata: { spanishNameResolutionVersion: 1 } }), game(2, { itemType: 'book' }),
      game(3, { lifecycleStatus: 'deactivated' }), game(4)],
    resolver: async (candidates) => new Map(candidates.map(({ id }) => [id, 'La Iniciativa'])),
    async save() { return false; },
  });
  assert.deepEqual(summary, { eligible: 1, processed: 1, renamed: 0, failed: 0, conflicts: 1 });
});

test('maintenance does not mark failed selections as resolved or write provider-invented translations', async () => {
  const summary = await updateCatalogSpanishNames({
    items: [game(1)], resolver: async () => new Map([['0', 'Not a BGG alias']]),
    async save() { assert.fail('Invalid choice must not write'); },
  });
  assert.equal(summary.failed, 1);
  assert.equal(summary.renamed, 0);
});
