import test from 'node:test';
import assert from 'node:assert/strict';

import type {
  CreateRoleGameMemberInput,
  CreateRoleGameSessionLinkInput,
  RoleGameMemberRecord,
  RoleGameRecord,
  RoleGameRepository,
  RoleGameSessionRecord,
} from './role-game-catalog.js';
import type {
  ScheduleEventRecord,
  ScheduleParticipantRecord,
  ScheduleRepository,
} from '../schedule/schedule-catalog.js';
import {
  computeUpcomingRoleGameOccurrences,
  createManualRoleGameSession,
  ensureRecurringRoleGameSessions,
} from './role-game-scheduler.js';

test('createManualRoleGameSession creates an Agenda event with game defaults', async () => {
  const roleGameRepository = createMemoryRoleGameRepository();
  const scheduleRepository = createMemoryScheduleRepository();
  const game = sampleGame({ title: 'Blades', defaultDurationMinutes: 150, capacity: 4 });

  const session = await createManualRoleGameSession({
    roleGameRepository,
    scheduleRepository,
    game,
    startsAt: '2026-08-06T18:00:00.000+02:00',
    actorTelegramUserId: 42,
  });

  assert.equal(session.event.title, 'Blades');
  assert.equal(session.event.description, 'Una partida lista para jugar.');
  assert.equal(session.event.durationMinutes, 150);
  assert.equal(session.event.organizerTelegramUserId, game.primaryGmTelegramUserId);
  assert.equal(session.event.createdByTelegramUserId, 42);
  assert.equal(session.event.tableId, game.defaultTableId);
  assert.equal(session.event.attendanceMode, game.defaultAttendanceMode);
  assert.equal(session.event.isPublic, game.defaultIsPublicScheduleEvent);
  assert.equal(session.event.capacity, game.capacity);
  assert.equal(session.link.roleGameId, game.id);
  assert.equal(session.link.scheduleEventId, session.event.id);
  assert.equal(session.link.source, 'manual');
});

test('createManualRoleGameSession auto-adds confirmed players to the Agenda event', async () => {
  const game = sampleGame({ id: 9, autoAddConfirmedPlayers: true });
  const members = [
    sampleMember({ id: 1, roleGameId: game.id, telegramUserId: 42, role: 'primary_gm', status: 'confirmed' }),
    sampleMember({ id: 2, roleGameId: game.id, telegramUserId: 77, role: 'player', status: 'confirmed' }),
    sampleMember({ id: 3, roleGameId: game.id, telegramUserId: 88, role: 'player', status: 'requested' }),
    sampleMember({ id: 4, roleGameId: game.id, telegramUserId: 99, role: 'coorganizer', status: 'confirmed' }),
  ];
  const roleGameRepository = createMemoryRoleGameRepository({ membersByGameId: new Map([[game.id, members]]) });
  const scheduleRepository = createMemoryScheduleRepository();

  const session = await createManualRoleGameSession({
    roleGameRepository,
    scheduleRepository,
    game,
    startsAt: '2026-08-06T18:00:00.000+02:00',
    actorTelegramUserId: 42,
  });

  const participants = await scheduleRepository.listParticipants(session.event.id);
  assert.deepEqual(participants.map((participant) => participant.participantTelegramUserId).sort((a, b) => a - b), [77]);
  assert.equal(participants[0]?.addedByTelegramUserId, 42);
});

test('createManualRoleGameSession auto-adds confirmed players only up to event capacity', async () => {
  const game = sampleGame({ id: 10, capacity: 2, autoAddConfirmedPlayers: true });
  const members = [
    sampleMember({ id: 1, roleGameId: game.id, telegramUserId: 77, role: 'player', status: 'confirmed' }),
    sampleMember({ id: 2, roleGameId: game.id, telegramUserId: 88, role: 'player', status: 'confirmed' }),
    sampleMember({ id: 3, roleGameId: game.id, telegramUserId: 99, role: 'player', status: 'confirmed' }),
  ];
  const roleGameRepository = createMemoryRoleGameRepository({ membersByGameId: new Map([[game.id, members]]) });
  const scheduleRepository = createMemoryScheduleRepository();

  const session = await createManualRoleGameSession({
    roleGameRepository,
    scheduleRepository,
    game,
    startsAt: '2026-08-06T18:00:00.000+02:00',
    actorTelegramUserId: 42,
  });

  const participants = await scheduleRepository.listParticipants(session.event.id);
  assert.deepEqual(participants.map((participant) => participant.participantTelegramUserId).sort((a, b) => a - b), [77, 88]);
});

