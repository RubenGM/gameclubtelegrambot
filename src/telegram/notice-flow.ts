import { appendAuditEvent } from '../audit/audit-log.js';
import { createDatabaseAuditLogRepository } from '../audit/audit-log-store.js';
import { createDatabaseMembershipAccessRepository } from '../membership/access-flow-store.js';
import { resolveTelegramDisplayName } from '../membership/display-name.js';
import { createNotice, canArchiveNotice, type NoticeAttachmentRecord, type NoticeDetailRecord, type NoticeRecord, type NoticeRepository } from '../notices/notice-catalog.js';
import { createDatabaseNoticeRepository } from '../notices/notice-catalog-store.js';
import { deleteNoticePublications, publishNoticeToSubscribedTargets } from '../notices/notice-publication.js';
import { createDatabaseNewsGroupRepository } from '../news/news-group-store.js';
import { noticesNewsGroupCategory } from '../news/news-group-catalog.js';
import { createTelegramI18n, normalizeBotLanguage, type BotLanguage } from './i18n.js';
import { renderTelegramMessageTextAsHtml } from './telegram-entity-html.js';
import { parseDate, parseDurationHours, parseDurationHoursMinutes, parseOptionalDurationMinutes } from './schedule-parsing.js';
import { buildCreateDurationOptions, buildDateOptions, buildSingleBackCancelKeyboard, scheduleLabels } from './schedule-keyboards.js';
import { escapeHtml } from './schedule-presentation.js';
import type { TelegramCommandHandlerContext, TelegramCommandRuntime } from './command-registry.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

export const noticeFlowKey = 'notices';

export const noticeCallbackPrefixes = {
  archiveConfirm: 'notice:archive_confirm:',
  archive: 'notice:archive:',
} as const;

type NoticeFlowContext = TelegramCommandHandlerContext & {
  noticeRepository?: NoticeRepository;
};

type DraftAttachment = Omit<NoticeAttachmentRecord, 'id' | 'noticeId' | 'createdAt'>;

export async function handleTelegramNoticeCommand(context: TelegramCommandHandlerContext): Promise<void> {
  await sendNoticeMenu(context as NoticeFlowContext);
}

