import test from 'node:test';
import assert from 'node:assert/strict';
import { startTelegramLlmGeneration, stopTelegramLlmGeneration, stopTelegramLlmGenerationByToken, abortAllTelegramLlmGenerations, shutdownTelegramLlmGenerations, enableTelegramLlmGenerations } from './llm-command-jobs.js';
import { createLlmAnswerPreview } from './llm-answer-preview.js';
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('Stop is bound to owner, topic and unpredictable generation identity; stale Stop cannot abort replacement', () => {
  const owner = { chatId: 7, userId: 7, messageThreadId: 4 };
  const old = startTelegramLlmGeneration(owner);
  assert.equal(stopTelegramLlmGeneration({ ...owner, userId: 9, draftId: old.draftId }), false);
  assert.equal(stopTelegramLlmGeneration({ ...owner, messageThreadId: 5, draftId: old.draftId }), false);
  assert.equal(stopTelegramLlmGenerationByToken(owner, 'invented'), false);
  const next = startTelegramLlmGeneration(owner);
  assert.equal(old.signal.aborted, true);
  old.finish();
  assert.equal(stopTelegramLlmGenerationByToken(owner, old.token), false);
  assert.equal(next.signal.aborted, false);
  assert.equal(stopTelegramLlmGeneration({ ...owner, draftId: next.draftId }), true);
  assert.equal(stopTelegramLlmGeneration({ ...owner, draftId: next.draftId }), false);
  assert.equal(stopTelegramLlmGenerationByToken(owner, next.token), false);
  next.finish();
  assert.equal(stopTelegramLlmGenerationByToken(owner, next.token), false);
});

test('shutdown aborts private and silent group generations and releases registry', () => {
  const privateJob = startTelegramLlmGeneration({ chatId: 2, userId: 2 });
  const groupJob = startTelegramLlmGeneration({ chatId: -3, userId: 2, messageThreadId: 42 });
  abortAllTelegramLlmGenerations();
  assert.equal(privateJob.signal.aborted, true);
  assert.equal(groupJob.signal.aborted, true);
  assert.equal(stopTelegramLlmGenerationByToken(groupJob, groupJob.token), false);
});

test('shutdown gate prevents work still entering handlers from starting fresh inference', () => {
  shutdownTelegramLlmGenerations();
  const late = startTelegramLlmGeneration({ chatId: 55, userId: 55 });
  assert.equal(late.signal.aborted, true);
  assert.equal(stopTelegramLlmGenerationByToken(late, late.token), false);
  enableTelegramLlmGenerations();
  const resumed = startTelegramLlmGeneration({ chatId: 55, userId: 55 });
  assert.equal(resumed.signal.aborted, false);
  resumed.finish();
});

test('preview coalesces bursts, serializes slow transport and flushes last provider snapshot before final', async () => {
  const job = startTelegramLlmGeneration({ chatId: 1, userId: 1 });
  const sent: string[] = []; let active = 0; let maxActive = 0;
  const preview = createLlmAnswerPreview({ job, intervalMs: 2, sendDraft: async (text) => { active++; maxActive = Math.max(active, maxActive); await pause(12); sent.push(text); active--; return true; }, updateProgress: async () => { assert.fail('unexpected editable fallback'); } });
  preview.onTextDelta('Ho'); preview.onTextDelta('la');
  await pause(5);
  preview.onTextDelta(', mundo.');
  await preview.finish();
  assert.deepEqual(sent, ['Hola', 'Hola, mundo.']);
  assert.equal(maxActive, 1);
  assert.equal(job.draftSent, true);
  preview.onTextDelta(' LATE'); await pause(3);
  assert.equal(sent.length, 2); job.finish();
});

test('unsupported draft uses editable text; Stop discards pending drafts and failed terminal does not flush', async () => {
  const job = startTelegramLlmGeneration({ chatId: 1, userId: 1 });
  const edits: string[] = []; let calls = 0;
  const preview = createLlmAnswerPreview({ job, intervalMs: 2, sendDraft: async () => { calls++; return false; }, updateProgress: async (text) => { edits.push(text); return true; } });
  preview.onTextDelta('Primero'); await pause(10);
  preview.onTextDelta(' y segundo'); await preview.finish();
  assert.equal(calls, 1); assert.deepEqual(edits, ['Primero', 'Primero y segundo']); assert.equal(job.draftSent, false); job.finish();
  const stopped = startTelegramLlmGeneration({ chatId: 1, userId: 1 });
  const quiet = createLlmAnswerPreview({ job: stopped, updateProgress: async () => { assert.fail('update after Stop'); } });
  quiet.onTextDelta('partial'); stopTelegramLlmGenerationByToken(stopped, stopped.token); await quiet.finish(); stopped.finish();
  const failed = startTelegramLlmGeneration({ chatId: 1, userId: 1 });
  const noFlush = createLlmAnswerPreview({ job: failed, updateProgress: async () => { assert.fail('update after terminal failure'); } });
  noFlush.onTextDelta('partial'); await noFlush.finish(false); failed.finish();
});
