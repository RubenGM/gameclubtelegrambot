import test from 'node:test';
import assert from 'node:assert/strict';

import type { AuditLogEventRecord, AuditLogRepository } from '../audit/audit-log.js';
import type { MembershipAccessRepository, MembershipUserRecord } from '../membership/access-flow.js';
import type { NewsGroupRecord, NewsGroupRepository } from '../news/news-group-catalog.js';
import type { ClubTableRecord, ClubTableRepository } from '../tables/table-catalog.js';
import type { ScheduleEventRecord, ScheduleParticipantRecord, ScheduleRepository } from '../schedule/schedule-catalog.js';
import type { VenueEventRecord, VenueEventRepository } from '../venue-events/venue-event-catalog.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import type { ConversationSessionRecord } from './conversation-session.js';
import { normalizeDisplayName } from '../membership/display-name.js';
import {
  handleTelegramScheduleCallback,
  handleTelegramScheduleStartText,
  handleTelegramScheduleText,
  scheduleCallbackPrefixes,
  scheduleLabels,
  type TelegramScheduleContext,
} from './schedule-flow.js';

function successButton(text: string) {
  return { text, semanticRole: 'success' as const };
}

function dangerButton(text: string) {
  return { text, semanticRole: 'danger' as const };
}

type ScheduleEventFixture = Omit<ScheduleEventRecord, 'attendanceMode' | 'initialOccupiedSeats'> &
  Partial<Pick<ScheduleEventRecord, 'attendanceMode' | 'initialOccupiedSeats'>>;

test.beforeEach((t: any) => {
  t.mock.timers.enable({
    apis: ['Date'],
    now: new Date('2026-04-05T09:00:00.000Z'),
  });
});

function createScheduleRepository(initialEvents: ScheduleEventFixture[] = []): ScheduleRepository & { __cancelledEventIds: number[] } {
  const events = new Map(initialEvents.map((event) => {
    const normalized = normalizeScheduleEventFixture(event);
    return [normalized.id, normalized];
  }));
  const participants = new Map<string, ScheduleParticipantRecord>();
  const cancelledEventIds: number[] = [];
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
        attendanceMode: input.attendanceMode,
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
    async findEventById(eventId: number) {
      return events.get(eventId) ?? null;
    },
    async listEvents({ includeCancelled, startsAtFrom, startsAtTo }) {
      return Array.from(events.values())
        .filter((event) => includeCancelled || event.lifecycleStatus === 'scheduled')
        .filter((event) => (startsAtFrom ? event.startsAt >= startsAtFrom : true))
        .filter((event) => (startsAtTo ? event.startsAt <= startsAtTo : true))
        .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
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
        attendanceMode: input.attendanceMode,
        initialOccupiedSeats: input.initialOccupiedSeats,
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
      cancelledEventIds.push(input.eventId);
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
    __cancelledEventIds: cancelledEventIds,
  };
}

