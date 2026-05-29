export type TelegramChatType = 'private' | 'group' | 'supergroup' | 'channel';

export interface TelegramChatLike {
  id: number;
  type: TelegramChatType;
  title?: string | undefined;
  username?: string | undefined;
}

export type TelegramChatContextKind = 'private' | 'group' | 'group-news';

export interface TelegramChatContext {
  kind: TelegramChatContextKind;
  chatId: number;
  chatTitle?: string | undefined;
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
      ...(resolveChatTitle(chat) ? { chatTitle: resolveChatTitle(chat) } : {}),
    };
  }

  if (chat.type === 'group' || chat.type === 'supergroup') {
    const newsEnabled = await isNewsEnabledGroup({ chatId: chat.id });

    return {
      kind: newsEnabled ? 'group-news' : 'group',
      chatId: chat.id,
      ...(resolveChatTitle(chat) ? { chatTitle: resolveChatTitle(chat) } : {}),
    };
  }

  throw new Error(`Unsupported Telegram chat type: ${chat.type}`);
}

function resolveChatTitle(chat: TelegramChatLike): string | undefined {
  const title = chat.title?.trim();
  if (title) {
    return title;
  }

  const username = chat.username?.trim();
  return username ? `@${username}` : undefined;
}
