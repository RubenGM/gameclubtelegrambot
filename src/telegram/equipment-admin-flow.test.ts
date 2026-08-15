import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuditLogRepository } from '../audit/audit-log.js';
import type { ClubEquipmentRecord, ClubEquipmentRepository } from '../equipment/equipment-catalog.js';
import type { ConversationSessionRecord } from './conversation-session.js';
import {
  handleTelegramEquipmentAdminText,
  type TelegramEquipmentAdminContext,
} from './equipment-admin-flow.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

test('equipment admin section creates new reservable equipment', async () => {
  const records = new Map<number, ClubEquipmentRecord>();
  const repository: ClubEquipmentRepository = {
    async createEquipment(input) {
      const record: ClubEquipmentRecord = {
        id: 1,
        ...input,
        lifecycleStatus: 'active',
        createdAt: '2026-08-16T10:00:00.000Z',
        updatedAt: '2026-08-16T10:00:00.000Z',
        deactivatedAt: null,
      };
      records.set(record.id, record);
      return record;
    },
    async findEquipmentById(equipmentId) { return records.get(equipmentId) ?? null; },
    async listEquipment({ includeDeactivated }) { return Array.from(records.values()).filter((item) => includeDeactivated || item.lifecycleStatus === 'active'); },
    async updateEquipment() { throw new Error('not implemented'); },
    async deactivateEquipment() { throw new Error('not implemented'); },
  };
  const auditEvents: string[] = [];
  const auditRepository: AuditLogRepository = {
    async appendEvent(event) {
      auditEvents.push(event.actionKey);
    },
  };
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  let session: { flowKey: string; stepKey: string; data: Record<string, unknown> } | null = null;
  const context: TelegramEquipmentAdminContext = {
    messageText: 'Equipamiento',
    reply: async (message, options) => { replies.push({ message, ...(options ? { options } : {}) }); },
    runtime: {
      actor: { telegramUserId: 42, status: 'approved', isApproved: true, isBlocked: false, isAdmin: true, permissions: [] },
      authorization: {
        authorize: (permissionKey) => ({ allowed: true, permissionKey, reason: 'admin-override' }),
        can: () => true,
      },
      session: {
        get current(): ConversationSessionRecord | null {
          return session ? {
            key: 'equipment-test', ...session,
            createdAt: '2026-08-16T10:00:00.000Z',
            updatedAt: '2026-08-16T10:00:00.000Z',
            expiresAt: '2026-08-17T10:00:00.000Z',
          } : null;
        },
        start: async ({ flowKey, stepKey, data = {} }) => {
          session = { flowKey, stepKey, data };
          return context.runtime.session.current!;
        },
        advance: async ({ stepKey, data }) => {
          if (!session) throw new Error('no session');
          session = { ...session, stepKey, data };
          return context.runtime.session.current!;
        },
        cancel: async () => { const hadSession = session !== null; session = null; return hadSession; },
      },
      chat: { kind: 'private', chatId: 1 },
      services: { database: { db: {} } },
      bot: { language: 'es' },
    },
    equipmentRepository: repository,
    auditRepository,
  };

  assert.equal(await handleTelegramEquipmentAdminText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Gestión de equipamiento/);

  context.messageText = 'Crear equipamiento';
  assert.equal(await handleTelegramEquipmentAdminText(context), true);
  context.messageText = 'TV móvil';
  assert.equal(await handleTelegramEquipmentAdminText(context), true);
  context.messageText = 'Con ruedas';
  assert.equal(await handleTelegramEquipmentAdminText(context), true);
  context.messageText = 'Guardar equipamiento';
  assert.equal(await handleTelegramEquipmentAdminText(context), true);

  assert.equal(records.get(1)?.displayName, 'TV móvil');
  assert.equal(records.get(1)?.description, 'Con ruedas');
  assert.deepEqual(auditEvents, ['equipment.created']);
  assert.equal(session, null);
});
