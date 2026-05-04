import { and, eq } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { groupPurchaseReminders } from '../infrastructure/database/schema.js';
import type { GroupPurchaseReminderRepository } from './group-purchase-reminders.js';

export function createDatabaseGroupPurchaseReminderRepository({
  database,
}: {
  database: DatabaseConnection['db'];
}): GroupPurchaseReminderRepository {
  return {
    async hasReminderBeenSent({ purchaseId, participantTelegramUserId, reminderKind, leadHours }) {
      const result = await database
        .select({ id: groupPurchaseReminders.id })
        .from(groupPurchaseReminders)
        .where(
          and(
            eq(groupPurchaseReminders.purchaseId, purchaseId),
            eq(groupPurchaseReminders.participantTelegramUserId, participantTelegramUserId),
            eq(groupPurchaseReminders.reminderKind, reminderKind),
            eq(groupPurchaseReminders.leadHours, leadHours),
          ),
        )
        .limit(1);

      return result.length > 0;
    },
    async recordReminderSent({ purchaseId, participantTelegramUserId, reminderKind, leadHours, sentAt }) {
      await database.insert(groupPurchaseReminders).values({
        purchaseId,
        participantTelegramUserId,
        reminderKind,
        leadHours,
        sentAt: new Date(sentAt),
      });
    },
  };
}
