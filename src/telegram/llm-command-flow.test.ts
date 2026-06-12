import test from 'node:test';
import assert from 'node:assert/strict';

import {
  handleTelegramLlmAskCommand,
  handleTelegramLlmCallback,
  handleTelegramLlmFallbackText,
  handleTelegramLlmMenuText,
  llmCommandCallbackPrefixes,
  llmCommandFlowKey,
  type TelegramLlmCommandContext,
} from './llm-command-flow.js';
import { defaultLlmCommandConfig } from './llm-command-config.js';
import type { LlmCommandMetricInput } from './llm-command-metrics.js';
import type { LlmCommandDecision } from './llm-command-schema.js';
import { LlmCommandServiceError } from './llm-command-service.js';
import type { ConversationSessionRecord, ConversationSessionRuntime } from './conversation-session.js';

test('handleTelegramLlmAskCommand starts a session when no prompt is provided', async () => {
  const context = createContext({ messageText: '/ask' });

  await handleTelegramLlmAskCommand(context);

  assert.equal(context.replies.at(-1), 'Escribe qué quieres preguntarme. Puedo ayudarte con actividades, catálogo, Storage, compras, avisos y LFG.');
  assert.equal(context.session.current?.flowKey, llmCommandFlowKey);
  assert.equal(context.servicePrompts.length, 0);
});

test('handleTelegramLlmAskCommand interprets explicit text through the injected service', async () => {
  const context = createContext({
    messageText: '/ask que puedes hacer',
    decision: {
      ...helpDecision(),
      reply: {
        text: 'Puedes preguntarme por actividades, catálogo y Storage.',
        sendNow: true,
      },
    },
  });

  await handleTelegramLlmAskCommand(context);

  assert.equal(context.replies.at(-1), 'Puedes preguntarme por actividades, catálogo y Storage.');
  assert.equal(context.servicePrompts.length, 1);
  assert.match(context.servicePrompts[0] ?? '', /que puedes hacer/);
  assert.deepEqual(context.metrics.map((metric) => ({
    entrySource: metric.entrySource,
    intent: metric.intent,
    confidence: metric.confidence,
    action: metric.action,
    result: metric.result,
  })), [{
    entrySource: 'ask_command',
    intent: 'help.capabilities',
    confidence: 0.95,
    action: 'read',
    result: 'success',
  }]);
  assert.doesNotMatch(JSON.stringify(context.metrics), /que puedes hacer/);
});

test('handleTelegramLlmMenuText is gated by feature flag and starts a session when enabled', async () => {
  const disabled = createContext({
    llmEnabled: false,
  });
  assert.equal(await handleTelegramLlmMenuText(disabled), true);
  assert.equal(disabled.replies.at(-1), 'Preguntar al bot todavía no está activado.');

  const enabled = createContext({});
  assert.equal(await handleTelegramLlmMenuText(enabled), true);
  assert.equal(enabled.session.current?.flowKey, llmCommandFlowKey);
});

test('handleTelegramLlmFallbackText ignores ordinary text unless fallback is enabled and no flow handled it', async () => {
  const disabled = createContext({
    messageText: 'busca dragon ball',
    privateFallbackEnabled: false,
  });

  assert.equal(await handleTelegramLlmFallbackText(disabled), false);
  assert.equal(disabled.servicePrompts.length, 0);

  const enabled = createContext({ messageText: 'que puedes hacer' });

  assert.equal(await handleTelegramLlmFallbackText(enabled), true);
  assert.equal(enabled.replies.at(-1), 'Puedes preguntarme por actividades, catálogo, Storage, compras, avisos y LFG.');
});

