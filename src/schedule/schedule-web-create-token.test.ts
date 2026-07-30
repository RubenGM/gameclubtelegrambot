import test from 'node:test';
import assert from 'node:assert/strict';

import { createScheduleWebCreateTokenStore } from './schedule-web-create-token.js';
import type { AppMetadataSessionStorage } from '../telegram/conversation-session-store.js';

test('schedule web create tokens are stored by hash and consumed once', async () => {
  const storage = memoryAtomicStorage();
  const store = createScheduleWebCreateTokenStore({
    storage,
    now: () => new Date('2026-07-30T10:00:00.000Z'),
    generateToken: () => 'a'.repeat(43),
  });

  const issued = await store.issue({ telegramUserId: 77 });
  assert.equal(issued.token, 'a'.repeat(43));
  assert.equal([...storage.values.keys()].some((key) => key.includes(issued.token)), false);
  assert.equal((await store.inspect(issued.token))?.telegramUserId, 77);
  assert.equal((await store.consume(issued.token))?.telegramUserId, 77);
  assert.equal(await store.consume(issued.token), null);
  await store.restore(issued.token, issued.record);
  assert.equal((await store.inspect(issued.token))?.telegramUserId, 77);
});

test('schedule web create tokens expire after thirty minutes', async () => {
  let now = new Date('2026-07-30T10:00:00.000Z');
  const storage = memoryAtomicStorage();
  const store = createScheduleWebCreateTokenStore({
    storage,
    now: () => now,
    generateToken: () => 'b'.repeat(43),
  });

  const issued = await store.issue({ telegramUserId: 88 });
  now = new Date('2026-07-30T10:31:00.000Z');
  assert.equal(await store.inspect(issued.token), null);
  assert.equal(await store.consume(issued.token), null);
});

function memoryAtomicStorage(): AppMetadataSessionStorage & {
  values: Map<string, string>;
  take(key: string): Promise<string | null>;
} {
  const values = new Map<string, string>();
  return {
    values,
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
      return [...values.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value }));
    },
    async take(key) {
      const value = values.get(key) ?? null;
      values.delete(key);
      return value;
    },
  };
}
