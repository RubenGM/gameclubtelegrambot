import test from 'node:test';
import assert from 'node:assert/strict';

import type { AuditLogEventRecord, AuditLogRepository } from '../audit/audit-log.js';
import type { MembershipAccessRepository, MembershipUserRecord } from '../membership/access-flow.js';
import { resolveNewsGroupCategory, type NewsGroupRecord, type NewsGroupRepository } from '../news/news-group-catalog.js';
import type { ClubTableRecord, ClubTableRepository } from '../tables/table-catalog.js';
import type { ClubEquipmentRecord, ClubEquipmentRepository } from '../equipment/equipment-catalog.js';
import type { ScheduleEventRecord, ScheduleParticipantRecord, ScheduleRepository } from '../schedule/schedule-catalog.js';
import type { VenueEventRecord, VenueEventRepository } from '../venue-events/venue-event-catalog.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import type { TelegramRichMessageInput } from './rich-message-transport.js';
import type { ConversationSessionRecord } from './conversation-session.js';
import type { AppMetadataSessionStorage } from './conversation-session-store.js';
import { normalizeDisplayName } from '../membership/display-name.js';
import { publishCalendarSnapshotToNewsGroups, publishPublicCalendarSnapshotToNewsGroups, refreshCalendarSnapshotsToNewsGroups } from './schedule-notifications.js';
import { createTelegramI18n } from './i18n.js';
import { loadUpcomingCalendarEntries } from './calendar-summary.js';
import { replyCreateTablePrompt, runAfterScheduleSaveSideEffects } from './schedule-flow-support.js';
import {
  handleTelegramScheduleCallback,
  handleTelegramScheduleMessage,
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

function formatCalendarTime(value: string): string {
  const date = new Date(value);
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return minutes === '00' ? `${Number(date.getHours())}h` : `${String(date.getHours()).padStart(2, '0')}:${minutes}`;
}

function formatCalendarRange(startsAt: string, endsAt: string): string {
  return `${formatCalendarTime(startsAt)}-${formatCalendarTime(endsAt)}`;
}

function interpolateTestText(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replaceAll(`{${key}}`, value),
    template,
  );
}

function escapeTestHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type ScheduleEventFixture = Omit<ScheduleEventRecord, 'attendanceMode' | 'isPublic' | 'initialOccupiedSeats' | 'detailsMessageChatId' | 'detailsMessageId'> &
  Partial<Pick<ScheduleEventRecord, 'attendanceMode' | 'isPublic' | 'initialOccupiedSeats' | 'detailsMessageChatId' | 'detailsMessageId'>>;

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
        detailsMessageChatId: input.detailsMessageChatId ?? null,
        detailsMessageId: input.detailsMessageId ?? null,
        startsAt: input.startsAt,
        organizerTelegramUserId: input.organizerTelegramUserId,
        createdByTelegramUserId: input.createdByTelegramUserId,
        tableId: input.tableId,
        equipmentIds: input.equipmentIds ?? [],
        durationMinutes: input.durationMinutes,
        attendanceMode: input.attendanceMode,
        isPublic: input.isPublic,
        initialOccupiedSeats: input.initialOccupiedSeats ?? 0,
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
        isPriority: input.isPriority ?? existing.isPriority ?? false,
        priorityExplanation: input.priorityExplanation === undefined ? existing.priorityExplanation ?? null : input.priorityExplanation,
        title: input.title,
        description: input.description,
        detailsMessageChatId: input.detailsMessageChatId ?? null,
        detailsMessageId: input.detailsMessageId ?? null,
        startsAt: input.startsAt,
        organizerTelegramUserId: input.organizerTelegramUserId,
        tableId: input.tableId,
        equipmentIds: input.equipmentIds ?? existing.equipmentIds ?? [],
        durationMinutes: input.durationMinutes,
        attendanceMode: input.attendanceMode,
        isPublic: input.isPublic,
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
      const existing = participants.get(key);
      const next: ScheduleParticipantRecord = {
        ...existing,
        scheduleEventId: input.eventId,
        participantTelegramUserId: input.participantTelegramUserId,
        status: input.status,
        participationRole: input.participationRole ?? existing?.participationRole ?? 'player',
        companionCount: input.status === 'removed' ? 0 : (input.companionCount ?? existing?.companionCount ?? 0),
        spectatorCount: input.status === 'removed' ? 0 : (input.spectatorCount ?? existing?.spectatorCount ?? 0),
        addedByTelegramUserId: input.actorTelegramUserId,
        removedByTelegramUserId: input.status === 'removed' ? input.actorTelegramUserId : null,
        ...(input.reminderPreferenceConfigured === undefined
          ? {}
          : {
              reminderLeadHours: input.reminderLeadHours ?? null,
              reminderPreferenceConfigured: input.reminderPreferenceConfigured,
            }),
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
    isPublic: event.isPublic ?? false,
    initialOccupiedSeats: event.initialOccupiedSeats ?? 0,
    detailsMessageChatId: event.detailsMessageChatId ?? null,
    detailsMessageId: event.detailsMessageId ?? null,
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

function createEquipmentRepository(initialEquipment: ClubEquipmentRecord[] = []): ClubEquipmentRepository {
  const equipment = new Map(initialEquipment.map((item) => [item.id, item]));
  return {
    async createEquipment() { throw new Error('not implemented'); },
    async findEquipmentById(equipmentId: number) { return equipment.get(equipmentId) ?? null; },
    async listEquipment({ includeDeactivated }) {
      return Array.from(equipment.values()).filter((item) => includeDeactivated || item.lifecycleStatus === 'active');
    },
    async updateEquipment() { throw new Error('not implemented'); },
    async deactivateEquipment() { throw new Error('not implemented'); },
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
  equipmentRepository = createEquipmentRepository(),
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
  equipmentRepository?: ClubEquipmentRepository;
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
  const copiedMessages: Array<{ fromChatId: number; messageId: number; toChatId: number }> = [];
  const forwardedMessages: Array<{ fromChatId: number; messageId: number; toChatId: number }> = [];
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
        getChat: async (chatId: number) => ({ id: chatId, type: 'supergroup', title: `Canal ${chatId}` }),
        sendPrivateMessage: async () => {},
        sendGroupMessage: async (chatId: number, message: string, options?: TelegramReplyOptions) => {
          groupMessages.push({ chatId, message, ...(options ? { options } : {}) });
        },
        copyMessage: async ({ fromChatId, messageId, toChatId }: { fromChatId: number; messageId: number; toChatId: number }) => {
          copiedMessages.push({ fromChatId, messageId, toChatId });
          return { messageId: 9000 + copiedMessages.length };
        },
        forwardMessage: async ({ fromChatId, messageId, toChatId }: { fromChatId: number; messageId: number; toChatId: number }) => {
          forwardedMessages.push({ fromChatId, messageId, toChatId });
          return { messageId: 8000 + forwardedMessages.length };
        },
      },
    },
    scheduleRepository,
    tableRepository,
    equipmentRepository,
    venueEventRepository,
    membershipRepository,
    newsGroupRepository,
    auditRepository,
  };

  context.runtime.bot.sendPrivateMessage = async (telegramUserId: number, message: string) => {
    privateMessages.push({ telegramUserId, message });
  };

  return { context, replies, privateMessages, groupMessages, copiedMessages, forwardedMessages, getCurrentSession: () => currentSession };
}

function createNewsGroupRepository(
  initialGroups: NewsGroupRecord[] = [],
  subscribedGroupsByCategory: Map<string, Set<number>> = new Map(),
): NewsGroupRepository {
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
    async listSubscribedGroupsByCategory(categoryKey) {
      const subscriptions = subscribedGroupsByCategory.get(categoryKey);
      const category = resolveNewsGroupCategory(categoryKey);
      if (!subscriptions && category?.defaultSubscribed === false) {
        return [];
      }
      return Array.from(groups.values()).filter((group) => {
        if (!group.isEnabled) {
          return false;
        }

        if (!subscriptions) {
          return true;
        }

        return subscriptions.has(group.chatId);
      }).map((group) => ({ ...group, messageThreadId: null }));
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

function createMemoryAppMetadataStorage(values: Map<string, string> = new Map()): AppMetadataSessionStorage {
  return {
    async get(key) {
      return values.get(key) ?? null;
    },
    async set(key, value) {
      values.set(key, value);
    },
    async delete(key) {
      return values.delete(key);
    },
    async listByPrefix(prefix) {
      return Array.from(values, ([key, value]) => ({ key, value }))
        .filter((entry) => entry.key.startsWith(prefix));
    },
  };
}

test('handleTelegramScheduleText opens the schedule menu from the keyboard action', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 4,
      title: 'Wingspan',
      description: 'Ocells i engines',
      detailsMessageChatId: 1,
      detailsMessageId: 444,
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
  assert.match(replies.at(-1)?.message ?? '', /<b>Diumenge 5 abril<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /18h-21h <a href="https:\/\/t\.me\/cawa_management_bot\?start=schedule_event_4"><b>Wingspan<\/b><\/a> · Mesa abierta · 3p \(3 libres\)/);
  assert.match(replies.at(-1)?.message ?? '', /<a href="https:\/\/t\.me\/cawa_management_bot\?start=schedule_details_4">Veure detalls<\/a>/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Ocells i engines/);
  assert.deepEqual(replies.at(-1)?.options, {
    parseMode: 'HTML',
    replyKeyboard: [['Veure activitats', 'Crear activitat', 'Crear (simple)'], ['Editar activitat', 'Cancel·lar activitat'], ['Inici', 'Ajuda']],
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
      startsAt: '2026-05-16T16:00:00.000Z',
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
  assert.match(replies.at(-1)?.message ?? '', /<b>Sábado 16 mayo<\/b>/);
});

test('handleTelegramScheduleText accepts the Spanish edit menu label', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 4,
      title: 'Wingspan',
      description: 'Ocells i engines',
      detailsMessageChatId: 1,
      detailsMessageId: 444,
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

test('activity detail shows creator card, named attendees and assignable reserved seats in the selected language', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 4,
      title: 'Partida de rol Pathfinder',
      description: null,
      startsAt: '2026-07-31T16:00:00.000Z',
      organizerTelegramUserId: 42,
      createdByTelegramUserId: 42,
      tableId: null,
      durationMinutes: 240,
      attendanceMode: 'open',
      isPublic: true,
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
  await scheduleRepository.upsertParticipant({
    eventId: 4,
    participantTelegramUserId: 55,
    actorTelegramUserId: 55,
    status: 'active',
  });
  const { context, replies } = createContext({
    scheduleRepository,
    actorTelegramUserId: 42,
    language: 'es',
  });

  context.messageText = '/start schedule_event_4';
  assert.equal(await handleTelegramScheduleStartText(context), true);

  const message = replies.at(-1)?.message ?? '';
  assert.match(message, /<b>Creada por:<\/b> <a href="tg:\/\/user\?id=42">Ada \(@ada\)<\/a>/);
  assert.match(message, /<b>Asistentes:<\/b>\s*\n- <a href="https:\/\/t\.me\/carla">Carla \(@carla\)<\/a>/);
  assert.equal((message.match(/- Reservado - <a href="https:\/\/t\.me\/cawa_management_bot\?start=schedule_reserve_4">Asignar<\/a>/g) ?? []).length, 2);
  assert.doesNotMatch(message, /Plazas ocupadas iniciales/);
  assert.ok(replies.at(-1)?.options?.inlineKeyboard?.flat().some((button) => button.text === 'Promocionar actividad'));
  assert.doesNotMatch(message, /Places ocupades|Assistents|<b>Inici:<\/b>/);
});

test('creator assigns a reserved seat from the paginated approved-member selector without increasing occupancy', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 4,
      title: 'Pathfinder',
      description: null,
      startsAt: '2026-07-31T16:00:00.000Z',
      organizerTelegramUserId: 42,
      createdByTelegramUserId: 42,
      tableId: null,
      durationMinutes: 240,
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
  const auditRepository = createAuditRepository();
  const { context, replies, privateMessages } = createContext({
    scheduleRepository,
    auditRepository,
    actorTelegramUserId: 42,
    language: 'es',
  });

  context.messageText = '/start schedule_reserve_4';
  assert.equal(await handleTelegramScheduleStartText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Elige el socio/);
  assert.match(replies.at(-1)?.message ?? '', /Mostrando 1-4 de 4\. Página 1\/1\./);
  assert.ok(replies.at(-1)?.options?.inlineKeyboard?.flat().some((button) =>
    button.callbackData === `${scheduleCallbackPrefixes.assignReservedSeat}4:55`,
  ));

  context.callbackData = `${scheduleCallbackPrefixes.assignReservedSeat}4:55`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.equal((await scheduleRepository.findEventById(4))?.initialOccupiedSeats, 1);
  assert.equal((await scheduleRepository.findParticipant(4, 55))?.status, 'active');
  assert.match(replies.at(-1)?.message ?? '', /Plaza reservada asignada a Carla/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Plazas ocupadas:<\/b> 2\/4/);
  assert.match(replies.at(-1)?.message ?? '', /- <a href="https:\/\/t\.me\/carla">Carla \(@carla\)<\/a>/);
  assert.equal(privateMessages.at(-1)?.telegramUserId, 55);
  assert.match(privateMessages.at(-1)?.message ?? '', /te ha asignado una plaza reservada/);
  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'schedule.reserved-seat.assigned');
});

test('reserved-seat member selector paginates approved members with links and bounded navigation', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 4,
      title: 'Pathfinder',
      description: null,
      startsAt: '2026-07-31T16:00:00.000Z',
      organizerTelegramUserId: 42,
      createdByTelegramUserId: 42,
      tableId: null,
      durationMinutes: 240,
      attendanceMode: 'open',
      isPublic: false,
      initialOccupiedSeats: 1,
      capacity: 4,
      lifecycleStatus: 'scheduled',
      createdAt: '2026-07-29T10:00:00.000Z',
      updatedAt: '2026-07-29T10:00:00.000Z',
      cancelledAt: null,
      cancelledByTelegramUserId: null,
      cancellationReason: null,
    },
  ]);
  const users: MembershipUserRecord[] = [
    { telegramUserId: 42, username: 'creator42', displayName: 'Creator', status: 'approved', isAdmin: false },
    ...Array.from({ length: 11 }, (_, index): MembershipUserRecord => ({
      telegramUserId: 100 + index,
      username: `member${index + 1}`,
      displayName: `Member ${String(index + 1).padStart(2, '0')}`,
      status: 'approved',
      isAdmin: false,
    })),
  ];
  const { context, replies } = createContext({
    scheduleRepository,
    membershipRepository: createMembershipRepository(users),
    actorTelegramUserId: 42,
    language: 'es',
  });

  context.messageText = '/start schedule_reserve_4';
  assert.equal(await handleTelegramScheduleStartText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Mostrando 1-8 de 12\. Página 1\/2\./);
  assert.ok(replies.at(-1)?.options?.inlineKeyboard?.flat().some((button) =>
    button.callbackData === `${scheduleCallbackPrefixes.reservedSeatPage}4:2`,
  ));

  context.callbackData = `${scheduleCallbackPrefixes.reservedSeatPage}4:99`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Mostrando 9-12 de 12\. Página 2\/2\./);
  assert.ok(replies.at(-1)?.options?.inlineKeyboard?.flat().some((button) =>
    button.callbackData === `${scheduleCallbackPrefixes.reservedSeatPage}4:1`,
  ));
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Member 01/);
});

