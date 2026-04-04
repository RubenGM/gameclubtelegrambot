import { Bot, type Context } from 'grammy';

import type { RuntimeConfig } from '../config/runtime-config.js';
import type { InfrastructureRuntimeServices } from '../infrastructure/runtime-boundary.js';
import {
  TelegramInteractionError,
  registerTelegramCommands,
  renderTelegramHelpMessage,
  type TelegramCommandDefinition,
  type TelegramCommandHandlerContext,
  type TelegramCommandHandler,
} from './command-registry.js';
import {
  resolveTelegramChatContext,
  type TelegramChatContext,
  type TelegramChatLike,
} from './chat-context.js';
import {
  loadConversationSessionRuntime,
  type ConversationSessionRuntime,
  type ConversationSessionStore,
} from './conversation-session.js';
import {
  createAppMetadataConversationSessionStore,
  createDatabaseAppMetadataSessionStorage,
} from './conversation-session-store.js';
import {
  createDatabaseTelegramActorStore,
  type TelegramActor,
} from './actor-store.js';

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
  chat?: TelegramChatLike;
  from?: {
    id: number;
  };
  reply(message: string): Promise<unknown>;
  runtime?: TelegramRuntime;
}

export interface TelegramRuntime {
  bot: Pick<RuntimeConfig['bot'], 'clubName' | 'publicName'>;
  services: InfrastructureRuntimeServices;
  chat?: TelegramChatContext;
  actor?: TelegramActor;
  session?: ConversationSessionRuntime;
}

export type TelegramMiddleware = (
  context: TelegramContextLike,
  next: () => Promise<void>,
) => Promise<void>;

export interface TelegramBotLike {
  use(middleware: TelegramMiddleware): void;
  onCommand(command: string, handler: TelegramCommandHandler): void;
  startPolling(): Promise<void>;
  stopPolling(): Promise<void>;
}

