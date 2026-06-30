import assert from 'node:assert/strict';
import test from 'node:test';

import { createMemoryPrintJobHistoryRepository } from '../printing/print-job-history.js';
import { handleTelegramPrinterAdminText } from './printer-admin-flow.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

test('printer admin flow switches between enabled, disabled and test modes', async () => {
  const { context, replies, settings } = createContext();

  assert.equal(await handleTelegramPrinterAdminText({ ...context, messageText: 'Impresora' }), true);
  assert.match(replies.at(-1)?.message ?? '', /desactivada/i);

  assert.equal(await handleTelegramPrinterAdminText({ ...context, messageText: 'Activar' }), true);
  assert.equal(settings.mode, 'enabled');
  assert.match(replies.at(-1)?.message ?? '', /activada/i);

  assert.equal(await handleTelegramPrinterAdminText({ ...context, messageText: 'Modo prueba' }), true);
  assert.equal(settings.mode, 'test');
  assert.match(replies.at(-1)?.message ?? '', /modo prueba/i);

  assert.equal(await handleTelegramPrinterAdminText({ ...context, messageText: 'Desactivar' }), true);
  assert.equal(settings.mode, 'disabled');
  assert.match(replies.at(-1)?.message ?? '', /desactivada/i);
});

test('printer admin flow shows recent history', async () => {
  const history = createMemoryPrintJobHistoryRepository();
  await history.createJob({
    requestedByTelegramUserId: 7,
    requestedByDisplayName: 'Ruben',
    origin: 'telegram_attachment',
    storageEntryId: null,
    storageMessageId: null,
    originalFileName: 'fichas.pdf',
    mimeType: 'application/pdf',
    detectedType: 'pdf',
    normalizedPageCount: 4,
    selectedPagesLabel: '1-4',
    selectedPageCount: 4,
    copies: 7,
    estimatedPhysicalPages: 28,
    sides: 'two-sided-long-edge',
    cupsQueue: 'Virtual-PDF',
  });
  const { context, replies } = createContext({ history });

  assert.equal(await handleTelegramPrinterAdminText({ ...context, messageText: 'Historial impresión' }), true);
  assert.match(replies.at(-1)?.message ?? '', /fichas\.pdf/);
  assert.match(replies.at(-1)?.message ?? '', /28/);
});

function createContext({ history = createMemoryPrintJobHistoryRepository() } = {}) {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const settings: { mode: 'disabled' | 'enabled' | 'test'; cupsQueue: string } = {
    mode: 'disabled',
    cupsQueue: 'Virtual-PDF',
  };
  const context = {
    reply: async (message: string, options?: TelegramReplyOptions) => {
      replies.push(options ? { message, options } : { message });
      return { message_id: replies.length };
    },
    printSettingsStore: {
      async getSettings() {
        return settings;
      },
      async saveSettings(next: typeof settings) {
        settings.mode = next.mode;
        settings.cupsQueue = next.cupsQueue;
      },
    },
    printJobHistory: history,
    printService: {
      async getPrinterStatus(queue: string) {
        return { queue, duplexSupported: true };
      },
    },
    runtime: {
      chat: { kind: 'private' as const, chatId: 7 },
      actor: {
        telegramUserId: 7,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin: true,
        permissions: [],
      },
      authorization: {
        authorize: () => ({ allowed: false, permissionKey: 'test', reason: 'no-match' as const }),
        can: () => false,
      },
      session: {
        current: null,
        start: async () => { throw new Error('not used'); },
        advance: async () => { throw new Error('not used'); },
        cancel: async () => true,
      },
      bot: {
        language: 'es' as const,
        publicName: 'Game Club Bot',
        clubName: 'Game Club',
        sendPrivateMessage: async () => {},
      },
      services: {} as TelegramCommandHandlerContext['runtime']['services'],
    },
  } satisfies TelegramCommandHandlerContext & Record<string, unknown>;

  return { context, replies, settings };
}
