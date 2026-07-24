import { and, asc, eq } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { auditLog, userPermissionAssignments, userPermissionAuditLog, users } from '../infrastructure/database/schema.js';

export const imageGenerationPermissionKey = 'image_generation.use';

export interface ImageGenerationPermissionUserRecord {
  telegramUserId: number;
  username: string | null;
  displayName: string;
  status: string;
  isAdmin: boolean;
}

export interface ImageGenerationPermissionRepository {
  findUserByTelegramUserId(telegramUserId: number): Promise<ImageGenerationPermissionUserRecord | null>;
  listGrantableUsers(): Promise<ImageGenerationPermissionUserRecord[]>;
  listAllowedUsers(): Promise<ImageGenerationPermissionUserRecord[]>;
  grantPermission(input: { subjectTelegramUserId: number; changedByTelegramUserId: number }): Promise<void>;
  revokePermission(input: { subjectTelegramUserId: number; changedByTelegramUserId: number }): Promise<void>;
}

export function createDatabaseImageGenerationPermissionRepository({ database }: { database: DatabaseConnection['db'] }): ImageGenerationPermissionRepository {
  const selectUser = {
    telegramUserId: users.telegramUserId,
    username: users.username,
    displayName: users.displayName,
    status: users.status,
    isAdmin: users.isAdmin,
  };
  return {
    async findUserByTelegramUserId(telegramUserId) {
      return (await database.select(selectUser).from(users).where(eq(users.telegramUserId, telegramUserId)))[0] ?? null;
    },
    async listGrantableUsers() {
      return database.select(selectUser).from(users)
        .where(and(eq(users.status, 'approved'), eq(users.isAdmin, false)))
        .orderBy(asc(users.displayName), asc(users.telegramUserId));
    },
    async listAllowedUsers() {
      return database.select(selectUser).from(userPermissionAssignments)
        .innerJoin(users, eq(userPermissionAssignments.subjectTelegramUserId, users.telegramUserId))
        .where(and(
          eq(users.status, 'approved'), eq(users.isAdmin, false),
          eq(userPermissionAssignments.permissionKey, imageGenerationPermissionKey),
          eq(userPermissionAssignments.scopeType, 'global'),
          eq(userPermissionAssignments.effect, 'allow'),
        ))
        .orderBy(asc(users.displayName), asc(users.telegramUserId));
    },
    async grantPermission(input) { await persistPermissionChange(database, input, 'allow'); },
    async revokePermission(input) { await persistPermissionChange(database, input, 'deny'); },
  };
}

async function persistPermissionChange(
  database: DatabaseConnection['db'],
  input: { subjectTelegramUserId: number; changedByTelegramUserId: number },
  nextEffect: 'allow' | 'deny',
): Promise<void> {
  await database.transaction(async (tx) => {
    const where = and(
      eq(userPermissionAssignments.subjectTelegramUserId, input.subjectTelegramUserId),
      eq(userPermissionAssignments.permissionKey, imageGenerationPermissionKey),
      eq(userPermissionAssignments.scopeType, 'global'),
    );
    const existing = await tx.select({ effect: userPermissionAssignments.effect }).from(userPermissionAssignments).where(where);
    const values = {
      effect: nextEffect,
      grantedByTelegramUserId: input.changedByTelegramUserId,
      reason: 'image-generation-permission',
      updatedAt: new Date(),
    };
    if (existing.length) await tx.update(userPermissionAssignments).set(values).where(where);
    else await tx.insert(userPermissionAssignments).values({
      subjectTelegramUserId: input.subjectTelegramUserId,
      permissionKey: imageGenerationPermissionKey,
      scopeType: 'global', resourceType: null, resourceId: null,
      ...values,
    });
    await tx.insert(userPermissionAuditLog).values({
      subjectTelegramUserId: input.subjectTelegramUserId, permissionKey: imageGenerationPermissionKey,
      scopeType: 'global', resourceType: null, resourceId: null,
      previousEffect: existing[0]?.effect ?? null, nextEffect,
      changedByTelegramUserId: input.changedByTelegramUserId, reason: 'image-generation-permission',
    });
    await tx.insert(auditLog).values({
      actorTelegramUserId: input.changedByTelegramUserId,
      actionKey: `image_generation.permission.${nextEffect === 'allow' ? 'granted' : 'revoked'}`,
      targetType: 'membership-user', targetId: String(input.subjectTelegramUserId),
      summary: nextEffect === 'allow' ? 'Permis de generacio d imatges concedit' : 'Permis de generacio d imatges revocat',
      details: { permissionKey: imageGenerationPermissionKey, nextEffect },
    });
  });
}
