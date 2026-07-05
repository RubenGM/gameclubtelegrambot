import {
  createAppMetadataPrintingSettingsStore,
  type PrintingSettingsStore,
} from '../printing/print-settings.js';
import {
  createDatabasePrintPermissionRepository,
  type PrintPermissionRepository,
  type PrintPermissionUserRecord,
} from '../printing/print-permissions.js';
import {
  createDatabasePrintJobHistoryRepository,
  type PrintJobHistoryRepository,
} from '../printing/print-job-history.js';
import { createPrintService, type PrintService } from '../printing/print-service.js';
import { createDatabaseAppMetadataSessionStorage } from './conversation-session-store.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import { buildTelegramStartUrl } from './deep-links.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import { escapeHtml } from './schedule-presentation.js';

type PrinterAdminContext = TelegramCommandHandlerContext & {
  printSettingsStore?: PrintingSettingsStore | undefined;
  printJobHistory?: PrintJobHistoryRepository | undefined;
  printPermissionRepository?: PrintPermissionRepository | undefined;
  printService?: Pick<PrintService, 'getPrinterStatus'> | undefined;
};

const defaultQueue = 'HP-LaserJet-P2015-Series';
const printerPermissionFlowKey = 'printer-permission';
const printerPermissionPageSize = 10;
const printerGrantStartPayloadPrefix = 'printer_grant_';
const printerRevokeStartPayloadPrefix = 'printer_revoke_';

type PrinterPermissionStep = 'grant-user' | 'revoke-user' | 'list-user';
type PrinterPermissionPageInputStep = 'grant-page-input' | 'revoke-page-input' | 'list-page-input';

