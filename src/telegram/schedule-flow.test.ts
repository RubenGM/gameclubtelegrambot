import test from 'node:test';
import assert from 'node:assert/strict';

import type { ClubTableRecord, ClubTableRepository } from '../tables/table-catalog.js';
import type { ScheduleEventRecord, ScheduleParticipantRecord, ScheduleRepository } from '../schedule/schedule-catalog.js';
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

function createContext({
  scheduleRepository = createScheduleRepository(),
  tableRepository = createTableRepository(),
  actorTelegramUserId = 99,
  isAdmin = false,
}: {
  scheduleRepository?: ScheduleRepository;
  tableRepository?: ClubTableRepository;
  actorTelegramUserId?: number;
  isAdmin?: boolean;
} = {}) {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
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
  };

  return { context, replies, getCurrentSession: () => currentSession };
}

test('handleTelegramScheduleText opens the schedule menu from the keyboard action', async () => {
  const { context, replies } = createContext();
  context.messageText = scheduleLabels.openMenu;

  const handled = await handleTelegramScheduleText(context);

  assert.equal(handled, true);
  assert.deepEqual(replies.at(-1), {
    message: 'Gestio d activitats: tria una accio.',
    options: {
      replyKeyboard: [['Crear activitat', 'Editar activitat'], ['Cancel.lar activitat', '/start'], ['/help']],
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
  const { context, replies, getCurrentSession } = createContext({ scheduleRepository, tableRepository, actorTelegramUserId: 42 });

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
      capacity: 4,
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancelledByTelegramUserId: null,
      cancellationReason: null,
    },
  ]);
  const { context, getCurrentSession } = createContext({ scheduleRepository, actorTelegramUserId: 42 });

  context.callbackData = `${scheduleCallbackPrefixes.selectEdit}3`;
  const handled = await handleTelegramScheduleCallback(context);

  assert.equal(handled, true);
  assert.deepEqual(getCurrentSession(), { flowKey: 'schedule-edit', stepKey: 'title', data: { eventId: 3 } });
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
