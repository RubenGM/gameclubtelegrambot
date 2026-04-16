import type { CatalogGroupRecord, CatalogItemRecord, CatalogItemType, CatalogMediaRecord } from '../catalog/catalog-model.js';
import {
  escapeHtml,
  formatCatalogDescriptionLine,
  formatHtmlField,
  renderCatalogItemType,
  renderCatalogOptionalObject,
  renderCatalogPlayerRange,
} from './catalog-presentation.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';

export function formatCatalogAdminItemDetails({
  botLanguage,
  item,
  familyName,
  groupName,
  media,
  loanAvailabilityLines,
  itemTypeSupportsPlayers,
}: {
  botLanguage?: string;
  item: CatalogItemRecord;
  familyName: string | null;
  groupName: string | null;
  media: CatalogMediaRecord[];
  loanAvailabilityLines: string[];
  itemTypeSupportsPlayers: (itemType: CatalogItemType) => boolean;
}): string {
  const texts = createTelegramI18n(normalizeBotLanguage(botLanguage, 'ca')).catalogAdmin;
  const mediaLines = media.length === 0
    ? []
    : [
      formatHtmlField(texts.media, `${media.length} ${texts.mediaCount(media.length)}`),
      ...media.map((entry) => `- #${entry.id}: ${escapeHtml(entry.mediaType)} · ${escapeHtml(entry.url)}`),
    ];
  const descriptionLine = formatCatalogDescriptionLine(item.itemType, item.description);

  return [
    `<b>${escapeHtml(item.displayName)}</b> (#${item.id})`,
    formatHtmlField(texts.type, renderCatalogItemType(item.itemType)),
    ...(familyName ? [formatHtmlField(texts.family, escapeHtml(familyName))] : []),
    formatHtmlField(texts.group, escapeHtml(groupName ?? texts.noGroup)),
    ...loanAvailabilityLines,
    ...(item.originalName ? [formatHtmlField(texts.editFieldOriginalName, escapeHtml(item.originalName))] : []),
    ...(descriptionLine ? [descriptionLine] : []),
    ...(item.language ? [formatHtmlField(texts.language, escapeHtml(item.language))] : []),
    ...(item.publisher ? [formatHtmlField(texts.publisher, escapeHtml(item.publisher))] : []),
    ...(item.publicationYear !== null ? [formatHtmlField(texts.publicationYear, String(item.publicationYear))] : []),
    ...(itemTypeSupportsPlayers(item.itemType) && (item.playerCountMin !== null || item.playerCountMax !== null)
      ? [formatHtmlField(texts.players, renderCatalogPlayerRange(item.playerCountMin, item.playerCountMax))]
      : []),
    ...(item.recommendedAge !== null ? [formatHtmlField(texts.recommendedAge, String(item.recommendedAge))] : []),
    ...(item.playTimeMinutes !== null ? [formatHtmlField(texts.playTimeMinutes, String(item.playTimeMinutes))] : []),
    ...(item.externalRefs ? [`${texts.editFieldExternalRefs}: ${escapeHtml(renderCatalogOptionalObject(item.externalRefs))}`] : []),
    ...(item.metadata ? [`${texts.editFieldMetadata}: ${escapeHtml(renderCatalogOptionalObject(item.metadata))}`] : []),
    ...mediaLines,
    formatHtmlField(texts.status, item.lifecycleStatus),
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
    '<b>Items:</b>',
    ...(itemLines.length > 0 ? itemLines : ['- Cap item assignat']),
  ].join('\n');
}
