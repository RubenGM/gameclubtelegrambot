import test from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/pg-proxy';

import { auditLog, printJobs, userPermissionAssignments, userPermissionAuditLog, users } from '../infrastructure/database/schema.js';
import { createDatabasePrintPermissionRepository, printPermissionKey } from './print-permissions.js';

const usersTable = users as unknown;
const permissionAssignmentsTable = userPermissionAssignments as unknown;
const permissionAuditLogTable = userPermissionAuditLog as unknown;
const auditLogTable = auditLog as unknown;
const printJobsTable = printJobs as unknown;

test('createDatabasePrintPermissionRepository grants global print permission', async () => {
  const state = createState();
  const repository = createDatabasePrintPermissionRepository({
    database: createPrintPermissionDatabaseDouble(state),
  });

  await repository.grantPrintPermission({
    subjectTelegramUserId: 77,
    changedByTelegramUserId: 42,
  });

  assert.deepEqual(state.assignmentRows, [{
    subjectTelegramUserId: 77,
    permissionKey: printPermissionKey,
    scopeType: 'global',
    resourceType: null,
    resourceId: null,
    effect: 'allow',
    grantedByTelegramUserId: 42,
    reason: 'printing-permission',
  }]);
  assert.equal(state.permissionAuditRows[0]?.nextEffect, 'allow');
  assert.equal(state.auditRows[0]?.actionKey, 'printing.permission.granted');
});

test('createDatabasePrintPermissionRepository revokes existing global print permission', async () => {
  const state = createState({
    assignmentRows: [{
      subjectTelegramUserId: 77,
      permissionKey: printPermissionKey,
      scopeType: 'global',
      resourceType: null,
      resourceId: null,
      effect: 'allow',
    }],
  });
  const repository = createDatabasePrintPermissionRepository({
    database: createPrintPermissionDatabaseDouble(state),
  });

  await repository.revokePrintPermission({
    subjectTelegramUserId: 77,
    changedByTelegramUserId: 42,
  });

  assert.equal(state.assignmentRows.length, 1);
  assert.equal(state.assignmentRows[0]?.effect, 'deny');
  assert.equal(state.permissionAuditRows[0]?.previousEffect, 'allow');
  assert.equal(state.permissionAuditRows[0]?.nextEffect, 'deny');
  assert.equal(state.auditRows[0]?.actionKey, 'printing.permission.revoked');
});

test('print access lists include default members and select only denials for restoration', async () => {
  const queries: Array<{ query: string; params: unknown[] }> = [];
  const database = drizzle(async (query, params) => {
    queries.push({ query, params });
    return { rows: [] };
  });
  const repository = createDatabasePrintPermissionRepository({ database: database as never });
  await repository.listAllowedUsers();
  await repository.listGrantableUsers();
  assert.match(queries[0]!.query, /from "users"/);
  assert.match(queries[0]!.query, /not exists/);
  assert.match(queries[1]!.query, /exists/);
  assert.doesNotMatch(queries[1]!.query, /not exists/);
  for (const { query, params } of queries) {
    assert.match(query, /"user_permission_assignments"\."subject_telegram_user_id" = "users"\."telegram_user_id"/);
    assert.deepEqual(params, ['approved', false, 'printing.use', 'global', 'deny']);
  }
});

test('print statistics aggregate copies and logical pages and exclude simulated jobs', async () => {
  let queryText = '';
  const database = drizzle(async (query) => {
    queryText = query;
    return { rows: [] };
  });
  await createDatabasePrintPermissionRepository({ database: database as never }).listUserPrintStats([77]);
  assert.match(queryText, /sum\("selected_page_count" \* "copies"\)/);
  assert.match(queryText, /sum\("copies"\)/);
  assert.match(queryText, /"cups_job_id" is distinct from 'test-mode'/);
  assert.match(queryText, /"status" =/);
});

test('createDatabasePrintPermissionRepository lists submitted print usage stats', async () => {
  const repository = createDatabasePrintPermissionRepository({
    database: {
      select: () => ({
        from: (table: unknown) => {
          assert.equal(table, printJobsTable);
          return {
            where: () => ({
              groupBy: async () => [
                { telegramUserId: 77, submittedJobs: 3, estimatedPhysicalPages: 42, totalPrintedPages: 84, totalCopies: 7 },
              ],
            }),
          };
        },
      }),
    } as never,
  });

  assert.deepEqual(await repository.listUserPrintStats([77]), [
    { telegramUserId: 77, submittedJobs: 3, estimatedPhysicalPages: 42, totalPrintedPages: 84, totalCopies: 7 },
  ]);
  assert.deepEqual(await repository.listUserPrintStats([]), []);
});

function createState(input: Partial<PrintPermissionState> = {}): PrintPermissionState {
  return {
    assignmentRows: input.assignmentRows ?? [],
    permissionAuditRows: input.permissionAuditRows ?? [],
    auditRows: input.auditRows ?? [],
  };
}

interface PrintPermissionState {
  assignmentRows: Array<Record<string, unknown>>;
  permissionAuditRows: Array<Record<string, unknown>>;
  auditRows: Array<Record<string, unknown>>;
}

function createPrintPermissionDatabaseDouble(state: PrintPermissionState) {
  return {
    transaction: async (handler: (tx: Record<string, unknown>) => Promise<unknown>) =>
      handler({
        select: () => ({
          from: (table: unknown) => {
            if (table !== permissionAssignmentsTable) {
              throw new Error('unexpected select table');
            }
            return {
              where: async () => state.assignmentRows.map((row) => ({ effect: row.effect })),
            };
          },
        }),
        update: (table: unknown) => {
          if (table !== permissionAssignmentsTable) {
            throw new Error('unexpected update table');
          }
          return {
            set: (values: Record<string, unknown>) => ({
              where: async () => {
                for (const row of state.assignmentRows) {
                  Object.assign(row, values);
                }
              },
            }),
          };
        },
        insert: (table: unknown) => ({
          values: async (values: Record<string, unknown>) => {
            if (table === permissionAssignmentsTable) {
              state.assignmentRows.push(values);
              return;
            }
            if (table === permissionAuditLogTable) {
              state.permissionAuditRows.push(values);
              return;
            }
            if (table === auditLogTable) {
              state.auditRows.push(values);
              return;
            }
            throw new Error('unexpected insert table');
          },
        }),
      } as never),
  } as never;
}
