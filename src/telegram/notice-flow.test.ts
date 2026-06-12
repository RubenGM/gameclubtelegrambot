import test from 'node:test';
import assert from 'node:assert/strict';

import type { NoticeDetailRecord, NoticeRepository, NoticeRecord } from '../notices/notice-catalog.js';
import { formatNoticePublicationPayload, telegramNoticePublicationMaxLength } from '../notices/notice-publication.js';
import type { TelegramCommandHandlerContext, TelegramCommandRuntime } from './command-registry.js';
import { handleTelegramNoticeCallback, handleTelegramNoticeCommand, handleTelegramNoticeText, noticeFlowKey } from './notice-flow.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

test('handleTelegramNoticeCommand sends own notices only when present and always sends other notices list', async () => {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const repository = createNoticeRepository([
    createNotice({ id: 1, createdByTelegramUserId: 42, text: 'Mi aviso' }),
    createNotice({ id: 2, createdByTelegramUserId: 77, text: 'Aviso de otro' }),
  ]);
  const context = createContext({ replies, repository });

  await handleTelegramNoticeCommand(context);

  assert.equal(replies.length, 3);
  assert.match(replies[0]?.message ?? '', /Tus avisos activos:/);
  assert.match(replies[0]?.message ?? '', /Mi aviso/);
  assert.match(replies[1]?.message ?? '', /Avisos activos del club:/);
  assert.match(replies[1]?.message ?? '', /Aviso de otro/);
  assert.deepEqual(replies[0]?.options?.inlineKeyboard?.[0]?.map((button) => button.callbackData), [
    'notice:view:1',
    'notice:edit:1',
    'notice:archive_confirm:1',
  ]);
  assert.equal(replies[0]?.options?.replyKeyboard, undefined);
  assert.deepEqual(replies[1]?.options?.inlineKeyboard?.[0]?.map((button) => button.callbackData), ['notice:view:2']);
  assert.equal(replies[1]?.options?.replyKeyboard, undefined);
  assert.match(replies[2]?.message ?? '', /Qué quieres hacer ahora/);
  assert.deepEqual(replies[2]?.options?.replyKeyboard?.[0], ['Crear aviso']);
});

test('handleTelegramNoticeCommand still sends an empty other notices list', async () => {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const repository = createNoticeRepository([
    createNotice({ id: 1, createdByTelegramUserId: 42, text: 'Mi aviso' }),
  ]);
  const context = createContext({ replies, repository });

  await handleTelegramNoticeCommand(context);

  assert.equal(replies.length, 2);
  assert.match(replies[1]?.message ?? '', /No hay avisos activos de otros socios/);
  assert.equal(replies[1]?.options?.inlineKeyboard, undefined);
  assert.deepEqual(replies[1]?.options?.replyKeyboard?.[0], ['Crear aviso']);
});

test('handleTelegramNoticeCallback sends archive confirmation as inline keyboard without reply keyboard', async () => {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const notice = createNotice({ id: 1, createdByTelegramUserId: 42, text: 'Mi aviso' });
  const repository = createNoticeRepository([notice]);
  const context = createContext({ replies, repository });

  await handleTelegramNoticeCallback({
    ...context,
    callbackData: 'notice:archive_confirm:1',
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0]?.message ?? '', /Confirma que quieres archivar/);
  assert.deepEqual(replies[0]?.options?.inlineKeyboard?.[0]?.map((button) => button.callbackData), ['notice:archive:1']);
  assert.equal(replies[0]?.options?.replyKeyboard, undefined);
});

test('handleTelegramNoticeText rejects text when the final published message would exceed Telegram limit', async () => {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const advances: Array<{ stepKey: string; data: Record<string, unknown> }> = [];
  const repository = createNoticeRepository([]);
  const overhead = formatNoticePublicationPayload({ text: '', creatorDisplayName: 'Tester' }).length;
  const context = createContext({
    replies,
    repository,
    messageText: 'a'.repeat(telegramNoticePublicationMaxLength - overhead + 1),
    sessionCurrent: {
      flowKey: noticeFlowKey,
      stepKey: 'text',
      data: {},
      expiresAt: '2099-01-01T00:00:00.000Z',
    },
    advances,
  });

  const handled = await handleTelegramNoticeText(context);

  assert.equal(handled, true);
  assert.equal(advances.length, 0);
  assert.match(replies[0]?.message ?? '', /demasiado largo/);
  assert.deepEqual(replies[0]?.options?.replyKeyboard?.[0], ['/cancel']);
});

