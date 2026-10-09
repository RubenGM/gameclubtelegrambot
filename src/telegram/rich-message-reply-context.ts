/** Project Telegram's returned rich blocks into bounded, readable reply context. */
export function extractRichMessageReplyText(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.blocks)) return undefined;
  const text = renderBlocks(record.blocks, 0).trim();
  return text || undefined;
}

function renderBlocks(blocks: unknown[], depth: number): string {
  if (depth > 16) return '';
  return blocks.slice(0, 500).map((block) => {
    if (!block || typeof block !== 'object') return '';
    const record = block as Record<string, unknown>;
    if (Array.isArray(record.cells)) {
      return record.cells.map((row) => Array.isArray(row) ? row.map((cell) => cell && typeof cell === 'object' ? renderText((cell as Record<string, unknown>).text, depth + 1) : '').join(' ') : '').join('\n');
    }
    const text = renderText(record.text ?? record.summary ?? record.expression, depth + 1);
    const nested = Array.isArray(record.blocks) ? renderBlocks(record.blocks, depth + 1) : '';
    const items = Array.isArray(record.items) ? record.items.map((item) => item && typeof item === 'object' && Array.isArray((item as Record<string, unknown>).blocks) ? renderBlocks((item as { blocks: unknown[] }).blocks, depth + 1) : '').join('\n') : '';
    const caption = renderText(record.caption, depth + 1);
    return [text, nested, items, caption].filter(Boolean).join('\n');
  }).filter(Boolean).join('\n');
}

function renderText(value: unknown, depth: number): string {
  if (depth > 16) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((text) => renderText(text, depth + 1)).join('');
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const text = renderText(record.text ?? record.alternative_text ?? record.expression, depth + 1);
  return record.type === 'url' && typeof record.url === 'string' ? `${text} (${record.url})` : text;
}
