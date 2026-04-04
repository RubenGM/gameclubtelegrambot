import test from 'node:test';
import assert from 'node:assert/strict';

import { bootstrapConfigCandidateSchema } from './wizard/bootstrap-config-candidate.js';
import { initializeSystemFromCandidate } from './initialize-system.js';

const validCandidate = bootstrapConfigCandidateSchema.parse({
  bot: {
    publicName: 'Game Club Bot',
    clubName: 'Game Club',
  },
  telegram: {
    token: 'telegram-secret-token',
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
    password: 'admin-secret',
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
});

test('initializeSystemFromCandidate writes hashed config and seeds the first approved admin', async () => {
  const events: string[] = [];
  let persistedConfig = '';

  const result = await initializeSystemFromCandidate({
    candidate: validCandidate,
    configPath: 'config/runtime.json',
    logger: {
      info: () => {},
      error: () => {},
    },
    hashSecret: async (value) => `hashed:${value}`,
    fileExists: async () => false,
    ensureParentDirectory: async (path) => {
      events.push(`mkdir:${path}`);
    },
    writeTempFile: async (_path, content) => {
      persistedConfig = content;
      events.push('write-temp');
      return 'config/runtime.json.tmp';
    },
    promoteTempFile: async (tempPath, finalPath) => {
      events.push(`promote:${tempPath}->${finalPath}`);
    },
    removeFile: async (path) => {
      events.push(`remove:${path}`);
    },
    initializeDatabase: async ({ persistedConfig }) => {
      events.push(`db-seed:${persistedConfig.adminElevation.passwordHash}`);
    },
  });

  assert.equal(result.config.adminElevation.passwordHash, 'hashed:admin-secret');
  assert.equal(result.config.bootstrap.firstAdmin.telegramUserId, 123456789);
  assert.equal(result.config.database.password, 'super-db-secret');
  assert.match(persistedConfig, /"passwordHash": "hashed:admin-secret"/);
  assert.doesNotMatch(persistedConfig, /"password": "admin-secret"/);
  assert.deepEqual(events, [
    'mkdir:config',
    'write-temp',
    'db-seed:hashed:admin-secret',
    'promote:config/runtime.json.tmp->config/runtime.json',
  ]);
});

test('initializeSystemFromCandidate removes temp config when database initialization fails', async () => {
  const events: string[] = [];

  await assert.rejects(
    () =>
      initializeSystemFromCandidate({
        candidate: validCandidate,
        configPath: 'config/runtime.json',
        logger: {
          info: () => {},
          error: () => {},
        },
        hashSecret: async (value) => `hashed:${value}`,
        fileExists: async () => false,
        ensureParentDirectory: async () => {},
        writeTempFile: async () => {
          events.push('write-temp');
          return 'config/runtime.json.tmp';
        },
        promoteTempFile: async () => {
          events.push('promote');
        },
        removeFile: async (path) => {
          events.push(`remove:${path}`);
        },
        initializeDatabase: async () => {
          throw new Error('seed failed');
        },
      }),
    /seed failed/,
  );

  assert.deepEqual(events, ['write-temp', 'remove:config/runtime.json.tmp']);
});

test('initializeSystemFromCandidate compensates database state if final config promotion fails', async () => {
  const events: string[] = [];

  await assert.rejects(
    () =>
      initializeSystemFromCandidate({
        candidate: validCandidate,
        configPath: 'config/runtime.json',
        logger: {
          info: () => {},
          error: () => {},
        },
        hashSecret: async (value) => `hashed:${value}`,
        fileExists: async () => false,
        ensureParentDirectory: async () => {},
        writeTempFile: async () => 'config/runtime.json.tmp',
        promoteTempFile: async () => {
          throw new Error('rename failed');
        },
        removeFile: async (path) => {
          events.push(`remove:${path}`);
        },
        initializeDatabase: async () => {
          events.push('db-seed');
        },
        rollbackDatabaseInitialization: async () => {
          events.push('db-rollback');
        },
      }),
    /rename failed/,
  );

  assert.deepEqual(events, ['db-seed', 'db-rollback', 'remove:config/runtime.json.tmp']);
});

test('initializeSystemFromCandidate rejects reruns when the target config file already exists', async () => {
  await assert.rejects(
    () =>
      initializeSystemFromCandidate({
        candidate: validCandidate,
        configPath: 'config/runtime.json',
        logger: {
          info: () => {},
          error: () => {},
        },
        hashSecret: async (value) => `hashed:${value}`,
        fileExists: async () => true,
        ensureParentDirectory: async () => {},
        writeTempFile: async () => {
          throw new Error('should not write temp file');
        },
        promoteTempFile: async () => {},
        removeFile: async () => {},
        initializeDatabase: async () => {},
      }),
    /already exists/,
  );
});