function normalizeScheduleEventFixture(event: ScheduleEventFixture): ScheduleEventRecord {
  return {
    ...event,
    attendanceMode: event.attendanceMode ?? 'open',
    initialOccupiedSeats: event.initialOccupiedSeats ?? 0,
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

function createMembershipRepository(initialUsers: MembershipUserRecord[] = [
  { telegramUserId: 42, username: 'ada', displayName: 'Ada', status: 'approved', isAdmin: false },
  { telegramUserId: 55, username: 'carla', displayName: 'Carla', status: 'approved', isAdmin: false },
  { telegramUserId: 77, username: null, displayName: 'Biel', status: 'approved', isAdmin: false },
  { telegramUserId: 99, username: 'admin', displayName: 'Admin', status: 'approved', isAdmin: true },
]): MembershipAccessRepository {
  const users = new Map(initialUsers.map((user) => [user.telegramUserId, user]));

  return {
    async findUserByTelegramUserId(telegramUserId) {
      return users.get(telegramUserId) ?? null;
    },
    async syncUserProfile(input) {
      const existing = users.get(input.telegramUserId);
      if (!existing) {
        return null;
      }

      const next: MembershipUserRecord = {
        ...existing,
        ...(input.username !== undefined ? { username: input.username ?? null } : {}),
        displayName: normalizeDisplayName(input.displayName) ?? existing.displayName,
      };
      users.set(next.telegramUserId, next);
      return next;
    },
    async upsertPendingUser(input) {
      const next: MembershipUserRecord = {
        telegramUserId: input.telegramUserId,
        username: input.username ?? null,
        displayName: normalizeDisplayName(input.displayName) ?? 'Usuari',
        status: 'pending',
        isAdmin: false,
      };
      users.set(next.telegramUserId, next);
      return next;
    },
    async backfillDisplayNames() {
      let updatedCount = 0;
      for (const [telegramUserId, user] of users.entries()) {
        if (normalizeDisplayName(user.displayName)) {
          continue;
        }

        const next: MembershipUserRecord = {
          ...user,
          displayName: user.username?.trim() ? `@${user.username.trim()}` : 'Usuari',
        };
        users.set(telegramUserId, next);
        updatedCount += 1;
      }
      return updatedCount;
    },
    async listPendingUsers() {
      return Array.from(users.values()).filter((user) => user.status === 'pending');
    },
    async listRevocableUsers() {
      return Array.from(users.values()).filter((user) => user.status === 'approved' && !user.isAdmin);
    },
    async listApprovedAdminUsers() {
      return Array.from(users.values()).filter((user) => user.status === 'approved' && user.isAdmin);
    },
    async findLatestRevocation() {
      return null;
    },
    async approveMembershipRequest(input: { telegramUserId: number }) {
      const existing = users.get(input.telegramUserId);
      if (!existing) throw new Error(`unknown user ${input.telegramUserId}`);
      const next: MembershipUserRecord = { ...existing, status: 'approved' };
      users.set(next.telegramUserId, next);
      return next;
    },
    async rejectMembershipRequest(input: { telegramUserId: number }) {
      const existing = users.get(input.telegramUserId);
      if (!existing) throw new Error(`unknown user ${input.telegramUserId}`);
      const next: MembershipUserRecord = { ...existing, status: 'blocked' };
      users.set(next.telegramUserId, next);
      return next;
    },
    async revokeMembershipAccess(input: { telegramUserId: number }) {
      const existing = users.get(input.telegramUserId);
      if (!existing) throw new Error(`unknown user ${input.telegramUserId}`);
      const next: MembershipUserRecord = { ...existing, status: 'revoked' };
      users.set(next.telegramUserId, next);
      return next;
    },
    async appendStatusAuditLog() {},
  };
}

function createContext({
  scheduleRepository = createScheduleRepository(),
  tableRepository = createTableRepository(),
  venueEventRepository = createVenueEventRepository(),
  membershipRepository = createMembershipRepository(),
  newsGroupRepository = createNewsGroupRepository(),
  auditRepository = createAuditRepository(),
  actorTelegramUserId = 99,
  isAdmin = false,
  language = 'ca',
}: {
  scheduleRepository?: ScheduleRepository;
  tableRepository?: ClubTableRepository;
  venueEventRepository?: VenueEventRepository;
  membershipRepository?: MembershipAccessRepository;
  newsGroupRepository?: NewsGroupRepository;
  auditRepository?: AuditLogRepository;
  actorTelegramUserId?: number;
  isAdmin?: boolean;
  language?: 'ca' | 'es' | 'en';
} = {}) {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const privateMessages: Array<{ telegramUserId: number; message: string }> = [];
  const groupMessages: Array<{ chatId: number; message: string; options?: TelegramReplyOptions }> = [];
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
        language,
        sendPrivateMessage: async () => {},
        sendGroupMessage: async (chatId: number, message: string, options?: TelegramReplyOptions) => {
          groupMessages.push({ chatId, message, ...(options ? { options } : {}) });
        },
      },
    },
    scheduleRepository,
    tableRepository,
    venueEventRepository,
    membershipRepository,
    newsGroupRepository,
    auditRepository,
  };

  context.runtime.bot.sendPrivateMessage = async (telegramUserId: number, message: string) => {
    privateMessages.push({ telegramUserId, message });
  };

  return { context, replies, privateMessages, groupMessages, getCurrentSession: () => currentSession };
}

function createNewsGroupRepository(initialGroups: NewsGroupRecord[] = []): NewsGroupRepository {
  const groups = new Map(initialGroups.map((group) => [group.chatId, group]));

  return {
    async findGroupByChatId(chatId) {
      return groups.get(chatId) ?? null;
    },
    async listGroups({ includeDisabled } = {}) {
      return Array.from(groups.values()).filter((group) => includeDisabled || group.isEnabled);
    },
    async upsertGroup(input) {
      const now = '2026-04-04T10:00:00.000Z';
      const next: NewsGroupRecord = {
        chatId: input.chatId,
        isEnabled: input.isEnabled,
        metadata: input.metadata ?? null,
        createdAt: groups.get(input.chatId)?.createdAt ?? now,
        updatedAt: now,
        enabledAt: input.isEnabled ? now : null,
        disabledAt: input.isEnabled ? null : now,
      };
      groups.set(next.chatId, next);
      return next;
    },
    async listSubscriptionsByChatId() {
      return [];
    },
    async upsertSubscription() {
      throw new Error('not implemented');
    },
    async deleteSubscription() {
      return false;
    },
    async listSubscribedGroupsByCategory() {
      return [];
    },
    async isNewsEnabledGroup(chatId) {
      return groups.get(chatId)?.isEnabled === true;
    },
  };
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
  const scheduleRepository = createScheduleRepository([
    {
      id: 4,
      title: 'Wingspan',
      description: 'Ocells i engines',
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
  const { context, replies } = createContext({ scheduleRepository });
  context.messageText = scheduleLabels.openMenu;

  const handled = await handleTelegramScheduleText(context);

  assert.equal(handled, true);
  assert.match(replies.at(-1)?.message ?? '', /<b>05\/04\/2026<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /16h-19h <a href="https:\/\/t\.me\/cawatest_bot\?start=schedule_event_4"><b>Wingspan<\/b><\/a> · Mesa abierta · 3p \(3 libres\)/);
  assert.match(replies.at(-1)?.message ?? '', /<i>Ocells i engines<\/i>/);
  assert.deepEqual(replies.at(-1)?.options, {
    parseMode: 'HTML',
    replyKeyboard: [['Veure activitats', 'Crear activitat'], ['Editar activitat', 'Cancel·lar activitat'], ['Inici', 'Ajuda']],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });
});

test('handleTelegramScheduleText accepts the Spanish menu label', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 4,
      title: 'Wingspan',
      description: 'Ocells i engines',
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
  const { context, replies } = createContext({ scheduleRepository, language: 'es', isAdmin: true });
  context.messageText = 'Actividades';

  const handled = await handleTelegramScheduleText(context);

  assert.equal(handled, true);
  assert.ok(replies.at(-1));
});

test('handleTelegramScheduleText accepts the Spanish edit menu label', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 4,
      title: 'Wingspan',
      description: 'Ocells i engines',
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
  const { context, replies } = createContext({ scheduleRepository, language: 'es' });
  context.messageText = 'Editar actividad';

  const handled = await handleTelegramScheduleText(context);

  assert.equal(handled, true);
  assert.ok(replies.at(-1));
});

