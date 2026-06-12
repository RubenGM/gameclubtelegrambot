import { EventEmitter } from 'node:events';
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
