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
              <poll name="suggested_numplayers" title="User Suggested Number of Players" totalvotes="20">
                <results numplayers="1">
                  <result value="Best" numvotes="0" />
                  <result value="Recommended" numvotes="2" />
                  <result value="Not Recommended" numvotes="10" />
                </results>
                <results numplayers="2">
                  <result value="Best" numvotes="8" />
                  <result value="Recommended" numvotes="10" />
                  <result value="Not Recommended" numvotes="1" />
                </results>
                <results numplayers="3">
                  <result value="Best" numvotes="11" />
                  <result value="Recommended" numvotes="7" />
                  <result value="Not Recommended" numvotes="1" />
                </results>
              </poll>
              <statistics page="1">
                <ratings>
                  <usersrated value="58721" />
                  <average value="8.07115" />
                  <bayesaverage value="7.84537" />
                  <ranks>
                    <rank type="subtype" id="1" name="boardgame" friendlyname="Board Game Rank" value="32" bayesaverage="7.84537" />
                  </ranks>
                  <numweights value="3650" />
                  <averageweight value="3.7924" />
                </ratings>
              </statistics>
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
  assert.equal(result.items[0]?.metadata?.averageWeight, 3.7924);
  assert.equal(result.items[0]?.metadata?.averageRating, 8.07115);
  assert.equal(result.items[0]?.metadata?.bayesAverage, 7.84537);
  assert.equal(result.items[0]?.metadata?.usersRated, 58721);
  assert.equal(result.items[0]?.metadata?.numWeights, 3650);
  assert.equal(result.items[0]?.metadata?.rank, 32);
  assert.deepEqual(result.items[0]?.metadata?.bestPlayerCounts, ['3']);
  assert.deepEqual(result.items[0]?.metadata?.recommendedPlayerCounts, ['2', '3']);
  assert.equal(result.items[1]?.displayName, 'Riverfolk Expansion');
  assert.equal(result.items[1]?.itemType, 'expansion');
  assert.deepEqual(requests, [
    'https://boardgamegeek.com/xmlapi2/collection?username=ruben&subtype=boardgame&own=1',
    'https://boardgamegeek.com/xmlapi2/collection?username=ruben&subtype=boardgameexpansion&own=1',
    'https://boardgamegeek.com/xmlapi2/thing?id=101%2C202&stats=1',
  ]);
});