test('handleTelegramScheduleStartText opens an activity detail from a deep link payload', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 4,
      title: 'Wingspan',
      description: 'Ocells i engines',
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
  const { context, replies } = createContext({ scheduleRepository, isAdmin: true });

  context.messageText = '/start schedule_event_4';
  assert.equal(await handleTelegramScheduleStartText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /<b>Wingspan<\/b>/);
  assert.ok(replies.at(-1)?.options?.inlineKeyboard?.flat().some((button) => button.text === 'Editar activitat'));
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
  assert.deepEqual(getCurrentSession(), { flowKey: 'schedule-create', stepKey: 'date', data: { title: 'Dungeons & Dragons' } });
  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [
      ['Diumenge, 05/04', 'Dilluns, 06/04'],
      ['Dimarts, 07/04', 'Dimecres, 08/04'],
      ['Dijous, 09/04', 'Divendres, 10/04'],
      ['Tornar'],
      [{ text: '/cancel', semanticRole: 'danger' }],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });

  context.messageText = 'Diumenge, 05/04';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.deepEqual(getCurrentSession(), { flowKey: 'schedule-create', stepKey: 'time', data: { title: 'Dungeons & Dragons', date: '2026-04-05' } });

  context.messageText = '16:00';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'duration-mode');

  context.messageText = scheduleLabels.durationMinutes;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'duration');

  context.messageText = '180';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'attendance-mode');

  context.messageText = scheduleLabels.attendanceOpen;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'capacity');

  context.messageText = '5';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'initial-occupied-seats');

  context.messageText = '0';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'table');
  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [['Mesa TV'], [{ text: 'Sense taula', semanticRole: 'success' }], ['Tornar'], [{ text: '/cancel', semanticRole: 'danger' }]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });

  context.messageText = 'Mesa TV';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'confirm');
  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [
      ['Descripció'],
      [{ text: scheduleLabels.confirmCreate, semanticRole: 'success' }],
      ['Tornar'],
      [{ text: '/cancel', semanticRole: 'danger' }],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
    parseMode: 'HTML',
  });

  context.messageText = scheduleLabels.confirmCreate;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /Activitat creada correctament: <b>Dungeons &amp; Dragons<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Taula:<\/b> Mesa TV/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Inici:<\/b> 05\/04\/2026 16:00/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Durada:<\/b> 3 h/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Tipus:<\/b> Taula oberta/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Assistents:<\/b> Cap/);
  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'schedule.created');
  assert.equal(auditRepository.__events.at(-1)?.targetType, 'schedule-event');
});

test('handleTelegramScheduleText adds an optional description only from the final create step', async () => {
  const scheduleRepository = createScheduleRepository();
  const { context, replies, getCurrentSession } = createContext({ scheduleRepository, actorTelegramUserId: 42 });

  context.messageText = scheduleLabels.create;
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = 'Mansions of Madness';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = '05/04';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = '16:00';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = scheduleLabels.durationNone;
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = scheduleLabels.attendanceClosed;
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = '5';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = scheduleLabels.noTable;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'confirm');

  context.messageText = scheduleLabels.editFieldDescription;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.deepEqual(getCurrentSession(), {
    flowKey: 'schedule-create',
    stepKey: 'description',
    data: {
      title: 'Mansions of Madness',
      date: '2026-04-05',
      time: '16:00',
      durationMinutes: 120,
      attendanceMode: 'closed',
      capacity: 5,
      initialOccupiedSeats: 0,
      tableId: null,
    },
  });
  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [
      [{ text: scheduleLabels.skipOptional, semanticRole: 'success' }],
      ['Tornar'],
      [{ text: '/cancel', semanticRole: 'danger' }],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });

  context.messageText = 'Campanya narrativa';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'confirm');
  assert.match(replies.at(-1)?.message ?? '', /Descripció: Campanya narrativa/);

  context.messageText = scheduleLabels.confirmCreate;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal((await scheduleRepository.findEventById(1))?.description, 'Campanya narrativa');
});

test('handleTelegramScheduleText goes back to the previous create step without losing entered data', async () => {
  const { context, replies, getCurrentSession } = createContext({ actorTelegramUserId: 42 });

  context.messageText = scheduleLabels.create;
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = 'Terraforming Mars';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = 'Diumenge, 05/04';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = '17';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.deepEqual(getCurrentSession(), {
    flowKey: 'schedule-create',
    stepKey: 'time-minute',
    data: { title: 'Terraforming Mars', date: '2026-04-05', timeHour: '17' },
  });

  context.messageText = 'Tornar';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.deepEqual(getCurrentSession(), {
    flowKey: 'schedule-create',
    stepKey: 'time',
    data: { title: 'Terraforming Mars', date: '2026-04-05' },
  });
  assert.match(replies.at(-1)?.message ?? '', /HH o HH:MM/);

  context.messageText = '18:30';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'duration-mode');
  assert.deepEqual(getCurrentSession()?.data, {
    title: 'Terraforming Mars',
    date: '2026-04-05',
    time: '18:30',
  });
});

