import type { TelegramCommandHandlerContext } from './command-registry.js';
import { buildLlmCommandPrompt } from './llm-command-prompt.js';
import { routeLlmCommandDecision, type LlmCommandRouteOutcome } from './llm-command-router.js';
import type { ResolvedLlmCommandConfig } from './llm-command-config.js';
import type { LlmCommandMetricAction, LlmCommandMetricResult, LlmCommandMetrics } from './llm-command-metrics.js';
import { LlmCommandServiceError } from './llm-command-service.js';
import type { BotLanguage } from './i18n.js';
import { executeTelegramLlmReadAction } from './llm-command-read-actions.js';

export const llmCommandFlowKey = 'llm-command';

export type TelegramLlmCommandContext = TelegramCommandHandlerContext & {
  runtime: TelegramCommandHandlerContext['runtime'] & {
    llmCommands?: ResolvedLlmCommandConfig;
    llmCommandService?: {
      interpret(prompt: string): Promise<import('./llm-command-schema.js').LlmCommandDecision>;
    };
    llmCommandMetrics?: LlmCommandMetrics;
  };
};

export type TelegramLlmCommandEntrySource = 'ask_command' | 'menu_button' | 'private_fallback' | 'group_mention' | 'session';

export async function handleTelegramLlmAskCommand(context: TelegramLlmCommandContext): Promise<void> {
  const text = parseAskCommandText(context.messageText ?? '');
  if (!text) {
    await startTelegramLlmCommandSession(context);
    await context.reply('Escribe qué quieres preguntarme. Puedo ayudarte con actividades, catálogo, Storage, compras, avisos y LFG.');
    return;
  }

  await handleTelegramLlmCommandText(context, {
    source: 'ask_command',
    text,
    force: true,
  });
}

export async function handleTelegramLlmMenuText(context: TelegramLlmCommandContext): Promise<boolean> {
  if (context.runtime.chat.kind !== 'private' || !context.runtime.actor.isApproved || context.runtime.actor.isBlocked) {
    return false;
  }

  if (!isLlmCommandsEnabled(context)) {
    await context.reply('Preguntar al bot todavía no está activado.');
    return true;
  }

  await startTelegramLlmCommandSession(context);
  await context.reply('Escribe qué quieres preguntarme. Puedo ayudarte con actividades, catálogo, Storage, compras, avisos y LFG.');
  return true;
}

export async function handleTelegramLlmFallbackText(context: TelegramLlmCommandContext): Promise<boolean> {
  const text = context.messageText?.trim();
  if (!text || text.startsWith('/')) {
    return false;
  }

  const activeSession = await getActiveLlmCommandSession(context);
  if (activeSession === 'expired') {
    await context.reply('La sesión de Preguntar al bot ha caducado. Vuelve a escribir /ask si quieres seguir.');
    return true;
  }
  if (activeSession === 'active') {
    await handleTelegramLlmCommandText(context, {
      source: 'session',
      text,
      force: true,
    });
    return true;
  }

  const config = getLlmCommandConfig(context);
  if (
    config?.enabled &&
    isExplicitGroupLlmRequest(context, text) &&
    context.runtime.actor.isApproved &&
    !context.runtime.actor.isBlocked
  ) {
    await handleTelegramLlmCommandText(context, {
      source: 'group_mention',
      text: stripBotMention(context, text),
      force: true,
    });
    return true;
  }

  if (
    !config?.enabled ||
    !config.privateFallbackEnabled ||
    context.runtime.chat.kind !== 'private' ||
    !context.runtime.actor.isApproved ||
    context.runtime.actor.isBlocked ||
    context.runtime.session.current !== null
  ) {
    return false;
  }

  await handleTelegramLlmCommandText(context, {
    source: 'private_fallback',
    text,
    force: false,
  });
  return true;
}

