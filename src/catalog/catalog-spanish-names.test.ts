import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogSpanishNameCandidates, createCatalogSpanishNameResolver, resolveCatalogSpanishNames } from './catalog-spanish-names.js';
import { preserveCatalogDisplayName } from './catalog-names.js';

const game = () => ({ displayName: 'The Initiative', originalName: 'The Initiative', metadata: {
  alternateNames: ['The Initiative', 'La Iniciativa', 'L’Initiative', 'Инициатива', 'EN/FR/ES edition'],
} as Record<string, unknown> });

test('Spanish name resolver selects an existing alias, without translating or changing the original', async () => {
  const resolver = createCatalogSpanishNameResolver({ codexBin: '/configured/wrapper', query: async (input) => {
    assert.equal(input.codexBin, '/configured/wrapper');
    assert.match(input.prompt, /No traduzcas, no inventes/);
    assert.match(input.prompt, /La Iniciativa/);
    return '{"choices":[{"id":"0","name":"La Iniciativa"}]}';
  } });
  const [localized] = await resolveCatalogSpanishNames([game()], resolver);
  assert.equal(localized?.displayName, 'La Iniciativa');
  assert.equal(localized?.originalName, 'The Initiative');
  assert.equal(localized?.metadata?.spanishName, 'La Iniciativa');
  assert.equal(localized?.metadata?.spanishNameResolutionVersion, 1);
  assert.deepEqual(catalogSpanishNameCandidates(game()), ['The Initiative', 'La Iniciativa', 'L’Initiative']);
});

for (const raw of ['not json', '{"choices":[{"id":"0","nameIndex":99}]}', '{"choices":[{"id":"0","name":"An invented translation"}]}',
  '{"choices":[{"id":"0","name":1}]}', '{"choices":[{"id":"unknown","name":"La Iniciativa"}]}', '{"choices":[]}']) {
  test(`invalid classifier result is retryable: ${raw}`, async () => {
    const original = game();
    const [result] = await resolveCatalogSpanishNames([original], createCatalogSpanishNameResolver({ query: async () => raw }));
    assert.strictEqual(result, original);
    assert.equal(result?.metadata?.spanishNameResolutionVersion, undefined);
  });
}

test('duplicates and missing ids invalidate the whole batch', async () => {
  const originals = [game(), game()];
  const result = await resolveCatalogSpanishNames(originals, createCatalogSpanishNameResolver({ query: async () =>
    '{"choices":[{"id":"0","name":"La Iniciativa"},{"id":"0","name":"La Iniciativa"}]}' }));
  assert.deepEqual(result, originals);
  assert.ok(result.every((item) => item.metadata?.spanishNameResolutionVersion === undefined));
});

test('unknown Spanish names retain the original, while failures remain retryable', async () => {
  const [unknown] = await resolveCatalogSpanishNames([game()], async () => new Map([['0', null]]));
  assert.equal(unknown?.displayName, 'The Initiative');
  assert.equal(unknown?.metadata?.spanishNameResolutionVersion, 1);
  const original = game();
  const [failed] = await resolveCatalogSpanishNames([original], async () => { throw new Error('provider failure'); });
  assert.strictEqual(failed, original);
});

test('selection does not overwrite custom visible titles or reclassify stored decisions', async () => {
  const [localized] = await resolveCatalogSpanishNames([game()], async () => new Map([['0', 'La Iniciativa']]));
  assert.equal(preserveCatalogDisplayName({ ...game(), displayName: 'La copia del club' }, localized!), 'La copia del club');
  const result = await resolveCatalogSpanishNames([localized!], async () => { assert.fail('Already resolved'); });
  assert.equal(result[0]?.displayName, 'La Iniciativa');
});

test('base BGG aliases take precedence over labels from version records and single names need no query', async () => {
  const original = { ...game(), metadata: { ...game().metadata, boardGameGeekNameCandidates: ['The Initiative', 'La Iniciativa'] } };
  assert.deepEqual(catalogSpanishNameCandidates(original), ['The Initiative', 'La Iniciativa']);
  const [single] = await resolveCatalogSpanishNames([{ displayName: 'Catan', originalName: 'Catan', metadata: null as Record<string, unknown> | null }], async () => { assert.fail('Single name'); });
  assert.equal(single?.displayName, 'Catan');
  assert.equal(single?.metadata?.spanishNameResolutionVersion, 1);
});

test('each batch is bounded to ten games and injected resolvers cannot invent names', async () => {
  const sizes: number[] = [];
  const result = await resolveCatalogSpanishNames(Array.from({ length: 23 }, game), async (candidates) => {
    sizes.push(candidates.length);
    return new Map(candidates.map((candidate) => [candidate.id, 'An invented translation']));
  });
  assert.deepEqual(sizes, [10, 10, 3]);
  assert.ok(result.every((item) => item.displayName === 'The Initiative' && item.metadata?.spanishNameResolutionVersion === undefined));
});
