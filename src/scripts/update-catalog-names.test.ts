import assert from 'node:assert/strict';
import test from 'node:test';

import type { CatalogItemRecord } from '../catalog/catalog-model.js';
import type { WikipediaBoardGameCatalogDraft, WikipediaBoardGameImportService } from '../catalog/wikipedia-boardgame-import-service.js';
import { createCatalogNameBatchImportService, createCatalogNameFetch, parseCatalogNameUpdateOptions, updateCatalogNames, type CatalogNameUpdate } from './update-catalog-names.js';

function item(id: number, overrides: Partial<CatalogItemRecord> = {}): CatalogItemRecord {
  return {
    id, familyId: null, groupId: null, ownerTelegramUserId: 42, itemType: 'board-game', displayName: 'Forbidden Island',
    originalName: null, description: 'Descripción manual', language: 'ES', publisher: 'Editor local', publicationYear: 2010,
    playerCountMin: 2, playerCountMax: 4, recommendedAge: 10, playTimeMinutes: 30, storagePosition: 'A1',
    externalRefs: { boardGameGeekId: id }, metadata: { source: 'boardgamegeek', averageWeight: 1.7, manualField: 'conservar' },
    lifecycleStatus: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', deactivatedAt: null,
    ...overrides,
  };
}

function draft(): WikipediaBoardGameCatalogDraft {
  return {
    familyId: null, groupId: null, itemType: 'board-game', displayName: 'La isla prohibida', originalName: 'Forbidden Island',
    description: 'Provider description', language: null, publisher: 'Provider publisher', publicationYear: 2020,
    playerCountMin: 1, playerCountMax: 9, recommendedAge: null, playTimeMinutes: null,
    externalRefs: { boardGameGeekId: '1' },
    metadata: { source: 'boardgamegeek', spanishName: 'La isla prohibida', spanishNames: ['La isla prohibida'], alternateNames: ['Forbidden Island', 'La isla prohibida'], nameMetadataVersion: 2, averageWeight: 9.9 },
  };
}

test('catalog name backfill only writes names and retains existing metadata, aliases and custom titles', async () => {
  const items = [item(1), item(2, { displayName: 'La isla del club', originalName: 'Forbidden Island', externalRefs: null,
    metadata: { boardGameGeekId: '2', spanishName: 'La isla edición antigua', alternateNames: ['Isla del local'], manualField: true } })];
  const saved: CatalogNameUpdate[] = [];
  const queries: string[] = [];
  const pauses: number[] = [];
  const summary = await updateCatalogNames({
    items, importService: { async importByTitle(query) { queries.push(query); return { ok: true, draft: draft() }; } },
    async save(update) { saved.push(update); return true; }, wait: async (ms) => { pauses.push(ms); },
  });
  assert.deepEqual(queries, ['https://boardgamegeek.com/boardgame/1', 'https://boardgamegeek.com/boardgame/2']);
  assert.deepEqual(pauses, [1000]);
  assert.equal(summary.updated, 2);
  assert.equal(summary.renamed, 1);
  assert.equal(saved[0]?.displayName, 'La isla prohibida');
  assert.equal(saved[0]?.originalName, 'Forbidden Island');
  assert.equal(saved[0]?.metadata.averageWeight, 1.7);
  assert.equal(saved[0]?.metadata.manualField, 'conservar');
  assert.deepEqual(Object.keys(saved[0]!).sort(), ['displayName', 'item', 'metadata', 'originalName']);
  assert.strictEqual(saved[0]?.item, items[0]);
  assert.equal(saved[1]?.displayName, 'La isla del club');
  assert.equal(saved[1]?.metadata.spanishName, 'La isla edición antigua');
  assert.ok((saved[1]?.metadata.alternateNames as string[]).includes('Isla del local'));
  assert.ok((saved[1]?.metadata.spanishNames as string[]).includes('La isla prohibida'));
});

test('catalog name backfill dry-run respects eligibility and limit without writing', async () => {
  const queries: string[] = [];
  const summary = await updateCatalogNames({
    items: [item(1, { metadata: { nameMetadataVersion: 2 } }), item(2, { itemType: 'book' }),
      item(3, { lifecycleStatus: 'deactivated' }), item(4, { externalRefs: null, metadata: null }), item(5), item(6)],
    importService: { async importByTitle(query) { queries.push(query); return { ok: true, draft: draft() }; } },
    async save() { assert.fail('dry-run must not write'); }, dryRun: true, limit: 1,
  });
  assert.equal(summary.scanned, 6);
  assert.equal(summary.eligible, 2);
  assert.equal(summary.processed, 1);
  assert.equal(summary.updated, 0);
  assert.equal(summary.wouldUpdate, 1);
  assert.deepEqual(queries, ['https://boardgamegeek.com/boardgame/5']);
});

