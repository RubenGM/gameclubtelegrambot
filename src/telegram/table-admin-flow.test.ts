import test from 'node:test';
import assert from 'node:assert/strict';

import type { AuditLogEventRecord, AuditLogRepository } from '../audit/audit-log.js';
import type { ClubTableRecord, ClubTableRepository } from '../tables/table-catalog.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import type { ConversationSessionRecord } from './conversation-session.js';
import {
  handleTelegramTableAdminCallback,
  handleTelegramTableAdminText,
  handleTelegramTableAdminStartText,
  tableAdminLabels,
  tableAdminCallbackPrefixes,
  type TelegramTableAdminContext,
} from './table-admin-flow.js';

function createRepository(initialTables: ClubTableRecord[] = []): ClubTableRepository {
  const tables = new Map(initialTables.map((table) => [table.id, table]));
  let nextId = Math.max(0, ...initialTables.map((table) => table.id)) + 1;

  return {
    async createTable(input) {
      const createdAt = '2026-04-04T10:00:00.000Z';
      const next: ClubTableRecord = {
        id: nextId,
        displayName: input.displayName,
        description: input.description ?? null,
        recommendedCapacity: input.recommendedCapacity ?? null,
        lifecycleStatus: 'active',
        createdAt,
        updatedAt: createdAt,
        deactivatedAt: null,
      };
      nextId += 1;
      tables.set(next.id, next);
      return next;
    },
    async findTableById(tableId) {
      return tables.get(tableId) ?? null;
    },
    async listTables({ includeDeactivated }) {
      return Array.from(tables.values()).filter(
        (table) => includeDeactivated || table.lifecycleStatus === 'active',
      );
    },
    async updateTable(input) {
      const existing = tables.get(input.tableId);
      if (!existing) {
        throw new Error(`unknown table ${input.tableId}`);
      }

      const next: ClubTableRecord = {
        ...existing,
        displayName: input.displayName,
        description: input.description,
        recommendedCapacity: input.recommendedCapacity,
        updatedAt: '2026-04-04T11:00:00.000Z',
      };
      tables.set(next.id, next);
      return next;
    },
    async deactivateTable({ tableId }) {
      const existing = tables.get(tableId);
      if (!existing) {
        throw new Error(`unknown table ${tableId}`);
      }

      const next: ClubTableRecord = {
        ...existing,
        lifecycleStatus: 'deactivated',
        updatedAt: '2026-04-04T12:00:00.000Z',
        deactivatedAt: '2026-04-04T12:00:00.000Z',
      };
      tables.set(existing.id, next);
      return next;
    },
  };
}

function createContext({
  repository = createRepository(),
  auditRepository = createAuditRepository(),
  isAdmin = true,
}: {
  repository?: ClubTableRepository;
  auditRepository?: AuditLogRepository;
  isAdmin?: boolean;
} = {}) {
  const replies: Array<{ message: string; options?: TelegramReplyOptions | undefined }> = [];
  let currentSession: {
    flowKey: string;
    stepKey: string;
    data: Record<string, unknown>;
  } | null = null;

  const context: TelegramTableAdminContext = {
    messageText: undefined,
    callbackData: undefined,
    reply: async (message: string, options?: TelegramReplyOptions) => {
      replies.push({ message, ...(options ? { options } : {}) });
    },
    runtime: {
      actor: {
        telegramUserId: 99,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin,
        permissions: [],
      },
      session: {
        get current() {
          if (!currentSession) {
            return null;
          }

          return {
            key: 'telegram.session:1:99',
            flowKey: currentSession.flowKey,
            stepKey: currentSession.stepKey,
            data: currentSession.data,
            createdAt: '2026-04-04T10:00:00.000Z',
            updatedAt: '2026-04-04T10:00:00.000Z',
            expiresAt: '2026-04-05T10:00:00.000Z',
          };
        },
        start: async ({
          flowKey,
          stepKey,
          data = {},
        }: {
          flowKey: string;
          stepKey: string;
          data?: Record<string, unknown>;
        }): Promise<ConversationSessionRecord> => {
          currentSession = { flowKey, stepKey, data };
          return context.runtime.session.current!;
        },
        advance: async ({
          stepKey,
          data,
        }: {
          stepKey: string;
          data: Record<string, unknown>;
        }): Promise<ConversationSessionRecord> => {
          if (!currentSession) {
            throw new Error('no session');
          }

          currentSession = {
            flowKey: currentSession.flowKey,
            stepKey,
            data,
          };
          return context.runtime.session.current!;
        },
        cancel: async () => {
          const hadSession = currentSession !== null;
          currentSession = null;
          return hadSession;
        },
      },
      services: {
        database: {
          db: undefined as never,
        },
      },
      bot: {
        publicName: 'Game Club Bot',
        clubName: 'Game Club',
        sendPrivateMessage: async () => {},
      },
      chat: {
        kind: 'private',
        chatId: 1,
      },
      authorization: {
        authorize: (permissionKey: string) => ({
          allowed: permissionKey === 'table.manage',
          permissionKey,
          reason: permissionKey === 'table.manage' ? 'admin-override' : 'no-match',
        }),
        can: (permissionKey: string) => permissionKey === 'table.manage',
      },
    },
    tableRepository: repository,
    auditRepository,
  };

  return {
    context,
    replies,
    getCurrentSession: () => currentSession,
  };
}

