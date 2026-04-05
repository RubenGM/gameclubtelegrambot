import type {
  CatalogFamilyRecord,
  CatalogGroupRecord,
  CatalogItemRecord,
  CatalogMediaRecord,
  CatalogItemType,
} from '../catalog/catalog-model.js';

export function renderCatalogItemType(itemType: CatalogItemType): string {
  switch (itemType) {
    case 'board-game':
      return 'Joc de taula';
    case 'expansion':
      return 'Expansio';
    case 'book':
      return 'Llibre';
    case 'rpg-book':
      return 'Llibre RPG';
    case 'accessory':
      return 'Accessori';
  }
}

export function renderCatalogPlayerRange(min: number | null, max: number | null): string {
  if (min === null && max === null) {
    return 'Sense valor';
  }
  if (min !== null && max !== null) {
    return `${min}-${max}`;
  }
  return String(min ?? max);
}

export function renderCatalogOptionalObject(value: Record<string, unknown> | null): string {
  return value ? JSON.stringify(value) : 'Sense valor';
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

export function formatCatalogDescriptionLine(itemType: CatalogItemType, description: string | null): string | null {
  if (!description) {
    return null;
  }

  const escaped = escapeHtml(description);
  if (itemType === 'book' || itemType === 'board-game') {
    return `<b>Descripcio:</b> <i>${escaped}</i>`;
  }

  return `Descripcio: ${escaped}`;
}

export function formatMemberCatalogOverview({
  families,
  groups,
  items,
}: {
  families: CatalogFamilyRecord[];
  groups: CatalogGroupRecord[];
  items: CatalogItemRecord[];
}): string {
  const lines = ['Cataleg disponible:'];
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
    lines.push(`- ${family.displayName} · ${itemCount} item${itemCount === 1 ? '' : 's'} · ${groupCount} grup${groupCount === 1 ? '' : 's'}`);
  }

  lines.push(`- Items sense familia ni grup: ${items.filter((item) => item.familyId === null && item.groupId === null).length}`);
  lines.push('Fes servir /catalog_search <text> per cercar un item concret.');
  return lines.join('\n');
}

export function formatMemberCatalogFamilyDetails({
  family,
  groups,
  items,
}: {
  family: CatalogFamilyRecord;
  groups: CatalogGroupRecord[];
  items: CatalogItemRecord[];
}): string {
  const familyGroups = groups.filter((group) => group.familyId === family.id);
  const familyItems = items.filter((item) => item.familyId === family.id && item.groupId === null);

  return [
    `<b>${escapeHtml(family.displayName)}</b>`,
    formatHtmlField('Descripcio', escapeHtml(family.description ?? 'Sense descripcio')),
    '<b>Grups:</b>',
    ...(familyGroups.length > 0
      ? familyGroups.map((group) => `- ${escapeHtml(group.displayName)} · ${groupItemsLabel(items, group.id)}`)
      : ['- Cap grup assignat']),
    '<b>Items sense grup:</b>',
    ...(familyItems.length > 0
      ? familyItems.map((item) => `- ${escapeHtml(item.displayName)} · ${renderCatalogItemType(item.itemType)}`)
      : ['- Cap item sense grup']),
  ].join('\n');
}

export function formatMemberCatalogGroupDetails({
  group,
  family,
  items,
}: {
  group: CatalogGroupRecord;
  family: CatalogFamilyRecord | null;
  items: CatalogItemRecord[];
}): string {
  const groupItems = items.filter((item) => item.groupId === group.id);

  return [
    `<b>${escapeHtml(group.displayName)}</b>`,
    formatHtmlField('Familia', escapeHtml(family?.displayName ?? 'Sense familia')),
    formatHtmlField('Descripcio', escapeHtml(group.description ?? 'Sense descripcio')),
    '<b>Items:</b>',
    ...(groupItems.length > 0
      ? groupItems.map((item) => `- ${escapeHtml(item.displayName)} · ${renderCatalogItemType(item.itemType)}`)
      : ['- Cap item assignat']),
  ].join('\n');
}

export function formatMemberCatalogItemDetails({
  item,
  family,
  group,
  media,
  availabilityLines = [],
  extraLines = [],
}: {
  item: CatalogItemRecord;
  family: CatalogFamilyRecord | null;
  group: CatalogGroupRecord | null;
  media: CatalogMediaRecord[];
  availabilityLines?: string[];
  extraLines?: string[];
}): string {
  const mediaLines = media.length === 0
    ? []
    : [
      `Media: ${media.length} element${media.length === 1 ? '' : 's'}`,
      ...media.map((entry) => `- ${escapeHtml(entry.mediaType)} · ${escapeHtml(entry.url)}`),
    ];
  const descriptionLine = formatCatalogDescriptionLine(item.itemType, item.description);

  const detailLines = [
    ...(descriptionLine ? [descriptionLine] : []),
    ...(item.language ? [formatHtmlField('Llengua', escapeHtml(item.language))] : []),
    ...(item.publisher ? [formatHtmlField('Editorial', escapeHtml(item.publisher))] : []),
    ...(item.publicationYear !== null ? [formatHtmlField('Any publicacio', String(item.publicationYear))] : []),
    ...(item.itemType !== 'book' && item.itemType !== 'rpg-book' && (item.playerCountMin !== null || item.playerCountMax !== null)
      ? [formatHtmlField('Jugadors', renderCatalogPlayerRange(item.playerCountMin, item.playerCountMax))]
      : []),
    ...(item.recommendedAge !== null ? [formatHtmlField('Edat recomanada', String(item.recommendedAge))] : []),
    ...(item.playTimeMinutes !== null ? [formatHtmlField('Durada', String(item.playTimeMinutes))] : []),
    ...extraLines,
  ];

  return [
    `<b>${escapeHtml(item.displayName)}</b>`,
    formatHtmlField('Tipus', renderCatalogItemType(item.itemType)),
    formatHtmlField('Familia', escapeHtml(family?.displayName ?? 'Sense familia')),
    formatHtmlField('Grup', escapeHtml(group?.displayName ?? 'Sense grup')),
    ...availabilityLines,
    ...detailLines,
    ...mediaLines,
  ].join('\n');
}

function groupItemsLabel(items: CatalogItemRecord[], groupId: number): string {
  const count = items.filter((item) => item.groupId === groupId).length;
  return `${count} item${count === 1 ? '' : 's'}`;
}
