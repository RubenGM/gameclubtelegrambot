import assert from 'node:assert/strict';
import test from 'node:test';

import type { ScheduleEventRecord, ScheduleRepository } from '../schedule/schedule-catalog.js';
import type {
  RoleGameRecord,
  RoleGameRecurrenceRule,
  RoleGameRepository,
  RoleGameSessionRecord,
} from './role-game-catalog.js';
import type { RoleGameAutoSchedulingSettings, RoleGameAutoSchedulingStore } from './role-game-auto-scheduling-store.js';
import { createRoleGameRecurrenceWorker } from './role-game-recurrence-worker.js';

test('role-game recurrence worker reads the enabled flag and future-week horizon on every tick', async () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const startsOn = [
    tomorrow.getFullYear(),
    String(tomorrow.getMonth() + 1).padStart(2, '0'),
    String(tomorrow.getDate()).padStart(2, '0'),
  ].join('-');
  const game = sampleRecurringGame({
    recurrenceRule: {
      intervalWeeks: 1,
      weekday: tomorrow.getDay() as RoleGameRecurrenceRule['weekday'],
      startsOn,
      time: '12:00',
    },
    recurrenceWindowCount: 6,
  });
  const sessionLinks: RoleGameSessionRecord[] = [];
  const events: ScheduleEventRecord[] = [];
  const roleGameRepository = {
    listRecurringGames: async () => [game],
    listSessionLinks: async () => sessionLinks,
    createSessionLink: async (input: Parameters<RoleGameRepository['createSessionLink']>[0]) => {
      const link: RoleGameSessionRecord = {
        id: sessionLinks.length + 1,
        ...input,
        createdAt: new Date().toISOString(),
      };
      sessionLinks.push(link);
      return link;
    },
    listMembers: async () => [],
  } as unknown as RoleGameRepository;
  const scheduleRepository = {
    createEvent: async (input: Parameters<ScheduleRepository['createEvent']>[0]) => {
      const now = new Date().toISOString();
      const event: ScheduleEventRecord = {
        id: events.length + 1,
        ...input,
        detailsMessageChatId: input.detailsMessageChatId ?? null,
        detailsMessageId: input.detailsMessageId ?? null,
        catalogItemId: input.catalogItemId ?? null,
        lifecycleStatus: 'scheduled',
        createdAt: now,
        updatedAt: now,
        cancelledAt: null,
        cancelledByTelegramUserId: null,
        cancellationReason: null,
      };
      events.push(event);
      return event;
    },
    findEventById: async (eventId: number) => events.find((event) => event.id === eventId) ?? null,
    upsertParticipant: async () => { throw new Error('not expected'); },
  } as unknown as ScheduleRepository;
  let settings: RoleGameAutoSchedulingSettings = { enabled: true, maxFutureWeeks: 1 };
  let settingsReadCount = 0;
  const autoSchedulingStore: RoleGameAutoSchedulingStore = {
    getSettings: async () => {
      settingsReadCount += 1;
      return settings;
    },
    isEnabled: async () => settings.enabled,
    setEnabled: async (enabled) => { settings = { ...settings, enabled }; },
    setMaxFutureWeeks: async (maxFutureWeeks) => { settings = { ...settings, maxFutureWeeks }; },
  };
  let intervalHandler: (() => void) | null = null;
  const worker = createRoleGameRecurrenceWorker({
    enabled: true,
    intervalMs: 60_000,
    roleGameRepository,
    scheduleRepository,
    actorTelegramUserId: 42,
    logger: { error: () => undefined },
    autoSchedulingStore,
    setIntervalFn: (handler) => {
      intervalHandler = handler;
      return {} as ReturnType<typeof setInterval>;
    },
    clearIntervalFn: () => undefined,
  });

  await worker.start();
  assert.equal(events.length, 1);
  assert.equal(settingsReadCount, 1);

  settings = { enabled: true, maxFutureWeeks: 3 };
  runIntervalHandler(intervalHandler);
  await waitUntil(() => events.length === 3);
  assert.equal(events.length, 3);
  assert.equal(settingsReadCount, 2);

  settings = { enabled: false, maxFutureWeeks: 52 };
  runIntervalHandler(intervalHandler);
  await waitUntil(() => settingsReadCount === 3);
  assert.equal(events.length, 3);
  await worker.stop();
});

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for recurrence worker');
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function runIntervalHandler(handler: (() => void) | null): void {
  if (!handler) {
    throw new Error('Recurrence worker did not register an interval');
  }
  handler();
}

function sampleRecurringGame(overrides: Partial<RoleGameRecord> = {}): RoleGameRecord {
  return {
    id: 1,
    type: 'campaign',
    status: 'active',
    title: 'Partida recurrente',
    system: 'Pathfinder',
    description: null,
    visibility: 'members',
    publicJoinPolicy: 'members_only',
    entryMode: 'request',
    acceptanceMode: 'manual_review',
    capacity: 5,
    primaryGmTelegramUserId: 42,
    defaultDurationMinutes: 180,
    defaultTableId: null,
    defaultAttendanceMode: 'closed',
    defaultIsPublicScheduleEvent: false,
    autoAddConfirmedPlayers: false,
    allowPlayerManualScheduling: false,
    schedulingMode: 'recurring',
    recurrenceRule: { intervalWeeks: 1, weekday: 1, time: '12:00' },
    recurrenceWindowCount: 6,
    createdByTelegramUserId: 42,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    closedAt: null,
    ...overrides,
  };
}
