import test from 'node:test';
import assert from 'node:assert/strict';

import type { ScheduleEventRecord, ScheduleRepository } from '../schedule/schedule-catalog.js';
import type { VenueEventRecord, VenueEventRepository } from '../venue-events/venue-event-catalog.js';
import { buildTodayAtClubSummary } from './today-at-club-summary.js';

test('buildTodayAtClubSummary lists activities that start today', async () => {
  const summary = await buildTodayAtClubSummary({
    language: 'ca',
    now: new Date('2026-04-27T09:30:00.000Z'),
    scheduleRepository: createScheduleRepository([
      createScheduleEvent({ id: 1, title: 'Wingspan', startsAt: '2026-04-27T16:00:00.000Z' }),
      createScheduleEvent({ id: 2, title: 'Demà', startsAt: '2026-04-28T16:00:00.000Z' }),
    ]),
    venueEventRepository: createVenueEventRepository([]),
  });

  assert.match(summary, /<b>Avui al club<\/b>/);
  assert.match(summary, /<b>Activitats:<\/b>/);
  assert.match(summary, /- 16:00 Wingspan/);
  assert.doesNotMatch(summary, /Demà/);
});

test('buildTodayAtClubSummary lists venue events that overlap today', async () => {
  const summary = await buildTodayAtClubSummary({
    language: 'ca',
    now: new Date('2026-04-27T09:30:00.000Z'),
    scheduleRepository: createScheduleRepository([]),
    venueEventRepository: createVenueEventRepository([
      createVenueEvent({ id: 1, name: 'Torneig intern', startsAt: '2026-04-26T22:00:00.000Z', endsAt: '2026-04-27T10:00:00.000Z' }),
      createVenueEvent({ id: 2, name: 'Demà', startsAt: '2026-04-28T10:00:00.000Z', endsAt: '2026-04-28T12:00:00.000Z' }),
    ]),
  });

  assert.match(summary, /<b>Local:<\/b>/);
  assert.match(summary, /- 22:00-10:00 Torneig intern/);
  assert.doesNotMatch(summary, /Demà/);
});

test('buildTodayAtClubSummary shows an empty state when today has no entries', async () => {
  const summary = await buildTodayAtClubSummary({
    language: 'ca',
    now: new Date('2026-04-27T09:30:00.000Z'),
    scheduleRepository: createScheduleRepository([]),
    venueEventRepository: createVenueEventRepository([]),
  });

  assert.equal(summary, '<b>Avui al club</b>\nAvui no hi ha activitats ni esdeveniments del local registrats.');
});

function createScheduleRepository(events: ScheduleEventRecord[]): ScheduleRepository {
  return {
    createEvent: async () => undefined as never,
    findEventById: async () => null,
    async listEvents({ includeCancelled, startsAtFrom, startsAtTo }) {
      return events
        .filter((event) => (includeCancelled ? true : event.lifecycleStatus !== 'cancelled'))
        .filter((event) => (startsAtFrom ? event.startsAt >= startsAtFrom : true))
        .filter((event) => (startsAtTo ? event.startsAt <= startsAtTo : true))
        .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
    },
    updateEvent: async () => undefined as never,
    cancelEvent: async () => undefined as never,
    findParticipant: async () => null,
    listParticipants: async () => [],
    upsertParticipant: async () => undefined as never,
  };
}

function createVenueEventRepository(events: VenueEventRecord[]): VenueEventRepository {
  return {
    createVenueEvent: async () => undefined as never,
    findVenueEventById: async () => null,
    async listVenueEvents({ includeCancelled, startsAtFrom, endsAtTo }) {
      return events
        .filter((event) => (includeCancelled ? true : event.lifecycleStatus !== 'cancelled'))
        .filter((event) => (startsAtFrom ? event.endsAt >= startsAtFrom : true))
        .filter((event) => (endsAtTo ? event.startsAt <= endsAtTo : true))
        .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
    },
    updateVenueEvent: async () => undefined as never,
    cancelVenueEvent: async () => undefined as never,
  };
}

function createScheduleEvent(input: { id: number; title: string; startsAt: string }): ScheduleEventRecord {
  return {
    id: input.id,
    title: input.title,
    startsAt: input.startsAt,
    description: null,
    durationMinutes: 180,
    organizerTelegramUserId: 77,
    createdByTelegramUserId: 77,
    tableId: null,
    attendanceMode: 'open',
    initialOccupiedSeats: 0,
    capacity: 4,
    lifecycleStatus: 'scheduled',
    createdAt: '2026-04-20T10:00:00.000Z',
    updatedAt: '2026-04-20T10:00:00.000Z',
    cancelledAt: null,
    cancelledByTelegramUserId: null,
    cancellationReason: null,
  };
}

function createVenueEvent(input: { id: number; name: string; startsAt: string; endsAt: string }): VenueEventRecord {
  return {
    id: input.id,
    name: input.name,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    description: null,
    occupancyScope: 'partial',
    impactLevel: 'medium',
    lifecycleStatus: 'scheduled',
    createdAt: '2026-04-20T10:00:00.000Z',
    updatedAt: '2026-04-20T10:00:00.000Z',
    cancelledAt: null,
    cancellationReason: null,
  };
}
