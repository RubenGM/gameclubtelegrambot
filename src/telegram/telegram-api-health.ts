export interface TelegramApiHealthSnapshot {
  degraded: boolean;
  detectedAt: Date | null;
  lastFailureAt: Date | null;
  failureCount: number;
  successfulCallsSinceLastFailure: number;
}

export interface TelegramApiHealthMonitor {
  recordFailure(operation: string, error: unknown): TelegramApiHealthSnapshot;
  recordSuccess(operation: string): TelegramApiHealthSnapshot;
  snapshot(): TelegramApiHealthSnapshot;
  appendWarning(message: string, options?: { enabled?: boolean }): string;
}

export interface TelegramApiHealthMonitorOptions {
  now?: () => Date;
  recoveryQuietMs?: number;
  successRecoveryCount?: number;
  maxTextMessageLength?: number;
}

const defaultRecoveryQuietMs = 5 * 60 * 1000;
const defaultSuccessRecoveryCount = 3;

export function createTelegramApiHealthMonitor({
  now = () => new Date(),
  recoveryQuietMs = defaultRecoveryQuietMs,
  successRecoveryCount = defaultSuccessRecoveryCount,
}: TelegramApiHealthMonitorOptions = {}): TelegramApiHealthMonitor {
  let detectedAt: Date | null = null;
  let lastFailureAt: Date | null = null;
  let failureCount = 0;
  let successfulCallsSinceLastFailure = 0;

  const maybeRecover = () => {
    if (!detectedAt || !lastFailureAt) {
      return;
    }

    const quietForMs = now().getTime() - lastFailureAt.getTime();
    if (quietForMs >= recoveryQuietMs && successfulCallsSinceLastFailure >= successRecoveryCount) {
      detectedAt = null;
      lastFailureAt = null;
      failureCount = 0;
      successfulCallsSinceLastFailure = 0;
    }
  };

  const snapshot = (): TelegramApiHealthSnapshot => {
    maybeRecover();
    return {
      degraded: detectedAt !== null,
      detectedAt,
      lastFailureAt,
      failureCount,
      successfulCallsSinceLastFailure,
    };
  };

  return {
    recordFailure() {
      const failedAt = now();
      detectedAt ??= failedAt;
      lastFailureAt = failedAt;
      failureCount += 1;
      successfulCallsSinceLastFailure = 0;
      return snapshot();
    },
    recordSuccess() {
      if (detectedAt) {
        successfulCallsSinceLastFailure += 1;
      }
      return snapshot();
    },
    snapshot,
    appendWarning(message, options) {
      void options;
      snapshot();
      return message;
    },
  };
}
