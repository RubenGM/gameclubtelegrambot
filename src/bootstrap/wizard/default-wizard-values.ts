import { readFile } from 'node:fs/promises';

import type { BootstrapWizardDefaults } from './run-bootstrap-wizard.js';

export async function loadWizardDefaults(
  env: Record<string, string | undefined> = process.env,
): Promise<Partial<BootstrapWizardDefaults>> {
  const envFilePath = env.GAMECLUB_POSTGRES_ENV_PATH ?? '.env.postgres.local';
  const fileValues = await readOptionalEnvFile(envFilePath);

  const merged = {
    ...fileValues,
    ...pickDefinedEnvDefaults(env),
  };

  return {
    ...(merged.POSTGRES_HOST ? { databaseHost: merged.POSTGRES_HOST } : {}),
    ...(merged.POSTGRES_PORT ? { databasePort: Number(merged.POSTGRES_PORT) } : {}),
    ...(merged.POSTGRES_DB ? { databaseName: merged.POSTGRES_DB } : {}),
    ...(merged.POSTGRES_USER ? { databaseUser: merged.POSTGRES_USER } : {}),
    ...(merged.POSTGRES_PASSWORD ? { databasePassword: merged.POSTGRES_PASSWORD } : {}),
  };
}

async function readOptionalEnvFile(filePath: string): Promise<Record<string, string>> {
  try {
    const content = await readFile(filePath, 'utf8');
    return parseSimpleEnv(content);
  } catch {
    return {};
  }
}

function pickDefinedEnvDefaults(env: Record<string, string | undefined>): Record<string, string> {
  const keys = ['POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD'] as const;

  return Object.fromEntries(
    keys
      .map((key) => [key, env[key]])
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0),
  );
}

function parseSimpleEnv(content: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (key) {
      values[key] = value;
    }
  }

  return values;
}
