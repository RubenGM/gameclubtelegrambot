import type { TelegramCommandHandlerContext } from './command-registry.js';
import { buildLlmCommandPrompt } from './llm-command-prompt.js';
import { routeLlmCommandDecision, type LlmCommandRouteOutcome } from './llm-command-router.js';
import type { ResolvedLlmCommandConfig } from './llm-command-config.js';
import type { LlmCommandMetricAction, LlmCommandMetricResult, LlmCommandMetrics } from './llm-command-metrics.js';
import type { LlmCommandDecision } from './llm-command-schema.js';
import { LlmCommandServiceError, type LlmCommandGenerateJsonOptions } from './llm-command-service.js';
import { createTelegramI18n, normalizeBotLanguage, type BotLanguage } from './i18n.js';
import { catalogLoanCallbackPrefixes, handleTelegramCatalogLoanCallback } from './catalog-loan-flow.js';
import { groupPurchaseCallbackPrefixes, handleTelegramGroupPurchaseCallback } from './group-purchase-flow.js';
import { handleTelegramLfgText } from './lfg-flow.js';
import { noticeCallbackPrefixes, noticeFlowKey, handleTelegramNoticeCallback, handleTelegramNoticeText } from './notice-flow.js';
import { scheduleCallbackPrefixes, handleTelegramScheduleCallback } from './schedule-flow.js';
import { storageCallbackPrefixes, handleTelegramStorageCallback, handleTelegramStorageText } from './storage-flow.js';
import { executeTelegramLlmReadAction } from './llm-command-read-actions.js';
import { startTelegramEditableProgress, type TelegramEditableProgress } from './editable-progress.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import { createDatabaseAppMetadataSessionStorage } from './conversation-session-store.js';
import {
  createAppMetadataLlmModelSettingsStore,
  defaultLlmModelSettings,
  selectionToGenerateJsonOptions,
  type LlmModelSettings,
} from './llm-model-settings.js';

export const llmCommandFlowKey = 'llm-command';
export const llmCommandCallbackPrefixes = {
  confirmWrite: 'llm_cmd:confirm',
  cancelWrite: 'llm_cmd:cancel',
} as const;

export type TelegramLlmCommandContext = TelegramCommandHandlerContext & {
  runtime: TelegramCommandHandlerContext['runtime'] & {
    llmCommands?: ResolvedLlmCommandConfig;
    llmCommandService?: {
      interpret(prompt: string, options?: LlmCommandGenerateJsonOptions): Promise<import('./llm-command-schema.js').LlmCommandDecision>;
      generateJson?(prompt: string, schemaPath?: string, options?: LlmCommandGenerateJsonOptions): Promise<unknown>;
    };
    llmCommandMetrics?: LlmCommandMetrics;
  };
};

export type TelegramLlmCommandEntrySource = 'ask_command' | 'menu_button' | 'private_fallback' | 'group_mention' | 'session';

export async function handleTelegramLlmAskCommand(context: TelegramLlmCommandContext): Promise<void> {
  const text = parseAskCommandText(context.messageText ?? '');
  if (!text) {
    await startTelegramLlmCommandSession(context);
    await context.reply(resolveLlmCommandTexts(context).askPrompt);
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
    await context.reply(resolveLlmCommandTexts(context).disabled);
    return true;
  }

  await startTelegramLlmCommandSession(context);
  await context.reply(resolveLlmCommandTexts(context).askPrompt);
  return true;
}