test('another member cannot open the reserved-seat assignment selector', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 4,
      title: 'Pathfinder',
      description: null,
      startsAt: '2026-07-31T16:00:00.000Z',
      organizerTelegramUserId: 42,
      createdByTelegramUserId: 42,
      tableId: null,
      durationMinutes: 240,
      attendanceMode: 'open',
      isPublic: false,
      initialOccupiedSeats: 1,
      capacity: 4,
      lifecycleStatus: 'scheduled',
      createdAt: '2026-07-29T10:00:00.000Z',
      updatedAt: '2026-07-29T10:00:00.000Z',
      cancelledAt: null,
      cancelledByTelegramUserId: null,
      cancellationReason: null,
    },
  ]);
  const { context, replies } = createContext({
    scheduleRepository,
    actorTelegramUserId: 55,
    language: 'es',
  });

  context.messageText = '/start schedule_reserve_4';
  assert.equal(await handleTelegramScheduleStartText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /No puedes modificar una actividad/);
  assert.equal((await scheduleRepository.findEventById(4))?.initialOccupiedSeats, 1);
});

test('promotion auto-selects the only known destination and publishes an easy join action', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 4,
      title: 'Pathfinder',
      description: null,
      startsAt: '2026-07-31T16:00:00.000Z',
      organizerTelegramUserId: 42,
      createdByTelegramUserId: 42,
      tableId: null,
      durationMinutes: 240,
      attendanceMode: 'open',
      isPublic: false,
      initialOccupiedSeats: 1,
      capacity: 4,
      lifecycleStatus: 'scheduled',
      createdAt: '2026-07-29T10:00:00.000Z',
      updatedAt: '2026-07-29T10:00:00.000Z',
      cancelledAt: null,
      cancelledByTelegramUserId: null,
      cancellationReason: null,
    },
  ]);
  const promotionGroup: NewsGroupRecord = {
      chatId: -1001,
      isEnabled: true,
      metadata: null,
      createdAt: '2026-07-01T10:00:00.000Z',
      updatedAt: '2026-07-01T10:00:00.000Z',
      enabledAt: '2026-07-01T10:00:00.000Z',
      disabledAt: null,
  };
  const newsGroupRepository = createNewsGroupRepository(
    [promotionGroup],
    new Map([['promotions', new Set([-1001])]]),
  );
  const auditRepository = createAuditRepository();
  const { context, replies, groupMessages, getCurrentSession } = createContext({
    scheduleRepository,
    newsGroupRepository,
    auditRepository,
    actorTelegramUserId: 42,
    language: 'es',
  });

  context.callbackData = `${scheduleCallbackPrefixes.promote}4`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'custom-message');
  assert.match(replies.at(-1)?.message ?? '', /mensaje personalizado/);

  context.messageText = '¡Quedan plazas para este viernes!';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession(), null);
  assert.equal(groupMessages.length, 1);
  assert.equal(groupMessages[0]?.chatId, -1001);
  assert.match(groupMessages[0]?.message ?? '', /¡Quedan plazas para este viernes!/);
  assert.match(groupMessages[0]?.message ?? '', /<b>Plazas libres:<\/b> 3/);
  assert.deepEqual(groupMessages[0]?.options?.inlineKeyboard, [[{
    text: 'Ver y apuntarme',
    url: 'https://t.me/cawa_management_bot?start=schedule_event_4',
  }]]);
  assert.match(replies.at(-1)?.message ?? '', /Promoción publicada en Canal -1001/);
  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'schedule.promotion.published');
});

test('promotion asks for a destination when the bot knows more than one', async () => {
  const event: ScheduleEventFixture = {
    id: 4,
    title: 'Pathfinder',
    description: null,
    startsAt: '2026-07-31T16:00:00.000Z',
    organizerTelegramUserId: 42,
    createdByTelegramUserId: 42,
    tableId: null,
    durationMinutes: 240,
    attendanceMode: 'open',
    isPublic: false,
    initialOccupiedSeats: 0,
    capacity: 4,
    lifecycleStatus: 'scheduled',
    createdAt: '2026-07-29T10:00:00.000Z',
    updatedAt: '2026-07-29T10:00:00.000Z',
    cancelledAt: null,
    cancelledByTelegramUserId: null,
    cancellationReason: null,
  };
  const groups = [-1001, -1002].map((chatId): NewsGroupRecord => ({
    chatId,
    isEnabled: true,
    metadata: null,
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
    enabledAt: '2026-07-01T10:00:00.000Z',
    disabledAt: null,
  }));
  const newsGroupRepository = createNewsGroupRepository(
    groups,
    new Map([['promotions', new Set([-1001, -1002])]]),
  );
  newsGroupRepository.listSubscribedGroupsByCategory = async (categoryKey) =>
    categoryKey === 'promotions'
      ? [
          { ...groups[0]!, messageThreadId: null, isDefault: false },
          { ...groups[1]!, messageThreadId: null, isDefault: true },
        ]
      : [];
  const { context, replies, groupMessages, getCurrentSession } = createContext({
    scheduleRepository: createScheduleRepository([event]),
    newsGroupRepository,
    actorTelegramUserId: 42,
    language: 'es',
  });

  context.callbackData = `${scheduleCallbackPrefixes.promote}4`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  context.messageText = 'Sin mensaje';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'select-destination');
  assert.deepEqual(replies.at(-1)?.options?.inlineKeyboard?.map((row) => row[0]?.text), ['Canal -1002', 'Canal -1001']);

  context.callbackData = `${scheduleCallbackPrefixes.promoteTo}4:-1002:0`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.equal(groupMessages.length, 1);
  assert.equal(groupMessages[0]?.chatId, -1002);
});

test('promotion offers a forum General destination separately from known subscribed topics', async () => {
  const event: ScheduleEventFixture = {
    id: 4,
    title: 'Pathfinder',
    description: null,
    startsAt: '2026-07-31T16:00:00.000Z',
    organizerTelegramUserId: 42,
    createdByTelegramUserId: 42,
    tableId: null,
    durationMinutes: 240,
    attendanceMode: 'open',
    isPublic: false,
    initialOccupiedSeats: 0,
    capacity: 4,
    lifecycleStatus: 'scheduled',
    createdAt: '2026-07-29T10:00:00.000Z',
    updatedAt: '2026-07-29T10:00:00.000Z',
    cancelledAt: null,
    cancelledByTelegramUserId: null,
    cancellationReason: null,
  };
  const group: NewsGroupRecord = {
    chatId: -1001,
    isEnabled: true,
    metadata: { promotionDestinationNames: { '3': 'Info i Agenda' } },
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
    enabledAt: '2026-07-01T10:00:00.000Z',
    disabledAt: null,
  };
  const newsGroupRepository = createNewsGroupRepository([group]);
  newsGroupRepository.listSubscribedGroupsByCategory = async (categoryKey) =>
    categoryKey === 'promotions'
      ? [{ ...group, messageThreadId: null }, { ...group, messageThreadId: 3 }]
      : [];
  const { context, replies, groupMessages } = createContext({
    scheduleRepository: createScheduleRepository([event]),
    newsGroupRepository,
    actorTelegramUserId: 42,
    language: 'es',
  });
  context.runtime.bot.getChat = async (chatId: number) => ({
    id: chatId,
    type: 'supergroup',
    title: 'CAWA Girona',
    isForum: true,
  });

  context.callbackData = `${scheduleCallbackPrefixes.promote}4`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  context.messageText = 'Sin mensaje';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.deepEqual(
    replies.at(-1)?.options?.inlineKeyboard?.map((row) => row[0]?.text),
    ['CAWA Girona · General', 'CAWA Girona · Info i Agenda'],
  );

  context.callbackData = `${scheduleCallbackPrefixes.promoteTo}4:-1001:0`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.equal(groupMessages[0]?.chatId, -1001);
  assert.equal(groupMessages[0]?.options?.messageThreadId, undefined);
});

test('schedule details use a rich heading and table with original links, permission-filtered controls and plain fallback', async () => {
  const event = {
    id: 4, title: 'Partida <Catan> & Amics', description: 'Descripció <segura>', startsAt: '2026-04-05T16:00:00.000Z',
    organizerTelegramUserId: 42, createdByTelegramUserId: 42, tableId: null, durationMinutes: 180,
    attendanceMode: 'open' as const, isPublic: false, initialOccupiedSeats: 0, capacity: 4,
    lifecycleStatus: 'scheduled' as const, createdAt: '2026-04-04T10:00:00.000Z', updatedAt: '2026-04-04T10:00:00.000Z',
    cancelledAt: null, cancelledByTelegramUserId: null, cancellationReason: null,
  };
  const { context, replies } = createContext({ scheduleRepository: createScheduleRepository([event]), actorTelegramUserId: 123 });
  const richMessages: TelegramRichMessageInput[] = [];
  context.runtime.bot.sendRichMessage = async (input) => { richMessages.push(input); return { messageId: 42 }; };
  context.messageText = '/start schedule_event_4';
  assert.equal(await handleTelegramScheduleStartText(context), true);
  assert.equal(replies.length, 0);
  assert.match(richMessages[0]?.richMessage.html ?? '', /<h2>Partida &lt;Catan&gt; &amp; Amics<\/h2>/);
  assert.match(richMessages[0]?.richMessage.html ?? '', /<table>.*3 h.*<\/table>/s);
  assert.match(richMessages[0]?.richMessage.html ?? '', /Descripció &lt;segura&gt;/);
  assert.match(richMessages[0]?.fallbackText ?? '', /<b>Partida &lt;Catan&gt; &amp; Amics<\/b>/);
  assert.equal(richMessages[0]?.options?.parseMode, 'HTML');

  context.callbackData = `${scheduleCallbackPrefixes.inspect}4`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.equal(richMessages.length, 2);
  assert.deepEqual(richMessages[1]?.options, richMessages[0]?.options);
  context.runtime.actor.isApproved = false;
  context.runtime.actor.status = 'pending';
  assert.equal(await handleTelegramScheduleStartText(context), false);
  assert.equal(richMessages.length, 2);
});

test('handleTelegramScheduleStartText lets non-approved users open and join public schedule events', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 4,
      title: 'Evento público',
      description: null,
      startsAt: '2026-04-05T16:00:00.000Z',
      organizerTelegramUserId: 42,
      createdByTelegramUserId: 42,
      tableId: null,
      durationMinutes: 180,
      attendanceMode: 'open',
      isPublic: true,
      initialOccupiedSeats: 0,
      capacity: 4,
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancelledByTelegramUserId: null,
      cancellationReason: null,
    },
  ]);
  const { context, replies } = createContext({ scheduleRepository, actorTelegramUserId: 123 });
  context.runtime.actor.status = 'pending';
  context.runtime.actor.isApproved = false;
  context.messageText = '/start schedule_event_4';

  assert.equal(await handleTelegramScheduleStartText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Evento público/);

  context.callbackData = `${scheduleCallbackPrefixes.join}4`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.equal((await scheduleRepository.findParticipant(4, 123))?.status, 'active');
});

test('handleTelegramScheduleStartText keeps private schedule events closed to non-approved users', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 5,
      title: 'Evento privado',
      description: null,
      startsAt: '2026-04-05T16:00:00.000Z',
      organizerTelegramUserId: 42,
      createdByTelegramUserId: 42,
      tableId: null,
      durationMinutes: 180,
      attendanceMode: 'open',
      isPublic: false,
      initialOccupiedSeats: 0,
      capacity: 4,
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancelledByTelegramUserId: null,
      cancellationReason: null,
    },
  ]);
  const { context, replies } = createContext({ scheduleRepository, actorTelegramUserId: 123 });
  context.runtime.actor.status = 'pending';
  context.runtime.actor.isApproved = false;
  context.messageText = '/start schedule_event_5';

  assert.equal(await handleTelegramScheduleStartText(context), false);
  assert.equal(replies.length, 0);
});

test('handleTelegramScheduleStartText forwards the saved details message from a deep link payload', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 4,
      title: 'Wingspan',
      description: 'Ocells i engines',
      detailsMessageChatId: 1,
      detailsMessageId: 444,
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
  const { context, forwardedMessages } = createContext({ scheduleRepository, actorTelegramUserId: 77 });

  context.messageText = '/start schedule_details_4';
  assert.equal(await handleTelegramScheduleStartText(context), true);
  assert.deepEqual(forwardedMessages, [{ fromChatId: 1, messageId: 444, toChatId: 1 }]);
});

test('handleTelegramScheduleText creates an activity through keyboard-guided conversation steps', async () => {
  const texts = createTelegramI18n('ca').schedule;
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
      ['Enrere'], ['Sortir a Agenda'],
      [{ text: '/cancel', semanticRole: 'danger' }],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
    parseMode: 'HTML',
  });

  context.messageText = 'Diumenge, 05/04';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.deepEqual(getCurrentSession(), { flowKey: 'schedule-create', stepKey: 'time', data: { title: 'Dungeons & Dragons', date: '2026-04-05' } });

  context.messageText = '16:00';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'capacity');

  context.messageText = '5';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'confirm');

  context.messageText = texts.editFieldDuration;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'confirm-duration-mode');

  context.messageText = texts.durationMinutes;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'confirm-duration');

  context.messageText = '180';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'confirm');

  context.messageText = texts.detailsAttendanceMode;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'confirm-attendance-mode');

  context.messageText = texts.attendanceOpen;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'confirm');

  context.messageText = texts.editFieldTable;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'confirm-table');
  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [['Mesa TV'], [{ text: 'Sense taula', semanticRole: 'success' }], ['Enrere'], ['Sortir a Agenda'], [{ text: '/cancel', semanticRole: 'danger' }]],
    resizeKeyboard: true,
    persistentKeyboard: true,
    parseMode: 'HTML',
  });

  context.messageText = 'Mesa TV';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'confirm');
  assert.equal(replies.at(-1)?.options?.parseMode, 'HTML');

  context.messageText = scheduleLabels.confirmCreate;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /Activitat creada correctament\. <b>Dungeons &amp; Dragons<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Taula:<\/b> Mesa TV/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Inici:<\/b> 05\/04\/2026 16:00/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Durada:<\/b> 3 h/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Tipus:<\/b> Taula oberta/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Assistents:<\/b> Cap/);
  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'schedule.created');
  assert.equal(auditRepository.__events.at(-1)?.targetType, 'schedule-event');
});

