export interface ScheduleReminderWorker {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createScheduleReminderWorker({
  enabled,
  intervalMs,
  runOnce,
  logger,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}: {
  enabled: boolean;
  intervalMs: number;
  runOnce: () => Promise<void>;
  logger: { error(bindings: { error: string }, message: string): void };
  setIntervalFn?: (handler: () => void, intervalMs: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (timer: ReturnType<typeof setInterval>) => void;
}): ScheduleReminderWorker {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const tick = async () => {
    if (running) {
      return;
    }

    running = true;
    try {
      await runOnce();
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Schedule reminder tick failed');
    } finally {
      running = false;
    }
  };

  return {
    async start() {
      if (!enabled || timer) {
        return;
      }

      await tick();
      timer = setIntervalFn(() => {
        void tick();
      }, intervalMs);
      if (typeof timer === 'object' && timer !== null && 'unref' in timer && typeof timer.unref === 'function') {
        timer.unref();
      }
    },
    async stop() {
      if (!timer) {
        return;
      }

      clearIntervalFn(timer);
      timer = null;
    },
  };
}
