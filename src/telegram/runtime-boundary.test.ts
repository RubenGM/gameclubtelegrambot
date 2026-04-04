import test from 'node:test';
import assert from 'node:assert/strict';

import { createTelegramBoundary, TelegramStartupError } from './runtime-boundary.js';

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

  const telegram = await createTelegramBoundary({
    config: runtimeConfig,
    logger: {
      info: () => {},
      error: () => {},
    },
    createBot: ({ token }) => {
      events.push(`token:${token}`);

      return {
        onStartCommand: (handler) => {
          events.push('register:/start');
          void handler({
            reply: async (message: string) => {
              events.push(`reply:${message}`);
            },
          });
        },
        startPolling: async () => {
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
    'register:/start',
    'reply:Game Club Bot online. Escriu /start per comprovar que la connexio amb Telegram funciona.',
    'start-polling',
    'stop-polling',
  ]);
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
        createBot: () => ({
          onStartCommand: () => {},
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
