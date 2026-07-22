import { createHash } from 'node:crypto';

import type { NotionBlock, NotionFile, NotionPageDocument } from './notion-client.js';

const defaultTelegramMessageLimit = 3_500;

export interface RenderedNotionDocument {
  title: string;
  messages: string[];
  files: Array<{ blockId: string; file: NotionFile }>;
  unsupportedBlockTypes: string[];
  truncated: boolean;
  contentHash: string;
}

/**
 * Converts the supported read-only Notion block subset to safe Telegram HTML.
 * The result is deliberately block-oriented so it can be chunked without
 * splitting a Telegram entity in the middle of a tag.
 */
export function renderNotionDocument(
  document: NotionPageDocument,
  options: { messageLimit?: number } = {},
): RenderedNotionDocument {
  const messageLimit = options.messageLimit ?? defaultTelegramMessageLimit;
  const renderedBlocks: string[] = [];
  const files: Array<{ blockId: string; file: NotionFile }> = [];
  const unsupported = new Set<string>();

  for (const block of document.blocks) {
    collectBlock(block, { renderedBlocks, files, unsupported });
  }

  const title = document.page.title || 'Página sin título';
  const heading = `<b>${escapeHtml(title)}</b>`;
  const messages = chunkTelegramHtml([heading, ...renderedBlocks], messageLimit);
  const content = [title, ...renderedBlocks].join('\n');
  return {
    title,
    messages: messages.length > 0 ? messages : [heading],
    files,
    unsupportedBlockTypes: [...unsupported].sort(),
    truncated: document.truncated,
    contentHash: createHash('sha256').update(content).digest('hex'),
  };
}

function collectBlock(
  block: NotionBlock,
  state: {
    renderedBlocks: string[];
    files: Array<{ blockId: string; file: NotionFile }>;
    unsupported: Set<string>;
  },
): void {
  const rendered = renderBlock(block, state);
  if (rendered) state.renderedBlocks.push(rendered);
  for (const child of block.children) collectBlock(child, state);
}

function renderBlock(
  block: NotionBlock,
  state: {
    files: Array<{ blockId: string; file: NotionFile }>;
    unsupported: Set<string>;
  },
): string | null {
  const payload = asRecord(block.raw[block.type]);
  const richText = renderRichText(payload?.rich_text);
  switch (block.type) {
    case 'paragraph':
      return richText || null;
    case 'heading_1':
      return richText ? `<b>${richText}</b>` : null;
    case 'heading_2':
      return richText ? `<b>${richText}</b>` : null;
    case 'heading_3':
    case 'heading_4':
      return richText ? `<b>${richText}</b>` : null;
    case 'bulleted_list_item':
      return richText ? `• ${richText}` : null;
    case 'numbered_list_item':
      return richText ? `• ${richText}` : null;
    case 'to_do':
      return richText ? `${payload?.checked === true ? '☑️' : '☐'} ${richText}` : null;
    case 'quote':
      return richText ? `❝ ${richText}` : null;
    case 'callout':
      return richText ? `💡 ${richText}` : null;
    case 'toggle':
      return richText ? `▸ ${richText}` : null;
    case 'code': {
      const code = plainRichText(payload?.rich_text);
      return code ? `<pre>${escapeHtml(code)}</pre>` : null;
    }
    case 'divider':
      return '──────────';
    case 'child_page': {
      const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
      return title ? `📄 ${escapeHtml(title)}` : null;
    }
    case 'file':
    case 'image':
    case 'video':
    case 'audio':
    case 'pdf': {
      const file = extractFileFromPayload(payload);
      if (file) {
        state.files.push({ blockId: block.id, file });
        const label = file.name ? escapeHtml(file.name) : 'Adjunto de Notion';
        return `📎 ${label}`;
      }
      state.unsupported.add(block.type);
      return `⚠️ Adjunto de Notion no disponible`;
    }
    case 'table_row': {
      const cells = Array.isArray(payload?.cells)
        ? payload.cells.map((cell) => renderRichText(cell)).filter(Boolean)
        : [];
      return cells.length > 0 ? cells.join(' | ') : null;
    }
    case 'table':
    case 'column':
    case 'column_list':
    case 'synced_block':
    case 'template':
      return null;
    default:
      state.unsupported.add(block.type);
      return `⚠️ Bloque de Notion no compatible: ${escapeHtml(block.type)}`;
  }
}

function extractFileFromPayload(payload: Record<string, unknown> | null): NotionFile | null {
  if (!payload) return null;
  const file = asRecord(payload.file);
  const external = asRecord(payload.external);
  const name = typeof payload.name === 'string'
    ? payload.name
    : plainRichText(payload.caption) || null;
  if (typeof file?.url === 'string') {
    return {
      kind: 'notion_file',
      url: file.url,
      expiryTime: typeof file.expiry_time === 'string' ? file.expiry_time : null,
      name,
    };
  }
  if (typeof external?.url === 'string') {
    return { kind: 'external', url: external.url, expiryTime: null, name };
  }
  return null;
}

function renderRichText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.map((part) => renderRichTextPart(asRecord(part))).join('');
}

function plainRichText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.map((part) => {
    const record = asRecord(part);
    return typeof record?.plain_text === 'string' ? record.plain_text : '';
  }).join('');
}

function renderRichTextPart(part: Record<string, unknown> | null): string {
  if (!part) return '';
  let result = escapeHtml(typeof part.plain_text === 'string' ? part.plain_text : '');
  if (!result) return '';
  const annotations = asRecord(part.annotations);
  if (annotations?.code === true) result = `<code>${result}</code>`;
  if (annotations?.bold === true) result = `<b>${result}</b>`;
  if (annotations?.italic === true) result = `<i>${result}</i>`;
  if (annotations?.underline === true) result = `<u>${result}</u>`;
  if (annotations?.strikethrough === true) result = `<s>${result}</s>`;
  const href = safeHttpUrl(typeof part.href === 'string' ? part.href : undefined)
    ?? safeHttpUrl(typeof asRecord(part.text)?.link === 'object' ? String(asRecord(asRecord(part.text)?.link)?.url ?? '') : undefined);
  return href ? `<a href="${escapeHtml(href)}">${result}</a>` : result;
}

function chunkTelegramHtml(blocks: string[], limit: number): string[] {
  const output: string[] = [];
  let current = '';
  for (const block of blocks.filter(Boolean)) {
    if (block.length > limit) {
      if (current) output.push(current);
      output.push(...splitLargeBlock(block, limit));
      current = '';
      continue;
    }
    const next = current ? `${current}\n\n${block}` : block;
    if (next.length > limit) {
      if (current) output.push(current);
      current = block;
    } else {
      current = next;
    }
  }
  if (current) output.push(current);
  return output;
}

/** Long blocks use escaped plain text rather than risking malformed HTML. */
function splitLargeBlock(html: string, limit: number): string[] {
  const plain = html.replace(/<[^>]*>/g, '');
  const chunks: string[] = [];
  let remaining = plain;
  while (remaining.length > limit) {
    const boundary = Math.max(1, remaining.lastIndexOf(' ', limit));
    chunks.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function safeHttpUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
