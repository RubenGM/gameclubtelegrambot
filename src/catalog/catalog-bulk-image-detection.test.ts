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
  assert.match(question, /texto transcrito|transcrito/i);
  assert.match(question, /omite esa caja/i);
});

test('parseCatalogBulkImageResponse keeps only clear titles backed by matching visible text', () => {
  assert.deepEqual(parseCatalogBulkImageResponse(`> build · gpt-5.4

\`\`\`json
{"games":[
  {"title":"Root","visibleText":"ROOT","certainty":"clear"},
  {"title":"Catan","visibleText":"Cat","certainty":"clear"},
  {"title":"Heat","visibleText":"Heat","certainty":"uncertain"},
  {"name":"ROOT","visibleText":"Root","certainty":"clear"}
]}
\`\`\``), ['Root']);
});

test('parseCatalogBulkImageResponse rejects unstructured or unsupported model output', () => {
  assert.deepEqual(parseCatalogBulkImageResponse('1. Brass: Birmingham\n2) Ark Nova'), []);
  assert.deepEqual(parseCatalogBulkImageResponse('{"games":["Ark Nova"]}'), []);
  assert.deepEqual(parseCatalogBulkImageResponse('{"games":[]}'), []);
  assert.deepEqual(parseCatalogBulkImageResponse('Error: Model not found'), []);
});
