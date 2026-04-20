import { createTelegramI18n, type BotLanguage } from './i18n.js';
import type { TelegramReplyButton, TelegramReplyOptions } from './runtime-boundary.js';
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
    replyKeyboard: [[dangerButton('/cancel')]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildGroupPurchaseSkipCancelKeyboard(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).groupPurchases;
  return {
    replyKeyboard: [[successButton(texts.skipOptional)], [dangerButton('/cancel')]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildGroupPurchaseModeOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).groupPurchases;
  return {
    replyKeyboard: [[texts.modePerItem, texts.modeSharedCost], [dangerButton('/cancel')]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildGroupPurchaseFieldMenuOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).groupPurchases;
  return {
    replyKeyboard: [[texts.addIntegerField, texts.addChoiceField], [texts.addTextField, successButton(texts.continueFields)], [dangerButton('/cancel')]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildGroupPurchaseYesNoOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).groupPurchases;
  return {
    replyKeyboard: [[texts.yes, texts.no], [dangerButton('/cancel')]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildGroupPurchaseSaveOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).groupPurchases;
  return {
    replyKeyboard: [[successButton(texts.savePurchase)], [dangerButton('/cancel')]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildGroupPurchaseDateOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).groupPurchases;
  return {
    replyKeyboard: [...buildUpcomingDateRows(language), [successButton(texts.skipOptional)], [dangerButton('/cancel')]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function successButton(text: string): TelegramReplyButton {
  return { text, semanticRole: 'success' };
}

function dangerButton(text: string): TelegramReplyButton {
  return { text, semanticRole: 'danger' };
}
