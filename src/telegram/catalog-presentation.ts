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

  lines.push(`- Items: ${items.length}`);
  lines.push(escapeHtml(texts.catalogRead.searchHint));
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
  const nestedItemCount = items.filter((item) => item.familyId === family.id).length;

  return [
    `<b>${escapeHtml(family.displayName)}</b>`,
    formatHtmlField(texts.catalogAdmin.description, escapeHtml(family.description ?? texts.catalogAdmin.noDescription)),
    formatHtmlField(texts.catalogAdmin.groups, `${familyGroups.length} ${texts.catalogRead.groupCount(familyGroups.length)}`),
    formatHtmlField(texts.catalogAdmin.items, `${nestedItemCount} ${texts.catalogRead.itemCount(nestedItemCount)}`),
    formatHtmlField(texts.catalogAdmin.itemsWithoutGroup, `${familyItems.length} ${texts.catalogRead.itemCount(familyItems.length)}`),
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
    formatHtmlField(texts.catalogAdmin.items, `${groupItems.length} ${texts.catalogRead.itemCount(groupItems.length)}`),
  ].join('\n');
}

export function formatMemberCatalogItemDetails({
  breadcrumbLine,
  item,
  family,
  group,
  media,
  availabilityLines = [],
  extraLines = [],
  language = 'ca',
}: {
  breadcrumbLine?: string | null;
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
    ...(breadcrumbLine ? [breadcrumbLine] : []),
    `<b>${escapeHtml(item.displayName)}</b>`,
    '',
    formatHtmlField(texts.catalogAdmin.type, renderCatalogItemType(item.itemType, language)),
    ...(family ? [formatHtmlField(texts.catalogAdmin.family, escapeHtml(family.displayName))] : []),
    ...(group ? [formatHtmlField(texts.catalogAdmin.group, escapeHtml(group.displayName))] : []),
    ...availabilityLines,
    ...detailLines,
    ...mediaLines,
  ].join('\n');
}
