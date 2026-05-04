import { createTelegramI18n, type BotLanguage } from './i18n.js';
import type { TelegramReplyButton, TelegramReplyOptions } from './runtime-boundary.js';
import { buildSubmenuReplyKeyboard } from './submenu-keyboards.js';

export const lfgCallbackPrefixes = {
  editPlayer: 'lfg:edit_player:',
  resolvePlayer: 'lfg:resolve_player:',
  cancelPlayer: 'lfg:cancel_player:',
  editGroup: 'lfg:edit_group:',
  resolveGroup: 'lfg:resolve_group:',
  cancelGroup: 'lfg:cancel_group:',
} as const;

export function buildLfgMenuOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).lfg;
  return buildSubmenuReplyKeyboard({
    language,
    rows: [
      [texts.playersList],
      [texts.groupsList],
      [texts.playerCreate, texts.groupCreate],
      [texts.myAds],
      [texts.back],
    ],
  });
}

export function buildLfgSingleCancelKeyboard(): TelegramReplyOptions {
  return {
    replyKeyboard: [[dangerButton('/cancel')]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildLfgSkipCancelKeyboard(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).lfg;
  return {
    replyKeyboard: [[successButton(texts.skipOptional)], [dangerButton('/cancel')]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildLfgSaveOptions({
  language = 'ca',
  mode,
}: {
  language?: BotLanguage;
  mode: 'player-create' | 'player-edit' | 'group-create' | 'group-edit';
}): TelegramReplyOptions {
  const texts = createTelegramI18n(language).lfg;
  const saveText = mode === 'player-edit' || mode === 'group-edit'
    ? texts.saveChanges
    : mode === 'player-create'
      ? texts.savePlayerAd
      : texts.saveGroupAd;

  return {
    replyKeyboard: [[successButton(saveText)], [dangerButton('/cancel')]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildLfgMyPlayerAdOptions(adId: number, language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).lfg;
  return {
    inlineKeyboard: [
      [{ text: texts.editButton, callbackData: `${lfgCallbackPrefixes.editPlayer}${adId}` }],
      [{ text: texts.resolveButton, callbackData: `${lfgCallbackPrefixes.resolvePlayer}${adId}` }],
      [{ text: texts.cancelButton, callbackData: `${lfgCallbackPrefixes.cancelPlayer}${adId}` }],
    ],
  };
}

export function buildLfgMyGroupAdOptions(adId: number, language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).lfg;
  return {
    inlineKeyboard: [
      [{ text: texts.editButton, callbackData: `${lfgCallbackPrefixes.editGroup}${adId}` }],
      [{ text: texts.resolveButton, callbackData: `${lfgCallbackPrefixes.resolveGroup}${adId}` }],
      [{ text: texts.cancelButton, callbackData: `${lfgCallbackPrefixes.cancelGroup}${adId}` }],
    ],
  };
}

function successButton(text: string): TelegramReplyButton {
  return { text, semanticRole: 'success' };
}

function dangerButton(text: string): TelegramReplyButton {
  return { text, semanticRole: 'danger' };
}
