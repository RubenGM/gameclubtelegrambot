import test from 'node:test';
import assert from 'node:assert/strict';
import { connectPostgresDatabase, createPostgresConnectionString } from '../infrastructure/database/connection.js';
import { loadIntegrationRuntimeConfig } from '../test/integration-runtime.js';
import { catalogItemSortTitleSql, compareCatalogItemTitles } from './catalog-title-order.js';

const config = await loadIntegrationRuntimeConfig();
(config ? test : test.skip)('PostgreSQL applies the shared article rule before catalog pagination', async () => {
  const connection = await connectPostgresDatabase({ connectionString: createPostgresConnectionString(config!.database), ssl: config!.database.ssl, logger: { error() {} } });
  try {
    const items = [...['La Iniciativa', 'Azul', 'El Dorado', 'The Island', 'Zooloretto', 'L’illa', 'Una Águila', 'La'].map((displayName) => ({ displayName, itemType: 'board-game' })), { displayName: 'La Biblioteca', itemType: 'book' }];
    const values = items.flatMap((item) => [item.displayName, item.itemType]);
    const rows = items.map((_, index) => `($${index * 2 + 1}::text, $${index * 2 + 2}::text)`).join(',');
    const query = `with items(display_name, item_type) as (values ${rows}) select display_name from items order by ${catalogItemSortTitleSql} asc, items.display_name asc`;
    const result = await connection.pool.query<{ display_name: string }>(query, values);
    assert.deepEqual(result.rows.map((row) => row.display_name), [...items].sort(compareCatalogItemTitles).map((item) => item.displayName));
    const page = await connection.pool.query<{ display_name: string }>(`${query} limit 2 offset 3`, values);
    assert.deepEqual(page.rows, result.rows.slice(3, 5));
  } finally { await connection.close(); }
});
