import type { ClubTableRepository } from '../tables/table-catalog.js';
import type { ClubEquipmentRepository } from '../equipment/equipment-catalog.js';
import { renderCalendarRichTable, type CalendarRichTableEntry } from './calendar-rich-message.js';
import { getScheduleEventEndsAt, listScheduleEvents, type ScheduleRepository } from '../schedule/schedule-catalog.js';
import { listVenueEvents, type VenueEventRepository } from '../venue-events/venue-event-catalog.js';
import { normalizeBotLanguage, type BotLanguage } from './i18n.js';
import { escapeHtml } from './schedule-presentation.js';

export async function buildTodayAtClubPresentation({
  language,
  now = new Date(),
  scheduleRepository,
  venueEventRepository,
  tableRepository,
  equipmentRepository,
}: {
  language: string;
  now?: Date;
  scheduleRepository: ScheduleRepository;
  venueEventRepository: VenueEventRepository;
  tableRepository?: ClubTableRepository;
  equipmentRepository?: ClubEquipmentRepository;
}): Promise<{ message: string; richHtml: string }> {
  const texts = todayAtClubTexts[normalizeBotLanguage(language, 'ca')];
  const startsAtFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const startsAtTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - 1).toISOString();

  const [scheduleEvents, venueEvents] = await Promise.all([
    listScheduleEvents({ repository: scheduleRepository, includeCancelled: false, startsAtFrom, startsAtTo }),
    listVenueEvents({ repository: venueEventRepository, includeCancelled: false, startsAtFrom, endsAtTo: startsAtTo }),
  ]);

  const todayVenueEvents = venueEvents.filter((event) => event.endsAt >= startsAtFrom && event.startsAt <= startsAtTo);
  const lines = [`<b>${texts.title}</b>`];

  if (scheduleEvents.length === 0 && todayVenueEvents.length === 0) {
    lines.push(texts.empty);
    return { message: lines.join('\n'), richHtml: `<h3>${texts.title}</h3><p>${texts.empty}</p>` };
  }

  if (scheduleEvents.length > 0) {
    lines.push(`<b>${texts.activities}</b>`);
    for (const event of scheduleEvents) {
      lines.push(`- ${formatShortTime(event.startsAt)} ${escapeHtml(event.title)}`);
    }
  }

  if (todayVenueEvents.length > 0) {
    lines.push(`<b>${texts.venue}</b>`);
    for (const event of todayVenueEvents) {
      lines.push(`- ${formatShortTime(event.startsAt)}-${formatShortTime(event.endsAt)} ${escapeHtml(event.name)}`);
    }
  }

  const entries: CalendarRichTableEntry[] = await Promise.all(scheduleEvents.map(async (event) => {
    const [table, equipment] = await Promise.all([
      event.tableId && tableRepository ? tableRepository.findTableById(event.tableId) : null,
      Promise.all((event.equipmentIds ?? []).map(async (id) => equipmentRepository?.findEquipmentById(id))),
    ]);
    return { kind: 'schedule' as const, id: event.id, title: event.title, description: event.description,
      startsAt: event.startsAt, endsAt: getScheduleEventEndsAt(event), tableName: table?.displayName ?? null,
      equipmentNames: equipment.flatMap((item) => item ? [item.displayName] : []),
      attendanceMode: event.attendanceMode, isPublic: event.isPublic, capacity: event.capacity,
      hasDetails: event.detailsMessageChatId !== null && event.detailsMessageId !== null };
  }));
  entries.push(...todayVenueEvents.map((event) => ({ kind: 'venue' as const, title: event.name,
    startsAt: event.startsAt, endsAt: event.endsAt, description: event.description, allDay: false })));
  entries.sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  return { message: lines.join('\n'), richHtml: `<h3>${texts.title}</h3>${renderCalendarRichTable(entries, language)}` };
}

const todayAtClubTexts: Record<BotLanguage, { title: string; activities: string; venue: string; empty: string }> = {
  ca: {
    title: 'Avui al club',
    activities: 'Activitats:',
    venue: 'Local:',
    empty: 'Avui no hi ha activitats ni esdeveniments del local registrats.',
  },
  es: {
    title: 'Hoy en el club',
    activities: 'Actividades:',
    venue: 'Local:',
    empty: 'Hoy no hay actividades ni eventos del local registrados.',
  },
  en: {
    title: 'Today at the club',
    activities: 'Activities:',
    venue: 'Venue:',
    empty: 'There are no activities or venue events registered for today.',
  },
};

function formatShortTime(value: string): string {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export async function buildTodayAtClubSummary(input: Parameters<typeof buildTodayAtClubPresentation>[0]): Promise<string> {
  return (await buildTodayAtClubPresentation(input)).message;
}
