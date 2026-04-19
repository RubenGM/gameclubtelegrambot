import { Bot, type Context } from 'grammy';

import type { AuthorizationService } from '../authorization/service.js';
import type { RuntimeConfig } from '../config/runtime-config.js';
import type { InfrastructureRuntimeServices } from '../infrastructure/runtime-boundary.js';
import { createAppMetadataTelegramLanguagePreferenceStore } from './language-preference-store.js';
import {
  type TelegramCommandHandlerContext,
  type TelegramCommandHandler,
} from './command-registry.js';
import { type TelegramChatContext, type TelegramChatLike } from './chat-context.js';
import {
  type ConversationSessionStore,
  type ConversationSessionRuntime,
} from './conversation-session.js';
import {
  createAppMetadataConversationSessionStore,
  createDatabaseAppMetadataSessionStorage,
} from './conversation-session-store.js';
import {
  createDatabaseTelegramActorStore,
  type TelegramActor,
} from './actor-store.js';
import { createMiddlewarePipeline } from './runtime-boundary-middleware.js';
import { registerHandlers, toGrammyReplyOptions } from './runtime-boundary-registration.js';
import { createDatabaseNewsGroupRepository } from '../news/news-group-store.js';
import { createWikipediaBoardGameImportService } from '../catalog/wikipedia-boardgame-import-service.js';
import { createBoardGameGeekCollectionImportService } from '../catalog/wikipedia-boardgame-import-service.js';
import { createDatabaseMembershipAccessRepository } from '../membership/access-flow-store.js';

export { formatStartMessage, toGrammyReplyOptions } from './runtime-boundary-registration.js';

export interface TelegramBoundaryStatus {
  bot: 'connected';
}

export interface TelegramBoundary {
  status: TelegramBoundaryStatus;
  stop(): Promise<void>;
}

export type TelegramFatalRuntimeErrorHandler = (error: unknown) => void;

export interface TelegramLogger {
  info(bindings: object, message: string): void;
  error(bindings: object, message: string): void;
}

export interface TelegramContextLike {
  chat?: TelegramChatLike | undefined;
  from?: {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
  } | undefined;
  messageText?: string | undefined;
  callbackData?: string | undefined;
  reply(message: string, options?: TelegramReplyOptions): Promise<unknown>;
  runtime?: TelegramRuntime | undefined;
}

export interface TelegramInlineButton {
  text: string;
  callbackData?: string;
  url?: string;
}

export interface TelegramReplyOptions {
  inlineKeyboard?: TelegramInlineButton[][];
  replyKeyboard?: string[][];
  resizeKeyboard?: boolean;
  persistentKeyboard?: boolean;
  parseMode?: 'HTML';
}

export interface TelegramRuntime {
  bot: Pick<RuntimeConfig['bot'], 'clubName' | 'publicName' | 'language'> & {
    username?: string | undefined;
    sendPrivateMessage(telegramUserId: number, message: string, options?: TelegramReplyOptions): Promise<void>;
    sendGroupMessage?(chatId: number, message: string, options?: TelegramReplyOptions): Promise<void>;
  };
  services: InfrastructureRuntimeServices;
  wikipediaBoardGameImportService: ReturnType<typeof createWikipediaBoardGameImportService>;
  boardGameGeekCollectionImportService: ReturnType<typeof createBoardGameGeekCollectionImportService>;
  chat?: TelegramChatContext;
  actor?: TelegramActor;
  authorization?: AuthorizationService;
  session?: ConversationSessionRuntime;
}

export type TelegramMiddleware = (
  context: TelegramContextLike,
  next: () => Promise<void>,
) => Promise<void>;

export interface TelegramBotLike {
  username?: string | undefined;
  use(middleware: TelegramMiddleware): void;
  onCommand(command: string, handler: TelegramCommandHandler): void;
  onCallback(callbackPrefix: string, handler: TelegramCommandHandler): void;
  onText(handler: TelegramCommandHandler): void;
  sendPrivateMessage(telegramUserId: number, message: string, options?: TelegramReplyOptions): Promise<void>;
  sendGroupMessage?(chatId: number, message: string, options?: TelegramReplyOptions): Promise<void>;
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
  createLanguagePreferenceStore?: (options: {
    services: InfrastructureRuntimeServices;
  }) => {
    loadLanguage(telegramUserId: number): Promise<'ca' | 'es' | 'en' | null>;
    saveLanguage(telegramUserId: number, language: 'ca' | 'es' | 'en'): Promise<void>;
  };
  onFatalRuntimeError?: TelegramFatalRuntimeErrorHandler;
  createBot?: (options: CreateTelegramBotOptions) => TelegramBotLike;
}

