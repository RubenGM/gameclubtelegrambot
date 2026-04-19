import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatBackupArchiveRow,
  formatDatabasePanel,
  formatSystemPanel,
} from './backup-console-layout.js';

test('formatSystemPanel renders compact operational status lines', async () => {
  const output = formatSystemPanel({
    service: {
      state: 'active',
      rawState: 'active',
      serviceName: 'gameclubtelegrambot.service',
      message: null,
    },
    dependencies: [{
      command: 'pg_dump',
      state: 'installed',
      packageName: 'postgresql-client',
      autoInstallSupported: true,
    }],
    configFiles: [
      { label: 'Runtime config', path: '/etc/gameclubtelegrambot/runtime.json', state: 'present' },
      { label: 'Runtime env', path: '/etc/gameclubtelegrambot/.env', state: 'present' },
    ],
    backups: {
      directory: '/repo/backups',
      totalCount: 2,
      latestBackup: null,
      archives: [],
    },
  });

  assert.match(output, /Service: active/);
  assert.match(output, /Dependencies: 1 installed, 0 missing/);
  assert.match(output, /Runtime config: present/);
  assert.match(output, /Backups dir: \/repo\/backups/);
});

test('formatDatabasePanel renders connected summary data', async () => {
  const output = formatDatabasePanel({
    state: 'connected',
    host: '127.0.0.1',
    port: 55432,
    databaseName: 'gameclub',
    sizeBytes: 4096,
    totalTables: 4,
    knownTableCounts: [{ tableName: 'users', rowCount: 12 }],
  });

  assert.match(output, /Database: gameclub/);
  assert.match(output, /Host: 127.0.0.1:55432/);
  assert.match(output, /Tables: 4/);
  assert.match(output, /users: 12/);
});

test('formatBackupArchiveRow includes filename, size and timestamp', async () => {
  const output = formatBackupArchiveRow({
    fileName: 'gameclub-backup-20260419-120000.zip',
    filePath: '/repo/backups/gameclub-backup-20260419-120000.zip',
    sizeBytes: 1536,
    modifiedAt: '2026-04-19T12:00:00.000Z',
    manifest: null,
  });

  assert.match(output, /gameclub-backup-20260419-120000.zip/);
  assert.match(output, /1.5 KB/);
  assert.match(output, /2026-04-19 12:00/);
});
