import {
  canManageRoleGameOperationally,
  canManageRoleGame,
  canViewRoleGame,
  canViewRoleGameMaterial,
  createRoleGame,
  createRoleGameMaterial,
  recordRoleGameMaterialDelivery,
  requestRoleGameSeat,
  revealRoleGameMaterial,
  resolveRoleGameSeatRequest,
  type RoleGameAcceptanceMode,
  type RoleGameEntryMode,
  type RoleGameMaterialDeliveryMode,
  type RoleGameMaterialRecord,
  type RoleGameMemberRecord,
  type RoleGamePublicJoinPolicy,
  type RoleGameRecurrenceRule,
  type RoleGameRepository,
  type RoleGameRecord,
  type RoleGameSchedulingMode,
  type RoleGameType,
  type RoleGameStatus,
  type RoleGameVisibility,
  type UpdateRoleGameInput,
} from '../role-games/role-game-catalog.js';
import { createDatabaseRoleGameRepository } from '../role-games/role-game-catalog-store.js';
import { createManualRoleGameSession, createRoleGameScheduleSession } from '../role-games/role-game-scheduler.js';
import type { ScheduleRepository } from '../schedule/schedule-catalog.js';
import { createDatabaseScheduleRepository } from '../schedule/schedule-catalog-store.js';
import {
  createStorageEntry,
  type StorageCategoryRecord,
  type StorageCategoryRepository,
  type StorageEntryDetailRecord,
  type StorageEntryMessageInput,
} from '../storage/storage-catalog.js';
import { createDatabaseStorageRepository } from '../storage/storage-catalog-store.js';
import { internalRoleGameHandoutPurpose } from '../storage/storage-internal-purpose.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import { buildTelegramStartUrl } from './deep-links.js';
import { createTelegramI18n, normalizeBotLanguage, type BotLanguage } from './i18n.js';
import {
  buildStartsAt,
  parseDate,
  parseTime,
} from './schedule-parsing.js';
import {
  escapeHtml,
  formatTimestamp,
} from './schedule-presentation.js';
import {
  buildRoleGameHomeKeyboard,
  buildRoleGameCreateConfirmationKeyboard,
  buildRoleGameCreateStepKeyboard,
  buildRoleGameConfigurationKeyboard,
  buildRoleGameDashboardKeyboard,
  buildRoleGameListKeyboard,
  buildRoleGameMaterialInlineKeyboard,
  buildRoleGameMaterialsKeyboard,
  buildRoleGameParticipantsOverviewKeyboard,
  buildRoleGameSessionsKeyboard,
  roleGameCallbackPrefixes,
} from './role-game-keyboards.js';
import { startTelegramEditableProgress } from './editable-progress.js';
import {
  calculateRoleGameListTotalPages,
  clampRoleGameListPage,
  formatRoleGameDetailMessage,
  formatRoleGameListMessage,
  roleGameListPageSize,
} from './role-game-presentation.js';
import type { TelegramReplyButton } from './runtime-boundary.js';

const roleGameListFlowKey = 'role-games-list';
const roleGameCreateFlowKey = 'role-game-create';
const roleGameManualSessionFlowKey = 'role-game-manual-session';
const roleGameRecurrenceConfigFlowKey = 'role-game-recurrence-config';
const roleGameMaterialUploadFlowKey = 'role-game-material-upload';
const roleGameEditFlowKey = 'role-game-edit';
const roleGameStartPayloadPrefix = 'role_game_';
const roleGameMaterialStartPayloadPrefix = 'role_material_';
const roleGameMaterialsPageSize = 5;

type RoleGameListKind = 'mine' | 'visible';
type RoleGameCreateStep =
  | 'type'
  | 'title'
  | 'system'
  | 'description'
  | 'capacity'
  | 'visibility'
  | 'entry-mode'
  | 'acceptance-mode'
  | 'scheduling-mode'
  | 'recurrence-interval'
  | 'recurrence-weekday'
  | 'recurrence-time'
  | 'recurrence-window'
  | 'initial-session-date'
  | 'initial-session-time'
  | 'confirm';

type RoleGameManualSessionStep = 'date' | 'time';
type RoleGameRecurrenceConfigStep = 'interval' | 'weekday' | 'time' | 'window' | 'confirm';
type RoleGameEditField =
  | 'title'
  | 'system'
  | 'description'
  | 'capacity'
  | 'visibility'
  | 'entryMode'
  | 'acceptanceMode'
  | 'allowPlayerManualScheduling'
  | 'defaultIsPublicScheduleEvent'
  | 'status';
type RoleGameEditStep = 'field' | 'value';

interface RoleGameCreateDraft {
  type?: RoleGameType;
  title?: string;
  system?: string;
  description?: string;
  capacity?: number;
  visibility?: RoleGameVisibility;
  publicJoinPolicy?: RoleGamePublicJoinPolicy;
  entryMode?: RoleGameEntryMode;
  acceptanceMode?: RoleGameAcceptanceMode;
  defaultDurationMinutes?: number;
  defaultTableId?: number | null;
  defaultAttendanceMode?: 'open' | 'closed';
  defaultIsPublicScheduleEvent?: boolean;
  autoAddConfirmedPlayers?: boolean;
  allowPlayerManualScheduling?: boolean;
  schedulingMode?: RoleGameSchedulingMode;
  recurrenceRule?: RoleGameRecurrenceRule | null;
  recurrenceWindowCount?: number;
  initialSessionDate?: string;
  initialSessionTime?: string;
}

interface RoleGameManualSessionDraft {
  gameId?: number;
  date?: string;
  time?: string;
}

interface RoleGameRecurrenceConfigDraft {
  gameId?: number;
  intervalWeeks?: number;
  weekday?: RoleGameRecurrenceRule['weekday'];
  time?: string;
  windowCount?: number;
  existingFutureSessions?: number;
}

interface RoleGameEditDraft {
  gameId?: number;
  field?: RoleGameEditField;
}

interface RoleGameDetailSessionData {
  gameId: number;
  view: 'dashboard' | 'sessions' | 'materials' | 'configuration';
  page?: number;
}

export type TelegramRoleGameContext = TelegramCommandHandlerContext & {
  roleGameRepository?: RoleGameRepository;
  scheduleRepository?: ScheduleRepository;
  storageRepository?: StorageCategoryRepository;
};

export { roleGameCallbackPrefixes };

export async function handleTelegramRoleGameText(context: TelegramRoleGameContext): Promise<boolean> {
  const text = context.messageText?.trim();
  if (
    !text ||
    context.runtime.chat.kind !== 'private' ||
    context.runtime.actor.isBlocked
  ) {
    return false;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).roleGames;

  if (isRoleGameDetailSession(context)) {
    const handled = await handleRoleGameDetailText(context, text, language);
    if (handled) {
      return true;
    }
  }

  if (!context.runtime.actor.isApproved) {
    return false;
  }

  if (text === texts.cancel) {
    await context.runtime.session.cancel();
    await context.reply(createTelegramI18n(language).common.flowCancelled, buildRoleGameHomeKeyboard(language));
    return true;
  }

  if (isRoleGameCreateSession(context)) {
    return handleRoleGameCreateStep(context, text, language);
  }

  if (isRoleGameManualSessionSession(context)) {
    return handleRoleGameManualSessionStep(context, text, language);
  }

  if (isRoleGameRecurrenceConfigSession(context)) {
    return handleRoleGameRecurrenceConfigStep(context, text, language);
  }

  if (isRoleGameEditSession(context)) {
    return handleRoleGameEditStep(context, text, language);
  }

  if (isRoleGameListSession(context) && text === texts.nextPage) {
    return replyWithRoleGameListFromSession(context, 1, language);
  }
  if (isRoleGameListSession(context) && text === texts.previousPage) {
    return replyWithRoleGameListFromSession(context, -1, language);
  }

  if (matchesRoleGameEntry(text, language)) {
    await context.runtime.session.cancel();
    await context.reply(texts.menuIntro, buildRoleGameHomeKeyboard(language));
    return true;
  }

  if (text === texts.myGames) {
    return replyWithRoleGameList(context, { kind: 'mine', page: 1, language });
  }

  if (text === texts.visibleGames) {
    return replyWithRoleGameList(context, { kind: 'visible', page: 1, language });
  }

  if (text === texts.createGame) {
    await context.runtime.session.start({
      flowKey: roleGameCreateFlowKey,
      stepKey: 'type',
      data: {},
    });
    await context.reply(texts.promptType, buildRoleGameCreateStepKeyboard({
      language,
      rows: [[
        { text: texts.optionCampaign, semanticRole: 'primary' },
        { text: texts.optionOneShot, semanticRole: 'primary' },
      ]],
    }));
    return true;
  }

  return false;
}

export async function handleTelegramRoleGameMessage(context: TelegramRoleGameContext): Promise<boolean> {
  if (
    context.runtime.chat.kind !== 'private' ||
    !context.runtime.actor.isApproved ||
    context.runtime.actor.isBlocked ||
    context.runtime.session.current?.flowKey !== roleGameMaterialUploadFlowKey
  ) {
    return false;
  }
  return handleRoleGameMaterialUploadMessage(context, normalizeBotLanguage(context.runtime.bot.language, 'ca'));
}