test('catalog name backfill continues after lookup errors and concurrent edits without exposing exception data', async () => {
  let calls = 0;
  const progress: unknown[] = [];
  const importService: WikipediaBoardGameImportService = {
    async importByTitle() {
      calls += 1;
      if (calls === 1) throw new Error('private-api-token');
      if (calls === 2) return { ok: false, error: { type: 'connection', message: 'private-response' } };
      return { ok: true, draft: draft() };
    },
  };
  const summary = await updateCatalogNames({
    items: [item(1), item(2), item(3), item(4)], importService, async save(update) { return update.item.id !== 3; },
    wait: async () => {}, onProgress: (value) => progress.push(value),
  });
  assert.equal(summary.processed, 4);
  assert.equal(summary.failed, 2);
  assert.equal(summary.conflicts, 1);
  assert.equal(summary.updated, 1);
  assert.doesNotMatch(JSON.stringify({ progress, summary }), /private-api-token|private-response/);
});

test('catalog name backfill parses only supported options and positive limits', () => {
  assert.deepEqual(parseCatalogNameUpdateOptions(['--dry-run', '--limit', '3']), { dryRun: true, limit: 3, help: false });
  assert.equal(parseCatalogNameUpdateOptions(['--help']).help, true);
  assert.throws(() => parseCatalogNameUpdateOptions(['--limit', '-1']));
  assert.throws(() => parseCatalogNameUpdateOptions(['--limit']));
  assert.throws(() => parseCatalogNameUpdateOptions(['--unknown']));
});

test('catalog name batch service loads pending IDs once per 20 and reuses physical-copy results', async () => {
  const requests: string[] = [];
  const items = Array.from({ length: 21 }, (_, index) => item(index + 1));
  items.push(item(22, { externalRefs: { boardGameGeekId: '1' } }));
  const service = createCatalogNameBatchImportService({
    items, bggApiKey: 'test-key', fetchImpl: (async (input) => {
      const url = new URL(String(input));
      requests.push(url.toString());
      return new Response(`<items>${url.searchParams.get('id')!.split(',').map((id) =>
        `<item type="boardgame" id="${id}"><name type="primary" value="Game ${id}"/></item>`).join('')}</items>`);
    }) as typeof fetch,
  });
  for (const entry of items) {
    assert.equal((await service.importByTitle(`https://boardgamegeek.com/boardgame/${entry.externalRefs?.boardGameGeekId}`)).ok, true);
  }
  assert.equal(requests.length, 2);
  assert.equal(new URL(requests[0]!).searchParams.get('id')!.split(',').length, 20);
  assert.equal(new URL(requests[1]!).searchParams.get('id'), '21');
});

test('catalog name fetch spaces all HTTP starts by five seconds, including queued calls', async () => {
  let time = 0;
  const starts: number[] = [];
  const pacedFetch = createCatalogNameFetch({
    now: () => time, wait: async (ms) => { time += ms; },
    fetchImpl: (async (_input, init) => {
      assert.ok(init?.signal);
      starts.push(time);
      return new Response('<items/>');
    }) as typeof fetch,
  });
  await Promise.all([pacedFetch('https://example.test/1'), pacedFetch('https://example.test/2'), pacedFetch('https://example.test/3')]);
  assert.deepEqual(starts, [0, 5000, 10_000]);
});

test('catalog name fetch respects numeric and date Retry-After before recovering from throttling', async () => {
  let time = Date.parse('2026-10-18T10:00:00Z');
  const initial = time;
  const starts: number[] = [];
  const pacedFetch = createCatalogNameFetch({
    now: () => time, wait: async (ms) => { time += ms; },
    fetchImpl: (async () => {
      starts.push(time - initial);
      if (starts.length === 1) return new Response('', { status: 429, headers: { 'Retry-After': '7' } });
      if (starts.length === 2) return new Response('', { status: 503, headers: { 'Retry-After': new Date(time + 12_000).toUTCString() } });
      return new Response('<items/>');
    }) as typeof fetch,
  });
  assert.equal((await pacedFetch('https://example.test')).status, 200);
  assert.deepEqual(starts, [0, 7000, 19_000]);
});

test('catalog name fetch stops after four attempts and uses exponential fallback for temporary failures', async () => {
  let time = 0;
  const starts: number[] = [];
  const pacedFetch = createCatalogNameFetch({
    now: () => time, wait: async (ms) => { time += ms; },
    fetchImpl: (async () => {
      starts.push(time);
      return new Response('', { status: starts.length === 1 ? 502 : starts.length === 2 ? 503 : 504 });
    }) as typeof fetch,
  });
  assert.equal((await pacedFetch('https://example.test')).status, 504);
  assert.deepEqual(starts, [0, 10_000, 30_000, 70_000]);
});

test('catalog name fetch caps retry delays at a minute and preserves minimum spacing for short Retry-After', async () => {
  let time = 0;
  const starts: number[] = [];
  const pacedFetch = createCatalogNameFetch({
    now: () => time, wait: async (ms) => { time += ms; },
    fetchImpl: (async () => {
      starts.push(time);
      if (starts.length === 1) return new Response('', { status: 429, headers: { 'Retry-After': '120' } });
      if (starts.length === 2) return new Response('', { status: 429, headers: { 'Retry-After': '1' } });
      return new Response('', { status: 404 });
    }) as typeof fetch,
  });
  assert.equal((await pacedFetch('https://example.test')).status, 404);
  assert.deepEqual(starts, [0, 60_000, 65_000]);
});
