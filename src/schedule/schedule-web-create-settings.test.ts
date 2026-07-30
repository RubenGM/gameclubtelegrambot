import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAppMetadataScheduleWebCreateSettingsStore,
  defaultScheduleWebCreateSettings,
} from './schedule-web-create-settings.js';
import type { AppMetadataSessionStorage } from '../telegram/conversation-session-store.js';

test('schedule web create settings default to disabled', async () => {
  const store = createAppMetadataScheduleWebCreateSettingsStore({ storage: memoryStorage() });
  assert.deepEqual(await store.load(), defaultScheduleWebCreateSettings);
});

test('schedule web create settings normalize and persist the public base URL', async () => {
  const storage = memoryStorage();
  const store = createAppMetadataScheduleWebCreateSettingsStore({ storage });

  assert.deepEqual(await store.save({
    enabled: true,
    publicBaseUrl: 'https://cawa.hopto.org/',
  }), {
    enabled: true,
    publicBaseUrl: 'https://cawa.hopto.org',
  });
  assert.deepEqual(await store.load(), {
    enabled: true,
    publicBaseUrl: 'https://cawa.hopto.org',
  });
});

test('schedule web create settings reject unsafe public URLs', async () => {
  const store = createAppMetadataScheduleWebCreateSettingsStore({ storage: memoryStorage() });
  await assert.rejects(
    store.save({ enabled: true, publicBaseUrl: 'javascript:alert(1)' }),
    /HTTP o HTTPS/,
  );
  await assert.rejects(
    store.save({ enabled: true, publicBaseUrl: 'https://user:secret@example.test/path?q=token' }),
    /credenciales/,
  );
});

function memoryStorage(): AppMetadataSessionStorage {
  const values = new Map<string, string>();
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
      return [...values.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value }));
    },
  };
}
