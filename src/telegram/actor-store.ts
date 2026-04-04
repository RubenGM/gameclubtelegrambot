import { eq } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { users } from '../infrastructure/database/schema.js';

export interface TelegramActor {
  telegramUserId: number;
  isApproved: boolean;
  isAdmin: boolean;
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
          isApproved: users.isApproved,
          isAdmin: users.isAdmin,
        })
        .from(users)
        .where(eq(users.telegramUserId, telegramUserId));

      const actor = result[0];

      return {
        telegramUserId,
        isApproved: actor?.isApproved ?? false,
        isAdmin: actor?.isAdmin ?? false,
      };
    },
  };
}
