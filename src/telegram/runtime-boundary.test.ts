import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTelegramBoundary,
  formatStartMessage,
  isTelegramInternalTextCommand,
  isTelegramRawCommandMatch,
  runTelegramCallbackHandler,
  TelegramStartupError,
  type TelegramContextLike,
  type TelegramReplyOptions,
  type TelegramMiddleware,
  toGrammyReplyOptions,
} from './runtime-boundary.js';
import type { TelegramCommandHandler, TelegramCommandHandlerContext } from './command-registry.js';
import type { ConversationSessionRecord } from './conversation-session.js';
import { createTelegramI18n } from './i18n.js';
import { registerHandlers } from './runtime-boundary-registration.js';

const runtimeConfig = {
  schemaVersion: 1,
  bot: {
    publicName: 'Game Club Bot',
    clubName: 'Game Club',
    language: 'ca',
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

function replyKeyboardLabels(replyKeyboard: TelegramReplyOptions['replyKeyboard']): string[][] | undefined {
  return replyKeyboard?.map((row) =>
    row.map((button) => typeof button === 'string' ? button : button.text),
  );
}

function formatShortTime(value: string): string {
  const date = new Date(value);
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${String(date.getHours()).padStart(2, '0')}:${minutes}`;
}

function formatTimeRange(startsAt: string, endsAt: string): string {
  return `${formatShortTime(startsAt)}-${formatShortTime(endsAt)}`;
}

test('createTelegramBoundary reports a connected bot when long polling starts', async () => {
  const events: string[] = [];
  const sessionRecords = new Map<string, ConversationSessionRecord>();
  const membershipUsers = new Map<
    number,
    { telegramUserId: number; username?: string | null; displayName: string; status: string; isAdmin: boolean }
  >();
  const statusAuditLog: Array<{ telegramUserId: number; nextStatus: string }> = [];
  const auditEvents: Array<{ actionKey: string; targetType: string; targetId: string; summary: string; details: Record<string, unknown> | null }> = [];
  const databaseConnection = {
    pool: undefined as never,
    db: createMembershipDatabaseStub({ membershipUsers, statusAuditLog, auditEvents }) as never,
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
      status: telegramUserId === 42 ? 'pending' : 'approved',
      isApproved: telegramUserId !== 42,
      isBlocked: false,
      isAdmin: telegramUserId === 99,
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
      const callbackHandlers = new Map<string, TelegramCommandHandler>();
      let textHandler: TelegramCommandHandler | undefined;

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
        onCallback: (callbackPrefix, handler) => {
          events.push(`register:callback:${callbackPrefix}`);
          callbackHandlers.set(callbackPrefix, handler);
        },
        onText: (handler) => {
          textHandler = handler;
        },
        username: 'gameclub_test_bot',
        sendPrivateMessage: async () => {},
        startPolling: async () => {
          const context: TelegramContextLike = {
            chat: {
              id: 100,
              type: 'private',
            },
            from: {
              id: 42,
              username: 'new_member',
              first_name: 'New',
            },
            reply: async (message: string, options?: TelegramReplyOptions) => {
              events.push(`reply:${message}`);
              if (options?.inlineKeyboard) {
                events.push(`buttons:${options.inlineKeyboard.flat().map((button) => button.text).join('|')}`);
              }
              if (options?.replyKeyboard) {
                events.push(`reply-keyboard:${options.replyKeyboard.flat().map((button) => typeof button === 'string' ? button : button.text).join('|')}`);
              }
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
              const accessHandler = commandHandlers.get('access');
              const reviewHandler = commandHandlers.get('review_access');
              const manageUsersHandler = commandHandlers.get('manage_users');
              const approveHandler = callbackHandlers.get('approve_access:');
              if (!startHandler) {
                throw new Error('start handler not registered');
              }
              if (!accessHandler || !reviewHandler || !approveHandler || !manageUsersHandler) {
                throw new Error('membership handlers not registered');
              }

              const commandContext = context as unknown as import('./command-registry.js').TelegramCommandHandlerContext;

              await accessHandler(commandContext);
              context.messageText = 'New';
              await textHandler?.(commandContext);
              await startHandler(commandContext);
              context.from = {
                id: 99,
                username: 'club_admin',
                first_name: 'Admin',
              };
              if (context.runtime?.actor) {
                context.runtime.actor = {
                  telegramUserId: 99,
                  status: 'approved',
                  isApproved: true,
                  isBlocked: false,
                  isAdmin: true,
                  permissions: [],
                };
              }
              context.messageText = '/review_access';
              await reviewHandler(commandContext);
              context.messageText = '/manage_users';
              await manageUsersHandler(commandContext);
              context.callbackData = 'approve_access:42';
              await approveHandler(commandContext);
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

  assert.equal(events[0], 'token:telegram-token');
  assert.ok(events.includes('register:/access'));
  assert.ok(events.includes('register:callback:approve_access:'));
  assert.ok(events.includes('runtime:database:1'));
  assert.ok(events.includes('reply:Com vols que et conegui el bot? Escriu el nom que vols mostrar.'));
  assert.ok(events.some((event) => event.startsWith("reply:He registrat la teva sol·licitud d'accés.")));
  assert.ok(events.some((event) => event.startsWith('reply:Sol·licituds pendents:')));
  assert.ok(events.some((event) => event.includes('LFG (buscar grup): troba grup o jugadors per jugar.')));
  assert.equal(events.at(-2), 'start-polling');
  assert.equal(events.at(-1), 'stop-polling');
  assert.equal(membershipUsers.get(42)?.status, 'approved');
  assert.deepEqual(
    statusAuditLog.map((entry) => `${entry.telegramUserId}:${entry.nextStatus}`),
    ['42:pending', '42:approved'],
  );
  assert.deepEqual(auditEvents, [
    {
      actionKey: 'telegram.menu.shown',
      targetType: 'telegram-menu',
      targetId: 'private-pending-default',
      summary: 'Telegram menu shown: private-pending-default',
      details: {
        chatKind: 'private',
        actorRole: 'pending',
        language: 'ca',
        visibleActionIds: ['access', 'language', 'help'],
        visibleLabels: ['Accés al club', 'Idioma', 'Ajuda'],
      },
    },
    {
      actionKey: 'telegram.menu.shown',
      targetType: 'telegram-menu',
      targetId: 'private-pending-default',
      summary: 'Telegram menu shown: private-pending-default',
      details: {
        chatKind: 'private',
        actorRole: 'pending',
        language: 'ca',
        visibleActionIds: ['access', 'language', 'help'],
        visibleLabels: ['Accés al club', 'Idioma', 'Ajuda'],
      },
    },
    {
      actionKey: 'membership.approved',
      targetType: 'membership-user',
      targetId: '42',
      summary: 'Usuari aprovat correctament',
      details: {
        previousStatus: 'pending',
        nextStatus: 'approved',
      },
    },
  ]);
});

test('approving membership from the bot does not publish welcome templates', async () => {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const privateMessages: Array<{ telegramUserId: number; message: string }> = [];
  const groupMessages: Array<{ chatId: number; message: string; options?: TelegramReplyOptions }> = [];
  const sessionRecords = new Map<string, ConversationSessionRecord>();
  const now = new Date('2026-05-28T10:00:00.000Z');
  const membershipUsers = new Map<
    number,
    { telegramUserId: number; username?: string | null; displayName: string; status: string; isAdmin: boolean }
  >([
    [42, { telegramUserId: 42, username: 'new_member', displayName: 'Tester Club', status: 'pending', isAdmin: false }],
  ]);
  const appMetadataRecords = new Map<string, string>([
    ['telegram.welcome_templates', JSON.stringify([{
      id: 'welcome_1',
      templateText: 'Benvingut $USERNAME',
      templateHtml: '<b>Benvingut $USERNAME</b>',
      animationFileId: null,
      targetTelegramUserId: null,
      isEnabled: true,
      sortOrder: 0,
    }])],
  ]);
  const newsGroupRecords = new Map([
    [-200, { chatId: -200, isEnabled: true, metadata: null, createdAt: now, updatedAt: now, enabledAt: now, disabledAt: null }],
  ]);
  const newsGroupSubscriptions = new Map([
    ['nuevos_miembros', new Set([-200])],
  ]);
  const databaseConnection = {
    pool: undefined as never,
    db: createMembershipDatabaseStub({
      membershipUsers,
      statusAuditLog: [],
      auditEvents: [],
      appMetadataRecords,
      newsGroupRecords,
      newsGroupSubscriptions,
    }) as never,
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
      isAdmin: telegramUserId === 99,
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
    createBot: () => {
      const middlewares: TelegramMiddleware[] = [];
      const callbackHandlers = new Map<string, TelegramCommandHandler>();

      return {
        use: (middleware) => {
          middlewares.push(middleware);
        },
        onCommand: () => {},
        onCallback: (callbackPrefix, handler) => {
          callbackHandlers.set(callbackPrefix, handler);
        },
        onText: () => {},
        username: 'gameclub_test_bot',
        sendPrivateMessage: async (telegramUserId, message) => {
          privateMessages.push({ telegramUserId, message });
        },
        sendGroupMessage: async (chatId, message, options) => {
          groupMessages.push(options ? { chatId, message, options } : { chatId, message });
        },
        startPolling: async () => {
          const context: TelegramContextLike = {
            chat: {
              id: 100,
              type: 'private',
            },
            from: {
              id: 99,
              username: 'club_admin',
              first_name: 'Admin',
            },
            callbackData: 'approve_access:42',
            reply: async (message: string, options?: TelegramReplyOptions) => {
              replies.push(options ? { message, options } : { message });
            },
          };

          let index = -1;
          const dispatch = async (middlewareIndex: number): Promise<void> => {
            if (middlewareIndex <= index) {
              throw new Error('next called multiple times');
            }

            index = middlewareIndex;
            if (middlewareIndex === middlewares.length) {
              const approveHandler = callbackHandlers.get('approve_access:');
              if (!approveHandler) {
                throw new Error('approve handler not registered');
              }
              await approveHandler(context as unknown as TelegramCommandHandlerContext);
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

  await telegram.stop();

  assert.equal(replies[0]?.message.includes('aprovat') || replies[0]?.message.includes('aprobado'), true);
  assert.deepEqual(privateMessages, []);
  assert.deepEqual(groupMessages, []);
});

test('joining a group does not publish a welcome template', async () => {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const groupMessages: Array<{ chatId: number; message: string; options?: TelegramReplyOptions }> = [];
  const animations: Array<{ chatId: number; animationFileId: string; caption?: string }> = [];
  const appMetadataRecords = new Map<string, string>([
    ['telegram.welcome_templates', JSON.stringify([{
      id: 'welcome_1',
      templateText: 'Benvingut $USERNAME',
      templateHtml: '<b>Benvingut $USERNAME</b>',
      animationFileId: 'gif-file-id',
      targetTelegramUserId: null,
      isEnabled: true,
      sortOrder: 0,
    }])],
  ]);
  let messageHandler: TelegramCommandHandler | undefined;

  const telegram = await createTelegramBoundary({
    config: runtimeConfig,
    logger: {
      info: () => {},
      error: () => {},
    },
    services: {
      database: {
        pool: undefined as never,
        db: createMembershipDatabaseStub({
          membershipUsers: new Map([
            [42, { telegramUserId: 42, username: 'new_member', displayName: 'Tester Club', status: 'approved', isAdmin: false }],
          ]),
          statusAuditLog: [],
          auditEvents: [],
          appMetadataRecords,
        }) as never,
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
      loadSession: async () => null,
      saveSession: async () => {},
      deleteSession: async () => false,
      deleteExpiredSessions: async () => 0,
    }),
    createBot: () => {
      const middlewares: TelegramMiddleware[] = [];

      return {
        use: (middleware) => {
          middlewares.push(middleware);
        },
        onCommand: () => {},
        onCallback: () => {},
        onText: () => {},
        onMessage: (handler) => {
          messageHandler = handler;
        },
        sendPrivateMessage: async () => {},
        sendGroupMessage: async (chatId, message, options) => {
          groupMessages.push(options ? { chatId, message, options } : { chatId, message });
        },
        sendAnimation: async ({ chatId, animationFileId, caption }) => {
          animations.push({ chatId, animationFileId, ...(caption ? { caption } : {}) });
        },
        startPolling: async () => {
          const context: TelegramContextLike = {
            chat: {
              id: -200,
              type: 'group',
            },
            from: {
              id: 42,
              username: 'new_member',
              first_name: 'Tester',
            },
            newChatMembers: [{
              id: 42,
              username: 'new_member',
              first_name: 'Tester',
              is_bot: false,
            }],
            reply: async (message: string, options?: TelegramReplyOptions) => {
              replies.push(options ? { message, options } : { message });
            },
          };

          let index = -1;
          const dispatch = async (middlewareIndex: number): Promise<void> => {
            if (middlewareIndex <= index) {
              throw new Error('next called multiple times');
            }

            index = middlewareIndex;
            if (middlewareIndex === middlewares.length) {
              if (!messageHandler) {
                throw new Error('telegram message handler not registered');
              }
              await messageHandler(context as unknown as TelegramCommandHandlerContext);
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

  await telegram.stop();

  assert.deepEqual(replies, []);
  assert.deepEqual(groupMessages, []);
  assert.deepEqual(animations, []);
});

test('createTelegramBoundary marks configured news groups as group-news chats', async () => {
  const events: string[] = [];

  const telegram = await createTelegramBoundary({
    config: runtimeConfig,
    logger: {
      info: () => {},
      error: () => {},
    },
    services: {
      database: {
        pool: undefined as never,
        db: createNewsGroupDatabaseStub() as never,
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
      loadSession: async () => null,
      saveSession: async () => {},
      deleteSession: async () => false,
      deleteExpiredSessions: async () => 0,
    }),
    createBot: () => {
      const middlewares: TelegramMiddleware[] = [];

      return {
        use: (middleware) => {
          middlewares.push(middleware);
        },
        onCommand: () => {},
        onCallback: () => {},
        onText: () => {},
        sendPrivateMessage: async () => {},
        startPolling: async () => {
          const context: TelegramContextLike = {
            chat: {
              id: -200,
              type: 'group',
            },
            from: {
              id: 42,
            },
            reply: async () => {},
          };

          let index = -1;
          const dispatch = async (middlewareIndex: number): Promise<void> => {
            if (middlewareIndex <= index) {
              throw new Error('next called multiple times');
            }

            index = middlewareIndex;

            if (middlewareIndex === middlewares.length) {
              events.push(`chat-kind:${context.runtime?.chat?.kind ?? 'missing'}`);
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
  assert.deepEqual(events, ['chat-kind:group-news']);

  await telegram.stop();
});

test('createTelegramBoundary registers member-facing table callbacks', async () => {
  const events: string[] = [];

  const telegram = await createTelegramBoundary({
    config: runtimeConfig,
    logger: {
      info: () => {},
      error: () => {},
    },
    services: {
      database: {
        pool: undefined as never,
        db: createEmptyScheduleDatabaseStub() as never,
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
      loadSession: async () => null,
      saveSession: async () => {},
      deleteSession: async () => false,
      deleteExpiredSessions: async () => 0,
    }),
    createBot: () => ({
      use: () => {},
      onCommand: (command) => {
        events.push(`register:/${command}`);
      },
      onCallback: (callbackPrefix) => {
        events.push(`register:callback:${callbackPrefix}`);
      },
      onText: () => {},
      sendPrivateMessage: async () => {},
      startPolling: async () => {},
      stopPolling: async () => {},
    }),
  });

  await telegram.stop();

  assert.ok(events.includes('register:/tables'));
  assert.ok(events.includes('register:callback:table_read:inspect:'));
  assert.ok(events.includes('register:/venue_events'));
  assert.ok(events.includes('register:callback:venue_event_admin:inspect:'));
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
        db: createEmptyScheduleDatabaseStub() as never,
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
        expiresAt: '2099-04-04T11:00:00.000Z',
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
        onCallback: () => {},
        onText: () => {},
        sendPrivateMessage: async () => {},
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
  assert.deepEqual(replies, ["No s'ha pogut completar l'acció. Error exacte: database timeout"]);
});

test('runTelegramCallbackHandler still acknowledges the callback when the handler throws', async () => {
  const calls: string[] = [];
  const handlerError = new Error('handler failed');

  await assert.rejects(
    () =>
      runTelegramCallbackHandler({
        handle: async () => {
          calls.push('handle');
          throw handlerError;
        },
        acknowledge: async () => {
          calls.push('ack');
        },
      }),
    handlerError,
  );

  assert.deepEqual(calls, ['ack', 'handle']);
});

test('runTelegramCallbackHandler still handles the callback when acknowledgement is stale', async () => {
  const calls: string[] = [];

  await runTelegramCallbackHandler({
    acknowledge: async () => {
      calls.push('ack');
      throw new Error('query is too old');
    },
    handle: async () => {
      calls.push('handle');
    },
  });

  assert.deepEqual(calls, ['ack', 'handle']);
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
          onCallback: () => {},
          onText: () => {},
          sendPrivateMessage: async () => {},
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

test('createTelegramBoundary reports unexpected polling failures after startup', async () => {
  let emitFatalRuntimeError: ((error: unknown) => void) | undefined;
  const reportedErrors: unknown[] = [];

  const telegram = await createTelegramBoundary({
    config: runtimeConfig,
    logger: {
      info: () => {},
      error: () => {},
    },
    services: {
      database: {
        pool: undefined as never,
        db: createMembershipDatabaseStub({
          membershipUsers: new Map(),
          statusAuditLog: [],
          auditEvents: [],
        }) as never,
        close: async () => {},
      },
    },
    onFatalRuntimeError: (error) => {
      reportedErrors.push(error);
    },
    createBot: ({ onFatalRuntimeError }) => {
      emitFatalRuntimeError = onFatalRuntimeError;

      return {
        use: () => {},
        onCommand: () => {},
        onCallback: () => {},
        onText: () => {},
        sendPrivateMessage: async () => {},
        startPolling: async () => {},
        stopPolling: async () => {},
      };
    },
  });

  const error = new Error('polling failed');
  emitFatalRuntimeError?.(error);

  assert.deepEqual(reportedErrors, [error]);

  await telegram.stop();
});

test('toGrammyReplyOptions converts inline keyboards to grammY reply markup', async () => {
  assert.deepEqual(
    toGrammyReplyOptions({
      inlineKeyboard: [
        [
          { text: 'Aprovar', callbackData: 'approve_access:42' },
          { text: 'Rebutjar', callbackData: 'reject_access:42' },
        ],
      ],
    }),
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Aprovar', callback_data: 'approve_access:42' },
            { text: 'Rebutjar', callback_data: 'reject_access:42' },
          ],
        ],
      },
    },
  );
});

test('toGrammyReplyOptions preserves parse mode without keyboards', async () => {
  assert.deepEqual(toGrammyReplyOptions({ parseMode: 'HTML' }), {
    parse_mode: 'HTML',
  });
});

test('toGrammyReplyOptions preserves topic targets without keyboards', async () => {
  assert.deepEqual(toGrammyReplyOptions({ parseMode: 'HTML', messageThreadId: 77 }), {
    parse_mode: 'HTML',
    message_thread_id: 77,
  });
});

test('toGrammyReplyOptions converts reply keyboard to grammY reply markup', async () => {
  assert.deepEqual(
    toGrammyReplyOptions({
      replyKeyboard: [['/review_access', '/help']],
      resizeKeyboard: true,
      persistentKeyboard: true,
    }),
    {
      reply_markup: {
        keyboard: [[{ text: '/review_access' }, { text: '/help' }]],
        resize_keyboard: true,
        is_persistent: true,
      },
    },
  );
});

test('toGrammyReplyOptions applies configured style and custom emoji to reply keyboard buttons', async () => {
  assert.deepEqual(
    toGrammyReplyOptions(
      {
        replyKeyboard: [[{ text: 'Activitats', semanticRole: 'primary' }, { text: 'Ajuda', semanticRole: 'help' }]],
        resizeKeyboard: true,
        persistentKeyboard: true,
      },
      {
        primary: {
          style: 'primary',
          iconCustomEmojiId: '5393123412341234123',
        },
        help: {
          iconCustomEmojiId: '5393123412341234888',
        },
      },
    ),
    {
      reply_markup: {
        keyboard: [[
          { text: 'Activitats', style: 'primary', icon_custom_emoji_id: '5393123412341234123' },
          { text: 'Ajuda', icon_custom_emoji_id: '5393123412341234888' },
        ]],
        resize_keyboard: true,
        is_persistent: true,
      },
    },
  );
});

test('toGrammyReplyOptions converts request_chat reply keyboard buttons to raw Bot API payloads', async () => {
  assert.deepEqual(
    toGrammyReplyOptions({
      replyKeyboard: [[{
        text: 'Compartir supergrupo',
        semanticRole: 'primary',
        requestChat: {
          requestId: 7001,
          chatIsChannel: false,
          chatIsForum: true,
          botIsMember: true,
          userAdministratorRights: {
            isAnonymous: false,
            canManageChat: true,
            canDeleteMessages: false,
            canManageVideoChats: false,
            canRestrictMembers: false,
            canPromoteMembers: false,
            canChangeInfo: false,
            canInviteUsers: true,
            canPostStories: false,
            canEditStories: false,
            canDeleteStories: false,
            canPinMessages: false,
            canManageTopics: true,
          },
          botAdministratorRights: {
            isAnonymous: false,
            canManageChat: true,
            canDeleteMessages: false,
            canManageVideoChats: false,
            canRestrictMembers: false,
            canPromoteMembers: false,
            canChangeInfo: false,
            canInviteUsers: true,
            canPostStories: false,
            canEditStories: false,
            canDeleteStories: false,
            canPinMessages: false,
            canManageTopics: true,
          },
        },
      }]],
      resizeKeyboard: true,
      persistentKeyboard: true,
    }),
    {
      reply_markup: {
        keyboard: [[{
          text: 'Compartir supergrupo',
          request_chat: {
            request_id: 7001,
            chat_is_channel: false,
            chat_is_forum: true,
            bot_is_member: true,
            user_administrator_rights: {
              is_anonymous: false,
              can_manage_chat: true,
              can_delete_messages: false,
              can_manage_video_chats: false,
              can_restrict_members: false,
              can_promote_members: false,
              can_change_info: false,
              can_invite_users: true,
              can_post_stories: false,
              can_edit_stories: false,
              can_delete_stories: false,
              can_pin_messages: false,
              can_manage_topics: true,
            },
            bot_administrator_rights: {
              is_anonymous: false,
              can_manage_chat: true,
              can_delete_messages: false,
              can_manage_video_chats: false,
              can_restrict_members: false,
              can_promote_members: false,
              can_change_info: false,
              can_invite_users: true,
              can_post_stories: false,
              can_edit_stories: false,
              can_delete_stories: false,
              can_pin_messages: false,
              can_manage_topics: true,
            },
          },
        }]],
        resize_keyboard: true,
        is_persistent: true,
      },
    },
  );
});

test('translated quick-action buttons still trigger the same handlers', async () => {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const membershipUsers = new Map([
    [
      42,
      {
        telegramUserId: 42,
        username: 'new_member',
        displayName: 'New',
        status: 'pending',
        isAdmin: false,
      },
    ],
  ]);

  let textHandler: TelegramCommandHandler | undefined;

  const telegram = await createTelegramBoundary({
    config: runtimeConfig,
    logger: {
      info: () => {},
      error: () => {},
    },
    services: {
      database: {
        pool: undefined as never,
        db: createMembershipDatabaseStub({
          membershipUsers,
          statusAuditLog: [],
          auditEvents: [],
        }) as never,
        close: async () => {},
      },
    },
    loadActor: async ({ telegramUserId }) => ({
      telegramUserId,
      status: 'approved',
      isApproved: true,
      isBlocked: false,
      isAdmin: true,
      permissions: [],
    }),
    createConversationSessionStore: () => ({
      loadSession: async () => null,
      saveSession: async () => {},
      deleteSession: async () => false,
      deleteExpiredSessions: async () => 0,
    }),
    createBot: () => {
      const middlewares: TelegramMiddleware[] = [];

      return {
        use: (middleware) => {
          middlewares.push(middleware);
        },
        onCommand: () => {},
        onCallback: () => {},
        onText: (handler) => {
          textHandler = handler;
        },
        sendPrivateMessage: async () => {},
        startPolling: async () => {
          const context: TelegramContextLike = {
            chat: {
              id: 100,
              type: 'private',
            },
            from: {
              id: 99,
              username: 'club_admin',
              first_name: 'Admin',
            },
            reply: async (message: string, options?: TelegramReplyOptions) => {
              replies.push(options ? { message, options } : { message });
            },
          };

          let index = -1;
          const dispatch = async (middlewareIndex: number): Promise<void> => {
            if (middlewareIndex <= index) {
              throw new Error('next called multiple times');
            }

            index = middlewareIndex;

            if (middlewareIndex === middlewares.length) {
              if (!textHandler) {
                throw new Error('text handler not registered');
              }

              const commandContext = context as unknown as import('./command-registry.js').TelegramCommandHandlerContext;

              context.messageText = createTelegramI18n('es').actionMenu.start;
              await textHandler(commandContext);

              context.messageText = createTelegramI18n('es').actionMenu.help;
              await textHandler(commandContext);

              context.messageText = createTelegramI18n('es').actionMenu.reviewAccess;
              await textHandler(commandContext);
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

  await telegram.stop();

  assert.equal(replies.length, 3);
  assert.deepEqual(replyKeyboardLabels(replies[0]?.options?.replyKeyboard), [['Activitats', 'Catàleg'], ['Emmagatzematge', 'Compres conjuntes'], ['LFG (buscar grup)', 'Avisos'], ['Canviar nom', 'Admin'], ['Idioma', 'Ajuda']]);
  assert.match(replies[0]?.message ?? '', /Game Club Bot online \(v0\.[0-9.]+\)/);
  assert.match(replies[0]?.message ?? '', /sol·licituds/i);
  assert.match(replies[1]?.message ?? '', /Què pots fer ara/);
  assert.match(replies[2]?.message ?? '', /Sol·licituds pendents/);
  assert.deepEqual(
    replies[2]?.options?.inlineKeyboard?.flat().map((button) => button.text),
    ['Aprovar', 'Rebutjar'],
  );
});

test('admin welcome templates can be created from Telegram with an attached GIF file', async () => {
  const result = await runAdminWelcomeTemplateCreateFlow({
    messageMedia: {
      attachmentKind: 'document',
      fileId: 'gif-document-file-id',
      fileUniqueId: 'gif-document-unique-id',
      originalFileName: 'welcome.gif',
      mimeType: 'image/gif',
      messageId: 777,
    },
  });

  assert.match(result.replies[0]?.message ?? '', /^Encara no hi ha cap missatge de benvinguda configurat\./);
  assert.doesNotMatch(result.replies[0]?.message ?? '', /start=welcome_tpl_create/);
  assert.equal(result.replies[0]?.options?.parseMode, 'HTML');
  assert.equal(result.replies[0]?.options?.inlineKeyboard, undefined);
  assert.deepEqual(replyKeyboardLabels(result.replies[0]?.options?.replyKeyboard), [['Crear benvinguda'], ['Volver al inicio']]);
  assert.equal(result.replies[1]?.message, 'Escriu el text de benvinguda. Pots fer servir $USERNAME per substituir-lo pel nom visible de la persona.');
  assert.equal(result.replies[2]?.message, 'Ara envia el GIF o vídeo que vols adjuntar, o toca Sense GIF per guardar només el text.');
  assert.equal(result.replies[3]?.message, 'Missatge de benvinguda guardat.');
  assert.deepEqual(result.savedTemplates.map((template) => ({
    templateText: template.templateText,
    animationFileId: template.animationFileId,
    targetTelegramUserId: template.targetTelegramUserId,
    isEnabled: template.isEnabled,
  })), [
    {
      templateText: 'Ja arriba $USERNAME',
      animationFileId: 'gif-document-file-id',
      targetTelegramUserId: null,
      isEnabled: true,
    },
  ]);
});

test('admin welcome templates accept videos converted from mobile GIFs', async () => {
  const result = await runAdminWelcomeTemplateCreateFlow({
    messageMedia: {
      attachmentKind: 'video',
      fileId: 'gif-video-file-id',
      fileUniqueId: 'gif-video-unique-id',
      originalFileName: 'welcome.mp4',
      mimeType: 'video/mp4',
      messageId: 778,
    },
  });

  assert.equal(result.replies[3]?.message, 'Missatge de benvinguda guardat.');
  assert.deepEqual(result.savedTemplates.map((template) => ({
    templateText: template.templateText,
    animationFileId: template.animationFileId,
    targetTelegramUserId: template.targetTelegramUserId,
    isEnabled: template.isEnabled,
  })), [
    {
      templateText: 'Ja arriba $USERNAME',
      animationFileId: 'gif-video-file-id',
      targetTelegramUserId: null,
      isEnabled: true,
    },
  ]);
});

test('admin welcome templates preserve Telegram text formatting entities', async () => {
  const result = await runAdminWelcomeTemplateCreateFlow({
    messageMedia: {
      attachmentKind: 'animation',
      fileId: 'formatted-gif-file-id',
      fileUniqueId: 'formatted-gif-unique-id',
      originalFileName: 'welcome.gif',
      mimeType: 'image/gif',
      messageId: 779,
    },
    messageEntities: [
      {
        type: 'italic',
        offset: 0,
        length: 'Ja arriba $USERNAME'.length,
      },
    ],
  });

  assert.equal(result.savedTemplates[0]?.templateHtml, '<i>Ja arriba $USERNAME</i>');
});

test('admin welcome templates list supports pagination, editing and deletion', async () => {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const templates = Array.from({ length: 6 }, (_, index) => ({
    id: `welcome_${index + 1}`,
    templateText: `Plantilla ${index + 1} $USERNAME`,
    animationFileId: index === 0 ? 'gif-1' : null,
    targetTelegramUserId: null,
    isEnabled: true,
    sortOrder: index,
  }));
  const appMetadataRecords = new Map<string, string>([
    ['telegram.welcome_templates', JSON.stringify(templates)],
  ]);
  let textHandler: TelegramCommandHandler | undefined;
  const commandHandlers = new Map<string, TelegramCommandHandler>();

  const telegram = await createTelegramBoundary({
    config: runtimeConfig,
    logger: {
      info: () => {},
      error: () => {},
    },
    services: {
      database: {
        pool: undefined as never,
        db: createMembershipDatabaseStub({
          membershipUsers: new Map(),
          statusAuditLog: [],
          auditEvents: [],
          appMetadataRecords,
        }) as never,
        close: async () => {},
      },
    },
    loadActor: async ({ telegramUserId }) => ({
      telegramUserId,
      status: 'approved',
      isApproved: true,
      isBlocked: false,
      isAdmin: true,
      permissions: [],
    }),
    createConversationSessionStore: () => {
      const sessions = new Map<string, ConversationSessionRecord>();
      return {
        loadSession: async (key) => sessions.get(key) ?? null,
        saveSession: async (session) => {
          sessions.set(session.key, session);
        },
        deleteSession: async (key) => sessions.delete(key),
        deleteExpiredSessions: async () => 0,
      };
    },
    createBot: () => {
      const middlewares: TelegramMiddleware[] = [];

      return {
        use: (middleware) => {
          middlewares.push(middleware);
        },
        onCommand: (command, handler) => {
          commandHandlers.set(command, handler);
        },
        onCallback: () => {},
        onText: (handler) => {
          textHandler = handler;
        },
        sendPrivateMessage: async () => {},
        startPolling: async () => {
          const context: TelegramContextLike = {
            chat: {
              id: 100,
              type: 'private',
            },
            from: {
              id: 99,
              username: 'club_admin',
              first_name: 'Admin',
            },
            reply: async (message: string, options?: TelegramReplyOptions) => {
              replies.push(options ? { message, options } : { message });
            },
          };

          const runStart = async (payload: string): Promise<void> => {
            const handler = commandHandlers.get('start');
            if (!handler) {
              throw new Error('start handler not registered');
            }
            context.messageText = `/start ${payload}`;
            await handler(context as unknown as import('./command-registry.js').TelegramCommandHandlerContext);
          };

          let index = -1;
          const dispatch = async (middlewareIndex: number): Promise<void> => {
            if (middlewareIndex <= index) {
              throw new Error('next called multiple times');
            }

            index = middlewareIndex;

            if (middlewareIndex === middlewares.length) {
              if (!textHandler) {
                throw new Error('text handler not registered');
              }

              const commandContext = context as unknown as import('./command-registry.js').TelegramCommandHandlerContext;
              context.messageText = createTelegramI18n('ca').actionMenu.welcomeTemplates;
              await textHandler(commandContext);

              context.messageText = createTelegramI18n('ca').common.welcomeTemplatesNextPageButton;
              await textHandler(commandContext);
              await runStart('welcome_tpl_detail_welcome_6');
              await runStart('welcome_tpl_preview_welcome_6');
              await runStart('welcome_tpl_edit_text_welcome_6');
              context.messageText = 'Plantilla editada $USERNAME';
              await textHandler(commandContext);
              await runStart('welcome_tpl_delete_confirm_welcome_6');
              await runStart('welcome_tpl_delete_welcome_6');
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

  await telegram.stop();

  assert.match(replies[0]?.message ?? '', /Missatges de benvinguda configurats:/);
  assert.match(replies[0]?.message ?? '', /Missatges de benvinguda configurats:\n\n1\. Plantilla 1/);
  assert.match(replies[0]?.message ?? '', /Mostrant 1-5 de 6\. Pàgina 1\/2\./);
  assert.match(replies[0]?.message ?? '', /5\. Plantilla 5 \$USERNAME[^\n]*\n\nMostrant 1-5 de 6\. Pàgina 1\/2\./);
  assert.equal(replies[0]?.options?.parseMode, 'HTML');
  assert.equal(replies[0]?.options?.inlineKeyboard, undefined);
  assert.deepEqual(replyKeyboardLabels(replies[0]?.options?.replyKeyboard), [['Següent'], ['Crear benvinguda'], ['Volver al inicio']]);
  assert.doesNotMatch(replies[0]?.message ?? '', /start=welcome_tpl_create/);
  assert.doesNotMatch(replies[0]?.message ?? '', /start=welcome_tpl_list_2/);
  assert.match(replies[0]?.message ?? '', /Plantilla 1 \$USERNAME <a href="[^"]*start=welcome_tpl_detail_welcome_1">Detall<\/a>/);
  assert.doesNotMatch(replies[0]?.message ?? '', /start=welcome_tpl_edit_text_welcome_1/);
  assert.match(replies[1]?.message ?? '', /Missatges de benvinguda configurats:/);
  assert.match(replies[1]?.message ?? '', /Mostrant 6-6 de 6\. Pàgina 2\/2\./);
  assert.deepEqual(replyKeyboardLabels(replies[1]?.options?.replyKeyboard), [['Anterior'], ['Crear benvinguda'], ['Volver al inicio']]);
  assert.match(replies[2]?.message ?? '', /Plantilla 6/);
  assert.equal(replies[2]?.options?.parseMode, 'HTML');
  assert.match(replies[2]?.message ?? '', /start=welcome_tpl_edit_text_welcome_6/);
  assert.match(replies[2]?.message ?? '', /start=welcome_tpl_preview_welcome_6/);
  assert.match(replies[2]?.message ?? '', /start=welcome_tpl_delete_confirm_welcome_6/);
  assert.doesNotMatch(replies[2]?.message ?? '', /start=welcome_tpl_list_1/);
  assert.doesNotMatch(replies[2]?.message ?? '', /Tornar a benvingudes/);
  assert.equal(replies[3]?.message, 'Plantilla 6 Admin');
  assert.equal(replies[4]?.message.includes('Escriu el nou text de benvinguda'), true);
  assert.equal(replies[5]?.message, 'Missatge de benvinguda actualitzat.');
  assert.match(replies[6]?.message ?? '', /Plantilla editada/);
  assert.equal(replies[7]?.message.includes('Confirma que vols eliminar'), true);
  assert.match(replies[7]?.message ?? '', /start=welcome_tpl_delete_welcome_6/);
  assert.equal(replies[8]?.message, 'Missatge de benvinguda eliminat.');

  const savedTemplates = JSON.parse(appMetadataRecords.get('telegram.welcome_templates') ?? '[]') as Array<Record<string, unknown>>;
  assert.equal(savedTemplates.length, 5);
  assert.equal(savedTemplates.some((template) => template.id === 'welcome_6'), false);
});

async function runAdminWelcomeTemplateCreateFlow({
  messageMedia,
  messageEntities,
}: {
  messageMedia: NonNullable<TelegramContextLike['messageMedia']>;
  messageEntities?: NonNullable<TelegramContextLike['messageEntities']>;
}): Promise<{
  replies: Array<{ message: string; options?: TelegramReplyOptions }>;
  savedTemplates: Array<Record<string, unknown>>;
}> {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const appMetadataRecords = new Map<string, string>();
  let textHandler: TelegramCommandHandler | undefined;
  let messageHandler: TelegramCommandHandler | undefined;

  const telegram = await createTelegramBoundary({
    config: runtimeConfig,
    logger: {
      info: () => {},
      error: () => {},
    },
    services: {
      database: {
        pool: undefined as never,
        db: createMembershipDatabaseStub({
          membershipUsers: new Map(),
          statusAuditLog: [],
          auditEvents: [],
          appMetadataRecords,
        }) as never,
        close: async () => {},
      },
    },
    loadActor: async ({ telegramUserId }) => ({
      telegramUserId,
      status: 'approved',
      isApproved: true,
      isBlocked: false,
      isAdmin: true,
      permissions: [],
    }),
    createConversationSessionStore: () => {
      const sessions = new Map<string, ConversationSessionRecord>();
      return {
        loadSession: async (key) => sessions.get(key) ?? null,
        saveSession: async (session) => {
          sessions.set(session.key, session);
        },
        deleteSession: async (key) => sessions.delete(key),
        deleteExpiredSessions: async () => 0,
      };
    },
    createBot: () => {
      const middlewares: TelegramMiddleware[] = [];

      return {
        use: (middleware) => {
          middlewares.push(middleware);
        },
        onCommand: () => {},
        onCallback: () => {},
        onText: (handler) => {
          textHandler = handler;
        },
        onMessage: (handler) => {
          messageHandler = handler;
        },
        sendPrivateMessage: async () => {},
        startPolling: async () => {
          const context: TelegramContextLike = {
            chat: {
              id: 100,
              type: 'private',
            },
            from: {
              id: 99,
              username: 'club_admin',
              first_name: 'Admin',
            },
            reply: async (message: string, options?: TelegramReplyOptions) => {
              replies.push(options ? { message, options } : { message });
            },
          };

          let index = -1;
          const dispatch = async (middlewareIndex: number): Promise<void> => {
            if (middlewareIndex <= index) {
              throw new Error('next called multiple times');
            }

            index = middlewareIndex;

            if (middlewareIndex === middlewares.length) {
              if (!textHandler || !messageHandler) {
                throw new Error('telegram handlers not registered');
              }

              const commandContext = context as unknown as import('./command-registry.js').TelegramCommandHandlerContext;

              context.messageText = createTelegramI18n('ca').actionMenu.welcomeTemplates;
              await textHandler(commandContext);

              context.messageText = createTelegramI18n('ca').common.welcomeTemplatesCreateButton;
              await textHandler(commandContext);

              context.messageText = 'Ja arriba $USERNAME';
              context.messageEntities = messageEntities;
              await textHandler(commandContext);

              delete context.messageText;
              delete context.messageEntities;
              context.messageMedia = messageMedia;
              await messageHandler(commandContext);
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

  await telegram.stop();

  return {
    replies,
    savedTemplates: JSON.parse(appMetadataRecords.get('telegram.welcome_templates') ?? '[]') as Array<Record<string, unknown>>,
  };
}

test('secret welcome aliases preview the random welcome for the current user in private chat', async () => {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const animations: Array<{ chatId: number; animationFileId: string; caption?: string }> = [];
  const appMetadataRecords = new Map<string, string>([
    [
      'telegram.welcome_templates',
      JSON.stringify([
        {
          id: 'global',
          templateText: 'Hola $USERNAME',
          animationFileId: null,
          targetTelegramUserId: null,
          isEnabled: true,
          sortOrder: 0,
        },
        {
          id: 'targeted',
          templateText: 'Ara arriba $USERNAME',
          animationFileId: 'targeted-gif-id',
          targetTelegramUserId: 42,
          isEnabled: true,
          sortOrder: 1,
        },
      ]),
    ],
  ]);
  const membershipUsers = new Map([
    [
      42,
      {
        telegramUserId: 42,
        username: 'telegram_name',
        displayName: 'Tester',
        status: 'approved',
        isAdmin: false,
      },
    ],
  ]);
  let textHandler: TelegramCommandHandler | undefined;
  const commandHandlers = new Map<string, TelegramCommandHandler>();

  const telegram = await createTelegramBoundary({
    config: runtimeConfig,
    logger: {
      info: () => {},
      error: () => {},
    },
    services: {
      database: {
        pool: undefined as never,
        db: createMembershipDatabaseStub({
          membershipUsers,
          statusAuditLog: [],
          auditEvents: [],
          appMetadataRecords,
        }) as never,
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
      loadSession: async () => null,
      saveSession: async () => {},
      deleteSession: async () => false,
      deleteExpiredSessions: async () => 0,
    }),
    createBot: () => {
      const middlewares: TelegramMiddleware[] = [];

      return {
        use: (middleware) => {
          middlewares.push(middleware);
        },
        onCommand: (command, handler) => {
          commandHandlers.set(command, handler);
        },
        onCallback: () => {},
        onText: (handler) => {
          textHandler = handler;
        },
        sendPrivateMessage: async () => {},
        sendAnimation: async ({ chatId, animationFileId, caption }) => {
          animations.push({ chatId, animationFileId, ...(caption ? { caption } : {}) });
        },
        startPolling: async () => {
          const context: TelegramContextLike = {
            chat: {
              id: 100,
              type: 'private',
            },
            from: {
              id: 42,
              username: 'telegram_name',
              first_name: 'Telegram',
            },
            reply: async (message: string, options?: TelegramReplyOptions) => {
              replies.push(options ? { message, options } : { message });
            },
          };

          let index = -1;
          const dispatch = async (middlewareIndex: number): Promise<void> => {
            if (middlewareIndex <= index) {
              throw new Error('next called multiple times');
            }

            index = middlewareIndex;

            if (middlewareIndex === middlewares.length) {
              const welcomeHandler = commandHandlers.get('welcome');
              if (!welcomeHandler || !commandHandlers.has('bienvenida') || !textHandler) {
                throw new Error('secret welcome handlers not registered');
              }

              const commandContext = context as unknown as import('./command-registry.js').TelegramCommandHandlerContext;
              context.messageText = '/welcome';
              await welcomeHandler(commandContext);

              context.messageText = '/welcome 1';
              await welcomeHandler(commandContext);

              context.messageText = 'Bienvenida';
              await textHandler(commandContext);
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

  await telegram.stop();

  assert.deepEqual(replies, []);
  assert.deepEqual(animations, [
    {
      chatId: 100,
      animationFileId: 'targeted-gif-id',
      caption: 'Ara arriba Tester',
    },
    {
      chatId: 100,
      animationFileId: 'targeted-gif-id',
      caption: 'Ara arriba Tester',
    },
    {
      chatId: 100,
      animationFileId: 'targeted-gif-id',
      caption: 'Ara arriba Tester',
    },
  ]);
});

test('cancel restores the default action menu after an active flow', async () => {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];

  const telegram = await createTelegramBoundary({
    config: runtimeConfig,
    logger: {
      info: () => {},
      error: () => {},
    },
    services: {
      database: {
        pool: undefined as never,
        db: createEmptyScheduleDatabaseStub() as never,
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
    createConversationSessionStore: () => {
      let current: ConversationSessionRecord | null = {
        key: 'telegram.session:100:42',
        flowKey: 'schedule-create',
        stepKey: 'title',
        data: {},
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        expiresAt: '2026-04-04T11:00:00.000Z',
      };

      return {
        loadSession: async () => current,
        saveSession: async (session) => {
          current = session;
        },
        deleteSession: async () => {
          current = null;
          return true;
        },
        deleteExpiredSessions: async () => 0,
      };
    },
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
        onCallback: () => {},
        onText: () => {},
        sendPrivateMessage: async () => {},
        startPolling: async () => {
          const context: TelegramContextLike = {
            chat: {
              id: 100,
              type: 'private',
            },
            from: {
              id: 42,
            },
            reply: async (message: string, options?: TelegramReplyOptions) => {
              replies.push({ message, ...(options ? { options } : {}) });
            },
          };

          let index = -1;
          const dispatch = async (middlewareIndex: number): Promise<void> => {
            if (middlewareIndex <= index) {
              throw new Error('next called multiple times');
            }

            index = middlewareIndex;

            if (middlewareIndex === middlewares.length) {
              const cancelHandler = commandHandlers.get('cancel');
              if (!cancelHandler) {
                throw new Error('cancel handler not registered');
              }

              await cancelHandler(context as unknown as import('./command-registry.js').TelegramCommandHandlerContext);
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
  assert.deepEqual(replies, [
    {
      message: 'Procés cancel·lat correctament.',
        options: {
          menuId: 'private-approved-default',
          replyKeyboard: [
            [{ text: 'Activitats', semanticRole: 'primary' }, { text: 'Taules', semanticRole: 'primary' }],
            [{ text: 'Catàleg', semanticRole: 'primary' }, { text: 'Emmagatzematge', semanticRole: 'primary' }],
            [{ text: 'Compres conjuntes', semanticRole: 'primary' }, { text: 'LFG (buscar grup)', semanticRole: 'primary' }],
            [{ text: 'Avisos', semanticRole: 'primary' }, { text: 'Canviar nom', semanticRole: 'secondary' }],
            [{ text: 'Idioma', semanticRole: 'secondary' }, { text: 'Ajuda', semanticRole: 'help' }],
          ],
          actionRows: [['schedule', 'tables_read'], ['catalog', 'storage'], ['group_purchases', 'lfg'], ['notices', 'change_display_name'], ['language', 'help']],
          actions: [
            { id: 'schedule', label: 'Activitats', telemetryActionKey: 'menu.schedule', uxSection: 'primary' },
            { id: 'tables_read', label: 'Taules', telemetryActionKey: 'menu.tables', uxSection: 'primary' },
            { id: 'catalog', label: 'Catàleg', telemetryActionKey: 'menu.catalog', uxSection: 'primary' },
            { id: 'storage', label: 'Emmagatzematge', telemetryActionKey: 'menu.storage', uxSection: 'primary' },
            { id: 'group_purchases', label: 'Compres conjuntes', telemetryActionKey: 'menu.group_purchases', uxSection: 'primary' },
            { id: 'lfg', label: 'LFG (buscar grup)', telemetryActionKey: 'menu.lfg', uxSection: 'primary' },
            { id: 'notices', label: 'Avisos', telemetryActionKey: 'menu.notices', uxSection: 'primary' },
            { id: 'change_display_name', label: 'Canviar nom', telemetryActionKey: 'menu.change_display_name', uxSection: 'utility' },
            { id: 'language', label: 'Idioma', telemetryActionKey: 'menu.language', uxSection: 'utility' },
            { id: 'help', label: 'Ajuda', telemetryActionKey: 'menu.help', uxSection: 'utility' },
        ],
        resizeKeyboard: true,
        persistentKeyboard: true,
      },
    },
  ]);

  await telegram.stop();
});

test('start menu action clears active flow before showing the default keyboard', async () => {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  let textHandler: TelegramCommandHandler | undefined;

  const telegram = await createTelegramBoundary({
    config: runtimeConfig,
    logger: {
      info: () => {},
      error: () => {},
    },
    services: {
      database: {
        pool: undefined as never,
        db: createEmptyScheduleDatabaseStub() as never,
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
    createConversationSessionStore: () => {
      let current: ConversationSessionRecord | null = {
        key: 'telegram.session:100:42',
        flowKey: 'schedule-create',
        stepKey: 'title',
        data: {},
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        expiresAt: '2026-04-04T11:00:00.000Z',
      };

      return {
        loadSession: async () => current,
        saveSession: async (session) => {
          current = session;
        },
        deleteSession: async () => {
          current = null;
          return true;
        },
        deleteExpiredSessions: async () => 0,
      };
    },
    createBot: () => {
      const middlewares: TelegramMiddleware[] = [];

      return {
        use: (middleware) => {
          middlewares.push(middleware);
        },
        onCommand: () => {},
        onCallback: () => {},
        onText: (handler) => {
          textHandler = handler;
        },
        sendPrivateMessage: async () => {},
        startPolling: async () => {
          const context: TelegramContextLike = {
            chat: {
              id: 100,
              type: 'private',
            },
            from: {
              id: 42,
            },
            reply: async (message: string, options?: TelegramReplyOptions) => {
              replies.push({ message, ...(options ? { options } : {}) });
            },
          };

          let index = -1;
          const dispatch = async (middlewareIndex: number): Promise<void> => {
            if (middlewareIndex <= index) {
              throw new Error('next called multiple times');
            }

            index = middlewareIndex;

            if (middlewareIndex === middlewares.length) {
              if (!textHandler) {
                throw new Error('text handler not registered');
              }

              context.messageText = createTelegramI18n('ca').actionMenu.start;
              await textHandler(context as unknown as TelegramCommandHandlerContext);
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
  assert.equal(replies.length, 1);
  assert.match(replies[0]?.message ?? '', /Benvingut a Game Club Bot/);
  assert.deepEqual(replyKeyboardLabels(replies[0]?.options?.replyKeyboard), [
    ['Activitats', 'Taules'],
    ['Catàleg', 'Emmagatzematge'],
    ['Compres conjuntes', 'LFG (buscar grup)'],
    ['Avisos', 'Canviar nom'],
    ['Idioma', 'Ajuda'],
  ]);

  await telegram.stop();
});

test('private free text auto-creates a pending access request with detailed guidance', async () => {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const membershipUsers = new Map<
    number,
    { telegramUserId: number; username?: string | null; displayName: string; status: string; isAdmin: boolean }
  >();
  let textHandler: TelegramCommandHandler | undefined;

  const telegram = await createTelegramBoundary({
    config: runtimeConfig,
    logger: {
      info: () => {},
      error: () => {},
    },
    services: {
      database: {
        pool: undefined as never,
        db: createMembershipDatabaseStub({
          membershipUsers,
          statusAuditLog: [],
          auditEvents: [],
        }) as never,
        close: async () => {},
      },
    },
    createConversationSessionStore: () => ({
      loadSession: async () => null,
      saveSession: async () => {},
      deleteSession: async () => false,
      deleteExpiredSessions: async () => 0,
    }),
    createBot: () => {
      const middlewares: TelegramMiddleware[] = [];

      return {
        use: (middleware) => {
          middlewares.push(middleware);
        },
        onCommand: () => {},
        onCallback: () => {},
        onText: (handler) => {
          textHandler = handler;
        },
        sendPrivateMessage: async () => {},
        startPolling: async () => {
          const context: TelegramContextLike = {
            chat: {
              id: 100,
              type: 'private',
            },
            from: {
              id: 42,
              username: 'new_member',
            },
            messageText: 'hola',
            reply: async (message: string, options?: TelegramReplyOptions) => {
              replies.push(options ? { message, options } : { message });
            },
          };

          let index = -1;
          const dispatch = async (middlewareIndex: number): Promise<void> => {
            if (middlewareIndex <= index) {
              throw new Error('next called multiple times');
            }

            index = middlewareIndex;

            if (middlewareIndex === middlewares.length) {
              if (!textHandler) {
                throw new Error('text handler not registered');
              }

              const commandContext = context as unknown as TelegramCommandHandlerContext;
              await textHandler(commandContext);
              context.messageText = 'New Member';
              await textHandler(commandContext);
              return;
            }

            await middlewares[middlewareIndex]!(context, () => dispatch(middlewareIndex + 1));
          };

          await dispatch(0);
        },
        stopPolling: async () => {},
      };
    },
  });

  assert.equal(membershipUsers.get(42)?.status, 'pending');
  assert.equal(membershipUsers.get(42)?.displayName, 'New Member');
  assert.match(replies[0]?.message ?? '', /Com vols que et conegui el bot/i);
  assert.match(replies[1]?.message ?? '', /sol·licitud d'accés/i);
  assert.match(replies[1]?.message ?? '', /administrador/i);
  assert.match(replies[1]?.message ?? '', /pendent/i);

  await telegram.stop();
});

test('group free text does not auto-create a pending access request', async () => {
  const membershipUsers = new Map<
    number,
    { telegramUserId: number; username?: string | null; displayName: string; status: string; isAdmin: boolean }
  >();
  let textHandler: TelegramCommandHandler | undefined;

  const telegram = await createTelegramBoundary({
    config: runtimeConfig,
    logger: {
      info: () => {},
      error: () => {},
    },
    services: {
      database: {
        pool: undefined as never,
        db: createMembershipDatabaseStub({
          membershipUsers,
          statusAuditLog: [],
          auditEvents: [],
        }) as never,
        close: async () => {},
      },
    },
    createConversationSessionStore: () => ({
      loadSession: async () => null,
      saveSession: async () => {},
      deleteSession: async () => false,
      deleteExpiredSessions: async () => 0,
    }),
    createBot: () => {
      const middlewares: TelegramMiddleware[] = [];

      return {
        use: (middleware) => {
          middlewares.push(middleware);
        },
        onCommand: () => {},
        onCallback: () => {},
        onText: (handler) => {
          textHandler = handler;
        },
        sendPrivateMessage: async () => {},
        startPolling: async () => {
          const context: TelegramContextLike = {
            chat: {
              id: -200,
              type: 'group',
            },
            from: {
              id: 42,
              username: 'new_member',
            },
            messageText: 'hola',
            reply: async () => {},
          };

          let index = -1;
          const dispatch = async (middlewareIndex: number): Promise<void> => {
            if (middlewareIndex <= index) {
              throw new Error('next called multiple times');
            }

            index = middlewareIndex;

            if (middlewareIndex === middlewares.length) {
              if (!textHandler) {
                throw new Error('text handler not registered');
              }

              const commandContext = context as unknown as TelegramCommandHandlerContext;
              await textHandler(commandContext);
              return;
            }

            await middlewares[middlewareIndex]!(context, () => dispatch(middlewareIndex + 1));
          };

          await dispatch(0);
        },
        stopPolling: async () => {},
      };
    },
  });

  assert.equal(membershipUsers.get(42), undefined);

  await telegram.stop();
});

test('createTelegramBoundary routes plain text keyboard actions for admin table management', async () => {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];

  const telegram = await createTelegramBoundary({
    config: runtimeConfig,
    logger: {
      info: () => {},
      error: () => {},
    },
    services: {
      database: {
        pool: undefined as never,
        db: createEmptyScheduleDatabaseStub() as never,
        close: async () => {},
      },
    },
    loadActor: async ({ telegramUserId }) => ({
      telegramUserId,
      status: 'approved',
      isApproved: true,
      isBlocked: false,
      isAdmin: true,
      permissions: [],
    }),
    createConversationSessionStore: () => ({
      loadSession: async () => null,
      saveSession: async () => {},
      deleteSession: async () => false,
      deleteExpiredSessions: async () => 0,
    }),
    createBot: () => {
      const middlewares: TelegramMiddleware[] = [];
      const textHandlers: TelegramCommandHandler[] = [];

      return {
        use: (middleware) => {
          middlewares.push(middleware);
        },
        onCommand: () => {},
        onCallback: () => {},
        onText: (handler: TelegramCommandHandler) => {
          textHandlers.push(handler);
        },
        sendPrivateMessage: async () => {},
        startPolling: async () => {
          const context: TelegramContextLike = {
            chat: {
              id: 100,
              type: 'private',
            },
            from: {
              id: 99,
            },
            messageText: 'Taules',
            reply: async (message: string, options?: TelegramReplyOptions) => {
              replies.push({ message, ...(options ? { options } : {}) });
            },
          };

          let index = -1;
          const dispatch = async (middlewareIndex: number): Promise<void> => {
            if (middlewareIndex <= index) {
              throw new Error('next called multiple times');
            }

            index = middlewareIndex;

            if (middlewareIndex === middlewares.length) {
              const textHandler = textHandlers[0];
              if (!textHandler) {
                throw new Error('text handler not registered');
              }

              await textHandler(context as unknown as import('./command-registry.js').TelegramCommandHandlerContext);
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
  assert.deepEqual(replies, [
    {
      message: 'Gestió de taules: tria una acció.',
      options: {
        replyKeyboard: [['Crear taula', 'Llistar taules'], ['Editar taula', 'Desactivar taula'], ['Inici', 'Ajuda']],
        resizeKeyboard: true,
        persistentKeyboard: true,
      },
    },
  ]);
});

test('createTelegramBoundary routes plain text keyboard actions for member table browsing', async () => {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const auditEvents: Array<{ actionKey: string; targetType: string; targetId: string; summary: string; details: Record<string, unknown> | null }> = [];

  const telegram = await createTelegramBoundary({
    config: runtimeConfig,
    logger: {
      info: () => {},
      error: () => {},
    },
    services: {
      database: {
        pool: undefined as never,
        db: createClubTableDatabaseStub({
          auditEvents,
          tables: [
            {
              id: 1,
              displayName: 'Mesa TV',
              description: null,
              recommendedCapacity: 6,
              lifecycleStatus: 'active',
              createdAt: '2026-04-05T10:00:00.000Z',
              updatedAt: '2026-04-05T10:00:00.000Z',
            },
          ],
        }) as never,
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
      loadSession: async () => null,
      saveSession: async () => {},
      deleteSession: async () => false,
      deleteExpiredSessions: async () => 0,
    }),
    createBot: () => {
      const middlewares: TelegramMiddleware[] = [];
      const textHandlers: TelegramCommandHandler[] = [];

      return {
        use: (middleware) => {
          middlewares.push(middleware);
        },
        onCommand: () => {},
        onCallback: () => {},
        onText: (handler: TelegramCommandHandler) => {
          textHandlers.push(handler);
        },
        sendPrivateMessage: async () => {},
        startPolling: async () => {
          const context: TelegramContextLike = {
            chat: {
              id: 100,
              type: 'private',
            },
            from: {
              id: 77,
            },
            messageText: 'Taules',
            reply: async (message: string, options?: TelegramReplyOptions) => {
              replies.push({ message, ...(options ? { options } : {}) });
            },
          };

          let index = -1;
          const dispatch = async (middlewareIndex: number): Promise<void> => {
            if (middlewareIndex <= index) {
              throw new Error('next called multiple times');
            }

            index = middlewareIndex;

            if (middlewareIndex === middlewares.length) {
              const textHandler = textHandlers[0];
              if (!textHandler) {
                throw new Error('text handler not registered');
              }

              await textHandler(context as unknown as import('./command-registry.js').TelegramCommandHandlerContext);
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
  assert.match(replies[0]?.message ?? '', /Taules disponibles/);
  assert.match(replies[0]?.message ?? '', /Mesa TV/);
  assert.deepEqual(auditEvents, [
    {
      actionKey: 'telegram.menu.action_selected',
      targetType: 'telegram-menu',
      targetId: 'private-approved-default',
      summary: 'Telegram menu action selected: tables_read',
      details: {
        chatKind: 'private',
        actorRole: 'member',
        language: 'ca',
        menuId: 'private-approved-default',
        actionId: 'tables_read',
        telemetryActionKey: 'menu.tables',
        label: 'Taules',
      },
    },
  ]);
});

test('createTelegramBoundary records menu telemetry when showing the approved member start menu', async () => {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const membershipUsers = new Map<
    number,
    { telegramUserId: number; username?: string | null; displayName: string; status: string; isAdmin: boolean }
  >();
  const statusAuditLog: Array<{ telegramUserId: number; nextStatus: string }> = [];
  const auditEvents: Array<{ actionKey: string; targetType: string; targetId: string; summary: string; details: Record<string, unknown> | null }> = [];

  const telegram = await createTelegramBoundary({
    config: runtimeConfig,
    logger: {
      info: () => {},
      error: () => {},
    },
    services: {
      database: {
        pool: undefined as never,
        db: createMembershipDatabaseStub({ membershipUsers, statusAuditLog, auditEvents }) as never,
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
      loadSession: async () => null,
      saveSession: async () => {},
      deleteSession: async () => false,
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
        onCallback: () => {},
        onText: () => {},
        username: 'gameclub_test_bot',
        sendPrivateMessage: async () => {},
        startPolling: async () => {
          const context: TelegramContextLike = {
            chat: {
              id: 100,
              type: 'private',
            },
            from: {
              id: 77,
              username: 'member77',
              first_name: 'Member',
            },
            messageText: '/start',
            reply: async (message: string, options?: TelegramReplyOptions) => {
              replies.push({ message, ...(options ? { options } : {}) });
            },
          };

          let index = -1;
          const dispatch = async (middlewareIndex: number): Promise<void> => {
            if (middlewareIndex <= index) {
              throw new Error('next called multiple times');
            }

            index = middlewareIndex;

            if (middlewareIndex === middlewares.length) {
              const startHandler = commandHandlers.get('start');
              if (!startHandler) {
                throw new Error('start handler not registered');
              }

              await startHandler(context as unknown as TelegramCommandHandlerContext);
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
  assert.match(replies[0]?.message ?? '', /Des del menú pots obrir activitats, taules i catàleg/);
  assert.deepEqual(replyKeyboardLabels(replies[0]?.options?.replyKeyboard), [['Activitats', 'Taules'], ['Catàleg', 'Emmagatzematge'], ['Compres conjuntes', 'LFG (buscar grup)'], ['Avisos', 'Canviar nom'], ['Idioma', 'Ajuda']]);
  assert.deepEqual(auditEvents, [
    {
      actionKey: 'telegram.menu.shown',
      targetType: 'telegram-menu',
      targetId: 'private-approved-default',
      summary: 'Telegram menu shown: private-approved-default',
      details: {
        chatKind: 'private',
        actorRole: 'member',
        language: 'ca',
        visibleActionIds: ['schedule', 'tables_read', 'catalog', 'storage', 'group_purchases', 'lfg', 'notices', 'change_display_name', 'language', 'help'],
        visibleLabels: ['Activitats', 'Taules', 'Catàleg', 'Emmagatzematge', 'Compres conjuntes', 'LFG (buscar grup)', 'Avisos', 'Canviar nom', 'Idioma', 'Ajuda'],
      },
    },
  ]);
});

test('createTelegramBoundary appends today at club summary to approved member start', async () => {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const auditEvents: Array<{ actionKey: string; targetType: string; targetId: string; summary: string; details: Record<string, unknown> | null }> = [];

  const telegram = await createTelegramBoundary({
    config: runtimeConfig,
    logger: {
      info: () => {},
      error: () => {},
    },
    services: {
      database: {
        pool: undefined as never,
        db: createTodayAtClubDatabaseStub({ auditEvents }) as never,
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
      loadSession: async () => null,
      saveSession: async () => {},
      deleteSession: async () => false,
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
        onCallback: () => {},
        onText: () => {},
        username: 'gameclub_test_bot',
        sendPrivateMessage: async () => {},
        startPolling: async () => {
          const realDate = Date;
          const fixedNow = new Date('2026-04-27T09:30:00.000Z');
          globalThis.Date = class extends realDate {
            constructor(value?: string | number | Date) {
              super(value ?? fixedNow);
            }
            static now() {
              return fixedNow.getTime();
            }
          } as DateConstructor;

          try {
            const context: TelegramContextLike = {
              chat: {
                id: 100,
                type: 'private',
              },
              from: {
                id: 77,
                username: 'member77',
                first_name: 'Member',
              },
              messageText: '/start',
              reply: async (message: string, options?: TelegramReplyOptions) => {
                replies.push({ message, ...(options ? { options } : {}) });
              },
            };

            let index = -1;
            const dispatch = async (middlewareIndex: number): Promise<void> => {
              if (middlewareIndex <= index) {
                throw new Error('next called multiple times');
              }

              index = middlewareIndex;

              if (middlewareIndex === middlewares.length) {
                const startHandler = commandHandlers.get('start');
                if (!startHandler) {
                  throw new Error('start handler not registered');
                }

                await startHandler(context as unknown as TelegramCommandHandlerContext);
                return;
              }

              const middleware = middlewares[middlewareIndex];
              if (!middleware) {
                throw new Error(`middleware ${middlewareIndex} not registered`);
              }

              await middleware(context, () => dispatch(middlewareIndex + 1));
            };

            await dispatch(0);
          } finally {
            globalThis.Date = realDate;
          }
        },
        stopPolling: async () => {},
      };
    },
  });

  assert.equal(telegram.status.bot, 'connected');
  assert.match(replies[0]?.message ?? '', /<b>Avui al club<\/b>/);
  assert.match(replies[0]?.message ?? '', new RegExp(`- ${formatShortTime('2026-04-27T16:00:00.000Z')} Wingspan`));
  assert.match(replies[0]?.message ?? '', new RegExp(`- ${formatTimeRange('2026-04-27T18:00:00.000Z', '2026-04-27T21:00:00.000Z')} Torneig intern`));
  assert.equal(replies[0]?.options?.parseMode, 'HTML');
});

test('createTelegramBoundary shows contextual help after opening a submenu', async () => {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  let textHandler: TelegramCommandHandler | undefined;

  const telegram = await createTelegramBoundary({
    config: runtimeConfig,
    logger: {
      info: () => {},
      error: () => {},
    },
    services: {
      database: {
        pool: undefined as never,
        db: createMembershipDatabaseStub({ membershipUsers: new Map(), statusAuditLog: [], auditEvents: [] }) as never,
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
      loadSession: async () => null,
      saveSession: async () => {},
      deleteSession: async () => false,
      deleteExpiredSessions: async () => 0,
    }),
    createBot: () => {
      const middlewares: TelegramMiddleware[] = [];

      return {
        use: (middleware) => {
          middlewares.push(middleware);
        },
        onCommand: () => {},
        onCallback: () => {},
        onText: (handler) => {
          textHandler = handler;
        },
        username: 'gameclub_test_bot',
        sendPrivateMessage: async () => {},
        startPolling: async () => {
          const context: TelegramContextLike = {
            chat: {
              id: 100,
              type: 'private',
            },
            from: {
              id: 77,
              username: 'member77',
              first_name: 'Member',
            },
            reply: async (message: string, options?: TelegramReplyOptions) => {
              replies.push({ message, ...(options ? { options } : {}) });
            },
          };

          let index = -1;
          const dispatch = async (middlewareIndex: number): Promise<void> => {
            if (middlewareIndex <= index) {
              throw new Error('next called multiple times');
            }

            index = middlewareIndex;

            if (middlewareIndex === middlewares.length) {
              if (!textHandler) {
                throw new Error('text handler not registered');
              }

              context.messageText = 'Emmagatzematge';
              await textHandler(context as unknown as TelegramCommandHandlerContext);
              context.messageText = 'Ajuda';
              await textHandler(context as unknown as TelegramCommandHandlerContext);
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
  assert.match(replies.at(-1)?.message ?? '', /Detalls del menú actual: Emmagatzematge/);
  assert.match(replies.at(-1)?.message ?? '', /pots veure categories, cercar arxius, obrir entrades per ID/i);
});

test('createTelegramBoundary routes plain text keyboard actions for schedule management', async () => {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];

  const telegram = await createTelegramBoundary({
    config: runtimeConfig,
    logger: {
      info: () => {},
      error: () => {},
    },
    services: {
      database: {
        pool: undefined as never,
        db: createEmptyScheduleDatabaseStub() as never,
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
      loadSession: async () => null,
      saveSession: async () => {},
      deleteSession: async () => false,
      deleteExpiredSessions: async () => 0,
    }),
    createBot: () => {
      const middlewares: TelegramMiddleware[] = [];
      const textHandlers: TelegramCommandHandler[] = [];

      return {
        use: (middleware) => {
          middlewares.push(middleware);
        },
        onCommand: () => {},
        onCallback: () => {},
        onText: (handler: TelegramCommandHandler) => {
          textHandlers.push(handler);
        },
        sendPrivateMessage: async () => {},
        startPolling: async () => {
          const context: TelegramContextLike = {
            chat: {
              id: 100,
              type: 'private',
            },
            from: {
              id: 99,
            },
            messageText: 'Activitats',
            reply: async (message: string, options?: TelegramReplyOptions) => {
              replies.push({ message, ...(options ? { options } : {}) });
            },
          };

          let index = -1;
          const dispatch = async (middlewareIndex: number): Promise<void> => {
            if (middlewareIndex <= index) {
              throw new Error('next called multiple times');
            }

            index = middlewareIndex;

            if (middlewareIndex === middlewares.length) {
              const textHandler = textHandlers[0];
              if (!textHandler) {
                throw new Error('text handler not registered');
              }

              await textHandler(context as unknown as import('./command-registry.js').TelegramCommandHandlerContext);
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
  assert.deepEqual(replies, [
    {
      message: 'No hi ha activitats programades ara mateix.',
      options: {
        replyKeyboard: [['Veure activitats', 'Crear activitat'], ['Editar activitat', 'Cancel·lar activitat'], ['Inici', 'Ajuda']],
        resizeKeyboard: true,
        persistentKeyboard: true,
      },
    },
  ]);
});

test('formatStartMessage shows version only to admins', async () => {
  assert.match(
    formatStartMessage({ publicName: 'Game Club Bot', version: '0.1.0', isAdmin: true, isApproved: true, language: 'ca' }),
    /Game Club Bot online \(v0.1.0\)/,
  );
  assert.equal(
    formatStartMessage({ publicName: 'Game Club Bot', version: '0.1.0', isAdmin: false, isApproved: true, language: 'ca' }),
    'Benvingut a Game Club Bot. Des del menú pots obrir activitats, taules i catàleg.',
  );
  assert.equal(
    formatStartMessage({ publicName: 'Game Club Bot', version: '0.1.0', isAdmin: false, isApproved: false, language: 'ca' }),
    "Benvingut a Game Club Bot. Per començar, toca Accés al club o escriu /start. Si la teva sol·licitud ja està pendent, espera l'aprovació d'un administrador.",
  );
});

test('toGrammyReplyOptions converts inline url buttons to grammY reply markup', async () => {
  assert.deepEqual(
    toGrammyReplyOptions({
      inlineKeyboard: [[{ text: 'Abrir chat privado', url: 'https://t.me/gameclub_test_bot?start=from_group' }]],
    }),
    {
      reply_markup: {
        inline_keyboard: [[{ text: 'Abrir chat privado', url: 'https://t.me/gameclub_test_bot?start=from_group' }]],
      },
    },
  );
});

test('isTelegramRawCommandMatch accepts start deep-link payloads without bot command entities', async () => {
  assert.equal(isTelegramRawCommandMatch('/start catalog_admin_letters_JKL', 'start', 'cawa_management_bot'), true);
  assert.equal(isTelegramRawCommandMatch('/start@cawa_management_bot catalog_admin_letters_JKL', 'start', 'cawa_management_bot'), true);
  assert.equal(isTelegramRawCommandMatch('/start@other_bot catalog_admin_letters_JKL', 'start', 'cawa_management_bot'), false);
  assert.equal(isTelegramRawCommandMatch('/status catalog_admin_letters_JKL', 'start', 'cawa_management_bot'), false);
});

test('isTelegramInternalTextCommand accepts catalog letter fallback commands only', async () => {
  assert.equal(isTelegramInternalTextCommand('/catalog_admin_letters_jkl'), true);
  assert.equal(isTelegramInternalTextCommand('/cat_jkl'), true);
  assert.equal(isTelegramInternalTextCommand('/cat_hash_ab@cawa_management_bot'), true);
  assert.equal(isTelegramInternalTextCommand('/catalog_admin_letters_hash_ab@cawa_management_bot'), true);
  assert.equal(isTelegramInternalTextCommand('/start catalog_admin_letters_JKL'), false);
  assert.equal(isTelegramInternalTextCommand('/storage_category_86'), false);
});

test('group start reply explains private-chat usage and offers a private button', async () => {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const startHandlerCalls: TelegramCommandHandler[] = [];

  registerHandlers({
    bot: {
      username: 'gameclub_test_bot',
      use: () => {},
      onCommand: (command: string, handler: TelegramCommandHandler) => {
        if (command === 'start') {
          startHandlerCalls.push(handler);
        }
      },
      onCallback: () => {},
      onText: () => {},
      sendPrivateMessage: async () => {},
      startPolling: async () => {},
      stopPolling: async () => {},
    },
    publicName: 'Game Club Bot',
    adminElevationPasswordHash: 'hashed:admin-secret',
  });

  const startHandler = startHandlerCalls[0];
  assert.ok(startHandler);

  await startHandler({
    chat: { id: -100, type: 'group' },
    from: { id: 77, username: 'agatha', first_name: 'Agatha' },
    messageText: '/start',
    reply: async (message: string, options?: TelegramReplyOptions) => {
      replies.push({ message, ...(options ? { options } : {}) });
    },
    runtime: {
      bot: {
        publicName: 'Game Club Bot',
        clubName: 'Game Club',
        language: 'es',
        username: 'gameclub_test_bot',
        sendPrivateMessage: async () => {},
      },
      services: { database: { db: undefined as never } },
      wikipediaBoardGameImportService: undefined as never,
      boardGameGeekCollectionImportService: undefined as never,
      chat: { kind: 'group', chatId: -100 },
      actor: {
        telegramUserId: 77,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin: false,
        permissions: [],
      },
      authorization: { authorize: () => ({ allowed: true, permissionKey: 'any', reason: 'test' }), can: () => true },
      session: {
        current: null,
        start: async () => undefined as never,
        advance: async () => undefined as never,
        cancel: async () => false,
      },
    },
  } as unknown as TelegramCommandHandlerContext);

  assert.match(replies[0]?.message ?? '', /chat privado/i);
  assert.equal(replies[0]?.options?.inlineKeyboard, undefined);
});

test('/autojoin enabled stores group autojoin for admins', async () => {
  const commandHandlers = new Map<string, TelegramCommandHandler>();
  const replies: string[] = [];
  const appMetadataRecords = new Map<string, string>();

  registerHandlers({
    bot: {
      username: 'gameclub_test_bot',
      use: () => {},
      onCommand: (command: string, handler: TelegramCommandHandler) => {
        commandHandlers.set(command, handler);
      },
      onCallback: () => {},
      onText: () => {},
      onMessage: () => {},
      sendPrivateMessage: async () => {},
      startPolling: async () => {},
      stopPolling: async () => {},
    },
    publicName: 'Game Club Bot',
    adminElevationPasswordHash: 'hashed:admin-secret',
  });

  const autojoinHandler = commandHandlers.get('autojoin');
  assert.ok(autojoinHandler);

  await autojoinHandler({
    messageText: '/autojoin enabled',
    reply: async (message: string) => {
      replies.push(message);
    },
    runtime: createRuntimeForMembershipTest({
      database: createMembershipDatabaseStub({
        membershipUsers: new Map(),
        statusAuditLog: [],
        auditEvents: [],
        appMetadataRecords,
      }),
      chat: { kind: 'group', chatId: -1001, chatTitle: 'CAWA test' },
      actor: {
        telegramUserId: 99,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin: true,
        permissions: [],
      },
    }),
  } as unknown as TelegramCommandHandlerContext);

  assert.equal(appMetadataRecords.get('telegram.membership-autojoin:-1001'), 'true');
  assert.match(replies[0] ?? '', /Autojoin activat/);
});

test('group autojoin approves new non-bot members when enabled', async () => {
  const messageHandlers: TelegramCommandHandler[] = [];
  const replies: string[] = [];
  const groupMessages: Array<{ chatId: number; message: string; options?: TelegramReplyOptions }> = [];
  const membershipUsers = new Map<number, { telegramUserId: number; username?: string | null; displayName: string; status: string; isAdmin: boolean }>();
  const statusAuditLog: Array<{ telegramUserId: number; nextStatus: string }> = [];
  const auditEvents: Array<{ actionKey: string; targetType: string; targetId: string; summary: string; details: Record<string, unknown> | null }> = [];
  const appMetadataRecords = new Map<string, string>([
    ['telegram.membership-autojoin:-1001', 'true'],
    ['telegram.welcome_templates', JSON.stringify([{
      id: 'welcome_auto',
      templateText: 'Bienvenido $USERNAME',
      isEnabled: true,
    }])],
  ]);

  registerHandlers({
    bot: {
      username: 'gameclub_test_bot',
      use: () => {},
      onCommand: () => {},
      onCallback: () => {},
      onText: () => {},
      onMessage: (handler) => {
        messageHandlers.push(handler);
      },
      sendPrivateMessage: async () => {},
      startPolling: async () => {},
      stopPolling: async () => {},
    },
    publicName: 'Game Club Bot',
    adminElevationPasswordHash: 'hashed:admin-secret',
  });

  const messageHandler = messageHandlers[0];
  assert.ok(messageHandler);

  await messageHandler({
    newChatMembers: [
      { id: 42, username: 'new_member', first_name: 'New', last_name: 'Member' },
      { id: 501, username: 'helper_bot', first_name: 'Helper', is_bot: true },
    ],
    reply: async (message: string) => {
      replies.push(message);
    },
    runtime: createRuntimeForMembershipTest({
      database: createMembershipDatabaseStub({
        membershipUsers,
        statusAuditLog,
        auditEvents,
        appMetadataRecords,
      }),
      chat: { kind: 'group', chatId: -1001, chatTitle: 'CAWA test' },
      actor: {
        telegramUserId: 99,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin: true,
        permissions: [],
      },
      groupMessages,
    }),
  } as unknown as TelegramCommandHandlerContext);

  assert.equal(membershipUsers.get(42)?.status, 'approved');
  assert.equal(membershipUsers.get(42)?.displayName, 'New Member');
  assert.equal(membershipUsers.has(501), false);
  assert.deepEqual(statusAuditLog.map((row) => row.nextStatus), ['pending', 'approved']);
  assert.equal(auditEvents[0]?.actionKey, 'membership.approved');
  assert.deepEqual(replies, []);
  assert.equal(groupMessages.length, 1);
  assert.equal(groupMessages[0]?.chatId, -1001);
  assert.equal(groupMessages[0]?.message, 'Bienvenido New Member');
  assert.equal(groupMessages[0]?.options?.parseMode, 'HTML');
});

test('group join does not approve or welcome members when autojoin is disabled', async () => {
  const messageHandlers: TelegramCommandHandler[] = [];
  const replies: string[] = [];
  const groupMessages: Array<{ chatId: number; message: string; options?: TelegramReplyOptions }> = [];
  const membershipUsers = new Map<number, { telegramUserId: number; username?: string | null; displayName: string; status: string; isAdmin: boolean }>();
  const statusAuditLog: Array<{ telegramUserId: number; nextStatus: string }> = [];
  const auditEvents: Array<{ actionKey: string; targetType: string; targetId: string; summary: string; details: Record<string, unknown> | null }> = [];
  const appMetadataRecords = new Map<string, string>([
    ['telegram.welcome_templates', JSON.stringify([{
      id: 'welcome_auto',
      templateText: 'Bienvenido $USERNAME',
      isEnabled: true,
    }])],
  ]);

  registerHandlers({
    bot: {
      username: 'gameclub_test_bot',
      use: () => {},
      onCommand: () => {},
      onCallback: () => {},
      onText: () => {},
      onMessage: (handler) => {
        messageHandlers.push(handler);
      },
      sendPrivateMessage: async () => {},
      startPolling: async () => {},
      stopPolling: async () => {},
    },
    publicName: 'Game Club Bot',
    adminElevationPasswordHash: 'hashed:admin-secret',
  });

  const messageHandler = messageHandlers[0];
  assert.ok(messageHandler);

  await messageHandler({
    newChatMembers: [
      { id: 42, username: 'new_member', first_name: 'New', last_name: 'Member' },
    ],
    reply: async (message: string) => {
      replies.push(message);
    },
    runtime: createRuntimeForMembershipTest({
      database: createMembershipDatabaseStub({
        membershipUsers,
        statusAuditLog,
        auditEvents,
        appMetadataRecords,
      }),
      chat: { kind: 'group', chatId: -1001, chatTitle: 'CAWA test' },
      actor: {
        telegramUserId: 99,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin: true,
        permissions: [],
      },
      groupMessages,
    }),
  } as unknown as TelegramCommandHandlerContext);

  assert.equal(membershipUsers.has(42), false);
  assert.deepEqual(statusAuditLog, []);
  assert.deepEqual(auditEvents, []);
  assert.deepEqual(replies, []);
  assert.deepEqual(groupMessages, []);
});

function createRuntimeForMembershipTest({
  database,
  chat,
  actor,
  groupMessages,
}: {
  database: unknown;
  chat: { kind: 'private' | 'group' | 'group-news'; chatId: number; chatTitle?: string };
  actor: {
    telegramUserId: number;
    status: string;
    isApproved: boolean;
    isBlocked: boolean;
    isAdmin: boolean;
    permissions: string[];
  };
  groupMessages?: Array<{ chatId: number; message: string; options?: TelegramReplyOptions }>;
}): TelegramCommandHandlerContext['runtime'] {
  return {
    bot: {
      publicName: 'Game Club Bot',
      clubName: 'Game Club',
      language: 'es',
      username: 'gameclub_test_bot',
      sendPrivateMessage: async () => {},
      sendGroupMessage: async (chatId: number, message: string, options?: TelegramReplyOptions) => {
        groupMessages?.push(options ? { chatId, message, options } : { chatId, message });
      },
    },
    services: { database: { db: database as never } },
    wikipediaBoardGameImportService: undefined as never,
    boardGameGeekCollectionImportService: undefined as never,
    chat,
    actor,
    authorization: { authorize: () => ({ allowed: true, permissionKey: 'any', reason: 'test' }), can: () => true },
    session: {
      current: null,
      start: async () => undefined as never,
      advance: async () => undefined as never,
      cancel: async () => false,
    },
  } as unknown as TelegramCommandHandlerContext['runtime'];
}

function createMembershipDatabaseStub({
  membershipUsers,
  statusAuditLog,
  auditEvents,
  appMetadataRecords = new Map<string, string>(),
  newsGroupRecords = new Map(),
  newsGroupSubscriptions = new Map(),
}: {
  membershipUsers: Map<
    number,
    { telegramUserId: number; username?: string | null; displayName: string; status: string; isAdmin: boolean }
  >;
  statusAuditLog: Array<{ telegramUserId: number; nextStatus: string }>;
  auditEvents: Array<{ actionKey: string; targetType: string; targetId: string; summary: string; details: Record<string, unknown> | null }>;
  appMetadataRecords?: Map<string, string>;
  newsGroupRecords?: Map<number, {
    chatId: number;
    isEnabled: boolean;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
    enabledAt: Date | null;
    disabledAt: Date | null;
  }>;
  newsGroupSubscriptions?: Map<string, Set<number>>;
}) {
  type MembershipDatabaseStub = {
    transaction(handler: (tx: MembershipDatabaseStub) => Promise<unknown>): Promise<unknown>;
    select(selection: Record<string, unknown>): {
      from(): {
        where(): Promise<unknown[]> & {
          orderBy(): Promise<unknown[]> & {
            limit(): Promise<unknown[]>;
          };
        };
        orderBy(): {
          limit(): Promise<unknown[]>;
        };
      };
    };
    insert(): {
      values(value: Record<string, unknown>): Promise<void> | {
        onConflictDoUpdate(): Promise<void> | {
          returning(): Promise<Array<Record<string, unknown>>>;
        };
      };
    };
    update(): {
      set(value: Record<string, unknown>): {
        where(): {
          returning(): Promise<Array<Record<string, unknown>>>;
        };
      };
    };
    delete(): {
      where(): {
        returning(): Promise<Array<Record<string, unknown>>>;
      };
    };
  };

  let stub!: MembershipDatabaseStub;
  stub = {
    select(selection: Record<string, unknown> = {}) {
      return {
        from() {
          const rows = async (condition?: unknown) => {
            if ('permissionKey' in selection) {
              return [];
            }

            if ('changedByTelegramUserId' in selection && 'createdAt' in selection && 'reason' in selection) {
              return [];
            }

            if ('status' in selection && 'displayName' in selection) {
              return Array.from(membershipUsers.values());
            }

            if ('telegramUserId' in selection && 'displayName' in selection) {
              return Array.from(membershipUsers.values());
            }

            if ('value' in selection) {
              return Array.from(appMetadataRecords, ([key, value]) => ({ key, value }))
                .filter((row) => matchesAppMetadataCondition(condition, row.key));
            }

            if ('chatId' in selection && 'isEnabled' in selection && 'metadata' in selection) {
              return listSubscribedNewsGroupRows(newsGroupRecords, newsGroupSubscriptions);
            }

            return [];
          };
          const approvedNonAdmins = async () =>
            Array.from(membershipUsers.values()).filter((user) => user.status === 'approved' && !user.isAdmin);

          return {
            where(condition?: unknown) {
              const promise = rows(condition) as Promise<unknown[]> & {
                orderBy(): Promise<unknown[]> & {
                  limit(): Promise<unknown[]>;
                };
              };
              promise.orderBy = (() => {
                const ordered = approvedNonAdmins() as Promise<unknown[]> & {
                  limit(): Promise<unknown[]>;
                };
                ordered.limit = approvedNonAdmins;
                return ordered;
              }) as typeof promise.orderBy;
              return promise;
            },
            orderBy() {
              return {
                limit: approvedNonAdmins,
              };
            },
            innerJoin() {
              return {
                where() {
                  return {
                    orderBy: async () => listSubscribedNewsGroupRows(newsGroupRecords, newsGroupSubscriptions),
                  };
                },
              };
            },
          };
        },
      };
    },
    insert() {
      return {
        values(value: Record<string, unknown>) {
          if ('key' in value && 'value' in value) {
            appMetadataRecords.set(String(value.key), String(value.value));
            return {
              onConflictDoUpdate() {
                return Promise.resolve();
              },
            };
          }

          if ('nextStatus' in value) {
            statusAuditLog.push({
              telegramUserId: Number(value.subjectTelegramUserId),
              nextStatus: String(value.nextStatus),
            });
            return Promise.resolve();
          }

          if ('actionKey' in value && 'targetType' in value && 'targetId' in value) {
            auditEvents.push({
              actionKey: String(value.actionKey),
              targetType: String(value.targetType),
              targetId: String(value.targetId),
              summary: String(value.summary),
              details: (value.details as Record<string, unknown> | null | undefined) ?? null,
            });
            return Promise.resolve();
          }

          const record = {
            telegramUserId: Number(value.telegramUserId),
            username: (value.username as string | null | undefined) ?? null,
            displayName: String(value.displayName),
            status: String(value.status),
            isAdmin: Boolean(value.isAdmin),
          };
          membershipUsers.set(record.telegramUserId, record);

          return {
            onConflictDoUpdate() {
              return {
                returning: async () => [record],
              };
            },
          };
        },
      };
    },
    update() {
      return {
        set(value: Record<string, unknown>) {
          return {
            where() {
              return {
                returning: async () => {
                  const existing = membershipUsers.get(Number(value.telegramUserId ?? 42));
                  if (!existing) {
                    return [];
                  }

                  const next = {
                    ...existing,
                    ...(value.status !== undefined ? { status: String(value.status) } : {}),
                    ...(value.displayName !== undefined ? { displayName: String(value.displayName) } : {}),
                    ...(value.username !== undefined ? { username: value.username as string | null } : {}),
                    isAdmin: value.isAdmin === undefined ? existing.isAdmin : Boolean(value.isAdmin),
                  };
                  membershipUsers.set(next.telegramUserId, next);
                  return [next];
                },
              };
            },
          };
        },
      };
    },
    delete() {
      return {
            where(condition?: unknown) {
              return {
                returning: async () => {
                  const keys = Array.from(appMetadataRecords.keys()).filter((key) => matchesAppMetadataCondition(condition, key));
                  for (const key of keys) {
                    appMetadataRecords.delete(key);
                  }
              return keys.map((key) => ({ key }));
            },
          };
        },
      };
    },
    transaction: async (handler) => handler(stub),
  };

  return stub;
}

function listSubscribedNewsGroupRows(
  newsGroupRecords: Map<number, {
    chatId: number;
    isEnabled: boolean;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
    enabledAt: Date | null;
    disabledAt: Date | null;
  }>,
  newsGroupSubscriptions: Map<string, Set<number>>,
): Array<{
  chatId: number;
  isEnabled: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  enabledAt: Date | null;
  disabledAt: Date | null;
}> {
  const subscribedChatIds = newsGroupSubscriptions.get('nuevos_miembros') ?? new Set<number>();
  return Array.from(subscribedChatIds)
    .map((chatId) => newsGroupRecords.get(chatId))
    .filter((group): group is NonNullable<typeof group> => group?.isEnabled === true)
    .sort((left, right) => left.chatId - right.chatId);
}

function matchesAppMetadataCondition(condition: unknown, key: string): boolean {
  const normalized = extractAppMetadataCondition(condition);
  if (!normalized) {
    return true;
  }

  if (normalized.operator === 'like') {
    return key.startsWith(normalized.value.replace(/%+$/, ''));
  }

  return key === normalized.value;
}

function extractAppMetadataCondition(condition: unknown): { operator: 'eq' | 'like'; value: string } | null {
  if (typeof condition !== 'object' || condition === null || !('queryChunks' in condition)) {
    return null;
  }

  const queryChunks = (condition as { queryChunks?: unknown[] }).queryChunks ?? [];
  const operator = queryChunks.some((chunk) => {
    if (typeof chunk !== 'object' || chunk === null || !('value' in chunk)) {
      return false;
    }

    const value = (chunk as { value?: unknown }).value;
    return Array.isArray(value) && value.some((part) => typeof part === 'string' && part.includes(' like '));
  }) ? 'like' : 'eq';
  const rawValue = queryChunks.find((chunk) => typeof chunk === 'string')
    ?? queryChunks.map((chunk) => (typeof chunk === 'object' && chunk !== null && 'value' in chunk
      ? (chunk as { value?: unknown }).value
      : undefined)).find((value): value is string => typeof value === 'string');

  return typeof rawValue === 'string' ? { operator, value: rawValue } : null;
}

function createNewsGroupDatabaseStub() {
  return {
    select(selection: Record<string, unknown> = {}) {
      return {
        from(table: { [key: string]: unknown }) {
          return {
            where: async () => {
              if ('isEnabled' in selection) {
                return [{ isEnabled: true }];
              }

              if ('chatId' in selection && 'categoryKey' in selection) {
                return [
                  {
                    chatId: -200,
                    isEnabled: true,
                    metadata: null,
                    createdAt: new Date('2026-04-04T10:00:00.000Z'),
                    updatedAt: new Date('2026-04-04T10:00:00.000Z'),
                    enabledAt: new Date('2026-04-04T10:00:00.000Z'),
                    disabledAt: null,
                  },
                ];
              }

              if ('chatId' in selection) {
                return [
                  {
                    chatId: -200,
                    isEnabled: true,
                    metadata: null,
                    createdAt: new Date('2026-04-04T10:00:00.000Z'),
                    updatedAt: new Date('2026-04-04T10:00:00.000Z'),
                    enabledAt: new Date('2026-04-04T10:00:00.000Z'),
                    disabledAt: null,
                  },
                ];
              }

              return [];
            },
            innerJoin() {
              return this;
            },
            orderBy() {
              return Promise.resolve([]);
            },
          };
        },
      };
    },
  };
}

function createTodayAtClubDatabaseStub({
  auditEvents,
}: {
  auditEvents: Array<{ actionKey: string; targetType: string; targetId: string; summary: string; details: Record<string, unknown> | null }>;
}) {
  const scheduleRows = [
    {
      id: 1,
      title: 'Wingspan',
      description: null,
      startsAt: new Date('2026-04-27T16:00:00.000Z'),
      durationMinutes: 180,
      organizerTelegramUserId: 77,
      createdByTelegramUserId: 77,
      tableId: null,
      attendanceMode: 'open',
      initialOccupiedSeats: 0,
      capacity: 4,
      lifecycleStatus: 'scheduled',
      createdAt: new Date('2026-04-20T10:00:00.000Z'),
      updatedAt: new Date('2026-04-20T10:00:00.000Z'),
      cancelledAt: null,
      cancelledByTelegramUserId: null,
      cancellationReason: null,
    },
  ];
  const venueRows = [
    {
      id: 1,
      name: 'Torneig intern',
      description: null,
      startsAt: new Date('2026-04-27T18:00:00.000Z'),
      endsAt: new Date('2026-04-27T21:00:00.000Z'),
      occupancyScope: 'partial',
      impactLevel: 'medium',
      lifecycleStatus: 'scheduled',
      createdAt: new Date('2026-04-20T10:00:00.000Z'),
      updatedAt: new Date('2026-04-20T10:00:00.000Z'),
      cancelledAt: null,
      cancellationReason: null,
    },
  ];

  return {
    select() {
      return {
        from(table: Record<string, unknown>) {
          const rows = 'durationMinutes' in table ? scheduleRows : 'occupancyScope' in table ? venueRows : [];
          const orderedRows = async () => rows;
          const whereRows = rows as unknown as Promise<unknown[]> & { orderBy(): Promise<unknown[]> };
          whereRows.orderBy = orderedRows;
          return {
            where: () => whereRows,
            orderBy: orderedRows,
          };
        },
      };
    },
    insert() {
      return {
        values(value: Record<string, unknown>) {
          if ('actionKey' in value && 'targetType' in value && 'targetId' in value) {
            auditEvents.push({
              actionKey: String(value.actionKey),
              targetType: String(value.targetType),
              targetId: String(value.targetId),
              summary: String(value.summary),
              details: (value.details as Record<string, unknown> | null | undefined) ?? null,
            });
          }
          return Promise.resolve();
        },
      };
    },
  };
}

function createEmptyScheduleDatabaseStub() {
  return {
    select() {
      return {
        from() {
          return {
            where: () => ({
              orderBy: async () => [],
            }),
            orderBy: async () => [],
          };
        },
      };
    },
  };
}

function createClubTableDatabaseStub({
  auditEvents = [],
  tables,
}: {
  auditEvents?: Array<{ actionKey: string; targetType: string; targetId: string; summary: string; details: Record<string, unknown> | null }>;
  tables: Array<{
    id: number;
    displayName: string;
    description: string | null;
    recommendedCapacity: number | null;
    lifecycleStatus: 'active' | 'deactivated';
    createdAt: string;
    updatedAt: string;
  }>;
}) {
  return {
    select() {
      return {
        from() {
          return {
            where: async () => tables.filter((table) => table.lifecycleStatus === 'active').map(mapClubTableStubRow),
            orderBy: async () => tables.map(mapClubTableStubRow),
          };
        },
      };
    },
    insert() {
      return {
        values(value: Record<string, unknown>) {
          if ('actionKey' in value && 'targetType' in value && 'targetId' in value) {
            auditEvents.push({
              actionKey: String(value.actionKey),
              targetType: String(value.targetType),
              targetId: String(value.targetId),
              summary: String(value.summary),
              details: (value.details as Record<string, unknown> | null | undefined) ?? null,
            });
          }

          return Promise.resolve();
        },
      };
    },
  };
}

function mapClubTableStubRow(table: {
  id: number;
  displayName: string;
  description: string | null;
  recommendedCapacity: number | null;
  lifecycleStatus: 'active' | 'deactivated';
  createdAt: string;
  updatedAt: string;
}) {
  return {
    ...table,
    createdAt: new Date(table.createdAt),
    updatedAt: new Date(table.updatedAt),
    deactivatedAt: null,
  };
}
