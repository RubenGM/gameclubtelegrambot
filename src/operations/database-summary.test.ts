import test from 'node:test';
import assert from 'node:assert/strict';

import type { RuntimeConfig } from '../config/runtime-config.js';

import { readDatabaseSummaryForConfig } from './database-summary.js';

const runtimeConfig: RuntimeConfig = {
  schemaVersion: 1,
  bot: {
    publicName: 'Game Club Bot',
    clubName: 'Game Club',
    language: 'es',
  },
  telegram: {
    token: 'telegram-token',
  },
  database: {
    host: '127.0.0.1',
    port: 55432,
    name: 'gameclub',
    user: 'gameclub_user',
    password: 'secret-password',
    ssl: false,
  },
  adminElevation: {
    passwordHash: 'hash',
  },
  bootstrap: {
    firstAdmin: {
      telegramUserId: 1,
      username: 'club_admin',
      displayName: 'Club Administrator',
    },
  },
  notifications: {
    defaults: {
      groupAnnouncementsEnabled: true,
      eventRemindersEnabled: true,
      eventReminderLeadHours: 24,
    },
  },
  featureFlags: {},
};

test('readDatabaseSummaryForConfig returns database size, table count and known row counts', async () => {
  const queries: string[] = [];
  const summary = await readDatabaseSummaryForConfig({
    config: runtimeConfig,
    connect: async () => ({
      async query(sqlText: string) {
        queries.push(sqlText);

        if (sqlText.includes('pg_database_size')) {
          return {
            rows: [{ size_bytes: '4096' }],
          };
        }

        if (sqlText.includes('information_schema.tables')) {
          return {
            rows: [
              { table_name: 'users' },
              { table_name: 'catalog_items' },
              { table_name: 'catalog_loans' },
              { table_name: 'schedule_events' },
            ],
          };
        }

        if (sqlText.includes('from "users"')) {
          return { rows: [{ row_count: '12' }] };
        }

        if (sqlText.includes('from "catalog_items"')) {
          return { rows: [{ row_count: '34' }] };
        }

        if (sqlText.includes('from "catalog_loans"')) {
          return { rows: [{ row_count: '5' }] };
        }

        if (sqlText.includes('from "schedule_events"')) {
          return { rows: [{ row_count: '8' }] };
        }

        throw new Error(`Unexpected query: ${sqlText}`);
      },
      async close() {
        queries.push('close');
      },
    }),
  });

  assert.deepEqual(summary, {
    state: 'connected',
    host: '127.0.0.1',
    port: 55432,
    databaseName: 'gameclub',
    sizeBytes: 4096,
    totalTables: 4,
    knownTableCounts: [
      { tableName: 'users', rowCount: 12 },
      { tableName: 'catalog_items', rowCount: 34 },
      { tableName: 'catalog_loans', rowCount: 5 },
      { tableName: 'schedule_events', rowCount: 8 },
    ],
  });
  assert.equal(queries.at(-1), 'close');
});

test('readDatabaseSummaryForConfig skips optional table counts that fail individually', async () => {
  const summary = await readDatabaseSummaryForConfig({
    config: runtimeConfig,
    connect: async () => ({
      async query(sqlText: string) {
        if (sqlText.includes('pg_database_size')) {
          return {
            rows: [{ size_bytes: '2048' }],
          };
        }

        if (sqlText.includes('information_schema.tables')) {
          return {
            rows: [
              { table_name: 'users' },
              { table_name: 'venue_events' },
            ],
          };
        }

        if (sqlText.includes('from "users"')) {
          throw new Error('permission denied');
        }

        if (sqlText.includes('from "venue_events"')) {
          return { rows: [{ row_count: '3' }] };
        }

        throw new Error(`Unexpected query: ${sqlText}`);
      },
      async close() {
        // no-op
      },
    }),
  });

  assert.deepEqual(summary, {
    state: 'connected',
    host: '127.0.0.1',
    port: 55432,
    databaseName: 'gameclub',
    sizeBytes: 2048,
    totalTables: 2,
    knownTableCounts: [{ tableName: 'venue_events', rowCount: 3 }],
  });
});