export async function handleTelegramLlmFallbackText(context: TelegramLlmCommandContext): Promise<boolean> {
  const text = context.messageText?.trim();
  if (!text || text.startsWith('/')) {
    return false;
  }

  const activeSession = await getActiveLlmCommandSession(context);
  if (activeSession === 'expired') {
    await context.reply(resolveLlmCommandTexts(context).sessionExpired);
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
    isBlockingLlmFallbackSession(context.runtime.session.current)
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

export async function handleTelegramLlmCallback(context: TelegramLlmCommandContext): Promise<boolean> {
  const callbackData = context.callbackData;
  if (!callbackData || context.runtime.chat.kind !== 'private') {
    return false;
  }

  if (callbackData === llmCommandCallbackPrefixes.cancelWrite) {
    if (context.runtime.session.current?.flowKey === llmCommandFlowKey) {
      await context.runtime.session.cancel();
    }
    await context.reply(resolveLlmCommandTexts(context).cancelled);
    return true;
  }

  if (callbackData !== llmCommandCallbackPrefixes.confirmWrite) {
    return false;
  }

  const session = context.runtime.session.current;
  if (!session || session.flowKey !== llmCommandFlowKey || session.stepKey !== 'confirm-write') {
    await context.reply(resolveLlmCommandTexts(context).staleConfirmation);
    return true;
  }

  const pending = readPendingWrite(session.data);
  if (!pending) {
    await context.runtime.session.cancel();
    await context.reply(resolveLlmCommandTexts(context).pendingMissing);
    return true;
  }

  const prepared = await prepareConfirmedWrite(context, pending);
  if (!prepared) {
    await context.runtime.session.cancel();
    await context.reply(resolveLlmCommandTexts(context).unsupportedPrefill);
  }
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
    await context.reply(resolveLlmCommandTexts(context).disabled);
    return;
  }

  const service = context.runtime.llmCommandService;
  if (!service) {
    await context.reply(resolveLlmCommandTexts(context).serviceMissing);
    return;
  }

  const language = resolveLlmCommandLanguage(context);
  const texts = createTelegramI18n(language).llmCommand;
  const startedAt = Date.now();
  const progressOptions = context.messageThreadId ? { messageThreadId: context.messageThreadId } : undefined;
  const progress = await startTelegramEditableProgress(
    context,
    buildLlmProgressMessage({
      percent: 10,
      phase: texts.progressReceivedPhase,
      detail: texts.progressReceivedDetail,
      userText: input.text,
    }),
    { editFailedEvent: 'llm-command.progress-edit.failed' },
    progressOptions,
  );
  const prompt = buildLlmCommandPrompt({
    userText: input.text,
    language,
    isApproved: context.runtime.actor.isApproved,
    isAdmin: context.runtime.actor.isAdmin,
    chatKind: context.runtime.chat.kind,
    hasTopic: Boolean(context.messageThreadId),
    ...(context.replyToBotMessageContext ? { replyContext: context.replyToBotMessageContext } : {}),
    history: readLlmCommandSessionHistory(context, config.maxHistory),
    maxPromptChars: config.maxPromptChars,
  });

  const modelSettings = await loadLlmModelSettings(context);
  let decision: Awaited<ReturnType<typeof service.interpret>>;
  try {
    decision = await runWithProgressHeartbeat(
      () => service.interpret(prompt, selectionToGenerateJsonOptions(modelSettings.normal)),
      progress,
      [
        buildLlmProgressMessage({
          percent: 25,
          phase: texts.progressAnalyzingPhase,
          detail: texts.progressAnalyzingDetail,
          userText: input.text,
        }),
        buildLlmProgressMessage({
          percent: 40,
          phase: texts.progressWaitingPhase,
          detail: texts.progressWaitingDetail,
          userText: input.text,
        }),
        buildLlmProgressMessage({
          percent: 55,
          phase: texts.progressValidatingPhase,
          detail: texts.progressValidatingDetail,
          userText: input.text,
        }),
        buildLlmProgressMessage({
          percent: 60,
          phase: texts.progressAlmostPhase,
          detail: texts.progressAlmostDetail,
          userText: input.text,
        }),
      ],
      progressOptions,
    );
  } catch (error) {
    await recordLlmCommandMetric(context, {
      source: input.source,
      language,
      startedAt,
      action: 'failure',
      result: metricResultForError(error),
      reason: metricReasonForError(error),
    });
    await progress.complete(resolveLlmInterpretFailureMessage(error, texts));
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
    replyText: resolveOutcomeReply(outcome, texts),
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
  await replyWithOutcome(context, outcome, progress, input.text, readDecisionProgressMessages(decision), resolveNextStepModelOptions(decision, outcome, modelSettings));
}

async function replyWithOutcome(
  context: TelegramLlmCommandContext,
  outcome: LlmCommandRouteOutcome,
  progress?: TelegramEditableProgress,
  userText?: string,
  progressMessages: string[] = [],
  nextStepModelOptions?: LlmCommandGenerateJsonOptions,
): Promise<void> {
  const options = buildLlmReplyOptions(context);
  const texts = resolveLlmCommandTexts(context);
  if (outcome.type === 'execute_read') {
    await progress?.update(buildLlmProgressMessage({
      percent: 65,
      phase: texts.progressUnderstoodPhase,
      detail: progressMessages[0] ?? texts.progressReadDetail,
      ...(userText ? { userText } : {}),
    }));
    const readInput = userText ? { ...outcome, userText } : outcome;
    const message = await executeTelegramLlmReadAction(context, {
      ...readInput,
      ...(progress ? { progress: createLlmReadProgress(progress, userText, progressMessages.slice(1), texts) } : {}),
      ...(nextStepModelOptions ? { modelOptions: nextStepModelOptions } : {}),
    });
    const readOptions: TelegramReplyOptions = { ...options, parseMode: 'HTML' };
    if (progress) {
      await progress.complete(message, readOptions);
    } else {
      await context.reply(message, readOptions);
    }
    return;
  }
  if (outcome.type === 'request_confirmation') {
    await progress?.update(buildLlmProgressMessage({
      percent: 75,
      phase: texts.progressUnderstoodPhase,
      detail: progressMessages[0] ?? texts.progressConfirmationDetail,
      ...(userText ? { userText } : {}),
    }));
    await startLlmWriteConfirmation(context, outcome, progress);
    return;
  }

  if (progress) {
    await progress.complete(resolveOutcomeReply(outcome, texts), options);
  } else {
    await context.reply(resolveOutcomeReply(outcome, texts), options);
  }
}

const llmCommandStrongerNextStepIntents = new Set([
  'bot.search',
  'catalog.detail',
  'catalog.recommend',
  'storage.search',
]);

export function resolveNextStepModelOptions(
  decision: LlmCommandDecision,
  outcome: LlmCommandRouteOutcome,
  modelSettings: LlmModelSettings = defaultLlmModelSettings,
): LlmCommandGenerateJsonOptions | undefined {
  if (outcome.type !== 'execute_read' || !decision.nextStep.useStrongerModel) {
    return undefined;
  }
  if (!llmCommandStrongerNextStepIntents.has(outcome.intent)) {
    return undefined;
  }
  return selectionToGenerateJsonOptions(modelSettings.stronger);
}

async function loadLlmModelSettings(context: TelegramLlmCommandContext): Promise<LlmModelSettings> {
  try {
    return await createAppMetadataLlmModelSettingsStore({
      storage: createDatabaseAppMetadataSessionStorage({ database: context.runtime.services.database.db }),
    }).getSettings();
  } catch {
    return defaultLlmModelSettings;
  }
}

function createLlmReadProgress(
  progress: TelegramEditableProgress,
  userText: string | undefined,
  customMessages: string[],
  texts: ReturnType<typeof createTelegramI18n>['llmCommand'],
): { update(message: string): Promise<boolean> } {
  let index = 0;
  const phases = [
    { percent: 75, phase: texts.readProgressSearching },
    { percent: 85, phase: texts.readProgressFiltering },
    { percent: 92, phase: texts.readProgressPreparing },
  ];
  return {
    update(message: string) {
      const phase = phases[Math.min(index, phases.length - 1)] ?? { percent: 92, phase: 'Preparando respuesta' };
      const detail = customMessages[index] ?? message;
      index += 1;
      return progress.update(buildLlmProgressMessage({
        percent: phase.percent,
        phase: phase.phase,
        detail,
        ...(userText ? { userText } : {}),
      }));
    },
  };
}

function buildLlmProgressMessage(input: {
  percent: number;
  phase: string;
  detail: string;
  userText?: string;
}): string {
  const percent = Math.max(0, Math.min(99, Math.round(input.percent)));
  return [
    renderProgressBar(percent),
    sanitizeProgressText(input.phase, 120),
    sanitizeProgressText(input.detail, 220),
  ].filter(Boolean).join('\n\n');
}

function renderProgressBar(percent: number): string {
  const total = 10;
  const filled = Math.max(0, Math.min(total, Math.round((percent / 100) * total)));
  return `[${'#'.repeat(filled)}${'-'.repeat(total - filled)}]`;
}

function readDecisionProgressMessages(decision: LlmCommandDecision): string[] {
  return decision.progress.messages
    .map((message) => sanitizeProgressText(message, 180))
    .filter(Boolean)
    .slice(0, 4);
}

function sanitizeProgressText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 3))}...` : normalized;
}

async function runWithProgressHeartbeat<T>(
  task: () => Promise<T>,
  progress: TelegramEditableProgress,
  messages: string[],
  options?: TelegramReplyOptions,
): Promise<T> {
  let messageIndex = 1;
  let editInFlight = false;
  const interval = setInterval(() => {
    const nextMessage = messages[Math.min(messageIndex, messages.length - 1)];
    messageIndex += 1;
    if (!nextMessage || editInFlight) {
      return;
    }
    editInFlight = true;
    void progress.update(nextMessage, options).finally(() => {
      editInFlight = false;
    });
  }, 8000);
  try {
    return await task();
  } finally {
    clearInterval(interval);
  }
}

function resolveLlmInterpretFailureMessage(
  error: unknown,
  texts: ReturnType<typeof createTelegramI18n>['llmCommand'],
): string {
  if (error instanceof LlmCommandServiceError && error.code === 'timeout') {
    return texts.timeoutFailure;
  }
  return texts.genericFailure;
}

function buildLlmReplyOptions(context: TelegramLlmCommandContext): Parameters<TelegramLlmCommandContext['reply']>[1] {
  const messageThreadId = context.messageThreadId;
  const privateUrl = context.runtime.chat.kind !== 'private' && context.runtime.bot.username
    ? `https://t.me/${context.runtime.bot.username}?start=llm_ask`
    : undefined;
  if (!messageThreadId && !privateUrl) {
    return undefined;
  }

  return {
    ...(messageThreadId ? { messageThreadId } : {}),
    ...(privateUrl ? { inlineKeyboard: [[{ text: resolveLlmCommandTexts(context).openPrivateButton, url: privateUrl }]] } : {}),
  };
}

