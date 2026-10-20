import assert from 'node:assert/strict';
import test from 'node:test';
import { randomInt } from 'node:crypto';
import { applyMigrations } from '../infrastructure/database/apply-migrations.js';
import { connectPostgresDatabase, createPostgresConnectionString } from '../infrastructure/database/connection.js';
import { loadIntegrationRuntimeConfig } from '../test/integration-runtime.js';
import { createDatabaseGroupPurchaseRepository } from './group-purchase-catalog-store.js';

const config = await loadIntegrationRuntimeConfig();
const integrationTest = config ? test : test.skip;

integrationTest('PostgreSQL preserves advanced participation states for stale or concurrent join requests', async () => {
  if (!config) throw new Error('Integration runtime unavailable');
  await applyMigrations({ config });
  const connection = await connectPostgresDatabase({ connectionString: createPostgresConnectionString(config.database), ssl: config.database.ssl, logger: { error() {} } });
  const userId = 7_100_000_000_000 + randomInt(1_000_000_000);
  const repository = createDatabaseGroupPurchaseRepository({ database: connection.db });
  try {
    await connection.pool.query("insert into users (telegram_user_id, display_name) values ($1, 'Purchase join test')", [userId]);
    const detail = await repository.createPurchase({ title: 'Join regression', description: null, purchaseMode: 'per_item', createdByTelegramUserId: userId, joinDeadlineAt: null, confirmDeadlineAt: null, totalPriceCents: null, unitPriceCents: 100, unitLabel: null, allocationFieldKey: null, fields: [] });
    const input = { purchaseId: detail.purchase.id, participantTelegramUserId: userId };
    const rejoin = () => repository.upsertParticipant({ ...input, status: 'interested', preserveExistingStatus: true });
    assert.equal((await rejoin()).status, 'interested');
    for (const status of ['confirmed', 'paid', 'delivered'] as const) {
      const before = await repository.upsertParticipant({ ...input, status });
      assert.deepEqual(await rejoin(), before);
    }
    await repository.upsertParticipant({ ...input, status: 'removed' });
    assert.equal((await rejoin()).status, 'interested');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await repository.upsertParticipant({ ...input, status: 'interested' });
      await Promise.all([rejoin(), repository.upsertParticipant({ ...input, status: 'paid' }), rejoin()]);
      assert.equal((await repository.findParticipant(input.purchaseId, userId))?.status, 'paid');
    }
  } finally {
    try {
      await connection.pool.query('delete from group_purchase_participants where participant_telegram_user_id = $1', [userId]);
      await connection.pool.query('delete from group_purchases where created_by_telegram_user_id = $1', [userId]);
      await connection.pool.query('delete from users where telegram_user_id = $1', [userId]);
    } finally {
      await connection.close();
    }
  }
});
