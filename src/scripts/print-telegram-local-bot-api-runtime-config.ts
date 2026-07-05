import { loadRuntimeConfig, RuntimeConfigError } from '../config/load-runtime-config.js';

import { formatTelegramLocalBotApiRuntimeConfig } from './telegram-local-bot-api-runtime-config.js';

try {
  const config = await loadRuntimeConfig();
  process.stdout.write(formatTelegramLocalBotApiRuntimeConfig(config));
} catch (error) {
  if (error instanceof RuntimeConfigError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } else if (error instanceof Error) {
    process.stderr.write(`Could not print local Telegram Bot API runtime configuration: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
