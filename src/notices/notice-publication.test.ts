import test from 'node:test';
import assert from 'node:assert/strict';

import type { NewsGroupRepository } from '../news/news-group-catalog.js';
import type { NoticeDetailRecord, NoticePublicationRecord, NoticeRepository } from './notice-catalog.js';
import { expireDueNotices } from './notice-expiration.js';
import { deleteNoticePublications, publishNoticeToSubscribedTargets } from './notice-publication.js';

test('publishNoticeToSubscribedTargets sends notice text and attachments to avisos destinations', async () => {
  const publications: Array<Omit<NoticePublicationRecord, 'id' | 'createdAt' | 'deletedAt'>> = [];
  const groupMessages: Array<{ chatId: number; message: string; messageThreadId?: number }> = [];
  const copiedMessages: Array<{ fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }> = [];
  let nextMessageId = 100;
  const detail = createNoticeDetail();
  const noticeRepository = createNoticeRepository(detail, publications);

  const result = await publishNoticeToSubscribedTargets({
    detail,
    noticeRepository,
    newsGroupRepository: createNewsGroupRepository(),
    telegram: {
      sendGroupMessage: async (chatId, message, options) => {
        groupMessages.push(options?.messageThreadId ? { chatId, message, messageThreadId: options.messageThreadId } : { chatId, message });
        return { messageId: nextMessageId++ };
      },
      copyMessage: async (input) => {
        copiedMessages.push(input);
        return { messageId: nextMessageId++ };
      },
    },
  });

  assert.deepEqual(result, { targets: 2, sentMessages: 4, failures: 0 });
  assert.deepEqual(groupMessages.map((message) => ({ chatId: message.chatId, messageThreadId: message.messageThreadId })), [
    { chatId: -100, messageThreadId: 55 },
    { chatId: -200, messageThreadId: undefined },
  ]);
  assert.deepEqual(copiedMessages.map((message) => ({ toChatId: message.toChatId, messageThreadId: message.messageThreadId })), [
    { toChatId: -100, messageThreadId: 55 },
    { toChatId: -200, messageThreadId: undefined },
  ]);
  assert.deepEqual(publications.map((publication) => publication.publicationKind), ['text', 'attachment', 'text', 'attachment']);
});

test('deleteNoticePublications deletes every stored publication best effort', async () => {
  const detail = createNoticeDetail({
    publications: [
      createPublication({ id: 1, messageId: 10 }),
      createPublication({ id: 2, messageId: 11 }),
    ],
  });
  const deletedPublicationIds: number[] = [];
  const noticeRepository = createNoticeRepository(detail, [], deletedPublicationIds);
  const deletedMessages: number[] = [];

  const result = await deleteNoticePublications({
    detail,
    noticeRepository,
    telegram: {
      deleteMessage: async ({ messageId }) => {
        deletedMessages.push(messageId);
      },
    },
  });

  assert.deepEqual(result, { deleted: 2, failures: 0 });
  assert.deepEqual(deletedMessages, [10, 11]);
  assert.deepEqual(deletedPublicationIds, [1, 2]);
});

test('expireDueNotices archives due notices and deletes their publications', async () => {
  const detail = createNoticeDetail({
    notice: {
      ...createNoticeDetail().notice,
      expiresAt: '2026-06-03T10:00:00.000Z',
    },
    publications: [createPublication({ id: 1, messageId: 10 })],
  });
  const archivedNoticeIds: number[] = [];
  const deletedPublicationIds: number[] = [];
  const noticeRepository = createNoticeRepository(detail, [], deletedPublicationIds, archivedNoticeIds);

  const result = await expireDueNotices({
    noticeRepository,
    telegram: {
      deleteMessage: async () => {},
    },
    now: new Date('2026-06-03T11:00:00.000Z'),
  });

  assert.deepEqual(result, { archived: 1, deletedMessages: 1, deleteFailures: 0 });
  assert.deepEqual(archivedNoticeIds, [1]);
  assert.deepEqual(deletedPublicationIds, [1]);
});

