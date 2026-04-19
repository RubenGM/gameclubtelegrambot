import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTelegramMenuUxReportSnapshot,
  type TelegramMenuUxAuditEvent,
} from './telegram-menu-ux-report.js';

test('buildTelegramMenuUxReportSnapshot aggregates summary top actions and role breakdown', () => {
  const events: TelegramMenuUxAuditEvent[] = [
    {
      actionKey: 'telegram.menu.shown',
      targetId: 'private-approved-default',
      details: {
        actorRole: 'member',
        language: 'ca',
        menuId: 'private-approved-default',
        visibleActionIds: ['schedule', 'tables_read', 'catalog', 'language', 'help'],
        visibleLabels: ['Activitats', 'Taules', 'Cataleg', 'Idioma', 'Ajuda'],
      },
      createdAt: '2026-04-20T10:00:00.000Z',
    },
    {
      actionKey: 'telegram.menu.action_selected',
      targetId: 'private-approved-default',
      details: {
        actorRole: 'member',
        language: 'ca',
        menuId: 'private-approved-default',
        actionId: 'schedule',
        telemetryActionKey: 'menu.schedule',
        label: 'Activitats',
      },
      createdAt: '2026-04-20T10:01:00.000Z',
    },
    {
      actionKey: 'telegram.menu.action_selected',
      targetId: 'private-approved-default',
      details: {
        actorRole: 'member',
        language: 'ca',
        menuId: 'private-approved-default',
        actionId: 'schedule',
        telemetryActionKey: 'menu.schedule',
        label: 'Activitats',
      },
      createdAt: '2026-04-20T10:05:00.000Z',
    },
    {
      actionKey: 'telegram.menu.shown',
      targetId: 'private-admin-default',
      details: {
        actorRole: 'admin',
        language: 'ca',
        menuId: 'private-admin-default',
        visibleActionIds: ['review_access', 'manage_users', 'schedule'],
        visibleLabels: ['Revisar sollicituds', 'Administrar usuaris', 'Activitats'],
      },
      createdAt: '2026-04-20T11:00:00.000Z',
    },
    {
      actionKey: 'telegram.menu.action_selected',
      targetId: 'private-admin-default',
      details: {
        actorRole: 'admin',
        language: 'ca',
        menuId: 'private-admin-default',
        actionId: 'review_access',
        telemetryActionKey: 'menu.review_access',
        label: 'Revisar sollicituds',
      },
      createdAt: '2026-04-20T11:03:00.000Z',
    },
    {
      actionKey: 'telegram.menu.shown',
      targetId: 'private-pending-default',
      details: {
        actorRole: 'pending',
        language: 'ca',
        menuId: 'private-pending-default',
        visibleActionIds: ['access', 'language', 'help'],
        visibleLabels: ['Acces al club', 'Idioma', 'Ajuda'],
      },
      createdAt: '2026-04-20T12:00:00.000Z',
    },
    {
      actionKey: 'telegram.menu.action_selected',
      targetId: 'private-approved-default',
      details: {
        actorRole: 'member',
        menuId: 'private-approved-default',
        label: 'Taules',
      },
      createdAt: '2026-04-20T12:01:00.000Z',
    },
  ];

  const snapshot = buildTelegramMenuUxReportSnapshot({
    windowDays: 7,
    generatedAt: '2026-04-20T13:00:00.000Z',
    events,
  });

  assert.deepEqual(snapshot.summary, {
    menuShownCount: 3,
    actionSelectedCount: 3,
    interactionRate: 1,
    distinctMenus: 3,
    distinctActions: 2,
  });
  assert.deepEqual(snapshot.topActions, [
    {
      telemetryActionKey: 'menu.schedule',
      actionId: 'schedule',
      labelSample: 'Activitats',
      selectionCount: 2,
      share: 0.6667,
    },
    {
      telemetryActionKey: 'menu.review_access',
      actionId: 'review_access',
      labelSample: 'Revisar sollicituds',
      selectionCount: 1,
      share: 0.3333,
    },
  ]);
  assert.deepEqual(snapshot.roleBreakdown, [
    {
      actorRole: 'member',
      menuShownCount: 1,
      actionSelectedCount: 2,
      interactionRate: 2,
      topActionKey: 'menu.schedule',
    },
    {
      actorRole: 'admin',
      menuShownCount: 1,
      actionSelectedCount: 1,
      interactionRate: 1,
      topActionKey: 'menu.review_access',
    },
    {
      actorRole: 'pending',
      menuShownCount: 1,
      actionSelectedCount: 0,
      interactionRate: 0,
      topActionKey: null,
    },
  ]);
});

test('buildTelegramMenuUxReportSnapshot returns an empty snapshot without events', () => {
  const snapshot = buildTelegramMenuUxReportSnapshot({
    windowDays: 7,
    generatedAt: '2026-04-20T13:00:00.000Z',
    events: [],
  });

  assert.deepEqual(snapshot.summary, {
    menuShownCount: 0,
    actionSelectedCount: 0,
    interactionRate: 0,
    distinctMenus: 0,
    distinctActions: 0,
  });
  assert.deepEqual(snapshot.topActions, []);
  assert.deepEqual(snapshot.roleBreakdown, []);
});
