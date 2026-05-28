import { and, desc, eq, sql } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { auditLog, userStatusAuditLog, users } from '../infrastructure/database/schema.js';
import type { MembershipAccessRepository, MembershipUserRecord } from './access-flow.js';
import { formatMembershipDisplayName, isGenericDisplayName, normalizeDisplayName, resolveMembershipDisplayName } from './display-name.js';

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
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(eq(users.telegramUserId, telegramUserId));

      const row = result[0];
      if (!row) {
        return null;
      }

      return mapMembershipUserRow(row);
    },
    async syncUserProfile(input) {
      const existingResult = await database
        .select({
          telegramUserId: users.telegramUserId,
          username: users.username,
          displayName: users.displayName,
          status: users.status,
          isAdmin: users.isAdmin,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(eq(users.telegramUserId, input.telegramUserId));
      const existing = existingResult[0] ? mapMembershipUserRow(existingResult[0]) : undefined;
      if (!existing) {
        return null;
      }

      const nextDisplayName = isGenericDisplayName(existing.displayName)
        ? resolveMembershipDisplayName({
          displayName: input.displayName,
          ...(input.username !== undefined
            ? { username: input.username }
            : existing.username !== undefined
              ? { username: existing.username }
              : {}),
          fallbackLabel: formatMembershipDisplayName(existing),
        })
        : existing.displayName;
      const nextUsername = input.username !== undefined ? normalizeDisplayName(input.username) : normalizeDisplayName(existing.username);

      if (nextDisplayName === existing.displayName && nextUsername === normalizeDisplayName(existing.username)) {
        return existing;
      }

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
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        });

      return updated[0] ? mapMembershipUserRow(updated[0]) : null;
    },
    async updateDisplayName(input) {
      const nextDisplayName = normalizeDisplayName(input.displayName);
      if (!nextDisplayName) {
        return null;
      }

      const updated = await database
        .update(users)
        .set({
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
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        });

      return updated[0] ? mapMembershipUserRow(updated[0]) : null;
    },
    async upsertPendingUser(input) {
      const result = await database
        .insert(users)
        .values({
          telegramUserId: input.telegramUserId,
          ...(input.username !== undefined ? { username: normalizeDisplayName(input.username) } : {}),
          displayName: resolveMembershipDisplayName({
            displayName: input.displayName,
            ...(input.username !== undefined ? { username: input.username } : {}),
          }),
          status: 'pending',
          isApproved: false,
          isAdmin: false,
        })
        .onConflictDoUpdate({
          target: users.telegramUserId,
          set: {
            ...(input.username !== undefined ? { username: input.username } : {}),
            displayName: resolveMembershipDisplayName({
              displayName: input.displayName,
              ...(input.username !== undefined ? { username: input.username } : {}),
            }),
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
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        });

      const row = result[0];
      if (!row) {
        throw new Error(`Pending membership user ${input.telegramUserId} was not returned`);
      }
      return mapMembershipUserRow(row);
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

        const nextDisplayName = resolveMembershipDisplayName({
          displayName: row.displayName,
          username: row.username,
        });

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
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(eq(users.status, 'pending'));

      return result.map(mapMembershipUserRow);
    },
    async listManageableUsers() {
      const result = await database
        .select({
          telegramUserId: users.telegramUserId,
          username: users.username,
          displayName: users.displayName,
          status: users.status,
          isAdmin: users.isAdmin,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(sql`true`)
        .orderBy(users.displayName, users.telegramUserId);

      return result.map(mapMembershipUserRow);
    },
    async listRevocableUsers() {
      const result = await database
        .select({
          telegramUserId: users.telegramUserId,
          username: users.username,
          displayName: users.displayName,
          status: users.status,
          isAdmin: users.isAdmin,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(and(eq(users.status, 'approved'), eq(users.isAdmin, false)))
        .orderBy(users.displayName, users.telegramUserId);

      return result.map(mapMembershipUserRow);
    },
    async listApprovedAdminUsers() {
      const result = await database
        .select({
          telegramUserId: users.telegramUserId,
          username: users.username,
          displayName: users.displayName,
          status: users.status,
          isAdmin: users.isAdmin,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(and(eq(users.status, 'approved'), eq(users.isAdmin, true)))
        .orderBy(users.displayName, users.telegramUserId);

      return result.map(mapMembershipUserRow);
    },
    async findLatestRevocation(telegramUserId) {
      const result = await database
        .select({
          changedByTelegramUserId: userStatusAuditLog.changedByTelegramUserId,
          createdAt: userStatusAuditLog.createdAt,
          reason: userStatusAuditLog.reason,
        })
        .from(userStatusAuditLog)
        .where(and(eq(userStatusAuditLog.subjectTelegramUserId, telegramUserId), eq(userStatusAuditLog.nextStatus, 'revoked')))
        .orderBy(desc(userStatusAuditLog.createdAt), desc(userStatusAuditLog.id))
        .limit(1);

      const row = result[0];
      if (!row) {
        return null;
      }

      return {
        changedByTelegramUserId: row.changedByTelegramUserId,
        createdAt: row.createdAt.toISOString(),
        reason: row.reason,
      };
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
            revokedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(users.telegramUserId, input.telegramUserId))
          .returning({
            telegramUserId: users.telegramUserId,
            username: users.username,
            displayName: users.displayName,
            status: users.status,
            isAdmin: users.isAdmin,
            createdAt: users.createdAt,
            updatedAt: users.updatedAt,
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

        return mapMembershipUserRow(row);
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
            revokedAt: null,
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
            createdAt: users.createdAt,
            updatedAt: users.updatedAt,
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

        return mapMembershipUserRow(row);
      });
    },
    async revokeMembershipAccess(input) {
      return database.transaction(async (tx) => {
        const updated = await tx
          .update(users)
          .set({
            status: 'revoked',
            isApproved: false,
            approvedAt: null,
            blockedAt: null,
            revokedAt: new Date(),
            statusReason: input.reason,
            updatedAt: new Date(),
          })
          .where(eq(users.telegramUserId, input.telegramUserId))
          .returning({
            telegramUserId: users.telegramUserId,
            username: users.username,
            displayName: users.displayName,
            status: users.status,
            isAdmin: users.isAdmin,
            createdAt: users.createdAt,
            updatedAt: users.updatedAt,
          });

        const row = updated[0];
        if (!row) {
          throw new Error(`Membership user ${input.telegramUserId} not found`);
        }

        await tx.insert(userStatusAuditLog).values({
          subjectTelegramUserId: input.telegramUserId,
          previousStatus: input.previousStatus,
          nextStatus: 'revoked',
          changedByTelegramUserId: input.changedByTelegramUserId,
          reason: input.reason,
        });
        await tx.insert(auditLog).values({
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
        });

        return mapMembershipUserRow(row);
      });
    },
  };
}

function mapMembershipUserRow(row: {
  telegramUserId: number;
  username: string | null;
  displayName: string;
  status: string;
  isAdmin: boolean;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}): MembershipUserRecord {
  return {
    telegramUserId: row.telegramUserId,
    username: row.username,
    displayName: row.displayName,
    status: row.status as MembershipUserRecord['status'],
    isAdmin: row.isAdmin,
    ...(row.createdAt ? { createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt } : {}),
    ...(row.updatedAt ? { updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt } : {}),
  };
}
