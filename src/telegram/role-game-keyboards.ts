import { createTelegramI18n, type BotLanguage } from './i18n.js';
import type { TelegramReplyButton, TelegramReplyOptions } from './runtime-boundary.js';

export const roleGameCallbackPrefixes = {
  detail: 'role_game:detail:',
  listMine: 'role_game:list:mine:',
  listVisible: 'role_game:list:visible:',
  requestSeat: 'role_game:request:',
  acceptRequest: 'role_game:accept:',
  rejectRequest: 'role_game:reject:',
  scheduleSession: 'role_game:schedule:',
  configureRecurrence: 'role_game:configure_recurrence:',
  materialUpload: 'role_game:material_upload:',
  materials: 'role_game:materials:',
  edit: 'role_game:edit:',
  invite: 'role_game:invite:',
  material: 'role_game:material:',
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

export function buildRoleGameCreateStepKeyboard({
  language = 'ca',
  rows = [],
}: {
  language?: BotLanguage;
  rows?: TelegramReplyButton[][];
}): TelegramReplyOptions {
  const texts = createTelegramI18n(language).roleGames;
  return buildRoleGameReplyKeyboard(language, [
    ...rows,
    [dangerButton(texts.cancel)],
  ]);
}

export function buildRoleGameCreateConfirmationKeyboard(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).roleGames;
  return buildRoleGameReplyKeyboard(language, [
    [successButton(texts.confirmCreate)],
    [dangerButton(texts.cancel)],
  ]);
}

export function buildRoleGameDashboardKeyboard({
  canManageParticipants = false,
  canSchedule = false,
  canManageMaterials = false,
  canConfigure = false,
  canRequestSeat = false,
  pendingRequestCount = 0,
  language = 'ca',
}: {
  canManageParticipants?: boolean;
  canSchedule?: boolean;
  canManageMaterials?: boolean;
  canConfigure?: boolean;
  canRequestSeat?: boolean;
  pendingRequestCount?: number;
  language?: BotLanguage;
}): TelegramReplyOptions {
  const texts = createTelegramI18n(language).roleGames;
  const rows: TelegramReplyButton[][] = [];
  if (canManageParticipants) {
    rows.push([primaryButton(pendingRequestCount > 0
      ? texts.participantsPending.replace('{count}', String(pendingRequestCount))
      : texts.participants)]);
  }
  const sections: TelegramReplyButton[] = [canSchedule ? successButton(texts.sessions) : primaryButton(texts.sessions)];
  if (canManageMaterials) {
    sections.push(primaryButton(texts.materials));
  }
  rows.push(sections);
  const management: TelegramReplyButton[] = [];
  if (canManageParticipants) {
    management.push(successButton(texts.invite));
  }
  if (canConfigure) {
    management.push(primaryButton(texts.configuration));
  }
  if (management.length > 0) {
    rows.push(management);
  }
  if (canRequestSeat) {
    rows.push([successButton(texts.requestSeat)]);
  }
  rows.push([navigationButton(texts.backToMyGames)]);
  return buildRoleGameReplyKeyboard(language, rows);
}

export function buildRoleGameSessionsKeyboard({
  canSchedule = false,
  language = 'ca',
}: {
  canSchedule?: boolean;
  language?: BotLanguage;
} = {}): TelegramReplyOptions {
  const texts = createTelegramI18n(language).roleGames;
  return buildRoleGameReplyKeyboard(language, [
    ...(canSchedule ? [[successButton(texts.scheduleNextSession)]] : []),
    [navigationButton(texts.backToGame)],
  ]);
}

export function buildRoleGameParticipantsKeyboard({
  memberButtons,
  kind,
  hasPreviousPage = false,
  hasNextPage = false,
  language = 'ca',
}: {
  memberButtons: Record<string, number>;
  kind: 'active' | 'history';
  hasPreviousPage?: boolean;
  hasNextPage?: boolean;
  language?: BotLanguage;
}): TelegramReplyOptions {
  const texts = createTelegramI18n(language).roleGames;
  const navigation: TelegramReplyButton[] = [];
  if (hasPreviousPage) {
    navigation.push(navigationButton(texts.previousPage));
  }
  if (hasNextPage) {
    navigation.push(navigationButton(texts.nextPage));
  }
  return buildRoleGameReplyKeyboard(language, [
    ...Object.keys(memberButtons).map((label) => [primaryButton(label)]),
    ...(navigation.length > 0 ? [navigation] : []),
    [navigationButton(kind === 'active' ? texts.participantsHistory : texts.currentParticipants)],
    [navigationButton(texts.backToGame)],
  ]);
}

export function buildRoleGameParticipantDetailKeyboard(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).roleGames;
  return buildRoleGameReplyKeyboard(language, [
    [navigationButton(texts.backToGame)],
  ]);
}

