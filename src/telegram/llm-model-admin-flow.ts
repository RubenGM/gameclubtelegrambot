import { createDatabaseAppMetadataSessionStorage } from './conversation-session-store.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import { startTelegramEditableProgress } from './editable-progress.js';
import {
  createAppMetadataLlmModelSettingsStore,
  defaultLlmModelSettings,
  findLlmModelDefinition,
  formatLlmModelSelection,
  isAllowedLlmModelReasoning,
  llmModelDefinitions,
  loadAllLlmModelTestResults,
  loadLlmModelTestResult,
  saveLlmModelTestResult,
  selectionToGenerateJsonOptions,
  type LlmModelSelection,
  type LlmModelSlot,
  type LlmModelTestResult,
} from './llm-model-settings.js';
import { buildLlmCommandPrompt } from './llm-command-prompt.js';
import { createTelegramI18n, normalizeBotLanguage, type BotLanguage } from './i18n.js';
import { escapeHtml } from './schedule-presentation.js';

export const llmModelAdminCallbackPrefixes = {
  open: 'llm_model:open',
  selectSlot: 'llm_model:slot:',
  selectModel: 'llm_model:model:',
  selectReasoning: 'llm_model:reason:',
  runTest: 'llm_model:test:',
} as const;

type TelegramLlmModelAdminContext = TelegramCommandHandlerContext & {
  runtime: TelegramCommandHandlerContext['runtime'] & {
    llmCommandService?: TelegramCommandHandlerContext['runtime']['llmCommandService'];
  };
};

export async function handleTelegramLlmModelAdminText(context: TelegramLlmModelAdminContext): Promise<boolean> {
  const text = context.messageText?.trim();
  const language = resolveLlmModelAdminLanguage(context);
  if (text !== createTelegramI18n(language).actionMenu.llmModels) {
    return false;
  }
  if (!canManageLlmModels(context)) {
    await context.reply(createTelegramI18n(language).common.accessDeniedAdmin);
    return true;
  }
  await sendLlmModelAdminMenu(context);
  return true;
}

export async function handleTelegramLlmModelAdminCallback(context: TelegramLlmModelAdminContext): Promise<boolean> {
  const callbackData = context.callbackData;
  if (!callbackData || context.runtime.chat.kind !== 'private' || !canManageLlmModels(context)) {
    return false;
  }

  if (callbackData === llmModelAdminCallbackPrefixes.open) {
    await sendLlmModelAdminMenu(context);
    return true;
  }

  if (callbackData.startsWith(llmModelAdminCallbackPrefixes.selectSlot)) {
    const slot = parseSlot(callbackData.slice(llmModelAdminCallbackPrefixes.selectSlot.length));
    if (!slot) {
      return false;
    }
    const texts = createTelegramI18n(resolveLlmModelAdminLanguage(context)).llmModelAdmin;
    await context.reply(formatLlmModelAdminText(texts.selectModelPrompt, { slot: slotLabel(slot, texts) }), {
      inlineKeyboard: buildModelSelectionKeyboard(slot, texts),
    });
    return true;
  }

  if (callbackData.startsWith(llmModelAdminCallbackPrefixes.selectModel)) {
    const parsed = parseSlotAndModel(callbackData.slice(llmModelAdminCallbackPrefixes.selectModel.length));
    if (!parsed) {
      return false;
    }
    const definition = findLlmModelDefinition(parsed.model);
    if (!definition) {
      return false;
    }
    const texts = createTelegramI18n(resolveLlmModelAdminLanguage(context)).llmModelAdmin;
    await context.reply(formatLlmModelAdminText(texts.selectReasoningPrompt, {
      model: definition.label,
      slot: slotLabel(parsed.slot, texts),
    }), {
      inlineKeyboard: buildReasoningSelectionKeyboard(parsed.slot, parsed.model, texts),
    });
    return true;
  }

  if (callbackData.startsWith(llmModelAdminCallbackPrefixes.selectReasoning)) {
    const parsed = parseSlotModelReasoning(callbackData.slice(llmModelAdminCallbackPrefixes.selectReasoning.length));
    if (!parsed || !isAllowedLlmModelReasoning(parsed.model, parsed.reasoningEffort)) {
      return false;
    }
    const settings = await getSettingsStore(context).saveSelection(parsed.slot, {
      model: parsed.model,
      reasoningEffort: parsed.reasoningEffort,
    });
    const texts = createTelegramI18n(resolveLlmModelAdminLanguage(context)).llmModelAdmin;
    await context.reply([
      texts.settingsSaved,
      '',
      `${texts.normalLabel}: ${formatLlmModelSelection(settings.normal)}`,
      `${texts.strongerLabel}: ${formatLlmModelSelection(settings.stronger)}`,
    ].join('\n'), { inlineKeyboard: [[{ text: texts.backToModelsButton, callbackData: llmModelAdminCallbackPrefixes.open }]] });
    return true;
  }

  if (callbackData.startsWith(llmModelAdminCallbackPrefixes.runTest)) {
    const parsed = parseModelReasoning(callbackData.slice(llmModelAdminCallbackPrefixes.runTest.length));
    if (!parsed || !isAllowedLlmModelReasoning(parsed.model, parsed.reasoningEffort)) {
      return false;
    }
    await runLlmModelTestFromTelegram(context, parsed);
    return true;
  }

  return false;
}

