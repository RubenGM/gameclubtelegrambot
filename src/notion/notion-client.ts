const defaultNotionApiBaseUrl = 'https://api.notion.com/v1';
const defaultNotionVersion = '2026-03-11';
const defaultRequestTimeoutMs = 30_000;
const defaultMaxRetries = 3;
const defaultMaxBlocks = 1_000;
const defaultMaxDepth = 12;
const defaultMaxDownloadBytes = 20 * 1024 * 1024;

export interface NotionLogger {
  info(bindings: object, message: string): void;
  warn?(bindings: object, message: string): void;
}

export interface NotionClientOptions {
  apiToken: string;
  notionVersion?: string;
  apiBaseUrl?: string;
  requestTimeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  logger?: NotionLogger;
}

export interface NotionReadDocumentOptions {
  maxBlocks?: number;
  maxDepth?: number;
}

export interface NotionPageReference {
  pageId: string;
  canonicalUrl: string;
}

export interface NotionPage {
  id: string;
  url: string | null;
  title: string;
  lastEditedTime: string | null;
  archived: boolean;
  inTrash: boolean;
  raw: Record<string, unknown>;
}

export interface NotionBlock {
  id: string;
  type: string;
  hasChildren: boolean;
  archived: boolean;
  inTrash: boolean;
  raw: Record<string, unknown>;
  children: NotionBlock[];
}

export interface NotionPageDocument {
  page: NotionPage;
  blocks: NotionBlock[];
  blockCount: number;
  truncated: boolean;
}

export interface NotionFile {
  kind: 'notion_file' | 'external';
  url: string;
  expiryTime: string | null;
  name: string | null;
}

export interface NotionDownloadedFile {
  bytes: Uint8Array;
  contentType: string | null;
  filename: string | null;
}

export interface NotionClient {
  retrievePage(pageReference: string): Promise<NotionPage>;
  retrieveBlock(blockId: string): Promise<NotionBlock>;
  listBlockChildren(blockId: string): Promise<NotionBlock[]>;
  readPageDocument(pageReference: string, options?: NotionReadDocumentOptions): Promise<NotionPageDocument>;
  extractFile(block: NotionBlock): NotionFile | null;
  refreshBlockFile(blockId: string): Promise<NotionFile | null>;
  downloadFile(file: NotionFile, options?: { maxBytes?: number }): Promise<NotionDownloadedFile>;
}

export class NotionClientError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { status?: number | null; code?: string | null; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'NotionClientError';
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.retryable = options.retryable ?? false;
  }
}

/**
 * Extracts a Notion UUID only from a UUID itself or from an official Notion URL
 * (notion.so, notion.site, or app.notion.com). This deliberately rejects
 * arbitrary URLs: page references are data, never fetch targets.
 */
