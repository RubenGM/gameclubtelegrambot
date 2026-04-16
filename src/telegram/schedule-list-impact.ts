import { buildTelegramStartUrl } from './deep-links.js';
import type { ScheduleEventRecord } from '../schedule/schedule-catalog.js';
import type { VenueEventRecord } from '../venue-events/venue-event-catalog.js';
import {
  escapeHtml,
  formatDayHeading,
  formatEventTime,
  formatParticipantCount,
  groupScheduleEventsByDay,
  sortScheduleEvents,
} from './schedule-presentation.js';

export async function formatScheduleListWithVenueImpact({
  events,
  loadAttendance,
  loadRelevantVenueEvents,
}: {
  events: ScheduleEventRecord[];
  loadAttendance: (eventId: number) => Promise<{ occupiedSeats: number; capacity: number }>;
  loadRelevantVenueEvents: (event: ScheduleEventRecord) => Promise<VenueEventRecord[]>;
}): Promise<string> {
  const lines: string[] = [];
  const groupedEvents = groupScheduleEventsByDay(sortScheduleEvents(events));

  for (const [dayKey, dayEvents] of groupedEvents) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(`<b>${formatDayHeading(dayKey)}</b>`);
    for (const event of dayEvents) {
      const attendance = await loadAttendance(event.id);
      lines.push(`- <a href="${escapeHtml(buildTelegramStartUrl(`schedule_event_${event.id}`))}"><b>${escapeHtml(event.title)}</b></a> (${formatEventTime(event.startsAt)}) · ${formatParticipantCount(attendance.occupiedSeats, attendance.capacity)}`);
      if (event.description) {
        lines.push(`  <i>${escapeHtml(event.description)}</i>`);
      }
      const relevantVenueEvents = await loadRelevantVenueEvents(event);
      if (relevantVenueEvents.length > 0) {
        const summary = relevantVenueEvents
          .map((venueEvent) => `${escapeHtml(venueEvent.name)} (ocupacio ${escapeHtml(venueEvent.occupancyScope)}, impacte ${escapeHtml(venueEvent.impactLevel)})`)
          .join(', ');
        lines.push(`  <b>Impacte local:</b> ${summary}`);
      }
    }
  }

  return lines.join('\n');
}
