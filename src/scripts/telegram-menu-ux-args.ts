export interface TelegramMenuUxArgs {
  windowDays: number;
}

export function parseTelegramMenuUxArgs(argv: string[]): TelegramMenuUxArgs {
  let windowDays = 7;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === '--days') {
      const next = argv[index + 1];
      const parsed = Number(next);
      if (!next || !Number.isInteger(parsed) || parsed <= 0) {
        throw new Error('--days must be a positive integer');
      }
      windowDays = parsed;
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${current}`);
  }

  return { windowDays };
}
