import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCatalogBulkImageQuestion,
  parseCatalogBulkImageResponse,
} from './catalog-bulk-image-detection.js';

test('buildCatalogBulkImageQuestion requires a strict game-title JSON response', () => {
  const question = buildCatalogBulkImageQuestion();
  assert.match(question, /juegos de mesa y expansiones/i);
  assert.match(question, /JSON valido/i);
  assert.match(question, /"games"/);
});

test('parseCatalogBulkImageResponse reads fenced JSON and removes duplicate titles', () => {
  assert.deepEqual(parseCatalogBulkImageResponse(`> build · gpt-5.4

\`\`\`json
{"games":["Root", "Catan", {"title":"ROOT"}, {"name":"Heat"}]}
\`\`\``), ['Root', 'Catan', 'Heat']);
});

test('parseCatalogBulkImageResponse accepts a numbered fallback and rejects model errors', () => {
  assert.deepEqual(parseCatalogBulkImageResponse('1. Brass: Birmingham\n2) Ark Nova'), ['Brass: Birmingham', 'Ark Nova']);
  assert.deepEqual(parseCatalogBulkImageResponse('{"games":[]}'), []);
  assert.deepEqual(parseCatalogBulkImageResponse('Error: Model not found'), []);
});
