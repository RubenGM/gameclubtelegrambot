import pino from 'pino';

import { loadRuntimeConfig, RuntimeConfigError } from '../config/load-runtime-config.js';

const logger = pino({
  name: 'gameclubtelegrambot',
});

try {
  const config = await loadRuntimeConfig();
  logger.info(
    {
      configPath: process.env.GAMECLUB_CONFIG_PATH,
      publicName: config.bot.publicName,
      databaseHost: config.database.host,
      databaseName: config.database.name,
    },
    'Runtime configuration validated successfully',
  );
} catch (error) {
  if (error instanceof RuntimeConfigError) {
    logger.fatal({ error: error.message }, 'Runtime configuration validation failed');
    process.exitCode = 1;
  } else if (error instanceof Error) {
    logger.fatal({ error: error.message }, 'Runtime configuration check aborted due to an unexpected error');
    process.exitCode = 1;
  } else {
    throw error;
  }
}
