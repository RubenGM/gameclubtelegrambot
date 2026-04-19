import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseRequestedDependencyCommands,
  readBackupDependencyStatus,
} from './backup-dependencies.js';

test('parseRequestedDependencyCommands accepts supported dependency names', async () => {
  assert.deepEqual(parseRequestedDependencyCommands(['pg_dump', 'psql', 'python3']), [
    'pg_dump',
    'psql',
    'python3',
  ]);
});

test('parseRequestedDependencyCommands rejects unknown dependency names', async () => {
  assert.throws(
    () => parseRequestedDependencyCommands(['unknown']),
    /Dependencia desconeguda/,
  );
});

test('readBackupDependencyStatus marks commands as installed or missing based on command probes', async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const statuses = await readBackupDependencyStatus(
    ['pg_dump', 'psql'],
    async (command, args) => {
      calls.push({ command, args });
      return {
        stdout: '',
        stderr: '',
        exitCode: args[1]?.includes('pg_dump') ? 0 : 1,
      };
    },
  );

  assert.deepEqual(statuses, [
    {
      command: 'pg_dump',
      state: 'installed',
      packageName: 'postgresql-client',
      autoInstallSupported: true,
    },
    {
      command: 'psql',
      state: 'missing',
      packageName: 'postgresql-client',
      autoInstallSupported: true,
    },
  ]);
  assert.deepEqual(calls, [
    { command: 'sh', args: ['-lc', 'command -v pg_dump'] },
    { command: 'sh', args: ['-lc', 'command -v psql'] },
  ]);
});
