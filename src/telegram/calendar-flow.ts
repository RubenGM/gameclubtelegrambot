import { createDatabaseScheduleRepository } from '../schedule/schedule-catalog-store.js';
import { getScheduleEventEndsAt, listScheduleEvents, type ScheduleEventRecord, type ScheduleRepository } from '../schedule/schedule-catalog.js';
import { createDatabaseVenueEventRepository } from '../venue-events/venue-event-catalog-store.js';
import { listVenueEvents, type VenueEventRecord, type VenueEventRepository } from '../venue-events/venue-event-catalog.js';
import { createDatabaseClubTableRepository } from '../tables/table-catalog-store.js';
import type { ClubTableRepository } from '../tables/table-catalog.js';
import type { AuthorizationService } from '../authorization/service.js';
import type { TelegramActor } from './actor-store.js';
import type { TelegramChatContext } from './chat-context.js';
import type { ConversationSessionRecord } from './conversation-session.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import { resolveTelegramActionMenu } from './action-menu.js';
import { createTelegramI18n } from './i18n.js';
import { buildTelegramStartUrl } from './deep-links.js';

export const calendarLabels = {
  openMenu: 'Calendari',
} as const;

export interface TelegramCalendarContext {
  messageText?: string | undefined;
  reply(message: string, options?: TelegramReplyOptions): Promise<unknown>;
  runtime: {
    actor: TelegramActor;
    authorization: AuthorizationService;
    session: { current: ConversationSessionRecord | null };
    chat: TelegramChatContext;
    services: {
      database: {
        db: unknown;
      };
    };
    bot: {
      publicName: string;
      clubName: string;
      language?: string;
    };
  };
  scheduleRepository?: ScheduleRepository;
  venueEventRepository?: VenueEventRepository;
  tableRepository?: ClubTableRepository;
  now?: Date;
}

export async function handleTelegramCalendarText(context: TelegramCalendarContext): Promise<boolean> {
  const text = context.messageText?.trim();
  if (!text || context.runtime.chat.kind !== 'private' || !context.runtime.actor.isApproved || context.runtime.actor.isBlocked) {
    return false;
  }

  if (text === createTelegramI18n(resolveBotLanguage(context) as 'ca' | 'es' | 'en').actionMenu.calendar || text === calendarLabels.openMenu || text === '/calendar') {
    await replyWithCalendar(context);
    return true;
  }

  return false;
}

async function replyWithCalendar(context: TelegramCalendarContext): Promise<void> {
  const events = await loadUpcomingCalendarEntries(context);
  if (events.length === 0) {
    await context.reply(createTelegramI18n(resolveBotLanguage(context) as 'ca' | 'es' | 'en').calendar.noEvents, buildCalendarMenuOptions(context));
    return;
  }

  await context.reply(formatCalendarMessage(events, resolveBotLanguage(context)), buildCalendarReplyOptions(context));
}

async function loadUpcomingCalendarEntries(context: TelegramCalendarContext): Promise<CalendarEntry[]> {
  const now = context.now ?? new Date();
  const startsAtFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();

  const [scheduleEvents, venueEvents] = await Promise.all([
    listScheduleEvents({ repository: resolveScheduleRepository(context), includeCancelled: false, startsAtFrom }),
    listVenueEvents({ repository: resolveVenueEventRepository(context), includeCancelled: false, startsAtFrom }),
  ]);

  const tableNames = new Map<number, string | null>();
  const scheduleEntries = await Promise.all(
    scheduleEvents.map(async (event) => {
      const tableName = event.tableId ? await loadTableName(context, event.tableId, tableNames) : null;
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

function formatCalendarMessage(entries: CalendarEntry[], language: string): string {
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

function buildCalendarMenuOptions(context: TelegramCalendarContext): TelegramReplyOptions {
  return (
    resolveTelegramActionMenu({
      context: {
        actor: context.runtime.actor,
        authorization: context.runtime.authorization,
        chat: context.runtime.chat,
        session: context.runtime.session.current,
        language: resolveBotLanguage(context) as 'ca' | 'es' | 'en',
      },
    }) ?? {
      replyKeyboard: [['/start', '/help', createTelegramI18n(resolveBotLanguage(context) as 'ca' | 'es' | 'en').actionMenu.language]],
      resizeKeyboard: true,
      persistentKeyboard: true,
    }
  );
}

function buildCalendarReplyOptions(context: TelegramCalendarContext): TelegramReplyOptions {
  return {
    ...buildCalendarMenuOptions(context),
    parseMode: 'HTML',
  };
}

function resolveScheduleRepository(context: TelegramCalendarContext): ScheduleRepository {
  if (context.scheduleRepository) return context.scheduleRepository;
  return createDatabaseScheduleRepository({ database: context.runtime.services.database.db as never });
}

function resolveVenueEventRepository(context: TelegramCalendarContext): VenueEventRepository {
  if (context.venueEventRepository) return context.venueEventRepository;
  return createDatabaseVenueEventRepository({ database: context.runtime.services.database.db as never });
}

function resolveTableRepository(context: TelegramCalendarContext): ClubTableRepository {
  if (context.tableRepository) return context.tableRepository;
  return createDatabaseClubTableRepository({ database: context.runtime.services.database.db as never });
}

async function loadTableName(
  context: TelegramCalendarContext,
  tableId: number,
  cache: Map<number, string | null>,
): Promise<string | null> {
  if (cache.has(tableId)) return cache.get(tableId) ?? null;
  const table = await resolveTableRepository(context).findTableById(tableId);
  const name = table?.displayName ?? null;
  cache.set(tableId, name);
  return name;
}

function isAllDayVenueEvent(event: VenueEventRecord): boolean {
  const starts = new Date(event.startsAt);
  const ends = new Date(event.endsAt);
  return starts.getUTCHours() === 0 && starts.getUTCMinutes() === 0 && ends.getUTCHours() === 0 && ends.getUTCMinutes() === 0 && ends.getTime() - starts.getTime() === 24 * 60 * 60 * 1000;
}

function resolveBotLanguage(context: TelegramCalendarContext): string {
  return context.runtime.bot.language ?? 'ca';
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
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

interface CalendarEntryBase {
  startsAt: string;
  endsAt: string;
  title: string;
  description: string | null;
}

type CalendarEntry =
  | (CalendarEntryBase & { id: number; kind: 'schedule'; tableName: string | null; capacity: number })
  | (CalendarEntryBase & { kind: 'venue'; allDay: boolean });
