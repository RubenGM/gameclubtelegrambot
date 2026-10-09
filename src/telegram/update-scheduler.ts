import type { Update } from 'grammy/types';

export const telegramGenerationStopCallbackPrefix = 'llm_cmd:stop:';

export function isTelegramGenerationControl(update: Update): boolean {
  return Boolean(update.stopped_message_generation)
    || Boolean(update.callback_query?.message?.chat.type === 'private'
      && update.callback_query.data?.startsWith(telegramGenerationStopCallbackPrefix));
}

export function resolveTelegramUpdateScope(update: Update): string {
  const chat = update.message?.chat ?? update.callback_query?.message?.chat;
  const user = update.message?.from ?? update.callback_query?.from;
  return chat ? `chat:${chat.id}:user:${user?.id ?? chat.id}` : `update:${update.update_id}`;
}

export interface TelegramUpdateScheduler<T> {
  handle(update: T): Promise<void>;
  stop(): Promise<void>;
}

/** Keep polling independent of normal work so Stop can reach an active generation. */
export function createTelegramUpdateScheduler<T>({
  scope,
  isControl,
  consume,
  onError,
  onRejected,
  concurrency = 16,
  maxPending = 256,
}: {
  scope(update: T): string;
  isControl(update: T): boolean;
  consume(update: T): Promise<void>;
  onError(error: unknown, update: T): void;
  onRejected(update: T, reason: 'capacity' | 'shutdown'): void;
  concurrency?: number;
  maxPending?: number;
}): TelegramUpdateScheduler<T> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isInteger(maxPending) || maxPending < 0) {
    throw new Error('Invalid Telegram update scheduler limits');
  }
  const pending: Array<{ update: T; key: string }> = [];
  const activeScopes = new Set<string>();
  const activeTasks = new Set<Promise<void>>();
  let stopping = false;

  const launch = (update: T, key?: string): Promise<void> => {
    if (key !== undefined) activeScopes.add(key);
    const task = Promise.resolve().then(() => consume(update)).catch((error: unknown) => {
      onError(error, update);
    }).finally(() => {
      activeTasks.delete(task);
      if (key !== undefined) activeScopes.delete(key);
      pump();
    });
    activeTasks.add(task);
    return task;
  };

  const pump = (): void => {
    if (stopping) return;
    while (activeScopes.size < concurrency) {
      const index = pending.findIndex(({ key }) => !activeScopes.has(key));
      if (index < 0) return;
      const item = pending.splice(index, 1)[0]!;
      void launch(item.update, item.key);
    }
  };

  return {
    async handle(update) {
      if (stopping) {
        onRejected(update, 'shutdown');
        return;
      }
      if (isControl(update)) {
        await launch(update);
        return;
      }
      const key = scope(update);
      if (activeScopes.size < concurrency && !activeScopes.has(key)) {
        void launch(update, key);
      } else if (pending.length < maxPending) {
        pending.push({ update, key });
      } else {
        onRejected(update, 'capacity');
      }
    },
    async stop() {
      stopping = true;
      for (const { update } of pending.splice(0)) onRejected(update, 'shutdown');
      await Promise.all(activeTasks);
    },
  };
}
