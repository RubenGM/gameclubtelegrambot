import { Bot, type Context } from 'grammy';

import { APP_VERSION } from '../app-version.js';
import { createAuthorizationService } from '../authorization/service.js';
import type { RuntimeConfig } from '../config/runtime-config.js';
import type { InfrastructureRuntimeServices } from '../infrastructure/runtime-boundary.js';
import { createAppMetadataTelegramLanguagePreferenceStore } from './language-preference-store.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import {
  TelegramInteractionError,
  registerTelegramCommands,
  renderTelegramHelpMessage,
  type TelegramCommandDefinition,
  type TelegramCommandHandlerContext,
  type TelegramCommandHandler,
} from './command-registry.js';
import { resolveTelegramActionMenu } from './action-menu.js';
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
import { createDatabaseNewsGroupRepository } from '../news/news-group-store.js';
import { createWikipediaBoardGameImportService } from '../catalog/wikipedia-boardgame-import-service.js';
import {
  approveMembershipRequest,
  listPendingMembershipRequests,
  rejectMembershipRequest,
  requestMembershipAccess,
} from '../membership/access-flow.js';
import { createDatabaseMembershipAccessRepository } from '../membership/access-flow-store.js';
import { elevateApprovedUserToAdmin } from '../membership/admin-elevation.js';
import { createDatabaseAdminElevationRepository } from '../membership/admin-elevation-store.js';
import {
  handleTelegramCatalogAdminCallback,
  handleTelegramCatalogAdminText,
  handleTelegramCatalogAdminStartText,
  catalogAdminCallbackPrefixes,
} from './catalog-admin-flow.js';
import {
  handleTelegramCatalogReadCallback,
  handleTelegramCatalogReadCommand,
  handleTelegramCatalogReadText,
  handleTelegramCatalogReadStartText,
  catalogReadCallbackPrefixes,
} from './catalog-read-flow.js';
import {
  handleTelegramCatalogLoanCallback,
  handleTelegramCatalogLoanText,
  catalogLoanCallbackPrefixes,
} from './catalog-loan-flow.js';
import { handleTelegramNewsGroupText } from './news-group-flow.js';
import {
  handleTelegramCalendarText,
} from './calendar-flow.js';
import {
  handleTelegramTableAdminCallback,
  handleTelegramTableAdminText,
  handleTelegramTableAdminStartText,
  tableAdminCallbackPrefixes,
} from './table-admin-flow.js';
import {
  handleTelegramTableReadCallback,
  handleTelegramTableReadCommand,
  handleTelegramTableReadStartText,
  tableReadCallbackPrefixes,
} from './table-read-flow.js';
import {
  handleTelegramVenueEventAdminCallback,
  handleTelegramVenueEventAdminText,
  handleTelegramVenueEventAdminStartText,
  venueEventAdminCallbackPrefixes,
} from './venue-event-admin-flow.js';
import { handleTelegramLanguageCommand, handleTelegramLanguageText } from './language-flow.js';
import {
  handleTelegramScheduleCallback,
  handleTelegramScheduleText,
  handleTelegramScheduleStartText,
  scheduleCallbackPrefixes,
} from './schedule-flow.js';

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
  chat?: TelegramChatLike | undefined;
  from?: {
    id: number;
    username?: string;
    first_name?: string;
  } | undefined;
  messageText?: string | undefined;
  callbackData?: string | undefined;
  reply(message: string, options?: TelegramReplyOptions): Promise<unknown>;
  runtime?: TelegramRuntime | undefined;
}

export interface TelegramInlineButton {
  text: string;
  callbackData: string;
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
    sendPrivateMessage(telegramUserId: number, message: string): Promise<void>;
    sendGroupMessage?(chatId: number, message: string, options?: TelegramReplyOptions): Promise<void>;
  };
  services: InfrastructureRuntimeServices;
  wikipediaBoardGameImportService: ReturnType<typeof createWikipediaBoardGameImportService>;
  chat?: TelegramChatContext;
  actor?: TelegramActor;
  authorization?: ReturnType<typeof createAuthorizationService>;
  session?: ConversationSessionRuntime;
}

