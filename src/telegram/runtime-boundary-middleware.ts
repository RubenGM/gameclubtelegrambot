import { createAuthorizationService } from '../authorization/service.js';
import type { RuntimeConfig } from '../config/runtime-config.js';
import type { InfrastructureRuntimeServices } from '../infrastructure/runtime-boundary.js';
import { createDatabaseMembershipAccessRepository } from '../membership/access-flow-store.js';
import { resolveTelegramDisplayName } from '../membership/display-name.js';
import { createWikipediaBoardGameImportService } from '../catalog/wikipedia-boardgame-import-service.js';
import {
  resolveTelegramChatContext,
} from './chat-context.js';
import {
  loadConversationSessionRuntime,
  type ConversationSessionStore,
} from './conversation-session.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import type { TelegramActor } from './actor-store.js';
import {
  TelegramInteractionError,
} from './command-registry.js';
import type {
  TelegramBotLike,
  TelegramLogger,
  TelegramMiddleware,
} from './runtime-boundary.js';

export function createMiddlewarePipeline({
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

    const membershipRepository = createDatabaseMembershipAccessRepository({
      database: services.database.db,
    });
    await membershipRepository.syncUserProfile({
      telegramUserId: context.from.id,
      ...(context.from.username !== undefined ? { username: context.from.username } : {}),
      displayName: resolveTelegramDisplayName(context.from),
    });

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
      wikipediaBoardGameImportService: createWikipediaBoardGameImportService(
        config.bgg?.apiKey ? { bggApiKey: config.bgg.apiKey } : {},
      ),
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
