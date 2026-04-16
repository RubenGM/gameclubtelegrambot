import test from 'node:test';
import assert from 'node:assert/strict';

import { sql } from 'drizzle-orm';

import { appendAuditEvent } from '../audit/audit-log.js';
import { createDatabaseAuditLogRepository } from '../audit/audit-log-store.js';
import { applyMigrations } from '../infrastructure/database/apply-migrations.js';
import {
  connectPostgresDatabase,
  createPostgresConnectionString,
} from '../infrastructure/database/connection.js';
import { createDatabaseAdminElevationRepository } from './admin-elevation-store.js';
import { createDatabaseMembershipAccessRepository } from './access-flow-store.js';
import { loadIntegrationRuntimeConfig } from '../test/integration-runtime.js';

const integrationConfig = await loadIntegrationRuntimeConfig();
const integrationTest = integrationConfig ? test : test.skip;

integrationTest('membership approval persists user status and both audit logs', async () => {
  const context = await createIntegrationContext();

  try {
    const membershipRepository = createDatabaseMembershipAccessRepository({
      database: context.connection.db,
    });

    const updated = await membershipRepository.approveMembershipRequest({
      telegramUserId: context.pendingUserTelegramUserId,
      previousStatus: 'pending',
      changedByTelegramUserId: context.adminTelegramUserId,
    });

    assert.equal(updated.status, 'approved');

    const userResult = await context.connection.pool.query(
      `
        select status, is_approved, approved_at, blocked_at
        from users
        where telegram_user_id = $1
      `,
      [context.pendingUserTelegramUserId],
    );
    assert.equal(userResult.rows[0]?.status, 'approved');
    assert.equal(userResult.rows[0]?.is_approved, true);
    assert.ok(userResult.rows[0]?.approved_at);
    assert.equal(userResult.rows[0]?.blocked_at, null);

    const statusAuditResult = await context.connection.pool.query(
      `
        select previous_status, next_status, changed_by_telegram_user_id, reason
        from user_status_audit_log
        where subject_telegram_user_id = $1
        order by id desc
        limit 1
      `,
      [context.pendingUserTelegramUserId],
    );
    assert.deepEqual(statusAuditResult.rows[0], {
      previous_status: 'pending',
      next_status: 'approved',
      changed_by_telegram_user_id: String(context.adminTelegramUserId),
      reason: 'member-access-approved',
    });

    const auditResult = await context.connection.pool.query(
      `
        select actor_telegram_user_id, action_key, target_type, target_id, summary, details
        from audit_log
        where action_key = 'membership.approved' and target_id = $1
        order by id desc
        limit 1
      `,
      [String(context.pendingUserTelegramUserId)],
    );
    assert.deepEqual(auditResult.rows[0], {
      actor_telegram_user_id: String(context.adminTelegramUserId),
      action_key: 'membership.approved',
      target_type: 'membership-user',
      target_id: String(context.pendingUserTelegramUserId),
      summary: 'Usuari aprovat correctament',
      details: {
        previousStatus: 'pending',
        nextStatus: 'approved',
      },
    });
  } finally {
    await context.cleanup();
  }
});

integrationTest('admin elevation persists permission audit and top-level audit log', async () => {
  const context = await createIntegrationContext();

  try {
    const repository = createDatabaseAdminElevationRepository({
      database: context.connection.db,
    });

    const updated = await repository.elevateUserToAdmin({
      telegramUserId: context.pendingUserTelegramUserId,
      changedByTelegramUserId: context.adminTelegramUserId,
    });

    assert.equal(updated.isAdmin, true);

    const userResult = await context.connection.pool.query(
      'select is_admin from users where telegram_user_id = $1',
      [context.pendingUserTelegramUserId],
    );
    assert.equal(userResult.rows[0]?.is_admin, true);

    const permissionAuditResult = await context.connection.pool.query(
      `
        select permission_key, scope_type, next_effect, changed_by_telegram_user_id, reason
        from user_permission_audit_log
        where subject_telegram_user_id = $1
        order by id desc
        limit 1
      `,
      [context.pendingUserTelegramUserId],
    );
    assert.deepEqual(permissionAuditResult.rows[0], {
      permission_key: 'role.admin',
      scope_type: 'global',
      next_effect: 'allow',
      changed_by_telegram_user_id: String(context.adminTelegramUserId),
      reason: 'password-match',
    });

    const auditResult = await context.connection.pool.query(
      `
        select actor_telegram_user_id, action_key, target_type, target_id, summary, details
        from audit_log
        where action_key = 'membership.admin-elevated' and target_id = $1
        order by id desc
        limit 1
      `,
      [String(context.pendingUserTelegramUserId)],
    );
    assert.deepEqual(auditResult.rows[0], {
      actor_telegram_user_id: String(context.adminTelegramUserId),
      action_key: 'membership.admin-elevated',
      target_type: 'membership-user',
      target_id: String(context.pendingUserTelegramUserId),
      summary: 'Usuari elevat a administrador',
      details: {
        outcome: 'elevated',
      },
    });
  } finally {
    await context.cleanup();
  }
});

