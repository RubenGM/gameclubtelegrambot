import type { TelegramLlmGenerationJob } from './llm-command-jobs.js';

/** Serialize and coalesce Telegram traffic while preserving genuine provider deltas. */
export function createLlmAnswerPreview(input: {
  job: TelegramLlmGenerationJob;
  sendDraft?: ((text: string) => Promise<boolean>) | undefined;
  updateProgress(text: string): Promise<boolean>;
  intervalMs?: number;
}) {
  let text = '';
  let delivered = '';
  let closed = false;
  let useDraft = Boolean(input.sendDraft);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  let dirty = false;
  const isOpen = () => !closed && !input.job.signal.aborted;
  const deliver = () => {
    if (!isOpen() || inFlight || !dirty) return;
    dirty = false;
    const snapshot = text.slice(0, 3800).replace(/[\uD800-\uDBFF]$/, '') + (text.length > 3800 ? '…' : '');
    if (snapshot === delivered) return;
    inFlight = (async () => {
      try {
        if (useDraft && input.sendDraft) {
          const sent = await input.sendDraft(snapshot);
          if (!sent) useDraft = false;
          if (sent) { input.job.draftSent = true; delivered = snapshot; return; }
        }
        if (isOpen()) { await input.updateProgress(snapshot); delivered = snapshot; }
      } catch {
        // Delivery failures must not fail inference or log sensitive answer text.
        console.warn(JSON.stringify({ event: 'llm-command.stream-preview.failed' }));
      }
    })().finally(() => {
      inFlight = undefined;
      if (dirty && isOpen()) schedule();
    });
  };
  const schedule = () => {
    if (!timer && isOpen()) timer = setTimeout(() => { timer = undefined; deliver(); }, input.intervalMs ?? 500);
  };
  return {
    onTextDelta(delta: string) {
      if (!isOpen()) return;
      text += delta;
      dirty = true;
      schedule();
    },
    async finish(flush = true) {
      if (timer) clearTimeout(timer);
      timer = undefined;
      // Await the current update, then flush the last genuine snapshot before final persistence.
      if (inFlight) await inFlight;
      if (flush && isOpen()) deliver();
      closed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (inFlight) await inFlight;
    },
  };
}
