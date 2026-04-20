import { createTelegramI18n, type BotLanguage } from './i18n.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

export const groupPurchaseLabels = {
  openMenu: 'Compres conjuntes',
  list: 'Veure compres',
  create: 'Crear compra',
} as const;

export function buildGroupPurchaseMenuOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const i18n = createTelegramI18n(language);
  const texts = i18n.groupPurchases;

  return {
    replyKeyboard: [[texts.list, texts.create], [i18n.actionMenu.start, i18n.actionMenu.help]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}
