import type { RuntimeConfig } from '../config/runtime-config.js';
import type { AppRuntimeStatus } from '../domain/runtime-status.js';
import { createInfrastructureBoundary } from '../infrastructure/runtime-boundary.js';
import { createTelegramBoundary } from '../telegram/runtime-boundary.js';

export interface LoggerLike {
  info(bindings: object, message: string): void;
}

export interface CreateAppOptions {
  config: RuntimeConfig;
  logger: LoggerLike;
}

export interface App {
  start(): Promise<AppRuntimeStatus>;
}

export function createApp({ config, logger }: CreateAppOptions): App {
  return {
    async start() {
      const status: AppRuntimeStatus = {
        service: 'gameclubtelegrambot',
        infrastructure: createInfrastructureBoundary(),
        telegram: createTelegramBoundary(),
      };

      logger.info(
        {
          bot: {
            clubName: config.bot.clubName,
            publicName: config.bot.publicName,
          },
          status,
        },
        'Application started with validated runtime configuration',
      );

      return status;
    },
  };
}
