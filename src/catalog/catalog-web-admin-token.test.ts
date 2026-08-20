import test from 'node:test';
import assert from 'node:assert/strict';

import { createCatalogWebAdminTokenStore } from './catalog-web-admin-token.js';

test('catalog web admin token remains reusable for one hour', async () => {
  const values = new Map<string, string>();
  let current = new Date('2026-08-20T10:00:00.000Z');
  const store = createCatalogWebAdminTokenStore({
    storage: {
      get: async (key) => values.get(key) ?? null,
      set: async (key, value) => { values.set(key, value); },
      delete: async (key) => values.delete(key),
      listByPrefix: async () => [],
    },
    now: () => current,
    generateToken: () => 'a'.repeat(43),
  });

  const issued = await store.issue({ telegramUserId: 77 });
  assert.equal(issued.record.expiresAt, '2026-08-20T11:00:00.000Z');
  assert.equal((await store.inspect(issued.token))?.telegramUserId, 77);
  assert.equal((await store.inspect(issued.token))?.telegramUserId, 77);

  current = new Date('2026-08-20T11:00:00.000Z');
  assert.equal(await store.inspect(issued.token), null);
});
