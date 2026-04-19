import test from 'node:test';
import assert from 'node:assert/strict';

import { auditLog, userStatusAuditLog, users } from '../infrastructure/database/schema.js';
import { createDatabaseMembershipAccessRepository } from './access-flow-store.js';
import type { MembershipUserStatus } from './access-flow.js';

const usersTable = users as unknown;
const userStatusAuditLogTable = userStatusAuditLog as unknown;
const auditLogTable = auditLog as unknown;

type MembershipStoreTestState = {
  user: {
    telegramUserId: number;
    username: string;
    displayName: string;
    status: MembershipUserStatus;
    isAdmin: boolean;
    isApproved: boolean;
  };
  userUpdateCalls?: number;
  statusAuditRows: Array<Record<string, unknown>>;
  auditRows: Array<Record<string, unknown>>;
};

test('createDatabaseMembershipAccessRepository approves membership atomically', async () => {
  const state: MembershipStoreTestState = {
    user: {
      telegramUserId: 10,
      username: 'pending_a',
      displayName: 'Pending A',
      status: 'pending',
      isAdmin: false,
      isApproved: false,
    },
    statusAuditRows: [] as Array<Record<string, unknown>>,
    auditRows: [] as Array<Record<string, unknown>>,
  };

  const repository = createDatabaseMembershipAccessRepository({
    database: createMembershipDatabaseDouble(state),
  });

  const updated = await repository.approveMembershipRequest({
    telegramUserId: 10,
    previousStatus: 'pending',
    changedByTelegramUserId: 99,
  });

  assert.equal(updated.status, 'approved');
  assert.equal(state.user.status, 'approved');
  assert.equal(state.statusAuditRows.length, 1);
  assert.equal(state.auditRows.length, 1);
});

test('createDatabaseMembershipAccessRepository rolls back approval when audit insert fails', async () => {
  const state: MembershipStoreTestState = {
    user: {
      telegramUserId: 10,
      username: 'pending_a',
      displayName: 'Pending A',
      status: 'pending',
      isAdmin: false,
      isApproved: false,
    },
    statusAuditRows: [] as Array<Record<string, unknown>>,
    auditRows: [] as Array<Record<string, unknown>>,
  };

  const repository = createDatabaseMembershipAccessRepository({
    database: createMembershipDatabaseDouble(state, { failAuditInsert: true }),
  });

  await assert.rejects(
    () =>
      repository.approveMembershipRequest({
        telegramUserId: 10,
        previousStatus: 'pending',
        changedByTelegramUserId: 99,
      }),
    /audit insert failed/,
  );

  assert.equal(state.user.status, 'pending');
  assert.equal(state.statusAuditRows.length, 0);
  assert.equal(state.auditRows.length, 0);
});

test('createDatabaseMembershipAccessRepository rolls back rejection when status update fails', async () => {
  const state: MembershipStoreTestState = {
    user: {
      telegramUserId: 10,
      username: 'pending_a',
      displayName: 'Pending A',
      status: 'pending',
      isAdmin: false,
      isApproved: false,
    },
    statusAuditRows: [] as Array<Record<string, unknown>>,
    auditRows: [] as Array<Record<string, unknown>>,
  };

  const repository = createDatabaseMembershipAccessRepository({
    database: createMembershipDatabaseDouble(state, { missingUpdatedRow: true }),
  });

  await assert.rejects(
    () =>
      repository.rejectMembershipRequest({
        telegramUserId: 10,
        previousStatus: 'pending',
        changedByTelegramUserId: 99,
        reason: 'not-eligible',
      }),
    /Membership user 10 not found/,
  );

  assert.equal(state.user.status, 'pending');
  assert.equal(state.statusAuditRows.length, 0);
  assert.equal(state.auditRows.length, 0);
});

test('createDatabaseMembershipAccessRepository revokes approved membership atomically', async () => {
  const state: MembershipStoreTestState = {
    user: {
      telegramUserId: 10,
      username: 'approved_a',
      displayName: 'Approved A',
      status: 'approved',
      isAdmin: false,
      isApproved: true,
    },
    statusAuditRows: [],
    auditRows: [],
  };

  const repository = createDatabaseMembershipAccessRepository({
    database: createMembershipDatabaseDouble(state),
  });

  const updated = await repository.revokeMembershipAccess({
    telegramUserId: 10,
    previousStatus: 'approved',
    changedByTelegramUserId: 99,
    reason: 'Conducta inapropiada',
  });

  assert.equal(updated.status, 'revoked');
  assert.equal(state.user.status, 'revoked');
  assert.equal(state.statusAuditRows.length, 1);
  assert.equal(state.auditRows.length, 1);
});

