import {
  createAppMetadataPrintingSettingsStore,
  type PrintingSettingsStore,
} from '../printing/print-settings.js';
import {
  createDatabasePrintJobHistoryRepository,
  type PrintJobHistoryRepository,
} from '../printing/print-job-history.js';
import { createPrintService, type PrintService } from '../printing/print-service.js';
import { createDatabaseAppMetadataSessionStorage } from './conversation-session-store.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

type PrinterAdminContext = TelegramCommandHandlerContext & {
  printSettingsStore?: PrintingSettingsStore | undefined;
  printJobHistory?: PrintJobHistoryRepository | undefined;
  printService?: Pick<PrintService, 'getPrinterStatus'> | undefined;
};

const defaultQueue = 'HP-LaserJet-P2015-Series';

export async function handleTelegramPrinterAdminText(context: PrinterAdminContext): Promise<boolean> {
  const text = context.messageText?.trim();
  if (!text || context.runtime.chat.kind !== 'private' || !context.runtime.actor.isAdmin) {
    return false;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).printing;
  const menuLabels = createTelegramI18n(language).actionMenu;
  const settingsStore = resolveSettingsStore(context);
  const settings = await settingsStore.getSettings();

  if (text === texts.adminEnableButton) {
    await settingsStore.saveSettings({ ...settings, mode: 'enabled' });
    await context.reply(texts.adminEnabled, adminKeyboard(texts));
    return true;
  }

  if (text === texts.adminDisableButton) {
    await settingsStore.saveSettings({ ...settings, mode: 'disabled' });
    await context.reply(texts.adminDisabled, adminKeyboard(texts));
    return true;
  }

  if (text === texts.adminTestButton) {
    await settingsStore.saveSettings({ ...settings, mode: 'test' });
    await context.reply(texts.adminTestEnabled, adminKeyboard(texts));
    return true;
  }

  if (text === texts.adminHistoryButton) {
    await context.reply(await renderHistory(context), adminKeyboard(texts));
    return true;
  }

  if (text === '/printer_admin' || text === menuLabels.printerAdmin || text === texts.adminRefreshButton) {
    const status = await resolvePrintService(context).getPrinterStatus(settings.cupsQueue);
    await context.reply(formatText(texts.adminStatus, {
      status: renderMode(settings.mode, texts),
      queue: status.queue,
      duplex: status.duplexSupported ? 'sí' : 'no',
    }), adminKeyboard(texts));
    return true;
  }

  return false;
}

async function renderHistory(context: PrinterAdminContext): Promise<string> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).printing;
  const jobs = await resolveHistory(context).listRecent({ limit: 10 });
  if (jobs.length === 0) {
    return texts.adminHistoryEmpty;
  }

  return [
    texts.adminHistoryHeader,
    '',
    ...jobs.map((job) => `#${job.id} ${job.originalFileName} · ${job.selectedPagesLabel} x${job.copies} · ${job.estimatedPhysicalPages} · ${job.status}`),
  ].join('\n');
}

function adminKeyboard(texts: ReturnType<typeof createTelegramI18n>['printing']): TelegramReplyOptions {
  return {
    replyKeyboard: [
      [texts.adminEnableButton, texts.adminDisableButton],
      [texts.adminTestButton],
      [texts.adminHistoryButton, texts.adminRefreshButton],
      [createTelegramI18n('es').actionMenu.admin],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function resolveSettingsStore(context: PrinterAdminContext): PrintingSettingsStore {
  return context.printSettingsStore ?? createAppMetadataPrintingSettingsStore({
    storage: createDatabaseAppMetadataSessionStorage({ database: context.runtime.services.database.db }),
    defaultQueue,
  });
}

function resolveHistory(context: PrinterAdminContext): PrintJobHistoryRepository {
  return context.printJobHistory ?? createDatabasePrintJobHistoryRepository({
    database: context.runtime.services.database.db,
  });
}

function resolvePrintService(context: PrinterAdminContext): Pick<PrintService, 'getPrinterStatus'> {
  return context.printService ?? createPrintService();
}

function renderMode(
  mode: 'disabled' | 'test' | 'enabled',
  texts: ReturnType<typeof createTelegramI18n>['printing'],
): string {
  if (mode === 'enabled') {
    return texts.adminModeEnabled;
  }
  if (mode === 'test') {
    return texts.adminModeTest;
  }
  return texts.adminModeDisabled;
}

function formatText(template: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, value),
    template,
  );
}
