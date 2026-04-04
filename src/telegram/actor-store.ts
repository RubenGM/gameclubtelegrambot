import { eq } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { userPermissionAssignments, users } from '../infrastructure/database/schema.js';

export type TelegramActorStatus = 'pending' | 'approved' | 'blocked';

export interface TelegramActorPermission {
  permissionKey: string;
  scopeType: 'global' | 'resource';
  resourceType: string | null;
  resourceId: string | null;
  effect: 'allow' | 'deny';
}

export interface TelegramActor {
  telegramUserId: number;
  status: TelegramActorStatus;
  isApproved: boolean;
  isBlocked: boolean;
  isAdmin: boolean;
  permissions: TelegramActorPermission[];
}

export interface TelegramActorStore {
  loadActor(telegramUserId: number): Promise<TelegramActor>;
}

export function createDatabaseTelegramActorStore({
  database,
}: {
  database: DatabaseConnection['db'];
}): TelegramActorStore {
  return {
    async loadActor(telegramUserId) {
      const result = await database
        .select({
          telegramUserId: users.telegramUserId,
          status: users.status,
          isApproved: users.isApproved,
          isAdmin: users.isAdmin,
        })
        .from(users)
        .where(eq(users.telegramUserId, telegramUserId));

      const actor = result[0];
      const status = (actor?.status ?? 'pending') as TelegramActorStatus;
      const permissions = await database
        .select({
          permissionKey: userPermissionAssignments.permissionKey,
          scopeType: userPermissionAssignments.scopeType,
          resourceType: userPermissionAssignments.resourceType,
          resourceId: userPermissionAssignments.resourceId,
          effect: userPermissionAssignments.effect,
        })
        .from(userPermissionAssignments)
        .where(eq(userPermissionAssignments.subjectTelegramUserId, telegramUserId));

      return {
        telegramUserId,
        status,
        isApproved: status === 'approved' || actor?.isApproved === true,
        isBlocked: status === 'blocked',
        isAdmin: actor?.isAdmin ?? false,
        permissions: permissions as TelegramActorPermission[],
      };
    },
  };
}
