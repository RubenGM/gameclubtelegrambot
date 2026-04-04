import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

export type ServiceLifecycleState =
  | 'inactive'
  | 'activating'
  | 'active'
  | 'deactivating'
  | 'failed'
  | 'unknown';

export type ServiceControlOperation = 'status' | 'start' | 'stop' | 'restart' | 'logs';

export type ServiceControlErrorCode =
  | 'service-not-found'
  | 'permission-denied'
  | 'command-unavailable'
  | 'command-failed';

export interface ServiceCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type ServiceCommandRunner = (
  command: string,
  args: string[],
) => Promise<ServiceCommandResult>;

export interface ServiceStatus {
  serviceName: string;
  state: ServiceLifecycleState;
  rawState: string;
}

export interface ServiceControl {
  getServiceStatus(): Promise<ServiceStatus>;
  startService(): Promise<void>;
  stopService(): Promise<void>;
  restartService(): Promise<void>;
  readRecentLogs(options?: { lines?: number }): Promise<string>;
}

export interface CreateServiceControlOptions {
  serviceName: string;
  runCommand?: ServiceCommandRunner;
}

export class ServiceControlError extends Error {
  readonly code: ServiceControlErrorCode;
  readonly operation: ServiceControlOperation;
  readonly serviceName: string;

  constructor({
    code,
    operation,
    serviceName,
    message,
  }: {
    code: ServiceControlErrorCode;
    operation: ServiceControlOperation;
    serviceName: string;
    message: string;
  }) {
    super(message);
    this.name = 'ServiceControlError';
    this.code = code;
    this.operation = operation;
    this.serviceName = serviceName;
  }
}

export function createServiceControl({
  serviceName,
  runCommand = runSystemCommand,
}: CreateServiceControlOptions): ServiceControl {
  return {
    async getServiceStatus() {
      const result = await executeOrThrow({
        operation: 'status',
        serviceName,
        runCommand,
        command: 'systemctl',
        args: ['show', serviceName, '--property=ActiveState', '--value'],
      });
      const rawState = result.stdout.trim();

      return {
        serviceName,
        state: normalizeSystemdState(rawState),
        rawState,
      };
    },

    async startService() {
      await executeOrThrow({
        operation: 'start',
        serviceName,
        runCommand,
        command: 'systemctl',
        args: ['start', serviceName],
      });
    },

    async stopService() {
      await executeOrThrow({
        operation: 'stop',
        serviceName,
        runCommand,
        command: 'systemctl',
        args: ['stop', serviceName],
      });
    },

    async restartService() {
      await executeOrThrow({
        operation: 'restart',
        serviceName,
        runCommand,
        command: 'systemctl',
        args: ['restart', serviceName],
      });
    },

    async readRecentLogs({ lines = 50 }: { lines?: number } = {}) {
      const safeLines = normalizeLogLines(lines);
      const result = await executeOrThrow({
        operation: 'logs',
        serviceName,
        runCommand,
        command: 'journalctl',
        args: ['-u', serviceName, '-n', String(safeLines), '--no-pager'],
      });

      return result.stdout;
    },
  };
}

async function executeOrThrow({
  operation,
  serviceName,
  runCommand,
  command,
  args,
}: {
  operation: ServiceControlOperation;
  serviceName: string;
  runCommand: ServiceCommandRunner;
  command: string;
  args: string[];
}): Promise<ServiceCommandResult> {
  const result = await runCommand(command, args);

  if (result.exitCode === 0) {
    return result;
  }

  throw classifyCommandFailure({
    operation,
    serviceName,
    command,
    result,
  });
}

function normalizeSystemdState(rawState: string): ServiceLifecycleState {
  switch (rawState) {
    case 'inactive':
    case 'activating':
    case 'active':
    case 'deactivating':
    case 'failed':
      return rawState;
    default:
      return 'unknown';
  }
}

function normalizeLogLines(lines: number): number {
  if (!Number.isFinite(lines) || !Number.isInteger(lines) || lines <= 0) {
    return 50;
  }

  return lines;
}

function classifyCommandFailure({
  operation,
  serviceName,
  command,
  result,
}: {
  operation: ServiceControlOperation;
  serviceName: string;
  command: string;
  result: ServiceCommandResult;
}): ServiceControlError {
  const details = `${result.stdout}\n${result.stderr}`.toLowerCase();

  if (details.includes('could not be found') || details.includes('not loaded')) {
    return new ServiceControlError({
      code: 'service-not-found',
      operation,
      serviceName,
      message: `No s'ha trobat el servei ${serviceName}.`,
    });
  }

  if (details.includes('access denied') || details.includes('authentication is required')) {
    return new ServiceControlError({
      code: 'permission-denied',
      operation,
      serviceName,
      message: `Aquest usuari no te permisos per executar l'accio ${operation} sobre ${serviceName}.`,
    });
  }

  if (details.includes('command not found') || details.includes('no such file or directory')) {
    return new ServiceControlError({
      code: 'command-unavailable',
      operation,
      serviceName,
      message: `No s'ha pogut executar ${command} en aquest sistema.`,
    });
  }

  return new ServiceControlError({
    code: 'command-failed',
    operation,
    serviceName,
    message: `No s'ha pogut completar l'accio ${operation} per al servei ${serviceName}.`,
  });
}

async function runSystemCommand(command: string, args: string[]): Promise<ServiceCommandResult> {
  try {
    const result = await execFile(command, args, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
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
