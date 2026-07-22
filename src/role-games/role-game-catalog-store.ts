import { and, asc, count, eq, inArray, ne, or, sql } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import {
  roleGameCharacters,
  roleGameCharacterAttachments,
  roleGameCharacterClaimRequests,
  roleGameMaterialCategories,
  roleGameMaterialDeliveries,
  roleGameMaterials,
  roleGameMembers,
  roleGameNotionChanges,
  roleGameNotionPageRevisions,
  roleGameNotionSourcePages,
  roleGameNotionSources,
  roleGameNotionWebhookEvents,
  roleGames,
  roleGameSessions,
  scheduleEvents,
  storageEntries,
} from '../infrastructure/database/schema.js';
import type {
  CreateRoleGameMemberInput,
  RoleGameMemberRecord,
  RoleGameMemberStatus,
  RoleGameMaterialDeliveryRecord,
  RoleGameMaterialCategoryRecord,
  RoleGameMaterialRecord,
  RoleGameNotionChangeRecord,
  RoleGameNotionRepository,
  RoleGameNotionSourcePageRecord,
  RoleGameNotionSourceRecord,
  RoleGameNotionWebhookEventRecord,
  RoleGameNotionPageRevisionRecord,
  RoleGameRecord,
  RoleGameRecurrenceRule,
  RoleGameRepository,
  RoleGameSessionRecord,
  UpsertRoleGameNotionSourceInput,
  UpsertRoleGameNotionSourcePageInput,
  UpdateRoleGameInput,
} from './role-game-catalog.js';
import { canViewRoleGame } from './role-game-catalog.js';

type RoleGameRow = typeof roleGames.$inferSelect;
type RoleGameMemberRow = typeof roleGameMembers.$inferSelect;
type RoleGameSessionRow = typeof roleGameSessions.$inferSelect;
type RoleGameMaterialRow = typeof roleGameMaterials.$inferSelect;
type RoleGameMaterialCategoryRow = typeof roleGameMaterialCategories.$inferSelect;
type RoleGameMaterialDeliveryRow = typeof roleGameMaterialDeliveries.$inferSelect;
type RoleGameNotionSourceRow = typeof roleGameNotionSources.$inferSelect;
type RoleGameNotionSourcePageRow = typeof roleGameNotionSourcePages.$inferSelect;
type RoleGameNotionPageRevisionRow = typeof roleGameNotionPageRevisions.$inferSelect;
type RoleGameNotionWebhookEventRow = typeof roleGameNotionWebhookEvents.$inferSelect;
type RoleGameNotionChangeRow = typeof roleGameNotionChanges.$inferSelect;

const activeMemberStatuses = ['invited', 'requested', 'confirmed', 'waitlisted'] as const;