test('handleTelegramScheduleText goes back from the first create step to the activities menu', async () => {
  const { context, replies, getCurrentSession } = createContext({ actorTelegramUserId: 42 });

  context.messageText = scheduleLabels.create;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'title');

  context.messageText = 'Tornar';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /Activitats: tria una acció\./);
  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [['Veure activitats', 'Crear activitat'], ['Editar activitat', 'Cancel·lar activitat'], ['Inici', 'Ajuda']],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });
});

test('handleTelegramScheduleText localizes the back button for spanish create flow', async () => {
  const { context, replies, getCurrentSession } = createContext({ actorTelegramUserId: 42, language: 'es' });

  context.messageText = 'Crear actividad';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = 'Ark Nova';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = 'Domingo, 05/04';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = '17';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'time-minute');
  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [[':00', ':15'], [':30', ':45'], ['Volver'], [dangerButton('/cancel')]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });

  context.messageText = 'Volver';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'time');
});

test('handleTelegramScheduleText creates an activity with no duration using the internal two-hour default', async () => {
  const scheduleRepository = createScheduleRepository();
  const { context, replies, getCurrentSession } = createContext({ scheduleRepository, actorTelegramUserId: 42 });

  context.messageText = scheduleLabels.create;
  await handleTelegramScheduleText(context);
  context.messageText = 'Catan';
  await handleTelegramScheduleText(context);
  context.messageText = 'Diumenge, 05/04';
  await handleTelegramScheduleText(context);
  context.messageText = '16:00';
  await handleTelegramScheduleText(context);

  context.messageText = scheduleLabels.durationNone;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'attendance-mode');

  context.messageText = scheduleLabels.attendanceOpen;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'capacity');

  context.messageText = '4';
  await handleTelegramScheduleText(context);
  context.messageText = '0';
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.noTable;
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.confirmCreate;
  await handleTelegramScheduleText(context);

  assert.equal((await scheduleRepository.findEventById(1))?.durationMinutes, 120);
  assert.match(replies.at(-1)?.message ?? '', /<b>Durada:<\/b> 2 h/);
});

test('handleTelegramScheduleText creates an activity from whole hours duration input', async () => {
  const scheduleRepository = createScheduleRepository();
  const { context, replies, getCurrentSession } = createContext({ scheduleRepository, actorTelegramUserId: 42 });

  context.messageText = scheduleLabels.create;
  await handleTelegramScheduleText(context);
  context.messageText = 'Brass';
  await handleTelegramScheduleText(context);
  context.messageText = 'Diumenge, 05/04';
  await handleTelegramScheduleText(context);
  context.messageText = '16:00';
  await handleTelegramScheduleText(context);

  context.messageText = scheduleLabels.durationHours;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'duration-hours');

  context.messageText = '3';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'attendance-mode');

  context.messageText = scheduleLabels.attendanceOpen;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'capacity');

  context.messageText = '4';
  await handleTelegramScheduleText(context);
  context.messageText = '0';
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.noTable;
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.confirmCreate;
  await handleTelegramScheduleText(context);

  assert.equal((await scheduleRepository.findEventById(1))?.durationMinutes, 180);
  assert.match(replies.at(-1)?.message ?? '', /<b>Durada:<\/b> 3 h/);
});

test('handleTelegramScheduleText creates an activity from hours-and-minutes duration input', async () => {
  const scheduleRepository = createScheduleRepository();
  const { context, replies, getCurrentSession } = createContext({ scheduleRepository, actorTelegramUserId: 42 });

  context.messageText = scheduleLabels.create;
  await handleTelegramScheduleText(context);
  context.messageText = 'Eclipse';
  await handleTelegramScheduleText(context);
  context.messageText = 'Diumenge, 05/04';
  await handleTelegramScheduleText(context);
  context.messageText = '16:00';
  await handleTelegramScheduleText(context);

  context.messageText = scheduleLabels.durationHoursMinutes;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'duration-hours-minutes');

  context.messageText = '02:30';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'attendance-mode');

  context.messageText = scheduleLabels.attendanceOpen;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'capacity');

  context.messageText = '6';
  await handleTelegramScheduleText(context);
  context.messageText = '0';
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.noTable;
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.confirmCreate;
  await handleTelegramScheduleText(context);

  assert.equal((await scheduleRepository.findEventById(1))?.durationMinutes, 150);
  assert.match(replies.at(-1)?.message ?? '', /<b>Durada:<\/b> 2 h 30 min/);
});

test('handleTelegramScheduleText rejects invalid hours-and-minutes duration input', async () => {
  const { context, replies, getCurrentSession } = createContext({ actorTelegramUserId: 42 });

  context.messageText = scheduleLabels.create;
  await handleTelegramScheduleText(context);
  context.messageText = 'Eclipse';
  await handleTelegramScheduleText(context);
  context.messageText = 'Diumenge, 05/04';
  await handleTelegramScheduleText(context);
  context.messageText = '16:00';
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.durationHoursMinutes;
  await handleTelegramScheduleText(context);

  context.messageText = '2:30';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'duration-hours-minutes');
  assert.match(replies.at(-1)?.message ?? '', /HH:mm/);
});

