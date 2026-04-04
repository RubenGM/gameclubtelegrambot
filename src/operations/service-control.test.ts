import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ServiceControlError,
  createServiceControl,
  type ServiceCommandRunner,
} from './service-control.js';

test('getServiceStatus normalizes known systemd active states', async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const serviceControl = createServiceControl({
    serviceName: 'gameclubtelegrambot.service',
    runCommand: createRunner(calls, async () => ({ stdout: 'active\n', stderr: '', exitCode: 0 })),
  });

  const status = await serviceControl.getServiceStatus();

  assert.deepEqual(status, {
    serviceName: 'gameclubtelegrambot.service',
    state: 'active',
    rawState: 'active',
  });
  assert.deepEqual(calls, [
    {
      command: 'systemctl',
      args: ['show', 'gameclubtelegrambot.service', '--property=ActiveState', '--value'],
    },
  ]);
});

test('getServiceStatus falls back to unknown for unrecognized states', async () => {
  const serviceControl = createServiceControl({
    serviceName: 'gameclubtelegrambot.service',
    runCommand: async () => ({ stdout: 'reloading\n', stderr: '', exitCode: 0 }),
  });

  const status = await serviceControl.getServiceStatus();

  assert.deepEqual(status, {
    serviceName: 'gameclubtelegrambot.service',
    state: 'unknown',
    rawState: 'reloading',
  });
});

test('start stop and restart invoke systemctl with the expected service name', async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const serviceControl = createServiceControl({
    serviceName: 'gameclubtelegrambot.service',
    runCommand: createRunner(calls, async () => ({ stdout: '', stderr: '', exitCode: 0 })),
  });

  await serviceControl.startService();
  await serviceControl.stopService();
  await serviceControl.restartService();

  assert.deepEqual(calls, [
    { command: 'systemctl', args: ['start', 'gameclubtelegrambot.service'] },
    { command: 'systemctl', args: ['stop', 'gameclubtelegrambot.service'] },
    { command: 'systemctl', args: ['restart', 'gameclubtelegrambot.service'] },
  ]);
});

test('readRecentLogs returns journal output with the requested line count', async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const serviceControl = createServiceControl({
    serviceName: 'gameclubtelegrambot.service',
    runCommand: createRunner(calls, async () => ({ stdout: 'line 1\nline 2\n', stderr: '', exitCode: 0 })),
  });

  const logs = await serviceControl.readRecentLogs({ lines: 20 });

  assert.equal(logs, 'line 1\nline 2\n');
  assert.deepEqual(calls, [
    {
      command: 'journalctl',
      args: ['-u', 'gameclubtelegrambot.service', '-n', '20', '--no-pager'],
    },
  ]);
});

test('service-control turns missing service failures into predictable errors', async () => {
  const serviceControl = createServiceControl({
    serviceName: 'gameclubtelegrambot.service',
    runCommand: async () => ({
      stdout: '',
      stderr: 'Unit gameclubtelegrambot.service could not be found.\n',
      exitCode: 5,
    }),
  });

  await assert.rejects(
    () => serviceControl.getServiceStatus(),
    (error: unknown) => {
      assert.equal(error instanceof ServiceControlError, true);
      assert.equal((error as ServiceControlError).operation, 'status');
      assert.equal((error as ServiceControlError).code, 'service-not-found');
      assert.match((error as Error).message, /No s'ha trobat el servei/);
      return true;
    },
  );
});

test('service-control turns permission failures into predictable errors', async () => {
  const serviceControl = createServiceControl({
    serviceName: 'gameclubtelegrambot.service',
    runCommand: async () => ({
      stdout: '',
      stderr: 'Access denied\n',
      exitCode: 1,
    }),
  });

  await assert.rejects(
    () => serviceControl.restartService(),
    (error: unknown) => {
      assert.equal(error instanceof ServiceControlError, true);
      assert.equal((error as ServiceControlError).operation, 'restart');
      assert.equal((error as ServiceControlError).code, 'permission-denied');
      assert.match((error as Error).message, /no te permisos/i);
      return true;
    },
  );
});

function createRunner(
  calls: Array<{ command: string; args: string[] }>,
  resolve: ServiceCommandRunner,
): ServiceCommandRunner {
  return async (command: string, args: string[]) => {
    calls.push({ command, args });
    return resolve(command, args);
  };
}
