const maximumDetectedCatalogTitleLength = 180;

export function buildCatalogBulkImageQuestion(): string {
  return [
    'Detecta todos los juegos de mesa y expansiones cuyas cajas sean visibles en esta foto de una biblioteca.',
    'Devuelve exclusivamente JSON valido con esta forma exacta: {"games":[{"title":"Titulo exacto","visibleText":"Titulo exacto","certainty":"clear"}]}.',
    'Incluye una caja solo cuando puedas leer el titulo completo de forma directa y clara.',
    'title y visibleText deben contener exactamente el mismo titulo transcrito de la caja; no completes subtitulos ni palabras por el arte, el contexto o tu conocimiento de juegos existentes.',
    'Si una palabra es parcial, borrosa, dudosa o inferida, omite esa caja por completo.',
    'No incluyas libros, decoracion, accesorios ni explicaciones. No repitas titulos.',
  ].join(' ');
}

export function parseCatalogBulkImageResponse(value: string): string[] {
  const cleaned = value.replace(/\u001b\[[0-9;]*m/g, '').trim();
  if (!cleaned || /ProviderModelNotFoundError|Model not found|^Error:/im.test(cleaned)) {
    return [];
  }

  const parsedTitles = parseJsonTitles(cleaned);
  if (parsedTitles !== null) {
    return normalizeDetectedTitles(parsedTitles);
  }
  return [];
}

function parseJsonTitles(value: string): unknown[] | null {
  const candidates = [
    value,
    value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? '',
    extractJsonSlice(value, '{', '}'),
    extractJsonSlice(value, '[', ']'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      if (parsed && typeof parsed === 'object') {
        const record = parsed as Record<string, unknown>;
        for (const key of ['games', 'titles', 'items']) {
          if (Array.isArray(record[key])) {
            return record[key];
          }
        }
      }
    } catch {
      // Try the next likely JSON fragment, then fall back to a line-based response.
    }
  }
  return null;
}

function extractJsonSlice(value: string, opening: string, closing: string): string {
  const start = value.indexOf(opening);
  const end = value.lastIndexOf(closing);
  return start >= 0 && end > start ? value.slice(start, end + 1) : '';
}

function normalizeDetectedTitles(values: unknown[]): string[] {
  const titles: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (!value || typeof value !== 'object' || !isClearVisibleTitle(value as Record<string, unknown>)) {
      continue;
    }
    const raw = readObjectTitle(value as Record<string, unknown>);
    const title = raw
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .replace(/^['"`]+|['"`,;]+$/g, '')
      .trim();
    if (!title || title.length > maximumDetectedCatalogTitleLength || /^ningun[oa]?\b|^none\b/i.test(title)) {
      continue;
    }
    const key = title.toLocaleLowerCase('es');
    if (!seen.has(key)) {
      seen.add(key);
      titles.push(title);
    }
  }

  return titles;
}

function isClearVisibleTitle(value: Record<string, unknown>): boolean {
  if (value.certainty !== 'clear' || typeof value.visibleText !== 'string') {
    return false;
  }
  const title = readObjectTitle(value);
  return Boolean(title) && normalizeEvidence(title) === normalizeEvidence(value.visibleText);
}

function normalizeEvidence(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function readObjectTitle(value: Record<string, unknown>): string {
  for (const key of ['title', 'name', 'displayName']) {
    if (typeof value[key] === 'string') {
      return value[key];
    }
  }
  return '';
}
