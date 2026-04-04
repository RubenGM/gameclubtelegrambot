import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveTelegramActionMenu } from './action-menu.js';
import type { AuthorizationService } from '../authorization/service.js';
import type { TelegramActor } from './actor-store.js';
import type { TelegramChatContext } from './chat-context.js';
import type { ConversationSessionRecord } from './conversation-session.js';

function createContext({
  actor,
  chat,
  session = null,
}: {
  actor: TelegramActor;
  chat: TelegramChatContext;
  session?: ConversationSessionRecord | null;
}) {
  const authorization: AuthorizationService = {
    authorize: (permissionKey) => ({
      allowed: permissionKey === 'test.allow',
      permissionKey,
      reason: permissionKey === 'test.allow' ? 'global-allow' : 'no-match',
    }),
    can: (permissionKey) => permissionKey === 'test.allow',
  };

  return {
    actor,
    authorization,
    chat,
    session,
  };
}

test('resolveTelegramActionMenu returns pending private user actions by default', async () => {
  const menu = resolveTelegramActionMenu({
    context: createContext({
      actor: {
        telegramUserId: 42,
        status: 'pending',
        isApproved: false,
        isBlocked: false,
        isAdmin: false,
        permissions: [],
      },
      chat: {
        kind: 'private',
        chatId: 1,
      },
    }),
  });

  assert.deepEqual(menu, {
    replyKeyboard: [['/access', '/start'], ['/help']],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });
});

test('resolveTelegramActionMenu returns admin private actions by default', async () => {
  const menu = resolveTelegramActionMenu({
    context: createContext({
      actor: {
        telegramUserId: 99,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin: true,
        permissions: [],
      },
      chat: {
        kind: 'private',
        chatId: 1,
      },
    }),
  });

  assert.deepEqual(menu, {
    replyKeyboard: [['Activitats', 'Taules'], ['Esdeveniments local', '/review_access'], ['/start', '/help']],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });
});

test('resolveTelegramActionMenu exposes table reads to approved non-admin members', async () => {
  const menu = resolveTelegramActionMenu({
    context: createContext({
      actor: {
        telegramUserId: 77,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin: false,
        permissions: [],
      },
      chat: {
        kind: 'private',
        chatId: 1,
      },
    }),
  });

  assert.deepEqual(menu, {
    replyKeyboard: [['Activitats', '/tables'], ['/elevate_admin', '/start'], ['/help']],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });
});

test('resolveTelegramActionMenu exposes activities to admins in private chats', async () => {
  const menu = resolveTelegramActionMenu({
    context: createContext({
      actor: {
        telegramUserId: 99,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin: true,
        permissions: [],
      },
      chat: {
        kind: 'private',
        chatId: 1,
      },
    }),
  });

  assert.deepEqual(menu, {
    replyKeyboard: [['Activitats', 'Taules'], ['Esdeveniments local', '/review_access'], ['/start', '/help']],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });
});

test('resolveTelegramActionMenu replaces the default menu when a flow is active', async () => {
  const menu = resolveTelegramActionMenu({
    context: createContext({
      actor: {
        telegramUserId: 99,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin: true,
        permissions: [],
      },
      chat: {
        kind: 'private',
        chatId: 1,
      },
      session: {
        key: 'telegram.session:1:99',
        flowKey: 'schedule-create',
        stepKey: 'title',
        data: {},
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        expiresAt: '2026-04-04T11:00:00.000Z',
      },
    }),
  });

  assert.deepEqual(menu, {
    replyKeyboard: [['/cancel']],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });
});