export function parseNotionPageReference(value: string): NotionPageReference {
  const candidate = value.trim();
  const pageId = normalizeNotionId(candidate);
  if (pageId) {
    return { pageId, canonicalUrl: `https://www.notion.so/${pageId.replaceAll('-', '')}` };
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new NotionClientError('La referencia de Notion no es una URL o ID de página válido.');
  }

  if (url.protocol !== 'https:' || !isNotionHostname(url.hostname)) {
    throw new NotionClientError('La URL debe pertenecer a Notion (notion.so, notion.site o app.notion.com) y usar HTTPS.');
  }

  const idFromPath = [...url.pathname.matchAll(/(?:^|[^a-f0-9])([a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?:$|[^a-f0-9])/gi)]
    .map((match) => match[1])
    .at(-1);
  const normalized = idFromPath ? normalizeNotionId(idFromPath) : null;
  if (!normalized) {
    throw new NotionClientError('La URL de Notion no contiene un ID de página válido.');
  }

  return { pageId: normalized, canonicalUrl: url.toString() };
}

export function createNotionClient(options: NotionClientOptions): NotionClient {
  const apiToken = options.apiToken.trim();
  if (!apiToken) {
    throw new NotionClientError('Falta el token de la integración de Notion.');
  }

  const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl ?? defaultNotionApiBaseUrl);
  const notionVersion = (options.notionVersion ?? defaultNotionVersion).trim();
  const requestTimeoutMs = positiveInteger(options.requestTimeoutMs ?? defaultRequestTimeoutMs, 'requestTimeoutMs');
  const maxRetries = nonNegativeInteger(options.maxRetries ?? defaultMaxRetries, 'maxRetries');
  const requestFetch = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  if (typeof requestFetch !== 'function') {
    throw new NotionClientError('Fetch no está disponible para conectar con Notion.');
  }

  async function requestJson(path: string): Promise<Record<string, unknown>> {
    const url = new URL(path, `${apiBaseUrl}/`);
    let attempt = 0;

    while (true) {
      let response: Response;
      try {
        response = await requestFetch(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${apiToken}`,
            'Notion-Version': notionVersion,
          },
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
      } catch (error) {
        const retryable = isRetryableFetchError(error);
        if (retryable && attempt < maxRetries) {
          await retry(attempt++, null, url.pathname);
          continue;
        }
        throw new NotionClientError('No se pudo conectar con Notion.', { retryable });
      }

      const body = await readJsonResponse(response);
      if (response.ok) {
        return body;
      }

      const code = typeof body.code === 'string' ? body.code : null;
      const message = typeof body.message === 'string' ? body.message : 'Notion rechazó la solicitud.';
      const retryable = isRetryableStatus(response.status);
      if (retryable && attempt < maxRetries) {
        await retry(attempt++, response.headers.get('retry-after'), url.pathname);
        continue;
      }

      throw new NotionClientError(`Notion respondió ${response.status}: ${message}`, {
        status: response.status,
        code,
        retryable,
      });
    }
  }

  async function retry(attempt: number, retryAfter: string | null, path: string): Promise<void> {
    const retryAfterMs = parseRetryAfterMilliseconds(retryAfter);
    const delayMs = retryAfterMs ?? Math.min(10_000, 500 * 2 ** attempt);
    options.logger?.warn?.({ notion: { path, attempt: attempt + 1, delayMs } }, 'Retrying Notion read request');
    await sleep(delayMs);
  }

  async function retrievePage(pageReference: string): Promise<NotionPage> {
    const { pageId } = parseNotionPageReference(pageReference);
    const raw = await requestJson(`pages/${encodeURIComponent(pageId)}`);
    return parsePage(raw);
  }

  async function retrieveBlock(blockId: string): Promise<NotionBlock> {
    const normalizedBlockId = requireNotionId(blockId, 'block');
    const raw = await requestJson(`blocks/${encodeURIComponent(normalizedBlockId)}`);
    return parseBlock(raw);
  }

  async function listBlockChildren(blockId: string): Promise<NotionBlock[]> {
    const normalizedBlockId = requireNotionId(blockId, 'block');
    const blocks: NotionBlock[] = [];
    let cursor: string | null = null;

    do {
      const params = new URLSearchParams({ page_size: '100' });
      if (cursor) {
        params.set('start_cursor', cursor);
      }
      const response = await requestJson(`blocks/${encodeURIComponent(normalizedBlockId)}/children?${params.toString()}`);
      const results = Array.isArray(response.results) ? response.results : null;
      if (!results) {
        throw new NotionClientError('Notion devolvió una lista de bloques inválida.');
      }
      blocks.push(...results.map(parseBlock));
      cursor = response.has_more === true && typeof response.next_cursor === 'string' ? response.next_cursor : null;
    } while (cursor);

    return blocks;
  }

  async function readPageDocument(pageReference: string, readOptions: NotionReadDocumentOptions = {}): Promise<NotionPageDocument> {
    const maxBlocks = positiveInteger(readOptions.maxBlocks ?? defaultMaxBlocks, 'maxBlocks');
    const maxDepth = nonNegativeInteger(readOptions.maxDepth ?? defaultMaxDepth, 'maxDepth');
    const page = await retrievePage(pageReference);
    let blockCount = 0;
    let truncated = false;

    async function loadChildren(parentBlockId: string, depth: number): Promise<NotionBlock[]> {
      if (depth > maxDepth || blockCount >= maxBlocks) {
        truncated = true;
        return [];
      }
      const siblings = await listBlockChildren(parentBlockId);
      const selected = siblings.slice(0, Math.max(0, maxBlocks - blockCount));
      if (selected.length < siblings.length) {
        truncated = true;
      }
      blockCount += selected.length;

      for (const block of selected) {
        if (block.hasChildren) {
          block.children = await loadChildren(block.id, depth + 1);
        }
      }
      return selected;
    }

    const blocks = await loadChildren(page.id, 0);
    return { page, blocks, blockCount, truncated };
  }

  function extractFile(block: NotionBlock): NotionFile | null {
    return extractNotionFile(block.raw);
  }

  async function refreshBlockFile(blockId: string): Promise<NotionFile | null> {
    return extractFile(await retrieveBlock(blockId));
  }

  async function downloadFile(file: NotionFile, downloadOptions: { maxBytes?: number } = {}): Promise<NotionDownloadedFile> {
    const maxBytes = positiveInteger(downloadOptions.maxBytes ?? defaultMaxDownloadBytes, 'maxBytes');
    const url = assertSafeDownloadUrl(file.url);
    let response: Response;
    try {
      response = await requestFetch(url, { method: 'GET', signal: AbortSignal.timeout(requestTimeoutMs) });
    } catch {
      throw new NotionClientError('No se pudo descargar el adjunto de Notion.', { retryable: true });
    }
    if (!response.ok) {
      throw new NotionClientError(`No se pudo descargar el adjunto de Notion (HTTP ${response.status}).`, {
        status: response.status,
        retryable: isRetryableStatus(response.status),
      });
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new NotionClientError(`El adjunto de Notion supera el límite de ${maxBytes} bytes.`);
    }
    return {
      bytes: await readResponseBytes(response, maxBytes),
      contentType: response.headers.get('content-type'),
      filename: file.name ?? filenameFromUrl(url),
    };
  }

  return { retrievePage, retrieveBlock, listBlockChildren, readPageDocument, extractFile, refreshBlockFile, downloadFile };
}

export function extractNotionFile(rawBlock: Record<string, unknown>): NotionFile | null {
  const blockType = typeof rawBlock.type === 'string' ? rawBlock.type : null;
  if (!blockType) {
    return null;
  }
  const payload = asRecord(rawBlock[blockType]);
  const file = asRecord(payload?.file);
  const external = asRecord(payload?.external);
  const notionUrl = typeof file?.url === 'string' ? file.url : null;
  const externalUrl = typeof external?.url === 'string' ? external.url : null;
  const name = extractRichTextPlainText(payload?.caption);

  if (notionUrl) {
    return {
      kind: 'notion_file',
      url: notionUrl,
      expiryTime: typeof file?.expiry_time === 'string' ? file.expiry_time : null,
      name,
    };
  }
  if (externalUrl) {
    return { kind: 'external', url: externalUrl, expiryTime: null, name };
  }
  return null;
}

function parsePage(raw: Record<string, unknown>): NotionPage {
  const id = requireNotionId(typeof raw.id === 'string' ? raw.id : '', 'page');
  return {
    id,
    url: typeof raw.url === 'string' ? raw.url : null,
    title: extractPageTitle(raw),
    lastEditedTime: typeof raw.last_edited_time === 'string' ? raw.last_edited_time : null,
    archived: raw.archived === true,
    inTrash: raw.in_trash === true,
    raw,
  };
}

function parseBlock(value: unknown): NotionBlock {
  const raw = asRecord(value);
  if (!raw) {
    throw new NotionClientError('Notion devolvió un bloque inválido.');
  }
  const id = requireNotionId(typeof raw.id === 'string' ? raw.id : '', 'block');
  if (typeof raw.type !== 'string' || !raw.type) {
    throw new NotionClientError('Notion devolvió un bloque sin tipo.');
  }
  return {
    id,
    type: raw.type,
    hasChildren: raw.has_children === true,
    archived: raw.archived === true,
    inTrash: raw.in_trash === true,
    raw,
    children: [],
  };
}

function extractPageTitle(raw: Record<string, unknown>): string {
  const properties = asRecord(raw.properties);
  if (!properties) {
    return 'Página sin título';
  }
  for (const property of Object.values(properties)) {
    const record = asRecord(property);
    if (record?.type !== 'title' || !Array.isArray(record.title)) {
      continue;
    }
    const title = record.title
      .map((part) => asRecord(part))
      .map((part) => (typeof part?.plain_text === 'string' ? part.plain_text : ''))
      .join('')
      .trim();
    return title || 'Página sin título';
  }
  return 'Página sin título';
}

function normalizeApiBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new NotionClientError('La URL de la API de Notion no es válida.');
  }
  if (url.protocol !== 'https:') {
    throw new NotionClientError('La URL de la API de Notion debe usar HTTPS.');
  }
  return url.toString().replace(/\/$/, '');
}

function normalizeNotionId(value: string): string | null {
  const compact = value.replaceAll('-', '').toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(compact)) {
    return null;
  }
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function requireNotionId(value: string, resource: string): string {
  const normalized = normalizeNotionId(value);
  if (!normalized) {
    throw new NotionClientError(`El ID de ${resource} de Notion no es válido.`);
  }
  return normalized;
}

function isNotionHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'notion.so'
    || normalized.endsWith('.notion.so')
    || normalized === 'notion.site'
    || normalized.endsWith('.notion.site')
    || normalized === 'app.notion.com';
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new NotionClientError(`${name} debe ser un entero positivo.`);
  }
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new NotionClientError(`${name} debe ser un entero no negativo.`);
  }
  return value;
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return asRecord(parsed) ?? {};
  } catch {
    throw new NotionClientError('Notion devolvió JSON inválido.', { status: response.status });
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 529 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isRetryableFetchError(error: unknown): boolean {
  return !(error instanceof DOMException && error.name === 'AbortError') && !(error instanceof Error && error.name === 'TimeoutError');
}

function parseRetryAfterMilliseconds(value: string | null): number | null {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value.trim())) {
    return null;
  }
  return Math.min(60_000, Math.ceil(Number(value) * 1000));
}

function assertSafeDownloadUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new NotionClientError('La URL del adjunto de Notion no es válida.');
  }
  if (url.protocol !== 'https:' || isPrivateHostname(url.hostname)) {
    throw new NotionClientError('La URL del adjunto no es un destino HTTPS público permitido.');
  }
  return url;
}

function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) {
    return true;
  }
  if (
    normalized === '0.0.0.0' ||
    /^127\./.test(normalized) ||
    /^10\./.test(normalized) ||
    /^192\.168\./.test(normalized) ||
    /^169\.254\./.test(normalized)
  ) {
    return true;
  }
  const match172 = /^172\.(\d{1,3})\./.exec(normalized);
  if (match172 && Number(match172[1]) >= 16 && Number(match172[1]) <= 31) {
    return true;
  }
  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
}

async function readResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    return new Uint8Array(await response.arrayBuffer());
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new NotionClientError(`El adjunto de Notion supera el límite de ${maxBytes} bytes.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function filenameFromUrl(url: URL): string | null {
  const filename = url.pathname.split('/').filter(Boolean).at(-1);
  return filename ? decodeURIComponent(filename) : null;
}

function extractRichTextPlainText(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const text = value
    .map((part) => asRecord(part))
    .map((part) => (typeof part?.plain_text === 'string' ? part.plain_text : ''))
    .join('')
    .trim();
  return text || null;
}