function createAuditRepository(): AuditLogRepository & { __events: AuditLogEventRecord[] } {
  const events: AuditLogEventRecord[] = [];

  return {
    async appendEvent(input) {
      events.push({
        actorTelegramUserId: input.actorTelegramUserId,
        actionKey: input.actionKey,
        targetType: input.targetType,
        targetId: input.targetId,
        summary: input.summary,
        details: input.details ?? null,
        createdAt: '2026-04-04T10:00:00.000Z',
      });
    },
    __events: events,
  };
}

test('handleTelegramTableAdminText opens the admin table menu from the keyboard action', async () => {
  const { context, replies } = createContext();
  context.messageText = tableAdminLabels.openMenu;

  const handled = await handleTelegramTableAdminText(context);

  assert.equal(handled, true);
  assert.equal(replies.at(-1)?.message, 'Gestio de taules: tria una accio.');
  assert.deepEqual(replies.at(-1)?.options, {
    replyKeyboard: [
      [tableAdminLabels.create, tableAdminLabels.list],
      [tableAdminLabels.edit, tableAdminLabels.deactivate],
      [tableAdminLabels.start],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });
});

test('handleTelegramTableAdminText creates a table through keyboard-guided conversation steps', async () => {
  const repository = createRepository();
  const auditRepository = createAuditRepository();
  const { context, replies, getCurrentSession } = createContext({ repository, auditRepository });

  context.messageText = tableAdminLabels.create;
  assert.equal(await handleTelegramTableAdminText(context), true);
  assert.deepEqual(getCurrentSession(), {
    flowKey: 'table-admin-create',
    stepKey: 'display-name',
    data: {},
  });

  context.messageText = 'Mesa TV';
  assert.equal(await handleTelegramTableAdminText(context), true);
  assert.deepEqual(getCurrentSession(), {
    flowKey: 'table-admin-create',
    stepKey: 'description',
    data: { displayName: 'Mesa TV' },
  });

  context.messageText = tableAdminLabels.skipOptional;
  assert.equal(await handleTelegramTableAdminText(context), true);
  assert.deepEqual(getCurrentSession(), {
    flowKey: 'table-admin-create',
    stepKey: 'capacity',
    data: { displayName: 'Mesa TV', description: null },
  });

  context.messageText = tableAdminLabels.noCapacity;
  assert.equal(await handleTelegramTableAdminText(context), true);
  assert.deepEqual(getCurrentSession(), {
    flowKey: 'table-admin-create',
    stepKey: 'confirm',
    data: {
      displayName: 'Mesa TV',
      description: null,
      recommendedCapacity: null,
    },
  });

  context.messageText = tableAdminLabels.confirmCreate;
  assert.equal(await handleTelegramTableAdminText(context), true);
  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /Taula creada correctament: Mesa TV/);
  assert.deepEqual(await repository.listTables({ includeDeactivated: true }), [
    {
      id: 1,
      displayName: 'Mesa TV',
      description: null,
      recommendedCapacity: null,
      lifecycleStatus: 'active',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      deactivatedAt: null,
    },
  ]);
  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'table.created');
  assert.equal(auditRepository.__events.at(-1)?.targetType, 'club-table');
});

test('handleTelegramTableAdminText keeps the capacity step active when the numeric value is invalid', async () => {
  const { context, replies, getCurrentSession } = createContext();

  context.messageText = tableAdminLabels.create;
  await handleTelegramTableAdminText(context);
  context.messageText = 'Mesa petita';
  await handleTelegramTableAdminText(context);
  context.messageText = tableAdminLabels.skipOptional;
  await handleTelegramTableAdminText(context);

  context.messageText = '0';
  const handled = await handleTelegramTableAdminText(context);

  assert.equal(handled, true);
  assert.deepEqual(getCurrentSession(), {
    flowKey: 'table-admin-create',
    stepKey: 'capacity',
    data: { displayName: 'Mesa petita', description: null },
  });
  assert.equal(
    replies.at(-1)?.message,
    'La capacitat recomanada ha de ser un enter positiu. Escriu un numero valid o tria una opcio del teclat.',
  );
});

