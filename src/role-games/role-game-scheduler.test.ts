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
import { createManualRoleGameSession } from './role-game-scheduler.js';

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

function createMemoryRoleGameRepository({
  membersByGameId = new Map<number, RoleGameMemberRecord[]>(),
}: {
  membersByGameId?: Map<number, RoleGameMemberRecord[]>;
} = {}): RoleGameRepository {
  const sessionLinks: RoleGameSessionRecord[] = [];
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
        id: sessionLinks.length + 1,
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
    updateMaterialVisibility: async () => {
      throw new Error('not implemented in this test');
    },
    createMaterialDelivery: async () => {
      throw new Error('not implemented in this test');
    },
    requestSeat: async () => {
      throw new Error('not implemented in this test');
    },
    setMemberStatus: async () => {
      throw new Error('not implemented in this test');
    },
  };
}

function createMemoryScheduleRepository(): ScheduleRepository {
  const events = new Map<number, ScheduleEventRecord>();
  const participants = new Map<string, ScheduleParticipantRecord>();
  let nextEventId = 1;
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
    listEvents: async () => Array.from(events.values()),
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
