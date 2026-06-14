import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { Bot, InputFile, type Context } from 'grammy';

import type { AuthorizationService } from '../authorization/service.js';
import type { CatalogDescriptionTranslator } from '../catalog/catalog-description-translation.js';
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
import type { ResolvedLlmCommandConfig } from './llm-command-config.js';
import type { LlmCommandMetrics } from './llm-command-metrics.js';
import type { LlmCommandService } from './llm-command-service.js';
import { createDatabaseMembershipAccessRepository } from '../membership/access-flow-store.js';
import { createTelegramApiHealthMonitor, type TelegramApiHealthMonitor } from './telegram-api-health.js';
import { withTelegramApiRetry } from './telegram-api-retry.js';
import type { TelegramPhotoMediaInput } from './telegram-media.js';

export { formatStartMessage, toGrammyReplyOptions } from './runtime-boundary-registration.js';

export interface TelegramBoundaryStatus {
  bot: 'connected';
}

export interface TelegramBoundary {
  status: TelegramBoundaryStatus;
  sendPrivateMessage(telegramUserId: number, message: string, options?: TelegramReplyOptions): Promise<void>;
  sendGroupMessage?(chatId: number, message: string, options?: TelegramReplyOptions): Promise<TelegramSentMessage | void>;
  copyMessage?(input: { fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }): Promise<{ messageId: number }>;
  forwardMessage?(input: { fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }): Promise<{ messageId: number }>;
  deleteMessage?(input: { chatId: number; messageId: number }): Promise<void>;
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
  newChatMembers?: Array<{
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
    is_bot?: boolean;
  }> | undefined;
  messageText?: string | undefined;
  messageEntities?: TelegramMessageEntity[] | undefined;
  messageId?: number | undefined;
  isForwardedMessage?: boolean | undefined;
  callbackData?: string | undefined;
  messageThreadId?: number | undefined;
  replyToBotMessage?: boolean | undefined;
  replyToBotMessageContext?: {
    messageId?: number;
    text?: string;
  } | undefined;
  messageMedia?: {
    attachmentKind: string;
    fileId?: string | null;
    fileUniqueId?: string | null;
    caption?: string | null;
    originalFileName?: string | null;
    mimeType?: string | null;
    fileSizeBytes?: number | null;
    mediaGroupId?: string | null;
    messageId: number;
  } | undefined;
  sharedChat?: {
    requestId: number;
    chatId: number;
    title?: string | null;
  } | undefined;
  reply(message: string, options?: TelegramReplyOptions): Promise<unknown>;
  runtime?: TelegramRuntime | undefined;
}

export interface TelegramMessageEntity {
  type: string;
  offset: number;
  length: number;
  url?: string | undefined;
  language?: string | undefined;
}

export interface TelegramInlineButton {
  text: string;
  callbackData?: string;
  url?: string;
  semanticRole?: TelegramButtonSemanticRole;
}

export type TelegramButtonSemanticRole = 'primary' | 'secondary' | 'success' | 'danger' | 'navigation' | 'help';

export interface TelegramButtonAppearance {
  style?: 'primary' | 'success' | 'danger';
  iconCustomEmojiId?: string;
}

export type TelegramButtonAppearanceConfig = RuntimeConfig['telegram']['buttonAppearance'];

export interface TelegramReplyButton {
  text: string;
  semanticRole?: TelegramButtonSemanticRole;
  requestChat?: {
    requestId: number;
    chatIsChannel: boolean;
    chatIsForum?: boolean;
    botIsMember?: boolean;
    userAdministratorRights?: TelegramChatAdministratorRights;
    botAdministratorRights?: TelegramChatAdministratorRights;
  };
}

export type TelegramReplyKeyboardButton = string | TelegramReplyButton;

export interface TelegramChatAdministratorRights {
  isAnonymous?: boolean;
  canManageChat?: boolean;
  canDeleteMessages?: boolean;
  canManageVideoChats?: boolean;
  canRestrictMembers?: boolean;
  canPromoteMembers?: boolean;
  canChangeInfo?: boolean;
  canInviteUsers?: boolean;
  canPostStories?: boolean;
  canEditStories?: boolean;
  canDeleteStories?: boolean;
  canPostMessages?: boolean;
  canEditMessages?: boolean;
  canPinMessages?: boolean;
  canManageTopics?: boolean;
}

