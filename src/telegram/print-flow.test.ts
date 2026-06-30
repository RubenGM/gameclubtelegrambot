import assert from 'node:assert/strict';
import test from 'node:test';

import { createMemoryPrintJobHistoryRepository } from '../printing/print-job-history.js';
import type { PrintService } from '../printing/print-service.js';
import { handleTelegramPrintMessage, handleTelegramPrintText, startTelegramPrintFromStorageMessage } from './print-flow.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import type { ConversationSessionRecord } from './conversation-session.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

test('handleTelegramPrintText blocks new sessions when printing is disabled', async () => {
  const { context, replies } = createContext({ printingMode: 'disabled' });

  assert.equal(await handleTelegramPrintText({ ...context, messageText: '/print' }), true);
  assert.match(replies.at(-1)?.message ?? '', /desactivada/i);
});

test('handleTelegramPrintMessage prepares a PDF attachment and asks for pages', async () => {
  const { context, replies, downloads, getCurrentSession } = createContext({ printingMode: 'enabled' });

  assert.equal(await handleTelegramPrintText({ ...context, messageText: '/print' }), true);
  assert.equal(await handleTelegramPrintMessage({
    ...context,
    messageMedia: {
      attachmentKind: 'document',
      fileId: 'telegram-file',
      fileUniqueId: 'unique-file',
      originalFileName: 'personaje.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 1200,
      messageId: 55,
    },
  }), true);

  assert.deepEqual(downloads, [{ fileId: 'telegram-file', destinationPath: '/tmp/gameclub-print/telegram-file', allowLocalBotApi: true }]);
  assert.equal(getCurrentSession()?.stepKey, 'pages');
  assert.match(replies.at(-1)?.message ?? '', /12 páginas/i);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [['Todas'], ['Cancelar']]);
});

test('handleTelegramPrintMessage rejects files over Telegram download limit before getFile', async () => {
  const { context, replies, downloads, getCurrentSession } = createContext({ printingMode: 'enabled' });

  await handleTelegramPrintText({ ...context, messageText: '/print' });
  assert.equal(await handleTelegramPrintMessage({
    ...context,
    messageMedia: {
      attachmentKind: 'document',
      fileId: 'telegram-huge-file',
      fileUniqueId: 'huge-file',
      originalFileName: 'manual.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 72 * 1024 * 1024,
      messageId: 55,
    },
  }), true);

  assert.deepEqual(downloads, []);
  assert.equal(getCurrentSession()?.stepKey, 'file');
  assert.match(replies.at(-1)?.message ?? '', /72 MB/);
  assert.match(replies.at(-1)?.message ?? '', /20 MB/);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [['Cancelar']]);
});

test('handleTelegramPrintMessage allows large files when local Bot API downloads are available', async () => {
  const { context, replies, downloads, getCurrentSession } = createContext({
    printingMode: 'enabled',
    supportsLargeFileDownload: true,
  });

  await handleTelegramPrintText({ ...context, messageText: '/print' });
  assert.equal(await handleTelegramPrintMessage({
    ...context,
    messageMedia: {
      attachmentKind: 'document',
      fileId: 'telegram-huge-file',
      fileUniqueId: 'huge-file',
      originalFileName: 'manual.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 72 * 1024 * 1024,
      messageId: 55,
    },
  }), true);

  assert.deepEqual(downloads, [{
    fileId: 'telegram-huge-file',
    destinationPath: '/tmp/gameclub-print/telegram-huge-file',
    allowLocalBotApi: true,
  }]);
  assert.equal(getCurrentSession()?.stepKey, 'pages');
  assert.match(replies.at(-1)?.message ?? '', /12 páginas/i);
});

test('handleTelegramPrintMessage explains Telegram getFile size failures', async () => {
  const { context, replies, getCurrentSession } = createContext({
    printingMode: 'enabled',
    downloadError: new Error("Call to 'getFile' failed! (400: Bad Request: file is too big)"),
  });

  await handleTelegramPrintText({ ...context, messageText: '/print' });
  assert.equal(await handleTelegramPrintMessage({
    ...context,
    messageMedia: {
      attachmentKind: 'document',
      fileId: 'telegram-too-big-at-download',
      fileUniqueId: 'too-big-at-download',
      originalFileName: 'manual.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: null,
      messageId: 55,
    },
  }), true);

  assert.equal(getCurrentSession()?.stepKey, 'file');
  assert.match(replies.at(-1)?.message ?? '', /Bot API local/i);
  assert.match(replies.at(-1)?.message ?? '', /20 MB/);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [['Cancelar']]);
});

