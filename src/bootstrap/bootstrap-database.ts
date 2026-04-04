import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

import type { RuntimeConfig } from '../config/runtime-config.js';
import {
  connectPostgresDatabase,
  createPostgresConnectionString,
  type ConnectDatabaseOptions,
  type DatabaseConnection,
} from '../infrastructure/database/connection.js';
import { users } from '../infrastructure/database/schema.js';

export interface BootstrapDatabaseTransaction {
  countExistingApprovedAdmins(): Promise<number>;
  insertFirstApprovedAdmin(input: {
    telegramUserId: number;
    username?: string | undefined;
    displayName: string;
  }): Promise<void>;
  deleteFirstAdminByTelegramUserId(telegramUserId: number): Promise<void>;
}

export interface BootstrapDatabaseConnection {
  close(): Promise<void>;
  db?: DatabaseConnection['db'];
}

export interface InitializeBootstrapDatabaseOptions {
  persistedConfig: RuntimeConfig;
  connectDatabase?: (options: ConnectDatabaseOptions) => Promise<BootstrapDatabaseConnection>;
  runMigrations?: (connection: BootstrapDatabaseConnection, config: RuntimeConfig) => Promise<void>;
  runInTransaction?: (
    connection: BootstrapDatabaseConnection,
    handler: (tx: BootstrapDatabaseTransaction) => Promise<void>,
  ) => Promise<void>;
}

export interface RollbackBootstrapDatabaseInitializationOptions {
  persistedConfig: RuntimeConfig;
  connectDatabase?: (options: ConnectDatabaseOptions) => Promise<BootstrapDatabaseConnection>;
  runInTransaction?: (
    connection: BootstrapDatabaseConnection,
    handler: (tx: BootstrapDatabaseTransaction) => Promise<void>,
  ) => Promise<void>;
}

export class BootstrapDatabaseInitializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootstrapDatabaseInitializationError';
  }
}

export async function initializeBootstrapDatabase({
  persistedConfig,
  connectDatabase = connectPostgresDatabase,
  runMigrations = defaultRunMigrations,
  runInTransaction = defaultRunInTransaction,
}: InitializeBootstrapDatabaseOptions): Promise<void> {
  const connection = await connectDatabase({
    connectionString: createPostgresConnectionString(persistedConfig.database),
    ssl: persistedConfig.database.ssl,
    logger: {
      error: () => {},
    },
  });

  try {
    await runMigrations(connection, persistedConfig);
    await runInTransaction(connection, async (tx) => {
      const existingApprovedAdmins = await tx.countExistingApprovedAdmins();

      if (existingApprovedAdmins > 0) {
        throw new BootstrapDatabaseInitializationError(
          'Bootstrap target database already contains an approved administrator',
        );
      }

      await tx.insertFirstApprovedAdmin(persistedConfig.bootstrap.firstAdmin);
    });
  } finally {
    await connection.close();
  }
}

export async function rollbackBootstrapDatabaseInitialization({
  persistedConfig,
  connectDatabase = connectPostgresDatabase,
  runInTransaction = defaultRunInTransaction,
}: RollbackBootstrapDatabaseInitializationOptions): Promise<void> {
  const connection = await connectDatabase({
    connectionString: createPostgresConnectionString(persistedConfig.database),
    ssl: persistedConfig.database.ssl,
    logger: {
      error: () => {},
    },
  });

  try {
    await runInTransaction(connection, async (tx) => {
      await tx.deleteFirstAdminByTelegramUserId(
        persistedConfig.bootstrap.firstAdmin.telegramUserId,
      );
    });
  } finally {
    await connection.close();
  }
}

async function defaultRunMigrations(
  connection: BootstrapDatabaseConnection,
  _config: RuntimeConfig,
): Promise<void> {
  if (!connection.db) {
    throw new Error('Bootstrap database connection does not expose a Drizzle instance');
  }

  await migrate(connection.db, {
    migrationsFolder: 'drizzle',
  });
}

async function defaultRunInTransaction(
  connection: BootstrapDatabaseConnection,
  handler: (tx: BootstrapDatabaseTransaction) => Promise<void>,
): Promise<void> {
  if (!connection.db) {
    throw new Error('Bootstrap database connection does not expose a Drizzle instance');
  }

  await connection.db.transaction(async (transaction) => {
    const tx: BootstrapDatabaseTransaction = {
      async countExistingApprovedAdmins() {
        const result = await transaction
          .select({ count: sql<number>`count(*)` })
          .from(users)
          .where(eq(users.isApproved, true));

        return Number(result[0]?.count ?? 0);
      },
      async insertFirstApprovedAdmin(input) {
        await transaction.insert(users).values({
          telegramUserId: input.telegramUserId,
          ...(input.username !== undefined ? { username: input.username } : {}),
          displayName: input.displayName,
          isApproved: true,
          isAdmin: true,
          approvedAt: new Date(),
        });
      },
      async deleteFirstAdminByTelegramUserId(telegramUserId) {
        await transaction.delete(users).where(eq(users.telegramUserId, telegramUserId));
      },
    };

    await handler(tx);
  });
}
