import assert from 'node:assert/strict';
import test from 'node:test';

import { renderNotionDocument } from './notion-renderer.js';

test('renderNotionDocument produces safe chunked Telegram HTML and reports unsupported blocks', () => {
  const result = renderNotionDocument({
    page: { id: '11111111-1111-1111-1111-111111111111', url: null, title: 'Capítulo <uno>', lastEditedTime: null, archived: false, inTrash: false, raw: {} },
    blockCount: 3,
    truncated: false,
    blocks: [
      block('paragraph', { rich_text: [{ plain_text: 'Pista <secreta>', annotations: { bold: true } }] }),
      block('bulleted_list_item', { rich_text: [{ plain_text: 'Investiga la torre', annotations: {} }] }),
      block('embed', {}),
    ],
  });

  assert.match(result.messages[0]!, /Capítulo &lt;uno&gt;/);
  assert.match(result.messages.join('\n'), /<b>Pista &lt;secreta&gt;<\/b>/);
  assert.match(result.messages.join('\n'), /Bloque de Notion no compatible: embed/);
  assert.deepEqual(result.unsupportedBlockTypes, ['embed']);
});

test('renderNotionDocument keeps Notion-hosted files and does not require a live Notion URL in player content', () => {
  const result = renderNotionDocument({
    page: { id: '11111111-1111-1111-1111-111111111111', url: null, title: 'Mapa', lastEditedTime: null, archived: false, inTrash: false, raw: {} },
    blockCount: 1,
    truncated: false,
    blocks: [block('file', {
      name: 'mapa.pdf',
      file: { url: 'https://s3.us-west-2.amazonaws.com/secure.notion-static.com/mapa.pdf', expiry_time: '2026-07-23T10:00:00.000Z' },
    })],
  });

  assert.equal(result.files.length, 1);
  assert.equal(result.files[0]?.file.kind, 'notion_file');
  assert.match(result.messages.join('\n'), /mapa\.pdf/);
});

function block(type: string, payload: Record<string, unknown>) {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    type,
    hasChildren: false,
    archived: false,
    inTrash: false,
    raw: { id: '22222222-2222-2222-2222-222222222222', type, [type]: payload },
    children: [],
  };
}
