import type { ScheduleRepository } from '../schedule/schedule-catalog.js';
import type { ScheduleReminderWorker } from '../schedule/schedule-reminder-worker.js';
import type { RoleGameRepository } from './role-game-catalog.js';
import { ensureRecurringRoleGameSessions } from './role-game-scheduler.js';

export function createRoleGameRecurrenceWorker({
  enabled,
  intervalMs,
  roleGameRepository,
  scheduleRepository,
  actorTelegramUserId,
  logger,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}: {
  enabled: boolean;
  intervalMs: number;
  roleGameRepository: RoleGameRepository;
  scheduleRepository: ScheduleRepository;
  actorTelegramUserId: number;
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
      const games = await roleGameRepository.listRecurringGames?.() ?? [];
      await Promise.all(games.map((game) =>
        ensureRecurringRoleGameSessions({
          roleGameRepository,
          scheduleRepository,
          game,
          actorTelegramUserId,
        }),
      ));
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Role game recurrence tick failed');
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
