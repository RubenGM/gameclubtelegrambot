import { and, desc, eq } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { lfgGroupAds, lfgPlayerAds, users } from '../infrastructure/database/schema.js';
import type { LfgAdStatus, LfgGroupAdRecord, LfgPlayerAdRecord, LfgRepository } from './lfg-catalog.js';

const activeStatus = 'active' satisfies LfgAdStatus;

export function createDatabaseLfgRepository({
  database,
}: {
  database: DatabaseConnection['db'];
}): LfgRepository {
  return {
    async upsertActivePlayerAd(input) {
      const existing = await this.listActiveAdsByUser(input.telegramUserId);
      const activePlayerAd = existing.playerAds[0];
      if (activePlayerAd) {
        return this.updatePlayerAd({
          adId: activePlayerAd.id,
          telegramUserId: input.telegramUserId,
          displayName: input.displayName,
          description: input.description,
        });
      }

      const inserted = await database
        .insert(lfgPlayerAds)
        .values({
          telegramUserId: input.telegramUserId,
          displayName: input.displayName,
          description: input.description,
        })
        .returning();

      const row = inserted[0];
      if (!row) {
        throw new Error('LFG player ad insert did not return a row');
      }
      return mapPlayerAdRow(row);
    },
    async createGroupAd(input) {
      const inserted = await database
        .insert(lfgGroupAds)
        .values({
          createdByTelegramUserId: input.createdByTelegramUserId,
          creatorDisplayName: input.creatorDisplayName,
          title: input.title,
          description: input.description,
          seatsAvailable: input.seatsAvailable,
        })
        .returning();

      const row = inserted[0];
      if (!row) {
        throw new Error('LFG group ad insert did not return a row');
      }
      return mapGroupAdRow(row);
    },
    async updatePlayerAd(input) {
      const updated = await database
        .update(lfgPlayerAds)
        .set({
          displayName: input.displayName,
          description: input.description,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(lfgPlayerAds.id, input.adId),
            eq(lfgPlayerAds.telegramUserId, input.telegramUserId),
            eq(lfgPlayerAds.status, activeStatus),
          ),
        )
        .returning();

      const row = updated[0];
      if (!row) {
        throw new Error(`LFG player ad ${input.adId} not found`);
      }
      return mapPlayerAdRow(row);
    },
    async updateGroupAd(input) {
      const updated = await database
        .update(lfgGroupAds)
        .set({
          title: input.title,
          description: input.description,
          seatsAvailable: input.seatsAvailable,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(lfgGroupAds.id, input.adId),
            eq(lfgGroupAds.createdByTelegramUserId, input.actorTelegramUserId),
            eq(lfgGroupAds.status, activeStatus),
          ),
        )
        .returning();

      const row = updated[0];
      if (!row) {
        throw new Error(`LFG group ad ${input.adId} not found`);
      }
      return mapGroupAdRow(row);
    },
    async setPlayerAdStatus(input) {
      const now = new Date();
      const updated = await database
        .update(lfgPlayerAds)
        .set({
          status: input.status,
          updatedAt: now,
          resolvedAt: input.status === 'resolved' ? now : null,
          cancelledAt: input.status === 'cancelled' ? now : null,
        })
        .where(
          and(
            eq(lfgPlayerAds.id, input.adId),
            eq(lfgPlayerAds.telegramUserId, input.actorTelegramUserId),
            eq(lfgPlayerAds.status, activeStatus),
          ),
        )
        .returning();

      const row = updated[0];
      if (!row) {
        throw new Error(`LFG player ad ${input.adId} not found`);
      }
      return mapPlayerAdRow(row);
    },
    async setGroupAdStatus(input) {
      const now = new Date();
      const updated = await database
        .update(lfgGroupAds)
        .set({
          status: input.status,
          updatedAt: now,
          resolvedAt: input.status === 'resolved' ? now : null,
          cancelledAt: input.status === 'cancelled' ? now : null,
        })
        .where(
          and(
            eq(lfgGroupAds.id, input.adId),
            eq(lfgGroupAds.createdByTelegramUserId, input.actorTelegramUserId),
            eq(lfgGroupAds.status, activeStatus),
          ),
        )
        .returning();

      const row = updated[0];
      if (!row) {
        throw new Error(`LFG group ad ${input.adId} not found`);
      }
      return mapGroupAdRow(row);
    },
    async listActivePlayerAds() {
      const rows = await database
        .select(playerAdSelection)
        .from(lfgPlayerAds)
        .leftJoin(users, eq(users.telegramUserId, lfgPlayerAds.telegramUserId))
        .where(eq(lfgPlayerAds.status, activeStatus))
        .orderBy(desc(lfgPlayerAds.updatedAt), desc(lfgPlayerAds.id))
        .limit(20);
      return rows.map(mapPlayerAdRow);
    },
    async listActiveGroupAds() {
      const rows = await database
        .select(groupAdSelection)
        .from(lfgGroupAds)
        .leftJoin(users, eq(users.telegramUserId, lfgGroupAds.createdByTelegramUserId))
        .where(eq(lfgGroupAds.status, activeStatus))
        .orderBy(desc(lfgGroupAds.updatedAt), desc(lfgGroupAds.id))
        .limit(20);
      return rows.map(mapGroupAdRow);
    },
    async listActiveAdsByUser(telegramUserId) {
      const [playerRows, groupRows] = await Promise.all([
        database
          .select(playerAdSelection)
          .from(lfgPlayerAds)
          .leftJoin(users, eq(users.telegramUserId, lfgPlayerAds.telegramUserId))
          .where(and(eq(lfgPlayerAds.telegramUserId, telegramUserId), eq(lfgPlayerAds.status, activeStatus)))
          .orderBy(desc(lfgPlayerAds.updatedAt), desc(lfgPlayerAds.id)),
        database
          .select(groupAdSelection)
          .from(lfgGroupAds)
          .leftJoin(users, eq(users.telegramUserId, lfgGroupAds.createdByTelegramUserId))
          .where(and(eq(lfgGroupAds.createdByTelegramUserId, telegramUserId), eq(lfgGroupAds.status, activeStatus)))
          .orderBy(desc(lfgGroupAds.updatedAt), desc(lfgGroupAds.id)),
      ]);

      return {
        playerAds: playerRows.map(mapPlayerAdRow),
        groupAds: groupRows.map(mapGroupAdRow),
      };
    },
    async findPlayerAdById(adId) {
      const rows = await database
        .select(playerAdSelection)
        .from(lfgPlayerAds)
        .leftJoin(users, eq(users.telegramUserId, lfgPlayerAds.telegramUserId))
        .where(eq(lfgPlayerAds.id, adId))
        .limit(1);
      const row = rows[0];
      return row ? mapPlayerAdRow(row) : null;
    },
    async findGroupAdById(adId) {
      const rows = await database
        .select(groupAdSelection)
        .from(lfgGroupAds)
        .leftJoin(users, eq(users.telegramUserId, lfgGroupAds.createdByTelegramUserId))
        .where(eq(lfgGroupAds.id, adId))
        .limit(1);
      const row = rows[0];
      return row ? mapGroupAdRow(row) : null;
    },
  };
}

