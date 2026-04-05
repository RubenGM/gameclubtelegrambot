import test from 'node:test';
import assert from 'node:assert/strict';

import type { TelegramReplyOptions } from './runtime-boundary.js';
import type { ConversationSessionRecord } from './conversation-session.js';
import type { VenueEventRecord, VenueEventRepository } from '../venue-events/venue-event-catalog.js';
import type { ScheduleRepository } from '../schedule/schedule-catalog.js';
import {
  handleTelegramVenueEventAdminCallback,
  handleTelegramVenueEventAdminStartText,
  handleTelegramVenueEventAdminText,
  venueEventAdminCallbackPrefixes,
  venueEventAdminLabels,
  type TelegramVenueEventAdminContext,
} from './venue-event-admin-flow.js';

function createVenueEventRepository(initialEvents: VenueEventRecord[] = []): VenueEventRepository {
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
    async findVenueEventById(eventId: number) {
      return events.get(eventId) ?? null;
    },
    async listVenueEvents({ includeCancelled }) {
      return Array.from(events.values()).filter((event) => includeCancelled || event.lifecycleStatus === 'scheduled');
    },
    async updateVenueEvent(input) {
      const existing = events.get(input.eventId);
      if (!existing) throw new Error(`unknown venue event ${input.eventId}`);
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
      if (!existing) throw new Error(`unknown venue event ${input.eventId}`);
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

function createEmptyScheduleRepository(): ScheduleRepository {
  return {
    async createEvent() { throw new Error('not implemented'); },
    async findEventById() { return null; },
    async listEvents() { return []; },
    async updateEvent() { throw new Error('not implemented'); },
    async cancelEvent() { throw new Error('not implemented'); },
    async findParticipant() { return null; },
    async listParticipants() { return []; },
    async upsertParticipant() { throw new Error('not implemented'); },
  };
}

function createContext({
  venueEventRepository = createVenueEventRepository(),
  scheduleRepository = createEmptyScheduleRepository(),
  isAdmin = true,
}: {
  venueEventRepository?: VenueEventRepository;
  scheduleRepository?: ScheduleRepository;
  isAdmin?: boolean;
} = {}) {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const privateMessages: Array<{ telegramUserId: number; message: string }> = [];
  let currentSession: { flowKey: string; stepKey: string; data: Record<string, unknown> } | null = null;

  const context: TelegramVenueEventAdminContext = {
    messageText: undefined,
    callbackData: undefined,
    reply: async (message: string, options?: TelegramReplyOptions) => {
      replies.push({ message, ...(options ? { options } : {}) });
    },
    runtime: {
      actor: {
        telegramUserId: 99,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin,
        permissions: [],
      },
      authorization: {
        authorize: (permissionKey: string) => ({
          allowed: permissionKey === 'venue_event.manage' && isAdmin,
          permissionKey,
          reason: isAdmin ? 'admin-override' : 'no-match',
        }),
        can: (permissionKey: string) => permissionKey === 'venue_event.manage' && isAdmin,
      },
      session: {
        get current(): ConversationSessionRecord | null {
          if (!currentSession) return null;
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
          if (!currentSession) throw new Error('no session');
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
    venueEventRepository,
    ...(scheduleRepository ? { scheduleRepository } : {}),
  };

  context.runtime.bot.sendPrivateMessage = async (telegramUserId: number, message: string) => {
    privateMessages.push({ telegramUserId, message });
  };

  return { context, replies, privateMessages, getCurrentSession: () => currentSession };
}

test('handleTelegramVenueEventAdminText opens the venue event admin menu from the keyboard action', async () => {
  const { context, replies } = createContext();
  context.messageText = venueEventAdminLabels.openMenu;

  const handled = await handleTelegramVenueEventAdminText(context);

  assert.equal(handled, true);
  assert.deepEqual(replies.at(-1), {
    message: 'Gestio d esdeveniments del local: tria una accio.',
    options: {
      replyKeyboard: [['Crear esdeveniment', 'Llistar esdeveniments'], ['Editar esdeveniment', 'Cancel.lar esdeveniment'], ['/start', '/help']],
      resizeKeyboard: true,
      persistentKeyboard: true,
    },
  });
});

test('handleTelegramVenueEventAdminText creates a venue event through keyboard-guided steps', async () => {
  const { context, replies, getCurrentSession } = createContext();

  context.messageText = venueEventAdminLabels.create;
  assert.equal(await handleTelegramVenueEventAdminText(context), true);
  assert.deepEqual(getCurrentSession(), { flowKey: 'venue-event-admin-create', stepKey: 'name', data: {} });

  context.messageText = 'Campionat regional';
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.skipOptional;
  await handleTelegramVenueEventAdminText(context);
  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [['Diumenge, 05/04', 'Dilluns, 06/04'], ['Dimarts, 07/04', 'Dimecres, 08/04'], ['Dijous, 09/04', 'Divendres, 10/04'], ['/cancel']],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });

  context.messageText = 'Diumenge, 05/04';
  await handleTelegramVenueEventAdminText(context);
  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [[venueEventAdminLabels.allDay, venueEventAdminLabels.specificTime], [venueEventAdminLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });

  context.messageText = venueEventAdminLabels.specificTime;
  await handleTelegramVenueEventAdminText(context);
  assert.deepEqual(getCurrentSession(), { flowKey: 'venue-event-admin-create', stepKey: 'start-time', data: { name: 'Campionat regional', description: null, startDate: '2026-04-05', allDay: false } });

  context.messageText = '15:00';
  await handleTelegramVenueEventAdminText(context);
  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [['Diumenge, 05/04', 'Dilluns, 06/04'], ['Dimarts, 07/04', 'Dimecres, 08/04'], ['Dijous, 09/04', 'Divendres, 10/04'], ['/cancel']],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });

  context.messageText = 'Diumenge, 05/04';
  await handleTelegramVenueEventAdminText(context);
  assert.deepEqual(getCurrentSession(), { flowKey: 'venue-event-admin-create', stepKey: 'end-time', data: { name: 'Campionat regional', description: null, startDate: '2026-04-05', allDay: false, startTime: '15:00', endDate: '2026-04-05' } });
  context.messageText = '21:00';
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.scopeFull;
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.impactHigh;
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.confirmCreate;
  await handleTelegramVenueEventAdminText(context);

  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /Esdeveniment del local creat correctament: Campionat regional/);
  assert.match(replies.at(-1)?.message ?? '', /Impacte: high/);
});