export type TelegramMiddleware = (
  context: TelegramContextLike,
  next: () => Promise<void>,
) => Promise<void>;

export interface TelegramBotLike {
  use(middleware: TelegramMiddleware): void;
  onCommand(command: string, handler: TelegramCommandHandler): void;
  onCallback(callbackPrefix: string, handler: TelegramCommandHandler): void;
  onText(handler: TelegramCommandHandler): void;
  sendPrivateMessage(telegramUserId: number, message: string): Promise<void>;
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
      bot,
      logger,
      isNewsEnabledGroup,
      loadActor,
      conversationSessionStore: createConversationSessionStore({ services }),
      languagePreferenceStore: createLanguagePreferenceStore({ services }),
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
        await handler(createTelegramCommandContext(context));
        await context.answerCallbackQuery();
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
    async sendPrivateMessage(telegramUserId, message) {
      await bot.api.sendMessage(telegramUserId, message);
    },
    async sendGroupMessage(chatId, message, options) {
      await bot.api.sendMessage(chatId, message, options ? toGrammyReplyOptions(options) : undefined);
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
  bot,
  logger,
  isNewsEnabledGroup,
  loadActor,
  conversationSessionStore,
  languagePreferenceStore,
}: {
  config: RuntimeConfig;
  services: InfrastructureRuntimeServices;
  bot: TelegramBotLike;
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
  languagePreferenceStore: {
    loadLanguage(telegramUserId: number): Promise<'ca' | 'es' | 'en' | null>;
  };
}): TelegramMiddleware[] {
  return [
    createErrorHandlingMiddleware({ logger }),
    createLoggingMiddleware({ logger }),
    createRuntimeContextMiddleware({ config, services, bot }),
    createChatContextMiddleware({ services, isNewsEnabledGroup }),
    createActorMiddleware({ services, loadActor }),
    createLanguageMiddleware({ config, languagePreferenceStore }),
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
          : createTelegramI18n(normalizeBotLanguage(context.runtime?.bot.language, 'ca')).common.unexpectedError;

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
    context.runtime.authorization = createAuthorizationService({
      subject: {
        actorId: context.runtime.actor.telegramUserId,
        status: context.runtime.actor.status,
        isAdmin: context.runtime.actor.isAdmin,
        permissions: context.runtime.actor.permissions,
      },
    });

    await next();
  };
}

function createLanguageMiddleware({
  config,
  languagePreferenceStore,
}: {
  config: RuntimeConfig;
  languagePreferenceStore: {
    loadLanguage(telegramUserId: number): Promise<'ca' | 'es' | 'en' | null>;
  };
}): TelegramMiddleware {
  return async (context, next) => {
    if (!context.runtime?.bot || !context.runtime.actor) {
      throw new Error('Telegram actor context missing before language resolution');
    }

    const storedLanguage = await languagePreferenceStore.loadLanguage(context.runtime.actor.telegramUserId);
    context.runtime.bot.language = normalizeBotLanguage(storedLanguage ?? config.bot.language, config.bot.language);

    await next();
  };
}