const playerAdSelection = {
  id: lfgPlayerAds.id,
  telegramUserId: lfgPlayerAds.telegramUserId,
  displayName: lfgPlayerAds.displayName,
  userDisplayName: users.displayName,
  username: users.username,
  description: lfgPlayerAds.description,
  status: lfgPlayerAds.status,
  createdAt: lfgPlayerAds.createdAt,
  updatedAt: lfgPlayerAds.updatedAt,
  resolvedAt: lfgPlayerAds.resolvedAt,
  cancelledAt: lfgPlayerAds.cancelledAt,
};

const groupAdSelection = {
  id: lfgGroupAds.id,
  createdByTelegramUserId: lfgGroupAds.createdByTelegramUserId,
  creatorDisplayName: lfgGroupAds.creatorDisplayName,
  userDisplayName: users.displayName,
  creatorUsername: users.username,
  title: lfgGroupAds.title,
  description: lfgGroupAds.description,
  seatsAvailable: lfgGroupAds.seatsAvailable,
  status: lfgGroupAds.status,
  createdAt: lfgGroupAds.createdAt,
  updatedAt: lfgGroupAds.updatedAt,
  resolvedAt: lfgGroupAds.resolvedAt,
  cancelledAt: lfgGroupAds.cancelledAt,
};

interface PlayerAdReadableRow {
  id: number;
  telegramUserId: number;
  displayName: string;
  userDisplayName?: string | null;
  username?: string | null;
  description: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  cancelledAt: Date | null;
}

interface GroupAdReadableRow {
  id: number;
  createdByTelegramUserId: number;
  creatorDisplayName: string;
  userDisplayName?: string | null;
  creatorUsername?: string | null;
  title: string;
  description: string;
  seatsAvailable: number | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  cancelledAt: Date | null;
}

function mapPlayerAdRow(row: PlayerAdReadableRow): LfgPlayerAdRecord {
  return {
    id: row.id,
    telegramUserId: row.telegramUserId,
    displayName: resolveDisplayName(row.userDisplayName ?? row.displayName),
    username: normalizeUsername(row.username),
    description: row.description,
    status: row.status as LfgAdStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
  };
}

function mapGroupAdRow(row: GroupAdReadableRow): LfgGroupAdRecord {
  return {
    id: row.id,
    createdByTelegramUserId: row.createdByTelegramUserId,
    creatorDisplayName: resolveDisplayName(row.userDisplayName ?? row.creatorDisplayName),
    creatorUsername: normalizeUsername(row.creatorUsername),
    title: row.title,
    description: row.description,
    seatsAvailable: row.seatsAvailable,
    status: row.status as LfgAdStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
  };
}

function resolveDisplayName(value: string | null | undefined): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : 'Usuari';
}

function normalizeUsername(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/^@/, '');
  return normalized && normalized.length > 0 ? normalized : null;
}
