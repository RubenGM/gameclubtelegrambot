import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGoogleCalendarUrl, parseGoogleCalendarIdentifier } from './google-calendar-client.js';
import { createAppMetadataGoogleCalendarSettingsStore } from './google-calendar-settings.js';
import type { AppMetadataSessionStorage } from '../telegram/conversation-session-store.js';

function storage(initial?: Record<string, string>): AppMetadataSessionStorage {
  const values = new Map(Object.entries(initial ?? {}));
  return {
    async get(key) { return values.get(key) ?? null; },
    async set(key, value) { values.set(key, value); },
    async delete(key) { return values.delete(key); },
    async listByPrefix(prefix) { return [...values.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value })); },
  };
}

test('Google Calendar settings default to private and disabled', async () => {
  const settings = await createAppMetadataGoogleCalendarSettingsStore({ storage: storage() }).getSettings();
  assert.deepEqual(settings, { calendarId: null, calendarUrl: null, visibility: 'private', syncEnabled: false });
});

test('Google Calendar settings prevent enabled sync without a selected calendar', async () => {
  const store = createAppMetadataGoogleCalendarSettingsStore({ storage: storage() });
  await store.saveSettings({ calendarId: null, calendarUrl: 'https://example.test', visibility: 'public', syncEnabled: true });
  assert.deepEqual(await store.getSettings(), { calendarId: null, calendarUrl: null, visibility: 'public', syncEnabled: false });
});

test('Google Calendar calendar links round-trip through the manual selector format', () => {
  const calendarId = 'club@example.com';
  assert.equal(parseGoogleCalendarIdentifier(buildGoogleCalendarUrl(calendarId)), calendarId);
  assert.equal(parseGoogleCalendarIdentifier('https://example.test/?cid=Y2x1YkBleGFtcGxlLmNvbQ'), null);
});
