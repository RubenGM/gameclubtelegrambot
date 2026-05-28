import {
  cancelLfgGroupAd,
  cancelLfgPlayerAd,
  createLfgGroupAd,
  resolveLfgGroupAd,
  resolveLfgPlayerAd,
  updateLfgGroupAd,
  updateLfgPlayerAd,
  upsertLfgPlayerAd,
  type LfgRepository,
} from '../lfg/lfg-catalog.js';
import { createDatabaseLfgRepository } from '../lfg/lfg-catalog-store.js';
import {
  lfgGroupNewsCategory,
  lfgPlayerNewsCategory,
  type NewsGroupRepository,
} from '../news/news-group-catalog.js';
import { createDatabaseNewsGroupRepository } from '../news/news-group-store.js';
import { resolveTelegramDisplayName } from '../membership/display-name.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import { resolveTelegramActionMenu } from './action-menu.js';
import { createTelegramI18n, normalizeBotLanguage, type BotLanguage } from './i18n.js';
import {
  buildLfgMenuOptions,
  buildLfgMyGroupAdOptions,
  buildLfgMyPlayerAdOptions,
  buildLfgSaveOptions,
  buildLfgSingleCancelKeyboard,
  buildLfgSkipCancelKeyboard,
  lfgCallbackPrefixes,
} from './lfg-keyboards.js';
import {
  formatLfgGroupAdDetail,
  formatLfgGroupAdBroadcast,
  formatLfgGroupAdListMessage,
  formatLfgGroupDraftSummary,
  formatLfgMyAdsMessage,
  formatLfgPlayerAdBroadcast,
  formatLfgPlayerAdDetail,
  formatLfgPlayerAdListMessage,
  formatLfgPlayerDraftSummary,
} from './lfg-presentation.js';

const playerFlowKey = 'lfg-player-ad';
const groupFlowKey = 'lfg-group-ad';

interface LfgPlayerAdDraft {
  adId?: number;
  description?: string;
  isEdit?: boolean;
}

interface LfgGroupAdDraft {
  adId?: number;
  title?: string;
  description?: string;
  seatsAvailable?: number | null;
  isEdit?: boolean;
}

export type TelegramLfgContext = TelegramCommandHandlerContext & {
  lfgRepository?: LfgRepository;
  newsGroupRepository?: NewsGroupRepository;
};

export { lfgCallbackPrefixes };

export async function handleTelegramLfgCommand(context: TelegramLfgContext): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  await context.reply(createTelegramI18n(language).lfg.selectMenu, buildLfgMenuOptions(language));
}

export async function handleTelegramLfgText(context: TelegramLfgContext): Promise<boolean> {
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
  const i18n = createTelegramI18n(language);
  const texts = i18n.lfg;

  if (context.runtime.session.current?.flowKey === playerFlowKey) {
    return handleActivePlayerFlow(context, text, language);
  }
  if (context.runtime.session.current?.flowKey === groupFlowKey) {
    return handleActiveGroupFlow(context, text, language);
  }

  if (text === i18n.actionMenu.lfg || text === texts.openMenu || text === '/lfg') {
    await handleTelegramLfgCommand(context);
    return true;
  }

  if (text === texts.playersList) {
    const ads = await resolveRepository(context).listActivePlayerAds();
    await context.reply(
      ads.length === 0 ? texts.noPlayerAds : formatLfgPlayerAdListMessage({ ads, language }),
      {
        ...buildLfgMenuOptions(language),
        ...(ads.length > 0 ? { parseMode: 'HTML' as const } : {}),
      },
    );
    return true;
  }

  if (text === texts.groupsList) {
    const ads = await resolveRepository(context).listActiveGroupAds();
    await context.reply(
      ads.length === 0 ? texts.noGroupAds : formatLfgGroupAdListMessage({ ads, language }),
      {
        ...buildLfgMenuOptions(language),
        ...(ads.length > 0 ? { parseMode: 'HTML' as const } : {}),
      },
    );
    return true;
  }

  if (text === texts.myAds) {
    await replyWithMyAds(context, language);
    return true;
  }

  if (text === texts.playerCreate) {
    await context.runtime.session.start({ flowKey: playerFlowKey, stepKey: 'description', data: {} });
    await context.reply(texts.askPlayerDescription, buildLfgSingleCancelKeyboard());
    return true;
  }

  if (text === texts.groupCreate) {
    await context.runtime.session.start({ flowKey: groupFlowKey, stepKey: 'title', data: {} });
    await context.reply(texts.askGroupTitle, buildLfgSingleCancelKeyboard());
    return true;
  }

  if (text === texts.back) {
    await context.reply(i18n.common.helpMenuHint, resolveTelegramActionMenu({
      context: {
        actor: context.runtime.actor,
        authorization: context.runtime.authorization,
        chat: context.runtime.chat,
        session: context.runtime.session.current,
        language,
      },
    }));
    return true;
  }

  return false;
}

