import {
  createCatalogFamily,
  type CatalogFamilyRecord,
  type CatalogItemType,
  type CatalogRepository,
} from '../catalog/catalog-model.js';

export async function parseCatalogFamilyInput({
  repository,
  text,
  itemType,
  noFamilyLabel,
  normalizeFamilyLookupKey,
  buildFamilySlug,
  familyKindForItemType,
}: {
  repository: CatalogRepository;
  text: string;
  itemType: CatalogItemType;
  noFamilyLabel: string;
  normalizeFamilyLookupKey: (value: string) => string;
  buildFamilySlug: (value: string) => string;
  familyKindForItemType: (itemType: CatalogItemType) => CatalogFamilyRecord['familyKind'];
}): Promise<number | null | Error> {
  if (text === noFamilyLabel) {
    return null;
  }

  const value = Number(text);
  if (Number.isInteger(value) && value > 0) {
    const family = await repository.findFamilyById(value);
    if (!family) {
      return new Error('unknown-family');
    }
    return value;
  }

  const normalizedText = normalizeFamilyLookupKey(text);
  if (!normalizedText) {
    return new Error('invalid-family-name');
  }

  const existingFamily = (await repository.listFamilies()).find((family) => {
    return normalizeFamilyLookupKey(family.displayName) === normalizedText || normalizeFamilyLookupKey(family.slug) === normalizedText;
  });
  if (existingFamily) {
    return existingFamily.id;
  }
  if (itemType !== 'rpg-book' && itemType !== 'book' && itemType !== 'board-game') {
    return new Error('unknown-family');
  }

  const createdFamily = await createCatalogFamily({
    repository,
    slug: buildFamilySlug(text),
    displayName: text.trim(),
    familyKind: familyKindForItemType(itemType),
  });
  return createdFamily.id;
}

export async function parseCatalogGroupInput({
  repository,
  text,
  familyId,
  noGroupLabel,
}: {
  repository: CatalogRepository;
  text: string;
  familyId: number | null;
  noGroupLabel: string;
}): Promise<number | null | Error> {
  if (text === noGroupLabel) {
    return null;
  }

  const value = Number(text);
  if (!Number.isInteger(value) || value <= 0) {
    return new Error('invalid-group-id');
  }
  const group = await repository.findGroupById(value);
  if (!group) {
    return new Error('unknown-group');
  }
  if (group.familyId !== familyId) {
    return new Error('group-family-mismatch');
  }
  return value;
}
