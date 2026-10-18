type CatalogNamedItem = {
  displayName: string;
  originalName?: string | null;
  metadata?: Record<string, unknown> | null;
};

export const catalogNameMetadataVersion = 2;

export function normalizeCatalogSearchText(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Edition records can contain labels such as "Spanish edition 2015" instead of a game title. */
export function isUsableCatalogTitle(value: string, publisherLabels: string[] = []): boolean {
  const normalized = normalizeCatalogSearchText(value);
  if (!normalized) return false;
  const ordinal = '(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|primera|segunda|tercera|cuarta|quinta|primer|segona|new|revised|limited|deluxe|special|\\d+(?:st|nd|rd|th|a|o)?|[ivx]+)';
  const language = '(?:spanish|english|french|german|italian|portuguese|dutch|polish|catalan|espanol|espanola|castellano|castellana|castilian|ingles|inglesa|multilingual|bilingual|international|multilingue|bilingue)';
  const edition = '(?:edition|editions|edicion|ediciones|edicio|version|printing)';
  if (new RegExp(`^(?:${ordinal} )*${language} (?:${ordinal} )*${edition}\\b`).test(normalized)
    || new RegExp(`^(?:${ordinal} )*${edition} ${language}\\b`).test(normalized)) return false;
  const tokens = normalized.split(' ');
  const genericMarkers = new Set([
    'edition', 'editions', 'edicion', 'ediciones', 'edicio', 'edicoes', 'printing', 'print', 'version',
    'spanish', 'english', 'french', 'german', 'italian', 'portuguese', 'dutch', 'polish', 'catalan',
    'espanol', 'espanola', 'espanoles', 'castellano', 'castellana', 'castilian', 'ingles', 'inglesa',
    'francais', 'francaise', 'deutsch', 'deutsche', 'italiano', 'italiana', 'catala', 'catalana',
    'multilingual', 'bilingual', 'international', 'multilingue', 'bilingue', 'multi', 'language', 'languages',
  ]);
  if (!tokens.some((token) => genericMarkers.has(token))) return true;
  const genericWords = new Set([
    ...genericMarkers, 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
    'primera', 'segunda', 'tercera', 'cuarta', 'quinta', 'primer', 'segona', 'tercera',
    'original', 'new', 'nueva', 'nouvelle', 'revised', 'revisada', 'reprint', 'reimpresion',
    'deluxe', 'limited', 'limitada', 'special', 'especial', 'retail', 'standard', 'regular',
    'publisher', 'publishers', 'publishing', 'editorial', 'games', 'game', 'board', 'inc', 'ltd',
    'the', 'a', 'an', 'of', 'in', 'en', 'de', 'del', 'la', 'el', 'and', 'or', 'y', 'e',
    ...publisherLabels.flatMap((publisher) => normalizeCatalogSearchText(publisher).split(' ')),
  ]);
  return tokens.some((token) => !genericWords.has(token) && !/^\d+(?:st|nd|rd|th|a|o)?$/.test(token) && !/^[ivxlcdm]+$/.test(token));
}

function stringNames(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value])
    .filter((name): name is string => typeof name === 'string' && !!name.trim())
    .map((name) => name.trim());
}

export function uniqueCatalogNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.filter((name) => {
    const normalized = normalizeCatalogSearchText(name);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function catalogItemNames(item: CatalogNamedItem): string[] {
  return uniqueCatalogNames([
    item.displayName, ...stringNames(item.originalName),
    ...stringNames(item.metadata?.spanishName),
    ...stringNames(item.metadata?.spanishNames),
    ...stringNames(item.metadata?.alternateNames),
    ...stringNames(item.metadata?.boardGameGeekVersionName),
  ]);
}

export function catalogItemMatchesQuery(item: CatalogNamedItem, query: string, extraTexts: Array<string | null | undefined> = []): boolean {
  const tokens = normalizeCatalogSearchText(query).split(' ').filter(Boolean);
  const corpus = normalizeCatalogSearchText([...catalogItemNames(item), ...extraTexts.filter(Boolean)].join(' '));
  return tokens.every((token) => corpus.includes(token));
}

/** Keep manually recorded names when a provider refresh replaces its metadata. */
export function mergeCatalogNameMetadata(
  previous: Record<string, unknown> | null | undefined,
  imported: Record<string, unknown> | null | undefined,
  additionalNames: string[] = [],
): Record<string, unknown> | null {
  const result = { ...(imported ?? {}) };
  const publisherLabels = [...stringNames(previous?.publishers), ...stringNames(imported?.publishers)];
  const alternateNames = uniqueCatalogNames([
    ...stringNames(previous?.alternateNames), ...stringNames(imported?.alternateNames), ...additionalNames,
  ].filter((name) => isUsableCatalogTitle(name, publisherLabels)));
  const spanishNames = uniqueCatalogNames([
    ...stringNames(previous?.spanishName), ...stringNames(previous?.spanishNames),
    ...stringNames(imported?.spanishName), ...stringNames(imported?.spanishNames),
  ].filter((name) => isUsableCatalogTitle(name, publisherLabels)));
  delete result.alternateNames;
  delete result.spanishName;
  delete result.spanishNames;
  if (alternateNames.length) result.alternateNames = alternateNames;
  if (spanishNames.length) {
    result.spanishName = spanishNames[0];
    result.spanishNames = spanishNames;
  }
  const version = Math.max(Number(previous?.nameMetadataVersion) || 0, Number(imported?.nameMetadataVersion) || 0);
  if (version > 0) result.nameMetadataVersion = version;
  return Object.keys(result).length ? result : null;
}

/** Provider refreshes may replace the old primary title, but preserve a custom visible title. */
export function preserveCatalogDisplayName(previous: CatalogNamedItem, imported: CatalogNamedItem): string {
  if (!isUsableCatalogTitle(previous.displayName)) {
    return [imported.displayName, imported.originalName, previous.originalName].find((name): name is string =>
      typeof name === 'string' && isUsableCatalogTitle(name)) ?? imported.displayName;
  }
  const existing = normalizeCatalogSearchText(previous.displayName);
  const original = normalizeCatalogSearchText(previous.originalName ?? '');
  const importedOriginal = normalizeCatalogSearchText(imported.originalName ?? '');
  if (existing && existing !== original && existing !== importedOriginal) return previous.displayName;
  return stringNames(previous.metadata?.spanishName).find((name) => isUsableCatalogTitle(name)) ?? imported.displayName;
}
