import type { CatalogLoanRecord, CatalogItemRecord } from '../catalog/catalog-model.js';
import { buildTelegramStartUrl } from './deep-links.js';
import { escapeHtml, renderCatalogItemType } from './catalog-presentation.js';

export function formatCatalogLoanSummary({
  borrowerDisplayName,
  loan,
}: {
  borrowerDisplayName: string;
  loan: CatalogLoanRecord;
}): string {
  const parts = [`Prestat a ${borrowerDisplayName}`, `des de ${formatDateLabel(loan.createdAt)}`];
  if (loan.dueAt) {
    parts.push(`fins ${formatDateLabel(loan.dueAt)}`);
  }
  return parts.join(' · ');
}

export function formatCatalogItemSummaryLine({
  item,
  loanSummary,
  extraSuffix,
}: {
  item: CatalogItemRecord;
  loanSummary?: string | null;
  extraSuffix?: string | null;
}): string {
  const parts = [`- ${item.displayName} (#${item.id})`, renderCatalogItemType(item.itemType)];
  if (extraSuffix) {
    parts.push(extraSuffix);
  }
  if (loanSummary) {
    parts.push(loanSummary);
  }
  return parts.join(' · ');
}

export function formatCatalogBrowseItemLine({
  item,
  loanBorrowerDisplayName,
  loanCreatedAt,
  fallbackAvailability,
  omitTypeLabel = false,
  availableLabel,
  startPayloadPrefix,
}: {
  item: CatalogItemRecord;
  loanBorrowerDisplayName?: string;
  loanCreatedAt?: string;
  fallbackAvailability?: string;
  omitTypeLabel?: boolean;
  availableLabel: string;
  startPayloadPrefix: string;
}): string {
  const typeLabel = omitTypeLabel ? null : escapeHtml(renderCatalogItemType(item.itemType));
  const availability = loanBorrowerDisplayName && loanCreatedAt
    ? `<i>${[typeLabel, `Prestat a ${escapeHtml(loanBorrowerDisplayName)}`, `des de ${escapeHtml(formatCatalogListDate(loanCreatedAt))}`].filter(Boolean).join(' · ')}</i>`
    : `<i>${[typeLabel, escapeHtml(fallbackAvailability === 'Disponible' ? availableLabel : (fallbackAvailability ?? availableLabel))].filter(Boolean).join(' · ')}</i>`;
  return `- <a href="${escapeHtml(buildCatalogAdminItemDeepLink(item.id, startPayloadPrefix))}"><b>${escapeHtml(item.displayName)}</b></a>${availability ? ` · ${availability}` : ''}`;
}

export function buildCatalogAdminItemDeepLink(itemId: number, startPayloadPrefix: string): string {
  return buildTelegramStartUrl(`${startPayloadPrefix}${itemId}`);
}

export function parseCatalogAdminStartPayload(messageText: string | undefined, startPayloadPrefix: string): number | null {
  const payload = messageText?.trim().split(/\s+/).slice(1).join(' ');
  if (!payload || !payload.startsWith(startPayloadPrefix)) {
    return null;
  }

  const value = Number(payload.slice(startPayloadPrefix.length));
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

export function formatCatalogListDate(value: string): string {
  return new Intl.DateTimeFormat('ca-ES', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value));
}

function formatDateLabel(value: string): string {
  return value.slice(0, 10).split('-').reverse().join('/');
}
