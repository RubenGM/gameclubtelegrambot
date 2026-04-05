import test from 'node:test';
import assert from 'node:assert/strict';

import type { ClubTableRecord, ClubTableRepository } from '../tables/table-catalog.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import {
  handleTelegramTableReadCallback,
  handleTelegramTableReadCommand,
  handleTelegramTableReadStartText,
} from './table-read-flow.js';

function createRepository(initialTables: ClubTableRecord[]): ClubTableRepository {
  const tables = new Map(initialTables.map((table) => [table.id, table]));

  return {
    async createTable() {
      throw new Error('not implemented');
    },
    async findTableById(tableId) {
      return tables.get(tableId) ?? null;
    },
    async listTables({ includeDeactivated }) {
      return Array.from(tables.values()).filter(
        (table) => includeDeactivated || table.lifecycleStatus === 'active',
      );
    },
    async updateTable() {
      throw new Error('not implemented');
    },
    async deactivateTable() {
      throw new Error('not implemented');
    },
  };
}

function createContext(repository: ClubTableRepository): {
  context: TelegramCommandHandlerContext;
  replies: Array<{ message: string; options?: TelegramReplyOptions }>;
} {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];

  return {
    context: {
      reply: async (message, options) => {
        replies.push({ message, ...(options ? { options } : {}) });
      },
      runtime: {
        bot: {
          publicName: 'Game Club Bot',
          clubName: 'Game Club',
          sendPrivateMessage: async () => {},
        },
        services: {
          database: {
            db: undefined as never,
          },
        } as never,
        chat: {
          kind: 'private',
          chatId: 1,
        },
        actor: {
          telegramUserId: 7,
          status: 'approved',
          isApproved: true,
          isBlocked: false,
          isAdmin: false,
          permissions: [],
        },
        authorization: {
          authorize: () => ({ allowed: false, permissionKey: 'table.manage', reason: 'no-match' }),
          can: () => false,
        },
        session: {
          current: null,
          start: async () => {
            throw new Error('not implemented');
          },
          advance: async () => {
            throw new Error('not implemented');
          },
          cancel: async () => false,
        },
      },
      tableRepository: repository,
    } as TelegramCommandHandlerContext,
    replies,
  };
}

test('handleTelegramTableReadCommand lists only active tables with inline detail buttons', async () => {
  const repository = createRepository([
    {
      id: 1,
      displayName: 'Mesa TV',
      description: 'Prop del televisor',
      recommendedCapacity: 6,
      lifecycleStatus: 'active',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      deactivatedAt: null,
    },
    {
      id: 2,
      displayName: 'Mesa antiga',
      description: null,
      recommendedCapacity: 4,
      lifecycleStatus: 'deactivated',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      deactivatedAt: '2026-04-04T12:00:00.000Z',
    },
  ]);
  const { context, replies } = createContext(repository);

  await handleTelegramTableReadCommand(context);

  assert.deepEqual(replies, [
    {
      message: 'Taules disponibles:\n- <a href="https://t.me/cawatest_bot?start=table_read_1"><b>Mesa TV</b></a>',
      options: {
        parseMode: 'HTML',
      },
    },
  ]);
});

test('handleTelegramTableReadCallback shows member-facing table details without admin controls', async () => {
  const repository = createRepository([
    {
      id: 1,
      displayName: 'Mesa TV',
      description: 'Prop del televisor',
      recommendedCapacity: 6,
      lifecycleStatus: 'active',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      deactivatedAt: null,
    },
  ]);
  const { context, replies } = createContext(repository);
  context.callbackData = 'table_read:inspect:1';

  const handled = await handleTelegramTableReadCallback(context);

  assert.equal(handled, true);
  assert.deepEqual(replies, [
    {
      message: '<a href="https://t.me/cawatest_bot?start=table_read_1"><b>Mesa TV</b></a>\nDescripcio: Prop del televisor\nCapacitat recomanada: 6',
      options: {
        parseMode: 'HTML',
      },
    },
  ]);
});

test('handleTelegramTableReadStartText opens the linked member table details from /start', async () => {
  const repository = createRepository([
    {
      id: 1,
      displayName: 'Mesa TV',
      description: 'Prop del televisor',
      recommendedCapacity: 6,
      lifecycleStatus: 'active',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      deactivatedAt: null,
    },
  ]);
  const { context, replies } = createContext(repository);
  context.messageText = '/start table_read_1';

  const handled = await handleTelegramTableReadStartText(context);

  assert.equal(handled, true);
  assert.deepEqual(replies, [
    {
      message: '<a href="https://t.me/cawatest_bot?start=table_read_1"><b>Mesa TV</b></a>\nDescripcio: Prop del televisor\nCapacitat recomanada: 6',
      options: {
        parseMode: 'HTML',
      },
    },
  ]);
});