export async function sendLlmModelAdminMenu(context: TelegramLlmModelAdminContext): Promise<void> {
  const settings = await getSettingsStore(context).getSettings();
  const results = await loadAllLlmModelTestResults();
  const language = resolveLlmModelAdminLanguage(context);
  const texts = createTelegramI18n(language).llmModelAdmin;
  await context.reply(renderLlmModelAdminMenu(settings, results, language), {
    parseMode: 'HTML',
    inlineKeyboard: [
      [
        { text: texts.changeNormalButton, callbackData: `${llmModelAdminCallbackPrefixes.selectSlot}normal` },
        { text: texts.changeStrongerButton, callbackData: `${llmModelAdminCallbackPrefixes.selectSlot}stronger` },
      ],
      [{ text: texts.runNormalTestButton, callbackData: `${llmModelAdminCallbackPrefixes.runTest}${settings.normal.model}:${settings.normal.reasoningEffort}` }],
      [{ text: texts.runStrongerTestButton, callbackData: `${llmModelAdminCallbackPrefixes.runTest}${settings.stronger.model}:${settings.stronger.reasoningEffort}` }],
    ],
  });
}

export function renderLlmModelAdminMenu(
  settings = defaultLlmModelSettings,
  results: LlmModelTestResult[] = [],
  language: BotLanguage = 'es',
): string {
  const texts = createTelegramI18n(language).llmModelAdmin;
  const resultByKey = new Map(results.map((result) => [`${result.model}:${result.reasoningEffort}`, result]));
  const lines = [
    `<b>${escapeHtml(texts.menuTitle)}</b>`,
    '',
    `${escapeHtml(texts.normalLabel)}: ${escapeHtml(formatLlmModelSelection(settings.normal))}`,
    `${escapeHtml(texts.strongerLabel)}: ${escapeHtml(formatLlmModelSelection(settings.stronger))}`,
    '',
    `<b>${escapeHtml(texts.savedComparisonTitle)}</b>`,
    `<pre>${escapeHtml(texts.comparisonHeader)}`,
  ];
  for (const definition of llmModelDefinitions) {
    for (const reasoningEffort of definition.reasoningEfforts) {
      const result = resultByKey.get(`${definition.id}:${reasoningEffort}`);
      const label = `${definition.label}`.slice(0, 22).padEnd(22, ' ');
      lines.push(`${label} ${reasoningEffort.padEnd(7, ' ')} ${formatStoredResult(result, texts)}`);
    }
  }
  lines.push('</pre>');
  lines.push('');
  lines.push(escapeHtml(texts.tokensCostUnavailableNote));
  return lines.join('\n');
}