export function createDatabaseRoleGameRepository({
  database,
}: {
  database: DatabaseConnection['db'];
}): RoleGameRepository {
  return {
    notion: createDatabaseRoleGameNotionRepository({ database }),
    async createGame(input) {
      return database.transaction(async (tx) => {
        const createdGames = await tx
          .insert(roleGames)
          .values({
            type: input.type,
            status: 'active',
            title: input.title,
            system: input.system,
            description: input.description,
            visibility: input.visibility,
            publicJoinPolicy: input.publicJoinPolicy,
            entryMode: input.entryMode,
            acceptanceMode: input.acceptanceMode,
            capacity: input.capacity,
            primaryGmTelegramUserId: input.primaryGmTelegramUserId,
            defaultDurationMinutes: input.defaultDurationMinutes,
            defaultTableId: input.defaultTableId,
            defaultAttendanceMode: input.defaultAttendanceMode,
            defaultIsPublicScheduleEvent: input.defaultIsPublicScheduleEvent,
            autoAddConfirmedPlayers: input.autoAddConfirmedPlayers,
            allowPlayerManualScheduling: input.allowPlayerManualScheduling,
            schedulingMode: input.schedulingMode,
            recurrenceRule: input.recurrenceRule,
            recurrenceWindowCount: input.recurrenceWindowCount,
            createdByTelegramUserId: input.createdByTelegramUserId,
          })
          .returning();

        const game = createdGames[0];
        if (!game) {
          throw new Error('Role game insert did not return a row');
        }

        const createdMembers = await tx
          .insert(roleGameMembers)
          .values({
            roleGameId: game.id,
            telegramUserId: input.primaryGmTelegramUserId,
            role: 'primary_gm',
            status: 'confirmed',
            isExternal: false,
            requestedByTelegramUserId: input.createdByTelegramUserId,
          })
          .returning();

        if (!createdMembers[0]) {
          throw new Error('Role game primary GM insert did not return a row');
        }

        return mapRoleGameRow(game);
      });
    },
    async findGameById(gameId) {
      const rows = await database.select().from(roleGames).where(eq(roleGames.id, gameId)).limit(1);
      const row = rows.find((candidate) => candidate.id === gameId) ?? null;
      return row ? mapRoleGameRow(row) : null;
    },
    async updateGame(input) {
      const updatedAt = new Date();
      const rows = await database
        .update(roleGames)
        .set({
          ...mapRoleGameUpdateInput(input),
          updatedAt,
        })
        .where(eq(roleGames.id, input.gameId))
        .returning();
      const row = rows[0];
      if (!row) {
        throw new Error(`Role game ${input.gameId} not found`);
      }
      return mapRoleGameRow(row);
    },
    async listRecurringGames() {
      const rows = await database
        .select()
        .from(roleGames)
        .where(eq(roleGames.schedulingMode, 'recurring'))
        .orderBy(asc(roleGames.id));
      return rows
        .map(mapRoleGameRow)
        .filter((game) => game.status === 'active' && game.recurrenceRule && game.recurrenceWindowCount > 0);
    },
    async listVisibleGames(input) {
      const [gameRows, memberRows] = await Promise.all([
        database.select().from(roleGames).orderBy(asc(roleGames.title), asc(roleGames.id)),
        database
          .select()
          .from(roleGameMembers)
          .where(eq(roleGameMembers.telegramUserId, input.actor.telegramUserId))
          .orderBy(asc(roleGameMembers.roleGameId), asc(roleGameMembers.id)),
      ]);
      const membershipByGameId = new Map(
        selectPreferredMemberRows(memberRows.filter((member) => member.telegramUserId === input.actor.telegramUserId)).map((member) => [
          member.roleGameId,
          mapRoleGameMemberRow(member),
        ]),
      );
      return gameRows
        .map(mapRoleGameRow)
        .filter((game) => canViewRoleGame(input.actor, game, membershipByGameId.get(game.id) ?? null));
    },
    async listGamesForUser(telegramUserId) {
      const memberRows = await database
        .select()
        .from(roleGameMembers)
        .where(eq(roleGameMembers.telegramUserId, telegramUserId))
        .orderBy(asc(roleGameMembers.roleGameId), asc(roleGameMembers.id));
      const roleGameIds = new Set(
        memberRows
          .filter((member) => member.telegramUserId === telegramUserId && isActiveMemberStatus(member.status as RoleGameMemberStatus))
          .map((member) => member.roleGameId),
      );
      if (roleGameIds.size === 0) {
        return [];
      }

      const gameRows = await database.select().from(roleGames).orderBy(asc(roleGames.title), asc(roleGames.id));
      return gameRows.filter((game) => roleGameIds.has(game.id)).map(mapRoleGameRow);
    },
    async createOrUpdateMember(input) {
      const existing = await findActiveMemberRow(database, input.roleGameId, input.telegramUserId);
      if (!existing) {
        return this.createMember(input);
      }

      const rows = await database
        .update(roleGameMembers)
        .set({
          role: input.role,
          status: input.status,
          isExternal: input.isExternal,
          playerNote: input.playerNote ?? null,
          requestedByTelegramUserId: input.requestedByTelegramUserId,
          updatedAt: new Date(),
        })
        .where(eq(roleGameMembers.id, existing.id))
        .returning();
      const row = rows[0];
      if (!row) {
        throw new Error(`Role game member ${existing.id} not found`);
      }
      return mapRoleGameMemberRow(row);
    },
    async findMember(gameId, telegramUserId) {
      const row = await findMemberRow(database, gameId, telegramUserId);
      return row ? mapRoleGameMemberRow(row) : null;
    },
    async findMemberByTelegramUserId(gameId, telegramUserId) {
      const row = await findMemberRow(database, gameId, telegramUserId);
      return row ? mapRoleGameMemberRow(row) : null;
    },
    async findMemberById(memberId) {
      const rows = await database.select().from(roleGameMembers).where(eq(roleGameMembers.id, memberId)).limit(1);
      const row = rows.find((candidate) => candidate.id === memberId) ?? null;
      return row ? mapRoleGameMemberRow(row) : null;
    },
    async listMembers(gameId) {
      const rows = await database
        .select()
        .from(roleGameMembers)
        .where(eq(roleGameMembers.roleGameId, gameId))
        .orderBy(asc(roleGameMembers.role), asc(roleGameMembers.telegramUserId), asc(roleGameMembers.id));
      return rows.filter((row) => row.roleGameId === gameId).map(mapRoleGameMemberRow);
    },
    async countConfirmedPlayers(gameId) {
      const rows = await database
        .select({ count: count() })
        .from(roleGameMembers)
        .where(
          and(
            eq(roleGameMembers.roleGameId, gameId),
            eq(roleGameMembers.role, 'player'),
            eq(roleGameMembers.status, 'confirmed'),
          ),
        );
      return Number(rows[0]?.count ?? 0);
    },
    async createMember(input) {
      const rows = await database
        .insert(roleGameMembers)
        .values({
          roleGameId: input.roleGameId,
          telegramUserId: input.telegramUserId,
          role: input.role,
          status: input.status,
          isExternal: input.isExternal,
          playerNote: input.playerNote ?? null,
          requestedByTelegramUserId: input.requestedByTelegramUserId,
        })
        .returning();
      const row = rows[0];
      if (!row) {
        throw new Error('Role game member insert did not return a row');
      }
      return mapRoleGameMemberRow(row);
    },
    async createSessionLink(input) {
      const rows = await database
        .insert(roleGameSessions)
        .values({
          roleGameId: input.roleGameId,
          scheduleEventId: input.scheduleEventId,
          source: input.source,
          generatedForStartsAt: input.generatedForStartsAt ? new Date(input.generatedForStartsAt) : null,
          createdByTelegramUserId: input.createdByTelegramUserId,
        })
        .returning();
      const row = rows[0];
      if (!row) {
        throw new Error('Role game session link insert did not return a row');
      }
      return mapRoleGameSessionRow(row);
    },
    async listSessionLinks(gameId) {
      const rows = await database
        .select()
        .from(roleGameSessions)
        .where(eq(roleGameSessions.roleGameId, gameId))
        .orderBy(asc(roleGameSessions.createdAt), asc(roleGameSessions.id));
      return rows.filter((row) => row.roleGameId === gameId).map(mapRoleGameSessionRow);
    },
    async createMaterial(input) {
      const rows = await database
        .insert(roleGameMaterials)
        .values({
          roleGameId: input.roleGameId,
          categoryId: input.categoryId ?? null,
          internalStorageEntryId: input.internalStorageEntryId,
          title: input.title,
          description: input.description,
          visibility: input.visibility,
          deliveryState: input.deliveryState,
          uploadedByTelegramUserId: input.uploadedByTelegramUserId,
        })
        .returning();
      const row = rows[0];
      if (!row) {
        throw new Error('Role game material insert did not return a row');
      }
      return mapRoleGameMaterialRow(row);
    },
    async findMaterialById(materialId) {
      const rows = await database.select().from(roleGameMaterials).where(eq(roleGameMaterials.id, materialId)).limit(1);
      const row = rows.find((candidate) => candidate.id === materialId) ?? null;
      return row ? mapRoleGameMaterialRow(row) : null;
    },
    async listMaterials(gameId) {
      const rows = await database
        .select()
        .from(roleGameMaterials)
        .where(eq(roleGameMaterials.roleGameId, gameId))
        .orderBy(asc(roleGameMaterials.createdAt), asc(roleGameMaterials.id));
      return rows.filter((row) => row.roleGameId === gameId).map(mapRoleGameMaterialRow);
    },
    async createMaterialCategory(input) {
      if (input.parentCategoryId !== null) {
        const parent = await database.select().from(roleGameMaterialCategories)
          .where(and(eq(roleGameMaterialCategories.id, input.parentCategoryId), eq(roleGameMaterialCategories.roleGameId, input.roleGameId))).limit(1);
        if (!parent[0]) throw new Error('Parent material category does not belong to the role game');
      }
      const rows = await database.insert(roleGameMaterialCategories).values(input).returning();
      if (!rows[0]) throw new Error('Role game material category insert did not return a row');
      return mapRoleGameMaterialCategoryRow(rows[0]);
    },
    async findMaterialCategoryById(categoryId) {
      const rows = await database.select().from(roleGameMaterialCategories)
        .where(eq(roleGameMaterialCategories.id, categoryId)).limit(1);
      return rows[0] ? mapRoleGameMaterialCategoryRow(rows[0]) : null;
    },
    async listMaterialCategories(gameId) {
      const rows = await database.select().from(roleGameMaterialCategories)
        .where(eq(roleGameMaterialCategories.roleGameId, gameId))
        .orderBy(asc(roleGameMaterialCategories.name), asc(roleGameMaterialCategories.id));
      return rows.map(mapRoleGameMaterialCategoryRow);
    },
    async moveMaterialToCategory(input) {
      const materialRows = await database.select().from(roleGameMaterials)
        .where(eq(roleGameMaterials.id, input.materialId)).limit(1);
      const material = materialRows[0];
      if (!material) throw new Error(`Role game material ${input.materialId} not found`);
      if (input.categoryId !== null) {
        const categoryRows = await database.select().from(roleGameMaterialCategories)
          .where(and(eq(roleGameMaterialCategories.id, input.categoryId), eq(roleGameMaterialCategories.roleGameId, material.roleGameId))).limit(1);
        if (!categoryRows[0]) throw new Error('Material category does not belong to the role game');
      }
      const rows = await database.update(roleGameMaterials).set({ categoryId: input.categoryId, updatedAt: new Date() })
        .where(eq(roleGameMaterials.id, material.id)).returning();
      if (!rows[0]) throw new Error(`Role game material ${input.materialId} not found`);
      return mapRoleGameMaterialRow(rows[0]);
    },
    async deleteMaterial(input) {
      return database.transaction(async (tx) => {
        const materialRows = await tx.select().from(roleGameMaterials)
          .where(and(eq(roleGameMaterials.id, input.materialId), eq(roleGameMaterials.roleGameId, input.roleGameId))).limit(1);
        const material = materialRows[0];
        if (!material) throw new Error(`Role game material ${input.materialId} not found`);
        await tx.delete(roleGameMaterialDeliveries).where(eq(roleGameMaterialDeliveries.roleGameMaterialId, material.id));
        const deletedRows = await tx.delete(roleGameMaterials)
          .where(and(eq(roleGameMaterials.id, material.id), eq(roleGameMaterials.roleGameId, input.roleGameId))).returning();
        if (!deletedRows[0]) throw new Error(`Role game material ${input.materialId} not found`);
        await tx.update(storageEntries).set({
          lifecycleStatus: 'deleted',
          deletedAt: new Date(),
          deletedByTelegramUserId: input.deletedByTelegramUserId,
          updatedAt: new Date(),
        }).where(eq(storageEntries.id, material.internalStorageEntryId));
        return mapRoleGameMaterialRow(deletedRows[0]);
      });
    },
    async deleteGame(input) {
      return database.transaction(async (tx) => {
        const gameRows = await tx.select().from(roleGames)
          .where(eq(roleGames.id, input.gameId)).limit(1);
        const game = gameRows[0];
        if (!game) throw new Error(`Role game ${input.gameId} not found`);

        const characterRows = await tx.select({ id: roleGameCharacters.id }).from(roleGameCharacters)
          .where(eq(roleGameCharacters.roleGameId, game.id));
        const materialRows = await tx
          .select({ id: roleGameMaterials.id, storageEntryId: roleGameMaterials.internalStorageEntryId })
          .from(roleGameMaterials)
          .where(eq(roleGameMaterials.roleGameId, game.id));
        const sessionRows = await tx.select({ scheduleEventId: roleGameSessions.scheduleEventId })
          .from(roleGameSessions)
          .where(eq(roleGameSessions.roleGameId, game.id));
        const characterIds = characterRows.map((row) => row.id);
        const materialIds = materialRows.map((row) => row.id);
        const scheduleEventIds = sessionRows.map((row) => row.scheduleEventId);
        const attachmentRows = characterIds.length > 0
          ? await tx.select({ storageEntryId: roleGameCharacterAttachments.internalStorageEntryId })
            .from(roleGameCharacterAttachments)
            .where(inArray(roleGameCharacterAttachments.characterId, characterIds))
          : [];

        if (characterIds.length > 0) {
          await tx.delete(roleGameCharacterClaimRequests)
            .where(inArray(roleGameCharacterClaimRequests.characterId, characterIds));
          await tx.delete(roleGameCharacterAttachments)
            .where(inArray(roleGameCharacterAttachments.characterId, characterIds));
        }
        if (materialIds.length > 0) {
          await tx.delete(roleGameMaterialDeliveries)
            .where(inArray(roleGameMaterialDeliveries.roleGameMaterialId, materialIds));
        }
        await tx.delete(roleGameMaterials).where(eq(roleGameMaterials.roleGameId, game.id));
        await tx.delete(roleGameCharacters).where(eq(roleGameCharacters.roleGameId, game.id));
        await tx.delete(roleGameSessions).where(eq(roleGameSessions.roleGameId, game.id));
        await tx.delete(roleGameMembers).where(eq(roleGameMembers.roleGameId, game.id));
        await tx.delete(roleGameMaterialCategories).where(eq(roleGameMaterialCategories.roleGameId, game.id));

        if (scheduleEventIds.length > 0) {
          const now = new Date();
          await tx.update(scheduleEvents).set({
            lifecycleStatus: 'cancelled',
            cancelledAt: now,
            cancelledByTelegramUserId: input.deletedByTelegramUserId,
            cancellationReason: `Partida de rol eliminada: ${game.title}`,
            updatedAt: now,
          }).where(and(
            inArray(scheduleEvents.id, scheduleEventIds),
            eq(scheduleEvents.lifecycleStatus, 'scheduled'),
          ));
        }

        const storageEntryIds = [
          ...materialRows.map((row) => row.storageEntryId),
          ...attachmentRows.map((row) => row.storageEntryId),
        ];
        if (storageEntryIds.length > 0) {
          const now = new Date();
          await tx.update(storageEntries).set({
            lifecycleStatus: 'deleted',
            deletedAt: now,
            deletedByTelegramUserId: input.deletedByTelegramUserId,
            updatedAt: now,
          }).where(inArray(storageEntries.id, storageEntryIds));
        }

        const deletedRows = await tx.delete(roleGames).where(eq(roleGames.id, game.id)).returning();
        if (!deletedRows[0]) throw new Error(`Role game ${input.gameId} not found`);
        return mapRoleGameRow(deletedRows[0]);
      });
    },
    async updateMaterialVisibility(input) {
      const now = new Date();
      const rows = await database
        .update(roleGameMaterials)
        .set({
          visibility: input.visibility,
          deliveryState: input.deliveryState,
          revealedAt: input.deliveryState === 'revealed' ? now : null,
          updatedAt: now,
        })
        .where(eq(roleGameMaterials.id, input.materialId))
        .returning();
      const row = rows[0];
      if (!row) {
        throw new Error(`Role game material ${input.materialId} not found`);
      }
      return mapRoleGameMaterialRow(row);
    },
    async createMaterialDelivery(input) {
      const rows = await database
        .insert(roleGameMaterialDeliveries)
        .values({
          roleGameMaterialId: input.roleGameMaterialId,
          recipientTelegramUserId: input.recipientTelegramUserId,
          sentByTelegramUserId: input.sentByTelegramUserId,
          deliveryMode: input.deliveryMode,
          status: input.status,
          errorCode: input.errorCode,
        })
        .returning();
      const row = rows[0];
      if (!row) {
        throw new Error('Role game material delivery insert did not return a row');
      }
      return mapRoleGameMaterialDeliveryRow(row);
    },
    async hasMaterialRecipientAccess(materialId, recipientTelegramUserId) {
      const rows = await database.select({ id: roleGameMaterialDeliveries.id })
        .from(roleGameMaterialDeliveries)
        .where(and(
          eq(roleGameMaterialDeliveries.roleGameMaterialId, materialId),
          eq(roleGameMaterialDeliveries.recipientTelegramUserId, recipientTelegramUserId),
          eq(roleGameMaterialDeliveries.status, 'sent'),
          or(
            eq(roleGameMaterialDeliveries.deliveryMode, 'send_and_reveal'),
            eq(roleGameMaterialDeliveries.deliveryMode, 'reveal_only'),
          ),
        ))
        .limit(1);
      return rows.length > 0;
    },
    async requestSeat(input) {
      return database.transaction(async (tx) => {
        const lockedGames = await tx
          .select()
          .from(roleGames)
          .where(eq(roleGames.id, input.roleGameId))
          .limit(1)
          .for('update');
        const game = lockedGames[0];
        if (!game) {
          throw new Error(`Role game ${input.roleGameId} not found`);
        }

        const existingMembers = await tx
          .select()
          .from(roleGameMembers)
          .where(and(eq(roleGameMembers.roleGameId, input.roleGameId), eq(roleGameMembers.telegramUserId, input.telegramUserId)))
          .orderBy(asc(roleGameMembers.id));
        const existing = selectPreferredMemberRow(
          existingMembers.filter((member) => member.roleGameId === input.roleGameId && member.telegramUserId === input.telegramUserId),
        );
        if (existing) {
          throw new Error(`Telegram user ${input.telegramUserId} already has a membership in role game ${input.roleGameId}`);
        }

        const status = await resolveRequestedSeatStatus({
          tx,
          game,
          roleGameId: input.roleGameId,
        });
        const rows = await tx
          .insert(roleGameMembers)
          .values({
            roleGameId: input.roleGameId,
            telegramUserId: input.telegramUserId,
            role: 'player',
            status,
            isExternal: input.isExternal,
            requestedByTelegramUserId: input.actorTelegramUserId,
          })
          .returning();
        const row = rows[0];
        if (!row) {
          throw new Error('Role game seat request insert did not return a row');
        }
        return mapRoleGameMemberRow(row);
      });
    },
    async confirmMemberSeat(input) {
      return database.transaction(async (tx) => {
        const lockedMembers = await tx
          .select()
          .from(roleGameMembers)
          .where(eq(roleGameMembers.id, input.memberId))
          .limit(1)
          .for('update');
        const member = lockedMembers[0];
        if (
          !member ||
          member.role !== 'player' ||
          !input.expectedStatuses.includes(member.status as 'requested' | 'invited' | 'waitlisted')
        ) {
          throw new Error(`Role game member ${input.memberId} has stale status`);
        }

        const lockedGames = await tx
          .select()
          .from(roleGames)
          .where(eq(roleGames.id, member.roleGameId))
          .limit(1)
          .for('update');
        const game = lockedGames[0];
        if (!game) {
          throw new Error(`Role game ${member.roleGameId} not found`);
        }

        const confirmedRows = await tx
          .select({ count: count() })
          .from(roleGameMembers)
          .where(
            and(
              eq(roleGameMembers.roleGameId, game.id),
              eq(roleGameMembers.role, 'player'),
              eq(roleGameMembers.status, 'confirmed'),
            ),
          );
        if (Number(confirmedRows[0]?.count ?? 0) >= game.capacity) {
          throw new Error(`Role game ${game.id} is full`);
        }

        const rows = await tx
          .update(roleGameMembers)
          .set({
            status: 'confirmed',
            requestedByTelegramUserId: input.actorTelegramUserId,
            updatedAt: new Date(),
          })
          .where(and(
            eq(roleGameMembers.id, member.id),
            eq(roleGameMembers.status, member.status),
            eq(roleGameMembers.role, 'player'),
          ))
          .returning();
        const updated = rows[0];
        if (!updated) {
          throw new Error(`Role game member ${member.id} has stale status`);
        }
        return mapRoleGameMemberRow(updated);
      });
    },
    async setMemberRole(input) {
      return database.transaction(async (tx) => {
        const lockedMembers = await tx
          .select()
          .from(roleGameMembers)
          .where(eq(roleGameMembers.id, input.memberId))
          .limit(1)
          .for('update');
        const member = lockedMembers[0];
        if (
          !member ||
          member.status !== input.expectedStatus ||
          member.role !== input.expectedRole ||
          member.role === 'primary_gm'
        ) {
          throw new Error(`Role game member ${input.memberId} has stale status`);
        }

        if (input.role === 'player' && member.role !== 'player') {
          const lockedGames = await tx
            .select()
            .from(roleGames)
            .where(eq(roleGames.id, member.roleGameId))
            .limit(1)
            .for('update');
          const game = lockedGames[0];
          if (!game) {
            throw new Error(`Role game ${member.roleGameId} not found`);
          }
          const confirmedRows = await tx
            .select({ count: count() })
            .from(roleGameMembers)
            .where(and(
              eq(roleGameMembers.roleGameId, game.id),
              eq(roleGameMembers.role, 'player'),
              eq(roleGameMembers.status, 'confirmed'),
            ));
          if (Number(confirmedRows[0]?.count ?? 0) >= game.capacity) {
            throw new Error(`Role game ${game.id} is full`);
          }
        }

        const rows = await tx
          .update(roleGameMembers)
          .set({
            role: input.role,
            requestedByTelegramUserId: input.actorTelegramUserId,
            updatedAt: new Date(),
          })
          .where(and(
            eq(roleGameMembers.id, input.memberId),
            eq(roleGameMembers.status, input.expectedStatus),
            eq(roleGameMembers.role, input.expectedRole),
            ne(roleGameMembers.role, 'primary_gm'),
          ))
          .returning();
        const updated = rows[0];
        if (!updated) {
          throw new Error(`Role game member ${input.memberId} has stale status`);
        }
        return mapRoleGameMemberRow(updated);
      });
    },
    async setMemberStatus(input) {
      if (input.status === 'confirmed' && input.expectedRole === 'player' && input.expectedStatus !== 'confirmed') {
        throw new Error('Confirmed player seats must use confirmMemberSeat');
      }
      return database.transaction(async (tx) => {
        const lockedMembers = await tx
          .select()
          .from(roleGameMembers)
          .where(eq(roleGameMembers.id, input.memberId))
          .limit(1)
          .for('update');
        const member = lockedMembers[0];
        if (!member || member.status !== input.expectedStatus || member.role !== input.expectedRole) {
          throw new Error(`Role game member ${input.memberId} has stale status`);
        }
        const updatedAt = new Date();
        if (member.status === 'confirmed' && (input.status === 'left' || input.status === 'removed')) {
          await tx
            .update(roleGameCharacters)
            .set({
              assignedMemberId: null,
              unassignedAt: updatedAt,
              updatedAt,
            })
            .where(eq(roleGameCharacters.assignedMemberId, member.id));
        }
        const rows = await tx
          .update(roleGameMembers)
          .set({
            status: input.status,
            requestedByTelegramUserId: input.actorTelegramUserId,
            updatedAt,
          })
          .where(and(
            eq(roleGameMembers.id, input.memberId),
            eq(roleGameMembers.status, input.expectedStatus),
            eq(roleGameMembers.role, input.expectedRole),
          ))
          .returning();
        const row = rows[0];
        if (!row) {
          throw new Error(`Role game member ${input.memberId} has stale status`);
        }
        return mapRoleGameMemberRow(row);
      });
    },
  };
}

