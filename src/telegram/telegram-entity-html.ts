import type { TelegramCommandHandlerContext } from './command-registry.js';
import { escapeHtml } from './schedule-presentation.js';

export function renderTelegramMessageTextAsHtml(
  text: string,
  entities: TelegramCommandHandlerContext['messageEntities'],
): string | null {
  if (!entities?.length) {
    return null;
  }

  const normalizedEntities = entities
    .map((entity) => ({
      ...entity,
      end: entity.offset + entity.length,
    }))
    .filter((entity) => entity.offset >= 0 && entity.end <= text.length && entity.length > 0)
    .sort((left, right) => left.offset - right.offset || right.end - left.end);

  if (normalizedEntities.length === 0) {
    return null;
  }

  const renderRange = (start: number, end: number, availableEntities: typeof normalizedEntities): string => {
    let cursor = start;
    const parts: string[] = [];

    for (const entity of availableEntities) {
      if (entity.offset < cursor || entity.offset < start || entity.end > end) {
        continue;
      }

      if (entity.offset > cursor) {
        parts.push(escapeHtml(text.slice(cursor, entity.offset)));
      }

      const nested = availableEntities.filter((candidate) =>
        candidate !== entity && candidate.offset >= entity.offset && candidate.end <= entity.end);
      const inner = renderRange(entity.offset, entity.end, nested);
      parts.push(wrapTelegramEntityHtml(entity, inner, text.slice(entity.offset, entity.end)));
      cursor = entity.end;
    }

    if (cursor < end) {
      parts.push(escapeHtml(text.slice(cursor, end)));
    }

    return parts.join('');
  };

  return renderRange(0, text.length, normalizedEntities);
}

function wrapTelegramEntityHtml(
  entity: { type: string; url?: string | undefined },
  inner: string,
  rawText: string,
): string {
  switch (entity.type) {
    case 'bold':
      return `<b>${inner}</b>`;
    case 'italic':
      return `<i>${inner}</i>`;
    case 'underline':
      return `<u>${inner}</u>`;
    case 'strikethrough':
      return `<s>${inner}</s>`;
    case 'spoiler':
      return `<tg-spoiler>${inner}</tg-spoiler>`;
    case 'code':
      return `<code>${inner}</code>`;
    case 'pre':
      return `<pre>${inner}</pre>`;
    case 'blockquote':
      return `<blockquote>${inner}</blockquote>`;
    case 'expandable_blockquote':
      return `<blockquote expandable>${inner}</blockquote>`;
    case 'text_link':
      return entity.url ? `<a href="${escapeHtml(entity.url)}">${inner}</a>` : inner;
    case 'url':
      return `<a href="${escapeHtml(rawText)}">${inner}</a>`;
    default:
      return inner;
  }
}
