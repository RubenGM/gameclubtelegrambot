import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cancelScheduleEvent,
  createScheduleEvent,
  getScheduleCapacitySnapshot,
  setScheduleEventParticipantStatus,
  type ScheduleEventRecord,
  type ScheduleParticipantRecord,
  type ScheduleRepository,
} from './schedule-catalog.js';

function createRepository(initialEvents: ScheduleEventRecord[] = []): ScheduleRepository {
  const events = new Map(initialEvents.map((event) => [event.id, event]));
  const participants = new Map<string, ScheduleParticipantRecord>();
  let nextEventId = Math.max(0, ...initialEvents.map((event) => event.id)) + 1;

  return {
    async createEvent(input) {
      const createdAt = '2026-04-04T10:00:00.000Z';
      const next: ScheduleEventRecord = {
        id: nextEventId,
        title: input.title,
        description: input.description,
        startsAt: input.startsAt,
        organizerTelegramUserId: input.organizerTelegramUserId,
        createdByTelegramUserId: input.createdByTelegramUserId,
        tableId: input.tableId,
        capacity: input.capacity,
        lifecycleStatus: 'scheduled',
        createdAt,
        updatedAt: createdAt,
        cancelledAt: null,
        cancelledByTelegramUserId: null,
        cancellationReason: null,
      };
      nextEventId += 1;
      events.set(next.id, next);
      return next;
    },
    async findEventById(eventId) {
      return events.get(eventId) ?? null;
    },
    async listEvents() {
      return Array.from(events.values());
    },
    async updateEvent(input) {
      const existing = events.get(input.eventId);
      if (!existing) {
        throw new Error(`unknown schedule event ${input.eventId}`);
      }

      const next: ScheduleEventRecord = {
        ...existing,
        title: input.title,
        description: input.description,
        startsAt: input.startsAt,
        organizerTelegramUserId: input.organizerTelegramUserId,
        tableId: input.tableId,
        capacity: input.capacity,
        updatedAt: '2026-04-04T11:00:00.000Z',
      };
      events.set(next.id, next);
      return next;
    },
    async cancelEvent(input) {
      const existing = events.get(input.eventId);
      if (!existing) {
        throw new Error(`unknown schedule event ${input.eventId}`);
      }

      const next: ScheduleEventRecord = {
        ...existing,
        lifecycleStatus: 'cancelled',
        updatedAt: '2026-04-04T12:00:00.000Z',
        cancelledAt: '2026-04-04T12:00:00.000Z',
        cancelledByTelegramUserId: input.actorTelegramUserId,
        cancellationReason: input.reason ?? null,
      };
      events.set(next.id, next);
      return next;
    },
    async findParticipant(eventId, participantTelegramUserId) {
      return participants.get(`${eventId}:${participantTelegramUserId}`) ?? null;
    },
    async listParticipants(eventId) {
      return Array.from(participants.values()).filter((participant) => participant.scheduleEventId === eventId);
    },
    async upsertParticipant(input) {
      const existing = participants.get(`${input.eventId}:${input.participantTelegramUserId}`);
      const next: ScheduleParticipantRecord = {
        scheduleEventId: input.eventId,
        participantTelegramUserId: input.participantTelegramUserId,
        status: input.status,
        addedByTelegramUserId: existing?.addedByTelegramUserId ?? input.actorTelegramUserId,
        removedByTelegramUserId: input.status === 'removed' ? input.actorTelegramUserId : null,
        joinedAt: existing?.joinedAt ?? '2026-04-04T10:30:00.000Z',
        updatedAt: input.status === 'active' ? '2026-04-04T10:30:00.000Z' : '2026-04-04T11:30:00.000Z',
        leftAt: input.status === 'removed' ? '2026-04-04T11:30:00.000Z' : null,
      };

      participants.set(`${input.eventId}:${input.participantTelegramUserId}`, next);
      return next;
    },
  };
}

