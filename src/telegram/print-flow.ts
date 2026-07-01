import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  createAppMetadataPrintingSettingsStore,
  type PrintingMode,
  type PrintingSettingsStore,
} from '../printing/print-settings.js';
import { printPermissionKey } from '../printing/print-permissions.js';
import {
  createDatabasePrintJobHistoryRepository,
  type PrintJobHistoryRepository,
  type PrintJobSides,
} from '../printing/print-job-history.js';
import { createPrintService, type PrintService } from '../printing/print-service.js';
import { parsePrintPageSelection } from '../printing/page-selection.js';
import { createDatabaseAppMetadataSessionStorage } from './conversation-session-store.js';
import { type TelegramCommandHandlerContext } from './command-registry.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

const printFlowKey = 'print-job';
const defaultPrintQueue = 'HP-LaserJet-P2015-Series';
const defaultTempDir = '/tmp/gameclub-print';
const telegramBotApiDownloadLimitBytes = 20 * 1024 * 1024;

type PrintFlowContext = TelegramCommandHandlerContext & {
  printSettingsStore?: PrintingSettingsStore | undefined;
  printService?: PrintService | undefined;
  printJobHistory?: PrintJobHistoryRepository | undefined;
  restorePrintedStorageEntry?: ((context: TelegramCommandHandlerContext, entryId: number) => Promise<void>) | undefined;
  restorePrintHome?: ((context: TelegramCommandHandlerContext) => Promise<void>) | undefined;
};

type PrintSessionData = {
  origin: 'telegram_attachment' | 'storage_entry';
  storageEntryId?: number;
  storageMessageId?: number;
  fileId: string;
  filePath: string;
  pdfPath: string;
  originalFileName: string;
  mimeType: string | null;
  detectedType: 'pdf' | 'office';
  pageCount: number;
  cupsQueue: string;
  printMode: Exclude<PrintingMode, 'disabled'>;
  selectedPagesLabel?: string;
  selectedPageCount?: number;
  copies?: number;
  sides?: PrintJobSides;
  confirmedManyPages?: boolean;
  confirmedManyCopies?: boolean;
};

export async function handleTelegramPrintText(context: PrintFlowContext): Promise<boolean> {
  const text = context.messageText?.trim();
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).printing;
  const session = context.runtime.session.current;

  if (session?.flowKey === printFlowKey) {
    return continuePrintSession(context, text ?? '');
  }

  if (!text || !isPrintStartText(text, language)) {
    return false;
  }

  if (context.runtime.chat.kind !== 'private' || !context.runtime.actor.isApproved || context.runtime.actor.isBlocked) {
    return false;
  }

  if (!canActorUsePrinting(context)) {
    await context.reply(texts.noPermission);
    return true;
  }

  const settings = await resolvePrintSettingsStore(context).getSettings();
  if (settings.mode === 'disabled') {
    await context.reply(texts.disabled);
    return true;
  }

  await context.runtime.session.start({
    flowKey: printFlowKey,
    stepKey: 'file',
    data: { cupsQueue: settings.cupsQueue, printMode: settings.mode },
  });
  await context.reply(texts.askDocument, cancelKeyboard(language));
  return true;
}

