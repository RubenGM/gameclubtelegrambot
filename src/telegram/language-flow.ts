import { APP_VERSION } from '../app-version.js';
import type { AuthorizationService } from '../authorization/service.js';
import { resolveTelegramActionMenu } from './action-menu.js';
import type { TelegramActor } from './actor-store.js';
import type { TelegramChatContext } from './chat-context.js';
import { createDatabaseAppMetadataSessionStorage } from './conversation-session-store.js';
import { createAppMetadataTelegramLanguagePreferenceStore } from './language-preference-store.js';
import {
  createTelegramI18n,
  isBotLanguage,
  languageDisplayName,
  languageNames,
  normalizeBotLanguage,
  type BotLanguage,
} from './i18n.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

export interface TelegramLanguageContext {
  messageText?: string | undefined;
  callbackData?: string | undefined;
  reply(message: string, options?: TelegramReplyOptions): Promise<unknown>;
  runtime: {
    bot: {
      publicName: string;
      language?: string;
    };
    actor: TelegramActor;
    authorization: AuthorizationService;
    chat: TelegramChatContext;
    services: {
      database: {
        db: unknown;
      };
    };
  };
}

export function buildLanguageSelectionKeyboard(): TelegramReplyOptions {
  const names = languageNames();

  return {
    replyKeyboard: [[names.ca, names.es, names.en]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export async function handleTelegramLanguageText(context: TelegramLanguageContext): Promise<boolean> {
  const text = context.messageText?.trim();
  if (!text) {
    return false;
  }

  const activeLanguage = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const i18n = createTelegramI18n(activeLanguage);

  if (text === i18n.actionMenu.language) {
    await context.reply([i18n.language.prompt, i18n.language.help].join('\n'), buildLanguageSelectionKeyboard());
    return true;
  }

  if (!matchesLanguageSelectionText(text)) {
    return false;
  }

  const selectedLanguage = resolveLanguageFromText(text);
  if (!selectedLanguage) {
    return false;
  }

  await saveLanguagePreference(context, selectedLanguage);
  await replyWithLanguageConfirmation(context, selectedLanguage);
  return true;
}

export async function handleTelegramLanguageCommand(context: TelegramLanguageContext): Promise<boolean> {
  const text = context.messageText?.trim();
  if (!text || !/^\/language(?:@\w+)?(?:\s+\S+)?$/i.test(text)) {
    return false;
  }

  const rawLanguage = text.split(/\s+/)[1];
  if (rawLanguage) {
    const candidateLanguage = rawLanguage.toLowerCase();

    if (!isBotLanguage(candidateLanguage)) {
      const activeLanguage = normalizeBotLanguage(context.runtime.bot.language, 'ca');
      const i18n = createTelegramI18n(activeLanguage);
      await context.reply([i18n.language.prompt, i18n.language.help].join('\n'), buildLanguageSelectionKeyboard());
      return true;
    }

    const selectedLanguage: BotLanguage = candidateLanguage;
    await saveLanguagePreference(context, selectedLanguage);
    await replyWithLanguageConfirmation(context, selectedLanguage);
    return true;
  }

  const activeLanguage = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const i18n = createTelegramI18n(activeLanguage);
  await context.reply(
    [i18n.language.prompt, i18n.language.help, '', i18n.common.currentLanguage.replace('{language}', languageDisplayName(activeLanguage))].join('\n'),
    buildLanguageSelectionKeyboard(),
  );
  return true;
}

async function replyWithLanguageConfirmation(
  context: TelegramLanguageContext,
  selectedLanguage: BotLanguage,
): Promise<void> {
  const i18n = createTelegramI18n(selectedLanguage);
  context.runtime.bot.language = selectedLanguage;
  const actionMenu = resolveTelegramActionMenu({
    context: {
      actor: context.runtime.actor,
      authorization: context.runtime.authorization,
      chat: context.runtime.chat,
      session: null,
      language: selectedLanguage,
    },
  });
  const startMessage = (
    context.runtime.actor.isAdmin
      ? i18n.common.startMessageAdmin
      : context.runtime.actor.isApproved
        ? i18n.common.startMessagePublic
        : i18n.common.startMessagePending
  )
    .replace('{publicName}', context.runtime.bot.publicName)
    .replace('{version}', APP_VERSION);

  await context.reply(
    [
      i18n.language.saved.replace('{language}', languageDisplayName(selectedLanguage)),
      i18n.common.currentLanguage.replace('{language}', languageDisplayName(selectedLanguage)),
      '',
      startMessage,
    ].join('\n'),
    actionMenu,
  );
}

async function saveLanguagePreference(
  context: TelegramLanguageContext,
  selectedLanguage: BotLanguage,
): Promise<void> {
  const storage = createDatabaseAppMetadataSessionStorage({ database: context.runtime.services.database.db as never });
  const store = createAppMetadataTelegramLanguagePreferenceStore({ storage });
  await store.saveLanguage(context.runtime.actor.telegramUserId, selectedLanguage);
}

function matchesLanguageSelectionText(text: string): boolean {
  const names = languageNames();
  const normalized = text.toLowerCase();
  return normalized === 'ca' || normalized === 'es' || normalized === 'en' || Object.values(names).some((name) => name.toLowerCase() === normalized);
}

function resolveLanguageFromText(text: string): BotLanguage | null {
  const normalized = text.trim().toLowerCase();
  if (normalized === languageDisplayName('ca').toLowerCase() || normalized === 'ca') return 'ca';
  if (normalized === languageDisplayName('es').toLowerCase() || normalized === 'es') return 'es';
  if (normalized === languageDisplayName('en').toLowerCase() || normalized === 'en') return 'en';
  return null;
}
