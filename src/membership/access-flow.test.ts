import test from 'node:test';
import assert from 'node:assert/strict';

import {
  approveMembershipRequest,
  listPendingMembershipRequests,
  listRevocableMembershipUsers,
  rejectMembershipRequest,
  revokeMembershipAccess,
  requestMembershipAccess,
  type MembershipAccessRepository,
  type MembershipUserRecord,
} from './access-flow.js';
import type { AuditLogEventRecord } from '../audit/audit-log.js';
import { normalizeDisplayName } from './display-name.js';

function createRepository(initialUsers: MembershipUserRecord[] = []): MembershipAccessRepository & {
  __statusLog: string[];
  __auditEvents: AuditLogEventRecord[];
  __users: Map<number, MembershipUserRecord>;
} {
  const users = new Map(initialUsers.map((user) => [user.telegramUserId, user]));
  const statusLog: string[] = [];
  const auditEvents: AuditLogEventRecord[] = [];

  return {
    async findUserByTelegramUserId(telegramUserId) {
      return users.get(telegramUserId) ?? null;
    },
    async syncUserProfile(input) {
      const existing = users.get(input.telegramUserId);
      if (!existing) {
        return null;
      }

      const next: MembershipUserRecord = {
        ...existing,
        ...(input.username !== undefined ? { username: input.username ?? null } : {}),
        displayName: normalizeDisplayName(input.displayName) ?? existing.displayName,
      };
      users.set(input.telegramUserId, next);
      return next;
    },
    async upsertPendingUser(input) {
      const existing = users.get(input.telegramUserId);
      const next: MembershipUserRecord = {
        telegramUserId: input.telegramUserId,
        ...(input.username !== undefined ? { username: input.username } : {}),
        displayName: normalizeDisplayName(input.displayName) ?? 'Usuari',
        status: 'pending',
        isAdmin: existing?.isAdmin ?? false,
      };

      users.set(input.telegramUserId, next);
      statusLog.push(`pending:${input.telegramUserId}`);
      return next;
    },
    async listPendingUsers() {
      return Array.from(users.values()).filter((user) => user.status === 'pending');
    },
    async listRevocableUsers() {
      return Array.from(users.values()).filter((user) => user.status === 'approved' && !user.isAdmin);
    },
    async listApprovedAdminUsers() {
      return Array.from(users.values()).filter((user) => user.status === 'approved' && user.isAdmin);
    },
    async findLatestRevocation(telegramUserId) {
      const user = users.get(telegramUserId);
      if (!user || user.status !== 'revoked') {
        return null;
      }

      return {
        changedByTelegramUserId: 99,
        createdAt: '2026-04-04T10:00:00.000Z',
        reason: 'historic reason',
      };
    },
    async appendStatusAuditLog(input) {
      statusLog.push(
        `audit:${input.telegramUserId}:${input.previousStatus ?? 'null'}:${input.nextStatus}:${input.changedByTelegramUserId}`,
      );
    },
    async approveMembershipRequest(input) {
      const existing = users.get(input.telegramUserId);
      if (!existing) {
        throw new Error(`unknown user ${input.telegramUserId}`);
      }

      const next: MembershipUserRecord = {
        ...existing,
        status: 'approved',
      };
      users.set(input.telegramUserId, next);
      statusLog.push(`approved:${input.telegramUserId}:by:${input.changedByTelegramUserId}`);
      auditEvents.push({
        actorTelegramUserId: input.changedByTelegramUserId,
        actionKey: 'membership.approved',
        targetType: 'membership-user',
        targetId: String(input.telegramUserId),
        summary: 'Usuari aprovat correctament',
        details: {
          previousStatus: input.previousStatus,
          nextStatus: 'approved',
        },
        createdAt: '2026-04-04T10:00:00.000Z',
      });
      return next;
    },
    async rejectMembershipRequest(input) {
      const existing = users.get(input.telegramUserId);
      if (!existing) {
        throw new Error(`unknown user ${input.telegramUserId}`);
      }

      const next: MembershipUserRecord = {
        ...existing,
        status: 'blocked',
      };
      users.set(input.telegramUserId, next);
      statusLog.push(`blocked:${input.telegramUserId}:by:${input.changedByTelegramUserId}`);
      auditEvents.push({
        actorTelegramUserId: input.changedByTelegramUserId,
        actionKey: 'membership.rejected',
        targetType: 'membership-user',
        targetId: String(input.telegramUserId),
        summary: 'Sollicitud d acces rebutjada',
        details: {
          previousStatus: input.previousStatus,
          nextStatus: 'blocked',
          reason: input.reason ?? null,
        },
        createdAt: '2026-04-04T10:00:00.000Z',
      });
      return next;
    },
    async revokeMembershipAccess(input) {
      const existing = users.get(input.telegramUserId);
      if (!existing) {
        throw new Error(`unknown user ${input.telegramUserId}`);
      }

      const next: MembershipUserRecord = {
        ...existing,
        status: 'revoked',
      };
      users.set(input.telegramUserId, next);
      statusLog.push(`revoked:${input.telegramUserId}:by:${input.changedByTelegramUserId}`);
      auditEvents.push({
        actorTelegramUserId: input.changedByTelegramUserId,
        actionKey: 'membership.revoked',
        targetType: 'membership-user',
        targetId: String(input.telegramUserId),
        summary: 'Acces de membre revocat',
        details: {
          previousStatus: input.previousStatus,
          nextStatus: 'revoked',
          reason: input.reason,
        },
        createdAt: '2026-04-04T10:00:00.000Z',
      });
      return next;
    },
    async backfillDisplayNames() {
      let updatedCount = 0;
      for (const [telegramUserId, user] of users.entries()) {
        if (normalizeDisplayName(user.displayName)) {
          continue;
        }

        const next: MembershipUserRecord = {
          ...user,
          displayName: user.username?.trim() ? `@${user.username.trim()}` : 'Usuari',
        };
        users.set(telegramUserId, next);
        updatedCount += 1;
      }
      return updatedCount;
    },
    __statusLog: statusLog,
    __auditEvents: auditEvents,
    __users: users,
  };
}

