import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bootstrapInitializationMarkerKey,
  ensureBootstrapDatabaseInitialization,
  initializeBootstrapDatabase,
  inspectBootstrapDatabaseState,
  rollbackBootstrapDatabaseInitialization,
} from './bootstrap-database.js';
import type { RuntimeConfig } from '../config/runtime-config.js';

const persistedConfig: RuntimeConfig = {
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
    password: 'super-db-secret',
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
        hasApprovedAdmin: async () => false,
        insertFirstApprovedAdmin: async (input: {
          telegramUserId: number;
          username?: string | undefined;
          displayName: string;
        }) => {
          events.push(`insert-admin:${input.telegramUserId}:${input.username}`);
        },
        setInitializationMarker: async (input) => {
          events.push(`set-marker:${input.firstAdminTelegramUserId}`);
        },
        clearInitializationMarker: async () => {},
        deleteFirstAdminByTelegramUserId: async () => {},
      });
      events.push('transaction:commit');
    },
  });

  assert.deepEqual(events, [
    'migrate',
    'transaction:start',
    'insert-admin:123456789:club_admin',
    'set-marker:123456789',
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
              hasApprovedAdmin: async () => false,
              insertFirstApprovedAdmin: async () => {
                throw new Error('should not insert');
              },
              setInitializationMarker: async () => {},
              clearInitializationMarker: async () => {},
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
        hasApprovedAdmin: async () => false,
        insertFirstApprovedAdmin: async () => {},
        setInitializationMarker: async () => {},
        clearInitializationMarker: async () => {
          events.push('clear-marker');
        },
        deleteFirstAdminByTelegramUserId: async (telegramUserId: number) => {
          events.push(`delete-admin:${telegramUserId}`);
        },
      });
    },
  });

  assert.deepEqual(events, ['clear-marker', 'delete-admin:123456789', 'close']);
});

test('inspectBootstrapDatabaseState reads the initialization marker and first admin state', async () => {
  const events: string[] = [];

  const state = await inspectBootstrapDatabaseState({
    persistedConfig,
    connectDatabase: async () => ({
      db: {
        select: (selection: Record<string, unknown>) => ({
          from: (table: { [key: string]: unknown }) => ({
            where: async () => {
              if (table === undefined) {
                throw new Error('unexpected table');
              }

              if ('value' in selection) {
                events.push('select:marker');
                return [{ value: JSON.stringify({ firstAdminTelegramUserId: 123456789 }) }];
              }

              if ('count' in selection) {
                events.push('select:approved-count');
                return [{ count: 1 }];
              }

              events.push('select:first-admin');
              return [{ telegramUserId: 123456789 }];
            },
          }),
        }),
      } as never,
      close: async () => {
        events.push('close');
      },
    }),
  });

  assert.equal(state.marker?.firstAdminTelegramUserId, 123456789);
  assert.equal(state.firstAdminExists, true);
  assert.equal(state.approvedAdminCount, 1);
  assert.deepEqual(events, ['select:marker', 'select:approved-count', 'select:first-admin', 'close']);
});

test('ensureBootstrapDatabaseInitialization initializes a fresh database', async () => {
  const events: string[] = [];

  const outcome = await ensureBootstrapDatabaseInitialization({
    persistedConfig,
    inspectState: async () => ({
      marker: null,
      firstAdminExists: false,
      approvedAdminCount: 0,
    }),
    initializeDatabase: async () => {
      events.push('initialize');
    },
    repairMarker: async () => {
      events.push('repair');
    },
  });

  assert.equal(outcome, 'initialized');
  assert.deepEqual(events, ['initialize']);
});

test('ensureBootstrapDatabaseInitialization repairs a missing marker when first admin already exists', async () => {
  const events: string[] = [];

  const outcome = await ensureBootstrapDatabaseInitialization({
    persistedConfig,
    inspectState: async () => ({
      marker: null,
      firstAdminExists: true,
      approvedAdminCount: 1,
    }),
    initializeDatabase: async () => {
      events.push('initialize');
    },
    repairMarker: async () => {
      events.push('repair');
    },
  });

  assert.equal(outcome, 'repaired-marker');
  assert.deepEqual(events, ['repair']);
});

test('ensureBootstrapDatabaseInitialization is a no-op when database is already initialized', async () => {
  const events: string[] = [];

  const outcome = await ensureBootstrapDatabaseInitialization({
    persistedConfig,
    inspectState: async () => ({
      marker: {
        firstAdminTelegramUserId: persistedConfig.bootstrap.firstAdmin.telegramUserId,
      },
      firstAdminExists: true,
      approvedAdminCount: 1,
    }),
    initializeDatabase: async () => {
      events.push('initialize');
    },
    repairMarker: async () => {
      events.push('repair');
    },
  });

  assert.equal(outcome, 'already-initialized');
  assert.deepEqual(events, []);
});
