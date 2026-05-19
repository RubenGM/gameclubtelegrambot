import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdir, appendFile, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';

import type { RuntimeConfig } from '../config/runtime-config.js';
import type { InfrastructureRuntimeServices } from '../infrastructure/runtime-boundary.js';
import { resolveRuntimeConfigPaths, serializeEnvFile } from '../config/runtime-config-files.js';
import { createBackupOperations, type BackupOperations } from '../operations/backup-operations.js';
import { createServiceControl, type ServiceControl } from '../operations/service-control.js';
import { verifySecret } from '../security/verify-password-hash.js';
import { createDatabaseAppMetadataSessionStorage } from '../telegram/conversation-session-store.js';
import { listNewsGroupCategories, newMembersNewsGroupCategory } from '../news/news-group-catalog.js';
import { escapeHtml, renderHttpPage, type RenderHttpPageOptions } from './http-pages.js';
import { listHttpThemes } from './http-theme.js';
import { createDatabaseMemberSignupStore, type MemberSignupRecord, type MemberSignupStore } from './member-signup-store.js';
import { createAppMetadataWebSettingsStore, type WebSettings, type WebSettingsStore } from './web-settings-store.js';

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
  webSettingsStore?: WebSettingsStore;
  memberSignupStore?: MemberSignupStore;
  telegramSender?: HttpTelegramSender;
}

interface Session {
  token: string;
  csrfToken: string;
  expiresAt: number;
  pendingTelegramToken?: string;
}

interface LoginAttempt {
  count: number;
  firstAttemptAt: number;
}

interface HttpTelegramSender {
  sendPrivateMessage(telegramUserId: number, message: string): Promise<void>;
  sendGroupMessage?(chatId: number, message: string, options?: { parseMode?: 'HTML' }): Promise<void>;
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
const maxAssetUploadBytes = 2 * 1024 * 1024;
const publicCatalogPageSize = 24;
const bundledBrandAssetNames = new Set(['cawa_logo.svg', 'cawa_casco.svg']);
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
  resource('schedule_events', 'Actividades', 'schedule_events', 'id', 'title', ['starts_at', 'lifecycle_status'], ['id', 'title', 'starts_at', 'capacity', 'catalog_item_id', 'lifecycle_status'], [
    { column: 'title', label: 'Title', type: 'string' },
    { column: 'description', label: 'Description', type: 'string', nullable: true },
    { column: 'starts_at', label: 'Starts at', type: 'timestamp' },
    { column: 'duration_minutes', label: 'Duration', type: 'number' },
    { column: 'capacity', label: 'Capacity', type: 'number' },
    { column: 'catalog_item_id', label: 'Catalog item ID', type: 'number', nullable: true },
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
  webSettingsStore,
  memberSignupStore,
  telegramSender,
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
  const webAssetsDir = resolve(appRoot, 'data/http-assets');
  const settingsStore = webSettingsStore ?? createAppMetadataWebSettingsStore({
    storage: createDatabaseAppMetadataSessionStorage({ database: services.database.db }),
  });
  const signups = memberSignupStore ?? createDatabaseMemberSignupStore({
    database: services.database.db,
  });
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
        webSettingsStore: settingsStore,
        webAssetsDir,
        appRoot,
        memberSignupStore: signups,
        ...(telegramSender ? { telegramSender } : {}),
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
  webSettingsStore: WebSettingsStore;
  webAssetsDir: string;
  appRoot: string;
  memberSignupStore: MemberSignupStore;
  telegramSender?: HttpTelegramSender;
}): Promise<void> {
  const { request, response } = options;
  const url = new URL(request.url ?? '/', 'http://localhost');

  const assetMatch = url.pathname.match(/^\/assets\/([A-Za-z0-9][A-Za-z0-9._-]{0,160})$/);
  if (request.method === 'GET' && assetMatch?.[1]) {
    await sendWebAsset(response, options.webAssetsDir, assetMatch[1]);
    return;
  }

  const brandAssetMatch = url.pathname.match(/^\/brand\/([A-Za-z0-9][A-Za-z0-9._-]{0,80}\.svg)$/);
  if (request.method === 'GET' && brandAssetMatch?.[1]) {
    await sendBundledBrandAsset(response, options.appRoot, brandAssetMatch[1]);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/') {
    const settings = await options.webSettingsStore.load();
    sendHtml(response, 200, welcomePage(settings));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/club') {
    const settings = await options.webSettingsStore.load();
    sendHtml(response, 200, clubPage(settings));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/actividades') {
    const settings = await options.webSettingsStore.load();
    const events = await fetchPublicScheduleEvents(options.services);
    sendHtml(response, 200, activitiesPage(settings, events));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/catalogo') {
    const settings = await options.webSettingsStore.load();
    const search = url.searchParams.get('q') ?? '';
    const itemType = url.searchParams.get('type') ?? '';
    const pageNumber = parsePositiveInteger(url.searchParams.get('page'), 1);
    const catalogResult = await fetchPublicCatalogItems(options.services, { search, itemType, page: pageNumber });
    sendHtml(response, 200, catalogPage(settings, catalogResult, { search, itemType }));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/feedback') {
    sendHtml(response, 200, feedbackPage());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/alta') {
    const settings = await options.webSettingsStore.load();
    sendHtml(response, 200, memberSignupPage(settings));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/alta') {
    const form = await readForm(request);
    const validation = validateMemberSignupForm(form);
    if (!validation.ok) {
      const settings = await options.webSettingsStore.load();
      sendHtml(response, 400, memberSignupPage(settings, validation.message));
      return;
    }

    const signup = await options.memberSignupStore.create({
      ...validation.value,
      userAgent: String(request.headers['user-agent'] ?? '') || null,
      remoteAddress: request.socket.remoteAddress ?? null,
    });
    const notificationSummary = await notifyMemberSignup({
      services: options.services,
      signup,
      logger: options.logger,
      ...(options.telegramSender ? { telegramSender: options.telegramSender } : {}),
    });
    await options.memberSignupStore.updateNotificationSummary(signup.id, { ...notificationSummary });
    sendHtml(response, 200, memberSignupConfirmationPage(signup, notificationSummary));
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
    const dashboardStats = await fetchAdminDashboardStats(options.services);
    sendHtml(response, 200, adminDashboardPage(status, dashboardStats, adminSession.csrfToken));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/admin/service') {
    const status = await options.operations.readBackupConsoleStatus();
    const logs = await safeReadLogs(options.serviceControl);
    sendHtml(response, 200, adminMaintenancePage(status, logs, adminSession.csrfToken));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/admin/config') {
    const status = await options.operations.readBackupConsoleStatus();
    sendHtml(response, 200, adminConfigPage(status, adminSession.csrfToken));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/admin/backups') {
    const status = await options.operations.readBackupConsoleStatus();
    sendHtml(response, 200, adminBackupsPage(status, adminSession.csrfToken));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/admin/web') {
    const settings = await options.webSettingsStore.load();
    sendHtml(response, 200, webSettingsPage(settings, adminSession.csrfToken));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/admin/feedback') {
    const entries = await readFeedbackEntries(options.feedbackFile);
    sendHtml(response, 200, feedbackAdminPage(entries));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/admin/member-signups') {
    const signups = await fetchMemberSignupRows(options.services);
    sendHtml(response, 200, memberSignupsAdminPage(signups, adminSession.csrfToken));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/admin/news') {
    const newsSummary = await fetchNewsAdminSummary(options.services);
    sendHtml(response, 200, newsAdminPage(newsSummary));
    return;
  }

  const memberSignupStatusMatch = url.pathname.match(/^\/admin\/member-signups\/(\d+)\/status$/);
  if (request.method === 'POST' && memberSignupStatusMatch?.[1]) {
    const form = await readForm(request);
    if (!isValidCsrf(form, adminSession)) {
      sendHtml(response, 403, page('Accio rebutjada', '<p>La sessio admin no es valida. Torna a entrar.</p>'));
      return;
    }
    const nextStatus = normalizeMemberSignupStatus(form.get('status') ?? '');
    if (!nextStatus) {
      sendHtml(response, 400, page({ title: 'Estado invalido', body: '<p>El estado solicitado no es valido.</p><p><a href="/admin/member-signups">Volver</a></p>', shell: 'admin' }));
      return;
    }
    await updateMemberSignupStatus(options.services, Number(memberSignupStatusMatch[1]), nextStatus);
    redirect(response, '/admin/member-signups');
    return;
  }

  if (request.method === 'GET' && url.pathname === '/admin/users') {
    const usersOverview = await fetchAdminUsersOverview(options.services);
    sendHtml(response, 200, adminUsersPage(usersOverview));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/admin/activities') {
    const activitiesOverview = await fetchAdminActivitiesOverview(options.services);
    sendHtml(response, 200, adminActivitiesPage(activitiesOverview));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/admin/catalog') {
    const catalogOverview = await fetchAdminCatalogOverview(options.services);
    sendHtml(response, 200, adminCatalogPage(catalogOverview));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/admin/web') {
    const form = await readForm(request);
    if (!isValidCsrf(form, adminSession)) {
      sendHtml(response, 403, page('Accio rebutjada', '<p>La sessio admin no es valida. Torna a entrar.</p>'));
      return;
    }
    const currentSettings = await options.webSettingsStore.load();
    await options.webSettingsStore.save(buildWebSettingsFromForm(form, currentSettings));
    redirect(response, '/admin/web');
    return;
  }

  if (request.method === 'POST' && url.pathname === '/admin/web/assets') {
    const assetActionCompleted = await handleWebAssetAction({
      request,
      response,
      session: adminSession,
      webAssetsDir: options.webAssetsDir,
      webSettingsStore: options.webSettingsStore,
    });
    if (!assetActionCompleted) {
      return;
    }
    redirect(response, '/admin/web');
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
  if (request.method === 'GET' && resourceDeleteMatch?.[1] && resourceDeleteMatch[2]) {
    const resourceDef = requireResource(resourceDeleteMatch[1]);
    const row = await fetchResourceDetail(options.services, resourceDef, resourceDeleteMatch[2]);
    sendHtml(response, 200, resourceDeleteConfirmationPage(resourceDef, row, adminSession.csrfToken));
    return;
  }

  if (request.method === 'POST' && resourceDeleteMatch?.[1] && resourceDeleteMatch[2]) {
    const resourceDef = requireResource(resourceDeleteMatch[1]);
    const form = await readForm(request);
    if (!isValidCsrf(form, adminSession)) {
      sendHtml(response, 403, page('Accio rebutjada', '<p>La sessio admin no es valida. Torna a entrar.</p>'));
      return;
    }
    const isHardDelete = form.get('mode') === 'hard';
    if (isHardDelete && form.get('confirm') !== 'DELETE') {
      const row = await fetchResourceDetail(options.services, resourceDef, resourceDeleteMatch[2]);
      sendHtml(response, 400, resourceDeleteConfirmationPage(resourceDef, row, adminSession.csrfToken, 'Escribe DELETE para confirmar el borrado definitivo.'));
      return;
    }
    await deleteResource(options.services, resourceDef, resourceDeleteMatch[2], isHardDelete);
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
    const token = normalizeTelegramToken(form.get('token') ?? '');
    if (!token) {
      sendHtml(response, 400, page({ title: 'Token invalid', body: '<p>El token de Telegram no tiene un formato valido.</p><p><a href="/admin/config">Volver</a></p>', shell: 'admin' }));
      return;
    }
    adminSession.pendingTelegramToken = token;
    sendHtml(response, 200, tokenChangeConfirmationPage(adminSession.csrfToken));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/admin/token-confirm') {
    const form = await readForm(request);
    if (!isValidCsrf(form, adminSession)) {
      sendHtml(response, 403, page('Accio rebutjada', '<p>La sessio admin no es valida. Torna a entrar.</p>'));
      return;
    }
    if (!adminSession.pendingTelegramToken || form.get('confirm') !== 'CHANGE_TOKEN') {
      sendHtml(response, 400, tokenChangeConfirmationPage(adminSession.csrfToken, 'Escribe CHANGE_TOKEN para confirmar el cambio.'));
      return;
    }
    await updateTelegramToken(adminSession.pendingTelegramToken);
    delete adminSession.pendingTelegramToken;
    redirect(response, '/admin/config');
    return;
  }

  if (request.method === 'GET' && url.pathname === '/admin/service/confirm') {
    const action = url.searchParams.get('action') ?? '';
    if (action !== 'stop') {
      sendHtml(response, 404, page('No trobat', '<p>Pagina no trobada.</p>'));
      return;
    }
    sendHtml(response, 200, serviceStopConfirmationPage(adminSession.csrfToken));
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
    if (action === 'stop') {
      if (form.get('confirm') !== 'STOP') {
        sendHtml(response, 400, serviceStopConfirmationPage(adminSession.csrfToken, 'Escribe STOP para confirmar la parada del servicio.'));
        return;
      }
      await options.serviceControl.stopService();
    }
    if (action === 'restart') await options.serviceControl.restartService();
    redirect(response, '/admin/service');
    return;
  }

  if (request.method === 'POST' && url.pathname === '/admin/backup') {
    const form = await readForm(request);
    if (!isValidCsrf(form, adminSession)) {
      sendHtml(response, 403, page('Accio rebutjada', '<p>La sessio admin no es valida. Torna a entrar.</p>'));
      return;
    }
    await options.operations.createFullBackup();
    redirect(response, '/admin/backups');
    return;
  }

  if (request.method === 'GET' && url.pathname === '/admin/restore') {
    const backupFilePath = url.searchParams.get('backupFilePath') ?? '';
    const archive = await findBackupArchive(options.operations, backupFilePath);
    if (!archive) {
      sendHtml(response, 400, page('Backup invalid', '<p>El backup seleccionat no es valid.</p>'));
      return;
    }
    sendHtml(response, 200, backupConfirmationPage('restore', archive, adminSession.csrfToken));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/admin/restore') {
    const form = await readForm(request);
    if (!isValidCsrf(form, adminSession)) {
      sendHtml(response, 403, page('Accio rebutjada', '<p>La sessio admin no es valida. Torna a entrar.</p>'));
      return;
    }
    const backupFilePath = form.get('backupFilePath') ?? '';
    const archive = await findBackupArchive(options.operations, backupFilePath);
    if (!archive) {
      sendHtml(response, 400, page('Backup invalid', '<p>El backup seleccionat no es valid.</p>'));
      return;
    }
    if (form.get('confirm') !== 'RESTORE') {
      sendHtml(response, 400, backupConfirmationPage('restore', archive, adminSession.csrfToken, 'Escribe RESTORE para confirmar la restauracion.'));
      return;
    }
    await options.operations.restoreFullBackup({ backupFilePath });
    redirect(response, '/admin/backups');
    return;
  }

  if (request.method === 'GET' && url.pathname === '/admin/delete-backup') {
    const backupFilePath = url.searchParams.get('backupFilePath') ?? '';
    const archive = await findBackupArchive(options.operations, backupFilePath);
    if (!archive) {
      sendHtml(response, 400, page('Backup invalid', '<p>El backup seleccionat no es valid.</p>'));
      return;
    }
    sendHtml(response, 200, backupConfirmationPage('delete', archive, adminSession.csrfToken));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/admin/delete-backup') {
    const form = await readForm(request);
    if (!isValidCsrf(form, adminSession)) {
      sendHtml(response, 403, page('Accio rebutjada', '<p>La sessio admin no es valida. Torna a entrar.</p>'));
      return;
    }
    const backupFilePath = form.get('backupFilePath') ?? '';
    const archive = await findBackupArchive(options.operations, backupFilePath);
    if (!archive) {
      sendHtml(response, 400, page('Backup invalid', '<p>El backup seleccionat no es valid.</p>'));
      return;
    }
    if (form.get('confirm') !== 'DELETE') {
      sendHtml(response, 400, backupConfirmationPage('delete', archive, adminSession.csrfToken, 'Escribe DELETE para confirmar la eliminacion.'));
      return;
    }
    await deleteBackupArchive(backupFilePath);
    redirect(response, '/admin/backups');
    return;
  }

  sendHtml(response, 404, page('No trobat', '<p>Pagina no trobada.</p>'));
}

async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
  const body = await readRequestBody(request, maxBodyBytes);
  return new URLSearchParams(body.toString('utf8'));
}

async function readRequestBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new Error('Request body too large');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

interface MultipartFile {
  filename: string;
  contentType: string;
  content: Buffer;
}

interface MultipartForm {
  fields: URLSearchParams;
  files: Map<string, MultipartFile>;
}

async function readMultipartForm(request: IncomingMessage): Promise<MultipartForm> {
  const contentType = String(request.headers['content-type'] ?? '');
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1] ?? contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
  if (!boundary) {
    throw new Error('Multipart boundary missing');
  }

