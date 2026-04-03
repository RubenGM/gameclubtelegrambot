import { readFile } from 'node:fs/promises';

import { ZodError } from 'zod';

import {
  defaultRuntimeConfigPath,
  runtimeConfigSchema,
  type RuntimeConfig,
} from './runtime-config.js';

export interface LoadRuntimeConfigOptions {
  env?: Record<string, string | undefined>;
  readConfigFile?: (filePath: string) => Promise<string>;
}

export class RuntimeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeConfigError';
  }
}

export async function loadRuntimeConfig(
  options: LoadRuntimeConfigOptions = {},
): Promise<RuntimeConfig> {
  const env = options.env ?? process.env;
  const configPath = env.GAMECLUB_CONFIG_PATH ?? defaultRuntimeConfigPath;
  const readConfigFile = options.readConfigFile ?? defaultReadConfigFile;

  let rawConfig: string;

  try {
    rawConfig = await readConfigFile(configPath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown read error';
    throw new RuntimeConfigError(
      `Could not read runtime configuration file ${configPath}: ${reason}`,
    );
  }

  let parsedConfig: unknown;

  try {
    parsedConfig = JSON.parse(rawConfig);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown JSON parse error';
    throw new RuntimeConfigError(
      `Runtime configuration file ${configPath} contains invalid JSON: ${reason}`,
    );
  }

  try {
    return runtimeConfigSchema.parse(parsedConfig);
  } catch (error) {
    if (error instanceof ZodError) {
      const details = error.issues
        .map((issue) => {
          const fieldPath = issue.path.join('.') || '(root)';
          return `- ${fieldPath}: ${issue.message}`;
        })
        .join('\n');

      throw new RuntimeConfigError(
        `Runtime configuration validation failed for ${configPath}:\n${details}`,
      );
    }

    throw error;
  }
}

async function defaultReadConfigFile(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8');
}
