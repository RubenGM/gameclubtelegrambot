import test from 'node:test';
import assert from 'node:assert/strict';

import type { AuditLogEventRecord, AuditLogRepository } from '../audit/audit-log.js';
import type { ClubTableRecord, ClubTableRepository } from '../tables/table-catalog.js';
import type { ScheduleEventRecord, ScheduleParticipantRecord, ScheduleRepository } from '../schedule/schedule-catalog.js';
import type { VenueEventRecord, VenueEventRepository } from '../venue-events/venue-event-catalog.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import type { ConversationSessionRecord } from './conversation-session.js';
import {
  handleTelegramScheduleCallback,
  handleTelegramScheduleText,
  scheduleCallbackPrefixes,
  scheduleLabels,
  type TelegramScheduleContext,
} from './schedule-flow.js';

function createScheduleRepository(initialEvents: ScheduleEventRecord[] = []): ScheduleRepository {
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
        durationMinutes: input.durationMinutes,
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
    async findEventById(eventId: number) {
      return events.get(eventId) ?? null;
    },
    async listEvents({ includeCancelled }) {
      return Array.from(events.values()).filter((event) => includeCancelled || event.lifecycleStatus === 'scheduled');
    },
    async updateEvent(input) {
      const existing = events.get(input.eventId);
      if (!existing) {
        throw new Error(`unknown event ${input.eventId}`);
      }
      const next: ScheduleEventRecord = {
        ...existing,
        title: input.title,
        description: input.description,
        startsAt: input.startsAt,
        organizerTelegramUserId: input.organizerTelegramUserId,
        tableId: input.tableId,
        durationMinutes: input.durationMinutes,
        capacity: input.capacity,
        updatedAt: '2026-04-04T11:00:00.000Z',
      };
      events.set(existing.id, next);
      return next;
    },
    async cancelEvent(input) {
      const existing = events.get(input.eventId);
      if (!existing) {
        throw new Error(`unknown event ${input.eventId}`);
      }
      const next: ScheduleEventRecord = {
        ...existing,
        lifecycleStatus: 'cancelled',
        cancelledAt: '2026-04-04T12:00:00.000Z',
        cancelledByTelegramUserId: input.actorTelegramUserId,
        cancellationReason: input.reason ?? null,
        updatedAt: '2026-04-04T12:00:00.000Z',
      };
      events.set(existing.id, next);
      return next;
    },
    async findParticipant(eventId: number, participantTelegramUserId: number) {
      return participants.get(`${eventId}:${participantTelegramUserId}`) ?? null;
    },
    async listParticipants(eventId: number) {
      return Array.from(participants.values()).filter((item) => item.scheduleEventId === eventId);
    },
    async upsertParticipant(input) {
      const key = `${input.eventId}:${input.participantTelegramUserId}`;
      const next: ScheduleParticipantRecord = {
        scheduleEventId: input.eventId,
        participantTelegramUserId: input.participantTelegramUserId,
        status: input.status,
        addedByTelegramUserId: input.actorTelegramUserId,
        removedByTelegramUserId: input.status === 'removed' ? input.actorTelegramUserId : null,
        joinedAt: '2026-04-04T10:30:00.000Z',
        updatedAt: '2026-04-04T10:30:00.000Z',
        leftAt: input.status === 'removed' ? '2026-04-04T10:40:00.000Z' : null,
      };
      participants.set(key, next);
      return next;
    },
  };
}

function createTableRepository(initialTables: ClubTableRecord[] = []): ClubTableRepository {
  const tables = new Map(initialTables.map((table) => [table.id, table]));
  return {
    async createTable() { throw new Error('not implemented'); },
    async findTableById(tableId: number) { return tables.get(tableId) ?? null; },
    async listTables({ includeDeactivated }) {
      return Array.from(tables.values()).filter((table) => includeDeactivated || table.lifecycleStatus === 'active');
    },
    async updateTable() { throw new Error('not implemented'); },
    async deactivateTable() { throw new Error('not implemented'); },
  };
}

