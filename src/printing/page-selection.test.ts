import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePrintPageSelection } from './page-selection.js';

test('parsePrintPageSelection accepts all pages in supported languages', () => {
  assert.deepEqual(parsePrintPageSelection('Todas', 4), {
    ok: true,
    pages: [1, 2, 3, 4],
    label: '1-4',
  });
  assert.deepEqual(parsePrintPageSelection('all', 2), {
    ok: true,
    pages: [1, 2],
    label: '1-2',
  });
});

test('parsePrintPageSelection deduplicates ranges and lists', () => {
  assert.deepEqual(parsePrintPageSelection('1,3,2-4,3', 5), {
    ok: true,
    pages: [1, 2, 3, 4],
    label: '1-4',
  });
});

test('parsePrintPageSelection supports disjoint pages with compact labels', () => {
  assert.deepEqual(parsePrintPageSelection('1,3,5-7', 8), {
    ok: true,
    pages: [1, 3, 5, 6, 7],
    label: '1,3,5-7',
  });
});

test('parsePrintPageSelection rejects pages outside the document', () => {
  assert.deepEqual(parsePrintPageSelection('1,8', 4), {
    ok: false,
    reason: 'out-of-range',
  });
});

test('parsePrintPageSelection rejects invalid syntax and empty documents', () => {
  assert.deepEqual(parsePrintPageSelection('1,,2', 4), {
    ok: false,
    reason: 'invalid-format',
  });
  assert.deepEqual(parsePrintPageSelection('Todas', 0), {
    ok: false,
    reason: 'invalid-total-pages',
  });
});

