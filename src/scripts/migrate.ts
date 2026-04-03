import pino from 'pino';

import { loadRuntimeConfig, RuntimeConfigError } from '../config/load-runtime-config.js';
import { applyMigrations } from '../infrastructure/database/apply-migrations.js';
import { InfrastructureStartupError } from '../infrastructure/runtime-boundary.js';

const logger = pino({
  name: 'gameclubtelegrambot',
});

try {
  const config = await loadRuntimeConfig();
  await applyMigrations({ config });
  logger.info({}, 'Database migrations applied successfully');
} catch (error) {
  if (error instanceof RuntimeConfigError) {
    logger.fatal({ error: error.message }, 'Migration aborted due to invalid runtime configuration');
    process.exitCode = 1;
  } else if (error instanceof InfrastructureStartupError) {
    logger.fatal({ error: error.message }, 'Migration aborted due to database initialization failure');
    process.exitCode = 1;
  } else if (error instanceof Error) {
    logger.fatal({ error: error.message }, 'Migration aborted due to an unexpected error');
    process.exitCode = 1;
  } else {
    throw error;
  }
}