function createVenueEventRepository(initialEvents: VenueEventRecord[] = []): VenueEventRepository {
  const events = new Map(initialEvents.map((event) => [event.id, event]));
  let nextId = Math.max(0, ...initialEvents.map((event) => event.id)) + 1;

  return {
    async createVenueEvent(input) {
      const createdAt = '2026-04-04T10:00:00.000Z';
      const next: VenueEventRecord = {
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
      events.set(next.id, next);
      return next;
    },
    async findVenueEventById(eventId: number) {
      return events.get(eventId) ?? null;
    },
    async listVenueEvents({ includeCancelled, startsAtFrom, endsAtTo }) {
      return Array.from(events.values()).filter((event) => {
        if (!includeCancelled && event.lifecycleStatus === 'cancelled') {
          return false;
        }
        if (startsAtFrom && event.endsAt < startsAtFrom) {
          return false;
        }
        if (endsAtTo && event.startsAt > endsAtTo) {
          return false;
        }
        return true;
      });
    },
    async updateVenueEvent(input) {
      const existing = events.get(input.eventId);
      if (!existing) throw new Error(`unknown venue event ${input.eventId}`);
      const next: VenueEventRecord = {
        ...existing,
        name: input.name,
        description: input.description,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        occupancyScope: input.occupancyScope,
        impactLevel: input.impactLevel,
        updatedAt: '2026-04-04T11:00:00.000Z',
      };
      events.set(next.id, next);
      return next;
    },
    async cancelVenueEvent(input) {
      const existing = events.get(input.eventId);
      if (!existing) throw new Error(`unknown venue event ${input.eventId}`);
      const next: VenueEventRecord = {
        ...existing,
        lifecycleStatus: 'cancelled',
        cancelledAt: '2026-04-04T12:00:00.000Z',
        cancellationReason: input.reason ?? null,
        updatedAt: '2026-04-04T12:00:00.000Z',
      };
      events.set(next.id, next);
      return next;
    },
  };
}

function createContext({
  scheduleRepository = createScheduleRepository(),
  tableRepository = createTableRepository(),
  venueEventRepository = createVenueEventRepository(),
  auditRepository = createAuditRepository(),
  actorTelegramUserId = 99,
  isAdmin = false,
}: {
  scheduleRepository?: ScheduleRepository;
  tableRepository?: ClubTableRepository;
  venueEventRepository?: VenueEventRepository;
  auditRepository?: AuditLogRepository;
  actorTelegramUserId?: number;
  isAdmin?: boolean;
} = {}) {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const privateMessages: Array<{ telegramUserId: number; message: string }> = [];
  let currentSession: { flowKey: string; stepKey: string; data: Record<string, unknown> } | null = null;

  const context: TelegramScheduleContext = {
    messageText: undefined,
    callbackData: undefined,
    reply: async (message: string, options?: TelegramReplyOptions) => {
      replies.push({ message, ...(options ? { options } : {}) });
    },
    runtime: {
      actor: {
        telegramUserId: actorTelegramUserId,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin,
        permissions: [],
      },
      authorization: {
        authorize: (permissionKey: string) => ({
          allowed: permissionKey === 'schedule.manage' && isAdmin,
          permissionKey,
          reason: isAdmin ? 'admin-override' : 'no-match',
        }),
        can: (permissionKey: string) => permissionKey === 'schedule.manage' && isAdmin,
      },
      session: {
        get current(): ConversationSessionRecord | null {
          if (!currentSession) {
            return null;
          }
          return {
            key: 'telegram.session:1:99',
            flowKey: currentSession.flowKey,
            stepKey: currentSession.stepKey,
            data: currentSession.data,
            createdAt: '2026-04-04T10:00:00.000Z',
            updatedAt: '2026-04-04T10:00:00.000Z',
            expiresAt: '2026-04-05T10:00:00.000Z',
          };
        },
        start: async ({ flowKey, stepKey, data = {} }) => {
          currentSession = { flowKey, stepKey, data };
          return context.runtime.session.current!;
        },
        advance: async ({ stepKey, data }) => {
          if (!currentSession) {
            throw new Error('no session');
          }
          currentSession = { flowKey: currentSession.flowKey, stepKey, data };
          return context.runtime.session.current!;
        },
        cancel: async () => {
          const hadSession = currentSession !== null;
          currentSession = null;
          return hadSession;
        },
      },
      chat: {
        kind: 'private',
        chatId: 1,
      },
      services: {
        database: { db: undefined as never },
      },
      bot: {
        publicName: 'Game Club Bot',
        clubName: 'Game Club',
        sendPrivateMessage: async () => {},
      },
    },
    scheduleRepository,
    tableRepository,
    venueEventRepository,
    auditRepository,
  };

  context.runtime.bot.sendPrivateMessage = async (telegramUserId: number, message: string) => {
    privateMessages.push({ telegramUserId, message });
  };

  return { context, replies, privateMessages, getCurrentSession: () => currentSession };
}

function createAuditRepository(): AuditLogRepository & { __events: AuditLogEventRecord[] } {
  const events: AuditLogEventRecord[] = [];

  return {
    async appendEvent(input) {
      events.push({
        actorTelegramUserId: input.actorTelegramUserId,
        actionKey: input.actionKey,
        targetType: input.targetType,
        targetId: input.targetId,
        summary: input.summary,
        details: input.details ?? null,
        createdAt: '2026-04-04T10:00:00.000Z',
      });
    },
    __events: events,
  };
}

test('handleTelegramScheduleText opens the schedule menu from the keyboard action', async () => {
  const { context, replies } = createContext();
  context.messageText = scheduleLabels.openMenu;

  const handled = await handleTelegramScheduleText(context);

  assert.equal(handled, true);
  assert.deepEqual(replies.at(-1), {
    message: 'Gestio d activitats: tria una accio.',
    options: {
      replyKeyboard: [['Veure activitats', 'Crear activitat'], ['Editar activitat', 'Cancel.lar activitat'], ['/start', '/help']],
      resizeKeyboard: true,
      persistentKeyboard: true,
    },
  });
});

test('handleTelegramScheduleText creates an activity through keyboard-guided conversation steps', async () => {
  const tableRepository = createTableRepository([
    {
      id: 7,
      displayName: 'Mesa TV',
      description: null,
      recommendedCapacity: 6,
      lifecycleStatus: 'active',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      deactivatedAt: null,
    },
  ]);
  const scheduleRepository = createScheduleRepository();
  const auditRepository = createAuditRepository();
  const { context, replies, getCurrentSession } = createContext({ scheduleRepository, tableRepository, auditRepository, actorTelegramUserId: 42 });

  context.messageText = scheduleLabels.create;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.deepEqual(getCurrentSession(), { flowKey: 'schedule-create', stepKey: 'title', data: {} });

  context.messageText = '  Dungeons & Dragons  ';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.deepEqual(getCurrentSession(), { flowKey: 'schedule-create', stepKey: 'description', data: { title: 'Dungeons & Dragons' } });

  context.messageText = scheduleLabels.skipOptional;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.deepEqual(getCurrentSession(), { flowKey: 'schedule-create', stepKey: 'date', data: { title: 'Dungeons & Dragons', description: null } });

  context.messageText = '2026-04-05';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.deepEqual(getCurrentSession(), { flowKey: 'schedule-create', stepKey: 'time', data: { title: 'Dungeons & Dragons', description: null, date: '2026-04-05' } });

  context.messageText = '16:00';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'duration');

  context.messageText = '180';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'capacity');

  context.messageText = '5';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'table');

  context.callbackData = `${scheduleCallbackPrefixes.tableSelection}7`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'confirm');

  context.messageText = scheduleLabels.confirmCreate;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /Activitat creada correctament: Dungeons & Dragons/);
  assert.match(replies.at(-1)?.message ?? '', /Mesa TV/);
  assert.match(replies.at(-1)?.message ?? '', /Assistents: 42/);
  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'schedule.created');
  assert.equal(auditRepository.__events.at(-1)?.targetType, 'schedule-event');
});

