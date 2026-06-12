import test from 'node:test';
import assert from 'node:assert/strict';

import {
  llmCommandAdminRejectedMessage,
  llmCommandPrivateRequiredMessage,
  routeLlmCommandDecision,
  type LlmCommandRouteContext,
} from './llm-command-router.js';
import type { LlmCommandDecision } from './llm-command-schema.js';

const baseContext: LlmCommandRouteContext = {
  isApproved: true,
  isAdmin: false,
  chatKind: 'private',
  readConfidenceThreshold: 0.75,
  writeConfidenceThreshold: 0.9,
};

test('routeLlmCommandDecision executes confident read-only allowed intents', () => {
  const outcome = routeLlmCommandDecision(readDecision(), baseContext);

  assert.deepEqual(outcome, {
    type: 'execute_read',
    intent: 'storage.search',
    params: { query: 'Dragon Ball' },
  });
});

test('routeLlmCommandDecision asks clarification before threshold checks', () => {
  const outcome = routeLlmCommandDecision({
    ...readDecision(),
    confidence: 0.2,
    needsClarification: true,
    clarification: {
      question: '¿Que categoria quieres buscar?',
      expectedFields: ['category'],
      knownParams: {},
    },
    action: {
      type: 'ask_clarification',
      name: 'storage.search',
      params: {},
    },
  }, baseContext);

  assert.deepEqual(outcome, {
    type: 'ask_clarification',
    message: '¿Que categoria quieres buscar?',
    intent: 'storage.search',
  });
});

test('routeLlmCommandDecision rejects reads below the local confidence threshold', () => {
  const outcome = routeLlmCommandDecision({
    ...readDecision(),
    confidence: 0.74,
  }, baseContext);

  assert.equal(outcome.type, 'confidence_too_low');
  assert.equal(outcome.threshold, 0.75);
});

test('routeLlmCommandDecision requires approved access for member capabilities', () => {
  const outcome = routeLlmCommandDecision(readDecision(), {
    ...baseContext,
    isApproved: false,
  });

  assert.equal(outcome.type, 'permission_denied');
});

test('routeLlmCommandDecision rejects administrative actions with the required copy', () => {
  const outcome = routeLlmCommandDecision({
    ...readDecision(),
    intent: 'catalog.edit',
    confidence: 0.95,
    action: {
      type: 'call_internal_handler',
      name: 'catalog.edit',
      params: { id: 1 },
    },
    safety: {
      requiresApprovedMember: true,
      requiresAdmin: true,
      risk: 'admin',
      publicSideEffect: false,
      destructive: false,
      requiresPrivateChat: true,
    },
  }, { ...baseContext, isAdmin: true });

  assert.deepEqual(outcome, {
    type: 'admin_rejected',
    message: llmCommandAdminRejectedMessage,
  });
});

test('routeLlmCommandDecision derives group writes to private chat without executing', () => {
  const outcome = routeLlmCommandDecision(writeDecision(), {
    ...baseContext,
    chatKind: 'group',
  });

  assert.deepEqual(outcome, {
    type: 'private_chat_required',
    message: llmCommandPrivateRequiredMessage,
    targetIntent: 'notice.create',
  });
});

test('routeLlmCommandDecision requests confirmation for private writes', () => {
  const outcome = routeLlmCommandDecision(writeDecision(), baseContext);

  assert.deepEqual(outcome, {
    type: 'request_confirmation',
    intent: 'notice.create',
    params: { text: 'Mañana abrimos media hora más tarde.' },
    message: 'Voy a publicar este aviso.',
  });
});

function readDecision(): LlmCommandDecision {
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
      params: { query: 'Dragon Ball' },
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

function writeDecision(): LlmCommandDecision {
  return {
    ...readDecision(),
    intent: 'notice.create',
    confidence: 0.92,
    reply: {
      text: 'Preparo el aviso.',
      sendNow: false,
    },
    requiresConfirmation: true,
    confirmation: {
      text: 'Voy a publicar este aviso.',
      params: {},
    },
    action: {
      type: 'call_internal_handler',
      name: 'notice.create',
      params: { text: 'Mañana abrimos media hora más tarde.' },
    },
    safety: {
      requiresApprovedMember: true,
      requiresAdmin: false,
      risk: 'write',
      publicSideEffect: true,
      destructive: false,
      requiresPrivateChat: true,
    },
  };
}
