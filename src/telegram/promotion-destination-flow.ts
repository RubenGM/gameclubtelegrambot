import {
  promotionsNewsGroupCategory,
  resolvePromotionDestinationDisplayName,
  setPromotionDestinationDisplayName,
  type NewsGroupRepository,
} from '../news/news-group-catalog.js';
import { createDatabaseNewsGroupRepository } from '../news/news-group-store.js';
import type { TelegramActor } from './actor-store.js';
import type { TelegramChatContext } from './chat-context.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import { normalizeBotLanguage } from './i18n.js';

interface PromotionDestination {
  chatId: number;
  messageThreadId: number | null;
}

export interface TelegramPromotionDestinationContext {
  messageText?: string;
  reply(message: string, options?: TelegramReplyOptions): Promise<unknown>;
  runtime: {
    actor: TelegramActor;
    chat: TelegramChatContext;
    services: {
      database: {
        db: unknown;
      };
    };
    bot: {
      language?: string;
      getChat?(chatId: number): Promise<{
        id: number;
        type: string;
        title?: string;
        isForum?: boolean;
      }>;
    };
  };
  newsGroupRepository?: NewsGroupRepository;
}

export async function handleTelegramPromotionDestinationText(
  context: TelegramPromotionDestinationContext,
): Promise<boolean> {
  const text = context.messageText?.trim();
  if (!text || context.runtime.chat.kind !== 'private') {
    return false;
  }
  const [commandToken = '', actionToken = '', ...args] = text.split(/\s+/);
  if (!/^\/promociones(?:@\w+)?$/i.test(commandToken)) {
    return false;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  if (!context.runtime.actor.isAdmin) {
    await context.reply(promotionDestinationTexts(language).adminOnly);
    return true;
  }

  const action = normalizePromotionDestinationAction(actionToken);
  if (!action) {
    await context.reply(promotionDestinationTexts(language).help);
    return true;
  }

  try {
    const texts = promotionDestinationTexts(language);
    const {
      destination: parsedDestination,
      displayName,
      isDefault,
    } = parsePromotionDestinationArguments(args, action, texts);
    const repository = resolveNewsGroupRepository(context);
    let group = await repository.findGroupByChatId(parsedDestination.chatId);
    if (!group?.isEnabled) {
      throw new Error(promotionDestinationTexts(language).unknownGroup);
    }
    if (displayName) {
      group = await repository.upsertGroup({
        chatId: group.chatId,
        isEnabled: group.isEnabled,
        metadata: setPromotionDestinationDisplayName(group.metadata, parsedDestination.messageThreadId, displayName),
      });
    }
    const storedDisplayName = displayName
      ?? resolvePromotionDestinationDisplayName(group.metadata, parsedDestination.messageThreadId);
    const { destination, label: destinationLabel } = await resolvePromotionDestination(
      context,
      parsedDestination,
      storedDisplayName,
    );

    if (action === 'unsubscribe') {
      const removed = await repository.deleteSubscription({
        ...destination,
        categoryKey: promotionsNewsGroupCategory,
      });
      if (removed) {
        await repository.upsertGroup({
          chatId: group.chatId,
          isEnabled: group.isEnabled,
          metadata: setPromotionDestinationDisplayName(group.metadata, destination.messageThreadId, null),
        });
      }
      await context.reply(
        removed
          ? promotionDestinationTexts(language).removed.replace('{destination}', destinationLabel)
          : promotionDestinationTexts(language).notSubscribed.replace('{destination}', destinationLabel),
      );
      return true;
    }

    await repository.upsertSubscription({
      ...destination,
      categoryKey: promotionsNewsGroupCategory,
      ...(isDefault ? { isDefault: true } : {}),
    });
    await context.reply(
      (isDefault
        ? promotionDestinationTexts(language).subscribedDefault
        : promotionDestinationTexts(language).subscribed
      ).replace('{destination}', destinationLabel),
    );
    return true;
  } catch (error) {
    await context.reply(error instanceof Error ? error.message : promotionDestinationTexts(language).invalidLink);
    return true;
  }
}

export function parseTelegramPromotionDestinationLink(value: string): PromotionDestination {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('INVALID_PROMOTION_DESTINATION_LINK');
  }
  const hostname = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  if (
    url.protocol !== 'https:'
    || !['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me'].includes(hostname)
    || parts[0]?.toLowerCase() !== 'c'
    || parts.length < 3
    || !/^\d+$/.test(parts[1] ?? '')
    || parts.slice(2).some((part) => !/^\d+$/.test(part))
  ) {
    throw new Error('INVALID_PROMOTION_DESTINATION_LINK');
  }

  const chatId = Number(`-100${parts[1]}`);
  const linkedTopicOrMessageId = Number(parts[2]);
  const messageThreadId = parts.length >= 4 || linkedTopicOrMessageId !== 1
    ? linkedTopicOrMessageId
    : null;
  if (
    !Number.isSafeInteger(chatId)
    || chatId >= 0
    || (messageThreadId !== null && (!Number.isSafeInteger(messageThreadId) || messageThreadId <= 0))
  ) {
    throw new Error('INVALID_PROMOTION_DESTINATION_LINK');
  }
  return { chatId, messageThreadId };
}