  return parseMultipartForm(await readRequestBody(request, maxAssetUploadBytes), boundary);
}

function parseMultipartForm(body: Buffer, boundary: string): MultipartForm {
  const fields = new URLSearchParams();
  const files = new Map<string, MultipartFile>();
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  let cursor = body.indexOf(boundaryBuffer);

  while (cursor !== -1) {
    let partStart = cursor + boundaryBuffer.length;
    if (body[partStart] === 45 && body[partStart + 1] === 45) {
      break;
    }
    if (body[partStart] === 13 && body[partStart + 1] === 10) {
      partStart += 2;
    }
    const nextBoundary = body.indexOf(boundaryBuffer, partStart);
    if (nextBoundary === -1) {
      break;
    }

    let part = body.subarray(partStart, nextBoundary);
    if (part.length >= 2 && part[part.length - 2] === 13 && part[part.length - 1] === 10) {
      part = part.subarray(0, part.length - 2);
    }

    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd !== -1) {
      const header = part.subarray(0, headerEnd).toString('utf8');
      const content = part.subarray(headerEnd + 4);
      const disposition = header.match(/^content-disposition:\s*([^\r\n]+)/im)?.[1] ?? '';
      const name = disposition.match(/name="([^"]+)"/)?.[1];
      const filename = disposition.match(/filename="([^"]*)"/)?.[1];
      const partContentType = header.match(/^content-type:\s*([^\r\n]+)/im)?.[1]?.trim() ?? 'application/octet-stream';

      if (name && filename !== undefined) {
        files.set(name, { filename, contentType: partContentType, content });
      } else if (name) {
        fields.append(name, content.toString('utf8'));
      }
    }

    cursor = nextBoundary;
  }

  return { fields, files };
}

