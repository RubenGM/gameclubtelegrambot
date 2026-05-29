import test from 'node:test';
import assert from 'node:assert/strict';

import type { ConversationSessionRecord } from './conversation-session.js';
import type {
  NewsGroupRecord,
  NewsGroupRepository,
  NewsGroupSubscriptionRecord,
} from '../news/news-group-catalog.js';
import {
  handleTelegramNewsGroupCallback,
  handleTelegramNewsGroupText,
  newsGroupCallbackPrefixes,
  type TelegramNewsGroupContext,
} from './news-group-flow.js';

function createRepository(initialGroup: NewsGroupRecord | null = null): NewsGroupRepository {
  const groups = new Map<number, NewsGroupRecord>();
  const subscriptions = new Map<string, NewsGroupSubscriptionRecord>();

  if (initialGroup) {
    groups.set(initialGroup.chatId, initialGroup);
  }

  return {
    async findGroupByChatId(chatId) {
      return groups.get(chatId) ?? null;
    },
    async listGroups({ includeDisabled } = {}) {
      return Array.from(groups.values()).filter((group) => includeDisabled || group.isEnabled);
    },
    async upsertGroup(input) {
      const now = '2026-04-04T10:00:00.000Z';
      const existing = groups.get(input.chatId);
      const next: NewsGroupRecord = {
        chatId: input.chatId,
        isEnabled: input.isEnabled,
        metadata: input.metadata ?? existing?.metadata ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        enabledAt: input.isEnabled ? now : existing?.enabledAt ?? null,
        disabledAt: input.isEnabled ? null : now,
      };
      groups.set(next.chatId, next);
      return next;
    },
    async listSubscriptionsByChatId(chatId, input = {}) {
      return Array.from(subscriptions.values())
        .filter((subscription) => subscription.chatId === chatId)
        .filter((subscription) => !('messageThreadId' in input) || subscription.messageThreadId === (input.messageThreadId ?? null))
        .sort((left, right) => (left.messageThreadId ?? 0) - (right.messageThreadId ?? 0) || left.categoryKey.localeCompare(right.categoryKey));
    },
    async upsertSubscription(input) {
      const now = '2026-04-04T10:00:00.000Z';
      if (!groups.has(input.chatId)) {
        throw new Error('missing news group');
      }

      const messageThreadId = input.messageThreadId ?? null;
      const key = `${input.chatId}:${messageThreadId ?? 0}:${input.categoryKey}`;
      const subscription: NewsGroupSubscriptionRecord = {
        chatId: input.chatId,
        messageThreadId,
        categoryKey: input.categoryKey,
        createdAt: subscriptions.get(key)?.createdAt ?? now,
        updatedAt: now,
      };
      subscriptions.set(key, subscription);
      return subscription;
    },
    async deleteSubscription({ chatId, categoryKey, messageThreadId }) {
      return subscriptions.delete(`${chatId}:${messageThreadId ?? 0}:${categoryKey}`);
    },
    async listSubscribedGroupsByCategory(categoryKey) {
      const explicit = Array.from(subscriptions.values())
        .filter((subscription) => subscription.categoryKey === categoryKey)
        .flatMap((subscription) => {
          const group = groups.get(subscription.chatId);
          return group?.isEnabled ? [{ ...group, messageThreadId: subscription.messageThreadId }] : [];
        });
      if (categoryKey !== 'events') {
        return explicit;
      }
      const explicitChatIds = new Set(explicit.map((group) => group.chatId));
      const defaults = Array.from(groups.values())
        .filter((group) => group.isEnabled && !explicitChatIds.has(group.chatId))
        .map((group) => ({ ...group, messageThreadId: null }));
      return [...explicit, ...defaults];
    },
    async isNewsEnabledGroup(chatId) {
      return groups.get(chatId)?.isEnabled === true;
    },
  };
}

