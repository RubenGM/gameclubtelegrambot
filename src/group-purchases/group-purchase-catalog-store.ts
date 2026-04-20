import { and, asc, eq } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import {
  groupPurchaseFields,
  groupPurchaseMessages,
  groupPurchaseParticipantFieldValues,
  groupPurchaseParticipants,
  groupPurchases,
} from '../infrastructure/database/schema.js';
import type {
  GroupPurchaseDetailRecord,
  GroupPurchaseFieldRecord,
  GroupPurchaseMessageRecord,
  GroupPurchaseParticipantFieldValueRecord,
  GroupPurchaseParticipantRecord,
  GroupPurchaseRecord,
  GroupPurchaseRepository,
} from './group-purchase-catalog.js';

export function createDatabaseGroupPurchaseRepository({
  database,
}: {
  database: DatabaseConnection['db'];
}): GroupPurchaseRepository {
  return {
    async createPurchase(input) {
      return database.transaction(async (tx) => {
        const createdPurchases = await tx
          .insert(groupPurchases)
          .values({
            title: input.title,
            description: input.description,
            purchaseMode: input.purchaseMode,
            createdByTelegramUserId: input.createdByTelegramUserId,
            joinDeadlineAt: asDate(input.joinDeadlineAt),
            confirmDeadlineAt: asDate(input.confirmDeadlineAt),
            totalPriceCents: input.totalPriceCents,
            unitPriceCents: input.unitPriceCents,
            unitLabel: input.unitLabel,
            allocationFieldKey: input.allocationFieldKey,
          })
          .returning();

        const createdPurchase = createdPurchases[0];
        if (!createdPurchase) {
          throw new Error('Group purchase insert did not return a row');
        }

        const createdFields = input.fields.length === 0
          ? []
          : await tx
              .insert(groupPurchaseFields)
              .values(
                input.fields.map((field) => ({
                  purchaseId: createdPurchase.id,
                  fieldKey: field.fieldKey,
                  label: field.label,
                  fieldType: field.fieldType,
                  isRequired: field.isRequired,
                  sortOrder: field.sortOrder,
                  config: field.config,
                  affectsQuantity: field.affectsQuantity,
                })),
              )
              .returning();

        return {
          purchase: mapGroupPurchaseRow(createdPurchase),
          fields: createdFields.map(mapGroupPurchaseFieldRow),
          participants: [],
        };
      });
    },
    async updatePurchase(input) {
      const updated = await database
        .update(groupPurchases)
        .set({
          title: input.title,
          description: input.description,
          joinDeadlineAt: asDate(input.joinDeadlineAt),
          confirmDeadlineAt: asDate(input.confirmDeadlineAt),
          totalPriceCents: input.totalPriceCents,
          unitPriceCents: input.unitPriceCents,
          unitLabel: input.unitLabel,
          allocationFieldKey: input.allocationFieldKey,
          updatedAt: new Date(),
        })
        .where(eq(groupPurchases.id, input.purchaseId))
        .returning();

      const row = updated[0];
      if (!row) {
        throw new Error(`Group purchase ${input.purchaseId} not found`);
      }

      return mapGroupPurchaseRow(row);
    },
    async updatePurchaseLifecycleStatus(input) {
      const now = new Date();
      const updated = await database
        .update(groupPurchases)
        .set({
          lifecycleStatus: input.lifecycleStatus,
          updatedAt: now,
          ...(input.lifecycleStatus === 'cancelled' ? { cancelledAt: now } : {}),
        })
        .where(eq(groupPurchases.id, input.purchaseId))
        .returning();

      const row = updated[0];
      if (!row) {
        throw new Error(`Group purchase ${input.purchaseId} not found`);
      }

      return mapGroupPurchaseRow(row);
    },
    async findPurchaseById(purchaseId) {
      const result = await database.select().from(groupPurchases).where(eq(groupPurchases.id, purchaseId));
      const row = result[0];
      return row ? mapGroupPurchaseRow(row) : null;
    },
    async listPurchases() {
      const result = await database.select().from(groupPurchases).orderBy(asc(groupPurchases.createdAt), asc(groupPurchases.id));
      return result.map(mapGroupPurchaseRow);
    },
    async getPurchaseDetail(purchaseId) {
      const purchase = await this.findPurchaseById(purchaseId);
      if (!purchase) {
        return null;
      }

      const [fieldRows, participantRows] = await Promise.all([
        database
          .select()
          .from(groupPurchaseFields)
          .where(eq(groupPurchaseFields.purchaseId, purchaseId))
          .orderBy(asc(groupPurchaseFields.sortOrder), asc(groupPurchaseFields.id)),
        database
          .select()
          .from(groupPurchaseParticipants)
          .where(eq(groupPurchaseParticipants.purchaseId, purchaseId))
          .orderBy(asc(groupPurchaseParticipants.joinedAt), asc(groupPurchaseParticipants.participantTelegramUserId)),
      ]);

      return {
        purchase,
        fields: fieldRows.map(mapGroupPurchaseFieldRow),
        participants: participantRows.map(mapGroupPurchaseParticipantRow),
      } satisfies GroupPurchaseDetailRecord;
    },
    async findParticipant(purchaseId, participantTelegramUserId) {
      const result = await database
        .select()
        .from(groupPurchaseParticipants)
        .where(
          and(
            eq(groupPurchaseParticipants.purchaseId, purchaseId),
            eq(groupPurchaseParticipants.participantTelegramUserId, participantTelegramUserId),
          ),
        );
      const row = result[0];
      return row ? mapGroupPurchaseParticipantRow(row) : null;
    },
    async listParticipants(purchaseId) {
      const result = await database
        .select()
        .from(groupPurchaseParticipants)
        .where(eq(groupPurchaseParticipants.purchaseId, purchaseId))
        .orderBy(asc(groupPurchaseParticipants.joinedAt), asc(groupPurchaseParticipants.participantTelegramUserId));
      return result.map(mapGroupPurchaseParticipantRow);
    },
    async upsertParticipant(input) {
      const now = new Date();
      const inserted = await database
        .insert(groupPurchaseParticipants)
        .values({
          purchaseId: input.purchaseId,
          participantTelegramUserId: input.participantTelegramUserId,
          status: input.status,
          joinedAt: now,
          updatedAt: now,
          ...(input.status === 'removed' ? { removedAt: now } : { removedAt: null }),
          ...(input.status === 'confirmed' ? { confirmedAt: now } : {}),
          ...(input.status === 'paid' ? { paidAt: now } : {}),
          ...(input.status === 'delivered' ? { deliveredAt: now } : {}),
        })
        .onConflictDoUpdate({
          target: [groupPurchaseParticipants.purchaseId, groupPurchaseParticipants.participantTelegramUserId],
          set: {
            status: input.status,
            updatedAt: now,
            removedAt: input.status === 'removed' ? now : null,
            ...(input.status === 'confirmed' ? { confirmedAt: now } : {}),
            ...(input.status === 'paid' ? { paidAt: now } : {}),
            ...(input.status === 'delivered' ? { deliveredAt: now } : {}),
          },
        })
        .returning();

      const row = inserted[0];
      if (!row) {
        throw new Error(`Group purchase participant ${input.participantTelegramUserId} for purchase ${input.purchaseId} not found`);
      }

      return mapGroupPurchaseParticipantRow(row);
    },
    async listParticipantFieldValues(purchaseId, participantTelegramUserId) {
      const result = await database
        .select()
        .from(groupPurchaseParticipantFieldValues)
        .where(
          and(
            eq(groupPurchaseParticipantFieldValues.purchaseId, purchaseId),
            eq(groupPurchaseParticipantFieldValues.participantTelegramUserId, participantTelegramUserId),
          ),
        )
        .orderBy(asc(groupPurchaseParticipantFieldValues.fieldId));

      return result.map(mapGroupPurchaseParticipantFieldValueRow);
    },
    async replaceParticipantFieldValues(input) {
      return database.transaction(async (tx) => {
        await tx
          .delete(groupPurchaseParticipantFieldValues)
          .where(
            and(
              eq(groupPurchaseParticipantFieldValues.purchaseId, input.purchaseId),
              eq(groupPurchaseParticipantFieldValues.participantTelegramUserId, input.participantTelegramUserId),
            ),
          );

        if (input.values.length === 0) {
          return [];
        }

        const inserted = await tx
          .insert(groupPurchaseParticipantFieldValues)
          .values(
            input.values.map((value) => ({
              purchaseId: input.purchaseId,
              participantTelegramUserId: input.participantTelegramUserId,
              fieldId: value.fieldId,
              value: value.value,
              updatedAt: new Date(),
            })),
          )
          .returning();

        return inserted.map(mapGroupPurchaseParticipantFieldValueRow);
      });
    },
    async createMessage(input) {
      const inserted = await database
        .insert(groupPurchaseMessages)
        .values({
          purchaseId: input.purchaseId,
          authorTelegramUserId: input.authorTelegramUserId,
          body: input.body,
        })
        .returning();

      const row = inserted[0];
      if (!row) {
        throw new Error(`Group purchase message for purchase ${input.purchaseId} was not created`);
      }

      return mapGroupPurchaseMessageRow(row);
    },
  };
}

