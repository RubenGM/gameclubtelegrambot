import test from 'node:test';
import assert from 'node:assert/strict';

import {
  approveMembershipRequest,
  listPendingMembershipRequests,
  rejectMembershipRequest,
  requestMembershipAccess,
  type MembershipAccessRepository,
  type MembershipUserRecord,
} from './access-flow.js';
import type { AuditLogEventRecord } from '../audit/audit-log.js';

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
    async upsertPendingUser(input) {
      const existing = users.get(input.telegramUserId);
      const next: MembershipUserRecord = {
        telegramUserId: input.telegramUserId,
        ...(input.username !== undefined ? { username: input.username } : {}),
        displayName: input.displayName,
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
    async updateUserStatus(input) {
      const existing = users.get(input.telegramUserId);
      if (!existing) {
        throw new Error(`unknown user ${input.telegramUserId}`);
      }

      const next: MembershipUserRecord = {
        ...existing,
        status: input.status,
        isAdmin: input.status === 'approved' ? input.isAdmin ?? existing.isAdmin : existing.isAdmin,
      };
      users.set(input.telegramUserId, next);
      statusLog.push(`${input.status}:${input.telegramUserId}:by:${input.changedByTelegramUserId}`);
      return next;
    },
    async appendStatusAuditLog(input) {
      statusLog.push(
        `audit:${input.telegramUserId}:${input.previousStatus ?? 'null'}:${input.nextStatus}:${input.changedByTelegramUserId}`,
      );
    },
    async appendAuditEvent(input) {
      auditEvents.push({
        actorTelegramUserId: input.actorTelegramUserId,
        actionKey: input.actionKey,
        targetType: input.targetType,
        targetId: input.targetId,
        summary: input.summary,
        details: input.details ?? null,
        createdAt: '2026-04-04T10:00:00.000Z',
      });
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
  assert.match(result.message, /Hem registrat la teva sollicitud d accés/);
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
  assert.match(result.message, /La teva sollicitud ja esta pendent de revisio/);
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