function resolveOutcomeReply(
  outcome: LlmCommandRouteOutcome,
  texts: ReturnType<typeof createTelegramI18n>['llmCommand'],
): string {
  if ('message' in outcome) {
    return outcome.message;
  }
  return texts.defaultOutcomeReply;
}

async function startLlmWriteConfirmation(
  context: TelegramLlmCommandContext,
  outcome: Extract<LlmCommandRouteOutcome, { type: 'request_confirmation' }>,
  progress?: TelegramEditableProgress,
): Promise<void> {
  await context.runtime.session.start({
    flowKey: llmCommandFlowKey,
    stepKey: 'confirm-write',
    data: {
      intent: outcome.intent,
      params: outcome.params,
      message: outcome.message,
      llmExpiresAt: new Date(Date.now() + (getLlmCommandConfig(context)?.sessionTtlMinutes ?? 15) * 60_000).toISOString(),
    },
  });
  const texts = resolveLlmCommandTexts(context);
  const message = `${outcome.message}\n\n${texts.writeConfirmationPrompt}`;
  const options: TelegramReplyOptions = {
    inlineKeyboard: [[
      { text: texts.prepareButton, callbackData: llmCommandCallbackPrefixes.confirmWrite, semanticRole: 'success' },
      { text: texts.cancelButton, callbackData: llmCommandCallbackPrefixes.cancelWrite, semanticRole: 'danger' },
    ]],
  };
  if (progress) {
    await progress.complete(message, options);
    return;
  }
  await context.reply(message, options);
}

