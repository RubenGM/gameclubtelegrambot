import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOpenjevIntent } from './llm-openjev-intent-classifier.js';

const config = { openjevEnabled: true, openjevApiKey: 'test-key', openjevConfidenceThreshold: 0.8 };
const payload = (choice: string, confidence = 0.95) => ({ answers: { intent: { type: 'choice', choice, confidence } } });

test('OpenJev sends a bounded context and local choices using server-side auth', async () => {
  const result = await classifyOpenjevIntent({ config, text: 'Crea una compra conjunta', replyText: 'Fundas',
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://api.openjev.sh/v1/systemone');
      assert.equal(init?.redirect, 'error');
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-key');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.state.message, 'Crea una compra conjunta');
      assert.equal(body.state.replyContext, 'Fundas');
      assert.ok(body.questions.intent.criteria['group_purchase.create']);
      assert.doesNotMatch(String(init?.body), /test-key/);
      return Response.json(payload('group_purchase.create'));
    },
  });
  assert.deepEqual(result, { intent: 'group_purchase.create', confidence: 0.95 });
});

for (const body of [payload('shell.exec'), payload('schedule.create', 0.4), payload('schedule.create', 2), {}, { answers: { intent: { choice: 'schedule.create' } } }]) {
  test(`OpenJev rejects invalid or uncertain answer ${JSON.stringify(body)}`, async () => {
    assert.equal(await classifyOpenjevIntent({ config, text: 'Crea actividad', fetchImpl: async () => Response.json(body) }), undefined);
  });
}

for (const status of [401, 422, 429, 503]) {
  test(`OpenJev HTTP ${status} falls back without consuming error bodies`, async () => {
    assert.equal(await classifyOpenjevIntent({ config, text: 'hola', fetchImpl: async () => new Response('private provider error', { status }) }), undefined);
  });
}

test('OpenJev disabled or missing credentials makes no HTTP request', async () => {
  for (const disabled of [{}, { openjevEnabled: true }, { ...config, openjevEnabled: false }]) {
    assert.equal(await classifyOpenjevIntent({ config: disabled, text: 'hola', fetchImpl: async () => { throw new Error('must not call'); } }), undefined);
  }
});

test('OpenJev network failures and cancelled requests fall back', async () => {
  assert.equal(await classifyOpenjevIntent({ config, text: 'hola', fetchImpl: async () => { throw new Error('network'); } }), undefined);
  const controller = new AbortController();
  controller.abort();
  assert.equal(await classifyOpenjevIntent({ config, text: 'hola', signal: controller.signal, fetchImpl: async () => Response.json(payload('schedule.create')) }), undefined);
});

test('OpenJev timeout bounds the advisory request', async () => {
  assert.equal(await classifyOpenjevIntent({ config: { ...config, openjevTimeoutMs: 100 }, text: 'hola', fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
    const keepAlive = setTimeout(() => reject(new Error('test failed to abort')), 1000);
    init?.signal?.addEventListener('abort', () => { clearTimeout(keepAlive); reject(new Error('timeout')); }, { once: true });
  }) }), undefined);
});
