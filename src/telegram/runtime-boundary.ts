import { Bot } from 'grammy';

import type { RuntimeConfig } from '../config/runtime-config.js';

export interface TelegramBoundaryStatus {
  bot: 'connected';
}

export interface TelegramLogger {
  info(bindings: object, message: string): void;
  error(bindings: object, message: string): void;
}

export interface TelegramContextLike {
  reply(message: string): Promise<unknown>;
}

export interface TelegramBotLike {
  onStartCommand(handler: (context: TelegramContextLike) => Promise<unknown> | unknown): void;
  startPolling(): Promise<void>;
}

export interface CreateTelegramBoundaryOptions {
  config: RuntimeConfig;
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
  logger,
  createBot = createGrammyTelegramBot,
}: CreateTelegramBoundaryOptions): Promise<TelegramBoundaryStatus> {
  try {
    const bot = createBot({
      token: config.telegram.token,
      logger,
      publicName: config.bot.publicName,
    });

    bot.onStartCommand(async (context) => {
      await context.reply(
        `${config.bot.publicName} online. Escriu /start per comprovar que la connexio amb Telegram funciona.`,
      );
    });

    await bot.startPolling();
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown Telegram startup error';

    logger.error({ error: reason }, 'Telegram startup failed');

    throw new TelegramStartupError(`Telegram startup failed: ${reason}`);
  }

  logger.info({ publicName: config.bot.publicName }, 'Telegram bot long polling started');

  return {
    bot: 'connected',
  };
}

function createGrammyTelegramBot({
  token,
  logger,
}: CreateTelegramBotOptions): TelegramBotLike {
  const bot = new Bot(token);

  return {
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
  };
}
