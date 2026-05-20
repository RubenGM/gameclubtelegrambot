import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

import { createAdminHttpServer } from './admin-http-server.js';
import { hashSecret } from '../security/password-hash.js';
import type { RuntimeConfig } from '../config/runtime-config.js';
import type { MemberSignupInput, MemberSignupRecord, MemberSignupStore } from './member-signup-store.js';
import { defaultWebSettings, normalizeWebSettings, type WebSettings, type WebSettingsStore } from './web-settings-store.js';

test('admin http server exposes public feedback and protects admin pages', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'gameclub-http-'));
  const port = await findFreePort();
  const passwordHash = await hashSecret('secret-admin');
  const config: RuntimeConfig = {
    schemaVersion: 1,
    bot: { publicName: 'Bot', clubName: 'Club', language: 'ca' },
    telegram: { token: 'telegram-token' },
    database: { host: 'localhost', port: 5432, name: 'gameclub', user: 'user', password: 'pw', ssl: false },
    adminElevation: { passwordHash },
    httpServer: { enabled: true, host: '127.0.0.1', port, feedbackFile: 'feedback.jsonl' },
    bootstrap: { firstAdmin: { telegramUserId: 1, displayName: 'Admin' } },
    notifications: { defaults: { groupAnnouncementsEnabled: true, eventRemindersEnabled: true, eventReminderLeadHours: 24 } },
    featureFlags: {},
  };
  const serviceControl = {
    getServiceStatus: async () => ({ serviceName: 'gameclubtelegrambot.service', state: 'active' as const, rawState: 'active' }),
    startService: async () => {
      serviceActions.push('start');
    },
    stopService: async () => {
      serviceActions.push('stop');
    },
    restartService: async () => {},
    readRecentLogs: async () => 'service logs',
  };
  const serviceActions: string[] = [];
  const restored: string[] = [];
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const privateMessages: Array<{ telegramUserId: number; message: string }> = [];
  const groupMessages: Array<{ chatId: number; message: string }> = [];
  const backupPath = join(tmp, 'gameclub-backup-test.zip');
  await writeFile(backupPath, 'zip');
  const database = {
    pool: {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (sql.includes('from "users"') && sql.includes('order by')) {
          return {
            rows: [{
              telegram_user_id: 42,
              display_name: 'Ada',
              username: 'ada',
              status: 'pending',
              is_admin: false,
              is_approved: false,
            }],
          };
        }
        if (sql.includes('from users') && sql.includes('order by updated_at desc')) {
          return {
            rows: [{
              telegram_user_id: 42,
              display_name: 'Ada',
              username: 'ada',
              status: 'pending',
              is_admin: false,
              is_approved: false,
              created_at: '2026-05-18T18:00:00.000Z',
              updated_at: '2026-05-19T18:00:00.000Z',
            }],
          };
        }
        if (sql.includes('from users') && sql.includes("status = 'approved'") && sql.includes('is_admin = true')) {
          return {
            rows: [
              { telegram_user_id: 1001 },
              { telegram_user_id: 1002 },
            ],
          };
        }
        if (sql.includes('from news_group_subscriptions')) {
          return {
            rows: [
              { chat_id: -300 },
            ],
          };
        }
        if (sql.includes('count(*)::int as count from storage_categories') && sql.includes("lifecycle_status = 'active'")) {
          return { rows: [{ count: 2 }] };
        }
        if (sql.includes('count(*)::int as count from storage_categories') && sql.includes("lifecycle_status = 'archived'")) {
          return { rows: [{ count: 1 }] };
        }
        if (sql.includes('count(*)::int as count from storage_entries') && sql.includes("lifecycle_status = 'active'")) {
          return { rows: [{ count: 7 }] };
        }
        if (sql.includes('count(*)::int as count from storage_entries') && sql.includes("lifecycle_status = 'deleted'")) {
          return { rows: [{ count: 2 }] };
        }
        if (sql.includes('count(*)::int as count from storage_entry_messages')) {
          return { rows: [{ count: 12 }] };
        }
        if (sql.includes('from storage_categories categories') && sql.includes('left join storage_categories parents')) {
          return {
            rows: [{
              id: 3,
              display_name: 'Reglamentos',
              slug: 'reglamentos',
              description: 'PDFs y ayudas',
              parent_category_id: null,
              parent_name: null,
              storage_chat_id: -100,
              storage_thread_id: 12,
              category_purpose: 'user_uploads',
              lifecycle_status: 'active',
              entry_count: 4,
              updated_at: '2026-05-19T18:00:00.000Z',
            }, {
              id: 4,
              display_name: 'Ayudas de juego',
              slug: 'ayudas',
              description: 'Resumenes',
              parent_category_id: 3,
              parent_name: 'Reglamentos',
              storage_chat_id: -100,
              storage_thread_id: 13,
              category_purpose: 'user_uploads',
              lifecycle_status: 'active',
              entry_count: 2,
              updated_at: '2026-05-19T18:00:00.000Z',
            }],
          };
        }
        if (sql.includes('from storage_entries entries') && sql.includes('inner join storage_categories categories')) {
          return {
            rows: [{
              id: 55,
              category_id: 3,
              category_name: 'Reglamentos',
              source_kind: 'document',
              description: 'Manual de campaña',
              tags: ['rol', 'pdf'],
              lifecycle_status: 'active',
              created_by_name: 'Ada',
              message_count: 1,
              preview_telegram_file_id: 'photo-file-id',
              preview_mime_type: 'image/jpeg',
              preview_attachment_kind: 'photo',
              updated_at: '2026-05-19T18:00:00.000Z',
            }],
          };
        }
        if (sql.includes('from member_signup_requests') && sql.includes('full_name')) {
          return {
            rows: [{
              id: 1,
              full_name: 'Nueva Socia',
              telegram_alias: 'nueva_socia',
              contact: 'nueva@example.test',
              message: 'Quiero jugar campañas',
              status: 'pending',
              notification_summary: { privateSent: 1, privateFailed: 1, groupSent: 1, groupFailed: 0 },
              created_at: '2026-05-19T18:00:00.000Z',
            }],
          };
        }
        if (sql.includes('from schedule_events')) {
          return {
            rows: [{
              id: 7,
              title: 'Partida abierta',
              description: 'Mesa de iniciacion',
              starts_at: '2026-05-23T17:00:00.000Z',
              duration_minutes: 180,
              capacity: 6,
              initial_occupied_seats: 2,
              attendance_mode: 'open',
              table_name: 'Mesa grande',
              table_description: 'Zona central',
              table_recommended_capacity: 6,
              catalog_item_id: 11,
              catalog_item_name: 'Dune Imperium',
              catalog_item_type: 'board-game',
              catalog_item_publisher: 'Dire Wolf',
              catalog_item_publication_year: 2020,
              catalog_item_player_count_min: 1,
              catalog_item_player_count_max: 4,
              catalog_item_recommended_age: 14,
              catalog_item_play_time_minutes: 120,
              organizer_name: 'Ada',
              confirmed_attendees: 2,
              attendee_names: ['Ada', 'Marta'],
            }, {
              id: 8,
              title: 'Mesa cerrada',
              description: null,
              starts_at: '2026-05-23T19:00:00.000Z',
              duration_minutes: 120,
              capacity: 5,
              initial_occupied_seats: 1,
              attendance_mode: 'closed',
              table_name: 'Mesa pequeña',
              table_description: null,
              table_recommended_capacity: 5,
              catalog_item_id: null,
              catalog_item_name: null,
              catalog_item_type: null,
              catalog_item_publisher: null,
              catalog_item_publication_year: null,
              catalog_item_player_count_min: null,
              catalog_item_player_count_max: null,
              catalog_item_recommended_age: null,
              catalog_item_play_time_minutes: null,
              organizer_name: null,
              confirmed_attendees: 0,
              attendee_names: [],
            }],
          };
        }
        if (sql.includes('from catalog_families')) {
          return { rows: [{ id: 5, display_name: 'Juegos de mesa' }] };
        }
        if (sql.includes('count(') && sql.includes('from catalog_items items')) {
          return { rows: [{ count: 25 }] };
        }
        if (sql.includes('from catalog_items') && sql.includes('group by item_type')) {
          return { rows: [{ item_type: 'board-game', count: 18 }, { item_type: 'book', count: 7 }] };
        }
        if (sql.includes('from catalog_items items')) {
          return {
            rows: [{
              id: 11,
              display_name: 'Dune Imperium',
              original_name: 'Dune: Imperium',
              item_type: 'board-game',
              description: 'Juego de construccion de mazos, intriga y control de zonas.',
              language: 'ES',
              family_id: 5,
              family_name: 'Juegos de mesa',
              group_id: 9,
              group_name: 'Estrategia',
              owner_name: 'Ada',
              publisher: 'Dire Wolf',
              publication_year: 2020,
              player_count_min: 1,
              player_count_max: 4,
              recommended_age: 14,
              play_time_minutes: 120,
              active_loan_borrower: null,
              active_loan_due_at: null,
              media_url: 'storage:entry:99',
              media_alt_text: null,
              external_refs: { boardGameGeekId: '316554', boardGameGeekUrl: 'https://boardgamegeek.com/boardgame/316554' },
              metadata: { source: 'boardgamegeek' },
            }],
          };
        }
        if (sql.includes('count(*)') && sql.includes('from news_groups')) {
          return { rows: [{ count: 2 }] };
        }
        if (sql.includes('count(*)') && sql.includes('news_group_subscriptions subscriptions')) {
          return { rows: [{ count: 1 }] };
        }
        if (sql.includes('select * from "users"')) {
          return {
            rows: [{
              telegram_user_id: 42,
              display_name: 'Ada',
              username: 'ada',
              status: 'pending',
              is_admin: false,
              is_approved: false,
              status_reason: null,
            }],
          };
        }
        if (sql.includes('information_schema.columns')) {
          return { rows: [{ '?column?': 1 }] };
        }
        if (sql.includes('select "status" from "users"')) {
          return { rows: [{ status: 'pending' }] };
        }
        if (sql.includes('select "is_admin" from "users"')) {
          return { rows: [{ is_admin: false }] };
        }
        return { rows: [] };
      },
    },
  };
  const backupOperations = {
    readBackupConsoleStatus: async () => ({
      service: { serviceName: 'gameclubtelegrambot.service', state: 'active' as const, rawState: 'active', message: null },
      dependencies: [],
      configFiles: [{ label: 'Runtime config', path: '/etc/gameclubtelegrambot/runtime.json', state: 'present' as const }],
      database: {
        state: 'connected' as const,
        host: 'localhost',
        port: 5432,
        databaseName: 'gameclub',
        sizeBytes: 2048,
        totalTables: 1,
        knownTableCounts: [{ tableName: 'users', rowCount: 3 }],
      },
      backups: {
        directory: tmp,
        totalCount: 1,
        latestBackup: { fileName: 'gameclub-backup-test.zip', filePath: backupPath, sizeBytes: 123, modifiedAt: '2026-05-05T10:00:00.000Z', manifest: null },
        archives: [{ fileName: 'gameclub-backup-test.zip', filePath: backupPath, sizeBytes: 123, modifiedAt: '2026-05-05T10:00:00.000Z', manifest: null }],
      },
    }),
    listBackupArchives: async () => [{ fileName: 'gameclub-backup-test.zip', filePath: backupPath, sizeBytes: 123, modifiedAt: '2026-05-05T10:00:00.000Z', manifest: null }],
    createFullBackup: async () => ({ archivePath: join(tmp, 'backup.zip'), output: 'ok' }),
    restoreFullBackup: async ({ backupFilePath }: { backupFilePath: string }) => {
      restored.push(backupFilePath);
      return { output: 'ok' };
    },
    readLastOperationLog: async () => 'ok',
  };
  const webSettingsStore = createMemoryWebSettingsStore();
  const memberSignupStore = createMemoryMemberSignupStore();

  const server = createAdminHttpServer({
    config,
    services: { database: database as never },
    logger: { info() {}, error() {} },
    appRoot: tmp,
    backupOperations,
    serviceControl,
    webSettingsStore,
    memberSignupStore,
    telegramSender: {
      async sendPrivateMessage(telegramUserId, message) {
        if (telegramUserId === 1002) {
          throw new Error('telegram unavailable');
        }
        privateMessages.push({ telegramUserId, message });
      },
      async sendGroupMessage(chatId, message) {
        groupMessages.push({ chatId, message });
      },
    },
  });

  await server.start();
  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const welcomePage = await fetch(`${baseUrl}/`);
    assert.equal(welcomePage.status, 200);
    const welcomeHtml = await welcomePage.text();
    assert.match(welcomeHtml, /CAWA Girona/);
    assert.match(welcomeHtml, /Club de juegos, rol y wargames en Girona/);
    assert.match(welcomeHtml, /data-theme="classic"/);
    assert.match(welcomeHtml, /--cawa-brand:#184b1f/);
    assert.match(welcomeHtml, /rel="icon" href="\/brand\/cawa_casco\.svg"/);
    assert.match(welcomeHtml, /class="brand-logo" src="\/brand\/cawa_logo\.svg"/);
    assert.match(welcomeHtml, /href="\/actividades"/);
    assert.match(welcomeHtml, /href="\/catalogo"/);
    assert.match(welcomeHtml, /href="\/club"/);
    assert.match(welcomeHtml, /href="\/alta"/);

    const faviconResponse = await fetch(`${baseUrl}/brand/cawa_casco.svg`);
    assert.equal(faviconResponse.status, 200);
    assert.match(faviconResponse.headers.get('content-type') ?? '', /image\/svg\+xml/);

    const clubPage = await fetch(`${baseUrl}/club`);
    assert.equal(clubPage.status, 200);
    assert.match(await clubPage.text(), /CAWA Girona es un club multidisciplinar/);

    const activitiesPage = await fetch(`${baseUrl}/actividades`);
    assert.equal(activitiesPage.status, 200);
    const activitiesHtml = await activitiesPage.text();
    assert.match(activitiesHtml, /Partida abierta/);
    assert.match(activitiesHtml, /Sábado, 23 de mayo/);
    assert.match(activitiesHtml, /Dune Imperium/);
    assert.match(activitiesHtml, /Mesa grande/);
    assert.match(activitiesHtml, /Ada/);
    assert.match(activitiesHtml, /Marta/);
    assert.match(activitiesHtml, /4\/6 plazas/);
    assert.match(activitiesHtml, /3 h/);
    assert.match(activitiesHtml, /Mesa cerrada/);
    assert.match(activitiesHtml, /19:00/);
    assert.doesNotMatch(activitiesHtml, /19:00 - 21:00/);
    assert.doesNotMatch(activitiesHtml, /<dt>Duracion<\/dt><dd>120 min<\/dd>/);
    assert.doesNotMatch(activitiesHtml, /capacidad recomendada/);
    assert.doesNotMatch(activitiesHtml, /Mesa cerrada · 1\/5 plazas/);
    assert.equal((activitiesHtml.match(/Asistentes confirmados/g) ?? []).length, 1);

    const catalogPage = await fetch(`${baseUrl}/catalogo?q=dune&type=board-game&page=2`);
    assert.equal(catalogPage.status, 200);
    const catalogHtml = await catalogPage.text();
    assert.match(catalogHtml, /Dune Imperium/);
    assert.match(catalogHtml, /Juego de mesa/);
    assert.match(catalogHtml, /<dt>Jugadores<\/dt><dd>1-4<\/dd>/);
    assert.match(catalogHtml, /Juego de construccion de mazos/);
    assert.match(catalogHtml, /Propietario/);
    assert.match(catalogHtml, /Disponible/);
    assert.match(catalogHtml, /<h2>D<\/h2>/);
    assert.match(catalogHtml, /name="players"/);
    assert.match(catalogHtml, /name="availability"/);
    assert.doesNotMatch(catalogHtml, /name="family"/);
    assert.match(catalogHtml, /src="\/catalogo\/bgg-image\/316554"/);
    assert.match(catalogHtml, /href="\/catalogo\/11"/);
    assert.match(catalogHtml, /href="https:\/\/boardgamegeek\.com\/boardgame\/316554"/);
    assert.match(catalogHtml, /target="_blank" rel="noopener noreferrer">BoardGameGeek/);
    assert.match(catalogHtml, /Mostrando 1 de 25 articulos/);
    assert.match(catalogHtml, /Pagina 2 de 2/);
    assert.match(catalogHtml, /href="\/catalogo\?q=dune&amp;type=board-game&amp;page=1"/);

    const catalogDetailPage = await fetch(`${baseUrl}/catalogo/11`);
    assert.equal(catalogDetailPage.status, 200);
    const catalogDetailHtml = await catalogDetailPage.text();
    assert.match(catalogDetailHtml, /Juego de construccion de mazos, intriga y control de zonas\./);
    assert.match(catalogDetailHtml, /Abrir en BoardGameGeek/);
    assert.match(catalogDetailHtml, /target="_blank" rel="noopener noreferrer">Abrir en BoardGameGeek/);

    const feedbackPage = await fetch(`${baseUrl}/feedback`);
    assert.equal(feedbackPage.status, 200);
    assert.match(await feedbackPage.text(), /Enviar feedback/);

    const signupPage = await fetch(`${baseUrl}/alta`);
    assert.equal(signupPage.status, 200);
    assert.match(await signupPage.text(), /Alta como socio/);

    const invalidSignupResponse = await fetch(`${baseUrl}/alta`, {
      method: 'POST',
      body: new URLSearchParams({ fullName: 'A', contact: 'x' }),
    });
    assert.equal(invalidSignupResponse.status, 400);

    const signupResponse = await fetch(`${baseUrl}/alta`, {
      method: 'POST',
      body: new URLSearchParams({
        fullName: 'Nueva Socia',
        telegramAlias: '@nueva_socia',
        contact: 'nueva@example.test',
        message: 'Quiero jugar campañas',
        acceptedTerms: 'yes',
      }),
    });
    assert.equal(signupResponse.status, 200);
    assert.match(await signupResponse.text(), /Solicitud recibida/);
    assert.equal(memberSignupStore.__records.length, 1);
    assert.equal(memberSignupStore.__summaries.length, 1);
    assert.deepEqual(privateMessages.map((entry) => entry.telegramUserId), [1001]);
    assert.deepEqual(groupMessages.map((entry) => entry.chatId), [-300]);
    assert.equal(memberSignupStore.__summaries[0]?.summary.privateFailed, 1);
    assert.match(privateMessages[0]!.message, /Nueva solicitud de alta como socio/);
    assert.match(privateMessages[0]!.message, /Nueva Socia/);
    assert.match(privateMessages[0]!.message, /@nueva_socia/);

    const adminRedirect = await fetch(`${baseUrl}/admin`, { redirect: 'manual' });
    assert.equal(adminRedirect.status, 303);
    assert.equal(adminRedirect.headers.get('location'), '/admin/login');

    const feedbackResponse = await fetch(`${baseUrl}/feedback`, {
      method: 'POST',
      body: new URLSearchParams({ topic: 'club', message: 'Great club' }),
    });
    assert.equal(feedbackResponse.status, 200);
    assert.match(await readFile(join(tmp, 'feedback.jsonl'), 'utf8'), /Great club/);

    const loginResponse = await fetch(`${baseUrl}/admin/login`, {
      method: 'POST',
      redirect: 'manual',
      body: new URLSearchParams({ password: 'secret-admin' }),
    });
    assert.equal(loginResponse.status, 303);
    const cookie = loginResponse.headers.get('set-cookie');
    assert.ok(cookie);

    const adminPage = await fetch(`${baseUrl}/admin`, { headers: { cookie } });
    assert.equal(adminPage.status, 200);
    const adminHtml = await adminPage.text();
    assert.match(adminHtml, /gameclubtelegrambot/);
    assert.match(adminHtml, /Altas web pendientes/);
    assert.match(adminHtml, /class="admin-toolbar"/);
    assert.match(adminHtml, /class="admin-metrics"/);
    assert.match(adminHtml, /class="admin-section-grid"/);
    assert.match(adminHtml, /Panel operativo/);
    assert.match(adminHtml, /Servicio y logs/);
    assert.match(adminHtml, /href="\/admin\/backups"/);
    assert.match(adminHtml, /href="\/admin\/feedback"/);
    assert.match(adminHtml, /href="\/admin\/member-signups"/);
    assert.match(adminHtml, /href="\/admin\/news"/);
    assert.match(adminHtml, /href="\/admin\/config"/);
    assert.match(adminHtml, /href="\/admin\/activities"/);
    assert.match(adminHtml, /href="\/admin\/catalog"/);
    assert.match(adminHtml, /href="\/admin\/storage"/);
    assert.match(adminHtml, /href="\/admin\/users"/);
    assert.doesNotMatch(adminHtml, /Nou token de Telegram/);
    assert.doesNotMatch(adminHtml, /Restaurar/);
    const csrfToken = extractCsrfToken(adminHtml);

    const maintenancePage = await fetch(`${baseUrl}/admin/service`, { headers: { cookie } });
    assert.equal(maintenancePage.status, 200);
    const maintenanceHtml = await maintenancePage.text();
    assert.doesNotMatch(maintenanceHtml, /Runtime config/);
    assert.doesNotMatch(maintenanceHtml, /Nou token de Telegram/);
    assert.match(maintenanceHtml, /users/);
    assert.doesNotMatch(maintenanceHtml, /Restaurar/);

    const configPage = await fetch(`${baseUrl}/admin/config`, { headers: { cookie } });
    assert.equal(configPage.status, 200);
    const configHtml = await configPage.text();
    assert.match(configHtml, /Configuracion tecnica/);
    assert.match(configHtml, /Runtime config/);
    assert.match(configHtml, /Nou token de Telegram/);
    assert.doesNotMatch(configHtml, /Logs/);

    const backupsPage = await fetch(`${baseUrl}/admin/backups`, { headers: { cookie } });
    assert.equal(backupsPage.status, 200);
    const backupsHtml = await backupsPage.text();
    assert.match(backupsHtml, /Backups/);
    assert.match(backupsHtml, /Crear backup complet/);
    assert.match(backupsHtml, /\/admin\/restore\?backupFilePath=/);

    const webSettingsPage = await fetch(`${baseUrl}/admin/web`, { headers: { cookie } });
    assert.equal(webSettingsPage.status, 200);
    const webSettingsHtml = await webSettingsPage.text();
    assert.match(webSettingsHtml, /Web publica/);
    assert.match(webSettingsHtml, /CAWA Girona/);
    assert.match(webSettingsHtml, /enctype="multipart\/form-data"/);
    assert.match(webSettingsHtml, /Imagenes/);

    const feedbackAdminPage = await fetch(`${baseUrl}/admin/feedback`, { headers: { cookie } });
    assert.equal(feedbackAdminPage.status, 200);
    const feedbackAdminHtml = await feedbackAdminPage.text();
    assert.match(feedbackAdminHtml, /Feedback recibido/);
    assert.match(feedbackAdminHtml, /Great club/);
    assert.match(feedbackAdminHtml, /club/);

    const memberSignupsAdminPage = await fetch(`${baseUrl}/admin/member-signups`, { headers: { cookie } });
    assert.equal(memberSignupsAdminPage.status, 200);
    const memberSignupsAdminHtml = await memberSignupsAdminPage.text();
    assert.match(memberSignupsAdminHtml, /Altas de socio/);
    assert.match(memberSignupsAdminHtml, /Nueva Socia/);
    assert.match(memberSignupsAdminHtml, /nueva@example\.test/);
    assert.match(memberSignupsAdminHtml, /privados 1\/1 fallos/);
    assert.match(memberSignupsAdminHtml, /Contactada/);

    const memberSignupStatusResponse = await fetch(`${baseUrl}/admin/member-signups/1/status`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie },
      body: new URLSearchParams({ csrfToken, status: 'contacted' }),
    });
    assert.equal(memberSignupStatusResponse.status, 303);
    assert.equal(memberSignupStatusResponse.headers.get('location'), '/admin/member-signups');
    assert.ok(queries.some((query) => query.sql.includes('update member_signup_requests') && query.params[0] === 'contacted' && query.params[1] === 1));

    const invalidMemberSignupStatusResponse = await fetch(`${baseUrl}/admin/member-signups/1/status`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie },
      body: new URLSearchParams({ csrfToken, status: 'deleted' }),
    });
    assert.equal(invalidMemberSignupStatusResponse.status, 400);

    const newsAdminPage = await fetch(`${baseUrl}/admin/news`, { headers: { cookie } });
    assert.equal(newsAdminPage.status, 200);
    const newsAdminHtml = await newsAdminPage.text();
    assert.match(newsAdminHtml, /Noticias y feeds/);
    assert.match(newsAdminHtml, /2 grupos activos/);
    assert.match(newsAdminHtml, /nuevos_miembros/);

    const adminUsersPage = await fetch(`${baseUrl}/admin/users`, { headers: { cookie } });
    assert.equal(adminUsersPage.status, 200);
    const adminUsersHtml = await adminUsersPage.text();
    assert.match(adminUsersHtml, /Socios y usuarios/);
    assert.match(adminUsersHtml, /Ada/);
    assert.match(adminUsersHtml, /\/admin\/resources\/users/);

    const adminActivitiesPage = await fetch(`${baseUrl}/admin/activities`, { headers: { cookie } });
    assert.equal(adminActivitiesPage.status, 200);
    const adminActivitiesHtml = await adminActivitiesPage.text();
    assert.match(adminActivitiesHtml, /Actividades admin/);
    assert.match(adminActivitiesHtml, /Partida abierta/);
    assert.match(adminActivitiesHtml, /\/admin\/resources\/schedule_events/);

    const adminCatalogPage = await fetch(`${baseUrl}/admin/catalog`, { headers: { cookie } });
    assert.equal(adminCatalogPage.status, 200);
    const adminCatalogHtml = await adminCatalogPage.text();
    assert.match(adminCatalogHtml, /Catalogo admin/);
    assert.match(adminCatalogHtml, /Dune Imperium/);
    assert.match(adminCatalogHtml, /Juego de mesa/);
    assert.match(adminCatalogHtml, /\/admin\/resources\/catalog_items/);

    const adminStorageRootPage = await fetch(`${baseUrl}/admin/storage`, { headers: { cookie } });
    assert.equal(adminStorageRootPage.status, 200);
    const adminStorageRootHtml = await adminStorageRootPage.text();
    assert.match(adminStorageRootHtml, /Storage admin/);
    assert.match(adminStorageRootHtml, /Categorias principales/);
    assert.match(adminStorageRootHtml, /Reglamentos/);
    assert.match(adminStorageRootHtml, /\/admin\/storage\?categoryId=3/);
    assert.doesNotMatch(adminStorageRootHtml, /Manual de campaña/);

    const adminStorageCategoryPage = await fetch(`${baseUrl}/admin/storage?categoryId=3`, { headers: { cookie } });
    assert.equal(adminStorageCategoryPage.status, 200);
    const adminStorageCategoryHtml = await adminStorageCategoryPage.text();
    assert.match(adminStorageCategoryHtml, /Categoria: Reglamentos/);
    assert.match(adminStorageCategoryHtml, /Ayudas de juego/);
    assert.match(adminStorageCategoryHtml, /Manual de campaña/);
    assert.match(adminStorageCategoryHtml, /Entradas directas/);
    assert.match(adminStorageCategoryHtml, /src="\/admin\/storage\/media\/55"/);
    assert.match(adminStorageCategoryHtml, /Subido por Ada/);
    assert.match(adminStorageCategoryHtml, /\/admin\/storage\/entries\/55\/edit/);
    assert.match(adminStorageCategoryHtml, /\/admin\/storage\/categories\/3\/edit/);

    const adminStoragePage = await fetch(`${baseUrl}/admin/storage?q=manual`, { headers: { cookie } });
    assert.equal(adminStoragePage.status, 200);
    const adminStorageHtml = await adminStoragePage.text();
    assert.match(adminStorageHtml, /Storage admin/);
    assert.match(adminStorageHtml, /Resultados de busqueda/);
    assert.match(adminStorageHtml, /Manual de campaña/);
    assert.match(adminStorageHtml, /Reglamentos/);
    assert.match(adminStorageHtml, /#rol/);
    assert.doesNotMatch(adminStorageHtml, /<strong>#55<\/strong>/);
    assert.match(adminStorageHtml, /\/admin\/storage\/entries\/55\/edit/);

    const storageEntryEditPage = await fetch(`${baseUrl}/admin/storage/entries/55/edit`, { headers: { cookie } });
    assert.equal(storageEntryEditPage.status, 200);
    const storageEntryEditHtml = await storageEntryEditPage.text();
    assert.match(storageEntryEditHtml, /Editar Storage #55/);
    assert.match(storageEntryEditHtml, /rol, pdf/);

    const storageEntryUpdateResponse = await fetch(`${baseUrl}/admin/storage/entries/55/edit`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie },
      body: new URLSearchParams({ csrfToken, categoryId: '3', lifecycleStatus: 'active', tags: 'rol, ayuda', description: 'Manual actualizado' }),
    });
    assert.equal(storageEntryUpdateResponse.status, 303);
    assert.equal(storageEntryUpdateResponse.headers.get('location'), '/admin/storage');
    assert.ok(queries.some((query) => query.sql.includes('update storage_entries') && query.params[0] === 3 && query.params[2] === '["ayuda","rol"]'));

    const storageEntryDeletePage = await fetch(`${baseUrl}/admin/storage/entries/55/delete`, { headers: { cookie } });
    assert.equal(storageEntryDeletePage.status, 200);
    assert.match(await storageEntryDeletePage.text(), /No borra fisicamente/);

    const storageEntryDeleteResponse = await fetch(`${baseUrl}/admin/storage/entries/55/delete`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie },
      body: new URLSearchParams({ csrfToken, confirm: 'DELETE' }),
    });
    assert.equal(storageEntryDeleteResponse.status, 303);
    assert.ok(queries.some((query) => query.sql.includes("set lifecycle_status = 'deleted'") && query.params[0] === 55));

    const storageCategoryEditResponse = await fetch(`${baseUrl}/admin/storage/categories/3/edit`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie },
      body: new URLSearchParams({
        csrfToken,
        displayName: 'Reglamentos revisados',
        slug: 'reglamentos',
        parentCategoryId: '',
        categoryPurpose: 'user_uploads',
        lifecycleStatus: 'active',
        storageChatId: '-100',
        storageThreadId: '12',
        description: 'PDFs',
      }),
    });
    assert.equal(storageCategoryEditResponse.status, 303);
    assert.ok(queries.some((query) => query.sql.includes('update storage_categories') && query.params[0] === 'Reglamentos revisados'));

    const uploadBoundary = '----gameclub-test-boundary';
    const uploadLogoResponse = await fetch(`${baseUrl}/admin/web/assets`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${uploadBoundary}` },
      body: buildMultipartBody(uploadBoundary, { csrfToken, target: 'logo' }, {
        name: 'asset',
        filename: 'logo.png',
        contentType: 'image/png',
        content: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      }) as unknown as BodyInit,
    });
    assert.equal(uploadLogoResponse.status, 303);
    assert.equal(uploadLogoResponse.headers.get('location'), '/admin/web');

    const invalidUploadBoundary = '----gameclub-invalid-upload';
    const invalidUploadResponse = await fetch(`${baseUrl}/admin/web/assets`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${invalidUploadBoundary}` },
      body: buildMultipartBody(invalidUploadBoundary, { csrfToken, target: 'hero' }, {
        name: 'asset',
        filename: 'note.txt',
        contentType: 'text/plain',
        content: Buffer.from('not an image'),
      }) as unknown as BodyInit,
    });
    assert.equal(invalidUploadResponse.status, 400);

    const saveWebSettingsResponse = await fetch(`${baseUrl}/admin/web`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie },
      body: new URLSearchParams({
        csrfToken,
        brandName: 'Club Test',
        brandHeadline: 'Mesa abierta',
        primaryColor: '#184b1f',
        theme: 'tabletop',
        homeIntro: '<b>Intro escapada</b>',
        clubSummary: 'Resumen del club',
        clubAddress: 'Carrer Major',
        clubOpeningHours: 'Viernes tarde',
        clubContact: 'club@example.test',
        clubRules: 'Respeta el local',
        featuredLabel1: 'Feedback publico',
        featuredUrl1: '/feedback?from=home',
        featuredLabel2: 'No se guarda',
        featuredUrl2: 'javascript:alert(1)',
      }),
    });
    assert.equal(saveWebSettingsResponse.status, 303);
    assert.equal(saveWebSettingsResponse.headers.get('location'), '/admin/web');

    const updatedWelcomePage = await fetch(`${baseUrl}/`);
    const updatedWelcomeHtml = await updatedWelcomePage.text();
    assert.match(updatedWelcomeHtml, /Club Test/);
    assert.match(updatedWelcomeHtml, /Mesa abierta/);
    assert.match(updatedWelcomeHtml, /data-theme="tabletop"/);
    assert.doesNotMatch(updatedWelcomeHtml, /<b>Intro escapada<\/b>/);
    assert.match(updatedWelcomeHtml, /&lt;b&gt;Intro escapada&lt;\/b&gt;/);
    assert.match(updatedWelcomeHtml, /class="brand-logo"/);
    assert.match(updatedWelcomeHtml, /href="\/feedback\?from=home"/);
    assert.doesNotMatch(updatedWelcomeHtml, /javascript:alert/);
    const logoPath = updatedWelcomeHtml.match(/src="(\/assets\/logo-[^"]+\.png)"/)?.[1];
    assert.ok(logoPath);
    const logoResponse = await fetch(`${baseUrl}${logoPath}`);
    assert.equal(logoResponse.status, 200);
    assert.equal(logoResponse.headers.get('content-type'), 'image/png');

    const serviceResponse = await fetch(`${baseUrl}/admin/service`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie },
      body: new URLSearchParams({ csrfToken, action: 'start' }),
    });
    assert.equal(serviceResponse.status, 303);
    assert.deepEqual(serviceActions, ['start']);

    const stopWithoutConfirmationResponse = await fetch(`${baseUrl}/admin/service`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie },
      body: new URLSearchParams({ csrfToken, action: 'stop' }),
    });
    assert.equal(stopWithoutConfirmationResponse.status, 400);

    const stopConfirmPage = await fetch(`${baseUrl}/admin/service/confirm?action=stop`, { headers: { cookie } });
    assert.equal(stopConfirmPage.status, 200);
    assert.match(await stopConfirmPage.text(), /STOP/);

    const stopResponse = await fetch(`${baseUrl}/admin/service`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie },
      body: new URLSearchParams({ csrfToken, action: 'stop', confirm: 'STOP' }),
    });
    assert.equal(stopResponse.status, 303);
    assert.deepEqual(serviceActions, ['start', 'stop']);

    const csrfFailureResponse = await fetch(`${baseUrl}/admin/service`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie },
      body: new URLSearchParams({ action: 'restart' }),
    });
    assert.equal(csrfFailureResponse.status, 403);

    const restoreResponse = await fetch(`${baseUrl}/admin/restore`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie },
      body: new URLSearchParams({ csrfToken, backupFilePath: backupPath }),
    });
    assert.equal(restoreResponse.status, 400);
    assert.deepEqual(restored, []);

    const restoreConfirmPage = await fetch(`${baseUrl}/admin/restore?backupFilePath=${encodeURIComponent(backupPath)}`, { headers: { cookie } });
    assert.equal(restoreConfirmPage.status, 200);
    assert.match(await restoreConfirmPage.text(), /RESTORE/);

    const confirmedRestoreResponse = await fetch(`${baseUrl}/admin/restore`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie },
      body: new URLSearchParams({ csrfToken, backupFilePath: backupPath, confirm: 'RESTORE' }),
    });
    assert.equal(confirmedRestoreResponse.status, 303);
    assert.equal(confirmedRestoreResponse.headers.get('location'), '/admin/backups');
    assert.deepEqual(restored, [backupPath]);

    const resourcesPage = await fetch(`${baseUrl}/admin/resources/users`, { headers: { cookie } });
    assert.equal(resourcesPage.status, 200);
    const resourcesHtml = await resourcesPage.text();
    assert.match(resourcesHtml, /Ada/);
    assert.match(resourcesHtml, /csrfToken/);
    assert.match(resourcesHtml, /Borrado definitivo/);

    const editResponse = await fetch(`${baseUrl}/admin/resources/users/42/edit`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie },
      body: new URLSearchParams({ csrfToken, display_name: 'Ada Lovelace', is_admin: 'true' }),
    });
    assert.equal(editResponse.status, 303);
    assert.ok(queries.some((query) => query.sql.includes('update "users" set')));

    const userActionResponse = await fetch(`${baseUrl}/admin/resources/users/42/user-action`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie },
      body: new URLSearchParams({ csrfToken, action: 'approved' }),
    });
    assert.equal(userActionResponse.status, 303);
    assert.ok(queries.some((query) => query.sql.includes('insert into "user_status_audit_log"')));

    const hardDeletePage = await fetch(`${baseUrl}/admin/resources/users/42/delete`, { headers: { cookie } });
    assert.equal(hardDeletePage.status, 200);
    assert.match(await hardDeletePage.text(), /DELETE/);

    const hardDeleteWithoutConfirmationResponse = await fetch(`${baseUrl}/admin/resources/users/42/delete`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie },
      body: new URLSearchParams({ csrfToken, mode: 'hard' }),
    });
    assert.equal(hardDeleteWithoutConfirmationResponse.status, 400);

    const hardDeleteResponse = await fetch(`${baseUrl}/admin/resources/users/42/delete`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie },
      body: new URLSearchParams({ csrfToken, mode: 'hard', confirm: 'DELETE' }),
    });
    assert.equal(hardDeleteResponse.status, 303);
    assert.ok(queries.some((query) => query.sql.includes('delete from "users"')));

    const previousEnvPath = process.env.GAMECLUB_ENV_PATH;
    process.env.GAMECLUB_ENV_PATH = join(tmp, '.env');
    try {
      const pendingToken = '123456789:ABCDEFGHIJKLMNOPQRST_uvwx';
      const tokenResponse = await fetch(`${baseUrl}/admin/token`, {
        method: 'POST',
        headers: { cookie },
        body: new URLSearchParams({ csrfToken, token: pendingToken }),
      });
      assert.equal(tokenResponse.status, 200);
      const tokenConfirmationHtml = await tokenResponse.text();
      assert.match(tokenConfirmationHtml, /CHANGE_TOKEN/);
      assert.equal(tokenConfirmationHtml.includes(pendingToken), false);
      assert.rejects(readFile(join(tmp, '.env'), 'utf8'));

      const tokenConfirmFailure = await fetch(`${baseUrl}/admin/token-confirm`, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie },
        body: new URLSearchParams({ csrfToken, confirm: 'WRONG' }),
      });
      assert.equal(tokenConfirmFailure.status, 400);

      const tokenConfirmResponse = await fetch(`${baseUrl}/admin/token-confirm`, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie },
        body: new URLSearchParams({ csrfToken, confirm: 'CHANGE_TOKEN' }),
      });
      assert.equal(tokenConfirmResponse.status, 303);
      assert.equal(tokenConfirmResponse.headers.get('location'), '/admin/config');
      assert.match(await readFile(join(tmp, '.env'), 'utf8'), /GAMECLUB_TELEGRAM_TOKEN/);
    } finally {
      if (previousEnvPath === undefined) {
        delete process.env.GAMECLUB_ENV_PATH;
      } else {
        process.env.GAMECLUB_ENV_PATH = previousEnvPath;
      }
    }

    const deleteBackupResponse = await fetch(`${baseUrl}/admin/delete-backup`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie },
      body: new URLSearchParams({ csrfToken, backupFilePath: backupPath }),
    });
    assert.equal(deleteBackupResponse.status, 400);

    const deleteBackupConfirmPage = await fetch(`${baseUrl}/admin/delete-backup?backupFilePath=${encodeURIComponent(backupPath)}`, { headers: { cookie } });
    assert.equal(deleteBackupConfirmPage.status, 200);
    assert.match(await deleteBackupConfirmPage.text(), /DELETE/);

    const confirmedDeleteBackupResponse = await fetch(`${baseUrl}/admin/delete-backup`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie },
      body: new URLSearchParams({ csrfToken, backupFilePath: backupPath, confirm: 'DELETE' }),
    });
    assert.equal(confirmedDeleteBackupResponse.status, 303);
    assert.equal(confirmedDeleteBackupResponse.headers.get('location'), '/admin/backups');
  } finally {
    await server.stop();
    await rm(tmp, { recursive: true, force: true });
  }
});

