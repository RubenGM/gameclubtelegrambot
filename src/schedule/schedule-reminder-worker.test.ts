import test from 'node:test';
import assert from 'node:assert/strict';

import { createScheduleReminderWorker } from './schedule-reminder-worker.js';

test('createScheduleReminderWorker starts a polling interval and stops it', async () => {
  const calls: string[] = [];
  let intervalHandler: (() => void | Promise<void>) | undefined;
  const worker = createScheduleReminderWorker({
    enabled: true,
    intervalMs: 60000,
    runOnce: async () => {
      calls.push('run');
    },
    logger: { error: () => {} },
    setIntervalFn: (handler, intervalMs) => {
      assert.equal(intervalMs, 60000);
      intervalHandler = handler;
      return 123 as never;
    },
    clearIntervalFn: (timer) => {
      assert.equal(timer, 123);
      calls.push('clear');
    },
  });

  await worker.start();
  assert.deepEqual(calls, ['run']);
  await intervalHandler?.();
  assert.deepEqual(calls, ['run', 'run']);
  await worker.stop();
  assert.deepEqual(calls, ['run', 'run', 'clear']);
});

test('createScheduleReminderWorker does nothing when disabled', async () => {
  const calls: string[] = [];
  const worker = createScheduleReminderWorker({
    enabled: false,
    intervalMs: 60000,
    runOnce: async () => {
      calls.push('run');
    },
    logger: { error: () => {} },
    setIntervalFn: () => {
      calls.push('interval');
      return 123 as never;
    },
    clearIntervalFn: () => {
      calls.push('clear');
    },
  });

  await worker.start();
  await worker.stop();

  assert.deepEqual(calls, []);
});

test('createScheduleReminderWorker logs tick failures and keeps interval alive', async () => {
  const errors: string[] = [];
  const worker = createScheduleReminderWorker({
    enabled: true,
    intervalMs: 60000,
    runOnce: async () => {
      throw new Error('boom');
    },
    logger: {
      error: (bindings, message) => {
        errors.push(`${message}: ${String(bindings.error)}`);
      },
    },
    setIntervalFn: () => 123 as never,
    clearIntervalFn: () => {},
  });

  await worker.start();

  assert.deepEqual(errors, ['Schedule reminder tick failed: boom']);
});