function createDatabaseRoleGameNotionRepository({
  database,
}: {
  database: DatabaseConnection['db'];
}): RoleGameNotionRepository {
  return {
    async findSourceByRoleGameId(roleGameId) {
      const rows = await database
        .select()
        .from(roleGameNotionSources)
        .where(eq(roleGameNotionSources.roleGameId, roleGameId))
        .limit(1);
      return rows[0] ? mapRoleGameNotionSourceRow(rows[0]) : null;
    },
    async findSourceByWebhookPathSecret(webhookPathSecret) {
      const rows = await database
        .select()
        .from(roleGameNotionSources)
        .where(eq(roleGameNotionSources.webhookPathSecret, webhookPathSecret))
        .limit(1);
      return rows[0] ? mapRoleGameNotionSourceRow(rows[0]) : null;
    },
    async listSourcesByNotionPageId(notionPageId) {
      const rows = await database
        .select({ source: roleGameNotionSources })
        .from(roleGameNotionSourcePages)
        .innerJoin(roleGameNotionSources, eq(roleGameNotionSourcePages.sourceId, roleGameNotionSources.id))
        .where(and(eq(roleGameNotionSourcePages.notionPageId, notionPageId), eq(roleGameNotionSources.status, 'active')))
        .orderBy(asc(roleGameNotionSources.id));
      return rows.map((row) => mapRoleGameNotionSourceRow(row.source));
    },
    async listSourcePagesByNotionPageId(notionPageId) {
      const rows = await database
        .select({ page: roleGameNotionSourcePages })
        .from(roleGameNotionSourcePages)
        .innerJoin(roleGameNotionSources, eq(roleGameNotionSourcePages.sourceId, roleGameNotionSources.id))
        .where(and(eq(roleGameNotionSourcePages.notionPageId, notionPageId), eq(roleGameNotionSources.status, 'active')))
        .orderBy(asc(roleGameNotionSourcePages.id));
      return rows.map((row) => mapRoleGameNotionSourcePageRow(row.page));
    },
    async upsertSource(input) {
      return database.transaction(async (tx) => {
        const existingRows = await tx
          .select()
          .from(roleGameNotionSources)
          .where(eq(roleGameNotionSources.roleGameId, input.roleGameId))
          .limit(1)
          .for('update');
        const existing = existingRows[0] ?? null;
        const now = new Date();
        const values = mapRoleGameNotionSourceInput(input, now);
        const rows = existing
          ? await tx
            .update(roleGameNotionSources)
            .set(values)
            .where(eq(roleGameNotionSources.id, existing.id))
            .returning()
          : await tx.insert(roleGameNotionSources).values(values).returning();
        const row = rows[0];
        if (!row) {
          throw new Error(`Role game Notion source for game ${input.roleGameId} could not be saved`);
        }

        if (existing && existing.rootPageId !== input.rootPageId) {
          await tx.delete(roleGameNotionSourcePages).where(eq(roleGameNotionSourcePages.sourceId, row.id));
        }
        const pageRows = await tx
          .insert(roleGameNotionSourcePages)
          .values({
            sourceId: row.id,
            notionPageId: input.rootPageId,
            parentNotionPageId: null,
            pageUrl: input.rootPageUrl,
            title: input.title,
            status: 'active',
            lastNotionEditedAt: input.lastNotionEditedAt ? new Date(input.lastNotionEditedAt) : null,
            lastSeenAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [roleGameNotionSourcePages.sourceId, roleGameNotionSourcePages.notionPageId],
            set: {
              parentNotionPageId: null,
              pageUrl: input.rootPageUrl,
              title: input.title,
              status: 'active',
              lastNotionEditedAt: input.lastNotionEditedAt ? new Date(input.lastNotionEditedAt) : null,
              lastSeenAt: now,
              updatedAt: now,
            },
          })
          .returning();
        if (!pageRows[0]) {
          throw new Error(`Notion root page ${input.rootPageId} could not be registered`);
        }
        return mapRoleGameNotionSourceRow(row);
      });
    },
    async deleteSourceForRoleGame(roleGameId) {
      const rows = await database
        .delete(roleGameNotionSources)
        .where(eq(roleGameNotionSources.roleGameId, roleGameId))
        .returning({ id: roleGameNotionSources.id });
      return rows.length > 0;
    },
    async setSourceStatus(input) {
      const now = new Date();
      const rows = await database
        .update(roleGameNotionSources)
        .set({
          status: input.status,
          lastError: input.lastError === undefined ? undefined : input.lastError,
          lastSyncedAt: input.lastSyncedAt === undefined ? undefined : input.lastSyncedAt ? new Date(input.lastSyncedAt) : null,
          updatedAt: now,
        })
        .where(eq(roleGameNotionSources.id, input.sourceId))
        .returning();
      if (!rows[0]) {
        throw new Error(`Role game Notion source ${input.sourceId} not found`);
      }
      return mapRoleGameNotionSourceRow(rows[0]);
    },
    async setSourceWebhookVerificationToken(input) {
      const rows = await database
        .update(roleGameNotionSources)
        .set({ encryptedWebhookVerificationToken: input.encryptedWebhookVerificationToken, updatedAt: new Date() })
        .where(eq(roleGameNotionSources.id, input.sourceId))
        .returning();
      if (!rows[0]) throw new Error(`Role game Notion source ${input.sourceId} not found`);
      return mapRoleGameNotionSourceRow(rows[0]);
    },
    async findSourcePage(sourceId, notionPageId) {
      const rows = await database
        .select()
        .from(roleGameNotionSourcePages)
        .where(and(eq(roleGameNotionSourcePages.sourceId, sourceId), eq(roleGameNotionSourcePages.notionPageId, notionPageId)))
        .limit(1);
      return rows[0] ? mapRoleGameNotionSourcePageRow(rows[0]) : null;
    },
    async listSourcePages(sourceId) {
      const rows = await database
        .select()
        .from(roleGameNotionSourcePages)
        .where(eq(roleGameNotionSourcePages.sourceId, sourceId))
        .orderBy(asc(roleGameNotionSourcePages.createdAt), asc(roleGameNotionSourcePages.id));
      return rows.map(mapRoleGameNotionSourcePageRow);
    },
    async upsertSourcePage(input) {
      const now = new Date();
      const rows = await database
        .insert(roleGameNotionSourcePages)
        .values(mapRoleGameNotionSourcePageInput(input, now))
        .onConflictDoUpdate({
          target: [roleGameNotionSourcePages.sourceId, roleGameNotionSourcePages.notionPageId],
          set: mapRoleGameNotionSourcePageUpdate(input, now),
        })
        .returning();
      if (!rows[0]) {
        throw new Error(`Notion page ${input.notionPageId} could not be registered for source ${input.sourceId}`);
      }
      return mapRoleGameNotionSourcePageRow(rows[0]);
    },
    async createPageRevision(input) {
      const contentHash = input.contentHash;
      const values = {
        sourcePageId: input.sourcePageId,
        roleGameMaterialId: input.roleGameMaterialId,
        revisionKind: input.revisionKind,
        notionLastEditedAt: input.notionLastEditedAt ? new Date(input.notionLastEditedAt) : null,
        contentHash,
        blockIds: input.blockIds,
        renderedContent: input.renderedContent,
        capturedByTelegramUserId: input.capturedByTelegramUserId,
      };
      if (contentHash) {
        const rows = await database
          .insert(roleGameNotionPageRevisions)
          .values(values)
          .onConflictDoNothing({
            target: [roleGameNotionPageRevisions.sourcePageId, roleGameNotionPageRevisions.contentHash, roleGameNotionPageRevisions.revisionKind],
            where: sql`${roleGameNotionPageRevisions.contentHash} is not null`,
          })
          .returning();
        if (rows[0]) {
          return mapRoleGameNotionPageRevisionRow(rows[0]);
        }
        const existing = await database
          .select()
          .from(roleGameNotionPageRevisions)
          .where(and(
            eq(roleGameNotionPageRevisions.sourcePageId, input.sourcePageId),
            eq(roleGameNotionPageRevisions.contentHash, contentHash),
            eq(roleGameNotionPageRevisions.revisionKind, input.revisionKind),
          ))
          .limit(1);
        if (!existing[0]) {
          throw new Error(`Notion page revision for source page ${input.sourcePageId} could not be saved`);
        }
        return mapRoleGameNotionPageRevisionRow(existing[0]);
      }
      const rows = await database.insert(roleGameNotionPageRevisions).values(values).returning();
      if (rows[0]) {
        return mapRoleGameNotionPageRevisionRow(rows[0]);
      }
      throw new Error(`Notion page revision for source page ${input.sourcePageId} could not be saved`);
    },
    async listPageRevisions(sourcePageId) {
      const rows = await database
        .select()
        .from(roleGameNotionPageRevisions)
        .where(eq(roleGameNotionPageRevisions.sourcePageId, sourcePageId))
        .orderBy(asc(roleGameNotionPageRevisions.capturedAt), asc(roleGameNotionPageRevisions.id));
      return rows.map(mapRoleGameNotionPageRevisionRow);
    },
    async recordWebhookEvent(input) {
      const now = new Date();
      const rows = await database
        .insert(roleGameNotionWebhookEvents)
        .values({
          eventId: input.eventId,
          sourceId: input.sourceId,
          sourcePageId: input.sourcePageId,
          notionPageId: input.notionPageId,
          eventType: input.eventType,
          entityType: input.entityType,
          occurredAt: input.occurredAt ? new Date(input.occurredAt) : null,
          payload: input.payload,
          payloadFingerprint: input.payloadFingerprint,
          status: 'received',
          receivedAt: now,
        })
        .onConflictDoNothing({ target: roleGameNotionWebhookEvents.eventId })
        .returning();
      const created = rows[0] !== undefined;
      const row = rows[0] ?? (await database
        .select()
        .from(roleGameNotionWebhookEvents)
        .where(eq(roleGameNotionWebhookEvents.eventId, input.eventId))
        .limit(1))[0];
      if (!row) {
        throw new Error(`Notion webhook event ${input.eventId} could not be recorded`);
      }
      if (created && input.sourceId !== null) {
        await database
          .update(roleGameNotionSources)
          .set({
            lastWebhookEventId: input.eventId,
            lastWebhookEventAt: input.occurredAt ? new Date(input.occurredAt) : now,
            updatedAt: now,
          })
          .where(eq(roleGameNotionSources.id, input.sourceId));
      }
      return { event: mapRoleGameNotionWebhookEventRow(row), created };
    },
    async updateWebhookEvent(input) {
      const rows = await database
        .update(roleGameNotionWebhookEvents)
        .set({
          status: input.status,
          error: input.error === undefined ? undefined : input.error,
          processedAt: input.processedAt === undefined ? undefined : input.processedAt ? new Date(input.processedAt) : null,
        })
        .where(eq(roleGameNotionWebhookEvents.eventId, input.eventId))
        .returning();
      if (!rows[0]) {
        throw new Error(`Notion webhook event ${input.eventId} not found`);
      }
      return mapRoleGameNotionWebhookEventRow(rows[0]);
    },
    async createChange(input) {
      const rows = await database
        .insert(roleGameNotionChanges)
        .values({
          sourceId: input.sourceId,
          sourcePageId: input.sourcePageId,
          webhookEventId: input.webhookEventId,
          changeKind: input.changeKind,
          notionLastEditedAt: input.notionLastEditedAt ? new Date(input.notionLastEditedAt) : null,
          details: input.details,
        })
        .onConflictDoNothing({
          target: [roleGameNotionChanges.webhookEventId, roleGameNotionChanges.sourceId],
          where: sql`${roleGameNotionChanges.webhookEventId} is not null`,
        })
        .returning();
      if (rows[0]) return mapRoleGameNotionChangeRow(rows[0]);
      if (input.webhookEventId !== null) {
        const existing = await database
          .select()
          .from(roleGameNotionChanges)
          .where(and(
            eq(roleGameNotionChanges.webhookEventId, input.webhookEventId),
            eq(roleGameNotionChanges.sourceId, input.sourceId),
          ))
          .limit(1);
        if (existing[0]) return mapRoleGameNotionChangeRow(existing[0]);
      }
      throw new Error(`Notion change for source ${input.sourceId} could not be saved`);
    },
    async listChanges(input) {
      const conditions = [eq(roleGameNotionChanges.sourceId, input.sourceId)];
      if (input.statuses && input.statuses.length > 0) {
        conditions.push(inArray(roleGameNotionChanges.status, input.statuses));
      }
      const rows = await database
        .select()
        .from(roleGameNotionChanges)
        .where(and(...conditions))
        .orderBy(asc(roleGameNotionChanges.createdAt), asc(roleGameNotionChanges.id))
        .limit(input.limit ?? 50);
      return rows.map(mapRoleGameNotionChangeRow);
    },
    async updateChange(input) {
      const rows = await database
        .update(roleGameNotionChanges)
        .set({
          status: input.status,
          error: input.error === undefined ? undefined : input.error,
          reviewedByTelegramUserId: input.reviewedByTelegramUserId === undefined ? undefined : input.reviewedByTelegramUserId,
          reviewedAt: input.reviewedAt === undefined ? undefined : input.reviewedAt ? new Date(input.reviewedAt) : null,
          updatedAt: new Date(),
        })
        .where(eq(roleGameNotionChanges.id, input.changeId))
        .returning();
      if (!rows[0]) {
        throw new Error(`Notion change ${input.changeId} not found`);
      }
      return mapRoleGameNotionChangeRow(rows[0]);
    },
  };
}

