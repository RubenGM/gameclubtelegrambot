import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { AppMetadataSessionStorage } from './conversation-session-store.js';
import type { LlmCommandGenerateJsonOptions } from './llm-command-service.js';

export type LlmModelSlot = 'normal' | 'stronger';
export type LlmReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

export interface LlmModelDefinition {
  id: string;
  label: string;
  reasoningEfforts: LlmReasoningEffort[];
}

export interface LlmModelSelection {
  model: string;
  reasoningEffort: LlmReasoningEffort;
}

export interface LlmModelSettings {
  normal: LlmModelSelection;
  stronger: LlmModelSelection;
  updatedAt: string | null;
}

export interface LlmModelTestResult {
  model: string;
  reasoningEffort: LlmReasoningEffort;
  success: boolean;
  failures: number;
  successes: number;
  durationMs: number;
  tokens: {
    input: number | null;
    output: number | null;
    total: number | null;
  };
  costUsd: number | null;
  testedAt: string;
  error: string | null;
}

export const llmModelSettingsMetadataKey = 'llm.model_settings';
export const llmModelTestResultsDirectory = 'data/llm-model-tests';

export const llmModelDefinitions: LlmModelDefinition[] = [
  { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3-Codex-Spark', reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'] },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4-Mini', reasoningEfforts: ['none', 'low', 'medium'] },
  { id: 'gpt-5.4', label: 'GPT-5.4', reasoningEfforts: ['none', 'low', 'medium'] },
  { id: 'gpt-5.5', label: 'GPT-5.5', reasoningEfforts: ['none', 'low', 'medium'] },
];

export const defaultLlmModelSettings: LlmModelSettings = {
  normal: { model: 'gpt-5.4-mini', reasoningEffort: 'low' },
  stronger: { model: 'gpt-5.5', reasoningEffort: 'medium' },
  updatedAt: null,
};

export function createAppMetadataLlmModelSettingsStore({
  storage,
}: {
  storage: AppMetadataSessionStorage;
}) {
  return {
    async getSettings(): Promise<LlmModelSettings> {
      const raw = await storage.get(llmModelSettingsMetadataKey);
      return parseLlmModelSettings(raw);
    },
    async saveSelection(slot: LlmModelSlot, selection: LlmModelSelection): Promise<LlmModelSettings> {
      const settings = await this.getSettings();
      const next = normalizeLlmModelSettings({
        ...settings,
        [slot]: selection,
        updatedAt: new Date().toISOString(),
      });
      await storage.set(llmModelSettingsMetadataKey, JSON.stringify(next));
      return next;
    },
  };
}

export function parseLlmModelSettings(raw: string | null | undefined): LlmModelSettings {
  if (!raw) {
    return defaultLlmModelSettings;
  }
  try {
    return normalizeLlmModelSettings(JSON.parse(raw) as Partial<LlmModelSettings>);
  } catch {
    return defaultLlmModelSettings;
  }
}

export function normalizeLlmModelSettings(input: Partial<LlmModelSettings>): LlmModelSettings {
  return {
    normal: normalizeLlmModelSelection(input.normal, defaultLlmModelSettings.normal),
    stronger: normalizeLlmModelSelection(input.stronger, defaultLlmModelSettings.stronger),
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : null,
  };
}

export function normalizeLlmModelSelection(
  input: Partial<LlmModelSelection> | null | undefined,
  fallback: LlmModelSelection,
): LlmModelSelection {
  const model = typeof input?.model === 'string' ? input.model : fallback.model;
  const reasoningEffort = typeof input?.reasoningEffort === 'string' ? input.reasoningEffort : fallback.reasoningEffort;
  return isAllowedLlmModelReasoning(model, reasoningEffort)
    ? { model, reasoningEffort }
    : fallback;
}

export function isAllowedLlmModelReasoning(model: string, reasoningEffort: string): reasoningEffort is LlmReasoningEffort {
  const definition = llmModelDefinitions.find((candidate) => candidate.id === model);
  return Boolean(definition?.reasoningEfforts.includes(reasoningEffort as LlmReasoningEffort));
}

export function selectionToGenerateJsonOptions(selection: LlmModelSelection): LlmCommandGenerateJsonOptions {
  return {
    model: selection.model,
    reasoningEffort: selection.reasoningEffort,
  };
}

export function findLlmModelDefinition(model: string): LlmModelDefinition | null {
  return llmModelDefinitions.find((candidate) => candidate.id === model) ?? null;
}

export function formatLlmModelSelection(selection: LlmModelSelection): string {
  return `${findLlmModelDefinition(selection.model)?.label ?? selection.model} / ${selection.reasoningEffort}`;
}

export function llmModelTestResultPath(
  selection: LlmModelSelection,
  baseDirectory = llmModelTestResultsDirectory,
): string {
  return join(baseDirectory, `${selection.model}_${selection.reasoningEffort}.json`);
}

export async function saveLlmModelTestResult(
  result: LlmModelTestResult,
  baseDirectory = llmModelTestResultsDirectory,
): Promise<void> {
  const path = llmModelTestResultPath(result, baseDirectory);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

export async function loadLlmModelTestResult(
  selection: LlmModelSelection,
  baseDirectory = llmModelTestResultsDirectory,
): Promise<LlmModelTestResult | null> {
  try {
    const raw = await readFile(llmModelTestResultPath(selection, baseDirectory), 'utf8');
    return parseLlmModelTestResult(raw);
  } catch {
    return null;
  }
}

export async function loadAllLlmModelTestResults(
  baseDirectory = llmModelTestResultsDirectory,
): Promise<LlmModelTestResult[]> {
  const selections = llmModelDefinitions.flatMap((definition) =>
    definition.reasoningEfforts.map((reasoningEffort) => ({ model: definition.id, reasoningEffort })),
  );
  const results = await Promise.all(selections.map((selection) => loadLlmModelTestResult(selection, baseDirectory)));
  return results.filter((result): result is LlmModelTestResult => result !== null);
}

export function parseLlmModelTestResult(raw: string): LlmModelTestResult | null {
  try {
    const parsed = JSON.parse(raw) as Partial<LlmModelTestResult>;
    if (
      typeof parsed.model !== 'string' ||
      typeof parsed.reasoningEffort !== 'string' ||
      !isAllowedLlmModelReasoning(parsed.model, parsed.reasoningEffort) ||
      typeof parsed.success !== 'boolean' ||
      typeof parsed.durationMs !== 'number'
    ) {
      return null;
    }
    return {
      model: parsed.model,
      reasoningEffort: parsed.reasoningEffort,
      success: parsed.success,
      failures: typeof parsed.failures === 'number' ? parsed.failures : parsed.success ? 0 : 1,
      successes: typeof parsed.successes === 'number' ? parsed.successes : parsed.success ? 1 : 0,
      durationMs: parsed.durationMs,
      tokens: {
        input: normalizeNullableNumber(parsed.tokens?.input),
        output: normalizeNullableNumber(parsed.tokens?.output),
        total: normalizeNullableNumber(parsed.tokens?.total),
      },
      costUsd: normalizeNullableNumber(parsed.costUsd),
      testedAt: typeof parsed.testedAt === 'string' ? parsed.testedAt : new Date(0).toISOString(),
      error: typeof parsed.error === 'string' ? parsed.error : null,
    };
  } catch {
    return null;
  }
}

function normalizeNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
