import type { TelegramReplyOptions } from './runtime-boundary.js';

export async function replyWithCatalogAdminItemInspection({
  reply,
  detailsMessage,
  inlineKeyboard,
}: {
  reply: (message: string, options?: TelegramReplyOptions) => Promise<unknown>;
  detailsMessage: string;
  inlineKeyboard: NonNullable<TelegramReplyOptions['inlineKeyboard']>;
}): Promise<void> {
  await reply(detailsMessage, {
    parseMode: 'HTML',
    inlineKeyboard,
  });
}

export async function replyWithCatalogAdminGroupInspection({
  reply,
  detailsMessage,
  inlineKeyboard,
}: {
  reply: (message: string, options?: TelegramReplyOptions) => Promise<unknown>;
  detailsMessage: string;
  inlineKeyboard: NonNullable<TelegramReplyOptions['inlineKeyboard']>;
}): Promise<void> {
  await reply(detailsMessage, { inlineKeyboard });
}