export async function handleTelegramNoticeText(context: TelegramCommandHandlerContext): Promise<boolean> {
  const flowContext = context as NoticeFlowContext;
  if (flowContext.runtime.chat.kind !== 'private' || !flowContext.runtime.actor.isApproved || flowContext.runtime.actor.isBlocked) {
    return false;
  }

  const language = normalizeBotLanguage(flowContext.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).notices;
  const text = flowContext.messageText?.trim();
  if (!text) {
    return false;
  }

  if (text === texts.openMenu || text === '/notices' || text === '/avisos') {
    await sendNoticeMenu(flowContext);
    return true;
  }

  if (text === texts.create) {
    await startNoticeCreate(flowContext);
    return true;
  }

  const session = flowContext.runtime.session.current;
  if (session?.flowKey !== noticeFlowKey) {
    return false;
  }

  if (session.stepKey === 'text') {
    if (!text) {
      await flowContext.reply(texts.invalidText, buildNoticeCancelOptions());
      return true;
    }
    await flowContext.runtime.session.advance({
      stepKey: 'attachments',
      data: {
        text,
        textHtml: renderTelegramMessageTextAsHtml(text, flowContext.messageEntities),
        attachments: [],
      },
    });
    await flowContext.reply(texts.askAttachments, buildNoticeAttachmentOptions(language));
    return true;
  }

  if (session.stepKey === 'attachments') {
    if (text === texts.continueWithoutMoreAttachments || text === texts.noAttachments) {
      await flowContext.runtime.session.advance({ stepKey: 'duration-mode', data: session.data });
      await flowContext.reply(texts.askDurationMode, buildNoticeDurationModeOptions(language));
      return true;
    }
    await flowContext.reply(texts.askAttachments, buildNoticeAttachmentOptions(language));
    return true;
  }

  if (session.stepKey === 'duration-mode') {
    if (text === texts.durationPermanent) {
      return replyNoticeCreateConfirm(flowContext, { ...session.data, expiresAt: null });
    }
    if (text === texts.durationHours) {
      await flowContext.runtime.session.advance({ stepKey: 'duration-kind', data: session.data });
      await flowContext.reply(texts.askDurationKind, buildCreateDurationOptions(language));
      return true;
    }
    if (text === texts.durationUntilDay) {
      await flowContext.runtime.session.advance({ stepKey: 'until-date', data: session.data });
      await flowContext.reply(texts.askUntilDate, buildDateOptions(language));
      return true;
    }
    await flowContext.reply(texts.askDurationMode, buildNoticeDurationModeOptions(language));
    return true;
  }

  if (session.stepKey === 'duration-kind') {
    if (text === createTelegramI18n(language).schedule.durationHours || text === scheduleLabels.durationHours) {
      await flowContext.runtime.session.advance({ stepKey: 'duration-hours', data: session.data });
      await flowContext.reply(texts.askDurationHours, buildSingleBackCancelKeyboard(language));
      return true;
    }
    if (text === createTelegramI18n(language).schedule.durationHoursMinutes || text === scheduleLabels.durationHoursMinutes) {
      await flowContext.runtime.session.advance({ stepKey: 'duration-hours-minutes', data: session.data });
      await flowContext.reply(texts.askDurationHoursMinutes, buildSingleBackCancelKeyboard(language));
      return true;
    }
    if (text === createTelegramI18n(language).schedule.durationMinutes || text === scheduleLabels.durationMinutes) {
      await flowContext.runtime.session.advance({ stepKey: 'duration-minutes', data: session.data });
      await flowContext.reply(texts.askDurationMinutes, buildSingleBackCancelKeyboard(language));
      return true;
    }
    await flowContext.reply(texts.askDurationKind, buildCreateDurationOptions(language));
    return true;
  }

  if (session.stepKey === 'duration-hours') {
    const durationMinutes = parseDurationHours(text);
    return handleDurationMinutes(flowContext, session.data, durationMinutes, language);
  }

  if (session.stepKey === 'duration-hours-minutes') {
    const durationMinutes = parseDurationHoursMinutes(text);
    return handleDurationMinutes(flowContext, session.data, durationMinutes, language);
  }

  if (session.stepKey === 'duration-minutes') {
    const durationMinutes = parseOptionalDurationMinutes({
      value: text,
      language,
      skipOptionalLabels: [],
      defaultDurationMinutes: 0,
    });
    return handleDurationMinutes(flowContext, session.data, durationMinutes, language);
  }

  if (session.stepKey === 'until-date') {
    const date = parseDate(text);
    if (date instanceof Error) {
      await flowContext.reply(texts.invalidDate, buildDateOptions(language));
      return true;
    }
    return replyNoticeCreateConfirm(flowContext, { ...session.data, expiresAt: buildLocalEndOfDayIso(date) });
  }

  if (session.stepKey === 'confirm') {
    if (text === texts.editText) {
      await flowContext.runtime.session.advance({ stepKey: 'text', data: session.data });
      await flowContext.reply(texts.askText, buildNoticeCancelOptions());
      return true;
    }
    if (text === texts.editAttachments) {
      await flowContext.runtime.session.advance({ stepKey: 'attachments', data: { ...session.data, attachments: [] } });
      await flowContext.reply(texts.askAttachments, buildNoticeAttachmentOptions(language));
      return true;
    }
    if (text === texts.editDuration) {
      await flowContext.runtime.session.advance({ stepKey: 'duration-mode', data: session.data });
      await flowContext.reply(texts.askDurationMode, buildNoticeDurationModeOptions(language));
      return true;
    }
    if (text !== texts.confirmCreate) {
      await flowContext.reply(texts.confirmPrompt, buildNoticeConfirmOptions(language));
      return true;
    }
    await completeNoticeCreate(flowContext, session.data, language);
    return true;
  }

  return false;
}