export async function handleTelegramLfgCallback(context: TelegramLfgContext): Promise<boolean> {
  const callbackData = context.callbackData;
  if (!callbackData || context.runtime.chat.kind !== 'private' || !context.runtime.actor.isApproved) {
    return false;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).lfg;

  try {
    if (callbackData.startsWith(lfgCallbackPrefixes.editPlayer)) {
      const adId = parseEntityId(callbackData, lfgCallbackPrefixes.editPlayer);
      const ad = await resolveRepository(context).findPlayerAdById(adId);
      if (!ad || ad.telegramUserId !== context.runtime.actor.telegramUserId || ad.status !== 'active') {
        await context.reply(texts.staleAction, buildLfgMenuOptions(language));
        return true;
      }
      await context.runtime.session.start({
        flowKey: playerFlowKey,
        stepKey: 'description',
        data: { adId, description: ad.description, isEdit: true },
      });
      await context.reply(texts.askPlayerDescription, buildLfgSingleCancelKeyboard());
      return true;
    }

    if (callbackData.startsWith(lfgCallbackPrefixes.editGroup)) {
      const adId = parseEntityId(callbackData, lfgCallbackPrefixes.editGroup);
      const ad = await resolveRepository(context).findGroupAdById(adId);
      if (!ad || ad.createdByTelegramUserId !== context.runtime.actor.telegramUserId || ad.status !== 'active') {
        await context.reply(texts.staleAction, buildLfgMenuOptions(language));
        return true;
      }
      await context.runtime.session.start({
        flowKey: groupFlowKey,
        stepKey: 'title',
        data: {
          adId,
          title: ad.title,
          description: ad.description,
          seatsAvailable: ad.seatsAvailable,
          isEdit: true,
        },
      });
      await context.reply(texts.askGroupTitle, buildLfgSingleCancelKeyboard());
      return true;
    }

    if (callbackData.startsWith(lfgCallbackPrefixes.resolvePlayer)) {
      await resolveLfgPlayerAd({
        repository: resolveRepository(context),
        adId: parseEntityId(callbackData, lfgCallbackPrefixes.resolvePlayer),
        actorTelegramUserId: context.runtime.actor.telegramUserId,
      });
      await context.reply(texts.resolved, buildLfgMenuOptions(language));
      await replyWithMyAds(context, language);
      return true;
    }

    if (callbackData.startsWith(lfgCallbackPrefixes.cancelPlayer)) {
      await cancelLfgPlayerAd({
        repository: resolveRepository(context),
        adId: parseEntityId(callbackData, lfgCallbackPrefixes.cancelPlayer),
        actorTelegramUserId: context.runtime.actor.telegramUserId,
      });
      await context.reply(texts.cancelled, buildLfgMenuOptions(language));
      await replyWithMyAds(context, language);
      return true;
    }

    if (callbackData.startsWith(lfgCallbackPrefixes.resolveGroup)) {
      await resolveLfgGroupAd({
        repository: resolveRepository(context),
        adId: parseEntityId(callbackData, lfgCallbackPrefixes.resolveGroup),
        actorTelegramUserId: context.runtime.actor.telegramUserId,
      });
      await context.reply(texts.resolved, buildLfgMenuOptions(language));
      await replyWithMyAds(context, language);
      return true;
    }

    if (callbackData.startsWith(lfgCallbackPrefixes.cancelGroup)) {
      await cancelLfgGroupAd({
        repository: resolveRepository(context),
        adId: parseEntityId(callbackData, lfgCallbackPrefixes.cancelGroup),
        actorTelegramUserId: context.runtime.actor.telegramUserId,
      });
      await context.reply(texts.cancelled, buildLfgMenuOptions(language));
      await replyWithMyAds(context, language);
      return true;
    }
  } catch (error) {
    await context.reply(texts.staleAction, buildLfgMenuOptions(language));
    return true;
  }

  return false;
}

