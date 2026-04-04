import test from 'node:test';
import assert from 'node:assert/strict';

import { catalogFamilies, catalogItems, catalogMedia } from '../infrastructure/database/schema.js';
import { createDatabaseCatalogRepository } from './catalog-store.js';

const catalogFamiliesTable = catalogFamilies as unknown;
const catalogItemsTable = catalogItems as unknown;
const catalogMediaTable = catalogMedia as unknown;

test('createDatabaseCatalogRepository persists family and item relations', async () => {
  const repository = createDatabaseCatalogRepository({
    database: {
      insert: (table: { [key: string]: unknown }) => {
        if ((table as unknown) === catalogFamiliesTable) {
          return {
            values: (values: Record<string, unknown>) => {
              assert.equal(values.slug, 'arkham-horror');
              return {
                returning: async () => [
                  {
                    id: 1,
                    slug: 'arkham-horror',
                    displayName: 'Arkham Horror',
                    description: null,
                    familyKind: 'board-game-line',
                    createdAt: new Date('2026-04-04T10:00:00.000Z'),
                    updatedAt: new Date('2026-04-04T10:00:00.000Z'),
                  },
                ],
              };
            },
          };
        }

        if ((table as unknown) === catalogItemsTable) {
          return {
            values: (values: Record<string, unknown>) => {
              assert.equal(values.familyId, 1);
              assert.equal(values.itemType, 'expansion');
              assert.ok(values.externalRefs);
              return {
                returning: async () => [
                  {
                    id: 2,
                    familyId: 1,
                    itemType: 'expansion',
                    displayName: 'Dunwich Horror Expansion',
                    originalName: null,
                    description: null,
                    language: null,
                    publisher: null,
                    publicationYear: 2010,
                    playerCountMin: null,
                    playerCountMax: null,
                    recommendedAge: null,
                    playTimeMinutes: null,
                    externalRefs: { bggId: '123' },
                    metadata: { complexity: 'medium' },
                    lifecycleStatus: 'active',
                    createdAt: new Date('2026-04-04T10:00:00.000Z'),
                    updatedAt: new Date('2026-04-04T10:00:00.000Z'),
                    deactivatedAt: null,
                  },
                ],
              };
            },
          };
        }

        throw new Error('unexpected table');
      },
    } as never,
  });

  const family = await repository.createFamily({
    slug: 'arkham-horror',
    displayName: 'Arkham Horror',
    description: null,
    familyKind: 'board-game-line',
  });
  const item = await repository.createItem({
    familyId: 1,
    itemType: 'expansion',
    displayName: 'Dunwich Horror Expansion',
    originalName: null,
    description: null,
    language: null,
    publisher: null,
    publicationYear: 2010,
    playerCountMin: null,
    playerCountMax: null,
    recommendedAge: null,
    playTimeMinutes: null,
    externalRefs: { bggId: '123' },
    metadata: { complexity: 'medium' },
  });

  assert.equal(family.id, 1);
  assert.equal(item.familyId, 1);
  assert.deepEqual(item.externalRefs, { bggId: '123' });
});

test('createDatabaseCatalogRepository persists media attached to one item', async () => {
  const repository = createDatabaseCatalogRepository({
    database: {
      insert: (table: { [key: string]: unknown }) => {
        if ((table as unknown) !== catalogMediaTable) {
          throw new Error('unexpected table');
        }

        return {
          values: (values: Record<string, unknown>) => {
            assert.equal(values.itemId, 7);
            assert.equal(values.familyId, null);
            assert.equal(values.mediaType, 'image');

            return {
              returning: async () => [
                {
                  id: 4,
                  familyId: null,
                  itemId: 7,
                  mediaType: 'image',
                  url: 'https://example.com/root.jpg',
                  altText: 'Portada de Root',
                  sortOrder: 0,
                  createdAt: new Date('2026-04-04T10:00:00.000Z'),
                  updatedAt: new Date('2026-04-04T10:00:00.000Z'),
                },
              ],
            };
          },
        };
      },
    } as never,
  });

  const media = await repository.createMedia({
    familyId: null,
    itemId: 7,
    mediaType: 'image',
    url: 'https://example.com/root.jpg',
    altText: 'Portada de Root',
    sortOrder: 0,
  });

  assert.equal(media.id, 4);
  assert.equal(media.itemId, 7);
  assert.equal(media.familyId, null);
});
