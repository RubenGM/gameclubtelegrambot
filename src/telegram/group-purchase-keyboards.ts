import { createTelegramI18n, type BotLanguage } from './i18n.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import { buildUpcomingDateRows } from './schedule-presentation.js';

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

export function buildGroupPurchaseSingleCancelKeyboard(): TelegramReplyOptions {
  return {
    replyKeyboard: [['/cancel']],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildGroupPurchaseSkipCancelKeyboard(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).groupPurchases;
  return {
    replyKeyboard: [[texts.skipOptional], ['/cancel']],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildGroupPurchaseModeOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).groupPurchases;
  return {
    replyKeyboard: [[texts.modePerItem, texts.modeSharedCost], ['/cancel']],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildGroupPurchaseFieldMenuOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).groupPurchases;
  return {
    replyKeyboard: [[texts.addIntegerField, texts.addChoiceField], [texts.addTextField, texts.continueFields], ['/cancel']],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildGroupPurchaseYesNoOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).groupPurchases;
  return {
    replyKeyboard: [[texts.yes, texts.no], ['/cancel']],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildGroupPurchaseSaveOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).groupPurchases;
  return {
    replyKeyboard: [[texts.savePurchase], ['/cancel']],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildGroupPurchaseDateOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).groupPurchases;
  return {
    replyKeyboard: [...buildUpcomingDateRows(language), [texts.skipOptional], ['/cancel']],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}
