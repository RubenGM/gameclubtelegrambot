import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { RuntimeConfig } from '../config/runtime-config.js';
import { hashSecret } from '../security/password-hash.js';
import type { BootstrapConfigCandidate } from './wizard/bootstrap-config-candidate.js';

export interface BootstrapLogger {
  info(bindings: object, message: string): void;
  error(bindings: object, message: string): void;
}

export interface InitializeSystemFromCandidateOptions {
  candidate: BootstrapConfigCandidate;
  configPath: string;
  logger: BootstrapLogger;
  hashSecret?: (value: string) => Promise<string>;
  fileExists?: (path: string) => Promise<boolean>;
  ensureParentDirectory?: (path: string) => Promise<void>;
  writeTempFile?: (path: string, content: string) => Promise<string>;
  promoteTempFile?: (tempPath: string, finalPath: string) => Promise<void>;
  removeFile?: (path: string) => Promise<void>;
  initializeDatabase: (options: { persistedConfig: RuntimeConfig }) => Promise<void>;
  rollbackDatabaseInitialization?: (options: { persistedConfig: RuntimeConfig }) => Promise<void>;
}

export interface BootstrapInitializationResult {
  config: RuntimeConfig;
}

export class BootstrapInitializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootstrapInitializationError';
  }
}

export async function initializeSystemFromCandidate({
  candidate,
  configPath,
  logger,
  hashSecret: hashSecretValue = hashSecret,
  fileExists = defaultFileExists,
  ensureParentDirectory = defaultEnsureParentDirectory,
  writeTempFile = defaultWriteTempFile,
  promoteTempFile = defaultPromoteTempFile,
  removeFile = defaultRemoveFile,
  initializeDatabase,
  rollbackDatabaseInitialization,
}: InitializeSystemFromCandidateOptions): Promise<BootstrapInitializationResult> {
  if (await fileExists(configPath)) {
    throw new BootstrapInitializationError(
      `Bootstrap target configuration file ${configPath} already exists`,
    );
  }

  const passwordHash = await hashSecretValue(candidate.adminElevation.password);
  const persistedConfig: RuntimeConfig = {
    schemaVersion: 1,
    bot: candidate.bot,
    telegram: candidate.telegram,
    database: candidate.database,
    adminElevation: {
      passwordHash,
    },
    bootstrap: candidate.bootstrap,
    notifications: candidate.notifications,
    featureFlags: candidate.featureFlags,
  };

  const serializedConfig = JSON.stringify(persistedConfig, null, 2);
  const parentDirectory = dirname(configPath);

  await ensureParentDirectory(parentDirectory);
  const tempPath = await writeTempFile(configPath, `${serializedConfig}\n`);

  try {
    await initializeDatabase({ persistedConfig });
  } catch (error) {
    await removeFile(tempPath);
    throw error;
  }

  try {
    await promoteTempFile(tempPath, configPath);
  } catch (error) {
    if (rollbackDatabaseInitialization) {
      await rollbackDatabaseInitialization({ persistedConfig });
    }

    await removeFile(tempPath);
    throw error;
  }

  logger.info({ configPath }, 'Bootstrap initialization persisted successfully');

  return {
    config: persistedConfig,
  };
}

async function defaultFileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function defaultEnsureParentDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function defaultWriteTempFile(path: string, content: string): Promise<string> {
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, content, { mode: 0o600 });
  return tempPath;
}

async function defaultPromoteTempFile(tempPath: string, finalPath: string): Promise<void> {
  await rename(tempPath, finalPath);
}

async function defaultRemoveFile(path: string): Promise<void> {
  await rm(path, { force: true });
}
