import { eq, sql } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { auditLog, userStatusAuditLog, users } from '../infrastructure/database/schema.js';
import type { MembershipAccessRepository, MembershipUserRecord } from './access-flow.js';
import { formatMembershipDisplayName, normalizeDisplayName } from './display-name.js';

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
    async syncUserProfile(input) {
      const existingResult = await database
        .select({
          telegramUserId: users.telegramUserId,
          username: users.username,
          displayName: users.displayName,
          status: users.status,
          isAdmin: users.isAdmin,
        })
        .from(users)
        .where(eq(users.telegramUserId, input.telegramUserId));
      const existing = existingResult[0] as MembershipUserRecord | undefined;
      if (!existing) {
        return null;
      }

      const nextDisplayName = normalizeDisplayName(input.displayName) ?? formatMembershipDisplayName(existing);
      const nextUsername = input.username !== undefined ? normalizeDisplayName(input.username) : normalizeDisplayName(existing.username);

      const updated = await database
        .update(users)
        .set({
          ...(nextUsername !== undefined ? { username: nextUsername } : {}),
          displayName: nextDisplayName,
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

      return (updated[0] as MembershipUserRecord | undefined) ?? null;
    },
    async upsertPendingUser(input) {
      const result = await database
        .insert(users)
        .values({
          telegramUserId: input.telegramUserId,
          ...(input.username !== undefined ? { username: normalizeDisplayName(input.username) } : {}),
          displayName: normalizeDisplayName(input.displayName) ?? 'Usuari',
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
    async backfillDisplayNames() {
      const result = await database
        .select({
          telegramUserId: users.telegramUserId,
          username: users.username,
          displayName: users.displayName,
        })
        .from(users)
        .where(sql`true`);

      let updatedCount = 0;

      for (const row of result) {
        const currentDisplayName = normalizeDisplayName(row.displayName);
        if (currentDisplayName) {
          continue;
        }

        const nextDisplayName = formatMembershipDisplayName(
          {
            displayName: row.displayName,
            username: row.username,
          },
          'Usuari',
        );

        await database
          .update(users)
          .set({
            displayName: nextDisplayName,
            updatedAt: new Date(),
          })
          .where(eq(users.telegramUserId, row.telegramUserId));

        updatedCount += 1;
      }

      return updatedCount;
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
    async appendStatusAuditLog(input) {
      await database.insert(userStatusAuditLog).values({
        subjectTelegramUserId: input.telegramUserId,
        previousStatus: input.previousStatus,
        nextStatus: input.nextStatus,
        changedByTelegramUserId: input.changedByTelegramUserId,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
      });
    },
    async approveMembershipRequest(input) {
      return database.transaction(async (tx) => {
        const updated = await tx
          .update(users)
          .set({
            status: 'approved',
            isApproved: true,
            approvedAt: new Date(),
            blockedAt: null,
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

        await tx.insert(userStatusAuditLog).values({
          subjectTelegramUserId: input.telegramUserId,
          previousStatus: input.previousStatus,
          nextStatus: 'approved',
          changedByTelegramUserId: input.changedByTelegramUserId,
          reason: 'member-access-approved',
        });
        await tx.insert(auditLog).values({
          actorTelegramUserId: input.changedByTelegramUserId,
          actionKey: 'membership.approved',
          targetType: 'membership-user',
          targetId: String(input.telegramUserId),
          summary: 'Usuari aprovat correctament',
          details: {
            previousStatus: input.previousStatus,
            nextStatus: 'approved',
          },
        });

        return row as MembershipUserRecord;
      });
    },
    async rejectMembershipRequest(input) {
      return database.transaction(async (tx) => {
        const updated = await tx
          .update(users)
          .set({
            status: 'blocked',
            isApproved: false,
            approvedAt: null,
            blockedAt: new Date(),
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

        await tx.insert(userStatusAuditLog).values({
          subjectTelegramUserId: input.telegramUserId,
          previousStatus: input.previousStatus,
          nextStatus: 'blocked',
          changedByTelegramUserId: input.changedByTelegramUserId,
          reason: input.reason ?? 'member-access-rejected',
        });
        await tx.insert(auditLog).values({
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
        });

        return row as MembershipUserRecord;
      });
    },
  };
}
