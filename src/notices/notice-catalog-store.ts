import { and, desc, eq, gt, isNull, lt, ne, or } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { noticeAttachments, noticePublications, notices } from '../infrastructure/database/schema.js';
import type {
  NoticeAttachmentRecord,
  NoticeDetailRecord,
  NoticePublicationKind,
  NoticePublicationRecord,
  NoticeRecord,
  NoticeRepository,
  NoticeStatus,
} from './notice-catalog.js';

export function createDatabaseNoticeRepository({
  database,
}: {
  database: DatabaseConnection['db'];
}): NoticeRepository {
  return {
    async createNotice(input) {
      const created = await database
        .insert(notices)
        .values({
          createdByTelegramUserId: input.createdByTelegramUserId,
          creatorDisplayName: input.creatorDisplayName,
          text: input.text,
          textHtml: input.textHtml ?? null,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        })
        .returning();

      const notice = created[0];
      if (!notice) {
        throw new Error('Notice insert did not return a row');
      }

      const attachmentInputs = input.attachments ?? [];
      if (attachmentInputs.length > 0) {
        await database.insert(noticeAttachments).values(
          attachmentInputs.map((attachment) => ({
            noticeId: notice.id,
            sourceChatId: attachment.sourceChatId,
            sourceMessageId: attachment.sourceMessageId,
            attachmentKind: attachment.attachmentKind,
            telegramFileId: attachment.telegramFileId,
            telegramFileUniqueId: attachment.telegramFileUniqueId,
            caption: attachment.caption,
            originalFileName: attachment.originalFileName,
            mimeType: attachment.mimeType,
            fileSizeBytes: attachment.fileSizeBytes,
            mediaGroupId: attachment.mediaGroupId,
            sortOrder: attachment.sortOrder,
          })),
        );
      }

      return loadNoticeDetail(database, notice.id);
    },
    async updateNotice(input) {
      const updated = await database
        .update(notices)
        .set({
          text: input.text,
          textHtml: input.textHtml ?? null,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          updatedAt: new Date(),
        })
        .where(and(eq(notices.id, input.noticeId), eq(notices.status, 'active')))
        .returning();

      if (!updated[0]) {
        const existing = await database.select().from(notices).where(eq(notices.id, input.noticeId)).limit(1);
        return existing[0] ? loadNoticeDetail(database, input.noticeId) : null;
      }

      await database.delete(noticeAttachments).where(eq(noticeAttachments.noticeId, input.noticeId));
      const attachmentInputs = input.attachments ?? [];
      if (attachmentInputs.length > 0) {
        await database.insert(noticeAttachments).values(
          attachmentInputs.map((attachment) => ({
            noticeId: input.noticeId,
            sourceChatId: attachment.sourceChatId,
            sourceMessageId: attachment.sourceMessageId,
            attachmentKind: attachment.attachmentKind,
            telegramFileId: attachment.telegramFileId,
            telegramFileUniqueId: attachment.telegramFileUniqueId,
            caption: attachment.caption,
            originalFileName: attachment.originalFileName,
            mimeType: attachment.mimeType,
            fileSizeBytes: attachment.fileSizeBytes,
            mediaGroupId: attachment.mediaGroupId,
            sortOrder: attachment.sortOrder,
          })),
        );
      }

      return loadNoticeDetail(database, input.noticeId);
    },
    async findNoticeDetail(noticeId) {
      const rows = await database.select().from(notices).where(eq(notices.id, noticeId)).limit(1);
      if (!rows[0]) {
        return null;
      }
      return loadNoticeDetail(database, noticeId);
    },
    async listActiveNotices({ now = new Date().toISOString(), excludeCreatorTelegramUserId, creatorTelegramUserId, limit = 100 } = {}) {
      const filters = [
        eq(notices.status, 'active'),
        or(isNull(notices.expiresAt), gt(notices.expiresAt, new Date(now))),
      ];
      if (excludeCreatorTelegramUserId !== undefined) {
        filters.push(ne(notices.createdByTelegramUserId, excludeCreatorTelegramUserId));
      }
      if (creatorTelegramUserId !== undefined) {
        filters.push(eq(notices.createdByTelegramUserId, creatorTelegramUserId));
      }

      const rows = await database
        .select()
        .from(notices)
        .where(and(...filters))
        .orderBy(desc(notices.createdAt))
        .limit(limit);

      return rows.map(mapNoticeRow);
    },
    async listDueActiveNotices({ now, limit = 50 }) {
      const rows = await database
        .select()
        .from(notices)
        .where(and(eq(notices.status, 'active'), lt(notices.expiresAt, new Date(now))))
        .orderBy(desc(notices.expiresAt))
        .limit(limit);

      return Promise.all(rows.map((row) => loadNoticeDetail(database, row.id)));
    },
    async archiveNotice({ noticeId, actorTelegramUserId, reason }) {
      const now = new Date();
      const rows = await database
        .update(notices)
        .set({
          status: 'archived',
          updatedAt: now,
          archivedAt: now,
          archivedByTelegramUserId: actorTelegramUserId,
          archiveReason: reason,
        })
        .where(and(eq(notices.id, noticeId), eq(notices.status, 'active')))
        .returning();

      if (!rows[0]) {
        const existing = await database.select().from(notices).where(eq(notices.id, noticeId)).limit(1);
        return existing[0] ? loadNoticeDetail(database, noticeId) : null;
      }

      return loadNoticeDetail(database, noticeId);
    },
    async addPublication(input) {
      const rows = await database
        .insert(noticePublications)
        .values({
          noticeId: input.noticeId,
          chatId: input.chatId,
          messageThreadId: input.messageThreadId ?? 0,
          messageId: input.messageId,
          publicationKind: input.publicationKind,
          attachmentId: input.attachmentId ?? null,
        })
        .returning();
      const row = rows[0];
      if (!row) {
        throw new Error('Notice publication insert did not return a row');
      }
      return mapNoticePublicationRow(row);
    },
    async markPublicationDeleted(publicationId) {
      await database
        .update(noticePublications)
        .set({ deletedAt: new Date() })
        .where(eq(noticePublications.id, publicationId));
    },
  };
}

