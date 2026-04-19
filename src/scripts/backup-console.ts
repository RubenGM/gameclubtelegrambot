import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createBackupOperations } from '../operations/backup-operations.js';
import { BackupConsoleApp } from '../tui/backup-console-app.js';

const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const backupDir = process.env.GAMECLUB_BACKUP_DIR ?? join(appRoot, 'backups');
const pollIntervalMs = Number(process.env.GAMECLUB_BACKUP_CONSOLE_POLL_MS ?? '10000');

const app = new BackupConsoleApp({
  operations: createBackupOperations({
    appRoot,
    backupDir,
    serviceName: process.env.GAMECLUB_SERVICE_NAME ?? 'gameclubtelegrambot.service',
  }),
  pollIntervalMs: Number.isFinite(pollIntervalMs) && pollIntervalMs > 0 ? pollIntervalMs : 10000,
});

await app.run();