function createRuntimeContextMiddleware({
  config,
  services,
  bot,
}: {
  config: RuntimeConfig;
  services: InfrastructureRuntimeServices;
  bot: TelegramBotLike;
}): TelegramMiddleware {
  return async (context, next) => {
    context.runtime = {
      bot: {
        clubName: config.bot.clubName,
        language: config.bot.language,
        publicName: config.bot.publicName,
        sendPrivateMessage: bot.sendPrivateMessage.bind(bot),
        ...(bot.sendGroupMessage ? { sendGroupMessage: bot.sendGroupMessage.bind(bot) } : {}),
      },
      services,
      wikipediaBoardGameImportService: createWikipediaBoardGameImportService(),
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
    commands: createDefaultCommands({
      publicName: config.bot.publicName,
      adminElevationPasswordHash: config.adminElevation.passwordHash,
    }),
  });

  registerMembershipCallbacks({ bot });
  registerScheduleCallbacks({ bot });
  registerTableReadCallbacks({ bot });
  registerTableAdminCallbacks({ bot });
  registerCatalogReadCallbacks({ bot });
  registerCatalogAdminCallbacks({ bot });
  registerVenueEventAdminCallbacks({ bot });
  registerTextHandlers({ bot });
}

function registerTextHandlers({
  bot,
}: {
  bot: TelegramBotLike;
}): void {
  bot.onText(async (context) => {
    if (await handleTelegramLanguageText(context)) {
      return;
    }

    if (await handleTelegramMemberMenuDebugText(context)) {
      return;
    }

    if (await handleTelegramCatalogLoanText(context)) {
      return;
    }

    if (await handleTelegramVenueEventAdminText(context)) {
      return;
    }

    if (await handleTelegramCalendarText(context)) {
      return;
    }

    if (await handleTelegramScheduleText(context)) {
      return;
    }

    if (await handleTelegramTableAdminText(context)) {
      return;
    }

    if (await handleTelegramCatalogReadText(context)) {
      return;
    }

    if (await handleTelegramCatalogAdminText(context)) {
      return;
    }
  });
}

