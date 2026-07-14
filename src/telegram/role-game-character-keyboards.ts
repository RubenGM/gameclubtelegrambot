import { createTelegramI18n, type BotLanguage } from './i18n.js';
import type { TelegramReplyButton, TelegramReplyOptions } from './runtime-boundary.js';

function keyboard(language: BotLanguage, rows: TelegramReplyButton[][]): TelegramReplyOptions {
  const i18n = createTelegramI18n(language);
  return {
    replyKeyboard: [...rows, [
      { text: i18n.actionMenu.start, semanticRole: 'navigation' },
      { text: i18n.actionMenu.help, semanticRole: 'help' },
    ]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

const primary = (text: string): TelegramReplyButton => ({ text, semanticRole: 'primary' });
const success = (text: string): TelegramReplyButton => ({ text, semanticRole: 'success' });
const danger = (text: string): TelegramReplyButton => ({ text, semanticRole: 'danger' });
const navigation = (text: string): TelegramReplyButton => ({ text, semanticRole: 'navigation' });

export function buildRoleGameCharacterMenuKeyboard({
  language,
  canManage,
}: { language: BotLanguage; canManage: boolean }): TelegramReplyOptions {
  const t = createTelegramI18n(language).roleGames;
  return keyboard(language, [
    [primary(t.myCharacters), primary(t.campaignCharacters)],
    [primary(t.unassignedCharacters)],
    [success(t.createCharacter)],
    ...(canManage ? [[primary(t.characterClaims), primary(t.assignCharacter)]] : []),
    [navigation(t.backToGame)],
  ]);
}

export function buildRoleGameCharacterListKeyboard({
  language,
  canManage = false,
  selectionButtons = {},
  hasPreviousPage,
  hasNextPage,
}: {
  language: BotLanguage;
  canManage?: boolean;
  selectionButtons?: Record<string, number>;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
}): TelegramReplyOptions {
  const t = createTelegramI18n(language).roleGames;
  const pagination: TelegramReplyButton[] = [];
  if (hasPreviousPage) pagination.push(navigation(t.previousPage));
  if (hasNextPage) pagination.push(navigation(t.nextPage));
  return keyboard(language, [
    ...Object.keys(selectionButtons).map((label) => [primary(label)]),
    ...(pagination.length ? [pagination] : []),
    [primary(t.myCharacters), primary(t.campaignCharacters)],
    [primary(t.unassignedCharacters)],
    [success(t.createCharacter)],
    ...(canManage ? [[primary(t.characterClaims), primary(t.assignCharacter)]] : []),
    [navigation(t.backToGame)],
  ]);
}

export function buildRoleGameCharacterDetailKeyboard({
  language,
  canEdit,
  canManage,
  canRequest,
  hasOwnPendingRequest,
  isOwner,
  isAssigned,
}: {
  language: BotLanguage;
  canEdit: boolean;
  canManage: boolean;
  canRequest: boolean;
  hasOwnPendingRequest: boolean;
  isOwner: boolean;
  isAssigned: boolean;
}): TelegramReplyOptions {
  const t = createTelegramI18n(language).roleGames;
  const rows: TelegramReplyButton[][] = [];
  if (canEdit) {
    rows.push([primary(t.editCharacter), primary(t.manageCharacterAttachments)]);
  }
  if (canRequest) rows.push([success(t.requestCharacter)]);
  if (hasOwnPendingRequest) rows.push([danger(t.cancelCharacterRequest)]);
  if (isOwner) rows.push([danger(t.abandonCharacter)]);
  if (canManage && isAssigned) rows.push([primary(t.transferCharacter), danger(t.unassignCharacter)]);
  if (canManage && !isAssigned) rows.push([success(t.assignCharacter)]);
  rows.push([navigation(t.backToCharacters)]);
  return keyboard(language, rows);
}

export function buildRoleGameCharacterStepKeyboard({
  language,
  rows = [],
}: { language: BotLanguage; rows?: TelegramReplyButton[][] }): TelegramReplyOptions {
  const t = createTelegramI18n(language).roleGames;
  return keyboard(language, [...rows, [danger(t.cancel)]]);
}

export function buildRoleGameCharacterConfirmKeyboard(language: BotLanguage): TelegramReplyOptions {
  const t = createTelegramI18n(language).roleGames;
  return keyboard(language, [[success(t.confirmCreateCharacter)], [danger(t.cancel)]]);
}

export function buildRoleGameCharacterActionConfirmKeyboard(language: BotLanguage): TelegramReplyOptions {
  const t = createTelegramI18n(language).roleGames;
  return keyboard(language, [[success(t.confirmCharacterAction)], [danger(t.characterActionCancelled)], [navigation(t.backToCharacter)]]);
}

export function buildRoleGameCharacterAttachmentsKeyboard({
  language,
  attachmentButtons,
  canEdit,
  hasPreviousPage = false,
  hasNextPage = false,
}: { language: BotLanguage; attachmentButtons: Record<string, number>; canEdit: boolean; hasPreviousPage?: boolean; hasNextPage?: boolean }): TelegramReplyOptions {
  const t = createTelegramI18n(language).roleGames;
  const pagination = [];
  if (hasPreviousPage) pagination.push(navigation(t.previousPage));
  if (hasNextPage) pagination.push(navigation(t.nextPage));
  return keyboard(language, [
    ...Object.keys(attachmentButtons).map((label) => [primary(label)]),
    ...(pagination.length ? [pagination] : []),
    ...(canEdit ? [[success(t.addCharacterAttachment)]] : []),
    [navigation(t.backToCharacter)],
  ]);
}

export function buildRoleGameCharacterAttachmentDetailKeyboard({
  language,
  canEdit,
}: { language: BotLanguage; canEdit: boolean }): TelegramReplyOptions {
  const t = createTelegramI18n(language).roleGames;
  return keyboard(language, [
    ...(canEdit ? [
      [primary(t.changeCharacterAttachmentVisibility), primary(t.replaceCharacterAttachment)],
      [danger(t.removeCharacterAttachment)],
    ] : []),
    [navigation(t.manageCharacterAttachments)],
    [navigation(t.backToCharacter)],
  ]);
}