test('handleTelegramPrintText submits after extra confirmations for many copies', async () => {
  const history = createMemoryPrintJobHistoryRepository();
  const restoredHome: string[] = [];
  const { context, replies, submissions } = createContext({ printingMode: 'enabled', history, restoredHome });

  await handleTelegramPrintText({ ...context, messageText: '/print' });
  await handleTelegramPrintMessage({
    ...context,
    messageMedia: {
      attachmentKind: 'document',
      fileId: 'telegram-file',
      originalFileName: 'fichas.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 1200,
      messageId: 55,
    },
  });
  await handleTelegramPrintText({ ...context, messageText: '1-4' });
  assert.match(replies.at(-1)?.message ?? '', /escribir cualquier número/i);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [['1'], ['Cancelar']]);

  await handleTelegramPrintText({ ...context, messageText: '12' });
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [['Una cara', 'Doble cara'], ['Cancelar']]);

  await handleTelegramPrintText({ ...context, messageText: 'Doble cara' });
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [['Confirmar copias'], ['Cancelar']]);

  await handleTelegramPrintText({ ...context, messageText: 'Confirmar copias' });
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [['Imprimir ahora'], ['Cancelar']]);

  await handleTelegramPrintText({ ...context, messageText: 'Imprimir ahora' });

  assert.deepEqual(submissions, [{
    pdfPath: '/tmp/gameclub-print/telegram-file',
    queue: 'Virtual-PDF',
    copies: 12,
    pageRanges: '1-4',
    sides: 'two-sided-long-edge',
  }]);
  const jobs = await history.listRecent({ limit: 1 });
  assert.equal(jobs[0]?.status, 'submitted');
  assert.equal(jobs[0]?.copies, 12);
  assert.equal(jobs[0]?.estimatedPhysicalPages, 48);
  assert.deepEqual(restoredHome, ['home']);
});

test('handleTelegramPrintText keeps cancel available after validation errors and many-page confirmation', async () => {
  const { context, replies } = createContext({ printingMode: 'enabled' });

  await handleTelegramPrintText({ ...context, messageText: '/print' });
  await handleTelegramPrintMessage({
    ...context,
    messageMedia: {
      attachmentKind: 'document',
      fileId: 'telegram-file',
      originalFileName: 'manual.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 1200,
      messageId: 55,
    },
  });

  await handleTelegramPrintText({ ...context, messageText: '999' });
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [['Todas'], ['Cancelar']]);

  await handleTelegramPrintText({ ...context, messageText: 'Todas' });
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [['1'], ['Cancelar']]);

  await handleTelegramPrintText({ ...context, messageText: 'abc' });
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [['1'], ['Cancelar']]);

  await handleTelegramPrintText({ ...context, messageText: '1' });
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [['Una cara', 'Doble cara'], ['Cancelar']]);

  await handleTelegramPrintText({ ...context, messageText: 'algo raro' });
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [['Una cara', 'Doble cara'], ['Cancelar']]);

  await handleTelegramPrintText({ ...context, messageText: 'Una cara' });
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [['Confirmar páginas'], ['Cancelar']]);
});

test('handleTelegramPrintText completes test mode without submitting to CUPS', async () => {
  const history = createMemoryPrintJobHistoryRepository();
  const restoredHome: string[] = [];
  const { context, replies, submissions } = createContext({ printingMode: 'test', history, restoredHome });

  await handleTelegramPrintText({ ...context, messageText: '/print' });
  await handleTelegramPrintMessage({
    ...context,
    messageMedia: {
      attachmentKind: 'document',
      fileId: 'telegram-file',
      originalFileName: 'prueba.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 1200,
      messageId: 55,
    },
  });
  await handleTelegramPrintText({ ...context, messageText: '1-2' });
  await handleTelegramPrintText({ ...context, messageText: '1' });
  await handleTelegramPrintText({ ...context, messageText: 'Una cara' });
  await handleTelegramPrintText({ ...context, messageText: 'Imprimir ahora' });

  assert.deepEqual(submissions, []);
  assert.match(replies.at(-1)?.message ?? '', /modo prueba/i);
  const jobs = await history.listRecent({ limit: 1 });
  assert.equal(jobs[0]?.status, 'submitted');
  assert.equal(jobs[0]?.cupsJobId, 'test-mode');
  assert.equal(jobs[0]?.estimatedPhysicalPages, 2);
  assert.deepEqual(restoredHome, ['home']);
});

