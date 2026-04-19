import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import type { BackupDependencyStatus } from './backup-types.js';

const execFile = promisify(execFileCallback);

export type BackupDependencyCommand = 'pg_dump' | 'psql' | 'python3';

interface BackupDependencySpec {
  command: BackupDependencyCommand;
  packageName: string;
  autoInstallSupported: boolean;
}

export interface BackupDependencyCommandRunner {
  (
    command: string,
    args: string[],
    options?: {
      env?: NodeJS.ProcessEnv;
    },
  ): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;
}

export interface EnsureBackupDependenciesOptions {
  commands?: BackupDependencyCommand[];
  runCommand?: BackupDependencyCommandRunner;
}

const dependencySpecs: Record<BackupDependencyCommand, BackupDependencySpec> = {
  pg_dump: {
    command: 'pg_dump',
    packageName: 'postgresql-client',
    autoInstallSupported: true,
  },
  psql: {
    command: 'psql',
    packageName: 'postgresql-client',
    autoInstallSupported: true,
  },
  python3: {
    command: 'python3',
    packageName: 'python3',
    autoInstallSupported: true,
  },
};

export async function readBackupDependencyStatus(
  commands: BackupDependencyCommand[] = ['pg_dump', 'psql', 'python3'],
  commandRunner: BackupDependencyCommandRunner = runCommand,
): Promise<BackupDependencyStatus[]> {
  const uniqueCommands = [...new Set(commands)];
  const results: BackupDependencyStatus[] = [];

  for (const command of uniqueCommands) {
    const spec = dependencySpecs[command];
    const probe = await commandRunner('sh', ['-lc', `command -v ${spec.command}`]);
    results.push({
      command: spec.command,
      state: probe.exitCode === 0 ? 'installed' : 'missing',
      packageName: spec.packageName,
      autoInstallSupported: spec.autoInstallSupported,
    });
  }

  return results;
}

export async function ensureBackupDependencies(
  options: EnsureBackupDependenciesOptions = {},
): Promise<BackupDependencyStatus[]> {
  const commands = options.commands ?? ['pg_dump', 'psql', 'python3'];
  const run = options.runCommand ?? runCommand;
  const statuses = await readBackupDependencyStatus(commands, run);
  const missing = statuses.filter((status) => status.state === 'missing');

  if (missing.length === 0) {
    return statuses;
  }

  if (!(await isDebianLikeSystem())) {
    throw new Error('No es poden auto-instal.lar dependencies fora d un sistema Debian compatible.');
  }

  const aptStatus = await run('sh', ['-lc', 'command -v apt-get']);
  if (aptStatus.exitCode !== 0) {
    throw new Error('No s ha trobat apt-get per auto-instal.lar dependencies.');
  }

  const commandPrefix = process.getuid?.() === 0 ? [] : ['sudo'];
  if (commandPrefix.length > 0) {
    const sudoStatus = await run('sh', ['-lc', 'command -v sudo']);
    if (sudoStatus.exitCode !== 0) {
      throw new Error('Cal sudo per auto-instal.lar dependencies i no esta disponible.');
    }
  }

  const packageNames = [...new Set(missing.map((status) => status.packageName))];
  await run(commandPrefix[0] ?? 'apt-get', commandPrefix.length > 0 ? ['apt-get', 'update'] : ['update'], {
    env: {
      ...process.env,
      DEBIAN_FRONTEND: 'noninteractive',
    },
  });
  await run(commandPrefix[0] ?? 'apt-get', commandPrefix.length > 0 ? ['apt-get', 'install', '-y', ...packageNames] : ['install', '-y', ...packageNames], {
    env: {
      ...process.env,
      DEBIAN_FRONTEND: 'noninteractive',
    },
  });

  const refreshedStatuses = await readBackupDependencyStatus(commands, run);
  const stillMissing = refreshedStatuses.filter((status) => status.state !== 'installed');

  if (stillMissing.length > 0) {
    throw new Error(
      `No s han pogut instal.lar totes les dependencies necessaries: ${stillMissing.map((status) => status.command).join(', ')}.`,
    );
  }

  return refreshedStatuses;
}

export function parseRequestedDependencyCommands(values: string[]): BackupDependencyCommand[] {
  const commands: BackupDependencyCommand[] = [];

  for (const value of values) {
    if (!(value in dependencySpecs)) {
      throw new Error(`Dependencia desconeguda: ${value}`);
    }

    commands.push(value as BackupDependencyCommand);
  }

  return commands;
}

async function isDebianLikeSystem(): Promise<boolean> {
  try {
    const osRelease = await readFile('/etc/os-release', 'utf8');
    const lowered = osRelease.toLowerCase();
    return lowered.includes('id=debian') || lowered.includes('id_like=debian') || lowered.includes('id_like="debian');
  } catch {
    return false;
  }
}

async function runCommand(
  command: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFile(command, args, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 10,
      env: options.env,
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
