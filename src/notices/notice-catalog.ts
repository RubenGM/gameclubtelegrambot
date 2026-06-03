export type NoticeStatus = 'active' | 'archived';
export type NoticeArchiveReason = 'manual' | 'expired';
export type NoticePublicationKind = 'text' | 'attachment';

export interface NoticeRecord {
  id: number;
  createdByTelegramUserId: number;
  creatorDisplayName: string;
  text: string;
  textHtml: string | null;
  status: NoticeStatus;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  archivedByTelegramUserId: number | null;
  archiveReason: string | null;
}

export interface NoticeAttachmentRecord {
  id: number;
  noticeId: number;
  sourceChatId: number;
  sourceMessageId: number;
  attachmentKind: string;
  telegramFileId: string | null;
  telegramFileUniqueId: string | null;
  caption: string | null;
  originalFileName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  mediaGroupId: string | null;
  sortOrder: number;
  createdAt: string;
}

export interface NoticePublicationRecord {
  id: number;
  noticeId: number;
  chatId: number;
  messageThreadId: number | null;
  messageId: number;
  publicationKind: NoticePublicationKind;
  attachmentId: number | null;
  createdAt: string;
  deletedAt: string | null;
}

export interface NoticeDetailRecord {
  notice: NoticeRecord;
  attachments: NoticeAttachmentRecord[];
  publications: NoticePublicationRecord[];
}

export interface NoticeRepository {
  createNotice(input: {
    createdByTelegramUserId: number;
    creatorDisplayName: string;
    text: string;
    textHtml?: string | null;
    expiresAt?: string | null;
    attachments?: Array<Omit<NoticeAttachmentRecord, 'id' | 'noticeId' | 'createdAt'>>;
  }): Promise<NoticeDetailRecord>;
  findNoticeDetail(noticeId: number): Promise<NoticeDetailRecord | null>;
  listActiveNotices(input?: {
    now?: string;
    excludeCreatorTelegramUserId?: number;
    creatorTelegramUserId?: number;
    limit?: number;
  }): Promise<NoticeRecord[]>;
  listDueActiveNotices(input: { now: string; limit?: number }): Promise<NoticeDetailRecord[]>;
  archiveNotice(input: {
    noticeId: number;
    actorTelegramUserId: number | null;
    reason: NoticeArchiveReason;
  }): Promise<NoticeDetailRecord | null>;
  addPublication(input: {
    noticeId: number;
    chatId: number;
    messageThreadId?: number | null;
    messageId: number;
    publicationKind: NoticePublicationKind;
    attachmentId?: number | null;
  }): Promise<NoticePublicationRecord>;
  markPublicationDeleted(publicationId: number): Promise<void>;
}

export async function createNotice({
  repository,
  createdByTelegramUserId,
  creatorDisplayName,
  text,
  textHtml,
  expiresAt,
  attachments = [],
}: {
  repository: NoticeRepository;
  createdByTelegramUserId: number;
  creatorDisplayName: string;
  text: string;
  textHtml?: string | null;
  expiresAt?: string | null;
  attachments?: Array<Omit<NoticeAttachmentRecord, 'id' | 'noticeId' | 'createdAt'>>;
}): Promise<NoticeDetailRecord> {
  return repository.createNotice({
    createdByTelegramUserId: normalizeTelegramUserId(createdByTelegramUserId, 'creador'),
    creatorDisplayName: normalizeRequiredText(creatorDisplayName, 'creatorDisplayName').slice(0, 255),
    text: normalizeRequiredText(text, 'text'),
    textHtml: normalizeOptionalText(textHtml),
    expiresAt: normalizeOptionalIsoDate(expiresAt),
    attachments,
  });
}

export function canArchiveNotice({
  notice,
  actorTelegramUserId,
  isAdmin,
}: {
  notice: NoticeRecord;
  actorTelegramUserId: number;
  isAdmin: boolean;
}): boolean {
  return isAdmin || notice.createdByTelegramUserId === actorTelegramUserId;
}

function normalizeTelegramUserId(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} ha de ser un Telegram user ID positiu`);
  }
  return value;
}

function normalizeRequiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} es obligatorio`);
  }
  return normalized;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeOptionalIsoDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('expiresAt debe ser una fecha ISO válida');
  }
  return date.toISOString();
}
