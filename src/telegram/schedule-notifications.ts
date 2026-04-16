import { formatCalendarMessage, loadUpcomingCalendarEntries } from './calendar-summary.js';
import { escapeHtml, formatDayHeading } from './schedule-presentation.js';
import { detectScheduleConflicts, getScheduleEventEndsAt, type ScheduleEventRecord, type ScheduleRepository } from '../schedule/schedule-catalog.js';
import type { ClubTableRepository } from '../tables/table-catalog.js';
import type { VenueEventRepository } from '../venue-events/venue-event-catalog.js';
import type { NewsGroupRepository } from '../news/news-group-catalog.js';

export interface ScheduleCalendarChange {
  action: 'created' | 'updated' | 'deleted';
  event: ScheduleEventRecord;
}

export async function notifyScheduleConflicts({
  eventId,
  actorTelegramUserId,
  scheduleRepository,
  loadEvent,
  sendPrivateMessage,
}: {
  eventId: number;
  actorTelegramUserId: number;
  scheduleRepository: ScheduleRepository;
  loadEvent: (eventId: number) => Promise<ScheduleEventRecord>;
  sendPrivateMessage: (telegramUserId: number, message: string) => Promise<void>;
}): Promise<void> {
  const conflicts = await detectScheduleConflicts({
    repository: scheduleRepository,
    eventId,
    actorTelegramUserId,
  });

  if (conflicts.overlappingEventIds.length === 0) {
    return;
  }

  const subjectEvent = await loadEvent(eventId);
  const overlappingEvents = await Promise.all(conflicts.overlappingEventIds.map((id) => loadEvent(id)));
  const overlapSummary = overlappingEvents
    .map((event) => `${event.title} (${event.startsAt.slice(0, 16).replace('T', ' ')} - ${getScheduleEventEndsAt(event).slice(0, 16).replace('T', ' ')})`)
    .join('\n- ');

  await Promise.all(
    conflicts.impactedTelegramUserIds.map((telegramUserId) =>
      sendPrivateMessage(
        telegramUserId,
        [
          'S ha detectat un possible conflicte amb les teves reserves del club.',
          `Nova activitat o canvi: ${subjectEvent.title} (${subjectEvent.startsAt.slice(0, 16).replace('T', ' ')} - ${getScheduleEventEndsAt(subjectEvent).slice(0, 16).replace('T', ' ')})`,
          `Altres activitats afectades:\n- ${overlapSummary}`,
          'El bot no ha bloquejat la reserva. Si us plau, coordina-t hi manualment amb la resta de persones implicades.',
        ].join('\n'),
      ),
    ),
  );
}

export async function publishCalendarSnapshotToNewsGroups({
  change,
  sendGroupMessage,
  newsGroupRepository,
  database,
  botLanguage,
  scheduleRepository,
  venueEventRepository,
  tableRepository,
  resolveActorDisplayName,
}: {
  change: ScheduleCalendarChange;
  sendGroupMessage?: (chatId: number, message: string, options?: { parseMode?: 'HTML' }) => Promise<void>;
  newsGroupRepository: NewsGroupRepository;
  database: unknown;
  botLanguage?: string;
  scheduleRepository?: ScheduleRepository;
  venueEventRepository?: VenueEventRepository;
  tableRepository?: ClubTableRepository;
  resolveActorDisplayName: () => Promise<string>;
}): Promise<void> {
  if (!sendGroupMessage) {
    return;
  }

  const groups = await newsGroupRepository.listGroups({ includeDisabled: false });
  if (groups.length === 0) {
    return;
  }

  const entries = await loadUpcomingCalendarEntries({
    database,
    ...(scheduleRepository ? { scheduleRepository } : {}),
    ...(venueEventRepository ? { venueEventRepository } : {}),
    ...(tableRepository ? { tableRepository } : {}),
  });
  const message = entries.length > 0
    ? `Calendari actualitzat:\n${formatCalendarMessage(entries, botLanguage ?? 'ca')}`
    : 'Calendari actualitzat: no hi ha activitats ni esdeveniments propers ara mateix.';
  const footer = await formatCalendarBroadcastFooter({
    change,
    resolveActorDisplayName,
  });

  await Promise.all(
    groups.map(async (group) => {
      try {
        await sendGroupMessage(group.chatId, `${message}\n\n${footer}`, { parseMode: 'HTML' });
      } catch {
        // La notificació de grup no ha de bloquejar l'edició de l'activitat.
      }
    }),
  );
}

async function formatCalendarBroadcastFooter({
  change,
  resolveActorDisplayName,
}: {
  change: ScheduleCalendarChange;
  resolveActorDisplayName: () => Promise<string>;
}): Promise<string> {
  const userName = await resolveActorDisplayName();
  const actionLabel =
    change.action === 'created'
      ? 'creado'
      : change.action === 'updated'
        ? 'actualizado'
        : 'eliminado';

  return `<i>${escapeHtml(userName)} ha ${actionLabel} la actividad ${escapeHtml(change.event.title)} del ${escapeHtml(formatDayHeading(change.event.startsAt.slice(0, 10)))}</i>`;
}
