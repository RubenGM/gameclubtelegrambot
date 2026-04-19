import test from 'node:test';
import assert from 'node:assert/strict';

import { formatTelegramMenuUxReportText } from './telegram-menu-ux-report.js';

test('formatTelegramMenuUxReportText renders summary top actions and role breakdown', () => {
  const output = formatTelegramMenuUxReportText({
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
  });

  assert.match(output, /Telegram Menu UX Report/);
  assert.match(output, /Summary/);
  assert.match(output, /Top Actions/);
  assert.match(output, /By Role/);
  assert.match(output, /menu\.schedule/);
  assert.match(output, /member/);
});

test('formatTelegramMenuUxReportText renders a readable empty state', () => {
  const output = formatTelegramMenuUxReportText({
    windowDays: 7,
    generatedAt: '2026-04-20T13:00:00.000Z',
    summary: {
      menuShownCount: 0,
      actionSelectedCount: 0,
      interactionRate: 0,
      distinctMenus: 0,
      distinctActions: 0,
    },
    topActions: [],
    roleBreakdown: [],
  });

  assert.match(output, /No action selections recorded/);
  assert.match(output, /No role activity recorded/);
});