async function findMemberRow(
  database: DatabaseConnection['db'],
  gameId: number,
  telegramUserId: number,
): Promise<RoleGameMemberRow | null> {
  const rows = await database
    .select()
    .from(roleGameMembers)
    .where(and(eq(roleGameMembers.roleGameId, gameId), eq(roleGameMembers.telegramUserId, telegramUserId)))
    .orderBy(asc(roleGameMembers.id));
  return selectPreferredMemberRow(rows.filter((row) => row.roleGameId === gameId && row.telegramUserId === telegramUserId));
}

async function findActiveMemberRow(
  database: DatabaseConnection['db'],
  gameId: number,
  telegramUserId: number,
): Promise<RoleGameMemberRow | null> {
  const rows = await database
    .select()
    .from(roleGameMembers)
    .where(and(eq(roleGameMembers.roleGameId, gameId), eq(roleGameMembers.telegramUserId, telegramUserId)))
    .orderBy(asc(roleGameMembers.id));
  return selectActiveMemberRow(rows.filter((row) => row.roleGameId === gameId && row.telegramUserId === telegramUserId));
}

function selectPreferredMemberRows(rows: RoleGameMemberRow[]): RoleGameMemberRow[] {
  const byGameId = new Map<number, RoleGameMemberRow[]>();
  for (const row of rows) {
    byGameId.set(row.roleGameId, [...(byGameId.get(row.roleGameId) ?? []), row]);
  }
  return Array.from(byGameId.values()).flatMap((members) => {
    const selected = selectPreferredMemberRow(members);
    return selected ? [selected] : [];
  });
}

