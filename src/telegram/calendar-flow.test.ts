import test from 'node:test';
import assert from 'node:assert/strict';

import type { TelegramReplyOptions } from './runtime-boundary.js';
import type { ConversationSessionRecord } from './conversation-session.js';
import type { ScheduleRepository } from '../schedule/schedule-catalog.js';
import type { VenueEventRepository } from '../venue-events/venue-event-catalog.js';
import type { ClubTableRepository } from '../tables/table-catalog.js';
import { calendarLabels, handleTelegramCalendarText, type TelegramCalendarContext } from './calendar-flow.js';

function createContext({
  scheduleRepository,
  venueEventRepository,
  tableRepository,
  now = new Date('2026-04-04T10:00:00.000Z'),
  language = 'ca',
}: {
  scheduleRepository: ScheduleRepository;
  venueEventRepository: VenueEventRepository;
  tableRepository: ClubTableRepository;
  now?: Date;
  language?: 'ca' | 'es' | 'en';
}) {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const context: TelegramCalendarContext = {
    messageText: undefined,
    reply: async (message: string, options?: TelegramReplyOptions) => {
      replies.push({ message, ...(options ? { options } : {}) });
    },
    runtime: {
      actor: {
        telegramUserId: 99,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin: true,
        permissions: [],
      },
      authorization: {
        authorize: () => ({ allowed: true, permissionKey: 'any', reason: 'admin-override' as any }),
        can: () => true,
      },
      session: {
        current: null as ConversationSessionRecord | null,
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
        language,
      },
    },
    scheduleRepository,
    venueEventRepository,
    tableRepository,
    now,
  };

  return { context, replies };
}