test('requestMembershipAccess creates a pending access request for unknown users', async () => {
  const repository = createRepository();

  const result = await requestMembershipAccess({
    repository,
    telegramUserId: 10,
    username: 'new_member',
    displayName: 'New Member',
  });

  assert.equal(result.outcome, 'created');
  assert.match(result.message, /Ja hem rebut la teva sollicitud/);
  assert.match(result.message, /avisa un administrador del club/i);
});

test('requestMembershipAccess is idempotent for pending users', async () => {
  const repository = createRepository([
    {
      telegramUserId: 10,
      username: 'new_member',
      displayName: 'New Member',
      status: 'pending',
      isAdmin: false,
    },
  ]);

  const result = await requestMembershipAccess({
    repository,
    telegramUserId: 10,
    username: 'new_member',
    displayName: 'New Member',
  });

  assert.equal(result.outcome, 'already-pending');
  assert.match(result.message, /Ja hem rebut la teva sollicitud/);
  assert.match(result.message, /avisa un administrador del club/i);
});

test('requestMembershipAccess keeps approved users on normal access path', async () => {
  const repository = createRepository([
    {
      telegramUserId: 10,
      username: 'approved_member',
      displayName: 'Approved Member',
      status: 'approved',
      isAdmin: false,
    },
  ]);

  const result = await requestMembershipAccess({
    repository,
    telegramUserId: 10,
    username: 'approved_member',
    displayName: 'Approved Member',
  });

  assert.equal(result.outcome, 'already-approved');
  assert.match(result.message, /Ja tens accés aprovat/);
});

test('requestMembershipAccess keeps blocked users restricted', async () => {
  const repository = createRepository([
    {
      telegramUserId: 10,
      username: 'blocked_member',
      displayName: 'Blocked Member',
      status: 'blocked',
      isAdmin: false,
    },
  ]);

  const result = await requestMembershipAccess({
    repository,
    telegramUserId: 10,
    username: 'blocked_member',
    displayName: 'Blocked Member',
  });

  assert.equal(result.outcome, 'blocked');
  assert.match(result.message, /El teu accés esta blocat/);
});

test('requestMembershipAccess recreates a pending request for revoked users', async () => {
  const repository = createRepository([
    {
      telegramUserId: 10,
      username: 'revoked_member',
      displayName: 'Revoked Member',
      status: 'revoked',
      isAdmin: false,
    },
  ]);

  const result = await requestMembershipAccess({
    repository,
    telegramUserId: 10,
    username: 'revoked_member',
    displayName: 'Revoked Member',
  });

  assert.equal(result.outcome, 'created');
  assert.equal(repository.__users.get(10)?.status, 'pending');
});