async function handleTelegramLlmCommandText(
  context: TelegramLlmCommandContext,
  input: {
    source: TelegramLlmCommandEntrySource;
    text: string;
    force: boolean;
  },
): Promise<void> {
  const config = getLlmCommandConfig(context);
  if (!config?.enabled) {
    await context.reply('Preguntar al bot todavía no está activado.');
    return;
  }

  const service = context.runtime.llmCommandService;
  if (!service) {
    await context.reply('Preguntar al bot no está configurado todavía.');
    return;
  }

  const language = (context.runtime.bot.language ?? 'ca') as BotLanguage;
  const startedAt = Date.now();
  const prompt = buildLlmCommandPrompt({
    userText: input.text,
    language,
    isApproved: context.runtime.actor.isApproved,
    isAdmin: context.runtime.actor.isAdmin,
    chatKind: context.runtime.chat.kind,
    hasTopic: Boolean(context.messageThreadId),
    history: readLlmCommandSessionHistory(context, config.maxHistory),
    maxPromptChars: config.maxPromptChars,
  });

  let decision: Awaited<ReturnType<typeof service.interpret>>;
  try {
    decision = await service.interpret(prompt);
  } catch (error) {
    await recordLlmCommandMetric(context, {
      source: input.source,
      language,
      startedAt,
      action: 'failure',
      result: metricResultForError(error),
      reason: metricReasonForError(error),
    });
    await context.reply('No he podido interpretar la petición ahora mismo. Prueba de nuevo en unos momentos o usa el menú normal.');
    return;
  }
  const outcome = routeLlmCommandDecision(decision, {
    isApproved: context.runtime.actor.isApproved,
    isAdmin: context.runtime.actor.isAdmin,
    chatKind: context.runtime.chat.kind,
    readConfidenceThreshold: config.readConfidenceThreshold,
    writeConfidenceThreshold: config.writeConfidenceThreshold,
  });

  await persistLlmCommandTurn(context, {
    source: input.source,
    userText: input.text,
    intent: decision.intent,
    replyText: resolveOutcomeReply(outcome),
  });
  await recordLlmCommandMetric(context, {
    source: input.source,
    language,
    startedAt,
    intent: decision.intent,
    confidence: decision.confidence,
    action: metricActionForOutcome(outcome),
    result: metricResultForOutcome(outcome),
    reason: metricReasonForOutcome(outcome),
  });
  await replyWithOutcome(context, outcome);
}

async function replyWithOutcome(
  context: TelegramLlmCommandContext,
  outcome: LlmCommandRouteOutcome,
): Promise<void> {
  const options = context.messageThreadId ? { messageThreadId: context.messageThreadId } : undefined;
  if (outcome.type === 'execute_read') {
    await context.reply(await executeTelegramLlmReadAction(context, outcome), options);
    return;
  }

  await context.reply(resolveOutcomeReply(outcome), options);
}

function resolveOutcomeReply(outcome: LlmCommandRouteOutcome): string {
  if ('message' in outcome) {
    return outcome.message;
  }
  return 'He entendido la petición.';
}

async function recordLlmCommandMetric(
  context: TelegramLlmCommandContext,
  input: {
    source: TelegramLlmCommandEntrySource;
    language: BotLanguage;
    startedAt: number;
    intent?: string;
    confidence?: number;
    action: LlmCommandMetricAction;
    result: LlmCommandMetricResult;
    reason?: string | null;
  },
): Promise<void> {
  const metrics = context.runtime.llmCommandMetrics;
  if (!metrics) {
    return;
  }

  try {
    await metrics.record({
      actorTelegramUserId: context.runtime.actor.telegramUserId,
      chatId: context.runtime.chat.chatId,
      chatKind: context.runtime.chat.kind,
      hasTopic: Boolean(context.messageThreadId),
      entrySource: input.source,
      language: input.language,
      intent: input.intent ?? null,
      confidence: input.confidence ?? null,
      action: input.action,
      result: input.result,
      reason: input.reason ?? null,
      elapsedMs: Date.now() - input.startedAt,
    });
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'telegram.llm_command.metric.failed',
      error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
    }));
  }
}

function metricActionForOutcome(outcome: LlmCommandRouteOutcome): LlmCommandMetricAction {
  if (outcome.type === 'execute_read' || outcome.type === 'answer_directly') {
    return 'read';
  }
  if (outcome.type === 'request_confirmation') {
    return 'confirmation';
  }
  if (outcome.type === 'ask_clarification') {
    return 'clarification';
  }
  return outcome.type;
}

function metricResultForOutcome(outcome: LlmCommandRouteOutcome): LlmCommandMetricResult {
  if (outcome.type === 'permission_denied') {
    return 'permission_denied';
  }
  if (outcome.type === 'unsupported') {
    return 'action_not_allowlisted';
  }
  return 'success';
}

function metricReasonForOutcome(outcome: LlmCommandRouteOutcome): string | null {
  if (outcome.type === 'confidence_too_low') {
    return `threshold:${outcome.threshold}`;
  }
  if (outcome.type === 'private_chat_required') {
    return outcome.targetIntent;
  }
  return null;
}

