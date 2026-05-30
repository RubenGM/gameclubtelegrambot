import type { AuthorizationService } from '../authorization/service.js';
import {
  eventsNewsGroupCategory,
  newsGroupCategoryLabel,
  type NewsGroupCategoryKey,
  listNewsGroupCategories,
  normalizeMessageThreadId,
  normalizeNewsGroupCategoryKey,
  resolveNewsGroupCategory,
} from '../news/news-group-catalog.js';
import type { NewsGroupRecord, NewsGroupRepository, NewsGroupSubscriptionRecord } from '../news/news-group-catalog.js';
import { createDatabaseNewsGroupRepository } from '../news/news-group-store.js';
import type { TelegramActor } from './actor-store.js';
import type { TelegramChatContext } from './chat-context.js';
import type { ConversationSessionRuntime } from './conversation-session.js';
import { extractTelegramReplyMessageId } from './editable-progress.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';

const newsGroupReplyAutodeleteDelayMs = 60_000;

export const newsGroupCallbackPrefixes = {
  toggle: 'news_group:toggle',
  refresh: 'news_group:refresh',
  subscribe: 'news_group:subscribe:',
  unsubscribe: 'news_group:unsubscribe:',
} as const;

export interface TelegramNewsGroupContext {
  callbackData?: string;
  messageThreadId?: number;
  messageText?: string | undefined;
  reply(message: string, options?: TelegramReplyOptions): Promise<unknown>;
  runtime: {
    actor: TelegramActor;
    authorization: AuthorizationService;
    session: ConversationSessionRuntime;
    chat: TelegramChatContext;
    services: {
      database: {
        db: unknown;
      };
    };
    bot: {
      publicName: string;
      clubName: string;
      language?: string;
      sendPrivateMessage(telegramUserId: number, message: string): Promise<void>;
      deleteMessage?(input: { chatId: number; messageId: number }): Promise<void>;
    };
  };
  newsGroupRepository?: NewsGroupRepository;
}

export async function handleTelegramNewsGroupCallback(context: TelegramNewsGroupContext): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const i18n = createTelegramI18n(language);
  const callbackData = context.callbackData;

  if (!callbackData || !isNewsGroupChat(context.runtime.chat.kind)) {
    return false;
  }

  if (!canManageNewsGroups(context)) {
    await replyWithAutodelete(context, i18n.newsGroup.adminOnly);
    return true;
  }

  const repository = resolveNewsGroupRepository(context);
  const chatId = context.runtime.chat.chatId;
  const messageThreadId = resolveNewsTargetMessageThreadId(context);

  if (callbackData === newsGroupCallbackPrefixes.toggle) {
    const group = await ensureNewsGroupExists(repository, chatId);
    const isEnabled = !group.isEnabled;
    await repository.upsertGroup({ chatId, isEnabled });
    if (isEnabled && messageThreadId) {
      await repository.upsertSubscription({ chatId, messageThreadId, categoryKey: eventsNewsGroupCategory });
    }
    await replyWithNewsGroupStatus(
      context,
      repository,
      chatId,
      messageThreadId,
      language,
      i18n,
      isEnabled && messageThreadId ? buildNewsGroupSubscriptionConfirmation(context, eventsNewsGroupCategory, messageThreadId, language) : undefined,
    );
    return true;
  }

  if (callbackData === newsGroupCallbackPrefixes.refresh) {
    await replyWithNewsGroupStatus(context, repository, chatId, messageThreadId, language, i18n);
    return true;
  }

  if (callbackData.startsWith(newsGroupCallbackPrefixes.subscribe)) {
    const rawCategoryKey = callbackData.slice(newsGroupCallbackPrefixes.subscribe.length);
    try {
      const categoryKey = parseCategoryKey(rawCategoryKey, i18n);
      await ensureNewsGroupExists(repository, chatId);
      await repository.upsertSubscription({ chatId, messageThreadId, categoryKey });
      await replyWithNewsGroupStatus(
        context,
        repository,
        chatId,
        messageThreadId,
        language,
        i18n,
        buildNewsGroupSubscriptionConfirmation(context, categoryKey, messageThreadId, language),
      );
    } catch (error) {
      await replyWithAutodelete(context, error instanceof Error ? error.message : 'Invalid category');
    }
    return true;
  }

  if (callbackData.startsWith(newsGroupCallbackPrefixes.unsubscribe)) {
    const rawCategoryKey = callbackData.slice(newsGroupCallbackPrefixes.unsubscribe.length);
    try {
      const categoryKey = parseCategoryKey(rawCategoryKey, i18n);
      const removed = await repository.deleteSubscription({ chatId, messageThreadId, categoryKey });
      await replyWithNewsGroupStatus(
        context,
        repository,
        chatId,
        messageThreadId,
        language,
        i18n,
        removed
          ? i18n.newsGroup.categoryRemoved.replace('{category}', formatCategoryLabelFromKey(categoryKey, language))
          : i18n.newsGroup.categoryNotSubscribed.replace('{category}', formatCategoryLabelFromKey(categoryKey, language)),
      );
    } catch (error) {
      await replyWithAutodelete(context, error instanceof Error ? error.message : 'Invalid category');
    }
    return true;
  }

  return false;
}

