import test from 'node:test';
import assert from 'node:assert/strict';

import { auditLog, userPermissionAssignments, userPermissionAuditLog, users } from '../infrastructure/database/schema.js';
import { createDatabaseStorageCategoryAccessRepository } from './storage-category-access-store.js';

const usersTable = users as unknown;
const permissionAssignmentsTable = userPermissionAssignments as unknown;
const permissionAuditLogTable = userPermissionAuditLog as unknown;
const auditLogTable = auditLog as unknown;

test('createDatabaseStorageCategoryAccessRepository grants read and upload permissions for a category', async () => {
  const state = {
    user: { telegramUserId: 77, status: 'approved' },
    assignmentRows: [] as Array<Record<string, unknown>>,
    permissionAuditRows: [] as Array<Record<string, unknown>>,
    auditRows: [] as Array<Record<string, unknown>>,
  };

  const repository = createDatabaseStorageCategoryAccessRepository({
    database: createStorageCategoryAccessDatabaseDouble(state),
  });

  const user = await repository.findUserByTelegramUserId(77);
  assert.equal(user?.telegramUserId, 77);

  await repository.grantCategoryAccess({
    subjectTelegramUserId: 77,
    categoryId: 7,
    changedByTelegramUserId: 42,
  });

  assert.equal(state.assignmentRows.length, 2);
  assert.deepEqual(
    state.assignmentRows.map((row) => row.permissionKey),
    ['storage.entry.read', 'storage.entry.upload'],
  );
  assert.equal(state.permissionAuditRows.length, 2);
  assert.equal(state.auditRows.length, 1);
});

test('createDatabaseStorageCategoryAccessRepository revokes read and upload permissions for a category', async () => {
  const state = {
    user: { telegramUserId: 77, status: 'approved' },
    assignmentRows: [] as Array<Record<string, unknown>>,
    permissionAuditRows: [] as Array<Record<string, unknown>>,
    auditRows: [] as Array<Record<string, unknown>>,
  };

  const repository = createDatabaseStorageCategoryAccessRepository({
    database: createStorageCategoryAccessDatabaseDouble(state, {
      existingEffects: ['allow', 'allow'],
    }),
  });

  await repository.revokeCategoryAccess({
    subjectTelegramUserId: 77,
    categoryId: 7,
    changedByTelegramUserId: 42,
  });

  assert.equal(state.assignmentRows.length, 2);
  assert.deepEqual(
    state.assignmentRows.map((row) => row.effect),
    ['deny', 'deny'],
  );
  assert.equal(state.permissionAuditRows.length, 2);
  assert.deepEqual(
    state.permissionAuditRows.map((row) => row.previousEffect),
    ['allow', 'allow'],
  );
  assert.equal(state.auditRows.length, 1);
});

function createStorageCategoryAccessDatabaseDouble(state: {
  user: { telegramUserId: number; status: string } | null;
  assignmentRows: Array<Record<string, unknown>>;
  permissionAuditRows: Array<Record<string, unknown>>;
  auditRows: Array<Record<string, unknown>>;
}, options: {
  existingEffects?: string[];
} = {}) {
  let existingEffectIndex = 0;
  return {
    select: () => ({
      from: (table: { [key: string]: unknown }) => {
        if ((table as unknown) === usersTable) {
          return {
            where: async () => (state.user ? [state.user] : []),
          };
        }

        if ((table as unknown) === permissionAssignmentsTable) {
          return {
            where: async () => [],
          };
        }

        throw new Error('unexpected table');
      },
    }),
    transaction: async (handler: (tx: Record<string, unknown>) => Promise<unknown>) =>
      handler({
        select: () => ({
          from: (table: { [key: string]: unknown }) => {
            if ((table as unknown) !== permissionAssignmentsTable) {
              throw new Error('unexpected table');
            }
            return {
              where: async () => {
                const effect = options.existingEffects?.[existingEffectIndex];
                existingEffectIndex += 1;
                return effect ? [{ effect }] : [];
              },
            };
          },
        }),
        insert: (table: { [key: string]: unknown }) => ({
          values: (values: Record<string, unknown>) => {
            if ((table as unknown) === permissionAssignmentsTable) {
              return {
                onConflictDoUpdate: async () => {
                  state.assignmentRows.push(values);
                },
              };
            }
            if ((table as unknown) === permissionAuditLogTable) {
              state.permissionAuditRows.push(values);
              return Promise.resolve();
            }
            if ((table as unknown) === auditLogTable) {
              state.auditRows.push(values);
              return Promise.resolve();
            }
            throw new Error('unexpected table');
          },
        }),
      } as never),
  } as never;
}