export async function handleTelegramNoticeMessage(context: TelegramCommandHandlerContext): Promise<boolean> {
  const flowContext = context as NoticeFlowContext;
  if (flowContext.runtime.chat.kind !== 'private') {
    return false;
  }

  const session = flowContext.runtime.session.current;
  const media = flowContext.messageMedia;
  if (session?.flowKey !== noticeFlowKey || session.stepKey !== 'attachments' || !media || !isSupportedNoticeAttachmentKind(media.attachmentKind)) {
    return false;
  }

  const language = normalizeBotLanguage(flowContext.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).notices;
  const attachments = asDraftAttachments(session.data.attachments);
  attachments.push({
    sourceChatId: flowContext.runtime.chat.chatId,
    sourceMessageId: media.messageId,
    attachmentKind: media.attachmentKind,
    telegramFileId: media.fileId ?? null,
    telegramFileUniqueId: media.fileUniqueId ?? null,
    caption: media.caption ?? null,
    originalFileName: media.originalFileName ?? null,
    mimeType: media.mimeType ?? null,
    fileSizeBytes: media.fileSizeBytes ?? null,
    mediaGroupId: media.mediaGroupId ?? null,
    sortOrder: attachments.length,
  });

  await flowContext.runtime.session.advance({
    stepKey: 'attachments',
    data: { ...session.data, attachments },
  });
  await flowContext.reply(texts.addAnotherAttachment, buildNoticeAttachmentOptions(language));
  return true;
}

export async function handleTelegramNoticeCallback(context: TelegramCommandHandlerContext): Promise<boolean> {
  const callbackData = context.callbackData ?? '';
  if (callbackData.startsWith(noticeCallbackPrefixes.archiveConfirm)) {
    await sendNoticeArchiveConfirmation(context as NoticeFlowContext, parseNoticeCallbackId(callbackData, noticeCallbackPrefixes.archiveConfirm));
    return true;
  }
  if (callbackData.startsWith(noticeCallbackPrefixes.archive)) {
    await archiveNoticeFromTelegram(context as NoticeFlowContext, parseNoticeCallbackId(callbackData, noticeCallbackPrefixes.archive));
    return true;
  }
  return false;
}

export async function buildNoticeStartSummary(
  context: TelegramCommandHandlerContext,
  language: BotLanguage,
): Promise<string | null> {
  let notices: NoticeRecord[];
  try {
    notices = await resolveNoticeRepository(context as NoticeFlowContext).listActiveNotices({ limit: 3 });
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'notices.start-summary.failed',
      error: error instanceof Error ? error.message : String(error),
    }));
    return null;
  }
  if (notices.length === 0) {
    return null;
  }
  const texts = createTelegramI18n(language).notices;
  return [
    `<b>${escapeHtml(texts.startSummaryHeader)}</b>`,
    ...notices.map((notice) => formatNoticeSummaryLine(notice, language)),
  ].join('\n');
}

async function sendNoticeMenu(context: NoticeFlowContext): Promise<void> {
  await context.runtime.session.cancel();
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const repository = resolveNoticeRepository(context);
  const [own, others] = await Promise.all([
    repository.listActiveNotices({ creatorTelegramUserId: context.runtime.actor.telegramUserId }),
    repository.listActiveNotices({ excludeCreatorTelegramUserId: context.runtime.actor.telegramUserId }),
  ]);

  if (own.length > 0) {
    const inlineKeyboard = buildNoticeArchiveButtons(own, context);
    await context.reply(formatNoticeListMessage({
      header: createTelegramI18n(language).notices.ownHeader,
      empty: createTelegramI18n(language).notices.noOwnNotices,
      notices: own,
      language,
    }), {
      parseMode: 'HTML',
      ...(inlineKeyboard ? { inlineKeyboard } : {}),
      ...buildNoticeMenuOptions(language),
    });
  }

  const otherInlineKeyboard = buildNoticeArchiveButtons(others, context);
  await context.reply(formatNoticeListMessage({
    header: createTelegramI18n(language).notices.otherHeader,
    empty: createTelegramI18n(language).notices.noOtherNotices,
    notices: others,
    language,
  }), {
    parseMode: 'HTML',
    ...(otherInlineKeyboard ? { inlineKeyboard: otherInlineKeyboard } : {}),
    ...buildNoticeMenuOptions(language),
  });
}

