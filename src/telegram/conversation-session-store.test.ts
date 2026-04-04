import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAppMetadataConversationSessionStore,
  type AppMetadataSessionStorage,
} from './conversation-session-store.js';

test('app metadata session store persists and reloads a session record', async () => {
  const values = new Map<string, string>();
  const store = createAppMetadataConversationSessionStore({
    storage: createMemoryAppMetadataStorage(values),
  });

  await store.saveSession({
    key: 'telegram.session:100:200',
    flowKey: 'schedule-create',
    stepKey: 'title',
    data: {
      draft: true,
    },
    createdAt: '2026-04-04T10:00:00.000Z',
    updatedAt: '2026-04-04T10:00:00.000Z',
    expiresAt: '2026-04-04T12:00:00.000Z',
  });

  const loaded = await store.loadSession('telegram.session:100:200');

  assert.equal(loaded?.flowKey, 'schedule-create');
  assert.equal(loaded?.stepKey, 'title');
  assert.deepEqual(loaded?.data, { draft: true });
});

test('app metadata session store deletes expired sessions by prefix', async () => {
  const values = new Map<string, string>([
    [
      'telegram.session:1:1',
      JSON.stringify({
        key: 'telegram.session:1:1',
        flowKey: 'a',
        stepKey: 'one',
        data: {},
        createdAt: '2026-04-04T08:00:00.000Z',
        updatedAt: '2026-04-04T08:00:00.000Z',
        expiresAt: '2026-04-04T09:00:00.000Z',
      }),
    ],
    [
      'telegram.session:1:2',
      JSON.stringify({
        key: 'telegram.session:1:2',
        flowKey: 'b',
        stepKey: 'two',
        data: {},
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        expiresAt: '2026-04-04T11:00:00.000Z',
      }),
    ],
    ['bootstrap.initialization', '{"firstAdminTelegramUserId":1}'],
  ]);
  const store = createAppMetadataConversationSessionStore({
    storage: createMemoryAppMetadataStorage(values),
  });

  const deleted = await store.deleteExpiredSessions('2026-04-04T10:30:00.000Z');

  assert.equal(deleted, 1);
  assert.equal(values.has('telegram.session:1:1'), false);
  assert.equal(values.has('telegram.session:1:2'), true);
  assert.equal(values.has('bootstrap.initialization'), true);
});

function createMemoryAppMetadataStorage(values: Map<string, string>): AppMetadataSessionStorage {
  return {
    async get(key) {
      return values.get(key) ?? null;
    },
    async set(key, value) {
      values.set(key, value);
    },
    async delete(key) {
      return values.delete(key);
    },
    async listByPrefix(prefix) {
      return Array.from(values.entries())
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value }));
    },
  };
}
