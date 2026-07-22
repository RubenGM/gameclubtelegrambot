import {
  canManageRoleGameOperationally,
  canManageRoleGame,
  canRequestRoleGameSeat,
  canViewRoleGame,
  canViewRoleGameMaterial,
  createRoleGame,
  createRoleGameMaterial,
  createRoleGameMaterialCategory,
  inviteRoleGamePlayer,
  manageRoleGameMember,
  recordRoleGameMaterialDelivery,
  requestRoleGameSeat,
  respondToRoleGameInvitation,
  revealRoleGameMaterial,
  type RoleGameAcceptanceMode,
  type RoleGameEntryMode,
  type RoleGameMaterialDeliveryMode,
  type RoleGameMaterialCategoryRecord,
  type RoleGameMaterialRecord,
  type RoleGameMemberManagementAction,
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
import {
  listManageableMembershipUsers,
  type MembershipAccessRepository,
  type MembershipUserRecord,
} from '../membership/access-flow.js';
import { createDatabaseMembershipAccessRepository } from '../membership/access-flow-store.js';
import { formatMembershipDisplayName } from '../membership/display-name.js';
import {
  computeUpcomingRoleGameOccurrences,
  createManualRoleGameSession,
  createRoleGameScheduleSession,
  limitRoleGameOccurrencesToFutureWeeks,
  planRecurringRoleGameSessions,
} from '../role-games/role-game-scheduler.js';
import type { ScheduleEventRecord, ScheduleRepository } from '../schedule/schedule-catalog.js';
import { createDatabaseScheduleRepository } from '../schedule/schedule-catalog-store.js';
import type { ClubTableRepository } from '../tables/table-catalog.js';
import type { VenueEventRepository } from '../venue-events/venue-event-catalog.js';
import type { NewsGroupRepository } from '../news/news-group-catalog.js';
import {
  createStorageCategory,
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
import { runAfterScheduleSaveSideEffects } from './schedule-flow-support.js';
import {
  escapeHtml,
  formatDurationMinutes,
  formatEventTimeRange,
  formatHtmlField,
  formatTimestamp,
} from './schedule-presentation.js';
import {
  buildRoleGameHomeKeyboard,
  buildRoleGameCreateConfirmationKeyboard,
  buildRoleGameCreateStepKeyboard,
  buildRoleGameConfigurationKeyboard,
  buildRoleGameDashboardKeyboard,
  buildRoleGameInvitationResponseKeyboard,
  buildRoleGameInviteSelectionKeyboard,
  buildRoleGameListKeyboard,
  buildRoleGameMaterialDetailKeyboard,
  buildRoleGameMaterialPlayerActionKeyboard,
  buildRoleGameMaterialPlayerSelectionKeyboard,
  buildRoleGameMaterialNameKeyboard,
  buildRoleGameMaterialUploadKeyboard,
  buildRoleGameParticipantActionConfirmationKeyboard,
  buildRoleGameMaterialsKeyboard,
  buildRoleGameParticipantDetailKeyboard,
  buildRoleGameParticipantsKeyboard,
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
import {
  buildRoleGameParticipantButtonMap,
  buildRoleGameParticipantPage,
  listRoleGameMemberActions,
  formatRoleGameParticipantDetail,
  formatRoleGameParticipantList,
  type RoleGameParticipantListItem,
  type RoleGameParticipantListKind,
} from './role-game-participants.js';
import {
  formatRoleGameMemberChangeNotification,
  roleGameMemberActionLabel,
  roleGameMemberManagementActions,
} from './i18n-role-games.js';
import type { TelegramReplyButton } from './runtime-boundary.js';
import type { RoleGameCharacterRepository } from '../role-games/role-game-character-catalog.js';
import { createDatabaseRoleGameCharacterRepository } from '../role-games/role-game-character-store.js';
import {
  handleTelegramRoleGameCharacterStartText,
  handleTelegramRoleGameCharacterMessage,
  handleTelegramRoleGameCharacterText,
  isRoleGameCharacterSession,
  openRoleGameCharacters,
} from './role-game-character-flow.js';
import {
  handleTelegramRoleGameNotionText,
  isRoleGameNotionSession,
  openRoleGameNotionBrowsePage,
  openRoleGameNotion,
  parseRoleGameNotionBrowseStartPayload,
} from './role-game-notion-flow.js';
import {
  createDatabaseAppMetadataSessionStorage,
  type AppMetadataSessionStorage,
} from './conversation-session-store.js';
import {
  createAppMetadataRoleGameAutoSchedulingStore,
  defaultRoleGameAutoSchedulingMaxFutureWeeks,
} from '../role-games/role-game-auto-scheduling-store.js';

const roleGameListFlowKey = 'role-games-list';
const roleGameCreateFlowKey = 'role-game-create';
const roleGameManualSessionFlowKey = 'role-game-manual-session';
const roleGameRecurrenceConfigFlowKey = 'role-game-recurrence-config';
const roleGameMaterialUploadFlowKey = 'role-game-material-upload';
const roleGameEditFlowKey = 'role-game-edit';
const roleGameInviteFlowKey = 'role-game-invite';
const roleGameStartPayloadPrefix = 'role_game_';
const roleGameParticipantStartPayloadPrefix = 'role_game_participant_';
const roleGameDirectInviteStartPayloadPrefix = 'role_game_invite_';
const roleGameMaterialStartPayloadPrefix = 'role_material_';
const roleGameMaterialCategoryStartPayloadPrefix = 'role_material_category_';
const roleGameMaterialsPageSize = 5;
const roleGameMaterialPlayersPageSize = 6;
const roleGameInvitePageSize = 15;
const storageDefaultChatMetadataKey = 'storage.default_chat';
const roleGameHandoutCategorySlug = 'role-handouts';
const roleGameHandoutCategoryName = 'Handouts de rol';

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
  | 'recurrence-date'
  | 'recurrence-time'
  | 'recurrence-window'
  | 'initial-session-date'
  | 'initial-session-time'
  | 'confirm';

type RoleGameManualSessionStep = 'date' | 'time' | 'confirm';
type RoleGameRecurrenceConfigStep = 'interval' | 'weekday' | 'date' | 'time' | 'window' | 'confirm';
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
  agendaPreviewStartsAt?: string[];
  agendaPreviewSignature?: string;
}

interface RoleGameManualSessionDraft {
  gameId?: number;
  date?: string;
  time?: string;
  agendaPreviewStartsAt?: string[];
  agendaPreviewSignature?: string;
  overwrittenScheduleEventId?: number;
}

interface RoleGameRecurrenceConfigDraft {
  gameId?: number;
  schedulingMode?: RoleGameSchedulingMode;
  intervalWeeks?: number;
  weekday?: RoleGameRecurrenceRule['weekday'];
  startsOn?: string;
  time?: string;
  windowCount?: number;
  existingFutureSessions?: number;
  agendaPreviewStartsAt?: string[];
  agendaPreviewSignature?: string;
}

interface RoleGameInviteSessionData {
  gameId: number;
  page: number;
  total: number;
}

interface RoleGameEditDraft {
  gameId?: number;
  field?: RoleGameEditField;
}

interface RoleGameDetailSessionData {
  gameId: number;
  view: 'dashboard' | 'sessions' | 'materials' | 'configuration' | 'cancel-game-confirm' | 'delete-game-title' | 'delete-game-confirm' | 'material-detail' | 'material-player-select' | 'material-player-action' | 'material-category-create' | 'material-move' | 'material-delete-confirm';
  page?: number;
  materialId?: number;
  materialCategoryId?: number | null;
  materialCategoryButtons?: Record<string, number | null>;
  materialPlayerButtons?: Record<string, number>;
  selectedMemberId?: number;
  adminMode?: boolean;
}

interface RoleGameMaterialDraftMessage {
  fromChatId: number;
  fromMessageId: number;
  attachmentKind: 'document' | 'photo' | 'video' | 'audio';
  telegramFileId: string | null;
  telegramFileUniqueId: string | null;
  caption: string | null;
  originalFileName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  mediaGroupId: string | null;
  sortOrder: number;
}

interface RoleGameParticipantsSessionData {
  gameId: number;
  view: 'participants' | 'history' | 'participant-detail' | 'confirm-action';
  page: number;
  total: number;
  memberButtons: Record<string, number>;
  selectedMemberId?: number;
  pendingAction?: RoleGameMemberManagementAction;
}

type RoleGameDetailSessionState = RoleGameDetailSessionData | RoleGameParticipantsSessionData;

export type TelegramRoleGameContext = TelegramCommandHandlerContext & {
  roleGameRepository?: RoleGameRepository;
  characterRepository?: RoleGameCharacterRepository;
  membershipRepository?: MembershipAccessRepository;
  scheduleRepository?: ScheduleRepository;
  tableRepository?: ClubTableRepository;
  venueEventRepository?: VenueEventRepository;
  newsGroupRepository?: NewsGroupRepository;
  storageRepository?: StorageCategoryRepository;
  storageDefaultChatStore?: AppMetadataSessionStorage;
};

export { roleGameCallbackPrefixes };

export async function handleTelegramRoleGameAutoSchedulingCommand(context: TelegramRoleGameContext): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).roleGames;

  if (!context.runtime.actor.isAdmin || context.runtime.actor.isBlocked) {
    await context.reply(texts.permissionDenied);
    return;
  }
  const action = context.messageText?.trim().split(/\s+/)[1]?.toLowerCase();
  if (action !== 'enabled' && action !== 'disabled') {
    await context.reply(texts.autoSchedulingUsage);
    return;
  }
  const store = resolveRoleGameAutoSchedulingStore(context);
  const enabled = action === 'enabled';
  const wasEnabled = await store.isEnabled();
  await store.setEnabled(enabled);
  await context.reply(enabled
    ? (wasEnabled ? texts.autoSchedulingAlreadyEnabled : texts.autoSchedulingEnabled)
    : (wasEnabled ? texts.autoSchedulingDisabled : texts.autoSchedulingAlreadyDisabled));
}

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

  if (isRoleGameNotionSession(context)) {
    const notionSession = context.runtime.session.current;
    const notionData = notionSession?.data as { gameId?: unknown; categoryId?: unknown } | undefined;
    const handled = await handleTelegramRoleGameNotionText(context, text, language);
    if (handled) return true;
    if (text === texts.backToMaterials && typeof notionData?.gameId === 'number') {
      return replyWithRoleGameMaterials(context, {
        language,
        gameId: notionData.gameId,
        page: 1,
        categoryId: typeof notionData.categoryId === 'number' ? notionData.categoryId : null,
      });
    }
  }

  if (isRoleGameCharacterSession(context)) {
    const characterSession = context.runtime.session.current?.data as { gameId?: unknown } | undefined;
    if (text === texts.backToGame && typeof characterSession?.gameId === 'number') {
      const game = await findVisibleRoleGameDetail(context, characterSession.gameId);
      if (game) {
        await replyWithRoleGameDetail(context, game, language);
        return true;
      }
    }
    const handled = await handleTelegramRoleGameCharacterText(context);
    if (handled) return true;
  }

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

  if (isRoleGameInviteSession(context)) {
    return handleRoleGameInviteText(context, text, language);
  }

  if (context.runtime.session.current?.flowKey === roleGameMaterialUploadFlowKey) {
    return handleRoleGameMaterialUploadText(context, text, language);
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
    return replyWithRoleGameList(context, { kind: 'mine', page: 1, language });
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
  if (isRoleGameCharacterSession(context)) {
    const handled = await handleTelegramRoleGameCharacterMessage(context);
    if (handled) return true;
  }
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
  if (await handleTelegramRoleGameCharacterStartText(context)) {
    return true;
  }
  const notionBrowsePage = parseRoleGameNotionBrowseStartPayload(context.messageText);
  if (
    notionBrowsePage !== null &&
    context.runtime.chat.kind === 'private' &&
    context.runtime.actor.isApproved &&
    !context.runtime.actor.isBlocked
  ) {
    return openRoleGameNotionBrowsePage(context, {
      language: normalizeBotLanguage(context.runtime.bot.language, 'ca'),
      ...notionBrowsePage,
    });
  }
  const participantDetail = parseRoleGameParticipantStartPayload(context.messageText);
  if (
    participantDetail !== null &&
    context.runtime.chat.kind === 'private' &&
    context.runtime.actor.isApproved &&
    !context.runtime.actor.isBlocked
  ) {
    return replyWithRoleGameParticipantDetailFromStart(context, {
      language: normalizeBotLanguage(context.runtime.bot.language, 'ca'),
      ...participantDetail,
    });
  }
  const directInvite = parseRoleGameDirectInviteStartPayload(context.messageText);
  if (
    directInvite !== null &&
    context.runtime.chat.kind === 'private' &&
    context.runtime.actor.isApproved &&
    !context.runtime.actor.isBlocked
  ) {
    return inviteRoleGameCandidateAndReply(context, {
      language: normalizeBotLanguage(context.runtime.bot.language, 'ca'),
      gameId: directInvite.gameId,
      candidateTelegramUserId: directInvite.telegramUserId,
      page: directInvite.page,
    });
  }
  const materialCategoryId = parseStartPayload(context.messageText, roleGameMaterialCategoryStartPayloadPrefix);
  if (materialCategoryId !== null && context.runtime.chat.kind === 'private') {
    const repository = resolveRepository(context);
    const category = repository.findMaterialCategoryById ? await repository.findMaterialCategoryById(materialCategoryId) : null;
    if (!category) {
      await context.reply(createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca')).roleGames.notFound);
      return true;
    }
    return replyWithRoleGameMaterials(context, {
      language: normalizeBotLanguage(context.runtime.bot.language, 'ca'),
      gameId: category.roleGameId,
      page: 1,
      categoryId: category.id,
    });
  }
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
  if (
    callbackData.startsWith(roleGameCallbackPrefixes.inviteAccept) ||
    callbackData.startsWith(roleGameCallbackPrefixes.inviteDecline)
  ) {
    const accepting = callbackData.startsWith(roleGameCallbackPrefixes.inviteAccept);
    const prefix = accepting ? roleGameCallbackPrefixes.inviteAccept : roleGameCallbackPrefixes.inviteDecline;
    const memberId = parseCallbackEntityId(callbackData, prefix);
    if (memberId === null) {
      await context.reply(createTelegramI18n(language).roleGames.invitationUnavailable);
      return true;
    }
    return handleRoleGameInvitationResponse(context, {
      language,
      memberId,
      response: accepting ? 'accept' : 'decline',
    });
  }
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
      if (draft.type === 'campaign') {
        return advanceRoleGameCreate(
          context,
          language,
          'recurrence-interval',
          draft,
          texts.promptRecurrenceIntervalWeeks,
          buildRoleGameFrequencyRows(texts.optionNoFixedDays),
        );
      }
      draft.schedulingMode = 'manual';
      return advanceRoleGameCreate(context, language, 'initial-session-date', draft, texts.promptInitialSessionDate);
    }
    if (step === 'scheduling-mode') {
      draft.schedulingMode = parseCreateOption(text, {
        manual: texts.optionManualScheduling,
        recurring: texts.optionRecurringScheduling,
      });
      if (draft.schedulingMode === 'recurring') {
        return advanceRoleGameCreate(
          context,
          language,
          'recurrence-interval',
          draft,
          texts.promptRecurrenceIntervalWeeks,
          buildRoleGameFrequencyRows(texts.optionNoFixedDays),
        );
      }
      if (draft.type === 'one_shot') {
        return advanceRoleGameCreate(context, language, 'initial-session-date', draft, texts.promptInitialSessionDate);
      }
      await replyWithRoleGameCreateConfirmation(context, draft, language);
      return true;
    }
    if (step === 'recurrence-interval') {
      const intervalWeeks = parseRoleGameFrequency(text, texts.optionNoFixedDays);
      if (intervalWeeks === null) {
        draft.schedulingMode = 'manual';
        draft.recurrenceRule = null;
        draft.recurrenceWindowCount = 0;
        await replyWithRoleGameCreateConfirmation(context, draft, language);
        return true;
      }
      draft.schedulingMode = 'recurring';
      draft.recurrenceRule = {
        intervalWeeks,
        weekday: 0,
        time: '18:00',
      };
      return advanceRoleGameCreate(
        context,
        language,
        'recurrence-weekday',
        draft,
        texts.promptRecurrenceWeekday,
        buildRoleGameWeekdayRows(language),
      );
    }
    if (step === 'recurrence-weekday') {
      if (!draft.recurrenceRule) {
        throw new Error('missing recurrence rule');
      }
      draft.recurrenceRule = {
        ...draft.recurrenceRule,
        weekday: parseWeekday(text),
      };
      return advanceRoleGameCreate(
        context,
        language,
        'recurrence-date',
        draft,
        texts.promptNextRecurrenceDate,
        buildRoleGameRecurrenceDateRows(draft.recurrenceRule.weekday, language),
      );
    }
    if (step === 'recurrence-date') {
      if (!draft.recurrenceRule) {
        throw new Error('missing recurrence rule');
      }
      draft.recurrenceRule = {
        ...draft.recurrenceRule,
        startsOn: parseRoleGameRecurrenceDate(text, draft.recurrenceRule.weekday, language),
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
      await replyWithRoleGameCreateConfirmation(context, draft, language);
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
      await replyWithRoleGameCreateConfirmation(context, draft, language);
      return true;
    }
    if (step === 'confirm' && text === texts.confirmCreate) {
      if (!await refreshRoleGameCreateAgendaPreviewIfChanged(context, draft, language)) {
        return true;
      }
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
      if (initialSession) {
        await runAfterScheduleSaveSideEffects(context, initialSession.event, 'created');
      }
      const recurringSessions: Awaited<ReturnType<typeof createRoleGameScheduleSession>>[] = [];
      const autoSchedulingEnabled = await resolveRoleGameAutoSchedulingStore(context).isEnabled();
      for (const startsAt of autoSchedulingEnabled && draft.schedulingMode === 'recurring' ? draft.agendaPreviewStartsAt ?? [] : []) {
        const session = await createRoleGameScheduleSession({
          roleGameRepository: repository,
          scheduleRepository: resolveScheduleRepository(context),
          game,
          startsAt,
          actorTelegramUserId: context.runtime.actor.telegramUserId,
          source: 'recurring',
        });
        if (session.wasCreated) {
          recurringSessions.push(session);
        }
      }
      await context.runtime.session.cancel();
      await context.reply([
        initialSession ? texts.createdWithSession : texts.created,
        initialSession ? formatRoleGameScheduleEventLink(initialSession.event.id, initialSession.event.startsAt) : null,
        recurringSessions.length > 0
          ? texts.agendaActivitiesWritten.replace('{count}', String(recurringSessions.length))
          : null,
        ...recurringSessions.map((sessionResult) => formatRoleGameScheduleEventLink(sessionResult.event.id, sessionResult.event.startsAt)),
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
      draft.agendaPreviewStartsAt = [buildStartsAt(requireDraftValue(draft.date), requireDraftValue(draft.time))];
      draft.agendaPreviewSignature = buildRoleGameAgendaPreviewSignature(game, draft.agendaPreviewStartsAt);
      const nextSession = await findNearestFutureRoleGameSession(context, game.id);
      if (nextSession) {
        draft.overwrittenScheduleEventId = nextSession.id;
      } else {
        delete draft.overwrittenScheduleEventId;
      }
      await context.runtime.session.advance({ stepKey: 'confirm', data: draft });
      const agendaConfirmation = await formatRoleGameAgendaWriteConfirmation(context, {
        game,
        startsAt: draft.agendaPreviewStartsAt,
        language,
      });
      await context.reply([
        nextSession ? texts.promptManualSessionOverwrite.replace('{session}', formatRoleGameScheduleEventLink(nextSession.id, nextSession.startsAt)) : null,
        agendaConfirmation,
      ].filter((line): line is string => Boolean(line)).join('\n\n'), {
        ...buildRoleGameCreateConfirmationKeyboard(language),
        parseMode: 'HTML',
      });
      return true;
    }
    if (step === 'confirm' && text === texts.confirmCreate) {
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
      const agendaPreviewStartsAt = [buildStartsAt(requireDraftValue(draft.date), requireDraftValue(draft.time))];
      const agendaPreviewSignature = buildRoleGameAgendaPreviewSignature(game, agendaPreviewStartsAt);
      if (agendaPreviewSignature !== draft.agendaPreviewSignature) {
        draft.agendaPreviewStartsAt = agendaPreviewStartsAt;
        draft.agendaPreviewSignature = agendaPreviewSignature;
        await context.runtime.session.advance({ stepKey: 'confirm', data: draft });
        await context.reply(await formatRoleGameAgendaWriteConfirmation(context, {
          game,
          startsAt: agendaPreviewStartsAt,
          language,
        }), {
          ...buildRoleGameCreateConfirmationKeyboard(language),
          parseMode: 'HTML',
        });
        return true;
      }
      if (draft.overwrittenScheduleEventId) {
        const existing = await resolveScheduleRepository(context).findEventById(draft.overwrittenScheduleEventId);
        if (existing && existing.lifecycleStatus !== 'cancelled' && existing.startsAt > new Date().toISOString()) {
          await resolveScheduleRepository(context).cancelEvent({
            eventId: existing.id,
            actorTelegramUserId: context.runtime.actor.telegramUserId,
            reason: 'Reemplazada por la siguiente sesión manual de Rol',
          });
        }
      }
      const sessionResult = await createManualRoleGameSession({
        roleGameRepository: resolveRepository(context),
        scheduleRepository: resolveScheduleRepository(context),
        game,
        startsAt: requireDraftValue(draft.agendaPreviewStartsAt)[0]!,
        actorTelegramUserId: context.runtime.actor.telegramUserId,
      });
      await runAfterScheduleSaveSideEffects(context, sessionResult.event, 'created');
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
      const intervalWeeks = parseRoleGameFrequency(text, texts.optionNoFixedDays);
      if (intervalWeeks === null) {
        draft.schedulingMode = 'manual';
        draft.agendaPreviewStartsAt = [];
        await replyWithRoleGameRecurrenceConfirmation(context, draft, language);
        return true;
      }
      draft.schedulingMode = 'recurring';
      draft.intervalWeeks = intervalWeeks;
      await context.runtime.session.advance({ stepKey: 'weekday', data: draft });
      await context.reply(texts.promptRecurrenceWeekday, buildRoleGameCreateStepKeyboard({
        language,
        rows: buildRoleGameWeekdayRows(language),
      }));
      return true;
    }
    if (step === 'weekday') {
      draft.weekday = parseWeekday(text);
      await context.runtime.session.advance({ stepKey: 'date', data: draft });
      await context.reply(texts.promptNextRecurrenceDate, buildRoleGameCreateStepKeyboard({
        language,
        rows: buildRoleGameRecurrenceDateRows(draft.weekday, language),
      }));
      return true;
    }
    if (step === 'date') {
      const weekday = requireDraftValue(draft.weekday);
      draft.startsOn = parseRoleGameRecurrenceDate(text, weekday, language);
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
      await replyWithRoleGameRecurrenceConfirmation(context, draft, language);
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
      if (!await refreshRoleGameRecurrenceAgendaPreviewIfChanged(context, draft, game, language)) {
        return true;
      }
      const updated = draft.schedulingMode === 'manual'
        ? await repository.updateGame({
          gameId,
          schedulingMode: 'manual',
          recurrenceRule: null,
          recurrenceWindowCount: 0,
        })
        : await repository.updateGame({
          gameId,
          schedulingMode: 'recurring',
          recurrenceRule: {
            intervalWeeks: requireDraftValue(draft.intervalWeeks),
            weekday: requireDraftValue(draft.weekday),
            startsOn: requireDraftValue(draft.startsOn),
            time: requireDraftValue(draft.time),
          },
          recurrenceWindowCount: requireDraftValue(draft.windowCount),
        });
      const recurringSessions: Awaited<ReturnType<typeof createRoleGameScheduleSession>>[] = [];
      const autoSchedulingEnabled = await resolveRoleGameAutoSchedulingStore(context).isEnabled();
      for (const startsAt of autoSchedulingEnabled ? draft.agendaPreviewStartsAt ?? [] : []) {
        const session = await createRoleGameScheduleSession({
          roleGameRepository: repository,
          scheduleRepository: resolveScheduleRepository(context),
          game: updated,
          startsAt,
          actorTelegramUserId: context.runtime.actor.telegramUserId,
          source: 'recurring',
        });
        if (session.wasCreated) {
          recurringSessions.push(session);
        }
      }
      await context.runtime.session.cancel();
      await context.reply([
        texts.recurrenceSaved,
        recurringSessions.length > 0
          ? texts.agendaActivitiesWritten.replace('{count}', String(recurringSessions.length))
          : null,
        ...recurringSessions.map((sessionResult) => formatRoleGameScheduleEventLink(sessionResult.event.id, sessionResult.event.startsAt)),
        formatRoleGameDetailMessage({ game: updated, language }),
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
  await context.reply(texts.promptRecurrenceIntervalWeeks, buildRoleGameCreateStepKeyboard({
    language,
    rows: buildRoleGameFrequencyRows(texts.optionNoFixedDays),
  }));
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
  const action: RoleGameMemberManagementAction = status === 'confirmed' ? 'confirm' : 'reject';
  let updated: RoleGameMemberRecord;
  try {
    updated = await manageRoleGameMember({
      repository,
      actor,
      game,
      actorMembership: actorMember,
      member,
      action,
    });
  } catch (error) {
    await replyWithRoleGameDetail(context, game, language, roleGameParticipantActionErrorMessage(error, texts));
    return true;
  }
  await notifyRoleGameMemberChange(context, { game, member: updated, action, language });
  await replyWithRoleGameDetail(
    context,
    game,
    language,
    status === 'confirmed' ? texts.requestAccepted : texts.requestRejected,
  );
  return true;
}

async function startRoleGameMaterialUpload(
  context: TelegramRoleGameContext,
  {
    language,
    gameId,
    categoryId = null,
  }: {
    language: BotLanguage;
    gameId: number;
    categoryId?: number | null;
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
    data: { gameId: game.id, materialCategoryId: categoryId },
  });
  await context.reply(texts.promptMaterialUpload, buildRoleGameCreateStepKeyboard({ language }));
  return true;
}

async function replyWithRoleGameInvitation(
  context: TelegramRoleGameContext,
  {
    language,
    gameId,
    page = 1,
    notice,
  }: {
    language: BotLanguage;
    gameId: number;
    page?: number;
    notice?: string;
  },
): Promise<boolean> {
  const texts = createTelegramI18n(language).roleGames;
  const repository = resolveRepository(context);
  const game = await repository.findGameById(gameId);
  if (!game) {
    await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const dashboardAccess = await loadRoleGameDashboardAccess(context, game);
  if (!canManageCurrentRoleGame(context, game, dashboardAccess.actorMember)) {
    await context.reply(texts.permissionDenied, buildRoleGameHomeKeyboard(language));
    return true;
  }

  const confirmedPlayers = dashboardAccess.members.filter((member) => member.role === 'player' && member.status === 'confirmed').length;
  const candidates = await listInvitableRoleGameUsers(context, game, dashboardAccess.members);
  const totalPages = Math.max(1, Math.ceil(candidates.length / roleGameInvitePageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const start = (clampedPage - 1) * roleGameInvitePageSize;
  const visibleCandidates = candidates.slice(start, start + roleGameInvitePageSize);
  const url = escapeHtml(buildTelegramStartUrl(`${roleGameStartPayloadPrefix}${game.id}`));
  await context.runtime.session.start({
    flowKey: roleGameInviteFlowKey,
    stepKey: 'select',
    data: {
      gameId: game.id,
      page: clampedPage,
      total: candidates.length,
    } satisfies RoleGameInviteSessionData,
  });
  await context.reply([
    notice ? escapeHtml(notice) : null,
    `<b>${escapeHtml(texts.inviteLinkTitle)}</b>`,
    `<b>${escapeHtml(game.title)}</b>`,
    texts.currentPlayersSummary
      .replace('{confirmed}', String(confirmedPlayers))
      .replace('{capacity}', String(game.capacity)),
    '',
    escapeHtml(texts.inviteDirectInstructions),
    ...(visibleCandidates.length > 0
      ? visibleCandidates.map((user) => formatRoleGameInviteCandidateLink({
        gameId: game.id,
        page: clampedPage,
        user,
        language,
      }))
      : [escapeHtml(texts.inviteCandidatesEmpty)]),
    ...(totalPages > 1
      ? ['', escapeHtml(texts.inviteListFooter
        .replace('{from}', String(start + 1))
        .replace('{to}', String(start + visibleCandidates.length))
        .replace('{total}', String(candidates.length))
        .replace('{page}', String(clampedPage))
        .replace('{pages}', String(totalPages)))]
      : []),
    '',
    texts.inviteLinkInstructions,
    `<a href="${url}">role_game_${game.id}</a>`,
  ].filter((line): line is string => line !== null).join('\n'), {
    ...buildRoleGameInviteSelectionKeyboard({
      hasPreviousPage: clampedPage > 1,
      hasNextPage: clampedPage < totalPages,
      canGoToPage: totalPages > 1,
      language,
    }),
    parseMode: 'HTML',
  });
  return true;
}

async function handleRoleGameInviteText(
  context: TelegramRoleGameContext,
  text: string,
  language: BotLanguage,
): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== roleGameInviteFlowKey) return false;
  const data = session.data as unknown as RoleGameInviteSessionData;
  const texts = createTelegramI18n(language).roleGames;
  if (text === texts.backToGame) {
    const game = await findVisibleRoleGameDetail(context, data.gameId);
    if (!game) {
      await context.runtime.session.cancel();
      await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
      return true;
    }
    await replyWithRoleGameDetail(context, game, language);
    return true;
  }
  if (text === texts.previousPage || text === texts.nextPage) {
    return replyWithRoleGameInvitation(context, {
      language,
      gameId: data.gameId,
      page: data.page + (text === texts.nextPage ? 1 : -1),
    });
  }
  if (text === texts.inviteGoToPage) {
    await context.runtime.session.start({
      flowKey: roleGameInviteFlowKey,
      stepKey: 'page-input',
      data: { ...data },
    });
    await context.reply(texts.invitePromptPage, buildRoleGameInviteSelectionKeyboard({ language }));
    return true;
  }
  if (session.stepKey === 'page-input') {
    const requestedPage = parsePositiveInteger(text);
    if (requestedPage === null) {
      await context.reply(texts.inviteInvalidPage, buildRoleGameInviteSelectionKeyboard({ language }));
      return true;
    }
    return replyWithRoleGameInvitation(context, {
      language,
      gameId: data.gameId,
      page: requestedPage,
    });
  }

  const repository = resolveRepository(context);
  const game = await repository.findGameById(data.gameId);
  if (!game) {
    await context.runtime.session.cancel();
    await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const members = await repository.listMembers(game.id);
  const actorMember = members.find((member) => member.telegramUserId === context.runtime.actor.telegramUserId) ?? null;
  if (!canManageCurrentRoleGame(context, game, actorMember)) {
    await context.runtime.session.cancel();
    await context.reply(texts.permissionDenied, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const candidates = await listInvitableRoleGameUsers(context, game, members);
  const candidateTelegramUserId = resolveRoleGameInviteCandidate(text, candidates);
  if (candidateTelegramUserId === null) {
    await context.reply(texts.inviteUserNotFound, buildRoleGameInviteSelectionKeyboard({
      hasPreviousPage: data.page > 1,
      hasNextPage: data.page * roleGameInvitePageSize < data.total,
      canGoToPage: Math.ceil(data.total / roleGameInvitePageSize) > 1,
      language,
    }));
    return true;
  }
  return inviteRoleGameCandidateAndReply(context, {
    language,
    gameId: game.id,
    candidateTelegramUserId,
    page: data.page,
  });
}

async function inviteRoleGameCandidateAndReply(
  context: TelegramRoleGameContext,
  {
    language,
    gameId,
    candidateTelegramUserId,
    page,
  }: {
    language: BotLanguage;
    gameId: number;
    candidateTelegramUserId: number;
    page: number;
  },
): Promise<boolean> {
  const texts = createTelegramI18n(language).roleGames;
  const repository = resolveRepository(context);
  const game = await repository.findGameById(gameId);
  if (!game) {
    await context.runtime.session.cancel();
    await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const members = await repository.listMembers(game.id);
  const actorMember = members.find((member) => member.telegramUserId === context.runtime.actor.telegramUserId) ?? null;
  if (!canManageCurrentRoleGame(context, game, actorMember)) {
    await context.runtime.session.cancel();
    await context.reply(texts.permissionDenied, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const candidates = await listInvitableRoleGameUsers(context, game, members);
  const candidate = candidates.find((user) => user.telegramUserId === candidateTelegramUserId);
  if (!candidate) {
    return replyWithRoleGameInvitation(context, {
      language,
      gameId: game.id,
      page,
      notice: texts.inviteAlreadyMember,
    });
  }

  let member: RoleGameMemberRecord;
  try {
    member = await inviteRoleGamePlayer({
      repository,
      gameId: game.id,
      telegramUserId: candidate.telegramUserId,
      actor: {
        telegramUserId: context.runtime.actor.telegramUserId,
        isAdmin: context.runtime.actor.isAdmin,
        isApproved: context.runtime.actor.isApproved,
      },
    });
  } catch {
    return replyWithRoleGameInvitation(context, {
      language,
      gameId: game.id,
      page,
      notice: texts.inviteAlreadyMember,
    });
  }

  const inviter = await resolveMembershipRepository(context).findUserByTelegramUserId(context.runtime.actor.telegramUserId);
  const inviterLabel = inviter
    ? formatMembershipDisplayName(inviter, formatRoleGameParticipantFallbackName(language, context.runtime.actor.telegramUserId))
    : formatRoleGameParticipantFallbackName(language, context.runtime.actor.telegramUserId);
  const candidateLabel = formatMembershipDisplayName(candidate, formatRoleGameParticipantFallbackName(language, candidate.telegramUserId));
  try {
    await context.runtime.bot.sendPrivateMessage(candidate.telegramUserId, [
      `<b>${escapeHtml(texts.invitationTitle)}</b>`,
      escapeHtml(texts.invitationBody
        .replace('{inviter}', inviterLabel)
        .replace('{title}', game.title)
        .replace('{system}', game.system)),
    ].join('\n\n'), {
      ...buildRoleGameInvitationResponseKeyboard({ memberId: member.id, language }),
      parseMode: 'HTML',
    });
  } catch (error) {
    try {
      await repository.setMemberStatus({
        memberId: member.id,
        status: 'removed',
        expectedStatus: 'invited',
        expectedRole: 'player',
        actorTelegramUserId: context.runtime.actor.telegramUserId,
      });
    } catch (rollbackError) {
      context.runtime.logger?.warn?.({ error: rollbackError, memberId: member.id }, 'role-games.invitation.rollback.failed');
    }
    context.runtime.logger?.warn?.({ error, memberId: member.id, telegramUserId: candidate.telegramUserId }, 'role-games.invitation.delivery.failed');
    return replyWithRoleGameInvitation(context, {
      language,
      gameId: game.id,
      page,
      notice: texts.inviteDeliveryFailed.replace('{user}', candidateLabel),
    });
  }
  return replyWithRoleGameInvitation(context, {
    language,
    gameId: game.id,
    page,
    notice: texts.inviteSent.replace('{user}', candidateLabel),
  });
}

async function handleRoleGameInvitationResponse(
  context: TelegramRoleGameContext,
  {
    language,
    memberId,
    response,
  }: {
    language: BotLanguage;
    memberId: number;
    response: 'accept' | 'decline';
  },
): Promise<boolean> {
  const texts = createTelegramI18n(language).roleGames;
  const repository = resolveRepository(context);
  const member = await repository.findMemberById(memberId);
  if (!member || member.telegramUserId !== context.runtime.actor.telegramUserId || member.status !== 'invited') {
    await context.reply(texts.invitationUnavailable);
    return true;
  }
  const game = await repository.findGameById(member.roleGameId);
  if (!game || game.status !== 'active') {
    await context.reply(texts.invitationUnavailable);
    return true;
  }
  try {
    await respondToRoleGameInvitation({
      repository,
      memberId,
      telegramUserId: context.runtime.actor.telegramUserId,
      response,
    });
  } catch (error) {
    const isFull = error instanceof Error && / is full$/.test(error.message);
    await context.reply(isFull ? texts.invitationFull : texts.invitationUnavailable);
    return true;
  }
  await context.reply((response === 'accept' ? texts.invitationAccepted : texts.invitationDeclined)
    .replace('{title}', game.title));
  return true;
}

async function replyWithRoleGameMaterials(
  context: TelegramRoleGameContext,
  {
    language,
    gameId,
    page,
    categoryId = null,
  }: {
    language: BotLanguage;
    gameId: number;
    page: number;
    categoryId?: number | null;
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

  const categories = repository.listMaterialCategories ? await repository.listMaterialCategories(game.id) : [];
  const currentCategory = categoryId === null ? null : categories.find((category) => category.id === categoryId) ?? null;
  if (categoryId !== null && !currentCategory) {
    await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const childCategories = categories.filter((category) => category.parentCategoryId === categoryId);
  const materials = (await repository.listMaterials(game.id)).filter((material) => (material.categoryId ?? null) === categoryId);
  const entries: Array<{ kind: 'category'; category: RoleGameMaterialCategoryRecord } | { kind: 'material'; material: RoleGameMaterialRecord }> = [
    ...childCategories.map((category) => ({ kind: 'category' as const, category })),
    ...materials.map((material) => ({ kind: 'material' as const, material })),
  ];
  const totalPages = Math.max(1, Math.ceil(entries.length / roleGameMaterialsPageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const start = (clampedPage - 1) * roleGameMaterialsPageSize;
  const visibleEntries = entries.slice(start, start + roleGameMaterialsPageSize);
  const lines = [
    `<b>${escapeHtml(texts.materialsHeader.replace('{title}', game.title))}</b>${currentCategory ? `\n${escapeHtml(formatRoleGameMaterialCategoryPath(currentCategory, categories))}` : ''}`,
    '',
    ...(visibleEntries.length > 0
      ? visibleEntries.map((entry) => entry.kind === 'category'
        ? `📁 <a href="${escapeHtml(buildTelegramStartUrl(`${roleGameMaterialCategoryStartPayloadPrefix}${entry.category.id}`))}"><b>${escapeHtml(entry.category.name)}</b></a>`
        : formatRoleGameMaterialListRow(entry.material, language))
      : [escapeHtml(currentCategory ? texts.materialCategoryEmpty : texts.noMaterials)]),
  ];
  if (totalPages > 1) {
    lines.push('');
    lines.push(escapeHtml(texts.materialListFooter
      .replace('{from}', String(start + 1))
      .replace('{to}', String(start + visibleEntries.length))
      .replace('{total}', String(entries.length))
      .replace('{page}', String(clampedPage))
      .replace('{pages}', String(totalPages))));
  }

  await context.runtime.session.start({
    flowKey: 'role-game-detail',
    stepKey: 'materials',
    data: { gameId: game.id, view: 'materials', page: clampedPage, materialCategoryId: categoryId } satisfies RoleGameDetailSessionData,
  });
  await context.reply(lines.join('\n'), {
    ...buildRoleGameMaterialsKeyboard({
      canUpload: true,
      canManageCategory: true,
      canManageNotion: Boolean(context.runtime.notionCredentialEncryptionKey),
      inCategory: currentCategory !== null,
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
  if (!session || session.flowKey !== roleGameMaterialUploadFlowKey || !['media', 'attachments'].includes(session.stepKey) || !media || !isSupportedRoleGameMaterialAttachment(media.attachmentKind)) {
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

  const messages = asRoleGameMaterialDraftMessages(session.data.messages);
  messages.push({
    fromChatId: context.runtime.chat.chatId,
    fromMessageId: media.messageId,
    attachmentKind: media.attachmentKind as RoleGameMaterialDraftMessage['attachmentKind'],
    telegramFileId: media.fileId ?? null,
    telegramFileUniqueId: media.fileUniqueId ?? null,
    caption: media.caption ?? null,
    originalFileName: media.originalFileName ?? null,
    mimeType: media.mimeType ?? null,
    fileSizeBytes: media.fileSizeBytes ?? null,
    mediaGroupId: media.mediaGroupId ?? null,
    sortOrder: messages.length,
  });
  await context.runtime.session.advance({
    stepKey: 'attachments',
    data: { ...session.data, messages },
  });
  await context.reply(
    texts.materialAttachmentRecorded.replace('{count}', String(messages.length)),
    buildRoleGameMaterialUploadKeyboard(language),
  );
  return true;
}

async function handleRoleGameMaterialUploadText(
  context: TelegramRoleGameContext,
  text: string,
  language: BotLanguage,
): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== roleGameMaterialUploadFlowKey) {
    return false;
  }
  const texts = createTelegramI18n(language).roleGames;
  const messages = asRoleGameMaterialDraftMessages(session.data.messages);
  if (session.stepKey === 'attachments') {
    if (text === texts.addMoreMaterialAttachments) {
      await context.reply(texts.promptMaterialUpload, buildRoleGameMaterialUploadKeyboard(language));
      return true;
    }
    if (text !== texts.finishMaterialAttachments || messages.length === 0) {
      return false;
    }
    const suggestedName = deriveRoleGameMaterialDraftTitle(messages, language);
    await context.runtime.session.advance({
      stepKey: 'name',
      data: { ...session.data, messages, suggestedName },
    });
    await context.reply(
      texts.promptMaterialName.replace('{name}', suggestedName),
      buildRoleGameMaterialNameKeyboard({ suggestedName, language }),
    );
    return true;
  }
  if (session.stepKey !== 'name' || messages.length === 0) {
    return false;
  }
  const suggestedName = String(session.data.suggestedName ?? deriveRoleGameMaterialDraftTitle(messages, language));
  const title = text === texts.useSuggestedMaterialName.replace('{name}', suggestedName) ? suggestedName : text.trim();
  if (!title) {
    await context.reply(
      texts.promptMaterialName.replace('{name}', suggestedName),
      buildRoleGameMaterialNameKeyboard({ suggestedName, language }),
    );
    return true;
  }
  return persistRoleGameMaterialDraft(context, {
    gameId: Number(session.data.gameId),
    categoryId: typeof session.data.materialCategoryId === 'number' ? session.data.materialCategoryId : null,
    title,
    messages,
    language,
  });
}

async function persistRoleGameMaterialDraft(
  context: TelegramRoleGameContext,
  {
    gameId,
    categoryId,
    title,
    messages,
    language,
  }: {
    gameId: number;
    categoryId: number | null;
    title: string;
    messages: RoleGameMaterialDraftMessage[];
    language: BotLanguage;
  },
): Promise<boolean> {
  const texts = createTelegramI18n(language).roleGames;
  const roleGameRepository = resolveRepository(context);
  const game = Number.isSafeInteger(gameId) ? await roleGameRepository.findGameById(gameId) : null;
  if (!game || !context.runtime.bot.copyMessage) {
    await context.runtime.session.cancel();
    await context.reply(texts.materialStorageNotConfigured, buildRoleGameHomeKeyboard(language));
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
  const category = await ensureRoleGameHandoutCategory(context, storageRepository);
  if (!category) {
    await context.runtime.session.cancel();
    await context.reply(texts.materialStorageNotConfigured, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const progress = await startTelegramEditableProgress(context, texts.materialUploadCopying, {
    editFailedEvent: 'role-games.material-upload.progress-edit.failed',
  });
  const storedMessages: StorageEntryMessageInput[] = [];
  for (const message of messages) {
    const copied = await context.runtime.bot.copyMessage({
      fromChatId: message.fromChatId,
      messageId: message.fromMessageId,
      toChatId: category.storageChatId,
      messageThreadId: category.storageThreadId,
    });
    storedMessages.push({
      storageChatId: category.storageChatId,
      storageMessageId: copied.messageId,
      storageThreadId: category.storageThreadId,
      telegramFileId: message.telegramFileId,
      telegramFileUniqueId: message.telegramFileUniqueId,
      attachmentKind: message.attachmentKind,
      caption: message.caption,
      originalFileName: message.originalFileName,
      mimeType: message.mimeType,
      fileSizeBytes: message.fileSizeBytes,
      mediaGroupId: message.mediaGroupId,
      sortOrder: message.sortOrder,
    });
  }
  await progress.update(texts.materialUploadIndexing);
  const storageEntry = await createStorageEntry({
    repository: storageRepository,
    categoryId: category.id,
    createdByTelegramUserId: context.runtime.actor.telegramUserId,
    sourceKind: 'dm_copy',
    description: title,
    tags: ['rol', `partida-${game.id}`],
    messages: storedMessages,
  });
  const material = await createRoleGameMaterial({
    repository: roleGameRepository,
    roleGameId: game.id,
    categoryId,
    internalStorageEntryId: storageEntry.entry.id,
    title,
    description: messages.find((message) => message.caption)?.caption ?? null,
    visibility: 'gm_only',
    uploadedByTelegramUserId: context.runtime.actor.telegramUserId,
  });
  await context.runtime.session.start({
    flowKey: 'role-game-detail',
    stepKey: 'materials',
    data: { gameId: game.id, view: 'materials', page: 1, materialCategoryId: categoryId } satisfies RoleGameDetailSessionData,
  });
  await progress.complete([texts.materialSaved, formatRoleGameMaterialMessage(material)].join('\n\n'), {
    ...buildRoleGameMaterialsKeyboard({ canUpload: true, canManageCategory: true, inCategory: categoryId !== null, language }),
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
  const { sent, failed } = await deliverRoleGameMaterial(context, { repository, material, players, deliveryMode });

  if (deliveryMode === 'reveal_only') {
    await context.reply(texts.materialRevealed, buildRoleGameMaterialDetailKeyboard({ canManage: true, language }));
    return true;
  }

  await context.reply([
    texts.materialDeliverySummary
      .replace('{sent}', String(sent))
      .replace('{total}', String(players.length)),
    failed > 0 ? texts.materialDeliveryFailures.replace('{failed}', String(failed)) : null,
    deliveryMode === 'send_and_reveal' ? texts.materialDeliveryRevealed : null,
  ].filter((line): line is string => Boolean(line)).join('\n'), buildRoleGameMaterialDetailKeyboard({ canManage: true, language }));
  return true;
}

async function replyWithRoleGameMaterialPlayerSelection(
  context: TelegramRoleGameContext,
  {
    game,
    materialId,
    page,
    language,
  }: {
    game: RoleGameRecord;
    materialId: number;
    page: number;
    language: BotLanguage;
  },
): Promise<boolean> {
  const texts = createTelegramI18n(language).roleGames;
  const repository = resolveRepository(context);
  const [material, membership, members] = await Promise.all([
    repository.findMaterialById(materialId),
    repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId),
    repository.listMembers(game.id),
  ]);
  if (!material || material.roleGameId !== game.id || !canManageCurrentRoleGame(context, game, membership)) {
    await context.reply(texts.permissionDenied);
    return true;
  }
  const players = members.filter((member) => member.role === 'player' && member.status === 'confirmed');
  if (players.length === 0) {
    await context.reply(texts.noConfirmedMaterialPlayers, buildRoleGameMaterialDetailKeyboard({ canManage: true, language }));
    return true;
  }
  const items = (await resolveRoleGameParticipantListItems(context, players, language))
    .sort((left, right) => left.displayName.localeCompare(right.displayName, language));
  const pages = Math.max(1, Math.ceil(items.length / roleGameMaterialPlayersPageSize));
  const clampedPage = Math.min(Math.max(1, page), pages);
  const visibleItems = items.slice(
    (clampedPage - 1) * roleGameMaterialPlayersPageSize,
    clampedPage * roleGameMaterialPlayersPageSize,
  );
  const buttonMap = buildRoleGameParticipantButtonMap(visibleItems, {
    reservedLabels: [texts.previousPage, texts.nextPage, texts.backToMaterial],
  });
  await context.runtime.session.start({
    flowKey: 'role-game-detail',
    stepKey: 'material-player-select',
    data: {
      gameId: game.id,
      view: 'material-player-select',
      materialId: material.id,
      page: clampedPage,
      materialPlayerButtons: Object.fromEntries(buttonMap),
    } satisfies RoleGameDetailSessionData,
  });
  await context.reply(texts.promptMaterialPlayer, buildRoleGameMaterialPlayerSelectionKeyboard({
    playerLabels: Array.from(buttonMap.keys()),
    hasPreviousPage: clampedPage > 1,
    hasNextPage: clampedPage < pages,
    language,
  }));
  return true;
}

async function deliverRoleGameMaterial(
  context: TelegramRoleGameContext,
  {
    repository,
    material,
    players,
    deliveryMode,
    revealGlobally = true,
  }: {
    repository: RoleGameRepository;
    material: RoleGameMaterialRecord;
    players: RoleGameMemberRecord[];
    deliveryMode: RoleGameMaterialDeliveryMode;
    revealGlobally?: boolean;
  },
): Promise<{ sent: number; failed: number }> {
  const storageDetail = deliveryMode === 'reveal_only'
    ? null
    : await resolveStorageRepository(context).getEntryDetail(material.internalStorageEntryId);
  let sent = 0;
  let failed = 0;
  if (deliveryMode !== 'reveal_only') {
    for (const player of players) {
      try {
        await context.runtime.bot.sendPrivateMessage(player.telegramUserId, formatRoleGameMaterialMessage(material), { parseMode: 'HTML' });
        if (storageDetail) await copyRoleGameMaterialToPrivateChat(context, storageDetail, player.telegramUserId);
        sent += 1;
        await recordRoleGameMaterialDelivery({ repository, roleGameMaterialId: material.id, recipientTelegramUserId: player.telegramUserId, sentByTelegramUserId: context.runtime.actor.telegramUserId, deliveryMode, status: 'sent', errorCode: null });
      } catch (error) {
        failed += 1;
        await recordRoleGameMaterialDelivery({ repository, roleGameMaterialId: material.id, recipientTelegramUserId: player.telegramUserId, sentByTelegramUserId: context.runtime.actor.telegramUserId, deliveryMode, status: 'failed', errorCode: error instanceof Error ? error.message : 'send_failed' });
      }
    }
  }
  if (deliveryMode === 'reveal_only' && !revealGlobally) {
    for (const player of players) {
      await recordRoleGameMaterialDelivery({
        repository,
        roleGameMaterialId: material.id,
        recipientTelegramUserId: player.telegramUserId,
        sentByTelegramUserId: context.runtime.actor.telegramUserId,
        deliveryMode,
        status: 'sent',
        errorCode: null,
      });
    }
  }
  if (revealGlobally && (deliveryMode === 'send_and_reveal' || deliveryMode === 'reveal_only')) {
    await revealRoleGameMaterial({ repository, materialId: material.id });
  }
  return { sent, failed };
}

async function handleRoleGameMaterialCategoryDelivery(
  context: TelegramRoleGameContext,
  {
    game,
    categoryId,
    deliveryMode,
    language,
  }: {
    game: RoleGameRecord;
    categoryId: number;
    deliveryMode: RoleGameMaterialDeliveryMode;
    language: BotLanguage;
  },
): Promise<boolean> {
  const repository = resolveRepository(context);
  const categories = repository.listMaterialCategories ? await repository.listMaterialCategories(game.id) : [];
  const category = categories.find((item) => item.id === categoryId);
  if (!category) return replyWithRoleGameMaterials(context, { language, gameId: game.id, page: 1 });
  const descendantIds = collectRoleGameMaterialCategoryIds(category.id, categories);
  const materials = (await repository.listMaterials(game.id)).filter((material) => descendantIds.has(material.categoryId ?? -1));
  const players = (await repository.listMembers(game.id)).filter((member) => member.role === 'player' && member.status === 'confirmed');
  const texts = createTelegramI18n(language).roleGames;
  const progress = await startTelegramEditableProgress(context, texts.materialCategoryProgress
    .replace('{current}', '0').replace('{total}', String(materials.length)).replace('{title}', category.name), {
    editFailedEvent: 'role-games.material-category.progress-edit.failed',
  });
  let sent = 0;
  let failed = 0;
  for (const [index, material] of materials.entries()) {
    await progress.update(texts.materialCategoryProgress
      .replace('{current}', String(index + 1)).replace('{total}', String(materials.length)).replace('{title}', material.title));
    const result = await deliverRoleGameMaterial(context, { repository, material, players, deliveryMode });
    sent += result.sent;
    failed += result.failed;
  }
  await progress.complete(texts.materialCategorySummary
    .replace('{materials}', String(materials.length)).replace('{sent}', String(sent)).replace('{failed}', String(failed)));
  return replyWithRoleGameMaterials(context, { language, gameId: game.id, page: 1, categoryId: category.id });
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
    return (await repository.listGamesForUser(context.runtime.actor.telegramUserId))
      .filter((game) => game.status !== 'cancelled' && game.status !== 'closed');
  }
  return (await repository.listVisibleGames({
    actor: {
      telegramUserId: context.runtime.actor.telegramUserId,
      isAdmin: context.runtime.actor.isAdmin,
      isApproved: context.runtime.actor.isApproved,
    },
  })).filter((game) => game.status !== 'cancelled' && game.status !== 'closed');
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
  const canViewNormally = canViewRoleGameMaterial(actor, game, membership, material);
  const hasRecipientAccess = !canViewNormally &&
    membership?.role === 'player' &&
    membership.status === 'confirmed' &&
    repository.hasMaterialRecipientAccess
    ? await repository.hasMaterialRecipientAccess(material.id, actor.telegramUserId)
    : false;
  if (!canViewNormally && !hasRecipientAccess) {
    await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const canManage = canManageRoleGameOperationally(actor, game, membership);
  await context.runtime.session.start({
    flowKey: 'role-game-detail',
    stepKey: 'material-detail',
    data: { gameId: game.id, view: 'material-detail', materialId: material.id } satisfies RoleGameDetailSessionData,
  });
  await context.reply(formatRoleGameMaterialMessage(material), {
    ...buildRoleGameMaterialDetailKeyboard({ canManage, language }),
    parseMode: 'HTML',
  });
  const detail = await resolveStorageRepository(context).getEntryDetail(material.internalStorageEntryId);
  if (detail) {
    await copyRoleGameMaterialToPrivateChat(context, detail, context.runtime.actor.telegramUserId);
  }
  return true;
}

async function replyWithRoleGameDetail(
  context: TelegramRoleGameContext,
  game: RoleGameRecord,
  language: BotLanguage,
  prefixMessage?: string,
  adminMode = false,
): Promise<void> {
  const [dashboardAccess, nextSession] = await Promise.all([
    loadRoleGameDashboardAccess(context, game),
    findNearestFutureRoleGameSession(context, game.id),
  ]);
  await context.runtime.session.start({
    flowKey: 'role-game-detail',
    stepKey: 'dashboard',
    data: { gameId: game.id, view: 'dashboard', ...(adminMode ? { adminMode: true } : {}) } satisfies RoleGameDetailSessionData,
  });
  await context.reply([
    prefixMessage,
    formatRoleGameDetailMessage({ game, language }),
    formatRoleGameDashboardSummary({ game, dashboardAccess, nextSession, language }),
  ].filter((message): message is string => Boolean(message)).join('\n\n'), {
    ...buildRoleGameDashboardOptions(context, game, language, dashboardAccess, adminMode),
    parseMode: 'HTML',
  });
}

interface RoleGameDashboardAccess {
  actorMember: RoleGameMemberRecord | null;
  members: RoleGameMemberRecord[];
}

async function loadRoleGameDashboardAccess(
  context: TelegramRoleGameContext,
  game: RoleGameRecord,
): Promise<RoleGameDashboardAccess> {
  const repository = resolveRepository(context);
  const [actorMember, members] = await Promise.all([
    repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId),
    repository.listMembers(game.id),
  ]);
  return { actorMember, members };
}

function buildRoleGameDashboardOptions(
  context: TelegramRoleGameContext,
  game: RoleGameRecord,
  language: BotLanguage,
  { actorMember, members }: RoleGameDashboardAccess,
  adminMode = false,
) {
  const realActor = {
    telegramUserId: context.runtime.actor.telegramUserId,
    isAdmin: context.runtime.actor.isAdmin,
    isApproved: context.runtime.actor.isApproved,
  };
  const isAdminVisitor = realActor.isAdmin &&
    game.primaryGmTelegramUserId !== realActor.telegramUserId &&
    actorMember?.status !== 'confirmed';
  const actor = { ...realActor, isAdmin: realActor.isAdmin && (!isAdminVisitor || adminMode) };
  const canManageParticipants = canManageRoleGameOperationally(actor, game, actorMember);
  const canFullyManage = canManageRoleGame(actor, game, actorMember);
  return buildRoleGameDashboardKeyboard({
    canManageParticipants,
    canViewCharacters: canManageParticipants || actorMember?.status === 'confirmed',
    canSchedule: !isAdminVisitor || adminMode ? canScheduleManualRoleGameSession(context, game, actorMember) : false,
    canManageMaterials: canManageParticipants,
    canConfigure: (!isAdminVisitor || adminMode) &&
      (canFullyManage || canConfigureRoleGameRecurrence(context, game, actorMember)),
    canRequestSeat: !adminMode && canRequestRoleGameSeat(realActor, game, actorMember),
    canOpenAsAdmin: isAdminVisitor && !adminMode,
    canExitAdminMode: isAdminVisitor && adminMode,
    pendingRequestCount: canManageParticipants
      ? members.filter((member) => member.role === 'player' && member.status === 'requested').length
      : 0,
    language,
  });
}

async function findNearestFutureRoleGameSession(
  context: TelegramRoleGameContext,
  gameId: number,
): Promise<ScheduleEventRecord | null> {
  const links = await resolveRepository(context).listSessionLinks(gameId);
  if (links.length === 0) {
    return null;
  }
  const now = new Date().toISOString();
  const linkedEventIds = new Set(links.map((link) => link.scheduleEventId));
  const events = await resolveScheduleRepository(context).listEvents({
    includeCancelled: false,
    startsAtFrom: now,
  });
  return events
    .filter((event) => linkedEventIds.has(event.id) && event.startsAt > now)
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt))[0] ?? null;
}

function formatRoleGameDashboardSummary({
  game,
  dashboardAccess,
  nextSession,
  language,
}: {
  game: RoleGameRecord;
  dashboardAccess: RoleGameDashboardAccess;
  nextSession: ScheduleEventRecord | null;
  language: BotLanguage;
}): string {
  const texts = createTelegramI18n(language).roleGames;
  const confirmedPlayers = dashboardAccess.members.filter(
    (member) => member.role === 'player' && member.status === 'confirmed',
  ).length;
  const pendingRequests = dashboardAccess.members.filter(
    (member) => member.role === 'player' && member.status === 'requested',
  ).length;
  return [
    texts.currentPlayersSummary
      .replace('{confirmed}', String(confirmedPlayers))
      .replace('{capacity}', String(game.capacity)),
    texts.pendingRequestsSummary.replace('{count}', String(pendingRequests)),
    nextSession
      ? texts.nextSessionSummary.replace(
        '{session}',
        formatRoleGameScheduleEventLink(nextSession.id, nextSession.startsAt),
      )
      : texts.noUpcomingSession,
  ].join('\n');
}

async function handleRoleGameDetailText(
  context: TelegramRoleGameContext,
  text: string,
  language: BotLanguage,
): Promise<boolean> {
  const session = context.runtime.session.current;
  const data = session?.data as Partial<RoleGameDetailSessionState> | undefined;
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
  const currentMembership = await resolveRepository(context).findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
  const adminVisitorInNormalMode = context.runtime.actor.isAdmin &&
    game.primaryGmTelegramUserId !== context.runtime.actor.telegramUserId &&
    currentMembership?.status !== 'confirmed' &&
    (data as Partial<RoleGameDetailSessionData>).adminMode !== true;
  if (text === texts.backToMyGames) {
    await context.runtime.session.cancel();
    return replyWithRoleGameList(context, { kind: 'mine', page: 1, language });
  }
  if (text === texts.backToGame) {
    await replyWithRoleGameDetail(context, game, language);
    return true;
  }
  if (text === texts.characters && !adminVisitorInNormalMode) {
    return openRoleGameCharacters(context, game.id, language);
  }
  if (data.view === 'dashboard' && text === texts.openAsAdmin) {
    const isAdminVisitor = context.runtime.actor.isAdmin &&
      game.primaryGmTelegramUserId !== context.runtime.actor.telegramUserId &&
      currentMembership?.status !== 'confirmed';
    if (!isAdminVisitor) return false;
    await replyWithRoleGameDetail(context, game, language, texts.adminModeNotice, true);
    return true;
  }
  if (data.view === 'dashboard' && text === texts.exitAdminMode && data.adminMode === true) {
    await replyWithRoleGameDetail(context, game, language);
    return true;
  }
  if (data.view === 'material-category-create') {
    const repository = resolveRepository(context);
    try {
      await createRoleGameMaterialCategory({
        repository,
        roleGameId: game.id,
        parentCategoryId: data.materialCategoryId ?? null,
        name: text,
        createdByTelegramUserId: context.runtime.actor.telegramUserId,
      });
      await context.reply(texts.materialCategorySaved);
    } catch {
      await context.reply(texts.invalidCreateValue);
      return true;
    }
    return replyWithRoleGameMaterials(context, { language, gameId: game.id, page: 1, categoryId: data.materialCategoryId ?? null });
  }
  if (data.view === 'material-move' && typeof data.materialId === 'number' && data.materialCategoryButtons && Object.hasOwn(data.materialCategoryButtons, text)) {
    const repository = resolveRepository(context);
    const membership = await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
    if (!canManageCurrentRoleGame(context, game, membership) || !repository.moveMaterialToCategory) {
      await context.reply(texts.permissionDenied);
      return true;
    }
    await repository.moveMaterialToCategory({ materialId: data.materialId, categoryId: data.materialCategoryButtons[text] ?? null });
    await context.reply(texts.materialMoved);
    return replyWithRoleGameMaterial(context, data.materialId, language);
  }
  if (data.view === 'material-delete-confirm' && typeof data.materialId === 'number') {
    if (text !== texts.confirmDeleteMaterialAction) return false;
    const repository = resolveRepository(context);
    const membership = await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
    const material = await repository.findMaterialById(data.materialId);
    if (!material || material.roleGameId !== game.id || !canManageCurrentRoleGame(context, game, membership) || !repository.deleteMaterial) {
      await context.reply(texts.permissionDenied);
      return true;
    }
    await repository.deleteMaterial({
      materialId: material.id,
      roleGameId: game.id,
      deletedByTelegramUserId: context.runtime.actor.telegramUserId,
    });
    await context.reply(texts.materialDeleted);
    return replyWithRoleGameMaterials(context, { language, gameId: game.id, page: 1, categoryId: material.categoryId ?? null });
  }
  if (data.view === 'cancel-game-confirm') {
    if (text !== texts.confirmCancelGameAction) return false;
    const repository = resolveRepository(context);
    const membership = await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
    if (!canFullyManageCurrentRoleGame(context, game, membership) || game.status === 'cancelled' || game.status === 'closed') {
      await context.reply(texts.permissionDenied);
      return true;
    }
    await repository.updateGame({ gameId: game.id, status: 'cancelled', closedAt: new Date().toISOString() });
    await context.reply(texts.gameCancelled);
    return replyWithRoleGameList(context, { kind: 'mine', page: 1, language });
  }
  if (data.view === 'delete-game-title') {
    if (text === texts.cancel) return false;
    const repository = resolveRepository(context);
    const membership = await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
    if (!canFullyManageCurrentRoleGame(context, game, membership) || !repository.deleteGame) {
      await context.reply(texts.permissionDenied);
      return true;
    }
    if (text !== game.title) {
      await context.reply(texts.deleteGameTitleMismatch, buildRoleGameCreateStepKeyboard({ language }));
      return true;
    }
    await context.runtime.session.start({
      flowKey: 'role-game-detail',
      stepKey: 'delete-game-confirm',
      data: { gameId: game.id, view: 'delete-game-confirm' } satisfies RoleGameDetailSessionData,
    });
    await context.reply(texts.confirmDeleteGame.replace('{title}', game.title), buildRoleGameCreateStepKeyboard({
      language,
      rows: [[{ text: texts.confirmDeleteGameAction, semanticRole: 'danger' }]],
    }));
    return true;
  }
  if (data.view === 'delete-game-confirm') {
    if (text !== texts.confirmDeleteGameAction) return false;
    const repository = resolveRepository(context);
    const membership = await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
    if (!canFullyManageCurrentRoleGame(context, game, membership) || !repository.deleteGame) {
      await context.reply(texts.permissionDenied);
      return true;
    }
    await repository.deleteGame({
      gameId: game.id,
      deletedByTelegramUserId: context.runtime.actor.telegramUserId,
    });
    await context.reply(texts.gameDeleted);
    return replyWithRoleGameList(context, { kind: 'mine', page: 1, language });
  }
  if (data.view === 'material-player-select' && typeof data.materialId === 'number') {
    if (text === texts.backToMaterial) return replyWithRoleGameMaterial(context, data.materialId, language);
    if (text === texts.previousPage || text === texts.nextPage) {
      const page = data.page ?? 1;
      return replyWithRoleGameMaterialPlayerSelection(context, {
        game,
        materialId: data.materialId,
        page: text === texts.previousPage ? page - 1 : page + 1,
        language,
      });
    }
    if (data.materialPlayerButtons && Object.hasOwn(data.materialPlayerButtons, text)) {
      const repository = resolveRepository(context);
      const memberId = data.materialPlayerButtons[text];
      const [member, membership, material] = await Promise.all([
        typeof memberId === 'number' ? repository.findMemberById(memberId) : null,
        repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId),
        repository.findMaterialById(data.materialId),
      ]);
      if (!member || member.roleGameId !== game.id || member.role !== 'player' || member.status !== 'confirmed' ||
        !material || material.roleGameId !== game.id || !canManageCurrentRoleGame(context, game, membership)) {
        await context.reply(texts.permissionDenied);
        return true;
      }
      const [item] = await resolveRoleGameParticipantListItems(context, [member], language);
      await context.runtime.session.start({
        flowKey: 'role-game-detail',
        stepKey: 'material-player-action',
        data: {
          gameId: game.id,
          view: 'material-player-action',
          materialId: material.id,
          selectedMemberId: member.id,
        } satisfies RoleGameDetailSessionData,
      });
      await context.reply(
        texts.privateMaterialDeliveryFor.replace('{player}', item?.displayName ?? text),
        buildRoleGameMaterialPlayerActionKeyboard(language),
      );
      return true;
    }
    return false;
  }
  if (data.view === 'material-player-action' && typeof data.materialId === 'number' && typeof data.selectedMemberId === 'number') {
    if (text === texts.backToMaterial) return replyWithRoleGameMaterial(context, data.materialId, language);
    const deliveryMode = text === texts.sendMaterialToPlayerOnly
      ? 'send_only'
      : text === texts.sendAndRevealMaterialToPlayer
        ? 'send_and_reveal'
        : text === texts.revealMaterialToPlayerOnly
          ? 'reveal_only'
          : null;
    if (!deliveryMode) return false;
    const repository = resolveRepository(context);
    const [member, membership, material] = await Promise.all([
      repository.findMemberById(data.selectedMemberId),
      repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId),
      repository.findMaterialById(data.materialId),
    ]);
    if (!member || member.roleGameId !== game.id || member.role !== 'player' || member.status !== 'confirmed' ||
      !material || material.roleGameId !== game.id || !canManageCurrentRoleGame(context, game, membership)) {
      await context.reply(texts.permissionDenied);
      return true;
    }
    const [item] = await resolveRoleGameParticipantListItems(context, [member], language);
    const playerName = item?.displayName ?? formatRoleGameParticipantFallbackName(language, member.telegramUserId);
    const { sent, failed } = await deliverRoleGameMaterial(context, {
      repository,
      material,
      players: [member],
      deliveryMode,
      revealGlobally: false,
    });
    const message = deliveryMode === 'reveal_only'
      ? texts.materialPlayerRevealed.replace('{player}', playerName)
      : failed > 0 || sent === 0
        ? texts.materialPlayerDeliveryFailed.replace('{player}', playerName)
        : [
          texts.materialPlayerDeliverySent.replace('{player}', playerName),
          deliveryMode === 'send_and_reveal' ? texts.materialPlayerRevealed.replace('{player}', playerName) : null,
        ].filter((line): line is string => Boolean(line)).join('\n');
    await context.reply(message, buildRoleGameMaterialPlayerActionKeyboard(language));
    return true;
  }
  if (data.view === 'material-detail' && typeof data.materialId === 'number') {
    if (text === texts.backToMaterials) {
      return replyWithRoleGameMaterials(context, { language, gameId: game.id, page: 1 });
    }
    if (text === texts.moveMaterialToCategory) {
      const repository = resolveRepository(context);
      const membership = await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
      if (!canManageCurrentRoleGame(context, game, membership)) {
        await context.reply(texts.permissionDenied);
        return true;
      }
      const categories = repository.listMaterialCategories ? await repository.listMaterialCategories(game.id) : [];
      const materialCategoryButtons: Record<string, number | null> = {
        [texts.materialUncategorizedHeader]: null,
        ...Object.fromEntries(categories.map((category) => [formatRoleGameMaterialCategoryPath(category, categories), category.id])),
      };
      await context.runtime.session.start({
        flowKey: 'role-game-detail',
        stepKey: 'material-move',
        data: { gameId: game.id, view: 'material-move', materialId: data.materialId, materialCategoryButtons } satisfies RoleGameDetailSessionData,
      });
      await context.reply(texts.promptMoveMaterialCategory, buildRoleGameCreateStepKeyboard({
        language,
        rows: Object.keys(materialCategoryButtons).map((label) => [{ text: label, semanticRole: 'primary' }] as TelegramReplyButton[]),
      }));
      return true;
    }
    if (text === texts.deleteMaterial) {
      const repository = resolveRepository(context);
      const membership = await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
      const material = await repository.findMaterialById(data.materialId);
      if (!material || material.roleGameId !== game.id || !canManageCurrentRoleGame(context, game, membership) || !repository.deleteMaterial) {
        await context.reply(texts.permissionDenied);
        return true;
      }
      await context.runtime.session.start({
        flowKey: 'role-game-detail',
        stepKey: 'material-delete-confirm',
        data: { gameId: game.id, view: 'material-delete-confirm', materialId: material.id } satisfies RoleGameDetailSessionData,
      });
      await context.reply(texts.confirmDeleteMaterial.replace('{title}', material.title), buildRoleGameCreateStepKeyboard({
        language,
        rows: [[{ text: texts.confirmDeleteMaterialAction, semanticRole: 'danger' }]],
      }));
      return true;
    }
    if (text === texts.deliverMaterialToPlayer) {
      return replyWithRoleGameMaterialPlayerSelection(context, {
        game,
        materialId: data.materialId,
        page: 1,
        language,
      });
    }
    const deliveryMode = text === texts.sendMaterialOnly
      ? 'send_only'
      : text === texts.sendAndRevealMaterial
        ? 'send_and_reveal'
        : text === texts.revealMaterialOnly
          ? 'reveal_only'
          : null;
    if (deliveryMode) {
      return handleRoleGameMaterialCallback(context, {
        language,
        materialId: data.materialId,
        deliveryMode,
      });
    }
    return false;
  }
  if (data.view === 'participants' || data.view === 'history') {
    const kind: RoleGameParticipantListKind = data.view === 'participants' ? 'active' : 'history';
    const currentPage = data.page ?? 1;
    if (text === texts.previousPage) {
      return replyWithRoleGameParticipants(context, { language, game, kind, page: currentPage - 1 });
    }
    if (text === texts.nextPage) {
      return replyWithRoleGameParticipants(context, { language, game, kind, page: currentPage + 1 });
    }
    if (kind === 'active' && text === texts.participantsHistory) {
      return replyWithRoleGameParticipants(context, { language, game, kind: 'history', page: 1 });
    }
    if (kind === 'history' && text === texts.currentParticipants) {
      return replyWithRoleGameParticipants(context, { language, game, kind: 'active', page: 1 });
    }
    if (data.memberButtons && Object.hasOwn(data.memberButtons, text)) {
      const memberId = data.memberButtons[text];
      if (typeof memberId === 'number') {
        if (typeof data.total !== 'number') {
          return replyWithRoleGameParticipants(context, { language, game, kind, page: currentPage });
        }
        return replyWithRoleGameParticipantDetail(context, {
          language,
          game,
          kind,
          page: currentPage,
          total: data.total,
          memberButtons: data.memberButtons,
          memberId,
        });
      }
    }
  }
  if (data.view === 'participant-detail' || data.view === 'confirm-action') {
    return handleRoleGameParticipantDetailText(context, { data, game, text, language });
  }
  if (text === texts.sessions) {
    return replyWithRoleGameSessions(context, { language, game });
  }
  if (!adminVisitorInNormalMode && await isRoleGameParticipantsButtonText(context, game, text, language)) {
    return replyWithRoleGameParticipants(context, { language, game, kind: 'active', page: 1 });
  }
  if (text === texts.materials && !adminVisitorInNormalMode) {
    return replyWithRoleGameMaterials(context, { language, gameId: game.id, page: 1 });
  }
  if (text === texts.configuration && !adminVisitorInNormalMode) {
    return replyWithRoleGameConfiguration(context, { language, gameId: game.id });
  }
  if (text === texts.invite && !adminVisitorInNormalMode) {
    return replyWithRoleGameInvitation(context, { language, gameId: game.id });
  }
  if (text === texts.requestSeat) {
    return requestRoleGameSeatAndReply(context, { language, gameId: game.id });
  }
  if (data.view === 'materials' && text === texts.uploadMaterial) {
    return startRoleGameMaterialUpload(context, { language, gameId: game.id, categoryId: data.materialCategoryId ?? null });
  }
  if (data.view === 'materials' && text === texts.notion) {
    return openRoleGameNotion(context, { language, gameId: game.id, categoryId: data.materialCategoryId ?? null });
  }
  if (data.view === 'materials' && text === texts.createMaterialCategory) {
    await context.runtime.session.start({
      flowKey: 'role-game-detail',
      stepKey: 'material-category-create',
      data: { gameId: game.id, view: 'material-category-create', materialCategoryId: data.materialCategoryId ?? null } satisfies RoleGameDetailSessionData,
    });
    await context.reply(texts.promptMaterialCategoryName, buildRoleGameCreateStepKeyboard({ language }));
    return true;
  }
  if (data.view === 'materials' && text === texts.backToParentMaterialCategory && typeof data.materialCategoryId === 'number') {
    const repository = resolveRepository(context);
    const current = repository.findMaterialCategoryById ? await repository.findMaterialCategoryById(data.materialCategoryId) : null;
    return replyWithRoleGameMaterials(context, { language, gameId: game.id, page: 1, categoryId: current?.parentCategoryId ?? null });
  }
  if (data.view === 'materials' && typeof data.materialCategoryId === 'number') {
    const deliveryMode = text === texts.sendMaterialCategoryOnly
      ? 'send_only'
      : text === texts.sendAndRevealMaterialCategory
        ? 'send_and_reveal'
        : text === texts.revealMaterialCategoryOnly
          ? 'reveal_only'
          : null;
    if (deliveryMode) return handleRoleGameMaterialCategoryDelivery(context, { game, categoryId: data.materialCategoryId, deliveryMode, language });
  }
  if (data.view === 'materials' && text === texts.previousPage) {
    return replyWithRoleGameMaterials(context, { language, gameId: game.id, page: Math.max(1, (data.page ?? 1) - 1), categoryId: data.materialCategoryId ?? null });
  }
  if (data.view === 'materials' && text === texts.nextPage) {
    return replyWithRoleGameMaterials(context, { language, gameId: game.id, page: (data.page ?? 1) + 1, categoryId: data.materialCategoryId ?? null });
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
  if (data.view === 'configuration' && text === texts.cancelGame) {
    const repository = resolveRepository(context);
    const membership = await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
    if (!canFullyManageCurrentRoleGame(context, game, membership) || game.status === 'cancelled' || game.status === 'closed') {
      await context.reply(texts.permissionDenied);
      return true;
    }
    await context.runtime.session.start({
      flowKey: 'role-game-detail',
      stepKey: 'cancel-game-confirm',
      data: { gameId: game.id, view: 'cancel-game-confirm' } satisfies RoleGameDetailSessionData,
    });
    await context.reply(texts.confirmCancelGame.replace('{title}', game.title), buildRoleGameCreateStepKeyboard({
      language,
      rows: [[{ text: texts.confirmCancelGameAction, semanticRole: 'danger' }]],
    }));
    return true;
  }
  if (data.view === 'configuration' && text === texts.deleteGame) {
    const repository = resolveRepository(context);
    const membership = await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
    if (!canFullyManageCurrentRoleGame(context, game, membership) || !repository.deleteGame) {
      await context.reply(texts.permissionDenied);
      return true;
    }
    await context.runtime.session.start({
      flowKey: 'role-game-detail',
      stepKey: 'delete-game-title',
      data: { gameId: game.id, view: 'delete-game-title' } satisfies RoleGameDetailSessionData,
    });
    await context.reply(texts.promptDeleteGameTitle.replace('{title}', game.title), buildRoleGameCreateStepKeyboard({ language }));
    return true;
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

async function replyWithRoleGameParticipants(
  context: TelegramRoleGameContext,
  {
    language,
    game,
    kind,
    page,
  }: {
    language: BotLanguage;
    game: RoleGameRecord;
    kind: RoleGameParticipantListKind;
    page: number;
  },
): Promise<boolean> {
  const texts = createTelegramI18n(language).roleGames;
  const repository = resolveRepository(context);
  const actorMember = await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
  if (!canManageCurrentRoleGame(context, game, actorMember)) {
    await context.reply(texts.permissionDenied, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const participants = await resolveRoleGameParticipantListItems(context, await repository.listMembers(game.id), language);
  const participantPage = buildRoleGameParticipantPage({
    items: participants,
    kind,
    requestedPage: page,
    language,
  });
  const memberButtons = Object.fromEntries(buildRoleGameParticipantButtonMap(participantPage.items, {
    reservedLabels: roleGameParticipantReservedButtonLabels(language, kind),
  }));
  const participantLinks = new Map(participantPage.items.map((item) => [
    item.member.id,
    buildTelegramStartUrl(`${roleGameParticipantStartPayloadPrefix}${game.id}_${item.member.id}_${kind}_${participantPage.page}`),
  ]));
  await context.runtime.session.start({
    flowKey: 'role-game-detail',
    stepKey: kind,
    data: {
      gameId: game.id,
      view: kind === 'active' ? 'participants' : 'history',
      page: participantPage.page,
      total: participantPage.total,
      memberButtons,
    } satisfies RoleGameParticipantsSessionData,
  });
  await context.reply(formatRoleGameParticipantList({
    page: participantPage,
    title: game.title,
    kind,
    participantLinks,
    language,
  }), {
    ...buildRoleGameParticipantsKeyboard({
      kind,
      hasPreviousPage: participantPage.page > 1,
      hasNextPage: participantPage.page < participantPage.pages,
      language,
    }),
    parseMode: 'HTML',
  });
  return true;
}

async function replyWithRoleGameParticipantDetailFromStart(
  context: TelegramRoleGameContext,
  {
    language,
    gameId,
    memberId,
    kind,
    page,
  }: {
    language: BotLanguage;
    gameId: number;
    memberId: number;
    kind: RoleGameParticipantListKind;
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
  const participants = await resolveRoleGameParticipantListItems(context, await repository.listMembers(game.id), language);
  const participantPage = buildRoleGameParticipantPage({
    items: participants,
    kind,
    requestedPage: page,
    language,
  });
  const memberButtons = Object.fromEntries(buildRoleGameParticipantButtonMap(participantPage.items, {
    reservedLabels: roleGameParticipantReservedButtonLabels(language, kind),
  }));
  return replyWithRoleGameParticipantDetail(context, {
    language,
    game,
    kind,
    page: participantPage.page,
    total: participantPage.total,
    memberButtons,
    memberId,
  });
}

async function replyWithRoleGameParticipantDetail(
  context: TelegramRoleGameContext,
  {
    language,
    game,
    kind,
    page,
    total,
    memberButtons,
    memberId,
  }: {
    language: BotLanguage;
    game: RoleGameRecord;
    kind: RoleGameParticipantListKind;
    page: number;
    total: number;
    memberButtons: Record<string, number>;
    memberId: number;
  },
): Promise<boolean> {
  const texts = createTelegramI18n(language).roleGames;
  const repository = resolveRepository(context);
  const actorMember = await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
  if (!canManageCurrentRoleGame(context, game, actorMember)) {
    await context.reply(texts.permissionDenied, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const member = await repository.findMemberById(memberId);
  const allowedStatuses = kind === 'active'
    ? new Set<RoleGameMemberRecord['status']>(['requested', 'waitlisted', 'confirmed', 'invited'])
    : new Set<RoleGameMemberRecord['status']>(['left', 'removed', 'rejected']);
  if (!member || member.roleGameId !== game.id || !allowedStatuses.has(member.status)) {
    return replyWithRoleGameParticipants(context, { language, game, kind, page });
  }
  const [participant] = await resolveRoleGameParticipantListItems(context, [member], language);
  if (!participant) {
    return replyWithRoleGameParticipants(context, { language, game, kind, page });
  }
  await context.runtime.session.start({
    flowKey: 'role-game-detail',
    stepKey: 'participant-detail',
    data: {
      gameId: game.id,
      view: 'participant-detail',
      page,
      total,
      memberButtons,
      selectedMemberId: member.id,
    } satisfies RoleGameParticipantsSessionData,
  });
  await context.reply(formatRoleGameParticipantDetail({ item: participant, language }), {
    ...buildRoleGameParticipantDetailKeyboard({
      actions: listRoleGameMemberActions({
        actor: context.runtime.actor,
        game,
        actorMembership: actorMember,
        member,
      }),
      language,
    }),
    parseMode: 'HTML',
  });
  return true;
}

async function handleRoleGameParticipantDetailText(
  context: TelegramRoleGameContext,
  {
    data,
    game,
    text,
    language,
  }: {
    data: Partial<RoleGameParticipantsSessionData>;
    game: RoleGameRecord;
    text: string;
    language: BotLanguage;
  },
): Promise<boolean> {
  const texts = createTelegramI18n(language).roleGames;
  if (typeof data.selectedMemberId !== 'number' || !Number.isSafeInteger(data.selectedMemberId) || data.selectedMemberId <= 0) {
    return false;
  }
  if (data.view === 'participant-detail') {
    const actorMembership = await resolveRepository(context).findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
    const member = await resolveRepository(context).findMemberById(data.selectedMemberId);
    if (!member || member.roleGameId !== game.id) {
      return recoverRoleGameParticipantAction(context, { game, page: data.page ?? 1, language, message: texts.participantActionStale });
    }
    const actions = listRoleGameMemberActions({
      actor: context.runtime.actor,
      game,
      actorMembership,
      member,
    });
    const action = findRoleGameMemberActionByText(text, language);
    if (!action || !actions.includes(action)) {
      return false;
    }
    await context.runtime.session.start({
      flowKey: 'role-game-detail',
      stepKey: 'confirm-action',
      data: {
        gameId: game.id,
        view: 'confirm-action',
        page: data.page ?? 1,
        total: data.total ?? 0,
        memberButtons: data.memberButtons ?? {},
        selectedMemberId: member.id,
        pendingAction: action,
      } satisfies RoleGameParticipantsSessionData,
    });
    await context.reply(texts.participantActionPrompt.replace('{action}', roleGameMemberActionLabel(action, language)), buildRoleGameParticipantActionConfirmationKeyboard(language));
    return true;
  }
  if (data.view !== 'confirm-action' || !data.pendingAction) {
    return false;
  }
  if (text === texts.participantActionCancel) {
    return replyWithRoleGameParticipantDetail(context, {
      language,
      game,
      kind: 'active',
      page: data.page ?? 1,
      total: data.total ?? 0,
      memberButtons: data.memberButtons ?? {},
      memberId: data.selectedMemberId,
    });
  }
  if (text !== texts.participantActionConfirm) {
    return false;
  }
  return executeRoleGameParticipantAction(context, {
    gameId: data.gameId ?? game.id,
    memberId: data.selectedMemberId,
    action: data.pendingAction,
    page: data.page ?? 1,
    language,
  });
}

async function executeRoleGameParticipantAction(
  context: TelegramRoleGameContext,
  {
    gameId,
    memberId,
    action,
    page,
    language,
  }: {
    gameId: number;
    memberId: number;
    action: RoleGameMemberManagementAction;
    page: number;
    language: BotLanguage;
  },
): Promise<boolean> {
  const repository = resolveRepository(context);
  const texts = createTelegramI18n(language).roleGames;
  const game = await repository.findGameById(gameId);
  if (!game) {
    await context.runtime.session.cancel();
    await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
    return true;
  }
  const [actorMembership, member] = await Promise.all([
    repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId),
    repository.findMemberById(memberId),
  ]);
  if (!member || member.roleGameId !== game.id) {
    return recoverRoleGameParticipantAction(context, { game, page, language, message: texts.participantActionStale });
  }
  if (!listRoleGameMemberActions({ actor: context.runtime.actor, game, actorMembership, member }).includes(action)) {
    return recoverRoleGameParticipantAction(context, { game, page, language, message: texts.participantActionStale });
  }
  try {
    let affectedCharacters: Array<{ name: string }> = [];
    if (action === 'remove') {
      try {
        affectedCharacters = (await resolveCharacterRepository(context).listCharacters(game.id))
          .filter((character) => character.assignedMemberId === member.id);
      } catch (error) {
        context.runtime.logger?.warn?.({ error, gameId: game.id, memberId: member.id }, 'role_game.character.member_removal_lookup.failed');
      }
    }
    const updated = await manageRoleGameMember({
      repository,
      actor: context.runtime.actor,
      game,
      actorMembership,
      member,
      action,
    });
    await context.runtime.session.start({
      flowKey: 'role-game-detail',
      stepKey: 'participants',
      data: {
        gameId: game.id,
        view: 'participants',
        page,
        total: 0,
        memberButtons: {},
      } satisfies RoleGameParticipantsSessionData,
    });
    await notifyRoleGameMemberChange(context, { game, member: updated, action, language });
    if (affectedCharacters.length > 0) {
      await notifyRoleGameCharacterRemoval(context, {
        game,
        member: updated,
        characterNames: affectedCharacters.map((character) => character.name),
        language,
      });
    }
  } catch (error) {
    return recoverRoleGameParticipantAction(context, {
      game,
      page,
      language,
      message: roleGameParticipantActionErrorMessage(error, texts),
    });
  }
  return replyWithRoleGameParticipants(context, { language, game, kind: 'active', page });
}

async function notifyRoleGameCharacterRemoval(
  context: TelegramRoleGameContext,
  { game, member, characterNames, language }: { game: RoleGameRecord; member: RoleGameMemberRecord; characterNames: string[]; language: BotLanguage },
): Promise<void> {
  const names = characterNames.join(', ');
  const message = {
    ca: `Els teus personatges de ${game.title} han quedat sense assignar: ${names}. Els públics tornen a estar disponibles.`,
    es: `Tus personajes de ${game.title} han quedado sin asignar: ${names}. Los públicos vuelven a estar disponibles.`,
    en: `Your characters in ${game.title} are now unassigned: ${names}. Public characters are available again.`,
  }[language];
  try {
    await context.runtime.bot.sendPrivateMessage(member.telegramUserId, message);
  } catch (error) {
    context.runtime.logger?.warn?.({ error, gameId: game.id, memberId: member.id }, 'role_game.character.member_removal_notification.failed');
  }
}

async function recoverRoleGameParticipantAction(
  context: TelegramRoleGameContext,
  {
    game,
    page,
    language,
    message,
  }: {
    game: RoleGameRecord;
    page: number;
    language: BotLanguage;
    message: string;
  },
): Promise<boolean> {
  await context.reply(message);
  return replyWithRoleGameParticipants(context, { language, game, kind: 'active', page });
}

async function notifyRoleGameMemberChange(
  context: TelegramRoleGameContext,
  {
    game,
    member,
    action,
    language,
  }: {
    game: RoleGameRecord;
    member: RoleGameMemberRecord;
    action: RoleGameMemberManagementAction;
    language: BotLanguage;
  },
): Promise<void> {
  try {
    await context.runtime.bot.sendPrivateMessage(
      member.telegramUserId,
      formatRoleGameMemberChangeNotification({ game, action, language }),
    );
  } catch (error) {
    const bindings = {
      gameId: game.id,
      memberId: member.id,
      recipientTelegramUserId: member.telegramUserId,
      action,
      error: error instanceof Error ? error.message : String(error),
    };
    emitRoleGameParticipantNotificationWarning(context, bindings);
  }
}

function emitRoleGameParticipantNotificationWarning(
  context: TelegramRoleGameContext,
  bindings: {
    gameId: number;
    memberId: number;
    recipientTelegramUserId: number;
    action: RoleGameMemberManagementAction;
    error: string;
  },
): void {
  const message = 'role-game.participant-notification.failed';
  if (context.runtime.logger?.warn) {
    context.runtime.logger.warn(bindings, message);
    return;
  }
  console.warn(JSON.stringify({ level: 'warn', ...bindings, msg: message }));
}

function findRoleGameMemberActionByText(
  text: string,
  language: BotLanguage,
): RoleGameMemberManagementAction | null {
  const actions: RoleGameMemberManagementAction[] = [...roleGameMemberManagementActions];
  return actions.find((action) => roleGameMemberActionLabel(action, language) === text) ?? null;
}

function roleGameParticipantActionErrorMessage(
  error: unknown,
  texts: ReturnType<typeof createTelegramI18n>['roleGames'],
): string {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('is full')) return texts.participantActionFull;
  if (message.includes('does not have permission')) return texts.permissionDenied;
  if (message.includes('not found')) return texts.notFound;
  return texts.participantActionStale;
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
    ...buildRoleGameConfigurationKeyboard({
      canEdit,
      canConfigureRecurrence,
      canCancel: canEdit && game.status !== 'cancelled' && game.status !== 'closed',
      canDelete: canEdit && Boolean(resolveRepository(context).deleteGame),
      language,
    }),
    parseMode: 'HTML',
  });
  return true;
}

async function requestRoleGameSeatAndReply(
  context: TelegramRoleGameContext,
  { language, gameId }: { language: BotLanguage; gameId: number },
): Promise<boolean> {
  const texts = createTelegramI18n(language).roleGames;
  let member: RoleGameMemberRecord;
  try {
    member = await requestRoleGameSeat({
      repository: resolveRepository(context),
      gameId,
      telegramUserId: context.runtime.actor.telegramUserId,
      actor: {
        telegramUserId: context.runtime.actor.telegramUserId,
        isAdmin: context.runtime.actor.isAdmin,
        isApproved: context.runtime.actor.isApproved,
      },
    });
  } catch {
    const currentGame = await findVisibleRoleGameDetail(context, gameId);
    if (currentGame) {
      await replyWithRoleGameDetail(context, currentGame, language, texts.seatRequestUnavailable);
    } else {
      await context.reply(texts.permissionDenied, buildRoleGameHomeKeyboard(language));
    }
    return true;
  }
  const game = await findVisibleRoleGameDetail(context, gameId);
  const message = member.status === 'confirmed'
    ? texts.seatConfirmed
    : texts.seatRequested;
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

function collectRoleGameMaterialCategoryIds(rootId: number, categories: RoleGameMaterialCategoryRecord[]): Set<number> {
  const result = new Set<number>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of categories) {
      if (category.parentCategoryId !== null && result.has(category.parentCategoryId) && !result.has(category.id)) {
        result.add(category.id);
        changed = true;
      }
    }
  }
  return result;
}

function formatRoleGameMaterialCategoryPath(category: RoleGameMaterialCategoryRecord, categories: RoleGameMaterialCategoryRecord[]): string {
  const byId = new Map(categories.map((item) => [item.id, item]));
  const path = [category.name];
  const visited = new Set<number>([category.id]);
  let parentId = category.parentCategoryId;
  while (parentId !== null && !visited.has(parentId)) {
    const parent = byId.get(parentId);
    if (!parent) break;
    path.unshift(parent.name);
    visited.add(parent.id);
    parentId = parent.parentCategoryId;
  }
  return path.join(' / ');
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

function parseRoleGameParticipantStartPayload(text: string | undefined): {
  gameId: number;
  memberId: number;
  kind: RoleGameParticipantListKind;
  page: number;
} | null {
  const normalized = text?.trim();
  if (!normalized) return null;
  const payload = normalized.startsWith('/start ') ? normalized.slice('/start '.length).trim() : normalized;
  if (!payload.startsWith(roleGameParticipantStartPayloadPrefix)) return null;
  const [rawGameId, rawMemberId, rawKind, rawPage] = payload.slice(roleGameParticipantStartPayloadPrefix.length).split('_');
  const gameId = parsePositiveInteger(rawGameId ?? '');
  const memberId = parsePositiveInteger(rawMemberId ?? '');
  if (gameId === null || memberId === null || (rawKind !== 'active' && rawKind !== 'history')) return null;
  return {
    gameId,
    memberId,
    kind: rawKind,
    page: parsePositiveInteger(rawPage ?? '') ?? 1,
  };
}

function parseRoleGameDirectInviteStartPayload(text: string | undefined): {
  gameId: number;
  telegramUserId: number;
  page: number;
} | null {
  const normalized = text?.trim();
  if (!normalized) return null;
  const payload = normalized.startsWith('/start ') ? normalized.slice('/start '.length).trim() : normalized;
  if (!payload.startsWith(roleGameDirectInviteStartPayloadPrefix)) return null;
  const [rawGameId, rawTelegramUserId, rawPage] = payload.slice(roleGameDirectInviteStartPayloadPrefix.length).split('_');
  const gameId = parsePositiveInteger(rawGameId ?? '');
  const telegramUserId = parsePositiveInteger(rawTelegramUserId ?? '');
  if (gameId === null || telegramUserId === null) return null;
  return {
    gameId,
    telegramUserId,
    page: parsePositiveInteger(rawPage ?? '') ?? 1,
  };
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

function isRoleGameInviteSession(context: TelegramRoleGameContext): boolean {
  return context.runtime.session.current?.flowKey === roleGameInviteFlowKey;
}

function isRoleGameDetailSession(context: TelegramRoleGameContext): boolean {
  return context.runtime.session.current?.flowKey === 'role-game-detail';
}

function isRoleGameEditFieldStep(context: TelegramRoleGameContext): boolean {
  const session = context.runtime.session.current;
  return session?.flowKey === roleGameEditFlowKey && session.stepKey === 'field';
}

export function canManageCurrentRoleGame(
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
  if (game.type !== 'campaign' || game.status !== 'active') {
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

function parseRoleGameFrequency(text: string, noFixedDaysLabel: string): number | null {
  if (normalizeOptionText(text) === normalizeOptionText(noFixedDaysLabel)) {
    return null;
  }
  return parseBoundedInteger(text, 1, 52);
}

function buildRoleGameFrequencyRows(noFixedDaysLabel: string): TelegramReplyButton[][] {
  return [
    [{ text: noFixedDaysLabel, semanticRole: 'primary' }],
    [
      { text: '1', semanticRole: 'primary' },
      { text: '2', semanticRole: 'primary' },
    ],
  ];
}

function roleGameWeekdayLabels(language: BotLanguage): Record<RoleGameRecurrenceRule['weekday'], string> {
  const texts = createTelegramI18n(language).roleGames;
  return {
    0: texts.weekdaySunday,
    1: texts.weekdayMonday,
    2: texts.weekdayTuesday,
    3: texts.weekdayWednesday,
    4: texts.weekdayThursday,
    5: texts.weekdayFriday,
    6: texts.weekdaySaturday,
  };
}

function buildRoleGameWeekdayRows(language: BotLanguage): TelegramReplyButton[][] {
  const labels = roleGameWeekdayLabels(language);
  return [
    [1, 2].map((weekday) => ({ text: labels[weekday as 1 | 2], semanticRole: 'primary' as const })),
    [3, 4].map((weekday) => ({ text: labels[weekday as 3 | 4], semanticRole: 'primary' as const })),
    [5, 6].map((weekday) => ({ text: labels[weekday as 5 | 6], semanticRole: 'primary' as const })),
    [{ text: labels[0], semanticRole: 'primary' }],
  ];
}

function buildRoleGameRecurrenceDateRows(
  weekday: RoleGameRecurrenceRule['weekday'],
  language: BotLanguage,
): TelegramReplyButton[][] {
  return listUpcomingRoleGameDates(weekday).map((date) => [{
    text: formatRoleGameDateOption(date, language),
    semanticRole: 'primary',
  }]);
}

function parseRoleGameRecurrenceDate(
  text: string,
  weekday: RoleGameRecurrenceRule['weekday'],
  language: BotLanguage,
): string {
  const options = listUpcomingRoleGameDates(weekday);
  const selected = options.find((date) => normalizeOptionText(formatRoleGameDateOption(date, language)) === normalizeOptionText(text));
  if (selected) return formatLocalIsoDate(selected);
  const parsed = parseDate(text);
  if (parsed instanceof Error) throw parsed;
  const [year, month, day] = parsed.split('-').map(Number);
  const date = new Date(year!, month! - 1, day!, 12, 0, 0, 0);
  const today = startOfLocalDay(new Date());
  if (date.getDay() !== weekday || date.getTime() < today.getTime()) {
    throw new Error('invalid recurrence start date');
  }
  return parsed;
}

function listUpcomingRoleGameDates(
  weekday: RoleGameRecurrenceRule['weekday'],
  now = new Date(),
): Date[] {
  const first = startOfLocalDay(now);
  first.setDate(first.getDate() + ((weekday - first.getDay() + 7) % 7));
  return Array.from({ length: 4 }, (_, index) => {
    const date = new Date(first);
    date.setDate(first.getDate() + (index * 7));
    return date;
  });
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
}

function formatLocalIsoDate(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatRoleGameDateOption(date: Date, language: BotLanguage): string {
  const locale = ({ ca: 'ca-ES', es: 'es-ES', en: 'en-GB' } as const)[language];
  const formatted = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date).replace(',', '');
  return `${formatted.charAt(0).toLocaleUpperCase(locale)}${formatted.slice(1)}`;
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

async function replyWithRoleGameCreateConfirmation(
  context: TelegramRoleGameContext,
  draft: RoleGameCreateDraft,
  language: BotLanguage,
): Promise<void> {
  const texts = createTelegramI18n(language).roleGames;
  const autoSchedulingSettings = await resolveRoleGameAutoSchedulingStore(context).getSettings();
  draft.agendaPreviewStartsAt = buildRoleGameCreateAgendaPreview(
    draft,
    new Date(),
    autoSchedulingSettings.enabled,
    autoSchedulingSettings.maxFutureWeeks,
  );
  const game = buildRoleGameRecordFromCreateDraft(draft);
  draft.agendaPreviewSignature = buildRoleGameAgendaPreviewSignature(game, draft.agendaPreviewStartsAt);
  await context.runtime.session.advance({ stepKey: 'confirm', data: { ...draft } });
  const agendaConfirmation = draft.agendaPreviewStartsAt.length > 0
    ? await formatRoleGameAgendaWriteConfirmation(context, {
      game,
      startsAt: draft.agendaPreviewStartsAt,
      language,
    })
    : escapeHtml(texts.promptNoAgendaActivities);
  await context.reply([
    texts.promptConfirmCreate,
    formatRoleGameDetailMessage({ game, language }),
    agendaConfirmation,
  ].filter((line): line is string => Boolean(line)).join('\n\n'), {
    ...buildRoleGameCreateConfirmationKeyboard(language),
    parseMode: 'HTML',
  });
}

async function refreshRoleGameCreateAgendaPreviewIfChanged(
  context: TelegramRoleGameContext,
  draft: RoleGameCreateDraft,
  language: BotLanguage,
): Promise<boolean> {
  const autoSchedulingSettings = await resolveRoleGameAutoSchedulingStore(context).getSettings();
  const currentPreview = buildRoleGameCreateAgendaPreview(
    draft,
    new Date(),
    autoSchedulingSettings.enabled,
    autoSchedulingSettings.maxFutureWeeks,
  );
  const game = buildRoleGameRecordFromCreateDraft(draft);
  const currentSignature = buildRoleGameAgendaPreviewSignature(game, currentPreview);
  if (sameStringList(currentPreview, draft.agendaPreviewStartsAt ?? []) && currentSignature === draft.agendaPreviewSignature) {
    return true;
  }
  draft.agendaPreviewStartsAt = currentPreview;
  draft.agendaPreviewSignature = currentSignature;
  await replyWithRoleGameCreateConfirmation(context, draft, language);
  return false;
}

function buildRoleGameCreateAgendaPreview(
  draft: RoleGameCreateDraft,
  now = new Date(),
  includeRecurring = true,
  maxFutureWeeks = defaultRoleGameAutoSchedulingMaxFutureWeeks,
): string[] {
  if (draft.type === 'one_shot' && draft.initialSessionDate && draft.initialSessionTime) {
    return [buildStartsAt(draft.initialSessionDate, draft.initialSessionTime)];
  }
  if (!includeRecurring || draft.schedulingMode !== 'recurring' || !draft.recurrenceRule || !draft.recurrenceWindowCount) {
    return [];
  }
  return limitRoleGameOccurrencesToFutureWeeks({
    occurrences: computeUpcomingRoleGameOccurrences({
      rule: draft.recurrenceRule,
      now,
      count: draft.recurrenceWindowCount,
    }),
    now,
    maxFutureWeeks,
  });
}

async function replyWithRoleGameRecurrenceConfirmation(
  context: TelegramRoleGameContext,
  draft: RoleGameRecurrenceConfigDraft,
  language: BotLanguage,
): Promise<void> {
  const texts = createTelegramI18n(language).roleGames;
  const game = await resolveRepository(context).findGameById(requireDraftValue(draft.gameId));
  if (!game) {
    await context.runtime.session.cancel();
    await context.reply(texts.notFound, buildRoleGameHomeKeyboard(language));
    return;
  }
  draft.agendaPreviewStartsAt = await planRoleGameRecurrenceAgendaPreview(context, draft, game);
  const configuredGame = buildRoleGameRecordWithRecurrenceDraft(game, draft);
  draft.agendaPreviewSignature = buildRoleGameAgendaPreviewSignature(configuredGame, draft.agendaPreviewStartsAt);
  await context.runtime.session.advance({ stepKey: 'confirm', data: { ...draft } });
  const agendaConfirmation = draft.agendaPreviewStartsAt.length > 0
    ? await formatRoleGameAgendaWriteConfirmation(context, {
      game: configuredGame,
      startsAt: draft.agendaPreviewStartsAt,
      language,
    })
    : escapeHtml(texts.promptNoAgendaActivities);
  const existingSessionsWarning = draft.existingFutureSessions && draft.existingFutureSessions > 0
    ? texts.promptConfirmRecurrenceWithExistingSessions
    : null;
  await context.reply([
    texts.promptConfirmRecurrence,
    existingSessionsWarning,
    formatRoleGameRecurrenceSummary(draft, language),
    agendaConfirmation,
  ].filter((line): line is string => Boolean(line)).join('\n\n'), {
    ...buildRoleGameCreateConfirmationKeyboard(language),
    parseMode: 'HTML',
  });
}

async function refreshRoleGameRecurrenceAgendaPreviewIfChanged(
  context: TelegramRoleGameContext,
  draft: RoleGameRecurrenceConfigDraft,
  game: RoleGameRecord,
  language: BotLanguage,
): Promise<boolean> {
  const currentPreview = await planRoleGameRecurrenceAgendaPreview(context, draft, game);
  const configuredGame = buildRoleGameRecordWithRecurrenceDraft(game, draft);
  const currentSignature = buildRoleGameAgendaPreviewSignature(configuredGame, currentPreview);
  if (sameStringList(currentPreview, draft.agendaPreviewStartsAt ?? []) && currentSignature === draft.agendaPreviewSignature) {
    return true;
  }
  draft.agendaPreviewStartsAt = currentPreview;
  draft.agendaPreviewSignature = currentSignature;
  await replyWithRoleGameRecurrenceConfirmation(context, draft, language);
  return false;
}

async function planRoleGameRecurrenceAgendaPreview(
  context: TelegramRoleGameContext,
  draft: RoleGameRecurrenceConfigDraft,
  game: RoleGameRecord,
): Promise<string[]> {
  if (draft.schedulingMode !== 'recurring') {
    return [];
  }
  const autoSchedulingSettings = await resolveRoleGameAutoSchedulingStore(context).getSettings();
  if (!autoSchedulingSettings.enabled) {
    return [];
  }
  const plan = await planRecurringRoleGameSessions({
    roleGameRepository: resolveRepository(context),
    scheduleRepository: resolveScheduleRepository(context),
    game: buildRoleGameRecordWithRecurrenceDraft(game, draft),
    maxFutureWeeks: autoSchedulingSettings.maxFutureWeeks,
  });
  return plan.startsAtToCreate;
}

function buildRoleGameRecordWithRecurrenceDraft(
  game: RoleGameRecord,
  draft: RoleGameRecurrenceConfigDraft,
): RoleGameRecord {
  if (draft.schedulingMode !== 'recurring') {
    return {
      ...game,
      schedulingMode: 'manual',
      recurrenceRule: null,
      recurrenceWindowCount: 0,
    };
  }
  return {
    ...game,
    schedulingMode: 'recurring',
    recurrenceRule: {
      intervalWeeks: requireDraftValue(draft.intervalWeeks),
      weekday: requireDraftValue(draft.weekday),
      startsOn: requireDraftValue(draft.startsOn),
      time: requireDraftValue(draft.time),
    },
    recurrenceWindowCount: requireDraftValue(draft.windowCount),
  };
}

async function formatRoleGameAgendaWriteConfirmation(
  context: TelegramRoleGameContext,
  {
    game,
    startsAt,
    language,
  }: {
    game: RoleGameRecord;
    startsAt: string[];
    language: BotLanguage;
  },
): Promise<string> {
  const texts = createTelegramI18n(language);
  const roleTexts = texts.roleGames;
  const scheduleTexts = texts.schedule;
  const count = startsAt.length;
  const prompt = count === 1
    ? roleTexts.promptConfirmOneAgendaActivity
    : roleTexts.promptConfirmManyAgendaActivities.replace('{count}', String(count));
  const table = game.defaultTableId !== null && context.tableRepository
    ? await context.tableRepository.findTableById(game.defaultTableId)
    : null;
  const tableLabel = table?.displayName
    ?? (game.defaultTableId === null ? scheduleTexts.noTable : `#${game.defaultTableId}`);
  const attendanceLabel = game.defaultAttendanceMode === 'open'
    ? scheduleTexts.openDetailTag
    : scheduleTexts.closedDetailTag;
  const visibilityLabel = game.defaultIsPublicScheduleEvent
    ? scheduleTexts.publicActivityTag
    : scheduleTexts.memberOnlyActivityTag;
  const activityLines = startsAt.flatMap((activityStartsAt, index) => [
    `<b>${escapeHtml(roleTexts.agendaActivity.replace('{index}', String(index + 1)))}</b>`,
    formatHtmlField(roleTexts.agendaActivityDay, escapeHtml(formatRoleGameAgendaDay(activityStartsAt, language))),
    formatHtmlField(roleTexts.agendaActivityTime, escapeHtml(formatEventTimeRange(activityStartsAt, game.defaultDurationMinutes))),
  ]);
  return [
    `<b>${escapeHtml(prompt)}</b>`,
    `<b>${escapeHtml(roleTexts.agendaActivitiesPreview)}:</b>`,
    formatHtmlField(roleTexts.agendaActivityName, escapeHtml(game.title)),
    formatHtmlField(scheduleTexts.detailsDuration, escapeHtml(formatDurationMinutes(game.defaultDurationMinutes))),
    formatHtmlField(scheduleTexts.detailsAttendanceMode, escapeHtml(attendanceLabel)),
    formatHtmlField(scheduleTexts.detailsVisibility, escapeHtml(visibilityLabel)),
    formatHtmlField(scheduleTexts.detailsSeats, String(game.capacity)),
    formatHtmlField(scheduleTexts.detailsTable, escapeHtml(tableLabel)),
    formatHtmlField(scheduleTexts.detailsDescription, escapeHtml(game.description ?? scheduleTexts.noDescription)),
    '',
    ...activityLines,
  ].join('\n');
}

function formatRoleGameAgendaDay(startsAt: string, language: BotLanguage): string {
  const locale = ({ ca: 'ca-ES', es: 'es-ES', en: 'en-GB' } as const)[language];
  const formatted = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(startsAt)).replace(',', '');
  return `${formatted.charAt(0).toLocaleUpperCase(locale)}${formatted.slice(1)}`;
}

function sameStringList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function buildRoleGameAgendaPreviewSignature(game: RoleGameRecord, startsAt: string[]): string {
  return JSON.stringify({
    startsAt,
    title: game.title,
    description: game.description,
    durationMinutes: game.defaultDurationMinutes,
    tableId: game.defaultTableId,
    attendanceMode: game.defaultAttendanceMode,
    isPublic: game.defaultIsPublicScheduleEvent,
    capacity: game.capacity,
  });
}

function buildRoleGameRecordFromCreateDraft(draft: RoleGameCreateDraft): RoleGameRecord {
  return {
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
}

function formatRoleGameRecurrenceSummary(draft: RoleGameRecurrenceConfigDraft, language: BotLanguage): string {
  const texts = createTelegramI18n(language).roleGames;
  if (draft.schedulingMode === 'manual') {
    return escapeHtml(texts.optionNoFixedDays);
  }
  const weekday = roleGameWeekdayLabels(language)[requireDraftValue(draft.weekday)];
  const startsOn = requireDraftValue(draft.startsOn);
  const [year, month, day] = startsOn.split('-').map(Number);
  const dateLabel = formatRoleGameDateOption(new Date(year!, month! - 1, day!, 12), language);
  const templates = {
    ca: [`Cada ${requireDraftValue(draft.intervalWeeks)} setmana(es).`, `${weekday}, a partir de ${dateLabel}, a les ${requireDraftValue(draft.time)}.`, `Finestra: ${requireDraftValue(draft.windowCount)} sessions futures.`],
    es: [`Cada ${requireDraftValue(draft.intervalWeeks)} semana(s).`, `${weekday}, a partir del ${dateLabel}, a las ${requireDraftValue(draft.time)}.`, `Ventana: ${requireDraftValue(draft.windowCount)} sesiones futuras.`],
    en: [`Every ${requireDraftValue(draft.intervalWeeks)} week(s).`, `${weekday}, starting ${dateLabel}, at ${requireDraftValue(draft.time)}.`, `Window: ${requireDraftValue(draft.windowCount)} future sessions.`],
  } as const;
  return [
    ...templates[language].map(escapeHtml),
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

export async function ensureRoleGameHandoutCategory(
  context: TelegramRoleGameContext,
  repository: StorageCategoryRepository,
): Promise<StorageCategoryRecord | null> {
  const existing = await findRoleGameHandoutCategory(repository);
  if (existing) {
    return existing;
  }

  const defaultChat = await loadStorageDefaultChat(context);
  if (!defaultChat || !context.runtime.bot.createForumTopic) {
    return null;
  }

  try {
    const topic = await context.runtime.bot.createForumTopic({
      chatId: defaultChat.chatId,
      name: roleGameHandoutCategoryName,
    });
    return await createStorageCategory({
      repository,
      slug: roleGameHandoutCategorySlug,
      displayName: roleGameHandoutCategoryName,
      parentCategoryId: null,
      description: 'Material interno de partidas de rol.',
      storageChatId: defaultChat.chatId,
      storageThreadId: topic.messageThreadId,
      categoryPurpose: internalRoleGameHandoutPurpose,
    });
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'role-games.handout-storage.provision.failed',
      error: error instanceof Error ? error.message : String(error),
    }));
    return findRoleGameHandoutCategory(repository);
  }
}

async function loadStorageDefaultChat(context: TelegramRoleGameContext): Promise<{ chatId: number } | null> {
  const storage = context.storageDefaultChatStore ?? createDatabaseAppMetadataSessionStorage({
    database: context.runtime.services.database.db,
  });
  const raw = await storage.get(storageDefaultChatMetadataKey);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { chatId?: unknown };
    return typeof parsed.chatId === 'number' && Number.isSafeInteger(parsed.chatId) && parsed.chatId !== 0
      ? { chatId: parsed.chatId }
      : null;
  } catch {
    return null;
  }
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

function deriveRoleGameMaterialDraftTitle(messages: RoleGameMaterialDraftMessage[], language: BotLanguage): string {
  const caption = messages.find((message) => message.caption?.trim())?.caption?.trim();
  if (caption) {
    return truncateRoleGameMaterialSuggestedTitle(caption.replace(/\s+/g, ' '));
  }
  const fileName = messages.find((message) => message.originalFileName?.trim())?.originalFileName?.trim();
  if (fileName) {
    return truncateRoleGameMaterialSuggestedTitle(fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim());
  }
  return ({ ca: 'Material de rol', es: 'Material de rol', en: 'Role-playing material' } as const)[language];
}

function truncateRoleGameMaterialSuggestedTitle(title: string): string {
  return title.length <= 48 ? title : `${title.slice(0, 47).trimEnd()}…`;
}

function asRoleGameMaterialDraftMessages(value: unknown): RoleGameMaterialDraftMessage[] {
  return Array.isArray(value) ? value as RoleGameMaterialDraftMessage[] : [];
}

function isSupportedRoleGameMaterialAttachment(attachmentKind: string): boolean {
  return attachmentKind === 'document' || attachmentKind === 'photo' || attachmentKind === 'video' || attachmentKind === 'audio';
}

export function resolveRepository(context: TelegramRoleGameContext): RoleGameRepository {
  return context.roleGameRepository ?? createDatabaseRoleGameRepository({
    database: context.runtime.services.database.db,
  });
}

function resolveCharacterRepository(context: TelegramRoleGameContext): RoleGameCharacterRepository {
  return context.characterRepository ?? createDatabaseRoleGameCharacterRepository({
    database: context.runtime.services.database.db,
  });
}

function resolveMembershipRepository(context: TelegramRoleGameContext): MembershipAccessRepository {
  return context.membershipRepository ?? createDatabaseMembershipAccessRepository({
    database: context.runtime.services.database.db,
  });
}

async function listInvitableRoleGameUsers(
  context: TelegramRoleGameContext,
  game: RoleGameRecord,
  members: RoleGameMemberRecord[],
): Promise<MembershipUserRecord[]> {
  const activeTelegramUserIds = new Set(members
    .filter((member) => ['invited', 'requested', 'confirmed', 'waitlisted'].includes(member.status))
    .map((member) => member.telegramUserId));
  const { users } = await listManageableMembershipUsers({ repository: resolveMembershipRepository(context) });
  return users
    .filter((user) => (
      user.status === 'approved' &&
      user.telegramUserId !== context.runtime.actor.telegramUserId &&
      user.telegramUserId !== game.primaryGmTelegramUserId &&
      !activeTelegramUserIds.has(user.telegramUserId)
    ))
    .sort((left, right) => (
      new Intl.Collator(normalizeBotLanguage(context.runtime.bot.language, 'ca')).compare(left.displayName, right.displayName) ||
      left.telegramUserId - right.telegramUserId
    ));
}

function formatRoleGameInviteCandidateLink({
  gameId,
  page,
  user,
  language,
}: {
  gameId: number;
  page: number;
  user: MembershipUserRecord;
  language: BotLanguage;
}): string {
  const label = formatMembershipDisplayName(
    user,
    formatRoleGameParticipantFallbackName(language, user.telegramUserId),
  );
  const url = buildTelegramStartUrl(`${roleGameDirectInviteStartPayloadPrefix}${gameId}_${user.telegramUserId}_${page}`);
  return `- <a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
}

function resolveRoleGameInviteCandidate(
  text: string,
  candidates: MembershipUserRecord[],
): number | null {
  const usernameMatch = /^@([^\s]+)$/.exec(text.trim());
  if (!usernameMatch) return null;
  const normalizedUsername = usernameMatch[1]!.toLocaleLowerCase('en');
  return candidates.find((user) => user.username?.replace(/^@/, '').toLocaleLowerCase('en') === normalizedUsername)?.telegramUserId ?? null;
}

async function resolveRoleGameParticipantListItems(
  context: TelegramRoleGameContext,
  members: RoleGameMemberRecord[],
  language: BotLanguage,
): Promise<RoleGameParticipantListItem[]> {
  const membershipRepository = resolveMembershipRepository(context);
  return Promise.all(members.map(async (member) => {
    const user = await membershipRepository.findUserByTelegramUserId(member.telegramUserId);
    return {
      member,
      displayName: user?.displayName ?? formatRoleGameParticipantFallbackName(language, member.telegramUserId),
      username: user?.username ?? null,
    };
  }));
}

function formatRoleGameParticipantFallbackName(language: BotLanguage, telegramUserId: number): string {
  const label = language === 'ca' ? 'Usuari' : language === 'en' ? 'User' : 'Usuario';
  return `${label} ${telegramUserId}`;
}

function roleGameParticipantReservedButtonLabels(language: BotLanguage, kind: RoleGameParticipantListKind): string[] {
  const i18n = createTelegramI18n(language);
  return [
    i18n.roleGames.previousPage,
    i18n.roleGames.nextPage,
    kind === 'active' ? i18n.roleGames.participantsHistory : i18n.roleGames.currentParticipants,
    i18n.roleGames.backToGame,
    i18n.actionMenu.start,
    i18n.actionMenu.help,
  ];
}

function resolveScheduleRepository(context: TelegramRoleGameContext): ScheduleRepository {
  return context.scheduleRepository ?? createDatabaseScheduleRepository({
    database: context.runtime.services.database.db as never,
  });
}

function resolveRoleGameAutoSchedulingStore(context: TelegramRoleGameContext) {
  const storage = context.storageDefaultChatStore ?? createDatabaseAppMetadataSessionStorage({
    database: context.runtime.services.database.db,
  });
  return createAppMetadataRoleGameAutoSchedulingStore({ storage });
}

export function resolveStorageRepository(context: TelegramRoleGameContext): StorageCategoryRepository {
  return context.storageRepository ?? createDatabaseStorageRepository({
    database: context.runtime.services.database.db,
  });
}

function formatRoleGameScheduleEventLink(eventId: number, startsAt: string): string {
  return `<a href="${escapeHtml(buildTelegramStartUrl(`schedule_event_${eventId}`))}">Agenda ${escapeHtml(formatTimestamp(startsAt))}</a>`;
}
