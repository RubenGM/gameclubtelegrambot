import test from 'node:test';
import assert from 'node:assert/strict';

import { runMain } from './main-program.js';
import type { RuntimeConfig } from './config/runtime-config.js';

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
  database: {
    host: '127.0.0.1',
    port: 55432,
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
  featureFlags: {
    bootstrapWizard: true,
  },
};

test('runMain launches bootstrap on first run and then starts the service with the persisted config', async () => {
  const events: string[] = [];

  const exitCode = await runMain({
    logger: createLogger(events),
    resolveStartupState: async () => ({
      kind: 'fresh',
      message: 'fresh',
    }),
    runBootstrap: async () => runtimeConfig,
    runService: async ({ createApp }) => {
      assert.ok(createApp);
      const app = await createApp();
      await app.start();
      await app.stop();
      return 0;
    },
    createApp: ({ config }) => ({
      start: async () => {
        events.push(`app:start:${config.bot.publicName}`);
        return {};
      },
      stop: async () => {
        events.push('app:stop');
      },
    }),
    isInteractive: () => true,
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(events, ['info:Startup state requires bootstrap flow', 'app:start:Game Club Bot', 'app:stop']);
});

test('runMain aborts on first run without an interactive terminal', async () => {
  const events: string[] = [];

  const exitCode = await runMain({
    logger: createLogger(events),
    resolveStartupState: async () => ({
      kind: 'fresh',
      message: 'fresh',
    }),
    runBootstrap: async () => {
      throw new Error('should not bootstrap');
    },
    runService: async () => {
      throw new Error('should not start service');
    },
    createApp: () => ({
      start: async () => ({}),
      stop: async () => {},
    }),
    isInteractive: () => false,
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(events, ['fatal:Startup requires interactive bootstrap but no TTY is available']);
});

test('runMain aborts with an actionable message on ambiguous startup state', async () => {
  const events: string[] = [];

  const exitCode = await runMain({
    logger: createLogger(events),
    resolveStartupState: async () => ({
      kind: 'ambiguous',
      message: 'ambiguous state',
    }),
    runBootstrap: async () => {
      throw new Error('should not bootstrap');
    },
    runService: async () => {
      throw new Error('should not start service');
    },
    createApp: () => ({
      start: async () => ({}),
      stop: async () => {},
    }),
    isInteractive: () => true,
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(events, ['fatal:ambiguous state']);
});

function createLogger(events: string[]) {
  return {
    info: (_bindings: object, message: string) => {
      events.push(`info:${message}`);
    },
    fatal: (_bindings: object, message: string) => {
      events.push(`fatal:${message}`);
    },
    error: (_bindings: object, _message: string) => {},
  };
}
