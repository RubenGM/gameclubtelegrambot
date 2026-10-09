import type { TelegramRichMessage } from './rich-message-transport.js';

// https://core.telegram.org/bots/api#rich-message-limits
export const telegramRichMessageLimits = { text: 32_768, blocks: 500, depth: 16, media: 50, tableColumns: 20 } as const;
const blockTypes = new Set(['paragraph', 'heading', 'pre', 'footer', 'divider', 'mathematical_expression', 'anchor', 'list', 'blockquote', 'expandable_blockquote', 'pullquote', 'collage', 'slideshow', 'table', 'details', 'map', 'animation', 'audio', 'document', 'photo', 'video', 'voice_note', 'buttons', 'thinking']);
const richTextTypes = new Set(['bold', 'italic', 'underline', 'strikethrough', 'spoiler', 'date_time', 'text_mention', 'subscript', 'superscript', 'marked', 'code', 'custom_emoji', 'mathematical_expression', 'url', 'email_address', 'phone_number', 'bank_card_number', 'mention', 'hashtag', 'cashtag', 'bot_command', 'anchor_link', 'reference', 'reference_link', 'button']);
const htmlBlocks = /<(?:p|h[1-6]|pre|footer|hr|ul|ol|li|blockquote|aside|figure|img|video|audio|tg-document|table|tr|details|tg-map|tg-collage|tg-slideshow|tg-thinking|tg-math-block|tg-button-row)\b/gi;

/** Oversized content uses the ordinary message sanitizer instead of slicing rich HTML. */
export function isTelegramRichMessageWithinLimits(message: TelegramRichMessage): boolean {
  let textLength = 0;
  let blocks = 0;
  let media = message.media?.length ?? 0;
  let depth = 0;
  let tooManyColumns = false;
  if (message.html !== undefined) {
    const html = message.html;
    textLength = [...decodeHtmlEntities(html.replace(/<[^>]*>/g, ''))].length;
    blocks = [...html.matchAll(htmlBlocks)].length;
    media = Math.max(media, [...html.matchAll(/<(?:img|video|audio|tg-document)\b/gi)].length);
    for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      if ([...row[1]!.matchAll(/<(?:td|th)\b/gi)].length > telegramRichMessageLimits.tableColumns) tooManyColumns = true;
    }
    let currentDepth = 0;
    for (const match of html.matchAll(/<(\/?)([\w-]+)\b[^>]*>/g)) {
      if (['hr', 'img', 'br', 'input', 'tg-map', 'tg-document'].includes(match[2]!.toLowerCase())) continue;
      currentDepth = Math.max(0, currentDepth + (match[1] ? -1 : 1));
      depth = Math.max(depth, currentDepth);
    }
  } else if (message.markdown !== undefined) {
    // Markdown's source length is a conservative bound; rich HTML is used by our renderers.
    textLength = [...message.markdown].length;
    blocks = message.markdown.split(/\n\s*\n/).length;
  } else {
    const visit = (value: unknown, nesting: number, field?: string): void => {
      if (typeof value === 'string') {
        if (!field || ['text', 'summary', 'caption', 'credit', 'expression', 'alternative_text'].includes(field)) textLength += [...value].length;
        return;
      }
      if (Array.isArray(value)) { for (const entry of value) visit(entry, nesting, field); return; }
      if (!value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      const isBlock = typeof record.type === 'string' && blockTypes.has(record.type);
      const isFormatting = typeof record.type === 'string' && richTextTypes.has(record.type);
      const childNesting = nesting + (isBlock || isFormatting ? 1 : 0);
      depth = Math.max(depth, childNesting);
      if (isBlock) blocks += 1;
      if (['photo', 'video', 'audio', 'animation', 'document', 'voice_note'].includes(String(record.type))) media += 1;
      if (record.type === 'table' && Array.isArray(record.cells)) {
        blocks += record.cells.length;
        tooManyColumns ||= record.cells.some((row) => Array.isArray(row) && row.length > telegramRichMessageLimits.tableColumns);
      }
      if (record.type === 'list' && Array.isArray(record.items)) blocks += record.items.length;
      for (const [key, child] of Object.entries(record)) {
        if (key !== 'media') visit(child, childNesting, key);
      }
    };
    visit(message.blocks, 0);
  }
  return textLength <= telegramRichMessageLimits.text && blocks <= telegramRichMessageLimits.blocks && depth <= telegramRichMessageLimits.depth && media <= telegramRichMessageLimits.media && !tooManyColumns;
}

function decodeHtmlEntities(text: string): string {
  const named: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };
  return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (entity: string, value: string) => {
    if (!value.startsWith('#')) return named[value] ?? entity;
    const codePoint = value[1]?.toLowerCase() === 'x' ? Number.parseInt(value.slice(2), 16) : Number.parseInt(value.slice(1), 10);
    return codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
  });
}
