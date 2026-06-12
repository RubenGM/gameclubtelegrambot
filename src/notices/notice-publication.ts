import type { AuditLogRepository } from '../audit/audit-log.js';
import { appendAuditEvent } from '../audit/audit-log.js';
import { noticesNewsGroupCategory, type NewsGroupRepository } from '../news/news-group-catalog.js';
import type { TelegramReplyOptions, TelegramSentMessage } from '../telegram/runtime-boundary.js';
import { escapeHtml } from '../telegram/schedule-presentation.js';
import type { NoticeDetailRecord, NoticeRepository, NoticePublicationRecord } from './notice-catalog.js';

export const telegramNoticePublicationMaxLength = 4096;

export interface NoticeTelegramPublisher {
  sendGroupMessage?(chatId: number, message: string, options?: TelegramReplyOptions): Promise<TelegramSentMessage | void>;
  copyMessage?(input: { fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }): Promise<{ messageId: number }>;
  forwardMessage?(input: { fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }): Promise<{ messageId: number }>;
  deleteMessage?(input: { chatId: number; messageId: number }): Promise<void>;
}

export async function publishNoticeToSubscribedTargets({
  detail,
  noticeRepository,
  newsGroupRepository,
  telegram,
  auditRepository,
}: {
  detail: NoticeDetailRecord;
  noticeRepository: NoticeRepository;
  newsGroupRepository: NewsGroupRepository;
  telegram: NoticeTelegramPublisher;
  auditRepository?: AuditLogRepository;
}): Promise<{ targets: number; sentMessages: number; failures: number }> {
  assertNoticePublicationMessageLength(detail);
  const targets = await newsGroupRepository.listSubscribedGroupsByCategory(noticesNewsGroupCategory);
  if (!telegram.sendGroupMessage || targets.length === 0) {
    return { targets: targets.length, sentMessages: 0, failures: 0 };
  }

  let sentMessages = 0;
  let failures = 0;
  for (const target of targets) {
    try {
      const sent = await telegram.sendGroupMessage(target.chatId, formatNoticePublicationMessage(detail), {
        parseMode: 'HTML',
        ...(target.messageThreadId ? { messageThreadId: target.messageThreadId } : {}),
      });
      if (sent?.messageId) {
        await noticeRepository.addPublication({
          noticeId: detail.notice.id,
          chatId: target.chatId,
          messageThreadId: target.messageThreadId,
          messageId: sent.messageId,
          publicationKind: 'text',
        });
        sentMessages += 1;
      }

      for (const attachment of detail.attachments) {
        const copied = await transferNoticeAttachment({
          telegram,
          fromChatId: attachment.sourceChatId,
          messageId: attachment.sourceMessageId,
          toChatId: target.chatId,
          ...(target.messageThreadId ? { messageThreadId: target.messageThreadId } : {}),
        });
        await noticeRepository.addPublication({
          noticeId: detail.notice.id,
          chatId: target.chatId,
          messageThreadId: target.messageThreadId,
          messageId: copied.messageId,
          publicationKind: 'attachment',
          attachmentId: attachment.id,
        });
        sentMessages += 1;
      }
    } catch (error) {
      failures += 1;
      console.warn(JSON.stringify({
        event: 'notices.publish.target.failed',
        noticeId: detail.notice.id,
        chatId: target.chatId,
        messageThreadId: target.messageThreadId,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  if (auditRepository) {
    await appendAuditEvent({
      repository: auditRepository,
      actorTelegramUserId: detail.notice.createdByTelegramUserId,
      actionKey: 'notice.published',
      targetType: 'notice',
      targetId: detail.notice.id,
      summary: 'Aviso publicado en destinos suscritos',
      details: { targets: targets.length, sentMessages, failures },
    });
  }

  return { targets: targets.length, sentMessages, failures };
}

export async function deleteNoticePublications({
  detail,
  noticeRepository,
  telegram,
}: {
  detail: NoticeDetailRecord;
  noticeRepository: NoticeRepository;
  telegram: NoticeTelegramPublisher;
}): Promise<{ deleted: number; failures: number }> {
  if (!telegram.deleteMessage) {
    return { deleted: 0, failures: 0 };
  }

  let deleted = 0;
  let failures = 0;
  for (const publication of detail.publications.filter((item) => item.deletedAt === null)) {
    try {
      await telegram.deleteMessage({ chatId: publication.chatId, messageId: publication.messageId });
      await noticeRepository.markPublicationDeleted(publication.id);
      deleted += 1;
    } catch (error) {
      failures += 1;
      logNoticeDeleteFailure(detail, publication, error);
    }
  }

  return { deleted, failures };
}

export function formatNoticePublicationMessage(detail: NoticeDetailRecord): string {
  return formatNoticePublicationPayload({
    text: detail.notice.text,
    textHtml: detail.notice.textHtml,
    creatorDisplayName: detail.notice.creatorDisplayName,
  });
}

export function formatNoticePublicationPayload({
  text,
  textHtml,
  creatorDisplayName,
}: {
  text: string;
  textHtml?: string | null | undefined;
  creatorDisplayName: string;
}): string {
  const body = textHtml ?? escapeHtml(text);
  const footer = `<i>Aviso de ${escapeHtml(creatorDisplayName)}</i>`;
  return [`<b>Aviso</b>`, body, footer].join('\n\n');
}

export function validateNoticePublicationMessageLength(detail: NoticeDetailRecord): { valid: true; length: number; maxLength: number } | { valid: false; length: number; maxLength: number } {
  return validateNoticePublicationPayloadLength({
    text: detail.notice.text,
    textHtml: detail.notice.textHtml,
    creatorDisplayName: detail.notice.creatorDisplayName,
  });
}

export function validateNoticePublicationPayloadLength({
  text,
  textHtml,
  creatorDisplayName,
}: {
  text: string;
  textHtml?: string | null | undefined;
  creatorDisplayName: string;
}): { valid: true; length: number; maxLength: number } | { valid: false; length: number; maxLength: number } {
  const length = formatNoticePublicationPayload({ text, textHtml, creatorDisplayName }).length;
  if (length > telegramNoticePublicationMaxLength) {
    return { valid: false, length, maxLength: telegramNoticePublicationMaxLength };
  }
  return { valid: true, length, maxLength: telegramNoticePublicationMaxLength };
}

export function assertNoticePublicationMessageLength(detail: NoticeDetailRecord): void {
  const result = validateNoticePublicationMessageLength(detail);
  if (!result.valid) {
    throw new Error(`Notice publication message is too long: ${result.length}/${result.maxLength}`);
  }
}

function transferNoticeAttachment({
  telegram,
  fromChatId,
  messageId,
  toChatId,
  messageThreadId,
}: {
  telegram: NoticeTelegramPublisher;
  fromChatId: number;
  messageId: number;
  toChatId: number;
  messageThreadId?: number;
}): Promise<{ messageId: number }> {
  const input = {
    fromChatId,
    messageId,
    toChatId,
    ...(messageThreadId ? { messageThreadId } : {}),
  };
  if (telegram.copyMessage) {
    return telegram.copyMessage(input);
  }
  if (telegram.forwardMessage) {
    return telegram.forwardMessage(input);
  }
  throw new Error('Telegram runtime does not support copyMessage or forwardMessage');
}

function formatNoticeDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function logNoticeDeleteFailure(detail: NoticeDetailRecord, publication: NoticePublicationRecord, error: unknown): void {
  console.warn(JSON.stringify({
    event: 'notices.publication-delete.failed',
    noticeId: detail.notice.id,
    publicationId: publication.id,
    chatId: publication.chatId,
    messageThreadId: publication.messageThreadId,
    messageId: publication.messageId,
    error: error instanceof Error ? error.message : String(error),
  }));
}