export async function handleTelegramPrinterAdminStartText(context: PrinterAdminContext): Promise<boolean> {
  const text = context.messageText?.trim();
  if (!text || context.runtime.chat.kind !== 'private' || !context.runtime.actor.isAdmin) {
    return false;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).printing;
  const grantTarget = parseStartPayload(text, printerGrantStartPayloadPrefix);
  if (grantTarget !== null) {
    return applyPrinterPermissionChange(context, grantTarget, 'grant-user', texts);
  }

  const revokeTarget = parseStartPayload(text, printerRevokeStartPayloadPrefix);
  if (revokeTarget !== null) {
    return applyPrinterPermissionChange(context, revokeTarget, 'revoke-user', texts);
  }

  return false;
}

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

  if (context.runtime.session.current?.flowKey === printerPermissionFlowKey) {
    return handlePrinterPermissionSelection(context, text, texts);
  }

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

  if (text === texts.adminGrantPermissionButton) {
    return startPrinterPermissionSelection(context, 'grant-user', await resolvePrintPermissions(context).listGrantableUsers(), texts);
  }

  if (text === texts.adminRevokePermissionButton) {
    return startPrinterPermissionSelection(context, 'revoke-user', await resolvePrintPermissions(context).listAllowedUsers(), texts);
  }

  if (text === texts.adminAccessListButton) {
    return startPrinterPermissionSelection(context, 'list-user', await resolvePrintPermissions(context).listAllowedUsers(), texts);
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

async function startPrinterPermissionSelection(
  context: PrinterAdminContext,
  stepKey: PrinterPermissionStep,
  users: PrintPermissionUserRecord[],
  texts: ReturnType<typeof createTelegramI18n>['printing'],
  page = 1,
): Promise<boolean> {
  if (users.length === 0) {
    await context.reply(stepKey === 'grant-user' ? texts.adminNoGrantableUsers : texts.adminNoAllowedUsers, adminKeyboard(texts));
    return true;
  }

  const currentPage = clampPermissionPage(page, users.length);
  await context.runtime.session.start({
    flowKey: printerPermissionFlowKey,
    stepKey,
    data: { page: currentPage },
  });
  await replyWithPrinterPermissionList(context, stepKey, users, currentPage, texts);
  return true;
}

async function handlePrinterPermissionSelection(
  context: PrinterAdminContext,
  text: string,
  texts: ReturnType<typeof createTelegramI18n>['printing'],
): Promise<boolean> {
  if (text === '/cancel' || text === texts.cancelButton) {
    await context.runtime.session.cancel();
    await context.reply(createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca')).common.flowCancelled, adminKeyboard(texts));
    return true;
  }

  const session = context.runtime.session.current;
  if (!session || session.flowKey !== printerPermissionFlowKey) {
    return false;
  }

  if (text === texts.adminBackButton) {
    await context.runtime.session.cancel();
    await context.reply(texts.adminBackToPrinter, adminKeyboard(texts));
    return true;
  }

  if (isPermissionListStep(session.stepKey) && text === texts.adminNextPageButton) {
    return rerenderPermissionPage(context, session.stepKey, getSessionPage(session.data) + 1, texts);
  }

  if (isPermissionListStep(session.stepKey) && text === texts.adminPrevPageButton) {
    return rerenderPermissionPage(context, session.stepKey, getSessionPage(session.data) - 1, texts);
  }

  if (isPermissionListStep(session.stepKey) && text === texts.adminGoToPageButton) {
    await context.runtime.session.advance({
      stepKey: permissionPageInputStep(session.stepKey),
      data: { ...session.data, previousStepKey: session.stepKey },
    });
    await context.reply(texts.adminAskPageNumber, pageInputKeyboard(texts));
    return true;
  }

  if (isPermissionPageInputStep(session.stepKey)) {
    const requestedPage = Number(text);
    if (!Number.isInteger(requestedPage) || requestedPage < 1) {
      await context.reply(texts.adminInvalidPageNumber, pageInputKeyboard(texts));
      return true;
    }
    const previousStepKey = session.data.previousStepKey === 'grant-user' || session.data.previousStepKey === 'revoke-user' || session.data.previousStepKey === 'list-user'
      ? session.data.previousStepKey
      : 'list-user';
    return rerenderPermissionPage(context, previousStepKey, requestedPage, texts);
  }

  if (session.stepKey === 'list-user') {
    await context.reply(texts.adminBackToPrinter);
    return true;
  }

  const targetTelegramUserId = parseUserIdFromSelection(text);
  if (targetTelegramUserId === null) {
    await context.reply(texts.adminInvalidPermissionUser);
    return true;
  }

  return applyPrinterPermissionChange(context, targetTelegramUserId, session.stepKey === 'grant-user' ? 'grant-user' : 'revoke-user', texts);
}

async function rerenderPermissionPage(
  context: PrinterAdminContext,
  stepKey: PrinterPermissionStep,
  page: number,
  texts: ReturnType<typeof createTelegramI18n>['printing'],
): Promise<boolean> {
  const repository = resolvePrintPermissions(context);
  const users = stepKey === 'grant-user'
    ? await repository.listGrantableUsers()
    : await repository.listAllowedUsers();
  if (users.length === 0) {
    await context.runtime.session.cancel();
    await context.reply(stepKey === 'grant-user' ? texts.adminNoGrantableUsers : texts.adminNoAllowedUsers, adminKeyboard(texts));
    return true;
  }

  const currentPage = clampPermissionPage(page, users.length);
  await context.runtime.session.advance({ stepKey, data: { page: currentPage } });
  await replyWithPrinterPermissionList(context, stepKey, users, currentPage, texts);
  return true;
}

async function replyWithPrinterPermissionList(
  context: PrinterAdminContext,
  stepKey: PrinterPermissionStep,
  users: PrintPermissionUserRecord[],
  page: number,
  texts: ReturnType<typeof createTelegramI18n>['printing'],
): Promise<void> {
  const stats = await resolvePrintPermissions(context).listUserPrintStats(users.map((user) => user.telegramUserId));
  const statsByUser = new Map(stats.map((row) => [row.telegramUserId, row]));
  const totalPages = permissionTotalPages(users.length);
  const currentPage = clampPermissionPage(page, users.length);
  const startIndex = (currentPage - 1) * printerPermissionPageSize;
  const pageUsers = users.slice(startIndex, startIndex + printerPermissionPageSize);
  const title = stepKey === 'grant-user'
    ? texts.adminChooseGrantUser
    : stepKey === 'revoke-user'
      ? texts.adminChooseRevokeUser
      : texts.adminAccessListTitle;
  const lines = [
    escapeHtml(title),
    '',
    ...pageUsers.map((user) => formatPermissionUserLine(user, statsByUser.get(user.telegramUserId), stepKey, texts)),
    '',
    formatText(texts.adminPageFooter, {
      from: String(startIndex + 1),
      to: String(startIndex + pageUsers.length),
      total: String(users.length),
      page: String(currentPage),
      pages: String(totalPages),
    }),
  ];

  await context.reply(lines.join('\n'), {
    parseMode: 'HTML',
    ...permissionListKeyboard({ currentPage, totalPages, texts }),
  });
}

async function applyPrinterPermissionChange(
  context: PrinterAdminContext,
  targetTelegramUserId: number,
  stepKey: 'grant-user' | 'revoke-user',
  texts: ReturnType<typeof createTelegramI18n>['printing'],
): Promise<boolean> {
  const repository = resolvePrintPermissions(context);
  const user = await repository.findUserByTelegramUserId(targetTelegramUserId);
  if (!user || user.status !== 'approved' || user.isAdmin) {
    await context.reply(texts.adminInvalidPermissionUser);
    return true;
  }

  if (stepKey === 'grant-user') {
    await repository.grantPrintPermission({
      subjectTelegramUserId: user.telegramUserId,
      changedByTelegramUserId: context.runtime.actor.telegramUserId,
    });
    await context.runtime.session.cancel();
    await context.reply(formatText(texts.adminPermissionGranted, { user: formatPermissionUserLabel(user) }), adminKeyboard(texts));
    return true;
  }

  await repository.revokePrintPermission({
    subjectTelegramUserId: user.telegramUserId,
    changedByTelegramUserId: context.runtime.actor.telegramUserId,
  });
  await context.runtime.session.cancel();
  await context.reply(formatText(texts.adminPermissionRevoked, { user: formatPermissionUserLabel(user) }), adminKeyboard(texts));
  return true;
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
      [texts.adminGrantPermissionButton, texts.adminRevokePermissionButton],
      [texts.adminAccessListButton],
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

function resolvePrintPermissions(context: PrinterAdminContext): PrintPermissionRepository {
  return context.printPermissionRepository ?? createDatabasePrintPermissionRepository({
    database: context.runtime.services.database.db,
  });
}

function resolvePrintService(context: PrinterAdminContext): Pick<PrintService, 'getPrinterStatus'> {
  return context.printService ?? createPrintService();
}

function formatPermissionUserLabel(user: Pick<PrintPermissionUserRecord, 'telegramUserId' | 'displayName' | 'username'>): string {
  return user.username && user.username.trim().length > 0
    ? `${user.displayName} (@${user.username.replace(/^@/, '')}) · ${user.telegramUserId}`
    : `${user.displayName} · ${user.telegramUserId}`;
}

function formatPermissionUserLine(
  user: PrintPermissionUserRecord,
  stats: { submittedJobs: number; estimatedPhysicalPages: number } | undefined,
  stepKey: PrinterPermissionStep,
  texts: ReturnType<typeof createTelegramI18n>['printing'],
): string {
  const label = escapeHtml(formatPermissionUserLabel(user));
  const linkedLabel = stepKey === 'list-user'
    ? `<a href="tg://user?id=${user.telegramUserId}">${label}</a>`
    : `<a href="${escapeHtml(buildTelegramStartUrl(`${stepKey === 'grant-user' ? printerGrantStartPayloadPrefix : printerRevokeStartPayloadPrefix}${user.telegramUserId}`))}">${label}</a>`;
  return `- ${linkedLabel} · ${formatText(texts.adminUsageStats, {
    jobs: String(stats?.submittedJobs ?? 0),
    pages: String(stats?.estimatedPhysicalPages ?? 0),
  })}`;
}

function permissionListKeyboard({
  currentPage,
  totalPages,
  texts,
}: {
  currentPage: number;
  totalPages: number;
  texts: ReturnType<typeof createTelegramI18n>['printing'];
}): TelegramReplyOptions {
  const rows: string[][] = [];
  const navigation = [
    ...(currentPage > 1 ? [texts.adminPrevPageButton] : []),
    ...(currentPage < totalPages ? [texts.adminNextPageButton] : []),
  ];
  if (navigation.length > 0) {
    rows.push(navigation);
  }
  if (totalPages > 1) {
    rows.push([texts.adminGoToPageButton]);
  }
  rows.push([texts.adminBackButton]);
  return { replyKeyboard: rows, resizeKeyboard: true, persistentKeyboard: true };
}

function pageInputKeyboard(texts: ReturnType<typeof createTelegramI18n>['printing']): TelegramReplyOptions {
  return { replyKeyboard: [[texts.adminBackButton]], resizeKeyboard: true, persistentKeyboard: true };
}

function parseUserIdFromSelection(text: string): number | null {
  const match = text.match(/(?:·|\s)(\d+)$/);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isInteger(value) ? value : null;
}

function parseStartPayload(text: string, prefix: string): number | null {
  const match = text.match(/^\/start(?:@\w+)?\s+(.+)$/i);
  const payload = match?.[1]?.trim();
  if (!payload?.startsWith(prefix)) {
    return null;
  }
  const value = Number(payload.slice(prefix.length));
  return Number.isInteger(value) && value > 0 ? value : null;
}

function clampPermissionPage(page: number, totalItems: number): number {
  const parsed = Number.isFinite(page) ? Math.trunc(page) : 1;
  return Math.min(Math.max(parsed, 1), permissionTotalPages(totalItems));
}

function permissionTotalPages(totalItems: number): number {
  return Math.max(1, Math.ceil(totalItems / printerPermissionPageSize));
}

function getSessionPage(data: Record<string, unknown>): number {
  return typeof data.page === 'number' && Number.isFinite(data.page) ? data.page : 1;
}

function isPermissionListStep(stepKey: string): stepKey is PrinterPermissionStep {
  return stepKey === 'grant-user' || stepKey === 'revoke-user' || stepKey === 'list-user';
}

function isPermissionPageInputStep(stepKey: string): stepKey is PrinterPermissionPageInputStep {
  return stepKey === 'grant-page-input' || stepKey === 'revoke-page-input' || stepKey === 'list-page-input';
}

function permissionPageInputStep(stepKey: PrinterPermissionStep): PrinterPermissionPageInputStep {
  if (stepKey === 'grant-user') return 'grant-page-input';
  if (stepKey === 'revoke-user') return 'revoke-page-input';
  return 'list-page-input';
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