export interface TelegramReplyOptions {
  inlineKeyboard?: TelegramInlineButton[][];
  replyKeyboard?: TelegramReplyKeyboardButton[][];
  resizeKeyboard?: boolean;
  persistentKeyboard?: boolean;
  parseMode?: 'HTML';
  messageThreadId?: number;
}

export interface TelegramSentMessage {
  messageId: number;
}

export interface TelegramRuntime {
  bot: Pick<RuntimeConfig['bot'], 'clubName' | 'publicName' | 'language'> & {
    username?: string | undefined;
    getMe?(): Promise<{ id: number; username?: string }>;
    getChat?(chatId: number): Promise<{ id: number; type: string; title?: string; isForum?: boolean }>;
    getChatMember?(chatId: number, userId: number): Promise<{ status: string; canManageTopics?: boolean }>;
    createForumTopic?(input: { chatId: number; name: string }): Promise<{ chatId: number; name: string; messageThreadId: number }>;
    sendPrivateMessage(telegramUserId: number, message: string, options?: TelegramReplyOptions): Promise<void>;
    sendGroupMessage?(chatId: number, message: string, options?: TelegramReplyOptions): Promise<TelegramSentMessage | void>;
    copyMessage?(input: { fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }): Promise<{ messageId: number }>;
    forwardMessage?(input: { fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }): Promise<{ messageId: number }>;
    sendMediaGroup?(input: { chatId: number; media: TelegramPhotoMediaInput[]; messageThreadId?: number }): Promise<Array<{ messageId: number }>>;
    sendAnimation?(input: { chatId: number; animationFileId: string; caption?: string; messageThreadId?: number; options?: TelegramReplyOptions }): Promise<void>;
    sendDocument?(input: { chatId: number; filePath: string; caption?: string }): Promise<void>;
    downloadFile?(input: { fileId: string; destinationPath: string }): Promise<void>;
    editMessageText?(input: { chatId: number; messageId: number; text: string; options?: TelegramReplyOptions }): Promise<void>;
    deleteMessage?(input: { chatId: number; messageId: number }): Promise<void>;
  };
  services: InfrastructureRuntimeServices;
  wikipediaBoardGameImportService: ReturnType<typeof createWikipediaBoardGameImportService>;
  boardGameGeekCollectionImportService: ReturnType<typeof createBoardGameGeekCollectionImportService>;
  descriptionTranslator?: CatalogDescriptionTranslator;
  llmCommands?: ResolvedLlmCommandConfig;
  llmCommandService?: LlmCommandService;
  llmCommandMetrics?: LlmCommandMetrics;
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
  onMessage?(handler: TelegramCommandHandler): void;
  getMe?(): Promise<{ id: number; username?: string }>;
  getChat?(chatId: number): Promise<{ id: number; type: string; title?: string; isForum?: boolean }>;
  getChatMember?(chatId: number, userId: number): Promise<{ status: string; canManageTopics?: boolean }>;
  createForumTopic?(input: { chatId: number; name: string }): Promise<{ chatId: number; name: string; messageThreadId: number }>;
  sendPrivateMessage(telegramUserId: number, message: string, options?: TelegramReplyOptions): Promise<void>;
  sendGroupMessage?(chatId: number, message: string, options?: TelegramReplyOptions): Promise<TelegramSentMessage | void>;
  copyMessage?(input: { fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }): Promise<{ messageId: number }>;
  forwardMessage?(input: { fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }): Promise<{ messageId: number }>;
  sendMediaGroup?(input: { chatId: number; media: TelegramPhotoMediaInput[]; messageThreadId?: number }): Promise<Array<{ messageId: number }>>;
  sendAnimation?(input: { chatId: number; animationFileId: string; caption?: string; messageThreadId?: number; options?: TelegramReplyOptions }): Promise<void>;
  sendDocument?(input: { chatId: number; filePath: string; caption?: string }): Promise<void>;
  downloadFile?(input: { fileId: string; destinationPath: string }): Promise<void>;
  editMessageText?(input: { chatId: number; messageId: number; text: string; options?: TelegramReplyOptions }): Promise<void>;
  deleteMessage?(input: { chatId: number; messageId: number }): Promise<void>;
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
  buttonAppearance?: TelegramButtonAppearanceConfig;
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
      buttonAppearance: config.telegram.buttonAppearance,
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
      sendPrivateMessage: bot.sendPrivateMessage.bind(bot),
      ...(bot.sendGroupMessage ? { sendGroupMessage: bot.sendGroupMessage.bind(bot) } : {}),
      ...(bot.copyMessage ? { copyMessage: bot.copyMessage.bind(bot) } : {}),
      ...(bot.forwardMessage ? { forwardMessage: bot.forwardMessage.bind(bot) } : {}),
      ...(bot.deleteMessage ? { deleteMessage: bot.deleteMessage.bind(bot) } : {}),
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
  buttonAppearance,
  onFatalRuntimeError,
}: CreateTelegramBotOptions): TelegramBotLike {
  const bot = new Bot<Context & TelegramContextLike>(token);
  let pollingPromise: Promise<void> | undefined;
  let isStopping = false;
  let botUsername: string | undefined;
  const apiHealth = createTelegramApiHealthMonitor();
  const retryOptions = (operation: string) => ({
    operation,
    logger,
    onRetryableFailure: ({ error }: { error: unknown }) => {
      apiHealth.recordFailure(operation, error);
    },
    onSuccess: () => {
      apiHealth.recordSuccess(operation);
    },
  });

  return {
    get username() {
      return botUsername;
    },
    use(middleware) {
      bot.use(async (context, next) => middleware(context, next));
    },
    onCommand(command, handler) {
      const handleCommand = async (context: Context & TelegramContextLike): Promise<void> => {
        if (!context.runtime?.chat) {
          throw new Error('Telegram command received before chat context resolution');
        }

        context.messageText = context.msg?.text ?? context.message?.text;
        context.messageEntities = extractTelegramMessageEntities(context.msg ?? context.message);
        context.messageId = resolveTelegramMessageId(context.msg ?? context.message);
        context.isForwardedMessage = resolveTelegramForwardedMessage(context.msg ?? context.message);
        context.messageThreadId = resolveMessageThreadId(context.msg ?? context.message);
        context.replyToBotMessageContext = resolveReplyToBotMessageContext(context.msg ?? context.message, botUsername) ?? undefined;
        context.replyToBotMessage = Boolean(context.replyToBotMessageContext);

        await handler(createTelegramCommandContext(context, buttonAppearance, logger, apiHealth));
      };

      bot.command(command, async (context) => {
        await handleCommand(context);
      });
      bot.on('message:text', async (context, next) => {
        const messageText = context.msg?.text ?? context.message?.text;
        if (!isTelegramRawCommandMatch(messageText, command, botUsername)) {
          await next();
          return;
        }

        logger.info(
          {
            command,
            textPreview: messageText ? messageText.slice(0, 120) : undefined,
          },
          'Telegram raw command fallback matched',
        );
        await handleCommand(context);
      });
    },
    onCallback(callbackPrefix, handler) {
      bot.callbackQuery(new RegExp(`^${escapeRegExp(callbackPrefix)}(.+)?$`), async (context) => {
        if (!context.runtime?.chat) {
          throw new Error('Telegram callback received before chat context resolution');
        }

        context.callbackData = context.callbackQuery.data;
        context.messageThreadId = resolveMessageThreadId(context.callbackQuery.message);
        await runTelegramCallbackHandler({
          handle: () => handler(createTelegramCommandContext(context, buttonAppearance, logger, apiHealth)),
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
        context.messageEntities = extractTelegramMessageEntities(context.msg ?? context.message);
        context.messageId = resolveTelegramMessageId(context.msg ?? context.message);
        context.isForwardedMessage = resolveTelegramForwardedMessage(context.msg ?? context.message);
        context.messageThreadId = resolveMessageThreadId(context.msg ?? context.message);
        context.replyToBotMessageContext = resolveReplyToBotMessageContext(context.msg ?? context.message, botUsername) ?? undefined;
        context.replyToBotMessage = Boolean(context.replyToBotMessageContext);
        if (!context.messageText || (context.messageText.startsWith('/') && !isTelegramInternalTextCommand(context.messageText))) {
          return;
        }

        await handler(createTelegramCommandContext(context, buttonAppearance, logger, apiHealth));
      });
    },
    onMessage(handler) {
      bot.on('message', async (context) => {
        if (!context.runtime?.chat) {
          throw new Error('Telegram message received before chat context resolution');
        }

        context.messageText = context.msg?.text ?? context.message?.text;
        context.messageEntities = extractTelegramMessageEntities(context.msg ?? context.message);
        context.messageId = resolveTelegramMessageId(context.msg ?? context.message);
        context.isForwardedMessage = resolveTelegramForwardedMessage(context.msg ?? context.message);
        context.messageThreadId = resolveMessageThreadId(context.msg ?? context.message);
        context.replyToBotMessageContext = resolveReplyToBotMessageContext(context.msg ?? context.message, botUsername) ?? undefined;
        context.replyToBotMessage = Boolean(context.replyToBotMessageContext);
        context.messageMedia = extractTelegramMessageMedia(context.msg ?? context.message);
        context.sharedChat = extractTelegramSharedChat(context.msg ?? context.message);
        context.newChatMembers = extractTelegramNewChatMembers(context.msg ?? context.message);

        await handler(createTelegramCommandContext(context, buttonAppearance, logger, apiHealth));
      });
    },
    async getMe() {
      const me = await bot.api.raw.getMe();
      return {
        id: Number((me as { id: number }).id),
        ...(typeof (me as { username?: string }).username === 'string'
          ? { username: (me as { username?: string }).username }
          : {}),
      };
    },
    async getChat(chatId) {
      const chat = await bot.api.raw.getChat({ chat_id: chatId });
      const rawChat = chat as { id: number; type: string; title?: string; is_forum?: boolean };
      return {
        id: Number(rawChat.id),
        type: rawChat.type,
        ...(rawChat.title !== undefined ? { title: rawChat.title } : {}),
        ...(rawChat.is_forum !== undefined ? { isForum: rawChat.is_forum } : {}),
      };
    },
    async getChatMember(chatId, userId) {
      const member = await bot.api.raw.getChatMember({ chat_id: chatId, user_id: userId });
      const rawMember = member as { status: string; can_manage_topics?: boolean };
      return {
        status: rawMember.status,
        ...(rawMember.can_manage_topics !== undefined ? { canManageTopics: rawMember.can_manage_topics } : {}),
      };
    },
    async createForumTopic({ chatId, name }) {
      const topic = await bot.api.raw.createForumTopic({ chat_id: chatId, name });
      const rawTopic = topic as { name: string; message_thread_id: number };
      return {
        chatId,
        name: rawTopic.name,
        messageThreadId: Number(rawTopic.message_thread_id),
      };
    },
    async sendPrivateMessage(telegramUserId, message, options) {
      await withTelegramApiRetry(retryOptions('sendPrivateMessage'), () =>
        bot.api.sendMessage(telegramUserId, apiHealth.appendWarning(message), options ? toGrammyReplyOptions(options, buttonAppearance) : undefined),
      );
    },
    async sendGroupMessage(chatId, message, options) {
      const result = await withTelegramApiRetry(retryOptions('sendGroupMessage'), () =>
        bot.api.sendMessage(chatId, message, options ? toGrammyReplyOptions(options, buttonAppearance) : undefined),
      );
      const messageId = resolveTelegramMessageId(result);
      return messageId ? { messageId } : undefined;
    },
    async copyMessage({ fromChatId, messageId, toChatId, messageThreadId }) {
      const result = await withTelegramApiRetry(retryOptions('copyMessage'), () =>
        bot.api.raw.copyMessage({
          from_chat_id: fromChatId,
          message_id: messageId,
          chat_id: toChatId,
          ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
        }),
      );
      return {
        messageId: Number((result as { message_id: number }).message_id),
      };
    },
    async forwardMessage({ fromChatId, messageId, toChatId, messageThreadId }) {
      const result = await withTelegramApiRetry(retryOptions('forwardMessage'), () =>
        bot.api.raw.forwardMessage({
          from_chat_id: fromChatId,
          message_id: messageId,
          chat_id: toChatId,
          ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
        }),
      );
      return {
        messageId: Number((result as { message_id: number }).message_id),
      };
    },
    async sendMediaGroup({ chatId, media, messageThreadId }) {
      const singlePhoto = media.length === 1 ? media[0] : undefined;
      if (singlePhoto) {
        const result = await withTelegramApiRetry(retryOptions('sendPhoto'), () =>
          bot.api.sendPhoto(
            chatId,
            toGrammyPhotoSource(singlePhoto.media),
            {
              ...(singlePhoto.caption ? { caption: singlePhoto.caption } : {}),
              ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
            },
          ),
        );
        return [{ messageId: Number((result as { message_id: number }).message_id) }];
      }

      const result = await withTelegramApiRetry(retryOptions('sendMediaGroup'), () =>
        bot.api.sendMediaGroup(
          chatId,
          media.map(toGrammyPhotoMedia),
          messageThreadId ? { message_thread_id: messageThreadId } : undefined,
        ),
      );
      return (result as Array<{ message_id: number }>).map((message) => ({ messageId: Number(message.message_id) }));
    },
    async sendAnimation({ chatId, animationFileId, caption, messageThreadId, options }) {
      await withTelegramApiRetry(retryOptions('sendAnimation'), () =>
        bot.api.raw.sendAnimation({
          chat_id: chatId,
          animation: animationFileId,
          ...(caption ? { caption } : {}),
          ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
          ...(options ? toGrammyReplyOptions(options, buttonAppearance) : {}),
        }),
      );
    },
    async sendDocument({ chatId, filePath, caption }) {
      await withTelegramApiRetry(retryOptions('sendDocument'), () =>
        bot.api.sendDocument(chatId, new InputFile(filePath), caption ? { caption } : undefined),
      );
    },
    async downloadFile({ fileId, destinationPath }) {
      const file = await withTelegramApiRetry(retryOptions('getFile'), () =>
        bot.api.raw.getFile({ file_id: fileId }),
      ) as { file_path?: string };
      if (!file.file_path) {
        throw new Error('Telegram did not return a downloadable file path');
      }

      const response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
      if (!response.ok) {
        throw new Error(`Telegram file download failed with status ${response.status}`);
      }

      await mkdir(dirname(destinationPath), { recursive: true });
      await writeFile(destinationPath, Buffer.from(await response.arrayBuffer()));
    },
    async editMessageText({ chatId, messageId, text, options }) {
      await withTelegramApiRetry(retryOptions('editMessageText'), () =>
        bot.api.raw.editMessageText({
          chat_id: chatId,
          message_id: messageId,
          text,
          ...(options ? toGrammyReplyOptions(options, buttonAppearance) : {}),
        }),
      );
    },
    async deleteMessage({ chatId, messageId }) {
      await withTelegramApiRetry(retryOptions('deleteMessage'), () =>
        bot.api.raw.deleteMessage({
          chat_id: chatId,
          message_id: messageId,
        }),
      );
    },
    async startPolling() {
      await bot.init();

      isStopping = false;
      pollingPromise = bot.start({
        allowed_updates: ['message', 'callback_query'],
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
      try {
        bot.stop();
      } catch (error) {
        apiHealth.recordFailure('stopPolling', error);
        logger.error(
          { error: sanitizeTelegramErrorMessage(error) },
          'Telegram bot stop request failed during shutdown',
        );
      }

      try {
        await pollingPromise;
      } catch (error) {
        apiHealth.recordFailure('stopPolling', error);
        logger.error(
          { error: sanitizeTelegramErrorMessage(error) },
          'Telegram polling failed while shutting down',
        );
      }
    },
  };
}

function sanitizeTelegramErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot<redacted>');
}

function toGrammyPhotoSource(input: TelegramPhotoMediaInput['media']): string | InputFile {
  return typeof input === 'string' ? input : new InputFile(input.filePath);
}

function toGrammyPhotoMedia(input: TelegramPhotoMediaInput): {
  type: 'photo';
  media: string | InputFile;
  caption?: string;
} {
  return {
    type: 'photo',
    media: toGrammyPhotoSource(input.media),
    ...(input.caption ? { caption: input.caption } : {}),
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
    await acknowledge();
  } catch {
    // A stale Telegram callback query should not block the actual action.
  }
  await handle();
}

export function isTelegramRawCommandMatch(
  messageText: string | undefined,
  command: string,
  botUsername: string | undefined,
): boolean {
  const match = /^\/([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?(?=\s|$)/.exec(messageText?.trim() ?? '');
  if (!match || match[1] !== command) {
    return false;
  }

  const targetUsername = match[2];
  return !targetUsername || (botUsername !== undefined && targetUsername.toLowerCase() === botUsername.toLowerCase());
}

export function isTelegramInternalTextCommand(messageText: string): boolean {
  return /^(?:\/catalog_admin_letters_[A-Za-z0-9_-]+|\/cat_[A-Za-z0-9_-]+|\/update_bgg)(?:@[A-Za-z0-9_]+)?$/.test(messageText.trim());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveMessageThreadId(message: unknown): number | undefined {
  if (!message || typeof message !== 'object') {
    return undefined;
  }

  const maybeMessage = message as Record<string, unknown>;
  const candidate = maybeMessage.message_thread_id ?? maybeMessage.messageThreadId;
  return typeof candidate === 'number' ? candidate : undefined;
}

function resolveReplyToBotMessageContext(
  message: unknown,
  botUsername: string | undefined,
): { messageId?: number; text?: string } | null {
  if (!message || typeof message !== 'object' || !botUsername) {
    return null;
  }

  const maybeMessage = message as Record<string, unknown>;
  const replyToMessage = maybeMessage.reply_to_message ?? maybeMessage.replyToMessage;
  if (!replyToMessage || typeof replyToMessage !== 'object') {
    return null;
  }

  const replyRecord = replyToMessage as Record<string, unknown>;
  const from = replyRecord.from;
  if (!from || typeof from !== 'object') {
    return null;
  }

  const username = (from as Record<string, unknown>).username;
  if (typeof username !== 'string' || username.toLowerCase() !== botUsername.toLowerCase()) {
    return null;
  }

  const text = firstNonEmptyString(replyRecord.text, replyRecord.caption);
  const messageId = resolveTelegramMessageId(replyToMessage);
  return {
    ...(messageId !== undefined ? { messageId } : {}),
    ...(text ? { text: truncateReplyContextText(text) } : {}),
  };
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function truncateReplyContextText(value: string): string {
  return value.length > 1200 ? `${value.slice(0, 1197)}...` : value;
}

function resolveTelegramMessageId(message: unknown): number | undefined {
  if (!message || typeof message !== 'object') {
    return undefined;
  }
  const candidate = (message as Record<string, unknown>).message_id ?? (message as Record<string, unknown>).messageId;
  return typeof candidate === 'number' ? candidate : undefined;
}

function resolveTelegramForwardedMessage(message: unknown): boolean {
  if (!message || typeof message !== 'object') {
    return false;
  }
  const maybeMessage = message as Record<string, unknown>;
  return (
    maybeMessage.forward_origin !== undefined ||
    maybeMessage.forwardOrigin !== undefined ||
    maybeMessage.forward_from !== undefined ||
    maybeMessage.forwardFrom !== undefined ||
    maybeMessage.forward_sender_name !== undefined ||
    maybeMessage.forwardSenderName !== undefined ||
    maybeMessage.forward_from_chat !== undefined ||
    maybeMessage.forwardFromChat !== undefined
  );
}

function extractTelegramMessageEntities(message: unknown): TelegramMessageEntity[] | undefined {
  if (!message || typeof message !== 'object') {
    return undefined;
  }

  const rawEntities = (message as Record<string, unknown>).entities;
  if (!Array.isArray(rawEntities)) {
    return undefined;
  }

  const entities = rawEntities
    .filter((entity): entity is Record<string, unknown> => typeof entity === 'object' && entity !== null)
    .map((entity) => ({
      type: String(entity.type ?? ''),
      offset: Number(entity.offset),
      length: Number(entity.length),
      ...(typeof entity.url === 'string' ? { url: entity.url } : {}),
      ...(typeof entity.language === 'string' ? { language: entity.language } : {}),
    }))
    .filter((entity) => entity.type.length > 0 && Number.isInteger(entity.offset) && entity.offset >= 0 && Number.isInteger(entity.length) && entity.length > 0);

  return entities.length > 0 ? entities : undefined;
}

function extractTelegramMessageMedia(message: unknown): TelegramContextLike['messageMedia'] {
  if (!message || typeof message !== 'object') {
    return undefined;
  }

  const maybeMessage = message as Record<string, unknown>;
  const messageId = maybeMessage.message_id ?? maybeMessage.messageId;
  if (typeof messageId !== 'number') {
    return undefined;
  }

  if (maybeMessage.animation && typeof maybeMessage.animation === 'object') {
    const animation = maybeMessage.animation as Record<string, unknown>;
    return {
      attachmentKind: 'animation',
      fileId: asOptionalString(animation.file_id ?? animation.fileId),
      fileUniqueId: asOptionalString(animation.file_unique_id ?? animation.fileUniqueId),
      caption: asOptionalString(maybeMessage.caption),
      originalFileName: asOptionalString(animation.file_name ?? animation.fileName),
      mimeType: asOptionalString(animation.mime_type ?? animation.mimeType),
      fileSizeBytes: asOptionalNumber(animation.file_size ?? animation.fileSize),
      mediaGroupId: asOptionalString(maybeMessage.media_group_id ?? maybeMessage.mediaGroupId),
      messageId,
    };
  }

  if (maybeMessage.document && typeof maybeMessage.document === 'object') {
    const document = maybeMessage.document as Record<string, unknown>;
    return {
      attachmentKind: 'document',
      fileId: asOptionalString(document.file_id ?? document.fileId),
      fileUniqueId: asOptionalString(document.file_unique_id ?? document.fileUniqueId),
      caption: asOptionalString(maybeMessage.caption),
      originalFileName: asOptionalString(document.file_name ?? document.fileName),
      mimeType: asOptionalString(document.mime_type ?? document.mimeType),
      fileSizeBytes: asOptionalNumber(document.file_size ?? document.fileSize),
      mediaGroupId: asOptionalString(maybeMessage.media_group_id ?? maybeMessage.mediaGroupId),
      messageId,
    };
  }

  if (Array.isArray(maybeMessage.photo) && maybeMessage.photo.length > 0) {
    const photo = maybeMessage.photo[maybeMessage.photo.length - 1] as Record<string, unknown>;
    return {
      attachmentKind: 'photo',
      fileId: asOptionalString(photo.file_id ?? photo.fileId),
      fileUniqueId: asOptionalString(photo.file_unique_id ?? photo.fileUniqueId),
      caption: asOptionalString(maybeMessage.caption),
      originalFileName: null,
      mimeType: null,
      fileSizeBytes: asOptionalNumber(photo.file_size ?? photo.fileSize),
      mediaGroupId: asOptionalString(maybeMessage.media_group_id ?? maybeMessage.mediaGroupId),
      messageId,
    };
  }

  if (maybeMessage.video && typeof maybeMessage.video === 'object') {
    const video = maybeMessage.video as Record<string, unknown>;
    return {
      attachmentKind: 'video',
      fileId: asOptionalString(video.file_id ?? video.fileId),
      fileUniqueId: asOptionalString(video.file_unique_id ?? video.fileUniqueId),
      caption: asOptionalString(maybeMessage.caption),
      originalFileName: asOptionalString(video.file_name ?? video.fileName),
      mimeType: asOptionalString(video.mime_type ?? video.mimeType),
      fileSizeBytes: asOptionalNumber(video.file_size ?? video.fileSize),
      mediaGroupId: asOptionalString(maybeMessage.media_group_id ?? maybeMessage.mediaGroupId),
      messageId,
    };
  }

  if (maybeMessage.audio && typeof maybeMessage.audio === 'object') {
    const audio = maybeMessage.audio as Record<string, unknown>;
    return {
      attachmentKind: 'audio',
      fileId: asOptionalString(audio.file_id ?? audio.fileId),
      fileUniqueId: asOptionalString(audio.file_unique_id ?? audio.fileUniqueId),
      caption: asOptionalString(maybeMessage.caption),
      originalFileName: asOptionalString(audio.file_name ?? audio.fileName),
      mimeType: asOptionalString(audio.mime_type ?? audio.mimeType),
      fileSizeBytes: asOptionalNumber(audio.file_size ?? audio.fileSize),
      mediaGroupId: asOptionalString(maybeMessage.media_group_id ?? maybeMessage.mediaGroupId),
      messageId,
    };
  }

  return undefined;
}

function extractTelegramNewChatMembers(message: unknown): TelegramContextLike['newChatMembers'] {
  if (!message || typeof message !== 'object') {
    return undefined;
  }

  const members = (message as Record<string, unknown>).new_chat_members;
  if (!Array.isArray(members)) {
    return undefined;
  }

  return members
    .filter((member): member is Record<string, unknown> => typeof member === 'object' && member !== null)
    .map((member) => ({
      id: Number(member.id),
      ...(typeof member.username === 'string' ? { username: member.username } : {}),
      ...(typeof member.first_name === 'string' ? { first_name: member.first_name } : {}),
      ...(typeof member.last_name === 'string' ? { last_name: member.last_name } : {}),
      ...(typeof member.is_bot === 'boolean' ? { is_bot: member.is_bot } : {}),
    }))
    .filter((member) => Number.isFinite(member.id));
}

function extractTelegramSharedChat(message: unknown): TelegramContextLike['sharedChat'] {
  if (!message || typeof message !== 'object') {
    return undefined;
  }

  const maybeMessage = message as Record<string, unknown>;
  if (!maybeMessage.chat_shared || typeof maybeMessage.chat_shared !== 'object') {
    return undefined;
  }

  const shared = maybeMessage.chat_shared as Record<string, unknown>;
  const requestId = shared.request_id ?? shared.requestId;
  const chatId = shared.chat_id ?? shared.chatId;
  if (typeof requestId !== 'number' || typeof chatId !== 'number') {
    return undefined;
  }

  return {
    requestId,
    chatId,
    title: asOptionalString(shared.title),
  };
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function createTelegramCommandContext(
  context: TelegramContextLike & {
    reply(message: string, options?: Record<string, unknown>): Promise<unknown>;
  },
  buttonAppearance?: TelegramButtonAppearanceConfig,
  logger?: TelegramLogger,
  apiHealth?: TelegramApiHealthMonitor,
): TelegramCommandHandlerContext {
  return {
    ...context,
    ...(context.from ? { from: context.from } : {}),
    async reply(message: string, options?: TelegramReplyOptions) {
      const messageWithHealthWarning = apiHealth
        ? apiHealth.appendWarning(message, { enabled: context.chat?.type === 'private' })
        : message;
      const result = await withTelegramApiRetry({
        operation: 'reply',
        ...(logger ? { logger } : {}),
        ...(apiHealth
          ? {
              onRetryableFailure: ({ error }: { error: unknown }) => {
                apiHealth.recordFailure('reply', error);
              },
              onSuccess: () => {
                apiHealth.recordSuccess('reply');
              },
            }
          : {}),
      }, () =>
        context.reply(messageWithHealthWarning, toGrammyReplyOptions(options, buttonAppearance)),
      );
      logger?.info(
        {
          operation: 'reply',
          chatId: context.chat?.id,
          messageLength: messageWithHealthWarning.length,
          healthWarningAppended: messageWithHealthWarning !== message,
        },
        'Telegram reply sent',
      );
      return result;
    },
  } as unknown as TelegramCommandHandlerContext;
}
