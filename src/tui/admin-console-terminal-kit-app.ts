import { createRequire } from 'node:module';

import type {
  AdminConsoleOperations,
  AdminConsoleResourceDefinition,
  AdminConsoleResourceDetail,
  AdminConsoleResourceRow,
  AdminConsoleRuntimeSnapshot,
} from '../operations/admin-console.js';
import {
  formatConfigPanel,
  formatContentPanel,
  formatDashboardPanel,
  formatDatabasePanel,
  formatMessagesPanel,
} from './admin-console-layout.js';

const require = createRequire(import.meta.url);
const { terminal: term } = require('terminal-kit') as { terminal: any };

type AdminConsoleView = 'dashboard' | 'config' | 'content' | 'users' | 'admins' | 'resources' | 'messages' | 'database' | 'logs';

interface AdminConsoleTerminalKitAppOptions {
  operations: AdminConsoleOperations;
  pollIntervalMs?: number;
  operatorTelegramUserId?: number;
}

interface ViewItem {
  key: AdminConsoleView;
  label: string;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class AdminConsoleTerminalKitApp {
  private readonly options: AdminConsoleTerminalKitAppOptions;
  private readonly views: ViewItem[] = [
    { key: 'dashboard', label: '1 Resumen' },
    { key: 'config', label: '2 Config' },
    { key: 'content', label: '3 Contenido' },
    { key: 'users', label: '4 Usuarios' },
    { key: 'admins', label: '5 Admins' },
    { key: 'resources', label: '6 Recursos' },
    { key: 'messages', label: '7 Mensajes' },
    { key: 'database', label: '8 DB' },
    { key: 'logs', label: '9 Logs' },
  ];

  private readonly pollIntervalMs: number;
  private readonly operatorTelegramUserId: number;
  private currentView: AdminConsoleView = 'dashboard';
  private snapshot: AdminConsoleRuntimeSnapshot | null = null;
  private resourceDefinitions: AdminConsoleResourceDefinition[] = [];
  private selectedResourceIndex = 0;
  private resourceRows: AdminConsoleResourceRow[] = [];
  private selectedRowIndex = 0;
  private selectedResourceDetail: AdminConsoleResourceDetail | null = null;
  private resourceSearch = '';
  private logs = 'Cargando logs...';
  private status = 'Iniciando consola...';
  private detailScroll = 0;
  private rowScroll = 0;
  private resourceTypeScroll = 0;
  private closed = false;
  private loading = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private layout: {
    nav: Rect;
    resourceTypes: Rect;
    rows: Rect;
    detail: Rect;
    footer: Rect;
  } | null = null;

  constructor(options: AdminConsoleTerminalKitAppOptions) {
    this.options = options;
    this.pollIntervalMs = Number.isFinite(Number(options.pollIntervalMs)) ? Number(options.pollIntervalMs) : 8000;
    this.operatorTelegramUserId =
      typeof options.operatorTelegramUserId === 'number'
        ? options.operatorTelegramUserId
        : Number.parseInt(process.env.GAMECLUB_ADMIN_CONSOLE_OPERATOR_ID ?? '0', 10) || 0;
    this.resourceDefinitions = options.operations.listResourceDefinitions();
  }

  async run(): Promise<void> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error('Admin console requires an interactive terminal.');
    }

    term.fullscreen(true);
    term.hideCursor();
    term.grabInput({ mouse: 'button' });
    term.on('key', (name: string) => {
      void this.handleKey(name);
    });
    term.on('mouse', (name: string, data: { x: number; y: number }) => {
      void this.handleMouse(name, data);
    });
    process.on('SIGINT', () => {
      void this.stop();
    });

    await this.refresh();
    this.pollTimer = setInterval(() => {
      void this.refresh(false);
    }, this.pollIntervalMs);
    this.draw();

