import { and, eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

import type { RuntimeConfig } from '../config/runtime-config.js';
import {
  connectPostgresDatabase,
  createPostgresConnectionString,
  type ConnectDatabaseOptions,
  type DatabaseConnection,
} from '../infrastructure/database/connection.js';
import { appMetadata, users } from '../infrastructure/database/schema.js';

export const bootstrapInitializationMarkerKey = 'bootstrap.initialization';

export interface BootstrapInitializationMarker {
  firstAdminTelegramUserId: number;
}

export interface BootstrapDatabaseState {
  marker: BootstrapInitializationMarker | null;
  firstAdminExists: boolean;
  approvedAdminCount: number;
}

export interface BootstrapDatabaseTransaction {
  countExistingApprovedAdmins(): Promise<number>;
  hasApprovedAdmin(telegramUserId: number): Promise<boolean>;
  insertFirstApprovedAdmin(input: {
    telegramUserId: number;
    username?: string | undefined;
    displayName: string;
  }): Promise<void>;
  setInitializationMarker(input: BootstrapInitializationMarker): Promise<void>;
  clearInitializationMarker(): Promise<void>;
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

export interface InspectBootstrapDatabaseStateOptions {
  persistedConfig: RuntimeConfig;
  connectDatabase?: (options: ConnectDatabaseOptions) => Promise<BootstrapDatabaseConnection>;
}

export type EnsureBootstrapDatabaseInitializationOutcome =
  | 'initialized'
  | 'repaired-marker'
  | 'already-initialized';

export interface EnsureBootstrapDatabaseInitializationOptions {
  persistedConfig: RuntimeConfig;
  inspectState?: (options: InspectBootstrapDatabaseStateOptions) => Promise<BootstrapDatabaseState>;
  initializeDatabase?: (options: InitializeBootstrapDatabaseOptions) => Promise<void>;
  repairMarker?: (options: RepairBootstrapInitializationMarkerOptions) => Promise<void>;
}

export interface RepairBootstrapInitializationMarkerOptions {
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
      await tx.setInitializationMarker({
        firstAdminTelegramUserId: persistedConfig.bootstrap.firstAdmin.telegramUserId,
      });
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
      await tx.clearInitializationMarker();
      await tx.deleteFirstAdminByTelegramUserId(
        persistedConfig.bootstrap.firstAdmin.telegramUserId,
      );
    });
  } finally {
    await connection.close();
  }
}

export async function ensureBootstrapDatabaseInitialization({
  persistedConfig,
  inspectState = inspectBootstrapDatabaseState,
  initializeDatabase = initializeBootstrapDatabase,
  repairMarker = repairBootstrapInitializationMarker,
}: EnsureBootstrapDatabaseInitializationOptions): Promise<EnsureBootstrapDatabaseInitializationOutcome> {
  const state = await inspectState({ persistedConfig });

  if (
    state.marker?.firstAdminTelegramUserId === persistedConfig.bootstrap.firstAdmin.telegramUserId &&
    state.firstAdminExists &&
    state.approvedAdminCount >= 1
  ) {
    return 'already-initialized';
  }

  if (!state.marker && !state.firstAdminExists && state.approvedAdminCount === 0) {
    await initializeDatabase({ persistedConfig });
    return 'initialized';
  }

  if (!state.marker && state.firstAdminExists && state.approvedAdminCount >= 1) {
    await repairMarker({ persistedConfig });
    return 'repaired-marker';
  }

  throw new BootstrapDatabaseInitializationError(
    'Bootstrap database state is inconsistent and cannot be repaired automatically',
  );
}

export async function inspectBootstrapDatabaseState({
  persistedConfig,
  connectDatabase = connectPostgresDatabase,
}: InspectBootstrapDatabaseStateOptions): Promise<BootstrapDatabaseState> {
  const connection = await connectDatabase({
    connectionString: createPostgresConnectionString(persistedConfig.database),
    ssl: persistedConfig.database.ssl,
    logger: {
      error: () => {},
    },
  });

  try {
    if (!connection.db) {
      throw new Error('Bootstrap database connection does not expose a Drizzle instance');
    }

    const markerResult = await connection.db
      .select({ value: appMetadata.value })
      .from(appMetadata)
      .where(eq(appMetadata.key, bootstrapInitializationMarkerKey));
    const approvedAdminCountResult = await connection.db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(eq(users.isApproved, true));
    const firstAdminResult = await connection.db
      .select({ telegramUserId: users.telegramUserId })
      .from(users)
      .where(
        and(
          eq(users.telegramUserId, persistedConfig.bootstrap.firstAdmin.telegramUserId),
          eq(users.isApproved, true),
          eq(users.isAdmin, true),
        ),
      );

    return {
      marker: parseInitializationMarker(markerResult[0]?.value),
      firstAdminExists: firstAdminResult.length > 0,
      approvedAdminCount: Number(approvedAdminCountResult[0]?.count ?? 0),
    };
  } finally {
    await connection.close();
  }
}

export async function repairBootstrapInitializationMarker({
  persistedConfig,
  connectDatabase = connectPostgresDatabase,
  runInTransaction = defaultRunInTransaction,
}: RepairBootstrapInitializationMarkerOptions): Promise<void> {
  const connection = await connectDatabase({
    connectionString: createPostgresConnectionString(persistedConfig.database),
    ssl: persistedConfig.database.ssl,
    logger: {
      error: () => {},
    },
  });

  try {
    await runInTransaction(connection, async (tx) => {
      await tx.setInitializationMarker({
        firstAdminTelegramUserId: persistedConfig.bootstrap.firstAdmin.telegramUserId,
      });
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
      async hasApprovedAdmin(telegramUserId) {
        const result = await transaction
          .select({ telegramUserId: users.telegramUserId })
          .from(users)
          .where(
            and(
              eq(users.telegramUserId, telegramUserId),
              eq(users.isApproved, true),
              eq(users.isAdmin, true),
            ),
          );

        return result.length > 0;
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
      async setInitializationMarker(input) {
        await transaction
          .insert(appMetadata)
          .values({
            key: bootstrapInitializationMarkerKey,
            value: JSON.stringify(input),
          })
          .onConflictDoUpdate({
            target: appMetadata.key,
            set: {
              value: JSON.stringify(input),
              updatedAt: sql`now()`,
            },
          });
      },
      async clearInitializationMarker() {
        await transaction.delete(appMetadata).where(eq(appMetadata.key, bootstrapInitializationMarkerKey));
      },
      async deleteFirstAdminByTelegramUserId(telegramUserId) {
        await transaction.delete(users).where(eq(users.telegramUserId, telegramUserId));
      },
    };

    await handler(tx);
  });
}

function parseInitializationMarker(rawValue: string | undefined): BootstrapInitializationMarker | null {
  if (!rawValue) {
    return null;
  }

  const parsedValue: unknown = JSON.parse(rawValue);

  if (
    typeof parsedValue === 'object' &&
    parsedValue !== null &&
    'firstAdminTelegramUserId' in parsedValue &&
    typeof parsedValue.firstAdminTelegramUserId === 'number'
  ) {
    return {
      firstAdminTelegramUserId: parsedValue.firstAdminTelegramUserId,
    };
  }

  throw new Error('Bootstrap initialization marker contains invalid JSON payload');
}
