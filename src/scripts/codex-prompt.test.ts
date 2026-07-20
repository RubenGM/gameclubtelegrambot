import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCodexPromptArgs } from './codex-prompt.js';

test('buildCodexPromptArgs uses an ephemeral read-only invocation', () => {
  assert.deepEqual(buildCodexPromptArgs({ model: 'gpt-5.4-mini', reasoningEffort: 'low' }), [
    'exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only',
    '--model', 'gpt-5.4-mini', '-c', 'model_reasoning_effort="low"', '-',
  ]);
});

test('buildCodexPromptArgs attaches an optional image', () => {
  assert.deepEqual(buildCodexPromptArgs({
    model: 'gpt-5.4',
    reasoningEffort: 'medium',
    imagePath: '/tmp/cover.png',
  }), [
    'exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only',
    '--model', 'gpt-5.4', '-c', 'model_reasoning_effort="medium"', '--image', '/tmp/cover.png', '-',
  ]);
});
