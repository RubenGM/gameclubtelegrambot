import { and, asc, eq, gte, lte } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { venueEvents } from '../infrastructure/database/schema.js';
import type { VenueEventRecord, VenueEventRepository } from './venue-event-catalog.js';

export function createDatabaseVenueEventRepository({
  database,
}: {
  database: DatabaseConnection['db'];
}): VenueEventRepository {
  return {
    async createVenueEvent(input) {
      const created = await database
        .insert(venueEvents)
        .values({
          name: input.name,
          description: input.description,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          occupancyScope: input.occupancyScope,
          impactLevel: input.impactLevel,
        })
        .returning();

      const row = created[0];
      if (!row) {
        throw new Error('Venue event insert did not return a row');
      }
      return mapVenueEventRow(row);
    },
    async findVenueEventById(eventId) {
      const result = await database.select().from(venueEvents).where(eq(venueEvents.id, eventId));
      const row = result[0];
      return row ? mapVenueEventRow(row) : null;
    },
    async listVenueEvents({ includeCancelled, startsAtFrom, endsAtTo }) {
      const filters = [];
      if (!includeCancelled) {
        filters.push(eq(venueEvents.lifecycleStatus, 'scheduled'));
      }
      if (startsAtFrom) {
        filters.push(gte(venueEvents.endsAt, new Date(startsAtFrom)));
      }
      if (endsAtTo) {
        filters.push(lte(venueEvents.startsAt, new Date(endsAtTo)));
      }

      const query = database.select().from(venueEvents);
      const result = filters.length > 0 ? await query.where(and(...filters)) : await query.orderBy(asc(venueEvents.startsAt));
      return result.map(mapVenueEventRow);
    },
    async updateVenueEvent(input) {
      const updated = await database
        .update(venueEvents)
        .set({
          name: input.name,
          description: input.description,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          occupancyScope: input.occupancyScope,
          impactLevel: input.impactLevel,
          updatedAt: new Date(),
        })
        .where(eq(venueEvents.id, input.eventId))
        .returning();

      const row = updated[0];
      if (!row) {
        throw new Error(`Venue event ${input.eventId} not found`);
      }
      return mapVenueEventRow(row);
    },
    async cancelVenueEvent({ eventId, reason }) {
      const now = new Date();
      const updated = await database
        .update(venueEvents)
        .set({
          lifecycleStatus: 'cancelled',
          cancelledAt: now,
          cancellationReason: reason ?? null,
          updatedAt: now,
        })
        .where(eq(venueEvents.id, eventId))
        .returning();

      const row = updated[0];
      if (!row) {
        throw new Error(`Venue event ${eventId} not found`);
      }
      return mapVenueEventRow(row);
    },
  };
}

function mapVenueEventRow(row: typeof venueEvents.$inferSelect): VenueEventRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    occupancyScope: row.occupancyScope as VenueEventRecord['occupancyScope'],
    impactLevel: row.impactLevel as VenueEventRecord['impactLevel'],
    lifecycleStatus: row.lifecycleStatus as VenueEventRecord['lifecycleStatus'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancellationReason: row.cancellationReason,
  };
}
