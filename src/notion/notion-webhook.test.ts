import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { createNotionWebhookHandler, verifyNotionWebhookSignature } from './notion-webhook.js';

const verificationToken = 'secret_webhook_verification';

test('Notion webhook verifies raw bytes before dispatching a normalized event', async () => {
  const rawBody = '{"id":"event-1","type":"page.content_updated","timestamp":"2026-07-22T10:00:00.000Z","entity":{"id":"page-1","type":"page"}}';
  const events: unknown[] = [];
  const handler = createNotionWebhookHandler({
    verificationToken,
    onEvent: async (event) => {
      events.push(event);
    },
  });
  const signature = sign(rawBody);

  const result = await handler.handle({ rawBody, signature });

  assert.deepEqual(result, { statusCode: 202, kind: 'accepted' });
  assert.deepEqual(events, [
    {
      id: 'event-1',
      type: 'page.content_updated',
      timestamp: '2026-07-22T10:00:00.000Z',
      entity: { id: 'page-1', type: 'page' },
      raw: JSON.parse(rawBody),
    },
  ]);
  assert.equal(verifyNotionWebhookSignature(`${rawBody} `, signature, verificationToken), false);
});

test('Notion webhook rejects malformed JSON and bad signatures without dispatching', async () => {
  let calls = 0;
  const handler = createNotionWebhookHandler({ verificationToken, onEvent: async () => { calls += 1; } });

  assert.deepEqual(await handler.handle({ rawBody: 'not json', signature: sign('not json') }), { statusCode: 400, kind: 'invalid_json' });
  assert.deepEqual(
    await handler.handle({ rawBody: '{"id":"event","type":"page.content_updated"}', signature: 'sha256=wrong' }),
    { statusCode: 401, kind: 'invalid_signature' },
  );
  assert.equal(calls, 0);
});

test('Notion webhook accepts the unsigned subscription verification request without exposing its token in logging', async () => {
  let receivedToken = '';
  const info: object[] = [];
  const handler = createNotionWebhookHandler({
    onEvent: async () => undefined,
    onVerificationToken: (token) => {
      receivedToken = token;
    },
    logger: { info: (bindings) => info.push(bindings) },
  });

  const result = await handler.handle({ rawBody: '{"verification_token":"secret_setup"}', signature: undefined });

  assert.deepEqual(result, { statusCode: 202, kind: 'verification' });
  assert.equal(receivedToken, 'secret_setup');
  assert.deepEqual(info, [{ notionWebhook: { verification: true } }]);
  assert.doesNotMatch(JSON.stringify(info), /secret_setup/);
});

test('Notion webhook rejects signed events while no verification token is configured', async () => {
  const handler = createNotionWebhookHandler({ onEvent: async () => undefined });
  const rawBody = '{"id":"event","type":"page.content_updated"}';
  assert.deepEqual(await handler.handle({ rawBody, signature: sign(rawBody) }), {
    statusCode: 503,
    kind: 'missing_verification_token',
  });
});

function sign(rawBody: string): string {
  return `sha256=${createHmac('sha256', verificationToken).update(rawBody).digest('hex')}`;
}
