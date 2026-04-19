import { loadRuntimeConfig, RuntimeConfigError } from '../config/load-runtime-config.js';
import { readTelegramMenuUxReportForConfig, type TelegramMenuUxReportSnapshot } from '../operations/telegram-menu-ux-report.js';
import { parseTelegramMenuUxArgs } from './telegram-menu-ux-args.js';

export function formatTelegramMenuUxReportText(snapshot: TelegramMenuUxReportSnapshot): string {
  const lines = [
    'Telegram Menu UX Report',
    `Window: last ${snapshot.windowDays} days`,
    `Generated: ${snapshot.generatedAt}`,
    '',
    'Summary',
    `- Menus shown: ${snapshot.summary.menuShownCount}`,
    `- Actions selected: ${snapshot.summary.actionSelectedCount}`,
    `- Interaction rate: ${formatPercent(snapshot.summary.interactionRate)}`,
    `- Distinct menus: ${snapshot.summary.distinctMenus}`,
    `- Distinct actions: ${snapshot.summary.distinctActions}`,
    '',
    'Top Actions',
  ];

  if (snapshot.topActions.length === 0) {
    lines.push('No action selections recorded in this window.');
  } else {
    lines.push('Action key           Count   Share   Label');
    lines.push('-------------------  ------  ------  -------------------------');
    for (const action of snapshot.topActions) {
      lines.push(
        `${action.telemetryActionKey.padEnd(19)}  ${String(action.selectionCount).padStart(6)}  ${formatPercent(action.share).padStart(6)}  ${action.labelSample}`,
      );
    }
  }

  lines.push('');
  lines.push('By Role');
  if (snapshot.roleBreakdown.length === 0) {
    lines.push('No role activity recorded in this window.');
  } else {
    lines.push('Role     Shown   Selected   Rate    Top action');
    lines.push('-------  ------  ---------  ------  -------------------');
    for (const role of snapshot.roleBreakdown) {
      lines.push(
        `${role.actorRole.padEnd(7)}  ${String(role.menuShownCount).padStart(6)}  ${String(role.actionSelectedCount).padStart(9)}  ${formatPercent(role.interactionRate).padStart(6)}  ${role.topActionKey ?? '-'}`,
      );
    }
  }

  return lines.join('\n');
}

async function main(argv: string[]): Promise<void> {
  const args = parseTelegramMenuUxArgs(argv);
  const config = await loadRuntimeConfig();
  const snapshot = await readTelegramMenuUxReportForConfig({
    config,
    windowDays: args.windowDays,
  });
  process.stdout.write(`${formatTelegramMenuUxReportText(snapshot)}\n`);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof RuntimeConfigError || error instanceof Error) {
      console.error(error.message);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