test('handleTelegramScheduleCallback records audit entries when an admin cancels an activity', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 21,
      title: 'Terraforming Mars',
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
    },
  ]);
  const auditRepository = createAuditRepository();
  const { context } = createContext({ scheduleRepository, auditRepository, actorTelegramUserId: 99, isAdmin: true });

  context.callbackData = `${scheduleCallbackPrefixes.selectCancel}21`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  delete context.callbackData;
  context.messageText = scheduleLabels.confirmCancel;
  assert.equal(await handleTelegramScheduleText(context), true);

  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'schedule.cancelled');
  assert.equal(auditRepository.__events.at(-1)?.actorTelegramUserId, 99);
});

test('handleTelegramScheduleCallback rejects selecting a deactivated table for a new activity', async () => {
  const tableRepository = createTableRepository([
    {
      id: 7,
      displayName: 'Mesa TV',
      description: null,
      recommendedCapacity: 6,
      lifecycleStatus: 'deactivated',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T11:00:00.000Z',
      deactivatedAt: '2026-04-04T11:00:00.000Z',
    },
  ]);
  const { context, replies, getCurrentSession } = createContext({ tableRepository, actorTelegramUserId: 42 });

  context.messageText = scheduleLabels.create;
  await handleTelegramScheduleText(context);
  context.messageText = 'Root';
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.skipOptional;
  await handleTelegramScheduleText(context);
  context.messageText = '2026-04-05';
  await handleTelegramScheduleText(context);
  context.messageText = '16:00';
  await handleTelegramScheduleText(context);
  context.messageText = '180';
  await handleTelegramScheduleText(context);
  context.messageText = '5';
  await handleTelegramScheduleText(context);

  context.callbackData = `${scheduleCallbackPrefixes.tableSelection}7`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'table');
  assert.equal(replies.at(-1)?.message, 'La taula seleccionada ja no esta activa. Tria una taula activa o continua sense taula.');
});

