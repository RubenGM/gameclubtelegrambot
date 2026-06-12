import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLlmCommandPrompt } from './llm-command-prompt.js';

test('buildLlmCommandPrompt includes allowed read capabilities and user context', () => {
  const prompt = buildLlmCommandPrompt({
    userText: '¿que actividades hay hoy?',
    language: 'es',
    isApproved: true,
    isAdmin: false,
    chatKind: 'group',
    hasTopic: true,
  });

  assert.match(prompt, /schedule\.today/);
  assert.match(prompt, /storage\.search/);
  assert.match(prompt, /chat: group con topic/);
  assert.doesNotMatch(prompt, /notice\.create/);
});

test('buildLlmCommandPrompt trims long prompts without leaking extra history', () => {
  const prompt = buildLlmCommandPrompt({
    userText: 'x'.repeat(5000),
    language: 'es',
    isApproved: true,
    isAdmin: false,
    chatKind: 'private',
    hasTopic: false,
    history: [{ role: 'user', text: 'historial sensible' }],
    maxPromptChars: 1200,
  });

  assert.equal(prompt.length <= 1200, true);
  assert.doesNotMatch(prompt, /historial sensible/);
});
