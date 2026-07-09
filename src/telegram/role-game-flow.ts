import { canViewRoleGame, type RoleGameRepository, type RoleGameRecord } from '../role-games/role-game-catalog.js';
import { createDatabaseRoleGameRepository } from '../role-games/role-game-catalog-store.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import { createTelegramI18n, normalizeBotLanguage, type BotLanguage } from './i18n.js';
import {
  buildRoleGameHomeKeyboard,
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

const roleGameListFlowKey = 'role-games-list';
const roleGameStartPayloadPrefix = 'role_game_';

type RoleGameListKind = 'mine' | 'visible';

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

  if (text === texts.cancel) {
    await context.runtime.session.cancel();
    await context.reply(createTelegramI18n(language).common.flowCancelled, buildRoleGameHomeKeyboard(language));
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

  await context.reply(formatRoleGameDetailMessage({ game, language }), {
    ...buildRoleGameHomeKeyboard(language),
    parseMode: 'HTML',
  });
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
    await context.reply(
      game ? formatRoleGameDetailMessage({ game, language }) : createTelegramI18n(language).roleGames.notFound,
      game ? { ...buildRoleGameHomeKeyboard(language), parseMode: 'HTML' } : buildRoleGameHomeKeyboard(language),
    );
    return true;
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

function resolveRepository(context: TelegramRoleGameContext): RoleGameRepository {
  return context.roleGameRepository ?? createDatabaseRoleGameRepository({
    database: context.runtime.services.database.db,
  });
}