function asDate(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

function mapGroupPurchaseRow(row: typeof groupPurchases.$inferSelect): GroupPurchaseRecord {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    purchaseMode: row.purchaseMode as GroupPurchaseRecord['purchaseMode'],
    lifecycleStatus: row.lifecycleStatus as GroupPurchaseRecord['lifecycleStatus'],
    createdByTelegramUserId: row.createdByTelegramUserId,
    joinDeadlineAt: row.joinDeadlineAt?.toISOString() ?? null,
    confirmDeadlineAt: row.confirmDeadlineAt?.toISOString() ?? null,
    totalPriceCents: row.totalPriceCents,
    unitPriceCents: row.unitPriceCents,
    unitLabel: row.unitLabel,
    allocationFieldKey: row.allocationFieldKey,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
  };
}

function mapGroupPurchaseFieldRow(row: typeof groupPurchaseFields.$inferSelect): GroupPurchaseFieldRecord {
  return {
    id: row.id,
    purchaseId: row.purchaseId,
    fieldKey: row.fieldKey,
    label: row.label,
    fieldType: row.fieldType as GroupPurchaseFieldRecord['fieldType'],
    isRequired: row.isRequired,
    sortOrder: row.sortOrder,
    config: (row.config as Record<string, unknown> | null) ?? null,
    affectsQuantity: row.affectsQuantity,
  };
}

function mapGroupPurchaseParticipantRow(
  row: typeof groupPurchaseParticipants.$inferSelect,
): GroupPurchaseParticipantRecord {
  return {
    purchaseId: row.purchaseId,
    participantTelegramUserId: row.participantTelegramUserId,
    status: row.status as GroupPurchaseParticipantRecord['status'],
    joinedAt: row.joinedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    removedAt: row.removedAt?.toISOString() ?? null,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
  };
}

function mapGroupPurchaseParticipantFieldValueRow(
  row: typeof groupPurchaseParticipantFieldValues.$inferSelect,
): GroupPurchaseParticipantFieldValueRecord {
  return {
    purchaseId: row.purchaseId,
    participantTelegramUserId: row.participantTelegramUserId,
    fieldId: row.fieldId,
    value: row.value,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapGroupPurchaseMessageRow(row: typeof groupPurchaseMessages.$inferSelect): GroupPurchaseMessageRecord {
  return {
    id: row.id,
    purchaseId: row.purchaseId,
    authorTelegramUserId: row.authorTelegramUserId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}
