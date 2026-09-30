import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryFor, selectTests, type SourceFile } from './selection.js';

const sources: SourceFile[] = [
  { path: 'src/storage/store.ts', content: '' },
  { path: 'src/storage/store.test.ts', content: '' },
  { path: 'src/storage/store.integration.test.ts', content: '' },
  { path: 'src/telegram/storage-flow.ts', content: "export { store } from '../storage/store.js';" },
  { path: 'src/http/admin-http-server.ts', content: "import { store } from '../telegram/storage-flow.js';" },
  { path: 'src/http/admin-http-server.test.ts', content: "import '../http/admin-http-server.js';" },
  { path: 'src/catalog/catalog.test.ts', content: '' },
];

test('selection includes the changed domain and transitive consumers across categories', () => {
  assert.deepEqual(selectTests(sources, ['src/storage/store.ts']).tests, [
    'src/http/admin-http-server.test.ts', 'src/storage/store.integration.test.ts', 'src/storage/store.test.ts',
  ]);
});

test('selection follows literal dynamic imports, cycles and deleted source paths', () => {
  const files = [
    { path: 'src/http/a.ts', content: "export * from './b.js';" },
    { path: 'src/http/b.ts', content: "import './a.js'; import('./deleted.js');" },
    { path: 'src/catalog/a.test.ts', content: "import '../http/a.js';" },
    { path: 'src/storage/a.test.ts', content: '' },
  ];
  assert.deepEqual(selectTests(files, ['src/http/deleted.ts']).tests, ['src/catalog/a.test.ts']);
});

test('modified tests select themselves, documentation selects none, unknown code falls back to all', () => {
  assert.deepEqual(selectTests(sources, ['src/catalog/catalog.test.ts']).tests, ['src/catalog/catalog.test.ts']);
  assert.deepEqual(selectTests(sources, ['PENDING.md', 'docs/testing.md']).tests, []);
  assert.equal(selectTests(sources, ['unknown/tool.py']).tests.length, 4);
  assert.equal(selectTests(sources, ['package-lock.json']).tests.length, 4);
  assert.equal(selectTests(sources, ['drizzle/new.sql']).tests.length, 4);
});

test('non-imported runtime resources and operational scripts select their domains', () => {
  const files = [
    { path: 'src/telegram/llm-command-flow.test.ts', content: '' },
    { path: 'src/operations/service-control.test.ts', content: '' },
    { path: 'src/bootstrap/create-app.test.ts', content: '' },
  ];
  assert.deepEqual(selectTests(files, ['src/telegram/llm-command-decision.schema.json']).tests, ['src/telegram/llm-command-flow.test.ts']);
  assert.deepEqual(selectTests(files, ['startup.sh']).tests, ['src/bootstrap/create-app.test.ts', 'src/operations/service-control.test.ts']);
  assert.equal(categoryFor('src/telegram/catalog-loan-flow.test.ts'), 'loans');
});
