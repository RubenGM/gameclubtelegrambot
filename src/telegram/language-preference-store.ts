import type { BotLanguage } from './i18n.js';
import type { AppMetadataSessionStorage } from './conversation-session-store.js';

const languagePreferencePrefix = 'telegram.language:';

export interface TelegramLanguagePreferenceStore {
  loadLanguage(telegramUserId: number): Promise<BotLanguage | null>;
  saveLanguage(telegramUserId: number, language: BotLanguage): Promise<void>;
}

export function createAppMetadataTelegramLanguagePreferenceStore({
  storage,
}: {
  storage: AppMetadataSessionStorage;
}): TelegramLanguagePreferenceStore {
  return {
    async loadLanguage(telegramUserId) {
      const rawLanguage = await storage.get(buildPreferenceKey(telegramUserId));
      if (rawLanguage === 'ca' || rawLanguage === 'es' || rawLanguage === 'en') {
        return rawLanguage;
      }

      return null;
    },
    async saveLanguage(telegramUserId, language) {
      await storage.set(buildPreferenceKey(telegramUserId), language);
    },
  };
}

function buildPreferenceKey(telegramUserId: number): string {
  return `${languagePreferencePrefix}${telegramUserId}`;
}
