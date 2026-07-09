import {
  canManageRoleGameOperationally,
  canViewRoleGame,
  createRoleGame,
  requestRoleGameSeat,
  resolveRoleGameSeatRequest,
  type RoleGameAcceptanceMode,
  type RoleGameEntryMode,
  type RoleGameMemberRecord,
  type RoleGamePublicJoinPolicy,
  type RoleGameRepository,
  type RoleGameRecord,
  type RoleGameSchedulingMode,
  type RoleGameType,
  type RoleGameVisibility,
} from '../role-games/role-game-catalog.js';
import { createDatabaseRoleGameRepository } from '../role-games/role-game-catalog-store.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import { createTelegramI18n, normalizeBotLanguage, type BotLanguage } from './i18n.js';
import {
  buildRoleGameHomeKeyboard,
  buildRoleGameCreateConfirmationKeyboard,
  buildRoleGameCreateStepKeyboard,
  buildRoleGameDetailInlineKeyboard,
  buildRoleGameListKeyboard,
  roleGameCallbackPrefixes,
} from './role-game-keyboards.js';
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
const roleGameStartPayloadPrefix = 'role_game_';

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
  | 'confirm';

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
  recurrenceRule?: null;
  recurrenceWindowCount?: number;
}

export type TelegramRoleGameContext = TelegramCommandHandlerContext & {
  roleGameRepository?: RoleGameRepository;
};

export { roleGameCallbackPrefixes };

export async function handleTelegramRoleGameText(context: TelegramRoleGameContext): Promise<boolean> {
  const text = context.messageText?.trim();
  if (
    !text ||
    context.runtime.chat.kind !== 'private' ||
    !context.runtime.actor.isApproved ||
    context.runtime.actor.isBlocked
  ) {
    return false;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).roleGames;

  if (text === texts.cancel) {
    await context.runtime.session.cancel();
    await context.reply(createTelegramI18n(language).common.flowCancelled, buildRoleGameHomeKeyboard(language));
    return true;
  }

  if (isRoleGameCreateSession(context)) {
    return handleRoleGameCreateStep(context, text, language);
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

export async function handleTelegramRoleGameStartText(context: TelegramRoleGameContext): Promise<boolean> {
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
  if (!callbackData || context.runtime.chat.kind !== 'private' || !context.runtime.actor.isApproved || context.runtime.actor.isBlocked) {
    return false;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
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
    const repository = resolveRepository(context);
    const member = await requestRoleGameSeat({
      repository,
      gameId,
      telegramUserId: context.runtime.actor.telegramUserId,
      actor: {
        telegramUserId: context.runtime.actor.telegramUserId,
        isAdmin: context.runtime.actor.isAdmin,
        isApproved: context.runtime.actor.isApproved,
      },
    });
    const message = member.status === 'confirmed'
      ? createTelegramI18n(language).roleGames.seatConfirmed
      : createTelegramI18n(language).roleGames.seatRequested;
    const game = await findVisibleRoleGameDetail(context, gameId);
    if (game) {
      await context.reply(`${message}\n\n${formatRoleGameDetailMessage({ game, language })}`, {
        ...buildRoleGameHomeKeyboard(language),
        parseMode: 'HTML',
      });
      return true;
    }
    await context.reply(message, buildRoleGameHomeKeyboard(language));
    return true;
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
      return advanceRoleGameCreate(context, language, 'scheduling-mode', draft, texts.promptSchedulingMode, [[
        { text: texts.optionManualScheduling, semanticRole: 'primary' },
      ]]);
    }
    if (step === 'scheduling-mode') {
      draft.schedulingMode = parseCreateOption(text, {
        manual: texts.optionManualScheduling,
      });
      await context.runtime.session.advance({ stepKey: 'confirm', data: draft });
      await context.reply(`${texts.promptConfirmCreate}\n\n${formatRoleGameCreateSummary(draft, language)}`, {
        ...buildRoleGameCreateConfirmationKeyboard(language),
        parseMode: 'HTML',
      });
      return true;
    }
    if (step === 'confirm' && text === texts.confirmCreate) {
      const game = await createRoleGame({
        repository: resolveRepository(context),
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
        recurrenceRule: null,
        recurrenceWindowCount: draft.recurrenceWindowCount ?? 0,
      });
      await context.runtime.session.cancel();
      await context.reply(`${texts.created}\n\n${formatRoleGameDetailMessage({ game, language })}`, {
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

async function replyWithRoleGameDetail(
  context: TelegramRoleGameContext,
  game: RoleGameRecord,
  language: BotLanguage,
): Promise<void> {
  const repository = resolveRepository(context);
  const actorMember = await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId);
  const members = await repository.listMembers(game.id);
  const actor = {
    telegramUserId: context.runtime.actor.telegramUserId,
    isAdmin: context.runtime.actor.isAdmin,
    isApproved: context.runtime.actor.isApproved,
  };
  const canManageRequests = canManageRoleGameOperationally(actor, game, actorMember);
  const requestMemberIds = canManageRequests
    ? members.filter((member) => member.role === 'player' && member.status === 'requested').map((member) => member.id)
    : [];
  const canRequestSeat =
    game.status === 'active' &&
    game.entryMode === 'request' &&
    !canManageRequests &&
    !(actorMember && ['invited', 'requested', 'confirmed', 'waitlisted'].includes(actorMember.status));

  await context.reply(formatRoleGameDetailMessage({ game, language }), {
    ...buildRoleGameHomeKeyboard(language),
    ...buildRoleGameDetailInlineKeyboard({
      gameId: game.id,
      canRequestSeat,
      requestMemberIds,
      language,
    }),
    parseMode: 'HTML',
  });
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
  const normalized = text?.trim();
  if (!normalized) {
    return null;
  }
  const payload = normalized.startsWith('/start ') ? normalized.slice('/start '.length).trim() : normalized;
  if (!payload.startsWith(roleGameStartPayloadPrefix)) {
    return null;
  }
  return parsePositiveInteger(payload.slice(roleGameStartPayloadPrefix.length));
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

function parseCreateOption<T extends string>(text: string, options: Record<T, string>): T {
  const normalizedText = normalizeOptionText(text);
  const found = Object.entries(options).find(([, label]) => normalizeOptionText(label as string) === normalizedText);
  if (!found) {
    throw new Error('invalid option');
  }
  return found[0] as T;
}

function normalizeOptionText(value: string): string {
  return value.trim().toLocaleLowerCase('es');
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
    recurrenceRule: null,
    recurrenceWindowCount: draft.recurrenceWindowCount ?? 0,
    createdByTelegramUserId: 0,
    createdAt: '',
    updatedAt: '',
    closedAt: null,
  };
  return formatRoleGameDetailMessage({ game, language });
}

function resolveRepository(context: TelegramRoleGameContext): RoleGameRepository {
  return context.roleGameRepository ?? createDatabaseRoleGameRepository({
    database: context.runtime.services.database.db,
  });
}
