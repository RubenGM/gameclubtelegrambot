import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from './create-app.js';
import { InfrastructureStartupError } from '../infrastructure/runtime-boundary.js';
import { TelegramStartupError } from '../telegram/runtime-boundary.js';

const databaseConnection = {
  pool: undefined as never,
  db: undefined as never,
  close: async () => {},
};

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
  httpServer: {
    enabled: false,
    host: '127.0.0.1',
    port: 8787,
    feedbackFile: 'data/feedback.jsonl',
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
  featureFlags: {
    bootstrapWizard: true,
  },
} as const;

test('createApp exposes clean startup boundaries before external integrations exist', async () => {
  const messages: string[] = [];
  const logger = {
    info: (_bindings: object, message: string) => {
      messages.push(message);
    },
  };

  const app = createApp({
    config: runtimeConfig,
    logger,
    startInfrastructure: async () => ({
      status: {
        database: 'connected',
      },
      services: {
        database: databaseConnection,
      },
      stop: async () => {},
    }),
    startTelegram: async () => ({
      status: {
        bot: 'connected',
      },
      sendPrivateMessage: async () => {},
      stop: async () => {},
    }),
  });
  const status = await app.start();

  assert.equal(status.service, 'gameclubtelegrambot');
  assert.equal(status.infrastructure.database, 'connected');
  assert.equal(status.telegram.bot, 'connected');
  assert.equal(messages[0], 'Application started with validated runtime configuration');
});

test('createApp propagates predictable infrastructure startup failures', async () => {
  const logger = {
    info: (_bindings: object, _message: string) => {
      assert.fail('logger.info should not be called when startup fails');
    },
  };

  const app = createApp({
    config: runtimeConfig,
    logger,
    startInfrastructure: async () => {
      throw new InfrastructureStartupError('Database connection failed: connect ECONNREFUSED');
    },
  });

  await assert.rejects(
    () => app.start(),
    (error: unknown) => {
      assert.equal(error instanceof InfrastructureStartupError, true);
      assert.match(
        error instanceof Error ? error.message : '',
        /Database connection failed: connect ECONNREFUSED/,
      );
      return true;
    },
  );
});

test('createApp propagates predictable Telegram startup failures', async () => {
  const logger = {
    info: (_bindings: object, _message: string) => {
      assert.fail('logger.info should not be called when startup fails');
    },
  };

  const app = createApp({
    config: runtimeConfig,
    logger,
    startInfrastructure: async () => ({
      status: {
        database: 'connected',
      },
      services: {
        database: databaseConnection,
      },
      stop: async () => {},
    }),
    startTelegram: async () => {
      throw new TelegramStartupError('Telegram startup failed: Unauthorized');
    },
  });

  await assert.rejects(
    () => app.start(),
    (error: unknown) => {
      assert.equal(error instanceof TelegramStartupError, true);
      assert.match(error instanceof Error ? error.message : '', /Telegram startup failed: Unauthorized/);
      return true;
    },
  );
});

test('createApp passes infrastructure services into Telegram startup', async () => {
  const logger = {
    info: (_bindings: object, _message: string) => {},
  };
  let seenDatabaseConnection: unknown;

  const app = createApp({
    config: runtimeConfig,
    logger,
    startInfrastructure: async () => ({
      status: {
        database: 'connected',
      },
      services: {
        database: databaseConnection,
      },
      stop: async () => {},
    }),
    startTelegram: async ({ services }) => {
      seenDatabaseConnection = services.database;

      return {
        status: {
          bot: 'connected',
        },
        sendPrivateMessage: async () => {},
        stop: async () => {},
      };
    },
  });

  await app.start();

  assert.equal(seenDatabaseConnection, databaseConnection);
});

test('createApp notifies the first admin when startup is ready', async () => {
  const messages: Array<{ telegramUserId: number; message: string }> = [];
  const logger = {
    info: (_bindings: object, _message: string) => {},
  };

  const app = createApp({
    config: runtimeConfig,
    logger,
    startInfrastructure: async () => ({
      status: {
        database: 'connected',
      },
      services: {
        database: databaseConnection,
      },
      stop: async () => {},
    }),
    startTelegram: async () => ({
      status: {
        bot: 'connected',
      },
      sendPrivateMessage: async (telegramUserId, message) => {
        messages.push({ telegramUserId, message });
      },
      stop: async () => {},
    }),
    startScheduleReminders: () => ({
      start: async () => {},
      stop: async () => {},
    }),
    startRoleGameRecurrences: () => ({
      start: async () => {},
      stop: async () => {},
    }),
  });

  await app.start();

  assert.deepEqual(messages, [
    {
      telegramUserId: 123456789,
      message: 'Game Club Bot està llest.',
    },
  ]);
});

