import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createGoogleCalendarAdminService } from './google-calendar-admin-service.js';
import { createAppMetadataGoogleCalendarSettingsStore } from './google-calendar-settings.js';
import type { GoogleCalendarClient } from './google-calendar-client.js';
import type { ScheduleEventRecord, ScheduleRepository } from '../schedule/schedule-catalog.js';
import type { AppMetadataSessionStorage } from '../telegram/conversation-session-store.js';

const serviceAccountJson = JSON.stringify({
  type: 'service_account',
  project_id: 'club-project',
  client_email: 'calendar-bot@club-project.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n',
});

test('Google Calendar web admin configures credentials, calendar, visibility and synchronization', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'google-calendar-admin-'));
  const credentialFile = join(directory, 'credentials.json');
  const values = new Map<string, string>();
  const settingsStore = createAppMetadataGoogleCalendarSettingsStore({ storage: metadataStorage(values) });
  const calls: string[] = [];
  const client: GoogleCalendarClient = {
    async listAccessibleCalendars() {
      calls.push('list');
      return [{ id: 'club@example.com', summary: 'Calendario CAWA', accessRole: 'owner' }];
    },
    async getCalendar(calendarId) {
      calls.push(`get:${calendarId}`);
      return { id: calendarId, summary: 'Calendario CAWA', accessRole: 'owner' };
    },
    async setVisibility(calendarId, visibility) { calls.push(`visibility:${calendarId}:${visibility}`); },
    async upsertScheduleEvent({ event }) { calls.push(`upsert:${event.id}`); },
    async deleteScheduleEvent({ scheduleEventId }) { calls.push(`delete:${scheduleEventId}`); },
  };
  const event = scheduleEvent(17);
  const repository = {
    async listEvents() { return [event]; },
  } as unknown as ScheduleRepository;
  const service = createGoogleCalendarAdminService({
    config: { serviceAccountFile: credentialFile },
    settingsStore,
    scheduleRepository: repository,
    clientFactory: () => client,
  });

  await assert.rejects(() => service.saveCredentials('{"type":"user"}'), /cuenta de servicio/);
  const identity = await service.saveCredentials(serviceAccountJson);
  assert.equal(identity.clientEmail, 'calendar-bot@club-project.iam.gserviceaccount.com');
  assert.equal((await stat(credentialFile)).mode & 0o777, 0o600);
  assert.equal(await readFile(credentialFile, 'utf8'), serviceAccountJson);

  const initial = await service.loadState();
  assert.equal(initial.credentials.source, 'web-file');
  assert.equal(initial.calendars[0]?.summary, 'Calendario CAWA');

  await service.configureCalendar({ calendarIdOrUrl: 'club@example.com', visibility: 'private' });
  assert.deepEqual(await settingsStore.getSettings(), {
    calendarId: 'club@example.com',
    calendarUrl: 'https://calendar.google.com/calendar/u/0?cid=Y2x1YkBleGFtcGxlLmNvbQ',
    visibility: 'private',
    syncEnabled: false,
  });

  assert.deepEqual(await service.setSynchronization(true), { synchronized: 1 });
  assert.equal((await settingsStore.getSettings()).syncEnabled, true);
  assert.ok(calls.includes('upsert:17'));
  await service.setSynchronization(false);
  assert.equal((await settingsStore.getSettings()).syncEnabled, false);

  await service.removeWebCredentials();
  assert.equal((await service.loadState()).credentials.configured, false);
});

function metadataStorage(values: Map<string, string>): AppMetadataSessionStorage {
  return {
    async get(key) { return values.get(key) ?? null; },
    async set(key, value) { values.set(key, value); },
    async delete(key) { return values.delete(key); },
    async listByPrefix(prefix) {
      return [...values.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value }));
    },
  };
}

function scheduleEvent(id: number): ScheduleEventRecord {
  return {
    id,
    title: 'Partida de prueba',
    description: null,
    detailsMessageChatId: null,
    detailsMessageId: null,
    startsAt: '2030-08-26T18:00:00.000Z',
    durationMinutes: 180,
    organizerTelegramUserId: 1,
    createdByTelegramUserId: 1,
    tableId: null,
    equipmentIds: [],
    catalogItemId: null,
    attendanceMode: 'open',
    isPublic: true,
    initialOccupiedSeats: 0,
    capacity: 6,
    lifecycleStatus: 'scheduled',
    createdAt: '2026-08-26T10:00:00.000Z',
    updatedAt: '2026-08-26T10:00:00.000Z',
    cancelledAt: null,
    cancelledByTelegramUserId: null,
    cancellationReason: null,
  };
}
