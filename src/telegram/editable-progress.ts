import type { TelegramReplyOptions } from './runtime-boundary.js';

export interface TelegramEditableProgressContext {
  reply(message: string, options?: TelegramReplyOptions): Promise<unknown>;
  runtime?: {
    chat?: {
      chatId: number;
    };
    bot?: {
      editMessageText?(input: {
        chatId: number;
        messageId: number;
        text: string;
        options?: TelegramReplyOptions;
      }): Promise<void>;
    };
  };
}

export interface TelegramEditableProgressOptions {
  editFailedEvent: string;
}

export interface TelegramEditableProgress {
  messageId: number | null;
  update(message: string, options?: TelegramReplyOptions): Promise<boolean>;
  complete(message: string, options?: TelegramReplyOptions): Promise<void>;
}

export async function startTelegramEditableProgress(
  context: TelegramEditableProgressContext,
  message: string,
  options: TelegramEditableProgressOptions,
  replyOptions?: TelegramReplyOptions,
): Promise<TelegramEditableProgress> {
  const sent = await context.reply(message, replyOptions);
  const messageId = extractTelegramReplyMessageId(sent);
  return createTelegramEditableProgressForMessage(context, messageId, options);
}

export function resumeTelegramEditableProgress(
  context: TelegramEditableProgressContext,
  messageId: number,
  options: TelegramEditableProgressOptions,
): TelegramEditableProgress {
  return createTelegramEditableProgressForMessage(context, messageId, options);
}

function createTelegramEditableProgressForMessage(
  context: TelegramEditableProgressContext,
  messageId: number | null,
  options: TelegramEditableProgressOptions,
): TelegramEditableProgress {
  const chatId = context.runtime?.chat?.chatId;
  const editMessageText = context.runtime?.bot?.editMessageText;
  let canEdit = Boolean(messageId && chatId && editMessageText);

  const tryEdit = async (nextMessage: string, replyOptions?: TelegramReplyOptions): Promise<boolean> => {
    if (!canEdit || !messageId || !chatId || !editMessageText) {
      return false;
    }
    try {
      await editMessageText({
        chatId,
        messageId,
        text: nextMessage,
        ...(replyOptions ? { options: replyOptions } : {}),
      });
      return true;
    } catch (error) {
      canEdit = false;
      console.warn(JSON.stringify({
        event: options.editFailedEvent,
        error: error instanceof Error ? error.message : String(error),
      }));
      return false;
    }
  };

  return {
    messageId,
    update: async (nextMessage, replyOptions) => tryEdit(nextMessage, replyOptions),
    complete: async (nextMessage, replyOptions) => {
      if (!(await tryEdit(nextMessage, replyOptions))) {
        await context.reply(nextMessage, replyOptions);
      }
    },
  };
}

export function extractTelegramReplyMessageId(value: unknown): number | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = (value as Record<string, unknown>).message_id
    ?? (value as Record<string, unknown>).messageId;
  return typeof candidate === 'number' && Number.isInteger(candidate) ? candidate : null;
}