async function saveFeedback(filePath: string, input: Record<string, unknown>): Promise<void> {
  const message = String(input.message ?? '').trim();
  if (message.length < 3) {
    throw new Error('Feedback message is required');
  }
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify({ ...input, message })}\n`, 'utf8');
}

interface FeedbackEntry {
  createdAt: string;
  topic: string;
  name: string;
  contact: string;
  message: string;
  userAgent: string;
  remoteAddress: string;
}

async function readFeedbackEntries(filePath: string): Promise<FeedbackEntry[]> {
  const raw = await readFile(filePath, 'utf8').catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }
    throw error;
  });

  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => parseFeedbackEntry(line))
    .filter((entry): entry is FeedbackEntry => entry !== null)
    .slice(-200)
    .reverse();
}

function parseFeedbackEntry(line: string): FeedbackEntry | null {
  try {
    const parsed = JSON.parse(line) as Partial<FeedbackEntry>;
    return {
      createdAt: String(parsed.createdAt ?? ''),
      topic: String(parsed.topic ?? ''),
      name: String(parsed.name ?? ''),
      contact: String(parsed.contact ?? ''),
      message: String(parsed.message ?? ''),
      userAgent: String(parsed.userAgent ?? ''),
      remoteAddress: String(parsed.remoteAddress ?? ''),
    };
  } catch {
    return null;
  }
}

interface ValidMemberSignupForm {
  fullName: string;
  telegramAlias: string | null;
  contact: string;
  message: string | null;
  acceptedTerms: boolean;
}

function validateMemberSignupForm(form: URLSearchParams): { ok: true; value: ValidMemberSignupForm } | { ok: false; message: string } {
  const fullName = normalizeFormText(form.get('fullName'), 255);
  const telegramAlias = normalizeTelegramAlias(form.get('telegramAlias'));
  const contact = normalizeFormText(form.get('contact'), 255);
  const message = normalizeFormText(form.get('message'), 2000);
  const acceptedTerms = form.get('acceptedTerms') === 'yes';

  if (fullName.length < 2) {
    return { ok: false, message: 'Indica tu nombre para poder gestionar la solicitud.' };
  }
  if (contact.length < 3) {
    return { ok: false, message: 'Indica una forma de contacto.' };
  }
  if (!acceptedTerms) {
    return { ok: false, message: 'Debes aceptar que el club contacte contigo para gestionar la solicitud.' };
  }

  return {
    ok: true,
    value: {
      fullName,
      telegramAlias,
      contact,
      message: message.length > 0 ? message : null,
      acceptedTerms,
    },
  };
}

function normalizeFormText(value: string | null, maxLength: number): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function normalizeTelegramAlias(value: string | null): string | null {
  const normalized = normalizeFormText(value, 128).replace(/^@+/, '');
  if (!normalized) {
    return null;
  }

  return normalized.replace(/^https?:\/\/t\.me\//i, '').replace(/[^\w]/g, '').slice(0, 64);
}

interface MemberSignupNotificationSummary {
  privateSent: number;
  privateFailed: number;
  groupSent: number;
  groupFailed: number;
}

async function notifyMemberSignup({
  services,
  telegramSender,
  signup,
  logger,
}: {
  services: InfrastructureRuntimeServices;
  telegramSender?: HttpTelegramSender;
  signup: MemberSignupRecord;
  logger: CreateAdminHttpServerOptions['logger'];
}): Promise<MemberSignupNotificationSummary> {
  const summary: MemberSignupNotificationSummary = {
    privateSent: 0,
    privateFailed: 0,
    groupSent: 0,
    groupFailed: 0,
  };

  if (!telegramSender) {
    return summary;
  }

  const message = formatMemberSignupNotification(signup);
  for (const telegramUserId of await fetchApprovedAdminTelegramUserIds(services)) {
    try {
      await telegramSender.sendPrivateMessage(telegramUserId, message);
      summary.privateSent += 1;
    } catch (error) {
      summary.privateFailed += 1;
      logger.error({ telegramUserId, error: error instanceof Error ? error.message : String(error) }, 'Failed to notify admin of web member signup');
    }
  }

  if (telegramSender.sendGroupMessage) {
    for (const chatId of await fetchSubscribedNewsGroupChatIds(services, newMembersNewsGroupCategory)) {
      try {
        await telegramSender.sendGroupMessage(chatId, message);
        summary.groupSent += 1;
      } catch (error) {
        summary.groupFailed += 1;
        logger.error({ chatId, error: error instanceof Error ? error.message : String(error) }, 'Failed to notify news group of web member signup');
      }
    }
  }

  return summary;
}

async function fetchApprovedAdminTelegramUserIds(services: InfrastructureRuntimeServices): Promise<number[]> {
  const result = await services.database.pool.query<{ telegram_user_id: number }>(
    `
      select telegram_user_id
      from users
      where status = 'approved' and is_admin = true
      order by telegram_user_id asc
    `,
  );

  return result.rows.map((row) => Number(row.telegram_user_id)).filter((telegramUserId) => Number.isFinite(telegramUserId));
}

async function fetchSubscribedNewsGroupChatIds(
  services: InfrastructureRuntimeServices,
  categoryKey: string,
): Promise<number[]> {
  const result = await services.database.pool.query<{ chat_id: number }>(
    `
      select groups.chat_id
      from news_group_subscriptions subscriptions
      inner join news_groups groups on groups.chat_id = subscriptions.chat_id
      where subscriptions.category_key = $1 and groups.is_enabled = true
      order by groups.chat_id asc
    `,
    [categoryKey],
  );

  return result.rows.map((row) => Number(row.chat_id)).filter((chatId) => Number.isFinite(chatId));
}

function formatMemberSignupNotification(signup: MemberSignupRecord): string {
  return [
    'Nueva solicitud de alta como socio',
    '',
    `Nombre: ${signup.fullName}`,
    signup.telegramAlias ? `Telegram: @${signup.telegramAlias.replace(/^@/, '')}` : null,
    `Contacto: ${signup.contact}`,
    signup.message ? `Mensaje: ${signup.message}` : null,
    `Origen: formulario web`,
    `Fecha: ${formatDateTime(signup.createdAt)}`,
    `Revision: /admin/member-signups`,
  ].filter((line): line is string => line !== null).join('\n');
}

async function handleWebAssetAction({
  request,
  response,
  session,
  webAssetsDir,
  webSettingsStore,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  session: Session;
  webAssetsDir: string;
  webSettingsStore: WebSettingsStore;
}): Promise<boolean> {
  const contentType = String(request.headers['content-type'] ?? '');
  const isMultipart = contentType.toLowerCase().startsWith('multipart/form-data');
  const multipart = isMultipart ? await readMultipartForm(request) : null;
  const fields = multipart?.fields ?? await readForm(request);
  const files = multipart?.files ?? new Map<string, MultipartFile>();

  if (!isValidCsrf(fields, session)) {
    sendHtml(response, 403, page('Accio rebutjada', '<p>La sessio admin no es valida. Torna a entrar.</p>'));
    return false;
  }

  const target = parseWebAssetTarget(fields.get('target') ?? '');
  if (!target) {
    sendHtml(response, 400, page('Asset invalid', '<p>El destino de la imagen no es valido.</p>'));
    return false;
  }

  const settings = await webSettingsStore.load();
  if ((fields.get('action') ?? '') === 'clear') {
    await webSettingsStore.save(updateWebSettingsAsset(settings, target, null));
    return true;
  }

  if (!isMultipart) {
    sendHtml(response, 400, page('Asset invalid', '<p>La subida debe enviarse como multipart/form-data.</p>'));
    return false;
  }

  const file = files.get('asset');
  if (!file || file.content.length === 0) {
    sendHtml(response, 400, page('Asset invalid', '<p>Selecciona una imagen para subir.</p>'));
    return false;
  }

  let assetPath: string;
  try {
    assetPath = await saveWebAsset(webAssetsDir, target, file);
  } catch {
    sendHtml(response, 400, page('Asset invalid', '<p>La imagen debe ser PNG, JPG, WEBP o GIF y no puede superar 2 MiB.</p>'));
    return false;
  }
  await webSettingsStore.save(updateWebSettingsAsset(settings, target, assetPath));
  return true;
}

type WebAssetTarget = 'logo' | 'hero' | `gallery${1 | 2 | 3}`;

function parseWebAssetTarget(value: string): WebAssetTarget | null {
  return value === 'logo' || value === 'hero' || value === 'gallery1' || value === 'gallery2' || value === 'gallery3'
    ? value
    : null;
}

async function saveWebAsset(webAssetsDir: string, target: WebAssetTarget, file: MultipartFile): Promise<string> {
  const allowedExtensionsByMime: Record<string, string[]> = {
    'image/png': ['.png'],
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/webp': ['.webp'],
    'image/gif': ['.gif'],
  };
  const normalizedMime = file.contentType.toLowerCase();
  const allowedExtensions = allowedExtensionsByMime[normalizedMime];
  const originalExtension = extname(file.filename).toLowerCase();
  if (!allowedExtensions || !allowedExtensions.includes(originalExtension)) {
    throw new Error('Unsupported web asset type');
  }
  if (file.content.length === 0 || file.content.length > maxAssetUploadBytes) {
    throw new Error('Invalid web asset size');
  }

  const extension = originalExtension === '.jpeg' ? '.jpg' : originalExtension;
  const fileName = `${target}-${Date.now()}-${randomBytes(6).toString('hex')}${extension}`;
  const filePath = resolve(webAssetsDir, fileName);
  if (!filePath.startsWith(`${webAssetsDir}/`)) {
    throw new Error('Invalid web asset path');
  }

  await mkdir(webAssetsDir, { recursive: true });
  await writeFile(filePath, file.content);
  return `/assets/${fileName}`;
}

function updateWebSettingsAsset(settings: WebSettings, target: WebAssetTarget, assetPath: string | null): WebSettings {
  if (target === 'logo') {
    return { ...settings, home: { ...settings.home, logoAsset: assetPath } };
  }
  if (target === 'hero') {
    return { ...settings, home: { ...settings.home, heroAsset: assetPath } };
  }

  const galleryAssets = [...settings.home.galleryAssets];
  const index = Number(target.replace('gallery', '')) - 1;
  if (assetPath) {
    galleryAssets[index] = assetPath;
  } else {
    galleryAssets.splice(index, 1);
  }

  return {
    ...settings,
    home: {
      ...settings.home,
      galleryAssets: galleryAssets.filter((item) => item && item.trim().length > 0),
    },
  };
}

async function sendWebAsset(response: ServerResponse, webAssetsDir: string, fileName: string): Promise<void> {
  const filePath = resolve(webAssetsDir, fileName);
  if (!filePath.startsWith(`${webAssetsDir}/`)) {
    sendHtml(response, 404, page('No trobat', '<p>Asset no trobat.</p>'));
    return;
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': webAssetContentType(fileName),
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    response.end(content);
  } catch {
    sendHtml(response, 404, page('No trobat', '<p>Asset no trobat.</p>'));
  }
}

async function sendBundledBrandAsset(response: ServerResponse, appRoot: string, fileName: string): Promise<void> {
  if (!bundledBrandAssetNames.has(fileName)) {
    sendHtml(response, 404, page('No trobat', '<p>Asset no trobat.</p>'));
    return;
  }
  try {
    const content = await readFile(resolve(appRoot, fileName)).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      return readFile(resolve(process.cwd(), fileName));
    });
    response.writeHead(200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    response.end(content);
  } catch {
    sendHtml(response, 404, page('No trobat', '<p>Asset no trobat.</p>'));
  }
}

function webAssetContentType(fileName: string): string {
  const extension = extname(fileName).toLowerCase();
  if (extension === '.png') {
    return 'image/png';
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg';
  }
  if (extension === '.webp') {
    return 'image/webp';
  }
  if (extension === '.gif') {
    return 'image/gif';
  }
  return 'application/octet-stream';
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

function parsePositiveInteger(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

interface PublicScheduleEventRow {
  id: number;
  title: string;
  description: string | null;
  starts_at: Date | string;
  duration_minutes: number;
  capacity: number;
  initial_occupied_seats: number;
  attendance_mode: string;
  table_name: string | null;
  table_description: string | null;
  table_recommended_capacity: number | null;
  catalog_item_id: number | null;
  catalog_item_name: string | null;
  catalog_item_type: string | null;
  catalog_item_publisher: string | null;
  catalog_item_publication_year: number | null;
  catalog_item_player_count_min: number | null;
  catalog_item_player_count_max: number | null;
  catalog_item_recommended_age: number | null;
  catalog_item_play_time_minutes: number | null;
  organizer_name: string | null;
  confirmed_attendees: number;
  attendee_names: string[];
}

interface PublicCatalogItemRow {
  id: number;
  display_name: string;
  item_type: string;
  family_name: string | null;
  group_name: string | null;
  publisher: string | null;
  publication_year: number | null;
  player_count_min: number | null;
  player_count_max: number | null;
  recommended_age: number | null;
  play_time_minutes: number | null;
}

interface PublicCatalogPage {
  items: PublicCatalogItemRow[];
  totalItems: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface AdminDashboardStats {
  approvedUsers: number;
  pendingUsers: number;
  adminUsers: number;
  futureActivities: number;
  activeCatalogItems: number;
  activeLoans: number;
  overdueLoans: number;
  pendingMemberSignups: number;
}

interface AdminMemberSignupRow {
  id: number;
  full_name: string;
  telegram_alias: string | null;
  contact: string;
  message: string | null;
  status: string;
  notification_summary: Record<string, unknown> | null;
  created_at: Date | string;
}

interface AdminUserRow {
  telegram_user_id: number;
  display_name: string;
  username: string | null;
  status: string;
  is_admin: boolean;
  is_approved: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

interface AdminUsersOverview {
  counts: {
    total: number;
    approved: number;
    pending: number;
    admins: number;
    blocked: number;
    revoked: number;
  };
  recentUsers: AdminUserRow[];
}

interface AdminActivitiesOverview {
  counts: {
    future: number;
    scheduledTotal: number;
    cancelledTotal: number;
  };
  upcomingEvents: PublicScheduleEventRow[];
}

interface AdminCatalogTypeCount {
  item_type: string;
  count: number | string;
}

interface AdminCatalogOverview {
  counts: {
    active: number;
    inactive: number;
    loaned: number;
  };
  typeCounts: AdminCatalogTypeCount[];
  sampleItems: PublicCatalogItemRow[];
}

interface NewsAdminCategorySummary {
  key: string;
  label: string;
  description: string;
  defaultSubscribed: boolean;
  subscribedGroups: number;
}

interface NewsAdminSummary {
  enabledGroups: number;
  totalGroups: number;
  categories: NewsAdminCategorySummary[];
}

async function fetchAdminDashboardStats(services: InfrastructureRuntimeServices): Promise<AdminDashboardStats> {
  const [
    approvedUsers,
    pendingUsers,
    adminUsers,
    futureActivities,
    activeCatalogItems,
    activeLoans,
    overdueLoans,
    pendingMemberSignups,
  ] = await Promise.all([
    safeCount(services, "select count(*)::int as count from users where status = 'approved'"),
    safeCount(services, "select count(*)::int as count from users where status = 'pending'"),
    safeCount(services, "select count(*)::int as count from users where status = 'approved' and is_admin = true"),
    safeCount(services, "select count(*)::int as count from schedule_events where lifecycle_status = 'scheduled' and starts_at >= now()"),
    safeCount(services, "select count(*)::int as count from catalog_items where lifecycle_status = 'active'"),
    safeCount(services, 'select count(*)::int as count from catalog_loans where returned_at is null'),
    safeCount(services, 'select count(*)::int as count from catalog_loans where returned_at is null and due_at < now()'),
    safeCount(services, "select count(*)::int as count from member_signup_requests where status = 'pending'"),
  ]);

  return {
    approvedUsers,
    pendingUsers,
    adminUsers,
    futureActivities,
    activeCatalogItems,
    activeLoans,
    overdueLoans,
    pendingMemberSignups,
  };
}

async function safeCount(services: InfrastructureRuntimeServices, sql: string): Promise<number> {
  try {
    const result = await services.database.pool.query<{ count: number | string }>(sql);
    const count = Number(result.rows[0]?.count ?? 0);
    return Number.isFinite(count) ? count : 0;
  } catch {
    return 0;
  }
}

async function fetchMemberSignupRows(services: InfrastructureRuntimeServices): Promise<AdminMemberSignupRow[]> {
  try {
    const result = await services.database.pool.query<AdminMemberSignupRow>(
      `
        select id, full_name, telegram_alias, contact, message, status, notification_summary, created_at
        from member_signup_requests
        order by
          case when status = 'pending' then 0 else 1 end,
          created_at desc
        limit 200
      `,
    );
    return result.rows;
  } catch {
    return [];
  }
}

function normalizeMemberSignupStatus(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return ['pending', 'contacted', 'approved', 'rejected'].includes(normalized) ? normalized : null;
}

async function updateMemberSignupStatus(
  services: InfrastructureRuntimeServices,
  signupId: number,
  status: string,
): Promise<void> {
  if (!Number.isInteger(signupId) || signupId <= 0) {
    throw new Error('Invalid member signup id');
  }
  await services.database.pool.query(
    `
      update member_signup_requests
      set status = $1,
          resolved_at = case when $1 = 'pending' then null else now() end,
          updated_at = now()
      where id = $2
    `,
    [status, signupId],
  );
}

async function fetchNewsAdminSummary(services: InfrastructureRuntimeServices): Promise<NewsAdminSummary> {
  const [enabledGroups, totalGroups] = await Promise.all([
    safeCount(services, 'select count(*)::int as count from news_groups where is_enabled = true'),
    safeCount(services, 'select count(*)::int as count from news_groups'),
  ]);
  const categories = await Promise.all(listNewsGroupCategories().map(async (category) => ({
    key: category.key,
    label: category.label.es,
    description: category.description.es,
    defaultSubscribed: category.defaultSubscribed,
    subscribedGroups: await safeCount(services, `
      select count(*)::int as count
      from news_group_subscriptions subscriptions
      inner join news_groups groups on groups.chat_id = subscriptions.chat_id
      where subscriptions.category_key = '${category.key.replaceAll("'", "''")}' and groups.is_enabled = true
    `),
  })));

  return {
    enabledGroups,
    totalGroups,
    categories,
  };
}

async function fetchAdminUsersOverview(services: InfrastructureRuntimeServices): Promise<AdminUsersOverview> {
  const [total, approved, pending, admins, blocked, revoked, recentUsers] = await Promise.all([
    safeCount(services, 'select count(*)::int as count from users'),
    safeCount(services, "select count(*)::int as count from users where status = 'approved'"),
    safeCount(services, "select count(*)::int as count from users where status = 'pending'"),
    safeCount(services, "select count(*)::int as count from users where status = 'approved' and is_admin = true"),
    safeCount(services, "select count(*)::int as count from users where status = 'blocked'"),
    safeCount(services, "select count(*)::int as count from users where status = 'revoked'"),
    fetchRecentAdminUsers(services),
  ]);

  return {
    counts: { total, approved, pending, admins, blocked, revoked },
    recentUsers,
  };
}

async function fetchRecentAdminUsers(services: InfrastructureRuntimeServices): Promise<AdminUserRow[]> {
  try {
    const result = await services.database.pool.query<AdminUserRow>(
      `
        select telegram_user_id, display_name, username, status, is_admin, is_approved, created_at, updated_at
        from users
        order by updated_at desc
        limit 50
      `,
    );
    return result.rows;
  } catch {
    return [];
  }
}

async function fetchAdminActivitiesOverview(services: InfrastructureRuntimeServices): Promise<AdminActivitiesOverview> {
  const [future, scheduledTotal, cancelledTotal, upcomingEvents] = await Promise.all([
    safeCount(services, "select count(*)::int as count from schedule_events where lifecycle_status = 'scheduled' and starts_at >= now()"),
    safeCount(services, "select count(*)::int as count from schedule_events where lifecycle_status = 'scheduled'"),
    safeCount(services, "select count(*)::int as count from schedule_events where lifecycle_status = 'cancelled'"),
    fetchPublicScheduleEvents(services),
  ]);

  return {
    counts: { future, scheduledTotal, cancelledTotal },
    upcomingEvents,
  };
}

async function fetchAdminCatalogOverview(services: InfrastructureRuntimeServices): Promise<AdminCatalogOverview> {
  const [active, inactive, loaned, typeCounts, catalogPage] = await Promise.all([
    safeCount(services, "select count(*)::int as count from catalog_items where lifecycle_status = 'active'"),
    safeCount(services, "select count(*)::int as count from catalog_items where lifecycle_status <> 'active'"),
    safeCount(services, 'select count(*)::int as count from catalog_loans where returned_at is null'),
    fetchAdminCatalogTypeCounts(services),
    fetchPublicCatalogItems(services, { search: '', itemType: '', page: 1 }),
  ]);

  return {
    counts: { active, inactive, loaned },
    typeCounts,
    sampleItems: catalogPage.items,
  };
}

async function fetchAdminCatalogTypeCounts(services: InfrastructureRuntimeServices): Promise<AdminCatalogTypeCount[]> {
  try {
    const result = await services.database.pool.query<AdminCatalogTypeCount>(
      `
        select item_type, count(*)::int as count
        from catalog_items
        where lifecycle_status = 'active'
        group by item_type
        order by item_type asc
      `,
    );
    return result.rows;
  } catch {
    return [];
  }
}

async function fetchPublicScheduleEvents(
  services: InfrastructureRuntimeServices,
): Promise<PublicScheduleEventRow[]> {
  const result = await services.database.pool.query<PublicScheduleEventRow>(
    `
      select
        events.id,
        events.title,
        events.description,
        events.starts_at,
        events.duration_minutes,
        events.capacity,
        events.initial_occupied_seats,
        events.attendance_mode,
        tables.display_name as table_name,
        tables.description as table_description,
        tables.recommended_capacity as table_recommended_capacity,
        catalog_items.id as catalog_item_id,
        catalog_items.display_name as catalog_item_name,
        catalog_items.item_type as catalog_item_type,
        catalog_items.publisher as catalog_item_publisher,
        catalog_items.publication_year as catalog_item_publication_year,
        catalog_items.player_count_min as catalog_item_player_count_min,
        catalog_items.player_count_max as catalog_item_player_count_max,
        catalog_items.recommended_age as catalog_item_recommended_age,
        catalog_items.play_time_minutes as catalog_item_play_time_minutes,
        organizers.display_name as organizer_name,
        coalesce(count(participants.participant_telegram_user_id) filter (where participants.status = 'active'), 0)::int as confirmed_attendees,
        coalesce(
          array_remove(array_agg(participant_users.display_name order by participant_users.display_name) filter (where participants.status = 'active'), null),
          '{}'
        ) as attendee_names
      from schedule_events events
      left join club_tables tables on tables.id = events.table_id
      left join catalog_items on catalog_items.id = events.catalog_item_id
      left join users organizers on organizers.telegram_user_id = events.organizer_telegram_user_id
      left join schedule_event_participants participants on participants.schedule_event_id = events.id
      left join users participant_users on participant_users.telegram_user_id = participants.participant_telegram_user_id
      where events.lifecycle_status = 'scheduled' and events.starts_at >= now()
      group by
        events.id,
        events.title,
        events.description,
        events.starts_at,
        events.duration_minutes,
        events.capacity,
        events.initial_occupied_seats,
        events.attendance_mode,
        tables.display_name,
        tables.description,
        tables.recommended_capacity,
        catalog_items.id,
        catalog_items.display_name,
        catalog_items.item_type,
        catalog_items.publisher,
        catalog_items.publication_year,
        catalog_items.player_count_min,
        catalog_items.player_count_max,
        catalog_items.recommended_age,
        catalog_items.play_time_minutes,
        organizers.display_name
      order by events.starts_at asc
      limit 50
    `,
  );

  return result.rows;
}

async function fetchPublicCatalogItems(
  services: InfrastructureRuntimeServices,
  {
    search,
    itemType,
    page,
  }: {
    search: string;
    itemType: string;
    page: number;
  },
): Promise<PublicCatalogPage> {
  const filters = ["items.lifecycle_status = 'active'"];
  const params: unknown[] = [];
  const normalizedSearch = search.trim();
  const normalizedType = itemType.trim();
  const normalizedPage = Math.max(1, page);

  if (normalizedSearch) {
    params.push(`%${normalizedSearch.toLowerCase()}%`);
    filters.push(`lower(items.display_name) like $${params.length}`);
  }

  if (normalizedType && ['board-game', 'book', 'rpg-book', 'expansion', 'accessory'].includes(normalizedType)) {
    params.push(normalizedType);
    filters.push(`items.item_type = $${params.length}`);
  }

  const countResult = await services.database.pool.query<{ count: number | string }>(
    `
      select count(*)::int as count
      from catalog_items items
      where ${filters.join(' and ')}
    `,
    params,
  );
  const totalItems = Number(countResult.rows[0]?.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalItems / publicCatalogPageSize));
  const resolvedPage = Math.min(normalizedPage, totalPages);
  const itemParams = [...params, publicCatalogPageSize, (resolvedPage - 1) * publicCatalogPageSize];
  const result = await services.database.pool.query<PublicCatalogItemRow>(
    `
      select
        items.id,
        items.display_name,
        items.item_type,
        families.display_name as family_name,
        groups.display_name as group_name,
        items.publisher,
        items.publication_year,
        items.player_count_min,
        items.player_count_max,
        items.recommended_age,
        items.play_time_minutes
      from catalog_items items
      left join catalog_families families on families.id = items.family_id
      left join catalog_groups groups on groups.id = items.group_id
      where ${filters.join(' and ')}
      order by items.display_name asc
      limit $${itemParams.length - 1}
      offset $${itemParams.length}
    `,
    itemParams,
  );

  return {
    items: result.rows,
    totalItems,
    page: resolvedPage,
    pageSize: publicCatalogPageSize,
    totalPages,
  };
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
  const trimmed = normalizeTelegramToken(token);
  if (!trimmed) {
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

function normalizeTelegramToken(token: string): string | null {
  const trimmed = token.trim();
  return /^\d+:[A-Za-z0-9_-]{20,}$/.test(trimmed) ? trimmed : null;
}

async function findBackupArchive(operations: BackupOperations, backupFilePath: string): Promise<BackupArchive | null> {
  const archives = await operations.listBackupArchives();
  return archives.find((archive) => archive.filePath === backupFilePath) ?? null;
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

function page(titleOrOptions: string | RenderHttpPageOptions, body = ''): string {
  if (typeof titleOrOptions === 'string') {
    return renderHttpPage({ title: titleOrOptions, body });
  }

  return renderHttpPage(titleOrOptions);
}

function feedbackPage(): string {
  return page({ title: 'Feedback', body: '<form method="post"><label>Sobre que es?<select name="topic"><option value="bot">Bot</option><option value="club">Club</option><option value="both">Bot i club</option></select></label><label>Nom opcional<input name="name" autocomplete="name"></label><label>Contacte opcional<input name="contact" autocomplete="email"></label><label>Feedback<textarea name="message" required maxlength="4000"></textarea></label><button type="submit">Enviar feedback</button></form>' });
}

function memberSignupPage(settings: WebSettings, error = ''): string {
  const errorHtml = error ? `<p role="alert">${escapeHtml(error)}</p>` : '';
  return page({
    title: 'Alta como socio',
    themeName: settings.theme,
    headerBrandName: settings.brand.name,
    headerLogoAsset: settings.home.logoAsset,
    body: `${errorHtml}<form method="post" action="/alta"><label>Nombre y apellidos<input name="fullName" autocomplete="name" maxlength="255" required></label><label>Alias o usuario de Telegram opcional<input name="telegramAlias" maxlength="128" placeholder="@usuario"></label><label>Contacto<input name="contact" autocomplete="email" maxlength="255" required></label><label>Motivo o mensaje<textarea name="message" maxlength="2000"></textarea></label><label><input class="inline" type="checkbox" name="acceptedTerms" value="yes" required> Acepto que el club contacte conmigo para gestionar esta solicitud.</label><button type="submit">Enviar solicitud</button></form>`,
  });
}

function memberSignupConfirmationPage(
  signup: MemberSignupRecord,
  summary: MemberSignupNotificationSummary,
): string {
  return page({
    title: 'Solicitud recibida',
    body: `<p>Gracias, ${escapeHtml(signup.fullName)}. Hemos registrado tu solicitud de alta como socio.</p><p>Un administrador la revisara y contactara contigo.</p><p><small>Avisos enviados: ${summary.privateSent} privados y ${summary.groupSent} grupos. Fallos registrados: ${summary.privateFailed + summary.groupFailed}.</small></p><p><a href="/">Volver a la portada</a></p>`,
  });
}

function loginPage(error = ''): string {
  const errorHtml = error ? `<p>${escapeHtml(error)}</p>` : '';
  return page({ title: 'Admin', body: `${errorHtml}<form method="post"><label>Contrasenya admin<input name="password" type="password" required autocomplete="current-password"></label><button type="submit">Entrar</button></form>`, shell: 'admin' });
}

function welcomePage(settings: WebSettings): string {
  const hero = settings.home.heroAsset
    ? `<img class="hero-image" src="${escapeHtml(settings.home.heroAsset)}" alt="${escapeHtml(settings.brand.name)}" loading="lazy">`
    : `<div class="brand-hero-mark" aria-hidden="true"><span>Portal del club</span><img src="/brand/cawa_casco.svg" width="168" height="168" alt="" loading="eager"></div>`;
  const safeFeaturedLinks = settings.home.featuredLinks.filter((link) => link.label.trim().length > 0 && isSafePublicHref(link.url));
  const featuredLinks = safeFeaturedLinks.length > 0
    ? `<div class="featured-links">${safeFeaturedLinks.map((link) => `<a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a>`).join('')}</div>`
    : '';
  const gallery = settings.home.galleryAssets.length > 0
    ? `<div class="gallery">${settings.home.galleryAssets.map((asset) => `<img src="${escapeHtml(asset)}" alt="" loading="lazy">`).join('')}</div>`
    : '';

  return page({
    title: settings.brand.name,
    themeName: settings.theme,
    headerBrandName: settings.brand.name,
    headerLogoAsset: settings.home.logoAsset,
    body: `<div class="home-lede"><div><p><strong>${escapeHtml(settings.brand.headline)}</strong></p><p>${escapeHtml(settings.home.intro)}</p></div>${hero}</div>${featuredLinks}${gallery}`,
  });
}

function clubPage(settings: WebSettings): string {
  const detailRows: Array<[string, string]> = [
    ['Direccion', settings.clubInfo.address],
    ['Horarios', settings.clubInfo.openingHours],
    ['Contacto', settings.clubInfo.contact],
    ['Normas basicas', settings.clubInfo.rules],
  ];
  const details = detailRows
    .filter(([, value]) => value.trim().length > 0)
    .map(([label, value]) => `<section><h2>${escapeHtml(label)}</h2><p>${escapeHtml(value)}</p></section>`)
    .join('');

  return page({
    title: 'Informacion del club',
    themeName: settings.theme,
    headerBrandName: settings.brand.name,
    headerLogoAsset: settings.home.logoAsset,
    body: `<p>${escapeHtml(settings.clubInfo.summary)}</p>${details}`,
  });
}

function activitiesPage(settings: WebSettings, events: PublicScheduleEventRow[]): string {
  const body = events.length === 0
    ? '<p>No hay actividades futuras publicadas ahora mismo.</p>'
    : renderActivityDayGroups(events);

  return page({
    title: 'Actividades',
    themeName: settings.theme,
    headerBrandName: settings.brand.name,
    headerLogoAsset: settings.home.logoAsset,
    body,
  });
}

function renderActivityDayGroups(events: PublicScheduleEventRow[]): string {
  const sortedEvents = [...events].sort((left, right) => getTimestamp(left.starts_at) - getTimestamp(right.starts_at));
  const dayGroups = new Map<string, PublicScheduleEventRow[]>();

  for (const event of sortedEvents) {
    const key = formatActivityDayKey(event.starts_at);
    dayGroups.set(key, [...(dayGroups.get(key) ?? []), event]);
  }

  return `<div class="activity-days">${Array.from(dayGroups.entries()).map(([dayKey, dayEvents]) => `<section class="activity-day"><h2>${escapeHtml(formatActivityDayHeading(dayEvents[0]?.starts_at ?? dayKey))}</h2><div class="activity-grid">${dayEvents.map(renderActivityCard).join('')}</div></section>`).join('')}</div>`;
}

function renderActivityCard(event: PublicScheduleEventRow): string {
  const confirmedAttendees = Number(event.confirmed_attendees ?? 0);
  const occupiedSeats = event.initial_occupied_seats + confirmedAttendees;
  const seats = event.capacity > 0
    ? `${occupiedSeats}/${event.capacity} plazas`
    : 'sin aforo configurado';
  const attendanceMode = event.attendance_mode === 'closed' ? 'Mesa cerrada' : 'Mesa abierta';
  const attendeeNames = normalizeStringArray(event.attendee_names);
  const catalogLink = event.catalog_item_name
    ? `<a class="activity-linked-game" href="/catalogo?q=${encodeURIComponent(event.catalog_item_name)}">${escapeHtml(event.catalog_item_name)}</a>`
    : '';
  const attendees = attendeeNames.length > 0
    ? attendeeNames.map((name) => `<li>${escapeHtml(name)}</li>`).join('')
    : '<li>Sin asistentes confirmados desde Telegram</li>';
  const facts = [
    ['Horario', formatActivityTimeRange(event.starts_at, event.duration_minutes)],
    ['Duracion', `${event.duration_minutes} min`],
    ['Asistencia', `${attendanceMode} · ${seats}`],
    event.catalog_item_name ? ['Juego enlazado', formatActivityCatalogItem(event)] : null,
    event.organizer_name ? ['Organiza', event.organizer_name] : null,
    event.table_name ? ['Mesa', formatActivityTable(event)] : null,
  ].filter((fact): fact is [string, string] => fact !== null);

  return `<article class="activity-card"><div class="activity-card-main"><p class="activity-time">${escapeHtml(formatActivityTimeRange(event.starts_at, event.duration_minutes))}</p><h3>${escapeHtml(event.title)}</h3>${catalogLink}${event.description ? `<p>${escapeHtml(event.description)}</p>` : ''}</div><dl class="activity-facts">${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl><div class="activity-attendees"><strong>Asistentes confirmados</strong><ul>${attendees}</ul></div></article>`;
}

function formatActivityTable(event: PublicScheduleEventRow): string {
  const details = [
    event.table_description,
    event.table_recommended_capacity ? `capacidad recomendada ${event.table_recommended_capacity}` : null,
  ].filter((value): value is string => Boolean(value));

  return details.length > 0 ? `${event.table_name} (${details.join(' · ')})` : event.table_name ?? '';
}

function formatActivityCatalogItem(event: PublicScheduleEventRow): string {
  const facts = [
    event.catalog_item_type ? renderCatalogType(event.catalog_item_type) : null,
    event.catalog_item_publisher,
    event.catalog_item_publication_year ? String(event.catalog_item_publication_year) : null,
    event.catalog_item_player_count_min || event.catalog_item_player_count_max
      ? `${renderPlayerRange(event.catalog_item_player_count_min, event.catalog_item_player_count_max)} jugadores`
      : null,
    event.catalog_item_recommended_age ? `${event.catalog_item_recommended_age}+` : null,
    event.catalog_item_play_time_minutes ? `${event.catalog_item_play_time_minutes} min` : null,
  ].filter((value): value is string => Boolean(value));

  return facts.length > 0 ? `${event.catalog_item_name} (${facts.join(' · ')})` : event.catalog_item_name ?? '';
}

function catalogPage(
  settings: WebSettings,
  catalogResult: PublicCatalogPage,
  filters: { search: string; itemType: string },
): string {
  const { items } = catalogResult;
  const typeOptions = [
    ['', 'Todos'],
    ['board-game', 'Juegos de mesa'],
    ['book', 'Libros'],
    ['rpg-book', 'Libros de rol'],
    ['expansion', 'Expansiones'],
    ['accessory', 'Accesorios'],
  ].map(([value, label]) => `<option value="${escapeHtml(value)}"${value === filters.itemType ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
  const form = `<form method="get" action="/catalogo" class="search-form"><label>Buscar<input name="q" value="${escapeHtml(filters.search)}" placeholder="Nombre del juego o libro"></label><label>Tipo<select name="type">${typeOptions}</select></label><button type="submit">Filtrar</button></form>`;
  const list = items.length === 0
    ? '<p>No hay artículos activos que coincidan con la búsqueda.</p>'
    : `<div class="list">${items.map((item) => `<section><h2>${escapeHtml(item.display_name)}</h2><p>${escapeHtml(renderCatalogType(item.item_type))}${item.family_name ? ` · ${escapeHtml(item.family_name)}` : ''}${item.group_name ? ` · ${escapeHtml(item.group_name)}` : ''}</p>${renderCatalogItemFacts(item)}</section>`).join('')}</div>`;
  const pagination = renderCatalogPagination(catalogResult, filters);

  return page({
    title: 'Catalogo',
    themeName: settings.theme,
    headerBrandName: settings.brand.name,
    headerLogoAsset: settings.home.logoAsset,
    body: `${form}${pagination}${list}${pagination}`,
  });
}

function renderCatalogPagination(
  catalogResult: PublicCatalogPage,
  filters: { search: string; itemType: string },
): string {
  const summary = `Mostrando ${catalogResult.items.length} de ${catalogResult.totalItems} articulos. Pagina ${catalogResult.page} de ${catalogResult.totalPages}.`;
  if (catalogResult.totalPages <= 1) {
    return `<p>${escapeHtml(summary)}</p>`;
  }

  const links = [
    catalogResult.page > 1 ? `<a href="${escapeHtml(buildCatalogPageUrl(filters, catalogResult.page - 1))}">Anterior</a>` : '',
    catalogResult.page < catalogResult.totalPages ? `<a href="${escapeHtml(buildCatalogPageUrl(filters, catalogResult.page + 1))}">Siguiente</a>` : '',
  ].filter(Boolean).join('');

  return `<nav aria-label="Paginacion catalogo"><span>${escapeHtml(summary)}</span>${links}</nav>`;
}

function buildCatalogPageUrl(filters: { search: string; itemType: string }, pageNumber: number): string {
  const params = new URLSearchParams();
  if (filters.search.trim()) {
    params.set('q', filters.search.trim());
  }
  if (filters.itemType.trim()) {
    params.set('type', filters.itemType.trim());
  }
  params.set('page', String(pageNumber));
  return `/catalogo?${params.toString()}`;
}

function webSettingsPage(settings: WebSettings, csrfToken: string): string {
  const themeOptions = listHttpThemes()
    .map((theme) => `<option value="${escapeHtml(theme.name)}"${theme.name === settings.theme ? ' selected' : ''}>${escapeHtml(theme.label)}</option>`)
    .join('');
  const featuredLinkFields = Array.from({ length: 6 }, (_, index) => {
    const link = settings.home.featuredLinks[index];
    const labelNumber = index + 1;
    return `<div class="asset-panel"><label>Texto enlace ${labelNumber}<input name="featuredLabel${labelNumber}" value="${escapeHtml(link?.label ?? '')}" maxlength="80"></label><label>URL enlace ${labelNumber}<input name="featuredUrl${labelNumber}" value="${escapeHtml(link?.url ?? '')}" maxlength="240" placeholder="/actividades"></label></div>`;
  }).join('');
  const assetPanels = [
    renderAssetPanel('logo', 'Logo principal', settings.home.logoAsset, csrfToken),
    renderAssetPanel('hero', 'Imagen de portada', settings.home.heroAsset, csrfToken),
    renderAssetPanel('gallery1', 'Imagen auxiliar 1', settings.home.galleryAssets[0] ?? null, csrfToken),
    renderAssetPanel('gallery2', 'Imagen auxiliar 2', settings.home.galleryAssets[1] ?? null, csrfToken),
    renderAssetPanel('gallery3', 'Imagen auxiliar 3', settings.home.galleryAssets[2] ?? null, csrfToken),
  ].join('');

  return page({
    title: 'Web publica',
    shell: 'admin',
    themeName: settings.theme,
    body: `<form method="post" action="/admin/web">${csrfInput(csrfToken)}<section><h2>Marca</h2><label>Nombre publico<input name="brandName" value="${escapeHtml(settings.brand.name)}" maxlength="120" required></label><label>Titular<input name="brandHeadline" value="${escapeHtml(settings.brand.headline)}" maxlength="180" required></label><label>Color principal<input name="primaryColor" value="${escapeHtml(settings.brand.primaryColor)}" pattern="#[0-9a-fA-F]{6}" required></label><label>Tema<select name="theme">${themeOptions}</select></label></section><section><h2>Portada</h2><label>Texto introductorio<textarea name="homeIntro" maxlength="1000" required>${escapeHtml(settings.home.intro)}</textarea></label><h3>Enlaces destacados</h3><div class="asset-grid">${featuredLinkFields}</div></section><section><h2>Informacion del club</h2><label>Resumen<textarea name="clubSummary" maxlength="2000" required>${escapeHtml(settings.clubInfo.summary)}</textarea></label><label>Direccion<input name="clubAddress" value="${escapeHtml(settings.clubInfo.address)}" maxlength="240"></label><label>Horarios<textarea name="clubOpeningHours" maxlength="500">${escapeHtml(settings.clubInfo.openingHours)}</textarea></label><label>Contacto<input name="clubContact" value="${escapeHtml(settings.clubInfo.contact)}" maxlength="240"></label><label>Normas basicas<textarea name="clubRules" maxlength="2000">${escapeHtml(settings.clubInfo.rules)}</textarea></label></section><p class="row"><button type="submit">Guardar web publica</button><a href="/">Ver portada</a><a href="/club">Ver club</a></p></form><section><h2>Imagenes</h2><p>PNG, JPG, WEBP o GIF. Maximo 2 MiB por archivo.</p><div class="asset-grid">${assetPanels}</div></section>`,
  });
}

function renderAssetPanel(target: WebAssetTarget, label: string, assetPath: string | null, csrfToken: string): string {
  const preview = assetPath
    ? `<img class="asset-preview" src="${escapeHtml(assetPath)}" alt="${escapeHtml(label)}" loading="lazy"><p><code>${escapeHtml(assetPath)}</code></p><form method="post" action="/admin/web/assets">${csrfInput(csrfToken)}<input type="hidden" name="target" value="${escapeHtml(target)}"><button name="action" value="clear" type="submit">Quitar</button></form>`
    : '<p>No configurada.</p>';
  return `<div class="asset-panel"><h3>${escapeHtml(label)}</h3>${preview}<form method="post" action="/admin/web/assets" enctype="multipart/form-data">${csrfInput(csrfToken)}<input type="hidden" name="target" value="${escapeHtml(target)}"><input type="file" name="asset" accept="image/png,image/jpeg,image/webp,image/gif" required><button type="submit">Subir imagen</button></form></div>`;
}

function isSafePublicHref(value: string): boolean {
  if (/^\/(?!\/)[A-Za-z0-9/_?=&%#.-]*$/.test(value)) {
    return true;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function renderCatalogType(itemType: string): string {
  const labels: Record<string, string> = {
    'board-game': 'Juego de mesa',
    book: 'Libro',
    'rpg-book': 'Libro de rol',
    expansion: 'Expansion',
    accessory: 'Accesorio',
  };

  return labels[itemType] ?? itemType;
}

function renderCatalogItemFacts(item: PublicCatalogItemRow): string {
  const facts = [
    item.publisher ? `Editorial: ${item.publisher}` : '',
    item.publication_year ? `Año: ${item.publication_year}` : '',
    item.player_count_min || item.player_count_max ? `Jugadores: ${renderPlayerRange(item.player_count_min, item.player_count_max)}` : '',
    item.recommended_age ? `Edad: ${item.recommended_age}+` : '',
    item.play_time_minutes ? `Duracion: ${item.play_time_minutes} min` : '',
  ].filter((fact) => fact.length > 0);

  return facts.length > 0 ? `<p>${facts.map(escapeHtml).join(' · ')}</p>` : '';
}

function renderPlayerRange(min: number | null, max: number | null): string {
  if (min !== null && max !== null && min !== max) {
    return `${min}-${max}`;
  }
  if (min !== null) {
    return String(min);
  }
  if (max !== null) {
    return String(max);
  }
  return '-';
}

function formatDateTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Madrid',
  }).format(date);
}

function formatActivityTimeRange(value: Date | string, durationMinutes: number): string {
  const startsAt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(startsAt.getTime())) {
    return String(value);
  }

  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
  const formatter = new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid',
  });

  return `${formatter.format(startsAt)} - ${formatter.format(endsAt)}`;
}

