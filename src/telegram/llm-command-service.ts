import { spawn as defaultSpawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

import { parseLlmCommandDecisionJson, type LlmCommandDecision } from './llm-command-schema.js';

export interface LlmCommandServiceConfig {
  opencodeBin?: string | undefined;
  model: string;
  timeoutMs: number;
}

export interface LlmCommandService {
  interpret(prompt: string): Promise<LlmCommandDecision>;
}

export type LlmCommandSpawn = (
  command: string,
  args: string[],
  options: { stdio: ['pipe', 'pipe', 'pipe'] },
) => ChildProcessWithoutNullStreams;

export class LlmCommandServiceError extends Error {
  code: 'not_configured' | 'timeout' | 'process_failed' | 'invalid_json';

  constructor(code: LlmCommandServiceError['code'], message: string) {
    super(message);
    this.name = 'LlmCommandServiceError';
    this.code = code;
  }
}

export function createLlmCommandService({
  config,
  spawnImpl = defaultSpawn as LlmCommandSpawn,
}: {
  config: LlmCommandServiceConfig;
  spawnImpl?: LlmCommandSpawn;
}): LlmCommandService {
  return {
    interpret: (prompt) => runOpencodeJsonPrompt({ prompt, config, spawnImpl }),
  };
}

async function runOpencodeJsonPrompt({
  prompt,
  config,
  spawnImpl,
}: {
  prompt: string;
  config: LlmCommandServiceConfig;
  spawnImpl: LlmCommandSpawn;
}): Promise<LlmCommandDecision> {
  const opencodeBin = config.opencodeBin?.trim();
  if (!opencodeBin) {
    throw new LlmCommandServiceError('not_configured', 'GAMECLUB_OPENCODE_BIN is not configured');
  }

  const stdout = await runPromptProcess({
    command: opencodeBin,
    args: ['run', '--stdin', '--model', config.model],
    prompt,
    timeoutMs: config.timeoutMs,
    spawnImpl,
  });

  try {
    return parseLlmCommandDecisionJson(stdout.trim());
  } catch (error) {
    throw new LlmCommandServiceError(
      'invalid_json',
      error instanceof Error ? error.message : 'LLM command output is invalid',
    );
  }
}

function runPromptProcess({
  command,
  args,
  prompt,
  timeoutMs,
  spawnImpl,
}: {
  command: string;
  args: string[];
  prompt: string;
  timeoutMs: number;
  spawnImpl: LlmCommandSpawn;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill('SIGTERM');
      reject(new LlmCommandServiceError('timeout', `OpenCode timed out after ${timeoutMs} ms`));
    }, Math.max(1, timeoutMs));

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(new LlmCommandServiceError('process_failed', error.message));
    });
    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stdout.trim() || stderr.trim());
        return;
      }
      reject(new LlmCommandServiceError('process_failed', stderr.trim() || stdout.trim() || `OpenCode exited with code ${code ?? 1}`));
    });

    child.stdin.setDefaultEncoding('utf8');
    child.stdin.end(prompt);
  });
}