export async function handleTelegramPrintMessage(context: PrintFlowContext): Promise<boolean> {
  const session = context.runtime.session.current;
  if (session?.flowKey !== printFlowKey || session.stepKey !== 'file') {
    return false;
  }

  const media = context.messageMedia;
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).printing;
  if (!media || media.attachmentKind !== 'document' || !media.fileId || !isSupportedPrintableMime(media.mimeType, media.originalFileName)) {
    await context.reply(texts.unsupportedAttachment, cancelKeyboard(language));
    return true;
  }

  if (isTooLargeForTelegramDownload(media.fileSizeBytes) && context.runtime.bot.supportsLargeFileDownload !== true) {
    await replyDownloadTooLargeAndRestoreNavigation(context, media.fileSizeBytes);
    return true;
  }

  const filePath = join(defaultTempDir, sanitizePathSegment(media.fileId));
  await mkdir(dirname(filePath), { recursive: true });
  if (!context.runtime.bot.downloadFile) {
    throw new Error('Telegram runtime does not expose file download support');
  }
  try {
    await context.runtime.bot.downloadFile({ fileId: media.fileId, destinationPath: filePath, allowLocalBotApi: true });
  } catch (error) {
    if (isTelegramFileTooLargeError(error)) {
      await replyDownloadTooLargeAndRestoreNavigation(context, media.fileSizeBytes);
      return true;
    }
    throw error;
  }

  const printService = resolvePrintService(context);
  const detectedType = isPdf(media.mimeType, media.originalFileName) ? 'pdf' : 'office';
  const pdfPath = detectedType === 'pdf'
    ? filePath
    : await printService.convertOfficeToPdf(filePath, defaultTempDir);
  const inspection = await printService.inspectPdf(pdfPath);

  const data: PrintSessionData = {
    origin: 'telegram_attachment',
    fileId: media.fileId,
    filePath,
    pdfPath,
    originalFileName: media.originalFileName ?? 'documento',
    mimeType: media.mimeType ?? null,
    detectedType,
    pageCount: inspection.pageCount,
    cupsQueue: String(session.data.cupsQueue ?? defaultPrintQueue),
    printMode: session.data.printMode === 'test' ? 'test' : 'enabled',
  };

  await context.runtime.session.advance({ stepKey: 'pages', data });
  await context.reply(formatText(texts.prepared, {
    fileName: data.originalFileName,
    pages: String(data.pageCount),
  }), pagesKeyboard(language));
  return true;
}

export async function startTelegramPrintFromStorageMessage(
  context: PrintFlowContext,
  input: {
    storageEntryId: number;
    storageMessageId: number;
    fileId: string;
    originalFileName: string | null;
    mimeType: string | null;
    fileSizeBytes: number | null;
  },
): Promise<boolean> {
  if (context.runtime.chat.kind !== 'private' || !context.runtime.actor.isApproved || context.runtime.actor.isBlocked) {
    return false;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).printing;
  if (!canActorUsePrinting(context)) {
    await context.reply(texts.noPermission);
    return true;
  }

  const settings = await resolvePrintSettingsStore(context).getSettings();
  if (settings.mode === 'disabled') {
    await context.reply(texts.disabled);
    return true;
  }

  if (isTooLargeForTelegramDownload(input.fileSizeBytes) && context.runtime.bot.supportsLargeFileDownload !== true) {
    await replyDownloadTooLargeAndRestoreNavigation(context, input.fileSizeBytes, {
      origin: 'storage_entry',
      storageEntryId: input.storageEntryId,
    });
    return true;
  }

  const filePath = join(defaultTempDir, sanitizePathSegment(input.fileId));
  await mkdir(dirname(filePath), { recursive: true });
  if (!context.runtime.bot.downloadFile) {
    throw new Error('Telegram runtime does not expose file download support');
  }
  try {
    await context.runtime.bot.downloadFile({ fileId: input.fileId, destinationPath: filePath, allowLocalBotApi: true });
  } catch (error) {
    if (isTelegramFileTooLargeError(error)) {
      await replyDownloadTooLargeAndRestoreNavigation(context, input.fileSizeBytes, {
        origin: 'storage_entry',
        storageEntryId: input.storageEntryId,
      });
      return true;
    }
    throw error;
  }

  const printService = resolvePrintService(context);
  const detectedType = isPdf(input.mimeType, input.originalFileName) ? 'pdf' : 'office';
  const pdfPath = detectedType === 'pdf'
    ? filePath
    : await printService.convertOfficeToPdf(filePath, defaultTempDir);
  const inspection = await printService.inspectPdf(pdfPath);
  const data: PrintSessionData = {
    origin: 'storage_entry',
    storageEntryId: input.storageEntryId,
    storageMessageId: input.storageMessageId,
    fileId: input.fileId,
    filePath,
    pdfPath,
    originalFileName: input.originalFileName ?? `storage-${input.storageEntryId}`,
    mimeType: input.mimeType,
    detectedType,
    pageCount: inspection.pageCount,
    cupsQueue: settings.cupsQueue,
    printMode: settings.mode,
  };

  await context.runtime.session.start({ flowKey: printFlowKey, stepKey: 'pages', data });
  await context.reply(formatText(texts.prepared, {
    fileName: data.originalFileName,
    pages: String(data.pageCount),
  }), pagesKeyboard(language));
  return true;
}

