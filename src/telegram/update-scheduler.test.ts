import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { run } from '@grammyjs/runner';
import type { Update } from 'grammy/types';
import { createTelegramUpdateScheduler, isTelegramGenerationControl, resolveTelegramUpdateScope } from './update-scheduler.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test('same session is ordered, while another scope can progress without consuming queued slots', async () => {
  const first = deferred();
  const starts: number[] = [];
  const scheduler = createTelegramUpdateScheduler<{ id: number; key: string }>({
    scope: (update) => update.key,
    isControl: () => false,
    concurrency: 2,
    maxPending: 2,
    consume: async (update) => { starts.push(update.id); if (update.id === 1) await first.promise; },
    onError: assert.fail,
    onRejected: assert.fail,
  });
  await scheduler.handle({ id: 1, key: 'same' });
  await scheduler.handle({ id: 2, key: 'same' });
  await scheduler.handle({ id: 3, key: 'other' });
  await setImmediate();
  assert.deepEqual(starts, [1, 3]);
  first.resolve();
  await setImmediate();
  assert.deepEqual(starts, [1, 3, 2]);
  await scheduler.stop();
});

test('bounded active work and queue reject excess work but control bypasses both', async () => {
  const active = deferred();
  const starts: number[] = [];
  const rejected: Array<[number, string]> = [];
  const scheduler = createTelegramUpdateScheduler<number>({
    scope: (id) => String(id),
    isControl: (id) => id === 99,
    concurrency: 1,
    maxPending: 1,
    consume: async (id) => { starts.push(id); if (id === 1) await active.promise; },
    onError: assert.fail,
    onRejected: (id, reason) => rejected.push([id, reason]),
  });
  await scheduler.handle(1);
  await scheduler.handle(2);
  await scheduler.handle(3);
  await scheduler.handle(99);
  assert.deepEqual(starts, [1, 99]);
  assert.deepEqual(rejected, [[3, 'capacity']]);
  active.resolve();
  await setImmediate();
  assert.deepEqual(starts, [1, 99, 2]);
  await scheduler.stop();
});

test('shutdown rejects queued work, prevents new side effects and waits for active work', async () => {
  const active = deferred();
  const starts: number[] = [];
  const rejected: number[] = [];
  const scheduler = createTelegramUpdateScheduler<number>({
    scope: String,
    isControl: () => false,
    concurrency: 1,
    consume: async (id) => { starts.push(id); await active.promise; },
    onError: assert.fail,
    onRejected: (id, reason) => { assert.equal(reason, 'shutdown'); rejected.push(id); },
  });
  await scheduler.handle(1);
  await scheduler.handle(2);
  let stopped = false;
  const stop = scheduler.stop().then(() => { stopped = true; });
  await scheduler.handle(3);
  await setImmediate();
  assert.equal(stopped, false);
  assert.deepEqual(starts, [1]);
  assert.deepEqual(rejected, [2, 3]);
  active.resolve();
  await stop;
  assert.equal(stopped, true);
});

test('failed handlers are supervised and release their session lock', async () => {
  const errors: Array<[string, number]> = [];
  const starts: number[] = [];
  const scheduler = createTelegramUpdateScheduler<number>({
    scope: () => 'same',
    isControl: () => false,
    consume: async (id) => { starts.push(id); if (id === 1) throw new Error('failure'); },
    onError: (error, id) => errors.push([(error as Error).message, id]),
    onRejected: assert.fail,
  });
  await scheduler.handle(1);
  await scheduler.handle(2);
  await setImmediate();
  assert.deepEqual(starts, [1, 2]);
  assert.deepEqual(errors, [['failure', 1]]);
  await scheduler.stop();
});

test('scope follows persistent session key across messages, callbacks and topics', () => {
  const message = { update_id: 1, message: { chat: { id: -10 }, from: { id: 7 }, message_thread_id: 2 } } as Update;
  const callback = { update_id: 2, callback_query: { from: { id: 7 }, message: { chat: { id: -10 }, message_thread_id: 3 } } } as Update;
  assert.equal(resolveTelegramUpdateScope(message), 'chat:-10:user:7');
  assert.equal(resolveTelegramUpdateScope(callback), resolveTelegramUpdateScope(message));
  assert.equal(resolveTelegramUpdateScope({ update_id: 3 }), 'update:3');
});

test('native and fallback Stop are controls while unrelated and group callbacks retain session order', () => {
  const callback = (chatType: string, data: string) => ({ update_id: 1, callback_query: { data, from: { id: 7 }, message: { chat: { id: 7, type: chatType } } } }) as Update;
  assert.equal(isTelegramGenerationControl({ update_id: 1, stopped_message_generation: { chat: { id: 7, type: 'private' }, draft_id: 10 } } as Update), true);
  assert.equal(isTelegramGenerationControl(callback('private', 'llm_cmd:stop:token')), true);
  assert.equal(isTelegramGenerationControl(callback('private', 'llm_cmd:confirm:token')), false);
  assert.equal(isTelegramGenerationControl(callback('supergroup', 'llm_cmd:stop:token')), false);
});

test('runner continues polling for Stop after active work and its pending queue saturate', async () => {
  const active = deferred();
  const stopSeen = deferred();
  let polls = 0;
  const rejected: number[] = [];
  const scheduler = createTelegramUpdateScheduler<{ update_id: number }>({
    scope: (update) => String(update.update_id),
    isControl: (update) => update.update_id === 99,
    concurrency: 1,
    maxPending: 1,
    consume: async (update) => { if (update.update_id === 99) stopSeen.resolve(); else await active.promise; },
    onError: assert.fail,
    onRejected: (update) => rejected.push(update.update_id),
  });
  const runner = run({
    api: { getUpdates: async (_args, signal) => {
      polls += 1;
      if (polls === 1) return [1, 2, 3].map((update_id) => ({ update_id }));
      if (polls === 2) return [{ update_id: 99 }];
      return new Promise<{ update_id: number }[]>((resolve) => {
        if (signal.aborted) resolve([]);
        else signal.addEventListener('abort', () => resolve([]), { once: true });
      });
    } },
    handleUpdate: scheduler.handle,
    errorHandler: (error: unknown) => { assert.fail(error instanceof Error ? error : String(error)); },
  }, { sink: { concurrency: 2 } });
  try {
    await Promise.race([stopSeen.promise, new Promise<never>((_, reject) => {
      const timeout = setTimeout(() => reject(new Error('Stop was blocked by saturated intake')), 1000);
      timeout.unref();
    })]);
    assert.deepEqual(rejected, [3]);
    assert.ok(polls >= 2);
  } finally {
    active.resolve();
    await runner.stop();
    await scheduler.stop();
  }
});
