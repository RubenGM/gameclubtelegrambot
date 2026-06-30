import test from 'node:test';
import assert from 'node:assert/strict';

import type { RuntimeConfig } from '../config/runtime-config.js';

import {
  formatTelegramLocalBotApiRuntimeConfig,
  resolveTelegramLocalBotApiServiceConfig,
} from './telegram-local-bot-api-runtime-config.js';

const baseConfig: RuntimeConfig = {
  schemaVersion: 1,
  bot: {
    publicName: 'Game Club Bot',
    clubName: 'Game Club',
    language: 'es',
  },
  telegram: {
    token: 'telegram-token',
  },
  database: {
    host: '127.0.0.1',
    port: 55432,
    name: 'gameclub',
    user: 'gameclub_user',
    password: 'secret-password',
    ssl: false,
  },
  adminElevation: {
    passwordHash: 'hash',
  },
  bootstrap: {
    firstAdmin: {
      telegramUserId: 1,
      username: 'club_admin',
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

test('formatTelegramLocalBotApiRuntimeConfig prints disabled defaults as sourceable env', () => {
  const output = formatTelegramLocalBotApiRuntimeConfig(baseConfig);

  assert.equal(
    output,
    [
      "GAMECLUB_TELEGRAM_LOCAL_BOT_API_ENABLED='false'",
      "GAMECLUB_TELEGRAM_LOCAL_BOT_API_BASE_URL='http://127.0.0.1:8081'",
      "GAMECLUB_TELEGRAM_LOCAL_BOT_API_HOST='127.0.0.1'",
      "GAMECLUB_TELEGRAM_LOCAL_BOT_API_PORT='8081'",
      "GAMECLUB_TELEGRAM_LOCAL_BOT_API_DATA_DIR='/var/lib/gameclubtelegrambot/telegram-bot-api'",
      "GAMECLUB_TELEGRAM_LOCAL_BOT_API_TEMP_DIR='/var/lib/gameclubtelegrambot/telegram-bot-api/tmp'",
      '',
    ].join('\n'),
  );
});

test('resolveTelegramLocalBotApiServiceConfig derives bind settings from the configured base URL', () => {
  const config = resolveTelegramLocalBotApiServiceConfig({
    ...baseConfig,
    telegram: {
      token: 'telegram-token',
      localBotApi: {
        enabled: true,
        baseUrl: 'http://localhost:9090',
        apiId: 123456,
        apiHash: 'api-hash',
        dataDir: "/srv/game club/telegram's files",
      },
    },
  });

  assert.deepEqual(config, {
    enabled: true,
    baseUrl: 'http://localhost:9090',
    host: '127.0.0.1',
    port: 9090,
    dataDir: "/srv/game club/telegram's files",
    tempDir: "/srv/game club/telegram's files/tmp",
  });
});

test('formatTelegramLocalBotApiRuntimeConfig shell-quotes configured paths', () => {
  const output = formatTelegramLocalBotApiRuntimeConfig({
    ...baseConfig,
    telegram: {
      token: 'telegram-token',
      localBotApi: {
        enabled: true,
        baseUrl: 'http://localhost:9090',
        apiId: 123456,
        apiHash: 'api-hash',
        dataDir: "/srv/game club/telegram's files",
      },
    },
  });

  assert.match(output, /GAMECLUB_TELEGRAM_LOCAL_BOT_API_ENABLED='true'/);
  assert.match(output, /GAMECLUB_TELEGRAM_LOCAL_BOT_API_DATA_DIR='\/srv\/game club\/telegram'\\''s files'/);
});

test('resolveTelegramLocalBotApiServiceConfig rejects enabled public URLs', () => {
  assert.throws(
    () =>
      resolveTelegramLocalBotApiServiceConfig({
        ...baseConfig,
        telegram: {
          token: 'telegram-token',
          localBotApi: {
            enabled: true,
            baseUrl: 'http://0.0.0.0:8081',
            apiId: 123456,
            apiHash: 'api-hash',
            dataDir: '/var/lib/gameclubtelegrambot/telegram-bot-api',
          },
        },
      }),
    /localhost or another loopback address/,
  );
});
