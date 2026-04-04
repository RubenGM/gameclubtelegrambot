import test from 'node:test';
import assert from 'node:assert/strict';

import { initializeBootstrapDatabase, rollbackBootstrapDatabaseInitialization } from './bootstrap-database.js';
import type { RuntimeConfig } from '../config/runtime-config.js';

const persistedConfig: RuntimeConfig = {
  schemaVersion: 1,
  bot: {
    publicName: 'Game Club Bot',
    clubName: 'Game Club',
  },
  telegram: {
    token: 'telegram-token',
  },
  database: {
    host: '127.0.0.1',
    port: 55432,
    name: 'gameclub',
    user: 'gameclub_user',
    password: 'super-db-secret',
    ssl: false,
  },
  adminElevation: {
    passwordHash: 'hashed:admin-secret',
  },
  bootstrap: {
    firstAdmin: {
      telegramUserId: 123456789,
      username: 'rubengm',
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
  featureFlags: {
    bootstrapWizard: true,
  },
};

test('initializeBootstrapDatabase migrates and inserts the first approved admin exactly once', async () => {
  const events: string[] = [];

  await initializeBootstrapDatabase({
    persistedConfig,
    connectDatabase: async () => ({
      close: async () => {
        events.push('close');
      },
    }),
    runMigrations: async () => {
      events.push('migrate');
    },
    runInTransaction: async (_connection, handler) => {
      events.push('transaction:start');
      await handler({
        countExistingApprovedAdmins: async () => 0,
        insertFirstApprovedAdmin: async (input: {
          telegramUserId: number;
          username?: string | undefined;
          displayName: string;
        }) => {
          events.push(`insert-admin:${input.telegramUserId}:${input.username}`);
        },
        deleteFirstAdminByTelegramUserId: async () => {},
      });
      events.push('transaction:commit');
    },
  });

  assert.deepEqual(events, [
    'migrate',
    'transaction:start',
    'insert-admin:123456789:rubengm',
    'transaction:commit',
    'close',
  ]);
});

test('initializeBootstrapDatabase rejects reruns when an approved admin already exists', async () => {
  await assert.rejects(
    () =>
      initializeBootstrapDatabase({
        persistedConfig,
        connectDatabase: async () => ({
          close: async () => {},
        }),
        runMigrations: async () => {},
        runInTransaction: async (_connection, handler) => {
          await handler({
            countExistingApprovedAdmins: async () => 1,
            insertFirstApprovedAdmin: async () => {
              throw new Error('should not insert');
            },
            deleteFirstAdminByTelegramUserId: async () => {},
          });
        },
      }),
    /already contains an approved administrator/,
  );
});

test('rollbackBootstrapDatabaseInitialization deletes the seeded first admin', async () => {
  const events: string[] = [];

  await rollbackBootstrapDatabaseInitialization({
    persistedConfig,
    connectDatabase: async () => ({
      close: async () => {
        events.push('close');
      },
    }),
    runInTransaction: async (_connection, handler) => {
      await handler({
        countExistingApprovedAdmins: async () => 0,
        insertFirstApprovedAdmin: async () => {},
        deleteFirstAdminByTelegramUserId: async (telegramUserId: number) => {
          events.push(`delete-admin:${telegramUserId}`);
        },
      });
    },
  });

  assert.deepEqual(events, ['delete-admin:123456789', 'close']);
});
