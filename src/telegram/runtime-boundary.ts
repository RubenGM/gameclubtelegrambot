import { Bot, type Context } from 'grammy';

import { APP_VERSION } from '../app-version.js';
import { createAuthorizationService } from '../authorization/service.js';
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
import {
  approveMembershipRequest,
  listPendingMembershipRequests,
  rejectMembershipRequest,
  requestMembershipAccess,
} from '../membership/access-flow.js';
import { createDatabaseMembershipAccessRepository } from '../membership/access-flow-store.js';
import { elevateApprovedUserToAdmin } from '../membership/admin-elevation.js';
import { createDatabaseAdminElevationRepository } from '../membership/admin-elevation-store.js';

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
}

export interface TelegramRuntime {
  bot: Pick<RuntimeConfig['bot'], 'clubName' | 'publicName'> & {
    sendPrivateMessage(telegramUserId: number, message: string): Promise<void>;
  };
  services: InfrastructureRuntimeServices;
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
  sendPrivateMessage(telegramUserId: number, message: string): Promise<void>;
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
      bot,
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
    async sendPrivateMessage(telegramUserId, message) {
      await bot.api.sendMessage(telegramUserId, message);
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
}): TelegramMiddleware[] {
  return [
    createErrorHandlingMiddleware({ logger }),
    createLoggingMiddleware({ logger }),
    createRuntimeContextMiddleware({ config, services, bot }),
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
        publicName: config.bot.publicName,
        sendPrivateMessage: bot.sendPrivateMessage.bind(bot),
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
    commands: createDefaultCommands({
      publicName: config.bot.publicName,
      adminElevationPasswordHash: config.adminElevation.passwordHash,
    }),
  });

  registerMembershipCallbacks({ bot });
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
        const password = parseCommandSecret(context.messageText, 'elevate_admin');
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
        const applicantTelegramUserId = parseCommandTarget(context.messageText, 'approve');
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
        const applicantTelegramUserId = parseCommandTarget(context.messageText, 'reject');
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
          formatStartMessage({
            publicName,
            version: APP_VERSION,
            isAdmin: context.runtime.actor.isAdmin,
          }),
          context.runtime.actor.isAdmin
            ? {
                inlineKeyboard: buildAdminStartInlineKeyboard(),
                replyKeyboard: buildAdminReplyKeyboard(),
                resizeKeyboard: true,
                persistentKeyboard: true,
              }
            : undefined,
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

function parseCommandTarget(messageText: string | undefined, command: string): number {
  const candidate = messageText?.trim().split(/\s+/)[1];
  const telegramUserId = Number(candidate);

  if (!candidate || !Number.isInteger(telegramUserId) || telegramUserId <= 0) {
    throw new TelegramInteractionError(
      `Has d indicar un Telegram user ID valid amb /${command} <telegramUserId>.`,
    );
  }

  return telegramUserId;
}

function parseCommandSecret(messageText: string | undefined, command: string): string {
  const secret = messageText?.trim().split(/\s+/).slice(1).join(' ');

  if (!secret) {
    throw new TelegramInteractionError(`Has d indicar la contrasenya amb /${command} <contrasenya>.`);
  }

  return secret;
}

function parseCallbackTarget(callbackData: string | undefined, callbackPrefix: string): number {
  const candidate = callbackData?.slice(callbackPrefix.length);
  const telegramUserId = Number(candidate);

  if (!candidate || !Number.isInteger(telegramUserId) || telegramUserId <= 0) {
    throw new TelegramInteractionError('No s ha pogut identificar l usuari destinatari d aquesta accio.');
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
  if (!options?.inlineKeyboard && !options?.replyKeyboard) {
    return undefined;
  }

  if (options.replyKeyboard) {
    return {
      reply_markup: {
        keyboard: options.replyKeyboard.map((row) => row.map((buttonText) => ({ text: buttonText }))),
        resize_keyboard: options.resizeKeyboard ?? true,
        is_persistent: options.persistentKeyboard ?? true,
      },
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
  };
}

export function formatStartMessage({
  publicName,
  version,
  isAdmin,
}: {
  publicName: string;
  version: string;
  isAdmin: boolean;
}): string {
  if (isAdmin) {
    return `${publicName} online (v${version}). Escriu /help per veure les opcions disponibles.`;
  }

  return `Benvingut a ${publicName}. Escriu /help per veure les opcions disponibles.`;
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
    const applicantTelegramUserId = parseCallbackTarget(context.callbackData, 'approve_access:');
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
    const applicantTelegramUserId = parseCallbackTarget(context.callbackData, 'reject_access:');
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

async function handleReviewAccess(context: TelegramCommandHandlerContext): Promise<void> {
  const repository = createDatabaseMembershipAccessRepository({
    database: context.runtime.services.database.db,
  });
  const result = await listPendingMembershipRequests({ repository });

  if (result.pendingUsers.length === 0) {
    await context.reply('No hi ha cap sollicitud pendent ara mateix.');
    return;
  }

  await context.reply(
    ['Sollicituds pendents:']
      .concat(
        result.pendingUsers.map(
          (user) =>
            `- ${user.displayName} (${user.username ? `@${user.username}` : user.telegramUserId}) -> /approve ${user.telegramUserId} o /reject ${user.telegramUserId}`,
        ),
      )
      .join('\n'),
    {
      inlineKeyboard: result.pendingUsers.map((user) => [
        {
          text: 'Aprovar',
          callbackData: `approve_access:${user.telegramUserId}`,
        },
        {
          text: 'Rebutjar',
          callbackData: `reject_access:${user.telegramUserId}`,
        },
      ]),
    },
  );
}

export function buildAdminStartInlineKeyboard(): TelegramInlineButton[][] {
  return [
    [
      {
        text: 'Revisar accessos',
        callbackData: 'menu:review_access',
      },
      {
        text: 'Ajuda',
        callbackData: 'menu:help',
      },
    ],
  ];
}

export function buildAdminReplyKeyboard(): string[][] {
  return [['/review_access', '/help']];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
