import { createTelegramI18n, type BotLanguage } from './i18n.js';
import type { TelegramReplyButton, TelegramReplyOptions } from './runtime-boundary.js';

export const roleGameCallbackPrefixes = {
  detail: 'role_game:detail:',
  listMine: 'role_game:list:mine:',
  listVisible: 'role_game:list:visible:',
} as const;

export function buildRoleGameHomeKeyboard(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).roleGames;
  return buildRoleGameReplyKeyboard(language, [
    [primaryButton(texts.myGames), primaryButton(texts.visibleGames)],
    [successButton(texts.createGame)],
    [dangerButton(texts.cancel)],
  ]);
}

export function buildRoleGameListKeyboard({
  language = 'ca',
  hasPreviousPage,
  hasNextPage,
}: {
  language?: BotLanguage;
  hasPreviousPage?: boolean;
  hasNextPage?: boolean;
}): TelegramReplyOptions {
  const texts = createTelegramI18n(language).roleGames;
  const paginationRow: TelegramReplyButton[] = [];
  if (hasPreviousPage) {
    paginationRow.push({ text: texts.previousPage, semanticRole: 'navigation' });
  }
  if (hasNextPage) {
    paginationRow.push({ text: texts.nextPage, semanticRole: 'navigation' });
  }

  return buildRoleGameReplyKeyboard(language, [
    ...(paginationRow.length > 0 ? [paginationRow] : []),
    [primaryButton(texts.myGames), primaryButton(texts.visibleGames)],
    [successButton(texts.createGame)],
    [dangerButton(texts.cancel)],
  ]);
}

function buildRoleGameReplyKeyboard(language: BotLanguage, rows: TelegramReplyButton[][]): TelegramReplyOptions {
  const i18n = createTelegramI18n(language);
  return {
    replyKeyboard: [...rows, [navigationButton(i18n.actionMenu.start), helpButton(i18n.actionMenu.help)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function primaryButton(text: string): TelegramReplyButton {
  return { text, semanticRole: 'primary' };
}

function successButton(text: string): TelegramReplyButton {
  return { text, semanticRole: 'success' };
}

function dangerButton(text: string): TelegramReplyButton {
  return { text, semanticRole: 'danger' };
}

function navigationButton(text: string): TelegramReplyButton {
  return { text, semanticRole: 'navigation' };
}

function helpButton(text: string): TelegramReplyButton {
  return { text, semanticRole: 'help' };
}