function selectPreferredMemberRow(rows: RoleGameMemberRow[]): RoleGameMemberRow | null {
  return selectActiveMemberRow(rows) ?? selectLatestMemberRow(rows);
}

function selectActiveMemberRow(rows: RoleGameMemberRow[]): RoleGameMemberRow | null {
  return selectLatestMemberRow(rows.filter((row) => isActiveMemberStatus(row.status as RoleGameMemberStatus)));
}

function selectLatestMemberRow(rows: RoleGameMemberRow[]): RoleGameMemberRow | null {
  return rows.reduce<RoleGameMemberRow | null>((selected, row) => (!selected || row.id > selected.id ? row : selected), null);
}

async function resolveRequestedSeatStatus({
  tx,
  game,
  roleGameId,
}: {
  tx: Pick<DatabaseConnection['db'], 'select'>;
  game: RoleGameRow;
  roleGameId: number;
}): Promise<RoleGameMemberStatus> {
  if (game.acceptanceMode !== 'auto_until_full') {
    return 'requested';
  }

  const rows = await tx
    .select({ count: count() })
    .from(roleGameMembers)
    .where(and(eq(roleGameMembers.roleGameId, roleGameId), eq(roleGameMembers.role, 'player'), eq(roleGameMembers.status, 'confirmed')));
  const confirmedPlayers = Number(rows[0]?.count ?? 0);
  return confirmedPlayers < game.capacity ? 'confirmed' : 'waitlisted';
}

