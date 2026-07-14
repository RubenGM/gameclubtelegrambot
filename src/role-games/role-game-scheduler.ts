import {
  createScheduleEvent,
  type ScheduleEventRecord,
  type ScheduleRepository,
} from '../schedule/schedule-catalog.js';
import type {
  RoleGameRecord,
  RoleGameRepository,
  RoleGameRecurrenceRule,
  RoleGameSessionRecord,
  RoleGameSessionSource,
} from './role-game-catalog.js';

export interface RoleGameScheduleSessionResult {
  event: ScheduleEventRecord;
  link: RoleGameSessionRecord;
}

export async function createRoleGameScheduleSession({
  roleGameRepository,
  scheduleRepository,
  game,
  startsAt,
  actorTelegramUserId,
  source,
  tableId,
}: {
  roleGameRepository: RoleGameRepository;
  scheduleRepository: ScheduleRepository;
  game: RoleGameRecord;
  startsAt: string;
  actorTelegramUserId: number;
  source: RoleGameSessionSource;
  tableId?: number | null;
}): Promise<RoleGameScheduleSessionResult> {
  const event = await createScheduleEvent({
    repository: scheduleRepository,
    title: game.title,
    description: game.description,
    startsAt,
    durationMinutes: game.defaultDurationMinutes,
    organizerTelegramUserId: game.primaryGmTelegramUserId,
    createdByTelegramUserId: actorTelegramUserId,
    tableId: tableId ?? game.defaultTableId,
    attendanceMode: game.defaultAttendanceMode,
    isPublic: game.defaultIsPublicScheduleEvent,
    initialOccupiedSeats: 0,
    capacity: game.capacity,
  });

  const link = await roleGameRepository.createSessionLink({
    roleGameId: game.id,
    scheduleEventId: event.id,
    source,
    generatedForStartsAt: source === 'recurring' ? startsAt : null,
    createdByTelegramUserId: actorTelegramUserId,
  });

  if (game.autoAddConfirmedPlayers) {
    const members = await roleGameRepository.listMembers(game.id);
    const availableSeats = Math.max(0, event.capacity - event.initialOccupiedSeats);
    const confirmedPlayers = members
      .filter((member) => member.role === 'player' && member.status === 'confirmed')
      .slice(0, availableSeats);
    await Promise.all(
      confirmedPlayers.map((member) =>
        scheduleRepository.upsertParticipant({
          eventId: event.id,
          participantTelegramUserId: member.telegramUserId,
          actorTelegramUserId,
          status: 'active',
        }),
      ),
    );
  }

  return { event, link };
}

export async function createManualRoleGameSession(input: Omit<Parameters<typeof createRoleGameScheduleSession>[0], 'source'>): Promise<RoleGameScheduleSessionResult> {
  return createRoleGameScheduleSession({
    ...input,
    source: 'manual',
  });
}

export function computeUpcomingRoleGameOccurrences({
  rule,
  now,
  count,
}: {
  rule: RoleGameRecurrenceRule;
  now: Date;
  count: number;
}): string[] {
  if (count <= 0) {
    return [];
  }
  const [hour, minute] = parseRecurrenceTime(rule.time);
  const occurrences: string[] = [];
  const cursor = new Date(now);
  cursor.setHours(hour, minute, 0, 0);
  const daysUntilWeekday = (rule.weekday - cursor.getDay() + 7) % 7;
  cursor.setDate(cursor.getDate() + daysUntilWeekday);
  if (cursor.getTime() <= now.getTime()) {
    cursor.setDate(cursor.getDate() + 7 * rule.intervalWeeks);
  }

  while (occurrences.length < count) {
    occurrences.push(cursor.toISOString());
    cursor.setDate(cursor.getDate() + 7 * rule.intervalWeeks);
  }
  return occurrences;
}

export async function ensureRecurringRoleGameSessions({
  roleGameRepository,
  scheduleRepository,
  game,
  actorTelegramUserId,
  now = new Date(),
}: {
  roleGameRepository: RoleGameRepository;
  scheduleRepository: ScheduleRepository;
  game: RoleGameRecord;
  actorTelegramUserId: number;
  now?: Date;
}): Promise<{ created: number; skipped: number }> {
  if (game.schedulingMode !== 'recurring' || !game.recurrenceRule || game.recurrenceWindowCount <= 0 || game.status !== 'active') {
    return { created: 0, skipped: 0 };
  }

  const linkedSessions = await roleGameRepository.listSessionLinks(game.id);
  const linkedByOccurrence = await buildLinkedSessionOccurrences({ linkedSessions, scheduleRepository });

  let created = 0;
  let skipped = 0;
  let activeFutureSessions = 0;
  let occurrenceIndex = 0;

  while (activeFutureSessions < game.recurrenceWindowCount) {
    const occurrences = computeUpcomingRoleGameOccurrences({
      rule: game.recurrenceRule,
      now,
      count: occurrenceIndex + 1,
    });
    const occurrence = occurrences[occurrenceIndex];
    if (!occurrence) {
      break;
    }
    const existingLink = linkedByOccurrence.get(occurrence);
    if (existingLink) {
      const event = await scheduleRepository.findEventById(existingLink.scheduleEventId);
      if (event?.lifecycleStatus === 'cancelled') {
        skipped += 1;
      } else if (event && event.startsAt > now.toISOString()) {
        activeFutureSessions += 1;
      }
    } else {
      const session = await createRoleGameScheduleSession({
        roleGameRepository,
        scheduleRepository,
        game,
        startsAt: occurrence,
        actorTelegramUserId,
        source: 'recurring',
      });
      linkedByOccurrence.set(occurrence, session.link);
      activeFutureSessions += 1;
      created += 1;
    }
    occurrenceIndex += 1;
  }

  return { created, skipped };
}

async function buildLinkedSessionOccurrences({
  linkedSessions,
  scheduleRepository,
}: {
  linkedSessions: RoleGameSessionRecord[];
  scheduleRepository: ScheduleRepository;
}): Promise<Map<string, RoleGameSessionRecord>> {
  const linkedByOccurrence = new Map<string, RoleGameSessionRecord>();
  for (const link of linkedSessions) {
    if (link.source === 'recurring' && link.generatedForStartsAt) {
      linkedByOccurrence.set(link.generatedForStartsAt, link);
      continue;
    }
    const event = await scheduleRepository.findEventById(link.scheduleEventId);
    if (event && event.lifecycleStatus !== 'cancelled') {
      linkedByOccurrence.set(event.startsAt, link);
    }
  }
  return linkedByOccurrence;
}

function parseRecurrenceTime(time: string): [number, number] {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) {
    throw new Error(`Invalid recurrence time: ${time}`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid recurrence time: ${time}`);
  }
  return [hour, minute];
}
