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
  const detailsLink = formatGroupPurchaseDetailsLink(purchase, language);
  if (detailsLink) {
    lines.push(detailsLink);
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

export function formatGroupPurchaseGroupAnnouncement({
  detail,
  language,
  heading = 'Nueva compra conjunta disponible:',
}: {
  detail: GroupPurchaseDetailRecord;
  language: BotLanguage;
  heading?: string;
}): string {
  const texts = createTelegramI18n(language).groupPurchases;
  const purchase = detail.purchase;
  return [
    heading,
    `<a href="${escapeHtml(buildTelegramStartUrl(`group_purchase_${purchase.id}`))}"><b>${escapeHtml(purchase.title)}</b></a>`,
    `${texts.modeLabel}: ${escapeHtml(formatModeLabel(purchase, language))}`,
    ...(formatGroupPurchaseDetailsLink(purchase, language) ? [formatGroupPurchaseDetailsLink(purchase, language)!] : []),
    ...formatSharedCostStatusLines(detail),
  ].join('\n');
}

export function formatGroupPurchaseParticipantUpdateMessage({
  detail,
  participantTelegramUserId,
  updateKind,
}: {
  detail: GroupPurchaseDetailRecord;
  participantTelegramUserId: number;
  updateKind: 'interested' | 'confirmed' | 'removed';
}): string {
  const participant = detail.participants.find((entry) => entry.participantTelegramUserId === participantTelegramUserId);
  const participantName = participant?.participantDisplayName ?? `Usuario ${participantTelegramUserId}`;
  const updateLine = updateKind === 'interested'
    ? `${participantName} se ha apuntado, a falta de confirmación`
    : updateKind === 'confirmed'
      ? `${participantName} ha confirmado su participación`
      : `${participantName} se ha echado atrás`;

  return [
    `<a href="${escapeHtml(buildTelegramStartUrl(`group_purchase_${detail.purchase.id}`))}"><b>${escapeHtml(detail.purchase.title)}</b></a>`,
    escapeHtml(updateLine),
    ...(formatGroupPurchaseDetailsLink(detail.purchase, 'es') ? [formatGroupPurchaseDetailsLink(detail.purchase, 'es')!] : []),
    ...formatSharedCostStatusLines(detail),
  ].join('\n');
}

export function hasGroupPurchaseDetailsMessage(purchase: GroupPurchaseRecord): boolean {
  return purchase.detailsMessageChatId !== null && purchase.detailsMessageId !== null;
}

function formatGroupPurchaseDetailsLink(purchase: GroupPurchaseRecord, language: BotLanguage): string | null {
  if (!hasGroupPurchaseDetailsMessage(purchase)) {
    return null;
  }
  return `<a href="${escapeHtml(buildTelegramStartUrl(`group_purchase_details_${purchase.id}`))}">${escapeHtml(resolveDetailsLinkLabel(language))}</a>`;
}

function resolveDetailsLinkLabel(language: BotLanguage): string {
  if (language === 'en') return 'Open description';
  if (language === 'ca') return 'Obrir descripció';
  return 'Abrir descripción';
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

function formatSharedCostStatusLines(detail: GroupPurchaseDetailRecord): string[] {
  if (detail.purchase.purchaseMode !== 'shared_cost') {
    return [];
  }

  const confirmedCount = detail.participants.filter((participant) =>
    participant.status === 'confirmed' ||
    participant.status === 'paid' ||
    participant.status === 'delivered'
  ).length;
  const currentCost = detail.purchase.totalPriceCents !== null && confirmedCount > 0
    ? formatEuroAmountSymbol(detail.purchase.totalPriceCents / confirmedCount)
    : 'pendiente de confirmaciones';
  const totalCost = detail.purchase.totalPriceCents !== null
    ? formatEuroAmountSymbol(detail.purchase.totalPriceCents)
    : 'pendiente de definir';

  return [
    `Coste total: ${totalCost}`,
    `Coste actual por persona: ${currentCost}`,
    `Usuarios confirmados actualmente: ${confirmedCount}`,
  ];
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

function formatEuroAmountSymbol(cents: number): string {
  return `${(cents / 100).toFixed(2).replace('.', ',')}€`;
}