function createContext({
  repository = createRepository(),
  chatKind = 'group',
  isAdmin = true,
  hasNewsPermission = isAdmin,
  messageThreadId,
  chatTitle = 'Cawa',
  botLanguage,
}: {
  repository?: NewsGroupRepository;
  chatKind?: 'group' | 'group-news';
  isAdmin?: boolean;
  hasNewsPermission?: boolean;
  messageThreadId?: number;
  chatTitle?: string;
  botLanguage?: string;
} = {}) {
  const replies: string[] = [];
  const deletedMessages: Array<{ chatId: number; messageId: number }> = [];
  let currentSession: ConversationSessionRecord | null = null;
  let nextMessageId = 100;

  const context: TelegramNewsGroupContext = {
    reply: async (message) => {
      replies.push(message);
      nextMessageId += 1;
      return { message_id: nextMessageId };
    },
    ...(messageThreadId ? { messageThreadId } : {}),
    runtime: {
      actor: {
        telegramUserId: 99,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin,
        permissions: [],
      },
      authorization: {
        authorize: (permissionKey: string) => ({
          allowed: permissionKey === 'news_group.manage' && hasNewsPermission,
          permissionKey,
          reason: hasNewsPermission ? 'global-allow' : 'no-match',
        }),
        can: (permissionKey: string) => permissionKey === 'news_group.manage' && hasNewsPermission,
      },
      session: {
        get current() {
          return currentSession;
        },
        start: async ({ flowKey, stepKey, data = {} }) => {
          currentSession = {
            key: 'telegram.session:1:99',
            flowKey,
            stepKey,
            data,
            createdAt: '2026-04-04T10:00:00.000Z',
            updatedAt: '2026-04-04T10:00:00.000Z',
            expiresAt: '2026-04-05T10:00:00.000Z',
          };
          return currentSession;
        },
        advance: async ({ stepKey, data }) => {
          if (!currentSession) {
            throw new Error('no session');
          }

          currentSession = {
            ...currentSession,
            stepKey,
            data,
            updatedAt: '2026-04-04T10:00:00.000Z',
          };
          return currentSession;
        },
        cancel: async () => {
          const hadSession = currentSession !== null;
          currentSession = null;
          return hadSession;
        },
      },
      chat: {
        kind: chatKind,
        chatId: -200,
        chatTitle,
      },
      services: {
        database: {
          db: undefined as never,
        },
      },
      bot: {
        publicName: 'Game Club Bot',
        clubName: 'Game Club',
        ...(botLanguage ? { language: botLanguage } : {}),
        sendPrivateMessage: async () => {},
        deleteMessage: async (input) => {
          deletedMessages.push(input);
        },
      },
    },
    newsGroupRepository: repository,
  };

  return { context, replies, deletedMessages, repository };
}

test('handleTelegramNewsGroupText enables and subscribes a group with clear status', async () => {
  const { context, replies, repository } = createContext();

  context.messageText = '/news';
  assert.equal(await handleTelegramNewsGroupText(context), true);
  assert.match(replies.at(-1) ?? '', /Mode news: desactivat/);
  assert.match(replies.at(-1) ?? '', /Categories subscrites: cap/);

  context.messageText = '/news subscriure events';
  assert.equal(await handleTelegramNewsGroupText(context), true);
  assert.match(replies.at(-1) ?? '', /Subscrit correctament a events a Cawa\./);
  assert.match(replies.at(-1) ?? '', /Categories subscrites: events/);
  assert.equal((await repository.findGroupByChatId(-200))?.isEnabled, false);

  context.messageText = '/news activar';
  assert.equal(await handleTelegramNewsGroupText(context), true);
  assert.match(replies.at(-1) ?? '', /Mode news: activat/);
  assert.match(replies.at(-1) ?? '', /Categories subscrites: events/);
  assert.equal((await repository.findGroupByChatId(-200))?.isEnabled, true);
});

test('handleTelegramNewsGroupText autodeletes subscription replies after one minute', async (t: any) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { context, deletedMessages } = createContext();

  context.messageText = '/news subscriure events';
  assert.equal(await handleTelegramNewsGroupText(context), true);
  assert.deepEqual(deletedMessages, []);

  t.mock.timers.tick(59_999);
  assert.deepEqual(deletedMessages, []);

  t.mock.timers.tick(1);
  await Promise.resolve();
  assert.deepEqual(deletedMessages, [{ chatId: -200, messageId: 101 }]);
});

