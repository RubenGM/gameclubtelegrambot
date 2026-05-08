import type { AuthorizationService } from '../authorization/service.js';
import {
  newsGroupCategoryLabel,
  type NewsGroupCategoryKey,
  listNewsGroupCategories,
  normalizeNewsGroupCategoryKey,
  resolveNewsGroupCategory,
} from '../news/news-group-catalog.js';
import type { NewsGroupRecord, NewsGroupRepository, NewsGroupSubscriptionRecord } from '../news/news-group-catalog.js';
import { createDatabaseNewsGroupRepository } from '../news/news-group-store.js';
import type { TelegramActor } from './actor-store.js';
import type { TelegramChatContext } from './chat-context.js';
import type { ConversationSessionRuntime } from './conversation-session.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';

export const newsGroupCallbackPrefixes = {
  toggle: 'news_group:toggle',
  refresh: 'news_group:refresh',
  subscribe: 'news_group:subscribe:',
  unsubscribe: 'news_group:unsubscribe:',
} as const;

export interface TelegramNewsGroupContext {
  callbackData?: string;
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
    await context.reply(i18n.newsGroup.adminOnly);
    return true;
  }

  const repository = resolveNewsGroupRepository(context);
  const chatId = context.runtime.chat.chatId;

  if (callbackData === newsGroupCallbackPrefixes.toggle) {
    const group = await ensureNewsGroupExists(repository, chatId);
    await repository.upsertGroup({ chatId, isEnabled: !group.isEnabled });
    await replyWithNewsGroupStatus(context, repository, chatId, language, i18n);
    return true;
  }

  if (callbackData === newsGroupCallbackPrefixes.refresh) {
    await replyWithNewsGroupStatus(context, repository, chatId, language, i18n);
    return true;
  }

  if (callbackData.startsWith(newsGroupCallbackPrefixes.subscribe)) {
    const rawCategoryKey = callbackData.slice(newsGroupCallbackPrefixes.subscribe.length);
    try {
      const categoryKey = parseCategoryKey(rawCategoryKey, i18n);
      await ensureNewsGroupExists(repository, chatId);
      await repository.upsertSubscription({ chatId, categoryKey });
      await replyWithNewsGroupStatus(
        context,
        repository,
        chatId,
        language,
        i18n,
        i18n.newsGroup.categorySubscribed.replace('{category}', formatCategoryLabelFromKey(categoryKey, language)),
      );
    } catch (error) {
      await context.reply(error instanceof Error ? error.message : 'Invalid category');
    }
    return true;
  }

  if (callbackData.startsWith(newsGroupCallbackPrefixes.unsubscribe)) {
    const rawCategoryKey = callbackData.slice(newsGroupCallbackPrefixes.unsubscribe.length);
    try {
      const categoryKey = parseCategoryKey(rawCategoryKey, i18n);
      const removed = await repository.deleteSubscription({ chatId, categoryKey });
      await replyWithNewsGroupStatus(
        context,
        repository,
        chatId,
        language,
        i18n,
        removed
          ? i18n.newsGroup.categoryRemoved.replace('{category}', formatCategoryLabelFromKey(categoryKey, language))
          : i18n.newsGroup.categoryNotSubscribed.replace('{category}', formatCategoryLabelFromKey(categoryKey, language)),
      );
    } catch (error) {
      await context.reply(error instanceof Error ? error.message : 'Invalid category');
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
    await context.reply(i18n.newsGroup.adminOnly);
    return true;
  }

  const action = normalizeAction(args[0]);
  const repository = resolveNewsGroupRepository(context);
  const chatId = context.runtime.chat.chatId;

  if (action === 'status') {
    await replyWithNewsGroupStatus(context, repository, chatId, language, i18n);
    return true;
  }

  if (action === 'help' || action === null) {
    await context.reply(
      buildNewsGroupHelpMessage(
        i18n,
        language,
        await resolveCurrentNewsGroup(repository, chatId),
        await repository.listSubscriptionsByChatId(chatId),
      ),
    );
    return true;
  }

  if (action === 'enable') {
    await repository.upsertGroup({ chatId, isEnabled: true });
    await replyWithNewsGroupStatus(context, repository, chatId, language, i18n, i18n.newsGroup.statusEnabled);
    return true;
  }

  if (action === 'disable') {
    await repository.upsertGroup({ chatId, isEnabled: false });
    await replyWithNewsGroupStatus(context, repository, chatId, language, i18n, i18n.newsGroup.statusDisabled);
    return true;
  }

  if (action === 'subscribe') {
    const rawCategoryKey = args.slice(1).join(' ');
    const categoryKey = parseCategoryKey(rawCategoryKey, i18n);
    await ensureNewsGroupExists(repository, chatId);
    await repository.upsertSubscription({ chatId, categoryKey });
    await replyWithNewsGroupStatus(
      context,
      repository,
      chatId,
      language,
      i18n,
      i18n.newsGroup.categorySubscribed.replace('{category}', formatCategoryLabelFromKey(categoryKey, language)),
    );
    return true;
  }

  if (action === 'unsubscribe') {
    const rawCategoryKey = args.slice(1).join(' ');
    const categoryKey = parseCategoryKey(rawCategoryKey, i18n);
    const removed = await repository.deleteSubscription({ chatId, categoryKey });
    await replyWithNewsGroupStatus(
      context,
      repository,
      chatId,
      language,
      i18n,
      removed
        ? i18n.newsGroup.categoryRemoved.replace('{category}', formatCategoryLabelFromKey(categoryKey, language))
        : i18n.newsGroup.categoryNotSubscribed.replace('{category}', formatCategoryLabelFromKey(categoryKey, language)),
    );
    return true;
  }

  await context.reply(
    buildNewsGroupHelpMessage(
      i18n,
      language,
      await resolveCurrentNewsGroup(repository, chatId),
      await repository.listSubscriptionsByChatId(chatId),
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
  language: 'ca' | 'es' | 'en',
  i18n: ReturnType<typeof createTelegramI18n>,
  prefix?: string,
): Promise<void> {
  const group = await resolveCurrentNewsGroup(repository, chatId);
  const subscriptions = await repository.listSubscriptionsByChatId(chatId);
  await context.reply(buildNewsGroupSummary(i18n, language, group, subscriptions, prefix), {
    inlineKeyboard: buildNewsGroupStatusKeyboard(i18n, language, group, subscriptions),
  });
}

function buildNewsGroupSummary(
  i18n: ReturnType<typeof createTelegramI18n>,
  language: 'ca' | 'es' | 'en',
  group: NewsGroupRecord | null,
  subscriptions: NewsGroupSubscriptionRecord[],
  prefix?: string,
): string {
  const lines: string[] = [];

  if (prefix) {
    lines.push(prefix);
  }

  lines.push(group?.isEnabled ? i18n.newsGroup.modeOn : i18n.newsGroup.modeOff);
  lines.push(i18n.newsGroup.subscriptions.replace('{list}', formatSubscriptions(i18n, language, subscriptions)));
  lines.push(i18n.newsGroup.commands);

  return lines.join('\n');
}

function buildNewsGroupHelpMessage(
  i18n: ReturnType<typeof createTelegramI18n>,
  language: 'ca' | 'es' | 'en',
  group: NewsGroupRecord | null,
  subscriptions: NewsGroupSubscriptionRecord[],
): string {
  return [
    buildNewsGroupSummary(i18n, language, group, subscriptions),
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