test('handleTelegramLlmFallbackText only handles group text when it mentions or replies to the bot', async () => {
  const ignored = createContext({
    chatKind: 'group',
    messageText: 'que actividades hay hoy',
  });

  assert.equal(await handleTelegramLlmFallbackText(ignored), false);
  assert.equal(ignored.servicePrompts.length, 0);

  const mentioned = createContext({
    chatKind: 'group-news',
    messageText: '@gameclubbot que puedes hacer',
    messageThreadId: 42,
  });

  assert.equal(await handleTelegramLlmFallbackText(mentioned), true);
  assert.match(mentioned.servicePrompts[0] ?? '', /que puedes hacer/);
  assert.doesNotMatch(mentioned.servicePrompts[0] ?? '', /@gameclubbot/);
  assert.deepEqual(mentioned.replyOptions.at(-1), { messageThreadId: 42 });
});

test('handleTelegramLlmAskCommand records sanitized failure metrics without leaking prompts', async () => {
  const context = createContext({
    messageText: '/ask texto privado sensible',
    serviceError: new LlmCommandServiceError('invalid_json', 'raw response was not parseable'),
  });

  await handleTelegramLlmAskCommand(context);

  assert.equal(context.replies.at(-1), 'No he podido interpretar la petición ahora mismo. Prueba de nuevo en unos momentos o usa el menú normal.');
  assert.deepEqual(context.metrics.map((metric) => ({
    entrySource: metric.entrySource,
    intent: metric.intent,
    action: metric.action,
    result: metric.result,
    reason: metric.reason,
  })), [{
    entrySource: 'ask_command',
    intent: null,
    action: 'failure',
    result: 'invalid_json',
    reason: 'invalid_json',
  }]);
  assert.doesNotMatch(JSON.stringify(context.metrics), /texto privado sensible/);
});

test('handleTelegramLlmAskCommand continues when metric persistence fails', async () => {
  const context = createContext({
    messageText: '/ask que puedes hacer',
    metricsError: new Error('database temporarily unavailable'),
  });

  await handleTelegramLlmAskCommand(context);

  assert.equal(context.replies.at(-1), 'Puedes preguntarme por actividades, catálogo, Storage, compras, avisos y LFG.');
});

test('handleTelegramLlmCallback prepares the normal notice flow after write confirmation', async () => {
  const context = createContext({
    messageText: '/ask crea un aviso diciendo que abrimos tarde',
    decision: noticeCreateDecision(),
  });

  await handleTelegramLlmAskCommand(context);

  assert.equal(context.session.current?.flowKey, llmCommandFlowKey);
  assert.equal(context.session.current?.stepKey, 'confirm-write');
  assert.match(context.replies.at(-1) ?? '', /¿Quieres que prepare el flujo normal/);
  assert.deepEqual(context.replyOptions.at(-1), {
    inlineKeyboard: [[
      { text: 'Preparar', callbackData: llmCommandCallbackPrefixes.confirmWrite, semanticRole: 'success' },
      { text: 'Cancelar', callbackData: llmCommandCallbackPrefixes.cancelWrite, semanticRole: 'danger' },
    ]],
  });

  context.callbackData = llmCommandCallbackPrefixes.confirmWrite;
  assert.equal(await handleTelegramLlmCallback(context), true);

  assert.equal(context.session.current?.flowKey, 'notices');
  assert.equal(context.session.current?.stepKey, 'confirm');
  assert.equal(context.session.current?.data.text, 'Mañana abrimos media hora más tarde.');
  assert.equal(context.replies.at(-1), 'Revisa el aviso antes de publicarlo.');
});

test('handleTelegramLlmCallback cancels a pending write confirmation', async () => {
  const context = createContext({
    messageText: '/ask crea un aviso diciendo que abrimos tarde',
    decision: noticeCreateDecision(),
  });

  await handleTelegramLlmAskCommand(context);
  context.callbackData = llmCommandCallbackPrefixes.cancelWrite;

  assert.equal(await handleTelegramLlmCallback(context), true);
  assert.equal(context.session.current, null);
  assert.equal(context.replies.at(-1), 'Operación cancelada.');
});

