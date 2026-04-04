import { and, asc, eq } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { catalogFamilies, catalogGroups, catalogItems, catalogMedia } from '../infrastructure/database/schema.js';
import type {
  CatalogFamilyRecord,
  CatalogGroupRecord,
  CatalogItemRecord,
  CatalogMediaRecord,
  CatalogRepository,
} from './catalog-model.js';

export function createDatabaseCatalogRepository({
  database,
}: {
  database: DatabaseConnection['db'];
}): CatalogRepository {
  return {
    async createFamily(input) {
      const created = await database.insert(catalogFamilies).values(input).returning();
      const row = created[0];
      if (!row) {
        throw new Error('Catalog family insert did not return a row');
      }
      return mapCatalogFamilyRow(row);
    },
    async findFamilyById(familyId) {
      const result = await database.select().from(catalogFamilies).where(eq(catalogFamilies.id, familyId));
      const row = result[0];
      return row ? mapCatalogFamilyRow(row) : null;
    },
    async listFamilies() {
      const result = await database.select().from(catalogFamilies).orderBy(asc(catalogFamilies.displayName));
      return result.map(mapCatalogFamilyRow);
    },
    async createGroup(input) {
      const created = await database.insert(catalogGroups).values(input).returning();
      const row = created[0];
      if (!row) {
        throw new Error('Catalog group insert did not return a row');
      }
      return mapCatalogGroupRow(row);
    },
    async findGroupById(groupId) {
      const result = await database.select().from(catalogGroups).where(eq(catalogGroups.id, groupId));
      const row = result[0];
      return row ? mapCatalogGroupRow(row) : null;
    },
    async listGroups({ familyId }) {
      const query = database.select().from(catalogGroups);
      const result = familyId !== undefined
        ? await query.where(eq(catalogGroups.familyId, familyId)).orderBy(asc(catalogGroups.displayName))
        : await query.orderBy(asc(catalogGroups.displayName));
      return result.map(mapCatalogGroupRow);
    },
    async createItem(input) {
      const created = await database.insert(catalogItems).values(input).returning();
      const row = created[0];
      if (!row) {
        throw new Error('Catalog item insert did not return a row');
      }
      return mapCatalogItemRow(row);
    },
    async findItemById(itemId) {
      const result = await database.select().from(catalogItems).where(eq(catalogItems.id, itemId));
      const row = result[0];
      return row ? mapCatalogItemRow(row) : null;
    },
    async listItems({ familyId, groupId, includeDeactivated }) {
      const filters = [];
      if (!includeDeactivated) {
        filters.push(eq(catalogItems.lifecycleStatus, 'active'));
      }
      if (familyId !== undefined) {
        filters.push(eq(catalogItems.familyId, familyId));
      }
      if (groupId !== undefined) {
        filters.push(eq(catalogItems.groupId, groupId));
      }

      const query = database.select().from(catalogItems);
      const result = filters.length > 0
        ? await query.where(and(...filters)).orderBy(asc(catalogItems.displayName))
        : await query.orderBy(asc(catalogItems.displayName));

      return result.map(mapCatalogItemRow);
    },
    async updateItem(input) {
      const updated = await database
        .update(catalogItems)
        .set({
          familyId: input.familyId,
          groupId: input.groupId,
          itemType: input.itemType,
          displayName: input.displayName,
          originalName: input.originalName,
          description: input.description,
          language: input.language,
          publisher: input.publisher,
          publicationYear: input.publicationYear,
          playerCountMin: input.playerCountMin,
          playerCountMax: input.playerCountMax,
          recommendedAge: input.recommendedAge,
          playTimeMinutes: input.playTimeMinutes,
          externalRefs: input.externalRefs,
          metadata: input.metadata,
          updatedAt: new Date(),
        })
        .where(eq(catalogItems.id, input.itemId))
        .returning();
      const row = updated[0];
      if (!row) {
        throw new Error(`Catalog item ${input.itemId} not found`);
      }
      return mapCatalogItemRow(row);
    },
    async deactivateItem({ itemId }) {
      const now = new Date();
      const updated = await database
        .update(catalogItems)
        .set({
          lifecycleStatus: 'deactivated',
          updatedAt: now,
          deactivatedAt: now,
        })
        .where(eq(catalogItems.id, itemId))
        .returning();
      const row = updated[0];
      if (!row) {
        throw new Error(`Catalog item ${itemId} not found`);
      }
      return mapCatalogItemRow(row);
    },
    async createMedia(input) {
      const created = await database.insert(catalogMedia).values(input).returning();
      const row = created[0];
      if (!row) {
        throw new Error('Catalog media insert did not return a row');
      }
      return mapCatalogMediaRow(row);
    },
    async listMedia({ familyId, itemId }) {
      const filters = [];
      if (familyId !== undefined) {
        filters.push(eq(catalogMedia.familyId, familyId));
      }
      if (itemId !== undefined) {
        filters.push(eq(catalogMedia.itemId, itemId));
      }

      const query = database.select().from(catalogMedia);
      const result = filters.length > 0
        ? await query.where(and(...filters)).orderBy(asc(catalogMedia.sortOrder), asc(catalogMedia.id))
        : await query.orderBy(asc(catalogMedia.sortOrder), asc(catalogMedia.id));

      return result.map(mapCatalogMediaRow);
    },
  };
}

function mapCatalogFamilyRow(row: typeof catalogFamilies.$inferSelect): CatalogFamilyRecord {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    description: row.description,
    familyKind: row.familyKind as CatalogFamilyRecord['familyKind'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapCatalogGroupRow(row: typeof catalogGroups.$inferSelect): CatalogGroupRecord {
  return {
    id: row.id,
    familyId: row.familyId,
    slug: row.slug,
    displayName: row.displayName,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapCatalogItemRow(row: typeof catalogItems.$inferSelect): CatalogItemRecord {
  return {
    id: row.id,
    familyId: row.familyId,
    groupId: row.groupId,
    itemType: row.itemType as CatalogItemRecord['itemType'],
    displayName: row.displayName,
    originalName: row.originalName,
    description: row.description,
    language: row.language,
    publisher: row.publisher,
    publicationYear: row.publicationYear,
    playerCountMin: row.playerCountMin,
    playerCountMax: row.playerCountMax,
    recommendedAge: row.recommendedAge,
    playTimeMinutes: row.playTimeMinutes,
    externalRefs: (row.externalRefs as Record<string, unknown> | null) ?? null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    lifecycleStatus: row.lifecycleStatus as CatalogItemRecord['lifecycleStatus'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
  };
}

function mapCatalogMediaRow(row: typeof catalogMedia.$inferSelect): CatalogMediaRecord {
  return {
    id: row.id,
    familyId: row.familyId,
    itemId: row.itemId,
    mediaType: row.mediaType as CatalogMediaRecord['mediaType'],
    url: row.url,
    altText: row.altText,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