async function runLlmModelTestFromTelegram(
  context: TelegramLlmModelAdminContext,
  selection: LlmModelSelection,
): Promise<void> {
  const service = context.runtime.llmCommandService;
  const language = resolveLlmModelAdminLanguage(context);
  const texts = createTelegramI18n(language).llmModelAdmin;
  if (!service) {
    await context.reply(texts.serviceMissing);
    return;
  }

  const progress = await startTelegramEditableProgress(
    context,
    [
      '[#---------]',
      '',
      texts.progressPreparing,
      '',
      `${formatLlmModelSelection(selection)}`,
    ].join('\n'),
    { editFailedEvent: 'llm-model-test.progress-edit.failed' },
  );
  const startedAt = Date.now();
  let result: LlmModelTestResult;
  try {
    await progress.update([
      '[####------]',
      '',
      texts.progressRunning,
      '',
      `${formatLlmModelSelection(selection)}`,
    ].join('\n'));
    const prompt = buildLlmCommandPrompt({
      userText: texts.testPrompt,
      language,
      isApproved: true,
      isAdmin: false,
      chatKind: 'private',
      hasTopic: false,
      maxPromptChars: context.runtime.llmCommands?.maxPromptChars ?? 12000,
    });
    const decision = await service.interpret(prompt, selectionToGenerateJsonOptions(selection));
    const success = decision.intent === 'storage.search'
      && decision.action.name === 'storage.search'
      && typeof decision.action.params.query === 'string'
      && decision.action.params.query.toLowerCase().includes('attack');
    result = buildLlmModelTestResult({
      selection,
      startedAt,
      success,
      error: success ? null : formatLlmModelAdminText(texts.unexpectedResponse, {
        intent: decision.intent,
        action: decision.action.name,
      }),
    });
  } catch (error) {
    result = buildLlmModelTestResult({
      selection,
      startedAt,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  await saveLlmModelTestResult(result);
  await progress.complete(renderLlmModelTestResult(result, texts), { parseMode: 'HTML' });
}

function buildLlmModelTestResult({
  selection,
  startedAt,
  success,
  error,
}: {
  selection: LlmModelSelection;
  startedAt: number;
  success: boolean;
  error: string | null;
}): LlmModelTestResult {
  return {
    model: selection.model,
    reasoningEffort: selection.reasoningEffort,
    success,
    successes: success ? 1 : 0,
    failures: success ? 0 : 1,
    durationMs: Date.now() - startedAt,
    tokens: { input: null, output: null, total: null },
    costUsd: null,
    testedAt: new Date().toISOString(),
    error,
  };
}

function renderLlmModelTestResult(
  result: LlmModelTestResult,
  texts: ReturnType<typeof createTelegramI18n>['llmModelAdmin'],
): string {
  return [
    result.success ? texts.testSuccess : texts.testFailure,
    '',
    `${texts.modelLabel}: ${escapeHtml(formatLlmModelSelection(result))}`,
    `${texts.successFailureLabel}: ${result.successes}/${result.failures}`,
    `${texts.durationLabel}: ${formatDuration(result.durationMs)}`,
    `${texts.tokensLabel}: ${formatNullableNumber(result.tokens.total, texts)}`,
    `${texts.costLabel}: ${formatNullableCost(result.costUsd, texts)}`,
    ...(result.error ? ['', `${texts.errorLabel}: ${escapeHtml(result.error)}`] : []),
  ].join('\n');
}

function buildModelSelectionKeyboard(
  slot: LlmModelSlot,
  texts: ReturnType<typeof createTelegramI18n>['llmModelAdmin'],
) {
  return [
    ...llmModelDefinitions.map((definition) => [{
      text: definition.label,
      callbackData: `${llmModelAdminCallbackPrefixes.selectModel}${slot}:${definition.id}`,
    }]),
    [{ text: texts.backButton, callbackData: llmModelAdminCallbackPrefixes.open }],
  ];
}

function buildReasoningSelectionKeyboard(
  slot: LlmModelSlot,
  model: string,
  texts: ReturnType<typeof createTelegramI18n>['llmModelAdmin'],
) {
  const definition = findLlmModelDefinition(model);
  if (!definition) {
    return [[{ text: texts.backButton, callbackData: llmModelAdminCallbackPrefixes.open }]];
  }
  return [
    ...definition.reasoningEfforts.map((reasoningEffort) => [{
      text: reasoningEffort,
      callbackData: `${llmModelAdminCallbackPrefixes.selectReasoning}${slot}:${model}:${reasoningEffort}`,
    }]),
    [{ text: texts.backButton, callbackData: llmModelAdminCallbackPrefixes.open }],
  ];
}

function formatStoredResult(
  result: LlmModelTestResult | undefined,
  texts: ReturnType<typeof createTelegramI18n>['llmModelAdmin'],
): string {
  if (!result) {
    return texts.noSavedTest;
  }
  return formatLlmModelAdminText(texts.storedResultTemplate, {
    status: result.success ? texts.statusOk : texts.statusFail,
    duration: formatDuration(result.durationMs),
    tokens: formatNullableNumber(result.tokens.total, texts),
    cost: formatNullableCost(result.costUsd, texts),
  });
}

function getSettingsStore(context: TelegramLlmModelAdminContext) {
  return createAppMetadataLlmModelSettingsStore({
    storage: createDatabaseAppMetadataSessionStorage({ database: context.runtime.services.database.db }),
  });
}

function canManageLlmModels(context: TelegramLlmModelAdminContext): boolean {
  return context.runtime.chat.kind === 'private' && context.runtime.actor.isAdmin;
}

function parseSlot(value: string): LlmModelSlot | null {
  return value === 'normal' || value === 'stronger' ? value : null;
}

function parseSlotAndModel(value: string): { slot: LlmModelSlot; model: string } | null {
  const [slotValue, model] = value.split(':');
  const slot = parseSlot(slotValue ?? '');
  return slot && model ? { slot, model } : null;
}

function parseSlotModelReasoning(value: string): { slot: LlmModelSlot; model: string; reasoningEffort: LlmModelSelection['reasoningEffort'] } | null {
  const [slotValue, model, reasoningEffort] = value.split(':');
  const slot = parseSlot(slotValue ?? '');
  return slot && model && reasoningEffort ? { slot, model, reasoningEffort: reasoningEffort as LlmModelSelection['reasoningEffort'] } : null;
}

function parseModelReasoning(value: string): LlmModelSelection | null {
  const [model, reasoningEffort] = value.split(':');
  return model && reasoningEffort ? { model, reasoningEffort: reasoningEffort as LlmModelSelection['reasoningEffort'] } : null;
}

function slotLabel(slot: LlmModelSlot, texts: ReturnType<typeof createTelegramI18n>['llmModelAdmin']): string {
  return slot === 'normal' ? texts.normalSlot : texts.strongerSlot;
}

function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatNullableNumber(
  value: number | null,
  texts: ReturnType<typeof createTelegramI18n>['llmModelAdmin'],
): string {
  return value === null ? texts.unavailable : String(value);
}

function formatNullableCost(
  value: number | null,
  texts: ReturnType<typeof createTelegramI18n>['llmModelAdmin'],
): string {
  return value === null ? texts.unavailable : `$${value.toFixed(6)}`;
}

function resolveLlmModelAdminLanguage(context: TelegramLlmModelAdminContext): BotLanguage {
  return normalizeBotLanguage(context.runtime.bot.language, 'ca');
}

function formatLlmModelAdminText(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replaceAll(`{${key}}`, value),
    template,
  );
}
