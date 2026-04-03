import type { RuntimeConfig } from '../config/runtime-config.js';

import {
  connectPostgresDatabase,
  createPostgresConnectionString,
  type ConnectDatabaseOptions,
} from './database/connection.js';

export interface InfrastructureBoundaryStatus {
  database: 'connected';
}

export interface InfrastructureLogger {
  info(bindings: object, message: string): void;
  error(bindings: object, message: string): void;
}

export interface CreateInfrastructureBoundaryOptions {
  config: RuntimeConfig;
  logger: InfrastructureLogger;
  connectDatabase?: (options: ConnectDatabaseOptions) => Promise<unknown>;
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
}: CreateInfrastructureBoundaryOptions): Promise<InfrastructureBoundaryStatus> {
  const connectionString = createPostgresConnectionString(config.database);

  try {
    await connectDatabase({
      connectionString,
      ssl: config.database.ssl,
      logger,
    });
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
    database: 'connected',
  };
}
