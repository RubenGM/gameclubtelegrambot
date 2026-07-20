import test from 'node:test';
import assert from 'node:assert/strict';

import { renderLlmModelAdminMenu } from './llm-model-admin-flow.js';
import { defaultLlmModelSettings, type LlmModelTestResult } from './llm-model-settings.js';

test('renderLlmModelAdminMenu shows current selections and saved comparison results', () => {
  const result: LlmModelTestResult = {
    model: 'gpt-5.4-mini',
    reasoningEffort: 'low',
    success: true,
    successes: 1,
    failures: 0,
    durationMs: 1234,
    tokens: { input: null, output: null, total: 999 },
    costUsd: null,
    testedAt: '2026-06-14T00:00:00.000Z',
    error: null,
  };

  const message = renderLlmModelAdminMenu(defaultLlmModelSettings, [result]);

  assert.match(message, /Normal: GPT-5\.6-Luna \/ low/);
  assert.match(message, /Más pensamiento: GPT-5\.6-Sol \/ low/);
  assert.match(message, /GPT-5\.3-Codex-Spark/);
  assert.match(message, /GPT-5\.4-Mini\s+low\s+OK 1\.2s tokens=999 coste=n\/d/);
  assert.match(message, /sin prueba guardada/);
});
