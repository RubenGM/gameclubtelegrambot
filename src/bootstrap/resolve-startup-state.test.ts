import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveStartupState } from './resolve-startup-state.js';
import { RuntimeConfigError } from '../config/load-runtime-config.js';
import type { RuntimeConfig } from '../config/runtime-config.js';

const runtimeConfig: RuntimeConfig = {
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
  },
};

test('resolveStartupState returns fresh when no runtime config or temp file exists', async () => {
  const state = await resolveStartupState({
    env: {},
    fileExists: async () => false,
    loadRuntimeConfig: async () => {
      throw new Error('should not load runtime config');
    },
    inspectInitializationState: async () => {
      throw new Error('should not inspect initialization state');
    },
  });

  assert.equal(state.kind, 'fresh');
  assert.match(state.message, /No s ha trobat cap configuracio runtime/);
});

test('resolveStartupState returns ambiguous when a leftover temp config exists', async () => {
  const state = await resolveStartupState({
    env: {},
    fileExists: async (path) => path === 'config/runtime.json.tmp',
    loadRuntimeConfig: async () => {
      throw new Error('should not load runtime config');
    },
    inspectInitializationState: async () => {
      throw new Error('should not inspect initialization state');
    },
  });

  assert.equal(state.kind, 'ambiguous');
  assert.match(state.message, /fitxer temporal de bootstrap/);
});

test('resolveStartupState returns ambiguous when runtime config exists but is invalid', async () => {
  const state = await resolveStartupState({
    env: {},
    fileExists: async (path) => path === 'config/runtime.json',
    loadRuntimeConfig: async () => {
      throw new RuntimeConfigError('invalid runtime config');
    },
    inspectInitializationState: async () => {
      throw new Error('should not inspect initialization state');
    },
  });

  assert.equal(state.kind, 'ambiguous');
  assert.match(state.message, /configuracio runtime existent no es valida/);
});

test('resolveStartupState returns initialized when durable marker and first admin are consistent', async () => {
  const state = await resolveStartupState({
    env: {},
    fileExists: async (path) => path === 'config/runtime.json',
    loadRuntimeConfig: async () => runtimeConfig,
    inspectInitializationState: async () => ({
      marker: {
        firstAdminTelegramUserId: 123456789,
      },
      firstAdminExists: true,
      approvedAdminCount: 1,
    }),
  });

  assert.equal(state.kind, 'initialized');
  assert.equal(state.config, runtimeConfig);
});

test('resolveStartupState returns ambiguous when config exists but marker is missing', async () => {
  const state = await resolveStartupState({
    env: {},
    fileExists: async (path) => path === 'config/runtime.json',
    loadRuntimeConfig: async () => runtimeConfig,
    inspectInitializationState: async () => ({
      marker: null,
      firstAdminExists: true,
      approvedAdminCount: 1,
    }),
  });

  assert.equal(state.kind, 'ambiguous');
  assert.match(state.message, /marcador durable d inicialitzacio/);
});