test('createApp keeps running when the first admin startup notification fails', async () => {
  const errors: Array<{ bindings: object; message: string }> = [];
  const logger = {
    info: (_bindings: object, _message: string) => {},
    error: (bindings: object, message: string) => {
      errors.push({ bindings, message });
    },
  };

  const app = createApp({
    config: runtimeConfig,
    logger,
    startInfrastructure: async () => ({
      status: {
        database: 'connected',
      },
      services: {
        database: databaseConnection,
      },
      stop: async () => {},
    }),
    startTelegram: async () => ({
      status: {
        bot: 'connected',
      },
      sendPrivateMessage: async () => {
        throw new Error('bot was blocked by the user');
      },
      stop: async () => {},
    }),
    startScheduleReminders: () => ({
      start: async () => {},
      stop: async () => {},
    }),
    startRoleGameRecurrences: () => ({
      start: async () => {},
      stop: async () => {},
    }),
  });

  const status = await app.start();

  assert.equal(status.telegram.bot, 'connected');
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.message, 'First admin startup notification failed');
});

test('createApp stops Telegram before infrastructure during shutdown', async () => {
  const events: string[] = [];
  const logger = {
    info: (_bindings: object, _message: string) => {},
  };

  const app = createApp({
    config: runtimeConfig,
    logger,
    startInfrastructure: async () => ({
      status: {
        database: 'connected',
      },
      services: {
        database: databaseConnection,
      },
      stop: async () => {
        events.push('stop:infrastructure');
      },
    }),
    startTelegram: async () => ({
      status: {
        bot: 'connected',
      },
      sendPrivateMessage: async () => {},
      stop: async () => {
        events.push('stop:telegram');
      },
    }),
  });

  await app.start();
  await app.stop();

  assert.deepEqual(events, ['stop:telegram', 'stop:infrastructure']);
});

test('createApp starts and stops schedule reminder worker with the app lifecycle', async () => {
  const events: string[] = [];
  const logger = {
    info: (_bindings: object, _message: string) => {},
  };

  const app = createApp({
    config: runtimeConfig,
    logger,
    startInfrastructure: async () => ({
      status: {
        database: 'connected',
      },
      services: {
        database: databaseConnection,
      },
      stop: async () => {
        events.push('stop:infrastructure');
      },
    }),
    startTelegram: async () => ({
      status: {
        bot: 'connected',
      },
      sendPrivateMessage: async () => {},
      stop: async () => {
        events.push('stop:telegram');
      },
    }),
    startScheduleReminders: () => ({
      start: async () => {
        events.push('start:reminders');
      },
      stop: async () => {
        events.push('stop:reminders');
      },
    }),
  });

  await app.start();
  await app.stop();

  assert.deepEqual(events, ['start:reminders', 'stop:reminders', 'stop:telegram', 'stop:infrastructure']);
});

test('createApp starts and stops role game recurrence worker with the app lifecycle', async () => {
  const events: string[] = [];
  const logger = {
    info: (_bindings: object, _message: string) => {},
  };

  const app = createApp({
    config: runtimeConfig,
    logger,
    startInfrastructure: async () => ({
      status: {
        database: 'connected',
      },
      services: {
        database: databaseConnection,
      },
      stop: async () => {
        events.push('stop:infrastructure');
      },
    }),
    startTelegram: async () => ({
      status: {
        bot: 'connected',
      },
      sendPrivateMessage: async () => {},
      stop: async () => {
        events.push('stop:telegram');
      },
    }),
    startScheduleReminders: () => ({
      start: async () => {
        events.push('start:reminders');
      },
      stop: async () => {
        events.push('stop:reminders');
      },
    }),
    startRoleGameRecurrences: () => ({
      start: async () => {
        events.push('start:role-game-recurrences');
      },
      stop: async () => {
        events.push('stop:role-game-recurrences');
      },
    }),
  });

  await app.start();
  await app.stop();

  assert.deepEqual(events, [
    'start:reminders',
    'start:role-game-recurrences',
    'stop:role-game-recurrences',
    'stop:reminders',
    'stop:telegram',
    'stop:infrastructure',
  ]);
});

