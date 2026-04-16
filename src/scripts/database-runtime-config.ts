import type { RuntimeConfig } from '../config/runtime-config.js';

export function formatDatabaseRuntimeConfig(config: RuntimeConfig): string {
  return [
    config.database.host,
    String(config.database.port),
    config.database.name,
    config.database.user,
    config.database.password,
  ].join('\n').concat('\n');
}
