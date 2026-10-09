import { and, asc, desc, eq, inArray, exists, notExists, sql } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { auditLog, printJobs, userPermissionAssignments, userPermissionAuditLog, users } from '../infrastructure/database/schema.js';

export const printPermissionKey = 'printing.use';

export interface PrintPermissionUserRecord {
  telegramUserId: number;
  username: string | null;
  displayName: string;
  status: string;
  isAdmin: boolean;
}

export interface PrintPermissionUsageStats {
  telegramUserId: number;
  submittedJobs: number;
  estimatedPhysicalPages: number;
  totalPrintedPages: number;
  totalCopies: number;
}

export interface PrintUsageLeaderboardEntry extends PrintPermissionUsageStats {
  displayName: string;
  username: string | null;
}

export interface PrintPermissionRepository {
  listTopPrintUsers(): Promise<PrintUsageLeaderboardEntry[]>;
  findUserByTelegramUserId(telegramUserId: number): Promise<PrintPermissionUserRecord | null>;
  listGrantableUsers(): Promise<PrintPermissionUserRecord[]>;
  listAllowedUsers(): Promise<PrintPermissionUserRecord[]>;
  listUserPrintStats(telegramUserIds: number[]): Promise<PrintPermissionUsageStats[]>;
  grantPrintPermission(input: {
    subjectTelegramUserId: number;
    changedByTelegramUserId: number;
  }): Promise<void>;
  revokePrintPermission(input: {
    subjectTelegramUserId: number;
    changedByTelegramUserId: number;
  }): Promise<void>;
}

export function createDatabasePrintPermissionRepository({
  database,
}: {
  database: DatabaseConnection['db'];
}): PrintPermissionRepository {
  async function listPermissionUsers(denied: boolean): Promise<PrintPermissionUserRecord[]> {
    const denial = database.select({ id: userPermissionAssignments.id })
      .from(userPermissionAssignments)
      .where(and(
        eq(userPermissionAssignments.subjectTelegramUserId, users.telegramUserId),
        eq(userPermissionAssignments.permissionKey, printPermissionKey),
        eq(userPermissionAssignments.scopeType, 'global'),
        eq(userPermissionAssignments.effect, 'deny'),
      ));
    return database.select({
      telegramUserId: users.telegramUserId,
      username: users.username,
      displayName: users.displayName,
      status: users.status,
      isAdmin: users.isAdmin,
    }).from(users).where(and(
      eq(users.status, 'approved'), eq(users.isAdmin, false),
      denied ? exists(denial) : notExists(denial),
    )).orderBy(asc(users.displayName), asc(users.telegramUserId));
  }

  return {
    async findUserByTelegramUserId(telegramUserId) {
      const rows = await database
        .select({
          telegramUserId: users.telegramUserId,
          username: users.username,
          displayName: users.displayName,
          status: users.status,
          isAdmin: users.isAdmin,
        })
        .from(users)
        .where(eq(users.telegramUserId, telegramUserId));
      return rows[0] ?? null;
    },
    async listGrantableUsers() {
      return listPermissionUsers(true);
    },
    async listAllowedUsers() {
      return listPermissionUsers(false);
    },
    async listUserPrintStats(telegramUserIds) {
      if (telegramUserIds.length === 0) {
        return [];
      }

      const rows = await database
        .select({
          telegramUserId: printJobs.requestedByTelegramUserId,
          submittedJobs: sql<number>`count(*)::int`,
          totalPrintedPages: sql<number>`coalesce(sum(${printJobs.selectedPageCount} * ${printJobs.copies}), 0)::int`,
          totalCopies: sql<number>`coalesce(sum(${printJobs.copies}), 0)::int`,
          estimatedPhysicalPages: sql<number>`coalesce(sum(${printJobs.estimatedPhysicalPages}), 0)::int`,
        })
        .from(printJobs)
        .where(and(
          inArray(printJobs.requestedByTelegramUserId, telegramUserIds),
          eq(printJobs.status, 'submitted'),
          sql`${printJobs.cupsJobId} is distinct from 'test-mode'`,
        ))
        .groupBy(printJobs.requestedByTelegramUserId);

      return rows.map((row) => ({
        telegramUserId: row.telegramUserId,
        submittedJobs: Number(row.submittedJobs),
        totalPrintedPages: Number(row.totalPrintedPages),
        totalCopies: Number(row.totalCopies),
        estimatedPhysicalPages: Number(row.estimatedPhysicalPages),
      }));
    },
    async listTopPrintUsers() {
      const totalPrintedPages = sql<number>`coalesce(sum(${printJobs.selectedPageCount} * ${printJobs.copies}), 0)::int`;
      const submittedJobs = sql<number>`count(*)::int`;
      const rows = await database.select({
        telegramUserId: printJobs.requestedByTelegramUserId,
        displayName: sql<string>`coalesce(${users.displayName}, max(${printJobs.requestedByDisplayName}))`,
        username: users.username,
        submittedJobs,
        totalPrintedPages,
        totalCopies: sql<number>`coalesce(sum(${printJobs.copies}), 0)::int`,
        estimatedPhysicalPages: sql<number>`coalesce(sum(${printJobs.estimatedPhysicalPages}), 0)::int`,
      }).from(printJobs)
        .leftJoin(users, eq(users.telegramUserId, printJobs.requestedByTelegramUserId))
        .where(and(eq(printJobs.status, 'submitted'), sql`${printJobs.cupsJobId} is distinct from 'test-mode'`))
        .groupBy(printJobs.requestedByTelegramUserId, users.displayName, users.username)
        .orderBy(desc(totalPrintedPages), desc(submittedJobs), asc(printJobs.requestedByTelegramUserId))
        .limit(10);
      return rows.map((row) => ({
        ...row,
        submittedJobs: Number(row.submittedJobs),
        totalPrintedPages: Number(row.totalPrintedPages),
        totalCopies: Number(row.totalCopies),
        estimatedPhysicalPages: Number(row.estimatedPhysicalPages),
      }));
    },
    async grantPrintPermission(input) {
      await database.transaction(async (tx) => {
        await persistPrintPermissionChange({
          tx,
          ...input,
          nextEffect: 'allow',
          auditActionKey: 'printing.permission.granted',
          auditSummary: 'Permis d impressio concedit',
        });
      });
    },
    async revokePrintPermission(input) {
      await database.transaction(async (tx) => {
        await persistPrintPermissionChange({
          tx,
          ...input,
          nextEffect: 'deny',
          auditActionKey: 'printing.permission.revoked',
          auditSummary: 'Permis d impressio revocat',
        });
      });
    },
  };
}

