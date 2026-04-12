import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRuntimeConfig } from './load-runtime-config.js';

const validConfigJson = JSON.stringify({
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
  featureFlags: {
    bootstrapWizard: true,
    newsGroups: false,
  },
});

test('loadRuntimeConfig returns typed configuration from the configured JSON file', async () => {
  const config = await loadRuntimeConfig({
    env: {
      GAMECLUB_CONFIG_PATH: '/etc/gameclub/config.json',
    },
    readConfigFile: async (filePath) => {
      assert.equal(filePath, '/etc/gameclub/config.json');
      return validConfigJson;
    },
  });

  assert.equal(config.bot.publicName, 'Game Club Bot');
  assert.equal(config.telegram.token, 'telegram-token');
  assert.equal(config.bot.language, 'ca');
  assert.equal(config.database.port, 5432);
  assert.equal(config.bootstrap.firstAdmin.telegramUserId, 123456789);
  assert.equal(config.notifications.defaults.eventReminderLeadHours, 24);
  assert.equal(config.featureFlags.bootstrapWizard, true);
});

test('loadRuntimeConfig merges secret values from the sibling .env file', async () => {
  const config = await loadRuntimeConfig({
    env: {
      GAMECLUB_CONFIG_PATH: '/etc/gameclub/config.json',
    },
    readConfigFile: async (filePath) => {
      assert.equal(filePath, '/etc/gameclub/config.json');
      return JSON.stringify({
        schemaVersion: 1,
        bot: {
          publicName: 'Game Club Bot',
          clubName: 'Game Club',
        },
        database: {
          host: 'localhost',
          port: 5432,
          name: 'gameclub',
          user: 'gameclub_user',
          ssl: false,
        },
        bootstrap: {
          firstAdmin: {
            telegramUserId: 123456789,
            displayName: 'Club Administrator',
          },
        },
      });
    },
    readEnvFile: async (filePath) => {
      assert.equal(filePath, '/etc/gameclub/.env');
      return [
        'GAMECLUB_TELEGRAM_TOKEN="env-telegram-token"',
        'GAMECLUB_DATABASE_PASSWORD="env-db-password"',
        'GAMECLUB_ADMIN_PASSWORD_HASH="env-admin-hash"',
        'GAMECLUB_BGG_API_KEY="env-bgg-key"',
      ].join('\n');
    },
  });

  assert.equal(config.telegram.token, 'env-telegram-token');
  assert.equal(config.database.password, 'env-db-password');
  assert.equal(config.adminElevation.passwordHash, 'env-admin-hash');
  assert.equal(config.bgg?.apiKey, 'env-bgg-key');
});

test('loadRuntimeConfig prefers process env over values from the .env file', async () => {
  const config = await loadRuntimeConfig({
    env: {
      GAMECLUB_CONFIG_PATH: '/etc/gameclub/config.json',
      GAMECLUB_TELEGRAM_TOKEN: 'process-env-token',
    },
    readConfigFile: async () =>
      JSON.stringify({
        bot: {
          publicName: 'Game Club Bot',
          clubName: 'Game Club',
        },
        database: {
          host: 'localhost',
          port: 5432,
          name: 'gameclub',
          user: 'gameclub_user',
          ssl: false,
        },
        bootstrap: {
          firstAdmin: {
            telegramUserId: 123456789,
            displayName: 'Club Administrator',
          },
        },
      }),
    readEnvFile: async () => [
      'GAMECLUB_TELEGRAM_TOKEN="env-file-token"',
      'GAMECLUB_DATABASE_PASSWORD="env-db-password"',
      'GAMECLUB_ADMIN_PASSWORD_HASH="env-admin-hash"',
    ].join('\n'),
  });

  assert.equal(config.telegram.token, 'process-env-token');
  assert.equal(config.database.password, 'env-db-password');
  assert.equal(config.adminElevation.passwordHash, 'env-admin-hash');
});

