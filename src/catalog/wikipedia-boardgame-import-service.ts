import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { CatalogItemType } from './catalog-model.js';

const execFileAsync = promisify(execFile);

export interface WikipediaBoardGameCatalogDraft {
  familyId: number | null;
  groupId: number | null;
  itemType: CatalogItemType;
  displayName: string;
  originalName: string | null;
  description: string | null;
  language: string | null;
  publisher: string | null;
  publicationYear: number | null;
  playerCountMin: number | null;
  playerCountMax: number | null;
  recommendedAge: number | null;
  playTimeMinutes: number | null;
  externalRefs: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

export interface WikipediaBoardGameImportService {
  importByTitle(title: string): Promise<WikipediaBoardGameImportResult>;
}

export interface BoardGameGeekCollectionImportService {
  listCollections(username: string): Promise<BoardGameGeekCollectionListResult>;
  importCollection(input: { username: string; collectionKey?: BoardGameGeekCollectionKey; collectionName?: string }): Promise<BoardGameGeekCollectionImportResult>;
  importByUsername(username: string): Promise<BoardGameGeekCollectionImportResult>;
}

export type BoardGameGeekCollectionKey = 'owned' | 'wishlist' | 'preordered' | 'for-trade' | 'want-to-play' | 'want-to-buy' | 'previously-owned';

export type BoardGameGeekCollectionErrorStage = 'list-collections' | 'import-collection' | 'load-things';

export type BoardGameGeekCollectionErrorReason =
  | 'missing-api-key'
  | 'auth-invalid'
  | 'http-error'
  | 'not-ready'
  | 'unsupported-collection-name'
  | 'no-importable-items'
  | 'invalid-thing-response'
  | 'unexpected';

export interface BoardGameGeekCollectionDescriptor {
  key: BoardGameGeekCollectionKey;
  itemCount?: number;
}

export interface BoardGameGeekCollectionError {
  type: 'bad-input' | 'connection' | 'invalid-response' | 'not-found' | 'unexpected';
  stage: BoardGameGeekCollectionErrorStage;
  reason: BoardGameGeekCollectionErrorReason;
  message: string;
  username: string;
  httpStatus?: number;
  canRetryManually: boolean;
  collectionKey?: BoardGameGeekCollectionKey;
  collectionName?: string;
  supportedCollectionKeys?: BoardGameGeekCollectionKey[];
}

interface BoardGameGeekCandidate {
  id: string;
  names: string[];
  primaryName: string;
  yearPublished: number | null;
}

export type WikipediaBoardGameImportResult =
  | {
      ok: true;
      draft: WikipediaBoardGameCatalogDraft;
    }
  | {
      ok: false;
      error: {
        type: WikipediaBoardGameImportErrorType;
        message: string;
        candidates?: string[];
      };
    };

export type WikipediaBoardGameImportErrorType = 'ambiguous' | 'bad-input' | 'connection' | 'invalid-response' | 'not-found' | 'unexpected';

export type BoardGameGeekCollectionImportResult =
  | {
      ok: true;
      username: string;
      collectionKey: BoardGameGeekCollectionKey;
      totalCount: number;
      items: WikipediaBoardGameCatalogDraft[];
      errors: string[];
    }
  | {
      ok: false;
      error: BoardGameGeekCollectionError;
    };

export type BoardGameGeekCollectionListResult =
  | {
      ok: true;
      username: string;
      collections: BoardGameGeekCollectionDescriptor[];
      canWriteCollectionName: boolean;
    }
  | {
      ok: false;
      error: BoardGameGeekCollectionError;
    };

type BoardGameGeekCollectionFilters = Partial<Record<'own' | 'wishlist' | 'preordered' | 'trade' | 'wanttoplay' | 'wanttobuy' | 'prevowned', '1'>>;

const boardGameGeekCollectionDefinitions: Array<{
  key: BoardGameGeekCollectionKey;
  filters: BoardGameGeekCollectionFilters;
  aliases: string[];
}> = [
  {
    key: 'owned',
    filters: { own: '1' },
    aliases: ['owned', 'own', 'collection', 'my collection', 'coleccion propia', 'colección propia', 'col leccio propia', 'colleccio propia'],
  },
  {
    key: 'wishlist',
    filters: { wishlist: '1' },
    aliases: ['wishlist', 'wish list', 'lista de deseos', 'llista de desitjos'],
  },
  {
    key: 'preordered',
    filters: { preordered: '1' },
    aliases: ['preordered', 'preorder', 'reservados', 'reservat', 'reservados por adelantado'],
  },
  {
    key: 'for-trade',
    filters: { trade: '1' },
    aliases: ['for trade', 'trade', 'en intercambio', 'para intercambio', 'per intercanvi'],
  },
  {
    key: 'want-to-play',
    filters: { wanttoplay: '1' },
    aliases: ['want to play', 'wanttoplay', 'quiero jugar', 'vull jugar'],
  },
  {
    key: 'want-to-buy',
    filters: { wanttobuy: '1' },
    aliases: ['want to buy', 'wanttobuy', 'quiero comprar', 'vull comprar'],
  },
  {
    key: 'previously-owned',
    filters: { prevowned: '1' },
    aliases: ['previously owned', 'prevowned', 'owned before', 'antes en propiedad', 'abans en propietat'],
  },
];

class BoardGameGeekLookupError extends Error {
  constructor(
    message: string,
    readonly kind: 'http' | 'not-ready',
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'BoardGameGeekLookupError';
  }
}

export function createWikipediaBoardGameImportService({
  scriptPath = './scripts/wikipedia-boardgame-catalog-import.sh',
  execImpl = execFileAsync,
  fetchImpl = fetch,
  bggApiKey,
}: {
  scriptPath?: string;
  execImpl?: typeof execFileAsync;
  fetchImpl?: typeof fetch;
  bggApiKey?: string;
} = {}): WikipediaBoardGameImportService {
  return {
    async importByTitle(title: string) {
      const normalizedTitle = title.trim();
      if (!normalizedTitle) {
        return { ok: false, error: { type: 'bad-input', message: 'Falta el nom del joc.' } };
      }

      const normalizedBggApiKey = bggApiKey?.trim();
      if (normalizedBggApiKey) {
        const boardGameGeekResult = await importFromBoardGameGeek({
          title: normalizedTitle,
          fetchImpl,
          apiKey: normalizedBggApiKey,
        });
        if (boardGameGeekResult) {
          return boardGameGeekResult;
        }
      }

      try {
        const { stdout } = await execImpl('bash', [scriptPath, normalizedTitle], { maxBuffer: 10 * 1024 * 1024 });
        const parsed = JSON.parse(stdout) as unknown;
        return parseImportResult(parsed);
      } catch (error) {
        return {
          ok: false,
          error: {
            type: 'connection',
            message: error instanceof Error ? error.message : 'No s ha pogut connectar amb el servei d importacio.',
          },
        };
      }
    },
  };
}

export function createBoardGameGeekCollectionImportService({
  fetchImpl = fetch,
  bggApiKey,
}: {
  fetchImpl?: typeof fetch;
  bggApiKey?: string;
} = {}): BoardGameGeekCollectionImportService {
  async function listCollections(username: string): Promise<BoardGameGeekCollectionListResult> {
    const normalizedUsername = username.trim();
    if (!normalizedUsername) {
      return {
        ok: false,
        error: {
          type: 'bad-input',
          stage: 'list-collections',
          reason: 'unexpected',
          message: 'Missing BoardGameGeek username.',
          username: normalizedUsername,
          canRetryManually: false,
        },
      };
    }

    const normalizedBggApiKey = bggApiKey?.trim();
    if (!normalizedBggApiKey) {
      return {
        ok: false,
        error: {
          type: 'connection',
          stage: 'list-collections',
          reason: 'missing-api-key',
          message: 'BoardGameGeek API key is missing.',
          username: normalizedUsername,
          canRetryManually: false,
        },
      };
    }

    return {
      ok: true,
      username: normalizedUsername,
      collections: boardGameGeekCollectionDefinitions.map((definition) => ({ key: definition.key })),
      canWriteCollectionName: true,
    };
  }

  async function importCollection({
    username,
    collectionKey,
    collectionName,
  }: {
    username: string;
    collectionKey?: BoardGameGeekCollectionKey;
    collectionName?: string;
  }): Promise<BoardGameGeekCollectionImportResult> {
    const normalizedUsername = username.trim();
    if (!normalizedUsername) {
      return {
        ok: false,
        error: {
          type: 'bad-input',
          stage: 'import-collection',
          reason: 'unexpected',
          message: 'Missing BoardGameGeek username.',
          username: normalizedUsername,
          canRetryManually: false,
        },
      };
    }

    const normalizedBggApiKey = bggApiKey?.trim();
    const normalizedCollectionName = normalizeOptionalText(collectionName ?? null);
    if (!normalizedBggApiKey) {
      return {
        ok: false,
        error: {
          type: 'connection',
          stage: 'import-collection',
          reason: 'missing-api-key',
          message: 'BoardGameGeek API key is missing.',
          username: normalizedUsername,
          canRetryManually: false,
          ...(collectionKey ? { collectionKey } : {}),
          ...(normalizedCollectionName ? { collectionName: normalizedCollectionName } : {}),
        },
      };
    }

    const resolvedDefinition = collectionKey
      ? boardGameGeekCollectionDefinitions.find((definition) => definition.key === collectionKey) ?? null
      : resolveBoardGameGeekCollectionDefinition(collectionName ?? '');
    if (!resolvedDefinition) {
      return {
        ok: false,
        error: {
          type: 'bad-input',
          stage: 'import-collection',
          reason: 'unsupported-collection-name',
          message: 'Unsupported BoardGameGeek collection name.',
          username: normalizedUsername,
          supportedCollectionKeys: boardGameGeekCollectionDefinitions.map((definition) => definition.key),
          canRetryManually: true,
          ...(normalizedCollectionName ? { collectionName: normalizedCollectionName } : {}),
        },
      };
    }

    let collectionEntries: Array<{ id: string; displayName: string }>;
    try {
      collectionEntries = await importBoardGameGeekCollectionEntries(fetchImpl, normalizedBggApiKey, normalizedUsername, resolvedDefinition.filters);
    } catch (error) {
      return {
        ok: false,
        error: mapBoardGameGeekCollectionError(error, {
          username: normalizedUsername,
          stage: 'import-collection',
          collectionKey: resolvedDefinition.key,
          collectionName: normalizedCollectionName,
          canRetryManually: !collectionKey,
        }),
      };
    }

    if (collectionEntries.length === 0) {
      return {
        ok: false,
        error: {
          type: 'not-found',
          stage: 'import-collection',
          reason: 'no-importable-items',
          message: 'The selected BoardGameGeek collection does not contain importable items.',
          username: normalizedUsername,
          collectionKey: resolvedDefinition.key,
          canRetryManually: !collectionKey,
          ...(normalizedCollectionName ? { collectionName: normalizedCollectionName } : {}),
        },
      };
    }

    let thingXml: string;
    try {
      thingXml = await importBoardGameGeekThingXml(fetchImpl, normalizedBggApiKey, collectionEntries.map((entry) => entry.id));
    } catch (error) {
      return {
        ok: false,
        error: mapBoardGameGeekCollectionError(error, {
          username: normalizedUsername,
          stage: 'load-things',
          collectionKey: resolvedDefinition.key,
          collectionName: normalizedCollectionName,
          canRetryManually: false,
        }),
      };
    }

    const items: WikipediaBoardGameCatalogDraft[] = [];
    const errors: string[] = [];
    for (const entry of collectionEntries) {
      const draft = parseBoardGameGeekThing(thingXml, entry.id);
      if (!draft) {
        errors.push(`No s ha pogut carregar el detall de ${entry.displayName} [API #${entry.id}].`);
        continue;
      }
      items.push(draft);
    }

    if (items.length === 0) {
      return {
        ok: false,
        error: {
          type: 'invalid-response',
          stage: 'load-things',
          reason: 'invalid-thing-response',
          message: 'BoardGameGeek did not return usable thing details for this collection.',
          username: normalizedUsername,
          collectionKey: resolvedDefinition.key,
          canRetryManually: false,
          ...(normalizedCollectionName ? { collectionName: normalizedCollectionName } : {}),
        },
      };
    }

    return {
      ok: true,
      username: normalizedUsername,
      collectionKey: resolvedDefinition.key,
      totalCount: collectionEntries.length,
      items,
      errors,
    };
  }

  return {
    listCollections,
    importCollection,
    importByUsername: (username: string) => importCollection({ username, collectionKey: 'owned' }),
  };
}

async function importFromBoardGameGeek({
  title,
  fetchImpl,
  apiKey,
}: {
  title: string;
  fetchImpl: typeof fetch;
  apiKey: string;
}): Promise<WikipediaBoardGameImportResult | null> {
  try {
    const candidateId = parseBoardGameGeekCandidateId(title);
    if (candidateId) {
      const draft = await importBoardGameGeekThingById(fetchImpl, apiKey, candidateId);
      return draft ? { ok: true, draft } : null;
    }

    const searchParams = new URLSearchParams({
      query: title,
      type: 'boardgame',
    });
    const searchXml = await fetchBoardGameGeekXml(fetchImpl, `https://boardgamegeek.com/xmlapi2/search?${searchParams.toString()}`, apiKey);
    const candidates = parseBoardGameGeekSearchResults(searchXml);
    if (candidates.length === 0) {
      return null;
    }

    const selectedCandidate = chooseBoardGameGeekCandidate(title, candidates);
    if (selectedCandidate.kind === 'ambiguous') {
      return {
        ok: false,
        error: {
          type: 'ambiguous',
          message: 'He trobat diverses coincidencies a la API.',
          candidates: selectedCandidate.candidates.map(formatBoardGameGeekCandidateLabel),
        },
      };
    }

    const draft = await importBoardGameGeekThingById(fetchImpl, apiKey, selectedCandidate.candidate.id);
    return draft ? { ok: true, draft } : null;
  } catch {
    return null;
  }
}

async function importBoardGameGeekThingById(fetchImpl: typeof fetch, apiKey: string, itemId: string): Promise<WikipediaBoardGameCatalogDraft | null> {
  const thingXml = await importBoardGameGeekThingXml(fetchImpl, apiKey, [itemId]);
  return parseBoardGameGeekThing(thingXml, itemId);
}

async function importBoardGameGeekThingXml(fetchImpl: typeof fetch, apiKey: string, itemIds: string[]): Promise<string> {
  const uniqueItemIds = [...new Set(itemIds.filter((itemId) => itemId.trim().length > 0))];
  if (uniqueItemIds.length === 0) {
    throw new Error('BoardGameGeek thing lookup requires at least one item id');
  }

  const thingParams = new URLSearchParams({
    id: uniqueItemIds.join(','),
    stats: '1',
  });
  return fetchBoardGameGeekXml(fetchImpl, `https://boardgamegeek.com/xmlapi2/thing?${thingParams.toString()}`, apiKey);
}

async function importBoardGameGeekCollectionEntries(
  fetchImpl: typeof fetch,
  apiKey: string,
  username: string,
  filters: BoardGameGeekCollectionFilters,
): Promise<Array<{ id: string; displayName: string }>> {
  const boardGames = await importBoardGameGeekCollectionSubtype(fetchImpl, apiKey, username, 'boardgame', filters);
  const expansions = await importBoardGameGeekCollectionSubtype(fetchImpl, apiKey, username, 'boardgameexpansion', filters);
  const entries = [...boardGames, ...expansions];
  const deduped = new Map<string, { id: string; displayName: string }>();
  for (const entry of entries) {
    if (!deduped.has(entry.id)) {
      deduped.set(entry.id, entry);
    }
  }
  return [...deduped.values()];
}

async function importBoardGameGeekCollectionSubtype(
  fetchImpl: typeof fetch,
  apiKey: string,
  username: string,
  subtype: 'boardgame' | 'boardgameexpansion',
  filters: BoardGameGeekCollectionFilters,
): Promise<Array<{ id: string; displayName: string }>> {
  const params = new URLSearchParams({ username, subtype });
  for (const [key, value] of Object.entries(filters)) {
    if (value) {
      params.set(key, value);
    }
  }
  const xml = await fetchBoardGameGeekXml(fetchImpl, `https://boardgamegeek.com/xmlapi2/collection?${params.toString()}`, apiKey);
  return parseBoardGameGeekCollection(xml);
}

function parseBoardGameGeekCollection(xml: string): Array<{ id: string; displayName: string }> {
  const matches = [...xml.matchAll(/<item\b([^>]*)>([\s\S]*?)<\/item>/g)];
  const items: Array<{ id: string; displayName: string }> = [];
  for (const match of matches) {
    const attributes = match[1] ?? '';
    const body = match[2] ?? '';
    const id = readXmlAttribute(attributes, 'objectid') ?? readXmlAttribute(attributes, 'id');
    if (!id) {
      continue;
    }

    const displayName = firstNonEmpty([
      normalizeOptionalText(readXmlElementText(body, 'name')),
      decodeXmlEntities(readXmlAttributeFromTag(body, 'name', { type: 'primary' }, 'value') ?? '').trim(),
      decodeXmlEntities(readXmlAttributeFromTag(body, 'name', {}, 'value') ?? '').trim(),
    ]);
    if (!displayName) {
      continue;
    }

    items.push({ id, displayName });
  }
  return items;
}

function parseImportResult(value: unknown): WikipediaBoardGameImportResult {
  if (!value || typeof value !== 'object') {
    return { ok: false, error: { type: 'invalid-response', message: 'La resposta del servei no és vàlida.' } };
  }

  const payload = value as {
    ok?: unknown;
    draft?: unknown;
    error?: { type?: unknown; message?: unknown; candidates?: unknown };
  };

  if (payload.ok === false) {
    return {
      ok: false,
      error: {
        type: asImportErrorType(payload.error?.type),
        message: typeof payload.error?.message === 'string' ? payload.error.message : 'No s ha trobat cap coincidencia a Wikipedia.',
        ...(payload.error?.candidates !== undefined ? { candidates: asStringArray(payload.error.candidates) } : {}),
      },
    };
  }

  if (payload.ok === true && isValidDraft(payload.draft)) {
    return { ok: true, draft: normalizeDraft(payload.draft) };
  }

  if (isValidDraft(value)) {
    return { ok: true, draft: normalizeDraft(value) };
  }

  return { ok: false, error: { type: 'invalid-response', message: 'La resposta del servei no és vàlida.' } };
}

function isValidDraft(value: unknown): value is WikipediaBoardGameCatalogDraft {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const draft = value as Partial<WikipediaBoardGameCatalogDraft>;
  return typeof draft.displayName === 'string'
    && typeof draft.itemType === 'string'
    && draft.externalRefs !== undefined
    && draft.metadata !== undefined;
}

function normalizeDraft(draft: WikipediaBoardGameCatalogDraft): WikipediaBoardGameCatalogDraft {
  return {
    ...draft,
    publicationYear: normalizeOptionalInteger(draft.publicationYear),
    playerCountMin: normalizeOptionalInteger(draft.playerCountMin),
    playerCountMax: normalizeOptionalInteger(draft.playerCountMax),
    recommendedAge: normalizeOptionalInteger(draft.recommendedAge),
    playTimeMinutes: normalizeOptionalInteger(draft.playTimeMinutes),
  };
}

function normalizeOptionalInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const match = value.match(/\d+/);
    if (match) {
      return Number(match[0]);
    }
  }

  return null;
}