function createDefaultCommands({
  publicName,
  adminElevationPasswordHash,
}: {
  publicName: string;
  adminElevationPasswordHash: string;
}): TelegramCommandDefinition[] {
  return [
    {
      command: 'elevate_admin',
      contexts: ['private'],
      access: 'public',
      description: 'Eleva privilegis amb contrasenya',
      handle: async (context) => {
        const password = parseCommandSecret(context.messageText, 'elevate_admin', context.runtime.bot.language ?? 'ca');
        const repository = createDatabaseAdminElevationRepository({
          database: context.runtime.services.database.db,
        });
        const result = await elevateApprovedUserToAdmin({
          repository,
          telegramUserId: context.runtime.actor.telegramUserId,
          password,
          passwordHash: adminElevationPasswordHash,
        });

        await context.reply(result.message);
      },
    },
    {
      command: 'access',
      contexts: ['private'],
      access: 'public',
      description: 'Sollicita accés al club',
      handle: async (context) => {
        const repository = createDatabaseMembershipAccessRepository({
          database: context.runtime.services.database.db,
        });
        const result = await requestMembershipAccess({
          repository,
          telegramUserId: context.runtime.actor.telegramUserId,
          ...(context.from?.username !== undefined ? { username: context.from.username } : {}),
          displayName: context.from?.first_name ?? `Usuari ${context.runtime.actor.telegramUserId}`,
        });

        await context.reply(result.message);
      },
    },
    {
      command: 'language',
      contexts: ['private', 'group', 'group-news'],
      access: 'public',
      description: 'Canvia l idioma del bot',
      handle: async (context) => {
        await handleTelegramLanguageCommand(context);
      },
    },
    {
      command: 'schedule',
      contexts: ['private'],
      access: 'approved',
      description: 'Gestiona les teves activitats del club',
      handle: async (context) => {
        await handleTelegramScheduleText({ ...context, messageText: '/schedule' });
      },
    },
    {
      command: 'calendar',
      contexts: ['private'],
      access: 'approved',
      handle: async (context) => {
        await handleTelegramCalendarText({ ...context, messageText: '/calendar' });
      },
    },
    {
      command: 'tables',
      contexts: ['private'],
      access: 'approved',
      description: 'Consulta les taules actives del club',
      handle: async (context) => {
        await handleTelegramTableReadCommand(context);
      },
    },
    {
      command: 'catalog_search',
      contexts: ['private'],
      access: 'approved',
      description: 'Consulta i cerca el cataleg',
      handle: async (context) => {
        await handleTelegramCatalogReadCommand(context);
      },
    },
    {
      command: 'news',
      contexts: ['group', 'group-news'],
      access: 'admin',
      description: 'Gestiona el mode news i les subscripcions del grup',
      handle: async (context) => {
        await handleTelegramNewsGroupText(context);
      },
    },
    {
      command: 'venue_events',
      contexts: ['private'],
      access: 'admin',
      handle: async (context) => {
        await handleTelegramVenueEventAdminText({ ...context, messageText: '/venue_events' });
      },
    },
    {
      command: 'catalog',
      contexts: ['private'],
      access: 'admin',
      description: 'Gestiona el cataleg manual del club',
      handle: async (context) => {
        await handleTelegramCatalogAdminText({ ...context, messageText: '/catalog' });
      },
    },
    {
      command: 'review_access',
      contexts: ['private'],
      access: 'admin',
      description: 'Revisa sollicituds pendents',
      handle: async (context) => handleReviewAccess(context),
    },
    {
      command: 'approve',
      contexts: ['private'],
      access: 'admin',
      description: 'Aprova una sollicitud',
      handle: async (context) => {
        const applicantTelegramUserId = parseCommandTarget(context.messageText, 'approve', context.runtime.bot.language ?? 'ca');
        const repository = createDatabaseMembershipAccessRepository({
          database: context.runtime.services.database.db,
        });
        const result = await approveMembershipRequest({
          repository,
          applicantTelegramUserId,
          adminTelegramUserId: context.runtime.actor.telegramUserId,
        });

        await context.reply(result.adminMessage);
        if (result.outcome === 'approved') {
          await context.runtime.bot.sendPrivateMessage(applicantTelegramUserId, result.applicantMessage);
        }
      },
    },
    {
      command: 'reject',
      contexts: ['private'],
      access: 'admin',
      description: 'Rebutja una sollicitud',
      handle: async (context) => {
        const applicantTelegramUserId = parseCommandTarget(context.messageText, 'reject', context.runtime.bot.language ?? 'ca');
        const repository = createDatabaseMembershipAccessRepository({
          database: context.runtime.services.database.db,
        });
        const result = await rejectMembershipRequest({
          repository,
          applicantTelegramUserId,
          adminTelegramUserId: context.runtime.actor.telegramUserId,
        });

        await context.reply(result.adminMessage);
        if (result.outcome === 'blocked') {
          await context.runtime.bot.sendPrivateMessage(applicantTelegramUserId, result.applicantMessage);
        }
      },
    },
    {
      command: 'cancel',
      contexts: ['private', 'group', 'group-news'],
      access: 'public',
      description: 'Cancel.la el flux actual',
      handle: async (context) => {
        const cancelled = await context.runtime.session.cancel();
        const i18n = createTelegramI18n(context.runtime.bot.language ?? 'ca');

        await context.reply(
          cancelled ? i18n.common.flowCancelled : i18n.common.noActiveFlowToCancel,
          buildReplyOptionsForCurrentActionMenu(context),
        );
      },
    },
    {
      command: 'start',
      contexts: ['private', 'group', 'group-news'],
      access: 'public',
      description: 'Comprova que el bot esta actiu',
      handle: async (context) => {
        if (await handleTelegramScheduleStartText({ ...context })) {
          return;
        }
        if (await handleTelegramTableReadStartText({ ...context })) {
          return;
        }
        if (await handleTelegramTableAdminStartText({ ...context })) {
          return;
        }
        if (await handleTelegramCatalogReadStartText({ ...context })) {
          return;
        }
        if (await handleTelegramCatalogAdminStartText({ ...context })) {
          return;
        }
        if (await handleTelegramVenueEventAdminStartText({ ...context })) {
          return;
        }

        await context.reply(
          formatStartMessage({
            publicName,
            version: APP_VERSION,
            isAdmin: context.runtime.actor.isAdmin,
            isApproved: context.runtime.actor.isApproved,
            language: context.runtime.bot.language ?? 'ca',
          }),
          buildReplyOptionsForCurrentActionMenu(context),
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
            commands: createDefaultCommands({ publicName, adminElevationPasswordHash }),
            context,
          }),
        );
      },
    },
  ];
}

