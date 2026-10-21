// Only leading articles are ignored; titles and search aliases retain their spelling.
const articlePattern = "^(?:(?:el|la|lo|los|las|un|una|unos|unas|els|les|uns|unes|the|a|an)\\s+|l['’])";
const leadingArticle = new RegExp(articlePattern, 'iu');
type NamedCatalogItem = { displayName: string; itemType: string };

export function catalogItemSortTitle(item: NamedCatalogItem): string {
  const title = item.displayName.trim();
  if (item.itemType !== 'board-game' && item.itemType !== 'expansion') return title;
  return title.replace(leadingArticle, '').trim() || title;
}

export function catalogItemInitial(item: NamedCatalogItem): string {
  const first = catalogItemSortTitle(item).normalize('NFD').replace(/\p{Diacritic}/gu, '').at(0)?.toUpperCase() ?? '#';
  return /^[A-Z]$/.test(first) ? first : '#';
}

export function compareCatalogItemTitles(left: NamedCatalogItem, right: NamedCatalogItem): number {
  return catalogItemSortTitle(left).localeCompare(catalogItemSortTitle(right), 'es', { sensitivity: 'base' })
    || left.displayName.localeCompare(right.displayName, 'es', { sensitivity: 'base' });
}

// Static SQL for the public catalog's `items` alias, applied before LIMIT/OFFSET.
// Escaping is only for the constant above; no external value enters this expression.
const sqlPattern = articlePattern.replaceAll("'", "''");
const sqlTitle = `case when items.item_type in ('board-game', 'expansion') then coalesce(nullif(trim(regexp_replace(trim(items.display_name), '${sqlPattern}', '', 'i')), ''), trim(items.display_name)) else trim(items.display_name) end`;
export const catalogItemSortTitleSql = `lower(regexp_replace(normalize((${sqlTitle}), NFD), '[\u0300-\u036f]', '', 'g'))`;
