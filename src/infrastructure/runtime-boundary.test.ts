import test from 'node:test';
import assert from 'node:assert/strict';

import { createInfrastructureBoundary, InfrastructureStartupError } from './runtime-boundary.js';

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

test('createInfrastructureBoundary reports a connected database when startup succeeds', async () => {
  let seenConnectionString = '';
  let closeCalls = 0;
  const databaseConnection = {
    pool: undefined as never,
    db: undefined as never,
    close: async () => {
      closeCalls += 1;
    },
  };

  const infrastructure = await createInfrastructureBoundary({
    config: runtimeConfig,
    logger: {
      info: () => {},
      error: () => {},
    },
    connectDatabase: async ({ connectionString }) => {
      seenConnectionString = connectionString;

      return databaseConnection;
    },
  });

  assert.equal(infrastructure.status.database, 'connected');
  assert.equal(infrastructure.services.database, databaseConnection);
  assert.match(seenConnectionString, /^postgresql:\/\//);
  assert.match(seenConnectionString, /localhost:5432/);

  await infrastructure.stop();
  assert.equal(closeCalls, 1);
});

test('createInfrastructureBoundary throws a predictable error when database startup fails', async () => {
  await assert.rejects(
    () =>
      createInfrastructureBoundary({
        config: runtimeConfig,
        logger: {
          info: () => {},
          error: () => {},
        },
        connectDatabase: async () => {
          throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
        },
      }),
    (error: unknown) => {
      assert.equal(error instanceof InfrastructureStartupError, true);
      assert.match(
        error instanceof Error ? error.message : '',
        /Database connection failed: connect ECONNREFUSED 127\.0\.0\.1:5432/,
      );
      return true;
    },
  );
});
