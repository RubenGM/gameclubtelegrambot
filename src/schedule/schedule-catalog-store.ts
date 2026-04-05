import { and, asc, eq, gte, lte } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { scheduleEventParticipants, scheduleEvents } from '../infrastructure/database/schema.js';
import type { ScheduleEventRecord, ScheduleParticipantRecord, ScheduleRepository } from './schedule-catalog.js';

export function createDatabaseScheduleRepository({
  database,
}: {
  database: DatabaseConnection['db'];
}): ScheduleRepository {
  return {
    async createEvent(input) {
      const created = await database
        .insert(scheduleEvents)
        .values({
          title: input.title,
          description: input.description,
          startsAt: new Date(input.startsAt),
          durationMinutes: input.durationMinutes,
          organizerTelegramUserId: input.organizerTelegramUserId,
          createdByTelegramUserId: input.createdByTelegramUserId,
          tableId: input.tableId,
          capacity: input.capacity,
        })
        .returning();

      const row = created[0];
      if (!row) {
        throw new Error('Schedule event insert did not return a row');
      }

      return mapScheduleEventRow(row);
    },
    async findEventById(eventId) {
      const result = await database.select().from(scheduleEvents).where(eq(scheduleEvents.id, eventId));
      const row = result[0];
      return row ? mapScheduleEventRow(row) : null;
    },
    async listEvents({ includeCancelled, startsAtFrom, startsAtTo }) {
      const filters = [];
      if (!includeCancelled) {
        filters.push(eq(scheduleEvents.lifecycleStatus, 'scheduled'));
      }
      if (startsAtFrom) {
        filters.push(gte(scheduleEvents.startsAt, new Date(startsAtFrom)));
      }
      if (startsAtTo) {
        filters.push(lte(scheduleEvents.startsAt, new Date(startsAtTo)));
      }

      const query = database.select().from(scheduleEvents);
      const orderedQuery = filters.length > 0
        ? query.where(and(...filters)).orderBy(asc(scheduleEvents.startsAt))
        : query.orderBy(asc(scheduleEvents.startsAt));
      const result = await orderedQuery;

      return result.map(mapScheduleEventRow);
    },
    async updateEvent(input) {
      const updated = await database
        .update(scheduleEvents)
        .set({
          title: input.title,
          description: input.description,
          startsAt: new Date(input.startsAt),
          durationMinutes: input.durationMinutes,
          organizerTelegramUserId: input.organizerTelegramUserId,
          tableId: input.tableId,
          capacity: input.capacity,
          updatedAt: new Date(),
        })
        .where(eq(scheduleEvents.id, input.eventId))
        .returning();

      const row = updated[0];
      if (!row) {
        throw new Error(`Schedule event ${input.eventId} not found`);
      }

      return mapScheduleEventRow(row);
    },
    async cancelEvent({ eventId, actorTelegramUserId, reason }) {
      const now = new Date();
      const updated = await database
        .update(scheduleEvents)
        .set({
          lifecycleStatus: 'cancelled',
          updatedAt: now,
          cancelledAt: now,
          cancelledByTelegramUserId: actorTelegramUserId,
          cancellationReason: reason ?? null,
        })
        .where(eq(scheduleEvents.id, eventId))
        .returning();

      const row = updated[0];
      if (!row) {
        throw new Error(`Schedule event ${eventId} not found`);
      }

      return mapScheduleEventRow(row);
    },
    async findParticipant(eventId, participantTelegramUserId) {
      const result = await database
        .select()
        .from(scheduleEventParticipants)
        .where(
          and(
            eq(scheduleEventParticipants.scheduleEventId, eventId),
            eq(scheduleEventParticipants.participantTelegramUserId, participantTelegramUserId),
          ),
        );

      const row = result[0];
      return row ? mapScheduleParticipantRow(row) : null;
    },
    async listParticipants(eventId) {
      const result = await database
        .select()
        .from(scheduleEventParticipants)
        .where(eq(scheduleEventParticipants.scheduleEventId, eventId));

      return result.map(mapScheduleParticipantRow);
    },
    async upsertParticipant({ eventId, participantTelegramUserId, actorTelegramUserId, status }) {
      const now = new Date();
      const updated = await database
        .insert(scheduleEventParticipants)
        .values({
          scheduleEventId: eventId,
          participantTelegramUserId,
          status,
          addedByTelegramUserId: actorTelegramUserId,
          removedByTelegramUserId: status === 'removed' ? actorTelegramUserId : null,
          ...(status === 'removed' ? { leftAt: now } : {}),
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [scheduleEventParticipants.scheduleEventId, scheduleEventParticipants.participantTelegramUserId],
          set: {
            status,
            removedByTelegramUserId: status === 'removed' ? actorTelegramUserId : null,
            leftAt: status === 'removed' ? now : null,
            updatedAt: now,
          },
        })
        .returning();

      const row = updated[0];
      if (!row) {
        throw new Error(`Schedule participant ${participantTelegramUserId} for event ${eventId} not found`);
      }

      return mapScheduleParticipantRow(row);
    },
  };
}

function mapScheduleEventRow(row: typeof scheduleEvents.$inferSelect): ScheduleEventRecord {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    startsAt: row.startsAt.toISOString(),
    durationMinutes: row.durationMinutes,
    organizerTelegramUserId: row.organizerTelegramUserId,
    createdByTelegramUserId: row.createdByTelegramUserId,
    tableId: row.tableId,
    capacity: row.capacity,
    lifecycleStatus: row.lifecycleStatus as ScheduleEventRecord['lifecycleStatus'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelledByTelegramUserId: row.cancelledByTelegramUserId,
    cancellationReason: row.cancellationReason,
  };
}

function mapScheduleParticipantRow(
  row: typeof scheduleEventParticipants.$inferSelect,
): ScheduleParticipantRecord {
  return {
    scheduleEventId: row.scheduleEventId,
    participantTelegramUserId: row.participantTelegramUserId,
    status: row.status as ScheduleParticipantRecord['status'],
    addedByTelegramUserId: row.addedByTelegramUserId,
    removedByTelegramUserId: row.removedByTelegramUserId,
    joinedAt: row.joinedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    leftAt: row.leftAt?.toISOString() ?? null,
  };
}
