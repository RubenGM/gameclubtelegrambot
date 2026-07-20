import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultBenchmarkModels, HelpRequested, parseBenchmarkOptions } from './codex-catalog-benchmark.js';

test('benchmark defaults to the requested Codex model set', () => {
  assert.deepEqual(parseBenchmarkOptions([]), {
    models: [...defaultBenchmarkModels], runs: 2, codexBin: './scripts/codex-cawa.sh', reasoningEffort: 'low', outputDir: 'data/codex-benchmarks',
  });
});

test('benchmark accepts a model subset and rejects invalid run counts', () => {
  assert.deepEqual(parseBenchmarkOptions(['--models', 'gpt-5.4,gpt-5.4-mini', '--runs', '3']).models, ['gpt-5.4', 'gpt-5.4-mini']);
  assert.throws(() => parseBenchmarkOptions(['--runs', '0']), /between 1 and 10/);
  assert.throws(() => parseBenchmarkOptions(['--help']), HelpRequested);
});