test('listPendingMembershipRequests returns pending applicants for admin review', async () => {
  const repository = createRepository([
    {
      telegramUserId: 10,
      username: 'pending_a',
      displayName: 'Pending A',
      status: 'pending',
      isAdmin: false,
    },
    {
      telegramUserId: 11,
      username: 'approved_b',
      displayName: 'Approved B',
      status: 'approved',
      isAdmin: false,
    },
  ]);

  const result = await listPendingMembershipRequests({ repository });

  assert.equal(result.pendingUsers.length, 1);
  assert.equal(result.pendingUsers[0]?.telegramUserId, 10);
});

test('listRevocableMembershipUsers only returns approved non-admin members', async () => {
  const repository = createRepository([
    {
      telegramUserId: 10,
      username: 'approved_member',
      displayName: 'Approved Member',
      status: 'approved',
      isAdmin: false,
    },
    {
      telegramUserId: 11,
      username: 'admin_member',
      displayName: 'Admin Member',
      status: 'approved',
      isAdmin: true,
    },
    {
      telegramUserId: 12,
      username: 'pending_member',
      displayName: 'Pending Member',
      status: 'pending',
      isAdmin: false,
    },
  ]);

  const result = await listRevocableMembershipUsers({ repository });

  assert.deepEqual(result.users.map((user) => user.telegramUserId), [10]);
});

test('approveMembershipRequest approves a pending user and returns applicant notification', async () => {
  const repository = createRepository([
    {
      telegramUserId: 10,
      username: 'pending_a',
      displayName: 'Pending A',
      status: 'pending',
      isAdmin: false,
    },
  ]);

  const result = await approveMembershipRequest({
    repository,
    applicantTelegramUserId: 10,
    adminTelegramUserId: 99,
  });

  assert.equal(result.outcome, 'approved');
  assert.match(result.applicantMessage, /La teva sollicitud ha estat aprovada/);
  assert.equal(repository.__auditEvents.at(-1)?.actionKey, 'membership.approved');
  assert.equal(repository.__auditEvents.at(-1)?.targetId, '10');
});

test('approveMembershipRequest is safe against duplicate approvals', async () => {
  const repository = createRepository([
    {
      telegramUserId: 10,
      username: 'approved_a',
      displayName: 'Approved A',
      status: 'approved',
      isAdmin: false,
    },
  ]);

  const result = await approveMembershipRequest({
    repository,
    applicantTelegramUserId: 10,
    adminTelegramUserId: 99,
  });

  assert.equal(result.outcome, 'already-approved');
});

test('approveMembershipRequest requires revoked users to request access again', async () => {
  const repository = createRepository([
    {
      telegramUserId: 10,
      username: 'revoked_a',
      displayName: 'Revoked A',
      status: 'revoked',
      isAdmin: false,
    },
  ]);

  const result = await approveMembershipRequest({
    repository,
    applicantTelegramUserId: 10,
    adminTelegramUserId: 99,
  });

  assert.equal(result.outcome, 'missing');
  assert.match(result.adminMessage, /ha de tornar a demanar \/access/i);
});

test('rejectMembershipRequest blocks a pending user and returns applicant notification', async () => {
  const repository = createRepository([
    {
      telegramUserId: 10,
      username: 'pending_a',
      displayName: 'Pending A',
      status: 'pending',
      isAdmin: false,
    },
  ]);

  const result = await rejectMembershipRequest({
    repository,
    applicantTelegramUserId: 10,
    adminTelegramUserId: 99,
    reason: 'Acces limitat a socis actius',
  });

  assert.equal(result.outcome, 'blocked');
  assert.match(result.applicantMessage, /La teva sollicitud d accés ha estat rebutjada/);
  assert.equal(repository.__auditEvents.at(-1)?.actionKey, 'membership.rejected');
  assert.equal(repository.__auditEvents.at(-1)?.actorTelegramUserId, 99);
});

test('revokeMembershipAccess revokes an approved user and records audit history', async () => {
  const repository = createRepository([
    {
      telegramUserId: 10,
      username: 'approved_a',
      displayName: 'Approved A',
      status: 'approved',
      isAdmin: false,
    },
  ]);

  const result = await revokeMembershipAccess({
    repository,
    applicantTelegramUserId: 10,
    adminTelegramUserId: 99,
    reason: 'Conducta inapropiada',
  });

  assert.equal(result.outcome, 'revoked');
  assert.match(result.applicantMessage, /\/access/);
  assert.equal(repository.__users.get(10)?.status, 'revoked');
  assert.equal(repository.__auditEvents.at(-1)?.actionKey, 'membership.revoked');
});
