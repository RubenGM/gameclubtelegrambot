import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAppMetadataMembershipRequestNotificationSubscriptionStore,
  toggleMembershipRequestNotifications,
} from './request-notification-store.js';

function createMemoryStorage() {
  const entries = new Map<string, string>();

  return {
    async get(key: string) {
      return entries.get(key) ?? null;
    },
    async set(key: string, value: string) {
      entries.set(key, value);
    },
    async delete(key: string) {
      return entries.delete(key);
    },
    async listByPrefix(prefix: string) {
      return Array.from(entries.entries())
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value }));
    },
  };
}

test('membership request notification subscriptions can be enabled and disabled per admin', async () => {
  const storage = createMemoryStorage();
  const store = createAppMetadataMembershipRequestNotificationSubscriptionStore({ storage });

  assert.equal(await store.isSubscribed(99), false);

  assert.equal(
    await toggleMembershipRequestNotifications({ store, telegramUserId: 99, enabled: true }),
    'enabled',
  );
  assert.equal(await store.isSubscribed(99), true);
  assert.deepEqual(await store.listSubscribedAdminTelegramUserIds(), [99]);

  assert.equal(
    await toggleMembershipRequestNotifications({ store, telegramUserId: 99, enabled: true }),
    'already-enabled',
  );

  assert.equal(
    await toggleMembershipRequestNotifications({ store, telegramUserId: 99, enabled: false }),
    'disabled',
  );
  assert.equal(await store.isSubscribed(99), false);
  assert.deepEqual(await store.listSubscribedAdminTelegramUserIds(), []);

  assert.equal(
    await toggleMembershipRequestNotifications({ store, telegramUserId: 99, enabled: false }),
    'already-disabled',
  );
});
