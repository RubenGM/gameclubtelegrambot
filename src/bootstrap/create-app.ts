import type { RuntimeConfig } from '../config/runtime-config.js';
import type { AppRuntimeStatus } from '../domain/runtime-status.js';
import {
  createInfrastructureBoundary,
  type InfrastructureBoundaryStatus,
} from '../infrastructure/runtime-boundary.js';
import {
  createTelegramBoundary,
  type TelegramBoundaryStatus,
} from '../telegram/runtime-boundary.js';

export interface LoggerLike {
  info(bindings: object, message: string): void;
  error?(bindings: object, message: string): void;
}

export interface CreateAppOptions {
  config: RuntimeConfig;
  logger: LoggerLike;
  startInfrastructure?: () => Promise<InfrastructureBoundaryStatus>;
  startTelegram?: () => Promise<TelegramBoundaryStatus>;
}

export interface App {
  start(): Promise<AppRuntimeStatus>;
}

export function createApp({
  config,
  logger,
  startInfrastructure = () =>
    createInfrastructureBoundary({
      config,
      logger: {
        info: logger.info.bind(logger),
        error: logger.error?.bind(logger) ?? (() => {}),
      },
    }),
  startTelegram = () =>
    createTelegramBoundary({
      config,
      logger: {
        info: logger.info.bind(logger),
        error: logger.error?.bind(logger) ?? (() => {}),
      },
    }),
}: CreateAppOptions): App {
  return {
    async start() {
      const infrastructure = await startInfrastructure();
      const telegram = await startTelegram();

      const status: AppRuntimeStatus = {
        service: 'gameclubtelegrambot',
        infrastructure,
        telegram,
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
