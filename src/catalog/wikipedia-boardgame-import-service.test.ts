import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBoardGameGeekCollectionImportService,
  createBoardGameGeekWebImportService,
  createWikipediaBoardGameImportService,
} from './wikipedia-boardgame-import-service.js';

test('BGG web import returns every search result and exposes language versions', async () => {
  const requests: string[] = [];
  const service = createBoardGameGeekWebImportService({
    bggApiKey: 'test-key',
    fetchImpl: (async (input: string | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.includes('/search?')) {
        return { ok: true, status: 200, text: async () => `<items>${Array.from({ length: 12 }, (_, index) => `<item type="boardgame" id="${index + 1}"><name type="primary" value="Juego ${index + 1}"/><yearpublished value="${2000 + index}"/></item>`).join('')}</items>` } as Response;
      }
      if (url.includes('id=1%2C2%2C3%2C4%2C5%2C6%2C7%2C8%2C9%2C10%2C11%2C12')) {
        return { ok: true, status: 200, text: async () => `<items>${Array.from({ length: 12 }, (_, index) => `<item type="boardgame" id="${index + 1}"><thumbnail>https://example.test/${index + 1}-thumb.jpg</thumbnail><image>https://example.test/${index + 1}.jpg</image><name type="primary" value="Juego ${index + 1}"/></item>`).join('')}</items>` } as Response;
      }
      if (url.includes('stats=1')) {
        return { ok: true, status: 200, text: async () => '<items><item type="boardgame" id="12"><name type="primary" value="Game Twelve"/><yearpublished value="2011"/></item></items>' } as Response;
      }
      return { ok: true, status: 200, text: async () => '<items><item type="boardgame" id="12"><versions><item type="boardgameversion" id="120"><name type="primary" value="Juego Doce"/><yearpublished value="2012"/><productcode value="ED-ES-12"/><link type="language" value="Spanish"/><link type="boardgamepublisher" value="Editorial ES"/><image>https://example.test/es.jpg</image></item><item type="boardgameversion" id="121"><name type="primary" value="Game Twelve"/><link type="language" value="English"/></item></versions></item></items>' } as Response;
    }) as typeof fetch,
  });

  const search = await service.search('Game Twelve');
  assert.equal(search.candidates.length, 12);
  assert.equal(search.candidates[11]?.thumbnailUrl, 'https://example.test/12-thumb.jpg');
  assert.equal(search.candidates[11]?.imageUrl, 'https://example.test/12.jpg');
  const detail = await service.inspect('12');
  assert.equal(detail.versions.length, 2);
  assert.deepEqual(detail.versions[0], { id: '120', name: 'Juego Doce', languages: ['Spanish'], publishers: ['Editorial ES'], yearPublished: 2012, productCode: 'ED-ES-12', imageUrl: 'https://example.test/es.jpg', thumbnailUrl: null });
  assert.deepEqual(requests, [
    'https://boardgamegeek.com/xmlapi2/search?query=Game+Twelve&type=boardgame',
    'https://boardgamegeek.com/xmlapi2/thing?id=1%2C2%2C3%2C4%2C5%2C6%2C7%2C8%2C9%2C10%2C11%2C12&stats=1',
    'https://boardgamegeek.com/xmlapi2/thing?id=12&stats=1',
    'https://boardgamegeek.com/xmlapi2/thing?id=12&versions=1',
  ]);
});

test('BGG web import accepts an exact BoardGameGeek URL without searching', async () => {
  const service = createBoardGameGeekWebImportService({ bggApiKey: 'test-key', fetchImpl: (async () => { throw new Error('search must not run'); }) as typeof fetch });
  assert.deepEqual(await service.search('https://boardgamegeek.com/boardgame/315196/example'), { candidates: [], directBoardGameGeekId: '315196' });
});

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

test('createWikipediaBoardGameImportService resolves a direct BGG URL by exact ID without Wikipedia fallback', async () => {
  const requests: string[] = [];
  let wikipediaCalls = 0;
  const service = createWikipediaBoardGameImportService({
    bggApiKey: 'test-bgg-key',
    fetchImpl: (async (input: string | URL) => {
      requests.push(String(input));
      return {
        ok: true,
        status: 200,
        text: async () => `
          <items>
            <item type="boardgame" id="216132">
              <name type="primary" value="Scythe: Legendary Box" />
              <yearpublished value="2017" />
            </item>
          </items>
        `,
      } as Response;
    }) as typeof fetch,
    execImpl: (() => {
      wikipediaCalls += 1;
      throw new Error('Wikipedia should not be called');
    }) as never,
  });

  const result = await service.importByTitle('https://boardgamegeek.com/boardgame/216132/scythe-legendary-box');

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.draft.displayName, 'Scythe: Legendary Box');
  assert.equal(result.ok && result.draft.externalRefs?.boardGameGeekId, '216132');
  assert.deepEqual(requests, ['https://boardgamegeek.com/xmlapi2/thing?id=216132&stats=1']);
  assert.equal(wikipediaCalls, 0);
});

test('createWikipediaBoardGameImportService treats zero-valued optional BGG fields as missing', async () => {
  const service = createWikipediaBoardGameImportService({
    bggApiKey: 'test-bgg-key',
    fetchImpl: (async () => ({
      ok: true,
      status: 200,
      text: async () => `
        <items>
          <item type="boardgame" id="315196">
            <name type="primary" value="Dungeons &amp; Dragons: Adventure Begins" />
            <yearpublished value="2020" />
            <minplayers value="2" />
            <maxplayers value="4" />
            <playingtime value="0" />
            <minage value="10" />
          </item>
        </items>
      `,
    } as Response)) as typeof fetch,
  });

  const result = await service.importByTitle(
    'https://boardgamegeek.com/boardgame/315196/dungeons-and-dragons-adventure-begins',
  );

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.draft.displayName, 'Dungeons & Dragons: Adventure Begins');
  assert.equal(result.ok && result.draft.playTimeMinutes, null);
  assert.equal(result.ok && result.draft.publicationYear, 2020);
  assert.equal(result.ok && result.draft.playerCountMin, 2);
  assert.equal(result.ok && result.draft.playerCountMax, 4);
  assert.equal(result.ok && result.draft.recommendedAge, 10);
});

test('createWikipediaBoardGameImportService does not send a missing direct BGG ID to Wikipedia', async () => {
  let wikipediaCalls = 0;
  const service = createWikipediaBoardGameImportService({
    bggApiKey: 'test-bgg-key',
    fetchImpl: (async () => ({
      ok: true,
      status: 200,
      text: async () => '<items></items>',
    } as Response)) as typeof fetch,
    execImpl: (() => {
      wikipediaCalls += 1;
      throw new Error('Wikipedia should not be called');
    }) as never,
  });

  const result = await service.importByTitle('boardgamegeek.com/boardgame/999999/missing-game');

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.type, 'not-found');
  assert.equal(wikipediaCalls, 0);
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
