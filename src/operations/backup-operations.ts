import { execFile as execFileCallback } from 'node:child_process';
import { access, readdir, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { loadRuntimeConfig } from '../config/load-runtime-config.js';
import { resolveRuntimeConfigPaths } from '../config/runtime-config-files.js';

import {
  ensureBackupDependencies,
  readBackupDependencyStatus,
  type BackupDependencyCommandRunner,
} from './backup-dependencies.js';
import { readDatabaseSummaryForConfig } from './database-summary.js';
import { createServiceControl, type ServiceControl } from './service-control.js';
import type {
  BackupArchiveInfo,
  BackupConfigFileStatus,
  BackupConsoleServiceStatus,
  BackupConsoleStatus,
  CreateBackupResult,
  DatabaseSummary,
} from './backup-types.js';

const execFile = promisify(execFileCallback);

export interface BackupCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface BackupCommandRunnerInput {
  command: string;
  args: string[];
  cwd: string;
}

export interface BackupCommandRunner {
  (input: BackupCommandRunnerInput): Promise<BackupCommandResult>;
}

export interface BackupOperations {
  readBackupConsoleStatus(): Promise<BackupConsoleStatus>;
  listBackupArchives(): Promise<BackupArchiveInfo[]>;
  createFullBackup(): Promise<CreateBackupResult>;
  restoreFullBackup(options: { backupFilePath: string }): Promise<{ output: string }>;
  readLastOperationLog(): Promise<string>;
}

export interface CreateBackupOperationsOptions {
  appRoot: string;
  backupDir: string;
  serviceName?: string;
  runCommand?: BackupCommandRunner;
  ensureDependencies?: () => Promise<unknown>;
  readDependencyStatus?: () => Promise<BackupConsoleStatus['dependencies']>;
  readConfigFiles?: () => Promise<BackupConfigFileStatus[]>;
  listBackupArchives?: () => Promise<BackupArchiveInfo[]>;
  readDatabaseSummary?: () => Promise<DatabaseSummary>;
  serviceControl?: ServiceControl;
}

export class BackupOperationError extends Error {
  readonly operation: 'backup' | 'restore';
  readonly output: string;

  constructor(operation: 'backup' | 'restore', message: string, output: string) {
    super(message);
    this.name = 'BackupOperationError';
    this.operation = operation;
    this.output = output;
  }
}

export function createBackupOperations(options: CreateBackupOperationsOptions): BackupOperations {
  const serviceControl = options.serviceControl ?? createServiceControl({
    serviceName: options.serviceName ?? 'gameclubtelegrambot.service',
  });
  const runCommand = options.runCommand ?? runBackupCommand;
  const ensureDependencies = options.ensureDependencies ?? (() => ensureBackupDependencies({
    commands: ['pg_dump', 'psql', 'python3'],
  }));
  const readDependencyStatus = options.readDependencyStatus ?? (() => readBackupDependencyStatus(['pg_dump', 'psql', 'python3']));
  const listBackupArchives = options.listBackupArchives ?? (() => listBackupArchivesFromDirectory(options.backupDir));
  const readConfigFiles = options.readConfigFiles ?? readRuntimeConfigFileStatuses;
  const readDatabaseSummary = options.readDatabaseSummary ?? defaultReadDatabaseSummary;

  let lastOperationLog = 'No operations run yet.';

  return {
    async readBackupConsoleStatus() {
      let dependencyInstallMessage: string | null = null;
      try {
        await ensureDependencies();
      } catch (error) {
        dependencyInstallMessage = error instanceof Error ? error.message : 'Unknown dependency install error';
      }

      const [dependencies, configFiles, backups, service, database] = await Promise.all([
        readDependencyStatus().then((items) => {
          if (dependencyInstallMessage === null) {
            return items;
          }

          return items.map((item) => item.state === 'installed'
            ? item
            : { ...item, state: 'error', message: dependencyInstallMessage });
        }),
        readConfigFiles(),
        listBackupArchives(),
        readServiceStatus(serviceControl),
        readDatabaseStatus(readDatabaseSummary),
      ]);

      return {
        service,
        dependencies,
        configFiles,
        database,
        backups: {
          directory: options.backupDir,
          totalCount: backups.length,
          latestBackup: backups[0] ?? null,
          archives: backups,
        },
      };
    },

    async listBackupArchives() {
      return listBackupArchives();
    },

    async createFullBackup() {
      await ensureBackupDependencies({
        commands: ['pg_dump', 'python3'],
      });
      const result = await runCommand({
        command: 'bash',
        args: [join(options.appRoot, 'scripts', 'backup-full.sh'), '--output-dir', options.backupDir],
        cwd: options.appRoot,
      });
      const output = combineCommandOutput(result);
      lastOperationLog = output;

      if (result.exitCode !== 0) {
        throw new BackupOperationError('backup', 'Could not create backup.', output);
      }

      const archivePath = output
        .trim()
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .at(-1);

      if (!archivePath) {
        throw new BackupOperationError('backup', 'Backup completed without reporting the archive path.', output);
      }

      return {
        archivePath,
        output,
      };
    },

    async restoreFullBackup({ backupFilePath }) {
      await ensureBackupDependencies({
        commands: ['psql', 'python3'],
      });
      const result = await runCommand({
        command: 'bash',
        args: [join(options.appRoot, 'scripts', 'restore-full.sh'), '--input', backupFilePath],
        cwd: options.appRoot,
      });
      const output = combineCommandOutput(result);
      lastOperationLog = output;

      if (result.exitCode !== 0) {
        throw new BackupOperationError('restore', 'Could not restore backup.', output);
      }

      return { output };
    },

    async readLastOperationLog() {
      return lastOperationLog;
    },
  };
}

async function listBackupArchivesFromDirectory(directory: string): Promise<BackupArchiveInfo[]> {
  try {
    await access(directory, fsConstants.R_OK);
  } catch {
    return [];
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const archives: BackupArchiveInfo[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.zip')) {
      continue;
    }

    const filePath = join(directory, entry.name);
    const stats = await stat(filePath);
    archives.push({
      fileName: entry.name,
      filePath,
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      manifest: null,
    });
  }

  archives.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
  return archives;
}

async function readRuntimeConfigFileStatuses(): Promise<BackupConfigFileStatus[]> {
  const runtimePaths = resolveRuntimeConfigPaths(process.env);
  return Promise.all([
    readConfigFileStatus('Runtime config', runtimePaths.configPath),
    readConfigFileStatus('Runtime env', runtimePaths.envPath),
    readConfigFileStatus('Service env', '/etc/default/gameclubtelegrambot'),
  ]);
}

async function readConfigFileStatus(label: string, filePath: string): Promise<BackupConfigFileStatus> {
  try {
    await access(filePath, fsConstants.R_OK);
    return { label, path: filePath, state: 'present' };
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { label, path: filePath, state: 'missing' };
    }

    return { label, path: filePath, state: 'unreadable' };
  }
}

