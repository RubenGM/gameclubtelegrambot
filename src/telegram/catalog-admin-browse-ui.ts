import type { CatalogFamilyRecord, CatalogGroupRecord, CatalogItemRecord } from '../catalog/catalog-model.js';
import { escapeHtml, formatHtmlField } from './catalog-presentation.js';
import { createTelegramI18n } from './i18n.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

type CatalogAdminTexts = ReturnType<typeof createTelegramI18n>['catalogAdmin'];

export function formatCatalogAdminFamilyBrowseMessage({
  family,
  texts,
  groupSections,
  looseItemLines,
}: {
  family: CatalogFamilyRecord;
  texts: CatalogAdminTexts;
  groupSections: Array<{ group: CatalogGroupRecord; itemLines: string[] }>;
  looseItemLines: string[];
}): string {
  const lines = [
    `<b>Categoria:</b> ${escapeHtml(family.displayName)} (#${family.id})`,
    formatHtmlField(texts.description, escapeHtml(family.description ?? texts.noDescription)),
  ];

  for (const section of groupSections) {
    lines.push(`<b>${texts.group}:</b> ${escapeHtml(section.group.displayName)} (#${section.group.id})`);
    lines.push(...section.itemLines);
  }

  if (looseItemLines.length > 0) {
    lines.push('Items sense grup:');
    lines.push(...looseItemLines);
  }

  return lines.join('\n');
}

export function buildCatalogAdminBrowseFamilyKeyboard({
  itemRows,
  texts,
  browseSearchCallbackData,
  browseMenuCallbackData,
}: {
  itemRows: NonNullable<TelegramReplyOptions['inlineKeyboard']>;
  texts: CatalogAdminTexts;
  browseSearchCallbackData: string;
  browseMenuCallbackData: string;
}): NonNullable<TelegramReplyOptions['inlineKeyboard']> {
  return [
    ...itemRows,
    [{ text: texts.searchByName, callbackData: browseSearchCallbackData }],
    [{ text: texts.browseBack, callbackData: browseMenuCallbackData }],
  ];
}

export function formatCatalogAdminSearchResultsMessage(query: string, itemLines: string[]): string {
  return [`Resultats per a "${query}":`, ...itemLines].join('\n');
}

export function buildCatalogAdminBrowseSearchKeyboard({
  itemRows,
  browseBackText,
  browseMenuCallbackData,
}: {
  itemRows: NonNullable<TelegramReplyOptions['inlineKeyboard']>;
  browseBackText: string;
  browseMenuCallbackData: string;
}): NonNullable<TelegramReplyOptions['inlineKeyboard']> {
  return [
    ...itemRows,
    [{ text: browseBackText, callbackData: browseMenuCallbackData }],
  ];
}

export function formatCatalogAdminItemList({
  texts,
  families,
  groups,
  items,
  itemLines,
}: {
  texts: CatalogAdminTexts;
  families: CatalogFamilyRecord[];
  groups: CatalogGroupRecord[];
  items: CatalogItemRecord[];
  itemLines: Map<number, string>;
}): string {
  const familyNames = new Map(families.map((family) => [family.id, family.displayName]));
  const groupNames = new Map(groups.map((group) => [group.id, group.displayName]));
  const groupedItems = items.filter((item) => item.groupId !== null);
  const standaloneItems = items.filter((item) => item.groupId === null);
  const lines: string[] = [];

  for (const group of groups) {
    const groupItems = groupedItems.filter((item) => item.groupId === group.id);
    if (groupItems.length === 0) {
      continue;
    }
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(`${texts.group}: ${escapeHtml(group.displayName)} · ${escapeHtml(group.familyId ? familyNames.get(group.familyId) ?? texts.familyFallback.replace('{id}', String(group.familyId)) : texts.noFamily)}`);
    lines.push('------');
    lines.push('');
    for (const item of groupItems) {
      lines.push(itemLines.get(item.id) ?? `- ${item.displayName}`);
    }
  }

  const standaloneItemsWithFamily = standaloneItems.filter((item) => item.familyId !== null);
  const standaloneItemsWithoutFamily = standaloneItems.filter((item) => item.familyId === null);

  for (const family of families) {
    const familyItems = standaloneItemsWithFamily.filter((item) => item.familyId === family.id);
    if (familyItems.length === 0) {
      continue;
    }
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(`${texts.family}: ${escapeHtml(family.displayName)}`);
    lines.push('------');
    lines.push('');
    for (const item of familyItems) {
      lines.push(itemLines.get(item.id) ?? `- ${item.displayName}`);
    }
  }

  if (standaloneItemsWithoutFamily.length > 0) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(`${texts.noGroup}:`);
    lines.push('------');
    lines.push('');
    for (const item of standaloneItemsWithoutFamily) {
      lines.push(itemLines.get(item.id) ?? `- ${item.displayName}`);
    }
  }

  for (const item of groupedItems) {
    if (item.groupId !== null && !groupNames.has(item.groupId)) {
      if (lines.length > 0) {
        lines.push('');
      }
      lines.push(texts.groupUndefined.replace('{id}', String(item.groupId)));
      lines.push('------');
      lines.push('');
      lines.push(itemLines.get(item.id) ?? `- ${item.displayName}`);
    }
  }

  return lines.join('\n');
}

export function buildCatalogAdminSelectionKeyboard({
  items,
  mode,
  inspectKeyboard,
  editPrefix,
  deactivatePrefix,
}: {
  items: CatalogItemRecord[];
  mode: 'list' | 'edit' | 'deactivate';
  inspectKeyboard: NonNullable<TelegramReplyOptions['inlineKeyboard']>;
  editPrefix: string;
  deactivatePrefix: string;
}): NonNullable<TelegramReplyOptions['inlineKeyboard']> {
  if (mode === 'list') {
    return inspectKeyboard;
  }

  return items.map((item) => [{
    text: item.displayName,
    callbackData: mode === 'edit'
      ? `${editPrefix}${item.id}`
      : `${deactivatePrefix}${item.id}`,
  }]);
}
