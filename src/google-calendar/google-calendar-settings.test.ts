import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGoogleCalendarEmbedUrl, buildGoogleCalendarUrl, parseGoogleCalendarIdentifier, toGoogleEvent } from './google-calendar-client.js';
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

test('buildGoogleCalendarEmbedUrl uses the configured calendar and club timezone', () => {
  assert.equal(
    buildGoogleCalendarEmbedUrl('cawagirona@gmail.com'),
    'https://calendar.google.com/calendar/embed?src=cawagirona%40gmail.com&ctz=Europe%2FMadrid',
  );
});

test('toGoogleEvent includes event detail URL in description', () => {
  const event = {
    id: 42,
    title: 'Partida Épica',
    description: 'Partida de prueba con amigos',
    startsAt: '2026-05-23T17:00:00.000Z',
    durationMinutes: 120,
    capacity: 6,
    initialOccupiedSeats: 1,
    attendanceMode: 'open' as const,
    tableId: null,
    catalogItemId: null,
    organizerTelegramUserId: 123,
    lifecycleStatus: 'scheduled' as const,
    createdAt: '2026-05-20T10:00:00.000Z',
    updatedAt: '2026-05-20T10:00:00.000Z',
  };
  const gEventDefault = toGoogleEvent(event);
  assert.equal(gEventDefault.summary, 'Partida Épica');
  assert.match(String(gEventDefault.description), /https:\/\/cawa\.hopto\.org\/actividades\/42/);
  assert.match(String(gEventDefault.description), /Partida de prueba con amigos/);
  assert.match(String(gEventDefault.description), /Plazas: 6/);

  const gEventCustom = toGoogleEvent(event, 'https://custom.club.org/');
  assert.match(String(gEventCustom.description), /https:\/\/custom\.club\.org\/actividades\/42/);
});
