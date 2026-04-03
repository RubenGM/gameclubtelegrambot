import test from 'node:test';
import assert from 'node:assert/strict';

import { applyMigrations } from './apply-migrations.js';

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
    password: 'admin-secret',
  },
  bootstrap: {
    firstAdmin: {
      telegramUserId: 123456789,
      displayName: 'Ruben Gonzalez',
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

test('applyMigrations runs migrations against the configured database and closes resources', async () => {
  const events: string[] = [];

  await applyMigrations({
    config: runtimeConfig,
    connectDatabase: async () => ({
      close: async () => {
        events.push('close');
      },
    }),
    runMigrations: async () => {
      events.push('migrate');
    },
  });

  assert.deepEqual(events, ['migrate', 'close']);
});

test('applyMigrations closes resources even when migration execution fails', async () => {
  const events: string[] = [];

  await assert.rejects(
    () =>
      applyMigrations({
        config: runtimeConfig,
        connectDatabase: async () => ({
          close: async () => {
            events.push('close');
          },
        }),
        runMigrations: async () => {
          events.push('migrate');
          throw new Error('migration failure');
        },
      }),
    /migration failure/,
  );

  assert.deepEqual(events, ['migrate', 'close']);
});
