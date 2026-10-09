import type { CalendarEntry } from './calendar-summary.js';
import { buildTelegramStartUrl } from './deep-links.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import type { TelegramRichMessage } from './rich-message-transport.js';
import { formatScheduleDescriptionSummary } from './schedule-presentation.js';

const defaultTimeZone = 'Europe/Madrid';
export type CalendarRichEntry = CalendarEntry & { equipmentNames?: string[]; venueImpactText?: string };
const calendarLabels = {
  ca: { period: 'Pròxims 30 dies', generated: 'Actualitzat', venue: 'Local', free: 'lliures' },
  es: { period: 'Próximos 30 días', generated: 'Actualizado', venue: 'Local', free: 'libres' },
  en: { period: 'Next 30 days', generated: 'Updated', venue: 'Venue', free: 'free' },
} as const;

export function buildCalendarRichMessage({
  entries,
  language,
  title,
  emptyText,
  footerHtml,
  actionsHtml,
  now,
  startsAtTo,
  timeZone = defaultTimeZone,
}: {
  entries: CalendarRichEntry[];
  language: string;
  title: string;
  emptyText: string;
  footerHtml: string;
  actionsHtml: string;
  now: Date;
  /** Omit for direct activity lists, which have no broadcast horizon. */
  startsAtTo?: string;
  timeZone?: string;
}): TelegramRichMessage {
  const locale = resolveLocale(language);
  const texts = createTelegramI18n(normalizeBotLanguage(language, 'ca'));
  const labels = calendarLabels[normalizeBotLanguage(language, 'ca')];
  const groups = new Map<string, CalendarRichEntry[]>();
  for (const entry of entries) {
    const day = getDayKey(entry.startsAt, timeZone);
    const dayEntries = groups.get(day) ?? [];
    dayEntries.push(entry);
    groups.set(day, dayEntries);
  }

  const parts = [
    `<h2>${escapeHtml(title)}</h2>`,
  ];
  if (startsAtTo) {
    const period = `${formatDate(now, locale, timeZone)} – ${formatDate(new Date(startsAtTo), locale, timeZone)}`;
    parts.push(`<footer>${escapeHtml(labels.period)} · ${escapeHtml(period)}</footer>`);
  }

  for (const [day, dayEntries] of groups) {
    parts.push(`<h3>${escapeHtml(formatDayHeading(day, locale))}</h3><table compact>`);
    for (const entry of dayEntries) parts.push(formatEntryRows(entry, language, locale, timeZone, texts));
    parts.push('</table>');
  }

  if (entries.length === 0) parts.push(`<p>${escapeHtml(emptyText)}</p>`);
  if (actionsHtml) parts.push(actionsHtml);
  if (footerHtml) parts.push(`<footer>${footerHtml}</footer>`);
  parts.push(`<footer>${escapeHtml(labels.generated)}: ${escapeHtml(formatDateTime(now, locale, timeZone))}</footer>`);
  return { html: parts.join('') };
}

function formatEntryRows(
  entry: CalendarRichEntry,
  language: string,
  locale: string,
  timeZone: string,
  texts: ReturnType<typeof createTelegramI18n>,
): string {
  const labels = calendarLabels[normalizeBotLanguage(language, 'ca')];
  const range = entry.kind === 'venue' && entry.allDay
    ? texts.calendar.allDay
    : `${formatTime(entry.startsAt, locale, timeZone)}–${formatTime(entry.endsAt, locale, timeZone)}`;
  const activity = entry.kind === 'schedule'
    ? `<a href="${escapeHtml(buildTelegramStartUrl(`schedule_event_${entry.id}`))}"><b>${escapeHtml(entry.title)}</b></a>`
    : `<b>${escapeHtml(entry.title)}</b>`;
  const details = entry.kind === 'schedule' && entry.hasDetails
    ? ` · <a href="${escapeHtml(buildTelegramStartUrl(`schedule_details_${entry.id}`))}">${escapeHtml(texts.schedule.detailsButton)}</a>`
    : '';
  const detailParts = entry.kind === 'schedule'
    ? [
        entry.tableName,
        entry.attendanceMode === 'open'
          ? `${entry.availableSeats}/${entry.capacity} ${labels.free}`
          : `${entry.capacity}p`,
        entry.attendanceMode === 'open' ? texts.schedule.openDetailTag : texts.schedule.closedDetailTag,
      ]
    : [labels.venue];
  const detailHtml = detailParts.filter((part): part is string => Boolean(part)).map(escapeHtml).join(' · ');
  const description = !entry.description || (entry.kind === 'schedule' && entry.hasDetails)
    ? ''
    : entry.kind === 'schedule'
      ? ` · ${formatScheduleDescriptionSummary({ description: entry.description, eventId: entry.id, language })}`
      : ` · <i>${escapeHtml(entry.description)}</i>`;
  const equipment = entry.equipmentNames?.length
    ? ` · ${escapeHtml(texts.schedule.detailsEquipment)}: ${escapeHtml(entry.equipmentNames.join(', '))}`
    : '';
  const venueImpact = entry.venueImpactText ? ` · ${escapeHtml(entry.venueImpactText)}` : '';

  return `<tr><td align="left" valign="top">${escapeHtml(range)}</td><td align="left" valign="top">${activity}</td></tr><tr><td></td><td>${detailHtml}${equipment}${details}${description}${venueImpact}</td></tr>`;
}

function getDayKey(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatDayHeading(day: string, locale: string): string {
  const [year = 1970, month = 1, date = 1] = day.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, date, 12));
  // The day key already represents the entry's local date; do not shift it again.
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(value);
  const monthName = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(value);
  return `${weekday.charAt(0).toLocaleUpperCase(locale)}${weekday.slice(1)} ${date} ${monthName}`;
}

function formatDate(date: Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium' }).format(date);
}

function formatDateTime(date: Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function formatTime(value: string, locale: string, timeZone: string): string {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  const hour = Number(values.hour);
  const minute = values.minute;
  return minute === '00' ? `${hour}h` : `${hour}:${minute}`;
}

function resolveLocale(language: string): string {
  return language === 'ca' ? 'ca-ES' : language === 'es' ? 'es-ES' : language;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
