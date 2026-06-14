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
  assert.match(prompt, /general\.answer/);
  assert.match(prompt, /bot\.search/);
  assert.match(prompt, /progress\.messages/);
  assert.match(prompt, /mientras consulta datos o prepara la respuesta/);
  assert.match(prompt, /preguntas generales o conversacionales/);
  assert.match(prompt, /pregunta de forma transversal/);
  assert.match(prompt, /storage\.search/);
  assert.match(prompt, /chat: group con topic/);
  assert.match(prompt, /No uses answer_directly para agenda/);
  assert.match(prompt, /params\.dateRange="this_week"/);
  assert.match(prompt, /catalogo son articulos fisicos\/prestables/);
  assert.match(prompt, /catalog\.recommend/);
  assert.match(prompt, /playerCount/);
  assert.match(prompt, /availableOnly=true/);
  assert.match(prompt, /itemType="board-game"/);
  assert.match(prompt, /contexto conversacional/);
  assert.match(prompt, /segunda pasada/);
  assert.match(prompt, /material de juegos de rol como libros, manuales, aventuras, fichas, mapas/);
  assert.match(prompt, /Si el usuario pide libros de rol/);
  assert.match(prompt, /usa storage\.search/);
  assert.doesNotMatch(prompt, /notice\.create/);
});

test('buildLlmCommandPrompt includes replied bot message as conversational context', () => {
  const prompt = buildLlmCommandPrompt({
    userText: '¿y alguno disponible?',
    language: 'es',
    isApproved: true,
    isAdmin: false,
    chatKind: 'group',
    hasTopic: false,
    replyContext: {
      messageId: 99,
      text: 'Resultados del catálogo:\n\n1. Dune - board-game',
    },
  });

  assert.match(prompt, /Mensaje del bot al que responde el usuario/);
  assert.match(prompt, /messageId: 99/);
  assert.match(prompt, /Resultados del catálogo/);
  assert.match(prompt, /La petición actual del usuario manda/i);
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
