import { Bot, type Context } from 'grammy';

import type { RuntimeConfig } from '../config/runtime-config.js';
import type { InfrastructureRuntimeServices } from '../infrastructure/runtime-boundary.js';

export interface TelegramBoundaryStatus {
  bot: 'connected';
}

export interface TelegramBoundary {
  status: TelegramBoundaryStatus;
  stop(): Promise<void>;
}

export interface TelegramLogger {
  info(bindings: object, message: string): void;
  error(bindings: object, message: string): void;
}

export interface TelegramContextLike {
  reply(message: string): Promise<unknown>;
  runtime?: TelegramRuntime;
}

export interface TelegramRuntime {
  bot: Pick<RuntimeConfig['bot'], 'clubName' | 'publicName'>;
  services: InfrastructureRuntimeServices;
}

export type TelegramMiddleware = (
  context: TelegramContextLike,
  next: () => Promise<void>,
) => Promise<void>;

export interface TelegramBotLike {
  use(middleware: TelegramMiddleware): void;
  onStartCommand(handler: (context: TelegramContextLike) => Promise<unknown> | unknown): void;
  startPolling(): Promise<void>;
  stopPolling(): Promise<void>;
}

export interface CreateTelegramBoundaryOptions {
  config: RuntimeConfig;
  services: InfrastructureRuntimeServices;
  logger: TelegramLogger;
  createBot?: (options: CreateTelegramBotOptions) => TelegramBotLike;
}

export interface CreateTelegramBotOptions {
  token: string;
  logger: TelegramLogger;
  publicName: string;
}

export class TelegramStartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TelegramStartupError';
  }
}

export async function createTelegramBoundary({
  config,
  services,
  logger,
  createBot = createGrammyTelegramBot,
}: CreateTelegramBoundaryOptions): Promise<TelegramBoundary> {
  try {
    const bot = createBot({
      token: config.telegram.token,
      logger,
      publicName: config.bot.publicName,
    });

    for (const middleware of createMiddlewarePipeline({ config, services, logger })) {
      bot.use(middleware);
    }

    registerHandlers({ bot, config });

    await bot.startPolling();

    logger.info({ publicName: config.bot.publicName }, 'Telegram bot long polling started');

    return {
      status: {
        bot: 'connected',
      },
      async stop() {
        await bot.stopPolling();
        logger.info({}, 'Telegram bot long polling stopped');
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown Telegram startup error';

    logger.error({ error: reason }, 'Telegram startup failed');

    throw new TelegramStartupError(`Telegram startup failed: ${reason}`);
  }
}

function createGrammyTelegramBot({
  token,
  logger,
}: CreateTelegramBotOptions): TelegramBotLike {
  const bot = new Bot<Context & TelegramContextLike>(token);

  return {
    use(middleware) {
      bot.use(async (context, next) => middleware(context, next));
    },
    onStartCommand(handler) {
      bot.command('start', handler);
    },
    async startPolling() {
      await bot.init();

      void bot.start({
        drop_pending_updates: false,
        onStart: ({ username }) => {
          logger.info({ username }, 'Telegram bot authenticated successfully');
        },
      }).catch((error) => {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Telegram polling stopped unexpectedly');
      });
    },
    async stopPolling() {
      bot.stop();
    },
  };
}

function createMiddlewarePipeline({
  config,
  services,
  logger,
}: {
  config: RuntimeConfig;
  services: InfrastructureRuntimeServices;
  logger: TelegramLogger;
}): TelegramMiddleware[] {
  return [
    createErrorHandlingMiddleware({ logger }),
    createLoggingMiddleware({ logger }),
    createRuntimeContextMiddleware({ config, services }),
  ];
}

function createErrorHandlingMiddleware({
  logger,
}: {
  logger: TelegramLogger;
}): TelegramMiddleware {
  return async (context, next) => {
    try {
      await next();
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          hasRuntimeContext: Boolean(context.runtime),
        },
        'Telegram update handling failed',
      );
      throw error;
    }
  };
}

function createLoggingMiddleware({
  logger,
}: {
  logger: TelegramLogger;
}): TelegramMiddleware {
  return async (_context, next) => {
    logger.info({}, 'Telegram update received');
    await next();
  };
}

function createRuntimeContextMiddleware({
  config,
  services,
}: {
  config: RuntimeConfig;
  services: InfrastructureRuntimeServices;
}): TelegramMiddleware {
  return async (context, next) => {
    context.runtime = {
      bot: {
        clubName: config.bot.clubName,
        publicName: config.bot.publicName,
      },
      services,
    };

    await next();
  };
}

function registerHandlers({
  bot,
  config,
}: {
  bot: TelegramBotLike;
  config: RuntimeConfig;
}): void {
  bot.onStartCommand(createStartCommandHandler({ publicName: config.bot.publicName }));
}

function createStartCommandHandler({
  publicName,
}: {
  publicName: string;
}): (context: TelegramContextLike) => Promise<void> {
  return async (context) => {
    await context.reply(
      `${publicName} online. Escriu /start per comprovar que la connexio amb Telegram funciona.`,
    );
  };
}