test('handleTelegramScheduleText offers quick minute buttons when creating an activity with hour-only input', async () => {
  const scheduleRepository = createScheduleRepository();
  const { context, replies, getCurrentSession } = createContext({ scheduleRepository, actorTelegramUserId: 42 });

  context.messageText = scheduleLabels.create;
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = 'Ark Nova';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = 'Diumenge, 05/04';
  assert.equal(await handleTelegramScheduleText(context), true);

  context.messageText = '17';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.deepEqual(getCurrentSession(), {
    flowKey: 'schedule-create',
    stepKey: 'time-minute',
    data: { title: 'Ark Nova', date: '2026-04-05', timeHour: '17' },
  });
  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [[':00', ':15'], [':30', ':45'], ['Tornar'], [dangerButton('/cancel')]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });

  context.messageText = ':15';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'duration-mode');

  context.messageText = scheduleLabels.durationMinutes;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'duration');
  context.messageText = '120';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'attendance-mode');
  context.messageText = scheduleLabels.attendanceOpen;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'capacity');
  context.messageText = '4';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = '0';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = scheduleLabels.noTable;
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = scheduleLabels.confirmCreate;
  assert.equal(await handleTelegramScheduleText(context), true);

  assert.equal((await scheduleRepository.findEventById(1))?.startsAt, '2026-04-05T17:15:00.000Z');
});

test('handleTelegramScheduleText accepts one-digit hours when creating an activity', async () => {
  const scheduleRepository = createScheduleRepository();
  const { context, replies, getCurrentSession } = createContext({ scheduleRepository, actorTelegramUserId: 42 });

  context.messageText = scheduleLabels.create;
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = 'Ark Nova';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = 'Diumenge, 05/04';
  assert.equal(await handleTelegramScheduleText(context), true);

  context.messageText = '2';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.deepEqual(getCurrentSession(), {
    flowKey: 'schedule-create',
    stepKey: 'time-minute',
    data: { title: 'Ark Nova', date: '2026-04-05', timeHour: '02' },
  });
  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [[':00', ':15'], [':30', ':45'], ['Tornar'], [dangerButton('/cancel')]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });

  context.messageText = ':15';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'duration-mode');

  context.messageText = scheduleLabels.durationMinutes;
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = '120';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Tria si es mesa abierta o mesa cerrada\./);
  context.messageText = scheduleLabels.attendanceOpen;
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = '4';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = '0';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = scheduleLabels.noTable;
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = scheduleLabels.confirmCreate;
  assert.equal(await handleTelegramScheduleText(context), true);

  assert.equal((await scheduleRepository.findEventById(1))?.startsAt, '2026-04-05T02:15:00.000Z');
});

test('handleTelegramScheduleText shows people instead of seats in the closed-table confirmation summary', async () => {
  const { context, replies, getCurrentSession } = createContext({ actorTelegramUserId: 42, language: 'es' });

  context.messageText = scheduleLabels.create;
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = 'Nemesis';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = '05/04';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = '16:00';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = scheduleLabels.durationMinutes;
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = '120';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = scheduleLabels.attendanceClosed;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'capacity');
  context.messageText = '5';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = scheduleLabels.noTable;
  assert.equal(await handleTelegramScheduleText(context), true);

  assert.match(replies.at(-1)?.message ?? '', /Tipo: Mesa cerrada/);
  assert.match(replies.at(-1)?.message ?? '', /Personas: 5/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Plazas: 5/);
  assert.match(replies.at(-1)?.message ?? '', /Confirma o cancela el proceso\./);
});

test('handleTelegramScheduleText rejects invalid quick minute selections while creating an activity', async () => {
  const { context, replies, getCurrentSession } = createContext({ actorTelegramUserId: 42 });

  context.messageText = scheduleLabels.create;
  await handleTelegramScheduleText(context);
  context.messageText = 'Ark Nova';
  await handleTelegramScheduleText(context);
  context.messageText = 'Diumenge, 05/04';
  await handleTelegramScheduleText(context);
  context.messageText = '17';
  await handleTelegramScheduleText(context);

  context.messageText = ':20';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'time-minute');
  assert.match(replies.at(-1)?.message ?? '', /HH o HH:MM/);
  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [[':00', ':15'], [':30', ':45'], ['Tornar'], [dangerButton('/cancel')]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });
});

test('handleTelegramScheduleText publishes the updated calendar to enabled news groups', async () => {
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
  const newsGroupRepository = createNewsGroupRepository([
    {
      chatId: -200,
      isEnabled: true,
      metadata: null,
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      enabledAt: '2026-04-04T10:00:00.000Z',
      disabledAt: null,
    },
  ]);
  const { context, groupMessages } = createContext({ scheduleRepository, tableRepository, newsGroupRepository, actorTelegramUserId: 42 });

  context.messageText = scheduleLabels.create;
  await handleTelegramScheduleText(context);
  context.messageText = 'Dune Imperium';
  await handleTelegramScheduleText(context);
  context.messageText = 'Diumenge, 05/04';
  await handleTelegramScheduleText(context);
  context.messageText = '16:00';
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.durationMinutes;
  await handleTelegramScheduleText(context);
  context.messageText = '180';
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.attendanceOpen;
  await handleTelegramScheduleText(context);
  context.messageText = '5';
  await handleTelegramScheduleText(context);
  context.messageText = '0';
  await handleTelegramScheduleText(context);
  context.messageText = 'Mesa TV';
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.confirmCreate;
  await handleTelegramScheduleText(context);

  assert.equal(groupMessages.length, 1);
  assert.equal(groupMessages[0]?.chatId, -200);
  assert.equal(groupMessages[0]?.options?.parseMode, 'HTML');
  assert.match(groupMessages[0]?.message ?? '', /Calendari actualitzat:/);
  assert.match(groupMessages[0]?.message ?? '', /16h-19h <a href="https:\/\/t\.me\/cawatest_bot\?start=schedule_event_1"><b>Dune Imperium<\/b><\/a> · Mesa abierta · 5p \(5 libres\) · Mesa TV/);
  assert.match(groupMessages[0]?.message ?? '', /ha creado la actividad Dune Imperium del 05\/04\/2026/i);
});