export async function handleTelegramRoleGameStartText(context: TelegramRoleGameContext): Promise<boolean> {
  const materialId = parseStartPayload(context.messageText, roleGameMaterialStartPayloadPrefix);
  if (materialId !== null && context.runtime.chat.kind === 'private') {
    return replyWithRoleGameMaterial(context, materialId, normalizeBotLanguage(context.runtime.bot.language, 'ca'));
  }

  const gameId = parseRoleGameStartPayload(context.messageText);
  if (gameId === null || context.runtime.chat.kind !== 'private') {
    return false;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const game = await findVisibleRoleGameDetail(context, gameId);
  if (!game) {
    await context.reply(createTelegramI18n(language).roleGames.notFound, buildRoleGameHomeKeyboard(language));
    return true;
  }

  await replyWithRoleGameDetail(context, game, language);
  return true;
}

export async function handleTelegramRoleGameCallback(context: TelegramRoleGameContext): Promise<boolean> {
  const callbackData = context.callbackData;
  if (!callbackData || context.runtime.chat.kind !== 'private' || context.runtime.actor.isBlocked) {
    return false;
  }
  const isExternalSeatRequest = callbackData.startsWith(roleGameCallbackPrefixes.requestSeat);
  if (!context.runtime.actor.isApproved && !isExternalSeatRequest) {
    return false;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const materialCallback = parseMaterialCallback(callbackData);
  if (materialCallback) {
    return handleRoleGameMaterialCallback(context, {
      language,
      materialId: materialCallback.materialId,
      deliveryMode: materialCallback.deliveryMode,
    });
  }

  if (callbackData.startsWith(roleGameCallbackPrefixes.edit)) {
    const gameId = parseCallbackEntityId(callbackData, roleGameCallbackPrefixes.edit);
    if (gameId === null) {
      await context.reply(createTelegramI18n(language).roleGames.notFound, buildRoleGameHomeKeyboard(language));
      return true;
    }
    return replyWithRoleGameConfiguration(context, { language, gameId });
  }

  if (callbackData.startsWith(roleGameCallbackPrefixes.invite)) {
    const gameId = parseCallbackEntityId(callbackData, roleGameCallbackPrefixes.invite);
    if (gameId === null) {
      await context.reply(createTelegramI18n(language).roleGames.notFound, buildRoleGameHomeKeyboard(language));
      return true;
    }
    return replyWithRoleGameInvitation(context, { language, gameId });
  }

  if (callbackData.startsWith(roleGameCallbackPrefixes.materials)) {
    const pageRequest = parseMaterialsCallback(callbackData);
    if (!pageRequest) {
      await context.reply(createTelegramI18n(language).roleGames.notFound, buildRoleGameHomeKeyboard(language));
      return true;
    }
    return replyWithRoleGameMaterials(context, {
      language,
      gameId: pageRequest.gameId,
      page: pageRequest.page,
    });
  }

  if (callbackData.startsWith(roleGameCallbackPrefixes.materialUpload)) {
    const gameId = parseCallbackEntityId(callbackData, roleGameCallbackPrefixes.materialUpload);
    if (gameId === null) {
      await context.reply(createTelegramI18n(language).roleGames.notFound, buildRoleGameHomeKeyboard(language));
      return true;
    }
    return startRoleGameMaterialUpload(context, { language, gameId });
  }

  if (callbackData.startsWith(roleGameCallbackPrefixes.detail)) {
    const gameId = parseCallbackEntityId(callbackData, roleGameCallbackPrefixes.detail);
    if (gameId === null) {
      await context.reply(createTelegramI18n(language).roleGames.notFound, buildRoleGameHomeKeyboard(language));
      return true;
    }
    const game = await findVisibleRoleGameDetail(context, gameId);
    if (!game) {
      await context.reply(createTelegramI18n(language).roleGames.notFound, buildRoleGameHomeKeyboard(language));
      return true;
    }
    await replyWithRoleGameDetail(context, game, language);
    return true;
  }

  if (callbackData.startsWith(roleGameCallbackPrefixes.requestSeat)) {
    const gameId = parseCallbackEntityId(callbackData, roleGameCallbackPrefixes.requestSeat);
    if (gameId === null) {
      await context.reply(createTelegramI18n(language).roleGames.notFound, buildRoleGameHomeKeyboard(language));
      return true;
    }
    return requestRoleGameSeatAndReply(context, { language, gameId });
  }

  if (callbackData.startsWith(roleGameCallbackPrefixes.scheduleSession)) {
    const gameId = parseCallbackEntityId(callbackData, roleGameCallbackPrefixes.scheduleSession);
    if (gameId === null) {
      await context.reply(createTelegramI18n(language).roleGames.notFound, buildRoleGameHomeKeyboard(language));
      return true;
    }
    return startRoleGameManualSession(context, { language, gameId });
  }

  if (callbackData.startsWith(roleGameCallbackPrefixes.configureRecurrence)) {
    const gameId = parseCallbackEntityId(callbackData, roleGameCallbackPrefixes.configureRecurrence);
    if (gameId === null) {
      await context.reply(createTelegramI18n(language).roleGames.notFound, buildRoleGameHomeKeyboard(language));
      return true;
    }
    return startRoleGameRecurrenceConfiguration(context, { language, gameId });
  }

  if (
    callbackData.startsWith(roleGameCallbackPrefixes.acceptRequest) ||
    callbackData.startsWith(roleGameCallbackPrefixes.rejectRequest)
  ) {
    const accepting = callbackData.startsWith(roleGameCallbackPrefixes.acceptRequest);
    const prefix = accepting ? roleGameCallbackPrefixes.acceptRequest : roleGameCallbackPrefixes.rejectRequest;
    const memberId = parseCallbackEntityId(callbackData, prefix);
    if (memberId === null) {
      await context.reply(createTelegramI18n(language).roleGames.notFound, buildRoleGameHomeKeyboard(language));
      return true;
    }
    return handleRoleGameRequestDecision(context, {
      language,
      memberId,
      status: accepting ? 'confirmed' : 'rejected',
    });
  }

  if (callbackData.startsWith(roleGameCallbackPrefixes.listMine)) {
    return replyWithRoleGameList(context, {
      kind: 'mine',
      page: parseCallbackEntityId(callbackData, roleGameCallbackPrefixes.listMine) ?? 1,
      language,
    });
  }

  if (callbackData.startsWith(roleGameCallbackPrefixes.listVisible)) {
    return replyWithRoleGameList(context, {
      kind: 'visible',
      page: parseCallbackEntityId(callbackData, roleGameCallbackPrefixes.listVisible) ?? 1,
      language,
    });
  }

  return false;
}

async function handleRoleGameCreateStep(
  context: TelegramRoleGameContext,
  text: string,
  language: BotLanguage,
): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== roleGameCreateFlowKey) {
    return false;
  }
  const texts = createTelegramI18n(language).roleGames;
  const draft = { ...(session.data as RoleGameCreateDraft) };
  const step = session.stepKey as RoleGameCreateStep;

  try {
    if (step === 'type') {
      draft.type = parseCreateOption(text, {
        campaign: texts.optionCampaign,
        one_shot: texts.optionOneShot,
      });
      return advanceRoleGameCreate(context, language, 'title', draft, texts.promptTitle);
    }
    if (step === 'title') {
      draft.title = text;
      return advanceRoleGameCreate(context, language, 'system', draft, texts.promptSystem);
    }
    if (step === 'system') {
      draft.system = text;
      return advanceRoleGameCreate(context, language, 'description', draft, texts.promptDescription);
    }
    if (step === 'description') {
      draft.description = text;
      return advanceRoleGameCreate(context, language, 'capacity', draft, texts.promptCapacity);
    }
    if (step === 'capacity') {
      const capacity = Number(text);
      if (!Number.isInteger(capacity) || capacity < 1 || capacity > 50) {
        throw new Error('invalid capacity');
      }
      draft.capacity = capacity;
      return advanceRoleGameCreate(context, language, 'visibility', draft, texts.promptVisibility, [[
        { text: texts.optionPrivate, semanticRole: 'primary' },
        { text: texts.optionMembers, semanticRole: 'primary' },
        { text: texts.optionPublic, semanticRole: 'primary' },
      ]]);
    }
    if (step === 'visibility') {
      draft.visibility = parseCreateOption(text, {
        private: texts.optionPrivate,
        members: texts.optionMembers,
        public: texts.optionPublic,
      });
      draft.publicJoinPolicy = draft.visibility === 'public' ? 'members_only' : 'members_only';
      return advanceRoleGameCreate(context, language, 'entry-mode', draft, texts.promptEntryMode, [[
        { text: texts.optionInviteOnly, semanticRole: 'primary' },
        { text: texts.optionRequest, semanticRole: 'primary' },
      ]]);
    }
    if (step === 'entry-mode') {
      draft.entryMode = parseCreateOption(text, {
        invite_only: texts.optionInviteOnly,
        request: texts.optionRequest,
      });
      return advanceRoleGameCreate(context, language, 'acceptance-mode', draft, texts.promptAcceptanceMode, [[
        { text: texts.optionManualReview, semanticRole: 'primary' },
        { text: texts.optionAutoUntilFull, semanticRole: 'primary' },
      ]]);
    }
    if (step === 'acceptance-mode') {
      draft.acceptanceMode = parseCreateOption(text, {
        manual_review: texts.optionManualReview,
        auto_until_full: texts.optionAutoUntilFull,
      });
      const schedulingOptions = draft.type === 'campaign'
        ? [
          { text: texts.optionManualScheduling, semanticRole: 'primary' as const },
          { text: texts.optionRecurringScheduling, semanticRole: 'primary' as const },
        ]
        : [{ text: texts.optionManualScheduling, semanticRole: 'primary' as const }];
      return advanceRoleGameCreate(context, language, 'scheduling-mode', draft, texts.promptSchedulingMode, [schedulingOptions]);
    }
    if (step === 'scheduling-mode') {
      draft.schedulingMode = parseCreateOption(text, {
        manual: texts.optionManualScheduling,
        recurring: texts.optionRecurringScheduling,
      });
      if (draft.schedulingMode === 'recurring') {
        return advanceRoleGameCreate(context, language, 'recurrence-interval', draft, texts.promptRecurrenceIntervalWeeks);
      }
      if (draft.type === 'one_shot') {
        return advanceRoleGameCreate(context, language, 'initial-session-date', draft, texts.promptInitialSessionDate);
      }
      await context.runtime.session.advance({ stepKey: 'confirm', data: draft });
      await context.reply(`${texts.promptConfirmCreate}\n\n${formatRoleGameCreateSummary(draft, language)}`, {
        ...buildRoleGameCreateConfirmationKeyboard(language),
        parseMode: 'HTML',
      });
      return true;
    }
    if (step === 'recurrence-interval') {
      draft.recurrenceRule = {
        intervalWeeks: parseBoundedInteger(text, 1, 8),
        weekday: 0,
        time: '18:00',
      };
      return advanceRoleGameCreate(context, language, 'recurrence-weekday', draft, texts.promptRecurrenceWeekday);
    }
    if (step === 'recurrence-weekday') {
      if (!draft.recurrenceRule) {
        throw new Error('missing recurrence rule');
      }
      draft.recurrenceRule = {
        ...draft.recurrenceRule,
        weekday: parseWeekday(text),
      };
      return advanceRoleGameCreate(context, language, 'recurrence-time', draft, texts.promptRecurrenceTime);
    }
    if (step === 'recurrence-time') {
      if (!draft.recurrenceRule) {
        throw new Error('missing recurrence rule');
      }
      draft.recurrenceRule = {
        ...draft.recurrenceRule,
        time: parseTimeValue(text),
      };
      return advanceRoleGameCreate(context, language, 'recurrence-window', draft, texts.promptRecurrenceWindowCount);
    }
    if (step === 'recurrence-window') {
      draft.recurrenceWindowCount = parseBoundedInteger(text, 1, 12);
      await context.runtime.session.advance({ stepKey: 'confirm', data: draft });
      await context.reply(`${texts.promptConfirmCreate}\n\n${formatRoleGameCreateSummary(draft, language)}`, {
        ...buildRoleGameCreateConfirmationKeyboard(language),
        parseMode: 'HTML',
      });
      return true;
    }
    if (step === 'initial-session-date') {
      const date = parseDate(text);
      if (date instanceof Error) {
        throw date;
      }
      draft.initialSessionDate = date;
      return advanceRoleGameCreate(context, language, 'initial-session-time', draft, texts.promptInitialSessionTime);
    }
    if (step === 'initial-session-time') {
      const time = parseTime(text);
      if (time instanceof Error) {
        throw time;
      }
      draft.initialSessionTime = time;
      await context.runtime.session.advance({ stepKey: 'confirm', data: draft });
      await context.reply(`${texts.promptConfirmCreate}\n\n${formatRoleGameCreateSummary(draft, language)}`, {
        ...buildRoleGameCreateConfirmationKeyboard(language),
        parseMode: 'HTML',
      });
      return true;
    }
    if (step === 'confirm' && text === texts.confirmCreate) {
      const repository = resolveRepository(context);
      const game = await createRoleGame({
        repository,
        type: requireDraftValue(draft.type),
        title: requireDraftValue(draft.title),
        system: requireDraftValue(draft.system),
        description: draft.description ?? null,
        visibility: requireDraftValue(draft.visibility),
        publicJoinPolicy: draft.publicJoinPolicy ?? 'members_only',
        entryMode: requireDraftValue(draft.entryMode),
        acceptanceMode: requireDraftValue(draft.acceptanceMode),
        capacity: requireDraftValue(draft.capacity),
        primaryGmTelegramUserId: context.runtime.actor.telegramUserId,
        createdByTelegramUserId: context.runtime.actor.telegramUserId,
        defaultDurationMinutes: draft.defaultDurationMinutes ?? 180,
        defaultTableId: draft.defaultTableId ?? null,
        defaultAttendanceMode: draft.defaultAttendanceMode ?? 'closed',
        defaultIsPublicScheduleEvent: draft.defaultIsPublicScheduleEvent ?? false,
        autoAddConfirmedPlayers: draft.autoAddConfirmedPlayers ?? true,
        allowPlayerManualScheduling: draft.allowPlayerManualScheduling ?? false,
        schedulingMode: draft.schedulingMode ?? 'manual',
        recurrenceRule: draft.recurrenceRule ?? null,
        recurrenceWindowCount: draft.recurrenceWindowCount ?? 0,
      });
      const initialSession = draft.type === 'one_shot' && draft.initialSessionDate && draft.initialSessionTime
        ? await createRoleGameScheduleSession({
          roleGameRepository: repository,
          scheduleRepository: resolveScheduleRepository(context),
          game,
          startsAt: buildStartsAt(draft.initialSessionDate, draft.initialSessionTime),
          actorTelegramUserId: context.runtime.actor.telegramUserId,
          source: 'one_shot_initial',
        })
        : null;
      await context.runtime.session.cancel();
      await context.reply([
        initialSession ? texts.createdWithSession : texts.created,
        initialSession ? formatRoleGameScheduleEventLink(initialSession.event.id, initialSession.event.startsAt) : null,
        formatRoleGameDetailMessage({ game, language }),
      ].filter((line): line is string => Boolean(line)).join('\n\n'), {
        ...buildRoleGameHomeKeyboard(language),
        parseMode: 'HTML',
      });
      return true;
    }
  } catch {
    await context.reply(texts.invalidCreateValue, buildRoleGameCreateStepKeyboard({ language }));
    return true;
  }

  await context.reply(texts.invalidCreateValue, buildRoleGameCreateStepKeyboard({ language }));
  return true;
}

