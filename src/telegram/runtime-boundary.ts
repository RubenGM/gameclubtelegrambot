export interface TelegramBoundaryStatus {
  bot: 'not-configured';
}

export function createTelegramBoundary(): TelegramBoundaryStatus {
  return {
    bot: 'not-configured',
  };
}
