import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { auditLog } from '../infrastructure/database/schema.js';
import type { AuditLogRepository } from './audit-log.js';

export function createDatabaseAuditLogRepository({
  database,
}: {
  database: DatabaseConnection['db'];
}): AuditLogRepository {
  return {
    async appendEvent(input) {
      await database.insert(auditLog).values({
        actorTelegramUserId: input.actorTelegramUserId,
        actionKey: input.actionKey,
        targetType: input.targetType,
        targetId: input.targetId,
        summary: input.summary,
        details: input.details ?? null,
      });
    },
  };
}
