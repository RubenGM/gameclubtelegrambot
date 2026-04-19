import blessed from 'blessed';

import type { BackupArchiveInfo } from '../operations/backup-types.js';
import type { BackupOperations } from '../operations/backup-operations.js';
import { BackupOperationError } from '../operations/backup-operations.js';

import {
  formatBackupArchiveRow,
  formatDatabasePanel,
  formatSystemPanel,
} from './backup-console-layout.js';

export interface BackupConsoleAppOptions {
  operations: BackupOperations;
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  pollIntervalMs?: number;
}

export class BackupConsoleApp {
  private readonly screen: blessed.Widgets.Screen;
  private readonly headerBox: blessed.Widgets.BoxElement;
  private readonly footerBox: blessed.Widgets.BoxElement;
  private readonly systemBox: blessed.Widgets.BoxElement;
  private readonly databaseBox: blessed.Widgets.BoxElement;
  private readonly backupsList: blessed.Widgets.ListElement;
  private readonly logBox: blessed.Widgets.BoxElement;
  private readonly refreshButton: blessed.Widgets.ButtonElement;
  private readonly backupButton: blessed.Widgets.ButtonElement;
  private readonly restoreButton: blessed.Widgets.ButtonElement;
  private readonly pathButton: blessed.Widgets.ButtonElement;
  private readonly quitButton: blessed.Widgets.ButtonElement;
  private readonly questionBox: blessed.Widgets.QuestionElement;
  private pollTimer: NodeJS.Timeout | null = null;
  private isBusy = false;
  private archives: BackupArchiveInfo[] = [];
  private closed = false;
  private readonly stdin: NodeJS.ReadStream;
  private readonly stdout: NodeJS.WriteStream;
  private focusIndex = 0;