test('handleTelegramScheduleText accepts dd/MM/yyyy dates and shows upcoming day shortcuts', async () => {
  const { context, replies, getCurrentSession } = createContext({ actorTelegramUserId: 42 });

  context.messageText = scheduleLabels.create;
  await handleTelegramScheduleText(context);
  context.messageText = 'Ark Nova';
  await handleTelegramScheduleText(context);

  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [['Diumenge, 05/04', 'Dilluns, 06/04'], ['Dimarts, 07/04', 'Dimecres, 08/04'], ['Dijous, 09/04', 'Divendres, 10/04'], ['Tornar'], [dangerButton('/cancel')]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });

  context.messageText = 'Dilluns, 06/04/2026';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.data.date, '2026-04-06');
});

test('handleTelegramScheduleText shows created tables as reply keyboard buttons during selection', async () => {
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
    {
      id: 8,
      displayName: 'Mesa gran',
      description: null,
      recommendedCapacity: 8,
      lifecycleStatus: 'active',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      deactivatedAt: null,
    },
  ]);
  const { context, replies, getCurrentSession } = createContext({ tableRepository, actorTelegramUserId: 42 });

  context.messageText = scheduleLabels.create;
  await handleTelegramScheduleText(context);
  context.messageText = 'Ark Nova';
  await handleTelegramScheduleText(context);
  context.messageText = '05/04';
  await handleTelegramScheduleText(context);
  context.messageText = '16:00';
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.durationNone;
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.attendanceOpen;
  await handleTelegramScheduleText(context);
  context.messageText = '5';
  await handleTelegramScheduleText(context);
  context.messageText = '0';
  await handleTelegramScheduleText(context);

  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [['Mesa TV', 'Mesa gran'], [successButton('Sense taula')], ['Tornar'], [dangerButton('/cancel')]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });

  context.messageText = 'Mesa gran';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'confirm');
  assert.equal(getCurrentSession()?.data.tableId, 8);
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
  context.messageText = '05/04';
  await handleTelegramScheduleText(context);
  context.messageText = '16:00';
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.durationNone;
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.attendanceOpen;
  await handleTelegramScheduleText(context);
  context.messageText = '5';
  await handleTelegramScheduleText(context);
  context.messageText = '0';
  await handleTelegramScheduleText(context);

  context.callbackData = `${scheduleCallbackPrefixes.tableSelection}7`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'table');
  assert.equal(replies.at(-1)?.message, 'La taula seleccionada ja no està activa. Torna a triar una taula activa o continua sense taula.');
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
  assert.match(replies.at(-1)?.message ?? '', /<b>Taula:<\/b> Mesa arxiu/);
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
  context.messageText = '05/04';
  await handleTelegramScheduleText(context);
  context.messageText = '16:00';
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.durationNone;
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.attendanceOpen;
  await handleTelegramScheduleText(context);
  context.messageText = '6';
  await handleTelegramScheduleText(context);
  context.messageText = '0';
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
      description: 'Ocells i engines',
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
    {
      id: 5,
      title: 'ahir',
      description: null,
      startsAt: '2026-04-04T12:15:00.000Z',
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
    {
      id: 6,
      title: 'Ravenloft',
      description: 'Cementiri i vampirs',
      startsAt: '2026-04-05T18:30:00.000Z',
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
  await scheduleRepository.upsertParticipant({
    eventId: 4,
    participantTelegramUserId: 42,
    actorTelegramUserId: 42,
    status: 'active',
  });
  await scheduleRepository.upsertParticipant({
    eventId: 6,
    participantTelegramUserId: 55,
    actorTelegramUserId: 55,
    status: 'active',
  });
  const { context, replies } = createContext({ scheduleRepository, actorTelegramUserId: 77 });
  context.messageText = scheduleLabels.list;

  const handled = await handleTelegramScheduleText(context);

  assert.equal(handled, true);
  assert.equal(scheduleRepository.__cancelledEventIds.includes(5), true);
  assert.match(replies.at(-1)?.message ?? '', /<b>05\/04\/2026<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /16h-19h <a href="https:\/\/t\.me\/cawatest_bot\?start=schedule_event_4"><b>Wingspan<\/b><\/a> · Mesa abierta · 3p \(2 libres\)/);
  assert.match(replies.at(-1)?.message ?? '', /18:30h-21:30h <a href="https:\/\/t\.me\/cawatest_bot\?start=schedule_event_6"><b>Ravenloft<\/b><\/a> · Mesa abierta · 4p \(3 libres\)/);
  assert.deepEqual(replies.at(-1)?.options, { parseMode: 'HTML' });
});

