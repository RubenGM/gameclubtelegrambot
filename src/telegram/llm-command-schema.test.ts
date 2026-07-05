import test from 'node:test';
import assert from 'node:assert/strict';

import { LlmCommandParseError, parseLlmCommandDecisionJson } from './llm-command-schema.js';

test('parseLlmCommandDecisionJson accepts a valid allowlisted decision', () => {
  const decision = parseLlmCommandDecisionJson(JSON.stringify(validDecision()));

  assert.equal(decision.intent, 'storage.search');
  assert.equal(decision.action.name, 'storage.search');
  assert.deepEqual(decision.action.params, { query: 'Dragon Ball', fileExtensions: ['stl'] });
});

test('parseLlmCommandDecisionJson accepts the multi-source search intent', () => {
  const decision = parseLlmCommandDecisionJson(JSON.stringify({
    ...validDecision(),
    intent: 'bot.search',
    action: {
      type: 'call_internal_handler',
      name: 'bot.search',
      params: {
        query: 'Star Wars',
        sources: ['catalog', 'storage'],
      },
    },
  }));

  assert.equal(decision.intent, 'bot.search');
  assert.deepEqual(decision.action.params.sources, ['catalog', 'storage']);
});

test('parseLlmCommandDecisionJson accepts general direct answers', () => {
  const decision = parseLlmCommandDecisionJson(JSON.stringify({
    ...validDecision(),
    intent: 'general.answer',
    reply: {
      text: 'Sí, puedo explicarlo de forma general.',
      sendNow: true,
    },
    action: {
      type: 'answer_directly',
      name: 'general.answer',
      params: {},
    },
    safety: {
      requiresApprovedMember: false,
      requiresAdmin: false,
      risk: 'read_only',
      publicSideEffect: false,
      destructive: false,
      requiresPrivateChat: false,
    },
  }));

  assert.equal(decision.intent, 'general.answer');
  assert.equal(decision.action.type, 'answer_directly');
});

test('parseLlmCommandDecisionJson accepts optional progress messages', () => {
  const decision = parseLlmCommandDecisionJson(JSON.stringify({
    ...validDecision(),
    progress: {
      messages: [
        'Voy a revisar Storage y quedarme solo con archivos STL.',
        'Después prepararé una respuesta con enlaces útiles.',
      ],
    },
  }));

  assert.deepEqual(decision.progress.messages, [
    'Voy a revisar Storage y quedarme solo con archivos STL.',
    'Después prepararé una respuesta con enlaces útiles.',
  ]);
});

test('parseLlmCommandDecisionJson accepts a stronger next-step model request', () => {
  const decision = parseLlmCommandDecisionJson(JSON.stringify({
    ...validDecision(),
    nextStep: {
      useStrongerModel: true,
      reason: 'recomendacion semantica con muchos candidatos',
    },
  }));

  assert.equal(decision.nextStep.useStrongerModel, true);
  assert.equal(decision.nextStep.reason, 'recomendacion semantica con muchos candidatos');
});

test('parseLlmCommandDecisionJson rejects non JSON text', () => {
  assert.throws(
    () => parseLlmCommandDecisionJson('Claro, aqui tienes {"version":1}'),
    LlmCommandParseError,
  );
});

test('parseLlmCommandDecisionJson rejects unknown intents and incomplete clarification objects', () => {
  assert.throws(
    () => parseLlmCommandDecisionJson(JSON.stringify({
      ...validDecision(),
      intent: 'shell.run',
      needsClarification: true,
      clarification: null,
    })),
    /does not match the contract/,
  );
});

function validDecision(): Record<string, unknown> {
  return {
    version: 1,
    language: 'es',
    intent: 'storage.search',
    confidence: 0.93,
    reply: {
      text: 'Busco archivos STL de Dragon Ball en Storage.',
      sendNow: false,
    },
    needsClarification: false,
    clarification: null,
    requiresConfirmation: false,
    confirmation: null,
    action: {
      type: 'call_internal_handler',
      name: 'storage.search',
      params: {
        query: 'Dragon Ball',
        fileExtensions: ['stl'],
      },
    },
    safety: {
      requiresApprovedMember: true,
      requiresAdmin: false,
      risk: 'read_only',
      publicSideEffect: false,
      destructive: false,
      requiresPrivateChat: false,
    },
  };
}
