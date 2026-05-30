import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveTelegramActionMenu, resolveTelegramMenuSelection } from './action-menu.js';
import type { AuthorizationService } from '../authorization/service.js';
import type { TelegramActor } from './actor-store.js';
import type { TelegramChatContext } from './chat-context.js';
import type { ConversationSessionRecord } from './conversation-session.js';

function createContext({
  actor,
  chat,
  session = null,
}: {
  actor: TelegramActor;
  chat: TelegramChatContext;
  session?: ConversationSessionRecord | null;
}) {
  const authorization: AuthorizationService = {
    authorize: (permissionKey) => ({
      allowed: permissionKey === 'test.allow',
      permissionKey,
      reason: permissionKey === 'test.allow' ? 'global-allow' : 'no-match',
    }),
    can: (permissionKey) => permissionKey === 'test.allow',
  };

  return {
    actor,
    authorization,
    chat,
    session,
    language: 'ca' as const,
  };
}

test('resolveTelegramActionMenu returns pending private user actions by default', async () => {
  const menu = resolveTelegramActionMenu({
    context: createContext({
      actor: {
        telegramUserId: 42,
        status: 'pending',
        isApproved: false,
        isBlocked: false,
        isAdmin: false,
        permissions: [],
      },
      chat: {
        kind: 'private',
        chatId: 1,
      },
    }),
  });

  assert.deepEqual(menu, {
    menuId: 'private-pending-default',
    replyKeyboard: [[{ text: 'Accés al club', semanticRole: 'primary' }], [{ text: 'Idioma', semanticRole: 'secondary' }, { text: 'Ajuda', semanticRole: 'help' }]],
    actionRows: [['access'], ['language', 'help']],
    actions: [
      { id: 'access', label: 'Accés al club', telemetryActionKey: 'menu.access', uxSection: 'access' },
      { id: 'language', label: 'Idioma', telemetryActionKey: 'menu.language', uxSection: 'utility' },
      { id: 'help', label: 'Ajuda', telemetryActionKey: 'menu.help', uxSection: 'utility' },
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });
});

test('resolveTelegramActionMenu returns admin private actions by default', async () => {
  const menu = resolveTelegramActionMenu({
    context: createContext({
      actor: {
        telegramUserId: 99,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin: true,
        permissions: [],
      },
      chat: {
        kind: 'private',
        chatId: 1,
      },
    }),
  });

  assert.deepEqual(menu, {
    menuId: 'private-admin-default',
    replyKeyboard: [
      [{ text: 'Revisar sol·licituds', semanticRole: 'secondary' }, { text: 'Administrar usuaris', semanticRole: 'secondary' }],
      [{ text: 'Activitats', semanticRole: 'primary' }, { text: 'Taules', semanticRole: 'primary' }],
      [{ text: 'Catàleg', semanticRole: 'primary' }, { text: 'Emmagatzematge', semanticRole: 'primary' }],
      [{ text: 'Compres conjuntes', semanticRole: 'primary' }, { text: 'LFG (buscar grup)', semanticRole: 'primary' }],
      [{ text: 'Benvingudes', semanticRole: 'secondary' }, { text: 'Canviar nom', semanticRole: 'secondary' }],
      [{ text: 'Idioma', semanticRole: 'secondary' }, { text: 'Ajuda', semanticRole: 'help' }],
    ],
    actionRows: [['review_access', 'manage_users'], ['schedule', 'tables'], ['catalog', 'storage'], ['group_purchases', 'lfg'], ['welcome_templates', 'change_display_name'], ['language', 'help']],
    actions: [
      { id: 'review_access', label: 'Revisar sol·licituds', telemetryActionKey: 'menu.review_access', uxSection: 'admin' },
      { id: 'manage_users', label: 'Administrar usuaris', telemetryActionKey: 'menu.manage_users', uxSection: 'admin' },
      { id: 'schedule', label: 'Activitats', telemetryActionKey: 'menu.schedule', uxSection: 'primary' },
      { id: 'tables', label: 'Taules', telemetryActionKey: 'menu.tables_admin', uxSection: 'admin' },
      { id: 'catalog', label: 'Catàleg', telemetryActionKey: 'menu.catalog', uxSection: 'primary' },
      { id: 'storage', label: 'Emmagatzematge', telemetryActionKey: 'menu.storage', uxSection: 'primary' },
      { id: 'group_purchases', label: 'Compres conjuntes', telemetryActionKey: 'menu.group_purchases', uxSection: 'primary' },
      { id: 'lfg', label: 'LFG (buscar grup)', telemetryActionKey: 'menu.lfg', uxSection: 'primary' },
      { id: 'welcome_templates', label: 'Benvingudes', telemetryActionKey: 'menu.welcome_templates', uxSection: 'admin' },
      { id: 'change_display_name', label: 'Canviar nom', telemetryActionKey: 'menu.change_display_name', uxSection: 'utility' },
      { id: 'language', label: 'Idioma', telemetryActionKey: 'menu.language', uxSection: 'utility' },
      { id: 'help', label: 'Ajuda', telemetryActionKey: 'menu.help', uxSection: 'utility' },
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });
});

test('resolveTelegramActionMenu shows a compact member menu for approved non-admin members', async () => {
  const menu = resolveTelegramActionMenu({
    context: createContext({
      actor: {
        telegramUserId: 77,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin: false,
        permissions: [],
      },
      chat: {
        kind: 'private',
        chatId: 1,
      },
    }),
  });

  assert.deepEqual(menu, {
    menuId: 'private-approved-default',
    replyKeyboard: [
      [{ text: 'Activitats', semanticRole: 'primary' }, { text: 'Taules', semanticRole: 'primary' }],
      [{ text: 'Catàleg', semanticRole: 'primary' }, { text: 'Emmagatzematge', semanticRole: 'primary' }],
      [{ text: 'Compres conjuntes', semanticRole: 'primary' }, { text: 'LFG (buscar grup)', semanticRole: 'primary' }],
      [{ text: 'Canviar nom', semanticRole: 'secondary' }, { text: 'Idioma', semanticRole: 'secondary' }, { text: 'Ajuda', semanticRole: 'help' }],
    ],
    actionRows: [['schedule', 'tables_read'], ['catalog', 'storage'], ['group_purchases', 'lfg'], ['change_display_name', 'language', 'help']],
    actions: [
      { id: 'schedule', label: 'Activitats', telemetryActionKey: 'menu.schedule', uxSection: 'primary' },
      { id: 'tables_read', label: 'Taules', telemetryActionKey: 'menu.tables', uxSection: 'primary' },
      { id: 'catalog', label: 'Catàleg', telemetryActionKey: 'menu.catalog', uxSection: 'primary' },
      { id: 'storage', label: 'Emmagatzematge', telemetryActionKey: 'menu.storage', uxSection: 'primary' },
      { id: 'group_purchases', label: 'Compres conjuntes', telemetryActionKey: 'menu.group_purchases', uxSection: 'primary' },
      { id: 'lfg', label: 'LFG (buscar grup)', telemetryActionKey: 'menu.lfg', uxSection: 'primary' },
      { id: 'change_display_name', label: 'Canviar nom', telemetryActionKey: 'menu.change_display_name', uxSection: 'utility' },
      { id: 'language', label: 'Idioma', telemetryActionKey: 'menu.language', uxSection: 'utility' },
      { id: 'help', label: 'Ajuda', telemetryActionKey: 'menu.help', uxSection: 'utility' },
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });
});

test('resolveTelegramMenuSelection maps translated button text to stable menu action metadata', async () => {
  const selection = resolveTelegramMenuSelection({
    context: createContext({
      actor: {
        telegramUserId: 77,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin: false,
        permissions: [],
      },
      chat: {
        kind: 'private',
        chatId: 1,
      },
    }),
    text: 'Taules',
  });

  assert.deepEqual(selection, {
    menuId: 'private-approved-default',
    actionId: 'tables_read',
    label: 'Taules',
    telemetryActionKey: 'menu.tables',
    uxSection: 'primary',
  });
});

test('resolveTelegramMenuSelection accepts menu text from a different language', async () => {
  const selection = resolveTelegramMenuSelection({
    context: createContext({
      actor: {
        telegramUserId: 77,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin: false,
        permissions: [],
      },
      chat: {
        kind: 'private',
        chatId: 1,
      },
    }),
    text: 'Catálogo',
  });

  assert.deepEqual(selection, {
    menuId: 'private-approved-default',
    actionId: 'catalog',
    label: 'Catàleg',
    telemetryActionKey: 'menu.catalog',
    uxSection: 'primary',
  });
});

test('resolveTelegramActionMenu exposes activities to admins in private chats', async () => {
  const menu = resolveTelegramActionMenu({
    context: createContext({
      actor: {
        telegramUserId: 99,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin: true,
        permissions: [],
      },
      chat: {
        kind: 'private',
        chatId: 1,
      },
    }),
  });

  assert.deepEqual(menu, {
    menuId: 'private-admin-default',
    replyKeyboard: [
      [{ text: 'Revisar sol·licituds', semanticRole: 'secondary' }, { text: 'Administrar usuaris', semanticRole: 'secondary' }],
      [{ text: 'Activitats', semanticRole: 'primary' }, { text: 'Taules', semanticRole: 'primary' }],
      [{ text: 'Catàleg', semanticRole: 'primary' }, { text: 'Emmagatzematge', semanticRole: 'primary' }],
      [{ text: 'Compres conjuntes', semanticRole: 'primary' }, { text: 'LFG (buscar grup)', semanticRole: 'primary' }],
      [{ text: 'Benvingudes', semanticRole: 'secondary' }, { text: 'Canviar nom', semanticRole: 'secondary' }],
      [{ text: 'Idioma', semanticRole: 'secondary' }, { text: 'Ajuda', semanticRole: 'help' }],
    ],
    actionRows: [['review_access', 'manage_users'], ['schedule', 'tables'], ['catalog', 'storage'], ['group_purchases', 'lfg'], ['welcome_templates', 'change_display_name'], ['language', 'help']],
    actions: [
      { id: 'review_access', label: 'Revisar sol·licituds', telemetryActionKey: 'menu.review_access', uxSection: 'admin' },
      { id: 'manage_users', label: 'Administrar usuaris', telemetryActionKey: 'menu.manage_users', uxSection: 'admin' },
      { id: 'schedule', label: 'Activitats', telemetryActionKey: 'menu.schedule', uxSection: 'primary' },
      { id: 'tables', label: 'Taules', telemetryActionKey: 'menu.tables_admin', uxSection: 'admin' },
      { id: 'catalog', label: 'Catàleg', telemetryActionKey: 'menu.catalog', uxSection: 'primary' },
      { id: 'storage', label: 'Emmagatzematge', telemetryActionKey: 'menu.storage', uxSection: 'primary' },
      { id: 'group_purchases', label: 'Compres conjuntes', telemetryActionKey: 'menu.group_purchases', uxSection: 'primary' },
      { id: 'lfg', label: 'LFG (buscar grup)', telemetryActionKey: 'menu.lfg', uxSection: 'primary' },
      { id: 'welcome_templates', label: 'Benvingudes', telemetryActionKey: 'menu.welcome_templates', uxSection: 'admin' },
      { id: 'change_display_name', label: 'Canviar nom', telemetryActionKey: 'menu.change_display_name', uxSection: 'utility' },
      { id: 'language', label: 'Idioma', telemetryActionKey: 'menu.language', uxSection: 'utility' },
      { id: 'help', label: 'Ajuda', telemetryActionKey: 'menu.help', uxSection: 'utility' },
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });
});

test('resolveTelegramActionMenu treats revoked users like pending users for access re-request', async () => {
  const menu = resolveTelegramActionMenu({
    context: createContext({
      actor: {
        telegramUserId: 43,
        status: 'revoked',
        isApproved: false,
        isBlocked: false,
        isAdmin: false,
        permissions: [],
      },
      chat: {
        kind: 'private',
        chatId: 1,
      },
    }),
  });

  assert.deepEqual(menu, {
    menuId: 'private-pending-default',
    replyKeyboard: [[{ text: 'Accés al club', semanticRole: 'primary' }], [{ text: 'Idioma', semanticRole: 'secondary' }, { text: 'Ajuda', semanticRole: 'help' }]],
    actionRows: [['access'], ['language', 'help']],
    actions: [
      { id: 'access', label: 'Accés al club', telemetryActionKey: 'menu.access', uxSection: 'access' },
      { id: 'language', label: 'Idioma', telemetryActionKey: 'menu.language', uxSection: 'utility' },
      { id: 'help', label: 'Ajuda', telemetryActionKey: 'menu.help', uxSection: 'utility' },
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });
});

test('resolveTelegramActionMenu replaces the default menu when a flow is active', async () => {
  const menu = resolveTelegramActionMenu({
    context: createContext({
      actor: {
        telegramUserId: 99,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin: true,
        permissions: [],
      },
      chat: {
        kind: 'private',
        chatId: 1,
      },
      session: {
        key: 'telegram.session:1:99',
        flowKey: 'schedule-create',
        stepKey: 'title',
        data: {},
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        expiresAt: '2026-04-04T11:00:00.000Z',
      },
    }),
  });

  assert.deepEqual(menu, {
    menuId: 'active-flow',
    replyKeyboard: [[{ text: '/cancel', semanticRole: 'danger' }]],
    actionRows: [['cancel']],
    actions: [
      { id: 'cancel', label: '/cancel', telemetryActionKey: 'menu.cancel', uxSection: 'flow' },
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });
});
