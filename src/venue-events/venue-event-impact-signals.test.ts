import test from 'node:test';
import assert from 'node:assert/strict';

import type { ScheduleEventRecord, ScheduleParticipantRecord, ScheduleRepository } from '../schedule/schedule-catalog.js';
import type { VenueEventRecord, VenueEventRepository } from './venue-event-catalog.js';
import {
  buildVenueEventImpactSignal,
  type VenueEventImpactSignal,
} from './venue-event-impact-signals.js';

function createScheduleRepository(initialEvents: ScheduleEventRecord[] = []): ScheduleRepository {
  const events = new Map(initialEvents.map((event) => [event.id, event]));
  const participants = new Map<string, ScheduleParticipantRecord>();

  return {
    async createEvent() { throw new Error('not implemented'); },
    async findEventById(eventId: number) { return events.get(eventId) ?? null; },
    async listEvents({ includeCancelled }) {
      return Array.from(events.values()).filter((event) => includeCancelled || event.lifecycleStatus === 'scheduled');
    },
    async updateEvent() { throw new Error('not implemented'); },
    async cancelEvent() { throw new Error('not implemented'); },
    async findParticipant(eventId: number, participantTelegramUserId: number) {
      return participants.get(`${eventId}:${participantTelegramUserId}`) ?? null;
    },
    async listParticipants(eventId: number) {
      return Array.from(participants.values()).filter((participant) => participant.scheduleEventId === eventId);
    },
    async upsertParticipant(input) {
      const next: ScheduleParticipantRecord = {
        scheduleEventId: input.eventId,
        participantTelegramUserId: input.participantTelegramUserId,
        status: input.status,
        addedByTelegramUserId: input.actorTelegramUserId,
        removedByTelegramUserId: input.status === 'removed' ? input.actorTelegramUserId : null,
        joinedAt: '2026-04-04T10:30:00.000Z',
        updatedAt: '2026-04-04T10:30:00.000Z',
        leftAt: input.status === 'removed' ? '2026-04-04T11:00:00.000Z' : null,
      };
      participants.set(`${input.eventId}:${input.participantTelegramUserId}`, next);
      return next;
    },
  };
}

function createVenueEventRepository(initialEvents: VenueEventRecord[] = []): VenueEventRepository {
  const events = new Map(initialEvents.map((event) => [event.id, event]));

  return {
    async createVenueEvent() { throw new Error('not implemented'); },
    async findVenueEventById(eventId: number) { return events.get(eventId) ?? null; },
    async listVenueEvents({ includeCancelled, startsAtFrom, endsAtTo }) {
      return Array.from(events.values()).filter((event) => {
        if (!includeCancelled && event.lifecycleStatus === 'cancelled') return false;
        if (startsAtFrom && event.endsAt < startsAtFrom) return false;
        if (endsAtTo && event.startsAt > endsAtTo) return false;
        return true;
      });
    },
    async updateVenueEvent() { throw new Error('not implemented'); },
    async cancelVenueEvent() { throw new Error('not implemented'); },
  };
}

test('buildVenueEventImpactSignal finds overlapping activities and impacted users for a created venue event', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 11,
      title: 'Azul',
      description: null,
      startsAt: '2026-04-12T16:00:00.000Z',
      organizerTelegramUserId: 42,
      createdByTelegramUserId: 42,
      tableId: null,
      durationMinutes: 180,
      capacity: 4,
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancelledByTelegramUserId: null,
      cancellationReason: null,
    },
    {
      id: 12,
      title: 'Root',
      description: null,
      startsAt: '2026-04-12T21:30:00.000Z',
      organizerTelegramUserId: 77,
      createdByTelegramUserId: 77,
      tableId: null,
      durationMinutes: 120,
      capacity: 4,
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancelledByTelegramUserId: null,
      cancellationReason: null,
    },
  ]);
  await scheduleRepository.upsertParticipant({ eventId: 11, participantTelegramUserId: 42, actorTelegramUserId: 42, status: 'active' });
  await scheduleRepository.upsertParticipant({ eventId: 11, participantTelegramUserId: 55, actorTelegramUserId: 55, status: 'active' });

  const venueEventRepository = createVenueEventRepository([
    {
      id: 1,
      name: 'Campionat regional',
      description: null,
      startsAt: '2026-04-12T15:00:00.000Z',
      endsAt: '2026-04-12T21:00:00.000Z',
      occupancyScope: 'full',
      impactLevel: 'high',
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancellationReason: null,
    },
  ]);

  const signal = await buildVenueEventImpactSignal({
    venueEventRepository,
    scheduleRepository,
    venueEventId: 1,
    changeType: 'created',
    actorTelegramUserId: 99,
  });

  assert.equal(signal.changeType, 'created');
  assert.deepEqual(signal.affectedScheduleEventIds, [11]);
  assert.deepEqual(signal.impactedTelegramUserIds, [42, 55]);
});

test('buildVenueEventImpactSignal keeps impacted users for cancelled venue events so downstream notifications can resolve warnings', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 20,
      title: 'Heat',
      description: null,
      startsAt: '2026-04-12T16:00:00.000Z',
      organizerTelegramUserId: 42,
      createdByTelegramUserId: 42,
      tableId: null,
      durationMinutes: 180,
      capacity: 4,
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancelledByTelegramUserId: null,
      cancellationReason: null,
    },
  ]);
  await scheduleRepository.upsertParticipant({ eventId: 20, participantTelegramUserId: 42, actorTelegramUserId: 42, status: 'active' });

  const venueEventRepository = createVenueEventRepository([
    {
      id: 2,
      name: 'Acte municipal',
      description: null,
      startsAt: '2026-04-12T15:00:00.000Z',
      endsAt: '2026-04-12T21:00:00.000Z',
      occupancyScope: 'full',
      impactLevel: 'high',
      lifecycleStatus: 'cancelled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T12:00:00.000Z',
      cancelledAt: '2026-04-04T12:00:00.000Z',
      cancellationReason: 'Finalitzat',
    },
  ]);

  const signal = await buildVenueEventImpactSignal({
    venueEventRepository,
    scheduleRepository,
    venueEventId: 2,
    changeType: 'cancelled',
    actorTelegramUserId: 99,
  });

  assert.equal(signal.changeType, 'cancelled');
  assert.deepEqual(signal.affectedScheduleEventIds, [20]);
  assert.deepEqual(signal.impactedTelegramUserIds, [42]);
});
