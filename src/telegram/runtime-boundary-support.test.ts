import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveReplyToBotMessageContext } from './runtime-boundary-support.js';

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
