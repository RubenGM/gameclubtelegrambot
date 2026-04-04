import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTelegramBoundary,
  TelegramStartupError,
  type TelegramContextLike,
  type TelegramMiddleware,
} from './runtime-boundary.js';
import type { TelegramCommandHandler } from './command-registry.js';
import type { ConversationSessionRecord } from './conversation-session.js';

const runtimeConfig = {
  schemaVersion: 1,
  bot: {
    publicName: 'Game Club Bot',
    clubName: 'Game Club',
  },
  telegram: {
    token: 'telegram-token',
  },
  database: {
    host: 'localhost',
    port: 5432,
    name: 'gameclub',
    user: 'gameclub_user',
    password: 'super-secret',
    ssl: false,
  },
  adminElevation: {
    passwordHash: 'hashed:admin-secret',
  },
  bootstrap: {
    firstAdmin: {
      telegramUserId: 123456789,
      displayName: 'Club Administrator',
    },
  },
  notifications: {
    defaults: {
      groupAnnouncementsEnabled: true,
      eventRemindersEnabled: true,
      eventReminderLeadHours: 24,
    },
  },
  featureFlags: {},
} as const;

test('createTelegramBoundary reports a connected bot when long polling starts', async () => {
  const events: string[] = [];
  const sessionRecords = new Map<string, ConversationSessionRecord>();
  const databaseConnection = {
    pool: undefined as never,
    db: undefined as never,
    close: async () => {},
  };

  const telegram = await createTelegramBoundary({
    config: runtimeConfig,
    logger: {
      info: () => {},
      error: () => {},
    },
    services: {
      database: databaseConnection,
    },
    loadActor: async ({ telegramUserId }) => ({
      telegramUserId,
      status: 'approved',
      isApproved: true,
      isBlocked: false,
      isAdmin: false,
      permissions: [],
    }),
    createConversationSessionStore: () => ({
      loadSession: async (key) => sessionRecords.get(key) ?? null,
      saveSession: async (session) => {
        sessionRecords.set(session.key, session);
      },
      deleteSession: async (key) => sessionRecords.delete(key),
      deleteExpiredSessions: async () => 0,
    }),
    createBot: ({ token }) => {
      const middlewares: TelegramMiddleware[] = [];
      const commandHandlers = new Map<string, TelegramCommandHandler>();

      events.push(`token:${token}`);

      return {
        use: (middleware) => {
          events.push('middleware:register');
          middlewares.push(middleware);
        },
        onCommand: (command, handler) => {
          events.push(`register:/${command}`);
          commandHandlers.set(command, handler);
        },
        startPolling: async () => {
          const context: TelegramContextLike = {
            chat: {
              id: -100,
              type: 'group',
            },
            from: {
              id: 42,
            },
            reply: async (message: string) => {
              events.push(`reply:${message}`);
            },
          };

          let index = -1;
          const dispatch = async (middlewareIndex: number): Promise<void> => {
            if (middlewareIndex <= index) {
              throw new Error('next called multiple times');
            }

            index = middlewareIndex;

            if (middlewareIndex === middlewares.length) {
              events.push(`runtime:database:${Number((context.runtime as { services: { database: unknown } }).services.database === databaseConnection)}`);
              const startHandler = commandHandlers.get('start');
              if (!startHandler) {
                throw new Error('start handler not registered');
              }

              const commandContext = context as unknown as import('./command-registry.js').TelegramCommandHandlerContext;

              await startHandler(commandContext);
              await commandHandlers.get('help')?.(commandContext);
              return;
            }

            const middleware = middlewares[middlewareIndex];

            if (!middleware) {
              throw new Error(`middleware ${middlewareIndex} not registered`);
            }

            await middleware(context, () => dispatch(middlewareIndex + 1));
          };

          await dispatch(0);
          events.push('start-polling');
        },
        stopPolling: async () => {
          events.push('stop-polling');
        },
      };
    },
  });

  assert.equal(telegram.status.bot, 'connected');

  await telegram.stop();

  assert.deepEqual(events, [
    'token:telegram-token',
    'middleware:register',
    'middleware:register',
    'middleware:register',
    'middleware:register',
    'middleware:register',
    'middleware:register',
    'register:/cancel',
    'register:/start',
    'register:/help',
    'runtime:database:1',
    'reply:Game Club Bot online. Escriu /start per comprovar que la connexio amb Telegram funciona.',
    'reply:Comandes disponibles en aquest xat:\n/cancel - Cancel.la el flux actual\n/start - Comprova que el bot esta actiu\n/help - Mostra ajuda contextual\n\nPer veure totes les funcions, escriu-me en privat.',
    'start-polling',
    'stop-polling',
  ]);
});

