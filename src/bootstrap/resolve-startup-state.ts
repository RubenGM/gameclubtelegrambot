import { access } from 'node:fs/promises';

import {
  inspectBootstrapDatabaseState,
  type BootstrapDatabaseState,
} from './bootstrap-database.js';
import { loadRuntimeConfig, RuntimeConfigError } from '../config/load-runtime-config.js';
import { defaultRuntimeConfigPath, type RuntimeConfig } from '../config/runtime-config.js';

export type StartupState =
  | {
      kind: 'fresh';
      message: string;
    }
  | {
      kind: 'initialized';
      message: string;
      config: RuntimeConfig;
    }
  | {
      kind: 'ambiguous';
      message: string;
    };

export interface ResolveStartupStateOptions {
  env?: Record<string, string | undefined>;
  fileExists?: (path: string) => Promise<boolean>;
  loadRuntimeConfig?: (options: {
    env?: Record<string, string | undefined>;
  }) => Promise<RuntimeConfig>;
  inspectInitializationState?: (options: {
    config: RuntimeConfig;
  }) => Promise<BootstrapDatabaseState>;
}

export async function resolveStartupState({
  env = process.env,
  fileExists = defaultFileExists,
  loadRuntimeConfig: loadPersistedRuntimeConfig = loadRuntimeConfig,
  inspectInitializationState = ({ config }) => inspectBootstrapDatabaseState({ persistedConfig: config }),
}: ResolveStartupStateOptions = {}): Promise<StartupState> {
  const configPath = env.GAMECLUB_CONFIG_PATH ?? defaultRuntimeConfigPath;
  const tempConfigPath = `${configPath}.tmp`;
  const configExists = await fileExists(configPath);

  if (!configExists) {
    if (await fileExists(tempConfigPath)) {
      return {
        kind: 'ambiguous',
        message:
          `S ha detectat un fitxer temporal de bootstrap a ${tempConfigPath} sense configuracio final a ${configPath}. ` +
          'Revisa i neteja aquest estat abans de tornar a arrencar.',
      };
    }

    return {
      kind: 'fresh',
      message:
        `No s ha trobat cap configuracio runtime a ${configPath}. Cal executar el bootstrap inicial abans d arrencar el servei.`,
    };
  }

  let config: RuntimeConfig;

  try {
    config = await loadPersistedRuntimeConfig({ env });
  } catch (error) {
    if (error instanceof RuntimeConfigError) {
      return {
        kind: 'ambiguous',
        message:
          `La configuracio runtime existent no es valida: ${error.message}. ` +
          'Corregeix-la o restaura una configuracio coherent abans de continuar.',
      };
    }

    throw error;
  }

  let databaseState: BootstrapDatabaseState;

  try {
    databaseState = await inspectInitializationState({ config });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      kind: 'ambiguous',
      message:
        `La configuracio runtime existeix pero no s ha pogut verificar l estat durable d inicialitzacio: ${reason}. ` +
        'Revisa la connectivitat de PostgreSQL i l estat del bootstrap abans de continuar.',
    };
  }

  if (!databaseState.marker) {
    return {
      kind: 'ambiguous',
      message:
        'La configuracio runtime existeix pero falta el marcador durable d inicialitzacio a la base de dades. ' +
        'El sistema podria haver quedat parcialment inicialitzat.',
    };
  }

  if (databaseState.marker.firstAdminTelegramUserId !== config.bootstrap.firstAdmin.telegramUserId) {
    return {
      kind: 'ambiguous',
      message:
        'El marcador durable d inicialitzacio no coincideix amb el primer administrador configurat. ' +
        'No es segur continuar fins revisar manualment aquest estat.',
    };
  }

  if (!databaseState.firstAdminExists) {
    return {
      kind: 'ambiguous',
      message:
        'El marcador d inicialitzacio existeix pero el primer administrador aprovat ja no es present a la base de dades. ' +
        'Cal una recuperacio manual abans de continuar.',
    };
  }

  if (databaseState.approvedAdminCount < 1) {
    return {
      kind: 'ambiguous',
      message:
        'La configuracio runtime existeix pero no hi ha cap administrador aprovat a la base de dades. ' +
        'Aixo indica un estat de bootstrap incomplet o corrupte.',
    };
  }

  return {
    kind: 'initialized',
    message: 'Runtime initialization marker and persisted configuration are consistent',
    config,
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