async function startNoticeCreate(context: NoticeFlowContext): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).notices;
  const destinations = await createDatabaseNewsGroupRepository({
    database: context.runtime.services.database.db,
  }).listSubscribedGroupsByCategory(noticesNewsGroupCategory);
  if (destinations.length === 0) {
    await context.reply(texts.noDestinations, buildNoticeMenuOptions(language));
    return;
  }

  await context.runtime.session.start({
    flowKey: noticeFlowKey,
    stepKey: 'text',
    data: {},
  });
  await context.reply(texts.askText, buildNoticeCancelOptions());
}

async function handleDurationMinutes(
  context: NoticeFlowContext,
  data: Record<string, unknown>,
  durationMinutes: number | Error,
  language: BotLanguage,
): Promise<boolean> {
  const texts = createTelegramI18n(language).notices;
  if (durationMinutes instanceof Error || durationMinutes <= 0) {
    await context.reply(texts.invalidDuration, buildSingleBackCancelKeyboard(language));
    return true;
  }

  return replyNoticeCreateConfirm(context, {
    ...data,
    expiresAt: new Date(Date.now() + durationMinutes * 60_000).toISOString(),
  });
}

async function replyNoticeCreateConfirm(context: NoticeFlowContext, data: Record<string, unknown>): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).notices;
  await context.runtime.session.advance({ stepKey: 'confirm', data });
  await context.reply(`${texts.confirmPrompt}\n\n${formatNoticeDraftSummary(data, language)}`, {
    parseMode: 'HTML',
    ...buildNoticeConfirmOptions(language),
  });
  return true;
}

async function completeNoticeCreate(
  context: NoticeFlowContext,
  data: Record<string, unknown>,
  language: BotLanguage,
): Promise<void> {
  const texts = createTelegramI18n(language).notices;
  const repository = resolveNoticeRepository(context);
  const displayName = await resolveCreatorDisplayName(context);
  const detail = await createNotice({
    repository,
    createdByTelegramUserId: context.runtime.actor.telegramUserId,
    creatorDisplayName: displayName,
    text: String(data.text ?? ''),
    textHtml: typeof data.textHtml === 'string' ? data.textHtml : null,
    expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : null,
    attachments: asDraftAttachments(data.attachments),
  });
  await appendAuditEvent({
    repository: createDatabaseAuditLogRepository({ database: context.runtime.services.database.db }),
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    actionKey: 'notice.created',
    targetType: 'notice',
    targetId: detail.notice.id,
    summary: 'Aviso creado',
    details: {
      expiresAt: detail.notice.expiresAt,
      attachmentCount: detail.attachments.length,
    },
  });
  const result = await publishNoticeToSubscribedTargets({
    detail,
    noticeRepository: repository,
    newsGroupRepository: createDatabaseNewsGroupRepository({ database: context.runtime.services.database.db }),
    telegram: context.runtime.bot,
    auditRepository: createDatabaseAuditLogRepository({ database: context.runtime.services.database.db }),
  });
  await context.runtime.session.cancel();
  await context.reply(
    texts.created
      .replace('{targets}', String(result.targets))
      .replace('{sent}', String(result.sentMessages))
      .replace('{failures}', String(result.failures)),
    buildNoticeMenuOptions(language),
  );
  await sendNoticeMenu(context);
}

async function sendNoticeArchiveConfirmation(context: NoticeFlowContext, noticeId: number): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).notices;
  const detail = await resolveNoticeRepository(context).findNoticeDetail(noticeId);
  if (!detail) {
    await context.reply(texts.notFound, buildNoticeMenuOptions(language));
    return;
  }
  if (!canArchiveNotice({
    notice: detail.notice,
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    isAdmin: context.runtime.actor.isAdmin,
  })) {
    await context.reply(texts.cannotArchive, buildNoticeMenuOptions(language));
    return;
  }

  await context.reply(`${texts.archivePrompt}\n\n${formatNoticeSummaryLine(detail.notice, language)}`, {
    parseMode: 'HTML',
    inlineKeyboard: [[{ text: texts.archiveConfirm, callbackData: `${noticeCallbackPrefixes.archive}${noticeId}`, semanticRole: 'danger' }]],
    ...buildNoticeMenuOptions(language),
  });
}

