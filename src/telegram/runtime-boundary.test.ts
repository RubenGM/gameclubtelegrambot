import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTelegramBoundary,
  formatStartMessage,
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

  assert.deepEqual(events, [
    'token:telegram-token',
    'middleware:register',
    'middleware:register',
    'middleware:register',
    'middleware:register',
    'middleware:register',
    'middleware:register',
    'middleware:register',
    'register:/elevate_admin',
    'register:/access',
    'register:/subscribe_requests',
    'register:/unsubscribe_requests',
    'register:/language',
    'register:/schedule',
    'register:/calendar',
    'register:/tables',
    'register:/catalog_search',
    'register:/group_purchases',
    'register:/news',
    'register:/venue_events',
    'register:/catalog',
    'register:/review_access',
    'register:/manage_users',
    'register:/approve',
    'register:/reject',
    'register:/cancel',
    'register:/start',
    'register:/help',
    'register:callback:menu:review_access',
    'register:callback:menu:help',
    'register:callback:approve_access:',
    'register:callback:reject_access:',
    'register:callback:membership_revoke:select:',
    'register:callback:membership_revoke:confirm',
    'register:callback:membership_revoke:cancel',
    'register:callback:schedule:inspect:',
    'register:callback:schedule:join:',
    'register:callback:schedule:leave:',
    'register:callback:schedule:day:',
    'register:callback:schedule:select_edit:',
    'register:callback:schedule:select_cancel:',
    'register:callback:schedule:table:',
    'register:callback:group_purchase:join:',
    'register:callback:group_purchase:join_interested:',
    'register:callback:group_purchase:join_confirmed:',
    'register:callback:group_purchase:edit_values:',
    'register:callback:group_purchase:leave:',
    'register:callback:group_purchase:confirm:',
    'register:callback:group_purchase:manage_participants:',
    'register:callback:group_purchase:participant_status:',
    'register:callback:group_purchase:publish_message:',
    'register:callback:group_purchase:lifecycle:',
    'register:callback:group_purchase:edit_purchase:',
    'register:callback:group_purchase:publish_group:',
    'register:callback:table_read:inspect:',
    'register:callback:table_admin:inspect:',
    'register:callback:table_admin:edit:',
    'register:callback:table_admin:deactivate:',
    'register:callback:catalog_read:overview',
    'register:callback:catalog_read:page:next',
    'register:callback:catalog_read:page:prev',
    'register:callback:catalog_read:back',
    'register:callback:catalog_read:my_loans',
    'register:callback:catalog_read:family:',
    'register:callback:catalog_read:group:',
    'register:callback:catalog_read:item:',
    'register:callback:catalog_loan:my_loans',
    'register:callback:catalog_loan:create:',
    'register:callback:catalog_loan:return:',
    'register:callback:catalog_loan:edit:',
    'register:callback:catalog_admin:inspect:',
    'register:callback:catalog_admin:browse_menu',
    'register:callback:catalog_admin:browse_search',
    'register:callback:catalog_admin:browse_family:',
    'register:callback:catalog_admin:inspect_group:',
    'register:callback:catalog_admin:edit:',
    'register:callback:catalog_admin:create_activity:',
    'register:callback:catalog_admin:deactivate:',
    'register:callback:venue_event_admin:inspect:',
    'register:callback:venue_event_admin:edit:',
    'register:callback:venue_event_admin:cancel:',
    'runtime:database:1',
    'reply:He registrat la teva sollicitud d acces. Ara queda pendent de revisio per part d un administrador del club. Quan te l aprovin, ja podras fer servir activitats, calendari, cataleg i taules. Si vols agilitzar-ho, avisa un administrador i digues-li que ja t has registrat al bot.',
    'reply:La teva sollicitud d acces ja esta pendent. Un administrador del club l ha de revisar abans que puguis fer servir activitats, calendari, cataleg i taules. Si vols agilitzar-ho, avisa un administrador i digues-li que ja t has registrat al bot.',
    'reply-keyboard:Acces al club|Idioma|Ajuda',
    'reply:Sollicituds pendents:\n- New (@new_member) -> /approve 42 o /reject 42',
    'buttons:Aprovar|Rebutjar',
    'reply:No hi ha cap usuari aprovat disponible per expulsar.',
    'reply:Usuari aprovat correctament.',
    'reply:Que pots fer ara:\nRevisar sollicituds: revisa i resol les sollicituds pendents.\nAdministrar usuaris: administra usuaris aprovats i expulsions.\nActivitats: consulta, crea o edita activitats del club.\nTaules: consulta les taules actives del local.\nCataleg: explora el cataleg i revisa prestecs.\n\nToca un boto del menu per continuar.',
    'start-polling',
    'stop-polling',
  ]);
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
        visibleLabels: ['Acces al club', 'Idioma', 'Ajuda'],
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
  assert.deepEqual(replies, ['S ha produit un error inesperat. Torna-ho a provar en uns moments.']);
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

  assert.deepEqual(calls, ['handle', 'ack']);
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

              context.messageText = createTelegramI18n('ca').actionMenu.start;
              await textHandler(commandContext);

              context.messageText = createTelegramI18n('ca').actionMenu.help;
              await textHandler(commandContext);

              context.messageText = createTelegramI18n('ca').actionMenu.reviewAccess;
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
  assert.deepEqual(replyKeyboardLabels(replies[0]?.options?.replyKeyboard), [['Revisar sollicituds', 'Administrar usuaris'], ['Activitats', 'Taules'], ['Cataleg', 'Compres conjuntes'], ['Idioma', 'Ajuda']]);
  assert.match(replies[0]?.message ?? '', /Game Club Bot online \(v0\.[0-9.]+\)/);
  assert.match(replies[0]?.message ?? '', /sollicituds/i);
  assert.match(replies[1]?.message ?? '', /Que pots fer ara/);
  assert.match(replies[2]?.message ?? '', /Sollicituds pendents/);
  assert.deepEqual(
    replies[2]?.options?.inlineKeyboard?.flat().map((button) => button.text),
    ['Aprovar', 'Rebutjar'],
  );
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
      message: 'Proces cancel.lat correctament.',
      options: {
        menuId: 'private-approved-default',
        replyKeyboard: [
          [{ text: 'Activitats', semanticRole: 'primary' }, { text: 'Taules', semanticRole: 'primary' }],
          [{ text: 'Cataleg', semanticRole: 'primary' }, { text: 'Compres conjuntes', semanticRole: 'primary' }],
          [{ text: 'Idioma', semanticRole: 'secondary' }, { text: 'Ajuda', semanticRole: 'help' }],
        ],
        actionRows: [['schedule', 'tables_read'], ['catalog', 'group_purchases'], ['language', 'help']],
        actions: [
          { id: 'schedule', label: 'Activitats', telemetryActionKey: 'menu.schedule', uxSection: 'primary' },
          { id: 'tables_read', label: 'Taules', telemetryActionKey: 'menu.tables', uxSection: 'primary' },
          { id: 'catalog', label: 'Cataleg', telemetryActionKey: 'menu.catalog', uxSection: 'primary' },
          { id: 'group_purchases', label: 'Compres conjuntes', telemetryActionKey: 'menu.group_purchases', uxSection: 'primary' },
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
  assert.equal(membershipUsers.get(42)?.displayName, '@new_member');
  assert.match(replies[0]?.message ?? '', /sollicitud d acces/i);
  assert.match(replies[0]?.message ?? '', /administrador/i);
  assert.match(replies[0]?.message ?? '', /pendent/i);

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
      message: 'Gestio de taules: tria una accio.',
      options: {
        replyKeyboard: [['Crear taula', 'Llistar taules'], ['Editar taula', 'Desactivar taula'], ['Inici']],
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
  assert.match(replies[0]?.message ?? '', /Des del menu pots obrir activitats, taules i cataleg/);
  assert.deepEqual(replyKeyboardLabels(replies[0]?.options?.replyKeyboard), [['Activitats', 'Taules'], ['Cataleg', 'Compres conjuntes'], ['Idioma', 'Ajuda']]);
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
        visibleActionIds: ['schedule', 'tables_read', 'catalog', 'group_purchases', 'language', 'help'],
        visibleLabels: ['Activitats', 'Taules', 'Cataleg', 'Compres conjuntes', 'Idioma', 'Ajuda'],
      },
    },
  ]);
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
        replyKeyboard: [['Veure activitats', 'Crear activitat'], ['Editar activitat', 'Cancel.lar activitat'], ['Inici', 'Ajuda']],
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
    'Benvingut a Game Club Bot. Des del menu pots obrir activitats, taules i cataleg.',
  );
  assert.equal(
    formatStartMessage({ publicName: 'Game Club Bot', version: '0.1.0', isAdmin: false, isApproved: false, language: 'ca' }),
    'Benvingut a Game Club Bot. Per començar, toca Acces al club o escriu /start. Si la teva sollicitud ja esta pendent, espera l aprovacio d un administrador.',
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
  assert.match(replies[0]?.message ?? '', /grupos solo puedo orientarte/i);
  assert.equal(replies[0]?.options?.inlineKeyboard?.[0]?.[0]?.text, 'Abrir chat privado');
  assert.equal(replies[0]?.options?.inlineKeyboard?.[0]?.[0]?.url, 'https://t.me/gameclub_test_bot?start=from_group');
});


function createMembershipDatabaseStub({
  membershipUsers,
  statusAuditLog,
  auditEvents,
}: {
  membershipUsers: Map<
    number,
    { telegramUserId: number; username?: string | null; displayName: string; status: string; isAdmin: boolean }
  >;
  statusAuditLog: Array<{ telegramUserId: number; nextStatus: string }>;
  auditEvents: Array<{ actionKey: string; targetType: string; targetId: string; summary: string; details: Record<string, unknown> | null }>;
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
        onConflictDoUpdate(): {
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
  };

  let stub!: MembershipDatabaseStub;
  stub = {
    select(selection: Record<string, unknown>) {
      return {
        from() {
          const rows = async () => {
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

            return [];
          };
          const approvedNonAdmins = async () =>
            Array.from(membershipUsers.values()).filter((user) => user.status === 'approved' && !user.isAdmin);

          return {
            where() {
              const promise = rows() as Promise<unknown[]> & {
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
          };
        },
      };
    },
    insert() {
      return {
        values(value: Record<string, unknown>) {
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
    transaction: async (handler) => handler(stub),
  };

  return stub;
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
