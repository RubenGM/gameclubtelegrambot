import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BackupOperationError,
  createBackupOperations,
} from './backup-operations.js';

test('readBackupConsoleStatus installs dependencies and aggregates service, config, database and backups', async () => {
  const calls: string[] = [];
  const operations = createBackupOperations({
    appRoot: '/repo',
    backupDir: '/repo/backups',
    ensureDependencies: async () => {
      calls.push('ensure');
    },
    readDependencyStatus: async () => [{
      command: 'pg_dump',
      state: 'installed',
      packageName: 'postgresql-client',
      autoInstallSupported: true,
    }],
    readConfigFiles: async () => [
      { label: 'Runtime config', path: '/etc/gameclubtelegrambot/runtime.json', state: 'present' },
      { label: 'Runtime env', path: '/etc/gameclubtelegrambot/.env', state: 'present' },
      { label: 'Service env', path: '/etc/default/gameclubtelegrambot', state: 'present' },
    ],
    listBackupArchives: async () => [{
      fileName: 'gameclub-backup-20260419-120000.zip',
      filePath: '/repo/backups/gameclub-backup-20260419-120000.zip',
      sizeBytes: 1024,
      modifiedAt: '2026-04-19T12:00:00.000Z',
      manifest: null,
    }],
    readDatabaseSummary: async () => ({
      state: 'connected',
      host: '127.0.0.1',
      port: 55432,
      databaseName: 'gameclub',
      sizeBytes: 4096,
      totalTables: 4,
      knownTableCounts: [{ tableName: 'users', rowCount: 12 }],
    }),
    serviceControl: {
      async getServiceStatus() {
        return {
          serviceName: 'gameclubtelegrambot.service',
          state: 'active',
          rawState: 'active',
        };
      },
      async startService() {
        throw new Error('not used');
      },
      async stopService() {
        throw new Error('not used');
      },
      async restartService() {
        throw new Error('not used');
      },
      async readRecentLogs() {
        throw new Error('not used');
      },
    },
  });

  const status = await operations.readBackupConsoleStatus();

  assert.deepEqual(calls, ['ensure']);
  assert.equal(status.service.state, 'active');
  assert.equal(status.backups.totalCount, 1);
  assert.equal(status.backups.latestBackup?.fileName, 'gameclub-backup-20260419-120000.zip');
  assert.equal(status.database.state, 'connected');
  assert.equal(status.dependencies[0]?.command, 'pg_dump');
});

test('createFullBackup runs the CLI script and returns the archive path', async () => {
  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
  const operations = createBackupOperations({
    appRoot: '/repo',
    backupDir: '/repo/backups',
    ensureDependencies: async () => undefined,
    runCommand: async ({ command, args, cwd }) => {
      calls.push({ command, args, cwd });
      return {
        stdout: '[backup-full] Backup complet creat a: /repo/backups/gameclub-backup-20260419-120000.zip\n/repo/backups/gameclub-backup-20260419-120000.zip\n',
        stderr: '',
        exitCode: 0,
      };
    },
  });

  const result = await operations.createFullBackup();

  assert.equal(result.archivePath, '/repo/backups/gameclub-backup-20260419-120000.zip');
  assert.match(result.output, /Backup complet creat/);
  assert.deepEqual(calls, [{
    command: 'bash',
    args: ['/repo/scripts/backup-full.sh', '--output-dir', '/repo/backups'],
    cwd: '/repo',
  }]);
});

test('restoreFullBackup runs the restore CLI and keeps the combined operation log', async () => {
  const operations = createBackupOperations({
    appRoot: '/repo',
    backupDir: '/repo/backups',
    ensureDependencies: async () => undefined,
    runCommand: async () => ({
      stdout: '[restore-full] Restore completat i servei arrencat: gameclubtelegrambot.service\n',
      stderr: '',
      exitCode: 0,
    }),
  });

  const result = await operations.restoreFullBackup({
    backupFilePath: '/repo/backups/gameclub-backup-20260419-120000.zip',
  });

  assert.match(result.output, /Restore completat/);
  assert.match(await operations.readLastOperationLog(), /Restore completat/);
});

test('restoreFullBackup surfaces CLI failures as operator-facing errors', async () => {
  const operations = createBackupOperations({
    appRoot: '/repo',
    backupDir: '/repo/backups',
    ensureDependencies: async () => undefined,
    runCommand: async () => ({
      stdout: '',
      stderr: 'restore failed\n',
      exitCode: 1,
    }),
  });

  await assert.rejects(
    () => operations.restoreFullBackup({
      backupFilePath: '/repo/backups/gameclub-backup-20260419-120000.zip',
    }),
    (error: unknown) => {
      assert.equal(error instanceof BackupOperationError, true);
      assert.equal((error as BackupOperationError).operation, 'restore');
      assert.match((error as Error).message, /restore backup/i);
      assert.match((error as BackupOperationError).output, /restore failed/);
      return true;
    },
  );
});
