import type { GroupPurchaseDetailRecord, GroupPurchaseRecord } from '../group-purchases/group-purchase-catalog.js';
import { buildTelegramStartUrl } from './deep-links.js';
import { createTelegramI18n, type BotLanguage } from './i18n.js';
import { escapeHtml } from './schedule-presentation.js';

export function formatGroupPurchaseListMessage({
  purchases,
  language,
}: {
  purchases: GroupPurchaseRecord[];
  language: BotLanguage;
}): string {
  const texts = createTelegramI18n(language).groupPurchases;
  return [texts.listHeader, ...purchases.map((purchase) => `- ${formatGroupPurchaseListEntry(purchase, language)}`)].join('\n');
}

export function formatGroupPurchaseDetailMessage({
  detail,
  language,
}: {
  detail: GroupPurchaseDetailRecord;
  language: BotLanguage;
}): string {
  const texts = createTelegramI18n(language).groupPurchases;
  const purchase = detail.purchase;
  const lines = [
    `<a href="${escapeHtml(buildTelegramStartUrl(`group_purchase_${purchase.id}`))}"><b>${escapeHtml(purchase.title)}</b></a>`,
    `${texts.modeLabel}: ${formatModeLabel(purchase, language)}`,
    `${texts.statusLabel}: ${formatStatusLabel(purchase, language)}`,
  ];

  if (purchase.description) {
    lines.push(`${texts.descriptionLabel}: ${escapeHtml(purchase.description)}`);
  }
  if (purchase.unitPriceCents !== null) {
    lines.push(`${texts.unitPriceLabel}: ${formatEuroAmount(purchase.unitPriceCents)}`);
  }
  if (purchase.unitLabel) {
    lines.push(`${texts.unitLabelTitle}: ${escapeHtml(purchase.unitLabel)}`);
  }
  if (purchase.joinDeadlineAt) {
    lines.push(`${texts.joinDeadlineLabel}: ${formatShortDate(purchase.joinDeadlineAt)}`);
  }

  return lines.join('\n');
}

function formatGroupPurchaseListEntry(purchase: GroupPurchaseRecord, language: BotLanguage): string {
  const texts = createTelegramI18n(language).groupPurchases;
  const parts = [
    `<a href="${escapeHtml(buildTelegramStartUrl(`group_purchase_${purchase.id}`))}"><b>${escapeHtml(purchase.title)}</b></a>`,
    formatStatusLabel(purchase, language),
  ];

  if (purchase.joinDeadlineAt) {
    parts.push(`${texts.joinDeadlineShort} ${formatShortDate(purchase.joinDeadlineAt)}`);
  }

  return parts.join(' · ');
}

function formatStatusLabel(purchase: GroupPurchaseRecord, language: BotLanguage): string {
  const texts = createTelegramI18n(language).groupPurchases;

  if (purchase.lifecycleStatus === 'open') return texts.statusOpen;
  if (purchase.lifecycleStatus === 'closed') return texts.statusClosed;
  if (purchase.lifecycleStatus === 'archived') return texts.statusArchived;
  return texts.statusCancelled;
}

function formatModeLabel(purchase: GroupPurchaseRecord, language: BotLanguage): string {
  const texts = createTelegramI18n(language).groupPurchases;
  return purchase.purchaseMode === 'per_item' ? texts.modePerItem : texts.modeSharedCost;
}

function formatShortDate(iso: string): string {
  const date = new Date(iso);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

function formatEuroAmount(cents: number): string {
  return `${(cents / 100).toFixed(2)} EUR`;
}
