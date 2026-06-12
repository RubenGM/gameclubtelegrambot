import test from 'node:test';
import assert from 'node:assert/strict';

import { LlmCommandParseError, parseLlmCommandDecisionJson } from './llm-command-schema.js';

test('parseLlmCommandDecisionJson accepts a valid allowlisted decision', () => {
  const decision = parseLlmCommandDecisionJson(JSON.stringify(validDecision()));

  assert.equal(decision.intent, 'storage.search');
  assert.equal(decision.action.name, 'storage.search');
  assert.deepEqual(decision.action.params, { query: 'Dragon Ball', fileExtensions: ['stl'] });
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
