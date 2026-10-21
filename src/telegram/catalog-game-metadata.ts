import type { CatalogItemRecord } from '../catalog/catalog-model.js';
import type { BotLanguage } from './i18n.js';
import { translateCatalogTag } from './i18n-catalog-tags.js';

const labels = {
  ca: { categories: 'Categories', mechanics: 'Mecàniques', complexity: 'Complexitat', best: 'Millor a', recommended: 'Jugadors recomanats', rating: 'Valoració BGG', adjusted: 'Valoració ajustada BGG', rank: 'Rànquing BGG', votes: 'Vots BGG', weightVotes: 'Vots de complexitat', designers: 'Disseny', artists: 'Il·lustració', publishers: 'Editorials', families: 'Famílies BGG', aliases: 'Altres noms' },
  es: { categories: 'Categorías', mechanics: 'Mecánicas', complexity: 'Complejidad', best: 'Mejor a', recommended: 'Jugadores recomendados', rating: 'Valoración BGG', adjusted: 'Valoración ajustada BGG', rank: 'Ranking BGG', votes: 'Votos BGG', weightVotes: 'Votos de complejidad', designers: 'Diseño', artists: 'Ilustración', publishers: 'Editoriales', families: 'Familias BGG', aliases: 'Otros nombres' },
  en: { categories: 'Categories', mechanics: 'Mechanics', complexity: 'Complexity', best: 'Best with', recommended: 'Recommended players', rating: 'BGG rating', adjusted: 'Adjusted BGG rating', rank: 'BGG rank', votes: 'BGG votes', weightVotes: 'Complexity votes', designers: 'Designers', artists: 'Artists', publishers: 'Publishers', families: 'BGG families', aliases: 'Other names' },
} as const;

export function catalogMetadataNames(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())).map((entry) => entry.trim()))] : [];
}

export function catalogGamePlayerCounts(item: CatalogItemRecord, key: 'bestPlayerCounts' | 'recommendedPlayerCounts'): string[] {
  return catalogMetadataNames(item.metadata?.[key])
    .filter((value) => /^[1-9]\d*\+?$/.test(value))
    .filter((value) => (item.playerCountMin === null || Number.parseInt(value) >= item.playerCountMin) && (item.playerCountMax === null || Number.parseInt(value) <= item.playerCountMax))
    .sort((a, b) => Number.parseInt(a) - Number.parseInt(b));
}

function score(value: unknown, maximum: number, language: BotLanguage, minimum = 0): string | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value >= minimum && value <= maximum
    ? `${new Intl.NumberFormat(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)}/${maximum}` : null;
}

export function catalogGameComplexity(item: CatalogItemRecord, language: BotLanguage): string | null {
  return score(item.metadata?.averageWeight, 5, language, 1);
}

/** Public game facts; importer flags and internal maintenance metadata stay internal. */
export function catalogGameMetadataFields(item: CatalogItemRecord, language: BotLanguage): Array<{ label: string; value: string; href?: string }> {
  if (item.itemType !== 'board-game' && item.itemType !== 'expansion') return [];
  const texts = labels[language];
  const metadata = item.metadata ?? {};
  const fields: Array<{ label: string; value: string; href?: string }> = [];
  const add = (label: string, value: string | null) => { if (value) fields.push({ label, value }); };
  for (const key of ['categories', 'mechanics'] as const) {
    add(texts[key], [...new Set(catalogMetadataNames(metadata[key]).map((tag) => translateCatalogTag(tag, language)))].join(' · '));
  }
  add(texts.complexity, catalogGameComplexity(item, language));
  add(texts.best, catalogGamePlayerCounts(item, 'bestPlayerCounts').join(', '));
  add(texts.recommended, catalogGamePlayerCounts(item, 'recommendedPlayerCounts').join(', '));
  add(texts.rating, score(metadata.averageRating, 10, language));
  add(texts.adjusted, score(metadata.bayesAverage, 10, language));
  for (const [key, label] of [['rank', texts.rank], ['usersRated', texts.votes], ['numWeights', texts.weightVotes]] as const) {
    const value = metadata[key];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) add(label, String(value));
  }
  for (const key of ['designers', 'artists', 'publishers', 'families'] as const) add(texts[key], catalogMetadataNames(metadata[key]).join(', '));
  const aliases = catalogMetadataNames([...(Array.isArray(metadata.alternateNames) ? metadata.alternateNames : []), ...(Array.isArray(metadata.spanishNames) ? metadata.spanishNames : [])]);
  add(texts.aliases, aliases.filter((name) => name !== item.displayName && name !== item.originalName).join(', '));
  const id = item.externalRefs?.boardGameGeekId ?? metadata.boardGameGeekId;
  if ((typeof id === 'string' || typeof id === 'number') && /^[1-9]\d*$/.test(String(id))) {
    fields.push({ label: 'BoardGameGeek', value: 'BoardGameGeek', href: `https://boardgamegeek.com/boardgame/${id}` });
  }
  return fields;
}
