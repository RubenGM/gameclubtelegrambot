import { escapeHtml } from './catalog-presentation.js';
import type { TelegramRichMessage } from './rich-message-transport.js';

/** Trusted, escaped HTML: shared label/value table used by activity and catalog details. */
export function renderTelegramRichDetailTable(rows: ReadonlyArray<{ labelHtml: string; valueHtml: string }>): string {
  return rows.length ? `<table>${rows.map(({ labelHtml, valueHtml }) => `<tr><th>${labelHtml}</th><td>${valueHtml}</td></tr>`).join('')}</table>` : '';
}

/** Reuse trusted detail renderers, keeping their links and permission-filtered fields. */
export function buildTelegramRichDetailMessage(displayName: string, renderedDetails: string): TelegramRichMessage {
  const title = `<b>${escapeHtml(displayName)}</b>`;
  const rows: Array<{ labelHtml: string; valueHtml: string }> = [];
  const paragraphs: string[] = [];
  for (const line of splitDetailLines(renderedDetails)) {
    if (!line.trim() || line === title) continue;
    const field = /^<b>([^<]+)<\/b>\s*([\s\S]+)$/.exec(line);
    if (field) rows.push({ labelHtml: field[1]!, valueHtml: field[2]! });
    else paragraphs.push(`<p>${line}</p>`);
  }
  return { html: `<h2>${escapeHtml(displayName)}</h2>${renderTelegramRichDetailTable(rows)}${paragraphs.join('')}` };
}

export function splitDetailLines(html: string): string[] {
  const lines: string[] = [];
  let line = '';
  let openTags = 0;
  for (const token of html.match(/<[^>]*>|\n|[^<\n]+/g) ?? []) {
    if (token === '\n' && openTags === 0) {
      lines.push(line);
      line = '';
      continue;
    }
    if (token.startsWith('</')) openTags = Math.max(0, openTags - 1);
    else if (token.startsWith('<') && !/^<(?:br|hr|img|input)\b/i.test(token) && !token.endsWith('/>')) openTags += 1;
    line += token;
  }
  lines.push(line);
  return lines;
}
