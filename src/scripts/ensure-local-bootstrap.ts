import pino from 'pino';

import {
  BootstrapDatabaseInitializationError,
  ensureBootstrapDatabaseInitialization,
} from '../bootstrap/bootstrap-database.js';
import { loadRuntimeConfig, RuntimeConfigError } from '../config/load-runtime-config.js';
import { InfrastructureStartupError } from '../infrastructure/runtime-boundary.js';

const logger = pino({
  name: 'gameclubtelegrambot',
});

try {
  const config = await loadRuntimeConfig();
  const outcome = await ensureBootstrapDatabaseInitialization({
    persistedConfig: config,
  });

  logger.info({ outcome }, 'Local bootstrap database state ensured successfully');
} catch (error) {
  if (error instanceof RuntimeConfigError) {
    logger.fatal({ error: error.message }, 'Local bootstrap ensure aborted due to invalid runtime configuration');
    process.exitCode = 1;
  } else if (error instanceof InfrastructureStartupError) {
    logger.fatal({ error: error.message }, 'Local bootstrap ensure aborted due to database initialization failure');
    process.exitCode = 1;
  } else if (error instanceof BootstrapDatabaseInitializationError) {
    logger.fatal({ error: error.message }, 'Local bootstrap ensure aborted due to inconsistent database state');
    process.exitCode = 1;
  } else if (error instanceof Error) {
    logger.fatal({ error: error.message }, 'Local bootstrap ensure aborted due to an unexpected error');
    process.exitCode = 1;
  } else {
    throw error;
  }
}
