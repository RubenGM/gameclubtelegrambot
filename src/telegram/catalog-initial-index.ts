import type { CatalogItemRecord } from '../catalog/catalog-model.js';
import { escapeHtml } from './catalog-presentation.js';
import { buildTelegramStartUrl } from './deep-links.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import type { TelegramRichMessage, TelegramRichMessageTransport } from './rich-message-transport.js';

type InitialBucket = { initials: string; items: CatalogItemRecord[] };
const labels = {
  ca: { item: ['article', 'articles'], game: ['joc', 'jocs'], book: ['llibre', 'llibres'], accessory: ['accessori', 'accessoris'] },
  es: { item: ['artículo', 'artículos'], game: ['juego', 'juegos'], book: ['libro', 'libros'], accessory: ['accesorio', 'accesorios'] },
  en: { item: ['item', 'items'], game: ['game', 'games'], book: ['book', 'books'], accessory: ['accessory', 'accessories'] },
} as const;

export function buildCatalogInitialBuckets(items: CatalogItemRecord[]): InitialBucket[] {
  const byInitial = new Map<string, CatalogItemRecord[]>();
  for (const item of items) {
    const first = item.displayName.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').at(0)?.toUpperCase() ?? '#';
    const initial = /^[A-Z]$/.test(first) ? first : '#';
    const bucket = byInitial.get(initial) ?? [];
    bucket.push(item);
    byInitial.set(initial, bucket);
  }
  const initials = Array.from(byInitial.keys()).sort((left, right) => left.localeCompare(right));
  const buckets: InitialBucket[] = [];
  for (let index = 0; index < initials.length; index += 3) {
    const group = initials.slice(index, index + 3);
    buckets.push({ initials: group.join(''), items: group.flatMap((initial) => byInitial.get(initial) ?? []) });
  }
  return buckets;
}

export function buildCatalogInitialIndex(input: {
  buckets: InitialBucket[];
  totalCount: number;
  startPayloadPrefix: string;
  language?: string;
  footerText?: string;
  hint?: string;
}): { richMessage: TelegramRichMessage; fallbackText: string } {
  const language = normalizeBotLanguage(input.language, 'ca');
  const texts = createTelegramI18n(language);
  const words = labels[language];
  const countText = (count: number, names: readonly [string, string]) => `${count} ${names[count === 1 ? 0 : 1]}`;
  const title = escapeHtml(texts.actionMenu.catalog);
  const total = countText(input.totalCount, words.item);
  const rows: string[] = [];
  const fallback = [`<b>${title}</b>`, total, ''];
  for (const bucket of input.buckets) {
    const counts = { game: 0, book: 0, accessory: 0 };
    for (const item of bucket.items) {
      if (item.itemType === 'board-game' || item.itemType === 'expansion') counts.game += 1;
      else if (item.itemType === 'book' || item.itemType === 'rpg-book') counts.book += 1;
      else counts.accessory += 1;
    }
    const summary = (['game', 'book', 'accessory'] as const)
      .filter((type) => counts[type] > 0).map((type) => countText(counts[type], words[type])).join(' · ');
    const payload = bucket.initials.startsWith('#') ? `hash_${bucket.initials.slice(1)}` : bucket.initials;
    const link = `<a href="${escapeHtml(buildTelegramStartUrl(`${input.startPayloadPrefix}${payload}`))}"><b>${escapeHtml(bucket.initials.split('').join(' '))}</b></a>`;
    rows.push(`<tr><td valign="top">${link}</td><td align="right">${escapeHtml(summary)}</td></tr>`);
    fallback.push(`${link} — ${escapeHtml(summary)}`);
  }
  const empty = rows.length ? '' : `<p>${escapeHtml(texts.catalogAdmin.noItems)}</p>`;
  if (!rows.length) fallback.push(escapeHtml(texts.catalogAdmin.noItems));
  const footers = [input.footerText, input.hint].filter((text): text is string => Boolean(text));
  for (const text of footers) fallback.push('', escapeHtml(text));
  return {
    richMessage: { html: `<h2>${title}</h2><p>${total}</p>${rows.length ? `<table compact>${rows.join('')}</table>` : empty}${footers.map((text) => `<footer>${escapeHtml(text)}</footer>`).join('')}` },
    fallbackText: fallback.join('\n'),
  };
}

export async function replyWithCatalogInitialIndex(context: {
  reply(text: string, options?: TelegramReplyOptions): Promise<unknown>;
  messageThreadId?: number;
  runtime: { chat: { chatId: number; messageThreadId?: number }; bot: Partial<Pick<TelegramRichMessageTransport, 'sendRichMessage'>> & { language?: string } };
}, input: Parameters<typeof buildCatalogInitialIndex>[0], options?: TelegramReplyOptions): Promise<unknown> {
  const message = buildCatalogInitialIndex({ ...input, language: input.language ?? context.runtime.bot.language ?? 'ca' });
  const replyOptions = { ...options, parseMode: 'HTML' as const };
  if (!context.runtime.bot.sendRichMessage) return context.reply(message.fallbackText, replyOptions);
  const threadId = context.messageThreadId ?? context.runtime.chat.messageThreadId;
  return context.runtime.bot.sendRichMessage({ chatId: context.runtime.chat.chatId, ...message, options: replyOptions, ...(threadId !== undefined ? { messageThreadId: threadId } : {}) });
}
