import type {
  CatalogFamilyRecord,
  CatalogGroupRecord,
  CatalogItemRecord,
  CatalogMediaRecord,
  CatalogItemType,
} from '../catalog/catalog-model.js';
import { createTelegramI18n, normalizeBotLanguage, type BotLanguage } from './i18n.js';

export function renderCatalogItemType(itemType: CatalogItemType, language: BotLanguage = 'ca'): string {
  const texts = createTelegramI18n(normalizeBotLanguage(language, 'ca'));

  switch (itemType) {
    case 'board-game':
      return texts.catalogAdmin.typeBoardGame;
    case 'book':
      return texts.catalogAdmin.typeBook;
    case 'rpg-book':
      return texts.catalogAdmin.typeRpgBook;
    case 'accessory':
      return texts.catalogAdmin.typeAccessory;
    default:
      return itemType;
  }
}

export function renderCatalogPlayerRange(min: number | null, max: number | null, language: BotLanguage = 'ca'): string {
  if (min === null && max === null) {
    return createTelegramI18n(normalizeBotLanguage(language, 'ca')).catalogAdmin.noValue;
  }
  if (min !== null && max !== null) {
    return `${min}-${max}`;
  }
  return String(min ?? max);
}

export function renderCatalogOptionalObject(value: Record<string, unknown> | null, language: BotLanguage = 'ca'): string {
  return value ? JSON.stringify(value) : createTelegramI18n(normalizeBotLanguage(language, 'ca')).catalogAdmin.noValue;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatHtmlField(label: string, value: string): string {
  return `<b>${escapeHtml(label)}:</b> ${value}`;
}

export function formatCatalogDescriptionLine(
  itemType: CatalogItemType,
  description: string | null,
  language: BotLanguage = 'ca',
): string | null {
  if (!description) {
    return null;
  }

  const escaped = escapeHtml(description);
  if (itemType === 'book' || itemType === 'board-game') {
    return `<b>${createTelegramI18n(normalizeBotLanguage(language, 'ca')).catalogAdmin.description}:</b> <i>${escaped}</i>`;
  }

  return `${createTelegramI18n(normalizeBotLanguage(language, 'ca')).catalogAdmin.description}: ${escaped}`;
}

export function formatMemberCatalogOverview({
  families,
  groups,
  items,
  language = 'ca',
}: {
  families: CatalogFamilyRecord[];
  groups: CatalogGroupRecord[];
  items: CatalogItemRecord[];
  language?: BotLanguage;
}): string {
  const texts = createTelegramI18n(normalizeBotLanguage(language, 'ca'));
  const lines: string[] = [texts.catalogRead.available];
  const itemCountByFamily = new Map<number, number>();
  const itemCountByGroup = new Map<number, number>();

  for (const item of items) {
    if (item.familyId !== null) {
      itemCountByFamily.set(item.familyId, (itemCountByFamily.get(item.familyId) ?? 0) + 1);
    }
    if (item.groupId !== null) {
      itemCountByGroup.set(item.groupId, (itemCountByGroup.get(item.groupId) ?? 0) + 1);
    }
  }

  for (const family of families) {
    const groupCount = groups.filter((group) => group.familyId === family.id).length;
    const itemCount = itemCountByFamily.get(family.id) ?? 0;
      lines.push(`- ${family.displayName} · ${itemCount} ${texts.catalogRead.itemCount(itemCount)} · ${groupCount} ${texts.catalogRead.groupCount(groupCount)}`);
  }

  lines.push(`- ${texts.catalogRead.itemsWithoutFamilyGroup}: ${items.filter((item) => item.familyId === null && item.groupId === null).length}`);
  lines.push(texts.catalogRead.searchHint);
  return lines.join('\n');
}

export function formatMemberCatalogFamilyDetails({
  family,
  groups,
  items,
  language = 'ca',
}: {
  family: CatalogFamilyRecord;
  groups: CatalogGroupRecord[];
  items: CatalogItemRecord[];
  language?: BotLanguage;
}): string {
  const texts = createTelegramI18n(normalizeBotLanguage(language, 'ca'));
  const familyGroups = groups.filter((group) => group.familyId === family.id);
  const familyItems = items.filter((item) => item.familyId === family.id && item.groupId === null);

  return [
    `<b>${escapeHtml(family.displayName)}</b>`,
    formatHtmlField(texts.catalogAdmin.description, escapeHtml(family.description ?? texts.catalogAdmin.noDescription)),
    `<b>${texts.catalogAdmin.groups}:</b>`,
    ...(familyGroups.length > 0
      ? familyGroups.map((group) => `- ${escapeHtml(group.displayName)} · ${groupItemsLabel(items, group.id)}`)
      : [`- ${texts.catalogAdmin.noGroupAssigned}`]),
    `<b>${texts.catalogAdmin.itemsWithoutGroup}:</b>`,
    ...(familyItems.length > 0
      ? familyItems.map((item) => `- ${escapeHtml(item.displayName)} · ${renderCatalogItemType(item.itemType, language)}`)
      : [`- ${texts.catalogAdmin.noItemWithoutGroup}`]),
  ].join('\n');
}

export function formatMemberCatalogGroupDetails({
  group,
  family,
  items,
  language = 'ca',
}: {
  group: CatalogGroupRecord;
  family: CatalogFamilyRecord | null;
  items: CatalogItemRecord[];
  language?: BotLanguage;
}): string {
  const texts = createTelegramI18n(normalizeBotLanguage(language, 'ca'));
  const groupItems = items.filter((item) => item.groupId === group.id);

  return [
    `<b>${escapeHtml(group.displayName)}</b>`,
    formatHtmlField(texts.catalogAdmin.family, escapeHtml(family?.displayName ?? texts.catalogAdmin.noFamily)),
    formatHtmlField(texts.catalogAdmin.description, escapeHtml(group.description ?? texts.catalogAdmin.noDescription)),
    `<b>${texts.catalogAdmin.items}:</b>`,
    ...(groupItems.length > 0
      ? groupItems.map((item) => `- ${escapeHtml(item.displayName)} · ${renderCatalogItemType(item.itemType, language)}`)
      : [`- ${texts.catalogAdmin.noItemAssigned}`]),
  ].join('\n');
}

export function formatMemberCatalogItemDetails({
  item,
  family,
  group,
  media,
  availabilityLines = [],
  extraLines = [],
  language = 'ca',
}: {
  item: CatalogItemRecord;
  family: CatalogFamilyRecord | null;
  group: CatalogGroupRecord | null;
  media: CatalogMediaRecord[];
  availabilityLines?: string[];
  extraLines?: string[];
  language?: BotLanguage;
}): string {
  const texts = createTelegramI18n(normalizeBotLanguage(language, 'ca'));
  const mediaLines = media.length === 0
    ? []
    : [
      `${texts.catalogAdmin.media}: ${media.length} ${texts.catalogAdmin.mediaCount(media.length)}`,
      ...media.map((entry) => `- ${escapeHtml(entry.mediaType)} · ${escapeHtml(entry.url)}`),
    ];
  const descriptionLine = formatCatalogDescriptionLine(item.itemType, item.description, language);

  const detailLines = [
    ...(descriptionLine ? [descriptionLine] : []),
    ...(item.language ? [formatHtmlField(texts.catalogAdmin.language, escapeHtml(item.language))] : []),
    ...(item.publisher ? [formatHtmlField(texts.catalogAdmin.publisher, escapeHtml(item.publisher))] : []),
    ...(item.publicationYear !== null ? [formatHtmlField(texts.catalogAdmin.publicationYear, String(item.publicationYear))] : []),
    ...(item.itemType !== 'book' && item.itemType !== 'rpg-book' && (item.playerCountMin !== null || item.playerCountMax !== null)
      ? [formatHtmlField(texts.catalogAdmin.players, renderCatalogPlayerRange(item.playerCountMin, item.playerCountMax, language))]
      : []),
    ...(item.recommendedAge !== null ? [formatHtmlField(texts.catalogAdmin.recommendedAge, String(item.recommendedAge))] : []),
    ...(item.playTimeMinutes !== null ? [formatHtmlField(texts.catalogAdmin.playTimeMinutes, String(item.playTimeMinutes))] : []),
    ...extraLines,
  ];

  return [
    `<b>${escapeHtml(item.displayName)}</b>`,
    formatHtmlField(texts.catalogAdmin.type, renderCatalogItemType(item.itemType, language)),
    formatHtmlField(texts.catalogAdmin.family, escapeHtml(family?.displayName ?? texts.catalogAdmin.noFamily)),
    formatHtmlField(texts.catalogAdmin.group, escapeHtml(group?.displayName ?? texts.catalogAdmin.noGroup)),
    ...availabilityLines,
    ...detailLines,
    ...mediaLines,
  ].join('\n');
}

function groupItemsLabel(items: CatalogItemRecord[], groupId: number): string {
  const count = items.filter((item) => item.groupId === groupId).length;
  return `${count} item${count === 1 ? '' : 's'}`;
}