test('handleTelegramScheduleCallback opens a selected day with activity buttons', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 4,
      title: 'Wingspan',
      description: 'Ocells i engines',
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
    {
      id: 6,
      title: 'Ravenloft',
      description: 'Cementiri i vampirs',
      startsAt: '2026-04-05T18:30:00.000Z',
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
      id: 7,
      title: 'Blood Bowl',
      description: null,
      startsAt: '2026-04-06T15:00:00.000Z',
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
  const { context, replies } = createContext({ scheduleRepository, actorTelegramUserId: 77 });

  context.callbackData = `${scheduleCallbackPrefixes.day}2026-04-05`;
  assert.equal(await handleTelegramScheduleCallback(context), true);

  assert.match(replies.at(-1)?.message ?? '', /<b>05\/04\/2026<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /16h-19h <a href="https:\/\/t\.me\/cawatest_bot\?start=schedule_event_4"><b>Wingspan<\/b><\/a> · Mesa abierta · 3p \(3 libres\)/);
  assert.match(replies.at(-1)?.message ?? '', /18:30h-21:30h <a href="https:\/\/t\.me\/cawatest_bot\?start=schedule_event_6"><b>Ravenloft<\/b><\/a> · Mesa abierta · 4p \(4 libres\)/);
  assert.deepEqual(replies.at(-1)?.options, { parseMode: 'HTML' });
});

test('handleTelegramScheduleText separates different day groups with a blank line', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 4,
      title: 'Wingspan',
      description: 'Ocells i engines',
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
    {
      id: 8,
      title: 'Blood Bowl',
      description: null,
      startsAt: '2026-04-06T15:00:00.000Z',
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
  const { context, replies } = createContext({ scheduleRepository, actorTelegramUserId: 77 });
  context.messageText = scheduleLabels.list;

  assert.equal(await handleTelegramScheduleText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /<b>05\/04\/2026<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /16h-19h <a href="https:\/\/t\.me\/cawatest_bot\?start=schedule_event_4"><b>Wingspan<\/b><\/a> · Mesa abierta · 3p \(3 libres\)/);
  assert.match(replies.at(-1)?.message ?? '', /<b>06\/04\/2026<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /15h-18h <a href="https:\/\/t\.me\/cawatest_bot\?start=schedule_event_8"><b>Blood Bowl<\/b><\/a> · Mesa abierta · 2p \(2 libres\)/);
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
  assert.match(replies.at(-1)?.message ?? '', /<b>Impacte local:<\/b> Campionat regional \(ocupacio full, impacte high\)/);
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
  assert.match(replies.at(-1)?.message ?? '', /<b>Assistents:<\/b> Ada \(@ada\)/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Places ocupades:<\/b> 1\/3/);
  assert.deepEqual(replies.at(-1)?.options, {
    parseMode: 'HTML',
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
  assert.match(replies.at(-1)?.message ?? '', /<b>Esdeveniments del local rellevants:<\/b>/);
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
  assert.match(replies.at(-1)?.message ?? '', /T'has apuntat correctament a <b>Root<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Assistents:<\/b> Ada \(@ada\), Biel/);

  context.callbackData = `${scheduleCallbackPrefixes.leave}12`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Has sortit correctament de <b>Root<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Assistents:<\/b> Ada \(@ada\)/);
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
  const { context, getCurrentSession, replies } = createContext({ scheduleRepository, auditRepository, actorTelegramUserId: 42 });

  context.callbackData = `${scheduleCallbackPrefixes.inspect}3`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.deepEqual(replies.at(-1)?.options, {
    parseMode: 'HTML',
    inlineKeyboard: [
      [{ text: 'Apuntar-me', callbackData: 'schedule:join:3' }],
      [{ text: 'Editar activitat', callbackData: 'schedule:select_edit:3' }, { text: 'Eliminar activitat', callbackData: 'schedule:select_cancel:3' }],
    ],
  });

  context.callbackData = `${scheduleCallbackPrefixes.selectEdit}3`;
  const handled = await handleTelegramScheduleCallback(context);

  assert.equal(handled, true);
  assert.deepEqual(getCurrentSession(), { flowKey: 'schedule-edit', stepKey: 'select-field', data: { eventId: 3 } });
  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [
      ['Títol', scheduleLabels.editFieldDate],
      [scheduleLabels.editFieldTime, scheduleLabels.editFieldDuration],
      [scheduleLabels.editFieldCapacity],
      [scheduleLabels.editFieldInitialOccupiedSeats],
      [scheduleLabels.editFieldTable],
      ['Descripció'],
      [scheduleLabels.confirmEdit],
      [dangerButton('/cancel')],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
    parseMode: 'HTML',
  });

  context.messageText = scheduleLabels.editFieldTitle;
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = 'Root Deluxe';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Organitzador: Ada \(@ada\)/);
  context.messageText = scheduleLabels.editFieldDate;
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = '06/04';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = scheduleLabels.editFieldTime;
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = '17:30';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = scheduleLabels.editFieldCapacity;
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = '5';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = scheduleLabels.editFieldTable;
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = scheduleLabels.noTable;
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = scheduleLabels.confirmEdit;
  assert.equal(await handleTelegramScheduleText(context), true);

  assert.equal((await scheduleRepository.findEventById(3))?.title, 'Root Deluxe');
  assert.equal((await scheduleRepository.findEventById(3))?.capacity, 5);
  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'schedule.updated');
  assert.equal(auditRepository.__events.at(-1)?.targetId, '3');
});

