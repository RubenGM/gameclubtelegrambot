import type { MembershipAccessRepository } from './access-flow.js';
import type { AppMetadataSessionStorage } from '../telegram/conversation-session-store.js';
import { createTelegramI18n, normalizeBotLanguage, type BotLanguage } from '../telegram/i18n.js';

const subscriptionPrefix = 'telegram.membership-request-notifications:';
const enabledValue = 'true';

export interface MembershipRequestNotificationSubscriptionStore {
  isSubscribed(telegramUserId: number): Promise<boolean>;
  setSubscribed(telegramUserId: number, isSubscribed: boolean): Promise<void>;
  listSubscribedAdminTelegramUserIds(): Promise<number[]>;
}

export interface TelegramPrivateMessageSender {
  sendPrivateMessage(
    telegramUserId: number,
    message: string,
    options?: {
      inlineKeyboard?: Array<Array<{ text: string; callbackData: string }>>;
    },
  ): Promise<void>;
}

export interface TelegramLanguagePreferenceReader {
  loadLanguage(telegramUserId: number): Promise<BotLanguage | null>;
}

export function createAppMetadataMembershipRequestNotificationSubscriptionStore({
  storage,
}: {
  storage: AppMetadataSessionStorage;
}): MembershipRequestNotificationSubscriptionStore {
  return {
    async isSubscribed(telegramUserId) {
      return (await storage.get(buildSubscriptionKey(telegramUserId))) === enabledValue;
    },
    async setSubscribed(telegramUserId, isSubscribed) {
      const key = buildSubscriptionKey(telegramUserId);

      if (isSubscribed) {
        await storage.set(key, enabledValue);
        return;
      }

      await storage.delete(key);
    },
    async listSubscribedAdminTelegramUserIds() {
      const rows = await storage.listByPrefix(subscriptionPrefix);

      return rows
        .filter((row) => row.value === enabledValue)
        .map((row) => Number(row.key.slice(subscriptionPrefix.length)))
        .filter((telegramUserId) => Number.isInteger(telegramUserId) && telegramUserId > 0)
        .sort((left, right) => left - right);
    },
  };
}

export async function toggleMembershipRequestNotifications({
  store,
  telegramUserId,
  enabled,
}: {
  store: MembershipRequestNotificationSubscriptionStore;
  telegramUserId: number;
  enabled: boolean;
}): Promise<'enabled' | 'disabled' | 'already-enabled' | 'already-disabled'> {
  const currentlySubscribed = await store.isSubscribed(telegramUserId);

  if (enabled) {
    if (currentlySubscribed) {
      return 'already-enabled';
    }

    await store.setSubscribed(telegramUserId, true);
    return 'enabled';
  }

  if (!currentlySubscribed) {
    return 'already-disabled';
  }

  await store.setSubscribed(telegramUserId, false);
  return 'disabled';
}

export async function notifySubscribedAdminsOfMembershipRequest({
  store,
  membershipRepository,
  languagePreferenceReader,
  privateMessageSender,
  requesterTelegramUserId,
  requesterDisplayName,
  requesterUsername,
}: {
  store: MembershipRequestNotificationSubscriptionStore;
  membershipRepository: MembershipAccessRepository;
  languagePreferenceReader: TelegramLanguagePreferenceReader;
  privateMessageSender: TelegramPrivateMessageSender;
  requesterTelegramUserId: number;
  requesterDisplayName: string;
  requesterUsername?: string | null;
}): Promise<number> {
  const recipientIds = await store.listSubscribedAdminTelegramUserIds();
  let sentCount = 0;

  for (const recipientTelegramUserId of recipientIds) {
    const recipient = await membershipRepository.findUserByTelegramUserId(recipientTelegramUserId);
    if (!recipient || !recipient.isAdmin || recipient.status !== 'approved') {
      continue;
    }

    const preferredLanguage = await languagePreferenceReader.loadLanguage(recipientTelegramUserId);
    const language = normalizeBotLanguage(preferredLanguage ?? undefined, 'ca');
    const i18n = createTelegramI18n(language);
    const label = formatRequesterLabel({
      displayName: requesterDisplayName,
      ...(requesterUsername !== undefined ? { username: requesterUsername } : {}),
      telegramUserId: requesterTelegramUserId,
    });

    await privateMessageSender.sendPrivateMessage(recipientTelegramUserId, i18n.membership.newRequestNotification.replace('{label}', label), {
      inlineKeyboard: [[{
        text: i18n.common.approveButton,
        callbackData: `approve_access:${requesterTelegramUserId}`,
      }]],
    });
    sentCount += 1;
  }

  return sentCount;
}

function buildSubscriptionKey(telegramUserId: number): string {
  return `${subscriptionPrefix}${telegramUserId}`;
}

function formatRequesterLabel({
  displayName,
  username,
  telegramUserId,
}: {
  displayName: string;
  username?: string | null;
  telegramUserId: number;
}): string {
  const normalizedDisplayName = displayName.trim();
  const normalizedUsername = username?.trim();

  if (normalizedDisplayName && normalizedUsername) {
    return `${normalizedDisplayName} (@${normalizedUsername})`;
  }

  if (normalizedDisplayName) {
    return normalizedDisplayName;
  }

  if (normalizedUsername) {
    return `@${normalizedUsername}`;
  }

  return `Usuari ${telegramUserId}`;
}
