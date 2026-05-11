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
  appendWarning(message: string): string;
}

export interface TelegramApiHealthMonitorOptions {
  now?: () => Date;
  recoveryQuietMs?: number;
  successRecoveryCount?: number;
  maxTextMessageLength?: number;
}

const defaultRecoveryQuietMs = 5 * 60 * 1000;
const defaultSuccessRecoveryCount = 3;
const defaultMaxTextMessageLength = 4096;

export function createTelegramApiHealthMonitor({
  now = () => new Date(),
  recoveryQuietMs = defaultRecoveryQuietMs,
  successRecoveryCount = defaultSuccessRecoveryCount,
  maxTextMessageLength = defaultMaxTextMessageLength,
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
    appendWarning(message) {
      const current = snapshot();
      if (!current.degraded || !current.detectedAt) {
        return message;
      }

      const warning = [
        `Problemas de conexión con Telegram detectados desde ${formatTelegramApiHealthTimestamp(current.detectedAt)}.`,
        'Si el bot deja de responder, inténtalo de nuevo más tarde.',
      ].join(' ');
      const fullWarning = `\n\n⚠️ ${warning}`;

      if (message.length + fullWarning.length <= maxTextMessageLength) {
        return `${message}${fullWarning}`;
      }

      const shortWarning = `\n\n⚠️ Telegram está inestable desde ${formatTelegramApiHealthTimestamp(current.detectedAt)}. Inténtalo más tarde si deja de responder.`;
      if (message.length + shortWarning.length <= maxTextMessageLength) {
        return `${message}${shortWarning}`;
      }

      return message;
    },
  };
}

function formatTelegramApiHealthTimestamp(value: Date): string {
  const parts = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(value);
  const part = (type: string) => parts.find((candidate) => candidate.type === type)?.value ?? '00';

  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
}