async function archiveNoticeFromTelegram(context: NoticeFlowContext, noticeId: number): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).notices;
  const repository = resolveNoticeRepository(context);
  const current = await repository.findNoticeDetail(noticeId);
  if (!current) {
    await context.reply(texts.notFound, buildNoticeMenuOptions(language));
    return;
  }
  if (!canArchiveNotice({
    notice: current.notice,
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    isAdmin: context.runtime.actor.isAdmin,
  })) {
    await context.reply(texts.cannotArchive, buildNoticeMenuOptions(language));
    return;
  }

  const archived = await repository.archiveNotice({
    noticeId,
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    reason: 'manual',
  });
  if (!archived) {
    await context.reply(texts.notFound, buildNoticeMenuOptions(language));
    return;
  }

  const deletion = await deleteNoticePublications({
    detail: archived,
    noticeRepository: repository,
    telegram: context.runtime.bot,
  });
  await appendAuditEvent({
    repository: createDatabaseAuditLogRepository({ database: context.runtime.services.database.db }),
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    actionKey: 'notice.archived',
    targetType: 'notice',
    targetId: archived.notice.id,
    summary: 'Aviso archivado manualmente',
    details: {
      deletedMessages: deletion.deleted,
      deleteFailures: deletion.failures,
    },
  });
  await context.reply(
    texts.archived
      .replace('{deleted}', String(deletion.deleted))
      .replace('{failures}', String(deletion.failures)),
    buildNoticeMenuOptions(language),
  );
  await sendNoticeMenu(context);
}

function formatNoticeListMessage({
  header,
  empty,
  notices,
  language,
}: {
  header: string;
  empty: string;
  notices: NoticeRecord[];
  language: BotLanguage;
}): string {
  return [
    `<b>${escapeHtml(header)}</b>`,
    ...(notices.length === 0 ? [escapeHtml(empty)] : notices.map((notice) => formatNoticeSummaryLine(notice, language))),
  ].join('\n');
}

function formatNoticeSummaryLine(notice: NoticeRecord, language: BotLanguage): string {
  const attachmentSuffix = '';
  const expiry = notice.expiresAt ? ` · hasta ${formatNoticeDateTime(notice.expiresAt, language)}` : ' · permanente';
  return `- <b>#${notice.id}</b> ${escapeHtml(truncateNoticeText(notice.text))} · ${escapeHtml(notice.creatorDisplayName)}${escapeHtml(expiry)}${attachmentSuffix}`;
}

function formatNoticeDraftSummary(data: Record<string, unknown>, language: BotLanguage): string {
  const attachments = asDraftAttachments(data.attachments);
  const textHtml = typeof data.textHtml === 'string' ? data.textHtml : escapeHtml(String(data.text ?? ''));
  const expiresAt = typeof data.expiresAt === 'string' ? data.expiresAt : null;
  return [
    `<b>${escapeHtml(createTelegramI18n(language).notices.openMenu)}</b>`,
    textHtml,
    `<b>Duración:</b> ${escapeHtml(expiresAt ? formatNoticeDateTime(expiresAt, language) : createTelegramI18n(language).notices.durationPermanent)}`,
    `<b>Adjuntos:</b> ${attachments.length}`,
  ].join('\n\n');
}

function buildNoticeArchiveButtons(notices: NoticeRecord[], context: NoticeFlowContext) {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).notices;
  const rows = notices
    .filter((notice) => canArchiveNotice({
      notice,
      actorTelegramUserId: context.runtime.actor.telegramUserId,
      isAdmin: context.runtime.actor.isAdmin,
    }))
    .slice(0, 8)
    .map((notice) => [{ text: `${texts.archiveButton} #${notice.id}`, callbackData: `${noticeCallbackPrefixes.archiveConfirm}${notice.id}`, semanticRole: 'danger' as const }]);
  return rows.length > 0 ? rows : undefined;
}

