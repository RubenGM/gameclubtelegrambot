import { and, eq } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { auditLog, userPermissionAssignments, userPermissionAuditLog, users } from '../infrastructure/database/schema.js';

export interface StorageCategoryAccessUserRecord {
  telegramUserId: number;
  status: string;
}

export interface StorageCategoryAccessRepository {
  findUserByTelegramUserId(telegramUserId: number): Promise<StorageCategoryAccessUserRecord | null>;
  grantCategoryAccess(input: {
    subjectTelegramUserId: number;
    categoryId: number;
    changedByTelegramUserId: number;
  }): Promise<void>;
  revokeCategoryAccess(input: {
    subjectTelegramUserId: number;
    categoryId: number;
    changedByTelegramUserId: number;
  }): Promise<void>;
}

const categoryPermissionKeys = ['storage.entry.read', 'storage.entry.upload'] as const;

export function createDatabaseStorageCategoryAccessRepository({
  database,
}: {
  database: DatabaseConnection['db'];
}): StorageCategoryAccessRepository {
  return {
    async findUserByTelegramUserId(telegramUserId) {
      const rows = await database
        .select({
          telegramUserId: users.telegramUserId,
          status: users.status,
        })
        .from(users)
        .where(eq(users.telegramUserId, telegramUserId));
      return rows[0] ?? null;
    },
    async grantCategoryAccess({ subjectTelegramUserId, categoryId, changedByTelegramUserId }) {
      await database.transaction(async (tx) => {
        await persistCategoryAccessChange({
          tx,
          subjectTelegramUserId,
          categoryId,
          changedByTelegramUserId,
          nextEffect: 'allow',
          auditActionKey: 'storage.category-access.granted',
          auditSummary: 'Acces de categoria storage concedit',
        });
      });
    },
    async revokeCategoryAccess({ subjectTelegramUserId, categoryId, changedByTelegramUserId }) {
      await database.transaction(async (tx) => {
        await persistCategoryAccessChange({
          tx,
          subjectTelegramUserId,
          categoryId,
          changedByTelegramUserId,
          nextEffect: 'deny',
          auditActionKey: 'storage.category-access.revoked',
          auditSummary: 'Acces de categoria storage revocat',
        });
      });
    },
  };
}

async function persistCategoryAccessChange({
  tx,
  subjectTelegramUserId,
  categoryId,
  changedByTelegramUserId,
  nextEffect,
  auditActionKey,
  auditSummary,
}: {
  tx: DatabaseConnection['db'];
  subjectTelegramUserId: number;
  categoryId: number;
  changedByTelegramUserId: number;
  nextEffect: 'allow' | 'deny';
  auditActionKey: string;
  auditSummary: string;
}): Promise<void> {
  for (const permissionKey of categoryPermissionKeys) {
    const existingRows = await tx
      .select({ effect: userPermissionAssignments.effect })
      .from(userPermissionAssignments)
      .where(
        and(
          eq(userPermissionAssignments.subjectTelegramUserId, subjectTelegramUserId),
          eq(userPermissionAssignments.permissionKey, permissionKey),
          eq(userPermissionAssignments.scopeType, 'resource'),
          eq(userPermissionAssignments.resourceType, 'storage-category'),
          eq(userPermissionAssignments.resourceId, String(categoryId)),
        ),
      );

    await tx
      .insert(userPermissionAssignments)
      .values({
        subjectTelegramUserId,
        permissionKey,
        scopeType: 'resource',
        resourceType: 'storage-category',
        resourceId: String(categoryId),
        effect: nextEffect,
        grantedByTelegramUserId: changedByTelegramUserId,
        reason: 'storage-category-access',
      })
      .onConflictDoUpdate({
        target: [
          userPermissionAssignments.subjectTelegramUserId,
          userPermissionAssignments.permissionKey,
          userPermissionAssignments.scopeType,
          userPermissionAssignments.resourceType,
          userPermissionAssignments.resourceId,
        ],
        set: {
          effect: nextEffect,
          grantedByTelegramUserId: changedByTelegramUserId,
          reason: 'storage-category-access',
          updatedAt: new Date(),
        },
      });

    await tx.insert(userPermissionAuditLog).values({
      subjectTelegramUserId,
      permissionKey,
      scopeType: 'resource',
      resourceType: 'storage-category',
      resourceId: String(categoryId),
      previousEffect: existingRows[0]?.effect ?? null,
      nextEffect,
      changedByTelegramUserId,
      reason: 'storage-category-access',
    });
  }

  await tx.insert(auditLog).values({
    actorTelegramUserId: changedByTelegramUserId,
    actionKey: auditActionKey,
    targetType: 'storage-category',
    targetId: String(categoryId),
    summary: auditSummary,
    details: {
      subjectTelegramUserId,
      permissionKeys: [...categoryPermissionKeys],
      nextEffect,
    },
  });
}
