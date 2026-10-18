import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import type { CatalogItemRecord } from '../catalog/catalog-model.js';
import { catalogNameMetadataVersion, isUsableCatalogTitle, mergeCatalogNameMetadata, preserveCatalogDisplayName } from '../catalog/catalog-names.js';
import { createDatabaseCatalogRepository } from '../catalog/catalog-store.js';
import { importBoardGameGeekItemsByIds, parseBoardGameGeekCandidateId, type WikipediaBoardGameImportResult, type WikipediaBoardGameImportService } from '../catalog/wikipedia-boardgame-import-service.js';
import { loadRuntimeConfig } from '../config/load-runtime-config.js';
import { connectPostgresDatabase, createPostgresConnectionString } from '../infrastructure/database/connection.js';

export interface CatalogNameUpdate {
  item: CatalogItemRecord;
  displayName: string;
  originalName: string | null;
  metadata: Record<string, unknown>;
}

export interface CatalogNameUpdateSummary {
  scanned: number;
  eligible: number;
  processed: number;
  updated: number;
  wouldUpdate: number;
  renamed: number;
  spanishNamesFound: number;
  failed: number;
  conflicts: number;
}

/** BGG backfills share one paced HTTP queue, including retries and HTTP 202 polling. */
export function createCatalogNameFetch({
  fetchImpl = fetch, wait = delay, now = Date.now,
}: {
  fetchImpl?: typeof fetch;
  wait?: (milliseconds: number) => Promise<unknown>;
  now?: () => number;
} = {}): typeof fetch {
  let previousStart: number | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  return (input, init) => {
    const result = queue.then(async () => {
      for (let attempt = 0; ; attempt += 1) {
        if (previousStart !== null) {
          const remaining = 5000 - (now() - previousStart);
          if (remaining > 0) await wait(remaining);
        }
        previousStart = now();
        const timeout = AbortSignal.timeout(30_000);
        const response = await fetchImpl(input, {
          ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
        });
        if (![429, 502, 503, 504].includes(response.status) || attempt >= 3) return response;
        const retryAfter = response.headers.get('retry-after')?.trim();
        let retryDelay = 10_000 * 2 ** attempt;
        if (retryAfter) {
          const requested = /^\d+(?:\.\d+)?$/.test(retryAfter)
            ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now();
          if (Number.isFinite(requested) && requested >= 0) retryDelay = requested;
        }
        // Release retry responses before waiting so a long backfill does not retain sockets.
        await response.body?.cancel();
        await wait(Math.min(60_000, retryDelay));
      }
    });
    queue = result.then(() => {}, () => {});
    return result;
  };
}

export function catalogNameUpdateBggId(item: CatalogItemRecord): string | null {
  for (const value of [item.externalRefs?.boardGameGeekId, item.metadata?.boardGameGeekId]) {
    if ((typeof value === 'string' || typeof value === 'number') && /^[1-9]\d*$/.test(String(value))) return String(value);
  }
  return null;
}

function needsCatalogNameUpdate(item: CatalogItemRecord): boolean {
  const publishers = Array.isArray(item.metadata?.publishers) ? item.metadata.publishers.filter((name): name is string => typeof name === 'string') : [];
  const spanishNames = [item.metadata?.spanishName, ...(Array.isArray(item.metadata?.spanishNames) ? item.metadata.spanishNames : [])];
  const corrupted = !isUsableCatalogTitle(item.displayName, publishers)
    || spanishNames.some((name) => typeof name === 'string' && !isUsableCatalogTitle(name, publishers));
  return item.lifecycleStatus === 'active' && (item.itemType === 'board-game' || item.itemType === 'expansion')
    && (item.metadata?.nameMetadataVersion !== catalogNameMetadataVersion || corrupted) && catalogNameUpdateBggId(item) !== null;
}

/** Reuse one BGG response for up to 20 pending IDs, including repeated physical copies. */
export function createCatalogNameBatchImportService({
  items, bggApiKey, fetchImpl, limit,
}: {
  items: CatalogItemRecord[];
  bggApiKey: string;
  fetchImpl: typeof fetch;
  limit?: number;
}): WikipediaBoardGameImportService {
  const ids = [...new Set(items.filter(needsCatalogNameUpdate).slice(0, limit).map((item) => catalogNameUpdateBggId(item)!))];
  const cache = new Map<string, WikipediaBoardGameImportResult>();
  return {
    async importByTitle(title) {
      const id = parseBoardGameGeekCandidateId(title);
      if (!id || !ids.includes(id)) return { ok: false, error: { type: 'bad-input', message: 'El ID no pertenece a los juegos pendientes.' } };
      if (!cache.has(id)) {
        const batch = ids.slice(ids.indexOf(id), ids.indexOf(id) + 20);
        try {
          const drafts = await importBoardGameGeekItemsByIds({ bggApiKey, fetchImpl, itemIds: batch });
          for (const batchId of batch) {
            const draft = drafts.find((candidate) => String(candidate.externalRefs?.boardGameGeekId) === batchId);
            cache.set(batchId, draft ? { ok: true, draft } : { ok: false, error: { type: 'not-found', message: 'BGG no devolvió este juego.' } });
          }
        } catch {
          for (const batchId of batch) cache.set(batchId, { ok: false, error: { type: 'connection', message: 'No se pudo cargar el lote de BGG.' } });
        }
      }
      return cache.get(id)!;
    },
  };
}