function buildNoticeMenuOptions(language: BotLanguage): TelegramReplyOptions {
  const texts = createTelegramI18n(language).notices;
  return {
    replyKeyboard: [[texts.create], [createTelegramI18n(language).common.backToStartButton]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildNoticeCancelOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [['/cancel']],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildNoticeAttachmentOptions(language: BotLanguage): TelegramReplyOptions {
  const texts = createTelegramI18n(language).notices;
  return {
    replyKeyboard: [[texts.continueWithoutMoreAttachments, texts.noAttachments], ['/cancel']],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildNoticeDurationModeOptions(language: BotLanguage): TelegramReplyOptions {
  const texts = createTelegramI18n(language).notices;
  return {
    replyKeyboard: [[texts.durationPermanent], [texts.durationHours, texts.durationUntilDay], ['/cancel']],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildNoticeConfirmOptions(language: BotLanguage): TelegramReplyOptions {
  const texts = createTelegramI18n(language).notices;
  return {
    replyKeyboard: [[texts.editText, texts.editAttachments], [texts.editDuration], [texts.confirmCreate], ['/cancel']],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function resolveNoticeRepository(context: NoticeFlowContext): NoticeRepository {
  return context.noticeRepository ?? createDatabaseNoticeRepository({ database: context.runtime.services.database.db });
}

async function resolveCreatorDisplayName(context: NoticeFlowContext): Promise<string> {
  const repository = createDatabaseMembershipAccessRepository({
    database: context.runtime.services.database.db,
  });
  const user = await repository.findUserByTelegramUserId(context.runtime.actor.telegramUserId);
  return user?.displayName ?? resolveTelegramDisplayName(context.from);
}

function asDraftAttachments(value: unknown): DraftAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): DraftAttachment[] => {
    if (!item || typeof item !== 'object') {
      return [];
    }
    const candidate = item as Partial<DraftAttachment>;
    if (
      typeof candidate.sourceChatId !== 'number' ||
      typeof candidate.sourceMessageId !== 'number' ||
      typeof candidate.attachmentKind !== 'string' ||
      typeof candidate.sortOrder !== 'number'
    ) {
      return [];
    }
    return [{
      sourceChatId: candidate.sourceChatId,
      sourceMessageId: candidate.sourceMessageId,
      attachmentKind: candidate.attachmentKind,
      telegramFileId: candidate.telegramFileId ?? null,
      telegramFileUniqueId: candidate.telegramFileUniqueId ?? null,
      caption: candidate.caption ?? null,
      originalFileName: candidate.originalFileName ?? null,
      mimeType: candidate.mimeType ?? null,
      fileSizeBytes: candidate.fileSizeBytes ?? null,
      mediaGroupId: candidate.mediaGroupId ?? null,
      sortOrder: candidate.sortOrder,
    }];
  });
}

function isSupportedNoticeAttachmentKind(value: string): boolean {
  return value === 'document' || value === 'photo' || value === 'video' || value === 'audio' || value === 'animation';
}

function parseNoticeCallbackId(callbackData: string, prefix: string): number {
  const value = Number(callbackData.slice(prefix.length));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('No se ha podido identificar el aviso.');
  }
  return value;
}

function buildLocalEndOfDayIso(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) {
    throw new Error('invalid-date');
  }
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
}

function truncateNoticeText(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 96 ? `${normalized.slice(0, 93)}...` : normalized;
}

function formatNoticeDateTime(value: string, language: BotLanguage): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const locale = language === 'ca' ? 'ca-ES' : language === 'es' ? 'es-ES' : 'en-GB';
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'Europe/Madrid',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function runtimeHasNoticePublishCapabilities(runtime: TelegramCommandRuntime): boolean {
  return Boolean(runtime.bot.sendGroupMessage && (runtime.bot.copyMessage || runtime.bot.forwardMessage));
}