async function handleActivePlayerFlow(context: TelegramLfgContext, text: string, language: BotLanguage): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== playerFlowKey) {
    return false;
  }

  const texts = createTelegramI18n(language).lfg;
  const draft = session.data as LfgPlayerAdDraft;

  if (session.stepKey === 'description') {
    const description = normalizeDescriptionInput(text);
    if (description === null) {
      await context.reply(texts.invalidDescription, buildLfgSingleCancelKeyboard());
      return true;
    }
    const nextDraft = { ...draft, description };
    await context.runtime.session.advance({ stepKey: 'confirm', data: nextDraft });
    await context.reply(
      formatLfgPlayerDraftSummary({
        description,
        displayName: resolveActorDisplayName(context),
        language,
        isEdit: Boolean(nextDraft.isEdit),
      }),
      { ...buildLfgSaveOptions({ language, mode: nextDraft.isEdit ? 'player-edit' : 'player-create' }), parseMode: 'HTML' },
    );
    return true;
  }

  if (session.stepKey === 'confirm') {
    const expected = draft.isEdit ? texts.saveChanges : texts.savePlayerAd;
    if (text !== expected) {
      await context.reply(
        formatLfgPlayerDraftSummary({
          description: draft.description ?? '',
          displayName: resolveActorDisplayName(context),
          language,
          isEdit: Boolean(draft.isEdit),
        }),
        { ...buildLfgSaveOptions({ language, mode: draft.isEdit ? 'player-edit' : 'player-create' }), parseMode: 'HTML' },
      );
      return true;
    }

    if (draft.isEdit && draft.adId !== undefined) {
      await updateLfgPlayerAd({
        repository: resolveRepository(context),
        adId: draft.adId,
        telegramUserId: context.runtime.actor.telegramUserId,
        displayName: resolveActorDisplayName(context),
        description: draft.description ?? '',
      });
      await context.runtime.session.cancel();
      await context.reply(texts.playerUpdated, buildLfgMenuOptions(language));
      return true;
    }

    const saved = await upsertLfgPlayerAd({
      repository: resolveRepository(context),
      telegramUserId: context.runtime.actor.telegramUserId,
      displayName: resolveActorDisplayName(context),
      description: draft.description ?? '',
    });
    await publishLfgPlayerAdAnnouncement(context, saved.id, language);
    await context.runtime.session.cancel();
    await context.reply(texts.playerSaved, buildLfgMenuOptions(language));
    return true;
  }

  return true;
}

async function handleActiveGroupFlow(context: TelegramLfgContext, text: string, language: BotLanguage): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== groupFlowKey) {
    return false;
  }

  const texts = createTelegramI18n(language).lfg;
  const draft = session.data as LfgGroupAdDraft;

  if (session.stepKey === 'title') {
    const title = normalizeTitleInput(text);
    if (title === null) {
      await context.reply(texts.invalidTitle, buildLfgSingleCancelKeyboard());
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'description', data: { ...draft, title } });
    await context.reply(texts.askGroupDescription, buildLfgSingleCancelKeyboard());
    return true;
  }

  if (session.stepKey === 'description') {
    const description = normalizeDescriptionInput(text);
    if (description === null) {
      await context.reply(texts.invalidDescription, buildLfgSingleCancelKeyboard());
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'seats', data: { ...draft, description } });
    await context.reply(texts.askGroupSeats, buildLfgSkipCancelKeyboard(language));
    return true;
  }

  if (session.stepKey === 'seats') {
    const seatsAvailable = text === texts.skipOptional ? null : parseSeats(text);
    if (seatsAvailable === undefined) {
      await context.reply(texts.invalidSeats, buildLfgSkipCancelKeyboard(language));
      return true;
    }
    const nextDraft = { ...draft, seatsAvailable };
    await context.runtime.session.advance({ stepKey: 'confirm', data: nextDraft });
    await context.reply(
      formatLfgGroupDraftSummary({
        title: nextDraft.title ?? '',
        description: nextDraft.description ?? '',
        seatsAvailable,
        creatorDisplayName: resolveActorDisplayName(context),
        language,
        isEdit: Boolean(nextDraft.isEdit),
      }),
      { ...buildLfgSaveOptions({ language, mode: nextDraft.isEdit ? 'group-edit' : 'group-create' }), parseMode: 'HTML' },
    );
    return true;
  }

  if (session.stepKey === 'confirm') {
    const expected = draft.isEdit ? texts.saveChanges : texts.saveGroupAd;
    if (text !== expected) {
      await context.reply(
        formatLfgGroupDraftSummary({
          title: draft.title ?? '',
          description: draft.description ?? '',
          seatsAvailable: draft.seatsAvailable ?? null,
          creatorDisplayName: resolveActorDisplayName(context),
          language,
          isEdit: Boolean(draft.isEdit),
        }),
        { ...buildLfgSaveOptions({ language, mode: draft.isEdit ? 'group-edit' : 'group-create' }), parseMode: 'HTML' },
      );
      return true;
    }

    if (draft.isEdit && draft.adId !== undefined) {
      await updateLfgGroupAd({
        repository: resolveRepository(context),
        adId: draft.adId,
        actorTelegramUserId: context.runtime.actor.telegramUserId,
        title: draft.title ?? '',
        description: draft.description ?? '',
        seatsAvailable: draft.seatsAvailable ?? null,
      });
      await context.runtime.session.cancel();
      await context.reply(texts.groupUpdated, buildLfgMenuOptions(language));
      return true;
    }

    const saved = await createLfgGroupAd({
      repository: resolveRepository(context),
      createdByTelegramUserId: context.runtime.actor.telegramUserId,
      creatorDisplayName: resolveActorDisplayName(context),
      title: draft.title ?? '',
      description: draft.description ?? '',
      seatsAvailable: draft.seatsAvailable ?? null,
    });
    await publishLfgGroupAdAnnouncement(context, saved.id, language);
    await context.runtime.session.cancel();
    await context.reply(texts.groupSaved, buildLfgMenuOptions(language));
    return true;
  }

  return true;
}

