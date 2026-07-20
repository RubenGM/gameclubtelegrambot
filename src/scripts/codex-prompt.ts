import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';

export type CodexPromptInput = {
  prompt: string;
  model: string;
  codexBin: string;
  reasoningEffort?: string;
  imagePath?: string | undefined;
  timeoutMs?: number;
};

export function buildCodexPromptArgs({
  model,
  reasoningEffort = 'low',
  imagePath,
}: { model: string; reasoningEffort?: string | undefined; imagePath?: string | undefined }): string[] {
  return [
    'exec',
    '--ephemeral',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--model',
    model,
    '-c',
    `model_reasoning_effort="${reasoningEffort}"`,
    ...(imagePath ? ['--image', imagePath] : []),
    '-',
  ];
}

export async function runCodexPromptCapture({
  prompt,
  model,
  codexBin,
  reasoningEffort = 'low',
  imagePath,
  timeoutMs = 60_000,
}: CodexPromptInput): Promise<string> {
  if (imagePath) {
    await access(imagePath);
  }

  const resolvedCodexBin = codexBin.trim();
  if (!resolvedCodexBin) {
    throw new Error('GAMECLUB_CODEX_BIN is not configured');
  }

  return new Promise((resolve, reject) => {
    const child = spawn(resolvedCodexBin, buildCodexPromptArgs({ model, reasoningEffort, imagePath }), {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGTERM');
        reject(new Error(`Codex timed out after ${timeoutMs} ms`));
      }
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
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve((stdout.trim() || stderr.trim()).trim());
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `Codex exited with code ${code ?? 1}`));
    });
    child.stdin.setDefaultEncoding('utf8');
    child.stdin.end(prompt);
  });
}
