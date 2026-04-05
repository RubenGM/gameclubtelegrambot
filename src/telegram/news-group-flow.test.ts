import test from 'node:test';
import assert from 'node:assert/strict';

import type { ConversationSessionRecord } from './conversation-session.js';
import type {
  NewsGroupRecord,
  NewsGroupRepository,
  NewsGroupSubscriptionRecord,
} from '../news/news-group-catalog.js';
import { handleTelegramNewsGroupText, type TelegramNewsGroupContext } from './news-group-flow.js';

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
    async listSubscriptionsByChatId(chatId) {
      return Array.from(subscriptions.values())
        .filter((subscription) => subscription.chatId === chatId)
        .sort((left, right) => left.categoryKey.localeCompare(right.categoryKey));
    },
    async upsertSubscription(input) {
      const now = '2026-04-04T10:00:00.000Z';
      if (!groups.has(input.chatId)) {
        throw new Error('missing news group');
      }

      const subscription: NewsGroupSubscriptionRecord = {
        chatId: input.chatId,
        categoryKey: input.categoryKey,
        createdAt: subscriptions.get(`${input.chatId}:${input.categoryKey}`)?.createdAt ?? now,
        updatedAt: now,
      };
      subscriptions.set(`${input.chatId}:${input.categoryKey}`, subscription);
      return subscription;
    },
    async deleteSubscription({ chatId, categoryKey }) {
      return subscriptions.delete(`${chatId}:${categoryKey}`);
    },
    async listSubscribedGroupsByCategory(categoryKey) {
      return Array.from(groups.values()).filter((group) => {
        if (!group.isEnabled) {
          return false;
        }

        return subscriptions.has(`${group.chatId}:${categoryKey}`);
      });
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
}: {
  repository?: NewsGroupRepository;
  chatKind?: 'group' | 'group-news';
  isAdmin?: boolean;
} = {}) {
  const replies: string[] = [];
  let currentSession: ConversationSessionRecord | null = null;

  const context: TelegramNewsGroupContext = {
    messageText: undefined,
    reply: async (message) => {
      replies.push(message);
    },
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
          allowed: permissionKey === 'news_group.manage' && isAdmin,
          permissionKey,
          reason: isAdmin ? 'admin-override' : 'no-match',
        }),
        can: (permissionKey: string) => permissionKey === 'news_group.manage' && isAdmin,
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
      },
      services: {
        database: {
          db: undefined as never,
        },
      },
      bot: {
        publicName: 'Game Club Bot',
        clubName: 'Game Club',
        sendPrivateMessage: async () => {},
      },
    },
    newsGroupRepository: repository,
  };

  return { context, replies, repository };
}

test('handleTelegramNewsGroupText enables and subscribes a group with clear status', async () => {
  const { context, replies, repository } = createContext();

  context.messageText = '/news';
  assert.equal(await handleTelegramNewsGroupText(context), true);
  assert.match(replies.at(-1) ?? '', /Mode news: desactivat/);
  assert.match(replies.at(-1) ?? '', /Categories subscrites: cap/);

  context.messageText = '/news subscriure events';
  assert.equal(await handleTelegramNewsGroupText(context), true);
  assert.match(replies.at(-1) ?? '', /Categoria "events" subscrita\./);
  assert.match(replies.at(-1) ?? '', /Categories subscrites: events/);
  assert.equal((await repository.findGroupByChatId(-200))?.isEnabled, false);

  context.messageText = '/news activar';
  assert.equal(await handleTelegramNewsGroupText(context), true);
  assert.match(replies.at(-1) ?? '', /Mode news: activat/);
  assert.match(replies.at(-1) ?? '', /Categories subscrites: events/);
  assert.equal((await repository.findGroupByChatId(-200))?.isEnabled, true);
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
  assert.match(replies.at(-1) ?? '', /Usa \/news per veure l estat actual del grup\./);
});
