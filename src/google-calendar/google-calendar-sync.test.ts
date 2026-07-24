import assert from 'node:assert/strict';
import test from 'node:test';

import { createAppMetadataGoogleCalendarSettingsStore } from './google-calendar-settings.js';
import { synchronizeFutureGoogleCalendarScheduleEvents, synchronizeGoogleCalendarScheduleEvent } from './google-calendar-sync.js';
import type { GoogleCalendarClient } from './google-calendar-client.js';
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
