import test from 'node:test';
import assert from 'node:assert/strict';

import { runBootstrapFlow } from './run-bootstrap-flow.js';
import { BootstrapInitializationError } from './initialize-system.js';

test('runBootstrapFlow blocks when the system already looks initialized', async () => {
  await assert.rejects(
    () =>
      runBootstrapFlow({
        logger: {
          info: () => {},
        },
        resolveStartupState: async () => ({
          kind: 'initialized',
          message: 'initialized',
          config: {
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
          },
        }),
        createIo: () => ({
          prompt: async () => {
            throw new Error('should not prompt');
          },
          confirm: async () => {
            throw new Error('should not confirm');
          },
          writeLine: () => {},
        }),
      }),
    (error: unknown) => {
      assert.equal(error instanceof BootstrapInitializationError, true);
      assert.match(error instanceof Error ? error.message : '', /ja esta inicialitzat/);
      return true;
    },
  );
});
