import test from 'node:test';
import assert from 'node:assert/strict';

import { auditLog, userPermissionAuditLog, users } from '../infrastructure/database/schema.js';
import { createDatabaseAdminElevationRepository } from './admin-elevation-store.js';
import type { AdminElevationUserRecord } from './admin-elevation.js';

const usersTable = users as unknown;
const userPermissionAuditLogTable = userPermissionAuditLog as unknown;
const auditLogTable = auditLog as unknown;

type AdminElevationStoreTestState = {
  user: AdminElevationUserRecord;
  permissionAuditRows: Array<Record<string, unknown>>;
  auditRows: Array<Record<string, unknown>>;
};

test('createDatabaseAdminElevationRepository elevates admin and writes permission audit', async () => {
  const state: AdminElevationStoreTestState = {
    user: {
      telegramUserId: 42,
      status: 'approved',
      isAdmin: false,
    },
    permissionAuditRows: [] as Array<Record<string, unknown>>,
    auditRows: [] as Array<Record<string, unknown>>,
  };

  const repository = createDatabaseAdminElevationRepository({
    database: createAdminElevationDatabaseDouble(state),
  });

  const updated = await repository.elevateUserToAdmin({
    telegramUserId: 42,
    changedByTelegramUserId: 42,
  });

  assert.equal(updated.isAdmin, true);
  assert.equal(state.user.isAdmin, true);
  assert.equal(state.permissionAuditRows.length, 1);
  assert.equal(state.permissionAuditRows[0]?.permissionKey, 'role.admin');
  assert.equal(state.auditRows.length, 1);
});

test('createDatabaseAdminElevationRepository rolls back admin update when permission audit fails', async () => {
  const state: AdminElevationStoreTestState = {
    user: {
      telegramUserId: 42,
      status: 'approved',
      isAdmin: false,
    },
    permissionAuditRows: [] as Array<Record<string, unknown>>,
    auditRows: [] as Array<Record<string, unknown>>,
  };

  const repository = createDatabaseAdminElevationRepository({
    database: createAdminElevationDatabaseDouble(state, { failPermissionAuditInsert: true }),
  });

  await assert.rejects(
    () =>
      repository.elevateUserToAdmin({
        telegramUserId: 42,
        changedByTelegramUserId: 42,
      }),
    /permission audit insert failed/,
  );

  assert.equal(state.user.isAdmin, false);
  assert.equal(state.permissionAuditRows.length, 0);
  assert.equal(state.auditRows.length, 0);
});

function createAdminElevationDatabaseDouble(
  state: AdminElevationStoreTestState,
  options: {
    failPermissionAuditInsert?: boolean;
  } = {},
) {
  return {
    transaction: async (handler: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const draft = {
        user: { ...state.user },
        permissionAuditRows: [...state.permissionAuditRows],
        auditRows: [...state.auditRows],
      };

      const result = await handler({
        update: (table: { [key: string]: unknown }) => {
          if ((table as unknown) !== usersTable) {
            throw new Error('unexpected table');
          }

          return {
            set: () => ({
              where: () => ({
                returning: async () => {
                  draft.user = {
                    ...draft.user,
                    isAdmin: true,
                  };

                  return [draft.user];
                },
              }),
            }),
          };
        },
        insert: (table: { [key: string]: unknown }) => ({
          values: async (values: Record<string, unknown>) => {
            if ((table as unknown) === userPermissionAuditLogTable) {
              if (options.failPermissionAuditInsert) {
                throw new Error('permission audit insert failed');
              }
              draft.permissionAuditRows.push(values);
              return;
            }

            if ((table as unknown) === auditLogTable) {
              draft.auditRows.push(values);
              return;
            }

            throw new Error('unexpected table');
          },
        }),
      } as never);

      state.user = draft.user;
      state.permissionAuditRows = draft.permissionAuditRows;
      state.auditRows = draft.auditRows;
      return result;
    },
  } as never;
}
