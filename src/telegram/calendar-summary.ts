import { createDatabaseScheduleRepository } from '../schedule/schedule-catalog-store.js';
import { getScheduleEventEndsAt, listScheduleEvents, type ScheduleEventRecord, type ScheduleRepository } from '../schedule/schedule-catalog.js';
import { createDatabaseVenueEventRepository } from '../venue-events/venue-event-catalog-store.js';
import { listVenueEvents, type VenueEventRecord, type VenueEventRepository } from '../venue-events/venue-event-catalog.js';
import { createDatabaseClubTableRepository } from '../tables/table-catalog-store.js';
import type { ClubTableRepository } from '../tables/table-catalog.js';
import { buildTelegramStartUrl } from './deep-links.js';

export type CalendarEntry =
  | {
      id: number;
      kind: 'schedule';
      startsAt: string;
      endsAt: string;
      title: string;
      description: string | null;
      tableName: string | null;
      capacity: number;
    }
  | {
      kind: 'venue';
      startsAt: string;
      endsAt: string;
      title: string;
      description: string | null;
      allDay: boolean;
    };

export async function loadUpcomingCalendarEntries({
  database,
  now = new Date(),
  scheduleRepository,
  venueEventRepository,
  tableRepository,
}: {
  database: unknown;
  now?: Date;
  scheduleRepository?: ScheduleRepository;
  venueEventRepository?: VenueEventRepository;
  tableRepository?: ClubTableRepository;
}): Promise<CalendarEntry[]> {
  const startsAtFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();

  const [scheduleEvents, venueEvents] = await Promise.all([
    listScheduleEvents({ repository: scheduleRepository ?? createDatabaseScheduleRepository({ database: database as never }), includeCancelled: false, startsAtFrom }),
    listVenueEvents({ repository: venueEventRepository ?? createDatabaseVenueEventRepository({ database: database as never }), includeCancelled: false, startsAtFrom }),
  ]);

  const tableNames = new Map<number, string | null>();
  const scheduleEntries = await Promise.all(
    scheduleEvents.map(async (event) => {
      const tableName = event.tableId ? await loadTableName(database, tableRepository, tableNames, event.tableId) : null;
      return {
        id: event.id,
        kind: 'schedule' as const,
        startsAt: event.startsAt,
        endsAt: getScheduleEventEndsAt(event),
        title: event.title,
        description: event.description,
        tableName,
        capacity: event.capacity,
      };
    }),
  );

  const venueEntries = venueEvents.map((event) => ({
    kind: 'venue' as const,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    title: event.name,
    description: event.description,
    allDay: isAllDayVenueEvent(event),
  }));

  return [...scheduleEntries, ...venueEntries].sort((left, right) => {
    const byStart = new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime();
    if (byStart !== 0) return byStart;
    return left.kind.localeCompare(right.kind);
  });
}

export function formatCalendarMessage(entries: CalendarEntry[], language: string): string {
  const rows: string[] = [];
  let currentDay: string | null = null;

  for (const entry of entries) {
    const dayKey = entry.startsAt.slice(0, 10);
    if (dayKey !== currentDay) {
      currentDay = dayKey;
      rows.push('');
      rows.push(`<b>${escapeHtml(formatCalendarDayHeader(dayKey, language))}</b>`);
    }
    rows.push(formatCalendarEntry(entry));
  }

  return rows.join('\n');
}

function formatCalendarEntry(entry: CalendarEntry): string {
  const descriptionLine = entry.description ? `\n  <i>${escapeHtml(entry.description)}</i>` : '';

  if (entry.kind === 'schedule') {
    const tableSuffix = entry.tableName ? ` · Taula ${escapeHtml(entry.tableName)}` : '';
    return `- ${formatTimeRange(entry.startsAt, entry.endsAt)} <a href="${escapeHtml(buildTelegramStartUrl(`schedule_event_${entry.id}`))}"><b>${escapeHtml(entry.title)}</b></a> · ${entry.capacity}p${tableSuffix}${descriptionLine}`;
  }

  if (entry.allDay) {
    return `- Tot el dia ${escapeHtml(entry.title)}${descriptionLine}`;
  }

  return `- ${formatTimeRange(entry.startsAt, entry.endsAt)} ${escapeHtml(entry.title)}${descriptionLine}`;
}

function formatCalendarDayHeader(dayKey: string, language: string): string {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  const weekday = new Intl.DateTimeFormat(resolveLanguageLocale(language), { weekday: 'long', timeZone: 'UTC' }).format(date);
  const month = new Intl.DateTimeFormat(resolveLanguageLocale(language), { month: 'long', timeZone: 'UTC' }).format(date);
  return `${capitalizeFirstLetter(weekday)} ${date.getUTCDate()} ${month}`;
}

function formatTimeRange(startsAt: string, endsAt: string): string {
  return `${formatShortTime(startsAt)}-${formatShortTime(endsAt)}`;
}

function formatShortTime(value: string): string {
  const date = new Date(value);
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return minutes === '00' ? `${Number(hours)}h` : `${hours}:${minutes}`;
}

async function loadTableName(
  database: unknown,
  tableRepository: ClubTableRepository | undefined,
  cache: Map<number, string | null>,
  tableId: number,
): Promise<string | null> {
  if (cache.has(tableId)) return cache.get(tableId) ?? null;
  const repository = tableRepository ?? createDatabaseClubTableRepository({ database: database as never });
  const table = await repository.findTableById(tableId);
  const name = table?.displayName ?? null;
  cache.set(tableId, name);
  return name;
}

function isAllDayVenueEvent(event: VenueEventRecord): boolean {
  const starts = new Date(event.startsAt);
  const ends = new Date(event.endsAt);
  return starts.getUTCHours() === 0 && starts.getUTCMinutes() === 0 && ends.getUTCHours() === 0 && ends.getUTCMinutes() === 0 && ends.getTime() - starts.getTime() === 24 * 60 * 60 * 1000;
}

function resolveLanguageLocale(language: string): string {
  return language === 'ca' ? 'ca-ES' : language;
}

function capitalizeFirstLetter(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