test('handleTelegramScheduleText uses the full-create defaults, shows the selected day schedule, and lets the summary change them', async () => {
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
  const scheduleRepository = createScheduleRepository([
    {
      id: 7,
      title: 'Actividad existente',
      description: null,
      startsAt: '2026-04-05T14:00:00.000Z',
      durationMinutes: 120,
      organizerTelegramUserId: 77,
      createdByTelegramUserId: 77,
      tableId: 7,
      capacity: 4,
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancelledByTelegramUserId: null,
      cancellationReason: null,
    },
  ]);
  const { context, replies, getCurrentSession } = createContext({ scheduleRepository, tableRepository, actorTelegramUserId: 42, language: 'es' });
  const texts = createTelegramI18n('es').schedule;

  context.messageText = texts.create;
  await handleTelegramScheduleText(context);
  context.messageText = 'Actividad nueva';
  await handleTelegramScheduleText(context);
  context.messageText = '05/04';
  await handleTelegramScheduleText(context);
  assert.match(replies.at(-1)?.message ?? '', /Actividad existente/);
  assert.match(replies.at(-1)?.message ?? '', /Mesa TV/);

  context.messageText = '18:00';
  await handleTelegramScheduleText(context);
  assert.equal(getCurrentSession()?.stepKey, 'capacity');
  context.messageText = '5';
  await handleTelegramScheduleText(context);
  assert.equal(getCurrentSession()?.stepKey, 'confirm');
  assert.match(replies.at(-1)?.message ?? '', /<b>Duración:<\/b> 2 h/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Tipo:<\/b> Mesa cerrada/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Mesa:<\/b> Sin mesa/);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard?.slice(0, 3), [
    [texts.editFieldTitle, texts.editFieldDate],
    [texts.editFieldTime, texts.editFieldDuration],
    [texts.editFieldAttendanceMode, texts.editFieldCapacity],
  ]);

  context.messageText = texts.editFieldDuration;
  await handleTelegramScheduleText(context);
  context.messageText = texts.durationHours;
  await handleTelegramScheduleText(context);
  context.messageText = '3';
  await handleTelegramScheduleText(context);
  assert.match(replies.at(-1)?.message ?? '', /<b>Duración:<\/b> 3 h/);

  context.messageText = texts.detailsAttendanceMode;
  await handleTelegramScheduleText(context);
  context.messageText = texts.attendanceOpen;
  await handleTelegramScheduleText(context);
  assert.match(replies.at(-1)?.message ?? '', /<b>Tipo:<\/b> Mesa abierta/);

  context.messageText = texts.editFieldTable;
  await handleTelegramScheduleText(context);
  context.messageText = 'Mesa TV';
  await handleTelegramScheduleText(context);
  assert.match(replies.at(-1)?.message ?? '', /<b>Mesa:<\/b> Mesa TV/);
});

test('handleTelegramScheduleText asks for capacity and creates a simple activity with the documented defaults', async () => {
  const scheduleRepository = createScheduleRepository();
  const auditRepository = createAuditRepository();
  const { context, replies, getCurrentSession } = createContext({ scheduleRepository, auditRepository, actorTelegramUserId: 42 });

  context.messageText = scheduleLabels.createSimple;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.deepEqual(getCurrentSession(), { flowKey: 'schedule-create-simple', stepKey: 'title', data: {} });

  context.messageText = 'Cascadia';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.deepEqual(getCurrentSession(), { flowKey: 'schedule-create-simple', stepKey: 'date', data: { title: 'Cascadia' } });

  context.messageText = 'Diumenge, 05/04';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.deepEqual(getCurrentSession(), { flowKey: 'schedule-create-simple', stepKey: 'time', data: { title: 'Cascadia', date: '2026-04-05' } });

  context.messageText = '16:00';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'attendance-mode');
  assert.equal(replies.at(-1)?.message, createTelegramI18n('ca').schedule.askAttendanceMode);

  context.messageText = createTelegramI18n('ca').schedule.attendanceClosed;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.deepEqual(getCurrentSession(), {
    flowKey: 'schedule-create-simple',
    stepKey: 'capacity',
    data: {
      title: 'Cascadia',
      date: '2026-04-05',
      time: '16:00',
      durationMinutes: 180,
      attendanceMode: 'closed',
      isPublic: false,
      initialOccupiedSeats: 0,
      tableId: null,
    },
  });
  assert.equal(replies.at(-1)?.message, createTelegramI18n('ca').schedule.askCapacity);

  context.messageText = '7';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'confirm');
  assert.equal(await scheduleRepository.findEventById(1), null);
  context.messageText = createTelegramI18n('ca').schedule.confirmCreate;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession(), null);

  const created = await scheduleRepository.findEventById(1);
  assert.deepEqual(created && {
    title: created.title,
    description: created.description,
    startsAt: created.startsAt,
    durationMinutes: created.durationMinutes,
    attendanceMode: created.attendanceMode,
    isPublic: created.isPublic,
    initialOccupiedSeats: created.initialOccupiedSeats,
    capacity: created.capacity,
    tableId: created.tableId,
  }, {
    title: 'Cascadia',
    description: null,
    startsAt: '2026-04-05T14:00:00.000Z',
    durationMinutes: 180,
    attendanceMode: 'closed',
    isPublic: false,
    initialOccupiedSeats: 0,
    capacity: 7,
    tableId: null,
  });
  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'schedule.created');
  assert.match(replies.at(-1)?.message ?? '', /Activitat creada correctament\. <b>Cascadia<\/b>/);
  assert.ok(replies.at(-1)?.options?.inlineKeyboard?.length);
  assert.equal(replies.at(-1)?.options?.replyKeyboard, undefined);
});

test('handleTelegramScheduleText creates a simple activity after selecting minutes for an hour-only time', async () => {
  const scheduleRepository = createScheduleRepository();
  const { context, getCurrentSession } = createContext({ scheduleRepository, actorTelegramUserId: 42 });

  context.messageText = scheduleLabels.createSimple;
  await handleTelegramScheduleText(context);
  context.messageText = 'Heat';
  await handleTelegramScheduleText(context);
  context.messageText = 'Diumenge, 05/04';
  await handleTelegramScheduleText(context);
  context.messageText = '16';
  await handleTelegramScheduleText(context);
  assert.deepEqual(getCurrentSession(), {
    flowKey: 'schedule-create-simple',
    stepKey: 'time-minute',
    data: { title: 'Heat', date: '2026-04-05', timeHour: '16' },
  });

  context.messageText = ':30';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'attendance-mode');
  context.messageText = createTelegramI18n('ca').schedule.attendanceOpen;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'capacity');
  context.messageText = '6';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'confirm');
  context.messageText = createTelegramI18n('ca').schedule.confirmCreate;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession(), null);
  assert.equal((await scheduleRepository.findEventById(1))?.startsAt, '2026-04-05T14:30:00.000Z');
  assert.equal((await scheduleRepository.findEventById(1))?.capacity, 6);
});

test('handleTelegramScheduleText validates capacity and returns to time in simple creation', async () => {
  const scheduleRepository = createScheduleRepository();
  const { context, replies, getCurrentSession } = createContext({ scheduleRepository, actorTelegramUserId: 42 });
  const texts = createTelegramI18n('ca').schedule;

  context.messageText = scheduleLabels.createSimple;
  await handleTelegramScheduleText(context);
  context.messageText = 'Heat';
  await handleTelegramScheduleText(context);
  context.messageText = 'Diumenge, 05/04';
  await handleTelegramScheduleText(context);
  context.messageText = '16:00';
  await handleTelegramScheduleText(context);

  context.messageText = texts.attendanceOpen;
  await handleTelegramScheduleText(context);

  context.messageText = '0';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'capacity');
  assert.equal(replies.at(-1)?.message, texts.invalidCapacity);
  assert.equal(await scheduleRepository.findEventById(1), null);

  context.messageText = texts.creationBack;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.deepEqual(getCurrentSession(), {
    flowKey: 'schedule-create-simple',
    stepKey: 'attendance-mode',
    data: {
      title: 'Heat',
      date: '2026-04-05',
      time: '16:00',
      durationMinutes: 180,
      attendanceMode: 'open',
      isPublic: false,
      initialOccupiedSeats: 0,
      tableId: null,
    },
  });
  assert.equal(replies.at(-1)?.message, texts.askAttendanceMode);
});

test('handleTelegramScheduleText keeps summary-customized open activities member-only by default', async () => {
  const texts = createTelegramI18n('ca').schedule;
  const { context, replies, getCurrentSession } = createContext({ actorTelegramUserId: 42 });

  context.messageText = scheduleLabels.create;
  await handleTelegramScheduleText(context);
  context.messageText = 'Torneo abierto';
  await handleTelegramScheduleText(context);
  context.messageText = 'Diumenge, 05/04';
  await handleTelegramScheduleText(context);
  context.messageText = '16:00';
  await handleTelegramScheduleText(context);
  context.messageText = '5';
  await handleTelegramScheduleText(context);
  context.messageText = texts.detailsAttendanceMode;
  await handleTelegramScheduleText(context);
  context.messageText = texts.attendanceOpen;
  await handleTelegramScheduleText(context);

  assert.equal(getCurrentSession()?.stepKey, 'confirm');
  assert.equal(getCurrentSession()?.data.isPublic, false);
  assert.match(replies.at(-1)?.message ?? '', /Taula oberta/);
});

test('handleTelegramScheduleText skips public visibility for closed activities', async () => {
  const scheduleRepository = createScheduleRepository();
  const { context, replies } = createContext({ scheduleRepository, actorTelegramUserId: 42 });

  context.messageText = scheduleLabels.create;
  await handleTelegramScheduleText(context);
  context.messageText = 'Mesa cerrada';
  await handleTelegramScheduleText(context);
  context.messageText = 'Diumenge, 05/04';
  await handleTelegramScheduleText(context);
  context.messageText = '16:00';
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.durationMinutes;
  await handleTelegramScheduleText(context);
  context.messageText = '180';
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.attendanceClosed;
  await handleTelegramScheduleText(context);
  context.messageText = '4';
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.noTable;
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.confirmCreate;
  await handleTelegramScheduleText(context);

  assert.doesNotMatch(replies.map((reply) => reply.message).join('\n'), /activitat pública/i);
  assert.equal((await scheduleRepository.findEventById(1))?.isPublic, false);
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
  context.messageText = '5';
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
      isPublic: false,
      capacity: 5,
      initialOccupiedSeats: 0,
      tableId: null,
    },
  });
  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [
      [{ text: scheduleLabels.skipOptional, semanticRole: 'success' }],
      ['Enrere'], ['Sortir a Agenda'],
      [{ text: '/cancel', semanticRole: 'danger' }],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
    parseMode: 'HTML',
  });

  context.messageText = 'Campanya narrativa';
  context.messageId = 777;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'confirm');
  assert.match(replies.at(-1)?.message ?? '', /<b>Descripció:<\/b> Campanya narrativa/);

  context.messageText = scheduleLabels.confirmCreate;
  assert.equal(await handleTelegramScheduleText(context), true);
  const event = await scheduleRepository.findEventById(1);
  assert.equal(event?.description, 'Campanya narrativa');
  assert.equal(event?.detailsMessageChatId, 1);
  assert.equal(event?.detailsMessageId, 777);
  assert.match(replies.at(-1)?.message ?? '', /schedule_details_1/);
});

test('handleTelegramScheduleMessage stores an attachment details message during activity creation', async () => {
  const scheduleRepository = createScheduleRepository();
  const { context, getCurrentSession } = createContext({ scheduleRepository, actorTelegramUserId: 42 });

  context.messageText = scheduleLabels.create;
  await handleTelegramScheduleText(context);
  context.messageText = 'Mansions of Madness';
  await handleTelegramScheduleText(context);
  context.messageText = '05/04';
  await handleTelegramScheduleText(context);
  context.messageText = '16:00';
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.durationNone;
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.attendanceClosed;
  await handleTelegramScheduleText(context);
  context.messageText = '5';
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.noTable;
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.editFieldDescription;
  await handleTelegramScheduleText(context);

  context.messageText = undefined;
  context.messageId = 778;
  context.messageMedia = {
    caption: 'Traed investigador pintado',
    messageId: 778,
  };

  assert.equal(await handleTelegramScheduleMessage(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'confirm');

  context.messageMedia = null;
  context.messageText = scheduleLabels.confirmCreate;
  assert.equal(await handleTelegramScheduleText(context), true);
  const event = await scheduleRepository.findEventById(1);
  assert.equal(event?.description, 'Traed investigador pintado');
  assert.equal(event?.detailsMessageChatId, 1);
  assert.equal(event?.detailsMessageId, 778);
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

  context.messageText = createTelegramI18n('ca').schedule.creationBack;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.deepEqual(getCurrentSession(), {
    flowKey: 'schedule-create',
    stepKey: 'time',
    data: { title: 'Terraforming Mars', date: '2026-04-05', timeHour: '17' },
  });
  assert.match(replies.at(-1)?.message ?? '', /HH o HH:MM/);

  context.messageText = '18:30';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'capacity');
  assert.deepEqual(getCurrentSession()?.data, {
    title: 'Terraforming Mars',
    date: '2026-04-05',
    time: '18:30',
    timeHour: '17',
    durationMinutes: 120,
    attendanceMode: 'closed',
    isPublic: false,
    initialOccupiedSeats: 0,
    tableId: null,
  });
});

test('handleTelegramScheduleText goes back from the first create step to the activities menu', async () => {
  const { context, replies, getCurrentSession } = createContext({ actorTelegramUserId: 42 });

  context.messageText = scheduleLabels.create;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'title');

  context.messageText = 'Tornar a Agenda';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /Activitats: tria una acció\./);
  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [['Veure activitats', 'Crear activitat', 'Crear (simple)'], ['Editar activitat', 'Cancel·lar activitat'], ['Inici', 'Ajuda']],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });
});

test('handleTelegramScheduleText offers a one-use web form when the general setting is enabled', async () => {
  const { context, replies, getCurrentSession } = createContext({
    actorTelegramUserId: 42,
    language: 'es',
  });
  const issuedFor: number[] = [];
  context.scheduleWebCreateSettingsStore = {
    async load() {
      return { enabled: true, publicBaseUrl: 'https://cawa.hopto.org' };
    },
    async save(settings) {
      return settings;
    },
  };
  context.scheduleWebCreateTokenStore = {
    async issue({ telegramUserId }) {
      issuedFor.push(telegramUserId);
      return {
        token: 'w'.repeat(43),
        record: {
          telegramUserId,
          sessionKey: 'telegram.session:1:99',
          createdAt: '2026-04-05T09:00:00.000Z',
          expiresAt: '2026-04-05T09:30:00.000Z',
        },
      };
    },
    async inspect() {
      return null;
    },
    async consume() {
      return null;
    },
    async restore() {},
  };

  context.messageText = 'Crear actividad';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.deepEqual(issuedFor, [42]);
  assert.equal(getCurrentSession()?.stepKey, 'title');
  assert.match(replies[0]?.message ?? '', /formulario web/);
  assert.deepEqual(replies[0]?.options?.inlineKeyboard, [[{
    text: 'Abrir formulario web',
    url: `https://cawa.hopto.org/actividad/nueva/${'w'.repeat(43)}`,
    semanticRole: 'primary',
  }]]);
  assert.equal(replies[1]?.message, 'Escribe el título de la actividad.');
  assert.ok(replies[1]?.options?.replyKeyboard);
});

