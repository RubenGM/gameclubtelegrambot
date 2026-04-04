import test from 'node:test';
import assert from 'node:assert/strict';

import type { TelegramReplyOptions } from './runtime-boundary.js';
import type { ConversationSessionRecord } from './conversation-session.js';
import type { VenueEventRecord, VenueEventRepository } from '../venue-events/venue-event-catalog.js';
import {
  handleTelegramVenueEventAdminCallback,
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

function createContext({
  venueEventRepository = createVenueEventRepository(),
  isAdmin = true,
}: {
  venueEventRepository?: VenueEventRepository;
  isAdmin?: boolean;
} = {}) {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
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
  };

  return { context, replies, getCurrentSession: () => currentSession };
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
  context.messageText = '2026-04-12';
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

  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /Esdeveniment del local creat correctament: Campionat regional/);
  assert.match(replies.at(-1)?.message ?? '', /Impacte: high/);
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
  context.messageText = venueEventAdminLabels.keepCurrent;
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.keepCurrent;
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.keepCurrent;
  await handleTelegramVenueEventAdminText(context);
  context.messageText = '15:00';
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.keepCurrent;
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.keepCurrent;
  await handleTelegramVenueEventAdminText(context);
  context.messageText = venueEventAdminLabels.confirmEdit;
  await handleTelegramVenueEventAdminText(context);

  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /Esdeveniment del local actualitzat correctament: Mercat solidari/);
  assert.match(replies.at(-1)?.message ?? '', /Final: 2026-04-12 15:00/);
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