async function defaultReadDatabaseSummary(): Promise<DatabaseSummary> {
  const config = await loadRuntimeConfig();
  return readDatabaseSummaryForConfig({ config });
}

async function readServiceStatus(serviceControl: ServiceControl): Promise<BackupConsoleServiceStatus> {
  try {
    const serviceStatus = await serviceControl.getServiceStatus();
    return {
      serviceName: serviceStatus.serviceName,
      state: serviceStatus.state,
      rawState: serviceStatus.rawState,
      message: null,
    };
  } catch (error) {
    return {
      serviceName: 'gameclubtelegrambot.service',
      state: 'unknown',
      rawState: 'error',
      message: error instanceof Error ? error.message : 'Unknown service status error',
    };
  }
}

async function readDatabaseStatus(
  readDatabaseSummary: () => Promise<DatabaseSummary>,
): Promise<DatabaseSummary> {
  try {
    return await readDatabaseSummary();
  } catch (error) {
    return {
      state: 'unavailable',
      message: error instanceof Error ? error.message : 'Unknown database status error',
    };
  }
}

function combineCommandOutput(result: BackupCommandResult): string {
  const output = `${result.stdout}${result.stderr}`.trim();
  return output.length > 0 ? output : '(no output)';
}

async function runBackupCommand({
  command,
  args,
  cwd,
}: BackupCommandRunnerInput): Promise<BackupCommandResult> {
  try {
    const result = await execFile(command, args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
      env: process.env,
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
    };
  } catch (error) {
    const stdout = typeof error === 'object' && error !== null && 'stdout' in error ? String(error.stdout ?? '') : '';
    const stderr = typeof error === 'object' && error !== null && 'stderr' in error ? String(error.stderr ?? '') : '';
    const exitCode =
      typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'number'
        ? error.code
        : 1;

    return {
      stdout,
      stderr,
      exitCode,
    };
  }
}
