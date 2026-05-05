import blessed from 'blessed';

import type {
  AdminConsoleAdminToggle,
  AdminConsoleOperations,
  AdminConsoleRuntimeSnapshot,
  AdminConsoleUserRecord,
  AdminConsoleUserStatusUpdate,
} from '../operations/admin-console.js';
import {
  formatAdminsPanel,
  formatConfigPanel,
  formatContentPanel,
  formatDashboardPanel,
  formatDatabasePanel,
  formatLogsHint,
  formatMessagesPanel,
  formatUsersPanel,
} from './admin-console-layout.js';

type AdminConsoleView =
  | 'dashboard'
  | 'config'
  | 'content'
  | 'users'
  | 'admins'
  | 'messages'
  | 'logs'
  | 'database';

interface SidebarItem {
  key: AdminConsoleView;
  label: string;
}

export interface AdminConsoleAppOptions {
  operations: AdminConsoleOperations;
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  pollIntervalMs?: number;
  operatorTelegramUserId?: number;
}

export class AdminConsoleApp {
  private readonly screen: blessed.Widgets.Screen;
  private readonly stdin: NodeJS.ReadStream;
  private readonly stdout: NodeJS.WriteStream;
  private readonly headerBox: blessed.Widgets.BoxElement;
  private readonly sidebar: blessed.Widgets.ListElement;
  private readonly contentBox: blessed.Widgets.BoxElement;
  private readonly usersList: blessed.Widgets.ListElement;
  private readonly adminList: blessed.Widgets.ListElement;
  private readonly footerBox: blessed.Widgets.BoxElement;
  private readonly statusBox: blessed.Widgets.BoxElement;
  private readonly options: AdminConsoleAppOptions;
  private readonly sidebarItems: SidebarItem[] = [
    { key: 'dashboard', label: '1 · Resumen' },
    { key: 'config', label: '2 · Config' },
    { key: 'content', label: '3 · Contingut' },
    { key: 'users', label: '4 · Usuaris' },
    { key: 'admins', label: '5 · Admins' },
    { key: 'messages', label: '6 · Missatges' },
    { key: 'database', label: '7 · DB' },
    { key: 'logs', label: '8 · Logs' },
  ];
  private currentView: AdminConsoleView = 'dashboard';
  private lastSnapshot: AdminConsoleRuntimeSnapshot | null = null;
  private usersByStatus: AdminConsoleUserRecord[] = [];
  private admins: AdminConsoleUserRecord[] = [];
  private messageSummary = 'Fes servir [r] per refrescar o canvia a Logs.';
  private pollTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private isBusy = false;
  private readonly pollIntervalMs: number;
  private readonly operatorTelegramUserId: number;

