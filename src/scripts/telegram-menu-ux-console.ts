import { loadRuntimeConfig, RuntimeConfigError } from '../config/load-runtime-config.js';
import { createTelegramMenuUxReportOperations } from '../operations/telegram-menu-ux-report.js';
import { TelegramMenuUxConsoleApp } from '../tui/telegram-menu-ux-console-app.js';
import { parseTelegramMenuUxArgs } from './telegram-menu-ux-args.js';

async function main(argv: string[]): Promise<void> {
  const args = parseTelegramMenuUxArgs(argv);
  const config = await loadRuntimeConfig();
  const app = new TelegramMenuUxConsoleApp({
    operations: createTelegramMenuUxReportOperations({ config }),
    windowDays: args.windowDays,
  });
  await app.run();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof RuntimeConfigError || error instanceof Error) {
      console.error(error.message);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