test('handleTelegramScheduleCallback keeps showing deactivated table names for historical activity views', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 18,
      title: 'Brass',
      description: null,
      startsAt: '2026-04-05T16:00:00.000Z',
      organizerTelegramUserId: 42,
      createdByTelegramUserId: 42,
      tableId: 9,
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
  await scheduleRepository.upsertParticipant({ eventId: 18, participantTelegramUserId: 42, actorTelegramUserId: 42, status: 'active' });
  const tableRepository = createTableRepository([
    {
      id: 9,
      displayName: 'Mesa arxiu',
      description: null,
      recommendedCapacity: 4,
      lifecycleStatus: 'deactivated',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T11:00:00.000Z',
      deactivatedAt: '2026-04-04T11:00:00.000Z',
    },
  ]);
  const { context, replies } = createContext({ scheduleRepository, tableRepository, actorTelegramUserId: 77 });

  context.callbackData = `${scheduleCallbackPrefixes.inspect}18`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Taula: Mesa arxiu/);
});

test('handleTelegramScheduleText shows advisory warning when requested capacity exceeds the selected table recommendation', async () => {
  const tableRepository = createTableRepository([
    {
      id: 7,
      displayName: 'Mesa TV',
      description: null,
      recommendedCapacity: 4,
      lifecycleStatus: 'active',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      deactivatedAt: null,
    },
  ]);
  const { context, replies } = createContext({ tableRepository, actorTelegramUserId: 42 });

  context.messageText = scheduleLabels.create;
  await handleTelegramScheduleText(context);
  context.messageText = 'Root';
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.skipOptional;
  await handleTelegramScheduleText(context);
  context.messageText = '2026-04-05';
  await handleTelegramScheduleText(context);
  context.messageText = '16:00';
  await handleTelegramScheduleText(context);
  context.messageText = '180';
  await handleTelegramScheduleText(context);
  context.messageText = '6';
  await handleTelegramScheduleText(context);
  context.callbackData = `${scheduleCallbackPrefixes.tableSelection}7`;

  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /supera la capacitat recomanada de la taula \(4\)/);
  assert.match(replies.at(-1)?.message ?? '', /no bloqueja la reserva/);
});

test('handleTelegramScheduleText lists activities with inline detail actions for members', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 4,
      title: 'Wingspan',
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
  await scheduleRepository.upsertParticipant({
    eventId: 4,
    participantTelegramUserId: 42,
    actorTelegramUserId: 42,
    status: 'active',
  });
  const { context, replies } = createContext({ scheduleRepository, actorTelegramUserId: 77 });
  context.messageText = scheduleLabels.list;

  const handled = await handleTelegramScheduleText(context);

  assert.equal(handled, true);
  assert.equal(replies.at(-1)?.message, 'Activitats disponibles:\n- Wingspan (2026-04-05 16:00)');
  assert.deepEqual(replies.at(-1)?.options, {
    inlineKeyboard: [[{ text: 'Veure Wingspan', callbackData: 'schedule:inspect:4' }]],
  });
});

test('handleTelegramScheduleText includes venue impact hints in the activity list when the local is affected', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 14,
      title: 'Wingspan',
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
  const venueEventRepository = createVenueEventRepository([
    {
      id: 1,
      name: 'Campionat regional',
      description: null,
      startsAt: '2026-04-05T15:00:00.000Z',
      endsAt: '2026-04-05T21:00:00.000Z',
      occupancyScope: 'full',
      impactLevel: 'high',
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancellationReason: null,
    },
  ]);
  const { context, replies } = createContext({ scheduleRepository, venueEventRepository, actorTelegramUserId: 77 });
  context.messageText = scheduleLabels.list;

  assert.equal(await handleTelegramScheduleText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Impacte local: Campionat regional \(ocupacio full, impacte high\)/);
});

