const defaultTelegramBotUsername = 'cawa_management_bot';

let telegramBotUsername = defaultTelegramBotUsername;

export function configureTelegramDeepLinks({ botUsername }: { botUsername?: string | null | undefined }): void {
  const normalized = botUsername?.trim().replace(/^@/, '');
  if (!normalized) {
    return;
  }

  telegramBotUsername = normalized;
}

export function buildTelegramStartUrl(payload: string): string {
  return `https://t.me/${telegramBotUsername}?start=${payload}`;
}