  constructor(private readonly options: BackupConsoleAppOptions) {
    this.stdin = options.stdin ?? process.stdin;
    this.stdout = options.stdout ?? process.stdout;

    this.screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
      dockBorders: true,
      title: 'Game Club Backup Console',
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
      label: ' Backup Console ',
    });

    this.refreshButton = this.createButton('Refresh', 0);
    this.backupButton = this.createButton('Create Backup', 16);
    this.restoreButton = this.createButton('Restore Selected', 38);
    this.pathButton = this.createButton('Show Path', 63);
    this.quitButton = this.createButton('Quit', 79);

    this.footerBox = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
      tags: true,
      border: 'line',
      label: ' Keys ',
      content: 'Tab/Shift+Tab move focus | Up/Down select backup | Enter/Space activate | r refresh | b backup | s path | q quit',
    });

    this.systemBox = blessed.box({
      parent: this.screen,
      top: 6,
      left: 0,
      width: '45%',
      height: 14,
      tags: true,
      border: 'line',
      label: ' System Status ',
      padding: { left: 1, right: 1 },
      scrollable: true,
    });

    this.databaseBox = blessed.box({
      parent: this.screen,
      top: 6,
      left: '45%',
      width: '55%',
      height: 14,
      tags: true,
      border: 'line',
      label: ' Database Summary ',
      padding: { left: 1, right: 1 },
      scrollable: true,
    });

    this.backupsList = blessed.list({
      parent: this.screen,
      top: 20,
      left: 0,
      width: '50%',
      height: '100%-23',
      border: 'line',
      label: ' Backups ',
      mouse: true,
      keys: true,
      vi: true,
      scrollable: true,
      style: {
        selected: {
          bg: 'blue',
          fg: 'white',
        },
      },
    });

    this.logBox = blessed.box({
      parent: this.screen,
      top: 20,
      left: '50%',
      width: '50%',
      height: '100%-23',
      border: 'line',
      label: ' Operation Log ',
      padding: { left: 1, right: 1 },
      scrollable: true,
      alwaysScroll: true,
      tags: true,
    });

    this.questionBox = blessed.question({
      parent: this.screen,
      width: '60%',
      height: 7,
      top: 'center',
      left: 'center',
      border: 'line',
      label: ' Confirm Restore ',
      tags: true,
      hidden: true,
    });

    this.bindEvents();
  }

  async run(): Promise<void> {
    if (!this.stdin.isTTY || !this.stdout.isTTY) {
      throw new Error('Backup console requires an interactive terminal.');
    }

    await this.refresh();
    this.focusIndex = focusTargetCount - 1;
    this.focusCurrentTarget();
    this.startPolling();
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
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.screen.destroy();
  }

  private createButton(label: string, left: number): blessed.Widgets.ButtonElement {
    return blessed.button({
      parent: this.screen,
      top: 3,
      left,
      width: label.length + 4,
      height: 3,
      mouse: true,
      keys: true,
      shrink: true,
      border: 'line',
      content: ` ${label} `,
      style: {
        focus: { bg: 'green', fg: 'black' },
        hover: { bg: 'green', fg: 'black' },
      },
    });
  }

  private bindEvents(): void {
    bindBackupConsoleButtonAction(this.refreshButton, () => {
      void this.refresh();
    });
    bindBackupConsoleButtonAction(this.backupButton, () => {
      void this.createBackup();
    });
    bindBackupConsoleButtonAction(this.restoreButton, () => {
      void this.restoreSelectedBackup();
    });
    bindBackupConsoleButtonAction(this.pathButton, () => {
      void this.showBackupPath();
    });
    bindBackupConsoleButtonAction(this.quitButton, () => {
      void this.stop();
    });

    this.screen.key(['r'], () => {
      void this.refresh();
    });
    this.screen.key(['c', 'b'], () => {
      void this.createBackup();
    });
    this.screen.key(['s', 'p'], () => {
      void this.showBackupPath();
    });
    this.screen.key(['tab'], () => {
      this.moveFocus(1);
    });
    this.screen.key(['S-tab'], () => {
      this.moveFocus(-1);
    });
    this.screen.key(['left'], () => {
      this.moveFocus(-1);
    });
    this.screen.key(['right'], () => {
      this.moveFocus(1);
    });
    this.screen.key(['enter', 'space'], () => {
      void this.activateFocusedTarget();
    });
  }

  private async refresh(): Promise<void> {
    if (this.isBusy) {
      return;
    }

    const status = await this.options.operations.readBackupConsoleStatus();
    this.archives = status.backups.archives;
    this.headerBox.setContent(
      `Service {bold}${status.service.state}{/bold} | Backups ${status.backups.totalCount} | Latest ${status.backups.latestBackup?.fileName ?? 'none'}`,
    );
    this.systemBox.setContent(formatSystemPanel(status));
    this.databaseBox.setContent(formatDatabasePanel(status.database));
    this.backupsList.setItems(this.archives.map((archive) => formatBackupArchiveRow(archive)));
    this.logBox.setContent(await this.options.operations.readLastOperationLog());
    this.screen.render();
  }

  private async createBackup(): Promise<void> {
    if (this.isBusy) {
      return;
    }

    this.isBusy = true;
    this.logBox.setContent('Creating backup...');
    this.screen.render();

    try {
      const result = await this.options.operations.createFullBackup();
      this.logBox.setContent(result.output);
      await this.refresh();
    } catch (error) {
      this.logBox.setContent(renderOperationError(error));
      this.screen.render();
    } finally {
      this.isBusy = false;
    }
  }

  private async restoreSelectedBackup(): Promise<void> {
    if (this.isBusy) {
      return;
    }

    const selectedIndex = (this.backupsList as blessed.Widgets.ListElement & { selected: number }).selected;
    const selectedArchive = this.archives[selectedIndex];
    if (!selectedArchive) {
      this.logBox.setContent('Select a backup first.');
      this.screen.render();
      return;
    }

    const confirmed = await this.askConfirmation(
      `Restore ${selectedArchive.fileName}? This will overwrite runtime data and database contents.`,
    );
    if (!confirmed) {
      return;
    }

    this.isBusy = true;
    this.logBox.setContent(`Restoring ${selectedArchive.fileName}...`);
    this.screen.render();

    try {
      const result = await this.options.operations.restoreFullBackup({
        backupFilePath: selectedArchive.filePath,
      });
      this.logBox.setContent(result.output);
      await this.refresh();
    } catch (error) {
      this.logBox.setContent(renderOperationError(error));
      this.screen.render();
    } finally {
      this.isBusy = false;
    }
  }

  private async showBackupPath(): Promise<void> {
    const status = await this.options.operations.readBackupConsoleStatus();
    this.logBox.setContent(`Backup directory:\n${status.backups.directory}`);
    this.screen.render();
  }

  private moveFocus(direction: 1 | -1): void {
    this.focusIndex = resolveNextBackupConsoleFocusIndex(this.focusIndex, focusTargetCount, direction);
    this.focusCurrentTarget();
    this.screen.render();
  }

  private focusCurrentTarget(): void {
    this.getFocusTargets()[this.focusIndex]?.focus();
  }

  private async activateFocusedTarget(): Promise<void> {
    switch (this.focusIndex) {
      case 0:
        await this.refresh();
        return;
      case 1:
        await this.createBackup();
        return;
      case 2:
        await this.restoreSelectedBackup();
        return;
      case 3:
        await this.showBackupPath();
        return;
      case 4:
        await this.stop();
        return;
      case 5:
        await this.restoreSelectedBackup();
        return;
      default:
        return;
    }
  }

  private getFocusTargets(): Array<{ focus(): void }> {
    return [
      this.refreshButton,
      this.backupButton,
      this.restoreButton,
      this.pathButton,
      this.quitButton,
      this.backupsList,
    ];
  }

  private askConfirmation(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.questionBox.ask(message, (answer) => {
        resolve(answer);
        this.screen.render();
      });
    });
  }

  private startPolling(): void {
    const pollIntervalMs = this.options.pollIntervalMs ?? 10000;
    this.pollTimer = setInterval(() => {
      void this.refresh();
    }, pollIntervalMs);
  }
}

export function bindBackupConsoleButtonAction(
  button: { on(eventName: 'press' | 'click', handler: () => void): void },
  handler: () => void,
): void {
  button.on('press', handler);
  button.on('click', handler);
}

const focusTargetCount = 6;

export function resolveNextBackupConsoleFocusIndex(
  currentIndex: number,
  targetCount: number,
  direction: 1 | -1,
): number {
  if (targetCount <= 0) {
    throw new Error('Focus target count must be positive.');
  }

  const normalizedCurrentIndex = ((currentIndex % targetCount) + targetCount) % targetCount;
  return (normalizedCurrentIndex + direction + targetCount) % targetCount;
}

function renderOperationError(error: unknown): string {
  if (error instanceof BackupOperationError) {
    return `${error.message}\n\n${error.output}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown operation error';
}
