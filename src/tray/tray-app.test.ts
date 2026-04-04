import test from 'node:test';
import assert from 'node:assert/strict';

import { ServiceControlError, type ServiceControl, type ServiceStatus } from '../operations/service-control.js';
import { createTrayApp, type TrayActionId, type TrayRuntime } from './tray-app.js';

test('tray app renders active service state and enables the right actions', async () => {
  const runtime = createTrayRuntimeDouble();
  const serviceControl = createServiceControlDouble({
    statuses: [
      {
        serviceName: 'gameclubtelegrambot.service',
        state: 'active',
        rawState: 'active',
      },
    ],
  });

  const app = createTrayApp({
    serviceControl,
    runtime,
    pollIntervalMs: 5000,
    scheduler: runtime.scheduler,
  });

  await app.start();

  assert.deepEqual(runtime.tooltipHistory.at(-1), 'Game Club Bot: actiu');
  assert.deepEqual(runtime.statusHistory.at(-1), 'active');
  assert.deepEqual(runtime.menuHistory.at(-1), [
    { id: 'status', title: 'Status: Bot actiu', enabled: false },
    { id: 'start', title: 'Start', enabled: false },
    { id: 'stop', title: 'Stop', enabled: true },
    { id: 'restart', title: 'Restart', enabled: true },
    { id: 'rebuild-restart', title: 'Rebuild and restart', enabled: true },
    { id: 'logs', title: 'View last logs', enabled: true },
    { id: 'refresh', title: 'Refresh', enabled: true },
    { id: 'quit', title: 'Quit tray', enabled: true },
  ]);
});

test('tray app rebuilds and restarts through the provided callback', async () => {
  const runtime = createTrayRuntimeDouble();
  const serviceControl = createServiceControlDouble({
    statuses: [
      {
        serviceName: 'gameclubtelegrambot.service',
        state: 'active',
        rawState: 'active',
      },
      {
        serviceName: 'gameclubtelegrambot.service',
        state: 'active',
        rawState: 'active',
      },
    ],
  });
  const calls: string[] = [];

  const app = createTrayApp({
    serviceControl,
    runtime,
    rebuildAndRestart: async () => {
      calls.push('rebuild-restart');
    },
    pollIntervalMs: 5000,
    scheduler: runtime.scheduler,
  });

  await app.start();
  await runtime.trigger('rebuild-restart');

  assert.deepEqual(calls, ['rebuild-restart']);
  assert.equal(runtime.statusHistory.includes('busy'), true);
  assert.deepEqual(serviceControl.calls, ['status', 'status']);
});

test('tray app restarts the service and refreshes state afterwards', async () => {
  const runtime = createTrayRuntimeDouble();
  const serviceControl = createServiceControlDouble({
    statuses: [
      {
        serviceName: 'gameclubtelegrambot.service',
        state: 'inactive',
        rawState: 'inactive',
      },
      {
        serviceName: 'gameclubtelegrambot.service',
        state: 'active',
        rawState: 'active',
      },
    ],
  });

  const app = createTrayApp({
    serviceControl,
    runtime,
    pollIntervalMs: 5000,
    scheduler: runtime.scheduler,
  });

  await app.start();
  await runtime.trigger('restart');

  assert.deepEqual(serviceControl.calls, ['status', 'restart', 'status']);
  assert.equal(runtime.statusHistory.includes('busy'), true);
  assert.deepEqual(runtime.tooltipHistory.at(-1), 'Game Club Bot: actiu');
});

test('tray app opens recent logs through the runtime', async () => {
  const runtime = createTrayRuntimeDouble();
  const serviceControl = createServiceControlDouble({
    statuses: [
      {
        serviceName: 'gameclubtelegrambot.service',
        state: 'failed',
        rawState: 'failed',
      },
    ],
    logs: 'line 1\nline 2\n',
  });

  const app = createTrayApp({
    serviceControl,
    runtime,
    pollIntervalMs: 5000,
    scheduler: runtime.scheduler,
  });

  await app.start();
  await runtime.trigger('logs');

  assert.deepEqual(serviceControl.calls, ['status', 'logs']);
  assert.deepEqual(runtime.logWindows, [
    {
      title: 'Game Club Bot logs',
      content: 'line 1\nline 2\n',
    },
  ]);
});

