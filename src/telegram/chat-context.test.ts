import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveTelegramChatContext } from './chat-context.js';

test('resolveTelegramChatContext marks private chats as private context', async () => {
  const context = await resolveTelegramChatContext({
    chat: {
      id: 10,
      type: 'private',
    },
  });

  assert.deepEqual(context, {
    kind: 'private',
    chatId: 10,
  });
});

test('resolveTelegramChatContext marks groups as group context by default', async () => {
  const context = await resolveTelegramChatContext({
    chat: {
      id: -100,
      type: 'group',
    },
  });

  assert.deepEqual(context, {
    kind: 'group',
    chatId: -100,
  });
});

test('resolveTelegramChatContext marks news-enabled groups separately', async () => {
  const context = await resolveTelegramChatContext({
    chat: {
      id: -200,
      type: 'supergroup',
    },
    isNewsEnabledGroup: async ({ chatId }) => chatId === -200,
  });

  assert.deepEqual(context, {
    kind: 'group-news',
    chatId: -200,
  });
});

test('resolveTelegramChatContext rejects unsupported chats centrally', async () => {
  await assert.rejects(
    () =>
      resolveTelegramChatContext({
        chat: {
          id: 99,
          type: 'channel',
        },
      }),
    /Unsupported Telegram chat type: channel/,
  );
});
