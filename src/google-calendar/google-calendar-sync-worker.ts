import type { ScheduleRepository } from '../schedule/schedule-catalog.js';
import type { AppMetadataSessionStorage } from '../telegram/conversation-session-store.js';
import type { GoogleCalendarServiceAccountConfig } from './google-calendar-client.js';
import { synchronizeFutureGoogleCalendarScheduleEvents } from './google-calendar-sync.js';

export interface GoogleCalendarSyncWorker {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createGoogleCalendarSyncWorker({
  enabled,
  intervalMs,
  repository,
  storage,
  config,
  logger,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}: {
  enabled: boolean;
  intervalMs: number;
  repository: ScheduleRepository;
  storage: AppMetadataSessionStorage;
  config: GoogleCalendarServiceAccountConfig | undefined;
  logger: { error(bindings: { error: string }, message: string): void };
  setIntervalFn?: (handler: () => void, intervalMs: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (timer: ReturnType<typeof setInterval>) => void;
}): GoogleCalendarSyncWorker {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await synchronizeFutureGoogleCalendarScheduleEvents({ repository, storage, config });
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Google Calendar synchronization tick failed');
    } finally {
      running = false;
    }
  };
  return {
    async start() {
      if (!enabled || timer) return;
      await tick();
      timer = setIntervalFn(() => { void tick(); }, intervalMs);
      if (typeof timer === 'object' && timer !== null && 'unref' in timer && typeof timer.unref === 'function') timer.unref();
    },
    async stop() {
      if (!timer) return;
      clearIntervalFn(timer);
      timer = null;
    },
  };
}
