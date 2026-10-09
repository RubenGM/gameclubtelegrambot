import type { ClubEquipmentRecord } from '../equipment/equipment-catalog.js';
import { getScheduleEventEndsAt, type ScheduleEventRecord } from '../schedule/schedule-catalog.js';
import type { ClubTableRecord } from '../tables/table-catalog.js';

export interface ScheduleResourceAvailabilityItem {
  id: number;
  displayName: string;
  busy: boolean;
  conflictingEventIds: number[];
}

export interface ScheduleResourceAvailability {
  tables: ScheduleResourceAvailabilityItem[];
  equipment: ScheduleResourceAvailabilityItem[];
}

export function buildScheduleResourceAvailability({
  startsAt,
  durationMinutes,
  tables,
  equipment,
  events,
  excludeEventId,
}: {
  startsAt: string;
  durationMinutes: number;
  tables: ClubTableRecord[];
  equipment: ClubEquipmentRecord[];
  events: ScheduleEventRecord[];
  excludeEventId?: number;
}): ScheduleResourceAvailability | null {
  const draftStart = new Date(startsAt).getTime();
  if (!Number.isFinite(draftStart) || !Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    return null;
  }
  const draftEnd = draftStart + durationMinutes * 60_000;
  if (!Number.isFinite(draftEnd) || draftEnd <= draftStart) {
    return null;
  }

  const overlappingEvents = events.filter((event) => {
    if (event.lifecycleStatus !== 'scheduled' || event.id === excludeEventId) {
      return false;
    }

    const eventStart = new Date(event.startsAt).getTime();
    let eventEnd: number;
    try {
      eventEnd = new Date(getScheduleEventEndsAt(event)).getTime();
    } catch {
      return false;
    }
    return Number.isFinite(eventStart)
      && Number.isFinite(eventEnd)
      && eventEnd > eventStart
      && intervalsOverlap(draftStart, draftEnd, eventStart, eventEnd);
  });

  return {
    tables: tables
      .filter((table) => table.lifecycleStatus === 'active')
      .map((table) => {
        const conflictingEventIds = overlappingEvents
          .filter((event) => event.isPriority === true || event.tableId === table.id)
          .map((event) => event.id)
          .sort((left, right) => left - right);
        return {
          id: table.id,
          displayName: table.displayName,
          busy: conflictingEventIds.length > 0,
          conflictingEventIds,
        };
      }),
    equipment: equipment
      .filter((item) => item.lifecycleStatus === 'active')
      .map((item) => {
        const conflictingEventIds = overlappingEvents
          .filter((event) => event.isPriority === true || (event.equipmentIds ?? []).includes(item.id))
          .map((event) => event.id)
          .sort((left, right) => left - right);
        return {
          id: item.id,
          displayName: item.displayName,
          busy: conflictingEventIds.length > 0,
          conflictingEventIds,
        };
      }),
  };
}

function intervalsOverlap(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): boolean {
  return leftStart < rightEnd && rightStart < leftEnd;
}