    await new Promise<void>((resolve) => {
      const wait = setInterval(() => {
        if (this.closed) {
          clearInterval(wait);
          resolve();
        }
      }, 100);
    });
  }

  async stop(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    term.grabInput(false);
    term.styleReset();
    term.hideCursor(false);
    term.fullscreen(false);
    term('\n');
  }

  private async refresh(render = true): Promise<void> {
    if (this.loading) {
      return;
    }
    this.loading = true;
    this.status = 'Actualizando...';
    if (render) {
      this.draw();
    }

    try {
      this.snapshot = await this.options.operations.readSnapshot();
      if (this.currentView === 'resources') {
        await this.loadResourceRows();
      }
      if (this.currentView === 'logs') {
        await this.loadLogs();
      }
      this.status = 'Actualizacion correcta.';
    } catch (error) {
      this.status = `Error: ${error instanceof Error ? error.message : 'desconocido'}`;
    } finally {
      this.loading = false;
      if (render) {
        this.draw();
      }
    }
  }

  private async handleKey(name: string): Promise<void> {
    if (name === 'CTRL_C' || name === 'q') {
      await this.stop();
      return;
    }

    const viewByNumber = this.views[Number.parseInt(name, 10) - 1];
    if (viewByNumber) {
      await this.setView(viewByNumber.key);
      return;
    }

    switch (name) {
      case 'LEFT':
        await this.moveView(-1);
        break;
      case 'RIGHT':
        await this.moveView(1);
        break;
      case 'UP':
      case 'k':
        await this.moveSelection(-1);
        break;
      case 'DOWN':
      case 'j':
        await this.moveSelection(1);
        break;
      case 'PAGE_UP':
        this.scrollDetail(-8);
        break;
      case 'PAGE_DOWN':
        this.scrollDetail(8);
        break;
      case 'HOME':
      case 'g':
        this.detailScroll = 0;
        this.draw();
        break;
      case 'END':
      case 'G':
        this.detailScroll = 100000;
        this.draw();
        break;
      case 'ENTER':
        await this.loadSelectedResourceDetail();
        break;
      case 'r':
        await this.refresh();
        break;
      case '/':
        await this.promptSearch();
        break;
      case 'e':
        await this.promptEdit();
        break;
      case 'd':
        await this.deleteSelected(false);
        break;
      case 'D':
        await this.deleteSelected(true);
        break;
      case 's':
        await this.runServiceAction('start');
        break;
      case 'x':
        await this.runServiceAction('stop');
        break;
      case 'S':
        await this.runServiceAction('restart');
        break;
      case '?':
      case 'F1':
        this.showHelp();
        break;
      default:
        break;
    }
  }

  private async handleMouse(name: string, data: { x: number; y: number }): Promise<void> {
    if (!this.layout) {
      return;
    }

    if (name === 'MOUSE_WHEEL_UP') {
      this.handleWheel(data, -3);
      return;
    }
    if (name === 'MOUSE_WHEEL_DOWN') {
      this.handleWheel(data, 3);
      return;
    }
    if (name !== 'MOUSE_LEFT_BUTTON_PRESSED') {
      return;
    }

    if (inside(data, this.layout.nav)) {
      const index = data.y - this.layout.nav.y - 1;
      const view = this.views[index];
      if (view) {
        await this.setView(view.key);
      }
      return;
    }

    if (this.currentView === 'resources' && inside(data, this.layout.resourceTypes)) {
      const index = this.resourceTypeScroll + data.y - this.layout.resourceTypes.y - 1;
      if (this.resourceDefinitions[index]) {
        this.selectedResourceIndex = index;
        this.selectedRowIndex = 0;
        this.rowScroll = 0;
        this.detailScroll = 0;
        await this.loadResourceRows();
        this.draw();
      }
      return;
    }

    if (this.currentView === 'resources' && inside(data, this.layout.rows)) {
      const index = this.rowScroll + data.y - this.layout.rows.y - 1;
      if (this.resourceRows[index]) {
        this.selectedRowIndex = index;
        await this.loadSelectedResourceDetail();
      }
    }
  }

  private handleWheel(data: { x: number; y: number }, delta: number): void {
    if (!this.layout) {
      return;
    }
    if (this.currentView === 'resources' && inside(data, this.layout.resourceTypes)) {
      this.resourceTypeScroll = clamp(this.resourceTypeScroll + delta, 0, Math.max(0, this.resourceDefinitions.length - this.layout.resourceTypes.height + 2));
      this.draw();
      return;
    }
    if (this.currentView === 'resources' && inside(data, this.layout.rows)) {
      this.rowScroll = clamp(this.rowScroll + delta, 0, Math.max(0, this.resourceRows.length - this.layout.rows.height + 2));
      this.draw();
      return;
    }
    this.scrollDetail(delta);
  }

  private async setView(view: AdminConsoleView): Promise<void> {
    this.currentView = view;
    this.detailScroll = 0;
    if (view === 'resources') {
      await this.loadResourceRows();
    }
    if (view === 'logs') {
      await this.loadLogs();
    }
    this.draw();
  }

  private async moveView(delta: 1 | -1): Promise<void> {
    const index = this.views.findIndex((view) => view.key === this.currentView);
    const next = this.views[(index + delta + this.views.length) % this.views.length];
    if (next) {
      await this.setView(next.key);
    }
  }

  private async moveSelection(delta: number): Promise<void> {
    if (this.currentView !== 'resources') {
      this.scrollDetail(delta);
      return;
    }

    this.selectedRowIndex = clamp(this.selectedRowIndex + delta, 0, Math.max(0, this.resourceRows.length - 1));
    const rowsRect = this.layout?.rows;
    if (rowsRect) {
      const visibleHeight = Math.max(1, rowsRect.height - 2);
      if (this.selectedRowIndex < this.rowScroll) {
        this.rowScroll = this.selectedRowIndex;
      }
      if (this.selectedRowIndex >= this.rowScroll + visibleHeight) {
        this.rowScroll = this.selectedRowIndex - visibleHeight + 1;
      }
    }
    await this.loadSelectedResourceDetail(false);
    this.draw();
  }

  private scrollDetail(delta: number): void {
    this.detailScroll = Math.max(0, this.detailScroll + delta);
    this.draw();
  }

  private async loadResourceRows(): Promise<void> {
    const definition = this.currentResourceDefinition();
    if (!definition) {
      this.resourceRows = [];
      this.selectedResourceDetail = null;
      return;
    }
    this.resourceRows = await this.options.operations.listResources({
      kind: definition.kind,
      search: this.resourceSearch,
      limit: 300,
    });
    this.selectedRowIndex = clamp(this.selectedRowIndex, 0, Math.max(0, this.resourceRows.length - 1));
    await this.loadSelectedResourceDetail(false);
  }

  private async loadSelectedResourceDetail(render = true): Promise<void> {
    const definition = this.currentResourceDefinition();
    const row = this.resourceRows[this.selectedRowIndex];
    if (!definition || !row) {
      this.selectedResourceDetail = null;
      if (render) {
        this.draw();
      }
      return;
    }
    try {
      this.selectedResourceDetail = await this.options.operations.readResource(definition.kind, row.id);
      this.detailScroll = 0;
    } catch (error) {
      this.selectedResourceDetail = null;
      this.status = `No se pudo leer detalle: ${error instanceof Error ? error.message : 'error desconocido'}`;
    }
    if (render) {
      this.draw();
    }
  }

  private async loadLogs(): Promise<void> {
    try {
      this.logs = await this.options.operations.readRecentLogs(180);
    } catch (error) {
      this.logs = `No se pudieron leer logs: ${error instanceof Error ? error.message : 'error desconocido'}`;
    }
  }

  private currentResourceDefinition(): AdminConsoleResourceDefinition | null {
    return this.resourceDefinitions[this.selectedResourceIndex] ?? null;
  }

  private async promptSearch(): Promise<void> {
    if (this.currentView !== 'resources') {
      return;
    }
    const value = await this.input('Buscar', this.resourceSearch);
    if (value === null) {
      return;
    }
    this.resourceSearch = value.trim();
    this.selectedRowIndex = 0;
    this.rowScroll = 0;
    await this.loadResourceRows();
    this.draw();
  }

  private async promptEdit(): Promise<void> {
    if (this.currentView !== 'resources' || !this.selectedResourceDetail) {
      return;
    }
    const editableFields = this.selectedResourceDetail.fields.filter((field) => field.editable);
    if (editableFields.length === 0) {
      this.status = 'Este recurso no tiene campos editables.';
      this.draw();
      return;
    }

    const defaultField = editableFields[0]?.column ?? '';
    const column = await this.input(`Campo editable (${editableFields.map((field) => field.column).join(', ')})`, defaultField);
    if (!column) {
      return;
    }
    const field = editableFields.find((candidate) => candidate.column === column.trim());
    if (!field) {
      this.status = `Campo no editable: ${column}`;
      this.draw();
      return;
    }
    const value = await this.input(`Nuevo valor para ${field.column} (${field.type})`, field.value);
    if (value === null) {
      return;
    }

    const definition = this.currentResourceDefinition();
    if (!definition) {
      return;
    }
    try {
      await this.options.operations.updateResourceField({
        kind: definition.kind,
        id: this.selectedResourceDetail.id,
        column: field.column,
        value,
      });
      this.status = `${field.column} actualizado.`;
      await this.loadResourceRows();
    } catch (error) {
      this.status = `No se pudo editar: ${error instanceof Error ? error.message : 'error desconocido'}`;
    }
    this.draw();
  }

  private async deleteSelected(hardDelete: boolean): Promise<void> {
    if (this.currentView !== 'resources' || !this.selectedResourceDetail) {
      return;
    }
    const definition = this.currentResourceDefinition();
    if (!definition) {
      return;
    }
    const confirmed = await this.confirm(`${hardDelete ? 'Borrar definitivamente' : 'Desactivar/archivar'} ${definition.label} #${this.selectedResourceDetail.id}?`);
    if (!confirmed) {
      this.draw();
      return;
    }
    try {
      await this.options.operations.deleteResource({
        kind: definition.kind,
        id: this.selectedResourceDetail.id,
        hardDelete,
        operatorTelegramUserId: this.operatorTelegramUserId,
      });
      this.status = hardDelete ? 'Fila borrada definitivamente.' : 'Fila desactivada/archivada.';
      this.selectedRowIndex = 0;
      this.rowScroll = 0;
      await this.loadResourceRows();
    } catch (error) {
      this.status = `No se pudo borrar: ${error instanceof Error ? error.message : 'error desconocido'}`;
    }
    this.draw();
  }

  private async runServiceAction(action: 'start' | 'stop' | 'restart'): Promise<void> {
    try {
      if (action === 'start') {
        await this.options.operations.startService();
      } else if (action === 'stop') {
        await this.options.operations.stopService();
      } else {
        await this.options.operations.restartService();
      }
      this.status = `Servicio ${action} ejecutado.`;
      await this.refresh(false);
    } catch (error) {
      this.status = `No se pudo ejecutar ${action}: ${error instanceof Error ? error.message : 'error desconocido'}`;
    }
    this.draw();
  }

  private async input(label: string, initial: string): Promise<string | null> {
    term.grabInput(false);
    this.draw();
    this.drawStatus(`${label}: `);
    return new Promise((resolve) => {
      term.inputField({ default: initial }, (error: unknown, value: string) => {
        term.grabInput({ mouse: 'button' });
        if (error) {
          resolve(null);
          return;
        }
        resolve(typeof value === 'string' ? value : null);
      });
    });
  }

  private async confirm(message: string): Promise<boolean> {
    term.grabInput(false);
    this.draw();
    this.drawStatus(`${message} [y/N] `);
    return new Promise((resolve) => {
      term.yesOrNo({ yes: ['y', 'ENTER'], no: ['n', 'ESCAPE'] }, (_error: unknown, result: boolean) => {
        term.grabInput({ mouse: 'button' });
        resolve(result === true);
      });
    });
  }

  private showHelp(): void {
    this.detailScroll = 0;
    this.status = 'Ayuda abierta. Pulsa r o cambia de vista para volver.';
    this.drawDetailText([
      'Ayuda',
      '',
      'Mouse:',
      '- Click en la columna izquierda: cambia de vista.',
      '- Click en tipo de recurso: cambia la tabla gestionada.',
      '- Click en una fila: selecciona y carga detalle.',
      '- Rueda sobre listas o detalle: scroll.',
      '',
      'Teclado:',
      '- q: salir',
      '- 1-9 / flechas izquierda-derecha: cambiar vista',
      '- j/k o flechas arriba-abajo: mover seleccion o hacer scroll',
      '- PageUp/PageDown: scroll de detalle',
      '- r: refrescar',
      '- /: buscar en Recursos',
      '- e: editar campo seleccionado por nombre',
      '- d: borrado blando si existe',
      '- D: borrado definitivo',
      '- s/x/S: start/stop/restart del servicio',
    ].join('\n'));
  }

  private draw(): void {
    const width = Math.max(80, Number(process.stdout.columns ?? term.width ?? 80));
    const height = Math.max(24, Number(process.stdout.rows ?? term.height ?? 24));
    const footerHeight = 3;
    const navWidth = 20;
    const resourceTypeWidth = this.currentView === 'resources' ? 28 : 0;
    const rowWidth = this.currentView === 'resources' ? 42 : 0;
    const bodyY = 4;
    const bodyHeight = height - footerHeight - bodyY + 1;

    this.layout = {
      nav: { x: 1, y: bodyY, width: navWidth, height: bodyHeight },
      resourceTypes: { x: navWidth + 1, y: bodyY, width: resourceTypeWidth, height: bodyHeight },
      rows: { x: navWidth + resourceTypeWidth + 1, y: bodyY, width: rowWidth, height: bodyHeight },
      detail: {
        x: navWidth + resourceTypeWidth + rowWidth + 1,
        y: bodyY,
        width: Math.max(20, width - navWidth - resourceTypeWidth - rowWidth),
        height: bodyHeight,
      },
      footer: { x: 1, y: height - footerHeight + 1, width, height: footerHeight },
    };

    term.clear();
    this.drawHeader(width);
    this.drawNav(this.layout.nav);
    if (this.currentView === 'resources') {
      this.drawResourceTypes(this.layout.resourceTypes);
      this.drawRows(this.layout.rows);
    }
    this.drawDetail();
    this.drawFooter(this.layout.footer);
  }

  private drawHeader(width: number): void {
    const service = this.snapshot?.service.state ?? '?';
    const database = this.snapshot?.database.state ?? '?';
    const users = this.snapshot?.users.total ?? 0;
    term.moveTo(1, 1).bgBlue.white(padRight(' Game Club Admin Console', width));
    term.moveTo(1, 2).white(padRight(` Service: ${service} | DB: ${database} | Usuarios: ${users} | ${new Date().toLocaleString()}`, width));
  }

  private drawNav(rect: Rect): void {
    drawBox(rect, 'Vistas');
    this.views.forEach((view, index) => {
      if (index >= rect.height - 2) {
        return;
      }
      term.moveTo(rect.x + 1, rect.y + 1 + index);
      const text = padRight(view.label, rect.width - 2);
      if (view.key === this.currentView) {
        term.bgBlue.white(text);
      } else {
        term.white(text);
      }
    });
  }

  private drawResourceTypes(rect: Rect): void {
    drawBox(rect, 'Tipos');
    const visible = Math.max(0, rect.height - 2);
    for (let offset = 0; offset < visible; offset += 1) {
      const index = this.resourceTypeScroll + offset;
      const definition = this.resourceDefinitions[index];
      if (!definition) {
        break;
      }
      term.moveTo(rect.x + 1, rect.y + 1 + offset);
      const text = padRight(truncate(definition.label, rect.width - 2), rect.width - 2);
      if (index === this.selectedResourceIndex) {
        term.bgGreen.black(text);
      } else {
        term.white(text);
      }
    }
  }

  private drawRows(rect: Rect): void {
    drawBox(rect, 'Filas');
    const visible = Math.max(0, rect.height - 2);
    for (let offset = 0; offset < visible; offset += 1) {
      const index = this.rowScroll + offset;
      const row = this.resourceRows[index];
      if (!row) {
        break;
      }
      term.moveTo(rect.x + 1, rect.y + 1 + offset);
      const text = padRight(truncate(`${row.id} ${row.title}`, rect.width - 2), rect.width - 2);
      if (index === this.selectedRowIndex) {
        term.bgBlue.white(text);
      } else {
        term.white(text);
      }
    }
  }

  private drawDetail(): void {
    if (!this.layout) {
      return;
    }
    let text: string;
    if (!this.snapshot) {
      text = 'Cargando...';
    } else if (this.currentView === 'dashboard') {
      text = formatDashboardPanel(this.snapshot);
    } else if (this.currentView === 'config') {
      text = formatConfigPanel(this.snapshot);
    } else if (this.currentView === 'content') {
      text = formatContentPanel(this.snapshot.content);
    } else if (this.currentView === 'messages') {
      text = formatMessagesPanel(this.snapshot.messages);
    } else if (this.currentView === 'database') {
      text = formatDatabasePanel(this.snapshot);
    } else if (this.currentView === 'logs') {
      text = this.logs;
    } else if (this.currentView === 'users') {
      text = formatDashboardPanel(this.snapshot) + '\n\nUsa la vista Recursos > Usuarios para listar, buscar y editar usuarios.';
    } else if (this.currentView === 'admins') {
      text = formatDashboardPanel(this.snapshot) + '\n\nUsa la vista Recursos > Usuarios para gestionar administradores.';
    } else {
      text = this.formatResourceDetail();
    }
    this.drawDetailText(text);
  }

  private drawDetailText(text: string): void {
    if (!this.layout) {
      return;
    }
    const rect = this.layout.detail;
    drawBox(rect, 'Detalle');
    const lines = text.split('\n');
    const visible = Math.max(0, rect.height - 2);
    const maxScroll = Math.max(0, lines.length - visible);
    this.detailScroll = clamp(this.detailScroll, 0, maxScroll);
    for (let offset = 0; offset < visible; offset += 1) {
      const line = lines[this.detailScroll + offset] ?? '';
      term.moveTo(rect.x + 1, rect.y + 1 + offset).white(padRight(truncate(line, rect.width - 2), rect.width - 2));
    }
  }

  private formatResourceDetail(): string {
    const definition = this.currentResourceDefinition();
    if (!definition) {
      return 'No hay recursos configurados.';
    }
    const header = [
      `Recurso: ${definition.label}`,
      `Tabla: ${definition.tableName}`,
      `Busqueda: ${this.resourceSearch || '<sin filtro>'}`,
      `Filas cargadas: ${this.resourceRows.length}`,
      '',
    ];
    if (!this.selectedResourceDetail) {
      return [...header, 'Selecciona una fila con click o Enter.'].join('\n');
    }
    const editable = this.selectedResourceDetail.fields.filter((field) => field.editable);
    return [
      ...header,
      `ID: ${this.selectedResourceDetail.id}`,
      '',
      'Campos:',
      ...this.selectedResourceDetail.fields.map((field) => `${field.editable ? '*' : ' '} ${field.column.padEnd(32)} ${field.value}`),
      '',
      'Campos editables:',
      ...(editable.length ? editable.map((field) => `- ${field.column} (${field.type})`) : ['<ninguno>']),
    ].join('\n');
  }

  private drawFooter(rect: Rect): void {
    const line1 = '[q] salir  [1-9] vistas  [click] seleccionar  [rueda] scroll  [r] refrescar  [?] ayuda';
    const line2 = this.currentView === 'resources'
      ? 'Recursos: [/] buscar  [e] editar  [d] desactivar/archivar  [D] borrar definitivo'
      : 'Servicio: [s] start  [x] stop  [S] restart';
    term.moveTo(rect.x, rect.y).bgBlack.white(padRight(line1, rect.width));
    term.moveTo(rect.x, rect.y + 1).bgBlack.white(padRight(line2, rect.width));
    this.drawStatus(this.status);
  }

  private drawStatus(message: string): void {
    if (!this.layout) {
      return;
    }
    term.moveTo(this.layout.footer.x, this.layout.footer.y + 2).bgBlack.yellow(padRight(message, this.layout.footer.width));
  }
}

function drawBox(rect: Rect, title: string): void {
  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }
  const horizontal = '-'.repeat(Math.max(0, rect.width - 2));
  term.moveTo(rect.x, rect.y).gray(`+${horizontal}+`);
  for (let row = 1; row < rect.height - 1; row += 1) {
    term.moveTo(rect.x, rect.y + row).gray('|');
    term.moveTo(rect.x + rect.width - 1, rect.y + row).gray('|');
  }
  term.moveTo(rect.x, rect.y + rect.height - 1).gray(`+${horizontal}+`);
  term.moveTo(rect.x + 2, rect.y).cyan(` ${truncate(title, Math.max(0, rect.width - 6))} `);
}

function inside(point: { x: number; y: number }, rect: Rect): boolean {
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function padRight(value: string, length: number): string {
  const cleanLength = Math.max(0, length);
  if (value.length >= cleanLength) {
    return value.slice(0, cleanLength);
  }
  return value + ' '.repeat(cleanLength - value.length);
}
