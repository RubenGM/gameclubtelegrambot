import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from './create-app.js';
import { InfrastructureStartupError } from '../infrastructure/runtime-boundary.js';
import { TelegramStartupError } from '../telegram/runtime-boundary.js';

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

  const app = createApp({
    config: runtimeConfig,
    logger,
    startInfrastructure: async () => ({
      database: 'connected',
    }),
    startTelegram: async () => ({
      bot: 'connected',
    }),
  });
  const status = await app.start();

  assert.equal(status.service, 'gameclubtelegrambot');
  assert.equal(status.infrastructure.database, 'connected');
  assert.equal(status.telegram.bot, 'connected');
  assert.equal(messages[0], 'Application started with validated runtime configuration');
});

test('createApp propagates predictable infrastructure startup failures', async () => {
  const logger = {
    info: (_bindings: object, _message: string) => {
      assert.fail('logger.info should not be called when startup fails');
    },
  };

  const app = createApp({
    config: runtimeConfig,
    logger,
    startInfrastructure: async () => {
      throw new InfrastructureStartupError('Database connection failed: connect ECONNREFUSED');
    },
  });

  await assert.rejects(
    () => app.start(),
    (error: unknown) => {
      assert.equal(error instanceof InfrastructureStartupError, true);
      assert.match(
        error instanceof Error ? error.message : '',
        /Database connection failed: connect ECONNREFUSED/,
      );
      return true;
    },
  );
});

test('createApp propagates predictable Telegram startup failures', async () => {
  const logger = {
    info: (_bindings: object, _message: string) => {
      assert.fail('logger.info should not be called when startup fails');
    },
  };

  const app = createApp({
    config: runtimeConfig,
    logger,
    startInfrastructure: async () => ({
      database: 'connected',
    }),
    startTelegram: async () => {
      throw new TelegramStartupError('Telegram startup failed: Unauthorized');
    },
  });

  await assert.rejects(
    () => app.start(),
    (error: unknown) => {
      assert.equal(error instanceof TelegramStartupError, true);
      assert.match(error instanceof Error ? error.message : '', /Telegram startup failed: Unauthorized/);
      return true;
    },
  );
});