function createContext({
  replies,
  repository,
  messageText,
  sessionCurrent = null,
  advances = [],
}: {
  replies: Array<{ message: string; options?: TelegramReplyOptions }>;
  repository: NoticeRepository;
  messageText?: string;
  sessionCurrent?: { flowKey: string; stepKey: string; data: Record<string, unknown>; expiresAt: string } | null;
  advances?: Array<{ stepKey: string; data: Record<string, unknown> }>;
}): TelegramCommandHandlerContext & { noticeRepository: NoticeRepository } {
  return {
    from: { id: 42, first_name: 'Tester' },
    ...(messageText !== undefined ? { messageText } : {}),
    runtime: {
      bot: {
        publicName: 'Game Club Bot',
        clubName: 'Game Club',
        language: 'es',
        sendPrivateMessage: async () => {},
      },
      services: {
        database: { db: undefined as never, pool: undefined as never, close: async () => {} },
      },
      chat: { kind: 'private', chatId: 42 },
      actor: {
        telegramUserId: 42,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin: false,
        permissions: [],
      },
      authorization: {
        authorize: (permissionKey: string) => ({ allowed: false, permissionKey, reason: 'no-match' }),
        can: () => false,
      },
      session: {
        current: sessionCurrent,
        start: async () => ({ flowKey: 'x', stepKey: 'x', data: {}, expiresAt: '2099-01-01T00:00:00.000Z' }),
        advance: async ({ stepKey, data }: { stepKey: string; data: Record<string, unknown> }) => {
          advances.push({ stepKey, data });
          return { flowKey: noticeFlowKey, stepKey, data, expiresAt: '2099-01-01T00:00:00.000Z' };
        },
        cancel: async () => true,
      },
    } as unknown as TelegramCommandRuntime,
    noticeRepository: repository,
    reply: async (message, options) => {
      replies.push(options ? { message, options } : { message });
    },
  };
}

function createNoticeRepository(notices: NoticeRecord[]): NoticeRepository {
  return {
    createNotice: async () => {
      throw new Error('not used');
    },
    updateNotice: async () => {
      throw new Error('not used');
    },
    findNoticeDetail: async (noticeId) => {
      const notice = notices.find((item) => item.id === noticeId);
      return notice ? createNoticeDetail(notice) : null;
    },
    listActiveNotices: async (input = {}) =>
      notices.filter((notice) => {
        if (input.creatorTelegramUserId !== undefined) {
          return notice.createdByTelegramUserId === input.creatorTelegramUserId;
        }
        if (input.excludeCreatorTelegramUserId !== undefined) {
          return notice.createdByTelegramUserId !== input.excludeCreatorTelegramUserId;
        }
        return true;
      }),
    listDueActiveNotices: async () => [],
    archiveNotice: async () => null,
    addPublication: async () => {
      throw new Error('not used');
    },
    markPublicationDeleted: async () => {},
  };
}

function createNoticeDetail(notice: NoticeRecord): NoticeDetailRecord {
  return {
    notice,
    attachments: [],
    publications: [],
  };
}

function createNotice(input: { id: number; createdByTelegramUserId: number; text: string }): NoticeRecord {
  return {
    id: input.id,
    createdByTelegramUserId: input.createdByTelegramUserId,
    creatorDisplayName: input.createdByTelegramUserId === 42 ? 'Tester' : 'Otro',
    text: input.text,
    textHtml: null,
    status: 'active',
    expiresAt: null,
    createdAt: '2026-06-03T10:00:00.000Z',
    updatedAt: '2026-06-03T10:00:00.000Z',
    archivedAt: null,
    archivedByTelegramUserId: null,
    archiveReason: null,
  };
}
