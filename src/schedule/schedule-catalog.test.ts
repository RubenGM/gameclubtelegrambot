import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cancelScheduleEvent,
  assignScheduleInitialOccupiedSeat,
  createScheduleEvent,
  detectScheduleConflicts,
  getScheduleCapacitySnapshot,
  getScheduleEventAttendance,
  joinScheduleEvent,
  leaveScheduleEvent,
  setScheduleEventParticipantCompanions,
  setScheduleEventParticipantGuests,
  setScheduleEventParticipantRole,
  setScheduleEventParticipantSpectators,
  setScheduleEventParticipantStatus,
  updateScheduleEvent,
  type ScheduleEventRecord,
  type ScheduleParticipantRecord,
  type ScheduleRepository,
} from './schedule-catalog.js';

type ScheduleEventFixture = Omit<ScheduleEventRecord, 'attendanceMode' | 'isPublic' | 'initialOccupiedSeats' | 'detailsMessageChatId' | 'detailsMessageId'> &
  Partial<Pick<ScheduleEventRecord, 'attendanceMode' | 'isPublic' | 'initialOccupiedSeats' | 'detailsMessageChatId' | 'detailsMessageId'>>;

function createRepository(initialEvents: ScheduleEventFixture[] = []): ScheduleRepository {
  const events = new Map(initialEvents.map((event) => {
    const normalized = normalizeScheduleEventFixture(event);
    return [normalized.id, normalized];
  }));
  const participants = new Map<string, ScheduleParticipantRecord>();
  let nextEventId = Math.max(0, ...initialEvents.map((event) => event.id)) + 1;

  return {
    async createEvent(input) {
      const createdAt = '2026-04-04T10:00:00.000Z';
      const next: ScheduleEventRecord = {
        id: nextEventId,
        title: input.title,
        description: input.description,
        detailsMessageChatId: input.detailsMessageChatId ?? null,
        detailsMessageId: input.detailsMessageId ?? null,
        startsAt: input.startsAt,
        organizerTelegramUserId: input.organizerTelegramUserId,
        createdByTelegramUserId: input.createdByTelegramUserId,
        tableId: input.tableId,
        equipmentIds: input.equipmentIds ?? [],
        catalogItemId: input.catalogItemId ?? null,
        durationMinutes: input.durationMinutes,
        attendanceMode: input.attendanceMode,
        isPublic: input.isPublic,
        initialOccupiedSeats: input.initialOccupiedSeats,
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
        detailsMessageChatId: input.detailsMessageChatId ?? null,
        detailsMessageId: input.detailsMessageId ?? null,
        startsAt: input.startsAt,
        organizerTelegramUserId: input.organizerTelegramUserId,
        tableId: input.tableId,
        equipmentIds: input.equipmentIds ?? existing.equipmentIds ?? [],
        catalogItemId: input.catalogItemId ?? existing.catalogItemId ?? null,
        durationMinutes: input.durationMinutes,
        attendanceMode: input.attendanceMode,
        isPublic: input.isPublic,
        initialOccupiedSeats: input.initialOccupiedSeats,
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
        participationRole: input.participationRole ?? existing?.participationRole ?? 'player',
        companionCount: input.status === 'removed' ? 0 : (input.companionCount ?? existing?.companionCount ?? 0),
        spectatorCount: input.status === 'removed' ? 0 : (input.spectatorCount ?? existing?.spectatorCount ?? 0),
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

function normalizeScheduleEventFixture(event: ScheduleEventFixture): ScheduleEventRecord {
  return {
    ...event,
    attendanceMode: event.attendanceMode ?? 'open',
    isPublic: event.isPublic ?? false,
    initialOccupiedSeats: event.initialOccupiedSeats ?? 0,
    detailsMessageChatId: event.detailsMessageChatId ?? null,
    detailsMessageId: event.detailsMessageId ?? null,
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
    catalogItemId: 12,
    durationMinutes: 180,
    capacity: 5,
    attendanceMode: 'open',
    initialOccupiedSeats: 2,
  } as never);

  assert.equal(event.id, 1);
  assert.equal(event.title, 'Dungeons & Dragons');
  assert.equal(event.description, 'Campanya oberta');
  assert.equal(event.organizerTelegramUserId, 42);
  assert.equal(event.createdByTelegramUserId, 99);
  assert.equal(event.tableId, 7);
  assert.equal(event.catalogItemId, 12);
  assert.equal(event.durationMinutes, 180);
  assert.equal(event.capacity, 5);
  assert.equal((event as { attendanceMode: string }).attendanceMode, 'open');
  assert.equal((event as { initialOccupiedSeats: number }).initialOccupiedSeats, 2);
  assert.equal(event.lifecycleStatus, 'scheduled');

  assert.deepEqual(await repository.listParticipants(event.id), []);
});

test('createScheduleEvent allows public open activities', async () => {
  const repository = createRepository();

  const event = await createScheduleEvent({
    repository,
    title: 'Torneo abierto',
    description: null,
    startsAt: '2026-07-10T18:00:00.000Z',
    durationMinutes: 180,
    organizerTelegramUserId: 42,
    createdByTelegramUserId: 42,
    tableId: null,
    attendanceMode: 'open',
    initialOccupiedSeats: 0,
    capacity: 8,
    isPublic: true,
  });

  assert.equal(event.isPublic, true);
});

test('createScheduleEvent rejects public closed activities', async () => {
  const repository = createRepository();

  await assert.rejects(
    () =>
      createScheduleEvent({
        repository,
        title: 'Mesa cerrada',
        description: null,
        startsAt: '2026-07-10T18:00:00.000Z',
        durationMinutes: 180,
        organizerTelegramUserId: 42,
        createdByTelegramUserId: 42,
        tableId: null,
        attendanceMode: 'closed',
        initialOccupiedSeats: 0,
        capacity: 4,
        isPublic: true,
      }),
    /Una actividad pública debe ser una mesa abierta/,
  );
});

test('updateScheduleEvent rejects public closed activities', async () => {
  const repository = createRepository();
  const event = await createScheduleEvent({
    repository,
    title: 'Mesa abierta',
    description: null,
    startsAt: '2026-07-10T18:00:00.000Z',
    durationMinutes: 180,
    organizerTelegramUserId: 42,
    createdByTelegramUserId: 42,
    tableId: null,
    attendanceMode: 'open',
    initialOccupiedSeats: 0,
    capacity: 4,
    isPublic: false,
  });

  await assert.rejects(
    () =>
      updateScheduleEvent({
        repository,
        eventId: event.id,
        title: event.title,
        description: event.description,
        startsAt: event.startsAt,
        durationMinutes: event.durationMinutes,
        organizerTelegramUserId: event.organizerTelegramUserId,
        tableId: event.tableId,
        attendanceMode: 'closed',
        initialOccupiedSeats: 0,
        capacity: event.capacity,
        isPublic: true,
      }),
    /Una actividad pública debe ser una mesa abierta/,
  );
});

test('getScheduleCapacitySnapshot for open activities counts initial occupied seats separately from bot participants', async () => {
  const repository = createRepository([
    {
      id: 30,
      title: 'Mesa oberta Root',
      description: null,
      startsAt: '2026-04-05T16:00:00.000Z',
      organizerTelegramUserId: 42,
      createdByTelegramUserId: 42,
      tableId: null,
      durationMinutes: 180,
      capacity: 5,
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancelledByTelegramUserId: null,
      cancellationReason: null,
      attendanceMode: 'open',
      initialOccupiedSeats: 2,
    } as ScheduleEventRecord,
  ]);

  await setScheduleEventParticipantStatus({
    repository,
    eventId: 30,
    participantTelegramUserId: 77,
    actorTelegramUserId: 77,
    status: 'active',
  });

  const snapshot = await getScheduleCapacitySnapshot({ repository, eventId: 30 });

  assert.deepEqual(snapshot, {
    capacity: 5,
    occupiedSeats: 3,
    availableSeats: 2,
    isFull: false,
  });
});

test('assignScheduleInitialOccupiedSeat replaces one generic reservation with a named participant', async () => {
  const repository = createRepository([
    {
      id: 7,
      title: 'Pathfinder',
      description: null,
      startsAt: '2026-07-31T16:00:00.000Z',
      durationMinutes: 240,
      organizerTelegramUserId: 42,
      createdByTelegramUserId: 42,
      tableId: null,
      attendanceMode: 'open',
      isPublic: false,
      initialOccupiedSeats: 2,
      capacity: 4,
      lifecycleStatus: 'scheduled',
      createdAt: '2026-07-29T10:00:00.000Z',
      updatedAt: '2026-07-29T10:00:00.000Z',
      cancelledAt: null,
      cancelledByTelegramUserId: null,
      cancellationReason: null,
    },
  ]);

  await assignScheduleInitialOccupiedSeat({
    repository,
    eventId: 7,
    participantTelegramUserId: 55,
    actorTelegramUserId: 42,
  });

  assert.equal((await repository.findEventById(7))?.initialOccupiedSeats, 1);
  assert.equal((await repository.findParticipant(7, 55))?.status, 'active');
  assert.deepEqual(await getScheduleCapacitySnapshot({ repository, eventId: 7 }), {
    capacity: 4,
    occupiedSeats: 2,
    availableSeats: 2,
    isFull: false,
  });
});

test('joinScheduleEvent rejects closed activities', async () => {
  const repository = createRepository([
    {
      id: 31,
      title: 'Campanya tancada',
      description: null,
      startsAt: '2026-04-05T16:00:00.000Z',
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
      attendanceMode: 'closed',
      initialOccupiedSeats: 0,
    } as ScheduleEventRecord,
  ]);

  await assert.rejects(
    () =>
      joinScheduleEvent({
        repository,
        eventId: 31,
        participantTelegramUserId: 77,
        actorTelegramUserId: 77,
      }),
    /No es pot apuntar gent a una activitat tancada/,
  );
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
        durationMinutes: 180,
        attendanceMode: 'open',
        initialOccupiedSeats: 0,
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
      durationMinutes: 180,
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
    /L'activitat ja no té places disponibles/,
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

test('joinScheduleEvent prevents duplicate seats and reports current attendance', async () => {
  const repository = createRepository([
    {
      id: 9,
      title: 'Heat',
      description: null,
      startsAt: '2026-04-05T16:00:00.000Z',
      organizerTelegramUserId: 42,
      createdByTelegramUserId: 42,
      tableId: null,
      durationMinutes: 180,
      capacity: 3,
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
    eventId: 9,
    participantTelegramUserId: 42,
    actorTelegramUserId: 42,
    status: 'active',
  });

  const joined = await joinScheduleEvent({
    repository,
    eventId: 9,
    participantTelegramUserId: 77,
    actorTelegramUserId: 77,
  });

  assert.equal(joined.status, 'active');

  await assert.rejects(
    () =>
      joinScheduleEvent({
        repository,
        eventId: 9,
        participantTelegramUserId: 77,
        actorTelegramUserId: 77,
      }),
    /Ja estas apuntat a aquesta activitat/,
  );

  const attendance = await getScheduleEventAttendance({ repository, eventId: 9 });
  assert.deepEqual(attendance.activeParticipantTelegramUserIds, [42, 77]);
  assert.deepEqual(attendance.snapshot, {
    capacity: 3,
    occupiedSeats: 2,
    availableSeats: 1,
    isFull: false,
  });
});

test('leaveScheduleEvent frees the seat and rejects leaving when not joined', async () => {
  const repository = createRepository([
    {
      id: 10,
      title: 'Cascadia',
      description: null,
      startsAt: '2026-04-05T16:00:00.000Z',
      organizerTelegramUserId: 42,
      createdByTelegramUserId: 42,
      tableId: null,
      durationMinutes: 180,
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
    eventId: 10,
    participantTelegramUserId: 42,
    actorTelegramUserId: 42,
    status: 'active',
  });
  await joinScheduleEvent({
    repository,
    eventId: 10,
    participantTelegramUserId: 77,
    actorTelegramUserId: 77,
  });

  const left = await leaveScheduleEvent({
    repository,
    eventId: 10,
    participantTelegramUserId: 77,
    actorTelegramUserId: 77,
  });
  assert.equal(left.status, 'removed');

  const snapshot = await getScheduleCapacitySnapshot({ repository, eventId: 10 });
  assert.deepEqual(snapshot, {
    capacity: 2,
    occupiedSeats: 1,
    availableSeats: 1,
    isFull: false,
  });

  await assert.rejects(
    () =>
      leaveScheduleEvent({
        repository,
        eventId: 10,
        participantTelegramUserId: 88,
        actorTelegramUserId: 88,
      }),
    /No estas apuntat a aquesta activitat/,
  );
});

test('detectScheduleConflicts only finds overlaps at the same assigned table', async () => {
  const repository = createRepository([
    {
      id: 20,
      title: 'Dune Imperium',
      description: null,
      startsAt: '2026-04-05T16:00:00.000Z',
      organizerTelegramUserId: 42,
      createdByTelegramUserId: 42,
      tableId: 1,
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
      id: 21,
      title: 'Ark Nova',
      description: null,
      startsAt: '2026-04-05T17:00:00.000Z',
      organizerTelegramUserId: 77,
      createdByTelegramUserId: 77,
      tableId: 1,
      durationMinutes: 120,
      capacity: 4,
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancelledByTelegramUserId: null,
      cancellationReason: null,
    },
    {
      id: 22,
      title: 'Heat',
      description: null,
      startsAt: '2026-04-05T17:30:00.000Z',
      organizerTelegramUserId: 88,
      createdByTelegramUserId: 88,
      tableId: null,
      durationMinutes: 60,
      capacity: 4,
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancelledByTelegramUserId: null,
      cancellationReason: null,
    },
    {
      id: 23,
      title: 'Catan',
      description: null,
      startsAt: '2026-04-05T17:30:00.000Z',
      organizerTelegramUserId: 99,
      createdByTelegramUserId: 99,
      tableId: 2,
      durationMinutes: 60,
      capacity: 4,
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancelledByTelegramUserId: null,
      cancellationReason: null,
    },
  ]);
  await setScheduleEventParticipantStatus({ repository, eventId: 20, participantTelegramUserId: 42, actorTelegramUserId: 42, status: 'active' });
  await setScheduleEventParticipantStatus({ repository, eventId: 20, participantTelegramUserId: 55, actorTelegramUserId: 55, status: 'active' });
  await setScheduleEventParticipantStatus({ repository, eventId: 21, participantTelegramUserId: 77, actorTelegramUserId: 77, status: 'active' });
  await setScheduleEventParticipantStatus({ repository, eventId: 21, participantTelegramUserId: 66, actorTelegramUserId: 66, status: 'active' });

  const conflicts = await detectScheduleConflicts({
    repository,
    eventId: 21,
    actorTelegramUserId: 77,
  });

  assert.deepEqual(conflicts.overlappingEventIds, [20]);
  assert.deepEqual(conflicts.impactedTelegramUserIds, [42, 55, 66]);

  const eventWithoutTableConflicts = await detectScheduleConflicts({
    repository,
    eventId: 22,
    actorTelegramUserId: 88,
  });

  assert.deepEqual(eventWithoutTableConflicts.overlappingEventIds, []);
  assert.deepEqual(eventWithoutTableConflicts.impactedTelegramUserIds, []);
});

test('detectScheduleConflicts also finds overlapping reservations for the same equipment', async () => {
  const common = {
    description: null,
    tableId: null,
    durationMinutes: 120,
    capacity: 4,
    lifecycleStatus: 'scheduled' as const,
    createdAt: '2026-04-04T10:00:00.000Z',
    updatedAt: '2026-04-04T10:00:00.000Z',
    cancelledAt: null,
    cancelledByTelegramUserId: null,
    cancellationReason: null,
  };
  const repository = createRepository([
    {
      ...common,
      id: 30,
      title: 'Partida con TV',
      startsAt: '2026-04-05T16:00:00.000Z',
      organizerTelegramUserId: 42,
      createdByTelegramUserId: 42,
      equipmentIds: [2],
    },
    {
      ...common,
      id: 31,
      title: 'Otra partida con TV',
      startsAt: '2026-04-05T17:00:00.000Z',
      organizerTelegramUserId: 77,
      createdByTelegramUserId: 77,
      equipmentIds: [2],
    },
    {
      ...common,
      id: 32,
      title: 'Partida con proyector',
      startsAt: '2026-04-05T17:00:00.000Z',
      organizerTelegramUserId: 88,
      createdByTelegramUserId: 88,
      equipmentIds: [3],
    },
  ]);

  const conflicts = await detectScheduleConflicts({ repository, eventId: 30, actorTelegramUserId: 42 });
  assert.deepEqual(conflicts.overlappingEventIds, [31]);
  assert.deepEqual(conflicts.impactedTelegramUserIds, [77]);
});

test('joinScheduleEvent with role spectator does not consume game seats and allows joining when full', async () => {
  const repository = createRepository([
    {
      id: 50,
      title: 'Game of Thrones',
      description: null,
      startsAt: '2026-04-05T16:00:00.000Z',
      organizerTelegramUserId: 42,
      createdByTelegramUserId: 42,
      tableId: null,
      durationMinutes: 180,
      capacity: 1,
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancelledByTelegramUserId: null,
      cancellationReason: null,
    },
  ]);

  // Player 1 joins (filling the capacity of 1)
  await joinScheduleEvent({
    repository,
    eventId: 50,
    participantTelegramUserId: 42,
    actorTelegramUserId: 42,
    role: 'player',
  });

  const snapshotFull = await getScheduleCapacitySnapshot({ repository, eventId: 50 });
  assert.equal(snapshotFull.availableSeats, 0);
  assert.equal(snapshotFull.isFull, true);

  // Player 2 attempts to join as player -> fails
  await assert.rejects(
    () =>
      joinScheduleEvent({
        repository,
        eventId: 50,
        participantTelegramUserId: 77,
        actorTelegramUserId: 77,
        role: 'player',
      }),
    /L'activitat ja no té places disponibles/,
  );

  // Spectator joins successfully even though table is full
  const spectator = await joinScheduleEvent({
    repository,
    eventId: 50,
    participantTelegramUserId: 77,
    actorTelegramUserId: 77,
    role: 'spectator',
  });
  assert.equal(spectator.participationRole, 'spectator');
  assert.equal(spectator.status, 'active');

  // Capacity remains 0 available, 1 occupied
  const snapshotAfterSpectator = await getScheduleCapacitySnapshot({ repository, eventId: 50 });
  assert.equal(snapshotAfterSpectator.occupiedSeats, 1);
  assert.equal(snapshotAfterSpectator.availableSeats, 0);
});

test('setScheduleEventParticipantRole allows switching roles and correctly recalculates available seats', async () => {
  const repository = createRepository([
    {
      id: 51,
      title: 'Dune',
      description: null,
      startsAt: '2026-04-05T16:00:00.000Z',
      organizerTelegramUserId: 42,
      createdByTelegramUserId: 42,
      tableId: null,
      durationMinutes: 180,
      capacity: 1,
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancelledByTelegramUserId: null,
      cancellationReason: null,
    },
  ]);

  // User 42 joins as spectator
  await joinScheduleEvent({
    repository,
    eventId: 51,
    participantTelegramUserId: 42,
    actorTelegramUserId: 42,
    role: 'spectator',
  });

  // Since seat is available, spectator switches to player
  await setScheduleEventParticipantRole({
    repository,
    eventId: 51,
    participantTelegramUserId: 42,
    actorTelegramUserId: 42,
    role: 'player',
  });

  let snapshot = await getScheduleCapacitySnapshot({ repository, eventId: 51 });
  assert.equal(snapshot.occupiedSeats, 1);
  assert.equal(snapshot.availableSeats, 0);

  // User 77 joins as spectator
  await joinScheduleEvent({
    repository,
    eventId: 51,
    participantTelegramUserId: 77,
    actorTelegramUserId: 77,
    role: 'spectator',
  });

  // User 77 cannot switch to player because table is full
  await assert.rejects(
    () =>
      setScheduleEventParticipantRole({
        repository,
        eventId: 51,
        participantTelegramUserId: 77,
        actorTelegramUserId: 77,
        role: 'player',
      }),
    /L'activitat ja no té places disponibles/,
  );

  // User 42 switches to spectator, freeing the seat
  await setScheduleEventParticipantRole({
    repository,
    eventId: 51,
    participantTelegramUserId: 42,
    actorTelegramUserId: 42,
    role: 'spectator',
  });

  snapshot = await getScheduleCapacitySnapshot({ repository, eventId: 51 });
  assert.equal(snapshot.occupiedSeats, 0);
  assert.equal(snapshot.availableSeats, 1);

  // Now User 77 can switch to player
  await setScheduleEventParticipantRole({
    repository,
    eventId: 51,
    participantTelegramUserId: 77,
    actorTelegramUserId: 77,
    role: 'player',
  });

  snapshot = await getScheduleCapacitySnapshot({ repository, eventId: 51 });
  assert.equal(snapshot.occupiedSeats, 1);
  assert.equal(snapshot.availableSeats, 0);
});

test('setScheduleEventParticipantSpectators sets spectatorCount without affecting game seat capacity', async () => {
  const repository = createRepository([
    {
      id: 52,
      title: 'Catan',
      description: null,
      startsAt: '2026-04-05T16:00:00.000Z',
      organizerTelegramUserId: 42,
      createdByTelegramUserId: 42,
      tableId: null,
      durationMinutes: 180,
      capacity: 3,
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancelledByTelegramUserId: null,
      cancellationReason: null,
    },
  ]);

  await joinScheduleEvent({
    repository,
    eventId: 52,
    participantTelegramUserId: 42,
    actorTelegramUserId: 42,
  });

  const updated = await setScheduleEventParticipantSpectators({
    repository,
    eventId: 52,
    participantTelegramUserId: 42,
    actorTelegramUserId: 42,
    spectatorCount: 3,
  });
  assert.equal(updated.spectatorCount, 3);

  // Capacity still shows 1 occupied seat (the player), 2 available
  const snapshot = await getScheduleCapacitySnapshot({ repository, eventId: 52 });
  assert.equal(snapshot.occupiedSeats, 1);
  assert.equal(snapshot.availableSeats, 2);

  // Reject negative spectator count
  await assert.rejects(
    () =>
      setScheduleEventParticipantSpectators({
        repository,
        eventId: 52,
        participantTelegramUserId: 42,
        actorTelegramUserId: 42,
        spectatorCount: -1,
      }),
    /El nombre d'espectadors no pot ser negatiu/,
  );
});

test('setScheduleEventParticipantCompanions sets companionCount and occupies table seats', async () => {
  const repository = createRepository([
    {
      id: 53,
      title: 'Terraforming Mars',
      description: null,
      startsAt: '2026-04-05T16:00:00.000Z',
      organizerTelegramUserId: 42,
      createdByTelegramUserId: 42,
      tableId: null,
      durationMinutes: 180,
      capacity: 3,
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancelledByTelegramUserId: null,
      cancellationReason: null,
    },
  ]);

  await joinScheduleEvent({
    repository,
    eventId: 53,
    participantTelegramUserId: 42,
    actorTelegramUserId: 42,
  });

  // Player adds 1 companion: occupies 1 (self) + 1 (companion) = 2 seats
  const updated = await setScheduleEventParticipantCompanions({
    repository,
    eventId: 53,
    participantTelegramUserId: 42,
    actorTelegramUserId: 42,
    companionCount: 1,
  });
  assert.equal(updated.companionCount, 1);

  let snapshot = await getScheduleCapacitySnapshot({ repository, eventId: 53 });
  assert.equal(snapshot.occupiedSeats, 2);
  assert.equal(snapshot.availableSeats, 1);

  // Cannot add 2 more companions (would need 2 seats, only 1 available)
  await assert.rejects(
    () =>
      setScheduleEventParticipantCompanions({
        repository,
        eventId: 53,
        participantTelegramUserId: 42,
        actorTelegramUserId: 42,
        companionCount: 3,
      }),
    /No queden places lliures a la taula per afegir més acompanyants/,
  );

  // Switching player to spectator resets companionCount to 0 and frees all table seats
  const spectatorRecord = await setScheduleEventParticipantRole({
    repository,
    eventId: 53,
    participantTelegramUserId: 42,
    actorTelegramUserId: 42,
    role: 'spectator',
  });
  assert.equal(spectatorRecord.participationRole, 'spectator');
  assert.equal(spectatorRecord.companionCount, 0);

  snapshot = await getScheduleCapacitySnapshot({ repository, eventId: 53 });
  assert.equal(snapshot.occupiedSeats, 0);
  assert.equal(snapshot.availableSeats, 3);

  // Spectator cannot add companions to play
  await assert.rejects(
    () =>
      setScheduleEventParticipantCompanions({
        repository,
        eventId: 53,
        participantTelegramUserId: 42,
        actorTelegramUserId: 42,
        companionCount: 1,
      }),
    /Només els jugadors poden afegir acompanyants a jugar/,
  );
});