test('handleTelegramPrintText cancels with the visible cancel button', async () => {
  const { context, replies, cleanups, getCurrentSession } = createContext({ printingMode: 'enabled' });

  await handleTelegramPrintText({ ...context, messageText: '/print' });
  await handleTelegramPrintMessage({
    ...context,
    messageMedia: {
      attachmentKind: 'document',
      fileId: 'telegram-file',
      originalFileName: 'manual.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 1200,
      messageId: 55,
    },
  });

  assert.equal(await handleTelegramPrintText({ ...context, messageText: 'Cancelar' }), true);
  assert.equal(getCurrentSession(), null);
  assert.deepEqual(cleanups, [['/tmp/gameclub-print/telegram-file', '/tmp/gameclub-print/telegram-file']]);
  assert.match(replies.at(-1)?.message ?? '', /cancelado/i);
});

test('startTelegramPrintFromStorageMessage prepares storage files and records storage origin', async () => {
  const history = createMemoryPrintJobHistoryRepository();
  const restoredStorageEntries: number[] = [];
  const { context, downloads } = createContext({ printingMode: 'enabled', history, restoredStorageEntries });

  assert.equal(await startTelegramPrintFromStorageMessage(context, {
    storageEntryId: 123,
    storageMessageId: 456,
    fileId: 'storage-file',
    originalFileName: 'hoja.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 1200,
  }), true);
  await handleTelegramPrintText({ ...context, messageText: '1-2' });
  await handleTelegramPrintText({ ...context, messageText: '1' });
  await handleTelegramPrintText({ ...context, messageText: 'Una cara' });
  await handleTelegramPrintText({ ...context, messageText: 'Imprimir ahora' });

  assert.deepEqual(downloads, [{ fileId: 'storage-file', destinationPath: '/tmp/gameclub-print/storage-file', allowLocalBotApi: true }]);
  const jobs = await history.listRecent({ limit: 1 });
  assert.equal(jobs[0]?.origin, 'storage_entry');
  assert.equal(jobs[0]?.storageEntryId, 123);
  assert.equal(jobs[0]?.storageMessageId, 456);
  assert.deepEqual(restoredStorageEntries, [123]);
});

test('startTelegramPrintFromStorageMessage rejects files over Telegram download limit before getFile', async () => {
  const { context, replies, downloads, getCurrentSession } = createContext({ printingMode: 'enabled' });

  assert.equal(await startTelegramPrintFromStorageMessage(context, {
    storageEntryId: 123,
    storageMessageId: 456,
    fileId: 'storage-huge-file',
    originalFileName: 'manual.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 72 * 1024 * 1024,
  }), true);

  assert.deepEqual(downloads, []);
  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /72 MB/);
  assert.match(replies.at(-1)?.message ?? '', /20 MB/);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [['Cancelar']]);
});

test('startTelegramPrintFromStorageMessage allows large files when local Bot API downloads are available', async () => {
  const { context, replies, downloads, getCurrentSession } = createContext({
    printingMode: 'enabled',
    supportsLargeFileDownload: true,
  });

  assert.equal(await startTelegramPrintFromStorageMessage(context, {
    storageEntryId: 123,
    storageMessageId: 456,
    fileId: 'storage-huge-file',
    originalFileName: 'manual.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 72 * 1024 * 1024,
  }), true);

  assert.deepEqual(downloads, [{
    fileId: 'storage-huge-file',
    destinationPath: '/tmp/gameclub-print/storage-huge-file',
    allowLocalBotApi: true,
  }]);
  assert.equal(getCurrentSession()?.stepKey, 'pages');
  assert.match(replies.at(-1)?.message ?? '', /12 páginas/i);
});


