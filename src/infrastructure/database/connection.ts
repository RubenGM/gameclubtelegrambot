import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import type { RuntimeConfig } from '../../config/runtime-config.js';

export interface DatabaseLogger {
  error(bindings: object, message: string): void;
}

export interface ConnectDatabaseOptions {
  connectionString: string;
  ssl: boolean;
  logger: DatabaseLogger;
}

export interface DatabaseConnection {
  pool: Pool;
  db: NodePgDatabase;
  close(): Promise<void>;
}

export function createPostgresConnectionString(
  databaseConfig: RuntimeConfig['database'],
): string {
  const user = encodeURIComponent(databaseConfig.user);
  const password = encodeURIComponent(databaseConfig.password);
  const host = databaseConfig.host;
  const port = databaseConfig.port;
  const name = encodeURIComponent(databaseConfig.name);

  return `postgresql://${user}:${password}@${host}:${port}/${name}`;
}

export async function connectPostgresDatabase({
  connectionString,
  ssl,
  logger,
}: ConnectDatabaseOptions): Promise<DatabaseConnection> {
  const pool = new Pool({
    connectionString,
    ssl,
  });

  pool.on('error', (error: Error) => {
    logger.error({ error: error.message }, 'Unexpected PostgreSQL pool error');
  });

  await pool.query('select 1');

  return {
    pool,
    db: drizzle(pool),
    async close() {
      await pool.end();
    },
  };
}