test('handleTelegramScheduleStartText starts activity creation from the calendar deep link', async () => {
  const { context, replies, getCurrentSession } = createContext({
    actorTelegramUserId: 42,
    language: 'es',
  });

  context.messageText = '/start schedule_create';

  assert.equal(await handleTelegramScheduleStartText(context), true);
  assert.equal(getCurrentSession()?.flowKey, 'schedule-create');
  assert.equal(getCurrentSession()?.stepKey, 'title');
  assert.equal(replies.at(-1)?.message, 'Escribe el título de la actividad.');
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
    replyKeyboard: [[':00', ':15'], [':30', ':45'], ['Atrás'], ['Salir a Agenda'], [dangerButton('/cancel')]],
    resizeKeyboard: true,
    persistentKeyboard: true,
    parseMode: 'HTML',
  });

  context.messageText = 'Atrás';
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

  context.messageText = '4';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'confirm');
  context.messageText = scheduleLabels.confirmCreate;
  await handleTelegramScheduleText(context);

  assert.equal((await scheduleRepository.findEventById(1))?.durationMinutes, 120);
  assert.match(replies.at(-1)?.message ?? '', /<b>Durada:<\/b> 2 h/);
});

test('handleTelegramScheduleText creates an activity from whole hours duration input', async () => {
  const texts = createTelegramI18n('ca').schedule;
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

  context.messageText = '4';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = texts.editFieldDuration;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'confirm-duration-mode');

  context.messageText = texts.durationHours;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'confirm-duration-hours');

  context.messageText = '3';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'confirm');
  context.messageText = scheduleLabels.confirmCreate;
  await handleTelegramScheduleText(context);

  assert.equal((await scheduleRepository.findEventById(1))?.durationMinutes, 180);
  assert.match(replies.at(-1)?.message ?? '', /<b>Durada:<\/b> 3 h/);
});

test('handleTelegramScheduleText creates an activity from hours-and-minutes duration input', async () => {
  const texts = createTelegramI18n('ca').schedule;
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

  context.messageText = '6';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = texts.editFieldDuration;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'confirm-duration-mode');

  context.messageText = texts.durationHoursMinutes;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'confirm-duration-hours-minutes');

  context.messageText = '02:30';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'confirm');
  context.messageText = scheduleLabels.confirmCreate;
  await handleTelegramScheduleText(context);

  assert.equal((await scheduleRepository.findEventById(1))?.durationMinutes, 150);
  assert.match(replies.at(-1)?.message ?? '', /<b>Durada:<\/b> 2 h 30 min/);
});

test('handleTelegramScheduleText rejects invalid hours-and-minutes duration input', async () => {
  const texts = createTelegramI18n('ca').schedule;
  const { context, replies, getCurrentSession } = createContext({ actorTelegramUserId: 42 });

  context.messageText = scheduleLabels.create;
  await handleTelegramScheduleText(context);
  context.messageText = 'Eclipse';
  await handleTelegramScheduleText(context);
  context.messageText = 'Diumenge, 05/04';
  await handleTelegramScheduleText(context);
  context.messageText = '16:00';
  await handleTelegramScheduleText(context);
  context.messageText = '4';
  await handleTelegramScheduleText(context);
  context.messageText = texts.editFieldDuration;
  await handleTelegramScheduleText(context);
  context.messageText = texts.durationHoursMinutes;
  await handleTelegramScheduleText(context);

  context.messageText = '2:30';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'confirm-duration-hours-minutes');
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
  assert.match(replies.at(-1)?.message ?? '', /minuts|minutos|minutes/i);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /HH o HH:MM|HH or HH:MM/);
  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [[':00', ':15'], [':30', ':45'], ['Enrere'], ['Sortir a Agenda'], [dangerButton('/cancel')]],
    resizeKeyboard: true,
    persistentKeyboard: true,
    parseMode: 'HTML',
  });

  context.messageText = ':15';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'capacity');
  context.messageText = '4';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = scheduleLabels.confirmCreate;
  assert.equal(await handleTelegramScheduleText(context), true);

  assert.equal((await scheduleRepository.findEventById(1))?.startsAt, new Date(2026, 3, 5, 17, 15).toISOString());
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
  assert.match(replies.at(-1)?.message ?? '', /minuts|minutos|minutes/i);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /HH o HH:MM|HH or HH:MM/);
  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [[':00', ':15'], [':30', ':45'], ['Enrere'], ['Sortir a Agenda'], [dangerButton('/cancel')]],
    resizeKeyboard: true,
    persistentKeyboard: true,
    parseMode: 'HTML',
  });

  context.messageText = ':15';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'capacity');
  context.messageText = '4';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = scheduleLabels.confirmCreate;
  assert.equal(await handleTelegramScheduleText(context), true);

  assert.equal((await scheduleRepository.findEventById(1))?.startsAt, new Date(2026, 3, 5, 2, 15).toISOString());
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
  assert.equal(getCurrentSession()?.stepKey, 'capacity');
  context.messageText = '5';
  assert.equal(await handleTelegramScheduleText(context), true);

  assert.match(replies.at(-1)?.message ?? '', /<b>Tipo:<\/b> Mesa cerrada/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Personas:<\/b> 5/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /<b>Plazas:<\/b> 5/);
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
    replyKeyboard: [[':00', ':15'], [':30', ':45'], ['Enrere'], ['Sortir a Agenda'], [dangerButton('/cancel')]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });
});

test('handleTelegramScheduleText publishes the updated calendar to enabled news groups', async () => {
  const texts = createTelegramI18n('ca').schedule;
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
  context.messageText = '5';
  await handleTelegramScheduleText(context);
  context.messageText = texts.editFieldDuration;
  await handleTelegramScheduleText(context);
  context.messageText = texts.durationMinutes;
  await handleTelegramScheduleText(context);
  context.messageText = '180';
  await handleTelegramScheduleText(context);
  context.messageText = texts.detailsAttendanceMode;
  await handleTelegramScheduleText(context);
  context.messageText = texts.attendanceOpen;
  await handleTelegramScheduleText(context);
  context.messageText = texts.editFieldTable;
  await handleTelegramScheduleText(context);
  context.messageText = 'Mesa TV';
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.editFieldDescription;
  await handleTelegramScheduleText(context);
  context.messageText = 'Traed promo pack';
  context.messageId = 777;
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.confirmCreate;
  await handleTelegramScheduleText(context);

  assert.equal(groupMessages.length, 1);
  assert.equal(groupMessages[0]?.chatId, -200);
  assert.equal(groupMessages[0]?.options?.parseMode, 'HTML');
  assert.match(groupMessages[0]?.message ?? '', /Calendari actualitzat:/);
  const event = await scheduleRepository.findEventById(1);
  assert.match(
    groupMessages[0]?.message ?? '',
    new RegExp(
      `- ${formatCalendarRange(event?.startsAt ?? '2026-04-05T16:00:00.000Z', event ? new Date(new Date(event.startsAt).getTime() + event.durationMinutes * 60000).toISOString() : '2026-04-05T19:00:00.000Z')} <a href="https:\\/\\/t\\.me\\/cawa_management_bot\\?start=schedule_event_1"><b>Dune Imperium<\\/b><\\/a> · Mesa abierta · 5p \\(5 libres\\) · Mesa TV · <a href="https:\\/\\/t\\.me\\/cawa_management_bot\\?start=schedule_details_1">Veure detalls<\\/a>`,
    ),
  );
  assert.doesNotMatch(groupMessages[0]?.message ?? '', /Traed promo pack/);
  assert.ok((groupMessages[0]?.message ?? '').includes(
    escapeTestHtml(interpolateTestText(texts.calendarBroadcastFooter, {
      actor: 'Ada (@ada)',
      action: texts.calendarBroadcastActionCreated,
      title: 'Dune Imperium',
      day: 'Diumenge 5 abril',
    })),
  ));
  assert.match(
    groupMessages[0]?.message ?? '',
    /<a href="https:\/\/t\.me\/cawa_management_bot\?start=schedule_create"><b>Fes la teva reserva<\/b><\/a>$/,
  );
});

test('news calendars include the 30-day boundary and keep distant activities available to direct reads', async () => {
  const scheduleRepository = createScheduleRepository();
  const create = (title: string, startsAt: string) => scheduleRepository.createEvent({
    title, startsAt, description: null, durationMinutes: 180, organizerTelegramUserId: 42,
    createdByTelegramUserId: 42, tableId: null, attendanceMode: 'open', isPublic: true,
    initialOccupiedSeats: 0, capacity: 5,
  });
  const near = await create('Próxima', '2026-04-06T10:00:00.000Z');
  await create('Límite incluido', '2026-05-05T09:00:00.000Z');
  await create('Fuera del límite', '2026-05-05T09:00:00.001Z');
  const far = await create('Curso de Davinci', '2026-09-05T10:00:00.000Z');
  const venueEventRepository = createVenueEventRepository();
  for (const [name, startsAt, endsAt] of [
    ['Cierre próximo', '2026-04-07T10:00:00.000Z', '2026-04-07T14:00:00.000Z'],
    ['Cierre lejano', '2026-09-07T10:00:00.000Z', '2026-09-07T14:00:00.000Z'],
  ]) {
    await venueEventRepository.createVenueEvent({ name: name!, startsAt: startsAt!, endsAt: endsAt!, description: null, occupancyScope: 'full', impactLevel: 'high' });
  }
  const newsGroupRepository = createNewsGroupRepository([{
    chatId: -200, isEnabled: true, metadata: null, createdAt: near.createdAt,
    updatedAt: near.updatedAt, enabledAt: near.createdAt, disabledAt: null,
  }], new Map([['events', new Set([-200])], ['public-events', new Set([-200])]]));
  const { context, groupMessages, replies } = createContext({ scheduleRepository, venueEventRepository, newsGroupRepository, actorTelegramUserId: 42 });

  await runAfterScheduleSaveSideEffects(context, near, 'created');
  assert.equal(groupMessages.length, 2);
  for (const { message } of groupMessages) {
    assert.match(message, /Próxima/);
    assert.match(message, /Límite incluido/);
    assert.doesNotMatch(message, /Fuera del límite|Curso de Davinci|Cierre lejano/);
  }
  assert.match(groupMessages[0]!.message, /Cierre próximo/);
  assert.doesNotMatch(groupMessages[1]!.message, /Cierre próximo/);

  groupMessages.length = 0;
  for (const action of ['created', 'updated', 'deleted'] as const) {
    await runAfterScheduleSaveSideEffects(context, far, action);
  }
  assert.equal(groupMessages.length, 0);
  const entries = await loadUpcomingCalendarEntries({ database: undefined, scheduleRepository, venueEventRepository });
  assert.ok(entries.some((entry) => entry.title === 'Curso de Davinci'));
  assert.ok(entries.some((entry) => entry.title === 'Cierre lejano'));
  context.messageText = scheduleLabels.list;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.match(replies.map((reply) => reply.message).join('\n'), /Curso de Davinci/);

  // When time advances, the formerly distant activity joins the next published snapshot.
  await publishCalendarSnapshotToNewsGroups({
    change: { action: 'updated', event: far }, database: undefined,
    newsGroupRepository, scheduleRepository, venueEventRepository,
    now: new Date('2026-08-10T09:00:00.000Z'),
    resolveActorDisplayName: async () => 'Ada',
    sendGroupMessage: async (_chatId, message) => { groupMessages.push({ chatId: -200, message }); },
  });
  assert.match(groupMessages[0]!.message, /Curso de Davinci/);
});

test('moving a visible activity beyond 30 days refreshes the feed to remove it', async () => {
  const scheduleRepository = createScheduleRepository();
  const event = await scheduleRepository.createEvent({
    title: 'Curso', startsAt: '2026-04-06T10:00:00.000Z', description: null,
    durationMinutes: 180, organizerTelegramUserId: 42, createdByTelegramUserId: 42,
    tableId: null, attendanceMode: 'closed', isPublic: false, initialOccupiedSeats: 0, capacity: 5,
  });
  const newsGroupRepository = createNewsGroupRepository([{
    chatId: -200, isEnabled: true, metadata: null, createdAt: event.createdAt,
    updatedAt: event.updatedAt, enabledAt: event.createdAt, disabledAt: null,
  }]);
  const { context, groupMessages } = createContext({ scheduleRepository, newsGroupRepository, actorTelegramUserId: 42 });
  const moved = await scheduleRepository.updateEvent({ ...event, eventId: event.id, startsAt: '2026-09-05T10:00:00.000Z' });
  await runAfterScheduleSaveSideEffects(context, moved, 'updated', event);
  assert.equal(groupMessages.length, 1);
  assert.doesNotMatch(groupMessages[0]!.message, /schedule_event_/);
  assert.match(groupMessages[0]!.message, /no hi ha activitats/);
});

test('publishCalendarSnapshotToNewsGroups keeps only the latest calendar snapshot message per destination', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 1,
      title: 'Dune Imperium',
      description: 'Cementiri i vampirs sota una lluna plena',
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
  const snapshotStorage = createMemoryAppMetadataStorage(new Map([
    ['telegram.schedule.calendar_snapshot:-200:0', JSON.stringify({ chatId: -200, messageThreadId: null, messageId: 901 })],
    ['google_calendar.settings', JSON.stringify({
      calendarId: 'cawagirona@gmail.com',
      calendarUrl: 'https://calendar.google.com/calendar/u/0?cid=test',
      visibility: 'public',
      syncEnabled: true,
    })],
  ]));
  const deletedMessages: Array<{ chatId: number; messageId: number }> = [];
  const editedMessages: Array<{ chatId: number; messageId: number; text: string; options?: TelegramReplyOptions }> = [];
  const groupMessages: Array<{ chatId: number; message: string; options?: TelegramReplyOptions }> = [];

  await publishCalendarSnapshotToNewsGroups({
    change: { action: 'updated', event: (await scheduleRepository.findEventById(1))! },
    sendGroupMessage: async (chatId, message, options) => {
      groupMessages.push({ chatId, message, ...(options ? { options } : {}) });
      return { messageId: 902 };
    },
    deleteMessage: async (input) => {
      deletedMessages.push(input);
    },
    editMessageText: async (input) => {
      editedMessages.push(input);
    },
    snapshotStorage,
    newsGroupRepository,
    database: undefined,
    scheduleRepository,
    tableRepository: createTableRepository(),
    venueEventRepository: createVenueEventRepository(),
    resolveActorDisplayName: async () => 'Rubén',
  });

  assert.equal(groupMessages.length, 1);
  assert.match(groupMessages[0]?.message ?? '', /<i>Cementiri i vampirs sota un\.\.\.<\/i>/);
  assert.match(groupMessages[0]?.message ?? '', /schedule_event_1">Veure descripció<\/a>/);
  assert.match(
    groupMessages[0]?.message ?? '',
    /Fes la teva reserva<\/b><\/a>\n\n<a href="https:\/\/calendar\.google\.com\/calendar\/embed\?src=cawagirona%40gmail\.com&amp;ctz=Europe%2FMadrid"><b>Ver en Google Calendar<\/b><\/a>$/,
  );
  assert.doesNotMatch(groupMessages[0]?.message ?? '', /lluna plena/);
  assert.deepEqual(deletedMessages, [{ chatId: -200, messageId: 901 }]);
  assert.deepEqual(editedMessages, []);
  assert.equal(
    await snapshotStorage.get('telegram.schedule.calendar_snapshot:events:-200:0'),
    JSON.stringify({ chatId: -200, messageThreadId: null, messageId: 902 }),
  );
});

