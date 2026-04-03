import pino from 'pino';

import { createApp } from './bootstrap/create-app.js';
import { loadRuntimeConfig, RuntimeConfigError } from './config/load-runtime-config.js';

const logger = pino({
  name: 'gameclubtelegrambot',
});

try {
  const config = await loadRuntimeConfig();
  const app = createApp({ config, logger });

  await app.start();
} catch (error) {
  if (error instanceof RuntimeConfigError) {
    logger.fatal({ error: error.message }, 'Startup aborted due to invalid runtime configuration');
    process.exitCode = 1;
  } else {
    throw error;
  }
}
