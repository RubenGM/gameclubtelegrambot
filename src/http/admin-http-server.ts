import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdir, appendFile, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import type { RuntimeConfig } from '../config/runtime-config.js';
import type { InfrastructureRuntimeServices } from '../infrastructure/runtime-boundary.js';
import { resolveRuntimeConfigPaths, serializeEnvFile } from '../config/runtime-config-files.js';
import { createBackupOperations, type BackupOperations } from '../operations/backup-operations.js';
import { createServiceControl, type ServiceControl } from '../operations/service-control.js';
import { verifySecret } from '../security/verify-password-hash.js';

export interface AdminHttpServer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface CreateAdminHttpServerOptions {
  config: RuntimeConfig;
  services: InfrastructureRuntimeServices;
  logger: {
    info(bindings: object, message: string): void;
    error(bindings: object, message: string): void;
  };
  appRoot?: string;
  backupDir?: string;
  serviceName?: string;
  backupOperations?: BackupOperations;
  serviceControl?: ServiceControl;
}

interface Session {
  token: string;
  csrfToken: string;
  expiresAt: number;
}

interface LoginAttempt {
  count: number;
  firstAttemptAt: number;
}

type FieldType = 'string' | 'number' | 'boolean' | 'json' | 'timestamp';

interface FieldDef {
  column: string;
  label: string;
  type: FieldType;
  nullable?: boolean;
}

interface SoftDeleteDef {
  column: string;
  value: string;
  timestampColumn?: string;
  actorColumn?: string;
}

interface ResourceDef {
  key: string;
  label: string;
  table: string;
  idColumn: string;
  titleColumn: string;
  subtitleColumns: string[];
  listColumns: string[];
  editableFields: FieldDef[];
  softDelete?: SoftDeleteDef;
}

