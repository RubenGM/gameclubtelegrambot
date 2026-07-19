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

export interface RoleGameRecurringSessionPlan {
  startsAtToCreate: string[];
  activeFutureSessions: number;
  skipped: number;
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
  const cursor = rule.startsOn
    ? buildRecurrenceStartDate(rule.startsOn, hour, minute)
    : new Date(now);
  if (!rule.startsOn) {
    cursor.setHours(hour, minute, 0, 0);
    const daysUntilWeekday = (rule.weekday - cursor.getDay() + 7) % 7;
    cursor.setDate(cursor.getDate() + daysUntilWeekday);
  }
  while (cursor.getTime() <= now.getTime()) {
    cursor.setDate(cursor.getDate() + 7 * rule.intervalWeeks);
  }

  while (occurrences.length < count) {
    occurrences.push(cursor.toISOString());
    cursor.setDate(cursor.getDate() + 7 * rule.intervalWeeks);
  }
  return occurrences;
}

function buildRecurrenceStartDate(startsOn: string, hour: number, minute: number): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startsOn);
  if (!match) {
    throw new Error(`Invalid recurrence start date: ${startsOn}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error(`Invalid recurrence start date: ${startsOn}`);
  }
  return date;
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
  const plan = await planRecurringRoleGameSessions({
    roleGameRepository,
    scheduleRepository,
    game,
    now,
  });
  let created = 0;
  for (const startsAt of plan.startsAtToCreate) {
    await createRoleGameScheduleSession({
      roleGameRepository,
      scheduleRepository,
      game,
      startsAt,
      actorTelegramUserId,
      source: 'recurring',
    });
    created += 1;
  }

  return { created, skipped: plan.skipped };
}

export async function planRecurringRoleGameSessions({
  roleGameRepository,
  scheduleRepository,
  game,
  now = new Date(),
}: {
  roleGameRepository: RoleGameRepository;
  scheduleRepository: ScheduleRepository;
  game: RoleGameRecord;
  now?: Date;
}): Promise<RoleGameRecurringSessionPlan> {
  if (game.schedulingMode !== 'recurring' || !game.recurrenceRule || game.recurrenceWindowCount <= 0 || game.status !== 'active') {
    return { startsAtToCreate: [], activeFutureSessions: 0, skipped: 0 };
  }

  const linkedSessions = await roleGameRepository.listSessionLinks(game.id);
  const linkedByOccurrence = await buildLinkedSessionOccurrences({ linkedSessions, scheduleRepository });
  const startsAtToCreate: string[] = [];
  let activeFutureSessions = 0;
  let skipped = 0;
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
      startsAtToCreate.push(occurrence);
      activeFutureSessions += 1;
    }
    occurrenceIndex += 1;
  }

  return { startsAtToCreate, activeFutureSessions, skipped };
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
