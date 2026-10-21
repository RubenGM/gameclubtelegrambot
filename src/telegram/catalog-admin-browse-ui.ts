import type { CatalogFamilyRecord, CatalogGroupRecord, CatalogItemRecord } from '../catalog/catalog-model.js';
import { escapeHtml, formatHtmlField } from './catalog-presentation.js';
import { createTelegramI18n } from './i18n.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

type CatalogAdminTexts = ReturnType<typeof createTelegramI18n>['catalogAdmin'];
const catalogAdminMessageSoftLimit = 3500;

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
    lines.push('Ítems sense grup:');
    lines.push(...looseItemLines);
  }

  return compactCatalogAdminMessage(lines);
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
  return compactCatalogAdminMessage([`<b>Resultats per a "${escapeHtml(query)}":</b>`, ...itemLines]);
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

function compactCatalogAdminMessage(lines: string[]): string {
  const visibleLines: string[] = [];
  let currentLength = 0;

  for (const line of lines) {
    const nextLength = currentLength + line.length + (visibleLines.length > 0 ? 1 : 0);
    if (nextLength > catalogAdminMessageSoftLimit) {
      break;
    }

    visibleLines.push(line);
    currentLength = nextLength;
  }

  const omittedCount = lines.length - visibleLines.length;
  if (omittedCount > 0) {
    visibleLines.push('');
    visibleLines.push(`... ${omittedCount} líneas más. Usa la búsqueda o los botones para abrir un ítem concreto.`);
  }

  return visibleLines.join('\n');
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
