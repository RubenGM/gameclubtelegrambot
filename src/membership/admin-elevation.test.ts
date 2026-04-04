import test from 'node:test';
import assert from 'node:assert/strict';

import {
  elevateApprovedUserToAdmin,
  type AdminElevationRepository,
  type AdminElevationUserRecord,
} from './admin-elevation.js';

function createRepository(initialUsers: AdminElevationUserRecord[] = []): AdminElevationRepository {
  const users = new Map(initialUsers.map((user) => [user.telegramUserId, user]));
  const auditLog: string[] = [];

  return {
    async findUserByTelegramUserId(telegramUserId) {
      return users.get(telegramUserId) ?? null;
    },
    async updateAdminRole(input) {
      const existing = users.get(input.telegramUserId);
      if (!existing) {
        throw new Error(`unknown user ${input.telegramUserId}`);
      }

      const next = {
        ...existing,
        isAdmin: input.isAdmin,
      };
      users.set(input.telegramUserId, next);
      auditLog.push(`role:${input.telegramUserId}:${input.isAdmin}:${input.changedByTelegramUserId}`);
      return next;
    },
    async appendAdminElevationAuditLog(input) {
      auditLog.push(`audit:${input.telegramUserId}:${input.outcome}:${input.reason ?? 'none'}`);
    },
    __auditLog: auditLog,
  } as AdminElevationRepository & { __auditLog: string[] };
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
