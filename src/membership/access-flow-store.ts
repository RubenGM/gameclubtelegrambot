import { eq } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { userStatusAuditLog, users } from '../infrastructure/database/schema.js';
import type { MembershipAccessRepository, MembershipUserRecord, MembershipUserStatus } from './access-flow.js';

export function createDatabaseMembershipAccessRepository({
  database,
}: {
  database: DatabaseConnection['db'];
}): MembershipAccessRepository {
  return {
    async findUserByTelegramUserId(telegramUserId) {
      const result = await database
        .select({
          telegramUserId: users.telegramUserId,
          username: users.username,
          displayName: users.displayName,
          status: users.status,
          isAdmin: users.isAdmin,
        })
        .from(users)
        .where(eq(users.telegramUserId, telegramUserId));

      const row = result[0];
      if (!row) {
        return null;
      }

      return row as MembershipUserRecord;
    },
    async upsertPendingUser(input) {
      const result = await database
        .insert(users)
        .values({
          telegramUserId: input.telegramUserId,
          ...(input.username !== undefined ? { username: input.username } : {}),
          displayName: input.displayName,
          status: 'pending',
          isApproved: false,
          isAdmin: false,
        })
        .onConflictDoUpdate({
          target: users.telegramUserId,
          set: {
            ...(input.username !== undefined ? { username: input.username } : {}),
            displayName: input.displayName,
            status: 'pending',
            isApproved: false,
            updatedAt: new Date(),
          },
        })
        .returning({
          telegramUserId: users.telegramUserId,
          username: users.username,
          displayName: users.displayName,
          status: users.status,
          isAdmin: users.isAdmin,
        });

      return result[0] as MembershipUserRecord;
    },
    async listPendingUsers() {
      const result = await database
        .select({
          telegramUserId: users.telegramUserId,
          username: users.username,
          displayName: users.displayName,
          status: users.status,
          isAdmin: users.isAdmin,
        })
        .from(users)
        .where(eq(users.status, 'pending'));

      return result as MembershipUserRecord[];
    },
    async updateUserStatus(input) {
      const nextStatus = input.status;
      const updated = await database
        .update(users)
        .set({
          status: nextStatus,
          isApproved: nextStatus === 'approved',
          ...(input.isAdmin !== undefined ? { isAdmin: input.isAdmin } : {}),
          approvedAt: nextStatus === 'approved' ? new Date() : null,
          blockedAt: nextStatus === 'blocked' ? new Date() : null,
          ...(input.reason !== undefined ? { statusReason: input.reason } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.telegramUserId, input.telegramUserId))
        .returning({
          telegramUserId: users.telegramUserId,
          username: users.username,
          displayName: users.displayName,
          status: users.status,
          isAdmin: users.isAdmin,
        });

      const row = updated[0];
      if (!row) {
        throw new Error(`Membership user ${input.telegramUserId} not found`);
      }

      return row as MembershipUserRecord;
    },
    async appendStatusAuditLog(input) {
      await database.insert(userStatusAuditLog).values({
        subjectTelegramUserId: input.telegramUserId,
        previousStatus: input.previousStatus,
        nextStatus: input.nextStatus,
        changedByTelegramUserId: input.changedByTelegramUserId,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
      });
    },
  };
}
