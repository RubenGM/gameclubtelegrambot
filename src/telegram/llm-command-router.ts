import type { TelegramChatContextKind } from './chat-context.js';
import { findLlmCommandCapability } from './llm-command-actions.js';
import type { LlmCommandDecision } from './llm-command-schema.js';

export type LlmCommandRouteOutcome =
  | { type: 'answer_directly'; message: string; intent: string }
  | { type: 'ask_clarification'; message: string; intent: string }
  | { type: 'execute_read'; intent: string; params: Record<string, unknown> }
  | { type: 'request_confirmation'; intent: string; params: Record<string, unknown>; message: string }
  | { type: 'private_chat_required'; message: string; targetIntent: string }
  | { type: 'admin_rejected'; message: string }
  | { type: 'permission_denied'; message: string }
  | { type: 'confidence_too_low'; message: string; threshold: number }
  | { type: 'unsupported'; message: string };

export interface LlmCommandRouteContext {
  isApproved: boolean;
  isAdmin: boolean;
  chatKind: TelegramChatContextKind;
  readConfidenceThreshold: number;
  writeConfidenceThreshold: number;
}

export const llmCommandAdminRejectedMessage = 'Las acciones de admin no se hacen por IA. Usa el menú normal de admin.';
export const llmCommandPrivateRequiredMessage = 'Puedo ayudarte con eso, pero las acciones que cambian algo las hago sólo por privado. Escríbeme este mismo mensaje en el chat privado y lo seguimos allí.';

export function routeLlmCommandDecision(
  decision: LlmCommandDecision,
  context: LlmCommandRouteContext,
): LlmCommandRouteOutcome {
  const capability = findLlmCommandCapability(decision.intent);
  if (!capability || decision.intent === 'unsupported' || decision.action.type === 'unsupported') {
    return { type: 'unsupported', message: decision.reply.text };
  }

  const localRisk = resolveLocalRisk(decision);
  if (capability.requiresAdmin || decision.safety.requiresAdmin || localRisk === 'admin') {
    return { type: 'admin_rejected', message: llmCommandAdminRejectedMessage };
  }

  if ((capability.requiresApprovedMember || decision.safety.requiresApprovedMember) && !context.isApproved) {
    return { type: 'permission_denied', message: 'Necesitas tener acceso aprobado para usar esta función.' };
  }

  if (decision.needsClarification) {
    return {
      type: 'ask_clarification',
      message: decision.clarification?.question ?? decision.reply.text,
      intent: decision.intent,
    };
  }

  if (decision.action.type === 'answer_directly') {
    return {
      type: 'answer_directly',
      message: decision.reply.text,
      intent: decision.intent,
    };
  }

  const threshold = localRisk === 'read_only'
    ? context.readConfidenceThreshold
    : context.writeConfidenceThreshold;
  if (decision.confidence < threshold) {
    return {
      type: 'confidence_too_low',
      message: decision.reply.text,
      threshold,
    };
  }

  if (localRisk !== 'read_only' && context.chatKind !== 'private') {
    return {
      type: 'private_chat_required',
      message: llmCommandPrivateRequiredMessage,
      targetIntent: decision.intent,
    };
  }

  if (localRisk !== 'read_only') {
    return {
      type: 'request_confirmation',
      intent: decision.intent,
      params: decision.action.params,
      message: decision.confirmation?.text ?? decision.reply.text,
    };
  }

  if (decision.action.type !== 'call_internal_handler') {
    return { type: 'unsupported', message: decision.reply.text };
  }

  return {
    type: 'execute_read',
    intent: decision.intent,
    params: decision.action.params,
  };
}

function resolveLocalRisk(decision: LlmCommandDecision): 'read_only' | 'write' | 'admin' | 'unknown' {
  if (decision.safety.requiresAdmin || decision.safety.risk === 'admin') {
    return 'admin';
  }
  if (
    decision.safety.risk === 'write' ||
    decision.safety.publicSideEffect ||
    decision.safety.destructive ||
    decision.safety.requiresPrivateChat ||
    decision.requiresConfirmation
  ) {
    return 'write';
  }
  if (decision.safety.risk === 'read_only') {
    return 'read_only';
  }
  return 'unknown';
}
