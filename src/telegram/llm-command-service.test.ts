import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import { Writable, Readable } from 'node:stream';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createLlmCommandService, LlmCommandServiceError, type LlmCommandSpawn } from './llm-command-service.js';

test('createLlmCommandService invokes GAMECLUB_OPENCODE_BIN through stdin and parses JSON', async () => {
  const calls: Array<{ command: string; args: string[]; prompt: string }> = [];
  const service = createLlmCommandService({
    config: {
      opencodeBin: './scripts/opencode-cawa.sh',
      model: 'openai/gpt-5.4-mini',
      timeoutMs: 1000,
    },
    spawnImpl: createSpawnDouble({
      stdout: JSON.stringify(validDecision()),
      onPrompt: (call) => calls.push(call),
    }),
  });

  const decision = await service.interpret('prompt text');

  assert.equal(decision.intent, 'help.capabilities');
  assert.deepEqual(calls, [{
    command: './scripts/opencode-cawa.sh',
    args: ['run', '--stdin', '--model', 'openai/gpt-5.4-mini'],
    prompt: 'prompt text',
  }]);
});

test('createLlmCommandService invokes Codex with output schema and parses the final output file', async () => {
  const calls: Array<{ command: string; args: string[]; prompt: string }> = [];
  const service = createLlmCommandService({
    config: {
      provider: 'codex',
      codexBin: './scripts/codex-cawa.sh',
      model: 'gpt-5.4-mini',
      reasoningEffort: 'low',
      timeoutMs: 1000,
    },
    spawnImpl: createSpawnDouble({
      stdout: 'Codex progress output that is not JSON',
      onPrompt: (call) => {
        calls.push(call);
        const outputPath = call.args[call.args.indexOf('-o') + 1];
        if (!outputPath) {
          throw new Error('missing Codex output path');
        }
        writeFileSync(outputPath, JSON.stringify(validDecision()));
      },
    }),
  });

  const decision = await service.interpret('prompt text');

  assert.equal(decision.intent, 'help.capabilities');
  assert.equal(calls[0]?.command, './scripts/codex-cawa.sh');
  assert.deepEqual(calls[0]?.args.slice(0, 12), [
    'exec',
    '--ephemeral',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--model',
    'gpt-5.4-mini',
    '-c',
    'model_reasoning_effort="low"',
    '--output-schema',
    'src/telegram/llm-command-decision.schema.json',
    '-o',
  ]);
  assert.equal(calls[0]?.args.at(-1), '-');
  assert.equal(calls[0]?.prompt, 'prompt text');
});

test('createLlmCommandService invokes Codex generic JSON with the Storage refinement schema', async () => {
  const calls: Array<{ command: string; args: string[]; prompt: string }> = [];
  const service = createLlmCommandService({
    config: {
      provider: 'codex',
      codexBin: './scripts/codex-cawa.sh',
      model: 'gpt-5.4-mini',
      reasoningEffort: 'low',
      timeoutMs: 1000,
    },
    spawnImpl: createSpawnDouble({
      stdout: 'Codex progress output that is not JSON',
      onPrompt: (call) => {
        calls.push(call);
        const outputPath = call.args[call.args.indexOf('-o') + 1];
        if (!outputPath) {
          throw new Error('missing Codex output path');
        }
        writeFileSync(outputPath, JSON.stringify({ selectedIds: [7], reason: 'matches' }));
      },
    }),
  });

  const parsed = await service.generateJson('filter prompt');

  assert.deepEqual(parsed, { selectedIds: [7], reason: 'matches' });
  assert.equal(calls[0]?.args.at(calls[0].args.indexOf('--output-schema') + 1), 'src/telegram/llm-storage-refinement.schema.json');
});

test('createLlmCommandService can pass a custom Codex JSON schema', async () => {
  const calls: Array<{ command: string; args: string[]; prompt: string }> = [];
  const service = createLlmCommandService({
    config: {
      provider: 'codex',
      codexBin: './scripts/codex-cawa.sh',
      model: 'gpt-5.4-mini',
      reasoningEffort: 'low',
      timeoutMs: 1000,
    },
    spawnImpl: createSpawnDouble({
      stdout: 'Codex progress output that is not JSON',
      onPrompt: (call) => {
        calls.push(call);
        const outputPath = call.args[call.args.indexOf('-o') + 1];
        if (!outputPath) {
          throw new Error('missing Codex output path');
        }
        writeFileSync(outputPath, JSON.stringify({ intro: 'Prueba', selectedIds: [1], reasons: [{ id: 1, reason: 'encaja' }] }));
      },
    }),
  });

  const parsed = await service.generateJson('recommend prompt', 'src/telegram/llm-catalog-recommendation.schema.json');

  assert.deepEqual(parsed, { intro: 'Prueba', selectedIds: [1], reasons: [{ id: 1, reason: 'encaja' }] });
  assert.equal(calls[0]?.args.at(calls[0].args.indexOf('--output-schema') + 1), 'src/telegram/llm-catalog-recommendation.schema.json');
});