async function prepareConfirmedWrite(
  context: TelegramLlmCommandContext,
  pending: { intent: string; params: Record<string, unknown> },
): Promise<boolean> {
  if (pending.intent === 'notice.create') {
    const text = pickStringParam(pending.params, ['text', 'message', 'body', 'content']);
    if (!text) {
      return false;
    }
    await context.runtime.session.start({
      flowKey: noticeFlowKey,
      stepKey: 'confirm',
      data: {
        text,
        textHtml: null,
        attachments: [],
        expiresAt: pickStringParam(pending.params, ['expiresAt']) ?? null,
      },
    });
    await handleTelegramNoticeText({ ...context, messageText: '__llm_prefill__' });
    return true;
  }

  if (pending.intent === 'notice.archive') {
    const noticeId = pickNumberParam(pending.params, ['noticeId', 'id']);
    if (noticeId === null) {
      return false;
    }
    return handleTelegramNoticeCallback({
      ...context,
      callbackData: `${noticeCallbackPrefixes.archiveConfirm}${noticeId}`,
    });
  }

  if (pending.intent === 'lfg.create') {
    const title = pickStringParam(pending.params, ['title', 'groupTitle']);
    const description = pickStringParam(pending.params, ['description', 'text', 'message']);
    if (!description) {
      return false;
    }
    if (title) {
      await context.runtime.session.start({
        flowKey: 'lfg-group-ad',
        stepKey: 'confirm',
        data: {
          title,
          description,
          seatsAvailable: pickNumberParam(pending.params, ['seatsAvailable', 'seats']) ?? null,
        },
      });
    } else {
      await context.runtime.session.start({
        flowKey: 'lfg-player-ad',
        stepKey: 'confirm',
        data: { description },
      });
    }
    await handleTelegramLfgText({ ...context, messageText: '__llm_prefill__' });
    return true;
  }

  if (pending.intent === 'schedule.join' || pending.intent === 'schedule.leave') {
    const eventId = pickNumberParam(pending.params, ['eventId', 'scheduleEventId', 'activityId', 'id']);
    if (eventId === null) {
      return false;
    }
    return handleTelegramScheduleCallback({
      ...context,
      callbackData: `${pending.intent === 'schedule.join' ? scheduleCallbackPrefixes.join : scheduleCallbackPrefixes.leave}${eventId}`,
    });
  }

  if (pending.intent === 'group_purchase.join') {
    const purchaseId = pickNumberParam(pending.params, ['purchaseId', 'groupPurchaseId', 'id']);
    if (purchaseId === null) {
      return false;
    }
    return handleTelegramGroupPurchaseCallback({
      ...context,
      callbackData: `${groupPurchaseCallbackPrefixes.joinInterested}${purchaseId}`,
    });
  }

  if (pending.intent === 'catalog.loan.create') {
    const itemId = pickNumberParam(pending.params, ['itemId', 'catalogItemId', 'id']);
    if (itemId === null) {
      return false;
    }
    return handleTelegramCatalogLoanCallback({
      ...context,
      callbackData: `${catalogLoanCallbackPrefixes.create}${itemId}`,
    });
  }

  if (pending.intent === 'storage.upload.start') {
    const categoryId = pickNumberParam(pending.params, ['categoryId', 'storageCategoryId', 'id']);
    if (categoryId !== null) {
      return handleTelegramStorageCallback({
        ...context,
        callbackData: `${storageCallbackPrefixes.uploadCategory}${categoryId}`,
      });
    }
    return handleTelegramStorageText({
      ...context,
      messageText: createTelegramI18n((context.runtime.bot.language ?? 'ca') as BotLanguage).storage.upload,
    });
  }

  return false;
}