const sessionCookieName = 'gameclub_admin_session';
const maxBodyBytes = 64 * 1024;
const defaultHttpServerConfig = {
  enabled: true,
  host: '127.0.0.1',
  port: 8787,
  feedbackFile: 'data/feedback.jsonl',
} as const;
const adminOperatorId = Number(process.env.GAMECLUB_ADMIN_CONSOLE_OPERATOR_ID ?? '0');
const resourceDefs: ResourceDef[] = [
  {
    key: 'users',
    label: 'Usuarios',
    table: 'users',
    idColumn: 'telegram_user_id',
    titleColumn: 'display_name',
    subtitleColumns: ['username', 'status'],
    listColumns: ['telegram_user_id', 'display_name', 'username', 'status', 'is_admin', 'is_approved'],
    editableFields: [
      { column: 'display_name', label: 'Display name', type: 'string' },
      { column: 'username', label: 'Username', type: 'string', nullable: true },
      { column: 'status', label: 'Status', type: 'string' },
      { column: 'is_admin', label: 'Admin', type: 'boolean' },
      { column: 'is_approved', label: 'Approved', type: 'boolean' },
      { column: 'status_reason', label: 'Status reason', type: 'string', nullable: true },
    ],
  },
  {
    key: 'catalog_items',
    label: 'Catalogo',
    table: 'catalog_items',
    idColumn: 'id',
    titleColumn: 'display_name',
    subtitleColumns: ['item_type', 'lifecycle_status'],
    listColumns: ['id', 'display_name', 'item_type', 'lifecycle_status', 'group_id', 'family_id'],
    editableFields: [
      { column: 'display_name', label: 'Display name', type: 'string' },
      { column: 'original_name', label: 'Original name', type: 'string', nullable: true },
      { column: 'description', label: 'Description', type: 'string', nullable: true },
      { column: 'language', label: 'Language', type: 'string', nullable: true },
      { column: 'publisher', label: 'Publisher', type: 'string', nullable: true },
      { column: 'publication_year', label: 'Publication year', type: 'number', nullable: true },
      { column: 'player_count_min', label: 'Player min', type: 'number', nullable: true },
      { column: 'player_count_max', label: 'Player max', type: 'number', nullable: true },
      { column: 'recommended_age', label: 'Recommended age', type: 'number', nullable: true },
      { column: 'play_time_minutes', label: 'Play time minutes', type: 'number', nullable: true },
      { column: 'lifecycle_status', label: 'Lifecycle', type: 'string' },
      { column: 'external_refs', label: 'External refs', type: 'json', nullable: true },
      { column: 'metadata', label: 'Metadata', type: 'json', nullable: true },
    ],
    softDelete: { column: 'lifecycle_status', value: 'inactive', timestampColumn: 'deactivated_at' },
  },
  resource('catalog_families', 'Familias', 'catalog_families', 'id', 'display_name', ['slug', 'family_kind'], ['id', 'display_name', 'slug', 'family_kind'], [
    { column: 'display_name', label: 'Display name', type: 'string' },
    { column: 'slug', label: 'Slug', type: 'string' },
    { column: 'description', label: 'Description', type: 'string', nullable: true },
    { column: 'family_kind', label: 'Family kind', type: 'string' },
  ]),
  resource('catalog_groups', 'Grupos', 'catalog_groups', 'id', 'display_name', ['slug', 'family_id'], ['id', 'display_name', 'slug', 'family_id'], [
    { column: 'display_name', label: 'Display name', type: 'string' },
    { column: 'slug', label: 'Slug', type: 'string' },
    { column: 'description', label: 'Description', type: 'string', nullable: true },
    { column: 'family_id', label: 'Family ID', type: 'number', nullable: true },
  ]),
  resource('catalog_loans', 'Prestamos', 'catalog_loans', 'id', 'borrower_display_name', ['item_id', 'returned_at'], ['id', 'item_id', 'borrower_display_name', 'due_at', 'returned_at'], [
    { column: 'borrower_display_name', label: 'Borrower', type: 'string' },
    { column: 'due_at', label: 'Due at', type: 'timestamp', nullable: true },
    { column: 'notes', label: 'Notes', type: 'string', nullable: true },
    { column: 'returned_at', label: 'Returned at', type: 'timestamp', nullable: true },
  ], { column: 'returned_at', value: 'now', timestampColumn: 'updated_at', actorColumn: 'returned_by_telegram_user_id' }),
  resource('club_tables', 'Mesas', 'club_tables', 'id', 'display_name', ['lifecycle_status', 'recommended_capacity'], ['id', 'display_name', 'recommended_capacity', 'lifecycle_status'], [
    { column: 'display_name', label: 'Display name', type: 'string' },
    { column: 'description', label: 'Description', type: 'string', nullable: true },
    { column: 'recommended_capacity', label: 'Capacity', type: 'number', nullable: true },
    { column: 'lifecycle_status', label: 'Lifecycle', type: 'string' },
  ], { column: 'lifecycle_status', value: 'inactive', timestampColumn: 'deactivated_at' }),
  resource('schedule_events', 'Actividades', 'schedule_events', 'id', 'title', ['starts_at', 'lifecycle_status'], ['id', 'title', 'starts_at', 'capacity', 'lifecycle_status'], [
    { column: 'title', label: 'Title', type: 'string' },
    { column: 'description', label: 'Description', type: 'string', nullable: true },
    { column: 'starts_at', label: 'Starts at', type: 'timestamp' },
    { column: 'duration_minutes', label: 'Duration', type: 'number' },
    { column: 'capacity', label: 'Capacity', type: 'number' },
    { column: 'attendance_mode', label: 'Attendance', type: 'string' },
    { column: 'lifecycle_status', label: 'Lifecycle', type: 'string' },
    { column: 'cancellation_reason', label: 'Cancellation reason', type: 'string', nullable: true },
  ], { column: 'lifecycle_status', value: 'cancelled', timestampColumn: 'cancelled_at', actorColumn: 'cancelled_by_telegram_user_id' }),
  resource('venue_events', 'Sala', 'venue_events', 'id', 'name', ['starts_at', 'lifecycle_status'], ['id', 'name', 'starts_at', 'ends_at', 'impact_level', 'lifecycle_status'], [
    { column: 'name', label: 'Name', type: 'string' },
    { column: 'description', label: 'Description', type: 'string', nullable: true },
    { column: 'starts_at', label: 'Starts at', type: 'timestamp' },
    { column: 'ends_at', label: 'Ends at', type: 'timestamp' },
    { column: 'occupancy_scope', label: 'Scope', type: 'string' },
    { column: 'impact_level', label: 'Impact', type: 'string' },
    { column: 'lifecycle_status', label: 'Lifecycle', type: 'string' },
    { column: 'cancellation_reason', label: 'Cancellation reason', type: 'string', nullable: true },
  ], { column: 'lifecycle_status', value: 'cancelled', timestampColumn: 'cancelled_at' }),
  resource('group_purchases', 'Compras', 'group_purchases', 'id', 'title', ['purchase_mode', 'lifecycle_status'], ['id', 'title', 'purchase_mode', 'lifecycle_status', 'join_deadline_at'], [
    { column: 'title', label: 'Title', type: 'string' },
    { column: 'description', label: 'Description', type: 'string', nullable: true },
    { column: 'purchase_mode', label: 'Mode', type: 'string' },
    { column: 'lifecycle_status', label: 'Lifecycle', type: 'string' },
    { column: 'join_deadline_at', label: 'Join deadline', type: 'timestamp', nullable: true },
    { column: 'confirm_deadline_at', label: 'Confirm deadline', type: 'timestamp', nullable: true },
    { column: 'total_price_cents', label: 'Total cents', type: 'number', nullable: true },
    { column: 'unit_price_cents', label: 'Unit cents', type: 'number', nullable: true },
    { column: 'unit_label', label: 'Unit label', type: 'string', nullable: true },
  ], { column: 'lifecycle_status', value: 'cancelled', timestampColumn: 'cancelled_at' }),
  resource('storage_categories', 'Storage categorias', 'storage_categories', 'id', 'display_name', ['slug', 'lifecycle_status'], ['id', 'display_name', 'slug', 'storage_chat_id', 'storage_thread_id', 'lifecycle_status'], [
    { column: 'display_name', label: 'Display name', type: 'string' },
    { column: 'slug', label: 'Slug', type: 'string' },
    { column: 'description', label: 'Description', type: 'string', nullable: true },
    { column: 'parent_category_id', label: 'Parent ID', type: 'number', nullable: true },
    { column: 'storage_chat_id', label: 'Chat ID', type: 'number' },
    { column: 'storage_thread_id', label: 'Thread ID', type: 'number' },
    { column: 'lifecycle_status', label: 'Lifecycle', type: 'string' },
  ], { column: 'lifecycle_status', value: 'archived', timestampColumn: 'archived_at' }),
  resource('storage_entries', 'Storage entradas', 'storage_entries', 'id', 'description', ['category_id', 'lifecycle_status'], ['id', 'category_id', 'source_kind', 'description', 'lifecycle_status'], [
    { column: 'description', label: 'Description', type: 'string', nullable: true },
    { column: 'tags', label: 'Tags', type: 'json' },
    { column: 'lifecycle_status', label: 'Lifecycle', type: 'string' },
  ], { column: 'lifecycle_status', value: 'deleted', timestampColumn: 'deleted_at', actorColumn: 'deleted_by_telegram_user_id' }),
  resource('lfg_player_ads', 'LFG jugadores', 'lfg_player_ads', 'id', 'display_name', ['status', 'telegram_user_id'], ['id', 'display_name', 'telegram_user_id', 'status'], [
    { column: 'display_name', label: 'Display name', type: 'string' },
    { column: 'description', label: 'Description', type: 'string' },
    { column: 'status', label: 'Status', type: 'string' },
  ], { column: 'status', value: 'cancelled', timestampColumn: 'cancelled_at' }),
  resource('lfg_group_ads', 'LFG grupos', 'lfg_group_ads', 'id', 'title', ['status', 'creator_display_name'], ['id', 'title', 'creator_display_name', 'status'], [
    { column: 'title', label: 'Title', type: 'string' },
    { column: 'description', label: 'Description', type: 'string' },
    { column: 'seats_available', label: 'Seats', type: 'number', nullable: true },
    { column: 'status', label: 'Status', type: 'string' },
  ], { column: 'status', value: 'cancelled', timestampColumn: 'cancelled_at' }),
  resource('audit_log', 'Auditoria', 'audit_log', 'id', 'summary', ['action_key', 'target_type'], ['id', 'action_key', 'target_type', 'target_id', 'summary'], []),
];