  constructor(options: AdminConsoleAppOptions) {
    this.options = options;
    this.stdin = options.stdin ?? process.stdin;
    this.stdout = options.stdout ?? process.stdout;
    this.pollIntervalMs = Number.isFinite(Number(options.pollIntervalMs)) ? Number(options.pollIntervalMs) : 8000;
    this.operatorTelegramUserId =
      typeof options.operatorTelegramUserId === 'number'
        ? options.operatorTelegramUserId
        : parseSafeInt(process.env.GAMECLUB_ADMIN_CONSOLE_OPERATOR_ID, 0);

    this.screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
      dockBorders: true,
      title: 'Game Club Admin Console',
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
      label: ' Admin Console ',
      padding: { left: 1, right: 1 },
    });

    this.sidebar = blessed.list({
      parent: this.screen,
      top: 3,
      left: 0,
      width: 24,
      height: '100%-8',
      border: 'line',
      label: ' Vistes ',
      mouse: true,
      keys: true,
      vi: true,
      items: this.sidebarItems.map((item) => item.label),
      style: {
        selected: {
          bg: 'blue',
          fg: 'white',
        },
      },
    });

    this.contentBox = blessed.box({
      parent: this.screen,
      top: 3,
      left: 24,
      width: '100%-24',
      height: '100%-8',
      border: 'line',
      label: ' Detall ',
      padding: { left: 1, right: 1 },
      scrollable: true,
      alwaysScroll: true,
      tags: true,
      content: 'Carregant...',
    });

    this.usersList = blessed.list({
      parent: this.screen,
      top: 3,
      left: 24,
      width: '100%-24',
      height: '100%-8',
      border: 'line',
      label: ' Usuaris ',
      hidden: true,
      mouse: true,
      keys: true,
      vi: true,
      items: [],
      style: {
        selected: {
          bg: 'blue',
          fg: 'white',
        },
      },
    });

    this.adminList = blessed.list({
      parent: this.screen,
      top: 3,
      left: 24,
      width: '100%-24',
      height: '100%-8',
      border: 'line',
      label: ' Administradors ',
      hidden: true,
      mouse: true,
      keys: true,
      vi: true,
      items: [],
      style: {
        selected: {
          bg: 'blue',
          fg: 'white',
        },
      },
    });

    this.statusBox = blessed.box({
      parent: this.screen,
      bottom: 3,
      left: 0,
      width: '100%',
      height: 2,
      border: 'line',
      label: ' Status ',
      content: 'Iniciant consola...',
      padding: { left: 1, right: 1 },
    });

    this.footerBox = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
      tags: true,
      border: 'line',
      label: ' Tecles ',
      content: this.buildFooter('dashboard'),
    });

    this.bindEvents();
  }

  async run(): Promise<void> {
    if (!this.stdin.isTTY || !this.stdout.isTTY) {
      throw new Error('Admin console requires an interactive terminal.');
    }

    await this.refresh();
    this.setActiveView('dashboard');
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

  private bindEvents(): void {
    this.sidebar.on('select', (_item, index) => {
      this.currentView = this.sidebarItems[index]?.key ?? 'dashboard';
      this.renderCurrentView();
    });

    this.screen.key(['tab'], () => {
      if (this.currentView === 'users') {
        this.usersList.focus();
        return;
      }

      if (this.currentView === 'admins') {
        this.adminList.focus();
        return;
      }

      this.sidebar.focus();
    });

    this.screen.key(['S-tab'], () => {
      this.sidebar.focus();
    });

    this.screen.key(['right'], () => {
      this.setViewNext(1);
    });

    this.screen.key(['left'], () => {
      this.setViewNext(-1);
    });

    this.screen.key(['1'], () => {
      this.setActiveView('dashboard');
    });
    this.screen.key(['2'], () => {
      this.setActiveView('config');
    });
    this.screen.key(['3'], () => {
      this.setActiveView('content');
    });
    this.screen.key(['4'], () => {
      this.setActiveView('users');
    });
    this.screen.key(['5'], () => {
      this.setActiveView('admins');
    });
    this.screen.key(['6'], () => {
      this.setActiveView('messages');
    });
    this.screen.key(['7'], () => {
      this.setActiveView('database');
    });
    this.screen.key(['8'], () => {
      this.setActiveView('logs');
    });

    this.screen.key(['r'], () => {
      void this.refresh();
    });
    this.screen.key(['s'], () => {
      void this.startService();
    });
    this.screen.key(['x'], () => {
      void this.stopService();
    });
    this.screen.key(['S'], () => {
      void this.restartService();
    });

    this.screen.key(['o'], () => {
      void this.updateSelectedUserStatus('approved');
    });
    this.screen.key(['p'], () => {
      void this.updateSelectedUserStatus('pending');
    });
    this.screen.key(['b'], () => {
      void this.updateSelectedUserStatus('blocked');
    });
    this.screen.key(['v'], () => {
      void this.updateSelectedUserStatus('revoked');
    });
    this.screen.key(['a'], () => {
      void this.toggleSelectedUserAdmin();
    });

    this.usersList.on('select item', () => {
      this.renderCurrentView();
    });
    this.adminList.on('select item', () => {
      this.renderCurrentView();
    });
  }

  private async refresh(): Promise<void> {
    if (this.isBusy) {
      return;
    }

    this.isBusy = true;
    this.setStatus('Actualitzant...');

    try {
      const snapshot = await this.options.operations.readSnapshot();
      this.lastSnapshot = snapshot;
      this.usersByStatus = await this.options.operations.listUsersByStatus('pending');
      this.admins = await this.options.operations.listAdmins();
      this.renderCurrentView();
      this.setStatus('Actualització correcta.');
      this.footerBox.setContent(this.buildFooter(this.currentView));
    } catch (error) {
      this.setStatus(`Error: ${error instanceof Error ? error.message : 'Desconegut'}`);
    } finally {
      this.isBusy = false;
      this.screen.render();
    }
  }

  private async startService(): Promise<void> {
    await this.withBusyToast(async () => {
      await this.options.operations.startService();
      this.setStatus('Servei iniciat.');
      await this.refresh();
    }, 'No s\'ha pogut iniciar el servei.');
  }

  private async stopService(): Promise<void> {
    await this.withBusyToast(async () => {
      await this.options.operations.stopService();
      this.setStatus('Servei aturat.');
      await this.refresh();
    }, 'No s\'ha pogut aturar el servei.');
  }

  private async restartService(): Promise<void> {
    await this.withBusyToast(async () => {
      await this.options.operations.restartService();
      this.setStatus('Servei reiniciat.');
      await this.refresh();
    }, 'No s\'ha pogut reiniciar el servei.');
  }

  private async updateSelectedUserStatus(nextStatus: 'pending' | 'approved' | 'blocked' | 'revoked'): Promise<void> {
    if (this.currentView !== 'users' && this.currentView !== 'admins') {
      return;
    }

    const user = this.getSelectedUser();
    if (!user) {
      this.setStatus('Selecciona un usuari primer.');
      return;
    }

    const payload: AdminConsoleUserStatusUpdate = {
      telegramUserId: user.telegramUserId,
      nextStatus,
      reason: `admin-console ${nextStatus}`,
      operatorTelegramUserId: this.operatorTelegramUserId,
    };

    await this.withBusyToast(async () => {
      await this.options.operations.updateUserStatus(payload);
      this.setStatus(`Usuari ${user.telegramUserId} actualitzat a ${nextStatus}.`);
      await this.refresh();
      this.setActiveView('users');
    }, `No s\'ha pogut canviar l\'estat de l\'usuari ${user.telegramUserId}.`);
  }

  private async toggleSelectedUserAdmin(): Promise<void> {
    if (this.currentView !== 'users' && this.currentView !== 'admins') {
      return;
    }

    const user = this.getSelectedUser();
    if (!user) {
      this.setStatus('Selecciona un usuari primer.');
      return;
    }

    const next = !user.isAdmin;
    const payload: AdminConsoleAdminToggle = {
      telegramUserId: user.telegramUserId,
      isAdmin: next,
      reason: next ? 'admin-console grant admin' : 'admin-console revoke admin',
      operatorTelegramUserId: this.operatorTelegramUserId,
    };

    await this.withBusyToast(async () => {
      await this.options.operations.updateUserAdmin(payload);
      this.setStatus(`Usuari ${user.telegramUserId} ${next ? 'promocionat a admin' : 'treta etiqueta admin'}.`);
      await this.refresh();
      this.setActiveView('admins');
    }, `No s\'ha pogut canviar el rol d\'admin de ${user.telegramUserId}.`);
  }

  private async withBusyToast(action: () => Promise<void>, errorMessage: string): Promise<void> {
    if (this.isBusy) {
      return;
    }

    this.isBusy = true;
    try {
      this.setStatus('Processant...');
      await action();
    } catch (error) {
      this.setStatus(`${errorMessage}${error instanceof Error ? `: ${error.message}` : ''}`);
    } finally {
      this.isBusy = false;
      this.screen.render();
    }
  }

  private setStatus(message: string): void {
    this.statusBox.setContent(message);
    this.screen.render();
  }

  private setActiveView(view: AdminConsoleView): void {
    this.currentView = view;
    const index = this.sidebarItems.findIndex((item) => item.key === view);
    this.sidebar.select(index >= 0 ? index : 0);
    this.renderCurrentView();
    this.footerBox.setContent(this.buildFooter(view));
    this.screen.render();
  }

  private setViewNext(direction: 1 | -1): void {
    const index = this.sidebarItems.findIndex((item) => item.key === this.currentView);
    const total = this.sidebarItems.length;
    const next = (index + direction + total) % total;
    const nextItem = this.sidebarItems[next];
    if (nextItem) {
      this.setActiveView(nextItem.key);
    }
  }

  private getSelectedUser(): AdminConsoleUserRecord | null {
    if (this.currentView === 'users') {
      const selected = (this.usersList as blessed.Widgets.ListElement & { selected: number }).selected;
      return this.usersByStatus[selected] ?? null;
    }

    if (this.currentView === 'admins') {
      const selected = (this.adminList as blessed.Widgets.ListElement & { selected: number }).selected;
      return this.admins[selected] ?? null;
    }

    return null;
  }

  private renderCurrentView(): void {
    if (!this.lastSnapshot) {
      return;
    }

    this.usersList.hide();
    this.adminList.hide();

    const selectedIndex = this.currentView === 'users'
      ? Math.min(Math.max((this.usersList as blessed.Widgets.ListElement & { selected: number }).selected, 0), Math.max(0, this.usersByStatus.length - 1))
      : Math.min(Math.max((this.adminList as blessed.Widgets.ListElement & { selected: number }).selected, 0), Math.max(0, this.admins.length - 1));

    this.headerBox.setContent(
      `Service: ${this.lastSnapshot.service.state} · DB: ${this.lastSnapshot.database.state} · Usuari administració: ${this.lastSnapshot.users.admins}`,
    );

    if (this.currentView === 'users') {
      const rows = this.usersByStatus;
      const formattedRows = rows.length === 0
        ? ['No hi ha usuaris pendents']
        : rows.map((row, index) =>
            `${index === selectedIndex ? '>' : ' '} ${row.telegramUserId} ${row.isAdmin ? '[A]' : '[ ]'} ${row.status.padEnd(8)} ${row.displayName}`,
          );

      this.usersList.setItems(formattedRows);
      this.usersList.show();
      this.usersList.focus();
      this.contentBox.show();
      this.contentBox.setContent(formatUsersPanel(rows, selectedIndex));
      return;
    }

    if (this.currentView === 'admins') {
      const rows = this.admins;
      const formattedRows = rows.length === 0
        ? ['No hi ha administradors']
        : rows.map((row, index) =>
            `${index === selectedIndex ? '>' : ' '} ${row.telegramUserId} ${row.status.padEnd(8)} ${row.displayName}`,
          );

      this.adminList.setItems(formattedRows);
      this.adminList.show();
      this.adminList.focus();
      this.contentBox.show();
      this.contentBox.setContent(formatAdminsPanel(rows, selectedIndex));
      return;
    }

    this.usersList.hide();
    this.adminList.hide();
    this.contentBox.show();

    switch (this.currentView) {
      case 'dashboard':
        this.contentBox.setContent(formatDashboardPanel(this.lastSnapshot));
        break;
      case 'config':
        this.contentBox.setContent(formatConfigPanel(this.lastSnapshot));
        break;
      case 'content':
        this.contentBox.setContent(formatContentPanel(this.lastSnapshot.content));
        break;
      case 'messages':
        this.contentBox.setContent(formatMessagesPanel(this.lastSnapshot.messages));
        break;
      case 'logs':
        this.contentBox.setContent(this.messageSummary);
        void this.showRecentLogs();
        break;
      case 'database':
        this.contentBox.setContent(formatDatabasePanel(this.lastSnapshot));
        break;
      default:
        this.contentBox.setContent('Vista desconeguda.');
    }
  }

  private async showRecentLogs(): Promise<void> {
    try {
      const logs = await this.options.operations.readRecentLogs(140);
      this.messageSummary = `${formatLogsHint()}\n\n${logs}`;
      if (this.currentView === 'logs') {
        this.contentBox.setContent(this.messageSummary);
      }
    } catch (error) {
      this.messageSummary = `No s\'han pogut llegir els logs: ${error instanceof Error ? error.message : 'error desconegut'}`;
      if (this.currentView === 'logs') {
        this.contentBox.setContent(this.messageSummary);
      }
      this.setStatus('No s\'han pogut llegir els logs del servei.');
    }

    this.screen.render();
  }

  private buildFooter(view: AdminConsoleView): string {
    const base = '[q] sortir | [r] refrescar | [1-8] vista | [s] start | [x] stop | [S] restart';

    switch (view) {
      case 'users':
        return `${base} | [o] aprovar | [b] bloquejar | [v] revocar | [p] pending | [a] alternar admin`;
      case 'admins':
        return `${base} | [a] treure/promoure admin`;
      case 'logs':
        return `${base} | [r] recarregar logs`;
      default:
        return base;
    }
  }

  private startPolling(): void {
    const pollIntervalMs = this.pollIntervalMs > 0 ? this.pollIntervalMs : 8000;
    this.pollTimer = setInterval(() => {
      void this.refresh();
    }, pollIntervalMs);
  }
}

function parseSafeInt(value: string | undefined, fallback: number): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}
