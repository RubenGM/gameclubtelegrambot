import { createApp } from './bootstrap/create-app.js';
import type { RunServiceOptions } from './bootstrap/run-service.js';
import {
  BootstrapDatabaseInitializationError,
} from './bootstrap/bootstrap-database.js';
import { BootstrapInitializationError } from './bootstrap/initialize-system.js';
import { runBootstrapFlow } from './bootstrap/run-bootstrap-flow.js';
import { resolveStartupState, type StartupState } from './bootstrap/resolve-startup-state.js';
import { RuntimeConfigError } from './config/load-runtime-config.js';
import type { RuntimeConfig } from './config/runtime-config.js';
import { InfrastructureStartupError } from './infrastructure/runtime-boundary.js';
import { TelegramStartupError } from './telegram/runtime-boundary.js';
import { runService, type RunnableApp, type ServiceLogger } from './bootstrap/run-service.js';

export interface MainLogger extends ServiceLogger {
  fatal(bindings: object, message: string): void;
}

export interface RunMainOptions {
  env?: Record<string, string | undefined>;
  logger: MainLogger;
  resolveStartupState?: (options: { env?: Record<string, string | undefined> }) => Promise<StartupState>;
  runBootstrap?: (options: {
    logger: MainLogger;
    env?: Record<string, string | undefined>;
  }) => Promise<RuntimeConfig | null>;
  runService?: (options: RunServiceOptions) => Promise<number>;
  createApp?: (options: { config: RuntimeConfig; logger: MainLogger }) => RunnableApp;
  isInteractive?: () => boolean;
}

export async function runMain({
  env = process.env,
  logger,
  resolveStartupState: detectStartupState = ({ env: runtimeEnv }) =>
    resolveStartupState(runtimeEnv ? { env: runtimeEnv } : {}),
  runBootstrap = ({ logger: bootstrapLogger, env: bootstrapEnv }) =>
    runBootstrapFlow(bootstrapEnv ? { logger: bootstrapLogger, env: bootstrapEnv } : { logger: bootstrapLogger }),
  runService: executeService = runService,
  createApp: buildApp = ({ config, logger: appLogger }) => createApp({ config, logger: appLogger }),
  isInteractive = () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
}: RunMainOptions): Promise<number> {
  try {
    const startupState = await detectStartupState({ env });

    if (startupState.kind === 'ambiguous') {
      logger.fatal({}, startupState.message);
      return 1;
    }

    let config: RuntimeConfig | null;

    if (startupState.kind === 'fresh') {
      if (!isInteractive()) {
        logger.fatal({}, 'Startup requires interactive bootstrap but no TTY is available');
        return 1;
      }

      logger.info({}, 'Startup state requires bootstrap flow');
      config = await runBootstrap({ logger, env });

      if (!config) {
        logger.info({}, 'Bootstrap flow finished without persisting configuration');
        return 0;
      }
    } else {
      config = startupState.config;
    }

    return await executeService({
      logger,
      createApp: async () => buildApp({ config, logger }),
    });
  } catch (error) {
    if (error instanceof RuntimeConfigError) {
      logger.fatal({ error: error.message }, 'Startup aborted due to invalid runtime configuration');
      return 1;
    }

    if (error instanceof InfrastructureStartupError) {
      logger.fatal({ error: error.message }, 'Startup aborted due to infrastructure initialization failure');
      return 1;
    }

    if (error instanceof TelegramStartupError) {
      logger.fatal({ error: error.message }, 'Startup aborted due to Telegram initialization failure');
      return 1;
    }

    if (error instanceof BootstrapInitializationError) {
      logger.fatal({ error: error.message }, 'Startup aborted due to bootstrap persistence failure');
      return 1;
    }

    if (error instanceof BootstrapDatabaseInitializationError) {
      logger.fatal({ error: error.message }, 'Startup aborted due to bootstrap database initialization failure');
      return 1;
    }

    throw error;
  }
}
