import type { Api } from 'grammy';
import type { InputRichMessageWithoutUpload } from 'grammy/types';
import type { TelegramReplyOptions, TelegramSentMessage } from './runtime-boundary.js';
import { isTelegramRichMessageWithinLimits } from './rich-message-limits.js';

/** No direct file uploads: rich drafts and durable messages share this contract. */
export type TelegramRichMessage = InputRichMessageWithoutUpload;

export interface TelegramRichMessageInput {
  chatId: number;
  richMessage: TelegramRichMessage;
  fallbackText: string;
  options?: TelegramReplyOptions;
  messageThreadId?: number;
}

export interface TelegramMessageDraftInput {
  chatId: number;
  draftId: number;
  text: string;
  messageThreadId?: number;
  parseMode?: 'HTML';
  canStop?: boolean;
  keepOnStop?: boolean;
}

export interface TelegramRichMessageDraftInput extends Omit<TelegramMessageDraftInput, 'text'> {
  richMessage: TelegramRichMessage;
  fallbackText: string;
}

export interface TelegramMessageGenerationStopped {
  chatId: number;
  userId: number;
  draftId: number;
  messageThreadId?: number;
}

export interface TelegramRichMessageTransport {
  sendRichMessage(input: TelegramRichMessageInput): Promise<TelegramSentMessage | void>;
  editRichMessage(input: TelegramRichMessageInput & { messageId: number }): Promise<void>;
  /** False means that drafts are unsupported; callers must use editable progress. */
  sendMessageDraft(input: TelegramMessageDraftInput): Promise<boolean>;
  sendRichMessageDraft(input: TelegramRichMessageDraftInput): Promise<boolean>;
}

type RichApi = Pick<Api['raw'], 'sendRichMessage' | 'sendMessageDraft' | 'sendRichMessageDraft' | 'editMessageText'>;

export function createTelegramRichMessageTransport(input: {
  api: RichApi;
  call<T>(operation: string, action: () => Promise<T>): Promise<T>;
  replyOptions(options?: TelegramReplyOptions): Record<string, unknown> | undefined;
  sanitizeDraft(text: string, parseMode?: 'HTML'): string;
  sendFallback(input: { chatId: number; text: string; options?: TelegramReplyOptions }): Promise<TelegramSentMessage | void>;
  editFallback(input: { chatId: number; messageId: number; text: string; options?: TelegramReplyOptions }): Promise<void>;
  onUnsupported?(operation: string, chatId: number): void;
}): TelegramRichMessageTransport {
  const unsupported = new Set<string>();
  const attempt = async <T>(operation: string, chatId: number, action: () => Promise<T>): Promise<{ supported: true; result: T } | { supported: false }> => {
    const key = `${operation}:${chatId}`;
    if (unsupported.has(key)) return { supported: false };
    try {
      return { supported: true, result: await input.call(operation, action) };
    } catch (error) {
      if (!isUnsupportedTelegramFeatureError(error, operation)) throw error;
      unsupported.add(key);
      input.onUnsupported?.(operation, chatId);
      return { supported: false };
    }
  };

  const transport: TelegramRichMessageTransport = {
    async sendRichMessage(message) {
      validateRichMessage(message.richMessage);
      const options = withThread(message);
      if (!isTelegramRichMessageWithinLimits(message.richMessage)) {
        return input.sendFallback({ chatId: message.chatId, text: message.fallbackText, ...(options ? { options } : {}) });
      }
      const result = await attempt('sendRichMessage', message.chatId, () => input.api.sendRichMessage({
        chat_id: message.chatId,
        ...richReplyOptions(input.replyOptions(options)),
        rich_message: message.richMessage,
      }));
      return result.supported
        ? { messageId: result.result.message_id }
        : input.sendFallback({ chatId: message.chatId, text: message.fallbackText, ...(options ? { options } : {}) });
    },
    async editRichMessage(message) {
      validateRichMessage(message.richMessage);
      // editMessageText accepts inline keyboards only, and does not accept a topic ID.
      const { replyKeyboard: _keyboard, messageThreadId: _thread, ...options } = message.options ?? {};
      if (!isTelegramRichMessageWithinLimits(message.richMessage)) {
        return input.editFallback({ chatId: message.chatId, messageId: message.messageId, text: message.fallbackText, options });
      }
      const result = await attempt('editRichMessage', message.chatId, () => input.api.editMessageText({
        chat_id: message.chatId,
        message_id: message.messageId,
        ...richReplyOptions(input.replyOptions(options)),
        rich_message: message.richMessage,
      }));
      if (!result.supported) await input.editFallback({ chatId: message.chatId, messageId: message.messageId, text: message.fallbackText, options });
    },
    async sendMessageDraft(message) {
      validateDraft(message);
      const result = await attempt('sendMessageDraft', message.chatId, () => input.api.sendMessageDraft({
        ...draftParameters(message),
        text: message.text ? input.sanitizeDraft(message.text, message.parseMode) : '',
        ...(message.parseMode ? { parse_mode: message.parseMode } : {}),
      }));
      return result.supported;
    },
    async sendRichMessageDraft(message) {
      validateDraft(message);
      validateRichMessage(message.richMessage);
      if (!isTelegramRichMessageWithinLimits(message.richMessage)) return transport.sendMessageDraft({ ...message, text: message.fallbackText });
      const result = await attempt('sendRichMessageDraft', message.chatId, () => input.api.sendRichMessageDraft({
        ...draftParameters(message),
        rich_message: message.richMessage,
      }));
      return result.supported || transport.sendMessageDraft({ ...message, text: message.fallbackText });
    },
  };
  return transport;
}

