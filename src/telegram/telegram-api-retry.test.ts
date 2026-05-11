import test from 'node:test';
import assert from 'node:assert/strict';

import { withTelegramApiRetry } from './telegram-api-retry.js';

test('withTelegramApiRetry retries transient network failures', async () => {
  const sleeps: number[] = [];
  const logs: Array<{ bindings: object; message: string }> = [];
  const events: string[] = [];
  let attempts = 0;

  const result = await withTelegramApiRetry(
    {
      operation: 'reply',
      logger: {
        info: (bindings, message) => logs.push({ bindings, message }),
        error: () => {},
      },
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
      onRetryableFailure: ({ operation, attempt }) => {
        events.push(`failure:${operation}:${attempt}`);
      },
      onSuccess: ({ operation, attempt }) => {
        events.push(`success:${operation}:${attempt}`);
      },
    },
    async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("Network request for 'sendMessage' failed!");
      }
      return 'sent';
    },
  );

  assert.equal(result, 'sent');
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [500]);
  assert.deepEqual(events, ['failure:reply:1', 'success:reply:2']);
  assert.equal(logs[0]?.message, 'Telegram API call failed; retrying');
});

test('withTelegramApiRetry respects Telegram retry_after responses', async () => {
  const sleeps: number[] = [];
  let attempts = 0;

  const result = await withTelegramApiRetry(
    {
      operation: 'sendMessage',
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    },
    async () => {
      attempts += 1;
      if (attempts === 1) {
        throw {
          error_code: 429,
          parameters: {
            retry_after: 2,
          },
        };
      }
      return 'sent';
    },
  );

  assert.equal(result, 'sent');
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [2_000]);
});

test('withTelegramApiRetry does not retry permanent Telegram API failures', async () => {
  let attempts = 0;
  const forbidden = {
    error_code: 403,
    description: 'Forbidden: bot was blocked by the user',
  };

  await assert.rejects(
    () =>
      withTelegramApiRetry(
        {
          operation: 'sendMessage',
          sleep: async () => {
            throw new Error('sleep should not be called');
          },
        },
        async () => {
          attempts += 1;
          throw forbidden;
        },
      ),
    forbidden,
  );

  assert.equal(attempts, 1);
});
