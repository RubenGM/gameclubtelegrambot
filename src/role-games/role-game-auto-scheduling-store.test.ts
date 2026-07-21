import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAppMetadataRoleGameAutoSchedulingStore,
  defaultRoleGameAutoSchedulingMaxFutureWeeks,
} from './role-game-auto-scheduling-store.js';

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
  assert.deepEqual(await store.getSettings(), {
    enabled: false,
    maxFutureWeeks: defaultRoleGameAutoSchedulingMaxFutureWeeks,
  });
  await store.setEnabled(true);
  assert.equal(await store.isEnabled(), true);
  await store.setMaxFutureWeeks(6);
  assert.deepEqual(await store.getSettings(), { enabled: true, maxFutureWeeks: 6 });
  await store.setEnabled(false);
  assert.equal(await store.isEnabled(), false);
  await store.setMaxFutureWeeks(defaultRoleGameAutoSchedulingMaxFutureWeeks);
  assert.equal(values.has('role-games.auto-scheduling.max-future-weeks'), false);
});

test('role-game automatic scheduling falls back to two weeks for invalid persisted values', async () => {
  const values = new Map<string, string>([
    ['role-games.auto-scheduling.max-future-weeks', 'unlimited'],
  ]);
  const store = createAppMetadataRoleGameAutoSchedulingStore({
    storage: {
      get: async (key) => values.get(key) ?? null,
      set: async (key, value) => { values.set(key, value); },
      delete: async (key) => values.delete(key),
      listByPrefix: async () => [],
    },
  });

  assert.equal((await store.getSettings()).maxFutureWeeks, 2);
  await assert.rejects(() => store.setMaxFutureWeeks(0), /between 1 and 52/);
  await assert.rejects(() => store.setMaxFutureWeeks(53), /between 1 and 52/);
  await assert.rejects(() => store.setMaxFutureWeeks(2.5), /between 1 and 52/);
});
