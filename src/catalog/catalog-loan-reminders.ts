import type { CatalogLoanRepository } from './catalog-model.js';

export type CatalogLoanReminderKind = 'due_soon' | 'overdue';

export interface CatalogLoanReminderRepository {
  hasReminderBeenSent(input: {
    loanId: number;
    borrowerTelegramUserId: number;
    reminderKind: CatalogLoanReminderKind;
    leadHours: number | null;
  }): Promise<boolean>;
  recordReminderSent(input: {
    loanId: number;
    borrowerTelegramUserId: number;
    reminderKind: CatalogLoanReminderKind;
    leadHours: number | null;
    sentAt: string;
  }): Promise<void>;
}

export interface CatalogLoanReminderRunResult {
  consideredLoans: number;
  sentReminders: number;
  skippedReminders: number;
  failedReminders: number;
}

export async function sendDueCatalogLoanReminders({
  catalogLoanRepository,
  reminderRepository,
  now = new Date(),
  leadHours,
  language,
  sendPrivateMessage,
}: {
  catalogLoanRepository: CatalogLoanRepository;
  reminderRepository: CatalogLoanReminderRepository;
  now?: Date;
  leadHours: number;
  language: string;
  sendPrivateMessage: (telegramUserId: number, message: string) => Promise<void>;
}): Promise<CatalogLoanReminderRunResult> {
  const windowEnd = new Date(now.getTime() + leadHours * 60 * 60 * 1000);
  const loans = await catalogLoanRepository.listActiveLoansDueBefore({
    dueAtTo: windowEnd.toISOString(),
    includeOverdue: true,
  });
  const result: CatalogLoanReminderRunResult = {
    consideredLoans: loans.length,
    sentReminders: 0,
    skippedReminders: 0,
    failedReminders: 0,
  };

  for (const loan of loans) {
    if (!loan.dueAt) {
      result.skippedReminders += 1;
      continue;
    }

    const dueAt = new Date(loan.dueAt);
    const reminderKind: CatalogLoanReminderKind = dueAt.getTime() < now.getTime() ? 'overdue' : 'due_soon';
    const effectiveLeadHours = reminderKind === 'due_soon' ? leadHours : null;
    const alreadySent = await reminderRepository.hasReminderBeenSent({
      loanId: loan.id,
      borrowerTelegramUserId: loan.borrowerTelegramUserId,
      reminderKind,
      leadHours: effectiveLeadHours,
    });
    if (alreadySent) {
      result.skippedReminders += 1;
      continue;
    }

    try {
      await sendPrivateMessage(
        loan.borrowerTelegramUserId,
        formatCatalogLoanReminderMessage({
          itemDisplayName: loan.itemDisplayName,
          dueAt: loan.dueAt,
          reminderKind,
          language,
        }),
      );
      await reminderRepository.recordReminderSent({
        loanId: loan.id,
        borrowerTelegramUserId: loan.borrowerTelegramUserId,
        reminderKind,
        leadHours: effectiveLeadHours,
        sentAt: now.toISOString(),
      });
      result.sentReminders += 1;
    } catch {
      result.failedReminders += 1;
    }
  }

  return result;
}

function formatCatalogLoanReminderMessage({
  itemDisplayName,
  dueAt,
  reminderKind,
  language,
}: {
  itemDisplayName: string;
  dueAt: string;
  reminderKind: CatalogLoanReminderKind;
  language: string;
}): string {
  const date = new Date(dueAt);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const formattedDate = `${day}/${month} ${hours}:${minutes}`;

  if (language === 'es') {
    return reminderKind === 'overdue'
      ? `Recordatorio: ${itemDisplayName} tenia prevista la devolucion el ${formattedDate}.`
      : `Recordatorio: ${itemDisplayName} debe devolverse el ${formattedDate}.`;
  }
  if (language === 'en') {
    return reminderKind === 'overdue'
      ? `Reminder: ${itemDisplayName} was due back on ${formattedDate}.`
      : `Reminder: ${itemDisplayName} is due back on ${formattedDate}.`;
  }

  return reminderKind === 'overdue'
    ? `Recordatori: ${itemDisplayName} tenia prevista la devolucio el ${formattedDate}.`
    : `Recordatori: ${itemDisplayName} s'ha de tornar el ${formattedDate}.`;
}