function createContext({
  messageText = 'texto',
  decision = helpDecision(),
  llmEnabled = true,
  privateFallbackEnabled = true,
  chatKind = 'private',
  messageThreadId,
  replyToBotMessage = false,
  serviceError,
  metricsError,
}: {
  messageText?: string;
  decision?: LlmCommandDecision;
  llmEnabled?: boolean;
  privateFallbackEnabled?: boolean;
  chatKind?: 'private' | 'group' | 'group-news';
  messageThreadId?: number;
  replyToBotMessage?: boolean;
  serviceError?: Error;
  metricsError?: Error;
}): TelegramLlmCommandContext & {
  replies: string[];
  replyOptions: unknown[];
  servicePrompts: string[];
  metrics: LlmCommandMetricInput[];
  session: ConversationSessionRuntime;
} {
  const replies: string[] = [];
  const replyOptions: unknown[] = [];
  const servicePrompts: string[] = [];
  const metrics: LlmCommandMetricInput[] = [];
  const session = createSessionRuntime();
  return {
    messageText,
    ...(messageThreadId !== undefined ? { messageThreadId } : {}),
    replyToBotMessage,
    from: {
      id: 123,
      first_name: 'Ada',
    },
    async reply(message, options) {
      replies.push(message);
      replyOptions.push(options);
    },
    runtime: {
      bot: {
        publicName: 'Game Club Bot',
        clubName: 'Game Club',
        language: 'es',
        username: 'gameclubbot',
        async sendPrivateMessage() {},
      },
      services: {} as TelegramLlmCommandContext['runtime']['services'],
      chat: {
        kind: chatKind,
        chatId: chatKind === 'private' ? 123 : -100123,
      },
      actor: {
        telegramUserId: 123,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin: false,
        permissions: [],
      },
      authorization: {
        authorize: (permissionKey) => ({ allowed: true, permissionKey, reason: 'global-allow' }),
        can: () => true,
      },
      session,
      llmCommands: {
        ...defaultLlmCommandConfig,
        enabled: llmEnabled,
        privateFallbackEnabled,
      },
      llmCommandService: {
        async interpret(prompt) {
          servicePrompts.push(prompt);
          if (serviceError) {
            throw serviceError;
          }
          return decision;
        },
      },
      llmCommandMetrics: {
        async record(input) {
          if (metricsError) {
            throw metricsError;
          }
          metrics.push(input);
        },
      },
    },
    replies,
    replyOptions,
    servicePrompts,
    metrics,
    session,
  };
}

function createSessionRuntime(): ConversationSessionRuntime {
  let current: ConversationSessionRecord | null = null;
  return {
    get current() {
      return current;
    },
    async start(input) {
      current = {
        key: 'telegram.session:123:123',
        flowKey: input.flowKey,
        stepKey: input.stepKey,
        data: input.data ?? {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      };
      return current;
    },
    async advance(input) {
      if (!current) {
        throw new Error('missing session');
      }
      current = {
        ...current,
        stepKey: input.stepKey,
        data: input.data,
        updatedAt: new Date().toISOString(),
      };
      return current;
    },
    async cancel() {
      const hadSession = current !== null;
      current = null;
      return hadSession;
    },
  };
}

function helpDecision(): LlmCommandDecision {
  return {
    version: 1,
    language: 'es',
    intent: 'help.capabilities',
    confidence: 0.95,
    reply: {
      text: 'Puedes preguntarme por actividades, catálogo, Storage, compras, avisos y LFG.',
      sendNow: true,
    },
    needsClarification: false,
    clarification: null,
    requiresConfirmation: false,
    confirmation: null,
    action: {
      type: 'answer_directly',
      name: 'help.capabilities',
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
  };
}

function noticeCreateDecision(): LlmCommandDecision {
  return {
    version: 1,
    language: 'es',
    intent: 'notice.create',
    confidence: 0.95,
    reply: {
      text: 'Preparo un aviso.',
      sendNow: false,
    },
    needsClarification: false,
    clarification: null,
    requiresConfirmation: true,
    confirmation: {
      text: 'Voy a preparar un aviso con el texto "Mañana abrimos media hora más tarde.".',
      params: {},
    },
    action: {
      type: 'call_internal_handler',
      name: 'notice.create',
      params: {
        text: 'Mañana abrimos media hora más tarde.',
      },
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
