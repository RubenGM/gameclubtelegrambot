import assert from 'node:assert/strict';
import test from 'node:test';

import { createMemoryPrintJobHistoryRepository } from '../printing/print-job-history.js';
import { handleTelegramPrinterAdminStartText, handleTelegramPrinterAdminText } from './printer-admin-flow.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import type { ConversationSessionRecord } from './conversation-session.js';
import { configureTelegramDeepLinks } from './deep-links.js';
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

test('printer admin flow grants and revokes print permission for approved users', async () => {
  const { context, replies, permissions, getCurrentSession } = createContext({
    printUsers: [
      { telegramUserId: 77, username: 'ada', displayName: 'Ada Lovelace', status: 'approved', isAdmin: false },
    ],
  });

  assert.equal(await handleTelegramPrinterAdminText({ ...context, messageText: 'Conceder impresión' }), true);
  assert.equal(getCurrentSession()?.stepKey, 'grant-user');
  assert.match(replies.at(-1)?.message ?? '', /Elige el usuario que podrá imprimir/);
  assert.match(replies.at(-1)?.message ?? '', /<a href="https:\/\/t\.me\/cawatest_bot\?start=printer_grant_77">Ada Lovelace \(@ada\) · 77<\/a>/);
  assert.equal(replies.at(-1)?.options?.parseMode, 'HTML');
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [
    ['Volver'],
  ]);

  assert.equal(await handleTelegramPrinterAdminStartText({ ...context, messageText: '/start printer_grant_77' }), true);
  assert.deepEqual(permissions, [{ action: 'grant', subjectTelegramUserId: 77, changedByTelegramUserId: 7 }]);
  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /permiso de impresión concedido/i);

  assert.equal(await handleTelegramPrinterAdminText({ ...context, messageText: 'Revocar impresión' }), true);
  assert.equal(getCurrentSession()?.stepKey, 'revoke-user');
  assert.match(replies.at(-1)?.message ?? '', /Impresiones: 3 · Páginas: 42/);

  assert.equal(await handleTelegramPrinterAdminStartText({ ...context, messageText: '/start printer_revoke_77' }), true);
  assert.deepEqual(permissions.at(-1), { action: 'revoke', subjectTelegramUserId: 77, changedByTelegramUserId: 7 });
  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /permiso de impresión revocado/i);

  assert.equal(await handleTelegramPrinterAdminText({ ...context, messageText: 'Accesos impresión' }), true);
  assert.equal(getCurrentSession()?.stepKey, 'list-user');
  assert.match(replies.at(-1)?.message ?? '', /Socios con permiso de impresión/);
  assert.match(replies.at(-1)?.message ?? '', /<a href="tg:\/\/user\?id=77">Ada Lovelace \(@ada\) · 77<\/a> · Impresiones: 3 · Páginas: 42/);
});

test('printer admin permission selector paginates users with links and footer', async () => {
  const printUsers = Array.from({ length: 13 }, (_, index) => ({
    telegramUserId: 100 + index,
    username: `user${index + 1}`,
    displayName: `User ${String(index + 1).padStart(2, '0')}`,
    status: 'approved',
    isAdmin: false,
  }));
  const { context, replies, getCurrentSession } = createContext({ printUsers });

  assert.equal(await handleTelegramPrinterAdminText({ ...context, messageText: 'Conceder impresión' }), true);
  assert.match(replies.at(-1)?.message ?? '', /Mostrando 1-10 de 13\. Página 1\/2\./);
  assert.match(replies.at(-1)?.message ?? '', /printer_grant_100/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /printer_grant_110/);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [
    ['Siguiente'],
    ['Ir a página'],
    ['Volver'],
  ]);

  assert.equal(await handleTelegramPrinterAdminText({ ...context, messageText: 'Siguiente' }), true);
  assert.match(replies.at(-1)?.message ?? '', /Mostrando 11-13 de 13\. Página 2\/2\./);
  assert.match(replies.at(-1)?.message ?? '', /printer_grant_110/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /printer_grant_109/);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [
    ['Anterior'],
    ['Ir a página'],
    ['Volver'],
  ]);

  assert.equal(await handleTelegramPrinterAdminText({ ...context, messageText: 'Ir a página' }), true);
  assert.equal(getCurrentSession()?.stepKey, 'grant-page-input');

  assert.equal(await handleTelegramPrinterAdminText({ ...context, messageText: '1' }), true);
  assert.equal(getCurrentSession()?.stepKey, 'grant-user');
  assert.match(replies.at(-1)?.message ?? '', /Mostrando 1-10 de 13\. Página 1\/2\./);
});

interface PrintPermissionTestUser {
  telegramUserId: number;
  username: string | null;
  displayName: string;
  status: string;
  isAdmin: boolean;
}

function createContext({
  history = createMemoryPrintJobHistoryRepository(),
  printUsers = [],
}: {
  history?: ReturnType<typeof createMemoryPrintJobHistoryRepository>;
  printUsers?: PrintPermissionTestUser[];
} = {}) {
  configureTelegramDeepLinks({ botUsername: 'cawatest_bot' });
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  let currentSession: ConversationSessionRecord | null = null;
  const settings: { mode: 'disabled' | 'enabled' | 'test'; cupsQueue: string } = {
    mode: 'disabled',
    cupsQueue: 'Virtual-PDF',
  };
  const permissions: Array<{ action: 'grant' | 'revoke'; subjectTelegramUserId: number; changedByTelegramUserId: number }> = [];
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
    printPermissionRepository: {
      async findUserByTelegramUserId(telegramUserId: number) {
        return printUsers.find((user) => user.telegramUserId === telegramUserId) ?? null;
      },
      async listGrantableUsers() {
        return printUsers;
      },
      async listAllowedUsers() {
        return printUsers;
      },
      async listUserPrintStats() {
        return printUsers.map((user) => ({
          telegramUserId: user.telegramUserId,
          submittedJobs: user.telegramUserId === 77 ? 3 : 0,
          estimatedPhysicalPages: user.telegramUserId === 77 ? 42 : 0,
        }));
      },
      async grantPrintPermission(input: { subjectTelegramUserId: number; changedByTelegramUserId: number }) {
        permissions.push({ action: 'grant', ...input });
      },
      async revokePrintPermission(input: { subjectTelegramUserId: number; changedByTelegramUserId: number }) {
        permissions.push({ action: 'revoke', ...input });
      },
    },
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
        get current() {
          return currentSession;
        },
        start: async ({ flowKey, stepKey, data = {} }: { flowKey: string; stepKey: string; data?: Record<string, unknown> }) => {
          currentSession = {
            key: 'telegram.session:7:7',
            flowKey,
            stepKey,
            data,
            createdAt: '2026-07-01T10:00:00.000Z',
            updatedAt: '2026-07-01T10:00:00.000Z',
            expiresAt: '2026-07-02T10:00:00.000Z',
          };
          return currentSession;
        },
        advance: async ({ stepKey, data }: { stepKey: string; data: Record<string, unknown> }) => {
          if (!currentSession) throw new Error('No session');
          currentSession = { ...currentSession, stepKey, data, updatedAt: '2026-07-01T10:01:00.000Z' };
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
        clubName: 'Game Club',
        sendPrivateMessage: async () => {},
      },
      services: {} as TelegramCommandHandlerContext['runtime']['services'],
    },
  } satisfies TelegramCommandHandlerContext & Record<string, unknown>;

  return { context, replies, settings, permissions, getCurrentSession: () => currentSession };
}