async function loadNoticeDetail(
  database: DatabaseConnection['db'],
  noticeId: number,
): Promise<NoticeDetailRecord> {
  const noticeRows = await database.select().from(notices).where(eq(notices.id, noticeId)).limit(1);
  const notice = noticeRows[0];
  if (!notice) {
    throw new Error(`Notice ${noticeId} not found`);
  }

  const [attachmentRows, publicationRows] = await Promise.all([
    database.select().from(noticeAttachments).where(eq(noticeAttachments.noticeId, noticeId)).orderBy(noticeAttachments.sortOrder),
    database.select().from(noticePublications).where(eq(noticePublications.noticeId, noticeId)).orderBy(noticePublications.id),
  ]);

  return {
    notice: mapNoticeRow(notice),
    attachments: attachmentRows.map(mapNoticeAttachmentRow),
    publications: publicationRows.map(mapNoticePublicationRow),
  };
}

function mapNoticeRow(row: typeof notices.$inferSelect): NoticeRecord {
  return {
    id: row.id,
    createdByTelegramUserId: row.createdByTelegramUserId,
    creatorDisplayName: row.creatorDisplayName,
    text: row.text,
    textHtml: row.textHtml ?? null,
    status: row.status as NoticeStatus,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    archivedByTelegramUserId: row.archivedByTelegramUserId ?? null,
    archiveReason: row.archiveReason ?? null,
  };
}

function mapNoticeAttachmentRow(row: typeof noticeAttachments.$inferSelect): NoticeAttachmentRecord {
  return {
    id: row.id,
    noticeId: row.noticeId,
    sourceChatId: row.sourceChatId,
    sourceMessageId: row.sourceMessageId,
    attachmentKind: row.attachmentKind,
    telegramFileId: row.telegramFileId ?? null,
    telegramFileUniqueId: row.telegramFileUniqueId ?? null,
    caption: row.caption ?? null,
    originalFileName: row.originalFileName ?? null,
    mimeType: row.mimeType ?? null,
    fileSizeBytes: row.fileSizeBytes ?? null,
    mediaGroupId: row.mediaGroupId ?? null,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapNoticePublicationRow(row: typeof noticePublications.$inferSelect): NoticePublicationRecord {
  return {
    id: row.id,
    noticeId: row.noticeId,
    chatId: row.chatId,
    messageThreadId: row.messageThreadId > 0 ? row.messageThreadId : null,
    messageId: row.messageId,
    publicationKind: row.publicationKind as NoticePublicationKind,
    attachmentId: row.attachmentId ?? null,
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}
