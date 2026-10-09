import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync } from 'node:crypto';

import { createAppMetadataGoogleCalendarSettingsStore } from './google-calendar-settings.js';
import { synchronizeFutureGoogleCalendarScheduleEvents, synchronizeGoogleCalendarScheduleEvent, synchronizeScheduleEventsToCalendar } from './google-calendar-sync.js';
import { createGoogleCalendarClient, GoogleCalendarApiError, type GoogleCalendarClient } from './google-calendar-client.js';
import type { ScheduleEventRecord, ScheduleRepository } from '../schedule/schedule-catalog.js';
import type { AppMetadataSessionStorage } from '../telegram/conversation-session-store.js';

function storage(): AppMetadataSessionStorage {
  const values = new Map<string, string>();
  return {
    async get(key) { return values.get(key) ?? null; },
    async set(key, value) { values.set(key, value); },
    async delete(key) { return values.delete(key); },
    async listByPrefix(prefix) { return [...values.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value })); },
  };
}

function event(overrides: Partial<ScheduleEventRecord> = {}): ScheduleEventRecord {
  return {
    id: 9, title: 'Netrunner', description: null, detailsMessageChatId: null, detailsMessageId: null,
    startsAt: '2026-08-01T16:00:00.000Z', durationMinutes: 180, organizerTelegramUserId: 1,
    createdByTelegramUserId: 1, tableId: null, catalogItemId: null, attendanceMode: 'open', isPublic: false,
    initialOccupiedSeats: 0, capacity: 4, lifecycleStatus: 'scheduled', createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z', cancelledAt: null, cancelledByTelegramUserId: null, cancellationReason: null,
    ...overrides,
  };
}

test('Google Calendar sync creates/updates scheduled events and removes cancelled ones', async () => {
  const metadata = storage();
  await createAppMetadataGoogleCalendarSettingsStore({ storage: metadata }).saveSettings({
    calendarId: 'club@example.com', calendarUrl: 'https://calendar.example', visibility: 'private', syncEnabled: true,
  });
  const calls: string[] = [];
  const client: GoogleCalendarClient = {
    async listAccessibleCalendars() { return []; }, async getCalendar() { throw new Error('not used'); }, async setVisibility() {},
    async upsertScheduleEvent({ calendarId, event: input }) { calls.push(`upsert:${calendarId}:${input.id}`); },
    async deleteScheduleEvent({ calendarId, scheduleEventId }) { calls.push(`delete:${calendarId}:${scheduleEventId}`); },
  };
  assert.equal(await synchronizeGoogleCalendarScheduleEvent({ event: event(), storage: metadata, config: undefined, client }), true);
  assert.equal(await synchronizeGoogleCalendarScheduleEvent({ event: event({ lifecycleStatus: 'cancelled' }), storage: metadata, config: undefined, client }), true);
  assert.deepEqual(calls, ['upsert:club@example.com:9', 'delete:club@example.com:9']);
});

test('Google Calendar reconciliation includes future cancellations for retries', async () => {
  const metadata = storage();
  await createAppMetadataGoogleCalendarSettingsStore({ storage: metadata }).saveSettings({
    calendarId: 'club@example.com', calendarUrl: 'https://calendar.example', visibility: 'private', syncEnabled: true,
  });
  const calls: string[] = [];
  const client: GoogleCalendarClient = {
    async listAccessibleCalendars() { return []; }, async getCalendar() { throw new Error('not used'); }, async setVisibility() {},
    async upsertScheduleEvent({ event: input }) { calls.push(`upsert:${input.id}`); },
    async deleteScheduleEvent({ scheduleEventId }) { calls.push(`delete:${scheduleEventId}`); },
  };
  const repository: ScheduleRepository = {
    async listEvents(input) { assert.equal(input.includeCancelled, true); return [event(), event({ id: 10, lifecycleStatus: 'cancelled' })]; },
  } as ScheduleRepository;
  const result = await synchronizeFutureGoogleCalendarScheduleEvents({ repository, storage: metadata, config: undefined, client, startsAtFrom: '2026-07-01T00:00:00.000Z' });
  assert.deepEqual(result, { synchronized: 2, skipped: false });
  assert.deepEqual(calls, ['upsert:9', 'delete:10']);
});

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

function apiClient(responses: Response[], calls: string[]): GoogleCalendarClient {
  return createGoogleCalendarClient({
    config: { serviceAccountJson: JSON.stringify({
      type: 'service_account', client_email: 'test@example.com', private_key: privateKey,
    }) },
    fetchFn: (async (url, init) => {
      calls.push(`${init?.method}:${String(url).split('/').at(-1)}`);
      const response = responses.shift();
      assert.ok(response, 'unexpected API request');
      return response;
    }) as typeof fetch,
  });
}

for (const status of [404, 410]) {
  test(`already deleted cancellation (HTTP ${status}) allows subsequent activity updates`, async () => {
    const calls: string[] = [];
    const client = apiClient([
      Response.json({ access_token: 'test-token', expires_in: 3600 }),
      Response.json({ error: { message: 'Resource has been deleted' } }, { status }),
      Response.json({}),
    ], calls);
    await synchronizeScheduleEventsToCalendar({
      events: [event({ lifecycleStatus: 'cancelled' }), event({ id: 10 })],
      calendarId: 'club@example.com', config: undefined, client,
    });
    assert.deepEqual(calls, ['POST:token', 'DELETE:gameclubschedule9', 'PUT:gameclubschedule10']);
  });
}

test('cancellation permission errors are still reported', async () => {
  const client = apiClient([
    Response.json({ access_token: 'test-token', expires_in: 3600 }),
    Response.json({ error: { message: 'Forbidden' } }, { status: 403 }),
  ], []);
  await assert.rejects(client.deleteScheduleEvent({ calendarId: 'club@example.com', scheduleEventId: 9 }),
    (error: unknown) => error instanceof GoogleCalendarApiError && error.status === 403);
});

test('reconciliation continues after failures and reports all failed activity IDs', async () => {
  const calls: number[] = [];
  const client: GoogleCalendarClient = {
    async listAccessibleCalendars() { return []; }, async getCalendar() { throw new Error('unused'); }, async setVisibility() {},
    async deleteScheduleEvent({ scheduleEventId }) { calls.push(scheduleEventId); throw new Error('Forbidden'); },
    async upsertScheduleEvent({ event: input }) {
      calls.push(input.id);
      if (input.id === 11) throw new Error('fetch failed');
    },
  };
  await assert.rejects(synchronizeScheduleEventsToCalendar({
    events: [event({ lifecycleStatus: 'cancelled' }), event({ id: 10 }), event({ id: 11 }), event({ id: 12 })],
    calendarId: 'club@example.com', config: undefined, client,
  }), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    assert.match(error.message, /Activity 9: Forbidden/);
    assert.match(error.message, /Activity 11: fetch failed/);
    return true;
  });
  assert.deepEqual(calls, [9, 10, 11, 12]);
});
