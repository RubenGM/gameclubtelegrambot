import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchTelegramFileBytesWithRetry,
  optionsForMessageChunk,
  resolveReplyToBotMessageContext,
} from './runtime-boundary-support.js';

test('fetchTelegramFileBytesWithRetry retries transient Telegram file fetch failures', async () => {
  let attempts = 0;
  const delays: number[] = [];
  const bytes = await fetchTelegramFileBytesWithRetry({
    fileUrl: 'https://api.telegram.test/file/bot-redacted/photos/library.jpg',
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new TypeError('fetch failed');
      }
      return new Response(Uint8Array.from([1, 2, 3]), { status: 200 });
    },
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
  });

  assert.equal(attempts, 3);
  assert.deepEqual(delays, [500, 1_000]);
  assert.deepEqual([...bytes], [1, 2, 3]);
});

test('fetchTelegramFileBytesWithRetry retries Telegram 5xx file responses', async () => {
  let attempts = 0;
  const bytes = await fetchTelegramFileBytesWithRetry({
    fileUrl: 'https://api.telegram.test/file/bot-redacted/photos/library.jpg',
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1
        ? new Response('temporary failure', { status: 502 })
        : new Response('photo', { status: 200 });
    },
    sleep: async () => {},
  });

  assert.equal(attempts, 2);
  assert.equal(bytes.toString('utf8'), 'photo');
});

test('resolveReplyToBotMessageContext accepts a real reply but ignores Telegram quotes', () => {
  const reply = {
    reply_to_message: {
      message_id: 77,
      from: { username: 'gameclubbot' },
      text: 'Resultados',
    },
  };

  assert.deepEqual(resolveReplyToBotMessageContext(reply, 'gameclubbot'), {
    messageId: 77,
    text: 'Resultados',
  });
  assert.equal(
    resolveReplyToBotMessageContext({ ...reply, quote: { text: 'Resultados' } }, 'gameclubbot'),
    null,
  );
  assert.equal(
    resolveReplyToBotMessageContext({ ...reply, external_reply: { origin: {} } }, 'gameclubbot'),
    null,
  );
});

test('optionsForMessageChunk keeps keyboards only on the final chunk', () => {
  const options = {
    parseMode: 'HTML' as const,
    messageThreadId: 25,
    inlineKeyboard: [[{ text: 'Continuar', callbackData: 'continue' }]],
  };

  assert.deepEqual(optionsForMessageChunk(options, 0, 2), {
    parseMode: 'HTML',
    messageThreadId: 25,
  });
  assert.equal(optionsForMessageChunk(options, 1, 2), options);
});

test('reply context preserves rich detail title, fields and bot detail links without a legacy text field', () => {
  const reply = { reply_to_message: { message_id: 77, from: { username: 'gameclubbot' }, rich_message: { blocks: [
    { type: 'heading', size: 2, text: 'Catan & Amics' },
    { type: 'table', cells: [[{ text: 'Jugadors:' }, { text: '3-4' }]] },
    { type: 'paragraph', text: { type: 'url', text: 'Veure detalls', url: 'https://t.me/gameclubbot?start=catalog_read_item_1' } },
  ] } } };
  assert.deepEqual(resolveReplyToBotMessageContext(reply, 'gameclubbot'), {
    messageId: 77,
    text: 'Catan & Amics\nJugadors: 3-4\nVeure detalls (https://t.me/gameclubbot?start=catalog_read_item_1)',
  });
});