test('publishPublicCalendarSnapshotToNewsGroups publishes only public schedule events with separate snapshot keys', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 1,
      title: 'Evento público',
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
      isPublic: true,
    },
    {
      id: 2,
      title: 'Evento privado',
      description: null,
      startsAt: '2026-04-05T18:00:00.000Z',
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
      isPublic: false,
    },
  ]);
  const newsGroupRepository = createNewsGroupRepository([
    {
      chatId: -201,
      isEnabled: true,
      metadata: null,
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      enabledAt: '2026-04-04T10:00:00.000Z',
      disabledAt: null,
    },
  ], new Map([['public-events', new Set([-201])]]));
  const snapshotStorage = createMemoryAppMetadataStorage();
  const groupMessages: Array<{ chatId: number; message: string; options?: TelegramReplyOptions }> = [];

  await publishPublicCalendarSnapshotToNewsGroups({
    change: { action: 'updated', event: (await scheduleRepository.findEventById(1))! },
    sendGroupMessage: async (chatId, message, options) => {
      groupMessages.push({ chatId, message, ...(options ? { options } : {}) });
      return { messageId: 903 };
    },
    snapshotStorage,
    newsGroupRepository,
    database: undefined,
    scheduleRepository,
    tableRepository: createTableRepository(),
    venueEventRepository: createVenueEventRepository(),
    resolveActorDisplayName: async () => 'Rubén',
  });

  assert.equal(groupMessages.length, 1);
  assert.equal(groupMessages[0]?.chatId, -201);
  assert.match(groupMessages[0]?.message ?? '', /Evento público/);
  assert.doesNotMatch(groupMessages[0]?.message ?? '', /Evento privado/);
  assert.doesNotMatch(groupMessages[0]?.message ?? '', /start=schedule_create/);
  assert.equal(
    await snapshotStorage.get('telegram.schedule.calendar_snapshot:public-events:-201:0'),
    JSON.stringify({ chatId: -201, messageThreadId: null, messageId: 903 }),
  );
  assert.equal(await snapshotStorage.get('telegram.schedule.calendar_snapshot:events:-201:0'), null);
});

test('publishCalendarSnapshotToNewsGroups retires the previous snapshot when Telegram refuses deletion', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 1,
      title: 'Dune Imperium',
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
  const snapshotStorage = createMemoryAppMetadataStorage(new Map([
    ['telegram.schedule.calendar_snapshot:-200:0', JSON.stringify({ chatId: -200, messageThreadId: null, messageId: 901 })],
  ]));
  const editedMessages: Array<{ chatId: number; messageId: number; text: string; options?: TelegramReplyOptions }> = [];
  const groupMessages: Array<{ chatId: number; message: string; options?: TelegramReplyOptions }> = [];

  await publishCalendarSnapshotToNewsGroups({
    change: { action: 'updated', event: (await scheduleRepository.findEventById(1))! },
    sendGroupMessage: async (chatId, message, options) => {
      groupMessages.push({ chatId, message, ...(options ? { options } : {}) });
      return { messageId: 902 };
    },
    deleteMessage: async () => {
      throw new Error("Call to 'deleteMessage' failed! (400: Bad Request: message can't be deleted)");
    },
    editMessageText: async (input) => {
      editedMessages.push(input);
    },
    snapshotStorage,
    newsGroupRepository,
    database: undefined,
    scheduleRepository,
    tableRepository: createTableRepository(),
    venueEventRepository: createVenueEventRepository(),
    resolveActorDisplayName: async () => 'Rubén',
  });

  assert.equal(groupMessages.length, 1);
  assert.equal(editedMessages.length, 1);
  assert.deepEqual(editedMessages[0], {
    chatId: -200,
    messageId: 901,
    text: createTelegramI18n('ca').schedule.calendarBroadcastReplaced,
    options: { parseMode: 'HTML' },
  });
  assert.equal(
    await snapshotStorage.get('telegram.schedule.calendar_snapshot:events:-200:0'),
    JSON.stringify({ chatId: -200, messageThreadId: null, messageId: 902 }),
  );
});

test('handleTelegramScheduleText publishes the updated calendar only to groups subscribed to agenda category', async () => {
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
  const newsGroupRepository = createNewsGroupRepository(
    [
      {
        chatId: -200,
        isEnabled: true,
        metadata: null,
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        enabledAt: '2026-04-04T10:00:00.000Z',
        disabledAt: null,
      },
      {
        chatId: -201,
        isEnabled: true,
        metadata: null,
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        enabledAt: '2026-04-04T10:00:00.000Z',
        disabledAt: null,
      },
    ],
    new Map([
      ['events', new Set([-200])],
    ]),
  );
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
});

test('handleTelegramScheduleText still publishes the calendar when the private confirmation reply fails', async () => {
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
  context.reply = async () => {
    throw new Error('sendMessage failed');
  };
  context.messageText = scheduleLabels.confirmCreate;

  const handled = await handleTelegramScheduleText(context);

  assert.equal(handled, true);
  assert.equal((await scheduleRepository.findEventById(1))?.title, 'Dune Imperium');
  assert.equal(groupMessages.length, 1);
  assert.match(groupMessages[0]?.message ?? '', /Calendari actualitzat:/);
  assert.match(groupMessages[0]?.message ?? '', /Dune Imperium/);
});

test('handleTelegramScheduleText accepts dd/MM/yyyy dates and shows upcoming day shortcuts', async () => {
  const { context, replies, getCurrentSession } = createContext({ actorTelegramUserId: 42 });

  context.messageText = scheduleLabels.create;
  await handleTelegramScheduleText(context);
  context.messageText = 'Ark Nova';
  await handleTelegramScheduleText(context);

  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [['Diumenge, 05/04', 'Dilluns, 06/04'], ['Dimarts, 07/04', 'Dimecres, 08/04'], ['Dijous, 09/04', 'Divendres, 10/04'], ['Enrere'], ['Sortir a Agenda'], [dangerButton('/cancel')]],
    resizeKeyboard: true,
    persistentKeyboard: true,
    parseMode: 'HTML',
  });

  context.messageText = 'Dilluns, 06/04/2026';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.data.date, '2026-04-06');
});

test('handleTelegramScheduleText shows created tables as reply keyboard buttons during selection', async () => {
  const texts = createTelegramI18n('ca').schedule;
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
  context.messageText = '5';
  await handleTelegramScheduleText(context);
  context.messageText = texts.editFieldTable;
  await handleTelegramScheduleText(context);

  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [['Mesa TV', 'Mesa gran'], [successButton('Sense taula')], ['Enrere'], ['Sortir a Agenda'], [dangerButton('/cancel')]],
    resizeKeyboard: true,
    persistentKeyboard: true,
    parseMode: 'HTML',
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
  const texts = createTelegramI18n('ca').schedule;
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
  context.messageText = '5';
  await handleTelegramScheduleText(context);
  context.messageText = texts.editFieldTable;
  await handleTelegramScheduleText(context);

  context.callbackData = `${scheduleCallbackPrefixes.tableSelection}7`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'confirm-table');
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
      detailsMessageChatId: 1,
      detailsMessageId: 444,
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
      description: 'Cementiri i vampirs sota una lluna plena',
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
  assert.match(replies.at(-1)?.message ?? '', /<b>Diumenge 5 abril<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /18h-21h <a href="https:\/\/t\.me\/cawa_management_bot\?start=schedule_event_4"><b>Wingspan<\/b><\/a> · Mesa abierta · 3p \(2 libres\)/);
  assert.match(replies.at(-1)?.message ?? '', /<a href="https:\/\/t\.me\/cawa_management_bot\?start=schedule_details_4">Veure detalls<\/a>/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Ocells i engines/);
  assert.match(replies.at(-1)?.message ?? '', /20:30h-23:30h <a href="https:\/\/t\.me\/cawa_management_bot\?start=schedule_event_6"><b>Ravenloft<\/b><\/a> · Mesa abierta · 4p \(3 libres\)/);
  assert.match(replies.at(-1)?.message ?? '', /<i>Cementiri i vampirs sota un\.\.\.<\/i>/);
  assert.match(replies.at(-1)?.message ?? '', /schedule_event_6">Veure descripció<\/a>/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /lluna plena/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /schedule_details_6/);
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

  assert.match(replies.at(-1)?.message ?? '', /<b>Diumenge 5 abril<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /18h-21h <a href="https:\/\/t\.me\/cawa_management_bot\?start=schedule_event_4"><b>Wingspan<\/b><\/a> · Mesa abierta · 3p \(3 libres\)/);
  assert.match(replies.at(-1)?.message ?? '', /20:30h-23:30h <a href="https:\/\/t\.me\/cawa_management_bot\?start=schedule_event_6"><b>Ravenloft<\/b><\/a> · Mesa abierta · 4p \(4 libres\)/);
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
  assert.match(replies.at(-1)?.message ?? '', /<b>Diumenge 5 abril<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /18h-21h <a href="https:\/\/t\.me\/cawa_management_bot\?start=schedule_event_4"><b>Wingspan<\/b><\/a> · Mesa abierta · 3p \(3 libres\)/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Dilluns 6 abril<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /17h-20h <a href="https:\/\/t\.me\/cawa_management_bot\?start=schedule_event_8"><b>Blood Bowl<\/b><\/a> · Mesa abierta · 2p \(2 libres\)/);
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
  assert.match(replies.at(-1)?.message ?? '', /<b>Impacte local:<\/b> Campionat regional \(ocupació full, impacte high\)/);
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
  assert.match(replies.at(-1)?.message ?? '', /<b>Assistents:<\/b>\s*\n- <a href="tg:\/\/user\?id=42">Ada \(@ada\)<\/a>/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Places ocupades:<\/b> 1\/3/);
  assert.deepEqual(replies.at(-1)?.options, {
    parseMode: 'HTML',
    inlineKeyboard: [
      [{ text: '🎮 Apuntar-me a jugar', callbackData: 'schedule:join:6' }],
      [{ text: "👀 Apuntar-me d'espectador", callbackData: 'schedule:join_spec:6' }],
    ],
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
  assert.match(replies.at(-1)?.message ?? '', /ocupació full, impacte high/);
  assert.match(replies.at(-1)?.message ?? '', /Això no bloqueja automàticament l'activitat/);
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
  assert.match(replies.at(-1)?.message ?? '', /<b>Assistents:<\/b>\s*\n- <a href="tg:\/\/user\?id=42">Ada \(@ada\)<\/a>\n- <a href="tg:\/\/user\?id=77">Biel<\/a>/);

  context.callbackData = `${scheduleCallbackPrefixes.leave}12`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Has sortit correctament de <b>Root<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Assistents:<\/b>\s*\n- <a href="tg:\/\/user\?id=42">Ada \(@ada\)<\/a>/);
});

test('handleTelegramScheduleCallback asks and stores a reminder preference after joining', async () => {
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
  const { context, getCurrentSession, replies } = createContext({ scheduleRepository, actorTelegramUserId: 77 });

  context.callbackData = `${scheduleCallbackPrefixes.join}12`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Quin recordatori vols per a aquesta activitat\?/);
  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [['2h abans', '24h abans'], ['Personalitzat', 'Sense recordatori']],
    resizeKeyboard: true,
    persistentKeyboard: true,
    parseMode: 'HTML',
  });
  assert.equal(getCurrentSession()?.flowKey, 'schedule-join-reminder');

  context.messageText = '2h abans';
  assert.equal(await handleTelegramScheduleText(context), true);

  const participant = await scheduleRepository.findParticipant(12, 77);
  assert.equal(participant?.reminderLeadHours, 2);
  assert.equal(participant?.reminderPreferenceConfigured, true);
  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /Recordatori configurat: 2h abans\./);
});

test('handleTelegramScheduleCallback lets an organizer edit their own activity', async () => {
  const texts = createTelegramI18n('ca').schedule;
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
      [{ text: '🎮 Apuntar-me a jugar', callbackData: 'schedule:join:3' }],
      [{ text: "👀 Apuntar-me d'espectador", callbackData: 'schedule:join_spec:3' }],
      [{ text: 'Editar activitat', callbackData: 'schedule:select_edit:3' }, { text: 'Eliminar activitat', callbackData: 'schedule:select_cancel:3' }],
      [{ text: 'Promocionar activitat', callbackData: 'schedule:promote:3' }],
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
      [scheduleLabels.editFieldCapacity, scheduleLabels.editFieldAttendanceMode],
      [scheduleLabels.editFieldInitialOccupiedSeats],
      [scheduleLabels.editFieldPublicVisibility],
      [scheduleLabels.editFieldTable, scheduleLabels.editFieldEquipment],
      ['Descripció'],
      [texts.confirmEdit],
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
  assert.match(replies.at(-1)?.message ?? '', /<b>Organitzador:<\/b> Ada \(@ada\)/);
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
  context.messageText = scheduleLabels.editFieldAttendanceMode;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'attendance-mode');
  context.messageText = texts.attendanceClosed;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /<b>Tipus:<\/b> Taula tancada/);
  context.messageText = texts.confirmEdit;
  assert.equal(await handleTelegramScheduleText(context), true);

  assert.equal((await scheduleRepository.findEventById(3))?.title, 'Root Deluxe');
  assert.equal((await scheduleRepository.findEventById(3))?.capacity, 5);
  assert.equal((await scheduleRepository.findEventById(3))?.attendanceMode, 'closed');
  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'schedule.updated');
  assert.equal(auditRepository.__events.at(-1)?.targetId, '3');
});

