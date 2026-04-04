import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createDebianTrayRuntime, type TrayHostProcessLike } from './debian-tray-runtime.js';

test('debian tray runtime sends menu snapshots to the host process', async () => {
  const host = createHostDouble();
  const runtime = createDebianTrayRuntime({
    spawnHost: async () => host.process,
  });

  const startPromise = runtime.start();
  await new Promise((resolve) => setImmediate(resolve));
  host.emitStdout({ type: 'ready' });
  await startPromise;

  await runtime.setTooltip('Game Club Bot: actiu');
  await runtime.setStatus('active');
  await runtime.setMenu([
    { id: 'status', title: 'Status: Bot actiu', enabled: false },
    { id: 'restart', title: 'Restart', enabled: true },
  ]);

  const lastMessage = host.writes.at(-1) as
    | { type: 'snapshot'; status: string; tooltip: string; items: unknown[] }
    | undefined;
  assert.equal(lastMessage?.type, 'snapshot');
  assert.equal(lastMessage?.status, 'active');
  assert.equal(lastMessage?.tooltip, 'Game Club Bot: actiu');
  assert.deepEqual(lastMessage?.items, [
    { id: 'status', title: 'Status: Bot actiu', enabled: false },
    { id: 'restart', title: 'Restart', enabled: true },
  ]);
});

test('debian tray runtime forwards click actions from the host process', async () => {
  const host = createHostDouble();
  const clicks: string[] = [];
  const runtime = createDebianTrayRuntime({
    spawnHost: async () => host.process,
  });

  runtime.onAction(async (actionId) => {
    clicks.push(actionId);
  });

  const startPromise = runtime.start();
  await new Promise((resolve) => setImmediate(resolve));
  host.emitStdout({ type: 'ready' });
  await startPromise;

  host.emitStdout({ type: 'click', actionId: 'restart' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(clicks, ['restart']);
});

test('debian tray runtime stops the host process cleanly', async () => {
  const host = createHostDouble();
  const runtime = createDebianTrayRuntime({
    spawnHost: async () => host.process,
  });

  const startPromise = runtime.start();
  await new Promise((resolve) => setImmediate(resolve));
  host.emitStdout({ type: 'ready' });
  await startPromise;

  await runtime.stop();

  assert.equal(host.killed, true);
  assert.deepEqual(host.writes.at(-1), { type: 'quit' });
});

function createHostDouble(): {
  writes: unknown[];
  readonly killed: boolean;
  emitStdout(message: unknown): void;
  process: TrayHostProcessLike;
} {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const writes: unknown[] = [];
  let killed = false;

  return {
    writes,
    get killed() {
      return killed;
    },
    emitStdout(message: unknown) {
      stdout.emit('data', `${JSON.stringify(message)}\n`);
    },
    process: {
      stdout,
      stderr,
      stdin: {
        write(chunk: string) {
          writes.push(JSON.parse(chunk));
          return true;
        },
      },
      once(_event: 'exit', _listener: (code: number | null, signal: string | null) => void) {
        return this;
      },
      kill() {
        killed = true;
        return true;
      },
    },
  };
}
