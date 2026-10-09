import { randomBytes, randomInt } from 'node:crypto';

export interface TelegramLlmJobOwner { chatId: number; userId: number; messageThreadId?: number }
export interface TelegramLlmGenerationJob extends TelegramLlmJobOwner {
  token: string;
  draftId: number;
  signal: AbortSignal;
  draftSent: boolean;
  finish(): void;
}
const jobs = new Map<string, TelegramLlmGenerationJob & { abort(): void }>();
let shuttingDown = false;
const ownerKey = (owner: TelegramLlmJobOwner) => `${owner.chatId}:${owner.messageThreadId ?? 0}:${owner.userId}`;

export function startTelegramLlmGeneration(owner: TelegramLlmJobOwner): TelegramLlmGenerationJob {
  const key = ownerKey(owner);
  jobs.get(key)?.abort();
  const controller = new AbortController();
  const job = { ...owner, token: randomBytes(12).toString('hex'), draftId: randomInt(1, 0x7fffffff), signal: controller.signal, draftSent: false,
    abort: () => controller.abort(),
    finish: () => { if (jobs.get(key) === job) jobs.delete(key); },
  };
  if (shuttingDown) { controller.abort(); return job; }
  jobs.set(key, job);
  return job;
}

export function stopTelegramLlmGeneration(event: TelegramLlmJobOwner & { draftId: number }): boolean {
  const job = jobs.get(ownerKey(event));
  if (!job || job.draftId !== event.draftId) return false;
  job.abort();
  return true;
}

export function stopTelegramLlmGenerationByToken(owner: TelegramLlmJobOwner, token: string): boolean {
  const job = jobs.get(ownerKey(owner));
  if (!job || job.token !== token) return false;
  job.abort();
  return true;
}

export function abortAllTelegramLlmGenerations(): void {
  for (const job of jobs.values()) job.abort();
  jobs.clear();
}

export function shutdownTelegramLlmGenerations(): void {
  shuttingDown = true;
  abortAllTelegramLlmGenerations();
}

export function enableTelegramLlmGenerations(): void {
  shuttingDown = false;
}
