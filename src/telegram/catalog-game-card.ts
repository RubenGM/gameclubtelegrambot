import type { CatalogItemRecord, CatalogLoanRecord } from '../catalog/catalog-model.js';
import { escapeHtml, renderCatalogPlayerRange } from './catalog-presentation.js';
import { buildTelegramStartUrl } from './deep-links.js';
import type { BotLanguage } from './i18n.js';
import { translateCatalogTag } from './i18n-catalog-tags.js';
import { catalogGameComplexity, catalogGamePlayerCounts } from './catalog-game-metadata.js';

const labels = {
  ca: { complexity: 'Complexitat', best: 'Millor a', borrower: 'El té', position: 'Ubicació' },
  es: { complexity: 'Complejidad', best: 'Mejor a', borrower: 'Lo tiene', position: 'Ubicación' },
  en: { complexity: 'Complexity', best: 'Best with', borrower: 'Borrower', position: 'Location' },
} as const;

export function summarizeCatalogDescription(description: string | null, language: BotLanguage): string | null {
  const text = description?.replace(/\s+/gu, ' ').trim();
  if (!text) return null;
  let summary = '';
  for (const part of new Intl.Segmenter(language, { granularity: 'sentence' }).segment(text)) {
    summary += part.segment;
    if (summary.trim().length >= 45) break;
  }
  const characters = Array.from(summary.trim());
  if (characters.length <= 140) return summary.trim();
  const prefix = characters.slice(0, 139).join('');
  const boundary = prefix.lastIndexOf(' ');
  return `${(boundary > 100 ? prefix.slice(0, boundary) : prefix).trimEnd()}…`;
}

export function catalogGameTags(item: CatalogItemRecord, language: BotLanguage): string[] {
  const names = (value: unknown) => Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim())) : [];
  const selected = [...names(item.metadata?.categories).slice(0, 1), ...names(item.metadata?.mechanics).slice(0, 2)];
  return [...new Set(selected.map((tag) => translateCatalogTag(tag, language)))];
}

export function buildCatalogGameCard({ item, loan, borrowerName, language, startPayloadPrefix }: {
  item: CatalogItemRecord;
  loan: CatalogLoanRecord | null;
  borrowerName?: string;
  language: BotLanguage;
  startPayloadPrefix: string;
}): { html: string; fallbackText: string } {
  const texts = labels[language];
  const lines: string[] = [];
  const metrics: string[] = [];
  if (item.playerCountMin !== null || item.playerCountMax !== null) {
    const players = item.playerCountMin === item.playerCountMax ? String(item.playerCountMin) : renderCatalogPlayerRange(item.playerCountMin, item.playerCountMax, language);
    metrics.push(`👥 ${players}`);
  }
  if (item.playTimeMinutes !== null) metrics.push(`⏱ ${item.playTimeMinutes} min`);
  if (item.recommendedAge !== null) metrics.push(`${item.recommendedAge}+`);
  if (item.language) metrics.push(item.language);
  if (metrics.length) lines.push(metrics.join(' · '));
  const description = summarizeCatalogDescription(item.description, language);
  const tags = catalogGameTags(item, language);
  if (tags.length) lines.push(tags.join(' · '));
  const extra: string[] = [];
  const complexity = catalogGameComplexity(item, language);
  if (complexity) extra.push(`⚖ ${texts.complexity}: ${complexity}`);
  const bestCounts = catalogGamePlayerCounts(item, 'bestPlayerCounts');
  if (bestCounts.length) extra.push(`${texts.best}: ${bestCounts.join(', ')}`);
  if (extra.length) lines.push(extra.join(' · '));
  const location: string[] = [];
  if (loan) location.push(`🟠 ${texts.borrower}: ${borrowerName ?? loan.borrowerDisplayName}`);
  if (item.storagePosition) location.push(`${texts.position}: ${item.storagePosition}`);
  if (location.length) lines.push(location.join(' · '));
  const link = `<a href="${escapeHtml(buildTelegramStartUrl(`${startPayloadPrefix}${item.id}`))}"><b>${escapeHtml(item.displayName)}</b></a>`;
  return {
    html: `<p>${loan ? `<mark>${link}</mark>` : link}</p>${lines.length ? `<table compact>${lines.map((line) => `<tr><td>${escapeHtml(line)}</td></tr>`).join('')}</table>` : ''}${description ? `<p>${escapeHtml(description)}</p>` : ''}`,
    fallbackText: [`${loan ? '🟠 ' : ''}${link}`, ...lines.map(escapeHtml), ...(description ? [escapeHtml(description)] : [])].join('\n'),
  };
}