test('computeUpcomingRoleGameOccurrences returns weekly Thursday sessions at 18:00', () => {
  const occurrences = computeUpcomingRoleGameOccurrences({
    rule: { intervalWeeks: 1, weekday: 4, time: '18:00' },
    now: new Date(2026, 6, 9, 17, 0),
    count: 3,
  });

  assert.deepEqual(occurrences, [
    new Date(2026, 6, 9, 18, 0).toISOString(),
    new Date(2026, 6, 16, 18, 0).toISOString(),
    new Date(2026, 6, 23, 18, 0).toISOString(),
  ]);
});

test('computeUpcomingRoleGameOccurrences skips alternating weeks for biweekly Wednesday sessions', () => {
  const occurrences = computeUpcomingRoleGameOccurrences({
    rule: { intervalWeeks: 2, weekday: 3, time: '18:30' },
    now: new Date(2026, 6, 9, 17, 0),
    count: 3,
  });

  assert.deepEqual(occurrences, [
    new Date(2026, 6, 15, 18, 30).toISOString(),
    new Date(2026, 6, 29, 18, 30).toISOString(),
    new Date(2026, 7, 12, 18, 30).toISOString(),
  ]);
});

test('ensureRecurringRoleGameSessions maintains the configured future window count', async () => {
  const roleGameRepository = createMemoryRoleGameRepository();
  const scheduleRepository = createMemoryScheduleRepository();
  const game = sampleGame({
    schedulingMode: 'recurring',
    recurrenceRule: { intervalWeeks: 1, weekday: 4, time: '18:00' },
    recurrenceWindowCount: 3,
  });

  const result = await ensureRecurringRoleGameSessions({
    roleGameRepository,
    scheduleRepository,
    game,
    actorTelegramUserId: 42,
    now: new Date(2026, 6, 9, 17, 0),
  });

  assert.deepEqual(result, { created: 3, skipped: 0 });
  const links = await roleGameRepository.listSessionLinks(game.id);
  assert.deepEqual(links.map((link) => link.generatedForStartsAt), [
    new Date(2026, 6, 9, 18, 0).toISOString(),
    new Date(2026, 6, 16, 18, 0).toISOString(),
    new Date(2026, 6, 23, 18, 0).toISOString(),
  ]);
  assert.deepEqual((await scheduleRepository.listEvents({ includeCancelled: true })).map((event) => event.startsAt), [
    new Date(2026, 6, 9, 18, 0).toISOString(),
    new Date(2026, 6, 16, 18, 0).toISOString(),
    new Date(2026, 6, 23, 18, 0).toISOString(),
  ]);
});

test('ensureRecurringRoleGameSessions counts matching future manual sessions instead of duplicating them', async () => {
  const manualOccurrence = new Date(2026, 6, 9, 18, 0).toISOString();
  const roleGameRepository = createMemoryRoleGameRepository({
    sessionLinks: [
      sampleSessionLink({
        id: 1,
        scheduleEventId: 1,
        source: 'manual',
        generatedForStartsAt: null,
      }),
    ],
  });
  const scheduleRepository = createMemoryScheduleRepository({
    events: [sampleScheduleEvent({ id: 1, startsAt: manualOccurrence })],
  });
  const game = sampleGame({
    schedulingMode: 'recurring',
    recurrenceRule: { intervalWeeks: 1, weekday: 4, time: '18:00' },
    recurrenceWindowCount: 2,
  });

  const result = await ensureRecurringRoleGameSessions({
    roleGameRepository,
    scheduleRepository,
    game,
    actorTelegramUserId: 42,
    now: new Date(2026, 6, 9, 17, 0),
  });

  assert.deepEqual(result, { created: 1, skipped: 0 });
  const events = await scheduleRepository.listEvents({ includeCancelled: true });
  assert.deepEqual(events.map((event) => event.startsAt), [
    manualOccurrence,
    new Date(2026, 6, 16, 18, 0).toISOString(),
  ]);
});

