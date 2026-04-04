import test from 'node:test';
import assert from 'node:assert/strict';

import { hashSecret } from './password-hash.js';

test('hashSecret creates a non-plaintext scrypt hash with parameters and salt', async () => {
  const hash = await hashSecret('admin-secret');

  assert.doesNotMatch(hash, /^admin-secret$/);
  assert.match(hash, /^scrypt:\d+:\d+:\d+:[0-9a-f]+:[0-9a-f]+$/);
});