test('createScheduleEvent creates a scheduled activity with organizer ownership and optional table', async () => {
  const repository = createRepository();

  const event = await createScheduleEvent({
    repository,
    title: '  Dungeons & Dragons  ',
    description: '  Campanya oberta  ',
    startsAt: '2026-04-05T16:00:00.000Z',
    organizerTelegramUserId: 42,
    createdByTelegramUserId: 99,
    tableId: 7,
    capacity: 5,
  });

  assert.equal(event.id, 1);
  assert.equal(event.title, 'Dungeons & Dragons');
  assert.equal(event.description, 'Campanya oberta');
  assert.equal(event.organizerTelegramUserId, 42);
  assert.equal(event.createdByTelegramUserId, 99);
  assert.equal(event.tableId, 7);
  assert.equal(event.capacity, 5);
  assert.equal(event.lifecycleStatus, 'scheduled');
});

test('createScheduleEvent rejects non-positive seat capacity', async () => {
  const repository = createRepository();

  await assert.rejects(
    () =>
      createScheduleEvent({
        repository,
        title: 'Partida curta',
        startsAt: '2026-04-05T16:00:00.000Z',
        organizerTelegramUserId: 42,
        createdByTelegramUserId: 42,
        capacity: 0,
      }),
    /La capacitat ha de ser un enter positiu/,
  );
});

test('setScheduleEventParticipantStatus keeps participants separate from the base event and computes capacity reliably', async () => {
  const repository = createRepository([
    {
      id: 1,
      title: 'Terraforming Mars',
      description: null,
      startsAt: '2026-04-05T16:00:00.000Z',
      organizerTelegramUserId: 42,
      createdByTelegramUserId: 42,
      tableId: null,
      capacity: 2,
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancelledByTelegramUserId: null,
      cancellationReason: null,
    },
  ]);

  await setScheduleEventParticipantStatus({
    repository,
    eventId: 1,
    participantTelegramUserId: 42,
    actorTelegramUserId: 42,
    status: 'active',
  });
  await setScheduleEventParticipantStatus({
    repository,
    eventId: 1,
    participantTelegramUserId: 77,
    actorTelegramUserId: 77,
    status: 'active',
  });

  const snapshot = await getScheduleCapacitySnapshot({ repository, eventId: 1 });

  assert.deepEqual(snapshot, {
    capacity: 2,
    occupiedSeats: 2,
    availableSeats: 0,
    isFull: true,
  });

  await assert.rejects(
    () =>
      setScheduleEventParticipantStatus({
        repository,
        eventId: 1,
        participantTelegramUserId: 88,
        actorTelegramUserId: 88,
        status: 'active',
      }),
    /L activitat ja no te places disponibles/,
  );
});

test('cancelScheduleEvent preserves identity and prevents further participant activation', async () => {
  const repository = createRepository([
    {
      id: 3,
      title: 'Root',
      description: null,
      startsAt: '2026-04-05T16:00:00.000Z',
      organizerTelegramUserId: 42,
      createdByTelegramUserId: 42,
      tableId: null,
      capacity: 4,
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancelledByTelegramUserId: null,
      cancellationReason: null,
    },
  ]);

  const cancelled = await cancelScheduleEvent({
    repository,
    eventId: 3,
    actorTelegramUserId: 99,
    reason: 'Local tancat',
  });

  assert.equal(cancelled.id, 3);
  assert.equal(cancelled.lifecycleStatus, 'cancelled');
  assert.equal(cancelled.cancelledByTelegramUserId, 99);
  assert.equal(cancelled.cancellationReason, 'Local tancat');

  await assert.rejects(
    () =>
      setScheduleEventParticipantStatus({
        repository,
        eventId: 3,
        participantTelegramUserId: 77,
        actorTelegramUserId: 77,
        status: 'active',
      }),
    /No es poden gestionar participants en una activitat cancel.lada/,
  );
});