test('handleTelegramCalendarText shows upcoming activities and venue events grouped by day', async () => {
  const scheduleRepository: ScheduleRepository = {
    async createEvent() { throw new Error('not implemented'); },
    async findEventById() { return null; },
    async listEvents() {
      return [
        {
          id: 1,
          title: 'Final de "La Copa"',
          description: 'Partida final del torneig',
          startsAt: '2026-04-04T10:00:00.000Z',
          durationMinutes: 120,
          organizerTelegramUserId: 99,
          createdByTelegramUserId: 99,
          tableId: 1,
          capacity: 2,
          lifecycleStatus: 'scheduled',
          createdAt: '2026-04-04T08:00:00.000Z',
          updatedAt: '2026-04-04T08:00:00.000Z',
          cancelledAt: null,
          cancelledByTelegramUserId: null,
          cancellationReason: null,
        },
        {
          id: 2,
          title: 'Juegos de mesa',
          description: null,
          startsAt: '2026-04-05T14:00:00.000Z',
          durationMinutes: 240,
          organizerTelegramUserId: 99,
          createdByTelegramUserId: 99,
          tableId: 2,
          capacity: 7,
          lifecycleStatus: 'scheduled',
          createdAt: '2026-04-04T08:00:00.000Z',
          updatedAt: '2026-04-04T08:00:00.000Z',
          cancelledAt: null,
          cancelledByTelegramUserId: null,
          cancellationReason: null,
        },
      ];
    },
    async updateEvent() { throw new Error('not implemented'); },
    async cancelEvent() { throw new Error('not implemented'); },
    async findParticipant() { return null; },
    async listParticipants() { return []; },
    async upsertParticipant() { throw new Error('not implemented'); },
  };

  const venueEventRepository: VenueEventRepository = {
    async createVenueEvent() { throw new Error('not implemented'); },
    async findVenueEventById() { return null; },
    async listVenueEvents() {
      return [
        {
          id: 10,
          name: 'L5A',
          description: 'Campanya oberta',
          startsAt: '2026-04-05T18:00:00.000Z',
          endsAt: '2026-04-05T20:00:00.000Z',
          occupancyScope: 'full',
          impactLevel: 'medium',
          lifecycleStatus: 'scheduled',
          createdAt: '2026-04-04T08:00:00.000Z',
          updatedAt: '2026-04-04T08:00:00.000Z',
          cancelledAt: null,
          cancellationReason: null,
        },
        {
          id: 11,
          name: 'Jornada oberta JdT Vermut Edition',
          description: null,
          startsAt: '2026-04-08T00:00:00.000Z',
          endsAt: '2026-04-09T00:00:00.000Z',
          occupancyScope: 'partial',
          impactLevel: 'low',
          lifecycleStatus: 'scheduled',
          createdAt: '2026-04-04T08:00:00.000Z',
          updatedAt: '2026-04-04T08:00:00.000Z',
          cancelledAt: null,
          cancellationReason: null,
        },
      ];
    },
    async updateVenueEvent() { throw new Error('not implemented'); },
    async cancelVenueEvent() { throw new Error('not implemented'); },
  };

  const tableRepository: ClubTableRepository = {
    async createTable() { throw new Error('not implemented'); },
    async findTableById(tableId) {
      return tableId === 1
        ? { id: 1, displayName: 'Taula de l entrada', description: null, recommendedCapacity: 4, lifecycleStatus: 'active', createdAt: '2026-04-04T08:00:00.000Z', updatedAt: '2026-04-04T08:00:00.000Z', deactivatedAt: null }
        : tableId === 2
          ? { id: 2, displayName: 'Taula gran', description: null, recommendedCapacity: 8, lifecycleStatus: 'active', createdAt: '2026-04-04T08:00:00.000Z', updatedAt: '2026-04-04T08:00:00.000Z', deactivatedAt: null }
          : null;
    },
    async listTables() { return []; },
    async updateTable() { throw new Error('not implemented'); },
    async deactivateTable() { throw new Error('not implemented'); },
  };

  const { context, replies } = createContext({ scheduleRepository, venueEventRepository, tableRepository });

  context.messageText = calendarLabels.openMenu;
  const handled = await handleTelegramCalendarText(context);

  assert.equal(handled, true);
  assert.equal(replies.at(-1)?.options?.parseMode, 'HTML');
  assert.match(replies.at(-1)?.message ?? '', /<b>Dissabte 4 abril<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /10h-12h <a href="https:\/\/t\.me\/cawatest_bot\?start=schedule_event_1"><b>Final de "La Copa"<\/b><\/a> · 2p · Taula Taula de l entrada/);
  assert.match(replies.at(-1)?.message ?? '', /<i>Partida final del torneig<\/i>/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Diumenge 5 abril<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /14h-18h <a href="https:\/\/t\.me\/cawatest_bot\?start=schedule_event_2"><b>Juegos de mesa<\/b><\/a> · 7p · Taula Taula gran/);
  assert.match(replies.at(-1)?.message ?? '', /18h-20h L5A/);
  assert.match(replies.at(-1)?.message ?? '', /<i>Campanya oberta<\/i>/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Dimecres 8 abril<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /Tot el dia Jornada oberta JdT Vermut Edition/);
});

test('handleTelegramCalendarText accepts Spanish calendar menu label', async () => {
  const scheduleRepository: ScheduleRepository = {
    async createEvent() { throw new Error('not implemented'); },
    async findEventById() { return null; },
    async listEvents() { return []; },
    async updateEvent() { throw new Error('not implemented'); },
    async cancelEvent() { throw new Error('not implemented'); },
    async findParticipant() { return null; },
    async listParticipants() { return []; },
    async upsertParticipant() { throw new Error('not implemented'); },
  };
  const venueEventRepository: VenueEventRepository = {
    async createVenueEvent() { throw new Error('not implemented'); },
    async findVenueEventById() { return null; },
    async listVenueEvents() { return []; },
    async updateVenueEvent() { throw new Error('not implemented'); },
    async cancelVenueEvent() { throw new Error('not implemented'); },
  };
  const tableRepository: ClubTableRepository = {
    async createTable() { throw new Error('not implemented'); },
    async findTableById() { return null; },
    async listTables() { return []; },
    async updateTable() { throw new Error('not implemented'); },
    async deactivateTable() { throw new Error('not implemented'); },
  };

  const { context, replies } = createContext({ scheduleRepository, venueEventRepository, tableRepository, language: 'es' });
  context.messageText = 'Calendario';

  assert.equal(await handleTelegramCalendarText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /No hay actividades ni eventos cercanos ahora mismo\./);
});
