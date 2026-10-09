import type { CatalogItemRecord, CatalogLoanRecord } from '../catalog/catalog-model.js';
import { escapeHtml, renderCatalogPlayerRange } from './catalog-presentation.js';
import { buildTelegramStartUrl } from './deep-links.js';
import { normalizeBotLanguage } from './i18n.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import type { TelegramRichMessage, TelegramRichMessageTransport } from './rich-message-transport.js';

export type CatalogTableEntry = { item: CatalogItemRecord; loan: CatalogLoanRecord | null; borrowerName?: string };
const labels = {
  ca: { games: 'Jocs de taula', books: 'Llibres', accessories: 'Accessoris', name: 'Títol', players: 'Jugadors', duration: 'Durada', publisher: 'Editorial', borrowed: 'Prestats', position: 'Ubicació', categories: 'Categories', mechanics: 'Mecàniques', borrower: 'El té', age: 'Edat' },
  es: { games: 'Juegos de mesa', books: 'Libros', accessories: 'Accesorios', name: 'Título', players: 'Jugadores', duration: 'Duración', publisher: 'Editorial', borrowed: 'Prestados', position: 'Ubicación', categories: 'Categorías', mechanics: 'Mecánicas', borrower: 'Lo tiene', age: 'Edad' },
  en: { games: 'Board games', books: 'Books', accessories: 'Accessories', name: 'Title', players: 'Players', duration: 'Duration', publisher: 'Publisher', borrowed: 'On loan', position: 'Location', categories: 'Categories', mechanics: 'Mechanics', borrower: 'Borrower', age: 'Age' },
} as const;

export function sortCatalogTableEntries(entries: CatalogTableEntry[]): CatalogTableEntry[] {
  return entries.slice().sort((a, b) => Number(Boolean(b.loan)) - Number(Boolean(a.loan)) || a.item.displayName.localeCompare(b.item.displayName));
}

export function buildCatalogItemTable(input: {
  title: string;
  entries: CatalogTableEntry[];
  language?: string;
  startPayloadPrefix: string;
  footerHtml?: string;
}): { richMessage: TelegramRichMessage; fallbackText: string } {
  const texts = labels[normalizeBotLanguage(input.language, 'ca')];
  const sorted = sortCatalogTableEntries(input.entries);
  const rich = [`<h2>${escapeHtml(input.title)}</h2>`];
  const fallback = [`<b>${escapeHtml(input.title)}</b>`];
  if (sorted.some((entry) => entry.loan)) {
    rich.push(`<p><mark>${texts.borrowed}</mark></p>`);
    fallback.push(`🟠 ${texts.borrowed}`);
  }
  const sections = [
    { title: texts.games, entries: sorted.filter(({ item }) => item.itemType === 'board-game' || item.itemType === 'expansion'), game: true },
    { title: texts.books, entries: sorted.filter(({ item }) => item.itemType === 'book' || item.itemType === 'rpg-book'), game: false },
    { title: texts.accessories, entries: sorted.filter(({ item }) => item.itemType === 'accessory'), game: false },
  ];
  for (const section of sections) {
    if (!section.entries.length) continue;
    const columns = section.game ? 3 : 2;
    rich.push(`<h3>${section.title}</h3><table compact><tr><th>${texts.name}</th><th>${section.game ? texts.players : texts.publisher}</th>${section.game ? `<th>${texts.duration}</th>` : ''}</tr>`);
    fallback.push('', `<b>${section.title}</b>`);
    for (const { item, loan, borrowerName } of section.entries) {
      const name = escapeHtml(item.displayName);
      const link = `<a href="${escapeHtml(buildTelegramStartUrl(`${input.startPayloadPrefix}${item.id}`))}"><b>${name}</b></a>`;
      const players = item.playerCountMin !== null || item.playerCountMax !== null ? renderCatalogPlayerRange(item.playerCountMin, item.playerCountMax) : '—';
      const duration = item.playTimeMinutes !== null ? `${item.playTimeMinutes} min` : '—';
      rich.push(`<tr><td>${loan ? `<mark>${link}</mark>` : link}</td><td>${section.game ? players : escapeHtml(item.publisher ?? '—')}</td>${section.game ? `<td>${duration}</td>` : ''}</tr>`);
      fallback.push(`${loan ? '🟠 ' : '- '}${link}${section.game ? ` · ${texts.players}: ${players} · ${duration}` : item.publisher ? ` · ${escapeHtml(item.publisher)}` : ''}`);
      const details: string[] = [];
      const add = (label: string, value: string | null | undefined) => { if (value) details.push(`<b>${label}:</b> ${escapeHtml(value)}`); };
      if (loan) add(texts.borrower, borrowerName ?? loan.borrowerDisplayName);
      add(texts.position, item.storagePosition);
      if (section.game) {
        add(texts.categories, metadataLabels(item.metadata?.categories));
        add(texts.mechanics, metadataLabels(item.metadata?.mechanics));
        if (item.recommendedAge !== null) add(texts.age, `${item.recommendedAge}+`);
      } else {
        add(texts.categories, metadataLabels(item.metadata?.genres ?? item.metadata?.subjects));
        if (item.publicationYear !== null) details.push(String(item.publicationYear));
      }
      if (item.language) details.push(escapeHtml(item.language));
      if (details.length) {
        rich.push(`<tr><td colspan="${columns}"><i>${details.join(' · ')}</i></td></tr>`);
        fallback.push(details.join(' · '));
      }
    }
    rich.push('</table>');
  }
  if (input.footerHtml) {
    rich.push(`<footer>${input.footerHtml}</footer>`);
    fallback.push('', input.footerHtml);
  }
  return { richMessage: { html: rich.join('') }, fallbackText: fallback.join('\n') };
}

function metadataLabels(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const names = value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()));
  return names.length ? names.slice(0, 2).join(', ') : null;
}

export async function replyWithCatalogItemTable(context: {
  reply(text: string, options?: TelegramReplyOptions): Promise<unknown>;
  runtime: { chat: { chatId: number; messageThreadId?: number }; bot: Partial<Pick<TelegramRichMessageTransport, 'sendRichMessage'>> & { language?: string } };
}, input: Parameters<typeof buildCatalogItemTable>[0], options?: TelegramReplyOptions): Promise<unknown> {
  const message = buildCatalogItemTable({ ...input, language: context.runtime.bot.language ?? 'ca' });
  const replyOptions = { ...options, parseMode: 'HTML' as const };
  if (!context.runtime.bot.sendRichMessage) return context.reply(message.fallbackText, replyOptions);
  return context.runtime.bot.sendRichMessage({ chatId: context.runtime.chat.chatId, ...message, options: replyOptions, ...(context.runtime.chat.messageThreadId !== undefined ? { messageThreadId: context.runtime.chat.messageThreadId } : {}) });
}
