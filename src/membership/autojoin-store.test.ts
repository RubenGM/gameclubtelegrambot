import test from 'node:test';
import assert from 'node:assert/strict';

import type { AppMetadataSessionStorage } from '../telegram/conversation-session-store.js';
import {
  createAppMetadataMembershipAutojoinStore,
  toggleMembershipAutojoin,
} from './autojoin-store.js';

test('membership autojoin can be enabled and disabled per group chat', async () => {
  const storage = createMemoryStorage();
  const store = createAppMetadataMembershipAutojoinStore({ storage });

  assert.equal(await store.isEnabled(-1001), false);

  assert.equal(await toggleMembershipAutojoin({ store, chatId: -1001, enabled: true }), 'enabled');
  assert.equal(await store.isEnabled(-1001), true);
  assert.equal(await store.isEnabled(-1002), false);

  assert.equal(await toggleMembershipAutojoin({ store, chatId: -1001, enabled: true }), 'already-enabled');

  assert.equal(await toggleMembershipAutojoin({ store, chatId: -1001, enabled: false }), 'disabled');
  assert.equal(await store.isEnabled(-1001), false);

  assert.equal(await toggleMembershipAutojoin({ store, chatId: -1001, enabled: false }), 'already-disabled');
});

function createMemoryStorage(): AppMetadataSessionStorage {
  const entries = new Map<string, string>();

  return {
    async get(key) {
      return entries.get(key) ?? null;
    },
    async set(key, value) {
      entries.set(key, value);
    },
    async delete(key) {
      return entries.delete(key);
    },
    async listByPrefix(prefix) {
      return Array.from(entries.entries())
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value }));
    },
  };
}
