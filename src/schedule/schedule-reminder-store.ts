import { and, eq } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { scheduleEventReminders } from '../infrastructure/database/schema.js';
import type { ScheduleEventReminderRepository } from './schedule-reminders.js';

export function createDatabaseScheduleEventReminderRepository({
  database,
}: {
  database: DatabaseConnection['db'];
}): ScheduleEventReminderRepository {
  return {
    async hasReminderBeenSent({ scheduleEventId, participantTelegramUserId, leadHours }) {
      const result = await database
        .select({ id: scheduleEventReminders.id })
        .from(scheduleEventReminders)
        .where(
          and(
            eq(scheduleEventReminders.scheduleEventId, scheduleEventId),
            eq(scheduleEventReminders.participantTelegramUserId, participantTelegramUserId),
            eq(scheduleEventReminders.leadHours, leadHours),
          ),
        )
        .limit(1);

      return result.length > 0;
    },
    async recordReminderSent({ scheduleEventId, participantTelegramUserId, leadHours, sentAt }) {
      await database.insert(scheduleEventReminders).values({
        scheduleEventId,
        participantTelegramUserId,
        leadHours,
        sentAt: new Date(sentAt),
      });
    },
  };
}
