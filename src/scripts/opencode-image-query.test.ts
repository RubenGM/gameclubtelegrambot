import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOpencodeRunArgs,
  buildVisionPrompt,
  defaultOpencodeVisionModel,
  HelpRequested,
  parseOpencodeImageQueryArgs,
  resolveOpencodeInvocation,
} from './opencode-image-query.js';

test('parseOpencodeImageQueryArgs requires image and question', () => {
  assert.throws(() => parseOpencodeImageQueryArgs([]), /--image is required/);
  assert.throws(() => parseOpencodeImageQueryArgs(['--image', 'cover.jpg']), /--question is required/);
});

test('parseOpencodeImageQueryArgs defaults to the recommended OpenAI vision model', () => {
  assert.deepEqual(
    parseOpencodeImageQueryArgs(['--image', 'cover.jpg', '--question', 'Nombre']),
    {
      imagePath: 'cover.jpg',
      question: 'Nombre',
      model: defaultOpencodeVisionModel,
      opencodeBin: 'opencode',
      dryRun: false,
    },
  );
});

test('parseOpencodeImageQueryArgs accepts the expected options', () => {
  assert.deepEqual(
    parseOpencodeImageQueryArgs([
      '--image',
      'cover.jpg',
      '--question',
      'Devuelve el nombre completo',
      '--model',
      'openai/gpt-4.1',
      '--opencode-bin',
      '/usr/local/bin/opencode',
      '--dry-run',
    ]),
    {
      imagePath: 'cover.jpg',
      question: 'Devuelve el nombre completo',
      model: 'openai/gpt-4.1',
      opencodeBin: '/usr/local/bin/opencode',
      dryRun: true,
    },
  );
});

test('parseOpencodeImageQueryArgs exposes help as a typed control flow', () => {
  assert.throws(() => parseOpencodeImageQueryArgs(['--help']), HelpRequested);
});

test('buildVisionPrompt keeps BGG metadata lookup out of the vision step', () => {
  const prompt = buildVisionPrompt('Que juego es?');

  assert.match(prompt, /imagen adjunta/);
  assert.match(prompt, /BoardGameGeek/);
  assert.match(prompt, /Pregunta: Que juego es\?/);
});

test('buildOpencodeRunArgs attaches the image and selected model', () => {
  assert.deepEqual(
    buildOpencodeRunArgs({
      imagePath: './cover.jpg',
      question: 'Nombre exacto',
      model: 'anthropic/claude-3-5-sonnet',
    }),
    [
      'run',
      buildVisionPrompt('Nombre exacto'),
      '--model',
      'anthropic/claude-3-5-sonnet',
      '--file',
      './cover.jpg',
    ],
  );
});

test('resolveOpencodeInvocation can wrap OpenCode with sudo for another user', () => {
  assert.deepEqual(
    resolveOpencodeInvocation({
      opencodeBin: '/usr/local/bin/opencode',
      opencodeArgs: ['run', 'Hola', '--model', 'openai/gpt-5.4-mini'],
      runAsUser: 'cawa',
    }),
    {
      command: 'sudo',
      args: ['-n', '-H', '-u', 'cawa', '/usr/local/bin/opencode', 'run', 'Hola', '--model', 'openai/gpt-5.4-mini'],
    },
  );
});
