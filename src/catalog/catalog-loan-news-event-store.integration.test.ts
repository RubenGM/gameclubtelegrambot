import test from 'node:test';
import assert from 'node:assert/strict';

import { sql } from 'drizzle-orm';

import { applyMigrations } from '../infrastructure/database/apply-migrations.js';
import {
  connectPostgresDatabase,
  createPostgresConnectionString,
} from '../infrastructure/database/connection.js';
import { loadIntegrationRuntimeConfig } from '../test/integration-runtime.js';
import { createDatabaseCatalogLoanNewsEventRepository } from './catalog-loan-news-event-store.js';

const integrationConfig = await loadIntegrationRuntimeConfig();
const integrationTest = integrationConfig ? test : test.skip;

integrationTest('catalog loan news event storage resets readiness from the newest pending event', async () => {
  if (!integrationConfig) {
    throw new Error('Integration runtime config is not available');
  }

  await applyMigrations({ config: integrationConfig });
  const connection = await connectPostgresDatabase({
    connectionString: createPostgresConnectionString(integrationConfig.database),
    ssl: integrationConfig.database.ssl,
    logger: { error: () => {} },
  });
  const item = await connection.pool.query(
    `
      insert into catalog_items (item_type, display_name, created_at, updated_at)
      values ('board-game', $1, now(), now())
      returning id
    `,
    [`Loan news buffer integration ${Date.now()}_${process.pid}`],
  );
  const itemId = Number(item.rows[0]?.id);
  const repository = createDatabaseCatalogLoanNewsEventRepository({ database: connection.db });

  try {
    const borrowed = await repository.enqueue({
      categoryKey: 'catalog-loans:board-game',
      action: 'borrowed',
      itemId,
      itemDisplayName: 'Catan',
      userName: 'Anna',
      occurredAt: '2026-08-19T10:00:00.000Z',
    });
    await repository.enqueue({
      categoryKey: 'catalog-loans:board-game',
      action: 'returned',
      itemId,
      itemDisplayName: 'Catan',
      userName: 'Anna',
      occurredAt: '2026-08-19T10:01:00.000Z',
    });

    assert.deepEqual(await repository.listPendingBatchReadyBefore('2026-08-19T10:00:59.999Z'), []);
    const ready = await repository.listPendingBatchReadyBefore('2026-08-19T10:01:00.000Z');
    assert.deepEqual(ready.map((event) => event.action), ['borrowed', 'returned']);

    await repository.markPublished({
      eventIds: ready.map((event) => event.id),
      publishedAt: '2026-08-19T10:06:00.000Z',
    });
    assert.deepEqual(await repository.listPendingBatchReadyBefore('2026-08-19T10:10:00.000Z'), []);
    assert.equal(borrowed.itemId, itemId);
  } finally {
    await connection.db.execute(sql`delete from catalog_loan_news_events where item_id = ${itemId}`);
    await connection.db.execute(sql`delete from catalog_items where id = ${itemId}`);
    await connection.close();
  }
});