test('handleTelegramScheduleCallback keeps the existing description when saving an edited activity without changing it', async () => {
  const texts = createTelegramI18n('es').schedule;
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

  context.messageText = texts.confirmEdit;
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
  assert.match(replies.at(-1)?.message ?? '', /minuts|minutos|minutes/i);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /HH o HH:MM|HH or HH:MM/);
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
  assert.equal((await scheduleRepository.findEventById(3))?.startsAt, new Date(2026, 3, 5, 19, 45).toISOString());
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
  assert.match(replies.at(-1)?.message ?? '', /<b>Durada:<\/b> 3 h/);
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
      [{ text: '🎮 Apuntar-me a jugar', callbackData: 'schedule:join:8' }],
      [{ text: "👀 Apuntar-me d'espectador", callbackData: 'schedule:join_spec:8' }],
      [{ text: 'Editar activitat', callbackData: 'schedule:select_edit:8' }, { text: 'Eliminar activitat', callbackData: 'schedule:select_cancel:8' }],
      [{ text: 'Promocionar activitat', callbackData: 'schedule:promote:8' }],
      [{ text: 'Marcar com a prioritària', callbackData: 'schedule:priority:8:on' }],
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

test('handleTelegramScheduleText warns in the creation summary when a selected table overlaps another activity', async () => {
  const tableRepository = createTableRepository([
    {
      id: 7,
      displayName: 'Mesa principal',
      description: null,
      recommendedCapacity: 4,
      lifecycleStatus: 'active',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      deactivatedAt: null,
    },
  ]);
  const scheduleRepository = createScheduleRepository([
    {
      id: 30,
      title: 'Terraforming Mars',
      description: null,
      startsAt: '2026-04-05T16:00:00.000Z',
      organizerTelegramUserId: 55,
      createdByTelegramUserId: 55,
      tableId: 7,
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
  const { context, replies } = createContext({ scheduleRepository, tableRepository, actorTelegramUserId: 77, language: 'es' });
  const texts = createTelegramI18n('es').schedule;

  context.messageText = texts.create;
  await handleTelegramScheduleText(context);
  context.messageText = 'Ark Nova';
  await handleTelegramScheduleText(context);
  context.messageText = '05/04';
  await handleTelegramScheduleText(context);
  context.messageText = '17:00';
  await handleTelegramScheduleText(context);
  context.messageText = '4';
  await handleTelegramScheduleText(context);
  context.messageText = texts.editFieldTable;
  await handleTelegramScheduleText(context);
  context.messageText = 'Mesa principal';
  await handleTelegramScheduleText(context);

  const summary = replies.at(-1)?.message ?? '';
  assert.match(summary, /posible conflicto/i);
  assert.match(summary, /Terraforming Mars/);
  assert.match(summary, /- 18h-21h .*Terraforming Mars/);
  assert.match(summary, /https:\/\/t\.me\/carla/);
});

test('activity creation can reserve several equipment items and warns about equipment overlaps', async () => {
  const scheduleRepository = createScheduleRepository([{
    id: 40,
    title: 'Actividad con TV',
    description: null,
    startsAt: '2026-04-05T16:00:00.000Z',
    organizerTelegramUserId: 77,
    createdByTelegramUserId: 77,
    tableId: null,
    equipmentIds: [2],
    durationMinutes: 180,
    capacity: 4,
    lifecycleStatus: 'scheduled',
    createdAt: '2026-04-04T10:00:00.000Z',
    updatedAt: '2026-04-04T10:00:00.000Z',
    cancelledAt: null,
    cancelledByTelegramUserId: null,
    cancellationReason: null,
  }]);
  const equipmentRepository = createEquipmentRepository([
    {
      id: 2,
      displayName: 'TV móvil',
      description: 'Con ruedas',
      lifecycleStatus: 'active',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      deactivatedAt: null,
    },
    {
      id: 3,
      displayName: 'Proyector',
      description: null,
      lifecycleStatus: 'active',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      deactivatedAt: null,
    },
  ]);
  const { context, replies } = createContext({
    scheduleRepository,
    equipmentRepository,
    actorTelegramUserId: 42,
    language: 'es',
  });
  await context.runtime.session.start({
    flowKey: 'schedule-create',
    stepKey: 'table',
    data: {
      title: 'Nueva actividad',
      date: '2026-04-05',
      time: '17:00',
      durationMinutes: 120,
      attendanceMode: 'closed',
      isPublic: false,
      initialOccupiedSeats: 0,
      capacity: 4,
    },
  });

  context.messageText = 'Sin mesa';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /equipamiento que quieres reservar/i);

  context.messageText = 'TV móvil';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard?.[0], ['✓ TV móvil', 'Proyector']);

  context.messageText = 'Proyector';
  assert.equal(await handleTelegramScheduleText(context), true);
  context.messageText = 'Terminar selección';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /<b>Equipamiento:<\/b> TV móvil, Proyector/);
  assert.match(replies.at(-1)?.message ?? '', /posible conflicto con tus reservas del club/);
  assert.ok(replies.at(-1)?.options?.replyKeyboard?.some((row) => row[0] === 'Mesa' && row[1] === 'Equipamiento'));

  context.messageText = 'Equipamiento';
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /equipamiento que quieres reservar/i);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard?.[0], ['✓ TV móvil', '✓ Proyector']);
  context.messageText = 'Terminar selección';
  assert.equal(await handleTelegramScheduleText(context), true);

  context.messageText = 'Guardar actividad';
  assert.equal(await handleTelegramScheduleText(context), true);
  const created = (await scheduleRepository.listEvents({ includeCancelled: false })).find((event) => event.title === 'Nueva actividad');
  assert.deepEqual(created?.equipmentIds, [2, 3]);
});

test('handleTelegramScheduleText sends private conflict notifications after creating an overlapping activity', async () => {
  const texts = createTelegramI18n('ca').schedule;
  const tableRepository = createTableRepository([
    {
      id: 7,
      displayName: 'Mesa principal',
      description: null,
      recommendedCapacity: 4,
      lifecycleStatus: 'active',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      deactivatedAt: null,
    },
  ]);
  const scheduleRepository = createScheduleRepository([
    {
      id: 30,
      title: 'Terraforming Mars',
      description: null,
      startsAt: '2026-04-05T16:00:00.000Z',
      organizerTelegramUserId: 42,
      createdByTelegramUserId: 42,
      tableId: 7,
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
  const { context, privateMessages } = createContext({ scheduleRepository, tableRepository, actorTelegramUserId: 77 });

  context.messageText = scheduleLabels.create;
  await handleTelegramScheduleText(context);
  context.messageText = 'Ark Nova';
  await handleTelegramScheduleText(context);
  context.messageText = '05/04';
  await handleTelegramScheduleText(context);
  context.messageText = '17:00';
  await handleTelegramScheduleText(context);
  context.messageText = '4';
  await handleTelegramScheduleText(context);
  context.messageText = texts.editFieldTable;
  await handleTelegramScheduleText(context);
  context.messageText = 'Mesa principal';
  await handleTelegramScheduleText(context);
  context.messageText = scheduleLabels.confirmCreate;
  await handleTelegramScheduleText(context);

  assert.deepEqual(privateMessages.map((item) => item.telegramUserId).sort((a, b) => a - b), [42, 55]);
  assert.match(privateMessages[0]?.message ?? '', /possible conflicte/);
  assert.match(privateMessages[0]?.message ?? '', /Ark Nova/);
  assert.match(privateMessages[0]?.message ?? '', /Terraforming Mars/);
});

test('handleTelegramScheduleText sends private conflict notifications after editing into an overlap', async () => {
  const tableRepository = createTableRepository([
    {
      id: 7,
      displayName: 'Mesa principal',
      description: null,
      recommendedCapacity: 4,
      lifecycleStatus: 'active',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      deactivatedAt: null,
    },
  ]);
  const scheduleRepository = createScheduleRepository([
    {
      id: 40,
      title: 'Gaia Project',
      description: null,
      startsAt: '2026-04-05T16:00:00.000Z',
      organizerTelegramUserId: 42,
      createdByTelegramUserId: 42,
      tableId: 7,
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
      tableId: 7,
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
  const { context, privateMessages } = createContext({ scheduleRepository, tableRepository, actorTelegramUserId: 77 });

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

test('handleTelegramScheduleCallback allows joining directly as spectator, displaying in spectator list with zero occupied seats', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 50,
      title: 'Game of Thrones',
      description: null,
      startsAt: '2026-04-05T16:00:00.000Z',
      organizerTelegramUserId: 42,
      createdByTelegramUserId: 42,
      tableId: null,
      durationMinutes: 240,
      capacity: 6,
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancelledByTelegramUserId: null,
      cancellationReason: null,
    },
  ]);
  await scheduleRepository.upsertParticipant({ eventId: 50, participantTelegramUserId: 42, actorTelegramUserId: 42, status: 'active', participationRole: 'player' });
  const { context, replies } = createContext({ scheduleRepository, actorTelegramUserId: 77 });

  context.callbackData = `${scheduleCallbackPrefixes.joinSpectator}50`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /T'has apuntat correctament a <b>Game of Thrones<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Places ocupades:<\/b> 1\/6/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Espectadors:<\/b>\s*\n- <a href="tg:\/\/user\?id=77">Biel<\/a>/);

  context.callbackData = `${scheduleCallbackPrefixes.inspect}50`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.deepEqual(replies.at(-1)?.options, {
    parseMode: 'HTML',
    inlineKeyboard: [
      [{ text: '👀 Espectadors (+0)', callbackData: 'schedule:spec:50' }],
      [{ text: '🎮 Passar a jugar', callbackData: 'schedule:switch:50:player' }],
      [{ text: 'Sortir', callbackData: 'schedule:leave:50' }],
    ],
  });
});

test('handleTelegramScheduleCallback switches roles between player and spectator and respects capacity', async () => {
  const scheduleRepository = createScheduleRepository([
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
  await scheduleRepository.upsertParticipant({ eventId: 51, participantTelegramUserId: 42, actorTelegramUserId: 42, status: 'active', participationRole: 'player' });
  const { context, replies } = createContext({ scheduleRepository, actorTelegramUserId: 77 });

  // User 77 joins as spectator
  context.callbackData = `${scheduleCallbackPrefixes.joinSpectator}51`;
  assert.equal(await handleTelegramScheduleCallback(context), true);

  // User 77 tries to switch to player when capacity is full (1/1)
  context.callbackData = `${scheduleCallbackPrefixes.switchRole}51:player`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.equal(replies.at(-1)?.message, 'La darrera plaça de joc ha estat ocupada per un altre soci.');

  // Create event with capacity 2
  const event2 = await scheduleRepository.createEvent({
    title: 'Brass',
    description: null,
    startsAt: '2026-04-05T16:00:00.000Z',
    organizerTelegramUserId: 42,
    createdByTelegramUserId: 42,
    tableId: null,
    durationMinutes: 120,
    attendanceMode: 'open',
    isPublic: true,
    initialOccupiedSeats: 0,
    capacity: 2,
  });
  await scheduleRepository.upsertParticipant({ eventId: event2.id, participantTelegramUserId: 42, actorTelegramUserId: 42, status: 'active', participationRole: 'player' });

  // Join as spectator
  context.callbackData = `${scheduleCallbackPrefixes.joinSpectator}${event2.id}`;
  await handleTelegramScheduleCallback(context);

  // Switch to player when seat available
  context.callbackData = `${scheduleCallbackPrefixes.switchRole}${event2.id}:player`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /<b>Places ocupades:<\/b> 2\/2/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Assistents:<\/b>\s*\n- <a href="tg:\/\/user\?id=42">Ada \(@ada\)<\/a>\n- <a href="tg:\/\/user\?id=77">Biel<\/a>/);

  // Switch back to spectator
  context.callbackData = `${scheduleCallbackPrefixes.switchRole}${event2.id}:spectator`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /<b>Places ocupades:<\/b> 1\/2/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Espectadors:<\/b>\s*\n- <a href="tg:\/\/user\?id=77">Biel<\/a>/);
});

test('handleTelegramScheduleCallback manages companion count with +/- buttons and reset', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 52,
      title: 'Terraforming Mars',
      description: null,
      startsAt: '2026-04-05T16:00:00.000Z',
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
  ]);
  const { context, replies } = createContext({ scheduleRepository, actorTelegramUserId: 77 });

  // Join as player
  context.callbackData = `${scheduleCallbackPrefixes.join}52`;
  await handleTelegramScheduleCallback(context);

  // Open manage companions dialog
  context.callbackData = `${scheduleCallbackPrefixes.manageCompanions}52`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Actualment en tens: 0/);
  assert.match(replies.at(-1)?.message ?? '', /Places lliures a la taula: 3/);
  assert.deepEqual(replies.at(-1)?.options, {
    parseMode: 'HTML',
    inlineKeyboard: [
      [
        { text: '➖ 1', callbackData: 'schedule:cdelta:52:-1' },
        { text: '➕ 1', callbackData: 'schedule:cdelta:52:+1' },
      ],
      [
        { text: '0 acompanyants', callbackData: 'schedule:cdelta:52:0' },
      ],
      [
        { text: "« Tornar a l'activitat", callbackData: 'schedule:inspect:52' },
      ],
    ],
  });

  // Increment to 1 companion
  context.callbackData = `${scheduleCallbackPrefixes.companionDelta}52:+1`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Actualment en tens: 1/);
  assert.match(replies.at(-1)?.message ?? '', /Places lliures a la taula: 2/);

  // Increment to 2 companions
  context.callbackData = `${scheduleCallbackPrefixes.companionDelta}52:+1`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Actualment en tens: 2/);
  assert.match(replies.at(-1)?.message ?? '', /Places lliures a la taula: 1/);

  // View activity detail - occupied seats is 3/4 (1 player + 2 companions)
  context.callbackData = `${scheduleCallbackPrefixes.inspect}52`;
  await handleTelegramScheduleCallback(context);
  assert.match(replies.at(-1)?.message ?? '', /<b>Places ocupades:<\/b> 3\/4/);
  assert.match(replies.at(-1)?.message ?? '', /Biel<\/a> \(\+2 a jugar\)/);
  assert.deepEqual(replies.at(-1)?.options?.inlineKeyboard?.[0], [
    { text: '👥 Acompanyants a jugar (+2)', callbackData: 'schedule:comp:52' },
  ]);
  assert.deepEqual(replies.at(-1)?.options?.inlineKeyboard?.[1], [
    { text: '👀 Espectadors (+0)', callbackData: 'schedule:spec:52' },
  ]);

  // Increment to 3 companions (filling table: 4/4)
  context.callbackData = `${scheduleCallbackPrefixes.companionDelta}52:+1`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Actualment en tens: 3/);
  assert.match(replies.at(-1)?.message ?? '', /Places lliures a la taula: 0/);

  // Attempting to add another companion when full should fail
  context.callbackData = `${scheduleCallbackPrefixes.companionDelta}52:+1`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.equal(replies.at(-1)?.message, 'No queden places lliures a la taula per afegir més acompanyants.');

  // Decrement to 2
  context.callbackData = `${scheduleCallbackPrefixes.companionDelta}52:-1`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Actualment en tens: 2/);

  // Reset to 0
  context.callbackData = `${scheduleCallbackPrefixes.companionDelta}52:0`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Actualment en tens: 0/);

  // Leave activity
  context.callbackData = `${scheduleCallbackPrefixes.leave}52`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Has sortit correctament/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Places ocupades:<\/b> 0\/4/);
});

test('handleTelegramScheduleCallback manages spectator count without taking table seats', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 53,
      title: 'Ark Nova',
      description: null,
      startsAt: '2026-04-05T16:00:00.000Z',
      organizerTelegramUserId: 42,
      createdByTelegramUserId: 42,
      tableId: null,
      durationMinutes: 120,
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

  // Join as spectator
  context.callbackData = `${scheduleCallbackPrefixes.joinSpectator}53`;
  await handleTelegramScheduleCallback(context);

  // Open manage spectators dialog
  context.callbackData = `${scheduleCallbackPrefixes.manageSpectators}53`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Actualment en tens: 0/);
  assert.deepEqual(replies.at(-1)?.options, {
    parseMode: 'HTML',
    inlineKeyboard: [
      [
        { text: '➖ 1', callbackData: 'schedule:sdelta:53:-1' },
        { text: '➕ 1', callbackData: 'schedule:sdelta:53:+1' },
      ],
      [
        { text: '0 espectadors', callbackData: 'schedule:sdelta:53:0' },
      ],
      [
        { text: "« Tornar a l'activitat", callbackData: 'schedule:inspect:53' },
      ],
    ],
  });

  // Increment spectators
  context.callbackData = `${scheduleCallbackPrefixes.spectatorDelta}53:+1`;
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Actualment en tens: 1/);

  // View detail: occupied seats should still be 0/2
  context.callbackData = `${scheduleCallbackPrefixes.inspect}53`;
  await handleTelegramScheduleCallback(context);
  assert.match(replies.at(-1)?.message ?? '', /<b>Places ocupades:<\/b> 0\/2/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Espectadors:<\/b>\s*\n- <a href="tg:\/\/user\?id=77">Biel<\/a> \(\+1 a mirar\)/);
});