test('handleTelegramVenueEventAdminText creates an all-day venue event when selected', async () => {
  const { context, replies, getCurrentSession } = createContext();

  context.messageText = venueEventAdminLabels.create;
  await handleTelegramVenueEventAdminText(context);
  context.messageText = 'Jornada de prototips';
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.skipOptional;
  await handleTelegramVenueEventAdminText(context);
  context.messageText = 'Dimecres, 08/04';
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.allDay;
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.scopePartial;
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.impactMedium;
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.confirmCreate;
  await handleTelegramVenueEventAdminText(context);

  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /Horari: Tot el dia/);
  assert.match(replies.at(-1)?.message ?? '', /Esdeveniment del local creat correctament: Jornada de prototips/);
});

test('handleTelegramVenueEventAdminText lists linked venue events and /start opens details', async () => {
  const { context, replies } = createContext({
    venueEventRepository: createVenueEventRepository([
      {
        id: 9,
        name: 'Concert <live>',
        description: null,
        startsAt: '2026-04-12T18:00:00.000Z',
        endsAt: '2026-04-12T20:00:00.000Z',
        occupancyScope: 'full',
        impactLevel: 'high',
        lifecycleStatus: 'scheduled',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        cancelledAt: null,
        cancellationReason: null,
      },
    ]),
  });

  context.messageText = venueEventAdminLabels.list;
  assert.equal(await handleTelegramVenueEventAdminText(context), true);
  assert.equal(replies.at(-1)?.options?.parseMode, 'HTML');
  assert.match(replies.at(-1)?.message ?? '', /<a href="https:\/\/t\.me\/cawatest_bot\?start=venue_event_admin_9"><b>Concert &lt;live&gt;<\/b><\/a>/);

  replies.length = 0;
  context.messageText = '/start venue_event_admin_9';
  assert.equal(await handleTelegramVenueEventAdminStartText(context), true);
  assert.equal(replies.at(-1)?.options?.parseMode, 'HTML');
  assert.match(replies.at(-1)?.message ?? '', /^Concert &lt;live&gt;/);
});

