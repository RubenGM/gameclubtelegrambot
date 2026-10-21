import type { CatalogItemRecord, CatalogLoanRecord } from '../catalog/catalog-model.js';
import { escapeHtml, renderCatalogPlayerRange } from './catalog-presentation.js';
import { buildTelegramStartUrl } from './deep-links.js';
import { createTelegramI18n, type BotLanguage } from './i18n.js';
import { translateCatalogTag } from './i18n-catalog-tags.js';
import { renderTelegramRichDetailTable } from './rich-detail-message.js';

const labels = {
  ca: { complexity: 'Complexitat', best: 'Millor a', borrower: 'El té', position: 'Ubicació', style: 'Estil', age: 'Edat' },
  es: { complexity: 'Complejidad', best: 'Mejor a', borrower: 'Lo tiene', position: 'Ubicación', style: 'Estilo', age: 'Edad' },
  en: { complexity: 'Complexity', best: 'Best with', borrower: 'Borrower', position: 'Location', style: 'Style', age: 'Age' },
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
  const admin = createTelegramI18n(language).catalogAdmin;
  const rows: Array<{ labelHtml: string; valueHtml: string }> = [];
  const lines: string[] = [];
  const add = (label: string, value: string) => {
    rows.push({ labelHtml: escapeHtml(`${label}:`), valueHtml: escapeHtml(value) });
    lines.push(`<b>${escapeHtml(label)}:</b> ${escapeHtml(value)}`);
  };
  if (item.playerCountMin !== null || item.playerCountMax !== null) {
    const players = item.playerCountMin === item.playerCountMax ? String(item.playerCountMin) : renderCatalogPlayerRange(item.playerCountMin, item.playerCountMax, language);
    add(admin.players, players);
  }
  if (item.playTimeMinutes !== null) add(admin.playTimeMinutes, `${item.playTimeMinutes} min`);
  if (item.recommendedAge !== null) add(texts.age, `${item.recommendedAge}+`);
  if (item.language) add(admin.language, item.language);
  const description = summarizeCatalogDescription(item.description, language);
  if (description) add(admin.description, description);
  const tags = catalogGameTags(item, language);
  if (tags.length) add(texts.style, tags.join(' · '));
  const weight = item.metadata?.averageWeight;
  if (typeof weight === 'number' && Number.isFinite(weight) && weight >= 1 && weight <= 5) {
    add(texts.complexity, `${new Intl.NumberFormat(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(weight)}/5`);
  }
  const best = Array.isArray(item.metadata?.bestPlayerCounts) ? item.metadata.bestPlayerCounts : [];
  const bestCounts = [...new Set(best.filter((value): value is string => typeof value === 'string' && /^[1-9]\d*\+?$/.test(value)))]
    .filter((value) => (item.playerCountMin === null || Number.parseInt(value) >= item.playerCountMin) && (item.playerCountMax === null || Number.parseInt(value) <= item.playerCountMax))
    .sort((a, b) => Number.parseInt(a) - Number.parseInt(b));
  if (bestCounts.length) add(texts.best, bestCounts.join(', '));
  if (loan) add(texts.borrower, `🟠 ${borrowerName ?? loan.borrowerDisplayName}`);
  if (item.storagePosition) add(texts.position, item.storagePosition);
  const link = `<a href="${escapeHtml(buildTelegramStartUrl(`${startPayloadPrefix}${item.id}`))}"><b>${escapeHtml(item.displayName)}</b></a>`;
  return {
    html: `<h2>${loan ? `<mark>${link}</mark>` : link}</h2>${renderTelegramRichDetailTable(rows)}`,
    fallbackText: [`${loan ? '🟠 ' : ''}${link}`, ...lines].join('\n'),
  };
}
