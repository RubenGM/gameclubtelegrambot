import type { CatalogGroupRecord, CatalogItemRecord, CatalogItemType, CatalogMediaRecord } from '../catalog/catalog-model.js';
import {
  escapeHtml,
  formatCatalogDescriptionLine,
  formatHtmlField,
  renderCatalogItemType,
  renderCatalogPlayerRange,
} from './catalog-presentation.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';

export function formatCatalogAdminItemDetails({
  breadcrumbLine,
  botLanguage,
  item,
  familyName,
  groupName,
  media,
  loanAvailabilityLines,
  ownerLine,
  itemTypeSupportsPlayers,
  footerLines = [],
}: {
  breadcrumbLine?: string | null;
  botLanguage?: string;
  item: CatalogItemRecord;
  familyName: string | null;
  groupName: string | null;
  media: CatalogMediaRecord[];
  loanAvailabilityLines: string[];
  ownerLine?: string | null;
  itemTypeSupportsPlayers: (itemType: CatalogItemType) => boolean;
  footerLines?: string[];
}): string {
  const language = normalizeBotLanguage(botLanguage, 'ca');
  const texts = createTelegramI18n(language).catalogAdmin;
  const mediaLines = media.length === 0
    ? []
    : [
      formatHtmlField(texts.media, `${media.length} ${texts.mediaCount(media.length)}`),
      ...media.map((entry) => `- #${entry.id}: ${escapeHtml(entry.mediaType)} · ${escapeHtml(entry.url)}`),
    ];
  const descriptionLine = formatCatalogDescriptionLine(item.itemType, item.description, language);
  const originalNameLine = item.originalName && item.originalName !== item.displayName
    ? [formatHtmlField(texts.editFieldOriginalName, escapeHtml(item.originalName))]
    : [];

  return [
    ...(breadcrumbLine ? [breadcrumbLine] : []),
    `<b>${escapeHtml(item.displayName)}</b> (#${item.id})`,
    '',
    formatHtmlField(texts.type, renderCatalogItemType(item.itemType, language)),
    ...(familyName ? [formatHtmlField(texts.family, escapeHtml(familyName))] : []),
    ...(groupName ? [formatHtmlField(texts.group, escapeHtml(groupName))] : []),
    ...(ownerLine ? [ownerLine] : []),
    ...loanAvailabilityLines,
    ...originalNameLine,
    ...(descriptionLine ? [descriptionLine] : []),
    ...(item.language ? [formatHtmlField(texts.language, escapeHtml(item.language))] : []),
    ...(item.publisher ? [formatHtmlField(texts.publisher, escapeHtml(item.publisher))] : []),
    ...(item.publicationYear !== null ? [formatHtmlField(texts.publicationYear, String(item.publicationYear))] : []),
    ...(itemTypeSupportsPlayers(item.itemType) && (item.playerCountMin !== null || item.playerCountMax !== null)
      ? [formatHtmlField(texts.players, renderCatalogPlayerRange(item.playerCountMin, item.playerCountMax, language))]
      : []),
    ...(item.recommendedAge !== null ? [formatHtmlField(texts.recommendedAge, String(item.recommendedAge))] : []),
    ...(item.playTimeMinutes !== null ? [formatHtmlField(texts.playTimeMinutes, String(item.playTimeMinutes))] : []),
    ...mediaLines,
    formatHtmlField(texts.status, item.lifecycleStatus),
    ...footerLines,
  ].join('\n');
}

export function formatCatalogAdminGroupDetails({
  botLanguage,
  group,
  familyName,
  itemLines,
}: {
  botLanguage?: string;
  group: CatalogGroupRecord;
  familyName: string | null;
  itemLines: string[];
}): string {
  const texts = createTelegramI18n(normalizeBotLanguage(botLanguage, 'ca')).catalogAdmin;

  return [
    `<b>${escapeHtml(group.displayName)}</b>`,
    formatHtmlField(texts.family, escapeHtml(familyName ?? texts.noFamily)),
    formatHtmlField(texts.description, escapeHtml(group.description ?? texts.noDescription)),
    '<b>Ítems:</b>',
    ...(itemLines.length > 0 ? itemLines : ['- Cap ítem assignat']),
  ].join('\n');
}