function createNoticeRepository(
  detail: NoticeDetailRecord,
  publications: Array<Omit<NoticePublicationRecord, 'id' | 'createdAt' | 'deletedAt'>>,
  deletedPublicationIds: number[] = [],
  archivedNoticeIds: number[] = [],
): NoticeRepository {
  let nextPublicationId = 1;
  return {
    createNotice: async () => detail,
    findNoticeDetail: async () => detail,
    listActiveNotices: async () => [detail.notice],
    listDueActiveNotices: async () => [detail],
    archiveNotice: async ({ noticeId }) => {
      archivedNoticeIds.push(noticeId);
      return { ...detail, notice: { ...detail.notice, status: 'archived', archivedAt: '2026-06-03T11:00:00.000Z' } };
    },
    addPublication: async (input) => {
      publications.push({
        ...input,
        messageThreadId: input.messageThreadId ?? null,
        attachmentId: input.attachmentId ?? null,
      });
      return {
        id: nextPublicationId++,
        ...input,
        messageThreadId: input.messageThreadId ?? null,
        attachmentId: input.attachmentId ?? null,
        createdAt: '2026-06-03T10:00:00.000Z',
        deletedAt: null,
      };
    },
    markPublicationDeleted: async (publicationId) => {
      deletedPublicationIds.push(publicationId);
    },
  };
}

function createNewsGroupRepository(): NewsGroupRepository {
  return {
    findGroupByChatId: async () => null,
    listGroups: async () => [],
    upsertGroup: async () => {
      throw new Error('not used');
    },
    listSubscriptionsByChatId: async () => [],
    upsertSubscription: async () => {
      throw new Error('not used');
    },
    deleteSubscription: async () => false,
    listSubscribedGroupsByCategory: async () => [
      { chatId: -100, messageThreadId: 55, isEnabled: true, metadata: null, createdAt: '2026-06-03T10:00:00.000Z', updatedAt: '2026-06-03T10:00:00.000Z', enabledAt: null, disabledAt: null },
      { chatId: -200, messageThreadId: null, isEnabled: true, metadata: null, createdAt: '2026-06-03T10:00:00.000Z', updatedAt: '2026-06-03T10:00:00.000Z', enabledAt: null, disabledAt: null },
    ],
    isNewsEnabledGroup: async () => true,
  };
}

function createNoticeDetail(overrides: Partial<NoticeDetailRecord> = {}): NoticeDetailRecord {
  const notice = {
    id: 1,
    createdByTelegramUserId: 42,
    creatorDisplayName: 'Tester',
    text: 'Mensaje importante',
    textHtml: '<b>Mensaje importante</b>',
    status: 'active' as const,
    expiresAt: null,
    createdAt: '2026-06-03T10:00:00.000Z',
    updatedAt: '2026-06-03T10:00:00.000Z',
    archivedAt: null,
    archivedByTelegramUserId: null,
    archiveReason: null,
  };
  return {
    notice,
    attachments: [{
      id: 7,
      noticeId: 1,
      sourceChatId: 42,
      sourceMessageId: 77,
      attachmentKind: 'photo',
      telegramFileId: 'file',
      telegramFileUniqueId: 'unique',
      caption: null,
      originalFileName: null,
      mimeType: null,
      fileSizeBytes: null,
      mediaGroupId: null,
      sortOrder: 0,
      createdAt: '2026-06-03T10:00:00.000Z',
    }],
    publications: [],
    ...overrides,
  };
}

function createPublication(input: { id: number; messageId: number }): NoticePublicationRecord {
  return {
    id: input.id,
    noticeId: 1,
    chatId: -100,
    messageThreadId: 55,
    messageId: input.messageId,
    publicationKind: 'text',
    attachmentId: null,
    createdAt: '2026-06-03T10:00:00.000Z',
    deletedAt: null,
  };
}
