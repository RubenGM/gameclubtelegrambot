import { listScheduleEvents, type ScheduleRepository } from '../schedule/schedule-catalog.js';
import { listVenueEvents, type VenueEventRepository } from '../venue-events/venue-event-catalog.js';
import { normalizeBotLanguage, type BotLanguage } from './i18n.js';
import { escapeHtml } from './schedule-presentation.js';

export async function buildTodayAtClubSummary({
  language,
  now = new Date(),
  scheduleRepository,
  venueEventRepository,
}: {
  language: string;
  now?: Date;
  scheduleRepository: ScheduleRepository;
  venueEventRepository: VenueEventRepository;
}): Promise<string> {
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
    return lines.join('\n');
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

  return lines.join('\n');
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
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}
