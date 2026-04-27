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
  messageThreadId?: number | undefined;
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
  };
}

export type TelegramReplyKeyboardButton = string | TelegramReplyButton;

export interface TelegramReplyOptions {
  inlineKeyboard?: TelegramInlineButton[][];
  replyKeyboard?: TelegramReplyKeyboardButton[][];
  resizeKeyboard?: boolean;
  persistentKeyboard?: boolean;
  parseMode?: 'HTML';
}

export interface TelegramRuntime {
  bot: Pick<RuntimeConfig['bot'], 'clubName' | 'publicName' | 'language'> & {
    username?: string | undefined;
    getMe?(): Promise<{ id: number; username?: string }>;
    getChat?(chatId: number): Promise<{ id: number; type: string; title?: string; isForum?: boolean }>;
    getChatMember?(chatId: number, userId: number): Promise<{ status: string; canManageTopics?: boolean }>;
    createForumTopic?(input: { chatId: number; name: string }): Promise<{ chatId: number; name: string; messageThreadId: number }>;
    sendPrivateMessage(telegramUserId: number, message: string, options?: TelegramReplyOptions): Promise<void>;
    sendGroupMessage?(chatId: number, message: string, options?: TelegramReplyOptions): Promise<void>;
    copyMessage?(input: { fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }): Promise<{ messageId: number }>;
    deleteMessage?(input: { chatId: number; messageId: number }): Promise<void>;
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
  onMessage?(handler: TelegramCommandHandler): void;
  getMe?(): Promise<{ id: number; username?: string }>;
  getChat?(chatId: number): Promise<{ id: number; type: string; title?: string; isForum?: boolean }>;
  getChatMember?(chatId: number, userId: number): Promise<{ status: string; canManageTopics?: boolean }>;
  createForumTopic?(input: { chatId: number; name: string }): Promise<{ chatId: number; name: string; messageThreadId: number }>;
  sendPrivateMessage(telegramUserId: number, message: string, options?: TelegramReplyOptions): Promise<void>;
  sendGroupMessage?(chatId: number, message: string, options?: TelegramReplyOptions): Promise<void>;
  copyMessage?(input: { fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }): Promise<{ messageId: number }>;
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

        await handler(createTelegramCommandContext(context, buttonAppearance));
      });
    },
    onCallback(callbackPrefix, handler) {
      bot.callbackQuery(new RegExp(`^${escapeRegExp(callbackPrefix)}(.+)?$`), async (context) => {
        if (!context.runtime?.chat) {
          throw new Error('Telegram callback received before chat context resolution');
        }

        context.callbackData = context.callbackQuery.data;
        await runTelegramCallbackHandler({
          handle: () => handler(createTelegramCommandContext(context, buttonAppearance)),
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

        await handler(createTelegramCommandContext(context, buttonAppearance));
      });
    },
    onMessage(handler) {
      bot.on('message', async (context) => {
        if (!context.runtime?.chat) {
          throw new Error('Telegram message received before chat context resolution');
        }

        context.messageText = context.msg?.text ?? context.message?.text;
        context.messageThreadId = resolveMessageThreadId(context.msg ?? context.message);
        context.messageMedia = extractTelegramMessageMedia(context.msg ?? context.message);
        context.sharedChat = extractTelegramSharedChat(context.msg ?? context.message);

        await handler(createTelegramCommandContext(context, buttonAppearance));
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
      await bot.api.sendMessage(telegramUserId, message, options ? toGrammyReplyOptions(options, buttonAppearance) : undefined);
    },
    async sendGroupMessage(chatId, message, options) {
      await bot.api.sendMessage(chatId, message, options ? toGrammyReplyOptions(options, buttonAppearance) : undefined);
    },
    async copyMessage({ fromChatId, messageId, toChatId, messageThreadId }) {
      const result = await bot.api.raw.copyMessage({
        from_chat_id: fromChatId,
        message_id: messageId,
        chat_id: toChatId,
        ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
      });
      return {
        messageId: Number((result as { message_id: number }).message_id),
      };
    },
    async deleteMessage({ chatId, messageId }) {
      await bot.api.raw.deleteMessage({
        chat_id: chatId,
        message_id: messageId,
      });
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

function resolveMessageThreadId(message: unknown): number | undefined {
  if (!message || typeof message !== 'object') {
    return undefined;
  }

  const maybeMessage = message as Record<string, unknown>;
  const candidate = maybeMessage.message_thread_id ?? maybeMessage.messageThreadId;
  return typeof candidate === 'number' ? candidate : undefined;
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
): TelegramCommandHandlerContext {
  return {
    ...context,
    reply(message: string, options?: TelegramReplyOptions) {
      return context.reply(message, toGrammyReplyOptions(options, buttonAppearance));
    },
  } as unknown as TelegramCommandHandlerContext;
}