export function createAdminHttpServer({
  config,
  services,
  logger,
  appRoot = process.cwd(),
  backupDir = process.env.GAMECLUB_BACKUP_DIR ?? '/var/backups/gameclubtelegrambot',
  serviceName = process.env.GAMECLUB_SERVICE_NAME ?? 'gameclubtelegrambot.service',
  backupOperations,
  serviceControl,
}: CreateAdminHttpServerOptions): AdminHttpServer {
  const httpConfig = {
    ...defaultHttpServerConfig,
    ...config.httpServer,
  };

  if (!httpConfig.enabled) {
    return {
      async start() {},
      async stop() {},
    };
  }

  const sessions = new Map<string, Session>();
  const loginAttempts = new Map<string, LoginAttempt>();
  const cookieSecret = httpConfig.sessionSecret ?? randomBytes(32).toString('hex');
  const control = serviceControl ?? createServiceControl({ serviceName });
  const operations = backupOperations ?? createBackupOperations({ appRoot, backupDir, serviceName, serviceControl: control });
  const feedbackFile = resolve(appRoot, httpConfig.feedbackFile);
  let server: Server | undefined;

  const handler = async (request: IncomingMessage, response: ServerResponse) => {
    try {
      await routeRequest({
        request,
        response,
        config,
        logger,
        services,
        sessions,
        loginAttempts,
        cookieSecret,
        operations,
        serviceControl: control,
        feedbackFile,
      });
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Admin HTTP request failed');
      sendHtml(response, 500, page('Error', '<p>No s&apos;ha pogut completar la peticio.</p>'));
    }
  };

  return {
    async start() {
      server = createServer((request, response) => {
        void handler(request, response);
      });

      await new Promise<void>((resolveStart, rejectStart) => {
        server?.once('error', rejectStart);
        server?.listen(httpConfig.port, httpConfig.host, () => {
          server?.off('error', rejectStart);
          resolveStart();
        });
      });

      logger.info(
        { httpServer: { host: httpConfig.host, port: httpConfig.port } },
        'Admin HTTP server started',
      );
    },
    async stop() {
      if (!server) {
        return;
      }

      await new Promise<void>((resolveStop, rejectStop) => {
        server?.close((error) => {
          if (error) {
            rejectStop(error);
            return;
          }
          resolveStop();
        });
      });
      server = undefined;
      logger.info({}, 'Admin HTTP server stopped');
    },
  };
}

