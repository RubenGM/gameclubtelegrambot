import test from 'node:test';
import assert from 'node:assert/strict';

import {
  elevateApprovedUserToAdmin,
  grantAdminRoleToUser,
  revokeAdminRoleFromUser,
  type AdminElevationRepository,
  type AdminElevationUserRecord,
} from './admin-elevation.js';

function createRepository(initialUsers: AdminElevationUserRecord[] = []): AdminElevationRepository & {
  __auditLog: string[];
} {
  const users = new Map(initialUsers.map((user) => [user.telegramUserId, user]));
  const auditLog: string[] = [];

  return {
    async findUserByTelegramUserId(telegramUserId) {
      return users.get(telegramUserId) ?? null;
    },
    async elevateUserToAdmin(input) {
      const existing = users.get(input.telegramUserId);
      if (!existing) {
        throw new Error(`unknown user ${input.telegramUserId}`);
      }

      const next = {
        ...existing,
        isAdmin: true,
      };
      users.set(input.telegramUserId, next);
      auditLog.push(`role:${input.telegramUserId}:true:${input.changedByTelegramUserId}:${input.actionKey ?? 'membership.admin-elevated'}`);
      return next;
    },
    async countApprovedAdmins() {
      return Array.from(users.values()).filter((user) => user.status === 'approved' && user.isAdmin).length;
    },
    async revokeUserAdminRole(input) {
      const existing = users.get(input.telegramUserId);
      if (!existing) {
        throw new Error(`unknown user ${input.telegramUserId}`);
      }

      const next = {
        ...existing,
        isAdmin: false,
      };
      users.set(input.telegramUserId, next);
      auditLog.push(`role:${input.telegramUserId}:false:${input.changedByTelegramUserId}`);
      return next;
    },
    __auditLog: auditLog,
  };
}

test('elevateApprovedUserToAdmin promotes an approved user with the correct password', async () => {
  const repository = createRepository([
    {
      telegramUserId: 42,
      status: 'approved',
      isAdmin: false,
    },
  ]);

  const result = await elevateApprovedUserToAdmin({
    repository,
    telegramUserId: 42,
    password: 'secret',
    passwordHash: 'stored-hash',
    verifySecret: async (password, passwordHash) => password === 'secret' && passwordHash === 'stored-hash',
  });

  assert.equal(result.outcome, 'elevated');
  assert.match(result.message, /Ara tens permisos d administrador/);
  assert.equal(repository.__auditLog.at(-1), 'role:42:true:42:membership.admin-elevated');
});

test('grantAdminRoleToUser promotes another approved user without password and records admin grant audit intent', async () => {
  const repository = createRepository([
    { telegramUserId: 42, status: 'approved', isAdmin: false },
  ]);

  const result = await grantAdminRoleToUser({
    repository,
    targetTelegramUserId: 42,
    adminTelegramUserId: 99,
    reason: 'manual-test',
  });

  assert.equal(result.outcome, 'granted');
  assert.equal(repository.__auditLog.at(-1), 'role:42:true:99:membership.admin-granted');
});

test('revokeAdminRoleFromUser removes admin role but protects the last approved admin', async () => {
  const repository = createRepository([
    { telegramUserId: 42, status: 'approved', isAdmin: true },
    { telegramUserId: 99, status: 'approved', isAdmin: true },
  ]);

  const result = await revokeAdminRoleFromUser({
    repository,
    targetTelegramUserId: 42,
    adminTelegramUserId: 99,
  });

  assert.equal(result.outcome, 'revoked');
  assert.equal(repository.__auditLog.at(-1), 'role:42:false:99');

  const lastAdminResult = await revokeAdminRoleFromUser({
    repository,
    targetTelegramUserId: 99,
    adminTelegramUserId: 42,
  });
  assert.equal(lastAdminResult.outcome, 'last-admin');
});

test('elevateApprovedUserToAdmin rejects unapproved users even with the correct password', async () => {
  const repository = createRepository([
    {
      telegramUserId: 42,
      status: 'pending',
      isAdmin: false,
    },
  ]);

  const result = await elevateApprovedUserToAdmin({
    repository,
    telegramUserId: 42,
    password: 'secret',
    passwordHash: 'stored-hash',
    verifySecret: async () => true,
  });

  assert.equal(result.outcome, 'not-approved');
  assert.match(result.message, /Nomes els usuaris aprovats poden demanar elevacio/);
});

test('elevateApprovedUserToAdmin rejects blocked users', async () => {
  const repository = createRepository([
    {
      telegramUserId: 42,
      status: 'blocked',
      isAdmin: false,
    },
  ]);

  const result = await elevateApprovedUserToAdmin({
    repository,
    telegramUserId: 42,
    password: 'secret',
    passwordHash: 'stored-hash',
    verifySecret: async () => true,
  });

  assert.equal(result.outcome, 'blocked');
});

test('elevateApprovedUserToAdmin is idempotent for admins', async () => {
  const repository = createRepository([
    {
      telegramUserId: 42,
      status: 'approved',
      isAdmin: true,
    },
  ]);

  const result = await elevateApprovedUserToAdmin({
    repository,
    telegramUserId: 42,
    password: 'secret',
    passwordHash: 'stored-hash',
    verifySecret: async () => true,
  });

  assert.equal(result.outcome, 'already-admin');
});

test('elevateApprovedUserToAdmin rejects incorrect passwords', async () => {
  const repository = createRepository([
    {
      telegramUserId: 42,
      status: 'approved',
      isAdmin: false,
    },
  ]);

  const result = await elevateApprovedUserToAdmin({
    repository,
    telegramUserId: 42,
    password: 'wrong-secret',
    passwordHash: 'stored-hash',
    verifySecret: async () => false,
  });

  assert.equal(result.outcome, 'invalid-password');
  assert.match(result.message, /Contrasenya d elevacio incorrecta/);
});