test('switching from player to spectator resets companion count and frees seats', async () => {
  const scheduleRepository = createScheduleRepository([
    {
      id: 54,
      title: 'Wingspan',
      description: null,
      startsAt: '2026-04-05T16:00:00.000Z',
      organizerTelegramUserId: 42,
      createdByTelegramUserId: 42,
      tableId: null,
      durationMinutes: 120,
      capacity: 3,
      lifecycleStatus: 'scheduled',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      cancelledAt: null,
      cancelledByTelegramUserId: null,
      cancellationReason: null,
    },
  ]);
  const { context, replies } = createContext({ scheduleRepository, actorTelegramUserId: 77 });

  // Join as player
  context.callbackData = `${scheduleCallbackPrefixes.join}54`;
  await handleTelegramScheduleCallback(context);

  // Add 2 companions -> occupied seats = 3/3 (full)
  context.callbackData = `${scheduleCallbackPrefixes.companionDelta}54:+1`;
  await handleTelegramScheduleCallback(context);
  context.callbackData = `${scheduleCallbackPrefixes.companionDelta}54:+1`;
  await handleTelegramScheduleCallback(context);

  context.callbackData = `${scheduleCallbackPrefixes.inspect}54`;
  await handleTelegramScheduleCallback(context);
  assert.match(replies.at(-1)?.message ?? '', /<b>Places ocupades:<\/b> 3\/3/);

  // Switch to spectator
  context.callbackData = `${scheduleCallbackPrefixes.switchRole}54:spectator`;
  assert.equal(await handleTelegramScheduleCallback(context), true);

  // Occupied seats should now be 0/3 and companions 0!
  context.callbackData = `${scheduleCallbackPrefixes.inspect}54`;
  await handleTelegramScheduleCallback(context);
  assert.match(replies.at(-1)?.message ?? '', /<b>Places ocupades:<\/b> 0\/3/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Espectadors:<\/b>\s*\n- <a href="tg:\/\/user\?id=77">Biel<\/a>/);
});


async function priorityFixture(repository: ScheduleRepository, startsAt = '2026-04-05T16:00:00.000Z') {
  return repository.createEvent({ title: 'Asamblea del club', description: null, startsAt, durationMinutes: 120, organizerTelegramUserId: 99, createdByTelegramUserId: 99, tableId: null, attendanceMode: 'closed', isPublic: false, initialOccupiedSeats: 0, capacity: 10 });
}

test('admin priority flow stores optional explanation, shows details and blocks creation with session cancellation', async () => {
  const repository = createScheduleRepository();
  const event = await priorityFixture(repository);
  const { context, replies, getCurrentSession } = createContext({ scheduleRepository: repository, isAdmin: true, language: 'es' });
  context.callbackData = `schedule:priority:${event.id}:on`;
  await handleTelegramScheduleCallback(context);
  assert.equal(getCurrentSession()?.stepKey, 'explanation');
  context.messageText = 'El club celebra <asamblea> & votación';
  await handleTelegramScheduleText(context);
  context.messageText = 'Confirmar prioridad';
  await handleTelegramScheduleText(context);
  assert.equal(getCurrentSession(), null);
  assert.equal((await repository.findEventById(event.id))?.isPriority, true);
  assert.match(replies.at(-1)?.message ?? '', /&lt;asamblea&gt; &amp; votación/);
  context.messageText = 'Crear (simple)';
  await handleTelegramScheduleText(context);
  for (const text of ['Otra actividad', '05/04/2026', '18:30', 'Cerrada', '4', 'Guardar actividad']) {
    context.messageText = text;
    await handleTelegramScheduleText(context);
  }
  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /club está reservado/);
  assert.match(replies.at(-1)?.message ?? '', /&lt;asamblea&gt; &amp; votación/);
  assert.equal((await repository.listEvents({ includeCancelled: true })).length, 1);
});

test('priority activation reports existing overlaps and denies non-admin callbacks', async () => {
  const repository = createScheduleRepository();
  const event = await priorityFixture(repository);
  const conflict = await priorityFixture(repository, '2026-04-05T17:00:00.000Z');
  const { context, replies, getCurrentSession } = createContext({ scheduleRepository: repository, isAdmin: true, language: 'es' });
  context.callbackData = `schedule:priority:${event.id}:on`;
  await handleTelegramScheduleCallback(context);
  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /primero debes gestionar/);
  assert.match(replies.at(-1)?.message ?? '', new RegExp(`schedule_event_${conflict.id}`));
  assert.equal((await repository.findEventById(event.id))?.isPriority, undefined);
  const member = createContext({ scheduleRepository: repository, language: 'es' });
  member.context.callbackData = `schedule:priority:${event.id}:on`;
  await handleTelegramScheduleCallback(member.context);
  assert.match(member.replies.at(-1)?.message ?? '', /Sólo un admin/);
});

test('priority confirmation rechecks conflicts and cancelling the prompt leaves the activity unchanged', async () => {
  const repository = createScheduleRepository();
  const event = await priorityFixture(repository);
  const { context, replies, getCurrentSession } = createContext({ scheduleRepository: repository, isAdmin: true, language: 'es' });
  context.callbackData = `schedule:priority:${event.id}:on`;
  await handleTelegramScheduleCallback(context);
  context.messageText = '/cancel';
  await handleTelegramScheduleText(context);
  assert.equal(getCurrentSession(), null);
  assert.equal((await repository.findEventById(event.id))?.isPriority, undefined);
  await handleTelegramScheduleCallback(context);
  context.messageText = 'Omitir';
  await handleTelegramScheduleText(context);
  await priorityFixture(repository, '2026-04-05T17:00:00.000Z');
  context.messageText = 'Confirmar prioridad';
  await handleTelegramScheduleText(context);
  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /primero debes gestionar/);
  assert.equal((await repository.findEventById(event.id))?.isPriority, undefined);
});

async function richCalendarFixture() {
  const scheduleRepository = createScheduleRepository();
  const event = await scheduleRepository.createEvent({
    title: 'Pública & club', description: 'Descripción visible', startsAt: '2026-04-06T10:00:00.000Z',
    durationMinutes: 90, organizerTelegramUserId: 42, createdByTelegramUserId: 42,
    tableId: null, attendanceMode: 'open', isPublic: true, initialOccupiedSeats: 0, capacity: 6,
  });
  const privateEvent = await scheduleRepository.createEvent({
    ...event, title: 'Privada secreta', isPublic: false,
  });
  const newsGroupRepository = createNewsGroupRepository();
  const categories: string[] = [];
  newsGroupRepository.listSubscribedGroupsByCategory = async (category) => {
    categories.push(category);
    return [{ chatId: -200, messageThreadId: category === 'public-events' ? 88 : 77,
      isEnabled: true, metadata: null, createdAt: event.createdAt, updatedAt: event.updatedAt,
      enabledAt: event.createdAt, disabledAt: null }];
  };
  return { event, privateEvent, categories, scheduleRepository, newsGroupRepository,
    venueEventRepository: createVenueEventRepository(), tableRepository: createTableRepository(),
    snapshotStorage: createMemoryAppMetadataStorage(), database: undefined, botLanguage: 'es',
    now: new Date('2026-04-05T09:00:00.000Z') };
}

test('calendar changes send a new rich topic snapshot and retire every previous fallback chunk', async () => {
  const fixture = await richCalendarFixture();
  await fixture.snapshotStorage.set('telegram.schedule.calendar_snapshot:events:-200:77', JSON.stringify({
    chatId: -200, messageThreadId: 77, messageId: 902, messageIds: [901, 902],
  }));
  const sent: TelegramRichMessageInput[] = [];
  const deleted: number[] = [];
  await publishCalendarSnapshotToNewsGroups({ ...fixture,
    change: { action: 'updated', event: fixture.event }, resolveActorDisplayName: async () => 'Ada',
    sendRichMessage: async (input) => { sent.push(input); return { messageId: 905, messageIds: [904, 905] }; },
    editRichMessage: async () => { assert.fail('normal changes must send a new notification'); },
    deleteMessage: async ({ messageId }) => { deleted.push(messageId); },
  });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]?.options, { parseMode: 'HTML', messageThreadId: 77 });
  assert.match(sent[0]?.richMessage.html ?? '', /<table compact>/);
  assert.match(sent[0]?.fallbackText ?? '', /Privada secreta/);
  assert.match(sent[0]?.fallbackText ?? '', /schedule_create/);
  assert.match(sent[0]?.fallbackText ?? '', /Ada/);
  assert.deepEqual(deleted, [901, 902]);
  assert.deepEqual(JSON.parse((await fixture.snapshotStorage.get('telegram.schedule.calendar_snapshot:events:-200:77'))!),
    { chatId: -200, messageThreadId: 77, messageId: 905, messageIds: [904, 905] });
});

test('format refresh edits subscribed calendar topics without an invented activity change or private disclosure', async () => {
  const fixture = await richCalendarFixture();
  for (const [category, thread, id] of [['events', 77, 901], ['public-events', 88, 902]] as const) {
    await fixture.snapshotStorage.set(`telegram.schedule.calendar_snapshot:${category}:-200:${thread}`,
      JSON.stringify({ chatId: -200, messageThreadId: thread, messageId: id }));
  }
  const edits: Array<TelegramRichMessageInput & { messageId: number }> = [];
  await refreshCalendarSnapshotsToNewsGroups({ ...fixture,
    sendRichMessage: async () => { assert.fail('stored single-message snapshots should be edited'); },
    editRichMessage: async (input) => { edits.push(input); },
  });
  assert.deepEqual(fixture.categories, ['events', 'public-events']);
  assert.deepEqual(edits.map(({ messageId, options }) => [messageId, options?.messageThreadId]), [[901, 77], [902, 88]]);
  assert.match(edits[0]?.richMessage.html ?? '', /Privada secreta/);
  assert.doesNotMatch(edits[1]?.richMessage.html ?? '', /Privada secreta|schedule_create/);
  assert.doesNotMatch(edits[1]?.fallbackText ?? '', /Privada secreta|schedule_create/);
  assert.doesNotMatch(edits.map((edit) => edit.fallbackText).join(''), /ha creado|ha actualizado|ha eliminado/);
});

test('public calendar ignores private-only changes and safely removes a newly hidden activity', async () => {
  const fixture = await richCalendarFixture();
  const sent: TelegramRichMessageInput[] = [];
  const sendRichMessage = async (input: TelegramRichMessageInput) => { sent.push(input); return { messageId: 903 }; };
  await publishPublicCalendarSnapshotToNewsGroups({ ...fixture, sendRichMessage,
    change: { action: 'updated', event: fixture.privateEvent },
    resolveActorDisplayName: async () => { assert.fail('private actor must not be resolved'); },
  });
  assert.equal(sent.length, 0);
  const hidden = await fixture.scheduleRepository.updateEvent({ ...fixture.event, eventId: fixture.event.id, isPublic: false });
  await publishPublicCalendarSnapshotToNewsGroups({ ...fixture, sendRichMessage,
    change: { action: 'updated', event: hidden, previousEvent: fixture.event },
    resolveActorDisplayName: async () => { assert.fail('hidden activity footer must not expose the actor'); },
  });
  assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0]?.richMessage.html ?? '', /Pública|Privada|Ada/);
  assert.doesNotMatch(sent[0]?.fallbackText ?? '', /Pública|Privada|Ada/);
  assert.match(sent[0]?.fallbackText ?? '', /no hay actividades públicas/);
});

test('format refresh replaces missing messages but never edits or deletes a reference from another topic', async () => {
  const fixture = await richCalendarFixture();
  await fixture.snapshotStorage.set('telegram.schedule.calendar_snapshot:events:-200:77', JSON.stringify({ chatId: -200, messageThreadId: 77, messageId: 901 }));
  await fixture.snapshotStorage.set('telegram.schedule.calendar_snapshot:public-events:-200:88', JSON.stringify({ chatId: -200, messageThreadId: 999, messageId: 902 }));
  const edits: number[] = [];
  const deletes: number[] = [];
  const sent: TelegramRichMessageInput[] = [];
  await refreshCalendarSnapshotsToNewsGroups({ ...fixture,
    editRichMessage: async ({ messageId }) => { edits.push(messageId); throw new Error('Bad Request: message to edit not found'); },
    sendRichMessage: async (input) => { sent.push(input); return { messageId: 903 + sent.length }; },
    deleteMessage: async ({ messageId }) => { deletes.push(messageId); },
  });
  assert.deepEqual(edits, [901]);
  assert.equal(sent.length, 2);
  assert.deepEqual(deletes, [901]);
});

test('format refresh avoids truncated plain fallback edits and retires all chunks when consolidating old snapshots', async () => {
  const fixture = await richCalendarFixture();
  await fixture.scheduleRepository.updateEvent({ ...fixture.event, eventId: fixture.event.id, title: 'T'.repeat(5000) });
  await fixture.snapshotStorage.set('telegram.schedule.calendar_snapshot:events:-200:77', JSON.stringify({ chatId: -200, messageThreadId: 77, messageId: 901 }));
  await fixture.snapshotStorage.set('telegram.schedule.calendar_snapshot:public-events:-200:88', JSON.stringify({ chatId: -200, messageThreadId: 88, messageId: 903, messageIds: [902, 903] }));
  const sent: TelegramRichMessageInput[] = [];
  const deleted: number[] = [];
  await refreshCalendarSnapshotsToNewsGroups({ ...fixture,
    editRichMessage: async () => { assert.fail('large complete fallback must be sent, not truncated by an edit'); },
    sendRichMessage: async (input) => { sent.push(input); return { messageId: 904 + sent.length }; },
    deleteMessage: async ({ messageId }) => { deleted.push(messageId); },
  });
  assert.equal(sent.length, 2);
  assert.ok(sent.every((input) => input.fallbackText.includes('T'.repeat(5000))));
  assert.deepEqual(deleted, [901, 902, 903]);
});

test('unchanged refresh migrates legacy keys without duplicate notification; authentication errors remain visible and do not send', async () => {
  const fixture = await richCalendarFixture();
  await fixture.snapshotStorage.set('telegram.schedule.calendar_snapshot:-200:77', JSON.stringify({ chatId: -200, messageThreadId: 77, messageId: 901 }));
  await fixture.snapshotStorage.set('telegram.schedule.calendar_snapshot:public-events:-200:88', JSON.stringify({ chatId: -200, messageThreadId: 88, messageId: 902 }));
  const warnings: unknown[] = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args); };
  try {
    await refreshCalendarSnapshotsToNewsGroups({ ...fixture,
      editRichMessage: async ({ messageId }) => { throw new Error(messageId === 901 ? 'Bad Request: message is not modified' : '401 Unauthorized'); },
      sendRichMessage: async () => { assert.fail('unchanged or unauthorized edits must not duplicate messages'); },
    });
  } finally { console.warn = originalWarn; }
  assert.equal(JSON.parse((await fixture.snapshotStorage.get('telegram.schedule.calendar_snapshot:events:-200:77'))!).messageId, 901);
  assert.match(JSON.stringify(warnings), /401 Unauthorized/);
});