test('handleTelegramScheduleCallback keeps the existing description when saving an edited activity without changing it', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 3,
      title: 'Root',
      description: 'Actividad original',
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
  const { context, getCurrentSession, replies } = createContext({ scheduleRepository, actorTelegramUserId: 42, language: 'es' });

  context.callbackData = `${scheduleCallbackPrefixes.selectEdit}3`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.deepEqual(getCurrentSession(), { flowKey: 'schedule-edit', stepKey: 'select-field', data: { eventId: 3 } });

  context.messageText = 'Guardar cambios';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /Actividad actualizada correctamente: <b>Root<\/b>/);
  assert.equal((await scheduleRepository.findEventById(3))?.description, 'Actividad original');
});

test('handleTelegramScheduleCallback offers quick minute buttons when editing with hour-only input', async () => {
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
  const { context, replies, getCurrentSession } = createContext({ scheduleRepository, actorTelegramUserId: 42 });

  context.callbackData = `${scheduleCallbackPrefixes.selectEdit}3`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  context.messageText = scheduleLabels.editFieldTime;
  assert.equal(await handleTelegramScheduleText(context), true);

  context.messageText = '19';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.deepEqual(getCurrentSession(), {
    flowKey: 'schedule-edit',
    stepKey: 'time-minute',
    data: { eventId: 3, timeHour: '19' },
  });
  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [[scheduleLabels.keepCurrent], [':00', ':15'], [':30', ':45'], [dangerButton('/cancel')]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });

  context.messageText = ':45';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');
  assert.match(replies.at(-1)?.message ?? '', /19:45/);

  context.messageText = scheduleLabels.confirmEdit;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal((await scheduleRepository.findEventById(3))?.startsAt, '2026-04-05T19:45:00.000Z');
});

test('handleTelegramScheduleCallback keeps the current duration from the duration mode step when editing', async () => {
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
  const { context, replies, getCurrentSession } = createContext({ scheduleRepository, actorTelegramUserId: 42 });

  context.callbackData = `${scheduleCallbackPrefixes.selectEdit}3`;
  await handleTelegramScheduleCallback(context);
  context.messageText = scheduleLabels.editFieldDuration;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'duration-mode');

  context.messageText = scheduleLabels.keepCurrent;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');
  assert.match(replies.at(-1)?.message ?? '', /Durada: 3 h/);
});

test('handleTelegramScheduleCallback keeps the current time from the quick minute step when editing', async () => {
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
  const { context, getCurrentSession } = createContext({ scheduleRepository, actorTelegramUserId: 42 });

  context.callbackData = `${scheduleCallbackPrefixes.selectEdit}3`;
  await handleTelegramScheduleCallback(context);
  context.messageText = scheduleLabels.editFieldTime;
  await handleTelegramScheduleText(context);
  context.messageText = '19';
  await handleTelegramScheduleText(context);

  context.messageText = scheduleLabels.keepCurrent;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');

  context.messageText = scheduleLabels.confirmEdit;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal((await scheduleRepository.findEventById(3))?.startsAt, '2026-04-05T16:00:00.000Z');
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

  context.callbackData = `${scheduleCallbackPrefixes.inspect}8`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.deepEqual(replies.at(-1)?.options, {
    parseMode: 'HTML',
    inlineKeyboard: [
      [{ text: 'Apuntar-me', callbackData: 'schedule:join:8' }],
      [{ text: 'Editar activitat', callbackData: 'schedule:select_edit:8' }, { text: 'Eliminar activitat', callbackData: 'schedule:select_cancel:8' }],
    ],
  });

  context.callbackData = `${scheduleCallbackPrefixes.selectCancel}8`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.deepEqual(getCurrentSession(), { flowKey: 'schedule-cancel', stepKey: 'confirm', data: { eventId: 8 } });

  context.messageText = scheduleLabels.confirmCancel;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /Activitat cancel·lada correctament: <b>Ark Nova<\/b>/);
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
  context.messageText = '05/04';
  await handleTelegramScheduleText(context);
  context.messageText = '17:00';
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.durationMinutes;
  await handleTelegramScheduleText(context);
  context.messageText = '120';
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.attendanceOpen;
  await handleTelegramScheduleText(context);
  context.messageText = '4';
  await handleTelegramScheduleText(context);
  context.messageText = '0';
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
  context.messageText = scheduleLabels.editFieldDate;
  await handleTelegramScheduleText(context);
  context.messageText = '05/04';
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.editFieldTime;
  await handleTelegramScheduleText(context);
  context.messageText = '17:00';
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.editFieldDuration;
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.durationMinutes;
  await handleTelegramScheduleText(context);
  context.messageText = '180';
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.confirmEdit;
  await handleTelegramScheduleText(context);

  assert.deepEqual(privateMessages.map((item) => item.telegramUserId).sort((a, b) => a - b), [42, 55]);
  assert.match(privateMessages[0]?.message ?? '', /possible conflicte/);
  assert.match(privateMessages[0]?.message ?? '', /Catan/);
  assert.match(privateMessages[0]?.message ?? '', /Gaia Project/);
});
