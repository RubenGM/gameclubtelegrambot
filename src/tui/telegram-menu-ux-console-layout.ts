import type { TelegramMenuUxReportSnapshot } from '../operations/telegram-menu-ux-report.js';

export function formatTelegramMenuUxSummaryPanel(snapshot: TelegramMenuUxReportSnapshot): string {
  return [
    `Window: last ${snapshot.windowDays} days`,
    `Generated: ${formatTimestamp(snapshot.generatedAt)}`,
    '',
    `Menus shown: ${snapshot.summary.menuShownCount}`,
    `Actions selected: ${snapshot.summary.actionSelectedCount}`,
    `Interaction rate: ${formatPercent(snapshot.summary.interactionRate)}`,
    `Distinct menus: ${snapshot.summary.distinctMenus}`,
    `Distinct actions: ${snapshot.summary.distinctActions}`,
  ].join('\n');
}

export function formatTelegramMenuUxTopActionsPanel(snapshot: TelegramMenuUxReportSnapshot): string {
  if (snapshot.topActions.length === 0) {
    return 'Top actions\n\nNo action selections recorded in this window.';
  }

  return [
    'Top actions',
    '',
    formatTable(
      ['Action key', 'Action ID', 'Label', 'Count', 'Share'],
      snapshot.topActions.map((action) => [
        action.telemetryActionKey,
        action.actionId,
        action.labelSample,
        String(action.selectionCount),
        formatPercent(action.share),
      ]),
    ),
  ].join('\n');
}

export function formatTelegramMenuUxRoleBreakdownPanel(snapshot: TelegramMenuUxReportSnapshot): string {
  if (snapshot.roleBreakdown.length === 0) {
    return 'By role\n\nNo role activity recorded in this window.';
  }

  return [
    'By role',
    '',
    formatTable(
      ['Role', 'Shown', 'Selected', 'Rate', 'Top action'],
      snapshot.roleBreakdown.map((role) => [
        role.actorRole,
        String(role.menuShownCount),
        String(role.actionSelectedCount),
        formatPercent(role.interactionRate),
        role.topActionKey ?? '-',
      ]),
    ),
  ].join('\n');
}

function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );

  const headerRow = headers.map((header, index) => header.padEnd(widths[index] ?? header.length)).join(' | ');
  const separator = widths.map((width) => '-'.repeat(width)).join('-+-');
  const body = rows.map((row) => row.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join(' | '));

  return [headerRow, separator, ...body].join('\n');
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
}
