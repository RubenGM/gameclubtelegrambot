import type { ScheduleEventRecord } from '../schedule/schedule-catalog.js';
import type { TelegramActor } from './actor-store.js';
import { createTelegramI18n, normalizeBotLanguage, type BotLanguage } from './i18n.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatHtmlField(label: string, value: string): string {
  return `<b>${escapeHtml(label)}:</b> ${value}`;
}

export function formatDayHeading(dayKey: string): string {
  return dayKey.split('-').reverse().join('/');
}

export function formatEventTime(startsAt: string): string {
  return startsAt.slice(11, 16);
}

export function formatEventTimeRange(startsAt: string, durationMinutes: number): string {
  const endsAt = new Date(new Date(startsAt).getTime() + durationMinutes * 60000).toISOString();
  return `${formatHourLabel(startsAt)}-${formatHourLabel(endsAt)}`;
}

export function sortScheduleEvents(events: ScheduleEventRecord[]): ScheduleEventRecord[] {
  return events.slice().sort((left, right) => left.startsAt.localeCompare(right.startsAt));
}

export function groupScheduleEventsByDay(events: ScheduleEventRecord[]): Map<string, ScheduleEventRecord[]> {
  const groups = new Map<string, ScheduleEventRecord[]>();
  for (const event of events) {
    const dayKey = event.startsAt.slice(0, 10);
    const bucket = groups.get(dayKey) ?? [];
    bucket.push(event);
    groups.set(dayKey, bucket);
  }

  return groups;
}

export function formatScheduleListMessage(events: ScheduleEventRecord[]): string {
  const groupedEvents = groupScheduleEventsByDay(sortScheduleEvents(events));
  const lines: string[] = [];

  for (const [dayKey, dayEvents] of groupedEvents) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(`<b>${formatDayHeading(dayKey)}</b>`);
    for (const event of dayEvents) {
      lines.push(`- <b>${escapeHtml(event.title)}</b> (${formatEventTime(event.startsAt)}) · ${event.capacity} places`);
      if (event.description) {
        lines.push(`  <i>${escapeHtml(event.description)}</i>`);
      }
    }
  }

  return lines.join('\n');
}

export function buildScheduleDayButtons({
  events,
  language,
  dayCallbackPrefix,
}: {
  events: ScheduleEventRecord[];
  language: string;
  dayCallbackPrefix: string;
}): NonNullable<TelegramReplyOptions['inlineKeyboard']> {
  const dayKeys = Array.from(new Set(events.map((event) => event.startsAt.slice(0, 10))));
  return dayKeys.map((dayKey) => [{ text: formatScheduleDayButtonLabel(dayKey, language), callbackData: `${dayCallbackPrefix}${dayKey}` }]);
}

export function formatScheduleEventDetails({
  event,
  tableName,
  language = 'ca',
}: {
  event: ScheduleEventRecord;
  tableName: string | null;
  language?: BotLanguage;
}): string {
  const texts = createTelegramI18n(normalizeBotLanguage(language, 'ca')).schedule;
  const attendanceLabel = event.attendanceMode === 'open' ? texts.openDetailTag : texts.closedDetailTag;
  return [
    `<b>${escapeHtml(event.title)}</b>`,
    formatHtmlField(texts.detailsStart, formatTimestamp(event.startsAt)),
    formatHtmlField(texts.detailsDuration, formatDurationMinutes(event.durationMinutes)),
    formatHtmlField(texts.detailsAttendanceMode, escapeHtml(attendanceLabel)),
    formatHtmlField(texts.detailsSeats, String(event.capacity)),
    ...(event.attendanceMode === 'open'
      ? [formatHtmlField(texts.detailsInitialOccupiedSeats, String(event.initialOccupiedSeats))]
      : []),
    formatHtmlField(texts.detailsTable, escapeHtml(tableName ?? texts.noTable)),
    formatHtmlField(texts.detailsDescription, escapeHtml(event.description ?? texts.noDescription)),
  ].join('\n');
}

export function formatDurationMinutes(durationMinutes: number): string {
  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;
  if (hours === 0) {
    return `${minutes} min`;
  }
  if (minutes === 0) {
    return `${hours} h`;
  }
  return `${hours} h ${minutes} min`;
}

export function buildScheduleDetailActionOptions({
  actor,
  event,
  isAttending,
  language = 'ca',
  callbackPrefixes,
}: {
  actor: TelegramActor;
  event: ScheduleEventRecord;
  isAttending: boolean;
  language?: BotLanguage;
  callbackPrefixes: {
    join: string;
    leave: string;
    selectEdit: string;
    selectCancel: string;
  };
}): TelegramReplyOptions {
  const texts = createTelegramI18n(normalizeBotLanguage(language, 'ca')).schedule;
  const rows: TelegramReplyOptions['inlineKeyboard'] = [];

  if (event.attendanceMode === 'open') {
    rows.push([
      { text: isAttending ? texts.leaveButton : texts.joinButton, callbackData: `${isAttending ? callbackPrefixes.leave : callbackPrefixes.join}${event.id}` },
    ]);
  }

  if (actor.isAdmin || event.createdByTelegramUserId === actor.telegramUserId) {
    rows.push([
      { text: texts.editButton, callbackData: `${callbackPrefixes.selectEdit}${event.id}` },
      { text: texts.deleteButton, callbackData: `${callbackPrefixes.selectCancel}${event.id}` },
    ]);
  }

  return rows.length > 0 ? { inlineKeyboard: rows } : {};
}

export function formatTimestamp(value: string): string {
  const date = new Date(value);
  return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCFullYear())} ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

export function buildUpcomingDateRows(language: string, now = new Date()): string[][] {
  const rows: string[][] = [];
  const values: string[] = [];

  for (let index = 0; index < 6; index += 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + index));
    values.push(formatUpcomingDateLabel(date, language));
  }

  for (let index = 0; index < values.length; index += 2) {
    rows.push(values.slice(index, index + 2));
  }

  return rows;
}

export function formatParticipantCount(occupiedSeats: number, capacity: number): string {
  return `${occupiedSeats}/${capacity} participants`;
}

function formatUpcomingDateLabel(date: Date, language: string): string {
  const weekday = new Intl.DateTimeFormat(resolveLanguageLocale(language), {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(date);
  return `${capitalizeFirstLetter(weekday)}, ${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function resolveLanguageLocale(language: string): string {
  switch (language) {
    case 'ca':
      return 'ca-ES';
    case 'es':
      return 'es-ES';
    case 'en':
      return 'en-GB';
    default:
      return language;
  }
}

function capitalizeFirstLetter(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

function formatScheduleDayButtonLabel(dayKey: string, language: string): string {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  const weekday = new Intl.DateTimeFormat(resolveLanguageLocale(language), { weekday: 'long', timeZone: 'UTC' }).format(date);
  return `Veure ${capitalizeFirstLetter(weekday)} ${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatHourLabel(isoTimestamp: string): string {
  const time = formatEventTime(isoTimestamp);
  if (time.endsWith(':00')) {
    return `${time.slice(0, 2)}h`;
  }

  return `${time}h`;
}
