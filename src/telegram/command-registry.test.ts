import test from 'node:test';
import assert from 'node:assert/strict';

import {
  registerTelegramCommands,
  type TelegramCommandDefinition,
  type TelegramCommandHandlerContext,
} from './command-registry.js';

function createContext(kind: 'private' | 'group' | 'group-news'): TelegramCommandHandlerContext {
  const replies: string[] = [];

  return {
    reply: async (message: string) => {
      replies.push(message);
    },
    runtime: {
      bot: {
        publicName: 'Game Club Bot',
        clubName: 'Game Club',
      },
      services: {
        database: {
          pool: undefined as never,
          db: undefined as never,
          close: async () => {},
        },
      },
      chat: {
        kind,
        chatId: kind === 'private' ? 1 : -1,
      },
      session: {
        current: null,
        start: async () => {
          throw new Error('not used in command registry tests');
        },
        advance: async () => {
          throw new Error('not used in command registry tests');
        },
        cancel: async () => false,
      },
    },
    __replies: replies,
  };
}

test('registerTelegramCommands dispatches allowed commands predictably', async () => {
  const events: string[] = [];
  const handlers = new Map<string, (context: TelegramCommandHandlerContext) => Promise<unknown> | unknown>();
  const commands: TelegramCommandDefinition[] = [
    {
      command: 'start',
      contexts: ['private', 'group', 'group-news'],
      handle: async () => {
        events.push('handle:start');
      },
    },
    {
      command: 'help',
      contexts: ['private'],
      handle: async () => {
        events.push('handle:help');
      },
    },
  ];

  registerTelegramCommands({
    bot: {
      onCommand: (command, handler) => {
        events.push(`register:${command}`);
        handlers.set(command, handler);
      },
    },
    commands,
  });

  await handlers.get('start')?.(createContext('group'));
  await handlers.get('help')?.(createContext('private'));

  assert.deepEqual(events, ['register:start', 'register:help', 'handle:start', 'handle:help']);
});

test('registerTelegramCommands enforces chat restrictions centrally', async () => {
  const handlers = new Map<string, (context: TelegramCommandHandlerContext) => Promise<unknown> | unknown>();

  registerTelegramCommands({
    bot: {
      onCommand: (command, handler) => {
        handlers.set(command, handler);
      },
    },
    commands: [
      {
        command: 'help',
        contexts: ['private'],
        handle: async () => {
          assert.fail('restricted command handler should not run');
        },
      },
    ],
  });

  const context = createContext('group');
  await handlers.get('help')?.(context);

  assert.deepEqual(context.__replies, ['Aquest comandament nomes esta disponible en xat privat.']);
});
