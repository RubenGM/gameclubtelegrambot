import { randomBytes, randomInt } from 'node:crypto';

export interface TelegramLlmJobOwner { chatId: number; userId: number; messageThreadId?: number }
export interface TelegramLlmGenerationJob extends TelegramLlmJobOwner {
  token: string;
  draftId: number;
  signal: AbortSignal;
  draftSent: boolean;
  finish(): void;
}
type StopSource = 'native' | 'callback' | 'replacement' | 'shutdown';
const jobs = new Map<string, TelegramLlmGenerationJob & { abort(source: StopSource): void }>();
let shuttingDown = false;
const ownerKey = (owner: TelegramLlmJobOwner) => `${owner.chatId}:${owner.messageThreadId ?? 0}:${owner.userId}`;

export function startTelegramLlmGeneration(owner: TelegramLlmJobOwner): TelegramLlmGenerationJob {
  const key = ownerKey(owner);
  jobs.get(key)?.abort('replacement');
  const controller = new AbortController();
  const startedAt = Date.now();
  let stoppedAt: number | undefined;
  let released = false;
  const record = (event: string, detail: object = {}) => console.info(JSON.stringify({
    event, chatId: owner.chatId, userId: owner.userId,
    messageThreadId: owner.messageThreadId ?? 0, draftId: job.draftId, ...detail,
  }));
  const job = { ...owner, token: randomBytes(12).toString('hex'), draftId: randomInt(1, 0x7fffffff), signal: controller.signal, draftSent: false,
    abort: (source: StopSource) => {
      if (controller.signal.aborted) return;
      stoppedAt = Date.now();
      record('llm-command.generation.abort', { source, elapsedMs: stoppedAt - startedAt });
      controller.abort();
    },
    finish: () => {
      if (released) return;
      released = true;
      if (jobs.get(key) === job) jobs.delete(key);
      record('llm-command.generation.released', {
        cancelled: controller.signal.aborted, draftSent: job.draftSent,
        elapsedMs: Date.now() - startedAt,
        ...(stoppedAt !== undefined ? { cancelToReleaseMs: Date.now() - stoppedAt } : {}),
      });
    },
  };
  if (shuttingDown) { job.abort('shutdown'); return job; }
  jobs.set(key, job);
  record('llm-command.generation.started');
  return job;
}

export function stopTelegramLlmGeneration(event: TelegramLlmJobOwner & { draftId: number }): boolean {
  const job = jobs.get(ownerKey(event));
  if (!job || job.signal.aborted || job.draftId !== event.draftId) return false;
  job.abort('native');
  return true;
}

export function stopTelegramLlmGenerationByToken(owner: TelegramLlmJobOwner, token: string): boolean {
  const job = jobs.get(ownerKey(owner));
  if (!job || job.signal.aborted || job.token !== token) return false;
  job.abort('callback');
  return true;
}

export function abortAllTelegramLlmGenerations(): void {
  for (const job of jobs.values()) job.abort('shutdown');
  jobs.clear();
}

export function shutdownTelegramLlmGenerations(): void {
  shuttingDown = true;
  abortAllTelegramLlmGenerations();
}

export function enableTelegramLlmGenerations(): void {
  shuttingDown = false;
}
