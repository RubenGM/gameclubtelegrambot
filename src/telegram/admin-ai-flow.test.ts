import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adminAiCallbackPrefixes,
  adminAiFlowKey,
  handleTelegramAdminAiCallback,
  handleTelegramAdminAiCommand,
  parseAdminAiCommandText,
  type AdminAiPlan,
} from './admin-ai-flow.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import type { ConversationSessionRecord } from './conversation-session.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

test('parseAdminAiCommandText accepts prompts and bot-qualified commands', () => {
  assert.equal(parseAdminAiCommandText('/adminai reinicia el bot'), 'reinicia el bot');
  assert.equal(parseAdminAiCommandText('/adminai@gameclubbot  abre usuarios '), 'abre usuarios');
  assert.equal(parseAdminAiCommandText('/adminai'), null);
});

test('handleTelegramAdminAiCommand creates a mandatory confirmation with a safe allowlisted plan', async () => {
  const context = createContext({ messageText: '/adminai gestiona los usuarios' });

  await handleTelegramAdminAiCommand(context.context);

  assert.equal(context.generated.length, 1);
  assert.equal(context.generated[0]?.schemaPath, 'src/telegram/admin-ai-plan.schema.json');
  assert.deepEqual(context.generated[0]?.options, {
    model: 'gpt-5.6-sol',
    reasoningEffort: 'low',
  });
  assert.match(context.generated[0]?.prompt ?? '', /gestiona los usuarios/);
  assert.equal(context.currentSession?.flowKey, adminAiFlowKey);
  assert.equal(context.currentSession?.stepKey, 'confirm');
  assert.match(context.edits.at(-1)?.text ?? '', /He interpretado esto:/);
  assert.match(context.edits.at(-1)?.text ?? '', /Acciones previstas:\n1\. Abrir la gestión de usuarios/);
  assert.deepEqual(context.edits.at(-1)?.options, {
    inlineKeyboard: [[
      { text: 'Aceptar', callbackData: adminAiCallbackPrefixes.confirm, semanticRole: 'success' },
      { text: 'Cancelar', callbackData: adminAiCallbackPrefixes.cancel, semanticRole: 'danger' },
    ]],
  });
});

test('handleTelegramAdminAiCallback cancels without executing the planned target', async () => {
  const context = createContext({ callbackData: adminAiCallbackPrefixes.cancel, activePlan: defaultPlan });
  let executions = 0;

  assert.equal(await handleTelegramAdminAiCallback(context.context, async () => {
    executions += 1;
    return true;
  }), true);

  assert.equal(executions, 0);
  assert.equal(context.currentSession, null);
  assert.equal(context.replies.at(-1)?.message, 'Operación administrativa cancelada.');
});

test('handleTelegramAdminAiCallback executes only after accepting a valid current plan', async () => {
  const context = createContext({ callbackData: adminAiCallbackPrefixes.confirm, activePlan: defaultPlan });
  const executed: AdminAiPlan[] = [];

  assert.equal(await handleTelegramAdminAiCallback(context.context, async (_callbackContext, plan) => {
    executed.push(plan);
    return true;
  }), true);

  assert.deepEqual(executed, [defaultPlan]);
  assert.equal(context.currentSession, null);
  assert.equal(context.replies.at(-1)?.message, 'Confirmado. Abro el flujo seguro correspondiente.');
});

test('handleTelegramAdminAiCommand refuses non-admin users before invoking the model', async () => {
  const context = createContext({ messageText: '/adminai reinicia', isAdmin: false });

  await handleTelegramAdminAiCommand(context.context);

  assert.equal(context.generated.length, 0);
  assert.equal(context.replies.at(-1)?.message, 'Este comando solo está disponible para administradores.');
});

test('handleTelegramAdminAiCommand rejects model output outside the local allowlist', async () => {
  const context = createContext({
    messageText: '/adminai borra la base de datos',
    generatedPlan: {
      ...defaultPlan,
      target: 'shell_command',
    },
  });

  await handleTelegramAdminAiCommand(context.context);

  assert.equal(context.currentSession, null);
  assert.equal(context.edits.at(-1)?.text, 'No he podido preparar un plan administrativo seguro. No se ha ejecutado ninguna acción.');
});

const defaultPlan: AdminAiPlan = {
  version: 1,
  explanation: 'Abriré la gestión guiada de usuarios del bot.',
  actions: ['Abrir la gestión de usuarios', 'Mantener las validaciones y confirmaciones del flujo existente'],
  target: 'manage_users',
};

function createContext({
  messageText,
  callbackData,
  isAdmin = true,
  activePlan,
  generatedPlan = defaultPlan,
}: {
  messageText?: string;
  callbackData?: string;
  isAdmin?: boolean;
  activePlan?: AdminAiPlan;
  generatedPlan?: unknown;
}) {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const edits: Array<{ text: string; options?: TelegramReplyOptions }> = [];
  const generated: Array<{ prompt: string; schemaPath?: string; options?: unknown }> = [];
  let currentSession: ConversationSessionRecord | null = activePlan
    ? makeSession(activePlan)
    : null;

  const context = {
    messageText,
    callbackData,
    async reply(message: string, options?: TelegramReplyOptions) {
      replies.push({ message, ...(options ? { options } : {}) });
      return { message_id: 91 };
    },
    runtime: {
      bot: {
        publicName: 'Club',
        clubName: 'Club',
        language: 'es' as const,
        async sendPrivateMessage() {},
        async editMessageText(input: { text: string; options?: TelegramReplyOptions }) {
          edits.push({ text: input.text, ...(input.options ? { options: input.options } : {}) });
        },
      },
      chat: { kind: 'private' as const, chatId: 100 },
      actor: {
        telegramUserId: 7,
        status: 'approved' as const,
        isApproved: true,
        isBlocked: false,
        isAdmin,
        permissions: [],
      },
      authorization: { can: () => true },
      services: { database: { db: {} } },
      session: {
        get current() {
          return currentSession;
        },
        async start(input: { flowKey: string; stepKey: string; data?: Record<string, unknown> }) {
          currentSession = {
            key: 'telegram.session:100:7',
            flowKey: input.flowKey,
            stepKey: input.stepKey,
            data: input.data ?? {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          };
          return currentSession;
        },
        async advance() {
          if (!currentSession) throw new Error('No active session');
          return currentSession;
        },
        async cancel() {
          const existed = currentSession !== null;
          currentSession = null;
          return existed;
        },
      },
      llmCommandService: {
        async interpret() {
          throw new Error('not used');
        },
        async generateJson(prompt: string, schemaPath?: string, options?: unknown) {
          generated.push({ prompt, ...(schemaPath ? { schemaPath } : {}), ...(options ? { options } : {}) });
          return generatedPlan;
        },
      },
      logger: {
        warn() {},
        error() {},
      },
    },
  } as unknown as TelegramCommandHandlerContext;

  return {
    context,
    replies,
    edits,
    generated,
    get currentSession() {
      return currentSession;
    },
  };
}

function makeSession(plan: AdminAiPlan): ConversationSessionRecord {
  return {
    key: 'telegram.session:100:7',
    flowKey: adminAiFlowKey,
    stepKey: 'confirm',
    data: { plan, userPrompt: 'gestiona usuarios' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}