async function replyWithMyAds(context: TelegramLfgContext, language: BotLanguage): Promise<void> {
  const texts = createTelegramI18n(language).lfg;
  const ads = await resolveRepository(context).listActiveAdsByUser(context.runtime.actor.telegramUserId);
  if (ads.playerAds.length === 0 && ads.groupAds.length === 0) {
    await context.reply(texts.noMyAds, buildLfgMenuOptions(language));
    return;
  }

  await context.reply(
    formatLfgMyAdsMessage({ playerAds: ads.playerAds, groupAds: ads.groupAds, language }),
    { ...buildLfgMenuOptions(language), parseMode: 'HTML' },
  );
  for (const ad of ads.playerAds) {
    await context.reply(formatLfgPlayerAdDetail({ ad, language }), { ...buildLfgMyPlayerAdOptions(ad.id, language), parseMode: 'HTML' });
  }
  for (const ad of ads.groupAds) {
    await context.reply(formatLfgGroupAdDetail({ ad, language }), { ...buildLfgMyGroupAdOptions(ad.id, language), parseMode: 'HTML' });
  }
}

function resolveRepository(context: TelegramLfgContext): LfgRepository {
  return context.lfgRepository ?? createDatabaseLfgRepository({ database: context.runtime.services.database.db });
}

function resolveNewsGroupRepository(context: TelegramLfgContext): NewsGroupRepository {
  return (
    context.newsGroupRepository ??
    createDatabaseNewsGroupRepository({ database: context.runtime.services.database.db as never })
  );
}

async function publishLfgPlayerAdAnnouncement(
  context: TelegramLfgContext,
  adId: number,
  language: BotLanguage,
): Promise<void> {
  const ad = await resolveRepository(context).findPlayerAdById(adId);
  if (!ad) {
    return;
  }

  await publishLfgAnnouncement(context, {
    categoryKey: lfgPlayerNewsCategory,
    message: formatLfgPlayerAdBroadcast({ ad, language }),
  });
}

async function publishLfgGroupAdAnnouncement(
  context: TelegramLfgContext,
  adId: number,
  language: BotLanguage,
): Promise<void> {
  const ad = await resolveRepository(context).findGroupAdById(adId);
  if (!ad) {
    return;
  }

  await publishLfgAnnouncement(context, {
    categoryKey: lfgGroupNewsCategory,
    message: formatLfgGroupAdBroadcast({ ad, language }),
  });
}

async function publishLfgAnnouncement(
  context: TelegramLfgContext,
  {
    categoryKey,
    message,
  }: {
    categoryKey: string;
    message: string;
  },
): Promise<void> {
  const sendGroupMessage = context.runtime.bot.sendGroupMessage;
  if (!sendGroupMessage) {
    return;
  }

  const groups = await resolveNewsGroupRepository(context).listSubscribedGroupsByCategory(categoryKey);
  if (groups.length === 0) {
    return;
  }

  await Promise.all(
    groups.map(async (group) => {
      try {
        await sendGroupMessage(group.chatId, message, {
          parseMode: 'HTML',
          ...(group.messageThreadId ? { messageThreadId: group.messageThreadId } : {}),
        });
      } catch {
        // No bloqueja la publicació local de l'anunci LFG.
      }
    }),
  );
}

function resolveActorDisplayName(context: TelegramLfgContext): string {
  return resolveTelegramDisplayName(context.from);
}

function normalizeDescriptionInput(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length >= 10 && normalized.length <= 500 ? normalized : null;
}

function normalizeTitleInput(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length >= 3 && normalized.length <= 120 ? normalized : null;
}

function parseSeats(value: string): number | undefined {
  if (!/^\d+$/.test(value.trim())) {
    return undefined;
  }
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 99) {
    return undefined;
  }
  return parsed;
}

function parseEntityId(callbackData: string, prefix: string): number {
  const raw = callbackData.slice(prefix.length);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid LFG callback target ${raw}`);
  }
  return parsed;
}