test('handleTelegramNewsGroupText subscribes only the current topic when used inside a topic', async () => {
  const { context, replies, repository } = createContext({ messageThreadId: 77, botLanguage: 'es' });

  context.messageText = '/news suscribir socios';
  assert.equal(await handleTelegramNewsGroupText(context), true);
  assert.match(replies.at(-1) ?? '', /Suscrito correctamente para nuevos_miembros en Cawa \(topic 77\)\./);
  assert.match(replies.at(-1) ?? '', /Destino: topic 77|Destí: topic 77/);
  assert.match(replies.at(-1) ?? '', /nuevos_miembros/);

  assert.deepEqual(await repository.listSubscriptionsByChatId(-200, { messageThreadId: 77 }), [
    {
      chatId: -200,
      messageThreadId: 77,
      categoryKey: 'nuevos_miembros',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
    },
  ]);
  assert.deepEqual(await repository.listSubscriptionsByChatId(-200, { messageThreadId: null }), []);

  context.messageText = '/news activar';
  assert.equal(await handleTelegramNewsGroupText(context), true);

  const targets = await repository.listSubscribedGroupsByCategory('nuevos_miembros');
  assert.deepEqual(targets.map((target) => ({ chatId: target.chatId, messageThreadId: target.messageThreadId })), [
    { chatId: -200, messageThreadId: 77 },
  ]);
});

test('handleTelegramNewsGroupText enables the current topic for default calendar news', async () => {
  const { context, replies, repository } = createContext({ messageThreadId: 77 });

  context.messageText = '/news activar';
  assert.equal(await handleTelegramNewsGroupText(context), true);

  assert.match(replies.at(-1) ?? '', /Subscrit correctament a events a Cawa \(topic 77\)\./);
  assert.match(replies.at(-1) ?? '', /Destino: topic 77|Destí: topic 77/);
  assert.deepEqual(await repository.listSubscriptionsByChatId(-200, { messageThreadId: 77 }), [
    {
      chatId: -200,
      messageThreadId: 77,
      categoryKey: 'events',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
    },
  ]);
  assert.deepEqual(await repository.listSubscribedGroupsByCategory('events').then((targets) => targets.map(({ chatId, messageThreadId }) => ({ chatId, messageThreadId }))), [
    { chatId: -200, messageThreadId: 77 },
  ]);
});

test('handleTelegramNewsGroupCallback enables the current topic for default calendar news', async () => {
  const { context, replies, repository } = createContext({ messageThreadId: 77 });

  context.callbackData = newsGroupCallbackPrefixes.toggle;
  assert.equal(await handleTelegramNewsGroupCallback(context), true);

  assert.match(replies.at(-1) ?? '', /Subscrit correctament a events a Cawa \(topic 77\)\./);
  assert.match(replies.at(-1) ?? '', /Destino: topic 77|Destí: topic 77/);
  assert.deepEqual(await repository.listSubscribedGroupsByCategory('events').then((targets) => targets.map(({ chatId, messageThreadId }) => ({ chatId, messageThreadId }))), [
    { chatId: -200, messageThreadId: 77 },
  ]);
});

test('handleTelegramNewsGroupText disables a group and keeps subscriptions visible', async () => {
  const { context, replies, repository } = createContext({
    repository: createRepository({
      chatId: -200,
      isEnabled: true,
      metadata: null,
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      enabledAt: '2026-04-04T10:00:00.000Z',
      disabledAt: null,
    }),
  });

  await repository.upsertSubscription({ chatId: -200, categoryKey: 'events' });

  context.messageText = '/news desactivar';
  assert.equal(await handleTelegramNewsGroupText(context), true);
  assert.match(replies.at(-1) ?? '', /Mode news: desactivat/);
  assert.match(replies.at(-1) ?? '', /Categories subscrites: events/);
  assert.equal((await repository.findGroupByChatId(-200))?.isEnabled, false);
});

test('handleTelegramNewsGroupText shows help for unknown actions', async () => {
  const { context, replies } = createContext();

  context.messageText = '/news inexplicable';
  assert.equal(await handleTelegramNewsGroupText(context), true);
  assert.match(replies.at(-1) ?? '', /Funcionament:/);
  assert.match(replies.at(-1) ?? '', /\/news estat/);
  assert.match(replies.at(-1) ?? '', /\/news ajuda/);
  assert.match(replies.at(-1) ?? '', /\/news activar/);
  assert.match(replies.at(-1) ?? '', /\/news desactivar/);
  assert.match(replies.at(-1) ?? '', /\/news subscriure <categoria>/);
  assert.match(replies.at(-1) ?? '', /\/news desubscriure <categoria>/);
  assert.match(replies.at(-1) ?? '', /lfg:players/);
  assert.match(replies.at(-1) ?? '', /lfg:groups/);
  assert.match(replies.at(-1) ?? '', /nuevos_miembros/);
});

