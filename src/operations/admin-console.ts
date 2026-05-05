import { readFile } from 'node:fs/promises';

import { resolveRuntimeConfigPaths } from '../config/runtime-config-files.js';
import { loadRuntimeConfig, RuntimeConfigError } from '../config/load-runtime-config.js';
import { createPostgresConnectionString, connectPostgresDatabase } from '../infrastructure/database/connection.js';
import { createServiceControl, type ServiceStatus } from './service-control.js';
import { readDatabaseSummaryForConfig } from './database-summary.js';

export interface AdminConsoleUserRecord {
  telegramUserId: number;
  username: string | null;
  displayName: string;
  status: 'pending' | 'approved' | 'blocked' | 'revoked';
  isAdmin: boolean;
  isApproved: boolean;
}

export interface AdminConsoleContentSummary {
  catalogItems: number;
  catalogGroups: number;
  catalogFamilies: number;
  catalogLoans: number;
  storageCategories: number;
  storageEntries: number;
  storageMessages: number;
  scheduleEvents: number;
  venueEvents: number;
  groupPurchases: number;
}

export interface AdminConsoleUserSummary {
  total: number;
  pending: number;
  approved: number;
  blocked: number;
  revoked: number;
  admins: number;
  latest: AdminConsoleUserRecord[];
}

export interface AdminConsoleAdminSummary {
  total: number;
  admins: AdminConsoleUserRecord[];
}

export interface AdminConsoleMessageRecord {
  id: number;
  source: 'audit' | 'storage_message';
  summary: string;
  createdAt: string;
}

export interface AdminConsoleRuntimeSnapshot {
  generatedAt: string;
  config: {
    resolvedConfigPath: string;
    resolvedEnvPath: string;
    state: 'loaded' | 'invalid' | 'missing';
    summary: string;
    rawConfigText: string;
    rawEnvText: string;
    botPublicName: string | null;
    botClubName: string | null;
    botLanguage: string | null;
    databaseHost: string | null;
    databaseName: string | null;
    databaseUser: string | null;
    databasePort: number | null;
    validationError: string | null;
  };
  service: ServiceStatus;
  database: {
    available: boolean;
    state: string;
    summary: string;
  };
  users: AdminConsoleUserSummary;
  admins: AdminConsoleAdminSummary;
  content: AdminConsoleContentSummary;
  messages: AdminConsoleMessageRecord[];
}

export interface AdminConsoleUserStatusUpdate {
  telegramUserId: number;
  nextStatus: 'pending' | 'approved' | 'blocked' | 'revoked';
  reason?: string;
  operatorTelegramUserId: number;
}

export interface AdminConsoleAdminToggle {
  telegramUserId: number;
  isAdmin: boolean;
  reason?: string;
  operatorTelegramUserId: number;
}

export interface AdminConsoleOperations {
  readSnapshot(): Promise<AdminConsoleRuntimeSnapshot>;
  startService(): Promise<void>;
  stopService(): Promise<void>;
  restartService(): Promise<void>;
  readRecentLogs(lines?: number): Promise<string>;
  listUsersByStatus(status: 'pending' | 'approved' | 'blocked' | 'revoked'): Promise<AdminConsoleUserRecord[]>;
  listAdmins(): Promise<AdminConsoleUserRecord[]>;
  updateUserStatus(input: AdminConsoleUserStatusUpdate): Promise<void>;
  updateUserAdmin(input: AdminConsoleAdminToggle): Promise<void>;
}

export interface CreateAdminConsoleOperationsOptions {
  serviceName?: string;
  env?: Record<string, string | undefined>;
}