async function handleRoleGameManualSessionStep(
  context: TelegramRoleGameContext,
  text: string,
  language: BotLanguage,
): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== roleGameManualSessionFlowKey) {
    return false;
  }
  const texts = createTelegramI18n(language).roleGames;
  const draft = { ...(session.data as RoleGameManualSessionDraft) };
  const step = session.stepKey as RoleGameManualSessionStep;

  try {
    if (step === 'date') {
      const date = parseDate(text);
      if (date instanceof Error) {
        throw date;
      }
      draft.date = date;
      await context.runtime.session.advance({ stepKey: 'time', data: draft });
      await context.reply(texts.promptManualSessionTime, buildRoleGameCreateStepKeyboard({ language }));
      return true;
    }
    if (step === 'time') {
      const time = parseTime(text);
      if (time instanceof Error) {
        throw time;
      }
      draft.time = time;
      const gameId = requireDraftValue(draft.gameId);
      const game = await resolveRepository(context).findGameById(gameId);
      if (!game) {
        await context.runtime.session.cancel();
        await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
        return true;
      }
      const actorMember = await resolveRepository(context).findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
      if (!canScheduleManualRoleGameSession(context, game, actorMember)) {
        await context.runtime.session.cancel();
        await context.reply(texts.permissionDenied, buildRoleGameHomeKeyboard(language));
        return true;
      }
      const sessionResult = await createManualRoleGameSession({
        roleGameRepository: resolveRepository(context),
        scheduleRepository: resolveScheduleRepository(context),
        game,
        startsAt: buildStartsAt(requireDraftValue(draft.date), requireDraftValue(draft.time)),
        actorTelegramUserId: context.runtime.actor.telegramUserId,
      });
      await context.runtime.session.cancel();
      await context.reply(`${texts.sessionScheduled}\n\n${formatRoleGameScheduleEventLink(sessionResult.event.id, sessionResult.event.startsAt)}`, {
        ...buildRoleGameHomeKeyboard(language),
        parseMode: 'HTML',
      });
      return true;
    }
  } catch {
    await context.reply(texts.invalidCreateValue, buildRoleGameCreateStepKeyboard({ language }));
    return true;
  }

  await context.reply(texts.invalidCreateValue, buildRoleGameCreateStepKeyboard({ language }));
  return true;
}

async function handleRoleGameRecurrenceConfigStep(
  context: TelegramRoleGameContext,
  text: string,
  language: BotLanguage,
): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== roleGameRecurrenceConfigFlowKey) {
    return false;
  }
  const texts = createTelegramI18n(language).roleGames;
  const draft = { ...(session.data as RoleGameRecurrenceConfigDraft) };
  const step = session.stepKey as RoleGameRecurrenceConfigStep;

  try {
    if (step === 'interval') {
      draft.intervalWeeks = parseBoundedInteger(text, 1, 8);
      await context.runtime.session.advance({ stepKey: 'weekday', data: draft });
      await context.reply(texts.promptRecurrenceWeekday, buildRoleGameCreateStepKeyboard({ language }));
      return true;
    }
    if (step === 'weekday') {
      draft.weekday = parseWeekday(text);
      await context.runtime.session.advance({ stepKey: 'time', data: draft });
      await context.reply(texts.promptRecurrenceTime, buildRoleGameCreateStepKeyboard({ language }));
      return true;
    }
    if (step === 'time') {
      draft.time = parseTimeValue(text);
      await context.runtime.session.advance({ stepKey: 'window', data: draft });
      await context.reply(texts.promptRecurrenceWindowCount, buildRoleGameCreateStepKeyboard({ language }));
      return true;
    }
    if (step === 'window') {
      draft.windowCount = parseBoundedInteger(text, 1, 12);
      await context.runtime.session.advance({ stepKey: 'confirm', data: draft });
      const confirmation = draft.existingFutureSessions && draft.existingFutureSessions > 0
        ? texts.promptConfirmRecurrenceWithExistingSessions
        : texts.promptConfirmCreate;
      await context.reply(`${confirmation}\n\n${formatRoleGameRecurrenceSummary(draft)}`, {
        ...buildRoleGameCreateConfirmationKeyboard(language),
        parseMode: 'HTML',
      });
      return true;
    }
    if (step === 'confirm' && text === texts.confirmCreate) {
      const gameId = requireDraftValue(draft.gameId);
      const repository = resolveRepository(context);
      const game = await repository.findGameById(gameId);
      if (!game) {
        await context.runtime.session.cancel();
        await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
        return true;
      }
      const actorMember = await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
      if (!canConfigureRoleGameRecurrence(context, game, actorMember)) {
        await context.runtime.session.cancel();
        await context.reply(texts.permissionDenied, buildRoleGameHomeKeyboard(language));
        return true;
      }
      const updated = await repository.updateGame({
        gameId,
        schedulingMode: 'recurring',
        recurrenceRule: {
          intervalWeeks: requireDraftValue(draft.intervalWeeks),
          weekday: requireDraftValue(draft.weekday),
          time: requireDraftValue(draft.time),
        },
        recurrenceWindowCount: requireDraftValue(draft.windowCount),
      });
      await context.runtime.session.cancel();
      await context.reply(`${texts.recurrenceSaved}\n\n${formatRoleGameDetailMessage({ game: updated, language })}`, {
        ...buildRoleGameHomeKeyboard(language),
        parseMode: 'HTML',
      });
      return true;
    }
  } catch {
    await context.reply(texts.invalidCreateValue, buildRoleGameCreateStepKeyboard({ language }));
    return true;
  }

  await context.reply(texts.invalidCreateValue, buildRoleGameCreateStepKeyboard({ language }));
  return true;
}

