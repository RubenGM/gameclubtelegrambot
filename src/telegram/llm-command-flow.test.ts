import test from 'node:test';
import assert from 'node:assert/strict';

import {
  handleTelegramLlmAskCommand,
  handleTelegramLlmFallbackText,
  handleTelegramLlmMenuText,
  llmCommandFlowKey,
  type TelegramLlmCommandContext,
} from './llm-command-flow.js';
import { defaultLlmCommandConfig } from './llm-command-config.js';
import type { LlmCommandDecision } from './llm-command-schema.js';
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

function createContext({
  messageText = 'texto',
  decision = helpDecision(),
  llmEnabled = true,
  privateFallbackEnabled = true,
}: {
  messageText?: string;
  decision?: LlmCommandDecision;
  llmEnabled?: boolean;
  privateFallbackEnabled?: boolean;
}): TelegramLlmCommandContext & {
  replies: string[];
  servicePrompts: string[];
  session: ConversationSessionRuntime;
} {
  const replies: string[] = [];
  const servicePrompts: string[] = [];
  const session = createSessionRuntime();
  return {
    messageText,
    from: {
      id: 123,
      first_name: 'Ada',
    },
    async reply(message) {
      replies.push(message);
    },
    runtime: {
      bot: {
        publicName: 'Game Club Bot',
        clubName: 'Game Club',
        language: 'es',
        async sendPrivateMessage() {},
      },
      services: {} as TelegramLlmCommandContext['runtime']['services'],
      chat: {
        kind: 'private',
        chatId: 123,
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
          return decision;
        },
      },
    },
    replies,
    servicePrompts,
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