function metricResultForError(error: unknown): LlmCommandMetricResult {
  if (error instanceof LlmCommandServiceError) {
    if (error.code === 'timeout') return 'timeout';
    if (error.code === 'invalid_json') return 'invalid_json';
    if (error.code === 'not_configured') return 'not_configured';
    if (error.code === 'process_failed') return 'process_failed';
  }
  return 'unknown_error';
}

function metricReasonForError(error: unknown): string {
  if (error instanceof LlmCommandServiceError) {
    return error.code;
  }
  return error instanceof Error ? error.name : 'unknown';
}

async function startTelegramLlmCommandSession(context: TelegramLlmCommandContext): Promise<void> {
  const config = getLlmCommandConfig(context);
  const now = new Date();
  await context.runtime.session.start({
    flowKey: llmCommandFlowKey,
    stepKey: 'awaiting-input',
    data: {
      llmExpiresAt: new Date(now.getTime() + (config?.sessionTtlMinutes ?? 15) * 60_000).toISOString(),
      history: [],
    },
  });
}

async function persistLlmCommandTurn(
  context: TelegramLlmCommandContext,
  turn: {
    source: TelegramLlmCommandEntrySource;
    userText: string;
    intent: string;
    replyText: string;
  },
): Promise<void> {
  if (context.runtime.chat.kind !== 'private') {
    return;
  }

  const session = context.runtime.session.current;
  if (!session || session.flowKey !== llmCommandFlowKey) {
    return;
  }

  const config = getLlmCommandConfig(context);
  const maxHistory = Math.max(0, config?.maxHistory ?? 8);
  const currentHistory = Array.isArray(session.data.history) ? session.data.history : [];
  const nextHistory = [
    ...currentHistory,
    { role: 'user', text: truncateForSession(turn.userText), source: turn.source },
    { role: 'assistant', text: truncateForSession(turn.replyText), intent: turn.intent },
  ].slice(-maxHistory);

  await context.runtime.session.advance({
    stepKey: 'awaiting-input',
    data: {
      ...session.data,
      llmExpiresAt: new Date(Date.now() + (config?.sessionTtlMinutes ?? 15) * 60_000).toISOString(),
      history: nextHistory,
    },
  });
}

async function getActiveLlmCommandSession(context: TelegramLlmCommandContext): Promise<'none' | 'active' | 'expired'> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== llmCommandFlowKey) {
    return 'none';
  }

  const expiresAt = typeof session.data.llmExpiresAt === 'string' ? session.data.llmExpiresAt : session.expiresAt;
  if (expiresAt <= new Date().toISOString()) {
    await context.runtime.session.cancel();
    return 'expired';
  }

  return 'active';
}

function readLlmCommandSessionHistory(
  context: TelegramLlmCommandContext,
  maxHistory: number,
): Array<{ role: 'user' | 'assistant'; intent?: string; text: string }> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== llmCommandFlowKey || !Array.isArray(session.data.history)) {
    return [];
  }

  return session.data.history
    .filter(isHistoryEntry)
    .slice(-Math.max(0, maxHistory));
}

function isHistoryEntry(value: unknown): value is { role: 'user' | 'assistant'; intent?: string; text: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'role' in value &&
    'text' in value &&
    (value.role === 'user' || value.role === 'assistant') &&
    typeof value.text === 'string' &&
    (!('intent' in value) || typeof value.intent === 'string')
  );
}

function parseAskCommandText(messageText: string): string {
  return messageText.replace(/^\/ask(?:@\w+)?/i, '').trim();
}

function getLlmCommandConfig(context: TelegramLlmCommandContext): ResolvedLlmCommandConfig | undefined {
  return context.runtime.llmCommands;
}

function isLlmCommandsEnabled(context: TelegramLlmCommandContext): boolean {
  return Boolean(getLlmCommandConfig(context)?.enabled);
}

function isExplicitGroupLlmRequest(context: TelegramLlmCommandContext, text: string): boolean {
  if (context.runtime.chat.kind === 'private') {
    return false;
  }
  if (context.replyToBotMessage) {
    return true;
  }

  const username = context.runtime.bot.username;
  if (!username) {
    return false;
  }

  return new RegExp(`(^|\\s)@${escapeRegExp(username)}\\b`, 'i').test(text);
}

function stripBotMention(context: TelegramLlmCommandContext, text: string): string {
  const username = context.runtime.bot.username;
  if (!username) {
    return text;
  }

  return text.replace(new RegExp(`(^|\\s)@${escapeRegExp(username)}\\b`, 'ig'), ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function truncateForSession(value: string): string {
  return value.length > 500 ? `${value.slice(0, 497)}...` : value;
}
