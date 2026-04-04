import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import SysTrayPackage, { type ClickEvent, type Menu, type MenuItem } from 'systray2';

import type { TrayActionId, TrayMenuItem, TrayRuntime, TrayStatusIndicator } from './tray-app.js';

const SysTray = SysTrayPackage as unknown as typeof import('systray2').default;

const trayIconBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO0p6YQAAAAASUVORK5CYII=';

export function createDebianTrayRuntime(): TrayRuntime {
  return new DebianTrayRuntime();
}

class DebianTrayRuntime implements TrayRuntime {
  private systray: import('systray2').default | null = null;
  private items: TrayMenuItem[] = [];
  private tooltip = 'Game Club Bot';
  private status: TrayStatusIndicator = 'unknown';
  private actionHandler: ((actionId: TrayActionId) => Promise<void>) | null = null;

  async start(): Promise<void> {
    const tray = new SysTray({
      menu: this.createMenu(),
      debug: false,
      copyDir: false,
    });

    tray.onClick(async (event: ClickEvent) => {
      const actionId = parseActionId(event.item);
      if (!actionId || !this.actionHandler) {
        return;
      }

      await this.actionHandler(actionId);
    });

    await tray.ready();
    this.systray = tray;
  }

  onAction(handler: (actionId: TrayActionId) => Promise<void>): void {
    this.actionHandler = handler;
  }

  async setMenu(items: TrayMenuItem[]): Promise<void> {
    this.items = items;
    await this.syncMenu();
  }

  async setStatus(state: TrayStatusIndicator): Promise<void> {
    this.status = state;
    await this.syncMenu();
  }

  async setTooltip(text: string): Promise<void> {
    this.tooltip = text;
    await this.syncMenu();
  }

  async showNotification(title: string, message: string): Promise<void> {
    await trySpawnDetached('notify-send', [title, message]);
  }

  async showTextWindow(title: string, content: string): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), 'gameclubtelegrambot-tray-'));
    const filePath = join(directory, 'logs.txt');
    await writeFile(filePath, content, 'utf8');
    await trySpawnDetached('xdg-open', [filePath], title, `Logs disponibles a ${filePath}`);
  }

  async stop(): Promise<void> {
    if (!this.systray || this.systray.killed) {
      return;
    }

    await this.systray.kill(false);
    this.systray = null;
  }

  private createMenu(): Menu {
    return {
      icon: trayIconBase64,
      title: trayTitle(this.status),
      tooltip: this.tooltip,
      items: this.items.map(toSystrayMenuItem),
    };
  }

  private async syncMenu(): Promise<void> {
    if (!this.systray || this.systray.killed) {
      return;
    }

    await this.systray.sendAction({
      type: 'update-menu',
      menu: this.createMenu(),
    });
  }
}

function toSystrayMenuItem(item: TrayMenuItem): MenuItem {
  return {
    title: item.title,
    tooltip: `action:${item.id}`,
    enabled: item.enabled,
  };
}

function parseActionId(item: MenuItem): TrayActionId | null {
  const tooltip = item.tooltip ?? '';
  if (!tooltip.startsWith('action:')) {
    return null;
  }

  const actionId = tooltip.slice('action:'.length);
  if (
    actionId === 'status' ||
    actionId === 'start' ||
    actionId === 'stop' ||
    actionId === 'restart' ||
    actionId === 'logs' ||
    actionId === 'refresh' ||
    actionId === 'quit'
  ) {
    return actionId;
  }

  return null;
}

function trayTitle(state: TrayStatusIndicator): string {
  switch (state) {
    case 'active':
      return 'GC active';
    case 'inactive':
      return 'GC off';
    case 'failed':
      return 'GC failed';
    case 'activating':
      return 'GC starting';
    case 'deactivating':
      return 'GC stopping';
    case 'busy':
      return 'GC busy';
    default:
      return 'GC unknown';
  }
}

async function trySpawnDetached(
  command: string,
  args: string[],
  fallbackTitle?: string,
  fallbackMessage?: string,
): Promise<void> {
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    if (fallbackTitle && fallbackMessage) {
      try {
        const child = spawn('notify-send', [fallbackTitle, fallbackMessage], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
      } catch {
        // Best-effort UI fallback only.
      }
    }
  }
}