interface DatabaseClient {
  query(sqlText: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  close(): Promise<void>;
}

export function createAdminConsoleOperations(options: CreateAdminConsoleOperationsOptions = {}): AdminConsoleOperations {
  const env = options.env ?? process.env;
  const runtimePaths = resolveRuntimeConfigPaths(env);
  const service = createServiceControl({
    serviceName: options.serviceName ?? 'gameclubtelegrambot.service',
  });

  return {
    async readSnapshot() {
      const now = new Date().toISOString();
      let rawConfigText = '';
      let rawEnvText = '';
      let configError: string | null = null;

      try {
        rawConfigText = await safeReadText(runtimePaths.configPath);
      } catch {
        rawConfigText = '<no se puede leer runtime.json>';
      }

      try {
        rawEnvText = await safeReadText(runtimePaths.envPath);
      } catch {
        rawEnvText = '<no se puede leer .env>';
      }

      let runtimeConfig: Awaited<ReturnType<typeof loadRuntimeConfig>> | null = null;
      try {
        runtimeConfig = await loadRuntimeConfig({
          env: {
            ...env,
            GAMECLUB_CONFIG_PATH: runtimePaths.configPath,
            GAMECLUB_ENV_PATH: runtimePaths.envPath,
          },
        });
      } catch (error) {
        if (error instanceof RuntimeConfigError) {
          configError = error.message;
        } else if (error instanceof Error) {
          configError = error.message;
        } else {
          configError = 'Error desconegut carregant la configuracio';
        }
      }

      const serviceStatus = await service.getServiceStatus();
      const users = await buildUserSummary(runtimeConfig);
      const admins = await buildAdminSummary(runtimeConfig);
      const content = await buildContentSummary(runtimeConfig);
      const messages = await buildRecentMessages(runtimeConfig);

      const dbAvailable = runtimeConfig !== null;
      let databaseSummary = 'No hi ha connexio a la base de dades';

      if (dbAvailable && runtimeConfig) {
        try {
          const dbSummary = await readDatabaseSummaryForConfig({ config: runtimeConfig });
          const knownCounts =
            dbSummary.knownTableCounts.length > 0
              ? dbSummary.knownTableCounts.map((entry) => `${entry.tableName}: ${entry.rowCount}`).join(' · ')
              : 'cap dada resum';
          databaseSummary =
            `Connected · ${dbSummary.databaseName}@${dbSummary.host}:${dbSummary.port} · ` +
            `taules ${dbSummary.totalTables} · mida ${formatBytes(dbSummary.sizeBytes)} · ${knownCounts}`;
        } catch {
          databaseSummary = 'Consulta de resum DB fallida';
        }
      }

      return {
        generatedAt: now,
        config: {
          resolvedConfigPath: runtimePaths.configPath,
          resolvedEnvPath: runtimePaths.envPath,
          state: configError ? (runtimeConfig ? 'invalid' : 'missing') : 'loaded',
          summary: configError
            ? `Error de validacio: ${configError}`
            : `Configuracio carregada: ${runtimeConfig?.bot.publicName ?? 'sense nom'}`,
          rawConfigText,
          rawEnvText,
          botPublicName: runtimeConfig?.bot.publicName ?? null,
          botClubName: runtimeConfig?.bot.clubName ?? null,
          botLanguage: runtimeConfig?.bot.language ?? null,
          databaseHost: runtimeConfig?.database.host ?? null,
          databaseName: runtimeConfig?.database.name ?? null,
          databaseUser: runtimeConfig?.database.user ?? null,
          databasePort: runtimeConfig?.database.port ?? null,
          validationError: configError,
        },
        service: serviceStatus,
        database: {
          available: dbAvailable,
          state: dbAvailable ? 'Disponible' : 'No disponible',
          summary: databaseSummary,
        },
        users,
        admins,
        content,
        messages,
      };
    },

    async startService() {
      await service.startService();
    },

    async stopService() {
      await service.stopService();
    },

    async restartService() {
      await service.restartService();
    },

    async readRecentLogs(lines = 120) {
      return service.readRecentLogs({ lines });
    },

    async listUsersByStatus(status) {
      const runtimeConfig = await loadRuntimeConfigOrNull(env, runtimePaths);
      if (!runtimeConfig) {
        return [];
      }

      return queryUsersByStatus(runtimeConfig, status);
    },

    async listAdmins() {
      const runtimeConfig = await loadRuntimeConfigOrNull(env, runtimePaths);
      if (!runtimeConfig) {
        return [];
      }

      return queryAdmins(runtimeConfig);
    },

    async updateUserStatus(input) {
      const runtimeConfig = await loadRuntimeConfigOrNull(env, runtimePaths);
      if (!runtimeConfig) {
        throw new Error('No s\'ha pogut carregar la configuracio del runtime per editar usuaris.');
      }

      await updateUserStatus(runtimeConfig, input);
    },

    async updateUserAdmin(input) {
      const runtimeConfig = await loadRuntimeConfigOrNull(env, runtimePaths);
      if (!runtimeConfig) {
        throw new Error('No s\'ha pogut carregar la configuracio del runtime per editar usuaris.');
      }

      await updateUserAdmin(runtimeConfig, input);
    },
  };
}

async function buildUserSummary(runtimeConfig: Awaited<ReturnType<typeof loadRuntimeConfig>> | null): Promise<AdminConsoleUserSummary> {
  if (!runtimeConfig) {
    return { total: 0, pending: 0, approved: 0, blocked: 0, revoked: 0, admins: 0, latest: [] };
  }

  try {
    const client = await connectDatabaseClient(runtimeConfig);
    try {
      const totalsRows = await queryRows(
        client,
        `select status, is_admin, count(*)::bigint as total from users group by status, is_admin`,
      );
      const latestRows = await queryRows(
        client,
        `select telegram_user_id, username, display_name, status, is_admin, is_approved from users order by created_at desc nulls last limit 12`,
      );

      let total = 0;
      let pending = 0;
      let approved = 0;
      let blocked = 0;
      let revoked = 0;
      let admins = 0;

      for (const row of totalsRows) {
        const count = toNumber(row.total);
        total += count;
        const status = String(row.status);
        if (status === 'pending') {
          pending += count;
        }
        if (status === 'approved') {
          approved += count;
        }
        if (status === 'blocked') {
          blocked += count;
        }
        if (status === 'revoked') {
          revoked += count;
        }
        if (toBoolean(row.is_admin)) {
          admins += count;
        }
      }

      return {
        total,
        pending,
        approved,
        blocked,
        revoked,
        admins,
        latest: latestRows.map((row) => ({
          telegramUserId: toNumber(row.telegram_user_id),
          username: typeof row.username === 'string' ? row.username : null,
          displayName: String(row.display_name ?? `Usuari ${toNumber(row.telegram_user_id)}`),
          status: String(row.status) as AdminConsoleUserRecord['status'],
          isAdmin: toBoolean(row.is_admin),
          isApproved: toBoolean(row.is_approved),
        })),
      };
    } finally {
      await client.close();
    }
  } catch {
    return { total: 0, pending: 0, approved: 0, blocked: 0, revoked: 0, admins: 0, latest: [] };
  }
}

async function buildAdminSummary(runtimeConfig: Awaited<ReturnType<typeof loadRuntimeConfig>> | null): Promise<AdminConsoleAdminSummary> {
  if (!runtimeConfig) {
    return { total: 0, admins: [] };
  }

  try {
    const client = await connectDatabaseClient(runtimeConfig);
    try {
      const rows = await queryRows(
        client,
        `select telegram_user_id, username, display_name, status, is_admin, is_approved
           from users
          where is_admin = true
          order by is_approved desc, telegram_user_id`,
      );

      return {
        total: rows.length,
        admins: rows.map((row) => ({
          telegramUserId: toNumber(row.telegram_user_id),
          username: typeof row.username === 'string' ? row.username : null,
          displayName: String(row.display_name ?? `Usuari ${toNumber(row.telegram_user_id)}`),
          status: String(row.status) as AdminConsoleUserRecord['status'],
          isAdmin: true,
          isApproved: toBoolean(row.is_approved),
        })),
      };
    } finally {
      await client.close();
    }
  } catch {
    return { total: 0, admins: [] };
  }
}

async function buildContentSummary(runtimeConfig: Awaited<ReturnType<typeof loadRuntimeConfig>> | null): Promise<AdminConsoleContentSummary> {
  if (!runtimeConfig) {
    return {
      catalogItems: 0,
      catalogGroups: 0,
      catalogFamilies: 0,
      catalogLoans: 0,
      storageCategories: 0,
      storageEntries: 0,
      storageMessages: 0,
      scheduleEvents: 0,
      venueEvents: 0,
      groupPurchases: 0,
    };
  }

  try {
    const client = await connectDatabaseClient(runtimeConfig);
    try {
      return {
        catalogItems: await safeCount(client, 'select count(*)::bigint as value from catalog_items'),
        catalogGroups: await safeCount(client, 'select count(*)::bigint as value from catalog_groups'),
        catalogFamilies: await safeCount(client, 'select count(*)::bigint as value from catalog_families'),
        catalogLoans: await safeCount(client, 'select count(*)::bigint as value from catalog_loans'),
        storageCategories: await safeCount(client, 'select count(*)::bigint as value from storage_categories'),
        storageEntries: await safeCount(client, 'select count(*)::bigint as value from storage_entries'),
        storageMessages: await safeCount(client, 'select count(*)::bigint as value from storage_entry_messages'),
        scheduleEvents: await safeCount(
          client,
          `select count(*)::bigint as value from schedule_events where lifecycle_status = 'scheduled'`,
        ),
        venueEvents: await safeCount(
          client,
          `select count(*)::bigint as value from venue_events where lifecycle_status = 'scheduled'`,
        ),
        groupPurchases: await safeCount(client, `select count(*)::bigint as value from group_purchases where lifecycle_status = 'open'`),
      };
    } finally {
      await client.close();
    }
  } catch {
    return {
      catalogItems: 0,
      catalogGroups: 0,
      catalogFamilies: 0,
      catalogLoans: 0,
      storageCategories: 0,
      storageEntries: 0,
      storageMessages: 0,
      scheduleEvents: 0,
      venueEvents: 0,
      groupPurchases: 0,
    };
  }
}

async function buildRecentMessages(runtimeConfig: Awaited<ReturnType<typeof loadRuntimeConfig>> | null): Promise<AdminConsoleMessageRecord[]> {
  if (!runtimeConfig) {
    return [];
  }

  try {
    const client = await connectDatabaseClient(runtimeConfig);
    try {
      const rows = await queryRows(
        client,
        `select id, action_key as actionKey, summary, created_at as createdAt from audit_log order by created_at desc limit 12`,
      );
      const storageRows = await queryRows(
        client,
        `select sem.id, sem.storage_message_id, sem.storage_chat_id, sem.attachment_kind as attachmentKind, sem.storage_thread_id as storageThreadId, sem.created_at as createdAt
         from storage_entry_messages sem
         order by sem.created_at desc limit 12`,
      );

      const messages: AdminConsoleMessageRecord[] = [];
      for (const row of rows) {
        messages.push({
          id: toNumber(row.id),
          source: 'audit',
          summary: `${String(row.actionKey ?? 'audit')} · ${String(row.summary ?? '')}`,
          createdAt: formatIso(row.createdAt),
        });
      }
      for (const row of storageRows) {
        messages.push({
          id: toNumber(row.id) + 100000,
          source: 'storage_message',
          summary: `Missatge storage #${toNumber(row.storage_message_id)} chat ${toNumber(row.storage_chat_id)} tipus ${String(row.attachmentKind)}`,
          createdAt: formatIso(row.createdAt),
        });
      }

      return messages.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)).slice(0, 24);
    } finally {
      await client.close();
    }
  } catch {
    return [];
  }
}