test('ensureRecurringRoleGameSessions skips cancelled linked sessions without recreating them', async () => {
  const firstOccurrence = new Date(2026, 6, 9, 18, 0).toISOString();
  const cancelledOccurrence = new Date(2026, 6, 16, 18, 0).toISOString();
  const roleGameRepository = createMemoryRoleGameRepository({
    sessionLinks: [
      sampleSessionLink({ id: 1, scheduleEventId: 1, generatedForStartsAt: firstOccurrence }),
      sampleSessionLink({ id: 2, scheduleEventId: 2, generatedForStartsAt: cancelledOccurrence }),
    ],
  });
  const scheduleRepository = createMemoryScheduleRepository({
    events: [
      sampleScheduleEvent({ id: 1, startsAt: firstOccurrence }),
      sampleScheduleEvent({
        id: 2,
        startsAt: cancelledOccurrence,
        lifecycleStatus: 'cancelled',
        cancelledAt: '2026-07-10T10:00:00.000Z',
        cancelledByTelegramUserId: 42,
        cancellationReason: 'No se juega',
      }),
    ],
  });
  const game = sampleGame({
    schedulingMode: 'recurring',
    recurrenceRule: { intervalWeeks: 1, weekday: 4, time: '18:00' },
    recurrenceWindowCount: 3,
  });

  const result = await ensureRecurringRoleGameSessions({
    roleGameRepository,
    scheduleRepository,
    game,
    actorTelegramUserId: 42,
    now: new Date(2026, 6, 9, 17, 0),
  });

  assert.deepEqual(result, { created: 2, skipped: 1 });
  const links = await roleGameRepository.listSessionLinks(game.id);
  assert.equal(links.filter((link) => link.generatedForStartsAt === cancelledOccurrence).length, 1);
  assert.deepEqual(links.map((link) => link.generatedForStartsAt), [
    firstOccurrence,
    cancelledOccurrence,
    new Date(2026, 6, 23, 18, 0).toISOString(),
    new Date(2026, 6, 30, 18, 0).toISOString(),
  ]);
});

function createMemoryRoleGameRepository({
  membersByGameId = new Map<number, RoleGameMemberRecord[]>(),
  sessionLinks: initialSessionLinks = [],
}: {
  membersByGameId?: Map<number, RoleGameMemberRecord[]>;
  sessionLinks?: RoleGameSessionRecord[];
} = {}): RoleGameRepository {
  const sessionLinks: RoleGameSessionRecord[] = [...initialSessionLinks];
  return {
    createGame: async () => {
      throw new Error('not implemented in this test');
    },
    findGameById: async () => null,
    updateGame: async () => {
      throw new Error('not implemented in this test');
    },
    listVisibleGames: async () => [],
    listGamesForUser: async () => [],
    createOrUpdateMember: async () => {
      throw new Error('not implemented in this test');
    },
    findMember: async () => null,
    findMemberByTelegramUserId: async () => null,
    findMemberById: async () => null,
    listMembers: async (gameId) => membersByGameId.get(gameId) ?? [],
    countConfirmedPlayers: async () => 0,
    createMember: async (input: CreateRoleGameMemberInput) => sampleMember({ ...input, id: 1 }),
    createSessionLink: async (input: CreateRoleGameSessionLinkInput) => {
      const link = {
        id: Math.max(0, ...sessionLinks.map((sessionLink) => sessionLink.id)) + 1,
        ...input,
        createdAt: '2026-07-09T10:00:00.000Z',
      };
      sessionLinks.push(link);
      return link;
    },
    listSessionLinks: async () => sessionLinks,
    createMaterial: async () => {
      throw new Error('not implemented in this test');
    },
    findMaterialById: async () => null,
    listMaterials: async () => [],
    updateMaterialVisibility: async () => {
      throw new Error('not implemented in this test');
    },
    createMaterialDelivery: async () => {
      throw new Error('not implemented in this test');
    },
    requestSeat: async () => {
      throw new Error('not implemented in this test');
    },
    confirmMemberSeat: async () => {
      throw new Error('not implemented in this test');
    },
    setMemberRole: async () => {
      throw new Error('not implemented in this test');
    },
    setMemberStatus: async () => {
      throw new Error('not implemented in this test');
    },
  };
}

