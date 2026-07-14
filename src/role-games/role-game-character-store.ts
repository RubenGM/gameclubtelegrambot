import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import {
  roleGameCharacterAttachments,
  roleGameCharacterClaimRequests,
  roleGameCharacters,
  roleGameMembers,
} from '../infrastructure/database/schema.js';
import type {
  CharacterAssignmentInput,
  CharacterTransferInput,
  RoleGameCharacterAttachmentRecord,
  RoleGameCharacterClaimRequestRecord,
  RoleGameCharacterRecord,
  RoleGameCharacterRepository,
} from './role-game-character-catalog.js';

type CharacterRow = typeof roleGameCharacters.$inferSelect;
type AttachmentRow = typeof roleGameCharacterAttachments.$inferSelect;
type ClaimRow = typeof roleGameCharacterClaimRequests.$inferSelect;
type Transaction = Parameters<Parameters<DatabaseConnection['db']['transaction']>[0]>[0];

export function createDatabaseRoleGameCharacterRepository({
  database,
}: {
  database: DatabaseConnection['db'];
}): RoleGameCharacterRepository {
  return {
    async createCharacter(input) {
      const rows = await database.insert(roleGameCharacters).values({
        roleGameId: input.roleGameId,
        assignedMemberId: input.assignedMemberId,
        name: input.name,
        description: input.description,
        externalUrl: input.externalUrl,
        visibility: input.visibility,
        createdByTelegramUserId: input.createdByTelegramUserId,
        assignedAt: input.assignedMemberId === null ? null : new Date(),
      }).returning();
      return mapRequiredCharacter(rows[0], 'Character insert did not return a row');
    },

    async findCharacterById(characterId) {
      const rows = await database.select().from(roleGameCharacters)
        .where(eq(roleGameCharacters.id, characterId)).limit(1);
      return rows[0] ? mapCharacterRow(rows[0]) : null;
    },

    async listCharacters(roleGameId) {
      const rows = await database.select().from(roleGameCharacters)
        .where(eq(roleGameCharacters.roleGameId, roleGameId))
        .orderBy(asc(roleGameCharacters.name), asc(roleGameCharacters.id));
      return rows.map(mapCharacterRow);
    },

    async updateCharacter(input) {
      return database.transaction(async (tx) => {
        const locked = await tx.select().from(roleGameCharacters)
          .where(eq(roleGameCharacters.id, input.characterId)).limit(1).for('update');
        const character = locked[0];
        if (!character || character.updatedAt.toISOString() !== input.expectedUpdatedAt) {
          throw new Error(`Role game character ${input.characterId} has stale state`);
        }
        const updatedAt = new Date();
        const rows = await tx.update(roleGameCharacters).set({
          name: input.name,
          description: input.description,
          externalUrl: input.externalUrl,
          visibility: input.visibility,
          updatedAt,
        }).where(and(
          eq(roleGameCharacters.id, character.id),
          eq(roleGameCharacters.updatedAt, character.updatedAt),
        )).returning();
        const updated = mapRequiredCharacter(
          rows[0],
          `Role game character ${input.characterId} has stale state`,
        );
        if (updated.visibility === 'private' && updated.assignedMemberId === null) {
          await cancelPendingClaims(tx, updated.id, input.actorTelegramUserId, updatedAt);
        }
        return updated;
      });
    },

    async assignCharacter(input) {
      return database.transaction((tx) => assignCharacterWithinTransaction(tx, input));
    },

    async transferCharacter(input) {
      return database.transaction((tx) => assignCharacterWithinTransaction(tx, input));
    },

    async unassignCharacter(input) {
      return database.transaction(async (tx) => {
        const locked = await tx.select().from(roleGameCharacters)
          .where(eq(roleGameCharacters.id, input.characterId)).limit(1).for('update');
        const character = locked[0];
        if (!character || character.assignedMemberId !== input.expectedAssignedMemberId) {
          throw new Error(`Role game character ${input.characterId} has stale ownership`);
        }
        const updatedAt = new Date();
        const rows = await tx.update(roleGameCharacters).set({
          assignedMemberId: null,
          unassignedAt: updatedAt,
          updatedAt,
        }).where(and(
          eq(roleGameCharacters.id, character.id),
          eq(roleGameCharacters.assignedMemberId, input.expectedAssignedMemberId),
        )).returning();
        return mapRequiredCharacter(
          rows[0],
          `Role game character ${input.characterId} has stale ownership`,
        );
      });
    },

    async createAttachment(input) {
      const rows = await database.insert(roleGameCharacterAttachments).values(input).returning();
      return mapRequiredAttachment(rows[0], 'Character attachment insert did not return a row');
    },

    async findAttachmentById(attachmentId) {
      const rows = await database.select().from(roleGameCharacterAttachments)
        .where(eq(roleGameCharacterAttachments.id, attachmentId)).limit(1);
      return rows[0] ? mapAttachmentRow(rows[0]) : null;
    },

    async listAttachments(characterId) {
      const rows = await database.select().from(roleGameCharacterAttachments)
        .where(and(
          eq(roleGameCharacterAttachments.characterId, characterId),
          isNull(roleGameCharacterAttachments.removedAt),
        ))
        .orderBy(desc(roleGameCharacterAttachments.createdAt), desc(roleGameCharacterAttachments.id));
      return rows.map(mapAttachmentRow);
    },

    async updateAttachmentVisibility(input) {
      const rows = await database.update(roleGameCharacterAttachments).set({
        visibility: input.visibility,
        updatedAt: new Date(),
      }).where(and(
        eq(roleGameCharacterAttachments.id, input.attachmentId),
        eq(roleGameCharacterAttachments.visibility, input.expectedVisibility),
        isNull(roleGameCharacterAttachments.removedAt),
      )).returning();
      return mapRequiredAttachment(
        rows[0],
        `Role game character attachment ${input.attachmentId} has stale state`,
      );
    },

    async replaceAttachmentStorageEntry(input) {
      const rows = await database.update(roleGameCharacterAttachments).set({
        internalStorageEntryId: input.internalStorageEntryId,
        updatedAt: new Date(),
      }).where(and(
        eq(roleGameCharacterAttachments.id, input.attachmentId),
        eq(roleGameCharacterAttachments.internalStorageEntryId, input.expectedInternalStorageEntryId),
        isNull(roleGameCharacterAttachments.removedAt),
      )).returning();
      return mapRequiredAttachment(
        rows[0],
        `Role game character attachment ${input.attachmentId} has stale state`,
      );
    },

    async removeAttachment(input) {
      const removedAt = new Date();
      const rows = await database.update(roleGameCharacterAttachments).set({
        removedAt,
        removedByTelegramUserId: input.actorTelegramUserId,
        updatedAt: removedAt,
      }).where(and(
        eq(roleGameCharacterAttachments.id, input.attachmentId),
        isNull(roleGameCharacterAttachments.removedAt),
      )).returning();
      return mapRequiredAttachment(
        rows[0],
        `Role game character attachment ${input.attachmentId} has stale state`,
      );
    },

    async createClaimRequest(input) {
      return database.transaction(async (tx) => {
        const characters = await tx.select().from(roleGameCharacters)
          .where(eq(roleGameCharacters.id, input.characterId)).limit(1).for('update');
        const character = characters[0];
        if (!character || character.assignedMemberId !== null || character.visibility !== 'players') {
          throw new Error(`Role game character ${input.characterId} cannot be requested`);
        }
        const members = await tx.select().from(roleGameMembers)
          .where(eq(roleGameMembers.id, input.requestedByMemberId)).limit(1).for('update');
        const member = members[0];
        if (!member || member.roleGameId !== character.roleGameId || member.status !== 'confirmed') {
          throw new Error(`Role game member ${input.requestedByMemberId} cannot request this character`);
        }
        const rows = await tx.insert(roleGameCharacterClaimRequests).values({
          characterId: character.id,
          requestedByMemberId: member.id,
          status: 'requested',
        }).returning();
        return mapRequiredClaim(rows[0], 'Character claim insert did not return a row');
      });
    },

    async findClaimRequestById(requestId) {
      const rows = await database.select().from(roleGameCharacterClaimRequests)
        .where(eq(roleGameCharacterClaimRequests.id, requestId)).limit(1);
      return rows[0] ? mapClaimRow(rows[0]) : null;
    },

    async listClaimRequests(input) {
      const conditions = [eq(roleGameCharacters.roleGameId, input.roleGameId)];
      if (input.characterId !== undefined) {
        conditions.push(eq(roleGameCharacterClaimRequests.characterId, input.characterId));
      }
      if (input.requestedByMemberId !== undefined) {
        conditions.push(eq(roleGameCharacterClaimRequests.requestedByMemberId, input.requestedByMemberId));
      }
      if (input.status !== undefined) {
        conditions.push(eq(roleGameCharacterClaimRequests.status, input.status));
      }
      const rows = await database.select({ claim: roleGameCharacterClaimRequests })
        .from(roleGameCharacterClaimRequests)
        .innerJoin(roleGameCharacters, eq(
          roleGameCharacters.id,
          roleGameCharacterClaimRequests.characterId,
        ))
        .where(and(...conditions))
        .orderBy(asc(roleGameCharacterClaimRequests.createdAt), asc(roleGameCharacterClaimRequests.id));
      return rows.map((row) => mapClaimRow(row.claim));
    },

    async resolveClaimRequest(input) {
      return database.transaction(async (tx) => {
        const requestLookup = await tx.select().from(roleGameCharacterClaimRequests)
          .where(eq(roleGameCharacterClaimRequests.id, input.requestId)).limit(1);
        const candidate = requestLookup[0];
        if (!candidate) {
          throw new Error(`Role game character claim ${input.requestId} has stale state`);
        }
        const characters = await tx.select().from(roleGameCharacters)
          .where(eq(roleGameCharacters.id, candidate.characterId)).limit(1).for('update');
        const character = characters[0];
        if (!character) {
          throw new Error(`Role game character ${candidate.characterId} not found`);
        }
        const requests = await tx.select().from(roleGameCharacterClaimRequests)
          .where(eq(roleGameCharacterClaimRequests.id, input.requestId)).limit(1).for('update');
        const request = requests[0];
        if (!request || request.status !== input.expectedStatus) {
          throw new Error(`Role game character claim ${input.requestId} has stale state`);
        }
        const now = new Date();
        if (input.status === 'rejected') {
          const rows = await tx.update(roleGameCharacterClaimRequests).set({
            status: 'rejected',
            resolvedByTelegramUserId: input.actorTelegramUserId,
            resolvedAt: now,
            updatedAt: now,
          }).where(and(
            eq(roleGameCharacterClaimRequests.id, request.id),
            eq(roleGameCharacterClaimRequests.status, 'requested'),
          )).returning();
          return {
            request: mapRequiredClaim(rows[0], `Role game character claim ${request.id} has stale state`),
            character: mapCharacterRow(character),
          };
        }
        const assigned = await assignCharacterWithinTransaction(tx, {
          characterId: character.id,
          assignedMemberId: request.requestedByMemberId,
          expectedAssignedMemberId: null,
          actorTelegramUserId: input.actorTelegramUserId,
        });
        const rows = await tx.update(roleGameCharacterClaimRequests).set({
          status: 'approved',
          resolvedByTelegramUserId: input.actorTelegramUserId,
          resolvedAt: now,
          updatedAt: now,
        }).where(and(
          eq(roleGameCharacterClaimRequests.id, request.id),
          inArray(roleGameCharacterClaimRequests.status, ['requested', 'cancelled']),
        )).returning();
        return {
          request: mapRequiredClaim(rows[0], `Role game character claim ${request.id} has stale state`),
          character: assigned,
        };
      });
    },

    async cancelClaimRequest(input) {
      const now = new Date();
      const rows = await database.update(roleGameCharacterClaimRequests).set({
        status: 'cancelled',
        resolvedAt: now,
        updatedAt: now,
      }).where(and(
        eq(roleGameCharacterClaimRequests.id, input.requestId),
        eq(roleGameCharacterClaimRequests.requestedByMemberId, input.requestedByMemberId),
        eq(roleGameCharacterClaimRequests.status, input.expectedStatus),
      )).returning();
      return mapRequiredClaim(
        rows[0],
        `Role game character claim ${input.requestId} has stale state`,
      );
    },
  };
}

