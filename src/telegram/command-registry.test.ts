import test from 'node:test';
import assert from 'node:assert/strict';

import {
  registerTelegramCommands,
  renderTelegramHelpMessage,
  TelegramInteractionError,
  type TelegramCommandDefinition,
  type TelegramCommandHandlerContext,
} from './command-registry.js';

function createContext({
  kind,
  isApproved = true,
  isAdmin = false,
}: {
  kind: 'private' | 'group' | 'group-news';
  isApproved?: boolean;
  isAdmin?: boolean;
}): TelegramCommandHandlerContext {
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
      actor: {
        telegramUserId: 123,
        status: isApproved ? 'approved' : 'pending',
        isApproved,
        isBlocked: false,
        isAdmin,
        permissions: [],
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
      access: 'approved',
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

  await handlers.get('start')?.(createContext({ kind: 'group' }));
  await handlers.get('help')?.(createContext({ kind: 'private' }));

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

  const context = createContext({ kind: 'group' });
  await handlers.get('help')?.(context);

  assert.deepEqual(context.__replies, ['Aquest comandament nomes esta disponible en xat privat.']);
});

test('registerTelegramCommands blocks unapproved users consistently', async () => {
  const handlers = new Map<string, (context: TelegramCommandHandlerContext) => Promise<unknown> | unknown>();

  registerTelegramCommands({
    bot: {
      onCommand: (command, handler) => {
        handlers.set(command, handler);
      },
    },
    commands: [
      {
        command: 'reserve',
        contexts: ['private'],
        access: 'approved',
        handle: async () => {
          assert.fail('unapproved user should be blocked before handler');
        },
      },
    ],
  });

  const context = createContext({ kind: 'private', isApproved: false });
  await handlers.get('reserve')?.(context);

  assert.deepEqual(context.__replies, ['Necessites aprovacio del club abans de poder fer aquesta accio.']);
});

test('registerTelegramCommands blocks non-admin users consistently', async () => {
  const handlers = new Map<string, (context: TelegramCommandHandlerContext) => Promise<unknown> | unknown>();

  registerTelegramCommands({
    bot: {
      onCommand: (command, handler) => {
        handlers.set(command, handler);
      },
    },
    commands: [
      {
        command: 'admin',
        contexts: ['private'],
        access: 'admin',
        handle: async () => {
          assert.fail('non-admin user should be blocked before handler');
        },
      },
    ],
  });

  const context = createContext({ kind: 'private', isApproved: true, isAdmin: false });
  await handlers.get('admin')?.(context);

  assert.deepEqual(context.__replies, ['Aquesta accio nomes esta disponible per a administradors del club.']);
});

test('registerTelegramCommands turns interaction errors into safe replies and clears session', async () => {
  const handlers = new Map<string, (context: TelegramCommandHandlerContext) => Promise<unknown> | unknown>();
  let cancelCalls = 0;

  registerTelegramCommands({
    bot: {
      onCommand: (command, handler) => {
        handlers.set(command, handler);
      },
    },
    commands: [
      {
        command: 'broken-flow',
        contexts: ['private'],
        handle: async () => {
          throw new TelegramInteractionError('No hem pogut continuar el flux actual.', {
            cancelSession: true,
          });
        },
      },
    ],
  });

  const context = createContext({ kind: 'private' });
  context.runtime.session.cancel = async () => {
    cancelCalls += 1;
    return true;
  };

  await handlers.get('broken-flow')?.(context);

  assert.equal(cancelCalls, 1);
  assert.deepEqual(context.__replies, ['No hem pogut continuar el flux actual.']);
});

test('renderTelegramHelpMessage adapts shared help to chat context and access', async () => {
  const message = renderTelegramHelpMessage({
    commands: [
      {
        command: 'start',
        contexts: ['private', 'group', 'group-news'],
        access: 'public',
        description: 'Comprova l estat del bot',
        handle: async () => {},
      },
      {
        command: 'reserve',
        contexts: ['private'],
        access: 'approved',
        description: 'Inicia una reserva',
        handle: async () => {},
      },
      {
        command: 'admin',
        contexts: ['private'],
        access: 'admin',
        description: 'Obre eines d administracio',
        handle: async () => {},
      },
    ],
    context: createContext({ kind: 'group', isApproved: true, isAdmin: false }),
  });

  assert.match(message, /Comandes disponibles en aquest xat/);
  assert.match(message, /\/start - Comprova l estat del bot/);
  assert.doesNotMatch(message, /\/reserve/);
  assert.doesNotMatch(message, /\/admin/);
  assert.match(message, /Per veure totes les funcions, escriu-me en privat/);
});