export async function handleTelegramNewsGroupText(context: TelegramNewsGroupContext): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const i18n = createTelegramI18n(language);
  const text = context.messageText?.trim();
  if (!text || !isNewsGroupChat(context.runtime.chat.kind)) {
    return false;
  }

  const [commandToken = '', ...args] = text.split(/\s+/);
  if (!/^\/news(?:@\w+)?$/i.test(commandToken)) {
    return false;
  }

  if (!canManageNewsGroups(context)) {
    await replyWithAutodelete(context, i18n.newsGroup.adminOnly);
    return true;
  }

  const action = normalizeAction(args[0]);
  const repository = resolveNewsGroupRepository(context);
  const chatId = context.runtime.chat.chatId;
  const messageThreadId = resolveNewsTargetMessageThreadId(context);

  if (action === 'status') {
    await replyWithNewsGroupStatus(context, repository, chatId, messageThreadId, language, i18n);
    return true;
  }

  if (action === 'help' || action === null) {
    await replyWithAutodelete(
      context,
      buildNewsGroupHelpMessage(
        i18n,
        language,
        messageThreadId,
        await resolveCurrentNewsGroup(repository, chatId),
        await repository.listSubscriptionsByChatId(chatId, { messageThreadId }),
      ),
    );
    return true;
  }

  if (action === 'enable') {
    await repository.upsertGroup({ chatId, isEnabled: true });
    if (messageThreadId) {
      await repository.upsertSubscription({ chatId, messageThreadId, categoryKey: eventsNewsGroupCategory });
    }
    await replyWithNewsGroupStatus(
      context,
      repository,
      chatId,
      messageThreadId,
      language,
      i18n,
      messageThreadId
        ? buildNewsGroupSubscriptionConfirmation(context, eventsNewsGroupCategory, messageThreadId, language)
        : i18n.newsGroup.statusEnabled,
    );
    return true;
  }

  if (action === 'disable') {
    await repository.upsertGroup({ chatId, isEnabled: false });
    await replyWithNewsGroupStatus(context, repository, chatId, messageThreadId, language, i18n, i18n.newsGroup.statusDisabled);
    return true;
  }

  if (action === 'subscribe') {
    const rawCategoryKey = args.slice(1).join(' ');
    const categoryKey = parseCategoryKey(rawCategoryKey, i18n);
    await ensureNewsGroupExists(repository, chatId);
    await repository.upsertSubscription({ chatId, messageThreadId, categoryKey });
    await replyWithNewsGroupStatus(
      context,
      repository,
      chatId,
      messageThreadId,
      language,
      i18n,
      buildNewsGroupSubscriptionConfirmation(context, categoryKey, messageThreadId, language),
    );
    return true;
  }

  if (action === 'unsubscribe') {
    const rawCategoryKey = args.slice(1).join(' ');
    const categoryKey = parseCategoryKey(rawCategoryKey, i18n);
    const removed = await repository.deleteSubscription({ chatId, messageThreadId, categoryKey });
    await replyWithNewsGroupStatus(
      context,
      repository,
      chatId,
      messageThreadId,
      language,
      i18n,
      removed
        ? i18n.newsGroup.categoryRemoved.replace('{category}', formatCategoryLabelFromKey(categoryKey, language))
        : i18n.newsGroup.categoryNotSubscribed.replace('{category}', formatCategoryLabelFromKey(categoryKey, language)),
    );
    return true;
  }

  await replyWithAutodelete(
    context,
    buildNewsGroupHelpMessage(
      i18n,
      language,
      messageThreadId,
      await resolveCurrentNewsGroup(repository, chatId),
      await repository.listSubscriptionsByChatId(chatId, { messageThreadId }),
    ),
  );
  return true;
}

function canManageNewsGroups(context: TelegramNewsGroupContext): boolean {
  return context.runtime.actor.isAdmin;
}

