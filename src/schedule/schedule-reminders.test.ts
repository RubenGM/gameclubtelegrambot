import test from 'node:test';
import assert from 'node:assert/strict';

import type { ScheduleEventRecord, ScheduleParticipantRecord, ScheduleRepository } from './schedule-catalog.js';
import { sendDueScheduleEventReminders, type ScheduleEventReminderRepository } from './schedule-reminders.js';

test('sendDueScheduleEventReminders sends reminders to active participants inside the lead window', async () => {
  const sent: Array<{ telegramUserId: number; message: string }> = [];
  const reminderRepository = createReminderRepository();
  const scheduleRepository = createScheduleRepository({
    events: [
      createEvent({ id: 1, title: 'Wingspan', startsAt: '2026-04-28T15:00:00.000Z' }),
      createEvent({ id: 2, title: 'Too late', startsAt: '2026-04-29T15:00:00.000Z' }),
    ],
    participants: [
      createParticipant({ scheduleEventId: 1, participantTelegramUserId: 77, status: 'active' }),
      createParticipant({ scheduleEventId: 1, participantTelegramUserId: 88, status: 'removed' }),
      createParticipant({ scheduleEventId: 2, participantTelegramUserId: 99, status: 'active' }),
    ],
  });

  const result = await sendDueScheduleEventReminders({
    scheduleRepository,
    reminderRepository,
    now: new Date('2026-04-27T15:00:00.000Z'),
    leadHours: 24,
    language: 'ca',
    sendPrivateMessage: async (telegramUserId, message) => {
      sent.push({ telegramUserId, message });
    },
  });

  assert.deepEqual(sent, [{ telegramUserId: 77, message: 'Recordatori: Wingspan comença el 28/04 a les 17:00.' }]);
  assert.deepEqual(reminderRepository.records, [{ scheduleEventId: 1, participantTelegramUserId: 77, leadHours: 24 }]);
  assert.deepEqual(result, { consideredEvents: 1, sentReminders: 1, skippedReminders: 0, failedReminders: 0 });
});

test('sendDueScheduleEventReminders skips reminders already recorded', async () => {
  const sent: Array<{ telegramUserId: number; message: string }> = [];
  const reminderRepository = createReminderRepository([
    { scheduleEventId: 1, participantTelegramUserId: 77, leadHours: 24 },
  ]);

  const result = await sendDueScheduleEventReminders({
    scheduleRepository: createScheduleRepository({
      events: [createEvent({ id: 1, title: 'Wingspan', startsAt: '2026-04-28T15:00:00.000Z' })],
      participants: [createParticipant({ scheduleEventId: 1, participantTelegramUserId: 77, status: 'active' })],
    }),
    reminderRepository,
    now: new Date('2026-04-27T15:00:00.000Z'),
    leadHours: 24,
    language: 'ca',
    sendPrivateMessage: async (telegramUserId, message) => {
      sent.push({ telegramUserId, message });
    },
  });

  assert.deepEqual(sent, []);
  assert.deepEqual(reminderRepository.records, [{ scheduleEventId: 1, participantTelegramUserId: 77, leadHours: 24 }]);
  assert.deepEqual(result, { consideredEvents: 1, sentReminders: 0, skippedReminders: 1, failedReminders: 0 });
});

test('sendDueScheduleEventReminders does not record failed sends', async () => {
  const reminderRepository = createReminderRepository();

  const result = await sendDueScheduleEventReminders({
    scheduleRepository: createScheduleRepository({
      events: [createEvent({ id: 1, title: 'Wingspan', startsAt: '2026-04-28T15:00:00.000Z' })],
      participants: [createParticipant({ scheduleEventId: 1, participantTelegramUserId: 77, status: 'active' })],
    }),
    reminderRepository,
    now: new Date('2026-04-27T15:00:00.000Z'),
    leadHours: 24,
    language: 'ca',
    sendPrivateMessage: async () => {
      throw new Error('Telegram unavailable');
    },
  });

  assert.deepEqual(reminderRepository.records, []);
  assert.deepEqual(result, { consideredEvents: 1, sentReminders: 0, skippedReminders: 0, failedReminders: 1 });
});

