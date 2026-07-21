import assert from 'node:assert/strict';
import test from 'node:test';

import type { RoleGameAutoSchedulingStore } from '../role-games/role-game-auto-scheduling-store.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import type { ConversationSessionRecord } from './conversation-session.js';
import {
  handleTelegramRoleGameAutoSchedulingAdminCallback,
  handleTelegramRoleGameAutoSchedulingAdminText,
  roleGameAutoSchedulingAdminCallbackPrefixes,
  roleGameAutoSchedulingAdminFlowKey,
} from './role-game-auto-scheduling-admin-flow.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

type CapturedReply = { message: string; options?: TelegramReplyOptions };

test('admin menu shows the live automatic scheduling settings and controls', async () => {
  const fixture = createFixture({ enabled: false, maxFutureWeeks: 2 });
  fixture.context.messageText = 'Rol automático';

  assert.equal(await handleTelegramRoleGameAutoSchedulingAdminText(fixture.context), true);

  const reply = fixture.replies.at(-1)!;
  assert.match(reply.message, /Programación automática de Rol/);
  assert.match(reply.message, /Creación automática: <b>desactivada<\/b>/);
  assert.match(reply.message, /Límite de creación futura: <b>2 semanas<\/b>/);
  assert.match(reply.message, /tiempo real/);
  assert.deepEqual(reply.options?.inlineKeyboard?.at(0), [{
    text: 'Activar creación automática',
    callbackData: roleGameAutoSchedulingAdminCallbackPrefixes.enable,
    semanticRole: 'success',
  }]);
  assert.deepEqual(reply.options?.inlineKeyboard?.at(1)?.map((button) => button.text), [
    '1 semana',
    '2 semanas',
    '4 semanas',
  ]);
});

test('enabling automatic creation requires an explicit confirmation with the active horizon', async () => {
  const fixture = createFixture({ enabled: false, maxFutureWeeks: 4 });
  fixture.context.callbackData = roleGameAutoSchedulingAdminCallbackPrefixes.enable;

  assert.equal(await handleTelegramRoleGameAutoSchedulingAdminCallback(fixture.context), true);
  assert.equal(fixture.settings.enabled, false);
  assert.match(fixture.replies.at(-1)!.message, /Autorizarás al bot a crear automáticamente actividades de Agenda/);
  assert.match(fixture.replies.at(-1)!.message, /hasta 4 semanas en el futuro/);
  assert.deepEqual(fixture.replies.at(-1)!.options?.inlineKeyboard?.at(0)?.map((button) => button.callbackData), [
    `${roleGameAutoSchedulingAdminCallbackPrefixes.confirmEnable}4`,
    roleGameAutoSchedulingAdminCallbackPrefixes.open,
  ]);

  fixture.context.callbackData = `${roleGameAutoSchedulingAdminCallbackPrefixes.confirmEnable}4`;
  assert.equal(await handleTelegramRoleGameAutoSchedulingAdminCallback(fixture.context), true);
  assert.equal(fixture.settings.enabled, true);
  assert.match(fixture.replies.at(-1)!.message, /Creación automática de partidas de Rol activada/);
});

test('stale enable confirmation does not activate after the horizon changes', async () => {
  const fixture = createFixture({ enabled: false, maxFutureWeeks: 2 });
  fixture.context.callbackData = roleGameAutoSchedulingAdminCallbackPrefixes.enable;
  await handleTelegramRoleGameAutoSchedulingAdminCallback(fixture.context);

  fixture.settings.maxFutureWeeks = 6;
  fixture.context.callbackData = `${roleGameAutoSchedulingAdminCallbackPrefixes.confirmEnable}2`;
  assert.equal(await handleTelegramRoleGameAutoSchedulingAdminCallback(fixture.context), true);
  assert.equal(fixture.settings.enabled, false);
  assert.match(fixture.replies.at(-1)!.message, /hasta 6 semanas en el futuro/);
  assert.deepEqual(fixture.replies.at(-1)!.options?.inlineKeyboard?.at(0)?.map((button) => button.callbackData), [
    `${roleGameAutoSchedulingAdminCallbackPrefixes.confirmEnable}6`,
    roleGameAutoSchedulingAdminCallbackPrefixes.open,
  ]);

  fixture.context.callbackData = `${roleGameAutoSchedulingAdminCallbackPrefixes.confirmEnable}6`;
  assert.equal(await handleTelegramRoleGameAutoSchedulingAdminCallback(fixture.context), true);
  assert.equal(fixture.settings.enabled, true);
});