export function buildRoleGameMaterialsKeyboard({
  canUpload = false,
  hasPreviousPage = false,
  hasNextPage = false,
  language = 'ca',
}: {
  canUpload?: boolean;
  hasPreviousPage?: boolean;
  hasNextPage?: boolean;
  language?: BotLanguage;
} = {}): TelegramReplyOptions {
  const texts = createTelegramI18n(language).roleGames;
  const navigation: TelegramReplyButton[] = [];
  if (hasPreviousPage) {
    navigation.push(navigationButton(texts.previousPage));
  }
  if (hasNextPage) {
    navigation.push(navigationButton(texts.nextPage));
  }
  return buildRoleGameReplyKeyboard(language, [
    ...(canUpload ? [[primaryButton(texts.uploadMaterial)]] : []),
    ...(navigation.length > 0 ? [navigation] : []),
    [navigationButton(texts.backToGame)],
  ]);
}

export function buildRoleGameConfigurationKeyboard({
  canEdit = false,
  canConfigureRecurrence = false,
  language = 'ca',
}: {
  canEdit?: boolean;
  canConfigureRecurrence?: boolean;
  language?: BotLanguage;
} = {}): TelegramReplyOptions {
  const texts = createTelegramI18n(language).roleGames;
  return buildRoleGameReplyKeyboard(language, [
    ...(canEdit ? [[primaryButton(texts.editGame)]] : []),
    ...(canConfigureRecurrence ? [[primaryButton(texts.configureRecurrence)]] : []),
    [navigationButton(texts.backToGame)],
  ]);
}

export function buildRoleGameDetailInlineKeyboard({
  gameId,
  requestMemberIds = [],
  canRequestSeat = false,
  canScheduleSession = false,
  canConfigureRecurrence = false,
  canEditGame = false,
  canManageGame = false,
  language = 'ca',
}: {
  gameId: number;
  requestMemberIds?: number[];
  canRequestSeat?: boolean;
  canScheduleSession?: boolean;
  canConfigureRecurrence?: boolean;
  canEditGame?: boolean;
  canManageGame?: boolean;
  language?: BotLanguage;
}): Pick<TelegramReplyOptions, 'inlineKeyboard'> {
  const texts = createTelegramI18n(language).roleGames;
  const inlineKeyboard: NonNullable<TelegramReplyOptions['inlineKeyboard']> = [];
  if (canConfigureRecurrence) {
    inlineKeyboard.push([
      { text: texts.configureRecurrence, callbackData: `${roleGameCallbackPrefixes.configureRecurrence}${gameId}`, semanticRole: 'primary' },
    ]);
  }
  if (canScheduleSession) {
    inlineKeyboard.push([
      { text: texts.scheduleNextSession, callbackData: `${roleGameCallbackPrefixes.scheduleSession}${gameId}`, semanticRole: 'success' },
    ]);
  }
  if (canEditGame) {
    inlineKeyboard.push([
      { text: texts.editGame, callbackData: `${roleGameCallbackPrefixes.edit}${gameId}`, semanticRole: 'primary' },
    ]);
  }
  if (canManageGame) {
    inlineKeyboard.push([
      { text: texts.invitePlayers, callbackData: `${roleGameCallbackPrefixes.invite}${gameId}`, semanticRole: 'success' },
    ]);
    inlineKeyboard.push([
      { text: texts.uploadMaterial, callbackData: `${roleGameCallbackPrefixes.materialUpload}${gameId}`, semanticRole: 'primary' },
      { text: texts.materials, callbackData: `${roleGameCallbackPrefixes.materials}${gameId}:1`, semanticRole: 'primary' },
    ]);
  }
  if (canRequestSeat) {
    inlineKeyboard.push([
      { text: texts.requestSeat, callbackData: `${roleGameCallbackPrefixes.requestSeat}${gameId}`, semanticRole: 'success' },
    ]);
  }
  for (const memberId of requestMemberIds) {
    inlineKeyboard.push([
      { text: texts.acceptRequest, callbackData: `${roleGameCallbackPrefixes.acceptRequest}${memberId}`, semanticRole: 'success' },
      { text: texts.rejectRequest, callbackData: `${roleGameCallbackPrefixes.rejectRequest}${memberId}`, semanticRole: 'danger' },
    ]);
  }
  return inlineKeyboard.length > 0 ? { inlineKeyboard } : {};
}

export function buildRoleGameMaterialInlineKeyboard({
  materialId,
  canManage = false,
  language = 'ca',
}: {
  materialId: number;
  canManage?: boolean;
  language?: BotLanguage;
}): Pick<TelegramReplyOptions, 'inlineKeyboard'> {
  if (!canManage) {
    return {};
  }
  const texts = createTelegramI18n(language).roleGames;
  return {
    inlineKeyboard: [
      [
        { text: texts.sendMaterialOnly, callbackData: `${roleGameCallbackPrefixes.material}send_only:${materialId}`, semanticRole: 'primary' },
      ],
      [
        { text: texts.sendAndRevealMaterial, callbackData: `${roleGameCallbackPrefixes.material}send_and_reveal:${materialId}`, semanticRole: 'success' },
      ],
      [
        { text: texts.revealMaterialOnly, callbackData: `${roleGameCallbackPrefixes.material}reveal_only:${materialId}`, semanticRole: 'success' },
      ],
    ],
  };
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
