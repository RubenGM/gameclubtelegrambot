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
        sendPrivateMessage: async () => {},
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
      authorization: {
        authorize: (permissionKey: string) => ({
          allowed: permissionKey === 'test.allow',
          permissionKey,
          reason: permissionKey === 'test.allow' ? 'global-allow' : 'no-match',
        }),
        can: (permissionKey: string) => permissionKey === 'test.allow',
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

  assert.deepEqual(context.__replies, ['Aquest comandament només està disponible en xat privat.']);
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

  assert.match(context.__replies?.[0] ?? '', /Encara no tens l'accés aprovat/);
  assert.match(context.__replies?.[0] ?? '', /avisa un administrador/i);
});

test('renderTelegramHelpMessage reminds pending private users to ask an admin for approval', async () => {
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
    ],
    context: createContext({ kind: 'private', isApproved: false, isAdmin: false }),
  });

  assert.match(message, /Què pots fer ara/);
  assert.match(message, /Accés al club/);
  assert.match(message, /Idioma/);
  assert.match(message, /avisa un administrador/i);
  assert.doesNotMatch(message, /\/start/);
  assert.doesNotMatch(message, /\/reserve/);
});

test('renderTelegramHelpMessage lists all current member menu options', async () => {
  const message = renderTelegramHelpMessage({
    commands: [],
    context: createContext({ kind: 'private', isApproved: true, isAdmin: false }),
  });

  assert.match(message, /Activitats: consulta i gestiona les activitats del club/i);
  assert.match(message, /Taules: consulta les taules actives del local/i);
  assert.match(message, /Catàleg: explora jocs, llibres i préstecs/i);
  assert.match(message, /Emmagatzematge: consulta material guardat del club/i);
  assert.match(message, /Compres conjuntes: segueix i participa en comandes compartides/i);
  assert.match(message, /Idioma: canvia l'idioma del bot/i);
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

  assert.deepEqual(context.__replies, ['Aquesta acció només està disponible per a administradors del club.']);
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

  assert.match(message, /Què pots fer ara/);
  assert.match(message, /escriu-me en privat/i);
  assert.doesNotMatch(message, /\/reserve/);
  assert.doesNotMatch(message, /\/admin/);
  assert.doesNotMatch(message, /\/start/);
});