test('Agenda post-save side effects propagate runtime rich hooks to both calendar subscription categories', async () => {
  const fixture = await richCalendarFixture();
  const { context } = createContext({ scheduleRepository: fixture.scheduleRepository,
    venueEventRepository: fixture.venueEventRepository, tableRepository: fixture.tableRepository,
    newsGroupRepository: fixture.newsGroupRepository, language: 'es' });
  const sent: TelegramRichMessageInput[] = [];
  context.runtime.bot.sendRichMessage = async function (input) {
    assert.equal(this, context.runtime.bot);
    sent.push(input);
  };
  context.runtime.bot.sendGroupMessage = async () => { assert.fail('rich-capable runtime should publish rich snapshots'); };
  await runAfterScheduleSaveSideEffects(context, fixture.event, 'created');
  assert.deepEqual(sent.map((input) => input.options?.messageThreadId), [77, 88]);
  assert.match(sent[0]?.richMessage.html ?? '', /Privada secreta/);
  assert.doesNotMatch(sent[1]?.richMessage.html ?? '', /Privada secreta/);
});

test('Actividades and Ver actividades use the compact rich layout with equipment, impact, existing controls and no future horizon', async () => {
  for (const language of ['ca', 'es', 'en'] as const) {
    const fixture = await richCalendarFixture();
    await fixture.scheduleRepository.updateEvent({ ...fixture.event, eventId: fixture.event.id, equipmentIds: [2, 3] });
    await fixture.scheduleRepository.updateEvent({ ...fixture.privateEvent, eventId: fixture.privateEvent.id,
      title: 'Actividad lejana privada', startsAt: '2027-04-05T16:00:00.000Z' });
    const venueEventRepository = createVenueEventRepository();
    await venueEventRepository.createVenueEvent({ name: 'Curso <especial>', description: null,
      startsAt: fixture.event.startsAt, endsAt: '2026-04-06T11:30:00.000Z', occupancyScope: 'partial', impactLevel: 'high' });
    const equipmentRepository = createEquipmentRepository([2, 3].map((id) => ({ id,
      displayName: id === 2 ? 'TV móvil' : 'Proyector <4K>', description: null, lifecycleStatus: 'active' as const,
      createdAt: fixture.event.createdAt, updatedAt: fixture.event.updatedAt, deactivatedAt: null })));
    const { context, replies } = createContext({ language, scheduleRepository: fixture.scheduleRepository,
      venueEventRepository, equipmentRepository });
    context.messageThreadId = 12;
    const richMessages: TelegramRichMessageInput[] = [];
    context.runtime.bot.sendRichMessage = async (input) => { richMessages.push(input); };
    const texts = createTelegramI18n(language);
    for (const command of [texts.actionMenu.schedule, texts.schedule.list]) {
      context.messageText = command;
      assert.equal(await handleTelegramScheduleText(context), true);
    }
    assert.equal(richMessages.length, 2);
    for (const message of richMessages) {
      const html = message.richMessage.html ?? '';
      assert.equal([...html.matchAll(/<tr>/g)].length, 4);
      assert.equal([...html.matchAll(/<td\b/g)].length, 8);
      assert.match(html, /Actividad lejana privada/);
      assert.match(html, /TV móvil, Proyector &lt;4K&gt;/);
      assert.match(html, /Impacte local: Curso &lt;especial&gt; \(ocupació partial, impacte high\)/);
      assert.doesNotMatch(html, /Próximos 30 días|Pròxims 30 dies|Next 30 days/);
      assert.match(message.fallbackText, /Actividad lejana privada/);
      assert.match(message.fallbackText, /TV móvil, Proyector &lt;4K&gt;/);
      assert.equal(message.messageThreadId, 12);
    }
    assert.ok(richMessages[0]?.options?.replyKeyboard);
    assert.deepEqual(richMessages[1]?.options, { parseMode: 'HTML' });
    delete context.runtime.bot.sendRichMessage;
    context.messageText = texts.actionMenu.schedule;
    assert.equal(await handleTelegramScheduleText(context), true);
    assert.equal(replies.at(-1)?.message, richMessages[0]?.fallbackText);
    assert.deepEqual(replies.at(-1)?.options, richMessages[0]?.options);
  }
});

test('direct activity lists keep their existing group routing exclusion when a rich runtime is available', async () => {
  const fixture = await richCalendarFixture();
  const { context, replies } = createContext({ scheduleRepository: fixture.scheduleRepository });
  context.runtime.chat.kind = 'group';
  context.runtime.bot.sendRichMessage = async () => { assert.fail('private list formatting must not change group replies'); };
  context.messageText = scheduleLabels.list;
  assert.equal(await handleTelegramScheduleText(context), false);
  assert.equal(replies.length, 0);
});

function savedDraft(): Record<string, unknown> {
  return { title: '<Plan & juego>', description: '<texto>', date: '2026-04-05', time: '16:00', durationMinutes: 120,
    attendanceMode: 'closed', isPublic: false, capacity: 4, initialOccupiedSeats: 0, tableId: null, equipmentIds: [] };
}

test('creation sends an immediate saved rich receipt and edits it through concrete stages without a reply keyboard', async () => {
  const { context, replies, getCurrentSession } = createContext({ language: 'es' });
  await context.runtime.session.start({ flowKey: 'schedule-create', stepKey: 'confirm', data: savedDraft() });
  const sent: TelegramRichMessageInput[] = [];
  const edited: Array<TelegramRichMessageInput & { messageId: number }> = [];
  context.runtime.bot.sendRichMessage = async (input) => {
    assert.equal(getCurrentSession(), null);
    assert.equal((await context.scheduleRepository!.findEventById(1))?.title, '<Plan & juego>');
    sent.push(input); return { messageId: 501 };
  };
  context.runtime.bot.editRichMessage = async (input) => { edited.push(input); };
  context.messageText = createTelegramI18n('es').schedule.confirmCreate;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(sent.length, 1);
  assert.match(sent[0]!.fallbackText, /Actividad creada correctamente/);
  assert.match(sent[0]!.richMessage.html ?? '', /&lt;Plan &amp; juego&gt;/);
  assert.equal(sent[0]!.options?.replyKeyboard, undefined);
  assert.equal(edited.length, 4);
  assert.deepEqual(edited.map((input) => input.messageId), [501, 501, 501, 501]);
  assert.match(edited[0]!.fallbackText, /Google Calendar/);
  assert.match(edited[1]!.fallbackText, /solapamientos/);
  assert.match(edited[2]!.fallbackText, /grupos y canales/);
  assert.match(edited[3]!.richMessage.html ?? '', /&lt;texto&gt;/);
  assert.ok(edited[3]!.options?.inlineKeyboard?.length);
  assert.ok(edited.every((input) => input.options?.replyKeyboard === undefined));
  assert.ok(replies.some((reply) => reply.options?.replyKeyboard));
});

test('creation rich editing failures fall back to a final rich receipt and retain the saved activity', async () => {
  const { context, getCurrentSession } = createContext({ language: 'es' });
  await context.runtime.session.start({ flowKey: 'schedule-create', stepKey: 'confirm', data: savedDraft() });
  const sent: TelegramRichMessageInput[] = [];
  context.runtime.bot.sendRichMessage = async (input) => { sent.push(input); return { messageId: 501 + sent.length }; };
  context.runtime.bot.editRichMessage = async () => { throw new Error('message cannot be edited'); };
  context.messageText = createTelegramI18n('es').schedule.confirmCreate;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession(), null);
  assert.equal(sent.length, 2);
  assert.match(sent[1]!.fallbackText, /&lt;Plan &amp; juego&gt;/);
  assert.ok(sent[1]!.options?.inlineKeyboard?.length);
  assert.equal((await context.scheduleRepository!.listEvents({ includeCancelled: false })).length, 1);
});

test('creation still delivers an HTML receipt when rich sending is unavailable or rejected', async () => {
  const { context, replies, getCurrentSession } = createContext({ language: 'en' });
  await context.runtime.session.start({ flowKey: 'schedule-create', stepKey: 'confirm', data: savedDraft() });
  context.runtime.bot.sendRichMessage = async () => { throw new Error('unknown method'); };
  context.messageText = createTelegramI18n('en').schedule.confirmCreate;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /Activity created successfully/);
  assert.match(replies.at(-1)?.message ?? '', /&lt;Plan &amp; juego&gt;/);
  assert.equal(replies.at(-1)?.options?.parseMode, 'HTML');
  assert.ok(replies.at(-1)?.options?.inlineKeyboard?.length);
});

test('an audit failure after creation cannot leave the draft available for duplicate saving', async () => {
  const auditRepository = createAuditRepository();
  auditRepository.appendEvent = async () => { throw new Error('audit unavailable'); };
  const { context, replies, getCurrentSession } = createContext({ auditRepository, language: 'es' });
  await context.runtime.session.start({ flowKey: 'schedule-create', stepKey: 'confirm', data: savedDraft() });
  context.messageText = createTelegramI18n('es').schedule.confirmCreate;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /Actividad creada correctamente/);
  assert.equal((await context.scheduleRepository!.listEvents({ includeCancelled: false })).length, 1);
  await handleTelegramScheduleText(context);
  assert.equal((await context.scheduleRepository!.listEvents({ includeCancelled: false })).length, 1);
});

test('a session retirement failure records the saved ID and retrying confirm does not create another activity', async () => {
  const { context, replies, getCurrentSession } = createContext({ language: 'es' });
  await context.runtime.session.start({ flowKey: 'schedule-create', stepKey: 'confirm', data: savedDraft() });
  context.runtime.session.cancel = async () => { throw new Error('session retirement unavailable'); };
  context.messageText = createTelegramI18n('es').schedule.confirmCreate;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.data.savedEventId, 1);
  assert.match(replies.at(-1)?.message ?? '', /Actividad creada correctamente/);
  context.messageText = createTelegramI18n('es').schedule.editFieldTable;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'confirm');
  context.messageText = createTelegramI18n('es').schedule.confirmCreate;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal((await context.scheduleRepository!.listEvents({ includeCancelled: false })).length, 1);
});

test('creation presents every active table as busy or free and recomputes availability before selecting', async () => {
  const tableRepository = createTableRepository([7, 8].map((id) => ({ id, displayName: id === 7 ? 'Mesa <TV>' : 'Mesa libre',
    description: null, recommendedCapacity: 4, lifecycleStatus: 'active' as const, createdAt: '2026-04-04T10:00:00.000Z',
    updatedAt: '2026-04-04T10:00:00.000Z', deactivatedAt: null })));
  const { context, replies } = createContext({ tableRepository, language: 'es' });
  const draft = savedDraft();
  await replyCreateTablePrompt(context, draft);
  assert.match(replies.at(-1)?.message ?? '', /🟢 Mesa &lt;TV&gt;: Libre/);
  await context.scheduleRepository!.createEvent({ title: 'Reserva reciente', description: null,
    startsAt: '2026-04-05T14:00:00.000Z', durationMinutes: 120, organizerTelegramUserId: 42, createdByTelegramUserId: 42,
    tableId: 7, equipmentIds: [], attendanceMode: 'closed', isPublic: false, capacity: 4, initialOccupiedSeats: 0 });
  await replyCreateTablePrompt(context, draft);
  assert.match(replies.at(-1)?.message ?? '', /🟠 Mesa &lt;TV&gt;: Ocupado/);
  assert.match(replies.at(-1)?.message ?? '', /🟢 Mesa libre: Libre/);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard?.[0], ['Mesa <TV>', 'Mesa libre']);
  assert.ok(replies.at(-1)?.options?.replyKeyboard?.some((row) => row.includes('Atrás')));
});

test('creation selected-day preview reuses the approved two-column rich calendar with escaped content and full fallback', async () => {
  const { context } = createContext({ language: 'es' });
  await context.scheduleRepository!.createEvent({ title: 'Actividad <anterior>', description: 'Texto & detalle',
    startsAt: '2026-04-05T14:00:00.000Z', durationMinutes: 120, organizerTelegramUserId: 42, createdByTelegramUserId: 42,
    tableId: null, equipmentIds: [], attendanceMode: 'closed', isPublic: false, capacity: 4, initialOccupiedSeats: 0 });
  const sent: TelegramRichMessageInput[] = [];
  context.runtime.bot.sendRichMessage = async (input) => { sent.push(input); return { messageId: sent.length }; };
  for (const text of ['Crear actividad', 'Nueva', '05/04/2026']) {
    context.messageText = text; await handleTelegramScheduleText(context);
  }
  assert.match(sent.at(-1)?.richMessage.html ?? '', /<table compact>/);
  assert.match(sent.at(-1)?.richMessage.html ?? '', /Actividad &lt;anterior&gt;/);
  assert.match(sent.at(-1)?.richMessage.html ?? '', /4 plazas 🔒/);
  assert.match(sent.at(-1)?.fallbackText ?? '', /Actividad &lt;anterior&gt;/);
  assert.ok(sent.at(-1)?.options?.replyKeyboard?.length);
});

test('simple creation can add attachment details from its summary and retains them through save', async () => {
  const { context, getCurrentSession } = createContext({ language: 'es' });
  await context.runtime.session.start({ flowKey: 'schedule-create-simple', stepKey: 'confirm', data: savedDraft() });
  context.messageText = createTelegramI18n('es').schedule.editFieldDescription;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'description');
  context.messageText = undefined;
  context.messageId = 778;
  context.messageMedia = { caption: 'Traed <dados> & figuras', messageId: 778 };
  assert.equal(await handleTelegramScheduleMessage(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'confirm');
  assert.equal(getCurrentSession()?.data.detailsMessageChatId, 1);
  assert.equal(getCurrentSession()?.data.detailsMessageId, 778);
  context.messageMedia = null;
  context.messageText = createTelegramI18n('es').schedule.confirmCreate;
  assert.equal(await handleTelegramScheduleText(context), true);
  const saved = await context.scheduleRepository!.findEventById(1);
  assert.equal(saved?.description, 'Traed <dados> & figuras');
  assert.equal(saved?.detailsMessageChatId, 1);
  assert.equal(saved?.detailsMessageId, 778);
});

test('ordinary text edits can update a saved receipt when rich transport is absent', async () => {
  const { context, replies } = createContext({ language: 'es' });
  await context.runtime.session.start({ flowKey: 'schedule-create', stepKey: 'confirm', data: savedDraft() });
  const edits: Array<{ messageId: number; text: string; options?: TelegramReplyOptions }> = [];
  const reply = context.reply;
  context.reply = async (text, options) => { await reply(text, options); return { messageId: 701 }; };
  context.runtime.bot.editMessageText = async (input) => { edits.push(input); };
  context.messageText = createTelegramI18n('es').schedule.confirmCreate;
  assert.equal(await handleTelegramScheduleText(context), true);
  assert.equal(edits.length, 4);
  assert.ok(edits.every((input) => input.messageId === 701 && !input.options?.replyKeyboard));
  assert.match(edits.at(-1)?.text ?? '', /Actividad creada correctamente/);
  assert.ok(edits.at(-1)?.options?.inlineKeyboard?.length);
  assert.ok(replies.some((reply) => reply.options?.replyKeyboard));
});
