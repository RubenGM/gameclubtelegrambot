import type { CatalogLoanRepository } from './catalog-model.js';

export type CatalogLoanReminderKind = 'weekly' | 'due_soon' | 'overdue';

export interface CatalogLoanReminderMessageOptions {
  inlineKeyboard: Array<Array<{
    text: string;
    callbackData: string;
  }>>;
}

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
  language,
  sendPrivateMessage,
}: {
  catalogLoanRepository: CatalogLoanRepository;
  reminderRepository: CatalogLoanReminderRepository;
  now?: Date;
  language: string;
  sendPrivateMessage: (
    telegramUserId: number,
    message: string,
    options?: CatalogLoanReminderMessageOptions,
  ) => Promise<void>;
}): Promise<CatalogLoanReminderRunResult> {
  const loans = await catalogLoanRepository.listActiveLoansWithItems();
  const result: CatalogLoanReminderRunResult = {
    consideredLoans: loans.length,
    sentReminders: 0,
    skippedReminders: 0,
    failedReminders: 0,
  };

  for (const loan of loans) {
    const reminderWeek = completedLoanWeeks(loan.createdAt, now);
    if (reminderWeek < 1) {
      result.skippedReminders += 1;
      continue;
    }
    const reminderLeadHours = reminderWeek * 7 * 24;

    const alreadySent = await reminderRepository.hasReminderBeenSent({
      loanId: loan.id,
      borrowerTelegramUserId: loan.borrowerTelegramUserId,
      reminderKind: 'weekly',
      leadHours: reminderLeadHours,
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
          language,
        }),
        {
          inlineKeyboard: [[{
            text: formatReturnedButtonText(language),
            callbackData: `catalog_loan:return:${loan.id}`,
          }]],
        },
      );
      await reminderRepository.recordReminderSent({
        loanId: loan.id,
        borrowerTelegramUserId: loan.borrowerTelegramUserId,
        reminderKind: 'weekly',
        leadHours: reminderLeadHours,
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
  language,
}: {
  itemDisplayName: string;
  dueAt: string | null;
  language: string;
}): string {
  const formattedDate = dueAt ? formatReminderDate(dueAt) : null;

  if (language === 'es') {
    return `¡Ey! Aún tienes ${itemDisplayName}. Acuérdate de devolverlo.${formattedDate ? ` La fecha prevista era el ${formattedDate}.` : ''}`;
  }
  if (language === 'en') {
    return `Hey! You still have ${itemDisplayName}. Remember to return it.${formattedDate ? ` It was due back on ${formattedDate}.` : ''}`;
  }

  return `Ei! Encara tens ${itemDisplayName}. Recorda tornar-lo.${formattedDate ? ` La data prevista era el ${formattedDate}.` : ''}`;
}

function completedLoanWeeks(createdAt: string, now: Date): number {
  const elapsedMs = now.getTime() - new Date(createdAt).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return 0;
  }
  return Math.floor(elapsedMs / (7 * 24 * 60 * 60 * 1000));
}

function formatReminderDate(value: string): string {
  const date = new Date(value);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
}

function formatReturnedButtonText(language: string): string {
  if (language === 'es') {
    return '✅ Ya lo he devuelto';
  }
  if (language === 'en') {
    return '✅ I have returned it';
  }
  return "✅ Ja l'he tornat";
}