function parseCommandTarget(
  messageText: string | undefined,
  command: string,
  language: 'ca' | 'es' | 'en' = 'ca',
): number {
  const candidate = messageText?.trim().split(/\s+/)[1];
  const telegramUserId = Number(candidate);

  if (!candidate || !Number.isInteger(telegramUserId) || telegramUserId <= 0) {
    throw new TelegramInteractionError(
      createTelegramI18n(language).common.invalidTelegramUserId.replace('{command}', command),
    );
  }

  return telegramUserId;
}

function parseCommandSecret(
  messageText: string | undefined,
  command: string,
  language: 'ca' | 'es' | 'en' = 'ca',
): string {
  const secret = messageText?.trim().split(/\s+/).slice(1).join(' ');

  if (!secret) {
    throw new TelegramInteractionError(
      createTelegramI18n(language).common.invalidPassword.replace('{command}', command),
    );
  }

  return secret;
}

function parseCallbackTarget(
  callbackData: string | undefined,
  callbackPrefix: string,
  language: 'ca' | 'es' | 'en' = 'ca',
): number {
  const candidate = callbackData?.slice(callbackPrefix.length);
  const telegramUserId = Number(candidate);

  if (!candidate || !Number.isInteger(telegramUserId) || telegramUserId <= 0) {
    throw new TelegramInteractionError(createTelegramI18n(language).common.invalidCallbackTarget);
  }

  return telegramUserId;
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

export function toGrammyReplyOptions(options?: TelegramReplyOptions): Record<string, unknown> | undefined {
  if (!options) {
    return undefined;
  }

  if (!options.inlineKeyboard && !options.replyKeyboard) {
    return options.parseMode ? { parse_mode: options.parseMode } : undefined;
  }

  if (options.replyKeyboard) {
    return {
      reply_markup: {
        keyboard: options.replyKeyboard.map((row) => row.map((buttonText) => ({ text: buttonText }))),
        resize_keyboard: options.resizeKeyboard ?? true,
        is_persistent: options.persistentKeyboard ?? true,
      },
      ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
    };
  }

  const inlineKeyboard = options.inlineKeyboard;

  if (!inlineKeyboard) {
    return undefined;
  }

  return {
    reply_markup: {
      inline_keyboard: inlineKeyboard.map((row) =>
        row.map((button) => ({
          text: button.text,
          callback_data: button.callbackData,
        })),
      ),
    },
    ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
  };
}

export function formatStartMessage({
  publicName,
  version,
  isAdmin,
  isApproved,
  language,
}: {
  publicName: string;
  version: string;
  isAdmin: boolean;
  isApproved: boolean;
  language: 'ca' | 'es' | 'en';
}): string {
  const i18n = createTelegramI18n(language);
  const template = isAdmin
    ? i18n.common.startMessageAdmin
    : isApproved
      ? i18n.common.startMessagePublic
      : i18n.common.startMessagePending;

  return template
    .replace('{publicName}', publicName)
    .replace('{version}', version);
}

function registerMembershipCallbacks({
  bot,
}: {
  bot: TelegramBotLike;
}): void {
  bot.onCallback('menu:review_access', async (context) => {
    await handleReviewAccess(context);
  });

  bot.onCallback('menu:help', async (context) => {
    await context.reply(
      renderTelegramHelpMessage({
        commands: createDefaultCommands({
          publicName: context.runtime.bot.publicName,
          adminElevationPasswordHash: '',
        }),
        context,
      }),
    );
  });

  bot.onCallback('approve_access:', async (context) => {
    const applicantTelegramUserId = parseCallbackTarget(context.callbackData, 'approve_access:', context.runtime.bot.language ?? 'ca');
    const repository = createDatabaseMembershipAccessRepository({
      database: context.runtime.services.database.db,
    });
    const result = await approveMembershipRequest({
      repository,
      applicantTelegramUserId,
      adminTelegramUserId: context.runtime.actor.telegramUserId,
    });

    await context.reply(result.adminMessage);
    if (result.outcome === 'approved') {
      await context.runtime.bot.sendPrivateMessage(applicantTelegramUserId, result.applicantMessage);
    }
  });

  bot.onCallback('reject_access:', async (context) => {
    const applicantTelegramUserId = parseCallbackTarget(context.callbackData, 'reject_access:', context.runtime.bot.language ?? 'ca');
    const repository = createDatabaseMembershipAccessRepository({
      database: context.runtime.services.database.db,
    });
    const result = await rejectMembershipRequest({
      repository,
      applicantTelegramUserId,
      adminTelegramUserId: context.runtime.actor.telegramUserId,
    });

    await context.reply(result.adminMessage);
    if (result.outcome === 'blocked') {
      await context.runtime.bot.sendPrivateMessage(applicantTelegramUserId, result.applicantMessage);
    }
  });
}

function registerTableAdminCallbacks({
  bot,
}: {
  bot: TelegramBotLike;
}): void {
  const callbackPrefixes = Object.values(tableAdminCallbackPrefixes);

  for (const callbackPrefix of callbackPrefixes) {
    bot.onCallback(callbackPrefix, async (context) => {
      await handleTelegramTableAdminCallback(context);
    });
  }
}

function registerCatalogAdminCallbacks({
  bot,
}: {
  bot: TelegramBotLike;
}): void {
  bot.onCallback(catalogAdminCallbackPrefixes.inspect, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
  bot.onCallback(catalogAdminCallbackPrefixes.browseMenu, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
  bot.onCallback(catalogAdminCallbackPrefixes.browseSearch, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
  bot.onCallback(catalogAdminCallbackPrefixes.browseFamily, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
  bot.onCallback(catalogAdminCallbackPrefixes.inspectGroup, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
  bot.onCallback(catalogAdminCallbackPrefixes.edit, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
  bot.onCallback(catalogAdminCallbackPrefixes.deactivate, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
}

function registerTableReadCallbacks({
  bot,
}: {
  bot: TelegramBotLike;
}): void {
  for (const callbackPrefix of Object.values(tableReadCallbackPrefixes)) {
    bot.onCallback(callbackPrefix, async (context) => {
      await handleTelegramTableReadCallback(context);
    });
  }
}

function registerCatalogReadCallbacks({
  bot,
}: {
  bot: TelegramBotLike;
}): void {
  bot.onCallback(catalogReadCallbackPrefixes.overview, async (context) => {
    await handleTelegramCatalogReadCallback(context);
  });
  bot.onCallback(catalogReadCallbackPrefixes.pageNext, async (context) => {
    await handleTelegramCatalogReadCallback(context);
  });
  bot.onCallback(catalogReadCallbackPrefixes.pagePrev, async (context) => {
    await handleTelegramCatalogReadCallback(context);
  });
  bot.onCallback(catalogReadCallbackPrefixes.back, async (context) => {
    await handleTelegramCatalogReadCallback(context);
  });
  bot.onCallback(catalogReadCallbackPrefixes.myLoans, async (context) => {
    await handleTelegramCatalogReadCallback(context);
  });
  bot.onCallback(catalogReadCallbackPrefixes.inspectFamily, async (context) => {
    await handleTelegramCatalogReadCallback(context);
  });
  bot.onCallback(catalogReadCallbackPrefixes.inspectGroup, async (context) => {
    await handleTelegramCatalogReadCallback(context);
  });
  bot.onCallback(catalogReadCallbackPrefixes.inspectItem, async (context) => {
    await handleTelegramCatalogReadCallback(context);
  });
  bot.onCallback(catalogLoanCallbackPrefixes.openMyLoans, async (context) => {
    await handleTelegramCatalogLoanCallback(context);
  });
  bot.onCallback(catalogLoanCallbackPrefixes.create, async (context) => {
    await handleTelegramCatalogLoanCallback(context);
  });
  bot.onCallback(catalogLoanCallbackPrefixes.return, async (context) => {
    await handleTelegramCatalogLoanCallback(context);
  });
  bot.onCallback(catalogLoanCallbackPrefixes.edit, async (context) => {
    await handleTelegramCatalogLoanCallback(context);
  });
}

function registerScheduleCallbacks({
  bot,
}: {
  bot: TelegramBotLike;
}): void {
  for (const callbackPrefix of Object.values(scheduleCallbackPrefixes)) {
    bot.onCallback(callbackPrefix, async (context) => {
      await handleTelegramScheduleCallback(context);
    });
  }
}

function registerVenueEventAdminCallbacks({
  bot,
}: {
  bot: TelegramBotLike;
}): void {
  for (const callbackPrefix of Object.values(venueEventAdminCallbackPrefixes)) {
    bot.onCallback(callbackPrefix, async (context) => {
      await handleTelegramVenueEventAdminCallback(context);
    });
  }
}

async function handleReviewAccess(context: TelegramCommandHandlerContext): Promise<void> {
  const i18n = createTelegramI18n(context.runtime.bot.language ?? 'ca');
  const repository = createDatabaseMembershipAccessRepository({
    database: context.runtime.services.database.db,
  });
  const result = await listPendingMembershipRequests({ repository });

  if (result.pendingUsers.length === 0) {
    await context.reply(i18n.common.noPendingRequests);
    return;
  }

  const lines = [
    i18n.common.pendingRequestsHeader,
    ...result.pendingUsers.map(
      (user) =>
        `- ${user.displayName} (${user.username ? `@${user.username}` : user.telegramUserId}) -> /approve ${user.telegramUserId} o /reject ${user.telegramUserId}`,
    ),
  ] as string[];

  await context.reply(lines.join('\n'), {
    inlineKeyboard: result.pendingUsers.map((user) => [
      {
        text: i18n.common.approveButton,
        callbackData: `approve_access:${user.telegramUserId}`,
      },
      {
        text: i18n.common.rejectButton,
        callbackData: `reject_access:${user.telegramUserId}`,
      },
    ]),
  });
}

function buildReplyOptionsForCurrentActionMenu(
  context: TelegramCommandHandlerContext,
): TelegramReplyOptions | undefined {
  return resolveTelegramActionMenu({
    context: {
      actor: context.runtime.actor,
      authorization: context.runtime.authorization,
      chat: context.runtime.chat,
      session: context.runtime.session.current,
      language: context.runtime.bot.language ?? 'ca',
    },
  });
}

async function handleTelegramMemberMenuDebugText(
  context: TelegramCommandHandlerContext,
): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  if (
    context.runtime.chat.kind !== 'private' ||
    !context.runtime.actor.isAdmin ||
    context.messageText?.trim() !== createTelegramI18n(language).actionMenu.memberDebug
  ) {
    return false;
  }

  await context.reply(createTelegramI18n(language).common.memberMenuDebugOpened, {
    ...resolveTelegramActionMenu({
      context: {
        actor: {
          ...context.runtime.actor,
          status: 'approved',
          isApproved: true,
          isAdmin: false,
        },
        authorization: context.runtime.authorization,
        chat: context.runtime.chat,
        session: context.runtime.session.current,
        language,
      },
    }),
  });
  return true;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
