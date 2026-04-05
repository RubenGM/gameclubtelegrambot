import type { AuthorizationService } from '../authorization/service.js';
import type { NewsGroupRecord, NewsGroupRepository, NewsGroupSubscriptionRecord } from '../news/news-group-catalog.js';
import { createDatabaseNewsGroupRepository } from '../news/news-group-store.js';
import type { TelegramActor } from './actor-store.js';
import type { TelegramChatContext } from './chat-context.js';
import type { ConversationSessionRuntime } from './conversation-session.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';

export interface TelegramNewsGroupContext {
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

export async function handleTelegramNewsGroupText(context: TelegramNewsGroupContext): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const i18n = createTelegramI18n(language);
  const text = context.messageText?.trim();
  if (!text || !isNewsGroupChat(context.runtime.chat.kind) || !canManageNewsGroups(context)) {
    return false;
  }

  const [commandToken = '', ...args] = text.split(/\s+/);
  if (!/^\/news(?:@\w+)?$/i.test(commandToken)) {
    return false;
  }

  const action = normalizeAction(args[0]);
  const repository = resolveNewsGroupRepository(context);
  const chatId = context.runtime.chat.chatId;

  if (action === 'status') {
    await replyWithNewsGroupStatus(context, repository, chatId, i18n);
    return true;
  }

  if (action === 'help' || action === null) {
    await context.reply(buildNewsGroupHelpMessage(i18n, await resolveCurrentNewsGroup(repository, chatId), await repository.listSubscriptionsByChatId(chatId)));
    return true;
  }

  if (action === 'enable') {
    await repository.upsertGroup({ chatId, isEnabled: true });
    await replyWithNewsGroupStatus(context, repository, chatId, i18n, i18n.newsGroup.statusEnabled);
    return true;
  }

  if (action === 'disable') {
    await repository.upsertGroup({ chatId, isEnabled: false });
    await replyWithNewsGroupStatus(context, repository, chatId, i18n, i18n.newsGroup.statusDisabled);
    return true;
  }

  if (action === 'subscribe') {
    const categoryKey = parseCategoryKey(args.slice(1).join(' '));
    await ensureNewsGroupExists(repository, chatId);
    await repository.upsertSubscription({ chatId, categoryKey });
    await replyWithNewsGroupStatus(context, repository, chatId, i18n, i18n.newsGroup.categorySubscribed.replace('{category}', categoryKey));
    return true;
  }

  if (action === 'unsubscribe') {
    const categoryKey = parseCategoryKey(args.slice(1).join(' '));
    const removed = await repository.deleteSubscription({ chatId, categoryKey });
    await replyWithNewsGroupStatus(
      context,
      repository,
      chatId,
      i18n,
      removed ? i18n.newsGroup.categoryRemoved.replace('{category}', categoryKey) : i18n.newsGroup.categoryNotSubscribed.replace('{category}', categoryKey),
    );
    return true;
  }

  await context.reply(buildNewsGroupHelpMessage(i18n, await resolveCurrentNewsGroup(repository, chatId), await repository.listSubscriptionsByChatId(chatId)));
  return true;
}

function canManageNewsGroups(context: TelegramNewsGroupContext): boolean {
  return context.runtime.actor.isAdmin || context.runtime.authorization.can('news_group.manage');
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
  i18n: ReturnType<typeof createTelegramI18n>,
  prefix?: string,
): Promise<void> {
  const group = await resolveCurrentNewsGroup(repository, chatId);
  const subscriptions = await repository.listSubscriptionsByChatId(chatId);
  await context.reply(buildNewsGroupSummary(i18n, group, subscriptions, prefix));
}

function buildNewsGroupSummary(
  i18n: ReturnType<typeof createTelegramI18n>,
  group: NewsGroupRecord | null,
  subscriptions: NewsGroupSubscriptionRecord[],
  prefix?: string,
): string {
  const lines: string[] = [];

  if (prefix) {
    lines.push(prefix);
  }

  lines.push(group?.isEnabled ? i18n.newsGroup.modeOn : i18n.newsGroup.modeOff);
  lines.push(i18n.newsGroup.subscriptions.replace('{list}', formatSubscriptions(i18n, subscriptions)));
  lines.push(i18n.newsGroup.commands);

  return lines.join('\n');
}

function buildNewsGroupHelpMessage(
  i18n: ReturnType<typeof createTelegramI18n>,
  group: NewsGroupRecord | null,
  subscriptions: NewsGroupSubscriptionRecord[],
): string {
  return [
    buildNewsGroupSummary(i18n, group, subscriptions),
    '',
    i18n.newsGroup.help,
  ].join('\n');
}

function formatSubscriptions(
  i18n: ReturnType<typeof createTelegramI18n>,
  subscriptions: NewsGroupSubscriptionRecord[],
): string {
  if (subscriptions.length === 0) {
    return i18n.newsGroup.noSubscriptions;
  }

  return subscriptions.map((subscription) => subscription.categoryKey).join(', ');
}

function normalizeAction(value: string | undefined): 'status' | 'help' | 'enable' | 'disable' | 'subscribe' | 'unsubscribe' | null {
  if (!value) {
    return 'status';
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return 'status';
  }

  if (['status', 'estat', 'state'].includes(normalized)) {
    return 'status';
  }
  if (['help', 'ajuda'].includes(normalized)) {
    return 'help';
  }
  if (['enable', 'activar', 'activar!', 'on'].includes(normalized)) {
    return 'enable';
  }
  if (['disable', 'desactivar', 'off'].includes(normalized)) {
    return 'disable';
  }
  if (['subscribe', 'subscriure', 'add'].includes(normalized)) {
    return 'subscribe';
  }
  if (['unsubscribe', 'desubscriure', 'remove'].includes(normalized)) {
    return 'unsubscribe';
  }

  return null;
}

function parseCategoryKey(value: string): string {
  const categoryKey = value.trim();
  if (!categoryKey) {
    throw new Error(createTelegramI18n('ca').newsGroup.categoryRequired);
  }

  return categoryKey;
}

function isNewsGroupChat(kind: TelegramChatContext['kind']): boolean {
  return kind === 'group' || kind === 'group-news';
}
