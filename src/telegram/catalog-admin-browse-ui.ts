import type { CatalogFamilyRecord, CatalogGroupRecord, CatalogItemRecord } from '../catalog/catalog-model.js';
import { escapeHtml, formatHtmlField } from './catalog-presentation.js';
import { buildTelegramStartUrl } from './deep-links.js';
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
    lines.push('Items sense grup:');
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
  return compactCatalogAdminMessage([`Resultats per a "${query}":`, ...itemLines]);
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
  items,
}: {
  texts: CatalogAdminTexts;
  families: CatalogFamilyRecord[];
  groups: CatalogGroupRecord[];
  items: CatalogItemRecord[];
  itemLines: Map<number, string>;
  browseLettersPrefix: string;
}): string {
  return compactCatalogAdminMessage(formatCatalogAdminInitialBuckets(items));
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
    visibleLines.push(`... ${omittedCount} lineas mas. Usa la busqueda o los botones para abrir un item concreto.`);
  }

  return visibleLines.join('\n');
}

function formatCatalogAdminInitialBuckets(items: CatalogItemRecord[]): string[] {
  return buildCatalogAdminInitialBuckets(items)
    .flatMap((initials) => {
      const href = buildTelegramStartUrl(`catalog_admin_letters_${serializeInitialSetForStartPayload(initials.initials.join(''))}`);
      return [
      `<a href="${escapeHtml(href)}"><b>${escapeHtml(initials.label)}</b></a>`,
      ...formatCatalogAdminTypeCounts(initials.items),
      '',
      ];
    })
    .slice(0, -1);
}

function buildCatalogAdminInitialBuckets(items: CatalogItemRecord[]): Array<{ initials: string[]; label: string; items: CatalogItemRecord[] }> {
  const buckets = new Map<string, CatalogItemRecord[]>();

  for (const item of items) {
    const initial = getCatalogAdminItemInitial(item);
    buckets.set(initial, [...(buckets.get(initial) ?? []), item]);
  }

  const sortedInitials = Array.from(buckets.keys()).sort((left, right) => left.localeCompare(right));
  return chunkArray(sortedInitials, 3).map((initials) => {
    const bucketItems = initials.flatMap((initial) => buckets.get(initial) ?? []);
    const label = `${initials.join(' ')} - ${bucketItems.length} ${bucketItems.length === 1 ? 'artículo' : 'artículos'}`;
    return { initials, label, items: bucketItems };
  });
}

function getCatalogAdminItemInitial(item: CatalogItemRecord): string {
  const first = item.displayName.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').at(0)?.toUpperCase() ?? '#';
  return /^[A-Z]$/.test(first) ? first : '#';
}

function serializeInitialSetForStartPayload(value: string): string {
  const normalized = Array.from(new Set(value.trim().toUpperCase().replace(/[^A-Z#]/g, '').split(''))).join('');
  if (normalized.startsWith('#')) {
    return `hash_${normalized.slice(1)}`;
  }

  return normalized;
}

function formatCatalogAdminTypeCounts(items: CatalogItemRecord[]): string[] {
  const boardGameCount = items.filter((item) => item.itemType === 'board-game' || item.itemType === 'expansion').length;
  const bookCount = items.filter((item) => item.itemType === 'book' || item.itemType === 'rpg-book').length;
  const accessoryCount = items.filter((item) => item.itemType === 'accessory').length;
  const lines: string[] = [];

  if (boardGameCount > 0) {
    lines.push(`${boardGameCount} ${boardGameCount === 1 ? 'juego de mesa' : 'juegos de mesa'}`);
  }
  if (bookCount > 0) {
    lines.push(`${bookCount} ${bookCount === 1 ? 'libro' : 'libros'}`);
  }
  if (accessoryCount > 0) {
    lines.push(`${accessoryCount} ${accessoryCount === 1 ? 'accesorio' : 'accesorios'}`);
  }

  return lines;
}

function chunkArray<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
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
