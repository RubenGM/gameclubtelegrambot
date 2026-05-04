import type { GroupPurchaseRepository } from './group-purchase-catalog.js';

export type GroupPurchaseReminderKind = 'confirm_deadline';

export interface GroupPurchaseReminderRepository {
  hasReminderBeenSent(input: {
    purchaseId: number;
    participantTelegramUserId: number;
    reminderKind: GroupPurchaseReminderKind;
    leadHours: number;
  }): Promise<boolean>;
  recordReminderSent(input: {
    purchaseId: number;
    participantTelegramUserId: number;
    reminderKind: GroupPurchaseReminderKind;
    leadHours: number;
    sentAt: string;
  }): Promise<void>;
}

export interface GroupPurchaseReminderRunResult {
  consideredPurchases: number;
  sentReminders: number;
  skippedReminders: number;
  failedReminders: number;
}

const confirmDeadlineReminderKind: GroupPurchaseReminderKind = 'confirm_deadline';

export async function sendDueGroupPurchaseReminders({
  groupPurchaseRepository,
  reminderRepository,
  now = new Date(),
  leadHours,
  language,
  sendPrivateMessage,
}: {
  groupPurchaseRepository: GroupPurchaseRepository;
  reminderRepository: GroupPurchaseReminderRepository;
  now?: Date;
  leadHours: number;
  language: string;
  sendPrivateMessage: (telegramUserId: number, message: string) => Promise<void>;
}): Promise<GroupPurchaseReminderRunResult> {
  const nowIso = now.toISOString();
  const windowEndIso = new Date(now.getTime() + leadHours * 60 * 60 * 1000).toISOString();
  const purchases = (await groupPurchaseRepository.listPurchases()).filter((purchase) =>
    purchase.lifecycleStatus === 'open' &&
    purchase.confirmDeadlineAt !== null &&
    purchase.confirmDeadlineAt >= nowIso &&
    purchase.confirmDeadlineAt <= windowEndIso,
  );

  const result: GroupPurchaseReminderRunResult = {
    consideredPurchases: purchases.length,
    sentReminders: 0,
    skippedReminders: 0,
    failedReminders: 0,
  };

  for (const purchase of purchases) {
    const participants = await groupPurchaseRepository.listParticipants(purchase.id);

    for (const participant of participants) {
      if (participant.status !== 'interested') {
        result.skippedReminders += 1;
        continue;
      }

      const alreadySent = await reminderRepository.hasReminderBeenSent({
        purchaseId: purchase.id,
        participantTelegramUserId: participant.participantTelegramUserId,
        reminderKind: confirmDeadlineReminderKind,
        leadHours,
      });
      if (alreadySent) {
        result.skippedReminders += 1;
        continue;
      }

      try {
        await sendPrivateMessage(
          participant.participantTelegramUserId,
          formatGroupPurchaseReminderMessage({ title: purchase.title, confirmDeadlineAt: purchase.confirmDeadlineAt!, language }),
        );
        await reminderRepository.recordReminderSent({
          purchaseId: purchase.id,
          participantTelegramUserId: participant.participantTelegramUserId,
          reminderKind: confirmDeadlineReminderKind,
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

function formatGroupPurchaseReminderMessage({
  title,
  confirmDeadlineAt,
  language,
}: {
  title: string;
  confirmDeadlineAt: string;
  language: string;
}): string {
  const date = new Date(confirmDeadlineAt);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');

  if (language === 'es') {
    return `Recordatorio: confirma la compra conjunta ${title} antes del ${day}/${month} a las ${hours}:${minutes}.`;
  }
  if (language === 'en') {
    return `Reminder: confirm the group purchase ${title} before ${day}/${month} at ${hours}:${minutes}.`;
  }

  return `Recordatori: confirma la compra conjunta ${title} abans del ${day}/${month} a les ${hours}:${minutes}.`;
}