function asImportErrorType(value: unknown): WikipediaBoardGameImportErrorType {
  if (value === 'ambiguous' || value === 'bad-input' || value === 'connection' || value === 'invalid-response' || value === 'not-found' || value === 'unexpected') {
    return value;
  }

  return 'unexpected';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

function resolveBoardGameGeekCollectionDefinition(value: string): (typeof boardGameGeekCollectionDefinitions)[number] | null {
  const normalizedValue = normalizeSearchText(value);
  if (!normalizedValue) {
    return null;
  }

  return boardGameGeekCollectionDefinitions.find((definition) => {
    if (normalizeSearchText(definition.key) === normalizedValue) {
      return true;
    }

    return definition.aliases.some((alias) => normalizeSearchText(alias) === normalizedValue);
  }) ?? null;
}

function mapBoardGameGeekCollectionError(
  error: unknown,
  {
    username,
    stage,
    collectionKey,
    collectionName,
    canRetryManually,
  }: {
    username: string;
    stage: BoardGameGeekCollectionErrorStage;
    collectionKey?: BoardGameGeekCollectionKey;
    collectionName?: string | null;
    canRetryManually: boolean;
  },
): BoardGameGeekCollectionError {
  const optionalContext = {
    ...(collectionKey ? { collectionKey } : {}),
    ...(collectionName ? { collectionName } : {}),
  };

  if (error instanceof BoardGameGeekLookupError) {
    if (error.httpStatus === 401) {
      return {
        type: 'connection',
        stage,
        reason: 'auth-invalid',
        message: 'BoardGameGeek authentication failed.',
        username,
        httpStatus: 401,
        canRetryManually: false,
        ...optionalContext,
      };
    }

    if (error.httpStatus === 404) {
      return {
        type: 'not-found',
        stage,
        reason: 'no-importable-items',
        message: 'BoardGameGeek did not find importable items for this request.',
        username,
        httpStatus: 404,
        canRetryManually: false,
        ...optionalContext,
      };
    }

    if (error.kind === 'not-ready') {
      return {
        type: 'connection',
        stage,
        reason: 'not-ready',
        message: 'BoardGameGeek did not become ready in time.',
        username,
        canRetryManually,
        ...optionalContext,
      };
    }

    return {
      type: 'connection',
      stage,
      reason: 'http-error',
      message: 'BoardGameGeek returned an HTTP error.',
      username,
      canRetryManually,
      ...(typeof error.httpStatus === 'number' ? { httpStatus: error.httpStatus } : {}),
      ...optionalContext,
    };
  }

  return {
    type: 'unexpected',
    stage,
    reason: 'unexpected',
    message: error instanceof Error ? error.message : 'Unexpected BoardGameGeek error.',
    username,
    canRetryManually,
    ...optionalContext,
  };
}

async function fetchBoardGameGeekXml(fetchImpl: typeof fetch, url: string, apiKey: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/xml, text/xml;q=0.9, */*;q=0.1',
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (response.status === 202) {
      await wait(1200 * (attempt + 1));
      continue;
    }

    if (!response.ok) {
      throw new BoardGameGeekLookupError(`BoardGameGeek lookup failed with status ${response.status}`, 'http', response.status);
    }

    return response.text();
  }

  throw new BoardGameGeekLookupError('BoardGameGeek lookup did not become ready in time', 'not-ready');
}

function parseBoardGameGeekSearchResults(xml: string): BoardGameGeekCandidate[] {
  const matches = [...xml.matchAll(/<item\b([^>]*)>([\s\S]*?)<\/item>/g)];
  const candidates: BoardGameGeekCandidate[] = [];

  for (const match of matches) {
    const attributes = match[1] ?? '';
    const body = match[2] ?? '';
    const id = readXmlAttribute(attributes, 'id');
    if (!id) {
      continue;
    }

    const names = [...body.matchAll(/<name\b[^>]*value=("([^"]*)"|'([^']*)')[^>]*\/?/g)]
      .map((nameMatch) => decodeXmlEntities(nameMatch[2] ?? nameMatch[3] ?? '').trim())
      .filter((value) => value.length > 0);
    const primaryName = firstNonEmpty([
      decodeXmlEntities(readXmlAttributeFromTag(body, 'name', { type: 'primary' }, 'value') ?? '').trim(),
      ...names,
    ]);

    if (!primaryName) {
      continue;
    }

    candidates.push({
      id,
      names,
      primaryName,
      yearPublished: parseOptionalInteger(readXmlAttributeFromTag(body, 'yearpublished', {}, 'value')),
    });
  }

  return candidates;
}

function chooseBoardGameGeekCandidate(
  title: string,
  candidates: BoardGameGeekCandidate[],
):
  | { kind: 'selected'; candidate: BoardGameGeekCandidate }
  | { kind: 'ambiguous'; candidates: BoardGameGeekCandidate[] } {
  const normalizedTitle = normalizeSearchText(title);
  const exactPrimaryMatches = candidates.filter((candidate) => normalizeSearchText(candidate.primaryName) === normalizedTitle);
  const singleExactPrimaryMatch = exactPrimaryMatches[0];
  if (exactPrimaryMatches.length === 1 && singleExactPrimaryMatch) {
    return { kind: 'selected', candidate: singleExactPrimaryMatch };
  }
  if (exactPrimaryMatches.length > 1) {
    return { kind: 'ambiguous', candidates: exactPrimaryMatches.slice(0, 8) };
  }

  const exactNameMatches = candidates.filter((candidate) => candidate.names.some((name) => normalizeSearchText(name) === normalizedTitle));
  const singleExactNameMatch = exactNameMatches[0];
  if (exactNameMatches.length === 1 && singleExactNameMatch) {
    return { kind: 'selected', candidate: singleExactNameMatch };
  }
  if (exactNameMatches.length > 1) {
    return { kind: 'ambiguous', candidates: exactNameMatches.slice(0, 8) };
  }

  const prefixMatches = candidates.filter((candidate) => {
    return candidate.names.some((name) => normalizeSearchText(name).startsWith(normalizedTitle));
  });
  const singlePrefixMatch = prefixMatches[0];
  if (prefixMatches.length === 1 && singlePrefixMatch) {
    return { kind: 'selected', candidate: singlePrefixMatch };
  }

  const tokenMatches = candidates.filter((candidate) => {
    return candidate.names.some((name) => normalizeSearchText(name).includes(normalizedTitle));
  });
  const singleTokenMatch = tokenMatches[0];
  if (tokenMatches.length === 1 && singleTokenMatch) {
    return { kind: 'selected', candidate: singleTokenMatch };
  }

  const ambiguousCandidates = (prefixMatches.length > 1 ? prefixMatches : tokenMatches.length > 1 ? tokenMatches : candidates)
    .slice(0, 8);
  return { kind: 'ambiguous', candidates: ambiguousCandidates };
}

function formatBoardGameGeekCandidateLabel(candidate: BoardGameGeekCandidate): string {
  return `${candidate.primaryName}${candidate.yearPublished ? ` (${candidate.yearPublished})` : ''} [API #${candidate.id}]`;
}

function parseBoardGameGeekCandidateId(value: string): string | null {
  const match = value.match(/\[API #(\d+)\]\s*$/i);
  return match?.[1] ?? null;
}

function parseBoardGameGeekThing(xml: string, itemId: string): WikipediaBoardGameCatalogDraft | null {
  const itemMatch = [...xml.matchAll(/<item\b([^>]*)>([\s\S]*?)<\/item>/g)].find((match) => readXmlAttribute(match[1] ?? '', 'id') === itemId);
  if (!itemMatch) {
    return null;
  }

  const attributes = itemMatch[1] ?? '';
  const body = itemMatch[2] ?? '';
  const bggUrl = `https://boardgamegeek.com/boardgame/${itemId}`;
  const publishers = readXmlLinkValues(body, 'boardgamepublisher');
  const designers = readXmlLinkValues(body, 'boardgamedesigner');
  const artists = readXmlLinkValues(body, 'boardgameartist');
  const categories = readXmlLinkValues(body, 'boardgamecategory');
  const mechanics = readXmlLinkValues(body, 'boardgamemechanic');
  const families = readXmlLinkValues(body, 'boardgamefamily');
  const displayName = firstNonEmpty([
    decodeXmlEntities(readXmlAttributeFromTag(body, 'name', { type: 'primary' }, 'value') ?? '').trim(),
    decodeXmlEntities(readXmlAttributeFromTag(body, 'name', {}, 'value') ?? '').trim(),
  ]);
  if (!displayName) {
    return null;
  }

  return {
    familyId: null,
    groupId: null,
    itemType: readXmlAttribute(attributes, 'type') === 'boardgameexpansion' ? 'expansion' : 'board-game',
    displayName,
    originalName: displayName,
    description: normalizeOptionalText(readXmlElementText(body, 'description')),
    language: null,
    publisher: publishers[0] ?? null,
    publicationYear: parseOptionalInteger(readXmlAttributeFromTag(body, 'yearpublished', {}, 'value')),
    playerCountMin: parseOptionalInteger(readXmlAttributeFromTag(body, 'minplayers', {}, 'value')),
    playerCountMax: parseOptionalInteger(readXmlAttributeFromTag(body, 'maxplayers', {}, 'value')),
    recommendedAge: parseOptionalInteger(readXmlAttributeFromTag(body, 'minage', {}, 'value')),
    playTimeMinutes: parseOptionalInteger(readXmlAttributeFromTag(body, 'playingtime', {}, 'value')),
    externalRefs: {
      boardGameGeekId: itemId,
      boardGameGeekUrl: bggUrl,
    },
    metadata: {
      source: 'boardgamegeek',
      boardGameGeekId: itemId,
      boardGameGeekUrl: bggUrl,
      imageUrl: normalizeOptionalText(readXmlElementText(body, 'image')),
      thumbnailUrl: normalizeOptionalText(readXmlElementText(body, 'thumbnail')),
      rank: parseOptionalInteger(readXmlAttributeFromTag(body, 'rank', { name: 'boardgame' }, 'value')),
      designers,
      artists,
      publishers,
      categories,
      mechanics,
      families,
    },
  };
}

function readXmlAttribute(attributes: string, attributeName: string): string | null {
  const match = attributes.match(new RegExp(`${escapeRegExp(attributeName)}=("([^"]*)"|'([^']*)')`, 'i'));
  return match ? decodeXmlEntities(match[2] ?? match[3] ?? '') : null;
}

function readXmlAttributeFromTag(
  xml: string,
  tagName: string,
  requiredAttributes: Record<string, string>,
  attributeName: string,
): string | null {
  const tags = [...xml.matchAll(new RegExp(`<${escapeRegExp(tagName)}\\b([^>]*)\\/?>(?:[^<]*)`, 'gi'))];
  for (const tag of tags) {
    const attributes = tag[1] ?? '';
    const matchesRequiredAttributes = Object.entries(requiredAttributes).every(([name, value]) => readXmlAttribute(attributes, name) === value);
    if (!matchesRequiredAttributes) {
      continue;
    }
    const attributeValue = readXmlAttribute(attributes, attributeName);
    if (attributeValue !== null) {
      return attributeValue;
    }
  }

  return null;
}

function readXmlElementText(xml: string, tagName: string): string | null {
  const match = xml.match(new RegExp(`<${escapeRegExp(tagName)}\\b[^>]*>([\\s\\S]*?)<\/${escapeRegExp(tagName)}>`, 'i'));
  if (!match) {
    return null;
  }

  return decodeXmlEntities(match[1] ?? '');
}

function readXmlLinkValues(xml: string, type: string): string[] {
  return [...xml.matchAll(/<link\b([^>]*)\/?>(?:[^<]*)/gi)]
    .map((match) => match[1] ?? '')
    .filter((attributes) => readXmlAttribute(attributes, 'type') === type)
    .map((attributes) => readXmlAttribute(attributes, 'value'))
    .filter((value): value is string => Boolean(value && value.trim().length > 0));
}

function parseOptionalInteger(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function normalizeOptionalText(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .replace(/\r\n/g, '\n')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .trim();
  return normalized.length > 0 ? normalized : null;
}

function firstNonEmpty(values: Array<string | null>): string | null {
  for (const value of values) {
    if (value && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|amp|apos|gt|lt|quot);/gi, (entity, code: string) => {
    const normalizedCode = code.toLowerCase();
    if (normalizedCode === 'amp') {
      return '&';
    }
    if (normalizedCode === 'apos') {
      return "'";
    }
    if (normalizedCode === 'gt') {
      return '>';
    }
    if (normalizedCode === 'lt') {
      return '<';
    }
    if (normalizedCode === 'quot') {
      return '"';
    }
    if (normalizedCode.startsWith('#x')) {
      return String.fromCodePoint(Number.parseInt(normalizedCode.slice(2), 16));
    }
    if (normalizedCode.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(normalizedCode.slice(1), 10));
    }
    return entity;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