async function assignCharacterWithinTransaction(
  tx: Transaction,
  input: CharacterAssignmentInput | CharacterTransferInput,
): Promise<RoleGameCharacterRecord> {
  const characters = await tx.select().from(roleGameCharacters)
    .where(eq(roleGameCharacters.id, input.characterId)).limit(1).for('update');
  const character = characters[0];
  if (!character || character.assignedMemberId !== input.expectedAssignedMemberId) {
    throw new Error(`Role game character ${input.characterId} has stale ownership`);
  }
  const members = await tx.select().from(roleGameMembers)
    .where(eq(roleGameMembers.id, input.assignedMemberId)).limit(1).for('update');
  const member = members[0];
  if (!member || member.roleGameId !== character.roleGameId || member.status !== 'confirmed') {
    throw new Error(`Role game member ${input.assignedMemberId} cannot own this character`);
  }
  const updatedAt = new Date();
  const ownershipCondition = input.expectedAssignedMemberId === null
    ? isNull(roleGameCharacters.assignedMemberId)
    : eq(roleGameCharacters.assignedMemberId, input.expectedAssignedMemberId);
  const rows = await tx.update(roleGameCharacters).set({
    assignedMemberId: member.id,
    assignedAt: updatedAt,
    unassignedAt: null,
    updatedAt,
  }).where(and(
    eq(roleGameCharacters.id, character.id),
    ownershipCondition,
  )).returning();
  const updated = mapRequiredCharacter(
    rows[0],
    `Role game character ${input.characterId} has stale ownership`,
  );
  await cancelPendingClaims(tx, character.id, input.actorTelegramUserId, updatedAt);
  return updated;
}

