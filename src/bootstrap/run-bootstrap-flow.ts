import type { RuntimeConfig } from '../config/runtime-config.js';
import { defaultRuntimeConfigPath } from '../config/runtime-config.js';
import {
  initializeBootstrapDatabase,
  rollbackBootstrapDatabaseInitialization,
} from './bootstrap-database.js';
import { BootstrapInitializationError, initializeSystemFromCandidate } from './initialize-system.js';
import { resolveStartupState, type StartupState } from './resolve-startup-state.js';
import { loadWizardDefaults } from './wizard/default-wizard-values.js';
import { runBootstrapWizard, type WizardIo } from './wizard/run-bootstrap-wizard.js';
import { createTerminalWizardIo } from './wizard/terminal-wizard-io.js';

export interface BootstrapFlowLogger {
  info(bindings: object, message: string): void;
}

export interface RunBootstrapFlowOptions {
  logger: BootstrapFlowLogger;
  env?: Record<string, string | undefined>;
  createIo?: () => WizardIo;
  resolveStartupState?: (options: { env?: Record<string, string | undefined> }) => Promise<StartupState>;
}

export async function runBootstrapFlow({
  logger,
  env = process.env,
  createIo = createTerminalWizardIo,
  resolveStartupState: detectStartupState = ({ env: runtimeEnv }) =>
    resolveStartupState(runtimeEnv ? { env: runtimeEnv } : {}),
}: RunBootstrapFlowOptions): Promise<RuntimeConfig | null> {
  const startupState = await detectStartupState({ env });

  if (startupState.kind === 'initialized') {
    throw new BootstrapInitializationError(
      'El sistema ja esta inicialitzat. El bootstrap no es pot tornar a executar accidentalment.',
    );
  }

  if (startupState.kind === 'ambiguous') {
    throw new BootstrapInitializationError(
      `S ha bloquejat el bootstrap per un estat ambigu previ: ${startupState.message}`,
    );
  }

  const io = createIo();

  try {
    const defaults = await loadWizardDefaults();
    const result = await runBootstrapWizard({ defaults, io });

    if (!result) {
      logger.info({}, 'Bootstrap wizard cancelled by the operator before persistence');
      return null;
    }

    const configPath = env.GAMECLUB_CONFIG_PATH ?? defaultRuntimeConfigPath;
    const initialization = await initializeSystemFromCandidate({
      candidate: result,
      configPath,
      logger: {
        info: logger.info.bind(logger),
        error: () => {},
      },
      initializeDatabase: async ({ persistedConfig }) => {
        await initializeBootstrapDatabase({ persistedConfig });
      },
      rollbackDatabaseInitialization: async ({ persistedConfig }) => {
        await rollbackBootstrapDatabaseInitialization({ persistedConfig });
      },
    });

    logger.info(
      {
        configPath,
        firstAdminTelegramUserId: initialization.config.bootstrap.firstAdmin.telegramUserId,
      },
      'Bootstrap wizard completed and persisted the initialized system',
    );

    return initialization.config;
  } finally {
    await io.close?.();
  }
}
