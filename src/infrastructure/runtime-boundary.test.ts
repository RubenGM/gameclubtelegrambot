import test from 'node:test';
import assert from 'node:assert/strict';

import { createInfrastructureBoundary, InfrastructureStartupError } from './runtime-boundary.js';

const runtimeConfig = {
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
  featureFlags: {},
} as const;

test('createInfrastructureBoundary reports a connected database when startup succeeds', async () => {
  let seenConnectionString = '';

  const status = await createInfrastructureBoundary({
    config: runtimeConfig,
    logger: {
      info: () => {},
      error: () => {},
    },
    connectDatabase: async ({ connectionString }) => {
      seenConnectionString = connectionString;
    },
  });

  assert.equal(status.database, 'connected');
  assert.match(seenConnectionString, /^postgresql:\/\//);
  assert.match(seenConnectionString, /localhost:5432/);
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
