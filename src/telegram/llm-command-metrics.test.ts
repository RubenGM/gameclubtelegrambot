import test from 'node:test';
import assert from 'node:assert/strict';

import { createAuditLogLlmCommandMetrics } from './llm-command-metrics.js';

test('createAuditLogLlmCommandMetrics persists only sanitized metric fields', async () => {
  const inserted: unknown[] = [];
  const metrics = createAuditLogLlmCommandMetrics({
    database: {
      insert() {
        return {
          async values(value: unknown) {
            inserted.push(value);
          },
        };
      },
    } as never,
  });

  await metrics.record({
    actorTelegramUserId: 123,
    chatId: 456,
    chatKind: 'private',
    hasTopic: false,
    entrySource: 'ask_command',
    language: 'es',
    intent: 'storage.search',
    confidence: 0.93456,
    action: 'read',
    result: 'success',
    reason: 'confidence_too_low',
    elapsedMs: 42.4,
  });

  assert.equal(inserted.length, 1);
  const row = inserted[0] as { targetId: string };
  assert.match(row.targetId, /^456:\d+$/);
  assert.deepEqual(row, {
    actorTelegramUserId: 123,
    actionKey: 'telegram.llm_command.metric',
    targetType: 'llm_command',
    targetId: row.targetId,
    summary: 'LLM command success',
    details: {
      chatKind: 'private',
      hasTopic: false,
      entrySource: 'ask_command',
      language: 'es',
      intent: 'storage.search',
      confidence: 0.935,
      action: 'read',
      result: 'success',
      reason: 'confidence_too_low',
      elapsedMs: 42,
    },
  });
});
