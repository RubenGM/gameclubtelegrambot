import { listCatalogGroups, listCatalogItems, type CatalogFamilyRecord, type CatalogGroupRecord, type CatalogItemRecord, type CatalogItemType, type CatalogRepository } from '../catalog/catalog-model.js';
import { buildFamilyOptions } from './catalog-admin-keyboards.js';
import { createTelegramI18n } from './i18n.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

export async function buildCatalogAdminFamilyPrompt({
  repository,
  itemType,
  language,
}: {
  repository: CatalogRepository;
  itemType: CatalogItemType;
  language: 'ca' | 'es' | 'en';
}): Promise<string> {
  const texts = createTelegramI18n(language).catalogAdmin;
  const families = await repository.listFamilies();
  if (itemType === 'rpg-book' || itemType === 'book' || itemType === 'board-game') {
    const popularFamilies = await listPopularCatalogFamilies({ repository, itemType });
    if (popularFamilies.length === 0) {
      if (itemType === 'board-game') {
        return texts.promptFamilyWriteBoardGame;
      }
      return itemType === 'rpg-book'
        ? texts.promptFamilyWriteRpgBook
        : texts.promptFamilyWriteBook;
    }
    if (itemType === 'board-game') {
      return texts.promptFamilyChooseBoardGame;
    }
    return itemType === 'rpg-book'
      ? texts.promptFamilyChooseRpgBook
      : texts.promptFamilyChooseBook;
  }
  if (families.length === 0) {
    return texts.promptNoFamilies;
  }
  return [texts.promptFamilyId, ...families.map(formatCatalogFamilyOption)].join('\n');
}

export async function buildCatalogAdminFamilyOptions({
  repository,
  itemType,
  language,
}: {
  repository: CatalogRepository;
  itemType: CatalogItemType;
  language: 'ca' | 'es' | 'en';
}): Promise<TelegramReplyOptions> {
  const allowNoFamily = itemType === 'rpg-book' || itemType === 'book' || itemType === 'board-game';
  const popularFamilies = allowNoFamily ? await listPopularCatalogFamilies({ repository, itemType }) : [];
  return buildFamilyOptions({
    allowNoFamily,
    popularFamilyNames: popularFamilies.map((family) => family.displayName),
    language,
  });
}

export async function buildCatalogAdminGroupPrompt({
  repository,
  familyId,
  language,
}: {
  repository: CatalogRepository;
  familyId: number | null;
  language: 'ca' | 'es' | 'en';
}): Promise<string> {
  const texts = createTelegramI18n(language).catalogAdmin;
  if (familyId === null) {
    return texts.promptNoGroupsWithNoFamily;
  }
  const groups = await listCatalogGroups({ repository, ...(familyId !== null ? { familyId } : {}) });
  if (groups.length === 0) {
    return texts.promptNoGroups;
  }
  return [texts.promptGroupId, ...groups.map(formatCatalogGroupOption)].join('\n');
}

export async function buildCatalogAdminGroupedInspectKeyboard({
  repository,
  items,
  language,
  inspectPrefix,
  inspectGroupPrefix,
}: {
  repository: CatalogRepository;
  items: CatalogItemRecord[];
  language: 'ca' | 'es' | 'en';
  inspectPrefix: string;
  inspectGroupPrefix: string;
}): Promise<NonNullable<TelegramReplyOptions['inlineKeyboard']>> {
  const texts = createTelegramI18n(language).catalogAdmin;
  const groups = await listCatalogGroups({ repository });
  const grouped = groups
    .filter((group) => items.some((item) => item.groupId === group.id))
    .map((group) => [{ text: texts.inspectGroupButton.replace('{name}', group.displayName), callbackData: `${inspectGroupPrefix}${group.id}` }]);
  const itemRows = items.map((item) => [{ text: item.displayName, callbackData: `${inspectPrefix}${item.id}` }]);
  return [...grouped, ...itemRows];
}

export async function listPopularCatalogFamilies({
  repository,
  itemType,
}: {
  repository: CatalogRepository;
  itemType: CatalogItemType;
}): Promise<CatalogFamilyRecord[]> {
  const [families, items] = await Promise.all([
    repository.listFamilies(),
    listCatalogItems({ repository, includeDeactivated: false }),
  ]);
  const compatibleFamilies = families.filter((family) => family.familyKind === familyKindForItemType(itemType));
  const counts = new Map<number, number>();
  for (const item of items) {
    if (item.itemType !== itemType || item.familyId === null) {
      continue;
    }
    counts.set(item.familyId, (counts.get(item.familyId) ?? 0) + 1);
  }
  return compatibleFamilies
    .slice()
    .sort((left, right) => {
      const popularityDifference = (counts.get(right.id) ?? 0) - (counts.get(left.id) ?? 0);
      if (popularityDifference !== 0) {
        return popularityDifference;
      }
      return left.displayName.localeCompare(right.displayName);
    })
    .slice(0, 6);
}

export function familyKindForItemType(itemType: CatalogItemType): CatalogFamilyRecord['familyKind'] {
  switch (itemType) {
    case 'rpg-book':
      return 'rpg-line';
    case 'book':
      return 'generic-line';
    case 'board-game':
    case 'expansion':
      return 'board-game-line';
    case 'accessory':
      return 'generic-line';
  }
}

export function chunkKeyboard(values: string[], size: number): string[][] {
  const rows: string[][] = [];
  for (let index = 0; index < values.length; index += size) {
    rows.push(values.slice(index, index + size));
  }
  return rows;
}

export function formatCatalogFamilyOption(family: CatalogFamilyRecord): string {
  return `- #${family.id}: ${family.displayName}`;
}

export function formatCatalogGroupOption(group: CatalogGroupRecord): string {
  return `- #${group.id}: ${group.displayName}`;
}
