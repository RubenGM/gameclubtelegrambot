import type { CatalogItemType } from '../catalog/catalog-model.js';
import {
  formatHtmlField,
  renderCatalogItemType,
  renderCatalogOptionalObject,
  renderCatalogPlayerRange,
} from './catalog-presentation.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';

const draftTextLimits = {
  name: 200,
  description: 1_200,
  shortText: 200,
  language: 80,
  structuredData: 350,
} as const;

export async function formatCatalogAdminDraftSummary({
  botLanguage,
  data,
  resolveFamilyName,
  resolveGroupName,
  itemTypeSupportsPlayers,
}: {
  botLanguage?: string;
  data: Record<string, unknown>;
  resolveFamilyName: (familyId: number | null) => Promise<string | null>;
  resolveGroupName: (groupId: number | null) => Promise<string | null>;
  itemTypeSupportsPlayers: (itemType: CatalogItemType) => boolean;
}): Promise<string> {
  const texts = createTelegramI18n(normalizeBotLanguage(botLanguage, 'ca')).catalogAdmin;
  const familyName = await resolveFamilyName(asNullableNumber(data.familyId));
  const groupName = await resolveGroupName(asNullableNumber(data.groupId));
  const itemType = String(data.itemType ?? 'board-game') as CatalogItemType;

  return [
    `<b>${texts.itemSummary}</b>`,
    formatHtmlField(texts.name, escapeHtmlPreview(String(data.displayName ?? ''), draftTextLimits.name)),
    formatHtmlField(texts.type, escapeHtml(renderCatalogItemType(itemType))),
    formatHtmlField(texts.family, escapeHtmlPreview(familyName ?? texts.noFamily, draftTextLimits.shortText)),
    formatHtmlField(texts.group, escapeHtmlPreview(groupName ?? texts.noGroup, draftTextLimits.shortText)),
    formatHtmlField(texts.editFieldOriginalName, escapeHtmlPreview(asNullableString(data.originalName) ?? texts.noValue, draftTextLimits.name)),
    formatHtmlField(texts.description, escapeHtmlPreview(asNullableString(data.description) ?? texts.noDescription, draftTextLimits.description)),
    formatHtmlField(texts.language, escapeHtmlPreview(asNullableString(data.language) ?? texts.noValue, draftTextLimits.language)),
    formatHtmlField(texts.publisher, escapeHtmlPreview(asNullableString(data.publisher) ?? texts.noValue, draftTextLimits.shortText)),
    formatHtmlField(texts.publicationYear, escapeHtml(String(asNullableNumber(data.publicationYear) ?? texts.noValue))),
    ...(itemTypeSupportsPlayers(itemType)
      ? [formatHtmlField(texts.players, escapeHtml(renderCatalogPlayerRange(asNullableNumber(data.playerCountMin), asNullableNumber(data.playerCountMax))))]
      : []),
    formatHtmlField(texts.recommendedAge, escapeHtml(String(asNullableNumber(data.recommendedAge) ?? texts.noValue))),
    formatHtmlField(texts.playTimeMinutes, escapeHtml(String(asNullableNumber(data.playTimeMinutes) ?? texts.noValue))),
    formatHtmlField(texts.editFieldExternalRefs, escapeHtmlPreview(renderCatalogOptionalObject(asNullableObject(data.externalRefs)), draftTextLimits.structuredData)),
    formatHtmlField(texts.editFieldMetadata, escapeHtmlPreview(renderCatalogOptionalObject(asNullableObject(data.metadata)), draftTextLimits.structuredData)),
  ].join('\n');
}

function escapeHtmlPreview(value: string, maxEscapedLength: number): string {
  let escaped = '';
  let truncated = false;

  for (const character of value) {
    const escapedCharacter = escapeHtml(character);
    if (escaped.length + escapedCharacter.length > maxEscapedLength - 1) {
      truncated = true;
      break;
    }
    escaped += escapedCharacter;
  }

  return truncated ? `${escaped}…` : escaped;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asNullableObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
