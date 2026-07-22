import assert from 'node:assert/strict';
import test from 'node:test';

import { decryptNotionCredential, encryptNotionCredential } from './notion-credential-crypto.js';

const encryptionKey = '0123456789012345678901234567890123456789012345678901234567890123';

test('Notion credentials are encrypted locally and require the correct server key', () => {
  const encrypted = encryptNotionCredential('secret_notion_token', encryptionKey);
  assert.doesNotMatch(encrypted, /secret_notion_token/);
  assert.equal(decryptNotionCredential(encrypted, encryptionKey), 'secret_notion_token');
  assert.throws(() => decryptNotionCredential(encrypted, 'f'.repeat(64)));
});
