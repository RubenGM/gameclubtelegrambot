import test from 'node:test';
import assert from 'node:assert/strict';

import { sql } from 'drizzle-orm';

import { applyMigrations } from '../infrastructure/database/apply-migrations.js';
import {
  connectPostgresDatabase,
  createPostgresConnectionString,
} from '../infrastructure/database/connection.js';
import { loadIntegrationRuntimeConfig } from '../test/integration-runtime.js';
import { createDatabaseCatalogLoanRepository } from './catalog-loan-store.js';

const integrationConfig = await loadIntegrationRuntimeConfig();

const integrationTest = integrationConfig ? test : test.skip;

integrationTest('PostgreSQL blocks a second active loan for the same item', async () => {
  const context = await createIntegrationContext();

  try {
    await context.connection.pool.query(
      `
        insert into catalog_loans (
          item_id,
          borrower_telegram_user_id,
          borrower_display_name,
          loaned_by_telegram_user_id,
          created_at,
          updated_at
        ) values ($1, $2, $3, $4, now(), now())
      `,
      [context.itemId, context.borrowerTelegramUserId, 'Borrower One', context.loanedByTelegramUserId],
    );

    await assert.rejects(
      () =>
        context.connection.pool.query(
          `
            insert into catalog_loans (
              item_id,
              borrower_telegram_user_id,
              borrower_display_name,
              loaned_by_telegram_user_id,
              created_at,
              updated_at
            ) values ($1, $2, $3, $4, now(), now())
          `,
          [context.itemId, context.secondBorrowerTelegramUserId, 'Borrower Two', context.loanedByTelegramUserId],
        ),
      (error: unknown) => {
        assert.ok(error && typeof error === 'object');
        assert.equal('code' in error ? error.code : undefined, '23505');
        assert.equal('constraint' in error ? error.constraint : undefined, 'catalog_loans_one_active_per_item');
        return true;
      },
    );
  } finally {
    await context.cleanup();
  }
});

integrationTest('concurrent loan creation allows one winner and one friendly duplicate failure', async () => {
  const context = await createIntegrationContext();

  try {
    const outcomes = await Promise.allSettled([
      context.repository.createLoan({
        itemId: context.itemId,
        borrowerTelegramUserId: context.borrowerTelegramUserId,
        borrowerDisplayName: 'Borrower One',
        loanedByTelegramUserId: context.loanedByTelegramUserId,
        dueAt: null,
        notes: null,
      }),
      context.repository.createLoan({
        itemId: context.itemId,
        borrowerTelegramUserId: context.secondBorrowerTelegramUserId,
        borrowerDisplayName: 'Borrower Two',
        loanedByTelegramUserId: context.loanedByTelegramUserId,
        dueAt: null,
        notes: null,
      }),
    ]);

    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected').length, 1);

    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    assert.ok(rejected);
    if (rejected.status === 'rejected') {
      assert.equal(rejected.reason instanceof Error ? rejected.reason.message : String(rejected.reason), 'Aquest item ja esta prestat.');
    }

    const activeLoans = await context.connection.pool.query(
      'select count(*)::int as count from catalog_loans where item_id = $1 and returned_at is null',
      [context.itemId],
    );
    assert.equal(activeLoans.rows[0]?.count, 1);
  } finally {
    await context.cleanup();
  }
});

integrationTest('closing the same loan twice returns the same closed record', async () => {
  const context = await createIntegrationContext();

  try {
    const created = await context.repository.createLoan({
      itemId: context.itemId,
      borrowerTelegramUserId: context.borrowerTelegramUserId,
      borrowerDisplayName: 'Borrower One',
      loanedByTelegramUserId: context.loanedByTelegramUserId,
      dueAt: null,
      notes: 'Needs sleeves',
    });

    const firstClose = await context.repository.closeLoan({
      loanId: created.id,
      returnedByTelegramUserId: context.loanedByTelegramUserId,
    });
    const secondClose = await context.repository.closeLoan({
      loanId: created.id,
      returnedByTelegramUserId: context.secondBorrowerTelegramUserId,
    });

    assert.equal(firstClose.id, secondClose.id);
    assert.equal(firstClose.returnedAt, secondClose.returnedAt);
    assert.equal(secondClose.returnedByTelegramUserId, context.loanedByTelegramUserId);
    assert.equal(secondClose.notes, 'Needs sleeves');
  } finally {
    await context.cleanup();
  }
});

async function createIntegrationContext() {
  if (!integrationConfig) {
    throw new Error('Integration runtime config is not available');
  }

  await applyMigrations({ config: integrationConfig });

  const connection = await connectPostgresDatabase({
    connectionString: createPostgresConnectionString(integrationConfig.database),
    ssl: integrationConfig.database.ssl,
    logger: {
      error: () => {},
    },
  });

  const repository = createDatabaseCatalogLoanRepository({
    database: connection.db,
  });
  const seed = createSeed();

  const firstUser = await connection.pool.query(
    `
      insert into users (telegram_user_id, display_name, status, is_approved, is_admin, created_at, updated_at)
      values ($1, $2, 'approved', true, false, now(), now())
      returning telegram_user_id
    `,
    [seed.borrowerTelegramUserId, 'Integration Borrower One'],
  );
  const secondUser = await connection.pool.query(
    `
      insert into users (telegram_user_id, display_name, status, is_approved, is_admin, created_at, updated_at)
      values ($1, $2, 'approved', true, true, now(), now())
      returning telegram_user_id
    `,
    [seed.loanedByTelegramUserId, 'Integration Loaner'],
  );
  const thirdUser = await connection.pool.query(
    `
      insert into users (telegram_user_id, display_name, status, is_approved, is_admin, created_at, updated_at)
      values ($1, $2, 'approved', true, false, now(), now())
      returning telegram_user_id
    `,
    [seed.secondBorrowerTelegramUserId, 'Integration Borrower Two'],
  );
  const item = await connection.pool.query(
    `
      insert into catalog_items (item_type, display_name, created_at, updated_at)
      values ('board-game', $1, now(), now())
      returning id
    `,
    [seed.itemDisplayName],
  );

  const itemId = Number(item.rows[0]?.id);

  return {
    connection,
    repository,
    itemId,
    borrowerTelegramUserId: Number(firstUser.rows[0]?.telegram_user_id),
    loanedByTelegramUserId: Number(secondUser.rows[0]?.telegram_user_id),
    secondBorrowerTelegramUserId: Number(thirdUser.rows[0]?.telegram_user_id),
    async cleanup() {
      await connection.db.execute(sql`delete from catalog_loans where item_id = ${itemId}`);
      await connection.db.execute(sql`delete from catalog_items where id = ${itemId}`);
      await connection.db.execute(sql`delete from users where telegram_user_id in (${seed.borrowerTelegramUserId}, ${seed.loanedByTelegramUserId}, ${seed.secondBorrowerTelegramUserId})`);
      await connection.close();
    },
  };
}

function createSeed() {
  const suffix = `${Date.now()}_${process.pid}_${Math.floor(Math.random() * 100000)}`;
  const baseTelegramUserId = Number(`7${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 100)}`);

  return {
    borrowerTelegramUserId: baseTelegramUserId,
    loanedByTelegramUserId: baseTelegramUserId + 1,
    secondBorrowerTelegramUserId: baseTelegramUserId + 2,
    itemDisplayName: `Integration Loan Item ${suffix}`,
  };
}