async function persistPrintPermissionChange({
  tx,
  subjectTelegramUserId,
  changedByTelegramUserId,
  nextEffect,
  auditActionKey,
  auditSummary,
}: {
  tx: DatabaseConnection['db'];
  subjectTelegramUserId: number;
  changedByTelegramUserId: number;
  nextEffect: 'allow' | 'deny';
  auditActionKey: string;
  auditSummary: string;
}): Promise<void> {
  const existingRows = await tx
    .select({ effect: userPermissionAssignments.effect })
    .from(userPermissionAssignments)
    .where(
      and(
        eq(userPermissionAssignments.subjectTelegramUserId, subjectTelegramUserId),
        eq(userPermissionAssignments.permissionKey, printPermissionKey),
        eq(userPermissionAssignments.scopeType, 'global'),
      ),
    );

  if (existingRows.length > 0) {
    await tx
      .update(userPermissionAssignments)
      .set({
        effect: nextEffect,
        grantedByTelegramUserId: changedByTelegramUserId,
        reason: 'printing-permission',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userPermissionAssignments.subjectTelegramUserId, subjectTelegramUserId),
          eq(userPermissionAssignments.permissionKey, printPermissionKey),
          eq(userPermissionAssignments.scopeType, 'global'),
        ),
      );
  } else {
    await tx
      .insert(userPermissionAssignments)
      .values({
        subjectTelegramUserId,
        permissionKey: printPermissionKey,
        scopeType: 'global',
        resourceType: null,
        resourceId: null,
        effect: nextEffect,
        grantedByTelegramUserId: changedByTelegramUserId,
        reason: 'printing-permission',
      });
  }

  await tx.insert(userPermissionAuditLog).values({
    subjectTelegramUserId,
    permissionKey: printPermissionKey,
    scopeType: 'global',
    resourceType: null,
    resourceId: null,
    previousEffect: existingRows[0]?.effect ?? null,
    nextEffect,
    changedByTelegramUserId,
    reason: 'printing-permission',
  });

  await tx.insert(auditLog).values({
    actorTelegramUserId: changedByTelegramUserId,
    actionKey: auditActionKey,
    targetType: 'membership-user',
    targetId: String(subjectTelegramUserId),
    summary: auditSummary,
    details: {
      permissionKey: printPermissionKey,
      nextEffect,
    },
  });
}