test('createLlmCommandService classifies missing Codex output files', async () => {
  const service = createLlmCommandService({
    config: {
      provider: 'codex',
      codexBin: './scripts/codex-cawa.sh',
      model: 'gpt-5.4-mini',
      reasoningEffort: 'low',
      timeoutMs: 1000,
    },
    spawnImpl: createSpawnDouble({
      stdout: 'Codex progress output without final file',
    }),
  });

  await assert.rejects(
    () => service.interpret('prompt text'),
    (error) => error instanceof LlmCommandServiceError && error.code === 'invalid_json'
      && error.message.includes('Codex did not write structured output'),
  );
});

test('createLlmCommandService can request generic JSON from the configured model', async () => {
  const calls: Array<{ command: string; args: string[]; prompt: string }> = [];
  const service = createLlmCommandService({
    config: {
      opencodeBin: './scripts/opencode-cawa.sh',
      model: 'openai/gpt-5.4-mini',
      timeoutMs: 1000,
    },
    spawnImpl: createSpawnDouble({
      stdout: JSON.stringify({ selectedIds: [12, 14], reason: 'manuales relevantes' }),
      onPrompt: (call) => calls.push(call),
    }),
  });

  const parsed = await service.generateJson('filter candidates');

  assert.deepEqual(parsed, { selectedIds: [12, 14], reason: 'manuales relevantes' });
  assert.deepEqual(calls, [{
    command: './scripts/opencode-cawa.sh',
    args: ['run', '--stdin', '--model', 'openai/gpt-5.4-mini'],
    prompt: 'filter candidates',
  }]);
});

test('createLlmCommandService classifies invalid generic JSON responses', async () => {
  const service = createLlmCommandService({
    config: {
      opencodeBin: './scripts/opencode-cawa.sh',
      model: 'openai/gpt-5.4-mini',
      timeoutMs: 1000,
    },
    spawnImpl: createSpawnDouble({ stdout: 'not json' }),
  });

  await assert.rejects(
    () => service.generateJson('filter candidates'),
    (error) => error instanceof LlmCommandServiceError && error.code === 'invalid_json',
  );
});

test('createLlmCommandService fails when wrapper is not configured', async () => {
  const service = createLlmCommandService({
    config: {
      opencodeBin: '',
      model: 'openai/gpt-5.4-mini',
      timeoutMs: 1000,
    },
    spawnImpl: createSpawnDouble({ stdout: JSON.stringify(validDecision()) }),
  });

  await assert.rejects(
    () => service.interpret('prompt text'),
    (error) => error instanceof LlmCommandServiceError && error.code === 'not_configured',
  );
});

test('createLlmCommandService classifies invalid JSON responses', async () => {
  const service = createLlmCommandService({
    config: {
      opencodeBin: './scripts/opencode-cawa.sh',
      model: 'openai/gpt-5.4-mini',
      timeoutMs: 1000,
    },
    spawnImpl: createSpawnDouble({ stdout: 'not json' }),
  });

  await assert.rejects(
    () => service.interpret('prompt text'),
    (error) => error instanceof LlmCommandServiceError && error.code === 'invalid_json',
  );
});

function createSpawnDouble({
  stdout,
  stderr = '',
  code = 0,
  onPrompt,
}: {
  stdout: string;
  stderr?: string;
  code?: number;
  onPrompt?: (call: { command: string; args: string[]; prompt: string }) => void;
}): LlmCommandSpawn {
  return (command, args) => {
    const child = new EventEmitter() as ReturnType<LlmCommandSpawn>;
    let prompt = '';
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        prompt += String(chunk);
        callback();
      },
      final(callback) {
        onPrompt?.({ command, args, prompt });
        callback();
        queueMicrotask(() => {
          if (stdout) {
            child.stdout.emit('data', stdout);
          }
          if (stderr) {
            child.stderr.emit('data', stderr);
          }
          child.emit('close', code);
        });
      },
    }) as ReturnType<LlmCommandSpawn>['stdin'];
    child.stdout = new Readable({ read() {} }) as ReturnType<LlmCommandSpawn>['stdout'];
    child.stderr = new Readable({ read() {} }) as ReturnType<LlmCommandSpawn>['stderr'];
    child.kill = (() => true) as ReturnType<LlmCommandSpawn>['kill'];
    return child;
  };
}

function validDecision(): unknown {
  return {
    version: 1,
    language: 'es',
    intent: 'help.capabilities',
    confidence: 0.95,
    reply: {
      text: 'Puedes preguntarme por agenda, catalogo y Storage.',
      sendNow: true,
    },
    needsClarification: false,
    clarification: null,
    requiresConfirmation: false,
    confirmation: null,
    action: {
      type: 'answer_directly',
      name: 'help.capabilities',
      params: {},
    },
    safety: {
      requiresApprovedMember: false,
      requiresAdmin: false,
      risk: 'read_only',
      publicSideEffect: false,
      destructive: false,
      requiresPrivateChat: false,
    },
  };
}
