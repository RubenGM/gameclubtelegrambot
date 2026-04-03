import pino from 'pino';

import { createApp } from './bootstrap/create-app.js';
import { runService } from './bootstrap/run-service.js';
import { loadRuntimeConfig, RuntimeConfigError } from './config/load-runtime-config.js';
import { InfrastructureStartupError } from './infrastructure/runtime-boundary.js';
import { TelegramStartupError } from './telegram/runtime-boundary.js';

const logger = pino({
  name: 'gameclubtelegrambot',
});

try {
  logger.info({}, 'Runtime configuration loading started');
  const config = await loadRuntimeConfig();
  logger.info({}, 'Runtime configuration loaded');

  process.exitCode = await runService({
    logger,
    createApp: async () => createApp({ config, logger }),
  });
} catch (error) {
  if (error instanceof RuntimeConfigError) {
    logger.fatal({ error: error.message }, 'Startup aborted due to invalid runtime configuration');
    process.exitCode = 1;
  } else if (error instanceof InfrastructureStartupError) {
    logger.fatal({ error: error.message }, 'Startup aborted due to infrastructure initialization failure');
    process.exitCode = 1;
  } else if (error instanceof TelegramStartupError) {
    logger.fatal({ error: error.message }, 'Startup aborted due to Telegram initialization failure');
    process.exitCode = 1;
  } else {
    throw error;
  }
}