export async function updateCatalogNames({
  items, importService, save, dryRun = false, limit, wait = delay, onProgress = () => {},
}: {
  items: CatalogItemRecord[];
  importService: WikipediaBoardGameImportService;
  save(update: CatalogNameUpdate): Promise<boolean>;
  dryRun?: boolean;
  limit?: number;
  wait?: (milliseconds: number) => Promise<unknown>;
  onProgress?: (progress: { itemId: number; status: 'updated' | 'would-update' | 'failed' | 'conflict' }) => void;
}): Promise<CatalogNameUpdateSummary> {
  const candidates = items.filter(needsCatalogNameUpdate);
  const summary: CatalogNameUpdateSummary = {
    scanned: items.length, eligible: candidates.length, processed: 0, updated: 0,
    wouldUpdate: 0, renamed: 0, spanishNamesFound: 0, failed: 0, conflicts: 0,
  };
  for (const item of candidates.slice(0, limit)) {
    // Serial requests plus this pause keep the rate below one request per second.
    if (summary.processed) await wait(1000);
    summary.processed += 1;
    try {
      const result = await importService.importByTitle(`https://boardgamegeek.com/boardgame/${catalogNameUpdateBggId(item)}`);
      if (!result.ok || result.draft.metadata?.source !== 'boardgamegeek'
        || result.draft.metadata?.nameMetadataVersion !== catalogNameMetadataVersion) {
        summary.failed += 1;
        onProgress({ itemId: item.id, status: 'failed' });
        continue;
      }
      const imported = result.draft;
      const importedNames: Record<string, unknown> = {};
      for (const key of ['alternateNames', 'spanishName', 'spanishNames', 'nameMetadataVersion']) {
        if (imported.metadata?.[key] !== undefined) importedNames[key] = imported.metadata[key];
      }
      const metadata = mergeCatalogNameMetadata(item.metadata, { ...item.metadata, ...importedNames },
        [item.displayName, item.originalName ?? '', imported.displayName, imported.originalName ?? ''])!;
      const update: CatalogNameUpdate = {
        item, metadata, displayName: preserveCatalogDisplayName(item, imported),
        originalName: item.originalName ?? imported.originalName,
      };
      if (dryRun) {
        summary.wouldUpdate += 1;
        onProgress({ itemId: item.id, status: 'would-update' });
      } else if (await save(update)) {
        summary.updated += 1;
        onProgress({ itemId: item.id, status: 'updated' });
      } else {
        summary.conflicts += 1;
        onProgress({ itemId: item.id, status: 'conflict' });
        continue;
      }
      if (update.displayName !== item.displayName) summary.renamed += 1;
      if (metadata.spanishName) summary.spanishNamesFound += 1;
    } catch {
      // Provider/SQL exception messages may contain credentials or response data.
      summary.failed += 1;
      onProgress({ itemId: item.id, status: 'failed' });
    }
  }
  return summary;
}

export function parseCatalogNameUpdateOptions(argv: string[]): { dryRun: boolean; limit?: number; help: boolean } {
  const options: { dryRun: boolean; limit?: number; help: boolean } = { dryRun: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--limit') {
      const value = argv[++index];
      if (!value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('El límite debe ser un entero positivo.');
      options.limit = Number(value);
    } else throw new Error('Opción no reconocida. Use --help.');
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseCatalogNameUpdateOptions(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('Uso: node --import tsx src/scripts/update-catalog-names.ts [--dry-run] [--limit N]\nConsulta BGG y completa los nombres pendientes; --dry-run consulta sin escribir.\n');
    return;
  }
  const config = await loadRuntimeConfig();
  if (!config.bgg?.apiKey) throw new Error('Falta configurar la clave de API de BGG.');
  const database = await connectPostgresDatabase({
    connectionString: createPostgresConnectionString(config.database), ssl: config.database.ssl,
    logger: { error() { process.stderr.write('Error de conexión a PostgreSQL.\n'); } },
  });
  try {
    const repository = createDatabaseCatalogRepository({ database: database.db });
    const items = await repository.listItems({ includeDeactivated: false });
    const summary = await updateCatalogNames({
      items,
      importService: createCatalogNameBatchImportService({
        items, bggApiKey: config.bgg.apiKey, fetchImpl: createCatalogNameFetch(),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
      }),
      dryRun: options.dryRun, ...(options.limit === undefined ? {} : { limit: options.limit }),
      onProgress: (progress) => process.stdout.write(`${JSON.stringify(progress)}\n`),
      async save(update) {
        // Compare the original name fields and metadata: unrelated concurrent edits are preserved.
        const result = await database.pool.query<{ id: number }>(`
          with updated as (
            update catalog_items set display_name=$1, original_name=$2, metadata=$3::jsonb, updated_at=now()
            where id=$4 and lifecycle_status='active' and display_name=$5
              and original_name is not distinct from $6 and metadata is not distinct from $7::jsonb
            returning id
          ), audited as (
            insert into audit_log (action_key, target_type, target_id, summary, details)
            select 'catalog.item.names_backfilled', 'catalog-item', id::text,
              'Nombres de catálogo completados desde BGG', $8::jsonb from updated returning id
          ) select id from updated`, [
          update.displayName, update.originalName, JSON.stringify(update.metadata), update.item.id,
          update.item.displayName, update.item.originalName, update.item.metadata === null ? null : JSON.stringify(update.item.metadata),
          JSON.stringify({ boardGameGeekId: catalogNameUpdateBggId(update.item), renamed: update.displayName !== update.item.displayName }),
        ]);
        return result.rows.length > 0;
      },
    });
    process.stdout.write(`${JSON.stringify({ dryRun: options.dryRun, ...summary })}\n`);
    if (summary.failed || summary.conflicts) process.exitCode = 1;
  } finally {
    await database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write('No se pudo completar la actualización de nombres. Revise los argumentos, la configuración, PostgreSQL y la clave BGG.\n');
    process.exitCode = 1;
  });
}
