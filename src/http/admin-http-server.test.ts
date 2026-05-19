import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

import { createAdminHttpServer } from './admin-http-server.js';
import { hashSecret } from '../security/password-hash.js';
import type { RuntimeConfig } from '../config/runtime-config.js';
import { defaultWebSettings, type WebSettings, type WebSettingsStore } from './web-settings-store.js';

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
    stopService: async () => {},
    restartService: async () => {},
    readRecentLogs: async () => 'service logs',
  };
  const serviceActions: string[] = [];
  const restored: string[] = [];
  const queries: Array<{ sql: string; params: unknown[] }> = [];
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
            }],
          };
        }
        if (sql.includes('from catalog_items items')) {
          return {
            rows: [{
              id: 11,
              display_name: 'Dune Imperium',
              item_type: 'board-game',
              family_name: 'Juegos de mesa',
              group_name: 'Estrategia',
              publisher: 'Dire Wolf',
              publication_year: 2020,
              player_count_min: 1,
              player_count_max: 4,
              recommended_age: 14,
              play_time_minutes: 120,
            }],
          };
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

  const server = createAdminHttpServer({
    config,
    services: { database: database as never },
    logger: { info() {}, error() {} },
    appRoot: tmp,
    backupOperations,
    serviceControl,
    webSettingsStore,
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
    assert.match(welcomeHtml, /href="\/actividades"/);
    assert.match(welcomeHtml, /href="\/catalogo"/);
    assert.match(welcomeHtml, /href="\/club"/);

    const clubPage = await fetch(`${baseUrl}/club`);
    assert.equal(clubPage.status, 200);
    assert.match(await clubPage.text(), /CAWA Girona es un club multidisciplinar/);

    const activitiesPage = await fetch(`${baseUrl}/actividades`);
    assert.equal(activitiesPage.status, 200);
    const activitiesHtml = await activitiesPage.text();
    assert.match(activitiesHtml, /Partida abierta/);
    assert.match(activitiesHtml, /2\/6 plazas/);

    const catalogPage = await fetch(`${baseUrl}/catalogo?q=dune&type=board-game`);
    assert.equal(catalogPage.status, 200);
    const catalogHtml = await catalogPage.text();
    assert.match(catalogHtml, /Dune Imperium/);
    assert.match(catalogHtml, /Juego de mesa/);
    assert.match(catalogHtml, /Jugadores: 1-4/);

    const feedbackPage = await fetch(`${baseUrl}/feedback`);
    assert.equal(feedbackPage.status, 200);
    assert.match(await feedbackPage.text(), /Enviar feedback/);

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
    assert.match(adminHtml, /gameclubtelegrambot\.service/);
    assert.match(adminHtml, /Runtime config/);
    assert.match(adminHtml, /users/);
    assert.match(adminHtml, /Restaurar/);
    const csrfToken = extractCsrfToken(adminHtml);

    const webSettingsPage = await fetch(`${baseUrl}/admin/web`, { headers: { cookie } });
    assert.equal(webSettingsPage.status, 200);
    const webSettingsHtml = await webSettingsPage.text();
    assert.match(webSettingsHtml, /Web publica/);
    assert.match(webSettingsHtml, /CAWA Girona/);

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

    const serviceResponse = await fetch(`${baseUrl}/admin/service`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie },
      body: new URLSearchParams({ csrfToken, action: 'start' }),
    });
    assert.equal(serviceResponse.status, 303);
    assert.deepEqual(serviceActions, ['start']);

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
    assert.equal(restoreResponse.status, 303);
    assert.deepEqual(restored, [backupPath]);

    const resourcesPage = await fetch(`${baseUrl}/admin/resources/users`, { headers: { cookie } });
    assert.equal(resourcesPage.status, 200);
    const resourcesHtml = await resourcesPage.text();
    assert.match(resourcesHtml, /Ada/);
    assert.match(resourcesHtml, /csrfToken/);

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

    const previousEnvPath = process.env.GAMECLUB_ENV_PATH;
    process.env.GAMECLUB_ENV_PATH = join(tmp, '.env');
    try {
      const tokenResponse = await fetch(`${baseUrl}/admin/token`, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie },
        body: new URLSearchParams({ csrfToken, token: '123456789:ABCDEFGHIJKLMNOPQRST_uvwx' }),
      });
      assert.equal(tokenResponse.status, 303);
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
    assert.equal(deleteBackupResponse.status, 303);
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

function createMemoryWebSettingsStore(): WebSettingsStore {
  let settings: WebSettings = defaultWebSettings;

  return {
    async load() {
      return settings;
    },
    async save(nextSettings) {
      settings = nextSettings;
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
