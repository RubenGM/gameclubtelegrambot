import { buildTelegramStartUrl } from './deep-links.js';
import type { ScheduleEventRecord } from '../schedule/schedule-catalog.js';
import type { VenueEventRecord } from '../venue-events/venue-event-catalog.js';
import {
  escapeHtml,
  formatDayHeading,
  formatEventTimeRange,
  groupScheduleEventsByDay,
  sortScheduleEvents,
} from './schedule-presentation.js';

export async function formatScheduleListWithVenueImpact({
  events,
  language = 'ca',
  loadAttendance,
  loadTableName,
  loadRelevantVenueEvents,
}: {
  events: ScheduleEventRecord[];
  language?: string;
  loadAttendance: (eventId: number) => Promise<{ occupiedSeats: number; capacity: number; availableSeats: number }>;
  loadTableName: (event: ScheduleEventRecord) => Promise<string | null>;
  loadRelevantVenueEvents: (event: ScheduleEventRecord) => Promise<VenueEventRecord[]>;
}): Promise<string> {
  const lines: string[] = [];
  const groupedEvents = groupScheduleEventsByDay(sortScheduleEvents(events));

  for (const [dayKey, dayEvents] of groupedEvents) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(`<b>${formatDayHeading(dayKey, language)}</b>`);
    for (const event of dayEvents) {
      const attendance = await loadAttendance(event.id);
      const attendanceSummary = event.attendanceMode === 'open'
        ? `${event.capacity}p (${attendance.availableSeats} libres)`
        : `${event.capacity}p`;
      const modeSummary = event.attendanceMode === 'open' ? ' · Mesa abierta' : '';
      const tableName = await loadTableName(event);
      const tableSummary = tableName ? ` · ${escapeHtml(tableName)}` : '';
      lines.push(`- ${formatEventTimeRange(event.startsAt, event.durationMinutes)} <a href="${escapeHtml(buildTelegramStartUrl(`schedule_event_${event.id}`))}"><b>${escapeHtml(event.title)}</b></a>${modeSummary} · ${attendanceSummary}${tableSummary}`);
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
