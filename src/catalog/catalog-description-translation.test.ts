import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCatalogDescriptionTranslator,
  translateDescriptionWithDeepL,
} from './catalog-description-translation.js';

test('translateDescriptionWithDeepL sends text to DeepL and returns translated text', async () => {
  const calls: Array<{ url: string; authorization: string | null; body: string }> = [];
  const translated = await translateDescriptionWithDeepL({
    description: 'Move through the Caribbean &mdash; collect goods.',
    targetLanguage: 'es',
    apiKey: 'test-key:fx',
    timeoutMs: 1000,
    fetchImpl: async (url, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(url),
        authorization: headers.get('authorization'),
        body: String(init?.body),
      });
      return new Response(JSON.stringify({ translations: [{ text: 'Muévete por el Caribe - recoge mercancías.' }] }), { status: 200 });
    },
  });

  assert.equal(translated, 'Muévete por el Caribe - recoge mercancías.');
  assert.equal(calls[0]?.url, 'https://api-free.deepl.com/v2/translate');
  assert.equal(calls[0]?.authorization, 'DeepL-Auth-Key test-key:fx');
  assert.match(calls[0]?.body ?? '', /target_lang=ES/);
  assert.match(calls[0]?.body ?? '', /Move\+through\+the\+Caribbean\+-\+collect\+goods\./);
});

test('createCatalogDescriptionTranslator falls back to Codex when DeepL is not configured', async () => {
  await assert.rejects(
    createCatalogDescriptionTranslator({
      codexBin: '/missing/codex',
      fetchImpl: async () => {
        throw new Error('DeepL should not be called');
      },
    })({
      description: 'A long English board game description.',
      model: 'gpt-5.4-mini',
      targetLanguage: 'es',
    }),
    /ENOENT|no such file/i,
  );
});

test('createCatalogDescriptionTranslator falls back to Codex when DeepL fails', async () => {
  await assert.rejects(
    createCatalogDescriptionTranslator({
      deeplApiKey: 'test-key:fx',
      codexBin: '/missing/codex',
      fetchImpl: async () => new Response('nope', { status: 500 }),
    })({
      description: 'A long English board game description.',
      model: 'gpt-5.4-mini',
      targetLanguage: 'es',
    }),
    /ENOENT|no such file/i,
  );
});