function resolveNewsGroupRepository(context: TelegramNewsGroupContext): NewsGroupRepository {
  return (
    context.newsGroupRepository ??
    createDatabaseNewsGroupRepository({ database: context.runtime.services.database.db as never })
  );
}

async function ensureNewsGroupExists(repository: NewsGroupRepository, chatId: number): Promise<NewsGroupRecord> {
  const group = await repository.findGroupByChatId(chatId);
  if (group) {
    return group;
  }

  return repository.upsertGroup({ chatId, isEnabled: false });
}

async function resolveCurrentNewsGroup(
  repository: NewsGroupRepository,
  chatId: number,
): Promise<NewsGroupRecord | null> {
  return repository.findGroupByChatId(chatId);
}

async function replyWithNewsGroupStatus(
  context: TelegramNewsGroupContext,
  repository: NewsGroupRepository,
  chatId: number,
  messageThreadId: number | null,
  language: 'ca' | 'es' | 'en',
  i18n: ReturnType<typeof createTelegramI18n>,
  prefix?: string,
): Promise<void> {
  const group = await resolveCurrentNewsGroup(repository, chatId);
  const subscriptions = await repository.listSubscriptionsByChatId(chatId, { messageThreadId });
  await replyWithAutodelete(context, buildNewsGroupSummary(i18n, language, messageThreadId, group, subscriptions, prefix), {
    inlineKeyboard: buildNewsGroupStatusKeyboard(i18n, language, group, subscriptions),
  });
}

async function replyWithAutodelete(
  context: TelegramNewsGroupContext,
  message: string,
  options?: TelegramReplyOptions,
): Promise<void> {
  const sent = await context.reply(message, options);
  scheduleNewsGroupReplyDeletion(context, sent);
}

