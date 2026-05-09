import { and, eq } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { catalogLoanReminders } from '../infrastructure/database/schema.js';
import type { CatalogLoanReminderRepository } from './catalog-loan-reminders.js';

export function createDatabaseCatalogLoanReminderRepository({
  database,
}: {
  database: DatabaseConnection['db'];
}): CatalogLoanReminderRepository {
  return {
    async hasReminderBeenSent({ loanId, borrowerTelegramUserId, reminderKind, leadHours }) {
      const result = await database
        .select({ id: catalogLoanReminders.id })
        .from(catalogLoanReminders)
        .where(
          and(
            eq(catalogLoanReminders.loanId, loanId),
            eq(catalogLoanReminders.borrowerTelegramUserId, borrowerTelegramUserId),
            eq(catalogLoanReminders.reminderKind, reminderKind),
            eq(catalogLoanReminders.leadHours, normalizeLeadHours(leadHours)),
          ),
        )
        .limit(1);

      return result.length > 0;
    },
    async recordReminderSent({ loanId, borrowerTelegramUserId, reminderKind, leadHours, sentAt }) {
      await database.insert(catalogLoanReminders).values({
        loanId,
        borrowerTelegramUserId,
        reminderKind,
        leadHours: normalizeLeadHours(leadHours),
        sentAt: new Date(sentAt),
      });
    },
  };
}

function normalizeLeadHours(leadHours: number | null): number {
  return leadHours ?? 0;
}
