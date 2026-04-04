import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCatalogFamily,
  createCatalogGroup,
  createCatalogItem,
  createCatalogMedia,
  deactivateCatalogItem,
  listCatalogItems,
  listCatalogGroups,
  updateCatalogItem,
  type CatalogFamilyRecord,
  type CatalogGroupRecord,
  type CatalogItemRecord,
  type CatalogMediaRecord,
  type CatalogRepository,
} from './catalog-model.js';

function createRepository({
  families: initialFamilies = [],
  groups: initialGroups = [],
  items: initialItems = [],
  media: initialMedia = [],
}: {
  families?: CatalogFamilyRecord[];
  groups?: CatalogGroupRecord[];
  items?: CatalogItemRecord[];
  media?: CatalogMediaRecord[];
} = {}): CatalogRepository {
  const families = new Map(initialFamilies.map((family) => [family.id, family]));
  const groups = new Map(initialGroups.map((group) => [group.id, group]));
  const items = new Map(initialItems.map((item) => [item.id, item]));
  const media = new Map(initialMedia.map((entry) => [entry.id, entry]));
  let nextFamilyId = Math.max(0, ...initialFamilies.map((family) => family.id)) + 1;
  let nextGroupId = Math.max(0, ...initialGroups.map((group) => group.id)) + 1;
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
    async createGroup(input) {
      const createdAt = '2026-04-04T10:00:00.000Z';
      const group: CatalogGroupRecord = {
        id: nextGroupId,
        familyId: input.familyId,
        slug: input.slug,
        displayName: input.displayName,
        description: input.description,
        createdAt,
        updatedAt: createdAt,
      };
      nextGroupId += 1;
      groups.set(group.id, group);
      return group;
    },
    async findGroupById(groupId) {
      return groups.get(groupId) ?? null;
    },
    async listGroups({ familyId }) {
      return Array.from(groups.values()).filter((group) => {
        if (familyId !== undefined && group.familyId !== familyId) {
          return false;
        }
        return true;
      });
    },
    async createItem(input) {
      const createdAt = '2026-04-04T10:00:00.000Z';
      const item: CatalogItemRecord = {
        id: nextItemId,
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
    async updateItem(input) {
      const existing = items.get(input.itemId);
      if (!existing) {
        throw new Error(`unknown item ${input.itemId}`);
      }
      const next: CatalogItemRecord = {
        ...existing,
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
        updatedAt: '2026-04-04T11:00:00.000Z',
      };
      items.set(next.id, next);
      return next;
    },
    async deactivateItem({ itemId }) {
      const existing = items.get(itemId);
      if (!existing) {
        throw new Error(`unknown item ${itemId}`);
      }
      const next: CatalogItemRecord = {
        ...existing,
        lifecycleStatus: 'deactivated',
        updatedAt: '2026-04-04T12:00:00.000Z',
        deactivatedAt: '2026-04-04T12:00:00.000Z',
      };
      items.set(next.id, next);
      return next;
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

test('createCatalogGroup creates a normalized group within a family line', async () => {
  const repository = createRepository({
    families: [
      {
        id: 3,
        slug: 'arkham-horror',
        displayName: 'Arkham Horror',
        description: null,
        familyKind: 'board-game-line',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
    ],
  });

  const group = await createCatalogGroup({
    repository,
    familyId: 3,
    slug: '  second-edition  ',
    displayName: '  Segona edicio  ',
    description: '  Joc base, expansions i accessoris compatibles  ',
  });

  assert.equal(group.id, 1);
  assert.equal(group.familyId, 3);
  assert.equal(group.slug, 'second-edition');
  assert.equal(group.displayName, 'Segona edicio');
  assert.equal(group.description, 'Joc base, expansions i accessoris compatibles');
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
    groups: [
      {
        id: 4,
        familyId: 7,
        slug: 'second-edition',
        displayName: 'Second Edition',
        description: null,
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
    ],
  });

  const grouped = await createCatalogItem({
    repository,
    familyId: 7,
    groupId: 4,
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
  const groupedGroups = await listCatalogGroups({ repository, familyId: 7 });

  assert.equal(grouped.familyId, 7);
  assert.equal(grouped.groupId, 4);
  assert.equal(standalone.familyId, null);
  assert.equal(standalone.groupId, null);
  assert.deepEqual(groupedItems.map((item) => item.displayName), ['Core Rulebook']);
  assert.deepEqual(groupedGroups.map((group) => group.displayName), ['Second Edition']);
});

test('createCatalogItem rejects unknown groups and family mismatches against the selected group', async () => {
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
      {
        id: 8,
        slug: 'dnd',
        displayName: 'D&D',
        description: null,
        familyKind: 'rpg-line',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
    ],
    groups: [
      {
        id: 4,
        familyId: 7,
        slug: 'second-edition',
        displayName: 'Second Edition',
        description: null,
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
    ],
  });

  await assert.rejects(
    () =>
      createCatalogItem({
        repository,
        familyId: 7,
        groupId: 99,
        itemType: 'rpg-book',
        displayName: 'Bestiary',
      }),
    /Catalog group 99 not found/,
  );

  await assert.rejects(
    () =>
      createCatalogItem({
        repository,
        familyId: 8,
        groupId: 4,
        itemType: 'rpg-book',
        displayName: 'Bestiary',
      }),
    /La familia de l item ha de coincidir amb la del grup seleccionat/,
  );
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

test('updateCatalogItem preserves identity while changing optional metadata', async () => {
  const repository = createRepository({
    items: [
      {
        id: 4,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Root',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });

  const updated = await updateCatalogItem({
    repository,
    itemId: 4,
    familyId: null,
    groupId: null,
    itemType: 'board-game',
    displayName: 'Root Deluxe',
    description: '  Joc d area control  ',
    playerCountMin: 2,
    playerCountMax: 6,
  });

  assert.equal(updated.id, 4);
  assert.equal(updated.displayName, 'Root Deluxe');
  assert.equal(updated.description, 'Joc d area control');
  assert.equal(updated.playerCountMax, 6);
});

test('deactivateCatalogItem preserves historical references and becomes idempotent', async () => {
  const repository = createRepository({
    items: [
      {
        id: 9,
        familyId: null,
        groupId: null,
        itemType: 'rpg-book',
        displayName: 'Player Handbook',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });

  const first = await deactivateCatalogItem({ repository, itemId: 9 });
  const second = await deactivateCatalogItem({ repository, itemId: 9 });
  const allItems = await listCatalogItems({ repository, includeDeactivated: true });

  assert.equal(first.lifecycleStatus, 'deactivated');
  assert.equal(second.lifecycleStatus, 'deactivated');
  assert.equal(allItems[0]?.id, 9);
});
