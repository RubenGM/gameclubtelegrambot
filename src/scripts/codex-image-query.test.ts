import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCodexImageQueryArgs,
  buildVisionPrompt,
  defaultCodexVisionModel,
  HelpRequested,
  parseCodexImageQueryArgs,
} from './codex-image-query.js';

test('parseCodexImageQueryArgs requires image and question', () => {
  assert.throws(() => parseCodexImageQueryArgs([]), /--image is required/);
  assert.throws(() => parseCodexImageQueryArgs(['--image', 'cover.jpg']), /--question is required/);
});

test('parseCodexImageQueryArgs defaults to the Codex wrapper and vision model', () => {
  assert.deepEqual(parseCodexImageQueryArgs(['--image', 'cover.jpg', '--question', 'Nombre']), {
    imagePath: 'cover.jpg', question: 'Nombre', model: defaultCodexVisionModel,
    codexBin: './scripts/codex-cawa.sh', reasoningEffort: 'low', dryRun: false,
  });
});

test('parseCodexImageQueryArgs exposes help as typed control flow', () => {
  assert.throws(() => parseCodexImageQueryArgs(['--help']), HelpRequested);
});

test('buildCodexImageQueryArgs attaches the image to Codex exec', () => {
  assert.deepEqual(buildCodexImageQueryArgs({ imagePath: './cover.jpg', model: 'gpt-5.4', reasoningEffort: 'medium' }), [
    'exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--model', 'gpt-5.4',
    '-c', 'model_reasoning_effort="medium"', '--image', './cover.jpg', '-',
  ]);
  assert.match(buildVisionPrompt('Nombre exacto'), /BoardGameGeek/);
});
