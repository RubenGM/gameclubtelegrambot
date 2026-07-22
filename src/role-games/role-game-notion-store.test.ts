import assert from 'node:assert/strict';
import test from 'node:test';
import { getTableColumns, getTableName } from 'drizzle-orm';

import {
  roleGameNotionChanges,
  roleGameNotionPageRevisions,
  roleGameNotionSourcePages,
  roleGameNotionSources,
  roleGameNotionWebhookEvents,
} from '../infrastructure/database/schema.js';
import { createDatabaseRoleGameRepository } from './role-game-catalog-store.js';

test('Notion role-game tables retain campaign binding, page routing, revisions, and webhook audit fields', () => {
  assert.equal(getTableName(roleGameNotionSources), 'role_game_notion_sources');
  assert.deepEqual(Object.keys(getTableColumns(roleGameNotionSources)), [
    'id',
    'roleGameId',
    'rootPageId',
    'rootPageUrl',
    'title',
    'status',
    'linkedByTelegramUserId',
    'tokenOwnerTelegramUserId',
    'encryptedApiToken',
    'webhookPathSecret',
    'encryptedWebhookVerificationToken',
    'lastNotionEditedAt',
    'lastSyncedAt',
    'lastWebhookEventId',
    'lastWebhookEventAt',
    'lastError',
    'createdAt',
    'updatedAt',
  ]);
  assert.equal(getTableName(roleGameNotionSourcePages), 'role_game_notion_source_pages');
  assert.equal('parentNotionPageId' in getTableColumns(roleGameNotionSourcePages), true);
  assert.equal('latestRoleGameMaterialId' in getTableColumns(roleGameNotionSourcePages), true);
  assert.equal(getTableName(roleGameNotionPageRevisions), 'role_game_notion_page_revisions');
  assert.equal('contentHash' in getTableColumns(roleGameNotionPageRevisions), true);
  assert.equal(getTableName(roleGameNotionWebhookEvents), 'role_game_notion_webhook_events');
  assert.equal('eventId' in getTableColumns(roleGameNotionWebhookEvents), true);
  assert.equal(getTableName(roleGameNotionChanges), 'role_game_notion_changes');
  assert.equal('webhookEventId' in getTableColumns(roleGameNotionChanges), true);
});

test('database role-game repository exposes the Notion persistence surface', () => {
  const repository = createDatabaseRoleGameRepository({ database: {} as never });
  assert.ok(repository.notion);
  assert.equal(typeof repository.notion.findSourceByRoleGameId, 'function');
  assert.equal(typeof repository.notion.findSourceByWebhookPathSecret, 'function');
  assert.equal(typeof repository.notion.listSourcePagesByNotionPageId, 'function');
  assert.equal(typeof repository.notion.recordWebhookEvent, 'function');
  assert.equal(typeof repository.notion.createPageRevision, 'function');
  assert.equal(typeof repository.notion.createChange, 'function');
});