function formatActivityDayHeading(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Madrid',
  }).format(date);
}

function formatActivityDayKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  const parts = new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Europe/Madrid',
  }).formatToParts(date);
  const getPart = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';

  return `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
}

function getTimestamp(value: Date | string): number {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter((item) => item.trim().length > 0);
  }

  return [];
}

function buildWebSettingsFromForm(form: URLSearchParams, currentSettings: WebSettings): WebSettings {
  return {
    theme: form.get('theme') as WebSettings['theme'],
    brand: {
      name: form.get('brandName') ?? '',
      headline: form.get('brandHeadline') ?? '',
      primaryColor: form.get('primaryColor') ?? '',
    },
    home: {
      intro: form.get('homeIntro') ?? '',
      logoAsset: currentSettings.home.logoAsset,
      heroAsset: currentSettings.home.heroAsset,
      galleryAssets: currentSettings.home.galleryAssets,
      featuredLinks: Array.from({ length: 6 }, (_, index) => ({
        label: form.get(`featuredLabel${index + 1}`) ?? '',
        url: form.get(`featuredUrl${index + 1}`) ?? '',
      })),
    },
    clubInfo: {
      summary: form.get('clubSummary') ?? '',
      address: form.get('clubAddress') ?? '',
      openingHours: form.get('clubOpeningHours') ?? '',
      contact: form.get('clubContact') ?? '',
      rules: form.get('clubRules') ?? '',
    },
  };
}

function adminDashboardPage(
  status: Awaited<ReturnType<BackupOperations['readBackupConsoleStatus']>>,
  stats: AdminDashboardStats,
  csrfToken: string,
): string {
  const latestBackup = status.backups.latestBackup
    ? status.backups.latestBackup.fileName
    : 'Sin backups';
  const latestBackupSize = status.backups.latestBackup
    ? formatBytes(status.backups.latestBackup.sizeBytes)
    : '';
  const database = status.database.state === 'connected'
    ? status.database.databaseName
    : status.database.message;
  const databaseDetail = status.database.state === 'connected'
    ? `${status.database.totalTables} tablas`
    : '';

  const metricRows = [
    ['Servicio', status.service.state, status.service.serviceName.replace(/\.service$/, '')],
    ['Base de datos', database, databaseDetail],
    ['Ultimo backup', latestBackupSize || latestBackup, latestBackupSize ? latestBackup : ''],
    ['Socios aprobados', String(stats.approvedUsers), ''],
    ['Pendientes Telegram', String(stats.pendingUsers), ''],
    ['Admins', String(stats.adminUsers), ''],
    ['Actividades futuras', String(stats.futureActivities), ''],
    ['Catalogo activo', String(stats.activeCatalogItems), ''],
    ['Prestamos activos', String(stats.activeLoans), `${stats.overdueLoans} vencidos`],
    ['Altas web pendientes', String(stats.pendingMemberSignups), ''],
  ];
  const metrics = metricRows
    .map(([label, value, detail]) => `<article class="admin-metric-card"><h2>${escapeHtml(label)}</h2><p>${escapeHtml(value)}</p>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</article>`)
    .join('');
  const adminSections = [
    ['Contenido publico', 'Web publica', 'Portada, logos, imagenes, enlaces destacados y textos del club.', '/admin/web'],
    ['Operacion diaria', 'Actividades', 'Resumen de agenda y acceso a eventos programados.', '/admin/activities'],
    ['Operacion diaria', 'Catalogo', 'Juegos, libros, prestamos activos y recursos de catalogo.', '/admin/catalog'],
    ['Comunidad', 'Socios y usuarios', 'Altas Telegram, aprobaciones, admins y estado de miembros.', '/admin/users'],
    ['Comunidad', 'Feedback', 'Mensajes enviados desde el formulario publico.', '/admin/feedback'],
    ['Comunidad', 'Altas de socio', 'Solicitudes web pendientes y seguimiento de contacto.', '/admin/member-signups'],
    ['Comunicacion', 'Noticias y feeds', 'Suscripciones por feed, incluido nuevos_miembros.', '/admin/news'],
    ['Sistema', 'Backups', 'Copias, restauracion protegida y borrado confirmado.', '/admin/backups'],
    ['Sistema', 'Servicio y logs', 'Estado systemd, logs recientes y acciones de servicio.', '/admin/service'],
    ['Sistema', 'Configuracion tecnica', 'Token Telegram y ajustes sensibles con confirmacion.', '/admin/config'],
    ['Avanzado', 'Recursos avanzados', 'Edicion directa de tablas permitidas para administracion puntual.', '/admin/resources'],
    ['Vista publica', 'Ver actividades', 'Comprobar la agenda como la ve un visitante.', '/actividades'],
    ['Vista publica', 'Ver catalogo', 'Comprobar el catalogo publico publicado.', '/catalogo'],
  ];
  const sections = adminSections
    .map(([group, title, description, href]) => `<a class="admin-section-card" href="${escapeHtml(href)}"><span>${escapeHtml(group)}</span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></a>`)
    .join('');

  return page({
    title: 'Admin',
    shell: 'admin',
    body: `<div class="admin-dashboard-shell"><div class="admin-toolbar"><p><strong>Panel operativo</strong><span>Estado del bot, comunidad y recursos principales.</span></p><form method="post" action="/admin/logout">${csrfInput(csrfToken)}<button type="submit">Salir</button></form></div><div class="admin-metrics">${metrics}</div><section class="admin-section-panel"><h2>Secciones</h2><div class="admin-section-grid">${sections}</div></section></div>`,
  });
}

function feedbackAdminPage(entries: FeedbackEntry[]): string {
  const body = entries.length === 0
    ? '<p>No hay feedback registrado.</p>'
    : `<table><thead><tr><th>Fecha</th><th>Tema</th><th>Nombre</th><th>Contacto</th><th>Mensaje</th></tr></thead><tbody>${entries.map((entry) => `<tr><td>${escapeHtml(entry.createdAt)}</td><td>${escapeHtml(entry.topic)}</td><td>${escapeHtml(entry.name)}</td><td>${escapeHtml(entry.contact)}</td><td>${escapeHtml(entry.message)}</td></tr>`).join('')}</tbody></table>`;

  return page({
    title: 'Feedback recibido',
    shell: 'admin',
    body,
  });
}

function memberSignupsAdminPage(signups: AdminMemberSignupRow[], csrfToken: string): string {
  const body = signups.length === 0
    ? '<p>No hay solicitudes de alta web registradas.</p>'
    : `<table><thead><tr><th>Fecha</th><th>Nombre</th><th>Telegram</th><th>Contacto</th><th>Estado</th><th>Avisos</th><th>Mensaje</th><th>Revision</th></tr></thead><tbody>${signups.map((signup) => `<tr><td>${escapeHtml(formatDateTime(signup.created_at))}</td><td>${escapeHtml(signup.full_name)}</td><td>${signup.telegram_alias ? `@${escapeHtml(signup.telegram_alias.replace(/^@/, ''))}` : ''}</td><td>${escapeHtml(signup.contact)}</td><td>${escapeHtml(signup.status)}</td><td>${escapeHtml(formatNotificationSummary(signup.notification_summary))}</td><td>${escapeHtml(signup.message ?? '')}</td><td>${renderMemberSignupStatusActions(signup, csrfToken)}</td></tr>`).join('')}</tbody></table>`;

  return page({
    title: 'Altas de socio',
    shell: 'admin',
    body,
  });
}

function renderMemberSignupStatusActions(signup: AdminMemberSignupRow, csrfToken: string): string {
  const actions: Array<[string, string]> = signup.status === 'pending'
    ? [['contacted', 'Contactada'], ['approved', 'Aprobada'], ['rejected', 'Rechazada']]
    : [['pending', 'Reabrir']];
  return actions
    .map(([status, label]) => `<form method="post" action="/admin/member-signups/${signup.id}/status" class="inline">${csrfInput(csrfToken)}<button name="status" value="${escapeHtml(status)}" type="submit">${escapeHtml(label)}</button></form>`)
    .join(' ');
}

function newsAdminPage(summary: NewsAdminSummary): string {
  const categoryRows = summary.categories
    .map((category) => `<tr><td>${escapeHtml(category.label)}</td><td>${escapeHtml(category.description)}</td><td>${category.subscribedGroups}</td><td>${category.defaultSubscribed ? 'si' : 'no'}</td></tr>`)
    .join('');

  return page({
    title: 'Noticias y feeds',
    shell: 'admin',
    body: `<section><h2>Grupos</h2><p>${summary.enabledGroups} grupos activos de ${summary.totalGroups} registrados.</p></section><section><h2>Categorias</h2><table><thead><tr><th>Feed</th><th>Descripcion</th><th>Grupos suscritos</th><th>Default</th></tr></thead><tbody>${categoryRows}</tbody></table></section>`,
  });
}

function adminUsersPage(overview: AdminUsersOverview): string {
  const metrics = [
    ['Total', overview.counts.total],
    ['Aprobados', overview.counts.approved],
    ['Pendientes', overview.counts.pending],
    ['Admins', overview.counts.admins],
    ['Bloqueados', overview.counts.blocked],
    ['Revocados', overview.counts.revoked],
  ].map(([label, value]) => `<section><h2>${escapeHtml(label)}</h2><p>${value}</p></section>`).join('');
  const rows = overview.recentUsers.length === 0
    ? '<p>No hay usuarios registrados.</p>'
    : `<table><thead><tr><th>Usuario</th><th>Telegram</th><th>Estado</th><th>Rol</th><th>Actualizado</th></tr></thead><tbody>${overview.recentUsers.map((user) => `<tr><td>${escapeHtml(user.display_name)}</td><td>${user.username ? `@${escapeHtml(user.username)}` : escapeHtml(user.telegram_user_id)}</td><td>${escapeHtml(user.status)}</td><td>${user.is_admin ? 'admin' : 'socio'}</td><td>${escapeHtml(formatDateTime(user.updated_at))}</td></tr>`).join('')}</tbody></table>`;

  return page({
    title: 'Socios y usuarios',
    shell: 'admin',
    body: `<div class="asset-grid">${metrics}</div><section><h2>Gestion</h2><p class="row"><a href="/admin/member-signups">Altas web</a><a href="/admin/resources/users">Editar usuarios</a></p></section><section><h2>Usuarios recientes</h2>${rows}</section>`,
  });
}

function adminActivitiesPage(overview: AdminActivitiesOverview): string {
  const metrics = [
    ['Futuras', overview.counts.future],
    ['Programadas', overview.counts.scheduledTotal],
    ['Canceladas', overview.counts.cancelledTotal],
  ].map(([label, value]) => `<section><h2>${escapeHtml(label)}</h2><p>${value}</p></section>`).join('');
  const rows = overview.upcomingEvents.length === 0
    ? '<p>No hay actividades futuras programadas.</p>'
    : `<table><thead><tr><th>Actividad</th><th>Fecha</th><th>Duracion</th><th>Plazas</th><th>Modo</th></tr></thead><tbody>${overview.upcomingEvents.map((event) => `<tr><td>${escapeHtml(event.title)}</td><td>${escapeHtml(formatDateTime(event.starts_at))}</td><td>${event.duration_minutes} min</td><td>${event.capacity > 0 ? `${event.initial_occupied_seats}/${event.capacity}` : '-'}</td><td>${escapeHtml(event.attendance_mode)}</td></tr>`).join('')}</tbody></table>`;

  return page({
    title: 'Actividades admin',
    shell: 'admin',
    body: `<div class="asset-grid">${metrics}</div><section><h2>Gestion</h2><p class="row"><a href="/admin/resources/schedule_events">Editar actividades</a><a href="/actividades">Ver pagina publica</a></p></section><section><h2>Proximas actividades</h2>${rows}</section>`,
  });
}

function adminCatalogPage(overview: AdminCatalogOverview): string {
  const metrics = [
    ['Activos', overview.counts.active],
    ['Inactivos', overview.counts.inactive],
    ['Prestados', overview.counts.loaned],
  ].map(([label, value]) => `<section><h2>${escapeHtml(label)}</h2><p>${value}</p></section>`).join('');
  const typeRows = overview.typeCounts.length === 0
    ? '<p>No hay articulos activos agrupados por tipo.</p>'
    : `<table><thead><tr><th>Tipo</th><th>Articulos activos</th></tr></thead><tbody>${overview.typeCounts.map((item) => `<tr><td>${escapeHtml(renderCatalogType(item.item_type))}</td><td>${Number(item.count)}</td></tr>`).join('')}</tbody></table>`;
  const sampleRows = overview.sampleItems.length === 0
    ? '<p>No hay articulos activos.</p>'
    : `<table><thead><tr><th>Articulo</th><th>Tipo</th><th>Familia</th><th>Datos</th></tr></thead><tbody>${overview.sampleItems.map((item) => `<tr><td>${escapeHtml(item.display_name)}</td><td>${escapeHtml(renderCatalogType(item.item_type))}</td><td>${escapeHtml(item.family_name ?? item.group_name ?? '-')}</td><td>${renderCatalogItemFacts(item) || '-'}</td></tr>`).join('')}</tbody></table>`;

  return page({
    title: 'Catalogo admin',
    shell: 'admin',
    body: `<div class="asset-grid">${metrics}</div><section><h2>Gestion</h2><p class="row"><a href="/admin/resources/catalog_items">Editar catalogo</a><a href="/catalogo">Ver catalogo publico</a></p></section><section><h2>Tipos</h2>${typeRows}</section><section><h2>Muestra de articulos activos</h2>${sampleRows}</section>`,
  });
}

function formatNotificationSummary(summary: Record<string, unknown> | null): string {
  if (!summary) {
    return '-';
  }
  const privateSent = Number(summary.privateSent ?? 0);
  const privateFailed = Number(summary.privateFailed ?? 0);
  const groupSent = Number(summary.groupSent ?? 0);
  const groupFailed = Number(summary.groupFailed ?? 0);
  return `privados ${privateSent}/${privateFailed} fallos · grupos ${groupSent}/${groupFailed} fallos`;
}

function adminMaintenancePage(status: Awaited<ReturnType<BackupOperations['readBackupConsoleStatus']>>, logs: string, csrfToken: string): string {
  const databaseSummary = status.database.state === 'connected'
    ? `${escapeHtml(status.database.databaseName)} · ${status.database.totalTables} taules · ${formatBytes(status.database.sizeBytes)}`
    : escapeHtml(status.database.message);
  const tableCounts = status.database.state === 'connected'
    ? `<ul>${status.database.knownTableCounts.map((item) => `<li>${escapeHtml(item.tableName)}: ${item.rowCount}</li>`).join('')}</ul>`
    : '';
  return page({ title: 'Servicio y logs', body: `<form method="post" action="/admin/logout">${csrfInput(csrfToken)}<button type="submit">Sortir</button></form><section><h2>Servei</h2><p>${escapeHtml(status.service.serviceName)}: ${escapeHtml(status.service.state)}</p><form class="row" method="post" action="/admin/service">${csrfInput(csrfToken)}<button name="action" value="start">Arrencar</button><button name="action" value="restart">Reiniciar</button><a href="/admin/service/confirm?action=stop">Aturar</a></form></section><section><h2>Base de dades</h2><p>${databaseSummary}</p>${tableCounts}</section><section><h2>Dependencies</h2><ul>${status.dependencies.map((item) => `<li>${escapeHtml(item.command)}: ${escapeHtml(item.state)}</li>`).join('')}</ul></section><section><h2>Logs</h2><pre>${escapeHtml(logs)}</pre></section>`, shell: 'admin' });
}

function adminConfigPage(status: Awaited<ReturnType<BackupOperations['readBackupConsoleStatus']>>, csrfToken: string): string {
  return page({
    title: 'Configuracion tecnica',
    shell: 'admin',
    body: `<section><h2>Runtime config</h2><ul>${status.configFiles.map((item) => `<li>${escapeHtml(item.label)}: ${escapeHtml(item.path)} · ${escapeHtml(item.state)}</li>`).join('')}</ul></section><section><h2>Token de Telegram</h2><p>Cambiar este token reinicia la conexion real del bot con Telegram. Revisa el valor antes de confirmar.</p><form method="post" action="/admin/token">${csrfInput(csrfToken)}<label>Nou token de Telegram<input name="token" type="password" autocomplete="off" pattern="\\d+:[A-Za-z0-9_-]{20,}"></label><button type="submit">Revisar cambio de token</button></form></section>`,
  });
}

function adminBackupsPage(status: Awaited<ReturnType<BackupOperations['readBackupConsoleStatus']>>, csrfToken: string): string {
  const archives = status.backups.archives.length === 0
    ? '<p>No hi ha backups disponibles.</p>'
    : `<ul>${status.backups.archives.map((archive) => `<li>${escapeHtml(archive.fileName)} · ${formatBytes(archive.sizeBytes)} · ${escapeHtml(archive.modifiedAt)} <a href="/admin/restore?backupFilePath=${encodeURIComponent(archive.filePath)}">Restaurar</a> <a href="/admin/delete-backup?backupFilePath=${encodeURIComponent(archive.filePath)}">Eliminar</a></li>`).join('')}</ul>`;

  return page({
    title: 'Backups',
    shell: 'admin',
    body: `<section><h2>Directorio</h2><p>${status.backups.totalCount} arxius a ${escapeHtml(status.backups.directory)}</p><form method="post" action="/admin/backup">${csrfInput(csrfToken)}<button type="submit">Crear backup complet</button></form></section><section><h2>Archivos</h2>${archives}</section>`,
  });
}

type BackupArchive = Awaited<ReturnType<BackupOperations['listBackupArchives']>>[number];

function backupConfirmationPage(
  action: 'restore' | 'delete',
  archive: BackupArchive,
  csrfToken: string,
  error = '',
): string {
  const isRestore = action === 'restore';
  const confirmValue = isRestore ? 'RESTORE' : 'DELETE';
  const actionPath = isRestore ? '/admin/restore' : '/admin/delete-backup';
  const title = isRestore ? 'Confirmar restauracion' : 'Confirmar eliminacion';
  const warning = isRestore
    ? 'Restaurar un backup puede sobrescribir la base de datos, configuracion o archivos runtime.'
    : 'Eliminar un backup borra el archivo de recuperacion seleccionado.';
  const errorHtml = error ? `<p role="alert">${escapeHtml(error)}</p>` : '';

  return page({
    title,
    shell: 'admin',
    body: `${errorHtml}<section><h2>${escapeHtml(archive.fileName)}</h2><p>${escapeHtml(warning)}</p><p>${formatBytes(archive.sizeBytes)} · ${escapeHtml(archive.modifiedAt)}</p><form method="post" action="${actionPath}">${csrfInput(csrfToken)}<input type="hidden" name="backupFilePath" value="${escapeHtml(archive.filePath)}"><label>Confirmacion<input name="confirm" autocomplete="off" placeholder="${confirmValue}" required></label><button type="submit">${escapeHtml(title)}</button><a href="/admin/service">Cancelar</a></form></section>`,
  });
}

function serviceStopConfirmationPage(csrfToken: string, error = ''): string {
  const errorHtml = error ? `<p role="alert">${escapeHtml(error)}</p>` : '';
  return page({
    title: 'Confirmar parada del servicio',
    shell: 'admin',
    body: `${errorHtml}<section><h2>Detener gameclubtelegrambot.service</h2><p>El bot y la web integrada dejaran de responder hasta que el servicio vuelva a arrancar.</p><form method="post" action="/admin/service">${csrfInput(csrfToken)}<input type="hidden" name="action" value="stop"><label>Confirmacion<input name="confirm" autocomplete="off" placeholder="STOP" required></label><button type="submit">Detener servicio</button><a href="/admin/service">Cancelar</a></form></section>`,
  });
}

function tokenChangeConfirmationPage(csrfToken: string, error = ''): string {
  const errorHtml = error ? `<p role="alert">${escapeHtml(error)}</p>` : '';
  return page({
    title: 'Confirmar cambio de token',
    shell: 'admin',
    body: `${errorHtml}<section><h2>Cambiar token de Telegram</h2><p>Un token incorrecto puede dejar el bot sin conexion con Telegram. El token introducido queda pendiente en la sesion y no se muestra en esta pagina.</p><form method="post" action="/admin/token-confirm">${csrfInput(csrfToken)}<label>Confirmacion<input name="confirm" autocomplete="off" placeholder="CHANGE_TOKEN" required></label><button type="submit">Cambiar token</button><a href="/admin/config">Cancelar</a></form></section>`,
  });
}

function resourcesIndexPage(): string {
  return page({ title: 'Recursos', body: `<ul>${resourceDefs.map((resourceDef) => `<li><a href="/admin/resources/${resourceDef.key}">${escapeHtml(resourceDef.label)}</a></li>`).join('')}</ul>`, shell: 'admin' });
}

function resourceListPage(resourceDef: ResourceDef, rows: Array<Record<string, unknown>>, search: string, csrfToken: string): string {
  const columns = uniqueColumns([resourceDef.idColumn, resourceDef.titleColumn, ...resourceDef.subtitleColumns, ...resourceDef.listColumns]);
  const header = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('');
  const body = rows.map((row) => {
    const id = String(row[resourceDef.idColumn] ?? '');
    const cells = columns.map((column) => `<td>${escapeHtml(formatCell(row[column]))}</td>`).join('');
    const deleteActions = resourceDef.softDelete
      ? `<form method="post" action="/admin/resources/${resourceDef.key}/${encodeURIComponent(id)}/delete" class="inline">${csrfInput(csrfToken)}<button name="mode" value="soft">Desactivar</button></form> <a href="/admin/resources/${resourceDef.key}/${encodeURIComponent(id)}/delete">Borrado definitivo</a>`
      : `<a href="/admin/resources/${resourceDef.key}/${encodeURIComponent(id)}/delete">Borrado definitivo</a>`;
    return `<tr>${cells}<td><a href="/admin/resources/${resourceDef.key}/${encodeURIComponent(id)}/edit">Editar</a> ${deleteActions}${resourceDef.key === 'users' ? userActionForms(id, csrfToken) : ''}</td></tr>`;
  }).join('');
  return page({ title: resourceDef.label, body: `<form method="get"><input name="q" value="${escapeHtml(search)}" placeholder="Buscar"><button type="submit">Buscar</button></form><table><thead><tr>${header}<th>Acciones</th></tr></thead><tbody>${body}</tbody></table>`, shell: 'admin' });
}

function resourceDeleteConfirmationPage(
  resourceDef: ResourceDef,
  row: Record<string, unknown>,
  csrfToken: string,
  error = '',
): string {
  const id = String(row[resourceDef.idColumn] ?? '');
  const title = formatCell(row[resourceDef.titleColumn]) || id;
  const errorHtml = error ? `<p role="alert">${escapeHtml(error)}</p>` : '';
  return page({
    title: 'Confirmar borrado definitivo',
    shell: 'admin',
    body: `${errorHtml}<section><h2>${escapeHtml(resourceDef.label)}: ${escapeHtml(title)}</h2><p>Esta accion elimina la fila y los dependientes configurados. Usa desactivar o archivar si existe esa opcion.</p><form method="post" action="/admin/resources/${resourceDef.key}/${encodeURIComponent(id)}/delete">${csrfInput(csrfToken)}<input type="hidden" name="mode" value="hard"><label>Confirmacion<input name="confirm" autocomplete="off" placeholder="DELETE" required></label><button type="submit">Borrar definitivamente</button><a href="/admin/resources/${resourceDef.key}">Cancelar</a></form></section>`,
  });
}

function resourceEditPage(resourceDef: ResourceDef, row: Record<string, unknown>, csrfToken: string): string {
  if (resourceDef.editableFields.length === 0) {
    return page({ title: resourceDef.label, body: '<p>Aquest recurs no te camps editables.</p>', shell: 'admin' });
  }
  const fields = resourceDef.editableFields.map((field) => `<label>${escapeHtml(field.label)} <small>${escapeHtml(field.column)} · ${escapeHtml(field.type)}</small><textarea name="${escapeHtml(field.column)}">${escapeHtml(formatCell(row[field.column]))}</textarea></label>`).join('');
  return page({ title: resourceDef.label, body: `<form method="post">${csrfInput(csrfToken)}${fields}<button type="submit">Guardar</button></form>`, shell: 'admin' });
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
