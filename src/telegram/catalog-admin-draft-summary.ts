import type { CatalogItemType } from '../catalog/catalog-model.js';
import {
  formatHtmlField,
  renderCatalogItemType,
  renderCatalogOptionalObject,
  renderCatalogPlayerRange,
} from './catalog-presentation.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';

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
    formatHtmlField(texts.name, escapeHtml(String(data.displayName ?? ''))),
    formatHtmlField(texts.type, escapeHtml(renderCatalogItemType(itemType))),
    formatHtmlField(texts.family, escapeHtml(familyName ?? texts.noFamily)),
    formatHtmlField(texts.group, escapeHtml(groupName ?? texts.noGroup)),
    formatHtmlField(texts.editFieldOriginalName, escapeHtml(asNullableString(data.originalName) ?? texts.noValue)),
    formatHtmlField(texts.description, escapeHtml(asNullableString(data.description) ?? texts.noDescription)),
    formatHtmlField(texts.language, escapeHtml(asNullableString(data.language) ?? texts.noValue)),
    formatHtmlField(texts.publisher, escapeHtml(asNullableString(data.publisher) ?? texts.noValue)),
    formatHtmlField(texts.publicationYear, escapeHtml(String(asNullableNumber(data.publicationYear) ?? texts.noValue))),
    ...(itemTypeSupportsPlayers(itemType)
      ? [formatHtmlField(texts.players, escapeHtml(renderCatalogPlayerRange(asNullableNumber(data.playerCountMin), asNullableNumber(data.playerCountMax))))]
      : []),
    formatHtmlField(texts.recommendedAge, escapeHtml(String(asNullableNumber(data.recommendedAge) ?? texts.noValue))),
    formatHtmlField(texts.playTimeMinutes, escapeHtml(String(asNullableNumber(data.playTimeMinutes) ?? texts.noValue))),
    formatHtmlField(texts.editFieldExternalRefs, escapeHtml(renderCatalogOptionalObject(asNullableObject(data.externalRefs)))),
    formatHtmlField(texts.editFieldMetadata, escapeHtml(renderCatalogOptionalObject(asNullableObject(data.metadata)))),
  ].join('\n');
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
