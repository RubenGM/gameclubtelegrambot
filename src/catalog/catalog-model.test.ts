import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCatalogFamily,
  createCatalogItem,
  createCatalogMedia,
  listCatalogItems,
  type CatalogFamilyRecord,
  type CatalogItemRecord,
  type CatalogMediaRecord,
  type CatalogRepository,
} from './catalog-model.js';

function createRepository({
  families: initialFamilies = [],
  items: initialItems = [],
  media: initialMedia = [],
}: {
  families?: CatalogFamilyRecord[];
  items?: CatalogItemRecord[];
  media?: CatalogMediaRecord[];
} = {}): CatalogRepository {
  const families = new Map(initialFamilies.map((family) => [family.id, family]));
  const items = new Map(initialItems.map((item) => [item.id, item]));
  const media = new Map(initialMedia.map((entry) => [entry.id, entry]));
  let nextFamilyId = Math.max(0, ...initialFamilies.map((family) => family.id)) + 1;
  let nextItemId = Math.max(0, ...initialItems.map((item) => item.id)) + 1;
  let nextMediaId = Math.max(0, ...initialMedia.map((entry) => entry.id)) + 1;

  return {
    async createFamily(input) {
      const createdAt = '2026-04-04T10:00:00.000Z';
      const family: CatalogFamilyRecord = {
        id: nextFamilyId,
        slug: input.slug,
        displayName: input.displayName,
        description: input.description,
        familyKind: input.familyKind,
        createdAt,
        updatedAt: createdAt,
      };
      nextFamilyId += 1;
      families.set(family.id, family);
      return family;
    },
    async findFamilyById(familyId) {
      return families.get(familyId) ?? null;
    },
    async listFamilies() {
      return Array.from(families.values());
    },
    async createItem(input) {
      const createdAt = '2026-04-04T10:00:00.000Z';
      const item: CatalogItemRecord = {
        id: nextItemId,
        familyId: input.familyId,
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
        lifecycleStatus: 'active',
        createdAt,
        updatedAt: createdAt,
        deactivatedAt: null,
      };
      nextItemId += 1;
      items.set(item.id, item);
      return item;
    },
    async findItemById(itemId) {
      return items.get(itemId) ?? null;
    },
    async listItems({ familyId, includeDeactivated }) {
      return Array.from(items.values()).filter((item) => {
        if (!includeDeactivated && item.lifecycleStatus !== 'active') {
          return false;
        }
        if (familyId !== undefined && item.familyId !== familyId) {
          return false;
        }
        return true;
      });
    },
    async createMedia(input) {
      const createdAt = '2026-04-04T10:00:00.000Z';
      const entry: CatalogMediaRecord = {
        id: nextMediaId,
        familyId: input.familyId,
        itemId: input.itemId,
        mediaType: input.mediaType,
        url: input.url,
        altText: input.altText,
        sortOrder: input.sortOrder,
        createdAt,
        updatedAt: createdAt,
      };
      nextMediaId += 1;
      media.set(entry.id, entry);
      return entry;
    },
    async listMedia({ familyId, itemId }) {
      return Array.from(media.values()).filter((entry) => {
        if (familyId !== undefined) {
          return entry.familyId === familyId;
        }
        if (itemId !== undefined) {
          return entry.itemId === itemId;
        }
        return true;
      });
    },
  };
}

test('createCatalogFamily creates a normalized family line', async () => {
  const repository = createRepository();

  const family = await createCatalogFamily({
    repository,
    slug: '  arkham-horror  ',
    displayName: '  Arkham Horror  ',
    description: '  Joc base i expansions cooperatives  ',
    familyKind: 'board-game-line',
  });

  assert.equal(family.id, 1);
  assert.equal(family.slug, 'arkham-horror');
  assert.equal(family.displayName, 'Arkham Horror');
  assert.equal(family.description, 'Joc base i expansions cooperatives');
  assert.equal(family.familyKind, 'board-game-line');
});

test('createCatalogItem rejects invalid player ranges and unknown family references', async () => {
  const repository = createRepository();

  await assert.rejects(
    () =>
      createCatalogItem({
        repository,
        familyId: null,
        itemType: 'board-game',
        displayName: 'Terraforming Mars',
        playerCountMin: 5,
        playerCountMax: 4,
      }),
    /El maxim de jugadors no pot ser inferior al minim/,
  );

  await assert.rejects(
    () =>
      createCatalogItem({
        repository,
        familyId: 99,
        itemType: 'rpg-book',
        displayName: 'Pathfinder Core Rulebook',
      }),
    /Catalog family 99 not found/,
  );
});

test('createCatalogItem supports grouped lines and standalone catalog items', async () => {
  const repository = createRepository({
    families: [
      {
        id: 7,
        slug: 'pathfinder',
        displayName: 'Pathfinder',
        description: null,
        familyKind: 'rpg-line',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
    ],
  });

  const grouped = await createCatalogItem({
    repository,
    familyId: 7,
    itemType: 'rpg-book',
    displayName: 'Core Rulebook',
    publicationYear: 2019,
  });
  const standalone = await createCatalogItem({
    repository,
    familyId: null,
    itemType: 'board-game',
    displayName: 'Root',
    playerCountMin: 2,
    playerCountMax: 4,
  });

  const groupedItems = await listCatalogItems({ repository, familyId: 7 });

  assert.equal(grouped.familyId, 7);
  assert.equal(standalone.familyId, null);
  assert.deepEqual(groupedItems.map((item) => item.displayName), ['Core Rulebook']);
});

test('createCatalogMedia requires exactly one owner reference', async () => {
  const repository = createRepository();

  await assert.rejects(
    () =>
      createCatalogMedia({
        repository,
        familyId: null,
        itemId: null,
        mediaType: 'image',
        url: 'https://example.com/image.jpg',
      }),
    /El media ha d apuntar exactament a una familia o a un item/,
  );

  await assert.rejects(
    () =>
      createCatalogMedia({
        repository,
        familyId: 1,
        itemId: 2,
        mediaType: 'image',
        url: 'https://example.com/image.jpg',
      }),
    /El media ha d apuntar exactament a una familia o a un item/,
  );
});