test('createApp starts and stops the admin HTTP server with the app lifecycle', async () => {
  const events: string[] = [];
  const logger = {
    info: (_bindings: object, _message: string) => {},
  };

  const app = createApp({
    config: runtimeConfig,
    logger,
    startInfrastructure: async () => ({
      status: {
        database: 'connected',
      },
      services: {
        database: databaseConnection,
      },
      stop: async () => {
        events.push('stop:infrastructure');
      },
    }),
    startTelegram: async () => ({
      status: {
        bot: 'connected',
      },
      sendPrivateMessage: async () => {},
      stop: async () => {
        events.push('stop:telegram');
      },
    }),
    startScheduleReminders: () => ({
      start: async () => {},
      stop: async () => {
        events.push('stop:reminders');
      },
    }),
    startAdminHttpServer: () => ({
      start: async () => {
        events.push('start:http');
      },
      stop: async () => {
        events.push('stop:http');
      },
    }),
  });

  await app.start();
  await app.stop();

  assert.deepEqual(events, ['start:http', 'stop:http', 'stop:reminders', 'stop:telegram', 'stop:infrastructure']);
});

test('createApp surfaces telegram runtime failures to subscribers', async () => {
  const logger = {
    info: (_bindings: object, _message: string) => {},
  };
  let emitFatalRuntimeError: ((error: unknown) => void) | undefined;
  const receivedErrors: unknown[] = [];

  const app = createApp({
    config: runtimeConfig,
    logger,
    startInfrastructure: async () => ({
      status: {
        database: 'connected',
      },
      services: {
        database: databaseConnection,
      },
      stop: async () => {},
    }),
    startTelegram: async ({ onFatalRuntimeError }) => {
      emitFatalRuntimeError = onFatalRuntimeError;

      return {
        status: {
          bot: 'connected',
        },
        sendPrivateMessage: async () => {},
        stop: async () => {},
      };
    },
  });

  app.onFatalRuntimeError?.((error) => {
    receivedErrors.push(error);
  });

  await app.start();
  const error = new Error('polling failed');
  emitFatalRuntimeError?.(error);

  assert.deepEqual(receivedErrors, [error]);
});

test('createApp attempts infrastructure shutdown even when Telegram stop fails', async () => {
  const events: string[] = [];
  const logger = {
    info: (_bindings: object, _message: string) => {},
    error: (_bindings: object, _message: string) => {},
  };

  const app = createApp({
    config: runtimeConfig,
    logger,
    startInfrastructure: async () => ({
      status: {
        database: 'connected',
      },
      services: {
        database: databaseConnection,
      },
      stop: async () => {
        events.push('stop:infrastructure');
      },
    }),
    startTelegram: async () => ({
      status: {
        bot: 'connected',
      },
      sendPrivateMessage: async () => {},
      stop: async () => {
        events.push('stop:telegram');
        throw new Error('telegram stop failed');
      },
    }),
  });

  await app.start();

  await assert.rejects(() => app.stop(), /telegram stop failed/);
  assert.deepEqual(events, ['stop:telegram', 'stop:infrastructure']);
});

test('createApp stops Telegram if startup completes after stop was requested', async () => {
  const events: string[] = [];
  let resolveTelegramStartup: ((value: {
    status: { bot: 'connected' };
    sendPrivateMessage: () => Promise<void>;
    stop: () => Promise<void>;
  }) => void) | undefined;
  const logger = {
    info: (_bindings: object, _message: string) => {},
    error: (_bindings: object, _message: string) => {},
  };

  const app = createApp({
    config: runtimeConfig,
    logger,
    startInfrastructure: async () => ({
      status: {
        database: 'connected',
      },
      services: {
        database: databaseConnection,
      },
      stop: async () => {
        events.push('stop:infrastructure');
      },
    }),
    startTelegram: async () =>
      new Promise<{
        status: { bot: 'connected' };
        sendPrivateMessage: () => Promise<void>;
        stop: () => Promise<void>;
      }>((resolve) => {
        resolveTelegramStartup = resolve;
      }),
  });

  const startup = app.start();
  await new Promise((resolve) => setImmediate(resolve));

  await app.stop();
  resolveTelegramStartup?.({
    status: {
      bot: 'connected',
    },
    sendPrivateMessage: async () => {},
    stop: async () => {
      events.push('stop:telegram');
    },
  });

  await assert.rejects(() => startup, /Application startup interrupted/);
  assert.deepEqual(events, ['stop:infrastructure', 'stop:telegram']);
});
