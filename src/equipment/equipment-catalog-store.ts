import { asc, eq } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { clubEquipment } from '../infrastructure/database/schema.js';
import type { ClubEquipmentRecord, ClubEquipmentRepository } from './equipment-catalog.js';

export function createDatabaseClubEquipmentRepository({
  database,
}: {
  database: DatabaseConnection['db'];
}): ClubEquipmentRepository {
  return {
    async createEquipment(input) {
      const created = await database
        .insert(clubEquipment)
        .values({
          displayName: input.displayName,
          description: input.description,
        })
        .returning();
      const row = created[0];
      if (!row) {
        throw new Error('Club equipment insert did not return a row');
      }
      return mapClubEquipmentRow(row);
    },
    async findEquipmentById(equipmentId) {
      const result = await database.select().from(clubEquipment).where(eq(clubEquipment.id, equipmentId));
      const row = result[0];
      return row ? mapClubEquipmentRow(row) : null;
    },
    async listEquipment({ includeDeactivated }) {
      const result = includeDeactivated
        ? await database.select().from(clubEquipment).orderBy(asc(clubEquipment.displayName))
        : await database
            .select()
            .from(clubEquipment)
            .where(eq(clubEquipment.lifecycleStatus, 'active'))
            .orderBy(asc(clubEquipment.displayName));
      return result.map(mapClubEquipmentRow);
    },
    async updateEquipment(input) {
      const updated = await database
        .update(clubEquipment)
        .set({
          displayName: input.displayName,
          description: input.description,
          updatedAt: new Date(),
        })
        .where(eq(clubEquipment.id, input.equipmentId))
        .returning();
      const row = updated[0];
      if (!row) {
        throw new Error(`Club equipment ${input.equipmentId} not found`);
      }
      return mapClubEquipmentRow(row);
    },
    async deactivateEquipment({ equipmentId }) {
      const now = new Date();
      const updated = await database
        .update(clubEquipment)
        .set({ lifecycleStatus: 'deactivated', updatedAt: now, deactivatedAt: now })
        .where(eq(clubEquipment.id, equipmentId))
        .returning();
      const row = updated[0];
      if (!row) {
        throw new Error(`Club equipment ${equipmentId} not found`);
      }
      return mapClubEquipmentRow(row);
    },
  };
}

function mapClubEquipmentRow(row: typeof clubEquipment.$inferSelect): ClubEquipmentRecord {
  return {
    id: row.id,
    displayName: row.displayName,
    description: row.description,
    lifecycleStatus: row.lifecycleStatus as ClubEquipmentRecord['lifecycleStatus'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
  };
}
