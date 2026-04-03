import type { RuntimeConfig } from '../config/runtime-config.js';

import {
  connectPostgresDatabase,
  createPostgresConnectionString,
  type DatabaseConnection,
  type ConnectDatabaseOptions,
} from './database/connection.js';

export interface InfrastructureBoundaryStatus {
  database: 'connected';
}

export interface InfrastructureBoundary {
  status: InfrastructureBoundaryStatus;
  stop(): Promise<void>;
}

export interface InfrastructureLogger {
  info(bindings: object, message: string): void;
  error(bindings: object, message: string): void;
}

export interface CreateInfrastructureBoundaryOptions {
  config: RuntimeConfig;
  logger: InfrastructureLogger;
  connectDatabase?: (options: ConnectDatabaseOptions) => Promise<DatabaseConnection>;
}

export class InfrastructureStartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InfrastructureStartupError';
  }
}

export async function createInfrastructureBoundary({
  config,
  logger,
  connectDatabase = connectPostgresDatabase,
}: CreateInfrastructureBoundaryOptions): Promise<InfrastructureBoundary> {
  const connectionString = createPostgresConnectionString(config.database);

  try {
    const database = await connectDatabase({
      connectionString,
      ssl: config.database.ssl,
      logger,
    });

    logger.info(
      {
        database: {
          host: config.database.host,
          port: config.database.port,
          name: config.database.name,
          ssl: config.database.ssl,
        },
      },
      'Database connection established',
    );

    return {
      status: {
        database: 'connected',
      },
      async stop() {
        await database.close();
        logger.info({}, 'Database connection closed');
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown database startup error';

    logger.error(
      {
        database: {
          host: config.database.host,
          port: config.database.port,
          name: config.database.name,
          ssl: config.database.ssl,
        },
        error: reason,
      },
      'Database startup failed',
    );

    throw new InfrastructureStartupError(`Database connection failed: ${reason}`);
  }
}
