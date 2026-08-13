import test from 'node:test';
import assert from 'node:assert/strict';

import { optionsForMessageChunk, resolveReplyToBotMessageContext } from './runtime-boundary-support.js';

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
