import {
  getScheduleEventAttendance,
  getScheduleEventEndsAt,
  type ScheduleEventRecord,
  type ScheduleRepository,
} from '../schedule/schedule-catalog.js';
import type { VenueEventRecord, VenueEventRepository } from './venue-event-catalog.js';

export interface VenueEventImpactSignal {
  venueEventId: number;
  changeType: 'created' | 'updated' | 'cancelled';
  impactedTelegramUserIds: number[];
  affectedScheduleEventIds: number[];
  affectedScheduleEvents: ScheduleEventRecord[];
  venueEvent: VenueEventRecord;
}

export async function buildVenueEventImpactSignal({
  venueEventRepository,
  scheduleRepository,
  venueEventId,
  changeType,
  actorTelegramUserId,
}: {
  venueEventRepository: VenueEventRepository;
  scheduleRepository: ScheduleRepository;
  venueEventId: number;
  changeType: 'created' | 'updated' | 'cancelled';
  actorTelegramUserId: number;
}): Promise<VenueEventImpactSignal> {
  const venueEvent = await venueEventRepository.findVenueEventById(venueEventId);
  if (!venueEvent) {
    throw new Error(`Venue event ${venueEventId} not found`);
  }

  const scheduleEvents = await scheduleRepository.listEvents({ includeCancelled: false });
  const affectedScheduleEvents: ScheduleEventRecord[] = [];
  const impactedUsers = new Set<number>();

  for (const scheduleEvent of scheduleEvents) {
    if (!eventsOverlap(venueEvent, scheduleEvent)) {
      continue;
    }

    affectedScheduleEvents.push(scheduleEvent);
    impactedUsers.add(scheduleEvent.organizerTelegramUserId);

    const attendance = await getScheduleEventAttendance({ repository: scheduleRepository, eventId: scheduleEvent.id });
    for (const telegramUserId of attendance.activeParticipantTelegramUserIds) {
      impactedUsers.add(telegramUserId);
    }
  }

  impactedUsers.delete(actorTelegramUserId);

  return {
    venueEventId,
    changeType,
    venueEvent,
    affectedScheduleEventIds: affectedScheduleEvents.map((event) => event.id),
    affectedScheduleEvents,
    impactedTelegramUserIds: Array.from(impactedUsers).sort((left, right) => left - right),
  };
}

function eventsOverlap(
  venueEvent: Pick<VenueEventRecord, 'startsAt' | 'endsAt'>,
  scheduleEvent: Pick<ScheduleEventRecord, 'startsAt' | 'durationMinutes'>,
): boolean {
  const venueStartsAt = new Date(venueEvent.startsAt).getTime();
  const venueEndsAt = new Date(venueEvent.endsAt).getTime();
  const scheduleStartsAt = new Date(scheduleEvent.startsAt).getTime();
  const scheduleEndsAt = new Date(getScheduleEventEndsAt(scheduleEvent)).getTime();

  return venueStartsAt < scheduleEndsAt && scheduleStartsAt < venueEndsAt;
}
