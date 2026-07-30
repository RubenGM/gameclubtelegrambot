import test from 'node:test';
import assert from 'node:assert/strict';

import type {
  NewsGroupRecord,
  NewsGroupRepository,
  NewsGroupSubscriptionRecord,
} from '../news/news-group-catalog.js';
import { resolvePromotionDestinationDisplayName } from '../news/news-group-catalog.js';
import {
  handleTelegramPromotionDestinationText,
  parseTelegramPromotionDestinationLink,
  type TelegramPromotionDestinationContext,
} from './promotion-destination-flow.js';

function createRepository(group: NewsGroupRecord): NewsGroupRepository {
  const subscriptions = new Map<string, NewsGroupSubscriptionRecord>();
  let currentGroup = group;
  return {
    async findGroupByChatId(chatId) {
      return chatId === currentGroup.chatId ? currentGroup : null;
    },
    async listGroups() {
      return [currentGroup];
    },
    async upsertGroup(input) {
      currentGroup = {
        ...currentGroup,
        isEnabled: input.isEnabled,
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      };
      return currentGroup;
    },
    async listSubscriptionsByChatId(chatId, input = {}) {
      return Array.from(subscriptions.values())
        .filter((subscription) => subscription.chatId === chatId)
        .filter((subscription) =>
          !('messageThreadId' in input) || subscription.messageThreadId === (input.messageThreadId ?? null));
    },
    async upsertSubscription(input) {
      if (input.isDefault) {
        for (const [key, subscription] of subscriptions) {
          if (subscription.categoryKey === input.categoryKey && subscription.isDefault) {
            subscriptions.set(key, { ...subscription, isDefault: false });
          }
        }
      }
      const messageThreadId = input.messageThreadId ?? null;
      const key = `${input.chatId}:${messageThreadId ?? 0}:${input.categoryKey}`;
      const now = '2026-07-30T10:00:00.000Z';
      const subscription: NewsGroupSubscriptionRecord = {
        chatId: input.chatId,
        messageThreadId,
        categoryKey: input.categoryKey,
        ...(input.isDefault ? { isDefault: true } : {}),
        createdAt: subscriptions.get(key)?.createdAt ?? now,
        updatedAt: now,
      };
      subscriptions.set(key, subscription);
      return subscription;
    },
    async deleteSubscription({ chatId, messageThreadId, categoryKey }) {
      return subscriptions.delete(`${chatId}:${messageThreadId ?? 0}:${categoryKey}`);
    },
    async listSubscribedGroupsByCategory(categoryKey) {
      return Array.from(subscriptions.values())
        .filter((subscription) => subscription.categoryKey === categoryKey)
        .map((subscription) => ({
          ...currentGroup,
          messageThreadId: subscription.messageThreadId,
          ...(subscription.isDefault !== undefined ? { isDefault: subscription.isDefault } : {}),
        }));
    },
    async isNewsEnabledGroup(chatId) {
      return chatId === group.chatId && group.isEnabled;
    },
  };
}

function createContext({
  isAdmin = true,
  groupEnabled = true,
}: {
  isAdmin?: boolean;
  groupEnabled?: boolean;
} = {}) {
  const group: NewsGroupRecord = {
    chatId: -1003515960088,
    isEnabled: groupEnabled,
    metadata: null,
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
    enabledAt: groupEnabled ? '2026-07-01T10:00:00.000Z' : null,
    disabledAt: groupEnabled ? null : '2026-07-01T10:00:00.000Z',
  };
  const repository = createRepository(group);
  const replies: string[] = [];
  const context: TelegramPromotionDestinationContext = {
    messageText: '',
    reply: async (message) => {
      replies.push(message);
      return {};
    },
    runtime: {
      actor: {
        telegramUserId: 42,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin,
        permissions: [],
      },
      chat: { kind: 'private', chatId: 42 },
      services: { database: { db: {} } },
      bot: {
        language: 'es',
        getChat: async (chatId) => ({
          id: chatId,
          type: 'supergroup',
          title: 'CAWA Girona',
          isForum: true,
        }),
      },
    },
    newsGroupRepository: repository,
  };
  return { context, replies, repository };
}

