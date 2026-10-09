import { escapeHtml } from './catalog-presentation.js';
import type { TelegramRichMessage } from './rich-message-transport.js';

/** Reuse trusted detail renderers, keeping their links and permission-filtered fields. */
export function buildTelegramRichDetailMessage(displayName: string, renderedDetails: string): TelegramRichMessage {
  const title = `<b>${escapeHtml(displayName)}</b>`;
  const rows: string[] = [];
  const paragraphs: string[] = [];
  for (const line of splitDetailLines(renderedDetails)) {
    if (!line.trim() || line === title) continue;
    const field = /^<b>([^<]+)<\/b>\s*([\s\S]+)$/.exec(line);
    if (field) rows.push(`<tr><th>${field[1]}</th><td>${field[2]}</td></tr>`);
    else paragraphs.push(`<p>${line}</p>`);
  }
  return { html: `<h2>${escapeHtml(displayName)}</h2>${rows.length ? `<table>${rows.join('')}</table>` : ''}${paragraphs.join('')}` };
}

function splitDetailLines(html: string): string[] {
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
