import { appendAuditEvent } from '../audit/audit-log.js';
import { createDatabaseAuditLogRepository } from '../audit/audit-log-store.js';
import type { DatabaseConnection } from '../infrastructure/database/connection.js';

export type LlmCommandMetricAction =
  | 'read'
  | 'write'
  | 'clarification'
  | 'confirmation'
  | 'admin_rejected'
  | 'private_chat_required'
  | 'unsupported'
  | 'permission_denied'
  | 'confidence_too_low'
  | 'failure';

export type LlmCommandMetricResult =
  | 'success'
  | 'timeout'
  | 'invalid_json'
  | 'action_not_allowlisted'
  | 'permission_denied'
  | 'handler_error'
  | 'cancelled'
  | 'not_configured'
  | 'process_failed'
  | 'unknown_error';

export interface LlmCommandMetricInput {
  actorTelegramUserId: number | null;
  chatId: number;
  chatKind: string;
  hasTopic: boolean;
  entrySource: string;
  language: string;
  intent?: string | null;
  confidence?: number | null;
  action: LlmCommandMetricAction;
  result: LlmCommandMetricResult;
  reason?: string | null;
  elapsedMs: number;
}

export interface LlmCommandMetrics {
  record(input: LlmCommandMetricInput): Promise<void>;
}

export function createAuditLogLlmCommandMetrics({
  database,
}: {
  database: DatabaseConnection['db'];
}): LlmCommandMetrics {
  const repository = createDatabaseAuditLogRepository({ database });
  return {
    async record(input) {
      await appendAuditEvent({
        repository,
        actorTelegramUserId: input.actorTelegramUserId,
        actionKey: 'telegram.llm_command.metric',
        targetType: 'llm_command',
        targetId: `${input.chatId}:${Date.now()}`,
        summary: `LLM command ${input.result}`,
        details: sanitizeMetricDetails(input),
      });
    },
  };
}

function sanitizeMetricDetails(input: LlmCommandMetricInput): Record<string, unknown> {
  return {
    chatKind: input.chatKind,
    hasTopic: input.hasTopic,
    entrySource: input.entrySource,
    language: input.language,
    ...(input.intent ? { intent: input.intent } : {}),
    ...(typeof input.confidence === 'number' ? { confidence: roundConfidence(input.confidence) } : {}),
    action: input.action,
    result: input.result,
    ...(input.reason ? { reason: input.reason.slice(0, 128) } : {}),
    elapsedMs: Math.max(0, Math.round(input.elapsedMs)),
  };
}

function roundConfidence(value: number): number {
  return Math.round(value * 1000) / 1000;
}