function parsePromotionDestinationArguments(
  args: string[],
  action: 'subscribe' | 'unsubscribe',
  texts: ReturnType<typeof promotionDestinationTexts>,
): { destination: PromotionDestination; displayName: string | null; isDefault: boolean } {
  const linkIndexes = args
    .map((arg, index) => (/^https:\/\//i.test(arg) ? index : -1))
    .filter((index) => index >= 0);
  if (linkIndexes.length !== 1) {
    throw new Error(texts.linkRequired);
  }
  const linkIndex = linkIndexes[0]!;
  const optionParts = args.slice(0, linkIndex);
  const isDefault = optionParts.length === 1 && optionParts[0]?.toLowerCase() === 'default';
  if (optionParts.length > 0 && !isDefault) {
    throw new Error(texts.linkRequired);
  }
  if (action === 'unsubscribe' && isDefault) {
    throw new Error(texts.defaultOnlyOnSubscribe);
  }
  const link = args[linkIndex]!;
  const displayNameParts = args.slice(linkIndex + 1);
  const displayName = displayNameParts.join(' ').trim() || null;
  if (displayName && displayName.length > 128) {
    throw new Error(texts.nameTooLong);
  }
  try {
    return {
      destination: parseTelegramPromotionDestinationLink(link!),
      displayName,
      isDefault,
    };
  } catch {
    throw new Error(texts.invalidLink);
  }
}

function normalizePromotionDestinationAction(value: string): 'subscribe' | 'unsubscribe' | null {
  const normalized = value.trim().toLowerCase();
  if (['subscribe', 'subscriure', 'suscribir', 'add'].includes(normalized)) {
    return 'subscribe';
  }
  if (['unsubscribe', 'desubscriure', 'desuscribir', 'remove'].includes(normalized)) {
    return 'unsubscribe';
  }
  return null;
}

function resolveNewsGroupRepository(context: TelegramPromotionDestinationContext): NewsGroupRepository {
  return context.newsGroupRepository
    ?? createDatabaseNewsGroupRepository({ database: context.runtime.services.database.db as never });
}

async function resolvePromotionDestination(
  context: TelegramPromotionDestinationContext,
  destination: PromotionDestination,
  displayName: string | null,
): Promise<{ destination: PromotionDestination; label: string }> {
  let chatName = `chat ${destination.chatId}`;
  let resolvedDestination = destination;
  if (context.runtime.bot.getChat) {
    try {
      const chat = await context.runtime.bot.getChat(destination.chatId);
      chatName = chat.title?.trim() || chatName;
      if (!chat.isForum && destination.messageThreadId !== null) {
        resolvedDestination = { ...destination, messageThreadId: null };
      }
    } catch {
      throw new Error(promotionDestinationTexts(normalizeBotLanguage(context.runtime.bot.language, 'ca')).unreachableGroup);
    }
  }
  return {
    destination: resolvedDestination,
    label: `${chatName} · ${displayName
      ?? (resolvedDestination.messageThreadId ? `topic ${resolvedDestination.messageThreadId}` : 'General')}`,
  };
}

function promotionDestinationTexts(language: 'ca' | 'es' | 'en') {
  if (language === 'es') {
    return {
      adminOnly: 'Sólo los administradores pueden configurar destinos de promociones.',
      help: [
        'Configura destinos de promociones sin escribir en los grupos:',
        '/promociones suscribir <enlace> [nombre a mostrar]',
        '/promociones suscribir default <enlace> [nombre a mostrar]',
        '/promociones desuscribir <enlace>',
      ].join('\n'),
      unknownGroup: 'Ese grupo no está habilitado en el bot. Un admin debe activar primero /news en el grupo.',
      unreachableGroup: 'El bot ya no puede acceder al grupo del enlace.',
      invalidLink: 'El enlace de Telegram no es válido.',
      defaultOnlyOnSubscribe: 'La opción default sólo se puede usar al suscribir un destino.',
      linkRequired: 'Debes indicar un único enlace privado de Telegram, por ejemplo https://t.me/c/3515960088/1.',
      nameTooLong: 'El nombre a mostrar no puede superar los 128 caracteres.',
      subscribed: 'Destino de promociones añadido: {destination}.',
      subscribedDefault: 'Destino de promociones añadido y marcado como predeterminado: {destination}.',
      removed: 'Destino de promociones eliminado: {destination}.',
      notSubscribed: 'Ese destino no estaba suscrito a promociones: {destination}.',
    };
  }
  if (language === 'en') {
    return {
      adminOnly: 'Only administrators can configure promotion destinations.',
      help: [
        'Configure promotion destinations without posting in groups:',
        '/promociones subscribe <link> [display name]',
        '/promociones subscribe default <link> [display name]',
        '/promociones unsubscribe <link>',
      ].join('\n'),
      unknownGroup: 'That group is not enabled in the bot. An admin must first enable /news in the group.',
      unreachableGroup: 'The bot can no longer access the group in that link.',
      invalidLink: 'The Telegram link is invalid.',
      defaultOnlyOnSubscribe: 'The default option can only be used when subscribing a destination.',
      linkRequired: 'Provide exactly one private Telegram link, for example https://t.me/c/3515960088/1.',
      nameTooLong: 'The display name cannot exceed 128 characters.',
      subscribed: 'Promotion destination added: {destination}.',
      subscribedDefault: 'Promotion destination added and marked as default: {destination}.',
      removed: 'Promotion destination removed: {destination}.',
      notSubscribed: 'That destination was not subscribed to promotions: {destination}.',
    };
  }
  return {
    adminOnly: 'Només els administradors poden configurar destinacions de promocions.',
    help: [
      'Configura destinacions de promocions sense escriure als grups:',
      '/promociones subscriure <enllaç> [nom visible]',
      '/promociones subscriure default <enllaç> [nom visible]',
      '/promociones desubscriure <enllaç>',
    ].join('\n'),
    unknownGroup: "Aquest grup no està habilitat al bot. Un admin hi ha d'activar primer /news.",
    unreachableGroup: "El bot ja no pot accedir al grup de l'enllaç.",
    invalidLink: "L'enllaç de Telegram no és vàlid.",
    defaultOnlyOnSubscribe: "L'opció default només es pot usar en subscriure una destinació.",
    linkRequired: "Has d'indicar un únic enllaç privat de Telegram, per exemple https://t.me/c/3515960088/1.",
    nameTooLong: 'El nom visible no pot superar els 128 caràcters.',
    subscribed: 'Destinació de promocions afegida: {destination}.',
    subscribedDefault: 'Destinació de promocions afegida i marcada com a predeterminada: {destination}.',
    removed: 'Destinació de promocions eliminada: {destination}.',
    notSubscribed: 'Aquesta destinació no estava subscrita a promocions: {destination}.',
  };
}