function createContext({
  printingMode,
  history = createMemoryPrintJobHistoryRepository(),
  restoredStorageEntries,
  restoredHome,
  downloadError,
  supportsLargeFileDownload = false,
}: {
  printingMode: 'disabled' | 'test' | 'enabled';
  history?: ReturnType<typeof createMemoryPrintJobHistoryRepository>;
  restoredStorageEntries?: number[];
  restoredHome?: string[];
  downloadError?: Error;
  supportsLargeFileDownload?: boolean;
}) {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const downloads: Array<{ fileId: string; destinationPath: string; allowLocalBotApi?: boolean }> = [];
  const submissions: Array<{ pdfPath: string; queue: string; copies: number; pageRanges: string; sides: 'one-sided' | 'two-sided-long-edge' }> = [];
  const cleanups: string[][] = [];
  let currentSession: ConversationSessionRecord | null = null;
  const printService: PrintService = {
    async inspectPdf() {
      return { pageCount: 12 };
    },
    async convertOfficeToPdf() {
      return '/tmp/gameclub-print/converted.pdf';
    },
    async getPrinterStatus(queue) {
      return { queue, duplexSupported: true };
    },
    async submitPdfJob(input) {
      submissions.push(input);
      return { cupsJobId: 'Virtual-PDF-42' };
    },
    async cleanup(paths) {
      cleanups.push(paths);
    },
  };

  const context = {
    from: { id: 7, username: 'ruben' },
    reply: async (message: string, options?: TelegramReplyOptions) => {
      replies.push(options ? { message, options } : { message });
      return { message_id: replies.length };
    },
    printSettingsStore: {
      async getSettings() {
        return { mode: printingMode, cupsQueue: 'Virtual-PDF' };
      },
      async saveSettings() {},
    },
    printService,
    printJobHistory: history,
    restorePrintedStorageEntry: restoredStorageEntries
      ? async (_context: TelegramCommandHandlerContext, entryId: number) => {
          restoredStorageEntries.push(entryId);
        }
      : undefined,
    restorePrintHome: restoredHome
      ? async () => {
          restoredHome.push('home');
        }
      : undefined,
    runtime: {
      chat: { kind: 'private' as const, chatId: 7 },
      actor: {
        telegramUserId: 7,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin: false,
        permissions: [],
      },
      authorization: {
        authorize: () => ({ allowed: false, permissionKey: 'test', reason: 'no-match' as const }),
        can: () => false,
      },
      session: {
        get current() {
          return currentSession;
        },
        start: async ({ flowKey, stepKey, data = {} }: { flowKey: string; stepKey: string; data?: Record<string, unknown> }) => {
          currentSession = {
            key: 'telegram.session:7:7',
            flowKey,
            stepKey,
            data,
            createdAt: '2026-06-30T10:00:00.000Z',
            updatedAt: '2026-06-30T10:00:00.000Z',
            expiresAt: '2026-07-01T10:00:00.000Z',
          };
          return currentSession;
        },
        advance: async ({ stepKey, data }: { stepKey: string; data: Record<string, unknown> }) => {
          if (!currentSession) throw new Error('No session');
          currentSession = { ...currentSession, stepKey, data, updatedAt: '2026-06-30T10:01:00.000Z' };
          return currentSession;
        },
        cancel: async () => {
          currentSession = null;
          return true;
        },
      },
      bot: {
        language: 'es' as const,
        publicName: 'Game Club Bot',
        supportsLargeFileDownload,
        clubName: 'Game Club',
        sendPrivateMessage: async () => {},
        downloadFile: async ({ fileId, destinationPath, allowLocalBotApi }: { fileId: string; destinationPath: string; allowLocalBotApi?: boolean }) => {
          if (downloadError) {
            throw downloadError;
          }
          downloads.push({
            fileId,
            destinationPath,
            ...(allowLocalBotApi !== undefined ? { allowLocalBotApi } : {}),
          });
        },
      },
      services: {} as TelegramCommandHandlerContext['runtime']['services'],
    },
  } satisfies TelegramCommandHandlerContext & Record<string, unknown>;

  return { context, replies, downloads, submissions, cleanups, getCurrentSession: () => currentSession };
}
