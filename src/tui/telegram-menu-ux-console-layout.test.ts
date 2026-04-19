import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatTelegramMenuUxRoleBreakdownPanel,
  formatTelegramMenuUxSummaryPanel,
  formatTelegramMenuUxTopActionsPanel,
} from './telegram-menu-ux-console-layout.js';

const snapshot = {
  windowDays: 7,
  generatedAt: '2026-04-20T13:00:00.000Z',
  summary: {
    menuShownCount: 12,
    actionSelectedCount: 9,
    interactionRate: 0.75,
    distinctMenus: 3,
    distinctActions: 4,
  },
  topActions: [
    {
      telemetryActionKey: 'menu.schedule',
      actionId: 'schedule',
      labelSample: 'Activitats',
      selectionCount: 5,
      share: 0.5556,
    },
  ],
  roleBreakdown: [
    {
      actorRole: 'member',
      menuShownCount: 8,
      actionSelectedCount: 6,
      interactionRate: 0.75,
      topActionKey: 'menu.schedule',
    },
  ],
};

test('formatTelegramMenuUxSummaryPanel renders core metrics compactly', () => {
  const output = formatTelegramMenuUxSummaryPanel(snapshot);

  assert.match(output, /Window: last 7 days/);
  assert.match(output, /Menus shown: 12/);
  assert.match(output, /Actions selected: 9/);
  assert.match(output, /Interaction rate: 75.0%/);
});

test('formatTelegramMenuUxTopActionsPanel renders ranked actions', () => {
  const output = formatTelegramMenuUxTopActionsPanel(snapshot);

  assert.match(output, /Top actions/);
  assert.match(output, /menu\.schedule/);
  assert.match(output, /Activitats/);
  assert.match(output, /55.6%/);
});

test('formatTelegramMenuUxRoleBreakdownPanel renders role rows', () => {
  const output = formatTelegramMenuUxRoleBreakdownPanel(snapshot);

  assert.match(output, /By role/);
  assert.match(output, /member/);
  assert.match(output, /menu\.schedule/);
});

test('telegram menu UX panels show a friendly empty state', () => {
  const emptySnapshot = {
    ...snapshot,
    summary: {
      menuShownCount: 0,
      actionSelectedCount: 0,
      interactionRate: 0,
      distinctMenus: 0,
      distinctActions: 0,
    },
    topActions: [],
    roleBreakdown: [],
  };

  assert.match(formatTelegramMenuUxTopActionsPanel(emptySnapshot), /No action selections recorded/);
  assert.match(formatTelegramMenuUxRoleBreakdownPanel(emptySnapshot), /No role activity recorded/);
});
