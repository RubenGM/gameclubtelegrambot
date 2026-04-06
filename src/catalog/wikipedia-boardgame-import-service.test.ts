import assert from 'node:assert/strict';
import test from 'node:test';

import { createWikipediaBoardGameImportService } from './wikipedia-boardgame-import-service.js';

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