function mapRoleGameUpdateInput(input: UpdateRoleGameInput): Partial<RoleGameRow> {
  const values: Partial<RoleGameRow> = {};
  if (input.status !== undefined) values.status = input.status;
  if (input.title !== undefined) values.title = input.title;
  if (input.system !== undefined) values.system = input.system;
  if (input.description !== undefined) values.description = input.description;
  if (input.visibility !== undefined) values.visibility = input.visibility;
  if (input.publicJoinPolicy !== undefined) values.publicJoinPolicy = input.publicJoinPolicy;
  if (input.entryMode !== undefined) values.entryMode = input.entryMode;
  if (input.acceptanceMode !== undefined) values.acceptanceMode = input.acceptanceMode;
  if (input.capacity !== undefined) values.capacity = input.capacity;
  if (input.primaryGmTelegramUserId !== undefined) values.primaryGmTelegramUserId = input.primaryGmTelegramUserId;
  if (input.defaultDurationMinutes !== undefined) values.defaultDurationMinutes = input.defaultDurationMinutes;
  if (input.defaultTableId !== undefined) values.defaultTableId = input.defaultTableId;
  if (input.defaultAttendanceMode !== undefined) values.defaultAttendanceMode = input.defaultAttendanceMode;
  if (input.defaultIsPublicScheduleEvent !== undefined) values.defaultIsPublicScheduleEvent = input.defaultIsPublicScheduleEvent;
  if (input.autoAddConfirmedPlayers !== undefined) values.autoAddConfirmedPlayers = input.autoAddConfirmedPlayers;
  if (input.allowPlayerManualScheduling !== undefined) values.allowPlayerManualScheduling = input.allowPlayerManualScheduling;
  if (input.schedulingMode !== undefined) values.schedulingMode = input.schedulingMode;
  if (input.recurrenceRule !== undefined) values.recurrenceRule = input.recurrenceRule;
  if (input.recurrenceWindowCount !== undefined) values.recurrenceWindowCount = input.recurrenceWindowCount;
  if (input.closedAt !== undefined) values.closedAt = input.closedAt ? new Date(input.closedAt) : null;
  return values;
}