async function startRoleGameEdit(
  context: TelegramRoleGameContext,
  {
    language,
    gameId,
  }: {
    language: BotLanguage;
    gameId: number;
  },
): Promise<boolean> {
  const texts = createTelegramI18n(language).roleGames;
  const repository = resolveRepository(context);
  const game = await repository.findGameById(gameId);
  if (!game) {
    await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const actorMember = await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
  if (!canFullyManageCurrentRoleGame(context, game, actorMember)) {
    await context.reply(texts.permissionDenied, buildRoleGameHomeKeyboard(language));
    return true;
  }

  await context.runtime.session.start({
    flowKey: roleGameEditFlowKey,
    stepKey: 'field',
    data: { gameId },
  });
  await context.reply(texts.promptEditField, buildRoleGameEditFieldKeyboard(language));
  return true;
}

async function startRoleGameManualSession(
  context: TelegramRoleGameContext,
  { language, gameId }: { language: BotLanguage; gameId: number },
): Promise<boolean> {
  const texts = createTelegramI18n(language).roleGames;
  const game = await findVisibleRoleGameDetail(context, gameId);
  if (!game) {
    await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const actorMember = await resolveRepository(context).findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
  if (!canScheduleManualRoleGameSession(context, game, actorMember)) {
    await context.reply(texts.permissionDenied, buildRoleGameHomeKeyboard(language));
    return true;
  }
  await context.runtime.session.start({
    flowKey: roleGameManualSessionFlowKey,
    stepKey: 'date',
    data: { gameId },
  });
  await context.reply(texts.promptManualSessionDate, buildRoleGameCreateStepKeyboard({ language }));
  return true;
}

async function startRoleGameRecurrenceConfiguration(
  context: TelegramRoleGameContext,
  { language, gameId }: { language: BotLanguage; gameId: number },
): Promise<boolean> {
  const texts = createTelegramI18n(language).roleGames;
  const game = await findVisibleRoleGameDetail(context, gameId);
  if (!game) {
    await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const repository = resolveRepository(context);
  const actorMember = await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
  if (!canConfigureRoleGameRecurrence(context, game, actorMember)) {
    await context.reply(texts.permissionDenied, buildRoleGameHomeKeyboard(language));
    return true;
  }
  await context.runtime.session.start({
    flowKey: roleGameRecurrenceConfigFlowKey,
    stepKey: 'interval',
    data: {
      gameId,
      existingFutureSessions: await countFutureRoleGameSessions(context, game.id),
    },
  });
  await context.reply(texts.promptRecurrenceIntervalWeeks, buildRoleGameCreateStepKeyboard({ language }));
  return true;
}

async function handleRoleGameEditStep(
  context: TelegramRoleGameContext,
  text: string,
  language: BotLanguage,
): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== roleGameEditFlowKey) {
    return false;
  }
  const texts = createTelegramI18n(language).roleGames;
  const draft = { ...(session.data as RoleGameEditDraft) };
  const step = session.stepKey as RoleGameEditStep;

  try {
    if (step === 'field') {
      const field = parseRoleGameEditField(text, language);
      draft.field = field;
      await context.runtime.session.advance({ stepKey: 'value', data: draft });
      await context.reply(resolveRoleGameEditPrompt(field, language), buildRoleGameEditValueKeyboard(field, language));
      return true;
    }

    if (step === 'value') {
      const repository = resolveRepository(context);
      const gameId = requireDraftValue(draft.gameId);
      const field = requireDraftValue(draft.field);
      const game = await repository.findGameById(gameId);
      if (!game) {
        await context.runtime.session.cancel();
        await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
        return true;
      }
      const actorMember = await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
      if (!canFullyManageCurrentRoleGame(context, game, actorMember)) {
        await context.runtime.session.cancel();
        await context.reply(texts.permissionDenied, buildRoleGameHomeKeyboard(language));
        return true;
      }

      const updated = await repository.updateGame(buildRoleGameEditUpdateInput({
        gameId,
        field,
        text,
        language,
      }));
      await context.runtime.session.cancel();
      await context.reply(`${texts.gameUpdated}\n\n${formatRoleGameDetailMessage({ game: updated, language })}`, {
        ...buildRoleGameHomeKeyboard(language),
        parseMode: 'HTML',
      });
      return true;
    }
  } catch {
    await context.reply(texts.invalidCreateValue, isRoleGameEditFieldStep(context)
      ? buildRoleGameEditFieldKeyboard(language)
      : draft.field
        ? buildRoleGameEditValueKeyboard(draft.field, language)
        : buildRoleGameCreateStepKeyboard({ language }));
    return true;
  }

  await context.reply(texts.invalidCreateValue, buildRoleGameEditFieldKeyboard(language));
  return true;
}

async function advanceRoleGameCreate(
  context: TelegramRoleGameContext,
  language: BotLanguage,
  stepKey: RoleGameCreateStep,
  data: RoleGameCreateDraft,
  prompt: string,
  rows: TelegramReplyButton[][] = [],
): Promise<boolean> {
  await context.runtime.session.advance({ stepKey, data: { ...data } });
  await context.reply(prompt, buildRoleGameCreateStepKeyboard({ language, rows }));
  return true;
}

async function handleRoleGameRequestDecision(
  context: TelegramRoleGameContext,
  {
    language,
    memberId,
    status,
  }: {
    language: BotLanguage;
    memberId: number;
    status: 'confirmed' | 'rejected';
  },
): Promise<boolean> {
  const texts = createTelegramI18n(language).roleGames;
  const repository = resolveRepository(context);
  const member = await repository.findMemberById(memberId);
  if (!member) {
    await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const game = await repository.findGameById(member.roleGameId);
  if (!game) {
    await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const actorMember = await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
  const actor = {
    telegramUserId: context.runtime.actor.telegramUserId,
    isAdmin: context.runtime.actor.isAdmin,
    isApproved: context.runtime.actor.isApproved,
  };
  if (!canManageRoleGameOperationally(actor, game, actorMember)) {
    await context.reply(texts.permissionDenied, buildRoleGameHomeKeyboard(language));
    return true;
  }

  try {
    await resolveRoleGameSeatRequest({
      repository,
      memberId,
      status,
      actorTelegramUserId: context.runtime.actor.telegramUserId,
    });
  } catch {
    await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const updatedGame = await repository.findGameById(game.id);
  await context.reply(
    [
      status === 'confirmed' ? texts.requestAccepted : texts.requestRejected,
      updatedGame ? formatRoleGameDetailMessage({ game: updatedGame, language }) : null,
    ].filter((line): line is string => Boolean(line)).join('\n\n'),
    {
    ...buildRoleGameHomeKeyboard(language),
    parseMode: 'HTML',
    },
  );
  return true;
}

async function startRoleGameMaterialUpload(
  context: TelegramRoleGameContext,
  {
    language,
    gameId,
  }: {
    language: BotLanguage;
    gameId: number;
  },
): Promise<boolean> {
  const texts = createTelegramI18n(language).roleGames;
  const repository = resolveRepository(context);
  const game = await repository.findGameById(gameId);
  if (!game) {
    await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const actorMember = await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
  const actor = {
    telegramUserId: context.runtime.actor.telegramUserId,
    isAdmin: context.runtime.actor.isAdmin,
    isApproved: context.runtime.actor.isApproved,
  };
  if (!canManageRoleGameOperationally(actor, game, actorMember)) {
    await context.reply(texts.permissionDenied, buildRoleGameHomeKeyboard(language));
    return true;
  }

  await context.runtime.session.start({
    flowKey: roleGameMaterialUploadFlowKey,
    stepKey: 'media',
    data: { gameId: game.id },
  });
  await context.reply(texts.promptMaterialUpload, buildRoleGameCreateStepKeyboard({ language }));
  return true;
}

async function replyWithRoleGameInvitation(
  context: TelegramRoleGameContext,
  {
    language,
    gameId,
  }: {
    language: BotLanguage;
    gameId: number;
  },
): Promise<boolean> {
  const texts = createTelegramI18n(language).roleGames;
  const repository = resolveRepository(context);
  const game = await repository.findGameById(gameId);
  if (!game) {
    await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const actorMember = await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
  if (!canManageCurrentRoleGame(context, game, actorMember)) {
    await context.reply(texts.permissionDenied, buildRoleGameHomeKeyboard(language));
    return true;
  }

  const members = await repository.listMembers(game.id);
  const confirmedPlayers = members.filter((member) => member.role === 'player' && member.status === 'confirmed').length;
  const url = escapeHtml(buildTelegramStartUrl(`${roleGameStartPayloadPrefix}${game.id}`));
  await context.runtime.session.start({
    flowKey: 'role-game-detail',
    stepKey: 'dashboard',
    data: { gameId: game.id, view: 'dashboard' } satisfies RoleGameDetailSessionData,
  });
  await context.reply([
    `<b>${escapeHtml(texts.inviteLinkTitle)}</b>`,
    `<b>${escapeHtml(game.title)}</b>`,
    texts.currentPlayersSummary
      .replace('{confirmed}', String(confirmedPlayers))
      .replace('{capacity}', String(game.capacity)),
    texts.inviteLinkInstructions,
    `<a href="${url}">role_game_${game.id}</a>`,
  ].join('\n'), {
    ...await buildRoleGameDashboardOptions(context, game, language),
    parseMode: 'HTML',
  });
  return true;
}

async function replyWithRoleGameMaterials(
  context: TelegramRoleGameContext,
  {
    language,
    gameId,
    page,
  }: {
    language: BotLanguage;
    gameId: number;
    page: number;
  },
): Promise<boolean> {
  const texts = createTelegramI18n(language).roleGames;
  const repository = resolveRepository(context);
  const game = await repository.findGameById(gameId);
  if (!game) {
    await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const actorMember = await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
  if (!canManageCurrentRoleGame(context, game, actorMember)) {
    await context.reply(texts.permissionDenied, buildRoleGameHomeKeyboard(language));
    return true;
  }

  const materials = await repository.listMaterials(game.id);
  if (materials.length === 0) {
    await context.runtime.session.start({
      flowKey: 'role-game-detail',
      stepKey: 'materials',
      data: { gameId: game.id, view: 'materials', page: 1 } satisfies RoleGameDetailSessionData,
    });
    await context.reply(`${texts.noMaterials}\n\n${formatRoleGameMaterialUploadShortcut(game.id, language)}`, {
      ...buildRoleGameMaterialsKeyboard({ canUpload: true, language }),
      parseMode: 'HTML',
    });
    return true;
  }

  const totalPages = Math.max(1, Math.ceil(materials.length / roleGameMaterialsPageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const start = (clampedPage - 1) * roleGameMaterialsPageSize;
  const visibleMaterials = materials.slice(start, start + roleGameMaterialsPageSize);
  const lines = [
    `<b>${escapeHtml(texts.materialsHeader.replace('{title}', game.title))}</b>`,
    '',
    ...visibleMaterials.map((material) => formatRoleGameMaterialListRow(material, language)),
  ];
  if (totalPages > 1) {
    lines.push('');
    lines.push(escapeHtml(texts.materialListFooter
      .replace('{from}', String(start + 1))
      .replace('{to}', String(start + visibleMaterials.length))
      .replace('{total}', String(materials.length))
      .replace('{page}', String(clampedPage))
      .replace('{pages}', String(totalPages))));
  }

  await context.runtime.session.start({
    flowKey: 'role-game-detail',
    stepKey: 'materials',
    data: { gameId: game.id, view: 'materials', page: clampedPage } satisfies RoleGameDetailSessionData,
  });
  await context.reply(lines.join('\n'), {
    ...buildRoleGameMaterialsKeyboard({
      canUpload: true,
      hasPreviousPage: clampedPage > 1,
      hasNextPage: clampedPage < totalPages,
      language,
    }),
    parseMode: 'HTML',
  });
  return true;
}

async function handleRoleGameMaterialUploadMessage(
  context: TelegramRoleGameContext,
  language: BotLanguage,
): Promise<boolean> {
  const session = context.runtime.session.current;
  const media = context.messageMedia;
  if (!session || session.flowKey !== roleGameMaterialUploadFlowKey || session.stepKey !== 'media' || !media || !isSupportedRoleGameMaterialAttachment(media.attachmentKind)) {
    return false;
  }

  const texts = createTelegramI18n(language).roleGames;
  const roleGameRepository = resolveRepository(context);
  const gameId = Number(session.data.gameId);
  const game = Number.isInteger(gameId) ? await roleGameRepository.findGameById(gameId) : null;
  if (!game) {
    await context.runtime.session.cancel();
    await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const actorMember = await roleGameRepository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
  const actor = {
    telegramUserId: context.runtime.actor.telegramUserId,
    isAdmin: context.runtime.actor.isAdmin,
    isApproved: context.runtime.actor.isApproved,
  };
  if (!canManageRoleGameOperationally(actor, game, actorMember)) {
    await context.runtime.session.cancel();
    await context.reply(texts.permissionDenied, buildRoleGameHomeKeyboard(language));
    return true;
  }

  const storageRepository = resolveStorageRepository(context);
  const category = await findRoleGameHandoutCategory(storageRepository);
  if (!category) {
    await context.runtime.session.cancel();
    await context.reply(texts.materialStorageNotConfigured, buildRoleGameHomeKeyboard(language));
    return true;
  }
  if (!context.runtime.bot.copyMessage) {
    await context.runtime.session.cancel();
    await context.reply(texts.materialStorageNotConfigured, buildRoleGameHomeKeyboard(language));
    return true;
  }

  const progress = await startTelegramEditableProgress(context, texts.materialUploadCopying, {
    editFailedEvent: 'role-games.material-upload.progress-edit.failed',
  });
  const copied = await context.runtime.bot.copyMessage({
    fromChatId: context.runtime.chat.chatId,
    messageId: media.messageId,
    toChatId: category.storageChatId,
    messageThreadId: category.storageThreadId,
  });
  await progress.update(texts.materialUploadIndexing);

  const storageEntry = await createStorageEntry({
    repository: storageRepository,
    categoryId: category.id,
    createdByTelegramUserId: context.runtime.actor.telegramUserId,
    sourceKind: 'dm_copy',
    description: media.caption ?? media.originalFileName ?? null,
    tags: ['rol', `partida-${game.id}`],
    messages: [{
      storageChatId: category.storageChatId,
      storageMessageId: copied.messageId,
      storageThreadId: category.storageThreadId,
      telegramFileId: media.fileId ?? null,
      telegramFileUniqueId: media.fileUniqueId ?? null,
      attachmentKind: media.attachmentKind as StorageEntryMessageInput['attachmentKind'],
      caption: media.caption ?? null,
      originalFileName: media.originalFileName ?? null,
      mimeType: media.mimeType ?? null,
      fileSizeBytes: media.fileSizeBytes ?? null,
      mediaGroupId: media.mediaGroupId ?? null,
      sortOrder: 0,
    }],
  });
  const material = await createRoleGameMaterial({
    repository: roleGameRepository,
    roleGameId: game.id,
    internalStorageEntryId: storageEntry.entry.id,
    title: deriveRoleGameMaterialTitle(media),
    description: media.caption ?? null,
    visibility: 'gm_only',
    uploadedByTelegramUserId: context.runtime.actor.telegramUserId,
  });

  await context.runtime.session.cancel();
  await progress.complete([
    texts.materialSaved,
    formatRoleGameMaterialMessage(material),
  ].join('\n\n'), {
    ...buildRoleGameHomeKeyboard(language),
    parseMode: 'HTML',
  });
  return true;
}

async function handleRoleGameMaterialCallback(
  context: TelegramRoleGameContext,
  {
    language,
    materialId,
    deliveryMode,
  }: {
    language: BotLanguage;
    materialId: number;
    deliveryMode: RoleGameMaterialDeliveryMode;
  },
): Promise<boolean> {
  const texts = createTelegramI18n(language).roleGames;
  const repository = resolveRepository(context);
  const material = await repository.findMaterialById(materialId);
  if (!material) {
    await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const game = await repository.findGameById(material.roleGameId);
  if (!game) {
    await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const actorMember = await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
  const actor = {
    telegramUserId: context.runtime.actor.telegramUserId,
    isAdmin: context.runtime.actor.isAdmin,
    isApproved: context.runtime.actor.isApproved,
  };
  if (!canManageRoleGameOperationally(actor, game, actorMember)) {
    await context.reply(texts.permissionDenied, buildRoleGameHomeKeyboard(language));
    return true;
  }

  const players = (await repository.listMembers(game.id))
    .filter((member) => member.role === 'player' && member.status === 'confirmed');
  const storageDetail = deliveryMode === 'reveal_only'
    ? null
    : await resolveStorageRepository(context).getEntryDetail(material.internalStorageEntryId);
  let sent = 0;
  let failed = 0;

  if (deliveryMode !== 'reveal_only') {
    for (const player of players) {
      try {
        await context.runtime.bot.sendPrivateMessage(
          player.telegramUserId,
          formatRoleGameMaterialMessage(material),
          { parseMode: 'HTML' },
        );
        if (storageDetail) {
          await copyRoleGameMaterialToPrivateChat(context, storageDetail, player.telegramUserId);
        }
        sent += 1;
        await recordRoleGameMaterialDelivery({
          repository,
          roleGameMaterialId: material.id,
          recipientTelegramUserId: player.telegramUserId,
          sentByTelegramUserId: context.runtime.actor.telegramUserId,
          deliveryMode,
          status: 'sent',
          errorCode: null,
        });
      } catch (error) {
        failed += 1;
        await recordRoleGameMaterialDelivery({
          repository,
          roleGameMaterialId: material.id,
          recipientTelegramUserId: player.telegramUserId,
          sentByTelegramUserId: context.runtime.actor.telegramUserId,
          deliveryMode,
          status: 'failed',
          errorCode: error instanceof Error ? error.message : 'send_failed',
        });
      }
    }
  }

  if (deliveryMode === 'send_and_reveal' || deliveryMode === 'reveal_only') {
    await revealRoleGameMaterial({ repository, materialId: material.id });
  }

  if (deliveryMode === 'reveal_only') {
    await context.reply(texts.materialRevealed, buildRoleGameHomeKeyboard(language));
    return true;
  }

  await context.reply([
    texts.materialDeliverySummary
      .replace('{sent}', String(sent))
      .replace('{total}', String(players.length)),
    failed > 0 ? texts.materialDeliveryFailures.replace('{failed}', String(failed)) : null,
    deliveryMode === 'send_and_reveal' ? texts.materialDeliveryRevealed : null,
  ].filter((line): line is string => Boolean(line)).join('\n'), buildRoleGameHomeKeyboard(language));
  return true;
}

async function replyWithRoleGameListFromSession(
  context: TelegramRoleGameContext,
  pageDelta: number,
  language: BotLanguage,
): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== roleGameListFlowKey) {
    return false;
  }

  const kind = session.data.listKind === 'mine' ? 'mine' : 'visible';
  const page = Number(session.data.page);
  return replyWithRoleGameList(context, {
    kind,
    page: Number.isFinite(page) ? page + pageDelta : 1,
    language,
  });
}

async function replyWithRoleGameList(
  context: TelegramRoleGameContext,
  {
    kind,
    page,
    language,
  }: {
    kind: RoleGameListKind;
    page: number;
    language: BotLanguage;
  },
): Promise<boolean> {
  const texts = createTelegramI18n(language).roleGames;
  const games = await listRoleGames(context, kind);
  if (games.length === 0) {
    await context.runtime.session.start({
      flowKey: roleGameListFlowKey,
      stepKey: kind,
      data: { listKind: kind, page: 1, totalItems: 0 },
    });
    await context.reply(kind === 'mine' ? texts.noMyGames : texts.noVisibleGames, buildRoleGameListKeyboard({ language }));
    return true;
  }

  const clampedPage = clampRoleGameListPage(page, games.length);
  const totalPages = calculateRoleGameListTotalPages(games.length);
  const pageGames = sliceRoleGamePage(games, clampedPage);

  await context.runtime.session.start({
    flowKey: roleGameListFlowKey,
    stepKey: kind,
    data: { listKind: kind, page: clampedPage, totalItems: games.length },
  });
  await context.reply(formatRoleGameListMessage({
    games: pageGames,
    language,
    page: clampedPage,
    total: games.length,
    header: kind === 'mine' ? texts.myGamesHeader : texts.visibleGamesHeader,
  }), {
    ...buildRoleGameListKeyboard({
      language,
      hasPreviousPage: clampedPage > 1,
      hasNextPage: clampedPage < totalPages,
    }),
    parseMode: 'HTML',
  });
  return true;
}

async function listRoleGames(context: TelegramRoleGameContext, kind: RoleGameListKind): Promise<RoleGameRecord[]> {
  const repository = resolveRepository(context);
  if (kind === 'mine') {
    return repository.listGamesForUser(context.runtime.actor.telegramUserId);
  }
  return repository.listVisibleGames({
    actor: {
      telegramUserId: context.runtime.actor.telegramUserId,
      isAdmin: context.runtime.actor.isAdmin,
      isApproved: context.runtime.actor.isApproved,
    },
  });
}

async function findVisibleRoleGameDetail(context: TelegramRoleGameContext, gameId: number): Promise<RoleGameRecord | null> {
  if (context.runtime.actor.isBlocked) {
    return null;
  }
  const repository = resolveRepository(context);
  const game = await repository.findGameById(gameId);
  if (!game) {
    return null;
  }
  const membership = await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
  return canViewRoleGame(
    {
      telegramUserId: context.runtime.actor.telegramUserId,
      isAdmin: context.runtime.actor.isAdmin,
      isApproved: context.runtime.actor.isApproved,
    },
    game,
    membership,
  )
    ? game
    : null;
}

async function replyWithRoleGameMaterial(
  context: TelegramRoleGameContext,
  materialId: number,
  language: BotLanguage,
): Promise<boolean> {
  const texts = createTelegramI18n(language).roleGames;
  if (context.runtime.actor.isBlocked || !context.runtime.actor.isApproved) {
    await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const repository = resolveRepository(context);
  const material = await repository.findMaterialById(materialId);
  if (!material) {
    await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const game = await repository.findGameById(material.roleGameId);
  if (!game) {
    await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const membership = await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
  const actor = {
    telegramUserId: context.runtime.actor.telegramUserId,
    isAdmin: context.runtime.actor.isAdmin,
    isApproved: context.runtime.actor.isApproved,
  };
  if (!canViewRoleGameMaterial(actor, game, membership, material)) {
    await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const canManage = canManageRoleGameOperationally(actor, game, membership);
  await context.reply(formatRoleGameMaterialMessage(material), {
    ...buildRoleGameMaterialInlineKeyboard({ materialId: material.id, canManage, language }),
    parseMode: 'HTML',
  });
  return true;
}

async function replyWithRoleGameDetail(
  context: TelegramRoleGameContext,
  game: RoleGameRecord,
  language: BotLanguage,
  prefixMessage?: string,
): Promise<void> {
  await context.runtime.session.start({
    flowKey: 'role-game-detail',
    stepKey: 'dashboard',
    data: { gameId: game.id, view: 'dashboard' } satisfies RoleGameDetailSessionData,
  });
  await context.reply([
    prefixMessage,
    formatRoleGameDetailMessage({ game, language }),
  ].filter((message): message is string => Boolean(message)).join('\n\n'), {
    ...await buildRoleGameDashboardOptions(context, game, language),
    parseMode: 'HTML',
  });
}

async function buildRoleGameDashboardOptions(
  context: TelegramRoleGameContext,
  game: RoleGameRecord,
  language: BotLanguage,
) {
  const repository = resolveRepository(context);
  const actorMember = await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
  const members = await repository.listMembers(game.id);
  const actor = {
    telegramUserId: context.runtime.actor.telegramUserId,
    isAdmin: context.runtime.actor.isAdmin,
    isApproved: context.runtime.actor.isApproved,
  };
  const canManageParticipants = canManageRoleGameOperationally(actor, game, actorMember);
  const canRequestSeat =
    game.status === 'active' &&
    game.entryMode === 'request' &&
    !canManageParticipants &&
    !(actorMember && ['invited', 'requested', 'confirmed', 'waitlisted'].includes(actorMember.status));
  return buildRoleGameDashboardKeyboard({
    canManageParticipants,
    canSchedule: canScheduleManualRoleGameSession(context, game, actorMember),
    canManageMaterials: canManageParticipants,
    canConfigure: canConfigureRoleGameRecurrence(context, game, actorMember),
    canRequestSeat,
    pendingRequestCount: canManageParticipants
      ? members.filter((member) => member.role === 'player' && member.status === 'requested').length
      : 0,
    language,
  });
}

async function handleRoleGameDetailText(
  context: TelegramRoleGameContext,
  text: string,
  language: BotLanguage,
): Promise<boolean> {
  const session = context.runtime.session.current;
  const data = session?.data as Partial<RoleGameDetailSessionData> | undefined;
  if (!data || typeof data.gameId !== 'number' || !Number.isSafeInteger(data.gameId) || data.gameId <= 0 || !data.view) {
    return false;
  }
  const gameId = data.gameId;
  const texts = createTelegramI18n(language).roleGames;
  const game = await findVisibleRoleGameDetail(context, gameId);
  if (!game) {
    await context.runtime.session.cancel();
    await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
    return true;
  }
  if (text === texts.backToMyGames) {
    await context.runtime.session.cancel();
    return replyWithRoleGameList(context, { kind: 'mine', page: 1, language });
  }
  if (text === texts.backToGame) {
    await replyWithRoleGameDetail(context, game, language);
    return true;
  }
  if (text === texts.sessions) {
    return replyWithRoleGameSessions(context, { language, game });
  }
  if (await isRoleGameParticipantsButtonText(context, game, text, language)) {
    return replyWithRoleGameParticipantsOverview(context, { language, game });
  }
  if (text === texts.materials) {
    return replyWithRoleGameMaterials(context, { language, gameId: game.id, page: 1 });
  }
  if (text === texts.configuration) {
    return replyWithRoleGameConfiguration(context, { language, gameId: game.id });
  }
  if (text === texts.invite) {
    return replyWithRoleGameInvitation(context, { language, gameId: game.id });
  }
  if (text === texts.requestSeat) {
    return requestRoleGameSeatAndReply(context, { language, gameId: game.id });
  }
  if (data.view === 'materials' && text === texts.uploadMaterial) {
    return startRoleGameMaterialUpload(context, { language, gameId: game.id });
  }
  if (data.view === 'materials' && text === texts.previousPage) {
    return replyWithRoleGameMaterials(context, { language, gameId: game.id, page: Math.max(1, (data.page ?? 1) - 1) });
  }
  if (data.view === 'materials' && text === texts.nextPage) {
    return replyWithRoleGameMaterials(context, { language, gameId: game.id, page: (data.page ?? 1) + 1 });
  }
  if (data.view === 'sessions' && text === texts.scheduleNextSession) {
    return startRoleGameManualSession(context, { language, gameId: game.id });
  }
  if (data.view === 'configuration' && text === texts.editGame) {
    return startRoleGameEdit(context, { language, gameId: game.id });
  }
  if (data.view === 'configuration' && text === texts.configureRecurrence) {
    return startRoleGameRecurrenceConfiguration(context, { language, gameId: game.id });
  }
  return false;
}

async function isRoleGameParticipantsButtonText(
  context: TelegramRoleGameContext,
  game: RoleGameRecord,
  text: string,
  language: BotLanguage,
): Promise<boolean> {
  const texts = createTelegramI18n(language).roleGames;
  if (text === texts.participants) {
    return true;
  }
  const members = await resolveRepository(context).listMembers(game.id);
  const pendingRequestCount = members.filter((member) => member.role === 'player' && member.status === 'requested').length;
  return text === texts.participantsPending.replace('{count}', String(pendingRequestCount));
}

async function replyWithRoleGameParticipantsOverview(
  context: TelegramRoleGameContext,
  { language, game }: { language: BotLanguage; game: RoleGameRecord },
): Promise<boolean> {
  const texts = createTelegramI18n(language).roleGames;
  const repository = resolveRepository(context);
  const actorMember = await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
  if (!canManageCurrentRoleGame(context, game, actorMember)) {
    await context.reply(texts.permissionDenied, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const members = await repository.listMembers(game.id);
  const count = (role: RoleGameMemberRecord['role'], status: RoleGameMemberRecord['status']) =>
    members.filter((member) => member.role === role && member.status === status).length;
  await context.reply([
    `<b>${escapeHtml(texts.participantsHeader.replace('{title}', game.title))}</b>`,
    `${texts.participantRequests}: ${count('player', 'requested')}`,
    `${texts.participantWaitlist}: ${count('player', 'waitlisted')}`,
    `${texts.participantCoorganizers}: ${count('coorganizer', 'confirmed')}`,
    `${texts.participantConfirmedPlayers}: ${count('player', 'confirmed')}`,
    `${texts.participantInvited}: ${count('player', 'invited')}`,
  ].join('\n'), {
    ...buildRoleGameParticipantsOverviewKeyboard(language),
    parseMode: 'HTML',
  });
  return true;
}

async function replyWithRoleGameSessions(
  context: TelegramRoleGameContext,
  { language, game }: { language: BotLanguage; game: RoleGameRecord },
): Promise<boolean> {
  const repository = resolveRepository(context);
  const actorMember = await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
  const links = await repository.listSessionLinks(game.id);
  const events = (await Promise.all(links.map((link) => resolveScheduleRepository(context).findEventById(link.scheduleEventId))))
    .filter((event): event is NonNullable<typeof event> => event !== null)
    .filter((event) => event.lifecycleStatus !== 'cancelled')
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  const texts = createTelegramI18n(language).roleGames;
  await context.runtime.session.start({
    flowKey: 'role-game-detail',
    stepKey: 'sessions',
    data: { gameId: game.id, view: 'sessions' } satisfies RoleGameDetailSessionData,
  });
  await context.reply([
    `<b>${escapeHtml(texts.sessionsHeader.replace('{title}', game.title))}</b>`,
    events.length > 0
      ? events.map((event) => `- ${formatRoleGameScheduleEventLink(event.id, event.startsAt)}`).join('\n')
      : texts.noSessions,
  ].join('\n\n'), {
    ...buildRoleGameSessionsKeyboard({
      canSchedule: canScheduleManualRoleGameSession(context, game, actorMember),
      language,
    }),
    parseMode: 'HTML',
  });
  return true;
}

async function replyWithRoleGameConfiguration(
  context: TelegramRoleGameContext,
  { language, gameId }: { language: BotLanguage; gameId: number },
): Promise<boolean> {
  const texts = createTelegramI18n(language).roleGames;
  const game = await findVisibleRoleGameDetail(context, gameId);
  if (!game) {
    await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const actorMember = await resolveRepository(context).findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
  const canEdit = canFullyManageCurrentRoleGame(context, game, actorMember);
  const canConfigureRecurrence = canConfigureRoleGameRecurrence(context, game, actorMember);
  if (!canEdit && !canConfigureRecurrence) {
    await context.reply(texts.permissionDenied, buildRoleGameHomeKeyboard(language));
    return true;
  }
  await context.runtime.session.start({
    flowKey: 'role-game-detail',
    stepKey: 'configuration',
    data: { gameId: game.id, view: 'configuration' } satisfies RoleGameDetailSessionData,
  });
  await context.reply(`<b>${escapeHtml(texts.configuration)}</b>`, {
    ...buildRoleGameConfigurationKeyboard({ canEdit, canConfigureRecurrence, language }),
    parseMode: 'HTML',
  });
  return true;
}

async function requestRoleGameSeatAndReply(
  context: TelegramRoleGameContext,
  { language, gameId }: { language: BotLanguage; gameId: number },
): Promise<boolean> {
  const member = await requestRoleGameSeat({
    repository: resolveRepository(context),
    gameId,
    telegramUserId: context.runtime.actor.telegramUserId,
    actor: {
      telegramUserId: context.runtime.actor.telegramUserId,
      isAdmin: context.runtime.actor.isAdmin,
      isApproved: context.runtime.actor.isApproved,
    },
  });
  const game = await findVisibleRoleGameDetail(context, gameId);
  const message = member.status === 'confirmed'
    ? createTelegramI18n(language).roleGames.seatConfirmed
    : createTelegramI18n(language).roleGames.seatRequested;
  if (game) {
    await replyWithRoleGameDetail(context, game, language, message);
    return true;
  }
  await context.reply(message, buildRoleGameHomeKeyboard(language));
  return true;
}

function formatRoleGameMaterialMessage(material: RoleGameMaterialRecord): string {
  const url = escapeHtml(buildTelegramStartUrl(`${roleGameMaterialStartPayloadPrefix}${material.id}`));
  return [
    `<b>${escapeHtml(material.title)}</b>`,
    material.description ? escapeHtml(material.description) : null,
    `<a href="${url}">role_material_${material.id}</a>`,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function formatRoleGameMaterialListRow(material: RoleGameMaterialRecord, language: BotLanguage): string {
  const url = escapeHtml(buildTelegramStartUrl(`${roleGameMaterialStartPayloadPrefix}${material.id}`));
  const texts = createTelegramI18n(language).roleGames;
  const state = material.visibility === 'players' ? texts.materialVisibilityPlayers : texts.materialVisibilityGmOnly;
  return `- <a href="${url}">${escapeHtml(material.title)}</a> · ${escapeHtml(state)}`;
}

function formatRoleGameMaterialUploadShortcut(gameId: number, language: BotLanguage): string {
  const texts = createTelegramI18n(language).roleGames;
  return `<a href="${escapeHtml(buildTelegramStartUrl(`${roleGameStartPayloadPrefix}${gameId}`))}">${escapeHtml(texts.detailsLink)}</a>`;
}

function sliceRoleGamePage(games: RoleGameRecord[], page: number): RoleGameRecord[] {
  const start = (page - 1) * roleGameListPageSize;
  return games.slice(start, start + roleGameListPageSize);
}

function matchesRoleGameEntry(text: string, language: BotLanguage): boolean {
  if (text === '/rol' || text === '/role_games') {
    return true;
  }
  const texts = createTelegramI18n(language).roleGames;
  return text === texts.menuTitle || text === createTelegramI18n(language).actionMenu.roleGames;
}

function parseRoleGameStartPayload(text: string | undefined): number | null {
  return parseStartPayload(text, roleGameStartPayloadPrefix);
}

function parseStartPayload(text: string | undefined, prefix: string): number | null {
  const normalized = text?.trim();
  if (!normalized) {
    return null;
  }
  const payload = normalized.startsWith('/start ') ? normalized.slice('/start '.length).trim() : normalized;
  if (!payload.startsWith(prefix)) {
    return null;
  }
  return parsePositiveInteger(payload.slice(prefix.length));
}

function parseMaterialCallback(callbackData: string): { deliveryMode: RoleGameMaterialDeliveryMode; materialId: number } | null {
  if (!callbackData.startsWith(roleGameCallbackPrefixes.material)) {
    return null;
  }
  const payload = callbackData.slice(roleGameCallbackPrefixes.material.length);
  const [deliveryMode, rawMaterialId] = payload.split(':');
  if (deliveryMode !== 'send_only' && deliveryMode !== 'send_and_reveal' && deliveryMode !== 'reveal_only') {
    return null;
  }
  const materialId = parsePositiveInteger(rawMaterialId ?? '');
  return materialId === null ? null : { deliveryMode, materialId };
}

function parseMaterialsCallback(callbackData: string): { gameId: number; page: number } | null {
  if (!callbackData.startsWith(roleGameCallbackPrefixes.materials)) {
    return null;
  }
  const payload = callbackData.slice(roleGameCallbackPrefixes.materials.length);
  const [rawGameId, rawPage] = payload.split(':');
  const gameId = parsePositiveInteger(rawGameId ?? '');
  if (gameId === null) {
    return null;
  }
  return { gameId, page: parsePositiveInteger(rawPage ?? '') ?? 1 };
}

function parseCallbackEntityId(callbackData: string, prefix: string): number | null {
  return parsePositiveInteger(callbackData.slice(prefix.length));
}

function parsePositiveInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function isRoleGameListSession(context: TelegramRoleGameContext): boolean {
  return context.runtime.session.current?.flowKey === roleGameListFlowKey;
}

function isRoleGameCreateSession(context: TelegramRoleGameContext): boolean {
  return context.runtime.session.current?.flowKey === roleGameCreateFlowKey;
}

function isRoleGameManualSessionSession(context: TelegramRoleGameContext): boolean {
  return context.runtime.session.current?.flowKey === roleGameManualSessionFlowKey;
}

function isRoleGameRecurrenceConfigSession(context: TelegramRoleGameContext): boolean {
  return context.runtime.session.current?.flowKey === roleGameRecurrenceConfigFlowKey;
}

function isRoleGameEditSession(context: TelegramRoleGameContext): boolean {
  return context.runtime.session.current?.flowKey === roleGameEditFlowKey;
}

function isRoleGameDetailSession(context: TelegramRoleGameContext): boolean {
  return context.runtime.session.current?.flowKey === 'role-game-detail';
}

function isRoleGameEditFieldStep(context: TelegramRoleGameContext): boolean {
  const session = context.runtime.session.current;
  return session?.flowKey === roleGameEditFlowKey && session.stepKey === 'field';
}

function canManageCurrentRoleGame(
  context: TelegramRoleGameContext,
  game: RoleGameRecord,
  actorMember: RoleGameMemberRecord | null,
): boolean {
  return canManageRoleGameOperationally(
    {
      telegramUserId: context.runtime.actor.telegramUserId,
      isAdmin: context.runtime.actor.isAdmin,
      isApproved: context.runtime.actor.isApproved,
    },
    game,
    actorMember,
  );
}

function canFullyManageCurrentRoleGame(
  context: TelegramRoleGameContext,
  game: RoleGameRecord,
  actorMember: RoleGameMemberRecord | null,
): boolean {
  return canManageRoleGame(
    {
      telegramUserId: context.runtime.actor.telegramUserId,
      isAdmin: context.runtime.actor.isAdmin,
      isApproved: context.runtime.actor.isApproved,
    },
    game,
    actorMember,
  );
}

function canScheduleManualRoleGameSession(
  context: TelegramRoleGameContext,
  game: RoleGameRecord,
  actorMember: RoleGameMemberRecord | null,
): boolean {
  if (game.type !== 'campaign' || game.status !== 'active' || game.schedulingMode !== 'manual') {
    return false;
  }
  const actor = {
    telegramUserId: context.runtime.actor.telegramUserId,
    isAdmin: context.runtime.actor.isAdmin,
    isApproved: context.runtime.actor.isApproved,
  };
  if (canManageRoleGameOperationally(actor, game, actorMember)) {
    return true;
  }
  return game.allowPlayerManualScheduling &&
    actorMember?.role === 'player' &&
    actorMember.status === 'confirmed';
}

function canConfigureRoleGameRecurrence(
  context: TelegramRoleGameContext,
  game: RoleGameRecord,
  actorMember: RoleGameMemberRecord | null,
): boolean {
  if (game.type !== 'campaign' || game.status !== 'active') {
    return false;
  }
  return canManageRoleGameOperationally(
    {
      telegramUserId: context.runtime.actor.telegramUserId,
      isAdmin: context.runtime.actor.isAdmin,
      isApproved: context.runtime.actor.isApproved,
    },
    game,
    actorMember,
  );
}

async function countFutureRoleGameSessions(context: TelegramRoleGameContext, gameId: number): Promise<number> {
  const now = new Date().toISOString();
  const links = await resolveRepository(context).listSessionLinks(gameId);
  const events = await Promise.all(links.map((link) => resolveScheduleRepository(context).findEventById(link.scheduleEventId)));
  return events.filter((event) => event && event.lifecycleStatus !== 'cancelled' && event.startsAt > now).length;
}

function parseCreateOption<T extends string>(text: string, options: Record<T, string>): T {
  const normalizedText = normalizeOptionText(text);
  const found = Object.entries(options).find(([, label]) => normalizeOptionText(label as string) === normalizedText);
  if (!found) {
    throw new Error('invalid option');
  }
  return found[0] as T;
}

function parseRoleGameEditField(text: string, language: BotLanguage): RoleGameEditField {
  const texts = createTelegramI18n(language).roleGames;
  return parseCreateOption(text, {
    title: texts.editTitleOption,
    system: texts.editSystemOption,
    description: texts.editDescriptionOption,
    capacity: texts.editCapacityOption,
    visibility: texts.editVisibilityOption,
    entryMode: texts.editEntryModeOption,
    acceptanceMode: texts.editAcceptanceModeOption,
    allowPlayerManualScheduling: texts.editPlayerSchedulingOption,
    defaultIsPublicScheduleEvent: texts.editPublicScheduleOption,
    status: texts.editStatusOption,
  });
}

function resolveRoleGameEditPrompt(field: RoleGameEditField, language: BotLanguage): string {
  const texts = createTelegramI18n(language).roleGames;
  const prompts: Record<RoleGameEditField, string> = {
    title: texts.promptEditTitle,
    system: texts.promptEditSystem,
    description: texts.promptEditDescription,
    capacity: texts.promptEditCapacity,
    visibility: texts.promptEditVisibility,
    entryMode: texts.promptEditEntryMode,
    acceptanceMode: texts.promptEditAcceptanceMode,
    allowPlayerManualScheduling: texts.promptEditPlayerScheduling,
    defaultIsPublicScheduleEvent: texts.promptEditPublicSchedule,
    status: texts.promptEditStatus,
  };
  return prompts[field];
}

function buildRoleGameEditFieldKeyboard(language: BotLanguage) {
  const texts = createTelegramI18n(language).roleGames;
  return buildRoleGameCreateStepKeyboard({
    language,
    rows: [
      [
        { text: texts.editTitleOption, semanticRole: 'primary' },
        { text: texts.editSystemOption, semanticRole: 'primary' },
      ],
      [
        { text: texts.editDescriptionOption, semanticRole: 'primary' },
        { text: texts.editCapacityOption, semanticRole: 'primary' },
      ],
      [
        { text: texts.editVisibilityOption, semanticRole: 'primary' },
        { text: texts.editEntryModeOption, semanticRole: 'primary' },
      ],
      [
        { text: texts.editAcceptanceModeOption, semanticRole: 'primary' },
        { text: texts.editPlayerSchedulingOption, semanticRole: 'primary' },
      ],
      [
        { text: texts.editPublicScheduleOption, semanticRole: 'primary' },
        { text: texts.editStatusOption, semanticRole: 'primary' },
      ],
    ],
  });
}

function buildRoleGameEditValueKeyboard(field: RoleGameEditField, language: BotLanguage) {
  const texts = createTelegramI18n(language).roleGames;
  if (field === 'visibility') {
    return buildRoleGameCreateStepKeyboard({
      language,
      rows: [[
        { text: texts.optionPrivate, semanticRole: 'primary' },
        { text: texts.optionMembers, semanticRole: 'primary' },
        { text: texts.optionPublic, semanticRole: 'primary' },
      ]],
    });
  }
  if (field === 'entryMode') {
    return buildRoleGameCreateStepKeyboard({
      language,
      rows: [[
        { text: texts.optionInviteOnly, semanticRole: 'primary' },
        { text: texts.optionRequest, semanticRole: 'primary' },
      ]],
    });
  }
  if (field === 'acceptanceMode') {
    return buildRoleGameCreateStepKeyboard({
      language,
      rows: [[
        { text: texts.optionManualReview, semanticRole: 'primary' },
        { text: texts.optionAutoUntilFull, semanticRole: 'primary' },
      ]],
    });
  }
  if (field === 'allowPlayerManualScheduling' || field === 'defaultIsPublicScheduleEvent') {
    return buildRoleGameCreateStepKeyboard({
      language,
      rows: [[
        { text: texts.optionYes, semanticRole: 'success' },
        { text: texts.optionNo, semanticRole: 'danger' },
      ]],
    });
  }
  if (field === 'status') {
    return buildRoleGameCreateStepKeyboard({
      language,
      rows: [[
        { text: texts.optionStatusActive, semanticRole: 'success' },
        { text: texts.optionStatusPaused, semanticRole: 'primary' },
        { text: texts.optionStatusClosed, semanticRole: 'danger' },
      ]],
    });
  }
  return buildRoleGameCreateStepKeyboard({ language });
}

function buildRoleGameEditUpdateInput({
  gameId,
  field,
  text,
  language,
}: {
  gameId: number;
  field: RoleGameEditField;
  text: string;
  language: BotLanguage;
}): UpdateRoleGameInput {
  const texts = createTelegramI18n(language).roleGames;
  if (field === 'title') return { gameId, title: text.trim() };
  if (field === 'system') return { gameId, system: text.trim() };
  if (field === 'description') {
    const description = text.trim();
    return { gameId, description: description === '-' ? null : description };
  }
  if (field === 'capacity') return { gameId, capacity: parseBoundedInteger(text, 1, 50) };
  if (field === 'visibility') {
    return {
      gameId,
      visibility: parseCreateOption(text, {
        private: texts.optionPrivate,
        members: texts.optionMembers,
        public: texts.optionPublic,
      }),
    };
  }
  if (field === 'entryMode') {
    return {
      gameId,
      entryMode: parseCreateOption(text, {
        invite_only: texts.optionInviteOnly,
        request: texts.optionRequest,
      }),
    };
  }
  if (field === 'acceptanceMode') {
    return {
      gameId,
      acceptanceMode: parseCreateOption(text, {
        manual_review: texts.optionManualReview,
        auto_until_full: texts.optionAutoUntilFull,
      }),
    };
  }
  if (field === 'allowPlayerManualScheduling') {
    return { gameId, allowPlayerManualScheduling: parseBooleanOption(text, language) };
  }
  if (field === 'defaultIsPublicScheduleEvent') {
    return { gameId, defaultIsPublicScheduleEvent: parseBooleanOption(text, language) };
  }
  const status = parseCreateOption(text, {
    active: texts.optionStatusActive,
    paused: texts.optionStatusPaused,
    closed: texts.optionStatusClosed,
  });
  return {
    gameId,
    status: status as RoleGameStatus,
    closedAt: status === 'closed' ? new Date().toISOString() : null,
  };
}

function parseBooleanOption(text: string, language: BotLanguage): boolean {
  const texts = createTelegramI18n(language).roleGames;
  return parseCreateOption(text, {
    yes: texts.optionYes,
    no: texts.optionNo,
  }) === 'yes';
}

function normalizeOptionText(value: string): string {
  return value.trim().toLocaleLowerCase('es');
}

function parseBoundedInteger(text: string, min: number, max: number): number {
  const value = Number(text.trim());
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error('invalid integer');
  }
  return value;
}

function parseWeekday(text: string): RoleGameRecurrenceRule['weekday'] {
  const normalized = normalizeOptionText(text);
  const weekdays: Record<string, RoleGameRecurrenceRule['weekday']> = {
    domingo: 0,
    diumenge: 0,
    sunday: 0,
    lunes: 1,
    dilluns: 1,
    monday: 1,
    martes: 2,
    dimarts: 2,
    tuesday: 2,
    miercoles: 3,
    miércoles: 3,
    dimecres: 3,
    wednesday: 3,
    jueves: 4,
    dijous: 4,
    thursday: 4,
    viernes: 5,
    divendres: 5,
    friday: 5,
    sabado: 6,
    sábado: 6,
    dissabte: 6,
    saturday: 6,
  };
  const weekday = weekdays[normalized];
  if (weekday === undefined) {
    throw new Error('invalid weekday');
  }
  return weekday;
}

function parseTimeValue(text: string): string {
  const parsed = parseTime(text);
  if (parsed instanceof Error) {
    throw parsed;
  }
  return parsed;
}

function requireDraftValue<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('missing draft value');
  }
  return value;
}

function formatRoleGameCreateSummary(draft: RoleGameCreateDraft, language: BotLanguage): string {
  const game: RoleGameRecord = {
    id: 0,
    type: draft.type ?? 'campaign',
    status: 'active',
    title: draft.title ?? '',
    system: draft.system ?? '',
    description: draft.description ?? null,
    visibility: draft.visibility ?? 'members',
    publicJoinPolicy: draft.publicJoinPolicy ?? 'members_only',
    entryMode: draft.entryMode ?? 'request',
    acceptanceMode: draft.acceptanceMode ?? 'manual_review',
    capacity: draft.capacity ?? 1,
    primaryGmTelegramUserId: 0,
    defaultDurationMinutes: draft.defaultDurationMinutes ?? 180,
    defaultTableId: draft.defaultTableId ?? null,
    defaultAttendanceMode: draft.defaultAttendanceMode ?? 'closed',
    defaultIsPublicScheduleEvent: draft.defaultIsPublicScheduleEvent ?? false,
    autoAddConfirmedPlayers: draft.autoAddConfirmedPlayers ?? true,
    allowPlayerManualScheduling: draft.allowPlayerManualScheduling ?? false,
    schedulingMode: draft.schedulingMode ?? 'manual',
    recurrenceRule: draft.recurrenceRule ?? null,
    recurrenceWindowCount: draft.recurrenceWindowCount ?? 0,
    createdByTelegramUserId: 0,
    createdAt: '',
    updatedAt: '',
    closedAt: null,
  };
  return formatRoleGameDetailMessage({ game, language });
}

function formatRoleGameRecurrenceSummary(draft: RoleGameRecurrenceConfigDraft): string {
  return [
    `Cada ${escapeHtml(String(requireDraftValue(draft.intervalWeeks)))} semana(s).`,
    `Día ${escapeHtml(String(requireDraftValue(draft.weekday)))} a las ${escapeHtml(requireDraftValue(draft.time))}.`,
    `Ventana: ${escapeHtml(String(requireDraftValue(draft.windowCount)))} sesiones futuras.`,
  ].join('\n');
}

async function findRoleGameHandoutCategory(repository: StorageCategoryRepository): Promise<StorageCategoryRecord | null> {
  const categories = repository.listAllCategoriesForInternalUse
    ? await repository.listAllCategoriesForInternalUse()
    : await repository.listCategories();
  return categories.find((category) => (
    category.lifecycleStatus === 'active' &&
    category.categoryPurpose === internalRoleGameHandoutPurpose
  )) ?? null;
}

async function copyRoleGameMaterialToPrivateChat(
  context: TelegramRoleGameContext,
  detail: StorageEntryDetailRecord,
  telegramUserId: number,
): Promise<void> {
  if (!context.runtime.bot.copyMessage) {
    throw new Error('Telegram bot runtime does not support copyMessage');
  }
  for (const message of detail.messages) {
    await context.runtime.bot.copyMessage({
      fromChatId: message.storageChatId,
      messageId: message.storageMessageId,
      toChatId: telegramUserId,
    });
  }
}

function deriveRoleGameMaterialTitle(media: NonNullable<TelegramRoleGameContext['messageMedia']>): string {
  return (media.caption ?? media.originalFileName ?? 'Material de rol').trim().replace(/\s+/g, ' ');
}

function isSupportedRoleGameMaterialAttachment(attachmentKind: string): boolean {
  return attachmentKind === 'document' || attachmentKind === 'photo' || attachmentKind === 'video' || attachmentKind === 'audio';
}

function resolveRepository(context: TelegramRoleGameContext): RoleGameRepository {
  return context.roleGameRepository ?? createDatabaseRoleGameRepository({
    database: context.runtime.services.database.db,
  });
}

function resolveScheduleRepository(context: TelegramRoleGameContext): ScheduleRepository {
  return context.scheduleRepository ?? createDatabaseScheduleRepository({
    database: context.runtime.services.database.db as never,
  });
}

function resolveStorageRepository(context: TelegramRoleGameContext): StorageCategoryRepository {
  return context.storageRepository ?? createDatabaseStorageRepository({
    database: context.runtime.services.database.db,
  });
}

function formatRoleGameScheduleEventLink(eventId: number, startsAt: string): string {
  return `<a href="${escapeHtml(buildTelegramStartUrl(`schedule_event_${eventId}`))}">Agenda ${escapeHtml(formatTimestamp(startsAt))}</a>`;
}