test('handleTelegramVenueEventAdminText sends private warnings when a created venue event overlaps scheduled activities', async () => {
  const venueEventRepository = createVenueEventRepository();
  const scheduleRepository = {
    async createEvent() { throw new Error('not implemented'); },
    async findEventById(eventId: number) {
      return eventId === 10
        ? {
            id: 10,
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
          }
        : null;
    },
    async listEvents({ includeCancelled }: { includeCancelled: boolean }) {
      return includeCancelled ? [] : [
        {
          id: 10,
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
      ];
    },
    async updateEvent() { throw new Error('not implemented'); },
    async cancelEvent() { throw new Error('not implemented'); },
    async findParticipant(eventId: number, participantTelegramUserId: number) {
      return eventId === 10 && participantTelegramUserId === 42
        ? {
            scheduleEventId: 10,
            participantTelegramUserId: 42,
            status: 'active',
            addedByTelegramUserId: 42,
            removedByTelegramUserId: null,
            joinedAt: '2026-04-04T10:30:00.000Z',
            updatedAt: '2026-04-04T10:30:00.000Z',
            leftAt: null,
          }
        : null;
    },
    async listParticipants(eventId: number) {
      return eventId === 10
        ? [
            {
              scheduleEventId: 10,
              participantTelegramUserId: 42,
              status: 'active',
              addedByTelegramUserId: 42,
              removedByTelegramUserId: null,
              joinedAt: '2026-04-04T10:30:00.000Z',
              updatedAt: '2026-04-04T10:30:00.000Z',
              leftAt: null,
            },
            {
              scheduleEventId: 10,
              participantTelegramUserId: 55,
              status: 'active',
              addedByTelegramUserId: 55,
              removedByTelegramUserId: null,
              joinedAt: '2026-04-04T10:30:00.000Z',
              updatedAt: '2026-04-04T10:30:00.000Z',
              leftAt: null,
            },
          ]
        : [];
    },
    async upsertParticipant() { throw new Error('not implemented'); },
  } as ScheduleRepository;
  const { context, privateMessages } = createContext({ venueEventRepository, scheduleRepository });

  context.messageText = venueEventAdminLabels.create;
  await handleTelegramVenueEventAdminText(context);
  context.messageText = 'Campionat regional';
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.skipOptional;
  await handleTelegramVenueEventAdminText(context);
  context.messageText = '2026-04-12';
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.specificTime;
  await handleTelegramVenueEventAdminText(context);
  context.messageText = '15:00';
  await handleTelegramVenueEventAdminText(context);
  context.messageText = '2026-04-12';
  await handleTelegramVenueEventAdminText(context);
  context.messageText = '21:00';
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.scopeFull;
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.impactHigh;
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.confirmCreate;
  await handleTelegramVenueEventAdminText(context);

  assert.deepEqual(privateMessages.map((item) => item.telegramUserId).sort((a, b) => a - b), [42, 55]);
  assert.match(privateMessages[0]?.message ?? '', /possible conflicte amb l ocupacio del local/);
  assert.match(privateMessages[0]?.message ?? '', /Campionat regional/);
  assert.match(privateMessages[0]?.message ?? '', /Azul/);
});

test('handleTelegramVenueEventAdminText keeps the end time step active when the range is invalid', async () => {
  const { context, getCurrentSession, replies } = createContext();

  context.messageText = venueEventAdminLabels.create;
  await handleTelegramVenueEventAdminText(context);
  context.messageText = 'Campionat regional';
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.skipOptional;
  await handleTelegramVenueEventAdminText(context);
  context.messageText = '2026-04-12';
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.specificTime;
  await handleTelegramVenueEventAdminText(context);
  context.messageText = '15:00';
  await handleTelegramVenueEventAdminText(context);
  context.messageText = '2026-04-12';
  await handleTelegramVenueEventAdminText(context);
  context.messageText = '14:00';
  await handleTelegramVenueEventAdminText(context);

  assert.equal(getCurrentSession()?.stepKey, 'end-time');
  assert.match(replies.at(-1)?.message ?? '', /El final ha de ser posterior a l inici/);
});

test('handleTelegramVenueEventAdminCallback edits an existing venue event with keep-current shortcuts', async () => {
  const venueEventRepository = createVenueEventRepository([
    {
      id: 3,
      name: 'Mercat solidari',
      description: null,
      startsAt: '2026-04-12T09:00:00.000Z',
      endsAt: '2026-04-12T13:00:00.000Z',
      occupancyScope: 'partial',
      impactLevel: 'medium',
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancellationReason: null,
    },
  ]);
  const { context, getCurrentSession, replies } = createContext({ venueEventRepository });

  context.callbackData = `${venueEventAdminCallbackPrefixes.edit}3`;
  assert.equal(await handleTelegramVenueEventAdminCallback(context), true);
  assert.deepEqual(getCurrentSession(), { flowKey: 'venue-event-admin-edit', stepKey: 'name', data: { eventId: 3 } });

  context.messageText = venueEventAdminLabels.keepCurrent;
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.keepCurrent;
  await handleTelegramVenueEventAdminText(context);
  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [[venueEventAdminLabels.keepCurrent], ['Diumenge, 05/04', 'Dilluns, 06/04'], ['Dimarts, 07/04', 'Dimecres, 08/04'], ['Dijous, 09/04', 'Divendres, 10/04'], [venueEventAdminLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });

  context.messageText = 'Diumenge, 05/04';
  await handleTelegramVenueEventAdminText(context);
  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [[venueEventAdminLabels.allDay, venueEventAdminLabels.specificTime], [venueEventAdminLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });

  context.messageText = venueEventAdminLabels.specificTime;
  await handleTelegramVenueEventAdminText(context);
  assert.deepEqual(getCurrentSession(), { flowKey: 'venue-event-admin-edit', stepKey: 'start-time', data: { eventId: 3, name: 'Mercat solidari', description: null, startDate: '2026-04-05', allDay: false } });

  context.messageText = '15:00';
  await handleTelegramVenueEventAdminText(context);
  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [[venueEventAdminLabels.keepCurrent], ['Diumenge, 05/04', 'Dilluns, 06/04'], ['Dimarts, 07/04', 'Dimecres, 08/04'], ['Dijous, 09/04', 'Divendres, 10/04'], [venueEventAdminLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });

  context.messageText = 'Dilluns, 06/04';
  await handleTelegramVenueEventAdminText(context);
  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [[venueEventAdminLabels.keepCurrent], [venueEventAdminLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });

  context.messageText = venueEventAdminLabels.keepCurrent;
  await handleTelegramVenueEventAdminText(context);
  assert.deepEqual(getCurrentSession(), { flowKey: 'venue-event-admin-edit', stepKey: 'scope', data: { eventId: 3, name: 'Mercat solidari', description: null, startDate: '2026-04-05', allDay: false, startTime: '15:00', endDate: '2026-04-06', endTime: '13:00' } });

  context.messageText = venueEventAdminLabels.keepCurrent;
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.keepCurrent;
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.confirmEdit;
  await handleTelegramVenueEventAdminText(context);

  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /Esdeveniment del local actualitzat correctament: Mercat solidari/);
  assert.match(replies.at(-1)?.message ?? '', /Horari: 2026-04-05 15:00 - 2026-04-06 13:00/);
});

