import blessed from 'blessed';

import type {
  AdminConsoleAdminToggle,
  AdminConsoleOperations,
  AdminConsoleResourceDefinition,
  AdminConsoleResourceDetail,
  AdminConsoleResourceKind,
  AdminConsoleResourceRow,
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
  | 'resources'
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
  private readonly resourceList: blessed.Widgets.ListElement;
  private readonly footerBox: blessed.Widgets.BoxElement;
  private readonly statusBox: blessed.Widgets.BoxElement;
  private readonly options: AdminConsoleAppOptions;
  private readonly sidebarItems: SidebarItem[] = [
    { key: 'dashboard', label: '1 · Resumen' },
    { key: 'config', label: '2 · Config' },
    { key: 'content', label: '3 · Contingut' },
    { key: 'users', label: '4 · Usuaris' },
    { key: 'admins', label: '5 · Admins' },
    { key: 'resources', label: '6 · Recursos' },
    { key: 'messages', label: '7 · Missatges' },
    { key: 'database', label: '8 · DB' },
    { key: 'logs', label: '9 · Logs' },
  ];
  private currentView: AdminConsoleView = 'dashboard';
  private lastSnapshot: AdminConsoleRuntimeSnapshot | null = null;
  private usersByStatus: AdminConsoleUserRecord[] = [];
  private admins: AdminConsoleUserRecord[] = [];
  private resourceDefinitions: AdminConsoleResourceDefinition[] = [];
  private selectedResourceIndex = 0;
  private resourceRows: AdminConsoleResourceRow[] = [];
  private selectedResourceDetail: AdminConsoleResourceDetail | null = null;
  private resourceSearch = '';
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

    this.resourceList = blessed.list({
      parent: this.screen,
      top: 3,
      left: 24,
      width: '45%',
      height: '100%-8',
      border: 'line',
      label: ' Recursos ',
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

    this.resourceDefinitions = this.options.operations.listResourceDefinitions();
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

      if (this.currentView === 'resources') {
        this.resourceList.focus();
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
      this.setActiveView('resources');
    });
    this.screen.key(['7'], () => {
      this.setActiveView('messages');
    });
    this.screen.key(['8'], () => {
      this.setActiveView('database');
    });
    this.screen.key(['9'], () => {
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
    this.screen.key(['c'], () => {
      void this.cycleResourceDefinition(1);
    });
    this.screen.key(['C'], () => {
      void this.cycleResourceDefinition(-1);
    });
    this.screen.key(['/'], () => {
      void this.promptResourceSearch();
    });
    this.screen.key(['e'], () => {
      void this.promptEditSelectedResource();
    });
    this.screen.key(['d'], () => {
      void this.confirmDeleteSelectedResource(false);
    });
    this.screen.key(['D'], () => {
      void this.confirmDeleteSelectedResource(true);
    });
    this.screen.key(['?', 'f1'], () => {
      this.showHelp();
    });
    this.screen.key(['pagedown'], () => {
      this.contentBox.scroll(10);
      this.screen.render();
    });
    this.screen.key(['pageup'], () => {
      this.contentBox.scroll(-10);
      this.screen.render();
    });
    this.screen.key(['home', 'g'], () => {
      this.contentBox.setScroll(0);
      this.screen.render();
    });
    this.screen.key(['end', 'G'], () => {
      this.contentBox.setScrollPerc(100);
      this.screen.render();
    });

    this.usersList.on('select item', () => {
      this.renderCurrentView();
    });
    this.adminList.on('select item', () => {
      this.renderCurrentView();
    });
    this.resourceList.on('select item', () => {
      void this.loadSelectedResourceDetail();
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
      if (this.currentView === 'resources') {
        await this.loadResourceRows();
      }
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
    if (view === 'resources') {
      void this.loadResourceRows();
    }
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
    this.resourceList.hide();
    this.contentBox.left = 24;
    this.contentBox.width = '100%-24';

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

    if (this.currentView === 'resources') {
      this.renderResourcesView();
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

  private async loadResourceRows(): Promise<void> {
    const definition = this.currentResourceDefinition();
    if (!definition) {
      return;
    }

    try {
      this.resourceRows = await this.options.operations.listResources({
        kind: definition.kind,
        search: this.resourceSearch,
        limit: 200,
      });
      await this.loadSelectedResourceDetail(false);
    } catch (error) {
      this.setStatus(`No s'han pogut carregar recursos: ${error instanceof Error ? error.message : 'error desconegut'}`);
    }
  }

  private async loadSelectedResourceDetail(render = true): Promise<void> {
    const definition = this.currentResourceDefinition();
    const selectedIndex = (this.resourceList as blessed.Widgets.ListElement & { selected: number }).selected;
    const row = this.resourceRows[selectedIndex] ?? this.resourceRows[0];
    if (!definition || !row) {
      this.selectedResourceDetail = null;
      if (render) {
        this.renderCurrentView();
      }
      return;
    }

    try {
      this.selectedResourceDetail = await this.options.operations.readResource(definition.kind, row.id);
      if (render) {
        this.renderCurrentView();
      }
    } catch (error) {
      this.selectedResourceDetail = null;
      this.setStatus(`No s'ha pogut llegir el detall: ${error instanceof Error ? error.message : 'error desconegut'}`);
    }
  }

  private renderResourcesView(): void {
    const definition = this.currentResourceDefinition();
    this.resourceList.show();
    this.resourceList.focus();
    this.contentBox.show();
    this.contentBox.left = '45%';
    this.contentBox.width = '55%';
    this.resourceList.setLabel(` ${definition?.label ?? 'Recursos'} `);

    if (!definition) {
      this.resourceList.setItems(['No hi ha recursos configurats']);
      this.contentBox.setContent('No hi ha definicions de recursos.');
      return;
    }

    const rows = this.resourceRows;
    const selectedIndex = Math.min(
      Math.max((this.resourceList as blessed.Widgets.ListElement & { selected: number }).selected, 0),
      Math.max(0, rows.length - 1),
    );
    const items = rows.length === 0
      ? ['No hi ha files']
      : rows.map((row, index) => `${index === selectedIndex ? '>' : ' '} ${String(row.id).padStart(6)} ${truncateText(row.title, 44)}`);

    this.resourceList.setItems(items);
    this.contentBox.setContent(this.formatResourceDetail(definition));
  }

  private formatResourceDetail(definition: AdminConsoleResourceDefinition): string {
    const header = [
      `Recurs: ${definition.label} (${definition.tableName})`,
      `Cerca: ${this.resourceSearch || '<cap>'}`,
      `Files carregades: ${this.resourceRows.length}`,
      '',
    ];

    if (!this.selectedResourceDetail) {
      return [...header, 'Selecciona una fila per veure el detall.'].join('\n');
    }

    const editable = this.selectedResourceDetail.fields.filter((field) => field.editable);
    return [
      ...header,
      `ID: ${this.selectedResourceDetail.id}`,
      '',
      'Camps:',
      ...this.selectedResourceDetail.fields.map((field) => {
        const marker = field.editable ? '*' : ' ';
        return `${marker} ${field.column.padEnd(32)} ${truncateText(field.value, 120)}`;
      }),
      '',
      'Editables:',
      ...(editable.length === 0 ? ['  <cap>'] : editable.map((field, index) => `  ${index + 1}. ${field.column} (${field.type})`)),
    ].join('\n');
  }

  private currentResourceDefinition(): AdminConsoleResourceDefinition | null {
    return this.resourceDefinitions[this.selectedResourceIndex] ?? null;
  }

  private async cycleResourceDefinition(direction: 1 | -1): Promise<void> {
    if (this.currentView !== 'resources' || this.resourceDefinitions.length === 0) {
      return;
    }

    const total = this.resourceDefinitions.length;
    this.selectedResourceIndex = (this.selectedResourceIndex + direction + total) % total;
    this.resourceRows = [];
    this.selectedResourceDetail = null;
    this.resourceSearch = '';
    this.resourceList.select(0);
    await this.loadResourceRows();
    this.renderCurrentView();
  }

  private async promptResourceSearch(): Promise<void> {
    if (this.currentView !== 'resources') {
      return;
    }

    const value = await this.promptInput('Cerca', 'Text de cerca (buit per netejar):', this.resourceSearch);
    if (value === null) {
      return;
    }

    this.resourceSearch = value.trim();
    this.resourceList.select(0);
    await this.loadResourceRows();
    this.renderCurrentView();
  }

  private async promptEditSelectedResource(): Promise<void> {
    if (this.currentView !== 'resources' || !this.selectedResourceDetail) {
      return;
    }

    const editableFields = this.selectedResourceDetail.fields.filter((field) => field.editable);
    if (editableFields.length === 0) {
      this.setStatus('Aquest recurs no te camps editables.');
      return;
    }

    const fieldName = await this.promptInput(
      'Editar camp',
      `Camp editable (${editableFields.map((field) => field.column).join(', ')}):`,
      editableFields[0]?.column ?? '',
    );
    if (!fieldName) {
      return;
    }

    const field = editableFields.find((candidate) => candidate.column === fieldName.trim());
    if (!field) {
      this.setStatus(`Camp no editable: ${fieldName}`);
      return;
    }

    const nextValue = await this.promptInput('Nou valor', `${field.column} (${field.type}). Escriu null per buidar si es nullable:`, field.value);
    if (nextValue === null) {
      return;
    }

    await this.withBusyToast(async () => {
      const definition = this.currentResourceDefinition();
      if (!definition) {
        return;
      }
      await this.options.operations.updateResourceField({
        kind: definition.kind,
        id: this.selectedResourceDetail?.id ?? '',
        column: field.column,
        value: nextValue,
      });
      await this.loadResourceRows();
      this.setStatus(`Camp ${field.column} actualitzat.`);
    }, `No s'ha pogut editar ${field.column}.`);
  }

  private async confirmDeleteSelectedResource(hardDelete: boolean): Promise<void> {
    if (this.currentView !== 'resources' || !this.selectedResourceDetail) {
      return;
    }

    const definition = this.currentResourceDefinition();
    if (!definition) {
      return;
    }

    const verb = hardDelete ? 'eliminar definitivament' : 'desactivar/arxivar';
    const confirmed = await this.confirmInput(
      'Confirmar eliminacio',
      `Vols ${verb} ${definition.label} #${this.selectedResourceDetail.id}?`,
    );
    if (!confirmed) {
      return;
    }

    await this.withBusyToast(async () => {
      await this.options.operations.deleteResource({
        kind: definition.kind,
        id: this.selectedResourceDetail?.id ?? '',
        hardDelete,
        operatorTelegramUserId: this.operatorTelegramUserId,
      });
      this.resourceList.select(0);
      await this.loadResourceRows();
      this.setStatus(hardDelete ? 'Fila eliminada definitivament.' : 'Fila desactivada/arxivada.');
    }, 'No s\'ha pogut eliminar el recurs.');
  }

  private promptInput(title: string, message: string, initial = ''): Promise<string | null> {
    return new Promise((resolve) => {
      const prompt = blessed.prompt({
        parent: this.screen,
        border: 'line',
        height: 9,
        width: '70%',
        top: 'center',
        left: 'center',
        label: ` ${title} `,
        tags: true,
      }) as blessed.Widgets.PromptElement & { input(message: string, value: string, callback: (error: unknown, value?: string) => void): void };

      prompt.input(message, initial, (_error, value) => {
        prompt.destroy();
        this.screen.render();
        resolve(typeof value === 'string' ? value : null);
      });
      this.screen.render();
    });
  }

  private confirmInput(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const question = blessed.question({
        parent: this.screen,
        border: 'line',
        height: 8,
        width: '70%',
        top: 'center',
        left: 'center',
        label: ` ${title} `,
        tags: true,
      }) as blessed.Widgets.QuestionElement & { ask(message: string, callback: (error: unknown, value?: unknown) => void): void };

      question.ask(`${message}\n\nConfirma con y/n.`, (_error, value) => {
        question.destroy();
        this.screen.render();
        const normalizedValue = value as boolean | string | undefined;
        resolve(normalizedValue === true || normalizedValue === 'yes' || normalizedValue === 'y');
      });
      this.screen.render();
    });
  }

  private showHelp(): void {
    const current = this.currentView === 'resources'
      ? [
          'Recursos:',
          '[c] seguent recurs | [C] anterior recurs | [/] cercar',
          '[Enter] detall | [e] editar camp | [d] desactivar/arxivar | [D] eliminar definitivament',
        ]
      : [];
    this.contentBox.setContent(
      [
        'Ajuda',
        '',
        '[q] sortir | [r] refrescar | [Tab] focus',
        '[fletxes] navegar | [PgUp/PgDn] scroll detall | [g/G] inici/final',
        '[1-9] canviar vista | [s] start servei | [x] stop servei | [S] restart servei',
        '[?] ajuda',
        '',
        ...current,
      ].join('\n'),
    );
    this.screen.render();
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
    const base = '[q] sortir | [r] refrescar | [1-9] vista | [Tab] focus | [?] ajuda';

    switch (view) {
      case 'users':
        return `${base} | [o] aprovar | [b] bloquejar | [v] revocar | [p] pending | [a] alternar admin`;
      case 'admins':
        return `${base} | [a] treure/promoure admin`;
      case 'resources':
        return `${base} | [c/C] recurs | [/] cercar | [e] editar | [d] arxivar | [D] borrar`;
      case 'logs':
        return `${base} | [PgUp/PgDn] scroll | [s/x/S] servei`;
      default:
        return `${base} | [s/x/S] servei`;
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

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}
