import type { RuntimeConfig } from '../config/runtime-config.js';
import type { AppRuntimeStatus } from '../domain/runtime-status.js';
import {
  createInfrastructureBoundary,
  type InfrastructureBoundary,
  type InfrastructureRuntimeServices,
} from '../infrastructure/runtime-boundary.js';
import {
  createTelegramBoundary,
  type TelegramBoundary,
  type TelegramFatalRuntimeErrorHandler,
} from '../telegram/runtime-boundary.js';

export interface LoggerLike {
  info(bindings: object, message: string): void;
  error?(bindings: object, message: string): void;
}

export interface CreateAppOptions {
  config: RuntimeConfig;
  logger: LoggerLike;
  startInfrastructure?: () => Promise<InfrastructureBoundary>;
  startTelegram?: (options: {
    services: InfrastructureRuntimeServices;
    onFatalRuntimeError: TelegramFatalRuntimeErrorHandler;
  }) => Promise<TelegramBoundary>;
}

export interface App {
  start(): Promise<AppRuntimeStatus>;
  stop(): Promise<void>;
  onFatalRuntimeError?(handler: TelegramFatalRuntimeErrorHandler): void;
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
  startTelegram = ({ services, onFatalRuntimeError }) =>
    createTelegramBoundary({
      config,
      services,
      logger: {
        info: logger.info.bind(logger),
        error: logger.error?.bind(logger) ?? (() => {}),
      },
      onFatalRuntimeError,
    }),
}: CreateAppOptions): App {
  let infrastructure: InfrastructureBoundary | undefined;
  let telegram: TelegramBoundary | undefined;
  const fatalRuntimeErrorHandlers = new Set<TelegramFatalRuntimeErrorHandler>();
  const emitFatalRuntimeError = (error: unknown) => {
    for (const handler of fatalRuntimeErrorHandlers) {
      handler(error);
    }
  };

  return {
    onFatalRuntimeError(handler) {
      fatalRuntimeErrorHandlers.add(handler);
    },
    async start() {
      infrastructure = await startInfrastructure();

      try {
        telegram = await startTelegram({
          services: infrastructure.services,
          onFatalRuntimeError: emitFatalRuntimeError,
        });
      } catch (error) {
        await infrastructure.stop();
        infrastructure = undefined;
        throw error;
      }

      const status: AppRuntimeStatus = {
        service: 'gameclubtelegrambot',
        infrastructure: infrastructure.status,
        telegram: telegram.status,
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
    async stop() {
      const shutdownErrors: Error[] = [];

      if (telegram) {
        try {
          await telegram.stop();
        } catch (error) {
          shutdownErrors.push(normalizeError(error, 'Telegram shutdown failed'));
        }
      }

      if (infrastructure) {
        try {
          await infrastructure.stop();
        } catch (error) {
          shutdownErrors.push(normalizeError(error, 'Infrastructure shutdown failed'));
        }
      }

      telegram = undefined;
      infrastructure = undefined;

      if (shutdownErrors[0]) {
        throw shutdownErrors[0];
      }
    },
  };
}

function normalizeError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(fallbackMessage);
}
