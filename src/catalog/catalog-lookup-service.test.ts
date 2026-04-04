import assert from 'node:assert/strict';
import test from 'node:test';

import { createHttpCatalogLookupService } from './catalog-lookup-service.js';

test('createHttpCatalogLookupService maps Open Library results into catalog lookup candidates', async () => {
  const service = createHttpCatalogLookupService({
    fetchImpl: async () => new Response(JSON.stringify({
      docs: [
        {
          key: '/works/OL123W',
          title: 'Player\'s Handbook',
          subtitle: '2024 Edition',
          author_name: ['Wizards RPG Team'],
          publisher: ['Wizards of the Coast'],
          first_publish_year: 2024,
          language: ['eng'],
          isbn: ['9780786969518'],
        },
      ],
    }), { status: 200 }),
  });

  const results = await service.search({ itemType: 'rpg-book', query: 'Manual del jugador 2024' });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.title, 'Player\'s Handbook');
  assert.equal(results[0]?.summary, 'Wizards RPG Team · Wizards of the Coast · 2024');
  assert.deepEqual(results[0]?.importedData.externalRefs, {
    openLibraryKey: '/works/OL123W',
    openLibraryUrl: 'https://openlibrary.org/works/OL123W',
    isbn: '9780786969518',
  });
  assert.deepEqual(results[0]?.importedData.metadata, {
    source: 'open-library',
    author: 'Wizards RPG Team',
  });
  assert.equal(results[0]?.importedData.originalName, 'Player\'s Handbook: 2024 Edition');
  assert.equal(results[0]?.importedData.language, 'ENG');
});

test('createHttpCatalogLookupService ignores unsupported item types', async () => {
  let wasCalled = false;
  const service = createHttpCatalogLookupService({
    fetchImpl: async () => {
      wasCalled = true;
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    },
  });

  const results = await service.search({ itemType: 'board-game', query: 'Spirit Island' });

  assert.deepEqual(results, []);
  assert.equal(wasCalled, false);
});

test('createHttpCatalogLookupService includes author refinement in Open Library requests', async () => {
  let requestedUrl = '';
  const service = createHttpCatalogLookupService({
    fetchImpl: async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ docs: [] }), { status: 200 });
    },
  });

  await service.search({ itemType: 'book', query: 'Eric', author: 'Terry Pratchett' });

  assert.match(requestedUrl, /q=Eric/);
  assert.match(requestedUrl, /author=Terry\+Pratchett/);
});