test('createDatabaseMembershipAccessRepository skips user profile writes when the normalized profile is unchanged', async () => {
  const state: MembershipStoreTestState = {
    user: {
      telegramUserId: 10,
      username: 'approved_a',
      displayName: 'Approved A',
      status: 'approved',
      isAdmin: false,
      isApproved: true,
    },
    userUpdateCalls: 0,
    statusAuditRows: [],
    auditRows: [],
  };

  const repository = createDatabaseMembershipAccessRepository({
    database: createMembershipDatabaseDouble(state),
  });

  const updated = await repository.syncUserProfile({
    telegramUserId: 10,
    username: ' approved_a ',
    displayName: ' Approved A ',
  });

  assert.equal(updated?.telegramUserId, 10);
  assert.equal(updated?.username, 'approved_a');
  assert.equal(updated?.displayName, 'Approved A');
  assert.equal(state.user.username, 'approved_a');
  assert.equal(state.user.displayName, 'Approved A');
  assert.equal(state.userUpdateCalls, 0);
});

function createMembershipDatabaseDouble(
  state: MembershipStoreTestState,
  options: {
    failAuditInsert?: boolean;
    missingUpdatedRow?: boolean;
  } = {},
) {
  return {
    select: () => ({
      from: (table: { [key: string]: unknown }) => {
        if ((table as unknown) !== usersTable) {
          throw new Error('unexpected table');
        }

        return {
          where: async () => [
            {
              telegramUserId: state.user.telegramUserId,
              username: state.user.username,
              displayName: state.user.displayName,
              status: state.user.status,
              isAdmin: state.user.isAdmin,
            },
          ],
        };
      },
    }),
    update: (table: { [key: string]: unknown }) => {
      if ((table as unknown) !== usersTable) {
        throw new Error('unexpected table');
      }

      return {
        set: (values: Record<string, unknown>) => ({
          where: () => ({
            returning: async () => {
              state.userUpdateCalls = (state.userUpdateCalls ?? 0) + 1;
              state.user = {
                ...state.user,
                username: (values.username as string | undefined) ?? state.user.username,
                displayName: (values.displayName as string | undefined) ?? state.user.displayName,
              };

              return [
                {
                  telegramUserId: state.user.telegramUserId,
                  username: state.user.username,
                  displayName: state.user.displayName,
                  status: state.user.status,
                  isAdmin: state.user.isAdmin,
                },
              ];
            },
          }),
        }),
      };
    },
    transaction: async (handler: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const draft = {
        user: { ...state.user },
        userUpdateCalls: state.userUpdateCalls ?? 0,
        statusAuditRows: [...state.statusAuditRows],
        auditRows: [...state.auditRows],
      };

      try {
        const result = await handler({
          update: (table: { [key: string]: unknown }) => {
            if ((table as unknown) !== usersTable) {
              throw new Error('unexpected table');
            }

            return {
              set: (values: Record<string, unknown>) => ({
                where: () => ({
                  returning: async () => {
                    draft.userUpdateCalls += 1;

                    if (options.missingUpdatedRow) {
                      return [];
                    }

                    draft.user = {
                      ...draft.user,
                      username: (values.username as string | undefined) ?? draft.user.username,
                      displayName: (values.displayName as string | undefined) ?? draft.user.displayName,
                      status: values.status as 'pending' | 'approved' | 'blocked' | 'revoked',
                      isApproved: (values.isApproved as boolean | undefined) ?? draft.user.isApproved,
                    };

                    return [
                      {
                        telegramUserId: draft.user.telegramUserId,
                        username: draft.user.username,
                        displayName: draft.user.displayName,
                        status: draft.user.status,
                        isAdmin: draft.user.isAdmin,
                      },
                    ];
                  },
                }),
              }),
            };
          },
          insert: (table: { [key: string]: unknown }) => ({
            values: async (values: Record<string, unknown>) => {
              if ((table as unknown) === userStatusAuditLogTable) {
                draft.statusAuditRows.push(values);
                return;
              }

              if ((table as unknown) === auditLogTable) {
                if (options.failAuditInsert) {
                  throw new Error('audit insert failed');
                }
                draft.auditRows.push(values);
                return;
              }

              throw new Error('unexpected table');
            },
          }),
        } as never);

        state.user = draft.user;
        state.userUpdateCalls = draft.userUpdateCalls;
        state.statusAuditRows = draft.statusAuditRows;
        state.auditRows = draft.auditRows;
        return result;
      } catch (error) {
        throw error;
      }
    },
  } as never;
}