async function queryUsersByStatus(
  runtimeConfig: Awaited<ReturnType<typeof loadRuntimeConfig>>,
  status: 'pending' | 'approved' | 'blocked' | 'revoked',
): Promise<AdminConsoleUserRecord[]> {
  try {
    const client = await connectDatabaseClient(runtimeConfig);
    try {
      const rows = await queryRows(
        client,
        `select telegram_user_id, username, display_name, status, is_admin, is_approved
         from users
         where status = $1
         order by telegram_user_id`,
        [status],
      );
      return rows.map((row) => ({
        telegramUserId: toNumber(row.telegram_user_id),
        username: typeof row.username === 'string' ? row.username : null,
        displayName: String(row.display_name ?? `Usuari ${toNumber(row.telegram_user_id)}`),
        status: String(row.status) as AdminConsoleUserRecord['status'],
        isAdmin: toBoolean(row.is_admin),
        isApproved: toBoolean(row.is_approved),
      }));
    } finally {
      await client.close();
    }
  } catch {
    return [];
  }
}

async function queryAdmins(runtimeConfig: Awaited<ReturnType<typeof loadRuntimeConfig>>): Promise<AdminConsoleUserRecord[]> {
  try {
    const client = await connectDatabaseClient(runtimeConfig);
    try {
      const rows = await queryRows(
        client,
        `select telegram_user_id, username, display_name, status, is_admin, is_approved
         from users
         where is_admin = true
         order by telegram_user_id`,
      );

      return rows.map((row) => ({
        telegramUserId: toNumber(row.telegram_user_id),
        username: typeof row.username === 'string' ? row.username : null,
        displayName: String(row.display_name ?? `Usuari ${toNumber(row.telegram_user_id)}`),
        status: String(row.status) as AdminConsoleUserRecord['status'],
        isAdmin: true,
        isApproved: toBoolean(row.is_approved),
      }));
    } finally {
      await client.close();
    }
  } catch {
    return [];
  }
}