function readPendingWrite(data: Record<string, unknown>): { intent: string; params: Record<string, unknown> } | null {
  if (typeof data.intent !== 'string' || !isRecord(data.params)) {
    return null;
  }
  return {
    intent: data.intent,
    params: data.params,
  };
}

function pickStringParam(params: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function pickNumberParam(params: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function isBlockingLlmFallbackSession(session: TelegramLlmCommandContext['runtime']['session']['current']): boolean {
  if (!session) {
    return false;
  }
  return session.flowKey !== 'catalog-read';
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

  return new RegExp(`^\\s*@${escapeRegExp(username)}\\b`, 'i').test(text);
}

function stripBotMention(context: TelegramLlmCommandContext, text: string): string {
  const username = context.runtime.bot.username;
  if (!username) {
    return text;
  }

  return text.replace(new RegExp(`^\\s*@${escapeRegExp(username)}\\b`, 'i'), '').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveLlmCommandLanguage(context: TelegramLlmCommandContext): BotLanguage {
  return normalizeBotLanguage(context.runtime.bot.language, 'ca');
}

function resolveLlmCommandTexts(context: TelegramLlmCommandContext): ReturnType<typeof createTelegramI18n>['llmCommand'] {
  return createTelegramI18n(resolveLlmCommandLanguage(context)).llmCommand;
}

function truncateForSession(value: string): string {
  return value.length > 500 ? `${value.slice(0, 497)}...` : value;
}