async function cancelPendingClaims(
  tx: Transaction,
  characterId: number,
  actorTelegramUserId: number,
  resolvedAt: Date,
): Promise<void> {
  await tx.update(roleGameCharacterClaimRequests).set({
    status: 'cancelled',
    resolvedByTelegramUserId: actorTelegramUserId,
    resolvedAt,
    updatedAt: resolvedAt,
  }).where(and(
    eq(roleGameCharacterClaimRequests.characterId, characterId),
    eq(roleGameCharacterClaimRequests.status, 'requested'),
  ));
}

function mapCharacterRow(row: CharacterRow): RoleGameCharacterRecord {
  return {
    id: row.id,
    roleGameId: row.roleGameId,
    assignedMemberId: row.assignedMemberId,
    name: row.name,
    description: row.description,
    externalUrl: row.externalUrl,
    visibility: row.visibility as RoleGameCharacterRecord['visibility'],
    createdByTelegramUserId: row.createdByTelegramUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    assignedAt: row.assignedAt?.toISOString() ?? null,
    unassignedAt: row.unassignedAt?.toISOString() ?? null,
  };
}

function mapAttachmentRow(row: AttachmentRow): RoleGameCharacterAttachmentRecord {
  return {
    id: row.id,
    characterId: row.characterId,
    internalStorageEntryId: row.internalStorageEntryId,
    visibility: row.visibility as RoleGameCharacterAttachmentRecord['visibility'],
    uploadedByTelegramUserId: row.uploadedByTelegramUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    removedAt: row.removedAt?.toISOString() ?? null,
    removedByTelegramUserId: row.removedByTelegramUserId,
  };
}

function mapClaimRow(row: ClaimRow): RoleGameCharacterClaimRequestRecord {
  return {
    id: row.id,
    characterId: row.characterId,
    requestedByMemberId: row.requestedByMemberId,
    status: row.status as RoleGameCharacterClaimRequestRecord['status'],
    resolvedByTelegramUserId: row.resolvedByTelegramUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

function mapRequiredCharacter(row: CharacterRow | undefined, message: string): RoleGameCharacterRecord {
  if (!row) throw new Error(message);
  return mapCharacterRow(row);
}

function mapRequiredAttachment(
  row: AttachmentRow | undefined,
  message: string,
): RoleGameCharacterAttachmentRecord {
  if (!row) throw new Error(message);
  return mapAttachmentRow(row);
}

function mapRequiredClaim(row: ClaimRow | undefined, message: string): RoleGameCharacterClaimRequestRecord {
  if (!row) throw new Error(message);
  return mapClaimRow(row);
}