test('handleTelegramTableAdminCallback inspects an existing table from the inline list', async () => {
  const { context, replies } = createContext({
    repository: createRepository([
      {
        id: 7,
        displayName: 'Mesa principal',
        description: 'Prop del taulell',
        recommendedCapacity: 6,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ]),
  });
  context.callbackData = `${tableAdminCallbackPrefixes.inspect}7`;

  const handled = await handleTelegramTableAdminCallback(context);

  assert.equal(handled, true);
  assert.match(replies.at(-1)?.message ?? '', /<b>Mesa principal<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /Capacitat recomanada: 6/);
  assert.equal(replies.at(-1)?.options?.parseMode, 'HTML');
});

test('handleTelegramTableAdminStartText opens the linked admin table details from /start', async () => {
  const { context, replies } = createContext({
    repository: createRepository([
      {
        id: 7,
        displayName: 'Mesa principal',
        description: 'Prop del taulell',
        recommendedCapacity: 6,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ]),
  });
  context.messageText = '/start table_admin_7';

  const handled = await handleTelegramTableAdminStartText(context);

  assert.equal(handled, true);
  assert.equal(replies.at(-1)?.options?.parseMode, 'HTML');
  assert.match(replies.at(-1)?.message ?? '', /<b>Mesa principal<\/b>/);
});

test('handleTelegramTableAdminCallback edits a table with keyboard shortcuts for existing values', async () => {
  const repository = createRepository([
    {
      id: 3,
      displayName: 'Mesa antiga',
      description: 'Vora la finestra',
      recommendedCapacity: 4,
      lifecycleStatus: 'active',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      deactivatedAt: null,
    },
  ]);
  const auditRepository = createAuditRepository();
  const { context, getCurrentSession } = createContext({ repository, auditRepository });

  context.callbackData = `${tableAdminCallbackPrefixes.edit}3`;
  assert.equal(await handleTelegramTableAdminCallback(context), true);
  assert.deepEqual(getCurrentSession(), {
    flowKey: 'table-admin-edit',
    stepKey: 'display-name',
    data: { tableId: 3 },
  });

  delete context.callbackData;
  context.messageText = tableAdminLabels.keepCurrent;
  assert.equal(await handleTelegramTableAdminText(context), true);
  context.messageText = tableAdminLabels.clearDescription;
  assert.equal(await handleTelegramTableAdminText(context), true);
  context.messageText = '8';
  assert.equal(await handleTelegramTableAdminText(context), true);
  context.messageText = tableAdminLabels.confirmEdit;
  assert.equal(await handleTelegramTableAdminText(context), true);

  assert.deepEqual(await repository.findTableById(3), {
    id: 3,
    displayName: 'Mesa antiga',
    description: null,
    recommendedCapacity: 8,
    lifecycleStatus: 'active',
    createdAt: '2026-04-04T10:00:00.000Z',
    updatedAt: '2026-04-04T11:00:00.000Z',
    deactivatedAt: null,
  });
  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'table.updated');
  assert.equal(auditRepository.__events.at(-1)?.targetId, '3');
});

test('handleTelegramTableAdminCallback deactivates a table only after explicit confirmation', async () => {
  const repository = createRepository([
    {
      id: 5,
      displayName: 'Mesa auxiliar',
      description: null,
      recommendedCapacity: 4,
      lifecycleStatus: 'active',
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
      deactivatedAt: null,
    },
  ]);
  const auditRepository = createAuditRepository();
  const { context, getCurrentSession } = createContext({ repository, auditRepository });

  context.callbackData = `${tableAdminCallbackPrefixes.deactivate}5`;
  assert.equal(await handleTelegramTableAdminCallback(context), true);
  assert.deepEqual(getCurrentSession(), {
    flowKey: 'table-admin-deactivate',
    stepKey: 'confirm',
    data: { tableId: 5 },
  });

  delete context.callbackData;
  context.messageText = tableAdminLabels.confirmDeactivate;
  assert.equal(await handleTelegramTableAdminText(context), true);

  assert.equal((await repository.findTableById(5))?.lifecycleStatus, 'deactivated');
  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'table.deactivated');
  assert.equal(auditRepository.__events.at(-1)?.targetId, '5');
});
