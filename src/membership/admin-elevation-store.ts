import { and, count, eq } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { auditLog, userPermissionAuditLog, users } from '../infrastructure/database/schema.js';
import type { AdminElevationRepository, AdminElevationUserRecord } from './admin-elevation.js';

export function createDatabaseAdminElevationRepository({
  database,
}: {
  database: DatabaseConnection['db'];
}): AdminElevationRepository {
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
    async countApprovedAdmins() {
      const result = await database
        .select({ value: count() })
        .from(users)
        .where(and(eq(users.status, 'approved'), eq(users.isAdmin, true)));
      return result[0]?.value ?? 0;
    },
    async elevateUserToAdmin(input) {
      return database.transaction(async (tx) => {
        const updated = await tx
          .update(users)
          .set({
            isAdmin: true,
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

        await tx.insert(userPermissionAuditLog).values({
          subjectTelegramUserId: input.telegramUserId,
          permissionKey: 'role.admin',
          scopeType: 'global',
          resourceType: null,
          resourceId: null,
          previousEffect: null,
          nextEffect: 'allow',
          changedByTelegramUserId: input.changedByTelegramUserId,
          reason: input.reason ?? 'password-match',
        });
        await tx.insert(auditLog).values({
          actorTelegramUserId: input.changedByTelegramUserId,
          actionKey: input.actionKey ?? 'membership.admin-elevated',
          targetType: 'membership-user',
          targetId: String(input.telegramUserId),
          summary: 'Usuari elevat a administrador',
          details: {
            outcome: 'elevated',
          },
        });

        return row as AdminElevationUserRecord;
      });
    },
    async revokeUserAdminRole(input) {
      return database.transaction(async (tx) => {
        const updated = await tx
          .update(users)
          .set({
            isAdmin: false,
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
          throw new Error(`Admin revoke target ${input.telegramUserId} not found`);
        }

        await tx.insert(userPermissionAuditLog).values({
          subjectTelegramUserId: input.telegramUserId,
          permissionKey: 'role.admin',
          scopeType: 'global',
          resourceType: null,
          resourceId: null,
          previousEffect: 'allow',
          nextEffect: null,
          changedByTelegramUserId: input.changedByTelegramUserId,
          reason: input.reason ?? 'admin-user-management',
        });
        await tx.insert(auditLog).values({
          actorTelegramUserId: input.changedByTelegramUserId,
          actionKey: 'membership.admin-revoked',
          targetType: 'membership-user',
          targetId: String(input.telegramUserId),
          summary: 'Acces administrador eliminat',
          details: {
            outcome: 'revoked',
          },
        });

        return row as AdminElevationUserRecord;
      });
    },
  };
}