test('handleTelegramVenueEventAdminCallback edits an existing venue event as all-day', async () => {
  const venueEventRepository = createVenueEventRepository([
    {
      id: 5,
      name: 'Sessio nocturna',
      description: null,
      startsAt: '2026-04-12T20:00:00.000Z',
      endsAt: '2026-04-12T23:00:00.000Z',
      occupancyScope: 'partial',
      impactLevel: 'medium',
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancellationReason: null,
    },
  ]);
  const { context, getCurrentSession, replies } = createContext({ venueEventRepository });

  context.callbackData = `${venueEventAdminCallbackPrefixes.edit}5`;
  await handleTelegramVenueEventAdminCallback(context);
  context.messageText = venueEventAdminLabels.keepCurrent;
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.keepCurrent;
  await handleTelegramVenueEventAdminText(context);
  context.messageText = 'Diumenge, 05/04';
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.allDay;
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.scopePartial;
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.impactMedium;
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.confirmEdit;
  await handleTelegramVenueEventAdminText(context);

  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /Horari: Tot el dia \(05\/04\/2026\)/);
});

test('handleTelegramVenueEventAdminCallback cancels a venue event only after explicit confirmation', async () => {
  const venueEventRepository = createVenueEventRepository([
    {
      id: 4,
      name: 'Acte municipal',
      description: null,
      startsAt: '2026-04-12T09:00:00.000Z',
      endsAt: '2026-04-12T15:00:00.000Z',
      occupancyScope: 'full',
      impactLevel: 'high',
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancellationReason: null,
    },
  ]);
  const { context, getCurrentSession, replies } = createContext({ venueEventRepository });

  context.callbackData = `${venueEventAdminCallbackPrefixes.cancel}4`;
  assert.equal(await handleTelegramVenueEventAdminCallback(context), true);
  assert.deepEqual(getCurrentSession(), { flowKey: 'venue-event-admin-cancel', stepKey: 'confirm', data: { eventId: 4 } });

  context.messageText = venueEventAdminLabels.confirmCancel;
  assert.equal(await handleTelegramVenueEventAdminText(context), true);
  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /Esdeveniment del local cancel.lat correctament: Acte municipal/);
});

