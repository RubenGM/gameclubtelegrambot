import type { AuditLogRepository } from '../audit/audit-log.js';
import { appendAuditEvent } from '../audit/audit-log.js';
import type { NoticeRepository } from './notice-catalog.js';
import { deleteNoticePublications, type NoticeTelegramPublisher } from './notice-publication.js';

export async function expireDueNotices({
  noticeRepository,
  telegram,
  auditRepository,
  now = new Date(),
  limit = 50,
}: {
  noticeRepository: NoticeRepository;
  telegram: NoticeTelegramPublisher;
  auditRepository?: AuditLogRepository;
  now?: Date;
  limit?: number;
}): Promise<{ archived: number; deletedMessages: number; deleteFailures: number }> {
  const due = await noticeRepository.listDueActiveNotices({ now: now.toISOString(), limit });
  let archived = 0;
  let deletedMessages = 0;
  let deleteFailures = 0;

  for (const detail of due) {
    const archivedDetail = await noticeRepository.archiveNotice({
      noticeId: detail.notice.id,
      actorTelegramUserId: null,
      reason: 'expired',
    });
    if (!archivedDetail || archivedDetail.notice.status !== 'archived') {
      continue;
    }

    archived += 1;
    const deletion = await deleteNoticePublications({
      detail: archivedDetail,
      noticeRepository,
      telegram,
    });
    deletedMessages += deletion.deleted;
    deleteFailures += deletion.failures;

    if (auditRepository) {
      await appendAuditEvent({
        repository: auditRepository,
        actorTelegramUserId: null,
        actionKey: 'notice.expired',
        targetType: 'notice',
        targetId: archivedDetail.notice.id,
        summary: 'Aviso expirado automáticamente',
        details: {
          deletedMessages: deletion.deleted,
          deleteFailures: deletion.failures,
        },
      });
    }
  }

  return { archived, deletedMessages, deleteFailures };
}