function scheduleNewsGroupReplyDeletion(context: TelegramNewsGroupContext, sent: unknown): void {
  const messageId = extractTelegramReplyMessageId(sent);
  const chatId = context.runtime.chat.chatId;
  const deleteMessage = context.runtime.bot.deleteMessage;

  if (!messageId || !chatId || !deleteMessage) {
    return;
  }

  const timer = setTimeout(() => {
    void deleteMessage({ chatId, messageId }).catch((error) => {
      console.warn(JSON.stringify({
        event: 'telegram.newsGroup.autodeleteFailed',
        chatId,
        messageId,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }, newsGroupReplyAutodeleteDelayMs);

  (timer as { unref?: () => void }).unref?.();
}

function buildNewsGroupSummary(
  i18n: ReturnType<typeof createTelegramI18n>,
  language: 'ca' | 'es' | 'en',
  messageThreadId: number | null,
  group: NewsGroupRecord | null,
  subscriptions: NewsGroupSubscriptionRecord[],
  prefix?: string,
): string {
  const lines: string[] = [];

  if (prefix) {
    lines.push(prefix);
  }

  lines.push(group?.isEnabled ? i18n.newsGroup.modeOn : i18n.newsGroup.modeOff);
  lines.push(formatNewsGroupTargetLine(language, messageThreadId));
  lines.push(i18n.newsGroup.subscriptions.replace('{list}', formatSubscriptions(i18n, language, subscriptions)));
  lines.push(i18n.newsGroup.commands);

  return lines.join('\n');
}

function buildNewsGroupHelpMessage(
  i18n: ReturnType<typeof createTelegramI18n>,
  language: 'ca' | 'es' | 'en',
  messageThreadId: number | null,
  group: NewsGroupRecord | null,
  subscriptions: NewsGroupSubscriptionRecord[],
): string {
  return [
    buildNewsGroupSummary(i18n, language, messageThreadId, group, subscriptions),
    '',
    i18n.newsGroup.help,
  ].join('\n');
}

function buildNewsGroupStatusKeyboard(
  i18n: ReturnType<typeof createTelegramI18n>,
  language: 'ca' | 'es' | 'en',
  group: NewsGroupRecord | null,
  subscriptions: NewsGroupSubscriptionRecord[],
): NonNullable<TelegramReplyOptions['inlineKeyboard']> {
  const subscribedKeys = new Set(subscriptions.map((subscription) => normalizeNewsGroupCategoryKey(subscription.categoryKey)));
  const categories = listNewsGroupCategories();
  const toggleButtonText = group?.isEnabled ? i18n.newsGroup.buttonDisable : i18n.newsGroup.buttonEnable;
  const lines: TelegramReplyOptions['inlineKeyboard'] = [
    [{ text: toggleButtonText, callbackData: newsGroupCallbackPrefixes.toggle }],
  ];

  for (const category of categories) {
    const isSubscribed = subscribedKeys.has(category.key);
    const action = isSubscribed ? newsGroupCallbackPrefixes.unsubscribe : newsGroupCallbackPrefixes.subscribe;
    const text = `${isSubscribed ? i18n.newsGroup.buttonUnsubscribe : i18n.newsGroup.buttonSubscribe}: ${newsGroupCategoryLabel(category, language)}`;
    lines.push([{
      text,
      callbackData: `${action}${category.key}`,
    }]);
  }

  lines.push([{ text: i18n.newsGroup.buttonRefresh, callbackData: newsGroupCallbackPrefixes.refresh }]);
  return lines;
}

function formatSubscriptions(
  i18n: ReturnType<typeof createTelegramI18n>,
  language: 'ca' | 'es' | 'en',
  subscriptions: NewsGroupSubscriptionRecord[],
): string {
  if (subscriptions.length === 0) {
    return i18n.newsGroup.noSubscriptions;
  }

  return subscriptions.map((subscription) => formatCategoryLabelFromKey(subscription.categoryKey, language)).join(', ');
}

function formatCategoryLabelFromKey(categoryKey: string, language: 'ca' | 'es' | 'en'): string {
  const resolved = resolveNewsGroupCategory(categoryKey);
  return resolved
    ? newsGroupCategoryLabel(resolved, language)
    : categoryKey;
}

function buildNewsGroupSubscriptionConfirmation(
  context: TelegramNewsGroupContext,
  categoryKey: string,
  messageThreadId: number | null,
  language: 'ca' | 'es' | 'en',
): string {
  const category = formatCategoryLabelFromKey(categoryKey, language);
  const destination = formatNewsGroupDestinationName(context, messageThreadId);

  if (language === 'ca') {
    return `Subscrit correctament a ${category} a ${destination}.`;
  }
  if (language === 'en') {
    return `Subscribed successfully to ${category} in ${destination}.`;
  }
  return `Suscrito correctamente para ${category} en ${destination}.`;
}

function formatNewsGroupDestinationName(context: TelegramNewsGroupContext, messageThreadId: number | null): string {
  const chatName = context.runtime.chat.chatTitle?.trim() || `chat ${context.runtime.chat.chatId}`;
  return messageThreadId ? `${chatName} (topic ${messageThreadId})` : chatName;
}

function resolveNewsTargetMessageThreadId(context: TelegramNewsGroupContext): number | null {
  return normalizeMessageThreadId(context.messageThreadId);
}

function formatNewsGroupTargetLine(language: 'ca' | 'es' | 'en', messageThreadId: number | null): string {
  if (messageThreadId) {
    if (language === 'es') {
      return `Destino: topic ${messageThreadId}`;
    }
    if (language === 'en') {
      return `Target: topic ${messageThreadId}`;
    }
    return `Destí: topic ${messageThreadId}`;
  }

  if (language === 'es') {
    return 'Destino: grupo completo';
  }
  if (language === 'en') {
    return 'Target: whole group';
  }
  return 'Destí: grup complet';
}

function normalizeAction(value: string | undefined): 'status' | 'help' | 'enable' | 'disable' | 'subscribe' | 'unsubscribe' | null {
  if (!value) {
    return 'status';
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return 'status';
  }

  if (['status', 'estat', 'estado', 'state'].includes(normalized)) {
    return 'status';
  }
  if (['help', 'ajuda', 'ayuda'].includes(normalized)) {
    return 'help';
  }
  if (['enable', 'activar', 'activar!', 'on'].includes(normalized)) {
    return 'enable';
  }
  if (['disable', 'desactivar', 'off'].includes(normalized)) {
    return 'disable';
  }
  if (['subscribe', 'subscriure', 'suscribir', 'add'].includes(normalized)) {
    return 'subscribe';
  }
  if (['unsubscribe', 'desubscriure', 'desuscribir', 'remove'].includes(normalized)) {
    return 'unsubscribe';
  }

  return null;
}

function parseCategoryKey(value: string, i18n: ReturnType<typeof createTelegramI18n>): NewsGroupCategoryKey {
  const normalized = normalizeNewsGroupCategoryKey(value);
  if (!normalized) {
    throw new Error(i18n.newsGroup.categoryRequired);
  }

  const category = resolveNewsGroupCategory(normalized);
  if (!category) {
    throw new Error(i18n.newsGroup.categoryUnknown.replace('{category}', value));
  }

  return category.key;
}

function isNewsGroupChat(kind: TelegramChatContext['kind']): boolean {
  return kind === 'group' || kind === 'group-news';
}