test('admin can enter a custom future-week limit and invalid values are rejected', async () => {
  const fixture = createFixture({ enabled: false, maxFutureWeeks: 2 });
  fixture.context.callbackData = roleGameAutoSchedulingAdminCallbackPrefixes.customWeeks;

  assert.equal(await handleTelegramRoleGameAutoSchedulingAdminCallback(fixture.context), true);
  assert.equal(fixture.session.current?.flowKey, roleGameAutoSchedulingAdminFlowKey);
  assert.equal(fixture.session.current?.stepKey, 'max-future-weeks');

  delete fixture.context.callbackData;
  fixture.context.messageText = '53';
  assert.equal(await handleTelegramRoleGameAutoSchedulingAdminText(fixture.context), true);
  assert.equal(fixture.settings.maxFutureWeeks, 2);
  assert.match(fixture.replies.at(-1)!.message, /entre 1 y 52/);

  fixture.context.messageText = '6';
  assert.equal(await handleTelegramRoleGameAutoSchedulingAdminText(fixture.context), true);
  assert.equal(fixture.settings.maxFutureWeeks, 6);
  assert.equal(fixture.session.current, null);
  assert.match(fixture.replies.at(-1)!.message, /Límite futuro actualizado a 6 semanas/);
});

test('admin can disable automation and apply a preset immediately', async () => {
  const fixture = createFixture({ enabled: true, maxFutureWeeks: 2 });
  fixture.context.callbackData = roleGameAutoSchedulingAdminCallbackPrefixes.disable;

  assert.equal(await handleTelegramRoleGameAutoSchedulingAdminCallback(fixture.context), true);
  assert.equal(fixture.settings.enabled, false);
  assert.match(fixture.replies.at(-1)!.message, /Creación automática de partidas de Rol desactivada/);

  fixture.context.callbackData = `${roleGameAutoSchedulingAdminCallbackPrefixes.weeks}8`;
  assert.equal(await handleTelegramRoleGameAutoSchedulingAdminCallback(fixture.context), true);
  assert.equal(fixture.settings.maxFutureWeeks, 8);
  assert.match(fixture.replies.at(-1)!.message, /Límite futuro actualizado a 8 semanas/);
});

test('increasing the active horizon requires confirmation before persisting it', async () => {
  const fixture = createFixture({ enabled: true, maxFutureWeeks: 2 });
  fixture.context.callbackData = `${roleGameAutoSchedulingAdminCallbackPrefixes.weeks}8`;

  assert.equal(await handleTelegramRoleGameAutoSchedulingAdminCallback(fixture.context), true);
  assert.equal(fixture.settings.maxFutureWeeks, 2);
  assert.match(fixture.replies.at(-1)!.message, /Aumentarás el límite de 2 semanas a 8 semanas/);
  assert.match(fixture.replies.at(-1)!.message, /próximo ciclo.*crear actividades de Agenda adicionales/);
  assert.deepEqual(fixture.replies.at(-1)!.options?.inlineKeyboard?.at(0)?.map((button) => button.callbackData), [
    `${roleGameAutoSchedulingAdminCallbackPrefixes.confirmWeeks}8`,
    roleGameAutoSchedulingAdminCallbackPrefixes.open,
  ]);

  fixture.context.callbackData = `${roleGameAutoSchedulingAdminCallbackPrefixes.confirmWeeks}8`;
  assert.equal(await handleTelegramRoleGameAutoSchedulingAdminCallback(fixture.context), true);
  assert.equal(fixture.settings.maxFutureWeeks, 8);

  fixture.context.callbackData = `${roleGameAutoSchedulingAdminCallbackPrefixes.weeks}1`;
  assert.equal(await handleTelegramRoleGameAutoSchedulingAdminCallback(fixture.context), true);
  assert.equal(fixture.settings.maxFutureWeeks, 1);
});

test('custom horizon increases also require confirmation while automation is enabled', async () => {
  const fixture = createFixture({ enabled: true, maxFutureWeeks: 2 });
  fixture.context.callbackData = roleGameAutoSchedulingAdminCallbackPrefixes.customWeeks;
  await handleTelegramRoleGameAutoSchedulingAdminCallback(fixture.context);

  delete fixture.context.callbackData;
  fixture.context.messageText = '6';
  assert.equal(await handleTelegramRoleGameAutoSchedulingAdminText(fixture.context), true);
  assert.equal(fixture.settings.maxFutureWeeks, 2);
  assert.equal(fixture.session.current, null);
  assert.match(fixture.replies.at(-1)!.message, /Aumentarás el límite de 2 semanas a 6 semanas/);

  fixture.context.callbackData = `${roleGameAutoSchedulingAdminCallbackPrefixes.confirmWeeks}6`;
  assert.equal(await handleTelegramRoleGameAutoSchedulingAdminCallback(fixture.context), true);
  assert.equal(fixture.settings.maxFutureWeeks, 6);
});

