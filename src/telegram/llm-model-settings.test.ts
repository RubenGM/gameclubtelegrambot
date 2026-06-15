import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAppMetadataLlmModelSettingsStore,
  defaultLlmModelSettings,
  isAllowedLlmModelReasoning,
  loadLlmModelTestResult,
  saveLlmModelTestResult,
  type LlmModelTestResult,
} from './llm-model-settings.js';

test('LLM model settings validate allowed model/reasoning combinations', () => {
  assert.equal(isAllowedLlmModelReasoning('gpt-5.3-codex-spark', 'xhigh'), true);
  assert.equal(isAllowedLlmModelReasoning('gpt-5.4-mini', 'medium'), true);
  assert.equal(isAllowedLlmModelReasoning('gpt-5.4-mini', 'high'), false);
  assert.equal(isAllowedLlmModelReasoning('gpt-5.5', 'xhigh'), false);
});

test('LLM model settings persist selections in app metadata storage', async () => {
  const values = new Map<string, string>();
  const store = createAppMetadataLlmModelSettingsStore({
    storage: {
      get: async (key) => values.get(key) ?? null,
      set: async (key, value) => {
        values.set(key, value);
      },
      delete: async (key) => values.delete(key),
      listByPrefix: async () => [],
    },
  });

  assert.deepEqual(await store.getSettings(), defaultLlmModelSettings);

  const saved = await store.saveSelection('normal', { model: 'gpt-5.5', reasoningEffort: 'low' });

  assert.deepEqual(saved.normal, { model: 'gpt-5.5', reasoningEffort: 'low' });
  assert.deepEqual((await store.getSettings()).normal, { model: 'gpt-5.5', reasoningEffort: 'low' });
});

test('LLM model test results overwrite the previous JSON for the same model', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gameclub-llm-model-test-'));
  try {
    const base: LlmModelTestResult = {
      model: 'gpt-5.4-mini',
      reasoningEffort: 'low',
      success: true,
      successes: 1,
      failures: 0,
      durationMs: 1000,
      tokens: { input: null, output: null, total: null },
      costUsd: null,
      testedAt: '2026-06-14T00:00:00.000Z',
      error: null,
    };
    await saveLlmModelTestResult(base, dir);
    await saveLlmModelTestResult({ ...base, success: false, successes: 0, failures: 1, durationMs: 2000, error: 'boom' }, dir);

    const loaded = await loadLlmModelTestResult({ model: 'gpt-5.4-mini', reasoningEffort: 'low' }, dir);
    const raw = await readFile(join(dir, 'gpt-5.4-mini_low.json'), 'utf8');

    assert.equal(loaded?.success, false);
    assert.equal(loaded?.durationMs, 2000);
    assert.equal(JSON.parse(raw).error, 'boom');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
