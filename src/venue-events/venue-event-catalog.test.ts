import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cancelVenueEvent,
  createVenueEvent,
  findRelevantVenueEventsForRange,
  listVenueEvents,
  updateVenueEvent,
  type VenueEventRecord,
  type VenueEventRepository,
} from './venue-event-catalog.js';

function createRepository(initialEvents: VenueEventRecord[] = []): VenueEventRepository {
  const events = new Map(initialEvents.map((event) => [event.id, event]));
  let nextId = Math.max(0, ...initialEvents.map((event) => event.id)) + 1;

  return {
    async createVenueEvent(input) {
      const createdAt = '2026-04-04T10:00:00.000Z';
      const event: VenueEventRecord = {
        id: nextId,
        name: input.name,
        description: input.description,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        occupancyScope: input.occupancyScope,
        impactLevel: input.impactLevel,
        lifecycleStatus: 'scheduled',
        createdAt,
        updatedAt: createdAt,
        cancelledAt: null,
        cancellationReason: null,
      };
      nextId += 1;
      events.set(event.id, event);
      return event;
    },
    async findVenueEventById(eventId) {
      return events.get(eventId) ?? null;
    },
    async listVenueEvents(input) {
      return Array.from(events.values()).filter((event) => {
        if (!input.includeCancelled && event.lifecycleStatus === 'cancelled') {
          return false;
        }
        if (input.startsAtFrom && event.endsAt < input.startsAtFrom) {
          return false;
        }
        if (input.endsAtTo && event.startsAt > input.endsAtTo) {
          return false;
        }
        return true;
      });
    },
    async updateVenueEvent(input) {
      const existing = events.get(input.eventId);
      if (!existing) {
        throw new Error(`unknown venue event ${input.eventId}`);
      }
      const updated: VenueEventRecord = {
        ...existing,
        name: input.name,
        description: input.description,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        occupancyScope: input.occupancyScope,
        impactLevel: input.impactLevel,
        updatedAt: '2026-04-04T11:00:00.000Z',
      };
      events.set(updated.id, updated);
      return updated;
    },
    async cancelVenueEvent(input) {
      const existing = events.get(input.eventId);
      if (!existing) {
        throw new Error(`unknown venue event ${input.eventId}`);
      }
      const updated: VenueEventRecord = {
        ...existing,
        lifecycleStatus: 'cancelled',
        cancelledAt: '2026-04-04T12:00:00.000Z',
        cancellationReason: input.reason ?? null,
        updatedAt: '2026-04-04T12:00:00.000Z',
      };
      events.set(updated.id, updated);
      return updated;
    },
  };
}

test('createVenueEvent stores a dedicated venue event with occupancy metadata', async () => {
  const repository = createRepository();

  const event = await createVenueEvent({
    repository,
    name: '  Campionat regional  ',
    description: '  Ocupara gran part del local  ',
    startsAt: '2026-04-10T15:00:00.000Z',
    endsAt: '2026-04-10T21:00:00.000Z',
    occupancyScope: 'full',
    impactLevel: 'high',
  });

  assert.equal(event.id, 1);
  assert.equal(event.name, 'Campionat regional');
  assert.equal(event.description, 'Ocupara gran part del local');
  assert.equal(event.occupancyScope, 'full');
  assert.equal(event.impactLevel, 'high');
  assert.equal(event.lifecycleStatus, 'scheduled');
});

test('createVenueEvent rejects invalid time ranges', async () => {
  const repository = createRepository();

  await assert.rejects(
    () =>
      createVenueEvent({
        repository,
        name: 'Esdeveniment invalid',
        startsAt: '2026-04-10T21:00:00.000Z',
        endsAt: '2026-04-10T15:00:00.000Z',
        occupancyScope: 'partial',
        impactLevel: 'medium',
      }),
    /El final ha de ser posterior a l inici/,
  );
});

