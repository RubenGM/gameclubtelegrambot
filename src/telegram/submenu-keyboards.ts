import { createTelegramI18n, type BotLanguage } from './i18n.js';
import type { TelegramReplyKeyboardButton, TelegramReplyOptions } from './runtime-boundary.js';

export function buildPersistentReplyKeyboard(rows: TelegramReplyKeyboardButton[][]): TelegramReplyOptions {
  return {
    replyKeyboard: rows,
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildSubmenuReplyKeyboard({
  language = 'ca',
  rows,
}: {
  language?: BotLanguage;
  rows: TelegramReplyKeyboardButton[][];
}): TelegramReplyOptions {
  return buildPersistentReplyKeyboard([...rows, buildGlobalNavigationRow(language)]);
}

export function buildGlobalNavigationRow(language: BotLanguage = 'ca'): string[] {
  const i18n = createTelegramI18n(language);
  return [i18n.actionMenu.start, i18n.actionMenu.help];
}
