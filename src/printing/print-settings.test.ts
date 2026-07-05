import assert from 'node:assert/strict';
import test from 'node:test';

import { createAppMetadataPrintingSettingsStore } from './print-settings.js';

test('printing settings default to disabled with the configured queue', async () => {
  const store = createAppMetadataPrintingSettingsStore({
    storage: createMemoryStorage(),
    defaultQueue: 'HP-LaserJet-P2015-Series',
  });

  assert.deepEqual(await store.getSettings(), {
    mode: 'disabled',
    cupsQueue: 'HP-LaserJet-P2015-Series',
  });
});

test('printing settings persist enabled, disabled and test modes', async () => {
  const storage = createMemoryStorage();
  const store = createAppMetadataPrintingSettingsStore({
    storage,
    defaultQueue: 'HP-LaserJet-P2015-Series',
  });

  await store.saveSettings({ mode: 'enabled', cupsQueue: 'Virtual-PDF' });
  assert.deepEqual(await store.getSettings(), {
    mode: 'enabled',
    cupsQueue: 'Virtual-PDF',
  });

  await store.saveSettings({ mode: 'test', cupsQueue: 'Virtual-PDF' });
  assert.deepEqual(await store.getSettings(), {
    mode: 'test',
    cupsQueue: 'Virtual-PDF',
  });

  await store.saveSettings({ mode: 'disabled', cupsQueue: 'Virtual-PDF' });
  assert.deepEqual(JSON.parse(storage.records.get('printing.settings') ?? '{}'), {
    mode: 'disabled',
    cupsQueue: 'Virtual-PDF',
  });
});

test('printing settings read legacy enabled boolean values', async () => {
  const storage = createMemoryStorage();
  const store = createAppMetadataPrintingSettingsStore({
    storage,
    defaultQueue: 'HP-LaserJet-P2015-Series',
  });

  storage.records.set('printing.settings', JSON.stringify({ enabled: true, cupsQueue: 'Old-PDF' }));
  assert.deepEqual(await store.getSettings(), {
    mode: 'enabled',
    cupsQueue: 'Old-PDF',
  });

  storage.records.set('printing.settings', JSON.stringify({ enabled: false, cupsQueue: 'Old-PDF' }));
  assert.deepEqual(await store.getSettings(), {
    mode: 'disabled',
    cupsQueue: 'Old-PDF',
  });
});

function createMemoryStorage() {
  const records = new Map<string, string>();
  return {
    records,
    async get(key: string) {
      return records.get(key) ?? null;
    },
    async set(key: string, value: string) {
      records.set(key, value);
    },
    async delete(key: string) {
      return records.delete(key);
    },
    async listByPrefix(prefix: string) {
      return [...records.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value }));
    },
  };
}