test('tray app shows operator-friendly errors and refreshes after a failed action', async () => {
  const runtime = createTrayRuntimeDouble();
  const serviceControl = createServiceControlDouble({
    statuses: [
      {
        serviceName: 'gameclubtelegrambot.service',
        state: 'inactive',
        rawState: 'inactive',
      },
      {
        serviceName: 'gameclubtelegrambot.service',
        state: 'inactive',
        rawState: 'inactive',
      },
    ],
    startError: new ServiceControlError({
      code: 'permission-denied',
      operation: 'start',
      serviceName: 'gameclubtelegrambot.service',
      message: "Aquest usuari no te permisos per executar l'accio start sobre gameclubtelegrambot.service.",
    }),
  });

  const app = createTrayApp({
    serviceControl,
    runtime,
    pollIntervalMs: 5000,
    scheduler: runtime.scheduler,
  });

  await app.start();
  await runtime.trigger('start');

  assert.deepEqual(runtime.notifications, [
    {
      title: 'Game Club Bot',
      message: "Aquest usuari no te permisos per executar l'accio start sobre gameclubtelegrambot.service.",
    },
  ]);
  assert.deepEqual(serviceControl.calls, ['status', 'start', 'status']);
});

test('tray app refreshes periodically while open', async () => {
  const runtime = createTrayRuntimeDouble();
  const serviceControl = createServiceControlDouble({
    statuses: [
      {
        serviceName: 'gameclubtelegrambot.service',
        state: 'inactive',
        rawState: 'inactive',
      },
      {
        serviceName: 'gameclubtelegrambot.service',
        state: 'active',
        rawState: 'active',
      },
    ],
  });

  const app = createTrayApp({
    serviceControl,
    runtime,
    pollIntervalMs: 5000,
    scheduler: runtime.scheduler,
  });

  await app.start();
  await runtime.scheduler.fireInterval();

  assert.deepEqual(serviceControl.calls, ['status', 'status']);
  assert.deepEqual(runtime.tooltipHistory.at(-1), 'Game Club Bot: actiu');

  await app.stop();
  assert.equal(runtime.stopped, true);
});

function createServiceControlDouble({
  statuses,
  logs = 'logs',
  startError,
}: {
  statuses: ServiceStatus[];
  logs?: string;
  startError?: Error;
}): ServiceControl & { calls: string[] } {
  const nextStatuses = [...statuses];
  const calls: string[] = [];
  const fallbackStatus = statuses.at(-1)!;

  return {
    calls,
    async getServiceStatus() {
      calls.push('status');
      return nextStatuses.shift() ?? fallbackStatus;
    },
    async startService() {
      calls.push('start');
      if (startError) {
        throw startError;
      }
    },
    async stopService() {
      calls.push('stop');
    },
    async restartService() {
      calls.push('restart');
    },
    async readRecentLogs() {
      calls.push('logs');
      return logs;
    },
  };
}

function createTrayRuntimeDouble(): TrayRuntime & {
  menuHistory: Array<Array<{ id: string; title: string; enabled: boolean }>>;
  tooltipHistory: string[];
  statusHistory: string[];
  notifications: Array<{ title: string; message: string }>;
  logWindows: Array<{ title: string; content: string }>;
  scheduler: {
    scheduleEvery(ms: number, callback: () => Promise<void> | void): { cancel(): void };
    fireInterval(): Promise<void>;
  };
  trigger(actionId: string): Promise<void>;
  stopped: boolean;
} {
  let actionHandler: ((actionId: TrayActionId) => Promise<void>) | undefined;
  let intervalCallback: (() => Promise<void> | void) | undefined;
  let stopped = false;

  const runtime = {
    menuHistory: [] as Array<Array<{ id: string; title: string; enabled: boolean }>>,
    tooltipHistory: [] as string[],
    statusHistory: [] as string[],
    notifications: [] as Array<{ title: string; message: string }>,
    logWindows: [] as Array<{ title: string; content: string }>,
    scheduler: {
      scheduleEvery(_ms: number, callback: () => Promise<void> | void) {
        intervalCallback = callback;
        return {
          cancel() {
            intervalCallback = undefined;
          },
        };
      },
      async fireInterval() {
        await intervalCallback?.();
      },
    },
    async start() {},
    onAction(handler: (actionId: TrayActionId) => Promise<void>) {
      actionHandler = handler;
    },
    async setSnapshot(snapshot: { items: Array<{ id: string; title: string; enabled: boolean }>; state: string; tooltip: string }) {
      this.statusHistory.push(snapshot.state);
      this.tooltipHistory.push(snapshot.tooltip);
      this.menuHistory.push(snapshot.items);
    },
    async setMenu(items: Array<{ id: string; title: string; enabled: boolean }>) {
      this.menuHistory.push(items);
    },
    async setStatus(state: string) {
      this.statusHistory.push(state);
    },
    async setTooltip(text: string) {
      this.tooltipHistory.push(text);
    },
    async showNotification(title: string, message: string) {
      this.notifications.push({ title, message });
    },
    async showTextWindow(title: string, content: string) {
      this.logWindows.push({ title, content });
    },
    async stop() {
      stopped = true;
    },
    async trigger(actionId: string) {
      await actionHandler?.(actionId as TrayActionId);
    },
    get stopped() {
      return stopped;
    },
  };

  return runtime;
}
