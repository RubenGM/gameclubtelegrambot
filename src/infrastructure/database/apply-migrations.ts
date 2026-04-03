import { migrate } from 'drizzle-orm/node-postgres/migrator';

import type { RuntimeConfig } from '../../config/runtime-config.js';

import {
  connectPostgresDatabase,
  createPostgresConnectionString,
  type DatabaseConnection,
  type ConnectDatabaseOptions,
} from './connection.js';

export interface ApplyMigrationsOptions {
  config: RuntimeConfig;
  connectDatabase?: (options: ConnectDatabaseOptions) => Promise<MigrationDatabaseConnection>;
  runMigrations?: (connection: MigrationDatabaseConnection) => Promise<void>;
}

export interface MigrationDatabaseConnection {
  db?: DatabaseConnection['db'];
  close(): Promise<void>;
}

export async function applyMigrations({
  config,
  connectDatabase = connectPostgresDatabase,
  runMigrations = defaultRunMigrations,
}: ApplyMigrationsOptions): Promise<void> {
  const connection = await connectDatabase({
    connectionString: createPostgresConnectionString(config.database),
    ssl: config.database.ssl,
    logger: {
      error: () => {},
    },
  });

  try {
    await runMigrations(connection);
  } finally {
    await connection.close();
  }
}

async function defaultRunMigrations(connection: MigrationDatabaseConnection): Promise<void> {
  if (!connection.db) {
    throw new Error('Migration connection does not expose a Drizzle database instance');
  }

  await migrate(connection.db, {
    migrationsFolder: 'drizzle',
  });
}