test('sendDueScheduleEventReminders uses participant reminder preferences when configured', async () => {
  const sent: Array<{ telegramUserId: number; message: string }> = [];
  const reminderRepository = createReminderRepository();

  const result = await sendDueScheduleEventReminders({
    scheduleRepository: createScheduleRepository({
      events: [
        createEvent({ id: 1, title: 'Now 2h', startsAt: '2026-04-27T17:00:00.000Z' }),
        createEvent({ id: 2, title: 'Too early 2h', startsAt: '2026-04-27T18:00:00.000Z' }),
      ],
      participants: [
        createParticipant({ scheduleEventId: 1, participantTelegramUserId: 77, status: 'active', reminderLeadHours: 2 }),
        createParticipant({ scheduleEventId: 1, participantTelegramUserId: 88, status: 'active', reminderLeadHours: null }),
        createParticipant({ scheduleEventId: 1, participantTelegramUserId: 99, status: 'active' }),
        createParticipant({ scheduleEventId: 2, participantTelegramUserId: 111, status: 'active', reminderLeadHours: 2 }),
      ],
    }),
    reminderRepository,
    now: new Date('2026-04-27T15:00:00.000Z'),
    leadHours: 24,
    maxLeadHours: 24,
    language: 'ca',
    sendPrivateMessage: async (telegramUserId, message) => {
      sent.push({ telegramUserId, message });
    },
  });

  assert.deepEqual(sent, [
    { telegramUserId: 77, message: 'Recordatori: Now 2h comença el 27/04 a les 19:00.' },
    { telegramUserId: 99, message: 'Recordatori: Now 2h comença el 27/04 a les 19:00.' },
  ]);
  assert.deepEqual(reminderRepository.records, [
    { scheduleEventId: 1, participantTelegramUserId: 77, leadHours: 2 },
    { scheduleEventId: 1, participantTelegramUserId: 99, leadHours: 24 },
  ]);
  assert.deepEqual(result, { consideredEvents: 2, sentReminders: 2, skippedReminders: 2, failedReminders: 0 });
});

function createReminderRepository(
  initialRecords: Array<{ scheduleEventId: number; participantTelegramUserId: number; leadHours: number }> = [],
): ScheduleEventReminderRepository & { records: Array<{ scheduleEventId: number; participantTelegramUserId: number; leadHours: number }> } {
  const records = initialRecords.slice();
  return {
    records,
    async hasReminderBeenSent(input) {
      return records.some((record) =>
        record.scheduleEventId === input.scheduleEventId &&
        record.participantTelegramUserId === input.participantTelegramUserId &&
        record.leadHours === input.leadHours,
      );
    },
    async recordReminderSent(input) {
      records.push({
        scheduleEventId: input.scheduleEventId,
        participantTelegramUserId: input.participantTelegramUserId,
        leadHours: input.leadHours,
      });
    },
  };
}

function createScheduleRepository({
  events,
  participants,
}: {
  events: ScheduleEventRecord[];
  participants: ScheduleParticipantRecord[];
}): ScheduleRepository {
  return {
    createEvent: async () => undefined as never,
    findEventById: async (eventId) => events.find((event) => event.id === eventId) ?? null,
    async listEvents({ includeCancelled, startsAtFrom, startsAtTo }) {
      return events
        .filter((event) => (includeCancelled ? true : event.lifecycleStatus === 'scheduled'))
        .filter((event) => (startsAtFrom ? event.startsAt >= startsAtFrom : true))
        .filter((event) => (startsAtTo ? event.startsAt <= startsAtTo : true))
        .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
    },
    updateEvent: async () => undefined as never,
    cancelEvent: async () => undefined as never,
    findParticipant: async () => null,
    async listParticipants(eventId) {
      return participants.filter((participant) => participant.scheduleEventId === eventId);
    },
    upsertParticipant: async () => undefined as never,
  };
}

function createEvent(input: { id: number; title: string; startsAt: string }): ScheduleEventRecord {
  return {
    id: input.id,
    title: input.title,
    description: null,
    startsAt: input.startsAt,
    durationMinutes: 180,
    organizerTelegramUserId: 42,
    createdByTelegramUserId: 42,
    tableId: null,
    attendanceMode: 'open',
    initialOccupiedSeats: 0,
    capacity: 4,
    lifecycleStatus: 'scheduled',
    createdAt: '2026-04-20T10:00:00.000Z',
    updatedAt: '2026-04-20T10:00:00.000Z',
    cancelledAt: null,
    cancelledByTelegramUserId: null,
    cancellationReason: null,
  };
}

function createParticipant(input: {
  scheduleEventId: number;
  participantTelegramUserId: number;
  status: 'active' | 'removed';
  reminderLeadHours?: number | null;
}): ScheduleParticipantRecord {
  return {
    scheduleEventId: input.scheduleEventId,
    participantTelegramUserId: input.participantTelegramUserId,
    status: input.status,
    addedByTelegramUserId: 42,
    removedByTelegramUserId: input.status === 'removed' ? 42 : null,
    joinedAt: '2026-04-20T10:00:00.000Z',
    updatedAt: '2026-04-20T10:00:00.000Z',
    leftAt: input.status === 'removed' ? '2026-04-21T10:00:00.000Z' : null,
    ...('reminderLeadHours' in input ? { reminderLeadHours: input.reminderLeadHours } : {}),
  };
}
