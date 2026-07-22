import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NotionClientError,
  createNotionClient,
  parseNotionPageReference,
} from './notion-client.js';

const pageId = '01234567-89ab-cdef-0123-456789abcdef';
const firstBlockId = '11111111-1111-1111-1111-111111111111';
const secondBlockId = '22222222-2222-2222-2222-222222222222';

test('parseNotionPageReference accepts canonical IDs and Notion URLs only', () => {
  assert.equal(parseNotionPageReference('0123456789abcdef0123456789abcdef').pageId, pageId);
  assert.equal(
    parseNotionPageReference('https://acme.notion.site/A-title-0123456789abcdef0123456789abcdef?pvs=4').pageId,
    pageId,
  );
  assert.equal(
    parseNotionPageReference('https://app.notion.com/p/A-title-0123456789abcdef0123456789abcdef?source=copy_link').pageId,
    pageId,
  );
  assert.throws(() => parseNotionPageReference('https://example.com/A-title-0123456789abcdef0123456789abcdef'), NotionClientError);
});

test('Notion client retrieves a page and recursively loads paginated block children', async () => {
  const requests: Array<{ url: string; headers: Headers }> = [];
  const client = createNotionClient({
    apiToken: 'secret_not_logged',
    fetch: async (input, init) => {
      const url = String(input);
      requests.push({ url, headers: new Headers(init?.headers) });
      if (url.endsWith(`/pages/${pageId}`)) {
        return jsonResponse({
          id: pageId,
          url: 'https://www.notion.so/Test-0123456789abcdef0123456789abcdef',
          last_edited_time: '2026-07-22T10:00:00.000Z',
          archived: false,
          in_trash: false,
          properties: { Name: { type: 'title', title: [{ plain_text: 'Capítulo 1' }] } },
        });
      }
      if (url.includes(`/blocks/${pageId}/children?`) && !url.includes('start_cursor=')) {
        return jsonResponse({
          results: [block(firstBlockId, 'paragraph', true)],
          has_more: true,
          next_cursor: 'next-page',
        });
      }
      if (url.includes(`/blocks/${pageId}/children?`) && url.includes('start_cursor=next-page')) {
        return jsonResponse({ results: [block(secondBlockId, 'image', false)], has_more: false, next_cursor: null });
      }
      if (url.includes(`/blocks/${firstBlockId}/children?`)) {
        return jsonResponse({ results: [block(secondBlockId, 'quote', false)], has_more: false, next_cursor: null });
      }
      throw new Error(`Unexpected request ${url}`);
    },
  });

  const document = await client.readPageDocument(pageId);

  assert.equal(document.page.title, 'Capítulo 1');
  assert.equal(document.blocks.length, 2);
  const firstDocumentBlock = document.blocks[0];
  assert.ok(firstDocumentBlock);
  const nestedBlock = firstDocumentBlock.children[0];
  assert.ok(nestedBlock);
  assert.equal(nestedBlock.type, 'quote');
  assert.equal(document.blockCount, 3);
  const firstRequest = requests[0];
  assert.ok(firstRequest);
  assert.equal(firstRequest.headers.get('authorization'), 'Bearer secret_not_logged');
  assert.equal(firstRequest.headers.get('notion-version'), '2026-03-11');
});

test('Notion client honors Retry-After for rate limited reads', async () => {
  const delays: number[] = [];
  let attempts = 0;
  const client = createNotionClient({
    apiToken: 'secret',
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
    fetch: async () => {
      attempts += 1;
      if (attempts === 1) {
        return jsonResponse({ code: 'rate_limited', message: 'Slow down' }, 429, { 'retry-after': '2' });
      }
      return jsonResponse({ id: pageId, properties: {}, archived: false, in_trash: false });
    },
  });

  await client.retrievePage(pageId);
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [2000]);
});

test('Notion file download refuses non-public URLs and exposes block file metadata', async () => {
  const client = createNotionClient({ apiToken: 'secret', fetch: async () => new Response('unexpected') });
  const file = client.extractFile({
    id: firstBlockId,
    type: 'image',
    hasChildren: false,
    archived: false,
    inTrash: false,
    children: [],
    raw: {
      type: 'image',
      image: { file: { url: 'https://secure.notion-static.com/a.png', expiry_time: '2026-07-22T11:00:00Z' } },
    },
  });
  assert.deepEqual(file, {
    kind: 'notion_file',
    url: 'https://secure.notion-static.com/a.png',
    expiryTime: '2026-07-22T11:00:00Z',
    name: null,
  });
  await assert.rejects(
    client.downloadFile({ kind: 'external', url: 'http://127.0.0.1/private', expiryTime: null, name: null }),
    NotionClientError,
  );
});

function block(id: string, type: string, hasChildren: boolean): Record<string, unknown> {
  return { id, type, has_children: hasChildren, archived: false, in_trash: false };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}
