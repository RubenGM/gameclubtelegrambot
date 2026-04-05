export const telegramBotUsername = 'cawatest_bot';

export function buildTelegramStartUrl(payload: string): string {
  return `https://t.me/${telegramBotUsername}?start=${payload}`;
}
