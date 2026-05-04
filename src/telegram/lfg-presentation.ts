import type { LfgGroupAdRecord, LfgPlayerAdRecord } from '../lfg/lfg-catalog.js';
import { createTelegramI18n, type BotLanguage } from './i18n.js';
import { escapeHtml } from './schedule-presentation.js';

export function formatLfgPlayerAdListMessage({
  ads,
  language,
}: {
  ads: LfgPlayerAdRecord[];
  language: BotLanguage;
}): string {
  const texts = createTelegramI18n(language).lfg;
  return [texts.playersHeader, ...ads.map((ad) => `- ${formatPlayerAdInline(ad, language)}`)].join('\n');
}

export function formatLfgGroupAdListMessage({
  ads,
  language,
}: {
  ads: LfgGroupAdRecord[];
  language: BotLanguage;
}): string {
  const texts = createTelegramI18n(language).lfg;
  return [texts.groupsHeader, ...ads.map((ad) => `- ${formatGroupAdInline(ad, language)}`)].join('\n');
}

export function formatLfgMyAdsMessage({
  playerAds,
  groupAds,
  language,
}: {
  playerAds: LfgPlayerAdRecord[];
  groupAds: LfgGroupAdRecord[];
  language: BotLanguage;
}): string {
  const texts = createTelegramI18n(language).lfg;
  const lines: string[] = [texts.myAdsHeader];
  for (const ad of playerAds) {
    lines.push(`- ${formatPlayerAdInline(ad, language)}`);
  }
  for (const ad of groupAds) {
    lines.push(`- ${formatGroupAdInline(ad, language)}`);
  }
  return lines.join('\n');
}

export function formatLfgPlayerAdDetail({
  ad,
  language,
}: {
  ad: LfgPlayerAdRecord;
  language: BotLanguage;
}): string {
  const texts = createTelegramI18n(language).lfg;
  return [
    `<b>${escapeHtml(texts.playerAdLabel)}</b>`,
    `${texts.playerLabel}: ${formatTelegramUserLabel(ad.displayName, ad.username)}`,
    `${texts.descriptionLabel}: ${escapeHtml(ad.description)}`,
    `${texts.updatedLabel}: ${formatShortDate(ad.updatedAt)}`,
  ].join('\n');
}

export function formatLfgGroupAdDetail({
  ad,
  language,
}: {
  ad: LfgGroupAdRecord;
  language: BotLanguage;
}): string {
  const texts = createTelegramI18n(language).lfg;
  return [
    `<b>${escapeHtml(ad.title)}</b>`,
    `${texts.creatorLabel}: ${formatTelegramUserLabel(ad.creatorDisplayName, ad.creatorUsername)}`,
    `${texts.seatsLabel}: ${ad.seatsAvailable === null ? texts.noSeats : String(ad.seatsAvailable)}`,
    `${texts.descriptionLabel}: ${escapeHtml(ad.description)}`,
    `${texts.updatedLabel}: ${formatShortDate(ad.updatedAt)}`,
  ].join('\n');
}

export function formatLfgPlayerAdBroadcast({
  ad,
  language,
}: {
  ad: LfgPlayerAdRecord;
  language: BotLanguage;
}): string {
  const texts = createTelegramI18n(language).lfg;
  return [
    texts.playerBroadcastHeader,
    `<b>${escapeHtml(texts.playerAdLabel)}</b>`,
    `${texts.playerLabel}: ${formatTelegramUserLabel(ad.displayName, ad.username)}`,
    `${texts.descriptionLabel}: ${escapeHtml(ad.description)}`,
  ].join('\n');
}

export function formatLfgGroupAdBroadcast({
  ad,
  language,
}: {
  ad: LfgGroupAdRecord;
  language: BotLanguage;
}): string {
  const texts = createTelegramI18n(language).lfg;
  return [
    texts.groupBroadcastHeader,
    `<b>${escapeHtml(ad.title)}</b>`,
    `${texts.creatorLabel}: ${formatTelegramUserLabel(ad.creatorDisplayName, ad.creatorUsername)}`,
    `${texts.seatsLabel}: ${ad.seatsAvailable === null ? texts.noSeats : String(ad.seatsAvailable)}`,
    `${texts.descriptionLabel}: ${escapeHtml(ad.description)}`,
  ].join('\n');
}

export function formatLfgPlayerDraftSummary({
  description,
  displayName,
  language,
  isEdit = false,
}: {
  description: string;
  displayName: string;
  language: BotLanguage;
  isEdit?: boolean;
}): string {
  const texts = createTelegramI18n(language).lfg;
  return [
    isEdit ? texts.editPlayerSummaryHeader : texts.playerSummaryHeader,
    '',
    `${texts.playerLabel}: ${escapeHtml(displayName)}`,
    `${texts.descriptionLabel}: ${escapeHtml(description)}`,
  ].join('\n');
}

export function formatLfgGroupDraftSummary({
  title,
  description,
  seatsAvailable,
  creatorDisplayName,
  language,
  isEdit = false,
}: {
  title: string;
  description: string;
  seatsAvailable: number | null;
  creatorDisplayName: string;
  language: BotLanguage;
  isEdit?: boolean;
}): string {
  const texts = createTelegramI18n(language).lfg;
  return [
    isEdit ? texts.editGroupSummaryHeader : texts.groupSummaryHeader,
    '',
    `${texts.titleLabel}: ${escapeHtml(title)}`,
    `${texts.creatorLabel}: ${escapeHtml(creatorDisplayName)}`,
    `${texts.seatsLabel}: ${seatsAvailable === null ? texts.noSeats : String(seatsAvailable)}`,
    `${texts.descriptionLabel}: ${escapeHtml(description)}`,
  ].join('\n');
}

function formatPlayerAdInline(ad: LfgPlayerAdRecord, language: BotLanguage): string {
  const texts = createTelegramI18n(language).lfg;
  return `${formatTelegramUserLabel(ad.displayName, ad.username, { bold: true })} · ${escapeHtml(ad.description)} · ${texts.updatedLabel} ${formatShortDate(ad.updatedAt)}`;
}

function formatGroupAdInline(ad: LfgGroupAdRecord, language: BotLanguage): string {
  const texts = createTelegramI18n(language).lfg;
  const parts = [
    `<b>${escapeHtml(ad.title)}</b>`,
    `${texts.creatorLabel}: ${formatTelegramUserLabel(ad.creatorDisplayName, ad.creatorUsername)}`,
    ad.seatsAvailable === null ? texts.noSeats : `${texts.seatsLabel}: ${ad.seatsAvailable}`,
    escapeHtml(ad.description),
    `${texts.updatedLabel} ${formatShortDate(ad.updatedAt)}`,
  ];
  return parts.join(' · ');
}

function formatTelegramUserLabel(
  displayName: string,
  username: string | null,
  { bold = false }: { bold?: boolean } = {},
): string {
  const normalizedUsername = username?.trim().replace(/^@/, '');
  const visibleText = normalizedUsername ? `${displayName} (@${normalizedUsername})` : displayName;
  const escapedText = bold ? `<b>${escapeHtml(visibleText)}</b>` : escapeHtml(visibleText);

  if (!normalizedUsername || !/^[A-Za-z0-9_]{5,32}$/.test(normalizedUsername)) {
    return escapedText;
  }

  return `<a href="https://t.me/${escapeHtml(normalizedUsername)}">${escapedText}</a>`;
}

function formatShortDate(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
}
