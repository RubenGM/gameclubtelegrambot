import test from 'node:test';
import assert from 'node:assert/strict';

import type { NoticeRepository, NoticeRecord } from '../notices/notice-catalog.js';
import type { TelegramCommandHandlerContext, TelegramCommandRuntime } from './command-registry.js';
import { handleTelegramNoticeCommand } from './notice-flow.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

test('handleTelegramNoticeCommand sends own notices only when present and always sends other notices list', async () => {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const repository = createNoticeRepository([
    createNotice({ id: 1, createdByTelegramUserId: 42, text: 'Mi aviso' }),
    createNotice({ id: 2, createdByTelegramUserId: 77, text: 'Aviso de otro' }),
  ]);
  const context = createContext({ replies, repository });

  await handleTelegramNoticeCommand(context);

  assert.equal(replies.length, 2);
  assert.match(replies[0]?.message ?? '', /Tus avisos activos:/);
  assert.match(replies[0]?.message ?? '', /Mi aviso/);
  assert.match(replies[1]?.message ?? '', /Avisos activos del club:/);
  assert.match(replies[1]?.message ?? '', /Aviso de otro/);
  assert.equal(replies[0]?.options?.inlineKeyboard?.[0]?.[0]?.callbackData, 'notice:archive_confirm:1');
  assert.equal(replies[1]?.options?.inlineKeyboard, undefined);
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
});

function createContext({
  replies,
  repository,
}: {
  replies: Array<{ message: string; options?: TelegramReplyOptions }>;
  repository: NoticeRepository;
}): TelegramCommandHandlerContext & { noticeRepository: NoticeRepository } {
  return {
    from: { id: 42, first_name: 'Tester' },
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
        current: null,
        start: async () => ({ flowKey: 'x', stepKey: 'x', data: {}, expiresAt: '2099-01-01T00:00:00.000Z' }),
        advance: async () => ({ flowKey: 'x', stepKey: 'x', data: {}, expiresAt: '2099-01-01T00:00:00.000Z' }),
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
    findNoticeDetail: async () => null,
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
