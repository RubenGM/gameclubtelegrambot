import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabaseTelegramActorStore } from './actor-store.js';
import { userPermissionAssignments, users } from '../infrastructure/database/schema.js';

const usersTable = users as unknown;
const userPermissionAssignmentsTable = userPermissionAssignments as unknown;

test('createDatabaseTelegramActorStore loads explicit user status and persisted permissions', async () => {
  const events: string[] = [];

  const store = createDatabaseTelegramActorStore({
    database: {
      select: (selection: Record<string, unknown>) => ({
        from: (table: { [key: string]: unknown }) => ({
          where: async () => {
            if ((table as unknown) === usersTable) {
              events.push('select:user');
              return [
                {
                  telegramUserId: 42,
                  status: 'approved',
                  isAdmin: true,
                },
              ];
            }

            if ((table as unknown) === userPermissionAssignmentsTable) {
              events.push('select:permissions');
              return [
                {
                  permissionKey: 'schedule.manage',
                  scopeType: 'global',
                  resourceType: null,
                  resourceId: null,
                  effect: 'allow',
                },
                {
                  permissionKey: 'table.reserve',
                  scopeType: 'resource',
                  resourceType: 'table',
                  resourceId: 'table-7',
                  effect: 'deny',
                },
              ];
            }

            throw new Error('unexpected table');
          },
        }),
      }),
    } as never,
  });

  const actor = await store.loadActor(42);

  assert.deepEqual(actor, {
    telegramUserId: 42,
    status: 'approved',
    isApproved: true,
    isBlocked: false,
    isAdmin: true,
    permissions: [
      {
        permissionKey: 'schedule.manage',
        scopeType: 'global',
        resourceType: null,
        resourceId: null,
        effect: 'allow',
      },
      {
        permissionKey: 'table.reserve',
        scopeType: 'resource',
        resourceType: 'table',
        resourceId: 'table-7',
        effect: 'deny',
      },
    ],
  });
  assert.deepEqual(events, ['select:user', 'select:permissions']);
});

test('createDatabaseTelegramActorStore defaults unknown users to pending without permissions', async () => {
  const store = createDatabaseTelegramActorStore({
    database: {
      select: (_selection: Record<string, unknown>) => ({
        from: (table: { [key: string]: unknown }) => ({
          where: async () => {
            if ((table as unknown) === usersTable) {
              return [];
            }

            return [];
          },
        }),
      }),
    } as never,
  });

  const actor = await store.loadActor(999);

  assert.deepEqual(actor, {
    telegramUserId: 999,
    status: 'pending',
    isApproved: false,
    isBlocked: false,
    isAdmin: false,
    permissions: [],
  });
});