function createMemoryScheduleRepository({
  events: initialEvents = [],
}: {
  events?: ScheduleEventRecord[];
} = {}): ScheduleRepository {
  const events = new Map<number, ScheduleEventRecord>(initialEvents.map((event) => [event.id, event]));
  const participants = new Map<string, ScheduleParticipantRecord>();
  let nextEventId = Math.max(0, ...initialEvents.map((event) => event.id)) + 1;
  return {
    createEvent: async (input) => {
      const createdAt = '2026-07-09T10:00:00.000Z';
      const event: ScheduleEventRecord = {
        id: nextEventId,
        ...input,
        detailsMessageChatId: input.detailsMessageChatId ?? null,
        detailsMessageId: input.detailsMessageId ?? null,
        catalogItemId: input.catalogItemId ?? null,
        lifecycleStatus: 'scheduled',
        createdAt,
        updatedAt: createdAt,
        cancelledAt: null,
        cancelledByTelegramUserId: null,
        cancellationReason: null,
      };
      nextEventId += 1;
      events.set(event.id, event);
      return event;
    },
    findEventById: async (eventId) => events.get(eventId) ?? null,
    listEvents: async (input) =>
      Array.from(events.values()).filter((event) => input.includeCancelled || event.lifecycleStatus !== 'cancelled'),
    updateEvent: async () => {
      throw new Error('not implemented in this test');
    },
    cancelEvent: async () => {
      throw new Error('not implemented in this test');
    },
    findParticipant: async (eventId, participantTelegramUserId) => participants.get(`${eventId}:${participantTelegramUserId}`) ?? null,
    listParticipants: async (eventId) =>
      Array.from(participants.values()).filter((participant) => participant.scheduleEventId === eventId),
    upsertParticipant: async (input) => {
      const existing = participants.get(`${input.eventId}:${input.participantTelegramUserId}`);
      const participant: ScheduleParticipantRecord = {
        scheduleEventId: input.eventId,
        participantTelegramUserId: input.participantTelegramUserId,
        status: input.status,
        addedByTelegramUserId: existing?.addedByTelegramUserId ?? input.actorTelegramUserId,
        removedByTelegramUserId: input.status === 'removed' ? input.actorTelegramUserId : null,
        joinedAt: existing?.joinedAt ?? '2026-07-09T10:00:00.000Z',
        updatedAt: '2026-07-09T10:00:00.000Z',
        leftAt: input.status === 'removed' ? '2026-07-09T10:00:00.000Z' : null,
      };
      participants.set(`${input.eventId}:${input.participantTelegramUserId}`, participant);
      return participant;
    },
  };
}

function sampleSessionLink(overrides: Partial<RoleGameSessionRecord> = {}): RoleGameSessionRecord {
  return {
    id: 1,
    roleGameId: 1,
    scheduleEventId: 1,
    source: 'recurring',
    generatedForStartsAt: '2026-07-09T16:00:00.000Z',
    createdByTelegramUserId: 42,
    createdAt: '2026-07-09T10:00:00.000Z',
    ...overrides,
  };
}

function sampleScheduleEvent(overrides: Partial<ScheduleEventRecord> = {}): ScheduleEventRecord {
  return {
    id: 1,
    title: 'Partida de prueba',
    description: 'Una partida lista para jugar.',
    detailsMessageChatId: null,
    detailsMessageId: null,
    startsAt: '2026-07-09T16:00:00.000Z',
    durationMinutes: 180,
    organizerTelegramUserId: 42,
    createdByTelegramUserId: 42,
    tableId: 3,
    attendanceMode: 'closed',
    isPublic: false,
    initialOccupiedSeats: 0,
    capacity: 5,
    lifecycleStatus: 'scheduled',
    createdAt: '2026-07-09T10:00:00.000Z',
    updatedAt: '2026-07-09T10:00:00.000Z',
    cancelledAt: null,
    cancelledByTelegramUserId: null,
    cancellationReason: null,
    ...overrides,
  };
}

function sampleGame(overrides: Partial<RoleGameRecord> = {}): RoleGameRecord {
  return {
    id: 1,
    type: 'campaign',
    status: 'active',
    title: 'Partida de prueba',
    system: 'Dungeons & Dragons',
    description: 'Una partida lista para jugar.',
    visibility: 'members',
    publicJoinPolicy: 'members_only',
    entryMode: 'request',
    acceptanceMode: 'manual_review',
    capacity: 5,
    primaryGmTelegramUserId: 42,
    defaultDurationMinutes: 180,
    defaultTableId: 3,
    defaultAttendanceMode: 'closed',
    defaultIsPublicScheduleEvent: false,
    autoAddConfirmedPlayers: true,
    allowPlayerManualScheduling: false,
    schedulingMode: 'manual',
    recurrenceRule: null,
    recurrenceWindowCount: 0,
    createdByTelegramUserId: 42,
    createdAt: '2026-07-09T10:00:00.000Z',
    updatedAt: '2026-07-09T10:00:00.000Z',
    closedAt: null,
    ...overrides,
  };
}

function sampleMember(overrides: Partial<RoleGameMemberRecord> = {}): RoleGameMemberRecord {
  return {
    id: 1,
    roleGameId: 1,
    telegramUserId: 77,
    role: 'player',
    status: 'confirmed',
    isExternal: false,
    characterName: null,
    playerNote: null,
    requestedByTelegramUserId: 77,
    createdAt: '2026-07-09T10:00:00.000Z',
    updatedAt: '2026-07-09T10:00:00.000Z',
    ...overrides,
  };
}