test('handleTelegramScheduleCallback shows activity attendance and allows joining when seats remain', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 6,
      title: 'Azul',
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
  await scheduleRepository.upsertParticipant({ eventId: 6, participantTelegramUserId: 42, actorTelegramUserId: 42, status: 'active' });
  const { context, replies } = createContext({ scheduleRepository, actorTelegramUserId: 77 });
  context.callbackData = `${scheduleCallbackPrefixes.inspect}6`;

  const handled = await handleTelegramScheduleCallback(context);

  assert.equal(handled, true);
  assert.match(replies.at(-1)?.message ?? '', /Assistents: 42/);
  assert.match(replies.at(-1)?.message ?? '', /Places ocupades: 1\/3/);
  assert.deepEqual(replies.at(-1)?.options, {
    inlineKeyboard: [[{ text: 'Apuntar-me', callbackData: 'schedule:join:6' }]],
  });
});

test('handleTelegramScheduleCallback shows overlapping venue event context in the schedule detail view', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 16,
      title: 'Azul',
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
  await scheduleRepository.upsertParticipant({ eventId: 16, participantTelegramUserId: 42, actorTelegramUserId: 42, status: 'active' });
  const venueEventRepository = createVenueEventRepository([
    {
      id: 2,
      name: 'Campionat regional',
      description: 'Afecta gran part del local',
      startsAt: '2026-04-05T15:00:00.000Z',
      endsAt: '2026-04-05T21:00:00.000Z',
      occupancyScope: 'full',
      impactLevel: 'high',
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancellationReason: null,
    },
  ]);
  const { context, replies } = createContext({ scheduleRepository, venueEventRepository, actorTelegramUserId: 77 });
  context.callbackData = `${scheduleCallbackPrefixes.inspect}16`;

  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Esdeveniments del local rellevants:/);
  assert.match(replies.at(-1)?.message ?? '', /Campionat regional/);
  assert.match(replies.at(-1)?.message ?? '', /ocupacio full, impacte high/);
  assert.match(replies.at(-1)?.message ?? '', /Aixo no bloqueja automaticament l activitat/);
});

test('handleTelegramScheduleCallback joins and leaves an activity updating attendance immediately', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 12,
      title: 'Root',
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
  await scheduleRepository.upsertParticipant({ eventId: 12, participantTelegramUserId: 42, actorTelegramUserId: 42, status: 'active' });
  const { context, replies } = createContext({ scheduleRepository, actorTelegramUserId: 77 });

  context.callbackData = `${scheduleCallbackPrefixes.join}12`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /T has apuntat correctament a Root/);
  assert.match(replies.at(-1)?.message ?? '', /Assistents: 42, 77/);

  context.callbackData = `${scheduleCallbackPrefixes.leave}12`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Has sortit correctament de Root/);
  assert.match(replies.at(-1)?.message ?? '', /Assistents: 42/);
});

test('handleTelegramScheduleCallback lets an organizer edit their own activity', async () => {
  const scheduleRepository = createScheduleRepository([
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
  const auditRepository = createAuditRepository();
  const { context, getCurrentSession } = createContext({ scheduleRepository, auditRepository, actorTelegramUserId: 42 });

  context.callbackData = `${scheduleCallbackPrefixes.selectEdit}3`;
  const handled = await handleTelegramScheduleCallback(context);

  assert.equal(handled, true);
  assert.deepEqual(getCurrentSession(), { flowKey: 'schedule-edit', stepKey: 'title', data: { eventId: 3 } });

  delete context.callbackData;
  context.messageText = 'Root Deluxe';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = scheduleLabels.skipOptional;
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = '2026-04-06';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = '17:30';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = '240';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = '5';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = scheduleLabels.noTable;
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = scheduleLabels.confirmEdit;
  assert.equal(await handleTelegramScheduleText(context), true);

  assert.equal((await scheduleRepository.findEventById(3))?.title, 'Root Deluxe');
  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'schedule.updated');
  assert.equal(auditRepository.__events.at(-1)?.targetId, '3');
});

test('handleTelegramScheduleCallback denies editing foreign activities to non-admins', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 5,
      title: 'Brass',
      description: null,
      startsAt: '2026-04-05T16:00:00.000Z',
      organizerTelegramUserId: 11,
      createdByTelegramUserId: 11,
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
  const { context, replies } = createContext({ scheduleRepository, actorTelegramUserId: 42, isAdmin: false });

  context.callbackData = `${scheduleCallbackPrefixes.selectEdit}5`;
  const handled = await handleTelegramScheduleCallback(context);

  assert.equal(handled, true);
  assert.equal(replies.at(-1)?.message, 'No pots modificar una activitat creada per una altra persona.');
});

