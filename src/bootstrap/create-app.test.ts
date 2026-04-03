import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from './create-app.js';

test('createApp exposes clean startup boundaries before external integrations exist', async () => {
  const messages: string[] = [];
  const logger = {
    info: (_bindings: object, message: string) => {
      messages.push(message);
    },
  };

  const app = createApp({ logger });
  const status = await app.start();

  assert.equal(status.service, 'gameclubtelegrambot');
  assert.equal(status.infrastructure.database, 'not-configured');
  assert.equal(status.telegram.bot, 'not-configured');
  assert.equal(messages[0], 'Application started with stubbed integrations');
});
