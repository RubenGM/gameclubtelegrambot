import type { CatalogItemRecord, CatalogLoanRecord } from '../catalog/catalog-model.js';
import { compareCatalogItemTitles } from '../catalog/catalog-title-order.js';
import { catalogMetadataNames } from './catalog-game-metadata.js';
import { escapeHtml, renderCatalogPlayerRange } from './catalog-presentation.js';
import { buildTelegramStartUrl } from './deep-links.js';
import { normalizeBotLanguage } from './i18n.js';
import { translateCatalogTag } from './i18n-catalog-tags.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import type { TelegramRichMessage, TelegramRichMessageTransport } from './rich-message-transport.js';
import { isTelegramRichMessageWithinLimits } from './rich-message-limits.js';

export type CatalogTableEntry = { item: CatalogItemRecord; loan: CatalogLoanRecord | null; borrowerName?: string };
const labels = {
  ca: { games: 'Jocs de taula', books: 'Llibres', accessories: 'Accessoris', name: 'Títol', players: 'Jugadors', duration: 'Durada', publisher: 'Editorial', borrowed: 'Prestats', position: 'Ubicació', categories: 'Categories', mechanics: 'Mecàniques', borrower: 'El té', age: 'Edat' },
  es: { games: 'Juegos de mesa', books: 'Libros', accessories: 'Accesorios', name: 'Título', players: 'Jugadores', duration: 'Duración', publisher: 'Editorial', borrowed: 'Prestados', position: 'Ubicación', categories: 'Categorías', mechanics: 'Mecánicas', borrower: 'Lo tiene', age: 'Edad' },
  en: { games: 'Board games', books: 'Books', accessories: 'Accessories', name: 'Title', players: 'Players', duration: 'Duration', publisher: 'Publisher', borrowed: 'On loan', position: 'Location', categories: 'Categories', mechanics: 'Mechanics', borrower: 'Borrower', age: 'Age' },
} as const;

export function sortCatalogTableEntries(entries: CatalogTableEntry[]): CatalogTableEntry[] {
  return entries.slice().sort((a, b) => Number(Boolean(b.loan)) - Number(Boolean(a.loan)) || compareCatalogItemTitles(a.item, b.item));
}

export function buildCatalogItemTable(input: {
  title: string;
  entries: CatalogTableEntry[];
  language?: string;
  startPayloadPrefix: string;
  footerHtml?: string;
}): { richMessage: TelegramRichMessage; fallbackText: string } {
  const language = normalizeBotLanguage(input.language, 'ca');
  const texts = labels[language];
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
    rich.push(`<h3>${section.title}</h3>`);
    fallback.push('', `<b>${section.title}</b>`);
    rich.push('<table compact>');
    if (section.game) rich.push(`<tr><th>${texts.name}</th><th>${texts.players}</th><th>${texts.duration}</th></tr>`);
    for (const { item, loan, borrowerName } of section.entries) {
      const name = escapeHtml(item.displayName);
      const link = `<a href="${escapeHtml(buildTelegramStartUrl(`${input.startPayloadPrefix}${item.id}`))}"><b>${name}</b></a>`;
      const titleCell = loan ? `<mark>${link}</mark>` : link;
      if (section.game) {
        const players = item.playerCountMin !== null || item.playerCountMax !== null ? renderCatalogPlayerRange(item.playerCountMin, item.playerCountMax, language) : '—';
        const duration = item.playTimeMinutes !== null ? `${item.playTimeMinutes} min` : '—';
        rich.push(`<tr><td valign="top">${titleCell}</td><td valign="top">${players}</td><td valign="top">${duration}</td></tr>`);
        fallback.push('', `${loan ? '🟠 ' : '- '}${link} · ${texts.players}: ${players} · ${duration}`);
      } else {
        rich.push(`<tr><td align="left" valign="top">${titleCell}</td><td align="right" valign="top">${escapeHtml(item.publisher ?? '')}</td></tr>`);
        fallback.push(`${loan ? '🟠 ' : '- '}${link}${item.publisher ? ` · ${escapeHtml(item.publisher)}` : ''}`);
      }
      const details: string[] = [];
      const add = (label: string, value: string | null | undefined) => { if (value) details.push(`<b>${label}:</b> ${escapeHtml(value)}`); };
      if (loan) add(texts.borrower, borrowerName ?? loan.borrowerDisplayName);
      add(texts.position, item.storagePosition);
      if (section.game) {
        for (const key of ['categories', 'mechanics'] as const) {
          add(texts[key], catalogMetadataNames(item.metadata?.[key]).slice(0, 2).map((tag) => translateCatalogTag(tag, language)).join(', '));
        }
        if (item.recommendedAge !== null) add(texts.age, `${item.recommendedAge}+`);
      } else {
        add(texts.categories, metadataLabels(item.metadata?.genres ?? item.metadata?.subjects));
        if (item.publicationYear !== null) details.push(String(item.publicationYear));
      }
      if (item.language) details.push(escapeHtml(item.language));
      if (details.length) {
        rich.push(`<tr><td colspan="${section.game ? 3 : 2}"><i>${details.join(section.game ? '<br>' : ' · ')}</i></td></tr>`);
        fallback.push(details.join(section.game ? '\n' : ' · '));
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
  const settings = { ...input, language: context.runtime.bot.language ?? 'ca' };
  const message = buildCatalogItemTable(settings);
  const replyOptions = { ...options, parseMode: 'HTML' as const };
  if (!context.runtime.bot.sendRichMessage) return context.reply(message.fallbackText, replyOptions);
  const sorted = sortCatalogTableEntries(input.entries);
  // Preserve the renderer's type sections and borrowed-first order across messages.
  const ordered = [
    sorted.filter(({ item }) => item.itemType === 'board-game' || item.itemType === 'expansion'),
    sorted.filter(({ item }) => item.itemType === 'book' || item.itemType === 'rpg-book'),
    sorted.filter(({ item }) => item.itemType === 'accessory'),
  ].flat();
  const split = (entries: CatalogTableEntry[], rendered = buildCatalogItemTable({ ...settings, entries })): CatalogTableEntry[][] => {
    if (entries.length <= 1 || isTelegramRichMessageWithinLimits(rendered.richMessage)) return [entries];
    const middle = Math.ceil(entries.length / 2);
    return [...split(entries.slice(0, middle)), ...split(entries.slice(middle))];
  };
  const batches = split(ordered, message);
  let result: unknown;
  const { footerHtml: _footer, ...withoutFooter } = settings;
  for (const [index, entries] of batches.entries()) {
    const last = index === batches.length - 1;
    const rendered = batches.length === 1 ? message : buildCatalogItemTable({ ...(last ? settings : withoutFooter), entries });
    result = await context.runtime.bot.sendRichMessage({
      chatId: context.runtime.chat.chatId,
      ...rendered,
      options: last ? replyOptions : { parseMode: 'HTML', ...(options?.messageThreadId !== undefined ? { messageThreadId: options.messageThreadId } : {}) },
      ...(context.runtime.chat.messageThreadId !== undefined ? { messageThreadId: context.runtime.chat.messageThreadId } : {}),
    });
  }
  return result;
}
