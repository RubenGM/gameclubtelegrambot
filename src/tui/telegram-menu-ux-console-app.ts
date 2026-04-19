import blessed from 'blessed';

import type { TelegramMenuUxReportSnapshot } from '../operations/telegram-menu-ux-report.js';
import type { TelegramMenuUxReportOperations } from '../operations/telegram-menu-ux-report.js';
import {
  formatTelegramMenuUxRoleBreakdownPanel,
  formatTelegramMenuUxSummaryPanel,
  formatTelegramMenuUxTopActionsPanel,
} from './telegram-menu-ux-console-layout.js';

type TelegramMenuUxViewId = 'summary' | 'top-actions' | 'by-role';

export interface TelegramMenuUxConsoleAppOptions {
  operations: TelegramMenuUxReportOperations;
  windowDays: number;
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
}

export class TelegramMenuUxConsoleApp {
  private readonly stdin: NodeJS.ReadStream;
  private readonly stdout: NodeJS.WriteStream;
  private readonly screen: blessed.Widgets.Screen;
  private readonly headerBox: blessed.Widgets.BoxElement;
  private readonly bodyBox: blessed.Widgets.BoxElement;
  private readonly footerBox: blessed.Widgets.BoxElement;
  private readonly viewIds: TelegramMenuUxViewId[] = ['summary', 'top-actions', 'by-role'];
  private currentViewIndex = 0;
  private closed = false;

  constructor(private readonly options: TelegramMenuUxConsoleAppOptions) {
    this.stdin = options.stdin ?? process.stdin;
    this.stdout = options.stdout ?? process.stdout;

    this.screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
      dockBorders: true,
      title: 'Telegram Menu UX Console',
      input: this.stdin,
      output: this.stdout,
    });

    this.headerBox = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      tags: true,
      border: 'line',
      label: ' Telegram Menu UX ',
    });

    this.bodyBox = blessed.box({
      parent: this.screen,
      top: 3,
      left: 0,
      width: '100%',
      height: '100%-6',
      border: 'line',
      label: ' Report ',
      padding: { left: 1, right: 1 },
      scrollable: true,
      alwaysScroll: true,
      tags: true,
    });

    this.footerBox = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
      tags: true,
      border: 'line',
      label: ' Keys ',
      content: 'Left/Right switch view | r refresh | q quit',
    });

    this.bindEvents();
  }

  async run(): Promise<void> {
    if (!this.stdin.isTTY || !this.stdout.isTTY) {
      throw new Error('Telegram menu UX console requires an interactive terminal.');
    }

    await this.refresh();
    this.screen.render();

    await new Promise<void>((resolve) => {
      this.screen.key(['q', 'C-c'], () => {
        void this.stop();
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.screen.destroy();
  }

  private bindEvents(): void {
    this.screen.key(['left'], () => {
      this.moveView(-1);
    });
    this.screen.key(['right', 'tab'], () => {
      this.moveView(1);
    });
    this.screen.key(['r'], () => {
      void this.refresh();
    });
  }

  private moveView(direction: -1 | 1): void {
    const total = this.viewIds.length;
    this.currentViewIndex = (this.currentViewIndex + direction + total) % total;
    this.bodyBox.setContent(this.renderCurrentView(this.lastSnapshot));
    this.renderHeader(this.lastSnapshot);
    this.screen.render();
  }

  private lastSnapshot: TelegramMenuUxReportSnapshot | null = null;

  private async refresh(): Promise<void> {
    const snapshot = await this.options.operations.readReport(this.options.windowDays);
    this.lastSnapshot = snapshot;
    this.renderHeader(snapshot);
    this.bodyBox.setContent(this.renderCurrentView(snapshot));
    this.screen.render();
  }

  private renderHeader(snapshot: TelegramMenuUxReportSnapshot | null): void {
    const currentView = this.viewIds[this.currentViewIndex] ?? 'summary';
    const tabs = this.viewIds.map((viewId) => (viewId === currentView ? `[${viewId}]` : viewId)).join(' | ');
    if (!snapshot) {
      this.headerBox.setContent(`Loading...\nViews: ${tabs}`);
      return;
    }

    this.headerBox.setContent(
      `Window: last ${snapshot.windowDays} days | Menus: ${snapshot.summary.menuShownCount} | Selected: ${snapshot.summary.actionSelectedCount}\nViews: ${tabs}`,
    );
  }

  private renderCurrentView(snapshot: TelegramMenuUxReportSnapshot | null): string {
    if (!snapshot) {
      return 'Loading report...';
    }

    switch (this.viewIds[this.currentViewIndex]) {
      case 'top-actions':
        return formatTelegramMenuUxTopActionsPanel(snapshot);
      case 'by-role':
        return formatTelegramMenuUxRoleBreakdownPanel(snapshot);
      case 'summary':
      default:
        return formatTelegramMenuUxSummaryPanel(snapshot);
    }
  }
}
