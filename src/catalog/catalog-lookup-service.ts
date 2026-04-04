import type { CatalogItemType } from './catalog-model.js';

export interface CatalogLookupCandidate {
  source: 'open-library';
  sourceId: string;
  title: string;
  summary: string;
  importedData: {
    originalName: string | null;
    description: string | null;
    language: string | null;
    publisher: string | null;
    publicationYear: number | null;
    externalRefs: Record<string, unknown> | null;
    metadata: Record<string, unknown> | null;
  };
}

export interface CatalogLookupService {
  search(input: { itemType: CatalogItemType; query: string; author?: string }): Promise<CatalogLookupCandidate[]>;
}

interface OpenLibrarySearchResult {
  key?: unknown;
  title?: unknown;
  subtitle?: unknown;
  author_name?: unknown;
  publisher?: unknown;
  first_publish_year?: unknown;
  language?: unknown;
  isbn?: unknown;
}

export function createHttpCatalogLookupService({
  fetchImpl = fetch,
}: {
  fetchImpl?: typeof fetch;
} = {}): CatalogLookupService {
  return {
    async search({ itemType, query, author }) {
      if (itemType !== 'rpg-book' && itemType !== 'book') {
        return [];
      }

      const normalizedQuery = query.trim();
      if (!normalizedQuery) {
        return [];
      }

      const normalizedAuthor = author?.trim();
      const searchParams = new URLSearchParams({ q: normalizedQuery });
      if (normalizedAuthor) {
        searchParams.set('author', normalizedAuthor);
      }

      const response = await fetchImpl(`https://openlibrary.org/search.json?${searchParams.toString()}`);
      if (!response.ok) {
        throw new Error(`Open Library lookup failed with status ${response.status}`);
      }

      const payload = await response.json() as { results?: unknown };
      const results = Array.isArray((payload as { docs?: unknown }).docs)
        ? (payload as { docs: unknown[] }).docs as OpenLibrarySearchResult[]
        : [];
      return results.slice(0, 5).map(mapOpenLibraryDocumentToCandidate).filter((value): value is CatalogLookupCandidate => value !== null);
    },
  };
}

function mapOpenLibraryDocumentToCandidate(document: OpenLibrarySearchResult): CatalogLookupCandidate | null {
  const sourceId = asNonEmptyString(document.key);
  const title = asNonEmptyString(document.title);
  if (!sourceId || !title) {
    return null;
  }

  const publisher = firstString(document.publisher);
  const publicationYear = typeof document.first_publish_year === 'number' ? document.first_publish_year : null;
  const author = firstString(document.author_name);
  const language = firstString(document.language)?.toUpperCase() ?? null;
  const isbn = firstString(document.isbn);
  const subtitle = asNonEmptyString(document.subtitle);
  const summaryParts = [author, publisher, publicationYear ? String(publicationYear) : null].filter((part) => part && part.trim().length > 0);

  return {
    source: 'open-library',
    sourceId,
    title,
    summary: summaryParts.length > 0 ? summaryParts.join(' · ') : 'Open Library',
    importedData: {
      originalName: subtitle ? `${title}: ${subtitle}` : title,
      description: null,
      language,
      publisher,
      publicationYear,
      externalRefs: {
        openLibraryKey: sourceId,
        openLibraryUrl: `https://openlibrary.org${sourceId}`,
        ...(isbn ? { isbn } : {}),
      },
      metadata: {
        source: 'open-library',
        ...(author ? { author } : {}),
      },
    },
  };
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asOptionalTrimmedString(value: unknown): string | null {
  return asNonEmptyString(value);
}

function firstString(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return asNonEmptyString(value.find((entry) => typeof entry === 'string'));
}
