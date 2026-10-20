import assert from 'node:assert/strict';
import test from 'node:test';
import { randomInt } from 'node:crypto';
import { applyMigrations } from '../infrastructure/database/apply-migrations.js';
import { connectPostgresDatabase, createPostgresConnectionString } from '../infrastructure/database/connection.js';
import { loadIntegrationRuntimeConfig } from '../test/integration-runtime.js';
import { createDatabaseNoticeRepository } from './notice-catalog-store.js';

const config = await loadIntegrationRuntimeConfig();
const integrationTest = config ? test : test.skip;

integrationTest('notice creation and replacement roll back text, attachments and publication references on PostgreSQL errors', async () => {
  if (!config) throw new Error('Integration runtime unavailable');
  await applyMigrations({ config });
  const connection = await connectPostgresDatabase({ connectionString: createPostgresConnectionString(config.database), ssl: config.database.ssl, logger: { error() {} } });
  const userId = 7_000_000_000_000 + randomInt(1_000_000_000);
  const repository = createDatabaseNoticeRepository({ database: connection.db });
  try {
    await connection.pool.query("insert into users (telegram_user_id, display_name) values ($1, 'Notice transaction test')", [userId]);
    const attachment = { sourceChatId: userId, sourceMessageId: 1, attachmentKind: 'document', telegramFileId: 'test-file', telegramFileUniqueId: null, caption: null, originalFileName: null, mimeType: null, fileSizeBytes: null, mediaGroupId: null, sortOrder: 0 };
    const created = await repository.createNotice({ createdByTelegramUserId: userId, creatorDisplayName: 'Test', text: 'Original', attachments: [attachment] });
    await repository.addPublication({ noticeId: created.notice.id, chatId: -userId, messageId: 1, publicationKind: 'attachment', attachmentId: created.attachments[0]!.id });
    const original = await repository.findNoticeDetail(created.notice.id);
    const invalidAttachment = { ...attachment, attachmentKind: 'x'.repeat(33) };
    await assert.rejects(repository.updateNotice({ noticeId: created.notice.id, text: 'Must roll back', attachments: [invalidAttachment] }));
    assert.deepEqual(await repository.findNoticeDetail(created.notice.id), original);

    await assert.rejects(repository.createNotice({ createdByTelegramUserId: userId, creatorDisplayName: 'Test', text: 'Must not exist', attachments: [invalidAttachment] }));
    const remaining = await connection.pool.query('select text from notices where created_by_telegram_user_id = $1', [userId]);
    assert.deepEqual(remaining.rows, [{ text: 'Original' }]);

    const updated = await repository.updateNotice({ noticeId: created.notice.id, text: 'Updated', attachments: [{ ...attachment, telegramFileId: 'new-file' }] });
    assert.equal(updated?.notice.text, 'Updated');
    assert.equal(updated?.attachments[0]?.telegramFileId, 'new-file');
    assert.equal(updated?.publications[0]?.attachmentId, null);
  } finally {
    try {
      await connection.pool.query('delete from notices where created_by_telegram_user_id = $1', [userId]);
      await connection.pool.query('delete from users where telegram_user_id = $1', [userId]);
    } finally {
      await connection.close();
    }
  }
});
