import test from 'node:test';
import assert from 'node:assert/strict';

import { runService } from './run-service.js';

test('runService shuts the app down on SIGTERM', async () => {
  const events: string[] = [];
  const signalHandlers = new Map<string, () => void>();

  const runPromise = runService({
    logger: {
      info: (_bindings: object, message: string) => {
        events.push(`info:${message}`);
      },
      fatal: (_bindings: object, message: string) => {
        events.push(`fatal:${message}`);
      },
      error: (_bindings: object, message: string) => {
        events.push(`error:${message}`);
      },
    },
    createApp: async () => ({
      async start() {
        events.push('app:start');
      },
      async stop() {
        events.push('app:stop');
      },
    }),
    processInterface: createProcessDouble(signalHandlers),
  });

  await new Promise((resolve) => setImmediate(resolve));
  signalHandlers.get('SIGTERM')?.();
  const exitCode = await runPromise;

  assert.equal(exitCode, 0);
  assert.deepEqual(events, [
    'info:Service startup initiated',
    'app:start',
    'info:Service startup completed',
    'info:Shutdown signal received',
    'app:stop',
    'info:Service shutdown completed',
  ]);
});

test('runService handles uncaught exceptions with fatal logging and shutdown', async () => {
  const events: string[] = [];
  const signalHandlers = new Map<string, () => void>();
  const uncaughtHandlers = new Map<string, (error: Error) => void>();

  const runPromise = runService({
    logger: {
      info: (_bindings: object, message: string) => {
        events.push(`info:${message}`);
      },
      fatal: (_bindings: object, message: string) => {
        events.push(`fatal:${message}`);
      },
      error: (_bindings: object, message: string) => {
        events.push(`error:${message}`);
      },
    },
    createApp: async () => ({
      async start() {
        events.push('app:start');
      },
      async stop() {
        events.push('app:stop');
      },
    }),
    processInterface: createProcessDouble(signalHandlers, uncaughtHandlers),
  });

  await new Promise((resolve) => setImmediate(resolve));
  uncaughtHandlers.get('uncaughtException')?.(new Error('boom'));
  const exitCode = await runPromise;

  assert.equal(exitCode, 1);
  assert.deepEqual(events, [
    'info:Service startup initiated',
    'app:start',
    'info:Service startup completed',
    'fatal:Unhandled exception detected',
    'app:stop',
    'info:Service shutdown completed',
  ]);
});

test('runService handles app runtime failures with fatal logging and shutdown', async () => {
  const events: string[] = [];
  const signalHandlers = new Map<string, () => void>();
  let runtimeFailureHandler: ((error: unknown) => void) | undefined;

  const runPromise = runService({
    logger: {
      info: (_bindings: object, message: string) => {
        events.push(`info:${message}`);
      },
      fatal: (_bindings: object, message: string) => {
        events.push(`fatal:${message}`);
      },
      error: (_bindings: object, message: string) => {
        events.push(`error:${message}`);
      },
    },
    createApp: async () => ({
      async start() {
        events.push('app:start');
      },
      async stop() {
        events.push('app:stop');
      },
      onFatalRuntimeError(handler) {
        runtimeFailureHandler = handler;
      },
    }),
    processInterface: createProcessDouble(signalHandlers),
  });

  await new Promise((resolve) => setImmediate(resolve));
  runtimeFailureHandler?.(new Error('telegram polling failed'));
  const exitCode = await runPromise;

  assert.equal(exitCode, 1);
  assert.deepEqual(events, [
    'info:Service startup initiated',
    'app:start',
    'info:Service startup completed',
    'fatal:Fatal runtime error detected',
    'app:stop',
    'info:Service shutdown completed',
  ]);
});

test('runService keeps shutdown idempotent when a signal arrives during runtime failure shutdown', async () => {
  const events: string[] = [];
  const signalHandlers = new Map<string, () => void>();
  let runtimeFailureHandler: ((error: unknown) => void) | undefined;
  let releaseStop: (() => void) | undefined;

  const runPromise = runService({
    logger: {
      info: (_bindings: object, message: string) => {
        events.push(`info:${message}`);
      },
      fatal: (_bindings: object, message: string) => {
        events.push(`fatal:${message}`);
      },
      error: (_bindings: object, message: string) => {
        events.push(`error:${message}`);
      },
    },
    createApp: async () => ({
      async start() {
        events.push('app:start');
      },
      async stop() {
        events.push('app:stop');
        await new Promise<void>((resolve) => {
          releaseStop = resolve;
        });
      },
      onFatalRuntimeError(handler) {
        runtimeFailureHandler = handler;
      },
    }),
    processInterface: createProcessDouble(signalHandlers),
  });

  await new Promise((resolve) => setImmediate(resolve));
  runtimeFailureHandler?.(new Error('telegram polling failed'));
  signalHandlers.get('SIGTERM')?.();
  releaseStop?.();
  const exitCode = await runPromise;

  assert.equal(exitCode, 1);
  assert.deepEqual(events, [
    'info:Service startup initiated',
    'app:start',
    'info:Service startup completed',
    'fatal:Fatal runtime error detected',
    'app:stop',
    'info:Service shutdown completed',
  ]);
});

function createProcessDouble(
  signalHandlers: Map<string, () => void>,
  errorHandlers: Map<string, (error: Error) => void> = new Map(),
) {
  return {
    once(event: string, handler: () => void) {
      signalHandlers.set(event, handler);
    },
    on(event: string, handler: (error: Error) => void) {
      errorHandlers.set(event, handler);
      return this;
    },
    removeListener(_event: string, _handler: unknown) {
      return this;
    },
  };
}