async function continuePrintSession(context: PrintFlowContext, text: string): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).printing;
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== printFlowKey) {
    return false;
  }

  const sessionData = session.data as Partial<PrintSessionData>;
  if (isPrintCancelText(text, language)) {
    await cancelPrintSession(context, sessionData);
    return true;
  }

  const data = session.data as PrintSessionData;
  if (session.stepKey === 'pages') {
    const parsed = parsePrintPageSelection(text, data.pageCount);
    if (!parsed.ok) {
      await context.reply(texts.invalidPages, pagesKeyboard(language));
      return true;
    }

    await context.runtime.session.advance({
      stepKey: 'copies',
      data: { ...data, selectedPagesLabel: parsed.label, selectedPageCount: parsed.pages.length },
    });
    await context.reply(texts.askCopies, copiesKeyboard(language));
    return true;
  }

  if (session.stepKey === 'copies') {
    const copies = Number(text);
    if (!Number.isInteger(copies) || copies < 1) {
      await context.reply(texts.invalidCopies, copiesKeyboard(language));
      return true;
    }

    await context.runtime.session.advance({ stepKey: 'sides', data: { ...data, copies } });
    await context.reply(texts.askSides, sidesKeyboard(language));
    return true;
  }

  if (session.stepKey === 'sides') {
    const sides = resolveSides(text, texts);
    if (!sides) {
      await context.reply(texts.askSides, sidesKeyboard(language));
      return true;
    }

    const nextData = { ...data, sides };
    await context.runtime.session.advance({ stepKey: 'confirm', data: nextData });
    return askNextConfirmation(context, nextData);
  }

  if (session.stepKey === 'confirm') {
    if (needsManyPagesConfirmation(data) && text === texts.confirmManyPagesButton) {
      const nextData = { ...data, confirmedManyPages: true };
      await context.runtime.session.advance({ stepKey: 'confirm', data: nextData });
      return askNextConfirmation(context, nextData);
    }

    if (needsManyCopiesConfirmation(data) && text === texts.confirmManyCopiesButton) {
      const nextData = { ...data, confirmedManyCopies: true };
      await context.runtime.session.advance({ stepKey: 'confirm', data: nextData });
      return askNextConfirmation(context, nextData);
    }

    if (text === texts.finalConfirmButton) {
      await submitPrintJob(context, data);
      return true;
    }

    await askNextConfirmation(context, data);
    return true;
  }

  return false;
}

async function askNextConfirmation(context: PrintFlowContext, data: PrintSessionData): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).printing;

  if (needsManyPagesConfirmation(data)) {
    await context.reply(texts.confirmManyPages, confirmationKeyboard(texts.confirmManyPagesButton, language));
    return true;
  }

  if (needsManyCopiesConfirmation(data)) {
    await context.reply(texts.confirmManyCopies, confirmationKeyboard(texts.confirmManyCopiesButton, language));
    return true;
  }

  await context.reply(formatText(texts.finalSummary, {
    fileName: data.originalFileName,
    pages: data.selectedPagesLabel ?? '',
    copies: String(data.copies ?? 1),
    sides: data.sides === 'two-sided-long-edge' ? texts.twoSided : texts.oneSided,
    total: String((data.selectedPageCount ?? 0) * (data.copies ?? 1)),
    queue: data.cupsQueue,
  }), confirmationKeyboard(texts.finalConfirmButton, language));
  return true;
}