test('loadRuntimeConfig applies defaults for schema version, notification defaults and feature flags', async () => {
  const config = await loadRuntimeConfig({
    readConfigFile: async () =>
      JSON.stringify({
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
      }),
  });

  assert.equal(config.schemaVersion, 1);
  assert.equal(config.notifications.defaults.groupAnnouncementsEnabled, true);
  assert.equal(config.notifications.defaults.eventRemindersEnabled, true);
  assert.equal(config.notifications.defaults.eventReminderLeadHours, 24);
  assert.equal(config.bot.language, 'ca');
  assert.deepEqual(config.featureFlags, {});
});

test('loadRuntimeConfig fails with an operator-friendly error when the file is missing', async () => {
  await assert.rejects(
    () =>
      loadRuntimeConfig({
        env: {
          GAMECLUB_CONFIG_PATH: '/missing/config.json',
        },
        readConfigFile: async () => {
          throw new Error('ENOENT: no such file or directory');
        },
      }),
    (error: unknown) => {
      assert.match(
        error instanceof Error ? error.message : '',
        /Could not read runtime configuration file \/missing\/config\.json/,
      );
      return true;
    },
  );
});

test('loadRuntimeConfig fails with a clear error when the JSON payload is malformed', async () => {
  await assert.rejects(
    () =>
      loadRuntimeConfig({
        env: {
          GAMECLUB_CONFIG_PATH: '/etc/gameclub/config.json',
        },
        readConfigFile: async () => '{not-json}',
      }),
    (error: unknown) => {
      assert.match(
        error instanceof Error ? error.message : '',
        /contains invalid JSON/,
      );
      return true;
    },
  );
});

test('loadRuntimeConfig fails when required configuration fields are invalid', async () => {
  await assert.rejects(
    () =>
      loadRuntimeConfig({
        env: {
          GAMECLUB_CONFIG_PATH: '/etc/gameclub/config.json',
        },
        readConfigFile: async () =>
          JSON.stringify({
            bot: {
              publicName: '',
              clubName: 'Game Club',
            },
            telegram: {
              token: '',
            },
            database: {
              host: 'localhost',
              port: 70000,
              name: 'gameclub',
              user: 'gameclub_user',
              password: '',
              ssl: false,
            },
            adminElevation: {
              passwordHash: '',
            },
            bootstrap: {
              firstAdmin: {
                telegramUserId: 0,
                displayName: '',
              },
            },
            notifications: {
              defaults: {
                eventReminderLeadHours: 500,
              },
            },
            featureFlags: {},
          }),
      }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : '';
      assert.match(message, /Runtime configuration validation failed/);
      assert.match(message, /bot\.publicName/);
      assert.match(message, /telegram\.token/);
      assert.match(message, /database\.port/);
      assert.match(message, /adminElevation\.passwordHash/);
      assert.match(message, /bootstrap\.firstAdmin\.telegramUserId/);
      assert.match(message, /bootstrap\.firstAdmin\.displayName/);
      assert.match(message, /notifications\.defaults\.eventReminderLeadHours/);
      return true;
    },
  );
});

test('loadRuntimeConfig fails when a required secret is missing from both env sources and JSON', async () => {
  await assert.rejects(
    () =>
      loadRuntimeConfig({
        env: {
          GAMECLUB_CONFIG_PATH: '/etc/gameclub/config.json',
        },
        readConfigFile: async () =>
          JSON.stringify({
            bot: {
              publicName: 'Game Club Bot',
              clubName: 'Game Club',
            },
            telegram: {},
            database: {
              host: 'localhost',
              port: 5432,
              name: 'gameclub',
              user: 'gameclub_user',
              ssl: false,
            },
            adminElevation: {},
            bootstrap: {
              firstAdmin: {
                telegramUserId: 123456789,
                displayName: 'Club Administrator',
              },
            },
          }),
        readEnvFile: async () => '',
      }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : '';
      assert.match(message, /Runtime configuration validation failed/);
      assert.match(message, /telegram\.token/);
      assert.match(message, /database\.password/);
      assert.match(message, /adminElevation\.passwordHash/);
      return true;
    },
  );
});