function extractCsrfToken(html: string): string {
  const match = html.match(/name="csrfToken" value="([^"]+)"/);
  assert.ok(match?.[1]);
  return match[1];
}

function buildMultipartBody(
  boundary: string,
  fields: Record<string, string>,
  file: { name: string; filename: string; contentType: string; content: Buffer },
): Buffer {
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8'));
  }
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`, 'utf8'));
  chunks.push(file.content);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));
  return Buffer.concat(chunks);
}

function createMemoryWebSettingsStore(): WebSettingsStore {
  let settings: WebSettings = defaultWebSettings;

  return {
    async load() {
      return settings;
    },
    async save(nextSettings) {
      settings = normalizeWebSettings(nextSettings);
    },
  };
}

function createMemoryMemberSignupStore(): MemberSignupStore & {
  __records: MemberSignupRecord[];
  __summaries: Array<{ id: number; summary: Record<string, unknown> }>;
} {
  const records: MemberSignupRecord[] = [];
  const summaries: Array<{ id: number; summary: Record<string, unknown> }> = [];

  return {
    __records: records,
    __summaries: summaries,
    async create(input: MemberSignupInput) {
      const record: MemberSignupRecord = {
        ...input,
        id: records.length + 1,
        status: 'pending',
        source: 'web',
        notificationSummary: null,
        createdAt: '2026-05-19T18:00:00.000Z',
        updatedAt: '2026-05-19T18:00:00.000Z',
        resolvedAt: null,
      };
      records.push(record);
      return record;
    },
    async updateNotificationSummary(id, summary) {
      summaries.push({ id, summary });
    },
  };
}

async function findFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  if (typeof address !== 'object' || address === null) {
    throw new Error('Could not allocate test port');
  }
  return address.port;
}
