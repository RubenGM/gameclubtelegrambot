import assert from 'node:assert/strict';
import test from 'node:test';

import { createAppMetadataRoleGameAutoSchedulingStore } from './role-game-auto-scheduling-store.js';

test('role-game automatic scheduling is disabled by default and can be toggled', async () => {
  const values = new Map<string, string>();
  const store = createAppMetadataRoleGameAutoSchedulingStore({
    storage: {
      get: async (key) => values.get(key) ?? null,
      set: async (key, value) => { values.set(key, value); },
      delete: async (key) => values.delete(key),
      listByPrefix: async () => [],
    },
  });

  assert.equal(await store.isEnabled(), false);
  await store.setEnabled(true);
  assert.equal(await store.isEnabled(), true);
  await store.setEnabled(false);
  assert.equal(await store.isEnabled(), false);
});
