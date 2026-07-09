import {
  createScheduleEvent,
  type ScheduleEventRecord,
  type ScheduleRepository,
} from '../schedule/schedule-catalog.js';
import type {
  RoleGameRecord,
  RoleGameRepository,
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
    const confirmedPlayers = members.filter((member) => member.role === 'player' && member.status === 'confirmed');
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