test('createTelegramBoundary replies with a safe message and clears session on unexpected handler errors', async () => {
  const replies: string[] = [];
  let cancelCalls = 0;

  const telegram = await createTelegramBoundary({
    config: runtimeConfig,
    logger: {
      info: () => {},
      error: () => {},
    },
    services: {
      database: {
        pool: undefined as never,
        db: undefined as never,
        close: async () => {},
      },
    },
    loadActor: async ({ telegramUserId }) => ({
      telegramUserId,
      status: 'approved',
      isApproved: true,
      isBlocked: false,
      isAdmin: false,
      permissions: [],
    }),
    createConversationSessionStore: () => ({
      loadSession: async () => ({
        key: 'telegram.session:-100:42',
        flowKey: 'broken-flow',
        stepKey: 'confirm',
        data: {},
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        expiresAt: '2026-04-04T11:00:00.000Z',
      }),
      saveSession: async () => {},
      deleteSession: async () => {
        cancelCalls += 1;
        return true;
      },
      deleteExpiredSessions: async () => 0,
    }),
    createBot: () => {
      const middlewares: TelegramMiddleware[] = [];
      const commandHandlers = new Map<string, TelegramCommandHandler>();

      return {
        use: (middleware) => {
          middlewares.push(middleware);
        },
        onCommand: (command, handler) => {
          commandHandlers.set(command, handler);
        },
        startPolling: async () => {
          const context: TelegramContextLike = {
            chat: {
              id: -100,
              type: 'group',
            },
            from: {
              id: 42,
            },
            reply: async (message: string) => {
              replies.push(message);
            },
          };

          const failingCommand = async () => {
            throw new Error('database timeout');
          };

          commandHandlers.set('explode', failingCommand as TelegramCommandHandler);

          let index = -1;
          const dispatch = async (middlewareIndex: number): Promise<void> => {
            if (middlewareIndex <= index) {
              throw new Error('next called multiple times');
            }

            index = middlewareIndex;

            if (middlewareIndex === middlewares.length) {
              const handler = commandHandlers.get('explode');
              if (!handler) {
                throw new Error('explode handler not registered');
              }

              await handler(context as unknown as import('./command-registry.js').TelegramCommandHandlerContext);
              return;
            }

            const middleware = middlewares[middlewareIndex];
            if (!middleware) {
              throw new Error(`middleware ${middlewareIndex} not registered`);
            }

            await middleware(context, () => dispatch(middlewareIndex + 1));
          };

          await dispatch(0);
        },
        stopPolling: async () => {},
      };
    },
  });

  assert.equal(telegram.status.bot, 'connected');
  assert.equal(cancelCalls, 1);
  assert.deepEqual(replies, ['S ha produit un error inesperat. Torna-ho a provar en uns moments.']);
});

test('createTelegramBoundary throws a predictable error when Telegram startup fails', async () => {
  await assert.rejects(
    () =>
      createTelegramBoundary({
        config: runtimeConfig,
        logger: {
          info: () => {},
          error: () => {},
        },
        services: {
          database: {
            pool: undefined as never,
            db: undefined as never,
            close: async () => {},
          },
        },
        createBot: () => ({
          use: () => {},
          onCommand: () => {},
          startPolling: async () => {
            throw new Error('Unauthorized');
          },
          stopPolling: async () => {},
        }),
      }),
    (error: unknown) => {
      assert.equal(error instanceof TelegramStartupError, true);
      assert.match(error instanceof Error ? error.message : '', /Telegram startup failed: Unauthorized/);
      return true;
    },
  );
});
