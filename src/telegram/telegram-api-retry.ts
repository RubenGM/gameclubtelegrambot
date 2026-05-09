import type { TelegramLogger } from './runtime-boundary.js';

const defaultMaxAttempts = 3;
const baseRetryDelayMs = 500;
const maxRetryDelayMs = 5_000;

export interface TelegramApiRetryOptions {
  operation: string;
  logger?: TelegramLogger;
  maxAttempts?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export async function withTelegramApiRetry<T>(
  options: TelegramApiRetryOptions,
  action: () => Promise<T>,
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? defaultMaxAttempts);
  const sleep = options.sleep ?? sleepMilliseconds;
  let attempt = 0;

  while (true) {
    attempt += 1;

    try {
      return await action();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableTelegramApiError(error)) {
        throw error;
      }

      const retryDelayMs = resolveRetryDelayMs(error, attempt);
      options.logger?.info(
        {
          operation: options.operation,
          attempt,
          maxAttempts,
          retryDelayMs,
          error: error instanceof Error ? error.message : String(error),
        },
        'Telegram API call failed; retrying',
      );
      await sleep(retryDelayMs);
    }
  }
}

function isRetryableTelegramApiError(error: unknown): boolean {
  const errorCode = readTelegramErrorCode(error);
  if (errorCode === 429 || (errorCode !== null && errorCode >= 500)) {
    return true;
  }
  if (errorCode !== null) {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /network request|fetch failed|socket|timeout|timed out|econnreset|econnrefused|eai_again|enetunreach/i.test(message);
}

function resolveRetryDelayMs(error: unknown, attempt: number): number {
  const retryAfterSeconds = readTelegramRetryAfterSeconds(error);
  if (retryAfterSeconds !== null) {
    return Math.min(maxRetryDelayMs, Math.max(0, retryAfterSeconds * 1_000));
  }

  return Math.min(maxRetryDelayMs, baseRetryDelayMs * 2 ** (attempt - 1));
}

function readTelegramErrorCode(error: unknown): number | null {
  const rawCode = readNestedProperty(error, ['error_code']) ?? readNestedProperty(error, ['errorCode']);
  return typeof rawCode === 'number' ? rawCode : null;
}

function readTelegramRetryAfterSeconds(error: unknown): number | null {
  const rawRetryAfter =
    readNestedProperty(error, ['parameters', 'retry_after'])
    ?? readNestedProperty(error, ['parameters', 'retryAfter']);
  return typeof rawRetryAfter === 'number' ? rawRetryAfter : null;
}

function readNestedProperty(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== 'object' || !(key in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function sleepMilliseconds(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