test('listVenueEvents filters by date range while excluding cancelled entries by default', async () => {
  const repository = createRepository([
    {
      id: 1,
      name: 'Torneig mati',
      description: null,
      startsAt: '2026-04-10T09:00:00.000Z',
      endsAt: '2026-04-10T13:00:00.000Z',
      occupancyScope: 'partial',
      impactLevel: 'medium',
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancellationReason: null,
    },
    {
      id: 2,
      name: 'Festival vespre',
      description: null,
      startsAt: '2026-04-10T18:00:00.000Z',
      endsAt: '2026-04-10T23:00:00.000Z',
      occupancyScope: 'full',
      impactLevel: 'high',
      lifecycleStatus: 'cancelled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: '2026-04-04T12:00:00.000Z',
      cancellationReason: 'Aplacat',
    },
  ]);

  const events = await listVenueEvents({
    repository,
    startsAtFrom: '2026-04-10T08:00:00.000Z',
    endsAtTo: '2026-04-10T14:00:00.000Z',
  });

  assert.deepEqual(events.map((event) => event.id), [1]);
});

test('updateVenueEvent preserves identity and updates occupancy metadata', async () => {
  const repository = createRepository([
    {
      id: 3,
      name: 'Mercat solidari',
      description: null,
      startsAt: '2026-04-10T09:00:00.000Z',
      endsAt: '2026-04-10T13:00:00.000Z',
      occupancyScope: 'partial',
      impactLevel: 'low',
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancellationReason: null,
    },
  ]);

  const updated = await updateVenueEvent({
    repository,
    eventId: 3,
    name: 'Mercat solidari ampliat',
    description: 'Mes espai ocupat',
    startsAt: '2026-04-10T09:00:00.000Z',
    endsAt: '2026-04-10T15:00:00.000Z',
    occupancyScope: 'full',
    impactLevel: 'high',
  });

  assert.equal(updated.id, 3);
  assert.equal(updated.name, 'Mercat solidari ampliat');
  assert.equal(updated.endsAt, '2026-04-10T15:00:00.000Z');
  assert.equal(updated.occupancyScope, 'full');
});

test('cancelVenueEvent cancels without deleting the historical record', async () => {
  const repository = createRepository([
    {
      id: 4,
      name: 'Acte municipal',
      description: null,
      startsAt: '2026-04-10T09:00:00.000Z',
      endsAt: '2026-04-10T15:00:00.000Z',
      occupancyScope: 'full',
      impactLevel: 'high',
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancellationReason: null,
    },
  ]);

  const cancelled = await cancelVenueEvent({
    repository,
    eventId: 4,
    reason: 'Canvi de sala',
  });

  assert.equal(cancelled.lifecycleStatus, 'cancelled');
  assert.equal(cancelled.cancellationReason, 'Canvi de sala');
  assert.equal(cancelled.id, 4);
});

test('findRelevantVenueEventsForRange returns only overlapping active venue events', async () => {
  const repository = createRepository([
    {
      id: 5,
      name: 'Campionat regional',
      description: null,
      startsAt: '2026-04-10T15:00:00.000Z',
      endsAt: '2026-04-10T21:00:00.000Z',
      occupancyScope: 'full',
      impactLevel: 'high',
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancellationReason: null,
    },
    {
      id: 6,
      name: 'Taller infantil',
      description: null,
      startsAt: '2026-04-10T09:00:00.000Z',
      endsAt: '2026-04-10T11:00:00.000Z',
      occupancyScope: 'partial',
      impactLevel: 'medium',
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancellationReason: null,
    },
    {
      id: 7,
      name: 'Acte cancel.lat',
      description: null,
      startsAt: '2026-04-10T16:00:00.000Z',
      endsAt: '2026-04-10T17:00:00.000Z',
      occupancyScope: 'partial',
      impactLevel: 'low',
      lifecycleStatus: 'cancelled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: '2026-04-04T12:00:00.000Z',
      cancellationReason: 'Aplacat',
    },
  ]);

  const relevant = await findRelevantVenueEventsForRange({
    repository,
    startsAt: '2026-04-10T16:00:00.000Z',
    endsAt: '2026-04-10T18:00:00.000Z',
  });

  assert.deepEqual(relevant.map((event) => event.id), [5]);
});
