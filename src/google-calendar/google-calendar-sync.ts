import type { ScheduleEventRecord, ScheduleRepository } from '../schedule/schedule-catalog.js';
import type { AppMetadataSessionStorage } from '../telegram/conversation-session-store.js';
import { createGoogleCalendarClient, type GoogleCalendarClient, type GoogleCalendarServiceAccountConfig } from './google-calendar-client.js';
import { createAppMetadataGoogleCalendarSettingsStore } from './google-calendar-settings.js';

export async function synchronizeGoogleCalendarScheduleEvent({
  event,
  storage,
  config,
  client: providedClient,
}: {
  event: ScheduleEventRecord;
  storage: AppMetadataSessionStorage;
  config: GoogleCalendarServiceAccountConfig | undefined;
  client?: GoogleCalendarClient;
}): Promise<boolean> {
  const settings = await createAppMetadataGoogleCalendarSettingsStore({ storage }).getSettings();
  if (!settings.syncEnabled || !settings.calendarId) return false;
  const client = providedClient ?? createGoogleCalendarClient({ config });
  if (event.lifecycleStatus === 'cancelled') {
    await client.deleteScheduleEvent({ calendarId: settings.calendarId, scheduleEventId: event.id });
  } else {
    await client.upsertScheduleEvent({ calendarId: settings.calendarId, event });
  }
  return true;
}

export async function synchronizeFutureGoogleCalendarScheduleEvents({
  repository,
  storage,
  config,
  startsAtFrom = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  client,
}: {
  repository: ScheduleRepository;
  storage: AppMetadataSessionStorage;
  config: GoogleCalendarServiceAccountConfig | undefined;
  startsAtFrom?: string;
  client?: GoogleCalendarClient;
}): Promise<{ synchronized: number; skipped: boolean }> {
  const settings = await createAppMetadataGoogleCalendarSettingsStore({ storage }).getSettings();
  if (!settings.syncEnabled || !settings.calendarId) return { synchronized: 0, skipped: true };
  const events = await repository.listEvents({ includeCancelled: true, startsAtFrom });
  await synchronizeScheduleEventsToCalendar({ events, calendarId: settings.calendarId, config, ...(client ? { client } : {}) });
  return { synchronized: events.length, skipped: false };
}

export async function synchronizeScheduleEventsToCalendar({
  events,
  calendarId,
  config,
  client: providedClient,
}: {
  events: ScheduleEventRecord[];
  calendarId: string;
  config: GoogleCalendarServiceAccountConfig | undefined;
  client?: GoogleCalendarClient;
}): Promise<void> {
  const client = providedClient ?? createGoogleCalendarClient({ config });
  for (const event of events) {
    if (event.lifecycleStatus === 'cancelled') {
      await client.deleteScheduleEvent({ calendarId, scheduleEventId: event.id });
    } else {
      await client.upsertScheduleEvent({ calendarId, event });
    }
  }
}
