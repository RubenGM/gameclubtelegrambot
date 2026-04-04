import { sql, eq } from 'drizzle-orm';

import { createDatabaseAuditLogRepository } from '../audit/audit-log-store.js';
import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import type { AdminElevationRepository, AdminElevationUserRecord } from './admin-elevation.js';
import { users } from '../infrastructure/database/schema.js';

export function createDatabaseAdminElevationRepository({
  database,
}: {
  database: DatabaseConnection['db'];
}): AdminElevationRepository {
  const auditRepository = createDatabaseAuditLogRepository({ database });

  return {
    async findUserByTelegramUserId(telegramUserId) {
      const result = await database
        .select({
          telegramUserId: users.telegramUserId,
          status: users.status,
          isAdmin: users.isAdmin,
        })
        .from(users)
        .where(eq(users.telegramUserId, telegramUserId));

      const row = result[0];
      return (row as AdminElevationUserRecord | undefined) ?? null;
    },
    async updateAdminRole(input) {
      const updated = await database
        .update(users)
        .set({
          isAdmin: input.isAdmin,
          updatedAt: new Date(),
        })
        .where(eq(users.telegramUserId, input.telegramUserId))
        .returning({
          telegramUserId: users.telegramUserId,
          status: users.status,
          isAdmin: users.isAdmin,
        });

      const row = updated[0];
      if (!row) {
        throw new Error(`Admin elevation target ${input.telegramUserId} not found`);
      }

      return row as AdminElevationUserRecord;
    },
    async appendAdminElevationAuditLog(input) {
      await database.execute(
        sql`insert into user_status_audit_log (subject_telegram_user_id, previous_status, next_status, changed_by_telegram_user_id, reason)
            values (${input.telegramUserId}, null, 'approved', ${input.telegramUserId}, ${input.reason ?? input.outcome})`,
      );
    },
    async appendAuditEvent(input) {
      await auditRepository.appendEvent(input);
    },
  };
}