export interface CreateTelegramBoundaryOptions {
  config: RuntimeConfig;
  services: InfrastructureRuntimeServices;
  logger: TelegramLogger;
  isNewsEnabledGroup?: (options: {
    chatId: number;
    services: InfrastructureRuntimeServices;
  }) => Promise<boolean>;
  loadActor?: (options: {
    telegramUserId: number;
    services: InfrastructureRuntimeServices;
  }) => Promise<TelegramActor>;
  createConversationSessionStore?: (options: {
    services: InfrastructureRuntimeServices;
  }) => ConversationSessionStore;
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
  isNewsEnabledGroup = async () => false,
  loadActor = ({ telegramUserId, services: runtimeServices }) =>
    createDatabaseTelegramActorStore({ database: runtimeServices.database.db }).loadActor(telegramUserId),
  createConversationSessionStore = ({ services: runtimeServices }) =>
    createAppMetadataConversationSessionStore({
      storage: createDatabaseAppMetadataSessionStorage({
        database: runtimeServices.database.db,
      }),
    }),
  createBot = createGrammyTelegramBot,
}: CreateTelegramBoundaryOptions): Promise<TelegramBoundary> {
  try {
    const bot = createBot({
      token: config.telegram.token,
      logger,
      publicName: config.bot.publicName,
    });

    for (const middleware of createMiddlewarePipeline({
      config,
      services,
      logger,
      isNewsEnabledGroup,
      loadActor,
      conversationSessionStore: createConversationSessionStore({ services }),
    })) {
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
    onCommand(command, handler) {
      bot.command(command, async (context) => {
        if (!context.runtime?.chat) {
          throw new Error('Telegram command received before chat context resolution');
        }

        await handler(context as unknown as TelegramCommandHandlerContext);
      });
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
  isNewsEnabledGroup,
  loadActor,
  conversationSessionStore,
}: {
  config: RuntimeConfig;
  services: InfrastructureRuntimeServices;
  logger: TelegramLogger;
  isNewsEnabledGroup: (options: {
    chatId: number;
    services: InfrastructureRuntimeServices;
  }) => Promise<boolean>;
  loadActor: (options: {
    telegramUserId: number;
    services: InfrastructureRuntimeServices;
  }) => Promise<TelegramActor>;
  conversationSessionStore: ConversationSessionStore;
}): TelegramMiddleware[] {
  return [
    createErrorHandlingMiddleware({ logger }),
    createLoggingMiddleware({ logger }),
    createRuntimeContextMiddleware({ config, services }),
    createChatContextMiddleware({ services, isNewsEnabledGroup }),
    createActorMiddleware({ services, loadActor }),
    createConversationSessionMiddleware({ store: conversationSessionStore }),
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
      const safeMessage =
        error instanceof TelegramInteractionError
          ? error.message
          : 'S ha produit un error inesperat. Torna-ho a provar en uns moments.';

      if (context.runtime?.session) {
        await context.runtime.session.cancel();
      }

      await context.reply(safeMessage);

      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          hasRuntimeContext: Boolean(context.runtime),
        },
        'Telegram update handling failed',
      );
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

function createActorMiddleware({
  services,
  loadActor,
}: {
  services: InfrastructureRuntimeServices;
  loadActor: (options: {
    telegramUserId: number;
    services: InfrastructureRuntimeServices;
  }) => Promise<TelegramActor>;
}): TelegramMiddleware {
  return async (context, next) => {
    if (!context.runtime?.chat) {
      throw new Error('Telegram chat context missing before actor resolution');
    }

    if (!context.from) {
      throw new Error('Telegram update does not include sender information');
    }

    context.runtime.actor = await loadActor({
      telegramUserId: context.from.id,
      services,
    });

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

function createChatContextMiddleware({
  services,
  isNewsEnabledGroup,
}: {
  services: InfrastructureRuntimeServices;
  isNewsEnabledGroup: (options: {
    chatId: number;
    services: InfrastructureRuntimeServices;
  }) => Promise<boolean>;
}): TelegramMiddleware {
  return async (context, next) => {
    if (!context.runtime) {
      throw new Error('Telegram runtime context missing before chat context resolution');
    }

    const chat = context.chat;

    context.runtime.chat = await resolveTelegramChatContext(
      chat
        ? {
            chat,
            isNewsEnabledGroup: ({ chatId }) => isNewsEnabledGroup({ chatId, services }),
          }
        : {
            isNewsEnabledGroup: ({ chatId }) => isNewsEnabledGroup({ chatId, services }),
          },
    );

    await next();
  };
}

function createConversationSessionMiddleware({
  store,
}: {
  store: ConversationSessionStore;
}): TelegramMiddleware {
  return async (context, next) => {
    if (!context.runtime?.chat) {
      throw new Error('Telegram chat context missing before conversation session resolution');
    }

    if (!context.from) {
      throw new Error('Telegram update does not include sender information');
    }

    context.runtime.session = await loadConversationSessionRuntime({
      scope: {
        chatId: context.runtime.chat.chatId,
        userId: context.from.id,
      },
      store,
    });

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
  registerTelegramCommands({
    bot,
    commands: createDefaultCommands({ publicName: config.bot.publicName }),
  });
}

function createDefaultCommands({
  publicName,
}: {
  publicName: string;
}): TelegramCommandDefinition[] {
  return [
    {
      command: 'cancel',
      contexts: ['private', 'group', 'group-news'],
      access: 'public',
      description: 'Cancel.la el flux actual',
      handle: async (context) => {
        const cancelled = await context.runtime.session.cancel();

        await context.reply(
          cancelled ? 'Flux cancel.lat correctament.' : 'No hi ha cap flux actiu per cancel.lar.',
        );
      },
    },
    {
      command: 'start',
      contexts: ['private', 'group', 'group-news'],
      access: 'public',
      description: 'Comprova que el bot esta actiu',
      handle: async (context) => {
        await context.reply(
          `${publicName} online. Escriu /start per comprovar que la connexio amb Telegram funciona.`,
        );
      },
    },
    {
      command: 'help',
      contexts: ['private', 'group', 'group-news'],
      access: 'public',
      description: 'Mostra ajuda contextual',
      handle: async (context) => {
        await context.reply(
          renderTelegramHelpMessage({
            commands: createDefaultCommands({ publicName }),
            context,
          }),
        );
      },
    },
  ];
}
