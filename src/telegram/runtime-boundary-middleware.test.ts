import test from 'node:test';
import assert from 'node:assert/strict';

import type { RuntimeConfig } from '../config/runtime-config.js';
import type { InfrastructureRuntimeServices } from '../infrastructure/runtime-boundary.js';
import { createMiddlewarePipeline } from './runtime-boundary-middleware.js';
import type { TelegramActor } from './actor-store.js';
import type { ConversationSessionStore } from './conversation-session.js';
import type { TelegramBotLike, TelegramContextLike, TelegramLogger, TelegramMiddleware } from './runtime-boundary.js';

const runtimeConfig: RuntimeConfig = {
  schemaVersion: 1,
  bot: {
    publicName: 'Game Club Bot',
    clubName: 'Game Club',
    language: 'ca',
  },
  telegram: {
    token: 'telegram-token',
  },
  bgg: {
    apiKey: 'bgg-token',
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
};

test('createMiddlewarePipeline reuses the board-game import service across updates', async () => {
  const database = createMembershipDatabaseStub();
  const middlewares = createMiddlewarePipeline({
    config: runtimeConfig,
    services: {
      database: {
        pool: undefined as never,
        db: database as never,
        close: async () => {},
      },
    } satisfies InfrastructureRuntimeServices,
    bot: createBotStub(),
    logger: createLoggerStub(),
    isNewsEnabledGroup: async () => false,
    loadActor: async ({ telegramUserId }) => createApprovedActor(telegramUserId),
    conversationSessionStore: createConversationSessionStoreStub(),
    languagePreferenceStore: {
      loadLanguage: async () => null,
    },
  });

  const firstContext = createTextContext();
  const secondContext = createTextContext();

  await runMiddlewares(middlewares, firstContext);
  await runMiddlewares(middlewares, secondContext);

  assert.ok(firstContext.runtime?.wikipediaBoardGameImportService);
  assert.equal(
    firstContext.runtime?.wikipediaBoardGameImportService,
    secondContext.runtime?.wikipediaBoardGameImportService,
  );
});

test('createMiddlewarePipeline logs structured update metadata', async () => {
  const infoLogs: Array<{ bindings: object; message: string }> = [];
  const middlewares = createMiddlewarePipeline({
    config: runtimeConfig,
    services: {
      database: {
        pool: undefined as never,
        db: createMembershipDatabaseStub() as never,
        close: async () => {},
      },
    } satisfies InfrastructureRuntimeServices,
    bot: createBotStub(),
    logger: {
      info(bindings, message) {
        infoLogs.push({ bindings, message });
      },
      error() {},
    },
    isNewsEnabledGroup: async () => false,
    loadActor: async ({ telegramUserId }) => createApprovedActor(telegramUserId),
    conversationSessionStore: createConversationSessionStoreStub(),
    languagePreferenceStore: {
      loadLanguage: async () => null,
    },
  });

  await runMiddlewares(middlewares, createTextContext());

  assert.deepEqual(infoLogs, [
    {
      bindings: {
        chatId: 100,
        chatType: 'private',
        telegramUserId: 42,
        updateKind: 'message',
      },
      message: 'Telegram update received',
    },
  ]);
});

function createMembershipDatabaseStub() {
  return {
    select: () => ({
      from: () => ({
        where: async () => [
          {
            telegramUserId: 42,
            username: 'new_member',
            displayName: 'New Member',
            status: 'approved',
            isAdmin: false,
          },
        ],
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            throw new Error('unexpected user profile write');
          },
        }),
      }),
    }),
  };
}

function createConversationSessionStoreStub(): ConversationSessionStore {
  return {
    async loadSession() {
      return null;
    },
    async saveSession() {},
    async deleteSession() {
      return false;
    },
    async deleteExpiredSessions() {
      return 0;
    },
  };
}

function createBotStub(): TelegramBotLike {
  return {
    use() {},
    onCommand() {},
    onCallback() {},
    onText() {},
    async sendPrivateMessage() {},
    async startPolling() {},
    async stopPolling() {},
  };
}

function createLoggerStub(): TelegramLogger {
  return {
    info() {},
    error() {},
  };
}

function createApprovedActor(telegramUserId: number): TelegramActor {
  return {
    telegramUserId,
    status: 'approved',
    isApproved: true,
    isBlocked: false,
    isAdmin: false,
    permissions: [],
  };
}

function createTextContext(): TelegramContextLike & { message: { text: string } } {
  return {
    chat: {
      id: 100,
      type: 'private',
    },
    from: {
      id: 42,
      username: 'new_member',
      first_name: 'New',
      last_name: 'Member',
    },
    message: {
      text: 'hola',
    },
    reply: async () => {},
  };
}

async function runMiddlewares(middlewares: TelegramMiddleware[], context: TelegramContextLike): Promise<void> {
  let index = -1;

  const dispatch = async (middlewareIndex: number): Promise<void> => {
    if (middlewareIndex <= index) {
      throw new Error('next called multiple times');
    }

    index = middlewareIndex;

    if (middlewareIndex === middlewares.length) {
      return;
    }

    const middleware = middlewares[middlewareIndex];
    if (!middleware) {
      throw new Error(`middleware ${middlewareIndex} not registered`);
    }

    await middleware(context, () => dispatch(middlewareIndex + 1));
  };

  await dispatch(0);
}