function mapRoleGameNotionSourceInput(input: UpsertRoleGameNotionSourceInput, updatedAt: Date) {
  return {
    roleGameId: input.roleGameId,
    rootPageId: input.rootPageId,
    rootPageUrl: input.rootPageUrl,
    title: input.title,
    status: input.status,
    linkedByTelegramUserId: input.linkedByTelegramUserId,
    tokenOwnerTelegramUserId: input.tokenOwnerTelegramUserId === undefined ? null : input.tokenOwnerTelegramUserId,
    encryptedApiToken: input.encryptedApiToken === undefined ? null : input.encryptedApiToken,
    webhookPathSecret: input.webhookPathSecret === undefined ? null : input.webhookPathSecret,
    encryptedWebhookVerificationToken: input.encryptedWebhookVerificationToken === undefined ? null : input.encryptedWebhookVerificationToken,
    lastNotionEditedAt: input.lastNotionEditedAt ? new Date(input.lastNotionEditedAt) : null,
    lastSyncedAt: input.lastSyncedAt ? new Date(input.lastSyncedAt) : null,
    lastError: input.lastError ?? null,
    updatedAt,
  };
}

function mapRoleGameNotionSourcePageInput(input: UpsertRoleGameNotionSourcePageInput, updatedAt: Date) {
  return {
    sourceId: input.sourceId,
    notionPageId: input.notionPageId,
    parentNotionPageId: input.parentNotionPageId,
    pageUrl: input.pageUrl,
    title: input.title,
    status: input.status,
    lastNotionEditedAt: input.lastNotionEditedAt ? new Date(input.lastNotionEditedAt) : null,
    latestContentFingerprint: input.latestContentFingerprint ?? null,
    latestRoleGameMaterialId: input.latestRoleGameMaterialId ?? null,
    lastSeenAt: input.lastSeenAt ? new Date(input.lastSeenAt) : updatedAt,
    firstImportedAt: input.firstImportedAt ? new Date(input.firstImportedAt) : null,
    lastImportedAt: input.lastImportedAt ? new Date(input.lastImportedAt) : null,
    updatedAt,
  };
}

function mapRoleGameNotionSourcePageUpdate(input: UpsertRoleGameNotionSourcePageInput, updatedAt: Date) {
  return {
    parentNotionPageId: input.parentNotionPageId,
    pageUrl: input.pageUrl,
    title: input.title,
    status: input.status,
    lastNotionEditedAt: input.lastNotionEditedAt ? new Date(input.lastNotionEditedAt) : null,
    latestContentFingerprint: input.latestContentFingerprint ?? null,
    latestRoleGameMaterialId: input.latestRoleGameMaterialId ?? null,
    lastSeenAt: input.lastSeenAt ? new Date(input.lastSeenAt) : updatedAt,
    firstImportedAt: input.firstImportedAt ? new Date(input.firstImportedAt) : null,
    lastImportedAt: input.lastImportedAt ? new Date(input.lastImportedAt) : null,
    updatedAt,
  };
}

function mapRoleGameRow(row: RoleGameRow): RoleGameRecord {
  return {
    id: row.id,
    type: row.type as RoleGameRecord['type'],
    status: row.status as RoleGameRecord['status'],
    title: row.title,
    system: row.system,
    description: row.description,
    visibility: row.visibility as RoleGameRecord['visibility'],
    publicJoinPolicy: row.publicJoinPolicy as RoleGameRecord['publicJoinPolicy'],
    entryMode: row.entryMode as RoleGameRecord['entryMode'],
    acceptanceMode: row.acceptanceMode as RoleGameRecord['acceptanceMode'],
    capacity: row.capacity,
    primaryGmTelegramUserId: row.primaryGmTelegramUserId,
    defaultDurationMinutes: row.defaultDurationMinutes,
    defaultTableId: row.defaultTableId,
    defaultAttendanceMode: row.defaultAttendanceMode as RoleGameRecord['defaultAttendanceMode'],
    defaultIsPublicScheduleEvent: row.defaultIsPublicScheduleEvent,
    autoAddConfirmedPlayers: row.autoAddConfirmedPlayers,
    allowPlayerManualScheduling: row.allowPlayerManualScheduling,
    schedulingMode: row.schedulingMode as RoleGameRecord['schedulingMode'],
    recurrenceRule: row.recurrenceRule as RoleGameRecurrenceRule | null,
    recurrenceWindowCount: row.recurrenceWindowCount,
    createdByTelegramUserId: row.createdByTelegramUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
  };
}

