import assert from 'node:assert/strict';
import test from 'node:test';

import { decryptNotionCredential, encryptNotionCredential } from '../notion/notion-credential-crypto.js';
import {
  buildNotionBrowseWindow,
  buildNotionLinkConfirmationSessionData,
  buildRoleGameNotionBrowseStartPayload,
  parseRoleGameNotionBrowseStartPayload,
} from './role-game-notion-flow.js';

test('the encrypted Notion token survives the source-preview confirmation step', () => {
  const encryptionKey = '0123456789012345678901234567890123456789012345678901234567890123';
  const encryptedApiToken = encryptNotionCredential('secret_notion_token', encryptionKey);

  const data = buildNotionLinkConfirmationSessionData({
    gameId: 1,
    categoryId: null,
    encryptedApiToken,
    rootPageId: '6c1eacde-d673-4c40-af4b-1b0875616f13',
    rootPageUrl: 'https://app.notion.com/p/Testttt-6c1eacded6734c40af4b1b0875616f13',
    rootTitle: 'Testttt',
  });

  assert.ok(data.encryptedApiToken);
  assert.equal(decryptNotionCredential(data.encryptedApiToken, encryptionKey), 'secret_notion_token');
  assert.equal(data.rootTitle, 'Testttt');
});

test('Notion browsing paginates only direct active child pages and clamps the requested page', () => {
  const pages = [
    { notionPageId: 'root', parentNotionPageId: null, title: 'Root', status: 'active' },
    ...Array.from({ length: 13 }, (_, index) => ({
      notionPageId: `child-${index + 1}`,
      parentNotionPageId: 'root',
      title: `Child ${index + 1}`,
      status: 'active',
    })),
    { notionPageId: 'nested', parentNotionPageId: 'child-1', title: 'Nested', status: 'active' },
    { notionPageId: 'trashed', parentNotionPageId: 'root', title: 'Trashed', status: 'trashed' },
  ];

  const first = buildNotionBrowseWindow({ pages, parentPageId: 'root', requestedPage: 0 });
  assert.equal(first.page, 1);
  assert.equal(first.total, 13);
  assert.equal(first.totalPages, 2);
  assert.equal(first.items.length, 12);

  const last = buildNotionBrowseWindow({ pages, parentPageId: 'root', requestedPage: 99 });
  assert.equal(last.page, 2);
  assert.deepEqual(last.items.map((page) => page.notionPageId), ['child-13']);
});

test('Notion browse links use a compact validated start payload and restore the canonical page ID', () => {
  const payload = buildRoleGameNotionBrowseStartPayload({
    gameId: 123,
    sourceId: 456,
    pageId: '6c1eacde-d673-4c40-af4b-1b0875616f13',
  });

  assert.equal(payload, 'role_notion_123_456_6c1eacded6734c40af4b1b0875616f13');
  assert.deepEqual(parseRoleGameNotionBrowseStartPayload(`/start ${payload}`), {
    gameId: 123,
    sourceId: 456,
    pageId: '6c1eacde-d673-4c40-af4b-1b0875616f13',
  });
  assert.equal(parseRoleGameNotionBrowseStartPayload('role_notion_123_456_bad'), null);
});
