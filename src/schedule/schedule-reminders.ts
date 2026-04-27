import { listScheduleEvents, type ScheduleRepository } from './schedule-catalog.js';

export interface ScheduleEventReminderRepository {
  hasReminderBeenSent(input: {
    scheduleEventId: number;
    participantTelegramUserId: number;
    leadHours: number;
  }): Promise<boolean>;
  recordReminderSent(input: {
    scheduleEventId: number;
    participantTelegramUserId: number;
    leadHours: number;
    sentAt: string;
  }): Promise<void>;
}

export interface ScheduleReminderRunResult {
  consideredEvents: number;
  sentReminders: number;
  skippedReminders: number;
  failedReminders: number;
}

export async function sendDueScheduleEventReminders({
  scheduleRepository,
  reminderRepository,
  now = new Date(),
  leadHours,
  language,
  sendPrivateMessage,
}: {
  scheduleRepository: ScheduleRepository;
  reminderRepository: ScheduleEventReminderRepository;
  now?: Date;
  leadHours: number;
  language: string;
  sendPrivateMessage: (telegramUserId: number, message: string) => Promise<void>;
}): Promise<ScheduleReminderRunResult> {
  const startsAtFrom = now.toISOString();
  const startsAtTo = new Date(now.getTime() + leadHours * 60 * 60 * 1000).toISOString();
  const events = await listScheduleEvents({
    repository: scheduleRepository,
    includeCancelled: false,
    startsAtFrom,
    startsAtTo,
  });
  const result: ScheduleReminderRunResult = {
    consideredEvents: events.length,
    sentReminders: 0,
    skippedReminders: 0,
    failedReminders: 0,
  };

  for (const event of events) {
    const participants = (await scheduleRepository.listParticipants(event.id))
      .filter((participant) => participant.status === 'active');

    for (const participant of participants) {
      const alreadySent = await reminderRepository.hasReminderBeenSent({
        scheduleEventId: event.id,
        participantTelegramUserId: participant.participantTelegramUserId,
        leadHours,
      });
      if (alreadySent) {
        result.skippedReminders += 1;
        continue;
      }

      try {
        await sendPrivateMessage(
          participant.participantTelegramUserId,
          formatScheduleReminderMessage({ title: event.title, startsAt: event.startsAt, language }),
        );
        await reminderRepository.recordReminderSent({
          scheduleEventId: event.id,
          participantTelegramUserId: participant.participantTelegramUserId,
          leadHours,
          sentAt: now.toISOString(),
        });
        result.sentReminders += 1;
      } catch {
        result.failedReminders += 1;
      }
    }
  }

  return result;
}

function formatScheduleReminderMessage({
  title,
  startsAt,
  language,
}: {
  title: string;
  startsAt: string;
  language: string;
}): string {
  const date = new Date(startsAt);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');

  if (language === 'es') {
    return `Recordatorio: ${title} empieza el ${day}/${month} a las ${hours}:${minutes}.`;
  }
  if (language === 'en') {
    return `Reminder: ${title} starts on ${day}/${month} at ${hours}:${minutes}.`;
  }

  return `Recordatori: ${title} comença el ${day}/${month} a les ${hours}:${minutes}.`;
}