test('handleTelegramScheduleCallback allows admins to cancel foreign activities with confirmation', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 8,
      title: 'Ark Nova',
      description: null,
      startsAt: '2026-04-05T16:00:00.000Z',
      organizerTelegramUserId: 11,
      createdByTelegramUserId: 11,
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
  const { context, getCurrentSession, replies } = createContext({ scheduleRepository, actorTelegramUserId: 99, isAdmin: true });

  context.callbackData = `${scheduleCallbackPrefixes.selectCancel}8`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.deepEqual(getCurrentSession(), { flowKey: 'schedule-cancel', stepKey: 'confirm', data: { eventId: 8 } });

  context.messageText = scheduleLabels.confirmCancel;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /Activitat cancel.lada correctament: Ark Nova/);
});

test('handleTelegramScheduleText sends private conflict notifications after creating an overlapping activity', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 30,
      title: 'Terraforming Mars',
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
  await scheduleRepository.upsertParticipant({ eventId: 30, participantTelegramUserId: 42, actorTelegramUserId: 42, status: 'active' });
  await scheduleRepository.upsertParticipant({ eventId: 30, participantTelegramUserId: 55, actorTelegramUserId: 55, status: 'active' });
  const { context, privateMessages } = createContext({ scheduleRepository, actorTelegramUserId: 77 });

  context.messageText = scheduleLabels.create;
  await handleTelegramScheduleText(context);
  context.messageText = 'Ark Nova';
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.skipOptional;
  await handleTelegramScheduleText(context);
  context.messageText = '2026-04-05';
  await handleTelegramScheduleText(context);
  context.messageText = '17:00';
  await handleTelegramScheduleText(context);
  context.messageText = '120';
  await handleTelegramScheduleText(context);
  context.messageText = '4';
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.noTable;
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.confirmCreate;
  await handleTelegramScheduleText(context);

  assert.deepEqual(privateMessages.map((item) => item.telegramUserId).sort((a, b) => a - b), [42, 55]);
  assert.match(privateMessages[0]?.message ?? '', /possible conflicte/);
  assert.match(privateMessages[0]?.message ?? '', /Ark Nova/);
  assert.match(privateMessages[0]?.message ?? '', /Terraforming Mars/);
});

test('handleTelegramScheduleText sends private conflict notifications after editing into an overlap', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 40,
      title: 'Gaia Project',
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
    {
      id: 41,
      title: 'Catan',
      description: null,
      startsAt: '2026-04-05T20:00:00.000Z',
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
  await scheduleRepository.upsertParticipant({ eventId: 40, participantTelegramUserId: 42, actorTelegramUserId: 42, status: 'active' });
  await scheduleRepository.upsertParticipant({ eventId: 40, participantTelegramUserId: 55, actorTelegramUserId: 55, status: 'active' });
  const { context, privateMessages } = createContext({ scheduleRepository, actorTelegramUserId: 77 });

  context.callbackData = `${scheduleCallbackPrefixes.selectEdit}41`;
  await handleTelegramScheduleCallback(context);
  context.messageText = scheduleLabels.keepCurrent;
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.keepCurrent;
  await handleTelegramScheduleText(context);
  context.messageText = '2026-04-05';
  await handleTelegramScheduleText(context);
  context.messageText = '17:00';
  await handleTelegramScheduleText(context);
  context.messageText = '180';
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.keepCurrent;
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.keepCurrent;
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.confirmEdit;
  await handleTelegramScheduleText(context);

  assert.deepEqual(privateMessages.map((item) => item.telegramUserId).sort((a, b) => a - b), [42, 55]);
  assert.match(privateMessages[0]?.message ?? '', /possible conflicte/);
  assert.match(privateMessages[0]?.message ?? '', /Catan/);
  assert.match(privateMessages[0]?.message ?? '', /Gaia Project/);
});
