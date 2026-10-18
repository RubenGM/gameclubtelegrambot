import { pathToFileURL } from 'node:url';
import type { CatalogItemRecord } from '../catalog/catalog-model.js';
import { mergeCatalogNameMetadata, preserveCatalogDisplayName } from '../catalog/catalog-names.js';
import { createCatalogSpanishNameResolver, resolveCatalogSpanishNames, spanishNameResolutionVersion, type CatalogSpanishNameResolver } from '../catalog/catalog-spanish-names.js';
import { createDatabaseCatalogRepository } from '../catalog/catalog-store.js';
import { loadRuntimeConfig } from '../config/load-runtime-config.js';
import { connectPostgresDatabase, createPostgresConnectionString } from '../infrastructure/database/connection.js';

export async function updateCatalogSpanishNames({ items, resolver, save, onProgress = () => {} }: {
  items: CatalogItemRecord[];
  resolver: CatalogSpanishNameResolver;
  save(update: { item: CatalogItemRecord; displayName: string; metadata: Record<string, unknown> }): Promise<boolean>;
  onProgress?: (progress: { processed: number; renamed: number; failed: number; conflicts: number }) => void;
}) {
  const pending = items.filter((item) => item.lifecycleStatus === 'active'
    && ['board-game', 'expansion'].includes(item.itemType) && !item.metadata?.spanishName
    && item.metadata?.spanishNameResolutionVersion !== spanishNameResolutionVersion);
  const summary = { eligible: pending.length, processed: 0, renamed: 0, failed: 0, conflicts: 0 };
  for (let offset = 0; offset < pending.length; offset += 10) {
    const batch = pending.slice(offset, offset + 10);
    const resolved = await resolveCatalogSpanishNames(batch, resolver);
    for (const [index, imported] of resolved.entries()) {
      const item = batch[index]!;
      summary.processed += 1;
      if (imported.metadata?.spanishNameResolutionVersion !== spanishNameResolutionVersion) { summary.failed += 1; continue; }
      const displayName = preserveCatalogDisplayName(item, imported);
      const metadata = mergeCatalogNameMetadata(item.metadata, imported.metadata, [item.displayName, item.originalName ?? ''])!;
      if (!(await save({ item, displayName, metadata }))) { summary.conflicts += 1; continue; }
      if (displayName !== item.displayName) summary.renamed += 1;
    }
    onProgress({ processed: summary.processed, renamed: summary.renamed, failed: summary.failed, conflicts: summary.conflicts });
  }
  return summary;
}

async function main() {
  if (process.argv.slice(2).some((argument) => argument !== '--dry-run')) throw new Error('Use --dry-run or no arguments');
  const dryRun = process.argv.includes('--dry-run');
  const config = await loadRuntimeConfig();
  const database = await connectPostgresDatabase({ connectionString: createPostgresConnectionString(config.database), ssl: config.database.ssl, logger: { error() {} } });
  try {
    const items = await createDatabaseCatalogRepository({ database: database.db }).listItems({ includeDeactivated: false });
    const summary = await updateCatalogSpanishNames({
      items, resolver: createCatalogSpanishNameResolver(), onProgress: (progress) => console.log(JSON.stringify(progress)),
      async save({ item, displayName, metadata }) {
        if (dryRun) { if (displayName !== item.displayName) console.log(JSON.stringify({ itemId: item.id, before: item.displayName, after: displayName })); return true; }
        const result = await database.pool.query(`
          with updated as (
            update catalog_items set display_name=$1, metadata=$2::jsonb, updated_at=now()
            where id=$3 and lifecycle_status='active' and display_name=$4
              and original_name is not distinct from $5 and metadata is not distinct from $6::jsonb
            returning id
          ), audited as (
            insert into audit_log (action_key, target_type, target_id, summary, details)
            select 'catalog.item.spanish_name_selected', 'catalog-item', id::text,
              'Nombre castellano seleccionado entre los alias BGG', $7::jsonb from updated returning id
          ) select id from updated`, [displayName, JSON.stringify(metadata), item.id, item.displayName,
          item.originalName, item.metadata === null ? null : JSON.stringify(item.metadata),
          JSON.stringify({ previousName: item.displayName, displayName })]);
        return result.rows.length > 0;
      },
    });
    console.log(JSON.stringify({ dryRun, ...summary }));
    if (summary.failed || summary.conflicts) process.exitCode = 1;
  } finally { await database.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('No se pudieron completar los nombres castellanos del catálogo.'); process.exitCode = 1; });
}
