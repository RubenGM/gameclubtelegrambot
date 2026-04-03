import type { AppRuntimeStatus } from '../domain/runtime-status.js';
import { createInfrastructureBoundary } from '../infrastructure/runtime-boundary.js';
import { createTelegramBoundary } from '../telegram/runtime-boundary.js';

export interface LoggerLike {
  info(bindings: object, message: string): void;
}

export interface CreateAppOptions {
  logger: LoggerLike;
}

export interface App {
  start(): Promise<AppRuntimeStatus>;
}

export function createApp({ logger }: CreateAppOptions): App {
  return {
    async start() {
      const status: AppRuntimeStatus = {
        service: 'gameclubtelegrambot',
        infrastructure: createInfrastructureBoundary(),
        telegram: createTelegramBoundary(),
      };

      logger.info({ status }, 'Application started with stubbed integrations');

      return status;
    },
  };
}
