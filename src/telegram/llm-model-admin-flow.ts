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
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import { escapeHtml } from './schedule-presentation.js';

export const llmModelAdminLabels = {
  openMenu: 'Modelos IA',
} as const;

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
  if (text !== llmModelAdminLabels.openMenu) {
    return false;
  }
  if (!canManageLlmModels(context)) {
    await context.reply(createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca')).common.accessDeniedAdmin);
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
    await context.reply(`Selecciona modelo para ${slotLabel(slot)}.`, {
      inlineKeyboard: buildModelSelectionKeyboard(slot),
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
    await context.reply(`Selecciona reasoning para ${definition.label} en ${slotLabel(parsed.slot)}.`, {
      inlineKeyboard: buildReasoningSelectionKeyboard(parsed.slot, parsed.model),
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
    await context.reply([
      'Configuración guardada.',
      '',
      `Normal: ${formatLlmModelSelection(settings.normal)}`,
      `Más pensamiento: ${formatLlmModelSelection(settings.stronger)}`,
    ].join('\n'), { inlineKeyboard: [[{ text: 'Volver a modelos IA', callbackData: llmModelAdminCallbackPrefixes.open }]] });
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
  await context.reply(renderLlmModelAdminMenu(settings, results), {
    parseMode: 'HTML',
    inlineKeyboard: [
      [
        { text: 'Cambiar normal', callbackData: `${llmModelAdminCallbackPrefixes.selectSlot}normal` },
        { text: 'Cambiar más pensamiento', callbackData: `${llmModelAdminCallbackPrefixes.selectSlot}stronger` },
      ],
      [{ text: 'Lanzar test de la selección normal', callbackData: `${llmModelAdminCallbackPrefixes.runTest}${settings.normal.model}:${settings.normal.reasoningEffort}` }],
      [{ text: 'Lanzar test de más pensamiento', callbackData: `${llmModelAdminCallbackPrefixes.runTest}${settings.stronger.model}:${settings.stronger.reasoningEffort}` }],
    ],
  });
}

export function renderLlmModelAdminMenu(
  settings = defaultLlmModelSettings,
  results: LlmModelTestResult[] = [],
): string {
  const resultByKey = new Map(results.map((result) => [`${result.model}:${result.reasoningEffort}`, result]));
  const lines = [
    '<b>Modelos IA</b>',
    '',
    `Normal: ${escapeHtml(formatLlmModelSelection(settings.normal))}`,
    `Más pensamiento: ${escapeHtml(formatLlmModelSelection(settings.stronger))}`,
    '',
    '<b>Comparativa guardada</b>',
    '<pre>Modelo                  Reason   Último test',
  ];
  for (const definition of llmModelDefinitions) {
    for (const reasoningEffort of definition.reasoningEfforts) {
      const result = resultByKey.get(`${definition.id}:${reasoningEffort}`);
      const label = `${definition.label}`.slice(0, 22).padEnd(22, ' ');
      lines.push(`${label} ${reasoningEffort.padEnd(7, ' ')} ${formatStoredResult(result)}`);
    }
  }
  lines.push('</pre>');
  lines.push('');
  lines.push('Los tokens y coste quedan como n/d si Codex no los expone de forma fiable.');
  return lines.join('\n');
}

async function runLlmModelTestFromTelegram(
  context: TelegramLlmModelAdminContext,
  selection: LlmModelSelection,
): Promise<void> {
  const service = context.runtime.llmCommandService;
  if (!service) {
    await context.reply('El servicio LLM no está configurado.');
    return;
  }

  const progress = await startTelegramEditableProgress(
    context,
    [
      '[#---------]',
      '',
      'Preparando test de modelo',
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
      'Ejecutando interpretación estructurada',
      '',
      `${formatLlmModelSelection(selection)}`,
    ].join('\n'));
    const prompt = buildLlmCommandPrompt({
      userText: 'qué archivos STL tenemos de Attack on Titan?',
      language: normalizeBotLanguage(context.runtime.bot.language, 'ca'),
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
      error: success ? null : `Respuesta inesperada: ${decision.intent}/${decision.action.name}`,
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
  await progress.complete(renderLlmModelTestResult(result), { parseMode: 'HTML' });
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

function renderLlmModelTestResult(result: LlmModelTestResult): string {
  return [
    result.success ? 'Test completado correctamente.' : 'Test fallido.',
    '',
    `Modelo: ${escapeHtml(formatLlmModelSelection(result))}`,
    `Éxitos/fracasos: ${result.successes}/${result.failures}`,
    `Tiempo dedicado: ${formatDuration(result.durationMs)}`,
    `Tokens: ${formatNullableNumber(result.tokens.total)}`,
    `Coste: ${result.costUsd === null ? 'n/d' : `$${result.costUsd.toFixed(6)}`}`,
    ...(result.error ? ['', `Error: ${escapeHtml(result.error)}`] : []),
  ].join('\n');
}

function buildModelSelectionKeyboard(slot: LlmModelSlot) {
  return [
    ...llmModelDefinitions.map((definition) => [{
      text: definition.label,
      callbackData: `${llmModelAdminCallbackPrefixes.selectModel}${slot}:${definition.id}`,
    }]),
    [{ text: 'Volver', callbackData: llmModelAdminCallbackPrefixes.open }],
  ];
}

function buildReasoningSelectionKeyboard(slot: LlmModelSlot, model: string) {
  const definition = findLlmModelDefinition(model);
  if (!definition) {
    return [[{ text: 'Volver', callbackData: llmModelAdminCallbackPrefixes.open }]];
  }
  return [
    ...definition.reasoningEfforts.map((reasoningEffort) => [{
      text: reasoningEffort,
      callbackData: `${llmModelAdminCallbackPrefixes.selectReasoning}${slot}:${model}:${reasoningEffort}`,
    }]),
    [{ text: 'Volver', callbackData: llmModelAdminCallbackPrefixes.open }],
  ];
}

function formatStoredResult(result: LlmModelTestResult | undefined): string {
  if (!result) {
    return 'sin prueba guardada';
  }
  const status = result.success ? 'OK' : 'FAIL';
  return `${status} ${formatDuration(result.durationMs)} tokens=${formatNullableNumber(result.tokens.total)} coste=${result.costUsd === null ? 'n/d' : `$${result.costUsd.toFixed(6)}`}`;
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

function slotLabel(slot: LlmModelSlot): string {
  return slot === 'normal' ? 'modo normal' : 'modo más pensamiento';
}

function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatNullableNumber(value: number | null): string {
  return value === null ? 'n/d' : String(value);
}