async function submitPrintJob(context: PrintFlowContext, data: PrintSessionData): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).printing;
  const history = resolvePrintJobHistory(context);
  const printService = resolvePrintService(context);
  const copies = data.copies ?? 1;
  const selectedPageCount = data.selectedPageCount ?? data.pageCount;
  const job = await history.createJob({
    requestedByTelegramUserId: context.runtime.actor.telegramUserId,
    requestedByDisplayName: context.from?.username ?? String(context.runtime.actor.telegramUserId),
    origin: data.origin,
    storageEntryId: data.storageEntryId ?? null,
    storageMessageId: data.storageMessageId ?? null,
    originalFileName: data.originalFileName,
    mimeType: data.mimeType,
    detectedType: data.detectedType,
    normalizedPageCount: data.pageCount,
    selectedPagesLabel: data.selectedPagesLabel ?? `1-${data.pageCount}`,
    selectedPageCount,
    copies,
    estimatedPhysicalPages: selectedPageCount * copies,
    sides: data.sides ?? 'one-sided',
    cupsQueue: data.cupsQueue,
  });

  let completed = false;
  try {
    if (data.printMode === 'test') {
      const submittedAt = new Date().toISOString();
      await history.markSubmitted(job.id, {
        cupsJobId: 'test-mode',
        submittedAt,
      });
      await context.reply(texts.submittedTest);
      completed = true;
    } else {
      const result = await printService.submitPdfJob({
        pdfPath: data.pdfPath,
        queue: data.cupsQueue,
        copies,
        pageRanges: data.selectedPagesLabel ?? `1-${data.pageCount}`,
        sides: data.sides ?? 'one-sided',
      });
      await history.markSubmitted(job.id, {
        cupsJobId: result.cupsJobId ?? 'n/d',
        submittedAt: new Date().toISOString(),
      });
      await context.reply(formatText(texts.submitted, { cupsJobId: result.cupsJobId ?? 'n/d' }));
      completed = true;
    }
  } catch (error) {
    await history.markFailed(job.id, {
      errorMessage: error instanceof Error ? error.message : 'Unknown print error',
      completedAt: new Date().toISOString(),
    });
    throw error;
  } finally {
    await printService.cleanup([data.filePath, data.pdfPath]);
    await context.runtime.session.cancel();
  }

  if (completed) {
    await restorePostPrintNavigation(context, data);
  }
}

async function restorePostPrintNavigation(context: PrintFlowContext, data: PrintSessionData): Promise<void> {
  if (data.origin === 'storage_entry' && data.storageEntryId && context.restorePrintedStorageEntry) {
    await context.restorePrintedStorageEntry(context, data.storageEntryId);
    return;
  }

  await context.restorePrintHome?.(context);
}

async function cancelPrintSession(context: PrintFlowContext, data: Partial<PrintSessionData>): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const paths = [data.filePath, data.pdfPath].filter((path): path is string => typeof path === 'string' && path.length > 0);
  if (paths.length > 0) {
    await resolvePrintService(context).cleanup(paths);
  }

  await context.runtime.session.cancel();
  await context.reply(createTelegramI18n(language).common.flowCancelled);
  if (data.origin === 'storage_entry' && data.storageEntryId && context.restorePrintedStorageEntry) {
    await context.restorePrintedStorageEntry(context, data.storageEntryId);
    return;
  }
  await context.restorePrintHome?.(context);
}

async function replyDownloadTooLargeAndRestoreNavigation(
  context: PrintFlowContext,
  fileSizeBytes: number | null | undefined,
  data?: Partial<PrintSessionData>,
): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).printing;

  if (context.runtime.session.current?.flowKey === printFlowKey) {
    await context.runtime.session.cancel();
  }

  await context.reply(formatTelegramDownloadTooLargeMessage(texts, fileSizeBytes));

  if (data?.origin === 'storage_entry' && data.storageEntryId && context.restorePrintedStorageEntry) {
    await context.restorePrintedStorageEntry(context, data.storageEntryId);
    return;
  }

  await context.restorePrintHome?.(context);
}

function needsManyPagesConfirmation(data: PrintSessionData): boolean {
  return (data.selectedPageCount ?? 0) > 10 && data.confirmedManyPages !== true;
}

function needsManyCopiesConfirmation(data: PrintSessionData): boolean {
  return (data.copies ?? 1) > 10 && data.confirmedManyCopies !== true;
}

function resolveSides(text: string, texts: ReturnType<typeof createTelegramI18n>['printing']): PrintJobSides | null {
  if (text === texts.oneSided || /^una cara$/i.test(text) || /^one-sided$/i.test(text)) {
    return 'one-sided';
  }
  if (text === texts.twoSided || /^doble cara$/i.test(text) || /^double-sided$/i.test(text)) {
    return 'two-sided-long-edge';
  }
  return null;
}

function isPrintCancelText(text: string, language: 'ca' | 'es' | 'en'): boolean {
  return text === createTelegramI18n(language).printing.cancelButton || /^\/cancel$/i.test(text);
}

