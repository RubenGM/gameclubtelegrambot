import { connectPostgresDatabase, createPostgresConnectionString } from '../infrastructure/database/connection.js';
import type { RuntimeConfig } from '../config/runtime-config.js';

import type { ConnectedDatabaseSummary } from './backup-types.js';

export interface DatabaseSummaryClient {
  query(sqlText: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  close(): Promise<void>;
}

export async function readDatabaseSummaryForConfig({
  config,
  connect = connectDatabaseSummaryClient,
}: {
  config: RuntimeConfig;
  connect?: (config: RuntimeConfig) => Promise<DatabaseSummaryClient>;
}): Promise<ConnectedDatabaseSummary> {
  const client = await connect(config);

  try {
    const sizeResult = await client.query(
      `select pg_database_size(current_database())::bigint as size_bytes`,
    );
    const tableResult = await client.query(
      `select table_name
       from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
       order by table_name`,
    );

    const knownTableCounts: ConnectedDatabaseSummary['knownTableCounts'] = [];
    for (const tableName of knownSummaryTables.filter((candidate) =>
      tableResult.rows.some((row) => row.table_name === candidate),
    )) {
      try {
        const countResult = await client.query(
          `select count(*)::bigint as row_count from "${tableName}"`,
        );
        const rowCount = Number(String(countResult.rows[0]?.row_count ?? '0'));
        knownTableCounts.push({ tableName, rowCount });
      } catch {
        // Optional count failures should not hide the rest of the summary.
      }
    }

    return {
      state: 'connected',
      host: config.database.host,
      port: config.database.port,
      databaseName: config.database.name,
      sizeBytes: Number(String(sizeResult.rows[0]?.size_bytes ?? '0')),
      totalTables: tableResult.rows.length,
      knownTableCounts,
    };
  } finally {
    await client.close();
  }
}

const knownSummaryTables = [
  'users',
  'catalog_items',
  'catalog_loans',
  'schedule_events',
  'venue_events',
  'club_tables',
] as const;

async function connectDatabaseSummaryClient(config: RuntimeConfig): Promise<DatabaseSummaryClient> {
  const database = await connectPostgresDatabase({
    connectionString: createPostgresConnectionString(config.database),
    ssl: config.database.ssl,
    logger: {
      error() {
        // Best effort summary logger; operator-facing errors surface at the boundary.
      },
    },
  });

  return {
    async query(sqlText: string) {
      const result = await database.pool.query(sqlText);
      return {
        rows: result.rows as Array<Record<string, unknown>>,
      };
    },
    async close() {
      await database.close();
    },
  };
}
