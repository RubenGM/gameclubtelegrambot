import test from 'node:test';
import assert from 'node:assert/strict';

import { createAppMetadataWebSettingsStore, defaultWebSettings, parseWebSettings } from './web-settings-store.js';
import type { AppMetadataSessionStorage } from '../telegram/conversation-session-store.js';

test('createAppMetadataWebSettingsStore returns brand defaults when unset', async () => {
  const store = createAppMetadataWebSettingsStore({ storage: createMemoryStorage() });

  const settings = await store.load();

  assert.equal(settings.brand.name, 'CAWA Girona');
  assert.equal(settings.brand.primaryColor, '#184b1f');
  assert.equal(settings.theme, 'classic');
  assert.equal(settings.home.logoAsset, null);
  assert.equal(settings.home.featuredLinks[0]?.url, '/actividades');
});

test('createAppMetadataWebSettingsStore saves normalized settings', async () => {
  const storage = createMemoryStorage();
  const store = createAppMetadataWebSettingsStore({ storage });

  await store.save({
    ...defaultWebSettings,
    theme: 'club-dark',
    brand: {
      name: '  Club CAWA  ',
      headline: '  Mesa abierta  ',
      primaryColor: '#BAD',
    },
    home: {
      intro: defaultWebSettings.home.intro,
      logoAsset: '/assets/logo-test.png',
      heroAsset: '../secret.png',
      galleryAssets: ['/assets/mesa.webp', '/tmp/private.jpg'],
      featuredLinks: [
        { label: ' Agenda ', url: '/actividades' },
        { label: 'Bad', url: 'javascript:alert(1)' },
      ],
    },
  });

  const loaded = await store.load();
  assert.equal(loaded.theme, 'club-dark');
  assert.equal(loaded.brand.name, 'Club CAWA');
  assert.equal(loaded.brand.headline, 'Mesa abierta');
  assert.equal(loaded.brand.primaryColor, '#184b1f');
  assert.equal(loaded.home.logoAsset, '/assets/logo-test.png');
  assert.equal(loaded.home.heroAsset, null);
  assert.deepEqual(loaded.home.galleryAssets, ['/assets/mesa.webp']);
  assert.deepEqual(loaded.home.featuredLinks, [{ label: 'Agenda', url: '/actividades' }]);
});

test('parseWebSettings falls back safely on invalid payloads and theme names', () => {
  assert.deepEqual(parseWebSettings('not-json'), defaultWebSettings);
  assert.equal(parseWebSettings(JSON.stringify({ theme: '../secret.css' })).theme, 'classic');
});

function createMemoryStorage(): AppMetadataSessionStorage {
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
      return Array.from(values.entries())
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value }));
    },
  };
}
