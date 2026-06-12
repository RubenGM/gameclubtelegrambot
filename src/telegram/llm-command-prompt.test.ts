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
  assert.match(prompt, /No uses answer_directly para agenda/);
  assert.match(prompt, /params\.dateRange="this_week"/);
  assert.match(prompt, /catalogo son articulos fisicos\/prestables/);
  assert.match(prompt, /catalog\.recommend/);
  assert.match(prompt, /playerCount/);
  assert.match(prompt, /availableOnly=true/);
  assert.match(prompt, /itemType="board-game"/);
  assert.match(prompt, /material de juegos de rol como libros, manuales, aventuras, fichas, mapas/);
  assert.match(prompt, /Si el usuario pide libros de rol/);
  assert.match(prompt, /usa storage\.search/);
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
