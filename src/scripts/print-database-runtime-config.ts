import { loadRuntimeConfig, RuntimeConfigError } from '../config/load-runtime-config.js';

import { formatDatabaseRuntimeConfig } from './database-runtime-config.js';

try {
  const config = await loadRuntimeConfig();
  process.stdout.write(formatDatabaseRuntimeConfig(config));
} catch (error) {
  if (error instanceof RuntimeConfigError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } else if (error instanceof Error) {
    process.stderr.write(`Could not print database runtime configuration: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