test('handleTelegramNewsGroupText allows only bot admins even if a user has news permission', async () => {
  const { context, replies, repository } = createContext({ isAdmin: false, hasNewsPermission: true });

  context.messageText = '/news activar';
  assert.equal(await handleTelegramNewsGroupText(context), true);
  assert.match(replies.at(-1) ?? '', /Només els administradors del bot/);
  assert.equal(await repository.findGroupByChatId(-200), null);
});

test('handleTelegramNewsGroupText accepts Spanish command aliases', async () => {
  const { context, replies, repository } = createContext({ botLanguage: 'es' });

  context.messageText = '/news suscribir socios';
  assert.equal(await handleTelegramNewsGroupText(context), true);
  assert.match(replies.at(-1) ?? '', /Suscrito correctamente para nuevos_miembros en Cawa\./);

  context.messageText = '/news estado';
  assert.equal(await handleTelegramNewsGroupText(context), true);
  assert.match(replies.at(-1) ?? '', /Categorías suscritas: nuevos_miembros/);

  context.messageText = '/news desuscribir new-members';
  assert.equal(await handleTelegramNewsGroupText(context), true);
  assert.match(replies.at(-1) ?? '', /Categoría "nuevos_miembros" eliminada\./);
  assert.deepEqual(await repository.listSubscriptionsByChatId(-200), []);
});

test('handleTelegramNewsGroupCallback toggles and refreshes the status with inline actions', async () => {
  const { context, replies, repository } = createContext();

  context.callbackData = newsGroupCallbackPrefixes.toggle;
  assert.equal(await handleTelegramNewsGroupCallback(context), true);
  assert.match(replies.at(-1) ?? '', /Mode news: activat/);
  assert.equal((await repository.findGroupByChatId(-200))?.isEnabled, true);

  context.callbackData = newsGroupCallbackPrefixes.refresh;
  assert.equal(await handleTelegramNewsGroupCallback(context), true);
  assert.match(replies.at(-1) ?? '', /Mode news: activat/);
  assert.equal((await repository.findGroupByChatId(-200))?.isEnabled, true);
});

test('handleTelegramNewsGroupCallback subscribes and unsubscribes a category directly', async () => {
  const { context, replies, repository } = createContext();

  context.callbackData = `${newsGroupCallbackPrefixes.subscribe}nuevos_miembros`;
  assert.equal(await handleTelegramNewsGroupCallback(context), true);
  assert.match(replies.at(-1) ?? '', /Subscrit correctament a nuevos_miembros a Cawa\./);
  assert.deepEqual((await repository.listSubscriptionsByChatId(-200)).map((entry) => entry.categoryKey), ['nuevos_miembros']);

  context.callbackData = `${newsGroupCallbackPrefixes.unsubscribe}nuevos_miembros`;
  assert.equal(await handleTelegramNewsGroupCallback(context), true);
  assert.match(replies.at(-1) ?? '', /Categoria "nuevos_miembros" eliminada\./);
  assert.deepEqual(await repository.listSubscriptionsByChatId(-200), []);
});

test('handleTelegramNewsGroupCallback is admin-only', async () => {
  const { context, replies, repository } = createContext({ isAdmin: false, hasNewsPermission: true });

  context.callbackData = newsGroupCallbackPrefixes.toggle;
  assert.equal(await handleTelegramNewsGroupCallback(context), true);
  assert.match(replies.at(-1) ?? '', /Només els administradors del bot/);
  assert.equal(await repository.findGroupByChatId(-200), null);
});

test('handleTelegramNewsGroupCallback ignores invalid categories', async () => {
  const { context, replies, repository } = createContext();

  context.callbackData = `${newsGroupCallbackPrefixes.subscribe}no_existe`;
  assert.equal(await handleTelegramNewsGroupCallback(context), true);
  assert.match(replies.at(-1) ?? '', /Categoria desconeguda: "no_existe"\./);
  assert.deepEqual(await repository.listSubscriptionsByChatId(-200), []);
});
