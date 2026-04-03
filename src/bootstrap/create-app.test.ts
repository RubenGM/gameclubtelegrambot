import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from './create-app.js';

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
  featureFlags: {
    bootstrapWizard: true,
  },
} as const;

test('createApp exposes clean startup boundaries before external integrations exist', async () => {
  const messages: string[] = [];
  const logger = {
    info: (_bindings: object, message: string) => {
      messages.push(message);
    },
  };

  const app = createApp({ config: runtimeConfig, logger });
  const status = await app.start();

  assert.equal(status.service, 'gameclubtelegrambot');
  assert.equal(status.infrastructure.database, 'not-configured');
  assert.equal(status.telegram.bot, 'not-configured');
  assert.equal(messages[0], 'Application started with validated runtime configuration');
});