function resolvePrintSettingsStore(context: PrintFlowContext): PrintingSettingsStore {
  return context.printSettingsStore ?? createAppMetadataPrintingSettingsStore({
    storage: createDatabaseAppMetadataSessionStorage({ database: context.runtime.services.database.db }),
    defaultQueue: defaultPrintQueue,
  });
}

function resolvePrintService(context: PrintFlowContext): PrintService {
  return context.printService ?? createPrintService();
}

function resolvePrintJobHistory(context: PrintFlowContext): PrintJobHistoryRepository {
  return context.printJobHistory ?? createDatabasePrintJobHistoryRepository({
    database: context.runtime.services.database.db,
  });
}

function canActorUsePrinting(context: PrintFlowContext): boolean {
  return context.runtime.actor.isAdmin || context.runtime.authorization.can(printPermissionKey);
}

function isPrintStartText(text: string, language: 'ca' | 'es' | 'en'): boolean {
  return /^\/print(?:@\w+)?$/i.test(text) || text === createTelegramI18n(language).actionMenu.print;
}

function isTooLargeForTelegramDownload(fileSizeBytes: number | null | undefined): boolean {
  return typeof fileSizeBytes === 'number' && fileSizeBytes > telegramBotApiDownloadLimitBytes;
}

function isTelegramFileTooLargeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes('getfile') && message.includes('file is too big');
}

function formatTelegramDownloadTooLargeMessage(
  texts: ReturnType<typeof createTelegramI18n>['printing'],
  fileSizeBytes: number | null | undefined,
): string {
  return formatText(texts.downloadTooLarge, {
    size: formatPrintFileSize(fileSizeBytes, texts.unknownSize),
    limit: formatPrintFileSize(telegramBotApiDownloadLimitBytes),
  });
}

function formatPrintFileSize(fileSizeBytes: number | null | undefined, unknownLabel = 'unknown size'): string {
  if (typeof fileSizeBytes !== 'number' || !Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
    return unknownLabel;
  }
  const megabytes = fileSizeBytes / (1024 * 1024);
  return `${Number.isInteger(megabytes) ? megabytes.toFixed(0) : megabytes.toFixed(1)} MB`;
}

function isSupportedPrintableMime(mimeType: string | null | undefined, fileName: string | null | undefined): boolean {
  return isPdf(mimeType, fileName) || isOffice(mimeType, fileName);
}

function isPdf(mimeType: string | null | undefined, fileName: string | null | undefined): boolean {
  return mimeType === 'application/pdf' || Boolean(fileName?.toLowerCase().endsWith('.pdf'));
}

function isOffice(mimeType: string | null | undefined, fileName: string | null | undefined): boolean {
  const normalizedMime = mimeType?.toLowerCase() ?? '';
  const normalizedName = fileName?.toLowerCase() ?? '';
  return normalizedMime.includes('officedocument')
    || normalizedMime.includes('opendocument')
    || ['.doc', '.docx', '.odt', '.xls', '.xlsx', '.ods', '.ppt', '.pptx', '.odp']
      .some((extension) => normalizedName.endsWith(extension));
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

function pagesKeyboard(language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
  const texts = createTelegramI18n(language);
  return withKeyboard([[texts.printing.allPagesButton], [texts.printing.cancelButton]]);
}

function copiesKeyboard(language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
  const texts = createTelegramI18n(language);
  return withKeyboard([['1'], [texts.printing.cancelButton]]);
}

function sidesKeyboard(language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
  const texts = createTelegramI18n(language);
  return withKeyboard([[texts.printing.oneSided, texts.printing.twoSided], [texts.printing.cancelButton]]);
}

function confirmationKeyboard(confirmButton: string, language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
  return withKeyboard([[confirmButton], [createTelegramI18n(language).printing.cancelButton]]);
}

function cancelKeyboard(language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
  return withKeyboard([[createTelegramI18n(language).printing.cancelButton]]);
}

function withKeyboard(replyKeyboard: string[][]): TelegramReplyOptions {
  return { replyKeyboard, resizeKeyboard: true, persistentKeyboard: true };
}

function formatText(template: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, value),
    template,
  );
}