export interface CreateTelegramBotOptions {
  token: string;
  logger: TelegramLogger;
  publicName: string;
  onFatalRuntimeError?: TelegramFatalRuntimeErrorHandler;
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
  isNewsEnabledGroup = async ({ chatId, services: runtimeServices }) => {
    const database = runtimeServices.database.db as { select?: unknown } | undefined;
    if (typeof database?.select !== 'function') {
      return false;
    }

    return createDatabaseNewsGroupRepository({ database: runtimeServices.database.db }).isNewsEnabledGroup(chatId);
  },
  loadActor = ({ telegramUserId, services: runtimeServices }) =>
    createDatabaseTelegramActorStore({ database: runtimeServices.database.db }).loadActor(telegramUserId),
  createConversationSessionStore = ({ services: runtimeServices }) =>
    createAppMetadataConversationSessionStore({
      storage: createDatabaseAppMetadataSessionStorage({
        database: runtimeServices.database.db,
      }),
    }),
  createLanguagePreferenceStore = ({ services: runtimeServices }) =>
    createAppMetadataTelegramLanguagePreferenceStore({
      storage: createDatabaseAppMetadataSessionStorage({
        database: runtimeServices.database.db,
      }),
    }),
  onFatalRuntimeError,
  createBot = createGrammyTelegramBot,
}: CreateTelegramBoundaryOptions): Promise<TelegramBoundary> {
  try {
    let didReportFatalRuntimeError = false;
    const reportFatalRuntimeError = (error: unknown) => {
      if (didReportFatalRuntimeError) {
        return;
      }

      didReportFatalRuntimeError = true;
      onFatalRuntimeError?.(error);
    };

    const bot = createBot({
      token: config.telegram.token,
      logger,
      publicName: config.bot.publicName,
      onFatalRuntimeError: reportFatalRuntimeError,
    });

    for (const middleware of createMiddlewarePipeline({
      config,
      services,
      bot,
      logger,
      isNewsEnabledGroup,
      loadActor,
      conversationSessionStore: createConversationSessionStore({ services }),
      languagePreferenceStore: createLanguagePreferenceStore({ services }),
    })) {
      bot.use(middleware);
    }

    registerHandlers({
      bot,
      publicName: config.bot.publicName,
      adminElevationPasswordHash: config.adminElevation.passwordHash,
    });

    try {
      await createDatabaseMembershipAccessRepository({
        database: services.database.db,
      }).backfillDisplayNames();
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Telegram displayName backfill skipped',
      );
    }

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
  onFatalRuntimeError,
}: CreateTelegramBotOptions): TelegramBotLike {
  const bot = new Bot<Context & TelegramContextLike>(token);
  let pollingPromise: Promise<void> | undefined;
  let isStopping = false;
  let botUsername: string | undefined;

  return {
    get username() {
      return botUsername;
    },
    use(middleware) {
      bot.use(async (context, next) => middleware(context, next));
    },
    onCommand(command, handler) {
      bot.command(command, async (context) => {
        if (!context.runtime?.chat) {
          throw new Error('Telegram command received before chat context resolution');
        }

        context.messageText = context.msg?.text ?? context.message?.text;

        await handler(createTelegramCommandContext(context));
      });
    },
    onCallback(callbackPrefix, handler) {
      bot.callbackQuery(new RegExp(`^${escapeRegExp(callbackPrefix)}(.+)?$`), async (context) => {
        if (!context.runtime?.chat) {
          throw new Error('Telegram callback received before chat context resolution');
        }

        context.callbackData = context.callbackQuery.data;
        await runTelegramCallbackHandler({
          handle: () => handler(createTelegramCommandContext(context)),
          acknowledge: () => context.answerCallbackQuery(),
        });
      });
    },
    onText(handler) {
      bot.on('message:text', async (context) => {
        if (!context.runtime?.chat) {
          throw new Error('Telegram text message received before chat context resolution');
        }

        context.messageText = context.msg?.text ?? context.message?.text;
        if (!context.messageText || context.messageText.startsWith('/')) {
          return;
        }

        await handler(createTelegramCommandContext(context));
      });
    },
    async sendPrivateMessage(telegramUserId, message, options) {
      await bot.api.sendMessage(telegramUserId, message, options ? toGrammyReplyOptions(options) : undefined);
    },
    async sendGroupMessage(chatId, message, options) {
      await bot.api.sendMessage(chatId, message, options ? toGrammyReplyOptions(options) : undefined);
    },
    async startPolling() {
      await bot.init();

      isStopping = false;
      pollingPromise = bot.start({
        drop_pending_updates: false,
        onStart: ({ username }) => {
          botUsername = username;
          logger.info({ username }, 'Telegram bot authenticated successfully');
        },
      }).catch((error) => {
        if (isStopping) {
          return;
        }

        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Telegram polling stopped unexpectedly');
        onFatalRuntimeError?.(error);
      });
    },
    async stopPolling() {
      isStopping = true;
      bot.stop();
      await pollingPromise;
    },
  };
}

export async function runTelegramCallbackHandler({
  handle,
  acknowledge,
}: {
  handle: () => unknown;
  acknowledge: () => unknown;
}): Promise<void> {
  try {
    await handle();
  } finally {
    await acknowledge();
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createTelegramCommandContext(
  context: TelegramContextLike & {
    reply(message: string, options?: Record<string, unknown>): Promise<unknown>;
  },
): TelegramCommandHandlerContext {
  return {
    ...context,
    reply(message: string, options?: TelegramReplyOptions) {
      return context.reply(message, toGrammyReplyOptions(options));
    },
  } as unknown as TelegramCommandHandlerContext;
}
