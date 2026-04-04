export type TelegramChatType = 'private' | 'group' | 'supergroup' | 'channel';

export interface TelegramChatLike {
  id: number;
  type: TelegramChatType;
}

export type TelegramChatContextKind = 'private' | 'group' | 'group-news';

export interface TelegramChatContext {
  kind: TelegramChatContextKind;
  chatId: number;
}

export interface ResolveTelegramChatContextOptions {
  chat?: TelegramChatLike;
  isNewsEnabledGroup?: (options: { chatId: number }) => Promise<boolean>;
}

export async function resolveTelegramChatContext({
  chat,
  isNewsEnabledGroup = async () => false,
}: ResolveTelegramChatContextOptions): Promise<TelegramChatContext> {
  if (!chat) {
    throw new Error('Telegram update does not include chat information');
  }

  if (chat.type === 'private') {
    return {
      kind: 'private',
      chatId: chat.id,
    };
  }

  if (chat.type === 'group' || chat.type === 'supergroup') {
    const newsEnabled = await isNewsEnabledGroup({ chatId: chat.id });

    return {
      kind: newsEnabled ? 'group-news' : 'group',
      chatId: chat.id,
    };
  }

  throw new Error(`Unsupported Telegram chat type: ${chat.type}`);
}