async function updateUserStatus(
  runtimeConfig: Awaited<ReturnType<typeof loadRuntimeConfig>>,
  input: AdminConsoleUserStatusUpdate,
): Promise<void> {
  const client = await connectDatabaseClient(runtimeConfig);
  try {
    const existingRows = await queryRows(
      client,
      `select status, is_approved from users where telegram_user_id = $1`,
      [input.telegramUserId],
    );

    if (existingRows.length === 0) {
      throw new Error(`Usuari ${input.telegramUserId} no existeix.`);
    }

    const previousStatus = String(existingRows[0]?.status ?? 'pending');

    const updatedRows = await queryRows(
      client,
      `update users
       set status = $1,
           is_approved = $2,
           updated_at = now(),
           approved_at = case when $1 = 'approved' then now() else approved_at end,
           blocked_at = case when $1 in ('blocked', 'revoked') then now() else null end,
           revoked_at = case when $1 = 'revoked' then now() else null end
       where telegram_user_id = $3
       returning telegram_user_id`,
      [input.nextStatus, input.nextStatus === 'approved', input.telegramUserId],
    );

    if (updatedRows.length === 0) {
      throw new Error(`No s'ha pogut actualitzar l'usuari ${input.telegramUserId}.`);
    }

    await queryRows(
      client,
      `insert into user_status_audit_log
         (subject_telegram_user_id, previous_status, next_status, changed_by_telegram_user_id, reason)
       values ($1, $2, $3, $4, $5)`,
      [input.telegramUserId, previousStatus, input.nextStatus, input.operatorTelegramUserId, input.reason ?? 'console-update'],
    );
  } finally {
    await client.close();
  }
}