function mapRoleGameSessionRow(row: RoleGameSessionRow): RoleGameSessionRecord {
  return {
    id: row.id,
    roleGameId: row.roleGameId,
    scheduleEventId: row.scheduleEventId,
    source: row.source as RoleGameSessionRecord['source'],
    generatedForStartsAt: row.generatedForStartsAt?.toISOString() ?? null,
    createdByTelegramUserId: row.createdByTelegramUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapRoleGameMaterialRow(row: RoleGameMaterialRow): RoleGameMaterialRecord {
  return {
    id: row.id,
    roleGameId: row.roleGameId,
    categoryId: row.categoryId,
    internalStorageEntryId: row.internalStorageEntryId,
    title: row.title,
    description: row.description,
    visibility: row.visibility as RoleGameMaterialRecord['visibility'],
    deliveryState: row.deliveryState as RoleGameMaterialRecord['deliveryState'],
    uploadedByTelegramUserId: row.uploadedByTelegramUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    revealedAt: row.revealedAt?.toISOString() ?? null,
  };
}

function mapRoleGameMaterialCategoryRow(row: RoleGameMaterialCategoryRow): RoleGameMaterialCategoryRecord {
  return {
    id: row.id,
    roleGameId: row.roleGameId,
    parentCategoryId: row.parentCategoryId,
    name: row.name,
    createdByTelegramUserId: row.createdByTelegramUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapRoleGameMaterialDeliveryRow(row: RoleGameMaterialDeliveryRow): RoleGameMaterialDeliveryRecord {
  return {
    id: row.id,
    roleGameMaterialId: row.roleGameMaterialId,
    recipientTelegramUserId: row.recipientTelegramUserId,
    sentByTelegramUserId: row.sentByTelegramUserId,
    deliveryMode: row.deliveryMode as RoleGameMaterialDeliveryRecord['deliveryMode'],
    status: row.status as RoleGameMaterialDeliveryRecord['status'],
    errorCode: row.errorCode,
    sentAt: row.sentAt.toISOString(),
  };
}

function mapRoleGameNotionSourceRow(row: RoleGameNotionSourceRow): RoleGameNotionSourceRecord {
  return {
    id: row.id,
    roleGameId: row.roleGameId,
    rootPageId: row.rootPageId,
    rootPageUrl: row.rootPageUrl,
    title: row.title,
    status: row.status as RoleGameNotionSourceRecord['status'],
    linkedByTelegramUserId: row.linkedByTelegramUserId,
    tokenOwnerTelegramUserId: row.tokenOwnerTelegramUserId,
    encryptedApiToken: row.encryptedApiToken,
    webhookPathSecret: row.webhookPathSecret,
    encryptedWebhookVerificationToken: row.encryptedWebhookVerificationToken,
    lastNotionEditedAt: row.lastNotionEditedAt?.toISOString() ?? null,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastWebhookEventId: row.lastWebhookEventId,
    lastWebhookEventAt: row.lastWebhookEventAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapRoleGameNotionSourcePageRow(row: RoleGameNotionSourcePageRow): RoleGameNotionSourcePageRecord {
  return {
    id: row.id,
    sourceId: row.sourceId,
    notionPageId: row.notionPageId,
    parentNotionPageId: row.parentNotionPageId,
    pageUrl: row.pageUrl,
    title: row.title,
    status: row.status as RoleGameNotionSourcePageRecord['status'],
    lastNotionEditedAt: row.lastNotionEditedAt?.toISOString() ?? null,
    latestContentFingerprint: row.latestContentFingerprint,
    latestRoleGameMaterialId: row.latestRoleGameMaterialId,
    lastSeenAt: row.lastSeenAt.toISOString(),
    firstImportedAt: row.firstImportedAt?.toISOString() ?? null,
    lastImportedAt: row.lastImportedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapRoleGameNotionPageRevisionRow(row: RoleGameNotionPageRevisionRow): RoleGameNotionPageRevisionRecord {
  return {
    id: row.id,
    sourcePageId: row.sourcePageId,
    roleGameMaterialId: row.roleGameMaterialId,
    revisionKind: row.revisionKind as RoleGameNotionPageRevisionRecord['revisionKind'],
    notionLastEditedAt: row.notionLastEditedAt?.toISOString() ?? null,
    contentHash: row.contentHash,
    blockIds: Array.isArray(row.blockIds) && row.blockIds.every((value): value is string => typeof value === 'string')
      ? row.blockIds
      : null,
    renderedContent: row.renderedContent,
    capturedByTelegramUserId: row.capturedByTelegramUserId,
    capturedAt: row.capturedAt.toISOString(),
  };
}

function mapRoleGameNotionWebhookEventRow(row: RoleGameNotionWebhookEventRow): RoleGameNotionWebhookEventRecord {
  return {
    id: row.id,
    eventId: row.eventId,
    sourceId: row.sourceId,
    sourcePageId: row.sourcePageId,
    notionPageId: row.notionPageId,
    eventType: row.eventType,
    entityType: row.entityType,
    occurredAt: row.occurredAt?.toISOString() ?? null,
    receivedAt: row.receivedAt.toISOString(),
    payload: row.payload,
    payloadFingerprint: row.payloadFingerprint,
    status: row.status as RoleGameNotionWebhookEventRecord['status'],
    error: row.error,
    processedAt: row.processedAt?.toISOString() ?? null,
  };
}

function mapRoleGameNotionChangeRow(row: RoleGameNotionChangeRow): RoleGameNotionChangeRecord {
  return {
    id: row.id,
    sourceId: row.sourceId,
    sourcePageId: row.sourcePageId,
    webhookEventId: row.webhookEventId,
    changeKind: row.changeKind,
    status: row.status as RoleGameNotionChangeRecord['status'],
    notionLastEditedAt: row.notionLastEditedAt?.toISOString() ?? null,
    details: row.details,
    error: row.error,
    reviewedByTelegramUserId: row.reviewedByTelegramUserId,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapRoleGameMemberRow(row: RoleGameMemberRow): RoleGameMemberRecord {
  return {
    id: row.id,
    roleGameId: row.roleGameId,
    telegramUserId: row.telegramUserId,
    role: row.role as RoleGameMemberRecord['role'],
    status: row.status as RoleGameMemberRecord['status'],
    isExternal: row.isExternal,
    playerNote: row.playerNote,
    requestedByTelegramUserId: row.requestedByTelegramUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isActiveMemberStatus(status: RoleGameMemberStatus): boolean {
  return activeMemberStatuses.includes(status as (typeof activeMemberStatuses)[number]);
}
