import test from 'node:test';
import assert from 'node:assert/strict';

import { formatDatabaseRuntimeConfig } from './database-runtime-config.js';

test('formatDatabaseRuntimeConfig prints validated database settings in shell-friendly order', async () => {
  const output = formatDatabaseRuntimeConfig({
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
    featureFlags: {
      bootstrapWizard: true,
    },
  });

  assert.equal(output, '127.0.0.1\n55432\ngameclub\ngameclub_user\nsecret-password\n');
});