async function routeRequest(options: {
  request: IncomingMessage;
  response: ServerResponse;
  config: RuntimeConfig;
  logger: CreateAdminHttpServerOptions['logger'];
  services: InfrastructureRuntimeServices;
  sessions: Map<string, Session>;
  loginAttempts: Map<string, LoginAttempt>;
  cookieSecret: string;
  operations: BackupOperations;
  serviceControl: ServiceControl;
  feedbackFile: string;
}): Promise<void> {
  const { request, response } = options;
  const url = new URL(request.url ?? '/', 'http://localhost');

  if (request.method === 'GET' && url.pathname === '/') {
    sendHtml(response, 200, welcomePage());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/feedback') {
    sendHtml(response, 200, feedbackPage());
    return;
  }

  if (request.method === 'POST' && url.pathname === '/feedback') {
    const form = await readForm(request);
    await saveFeedback(options.feedbackFile, {
      createdAt: new Date().toISOString(),
      topic: form.get('topic') ?? 'bot',
      name: form.get('name') ?? '',
      contact: form.get('contact') ?? '',
      message: form.get('message') ?? '',
      userAgent: request.headers['user-agent'] ?? '',
      remoteAddress: request.socket.remoteAddress ?? '',
    });
    sendHtml(response, 200, page('Feedback enviat', '<p>Gracies. El feedback ha quedat registrat.</p><p><a href="/feedback">Enviar-ne un altre</a></p>'));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/admin/login') {
    sendHtml(response, 200, loginPage());
    return;
  }

  if (request.method === 'POST' && url.pathname === '/admin/login') {
    const form = await readForm(request);
    const loginKey = loginAttemptKey(request);
    if (isLoginRateLimited(options.loginAttempts, loginKey)) {
      sendHtml(response, 429, loginPage('Massa intents. Torna-ho a provar mes tard.'));
      return;
    }
    const ok = await verifySecret(form.get('password') ?? '', options.config.adminElevation.passwordHash);
    if (!ok) {
      recordFailedLogin(options.loginAttempts, loginKey);
      sendHtml(response, 401, loginPage('Contrasenya incorrecta.'));
      return;
    }
    options.loginAttempts.delete(loginKey);
    const session = createSession(options.sessions);
    response.setHeader('Set-Cookie', serializeCookie(sessionCookieName, signToken(session.token, options.cookieSecret)));
    redirect(response, '/admin');
    return;
  }

  const authenticatedSession = url.pathname.startsWith('/admin')
    ? getAuthenticatedSession(request, options.sessions, options.cookieSecret)
    : null;

  if (request.method === 'POST' && url.pathname === '/admin/logout') {
    const form = await readForm(request);
    if (!authenticatedSession || !isValidCsrf(form, authenticatedSession)) {
      sendHtml(response, 403, page('Accio rebutjada', '<p>La sessio admin no es valida. Torna a entrar.</p>'));
      return;
    }
    response.setHeader('Set-Cookie', `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    redirect(response, '/admin/login');
    return;
  }

  if (url.pathname.startsWith('/admin') && !authenticatedSession) {
    redirect(response, '/admin/login');
    return;
  }
  const adminSession = authenticatedSession as Session;

  if (request.method === 'GET' && url.pathname === '/admin') {
    const status = await options.operations.readBackupConsoleStatus();
    const logs = await safeReadLogs(options.serviceControl);
    sendHtml(response, 200, adminPage(status, logs, adminSession.csrfToken));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/admin/resources') {
    sendHtml(response, 200, resourcesIndexPage());
    return;
  }

  const resourceMatch = url.pathname.match(/^\/admin\/resources\/([^/]+)$/);
  if (request.method === 'GET' && resourceMatch?.[1]) {
    const resourceDef = requireResource(resourceMatch[1]);
    const search = url.searchParams.get('q') ?? '';
    const rows = await fetchResourceRows(options.services, resourceDef, search);
    sendHtml(response, 200, resourceListPage(resourceDef, rows, search, adminSession.csrfToken));
    return;
  }

  const resourceEditMatch = url.pathname.match(/^\/admin\/resources\/([^/]+)\/([^/]+)\/edit$/);
  if (request.method === 'GET' && resourceEditMatch?.[1] && resourceEditMatch[2]) {
    const resourceDef = requireResource(resourceEditMatch[1]);
    const row = await fetchResourceDetail(options.services, resourceDef, resourceEditMatch[2]);
    sendHtml(response, 200, resourceEditPage(resourceDef, row, adminSession.csrfToken));
    return;
  }

  if (request.method === 'POST' && resourceEditMatch?.[1] && resourceEditMatch[2]) {
    const resourceDef = requireResource(resourceEditMatch[1]);
    const form = await readForm(request);
    if (!isValidCsrf(form, adminSession)) {
      sendHtml(response, 403, page('Accio rebutjada', '<p>La sessio admin no es valida. Torna a entrar.</p>'));
      return;
    }
    await updateResourceFields(options.services, resourceDef, resourceEditMatch[2], form);
    redirect(response, `/admin/resources/${resourceDef.key}`);
    return;
  }

  const resourceDeleteMatch = url.pathname.match(/^\/admin\/resources\/([^/]+)\/([^/]+)\/delete$/);
  if (request.method === 'POST' && resourceDeleteMatch?.[1] && resourceDeleteMatch[2]) {
    const resourceDef = requireResource(resourceDeleteMatch[1]);
    const form = await readForm(request);
    if (!isValidCsrf(form, adminSession)) {
      sendHtml(response, 403, page('Accio rebutjada', '<p>La sessio admin no es valida. Torna a entrar.</p>'));
      return;
    }
    await deleteResource(options.services, resourceDef, resourceDeleteMatch[2], form.get('mode') === 'hard');
    redirect(response, `/admin/resources/${resourceDef.key}`);
    return;
  }

  const userActionMatch = url.pathname.match(/^\/admin\/resources\/users\/([^/]+)\/user-action$/);
  if (request.method === 'POST' && userActionMatch?.[1]) {
    const form = await readForm(request);
    if (!isValidCsrf(form, adminSession)) {
      sendHtml(response, 403, page('Accio rebutjada', '<p>La sessio admin no es valida. Torna a entrar.</p>'));
      return;
    }
    await applyUserAction(options.services, userActionMatch[1], form.get('action') ?? '');
    redirect(response, '/admin/resources/users');
    return;
  }

  if (request.method === 'POST' && url.pathname === '/admin/token') {
    const form = await readForm(request);
    if (!isValidCsrf(form, adminSession)) {
      sendHtml(response, 403, page('Accio rebutjada', '<p>La sessio admin no es valida. Torna a entrar.</p>'));
      return;
    }
    await updateTelegramToken(form.get('token') ?? '');
    redirect(response, '/admin');
    return;
  }

  if (request.method === 'POST' && url.pathname === '/admin/service') {
    const form = await readForm(request);
    if (!isValidCsrf(form, adminSession)) {
      sendHtml(response, 403, page('Accio rebutjada', '<p>La sessio admin no es valida. Torna a entrar.</p>'));
      return;
    }
    const action = form.get('action');
    if (action === 'start') await options.serviceControl.startService();
    if (action === 'stop') await options.serviceControl.stopService();
    if (action === 'restart') await options.serviceControl.restartService();
    redirect(response, '/admin');
    return;
  }

  if (request.method === 'POST' && url.pathname === '/admin/backup') {
    const form = await readForm(request);
    if (!isValidCsrf(form, adminSession)) {
      sendHtml(response, 403, page('Accio rebutjada', '<p>La sessio admin no es valida. Torna a entrar.</p>'));
      return;
    }
    await options.operations.createFullBackup();
    redirect(response, '/admin');
    return;
  }

  if (request.method === 'POST' && url.pathname === '/admin/restore') {
    const form = await readForm(request);
    if (!isValidCsrf(form, adminSession)) {
      sendHtml(response, 403, page('Accio rebutjada', '<p>La sessio admin no es valida. Torna a entrar.</p>'));
      return;
    }
    const backupFilePath = form.get('backupFilePath') ?? '';
    const archives = await options.operations.listBackupArchives();
    if (!archives.some((archive) => archive.filePath === backupFilePath)) {
      sendHtml(response, 400, page('Backup invalid', '<p>El backup seleccionat no es valid.</p>'));
      return;
    }
    await options.operations.restoreFullBackup({ backupFilePath });
    redirect(response, '/admin');
    return;
  }

  if (request.method === 'POST' && url.pathname === '/admin/delete-backup') {
    const form = await readForm(request);
    if (!isValidCsrf(form, adminSession)) {
      sendHtml(response, 403, page('Accio rebutjada', '<p>La sessio admin no es valida. Torna a entrar.</p>'));
      return;
    }
    const backupFilePath = form.get('backupFilePath') ?? '';
    const archives = await options.operations.listBackupArchives();
    if (!archives.some((archive) => archive.filePath === backupFilePath)) {
      sendHtml(response, 400, page('Backup invalid', '<p>El backup seleccionat no es valid.</p>'));
      return;
    }
    await deleteBackupArchive(backupFilePath);
    redirect(response, '/admin');
    return;
  }

  sendHtml(response, 404, page('No trobat', '<p>Pagina no trobada.</p>'));
}

async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBodyBytes) {
      throw new Error('Request body too large');
    }
    chunks.push(buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

async function saveFeedback(filePath: string, input: Record<string, unknown>): Promise<void> {
  const message = String(input.message ?? '').trim();
  if (message.length < 3) {
    throw new Error('Feedback message is required');
  }
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify({ ...input, message })}\n`, 'utf8');
}

function createSession(sessions: Map<string, Session>): Session {
  const token = randomBytes(32).toString('hex');
  const session = {
    token,
    csrfToken: randomBytes(32).toString('hex'),
    expiresAt: Date.now() + 8 * 60 * 60 * 1000,
  };
  sessions.set(token, session);
  return session;
}

function getAuthenticatedSession(request: IncomingMessage, sessions: Map<string, Session>, secret: string): Session | null {
  const signed = parseCookies(request.headers.cookie ?? '')[sessionCookieName];
  if (!signed) {
    return null;
  }
  const token = verifySignedToken(signed, secret);
  if (!token) {
    return null;
  }
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function isValidCsrf(form: URLSearchParams, session: Session): boolean {
  const value = form.get('csrfToken') ?? '';
  return value.length > 0 && safeEqual(value, session.csrfToken);
}

function loginAttemptKey(request: IncomingMessage): string {
  return request.socket.remoteAddress ?? 'unknown';
}

function isLoginRateLimited(attempts: Map<string, LoginAttempt>, key: string): boolean {
  const current = attempts.get(key);
  if (!current) {
    return false;
  }
  const windowMs = 15 * 60 * 1000;
  if (Date.now() - current.firstAttemptAt > windowMs) {
    attempts.delete(key);
    return false;
  }
  return current.count >= 5;
}

function recordFailedLogin(attempts: Map<string, LoginAttempt>, key: string): void {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || now - current.firstAttemptAt > 15 * 60 * 1000) {
    attempts.set(key, { count: 1, firstAttemptAt: now });
    return;
  }
  attempts.set(key, { ...current, count: current.count + 1 });
}

function signToken(token: string, secret: string): string {
  const signature = createHmac('sha256', secret).update(token).digest('base64url');
  return `${token}.${signature}`;
}

function verifySignedToken(value: string, secret: string): string | null {
  const [token, signature] = value.split('.');
  if (!token || !signature) {
    return null;
  }
  const expected = signToken(token, secret).split('.')[1];
  if (!expected || !safeEqual(signature, expected)) {
    return null;
  }
  return token;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(header: string): Record<string, string> {
  return Object.fromEntries(header.split(';').map((part) => {
    const [key, ...value] = part.trim().split('=');
    return [key, value.join('=')];
  }).filter(([key]) => key));
}

function serializeCookie(name: string, value: string): string {
  return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`;
}

function resource(
  key: string,
  label: string,
  table: string,
  idColumn: string,
  titleColumn: string,
  subtitleColumns: string[],
  listColumns: string[],
  editableFields: FieldDef[],
  softDelete?: SoftDeleteDef,
): ResourceDef {
  return {
    key,
    label,
    table,
    idColumn,
    titleColumn,
    subtitleColumns,
    listColumns,
    editableFields,
    ...(softDelete ? { softDelete } : {}),
  };
}

function requireResource(key: string): ResourceDef {
  const resourceDef = resourceDefs.find((candidate) => candidate.key === key);
  if (!resourceDef) {
    throw new Error(`Unsupported resource: ${key}`);
  }
  return resourceDef;
}

function uniqueColumns(columns: string[]): string[] {
  return Array.from(new Set(columns));
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function normalizeId(value: string): string | number {
  return /^-?\d+$/.test(value) ? Number(value) : value;
}

async function fetchResourceRows(
  services: InfrastructureRuntimeServices,
  resourceDef: ResourceDef,
  search: string,
): Promise<Array<Record<string, unknown>>> {
  const columns = uniqueColumns([resourceDef.idColumn, resourceDef.titleColumn, ...resourceDef.subtitleColumns, ...resourceDef.listColumns]);
  const params: unknown[] = [];
  let where = '';
  if (search.trim()) {
    where = `where ${columns.map((column) => `${quoteIdentifier(column)}::text ilike $1`).join(' or ')}`;
    params.push(`%${search.trim()}%`);
  }
  const sql = `select ${columns.map(quoteIdentifier).join(', ')} from ${quoteIdentifier(resourceDef.table)} ${where} order by ${quoteIdentifier(resourceDef.idColumn)} desc limit 300`;
  const result = await services.database.pool.query(sql, params);
  return result.rows as Array<Record<string, unknown>>;
}

async function fetchResourceDetail(
  services: InfrastructureRuntimeServices,
  resourceDef: ResourceDef,
  rowId: string,
): Promise<Record<string, unknown>> {
  const result = await services.database.pool.query(
    `select * from ${quoteIdentifier(resourceDef.table)} where ${quoteIdentifier(resourceDef.idColumn)} = $1 limit 1`,
    [normalizeId(rowId)],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error('Resource row not found');
  }
  return row;
}

async function updateResourceFields(
  services: InfrastructureRuntimeServices,
  resourceDef: ResourceDef,
  rowId: string,
  form: URLSearchParams,
): Promise<void> {
  const assignments: string[] = [];
  const params: unknown[] = [];
  for (const field of resourceDef.editableFields) {
    if (!form.has(field.column)) {
      continue;
    }
    params.push(parseFieldValue(field, form.get(field.column) ?? ''));
    assignments.push(`${quoteIdentifier(field.column)} = $${params.length}`);
  }
  if (assignments.length === 0) {
    return;
  }
  if (await tableHasColumn(services, resourceDef.table, 'updated_at')) {
    assignments.push(`${quoteIdentifier('updated_at')} = now()`);
  }
  params.push(normalizeId(rowId));
  await services.database.pool.query(
    `update ${quoteIdentifier(resourceDef.table)} set ${assignments.join(', ')} where ${quoteIdentifier(resourceDef.idColumn)} = $${params.length}`,
    params,
  );
}

function parseFieldValue(field: FieldDef, value: string): unknown {
  const stripped = value.trim();
  if (field.nullable && (stripped === '' || stripped.toLowerCase() === 'null')) {
    return null;
  }
  if (field.type === 'number') {
    const parsed = Number(stripped);
    if (!Number.isFinite(parsed)) {
      throw new Error(`${field.column} must be a number`);
    }
    return Number.isInteger(parsed) ? parsed : Number(stripped);
  }
  if (field.type === 'boolean') {
    if (['true', '1', 'yes', 'y', 'si', 'sí'].includes(stripped.toLowerCase())) {
      return true;
    }
    if (['false', '0', 'no', 'n'].includes(stripped.toLowerCase())) {
      return false;
    }
    throw new Error(`${field.column} must be true or false`);
  }
  if (field.type === 'json') {
    return JSON.parse(stripped);
  }
  return value;
}

async function deleteResource(
  services: InfrastructureRuntimeServices,
  resourceDef: ResourceDef,
  rowId: string,
  hardDelete: boolean,
): Promise<void> {
  if (hardDelete || !resourceDef.softDelete) {
    await deleteDependents(services, resourceDef, rowId);
    await services.database.pool.query(
      `delete from ${quoteIdentifier(resourceDef.table)} where ${quoteIdentifier(resourceDef.idColumn)} = $1`,
      [normalizeId(rowId)],
    );
    return;
  }
  const softDelete = resourceDef.softDelete;
  const assignments: string[] = [];
  const params: unknown[] = [];
  if (softDelete.value === 'now') {
    assignments.push(`${quoteIdentifier(softDelete.column)} = now()`);
  } else {
    params.push(softDelete.value);
    assignments.push(`${quoteIdentifier(softDelete.column)} = $${params.length}`);
  }
  if (softDelete.timestampColumn) {
    assignments.push(`${quoteIdentifier(softDelete.timestampColumn)} = now()`);
  }
  if (softDelete.actorColumn) {
    params.push(adminOperatorId);
    assignments.push(`${quoteIdentifier(softDelete.actorColumn)} = $${params.length}`);
  }
  if (await tableHasColumn(services, resourceDef.table, 'updated_at')) {
    assignments.push(`${quoteIdentifier('updated_at')} = now()`);
  }
  params.push(normalizeId(rowId));
  await services.database.pool.query(
    `update ${quoteIdentifier(resourceDef.table)} set ${assignments.join(', ')} where ${quoteIdentifier(resourceDef.idColumn)} = $${params.length}`,
    params,
  );
}

async function deleteDependents(
  services: InfrastructureRuntimeServices,
  resourceDef: ResourceDef,
  rowId: string,
): Promise<void> {
  if (resourceDef.table !== 'catalog_items') {
    return;
  }
  await services.database.pool.query('delete from "catalog_media" where "item_id" = $1', [normalizeId(rowId)]);
  await services.database.pool.query('delete from "catalog_loans" where "item_id" = $1', [normalizeId(rowId)]);
}

async function applyUserAction(
  services: InfrastructureRuntimeServices,
  rowId: string,
  action: string,
): Promise<void> {
  const normalizedId = normalizeId(rowId);
  if (['pending', 'approved', 'blocked', 'revoked'].includes(action)) {
    const existing = await services.database.pool.query('select "status" from "users" where "telegram_user_id" = $1', [normalizedId]);
    const previous = String(existing.rows[0]?.status ?? '');
    if (!previous) {
      throw new Error('User not found');
    }
    await services.database.pool.query(
      `update "users"
          set "status" = $1,
              "is_approved" = $2,
              "updated_at" = now(),
              "approved_at" = case when $1 = 'approved' then now() else "approved_at" end,
              "blocked_at" = case when $1 in ('blocked', 'revoked') then now() else null end,
              "revoked_at" = case when $1 = 'revoked' then now() else null end,
              "status_reason" = $3
        where "telegram_user_id" = $4`,
      [action, action === 'approved', `admin-http ${action}`, normalizedId],
    );
    await services.database.pool.query(
      `insert into "user_status_audit_log"
        ("subject_telegram_user_id", "previous_status", "next_status", "changed_by_telegram_user_id", "reason")
       values ($1, $2, $3, $4, $5)`,
      [normalizedId, previous, action, adminOperatorId, `admin-http ${action}`],
    );
    return;
  }

  if (action === 'toggle-admin' || action === 'toggle-approved') {
    const column = action === 'toggle-admin' ? 'is_admin' : 'is_approved';
    const existing = await services.database.pool.query(`select ${quoteIdentifier(column)} from "users" where "telegram_user_id" = $1`, [normalizedId]);
    if (!existing.rows[0]) {
      throw new Error('User not found');
    }
    const previousValue = Boolean((existing.rows[0] as Record<string, unknown>)[column]);
    const nextValue = !previousValue;
    await services.database.pool.query(`update "users" set ${quoteIdentifier(column)} = $1, "updated_at" = now() where "telegram_user_id" = $2`, [nextValue, normalizedId]);
    if (column === 'is_admin') {
      await services.database.pool.query(
        `insert into "user_permission_audit_log"
          ("subject_telegram_user_id", "permission_key", "scope_type", "resource_type", "resource_id",
           "previous_effect", "next_effect", "changed_by_telegram_user_id", "reason")
         values ($1, 'admin', 'global', null, null, $2, $3, $4, $5)`,
        [normalizedId, previousValue ? 'allow' : null, nextValue ? 'allow' : null, adminOperatorId, 'admin-http toggle admin'],
      );
    }
    return;
  }

  throw new Error(`Unsupported user action: ${action}`);
}

async function tableHasColumn(
  services: InfrastructureRuntimeServices,
  table: string,
  column: string,
): Promise<boolean> {
  const result = await services.database.pool.query(
    `select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2 limit 1`,
    [table, column],
  );
  return result.rows.length > 0;
}

async function updateTelegramToken(token: string): Promise<void> {
  const trimmed = token.trim();
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(trimmed)) {
    throw new Error('Invalid Telegram token format');
  }
  const paths = resolveRuntimeConfigPaths(process.env);
  const existing = await readFile(paths.envPath, 'utf8').catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  });
  await mkdir(dirname(paths.envPath), { recursive: true });
  await writeFile(paths.envPath, serializeEnvFile(existing, { GAMECLUB_TELEGRAM_TOKEN: trimmed }), 'utf8');
}

async function deleteBackupArchive(filePath: string): Promise<void> {
  if (!basename(filePath).startsWith('gameclub-backup-') || !filePath.endsWith('.zip')) {
    throw new Error('Refusing to delete a file that does not look like a gameclub backup');
  }
  await unlink(filePath);
}

async function safeReadLogs(serviceControl: ServiceControl): Promise<string> {
  try {
    return await serviceControl.readRecentLogs({ lines: 60 });
  } catch (error) {
    return error instanceof Error ? error.message : 'No logs available';
  }
}

function redirect(response: ServerResponse, location: string): void {
  response.statusCode = 303;
  response.setHeader('Location', location);
  response.end();
}

function sendHtml(response: ServerResponse, statusCode: number, body: string): void {
  response.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(body);
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="ca"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:1120px;margin:32px auto;padding:0 16px;line-height:1.45}nav{display:flex;gap:12px;margin-bottom:24px}input,textarea,select,button{font:inherit}input,textarea,select{box-sizing:border-box;width:100%;padding:8px;margin:4px 0 12px}textarea{min-height:140px}button{padding:8px 12px}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border-bottom:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}section{border-top:1px solid #ddd;padding-top:16px;margin-top:16px}.row{display:flex;gap:8px;flex-wrap:wrap}.inline{display:inline}pre{white-space:pre-wrap;background:#f6f6f6;padding:12px;overflow:auto}</style></head><body><nav><a href="/feedback">Feedback</a><a href="/admin">Admin</a><a href="/admin/resources">Recursos</a></nav><h1>${escapeHtml(title)}</h1>${body}</body></html>`;
}

function feedbackPage(): string {
  return page('Feedback', '<form method="post"><label>Sobre que es?<select name="topic"><option value="bot">Bot</option><option value="club">Club</option><option value="both">Bot i club</option></select></label><label>Nom opcional<input name="name" autocomplete="name"></label><label>Contacte opcional<input name="contact" autocomplete="email"></label><label>Feedback<textarea name="message" required maxlength="4000"></textarea></label><button type="submit">Enviar feedback</button></form>');
}

function loginPage(error = ''): string {
  const errorHtml = error ? `<p>${escapeHtml(error)}</p>` : '';
  return page('Admin', `${errorHtml}<form method="post"><label>Contrasenya admin<input name="password" type="password" required autocomplete="current-password"></label><button type="submit">Entrar</button></form>`);
}

function welcomePage(): string {
  return page(
    'Cawa',
    '<p>Benvingut al panell web de Cawa. Des d&apos;aqui pots enviar feedback del bot o entrar a l&apos;administracio si tens permisos.</p><p class="row"><a href="/feedback">Enviar feedback</a><a href="/admin">Administracio</a></p>',
  );
}

function adminPage(status: Awaited<ReturnType<BackupOperations['readBackupConsoleStatus']>>, logs: string, csrfToken: string): string {
  const databaseSummary = status.database.state === 'connected'
    ? `${escapeHtml(status.database.databaseName)} · ${status.database.totalTables} taules · ${formatBytes(status.database.sizeBytes)}`
    : escapeHtml(status.database.message);
  const tableCounts = status.database.state === 'connected'
    ? `<ul>${status.database.knownTableCounts.map((item) => `<li>${escapeHtml(item.tableName)}: ${item.rowCount}</li>`).join('')}</ul>`
    : '';
  const archives = status.backups.archives.length === 0
    ? '<p>No hi ha backups disponibles.</p>'
    : `<ul>${status.backups.archives.map((archive) => `<li>${escapeHtml(archive.fileName)} · ${formatBytes(archive.sizeBytes)} · ${escapeHtml(archive.modifiedAt)} <form method="post" action="/admin/restore" class="inline">${csrfInput(csrfToken)}<input type="hidden" name="backupFilePath" value="${escapeHtml(archive.filePath)}"><button type="submit">Restaurar</button></form> <form method="post" action="/admin/delete-backup" class="inline">${csrfInput(csrfToken)}<input type="hidden" name="backupFilePath" value="${escapeHtml(archive.filePath)}"><button type="submit">Eliminar</button></form></li>`).join('')}</ul>`;
  return page('Admin', `<form method="post" action="/admin/logout">${csrfInput(csrfToken)}<button type="submit">Sortir</button></form><section><h2>Servei</h2><p>${escapeHtml(status.service.serviceName)}: ${escapeHtml(status.service.state)}</p><form class="row" method="post" action="/admin/service">${csrfInput(csrfToken)}<button name="action" value="start">Arrencar</button><button name="action" value="stop">Aturar</button><button name="action" value="restart">Reiniciar</button></form></section><section><h2>Config</h2><ul>${status.configFiles.map((item) => `<li>${escapeHtml(item.label)}: ${escapeHtml(item.path)} · ${escapeHtml(item.state)}</li>`).join('')}</ul><form method="post" action="/admin/token">${csrfInput(csrfToken)}<label>Nou token de Telegram<input name="token" type="password" autocomplete="off" pattern="\\d+:[A-Za-z0-9_-]{20,}"></label><button type="submit">Canviar token bot</button></form></section><section><h2>Base de dades</h2><p>${databaseSummary}</p>${tableCounts}</section><section><h2>Backups</h2><p>${status.backups.totalCount} arxius a ${escapeHtml(status.backups.directory)}</p><form method="post" action="/admin/backup">${csrfInput(csrfToken)}<button type="submit">Crear backup complet</button></form>${archives}</section><section><h2>Dependencies</h2><ul>${status.dependencies.map((item) => `<li>${escapeHtml(item.command)}: ${escapeHtml(item.state)}</li>`).join('')}</ul></section><section><h2>Logs</h2><pre>${escapeHtml(logs)}</pre></section>`);
}

function resourcesIndexPage(): string {
  return page('Recursos', `<ul>${resourceDefs.map((resourceDef) => `<li><a href="/admin/resources/${resourceDef.key}">${escapeHtml(resourceDef.label)}</a></li>`).join('')}</ul>`);
}

function resourceListPage(resourceDef: ResourceDef, rows: Array<Record<string, unknown>>, search: string, csrfToken: string): string {
  const columns = uniqueColumns([resourceDef.idColumn, resourceDef.titleColumn, ...resourceDef.subtitleColumns, ...resourceDef.listColumns]);
  const header = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('');
  const body = rows.map((row) => {
    const id = String(row[resourceDef.idColumn] ?? '');
    const cells = columns.map((column) => `<td>${escapeHtml(formatCell(row[column]))}</td>`).join('');
    return `<tr>${cells}<td><a href="/admin/resources/${resourceDef.key}/${encodeURIComponent(id)}/edit">Editar</a> <form method="post" action="/admin/resources/${resourceDef.key}/${encodeURIComponent(id)}/delete" class="inline">${csrfInput(csrfToken)}<button name="mode" value="soft">Desactivar</button><button name="mode" value="hard">Borrar</button></form>${resourceDef.key === 'users' ? userActionForms(id, csrfToken) : ''}</td></tr>`;
  }).join('');
  return page(resourceDef.label, `<form method="get"><input name="q" value="${escapeHtml(search)}" placeholder="Buscar"><button type="submit">Buscar</button></form><table><thead><tr>${header}<th>Acciones</th></tr></thead><tbody>${body}</tbody></table>`);
}

function resourceEditPage(resourceDef: ResourceDef, row: Record<string, unknown>, csrfToken: string): string {
  if (resourceDef.editableFields.length === 0) {
    return page(resourceDef.label, '<p>Aquest recurs no te camps editables.</p>');
  }
  const fields = resourceDef.editableFields.map((field) => `<label>${escapeHtml(field.label)} <small>${escapeHtml(field.column)} · ${escapeHtml(field.type)}</small><textarea name="${escapeHtml(field.column)}">${escapeHtml(formatCell(row[field.column]))}</textarea></label>`).join('');
  return page(resourceDef.label, `<form method="post">${csrfInput(csrfToken)}${fields}<button type="submit">Guardar</button></form>`);
}

function userActionForms(id: string, csrfToken: string): string {
  const actions = [
    ['approved', 'Aprobar'],
    ['pending', 'Pend.'],
    ['blocked', 'Bloquear'],
    ['revoked', 'Revocar'],
    ['toggle-admin', 'Admin'],
    ['toggle-approved', 'Aprob.'],
  ];
  return ` ${actions.map(([action, label]) => `<form method="post" action="/admin/resources/users/${encodeURIComponent(id)}/user-action" class="inline">${csrfInput(csrfToken)}<button name="action" value="${action}">${label}</button></form>`).join(' ')}`;
}

function csrfInput(csrfToken: string): string {
  return `<input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">`;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