test('parseTelegramPromotionDestinationLink resolves General and forum topics', () => {
  assert.deepEqual(parseTelegramPromotionDestinationLink('https://t.me/c/3515960088/1'), {
    chatId: -1003515960088,
    messageThreadId: null,
  });
  assert.deepEqual(parseTelegramPromotionDestinationLink('https://t.me/c/3515960088/5'), {
    chatId: -1003515960088,
    messageThreadId: 5,
  });
  assert.deepEqual(parseTelegramPromotionDestinationLink('https://t.me/c/3515960088/3/124'), {
    chatId: -1003515960088,
    messageThreadId: 3,
  });
  assert.throws(() => parseTelegramPromotionDestinationLink('https://example.com/c/3515960088/1'));
});

test('private promotions command subscribes General as the default without posting in the group', async () => {
  const { context, replies, repository } = createContext();
  context.messageText = '/promociones suscribir default https://t.me/c/3515960088/1';

  assert.equal(await handleTelegramPromotionDestinationText(context), true);
  assert.match(replies.at(-1) ?? '', /predeterminado: CAWA Girona · General/);
  assert.deepEqual(await repository.listSubscriptionsByChatId(-1003515960088), [{
    chatId: -1003515960088,
    messageThreadId: null,
    categoryKey: 'promotions',
    isDefault: true,
    createdAt: '2026-07-30T10:00:00.000Z',
    updatedAt: '2026-07-30T10:00:00.000Z',
  }]);
});

test('private promotions command subscribes and removes a specific topic from its message link', async () => {
  const { context, replies, repository } = createContext();
  const link = 'https://t.me/c/3515960088/3/124';
  context.messageText = `/promociones suscribir ${link}`;
  assert.equal(await handleTelegramPromotionDestinationText(context), true);
  assert.match(replies.at(-1) ?? '', /CAWA Girona · topic 3/);
  assert.equal((await repository.listSubscriptionsByChatId(-1003515960088))[0]?.messageThreadId, 3);

  context.messageText = `/promociones desuscribir ${link}`;
  assert.equal(await handleTelegramPromotionDestinationText(context), true);
  assert.match(replies.at(-1) ?? '', /Destino de promociones eliminado/);
  assert.deepEqual(await repository.listSubscriptionsByChatId(-1003515960088), []);
});

test('private promotions command identifies a direct one-segment topic link', async () => {
  const { context, replies, repository } = createContext();
  context.messageText = '/promociones suscribir https://t.me/c/3515960088/5';

  assert.equal(await handleTelegramPromotionDestinationText(context), true);
  assert.match(replies.at(-1) ?? '', /CAWA Girona · topic 5/);
  assert.equal((await repository.listSubscriptionsByChatId(-1003515960088))[0]?.messageThreadId, 5);
});

test('private promotions command stores an optional display name after the URL and reuses it', async () => {
  const { context, replies, repository } = createContext();
  context.messageText = '/promociones suscribir https://t.me/c/3515960088/5 Info i Agenda';

  assert.equal(await handleTelegramPromotionDestinationText(context), true);
  assert.match(replies.at(-1) ?? '', /CAWA Girona · Info i Agenda/);
  const group = await repository.findGroupByChatId(-1003515960088);
  assert.equal(resolvePromotionDestinationDisplayName(group?.metadata ?? null, 5), 'Info i Agenda');

  context.messageText = '/promociones suscribir https://t.me/c/3515960088/5';
  assert.equal(await handleTelegramPromotionDestinationText(context), true);
  assert.match(replies.at(-1) ?? '', /CAWA Girona · Info i Agenda/);
});

test('private promotions command rejects unknown groups and non-admin users', async () => {
  const disabled = createContext({ groupEnabled: false });
  disabled.context.messageText = '/promociones suscribir https://t.me/c/3515960088/1';
  assert.equal(await handleTelegramPromotionDestinationText(disabled.context), true);
  assert.match(disabled.replies.at(-1) ?? '', /no está habilitado/);

  const member = createContext({ isAdmin: false });
  member.context.messageText = '/promociones suscribir https://t.me/c/3515960088/1';
  assert.equal(await handleTelegramPromotionDestinationText(member.context), true);
  assert.match(member.replies.at(-1) ?? '', /Sólo los administradores/);
});