test('role scheduling callbacks reject non-admin users', async () => {
  const fixture = createFixture({ enabled: false, maxFutureWeeks: 2, isAdmin: false });
  fixture.context.callbackData = roleGameAutoSchedulingAdminCallbackPrefixes.enable;

  assert.equal(await handleTelegramRoleGameAutoSchedulingAdminCallback(fixture.context), true);
  assert.equal(fixture.settings.enabled, false);
  assert.match(fixture.replies.at(-1)!.message, /solo está disponible para administradores/);
});

test('role scheduling settings reject blocked admins and group access', async () => {
  const blocked = createFixture({ enabled: false, maxFutureWeeks: 2, isBlocked: true });
  blocked.context.callbackData = roleGameAutoSchedulingAdminCallbackPrefixes.enable;
  assert.equal(await handleTelegramRoleGameAutoSchedulingAdminCallback(blocked.context), true);
  assert.equal(blocked.settings.enabled, false);
  assert.match(blocked.replies.at(-1)!.message, /solo está disponible para administradores/);

  const group = createFixture({ enabled: false, maxFutureWeeks: 2, chatKind: 'group' });
  group.context.callbackData = roleGameAutoSchedulingAdminCallbackPrefixes.enable;
  assert.equal(await handleTelegramRoleGameAutoSchedulingAdminCallback(group.context), true);
  assert.equal(group.settings.enabled, false);
  assert.match(group.replies.at(-1)!.message, /solo está disponible para administradores/);
});

function createFixture({
  enabled,
  maxFutureWeeks,
  isAdmin = true,
  isBlocked = false,
  chatKind = 'private',
}: {
  enabled: boolean;
  maxFutureWeeks: number;
  isAdmin?: boolean;
  isBlocked?: boolean;
  chatKind?: 'private' | 'group';
}) {
  const settings = { enabled, maxFutureWeeks };
  const replies: CapturedReply[] = [];
  let current: ConversationSessionRecord | null = null;
  const session = {
    get current() {
      return current;
    },
    async start(input: { flowKey: string; stepKey: string; data?: Record<string, unknown> }) {
      current = sessionRecord(input.flowKey, input.stepKey, input.data ?? {});
      return current;
    },
    async advance(input: { stepKey: string; data: Record<string, unknown> }) {
      if (!current) throw new Error('no active session');
      current = { ...current, stepKey: input.stepKey, data: input.data };
      return current;
    },
    async cancel() {
      const hadSession = current !== null;
      current = null;
      return hadSession;
    },
  };
  const store: RoleGameAutoSchedulingStore = {
    async getSettings() {
      return { ...settings };
    },
    async isEnabled() {
      return settings.enabled;
    },
    async setEnabled(value) {
      settings.enabled = value;
    },
    async setMaxFutureWeeks(value) {
      settings.maxFutureWeeks = value;
    },
  };

  const context = {
    async reply(message: string, options?: TelegramReplyOptions) {
      replies.push({ message, ...(options ? { options } : {}) });
    },
    roleGameAutoSchedulingStore: store,
    runtime: {
      bot: {
        publicName: 'Bot',
        clubName: 'Club',
        language: 'es' as const,
        async sendPrivateMessage() {},
      },
      services: {} as never,
      chat: { kind: chatKind, chatId: 1 },
      actor: {
        telegramUserId: 42,
        status: 'approved' as const,
        isApproved: true,
        isBlocked,
        isAdmin,
        permissions: [],
      },
      authorization: {
        authorize: (permissionKey: string) => ({
          allowed: isAdmin,
          permissionKey,
          reason: isAdmin ? 'admin-override' as const : 'no-match' as const,
        }),
        can: () => isAdmin,
      },
      session,
    },
  } as unknown as TelegramCommandHandlerContext & { roleGameAutoSchedulingStore: RoleGameAutoSchedulingStore };

  return { context, replies, session, settings };
}

function sessionRecord(flowKey: string, stepKey: string, data: Record<string, unknown>): ConversationSessionRecord {
  return {
    key: 'telegram.session:1:42',
    flowKey,
    stepKey,
    data,
    createdAt: '2026-07-21T10:00:00.000Z',
    updatedAt: '2026-07-21T10:00:00.000Z',
    expiresAt: '2026-07-21T11:00:00.000Z',
  };
}
