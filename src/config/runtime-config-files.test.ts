import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseEnvFile,
  resolveRuntimeConfigPaths,
  serializeEnvFile,
  splitRuntimeConfigForPersistence,
} from './runtime-config-files.js';

test('resolveRuntimeConfigPaths derives the env file beside the config file', () => {
  const paths = resolveRuntimeConfigPaths({
    GAMECLUB_CONFIG_PATH: '/etc/gameclubtelegrambot/runtime.json',
  });

  assert.equal(paths.configPath, '/etc/gameclubtelegrambot/runtime.json');
  assert.equal(paths.envPath, '/etc/gameclubtelegrambot/.env');
});

test('parseEnvFile reads quoted and unquoted values', () => {
  const env = parseEnvFile([
    '# comment',
    'GAMECLUB_TELEGRAM_TOKEN="token-with-#-hash"',
    'GAMECLUB_DATABASE_PASSWORD=plain-value',
    "export GAMECLUB_ADMIN_PASSWORD_HASH='hash:value'",
  ].join('\n'));

  assert.equal(env.GAMECLUB_TELEGRAM_TOKEN, 'token-with-#-hash');
  assert.equal(env.GAMECLUB_DATABASE_PASSWORD, 'plain-value');
  assert.equal(env.GAMECLUB_ADMIN_PASSWORD_HASH, 'hash:value');
});

test('serializeEnvFile preserves unrelated lines and updates managed entries', () => {
  const output = serializeEnvFile([
    '# service env',
    'NODE_ENV=production',
    'GAMECLUB_TELEGRAM_TOKEN="old"',
  ].join('\n'), {
    GAMECLUB_TELEGRAM_TOKEN: 'new-token',
    GAMECLUB_DATABASE_PASSWORD: 'new-password',
  });

  assert.match(output, /# service env/);
  assert.match(output, /NODE_ENV=production/);
  assert.match(output, /GAMECLUB_TELEGRAM_TOKEN="new-token"/);
  assert.match(output, /GAMECLUB_DATABASE_PASSWORD="new-password"/);
});

test('splitRuntimeConfigForPersistence removes secret values from the JSON payload', () => {
  const payload = splitRuntimeConfigForPersistence({
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
      password: 'db-password',
      ssl: false,
    },
    adminElevation: {
      passwordHash: 'hash',
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
  });

  assert.equal(payload.jsonConfig.telegram, undefined);
  const databaseConfig = payload.jsonConfig.database as Record<string, unknown> | undefined;
  assert.equal(databaseConfig?.password, undefined);
  assert.equal(payload.jsonConfig.adminElevation, undefined);
  assert.equal(payload.envValues.GAMECLUB_TELEGRAM_TOKEN, 'telegram-token');
  assert.equal(payload.envValues.GAMECLUB_DATABASE_PASSWORD, 'db-password');
  assert.equal(payload.envValues.GAMECLUB_ADMIN_PASSWORD_HASH, 'hash');
});

test('splitRuntimeConfigForPersistence preserves unrelated existing JSON keys', () => {
  const payload = splitRuntimeConfigForPersistence(
    {
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
        password: 'db-password',
        ssl: false,
      },
      adminElevation: {
        passwordHash: 'hash',
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
    },
    {
      legacyBlock: {
        keepMe: true,
      },
      bot: {
        legacyLabel: 'keep',
      },
      telegram: {
        token: 'old-token',
      },
    },
  );

  const botConfig = payload.jsonConfig.bot as Record<string, unknown>;
  assert.equal((payload.jsonConfig.legacyBlock as Record<string, unknown>).keepMe, true);
  assert.equal(botConfig.legacyLabel, 'keep');
  assert.equal(payload.jsonConfig.telegram, undefined);
});