async function updateUserAdmin(
  runtimeConfig: Awaited<ReturnType<typeof loadRuntimeConfig>>,
  input: AdminConsoleAdminToggle,
): Promise<void> {
  const client = await connectDatabaseClient(runtimeConfig);
  try {
    const existingRows = await queryRows(
      client,
      `select is_admin from users where telegram_user_id = $1`,
      [input.telegramUserId],
    );

    if (existingRows.length === 0) {
      throw new Error(`Usuari ${input.telegramUserId} no existeix.`);
    }

    const previousAdmin = toBoolean(existingRows[0]?.is_admin);

    const updatedRows = await queryRows(
      client,
      `update users set is_admin = $1, updated_at = now() where telegram_user_id = $2 returning telegram_user_id`,
      [input.isAdmin, input.telegramUserId],
    );

    if (updatedRows.length === 0) {
      throw new Error(`No s\'ha pogut actualitzar l\'administrador ${input.telegramUserId}.`);
    }

    await queryRows(
      client,
      `insert into user_permission_audit_log
         (subject_telegram_user_id, permission_key, scope_type, resource_type, resource_id, previous_effect, next_effect, changed_by_telegram_user_id, reason)
       values ($1, 'admin', 'global', null, null, $2, $3, $4, $5)`,
      [
        input.telegramUserId,
        previousAdmin ? 'allow' : null,
        input.isAdmin ? 'allow' : null,
        input.operatorTelegramUserId,
        input.reason ?? 'console-update',
      ],
    );
  } finally {
    await client.close();
  }
}

async function loadRuntimeConfigOrNull(
  env: Record<string, string | undefined>,
  paths: { configPath: string; envPath: string },
): Promise<Awaited<ReturnType<typeof loadRuntimeConfig>> | null> {
  try {
    return await loadRuntimeConfig({
      env: {
        ...env,
        GAMECLUB_CONFIG_PATH: paths.configPath,
        GAMECLUB_ENV_PATH: paths.envPath,
      },
    });
  } catch {
    return null;
  }
}

async function connectDatabaseClient(config: Awaited<ReturnType<typeof loadRuntimeConfig>>): Promise<DatabaseClient> {
  const db = await connectPostgresDatabase({
    connectionString: createPostgresConnectionString(config.database),
    ssl: config.database.ssl,
    logger: {
      error() {
        return undefined;
      },
    },
  });

  return {
    async query(sqlText: string, values: unknown[] = []) {
      const result = await db.pool.query(sqlText, values);
      return { rows: result.rows as Array<Record<string, unknown>> };
    },
    async close() {
      await db.close();
    },
  };
}

async function queryRows(client: DatabaseClient, sql: string, values: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const result = await client.query(sql, values);
  return result.rows;
}

async function safeCount(client: DatabaseClient, sql: string): Promise<number> {
  try {
    const rows = await queryRows(client, sql);
    return toNumber(rows[0]?.value);
  } catch {
    return 0;
  }
}

async function safeReadText(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === 'true' || value === 't' || value === '1';
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${value} B`;
}

function formatIso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }

  return new Date().toISOString();
}