test('handleTelegramVenueEventAdminCallback notifies impacted users when a venue event cancellation resolves a local conflict', async () => {
  const venueEventRepository = createVenueEventRepository([
    {
      id: 40,
      name: 'Acte municipal',
      description: null,
      startsAt: '2026-04-12T09:00:00.000Z',
      endsAt: '2026-04-12T15:00:00.000Z',
      occupancyScope: 'full',
      impactLevel: 'high',
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancellationReason: null,
    },
  ]);
  const scheduleRepository = {
    async createEvent() { throw new Error('not implemented'); },
    async findEventById(eventId: number) {
      return eventId === 77
        ? {
            id: 77,
            title: 'Heat',
            description: null,
            startsAt: '2026-04-12T10:00:00.000Z',
            organizerTelegramUserId: 42,
            createdByTelegramUserId: 42,
            tableId: null,
            durationMinutes: 120,
            capacity: 4,
            lifecycleStatus: 'scheduled',
            createdAt: '2026-04-04T10:00:00.000Z',
            updatedAt: '2026-04-04T10:00:00.000Z',
            cancelledAt: null,
            cancelledByTelegramUserId: null,
            cancellationReason: null,
          }
        : null;
    },
    async listEvents({ includeCancelled }: { includeCancelled: boolean }) {
      return includeCancelled ? [] : [
        {
          id: 77,
          title: 'Heat',
          description: null,
          startsAt: '2026-04-12T10:00:00.000Z',
          organizerTelegramUserId: 42,
          createdByTelegramUserId: 42,
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
      ];
    },
    async updateEvent() { throw new Error('not implemented'); },
    async cancelEvent() { throw new Error('not implemented'); },
    async findParticipant(eventId: number, participantTelegramUserId: number) {
      return eventId === 77 && participantTelegramUserId === 42
        ? {
            scheduleEventId: 77,
            participantTelegramUserId: 42,
            status: 'active',
            addedByTelegramUserId: 42,
            removedByTelegramUserId: null,
            joinedAt: '2026-04-04T10:30:00.000Z',
            updatedAt: '2026-04-04T10:30:00.000Z',
            leftAt: null,
          }
        : null;
    },
    async listParticipants(eventId: number) {
      return eventId === 77
        ? [{
            scheduleEventId: 77,
            participantTelegramUserId: 42,
            status: 'active',
            addedByTelegramUserId: 42,
            removedByTelegramUserId: null,
            joinedAt: '2026-04-04T10:30:00.000Z',
            updatedAt: '2026-04-04T10:30:00.000Z',
            leftAt: null,
          }]
        : [];
    },
    async upsertParticipant() { throw new Error('not implemented'); },
  } as ScheduleRepository;
  const { context, privateMessages } = createContext({ venueEventRepository, scheduleRepository });

  context.callbackData = `${venueEventAdminCallbackPrefixes.cancel}40`;
  await handleTelegramVenueEventAdminCallback(context);
  context.messageText = venueEventAdminLabels.confirmCancel;
  await handleTelegramVenueEventAdminText(context);

  assert.deepEqual(privateMessages.map((item) => item.telegramUserId), [42]);
  assert.match(privateMessages[0]?.message ?? '', /Ja no hi ha impacte actiu del local/);
  assert.match(privateMessages[0]?.message ?? '', /Acte municipal/);
});
