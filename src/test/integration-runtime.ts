import { access } from 'node:fs/promises';

import { loadRuntimeConfig } from '../config/load-runtime-config.js';

const localConfigPath = 'config/runtime.local.json';

export async function loadIntegrationRuntimeConfig() {
  const env = await resolveIntegrationRuntimeEnv();
  if (!env) {
    return null;
  }

  return loadRuntimeConfig({
    env: {
      ...process.env,
      ...env,
    },
  });
}

export async function resolveIntegrationRuntimeEnv(
  env: Record<string, string | undefined> = process.env,
  fileExists: (filePath: string) => Promise<boolean> = defaultFileExists,
): Promise<Record<string, string> | null> {
  const explicitConfigPath = env.GAMECLUB_CONFIG_PATH?.trim();
  if (explicitConfigPath) {
    const explicitEnvPath = env.GAMECLUB_ENV_PATH?.trim();

    return {
      GAMECLUB_CONFIG_PATH: explicitConfigPath,
      ...(explicitEnvPath ? { GAMECLUB_ENV_PATH: explicitEnvPath } : {}),
    };
  }

  if (await fileExists(localConfigPath)) {
    return {
      GAMECLUB_CONFIG_PATH: localConfigPath,
    };
  }

  return null;
}

async function defaultFileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