function withThread(input: TelegramRichMessageInput): TelegramReplyOptions | undefined {
  return input.messageThreadId !== undefined
    ? { ...input.options, messageThreadId: input.messageThreadId }
    : input.options;
}

function richReplyOptions(options?: Record<string, unknown>): Record<string, unknown> {
  const { parse_mode: _parseMode, ...richOptions } = options ?? {};
  return richOptions;
}

function draftParameters(input: TelegramMessageDraftInput | TelegramRichMessageDraftInput) {
  return {
    chat_id: input.chatId,
    draft_id: input.draftId,
    ...(input.messageThreadId !== undefined ? { message_thread_id: input.messageThreadId } : {}),
    ...(input.canStop !== undefined ? { can_stop: input.canStop } : {}),
    ...(input.keepOnStop !== undefined ? { keep_on_stop: input.keepOnStop } : {}),
  };
}

function validateDraft(input: { draftId: number }): void {
  if (!Number.isSafeInteger(input.draftId) || input.draftId === 0) throw new Error('Telegram draft ID must be a non-zero safe integer');
}

function validateRichMessage(input: TelegramRichMessage): void {
  if ([input.html, input.markdown, input.blocks].filter((value) => value !== undefined).length !== 1) {
    throw new Error('Telegram rich messages require exactly one of html, markdown or blocks');
  }
}

export function isUnsupportedTelegramFeatureError(error: unknown, operation?: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const details = error as { error_code?: number; description?: string; message?: string };
  if (details.error_code !== 400 && details.error_code !== 404) return false;
  const description = details.description ?? details.message ?? '';
  // Old servers know editMessageText but require text instead of rich_message.
  if (operation === 'editRichMessage' && details.error_code === 400 && /message text is empty|text must be non-empty|(?:parameter|field) ["']?text["']? is required/i.test(description)) return true;
  return /unknown method|method (?:is )?not (?:found|supported)|(?:rich messages?|message drafts?|drafts?|rich_message|can_stop|keep_on_stop) (?:are |is )?(?:not supported|unsupported|not available)|unsupported (?:rich messages?|message drafts?|drafts?)/i.test(description);
}

export function resolveMessageGenerationStopped(update: unknown): TelegramMessageGenerationStopped | undefined {
  if (!update || typeof update !== 'object') return undefined;
  const event = (update as { stopped_message_generation?: { chat?: { id?: unknown; type?: unknown }; draft_id?: unknown; message_thread_id?: unknown } }).stopped_message_generation;
  if (event?.chat?.type !== 'private' || typeof event.chat.id !== 'number' || typeof event.draft_id !== 'number' || !Number.isSafeInteger(event.draft_id) || event.draft_id === 0) return undefined;
  // Telegram only delivers this update for private chats; their ID identifies the user.
  return {
    chatId: event.chat.id,
    userId: event.chat.id,
    draftId: event.draft_id,
    ...(typeof event.message_thread_id === 'number' ? { messageThreadId: event.message_thread_id } : {}),
  };
}
