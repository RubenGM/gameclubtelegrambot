import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBoardGameGeekCollectionImportService,
  createWikipediaBoardGameImportService,
} from './wikipedia-boardgame-import-service.js';

test('createWikipediaBoardGameImportService preserves ambiguous candidates', async () => {
  const service = createWikipediaBoardGameImportService({
    execImpl: (() => Object.assign(
      Promise.resolve({
        stdout: JSON.stringify({
          ok: false,
          error: {
            type: 'ambiguous',
            message: 'He trobat diverses pàgines candidates a Wikipedia.',
            candidates: ['Frosthaven', 'Frosthaven (board game)'],
          },
        }),
        stderr: '',
      }),
      { child: {} },
    )) as never,
  });

  const result = await service.importByTitle('Frosthaven');

  assert.equal(result.ok, false);
  assert.equal(result.error.type, 'ambiguous');
  assert.deepEqual(result.error.candidates, ['Frosthaven', 'Frosthaven (board game)']);
});

test('createBoardGameGeekCollectionImportService imports owned board games and expansions', async () => {
  const requests: string[] = [];
  const fetchImpl: typeof fetch = (async (input: string | URL) => {
    const url = String(input);
    requests.push(url);

    if (url.includes('/collection?') && url.includes('subtype=boardgame') && !url.includes('subtype=boardgameexpansion') && url.includes('own=1')) {
      return {
        ok: true,
        status: 200,
        text: async () => `
          <items totalitems="1" termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">
            <item objecttype="thing" objectid="101" subtype="boardgame" collid="1">
              <name sortindex="1">Root</name>
            </item>
          </items>
        `,
      } as Response;
    }

    if (url.includes('/collection?') && url.includes('subtype=boardgameexpansion') && url.includes('own=1')) {
      return {
        ok: true,
        status: 200,
        text: async () => `
          <items totalitems="1" termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">
            <item objecttype="thing" objectid="202" subtype="boardgameexpansion" collid="2">
              <name sortindex="1">Riverfolk Expansion</name>
            </item>
          </items>
        `,
      } as Response;
    }

    if (url.includes('/thing?') && url.includes('id=101%2C202') && url.includes('stats=1')) {
      return {
        ok: true,
        status: 200,
        text: async () => `
          <items termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">
            <item type="boardgame" id="101">
              <thumbnail>https://example.com/root-thumb.jpg</thumbnail>
              <image>https://example.com/root.jpg</image>
              <name type="primary" sortindex="1" value="Root" />
              <description>Woodland war game</description>
              <yearpublished value="2018" />
              <minplayers value="2" />
              <maxplayers value="4" />
              <playingtime value="90" />
              <minage value="10" />
              <link type="boardgamepublisher" value="Leder Games" />
              <link type="boardgamedesigner" value="Cole Wehrle" />
            </item>
            <item type="boardgameexpansion" id="202">
              <thumbnail>https://example.com/riverfolk-thumb.jpg</thumbnail>
              <image>https://example.com/riverfolk.jpg</image>
              <name type="primary" sortindex="1" value="Riverfolk Expansion" />
              <description>Root expansion</description>
              <yearpublished value="2018" />
              <minplayers value="1" />
              <maxplayers value="6" />
              <playingtime value="90" />
              <minage value="10" />
              <link type="boardgamepublisher" value="Leder Games" />
            </item>
          </items>
        `,
      } as Response;
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;

  const service = createBoardGameGeekCollectionImportService({
    fetchImpl,
    bggApiKey: 'test-bgg-key',
  });

  const result = await service.importByUsername('ruben');

  assert.equal(result.ok, true);
  assert.equal(result.username, 'ruben');
  assert.equal(result.totalCount, 2);
  assert.equal(result.errors.length, 0);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0]?.displayName, 'Root');
  assert.equal(result.items[0]?.itemType, 'board-game');
  assert.equal(result.items[1]?.displayName, 'Riverfolk Expansion');
  assert.equal(result.items[1]?.itemType, 'expansion');
  assert.deepEqual(requests, [
    'https://boardgamegeek.com/xmlapi2/collection?username=ruben&subtype=boardgame&own=1',
    'https://boardgamegeek.com/xmlapi2/collection?username=ruben&subtype=boardgameexpansion&own=1',
    'https://boardgamegeek.com/xmlapi2/thing?id=101%2C202&stats=1',
  ]);
});