integrationTest('database audit log repository persists normalized events', async () => {
  const context = await createIntegrationContext();

  try {
    const repository = createDatabaseAuditLogRepository({
      database: context.connection.db,
    });

    await appendAuditEvent({
      repository,
      actorTelegramUserId: context.adminTelegramUserId,
      actionKey: 'integration.audit-log',
      targetType: 'integration-test',
      targetId: 7,
      summary: 'Audit integration event',
      details: {
        seed: context.seedSuffix,
        nested: { ok: true },
      },
    });

    const auditResult = await context.connection.pool.query(
      `
        select actor_telegram_user_id, action_key, target_type, target_id, summary, details
        from audit_log
        where action_key = 'integration.audit-log' and summary = 'Audit integration event'
        order by id desc
        limit 1
      `,
    );

    assert.deepEqual(auditResult.rows[0], {
      actor_telegram_user_id: String(context.adminTelegramUserId),
      action_key: 'integration.audit-log',
      target_type: 'integration-test',
      target_id: '7',
      summary: 'Audit integration event',
      details: {
        seed: context.seedSuffix,
        nested: { ok: true },
      },
    });
  } finally {
    await context.cleanup();
  }
});

async function createIntegrationContext() {
  if (!integrationConfig) {
    throw new Error('Integration runtime config is not available');
  }

  await applyMigrations({ config: integrationConfig });

  const connection = await connectPostgresDatabase({
    connectionString: createPostgresConnectionString(integrationConfig.database),
    ssl: integrationConfig.database.ssl,
    logger: {
      error: () => {},
    },
  });

  const seed = createSeed();

  await connection.pool.query(
    `
      insert into users (telegram_user_id, username, display_name, status, is_approved, is_admin, created_at, updated_at)
      values
        ($1, $2, $3, 'pending', false, false, now(), now()),
        ($4, $5, $6, 'approved', true, true, now(), now())
    `,
    [
      seed.pendingUserTelegramUserId,
      `pending_${seed.seedSuffix}`,
      `Pending ${seed.seedSuffix}`,
      seed.adminTelegramUserId,
      `admin_${seed.seedSuffix}`,
      `Admin ${seed.seedSuffix}`,
    ],
  );

  return {
    connection,
    pendingUserTelegramUserId: seed.pendingUserTelegramUserId,
    adminTelegramUserId: seed.adminTelegramUserId,
    seedSuffix: seed.seedSuffix,
    async cleanup() {
      await connection.db.execute(
        sql`delete from audit_log where actor_telegram_user_id in (${seed.pendingUserTelegramUserId}, ${seed.adminTelegramUserId})`,
      );
      await connection.db.execute(
        sql`delete from user_permission_audit_log where subject_telegram_user_id in (${seed.pendingUserTelegramUserId}, ${seed.adminTelegramUserId})`,
      );
      await connection.db.execute(
        sql`delete from user_status_audit_log where subject_telegram_user_id in (${seed.pendingUserTelegramUserId}, ${seed.adminTelegramUserId})`,
      );
      await connection.db.execute(
        sql`delete from users where telegram_user_id in (${seed.pendingUserTelegramUserId}, ${seed.adminTelegramUserId})`,
      );
      await connection.close();
    },
  };
}

function createSeed() {
  const seedSuffix = `${Date.now()}_${process.pid}_${Math.floor(Math.random() * 100000)}`;
  const baseTelegramUserId = Number(`8${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 100)}`);

  return {
    pendingUserTelegramUserId: baseTelegramUserId,
    adminTelegramUserId: baseTelegramUserId + 1,
    seedSuffix,
  };
}
