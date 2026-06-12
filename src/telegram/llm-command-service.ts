import { spawn as defaultSpawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { parseLlmCommandDecisionJson, type LlmCommandDecision } from './llm-command-schema.js';

export interface LlmCommandServiceConfig {
  provider?: 'codex' | 'opencode';
  opencodeBin?: string | undefined;
  codexBin?: string | undefined;
  model: string;
  reasoningEffort?: string | undefined;
  timeoutMs: number;
}

export interface LlmCommandService {
  interpret(prompt: string): Promise<LlmCommandDecision>;
  generateJson(prompt: string): Promise<unknown>;
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
    generateJson: (prompt) => runOpencodeRawJsonPrompt({ prompt, config, spawnImpl }),
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
  if ((config.provider ?? 'opencode') === 'codex') {
    const stdout = await runCodexJsonPrompt({
      prompt,
      config,
      spawnImpl,
      schemaPath: 'src/telegram/llm-command-decision.schema.json',
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

async function runOpencodeRawJsonPrompt({
  prompt,
  config,
  spawnImpl,
}: {
  prompt: string;
  config: LlmCommandServiceConfig;
  spawnImpl: LlmCommandSpawn;
}): Promise<unknown> {
  if ((config.provider ?? 'opencode') === 'codex') {
    const stdout = await runCodexJsonPrompt({
      prompt,
      config,
      spawnImpl,
      schemaPath: 'src/telegram/llm-storage-refinement.schema.json',
    });
    try {
      return JSON.parse(stdout.trim());
    } catch (error) {
      throw new LlmCommandServiceError(
        'invalid_json',
        error instanceof Error ? error.message : 'LLM command output is invalid',
      );
    }
  }

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
    return JSON.parse(stdout.trim());
  } catch (error) {
    throw new LlmCommandServiceError(
      'invalid_json',
      error instanceof Error ? error.message : 'LLM command output is invalid',
    );
  }
}

async function runCodexJsonPrompt({
  prompt,
  config,
  schemaPath,
  spawnImpl,
}: {
  prompt: string;
  config: LlmCommandServiceConfig;
  schemaPath: string;
  spawnImpl: LlmCommandSpawn;
}): Promise<string> {
  const codexBin = config.codexBin?.trim();
  if (!codexBin) {
    throw new LlmCommandServiceError('not_configured', 'GAMECLUB_CODEX_BIN is not configured');
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'gameclub-llm-codex-'));
  const outputPath = join(tempDir, 'output.json');
  try {
    await chmod(tempDir, 0o777);
    const reasoningEffort = config.reasoningEffort?.trim() || 'low';
    await runPromptProcess({
      command: codexBin,
      args: [
        'exec',
        '--ephemeral',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '--model',
        config.model,
        '-c',
        `model_reasoning_effort="${reasoningEffort}"`,
        '--output-schema',
        schemaPath,
        '-o',
        outputPath,
        '-',
      ],
      prompt,
      timeoutMs: config.timeoutMs,
      spawnImpl,
    });
    try {
      return await readFile(outputPath, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new LlmCommandServiceError('invalid_json', `Codex did not write structured output: ${message}`);
    }
  } finally {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup only; never turn a valid LLM result into a user-visible failure.
    }
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
