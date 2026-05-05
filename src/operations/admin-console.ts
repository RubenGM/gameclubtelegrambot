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

export type AdminConsoleResourceKind =
  | 'users'
  | 'catalog_families'
  | 'catalog_groups'
  | 'catalog_items'
  | 'catalog_media'
  | 'catalog_loans'
  | 'club_tables'
  | 'schedule_events'
  | 'schedule_event_participants'
  | 'venue_events'
  | 'news_groups'
  | 'group_purchases'
  | 'group_purchase_fields'
  | 'group_purchase_messages'
  | 'lfg_player_ads'
  | 'lfg_group_ads'
  | 'storage_categories'
  | 'storage_entries'
  | 'storage_entry_messages'
  | 'audit_log';

export type AdminConsoleFieldType = 'string' | 'number' | 'boolean' | 'json' | 'timestamp';

export interface AdminConsoleResourceDefinition {
  kind: AdminConsoleResourceKind;
  label: string;
  tableName: string;
  idColumn: string;
  titleColumn: string;
  subtitleColumns: string[];
  listColumns: string[];
  editableFields: Array<{ column: string; label: string; type: AdminConsoleFieldType; nullable?: boolean }>;
  softDelete?: {
    column: string;
    value: string;
    timestampColumn?: string;
    actorColumn?: string;
  };
}

export interface AdminConsoleResourceListOptions {
  kind: AdminConsoleResourceKind;
  search?: string;
  limit?: number;
}

export interface AdminConsoleResourceRow {
  id: number | string;
  title: string;
  subtitle: string;
  values: Record<string, string>;
}

export interface AdminConsoleResourceDetail {
  definition: AdminConsoleResourceDefinition;
  id: number | string;
  fields: Array<{ column: string; label: string; type: AdminConsoleFieldType; value: string; editable: boolean }>;
}

export interface AdminConsoleResourceFieldUpdate {
  kind: AdminConsoleResourceKind;
  id: number | string;
  column: string;
  value: string;
}

export interface AdminConsoleResourceDeleteInput {
  kind: AdminConsoleResourceKind;
  id: number | string;
  hardDelete?: boolean;
  operatorTelegramUserId: number;
}

export interface AdminConsoleOperations {
  readSnapshot(): Promise<AdminConsoleRuntimeSnapshot>;
  startService(): Promise<void>;
  stopService(): Promise<void>;
  restartService(): Promise<void>;
  readRecentLogs(lines?: number): Promise<string>;
  listResourceDefinitions(): AdminConsoleResourceDefinition[];
  listResources(options: AdminConsoleResourceListOptions): Promise<AdminConsoleResourceRow[]>;
  readResource(kind: AdminConsoleResourceKind, id: number | string): Promise<AdminConsoleResourceDetail>;
  updateResourceField(input: AdminConsoleResourceFieldUpdate): Promise<void>;
  deleteResource(input: AdminConsoleResourceDeleteInput): Promise<void>;
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

const resourceDefinitions: AdminConsoleResourceDefinition[] = [
  resource('users', 'Usuaris', 'users', 'telegram_user_id', 'display_name', ['username', 'status'], ['telegram_user_id', 'display_name', 'username', 'status', 'is_admin', 'is_approved'], [
    field('display_name', 'Display name', 'string'),
    field('username', 'Username', 'string', true),
    field('status', 'Status', 'string'),
    field('is_admin', 'Admin', 'boolean'),
    field('is_approved', 'Approved', 'boolean'),
    field('status_reason', 'Status reason', 'string', true),
  ]),
  resource('catalog_families', 'Families de cataleg', 'catalog_families', 'id', 'display_name', ['slug', 'family_kind'], ['id', 'display_name', 'slug', 'family_kind'], [
    field('display_name', 'Display name', 'string'),
    field('slug', 'Slug', 'string'),
    field('description', 'Description', 'string', true),
    field('family_kind', 'Family kind', 'string'),
  ]),
  resource('catalog_groups', 'Grups de cataleg', 'catalog_groups', 'id', 'display_name', ['slug', 'family_id'], ['id', 'display_name', 'slug', 'family_id'], [
    field('display_name', 'Display name', 'string'),
    field('slug', 'Slug', 'string'),
    field('description', 'Description', 'string', true),
    field('family_id', 'Family ID', 'number', true),
  ]),
  resource('catalog_items', 'Items de cataleg', 'catalog_items', 'id', 'display_name', ['item_type', 'lifecycle_status'], ['id', 'display_name', 'item_type', 'lifecycle_status', 'group_id', 'family_id'], [
    field('display_name', 'Display name', 'string'),
    field('original_name', 'Original name', 'string', true),
    field('description', 'Description', 'string', true),
    field('language', 'Language', 'string', true),
    field('publisher', 'Publisher', 'string', true),
    field('publication_year', 'Publication year', 'number', true),
    field('player_count_min', 'Player min', 'number', true),
    field('player_count_max', 'Player max', 'number', true),
    field('recommended_age', 'Recommended age', 'number', true),
    field('play_time_minutes', 'Play time minutes', 'number', true),
    field('lifecycle_status', 'Lifecycle status', 'string'),
    field('external_refs', 'External refs JSON', 'json', true),
    field('metadata', 'Metadata JSON', 'json', true),
  ], { column: 'lifecycle_status', value: 'inactive', timestampColumn: 'deactivated_at' }),
  resource('catalog_media', 'Media de cataleg', 'catalog_media', 'id', 'url', ['media_type', 'item_id'], ['id', 'media_type', 'url', 'item_id', 'family_id', 'sort_order'], [
    field('media_type', 'Media type', 'string'),
    field('url', 'URL', 'string'),
    field('alt_text', 'Alt text', 'string', true),
    field('sort_order', 'Sort order', 'number'),
  ]),
  resource('catalog_loans', 'Prestecs de cataleg', 'catalog_loans', 'id', 'borrower_display_name', ['item_id', 'returned_at'], ['id', 'item_id', 'borrower_display_name', 'due_at', 'returned_at'], [
    field('borrower_display_name', 'Borrower display name', 'string'),
    field('due_at', 'Due at', 'timestamp', true),
    field('notes', 'Notes', 'string', true),
    field('returned_at', 'Returned at', 'timestamp', true),
  ], { column: 'returned_at', value: 'now', timestampColumn: 'updated_at', actorColumn: 'returned_by_telegram_user_id' }),
  resource('club_tables', 'Taules del club', 'club_tables', 'id', 'display_name', ['lifecycle_status', 'recommended_capacity'], ['id', 'display_name', 'recommended_capacity', 'lifecycle_status'], [
    field('display_name', 'Display name', 'string'),
    field('description', 'Description', 'string', true),
    field('recommended_capacity', 'Recommended capacity', 'number', true),
    field('lifecycle_status', 'Lifecycle status', 'string'),
  ], { column: 'lifecycle_status', value: 'inactive', timestampColumn: 'deactivated_at' }),
  resource('schedule_events', 'Activitats', 'schedule_events', 'id', 'title', ['starts_at', 'lifecycle_status'], ['id', 'title', 'starts_at', 'capacity', 'lifecycle_status'], [
    field('title', 'Title', 'string'),
    field('description', 'Description', 'string', true),
    field('starts_at', 'Starts at', 'timestamp'),
    field('duration_minutes', 'Duration minutes', 'number'),
    field('capacity', 'Capacity', 'number'),
    field('attendance_mode', 'Attendance mode', 'string'),
    field('lifecycle_status', 'Lifecycle status', 'string'),
    field('cancellation_reason', 'Cancellation reason', 'string', true),
  ], { column: 'lifecycle_status', value: 'cancelled', timestampColumn: 'cancelled_at', actorColumn: 'cancelled_by_telegram_user_id' }),
  resource('schedule_event_participants', 'Participants activitats', 'schedule_event_participants', 'id', 'participant_telegram_user_id', ['schedule_event_id', 'status'], ['id', 'schedule_event_id', 'participant_telegram_user_id', 'status'], [
    field('status', 'Status', 'string'),
    field('reminder_lead_hours', 'Reminder lead hours', 'number', true),
    field('reminder_preference_configured', 'Reminder configured', 'boolean'),
  ], { column: 'status', value: 'removed', timestampColumn: 'left_at', actorColumn: 'removed_by_telegram_user_id' }),
  resource('venue_events', 'Ocupacions de sala', 'venue_events', 'id', 'name', ['starts_at', 'lifecycle_status'], ['id', 'name', 'starts_at', 'ends_at', 'impact_level', 'lifecycle_status'], [
    field('name', 'Name', 'string'),
    field('description', 'Description', 'string', true),
    field('starts_at', 'Starts at', 'timestamp'),
    field('ends_at', 'Ends at', 'timestamp'),
    field('occupancy_scope', 'Occupancy scope', 'string'),
    field('impact_level', 'Impact level', 'string'),
    field('lifecycle_status', 'Lifecycle status', 'string'),
    field('cancellation_reason', 'Cancellation reason', 'string', true),
  ], { column: 'lifecycle_status', value: 'cancelled', timestampColumn: 'cancelled_at' }),
  resource('news_groups', 'Grups de noticies', 'news_groups', 'chat_id', 'chat_id', ['is_enabled'], ['chat_id', 'is_enabled', 'enabled_at', 'disabled_at'], [
    field('is_enabled', 'Enabled', 'boolean'),
    field('metadata', 'Metadata JSON', 'json', true),
  ]),
  resource('group_purchases', 'Compres de grup', 'group_purchases', 'id', 'title', ['purchase_mode', 'lifecycle_status'], ['id', 'title', 'purchase_mode', 'lifecycle_status', 'join_deadline_at'], [
    field('title', 'Title', 'string'),
    field('description', 'Description', 'string', true),
    field('purchase_mode', 'Purchase mode', 'string'),
    field('lifecycle_status', 'Lifecycle status', 'string'),
    field('join_deadline_at', 'Join deadline', 'timestamp', true),
    field('confirm_deadline_at', 'Confirm deadline', 'timestamp', true),
    field('total_price_cents', 'Total price cents', 'number', true),
    field('unit_price_cents', 'Unit price cents', 'number', true),
    field('unit_label', 'Unit label', 'string', true),
  ], { column: 'lifecycle_status', value: 'cancelled', timestampColumn: 'cancelled_at' }),
  resource('group_purchase_fields', 'Camps compres', 'group_purchase_fields', 'id', 'label', ['purchase_id', 'field_key'], ['id', 'purchase_id', 'field_key', 'label', 'field_type', 'is_required'], [
    field('field_key', 'Field key', 'string'),
    field('label', 'Label', 'string'),
    field('field_type', 'Field type', 'string'),
    field('is_required', 'Required', 'boolean'),
    field('sort_order', 'Sort order', 'number'),
    field('config', 'Config JSON', 'json', true),
    field('affects_quantity', 'Affects quantity', 'boolean'),
  ]),
  resource('group_purchase_messages', 'Missatges compres', 'group_purchase_messages', 'id', 'body', ['purchase_id', 'author_telegram_user_id'], ['id', 'purchase_id', 'author_telegram_user_id', 'body'], [
    field('body', 'Body', 'string'),
  ]),
  resource('lfg_player_ads', 'LFG jugadors', 'lfg_player_ads', 'id', 'display_name', ['status', 'telegram_user_id'], ['id', 'display_name', 'telegram_user_id', 'status'], [
    field('display_name', 'Display name', 'string'),
    field('description', 'Description', 'string'),
    field('status', 'Status', 'string'),
  ], { column: 'status', value: 'cancelled', timestampColumn: 'cancelled_at' }),
  resource('lfg_group_ads', 'LFG grups', 'lfg_group_ads', 'id', 'title', ['status', 'creator_display_name'], ['id', 'title', 'creator_display_name', 'status'], [
    field('title', 'Title', 'string'),
    field('description', 'Description', 'string'),
    field('seats_available', 'Seats available', 'number', true),
    field('status', 'Status', 'string'),
  ], { column: 'status', value: 'cancelled', timestampColumn: 'cancelled_at' }),
  resource('storage_categories', 'Categories storage', 'storage_categories', 'id', 'display_name', ['slug', 'lifecycle_status'], ['id', 'display_name', 'slug', 'storage_chat_id', 'storage_thread_id', 'lifecycle_status'], [
    field('display_name', 'Display name', 'string'),
    field('slug', 'Slug', 'string'),
    field('description', 'Description', 'string', true),
    field('parent_category_id', 'Parent category ID', 'number', true),
    field('storage_chat_id', 'Storage chat ID', 'number'),
    field('storage_thread_id', 'Storage thread ID', 'number'),
    field('lifecycle_status', 'Lifecycle status', 'string'),
  ], { column: 'lifecycle_status', value: 'archived', timestampColumn: 'archived_at' }),
  resource('storage_entries', 'Entrades storage', 'storage_entries', 'id', 'description', ['category_id', 'lifecycle_status'], ['id', 'category_id', 'source_kind', 'description', 'lifecycle_status'], [
    field('description', 'Description', 'string', true),
    field('tags', 'Tags JSON', 'json'),
    field('lifecycle_status', 'Lifecycle status', 'string'),
  ], { column: 'lifecycle_status', value: 'deleted', timestampColumn: 'deleted_at', actorColumn: 'deleted_by_telegram_user_id' }),
  resource('storage_entry_messages', 'Missatges storage', 'storage_entry_messages', 'id', 'caption', ['entry_id', 'attachment_kind'], ['id', 'entry_id', 'storage_chat_id', 'storage_message_id', 'attachment_kind', 'caption'], [
    field('caption', 'Caption', 'string', true),
    field('attachment_kind', 'Attachment kind', 'string'),
    field('sort_order', 'Sort order', 'number'),
  ]),
  resource('audit_log', 'Audit log', 'audit_log', 'id', 'summary', ['action_key', 'target_type'], ['id', 'action_key', 'target_type', 'target_id', 'summary'], []),
];

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

    listResourceDefinitions() {
      return resourceDefinitions;
    },

    async listResources(listOptions) {
      const runtimeConfig = await loadRuntimeConfigOrNull(env, runtimePaths);
      if (!runtimeConfig) {
        return [];
      }

      return listResources(runtimeConfig, listOptions);
    },

    async readResource(kind, id) {
      const runtimeConfig = await loadRuntimeConfigOrNull(env, runtimePaths);
      if (!runtimeConfig) {
        throw new Error('No s\'ha pogut carregar la configuracio del runtime per llegir recursos.');
      }

      return readResource(runtimeConfig, kind, id);
    },

    async updateResourceField(input) {
      const runtimeConfig = await loadRuntimeConfigOrNull(env, runtimePaths);
      if (!runtimeConfig) {
        throw new Error('No s\'ha pogut carregar la configuracio del runtime per editar recursos.');
      }

      await updateResourceField(runtimeConfig, input);
    },

    async deleteResource(input) {
      const runtimeConfig = await loadRuntimeConfigOrNull(env, runtimePaths);
      if (!runtimeConfig) {
        throw new Error('No s\'ha pogut carregar la configuracio del runtime per eliminar recursos.');
      }

      await deleteResource(runtimeConfig, input);
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

async function listResources(
  runtimeConfig: Awaited<ReturnType<typeof loadRuntimeConfig>>,
  options: AdminConsoleResourceListOptions,
): Promise<AdminConsoleResourceRow[]> {
  const definition = findResourceDefinition(options.kind);
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 120), 1), 500);
  const search = options.search?.trim();
  const client = await connectDatabaseClient(runtimeConfig);

  try {
    const columns = uniqueColumns([definition.idColumn, definition.titleColumn, ...definition.subtitleColumns, ...definition.listColumns]);
    const where = search ? buildSearchWhere(definition, search) : { sql: '', values: [] };
    const rows = await queryRows(
      client,
      `select ${columns.map(quoteIdentifier).join(', ')}
         from ${quoteIdentifier(definition.tableName)}
       ${where.sql}
       order by ${quoteIdentifier(definition.idColumn)} desc
       limit $${where.values.length + 1}`,
      [...where.values, limit],
    );

    return rows.map((row) => {
      const id = row[definition.idColumn];
      const title = formatCell(row[definition.titleColumn]) || `${definition.label} ${formatCell(id)}`;
      const subtitle = definition.subtitleColumns
        .map((column) => `${column}: ${formatCell(row[column])}`)
        .filter((value) => !value.endsWith(': '))
        .join(' | ');
      const values: Record<string, string> = {};
      for (const column of definition.listColumns) {
        values[column] = formatCell(row[column]);
      }

      return {
        id: typeof id === 'number' || typeof id === 'string' ? id : formatCell(id),
        title,
        subtitle,
        values,
      };
    });
  } finally {
    await client.close();
  }
}

async function readResource(
  runtimeConfig: Awaited<ReturnType<typeof loadRuntimeConfig>>,
  kind: AdminConsoleResourceKind,
  id: number | string,
): Promise<AdminConsoleResourceDetail> {
  const definition = findResourceDefinition(kind);
  const client = await connectDatabaseClient(runtimeConfig);

  try {
    const rows = await queryRows(
      client,
      `select * from ${quoteIdentifier(definition.tableName)} where ${quoteIdentifier(definition.idColumn)} = $1 limit 1`,
      [normalizeResourceId(id)],
    );

    if (rows.length === 0) {
      throw new Error(`No s'ha trobat ${definition.label} amb id ${id}.`);
    }

    const row = rows[0] ?? {};
    const editable = new Set(definition.editableFields.map((fieldSpec) => fieldSpec.column));
    const typeByColumn = new Map(definition.editableFields.map((fieldSpec) => [fieldSpec.column, fieldSpec.type]));
    return {
      definition,
      id,
      fields: Object.keys(row)
        .sort((left, right) => (left === definition.idColumn ? -1 : right === definition.idColumn ? 1 : left.localeCompare(right)))
        .map((column) => ({
          column,
          label: labelForColumn(definition, column),
          type: typeByColumn.get(column) ?? inferFieldType(row[column]),
          value: formatCell(row[column]),
          editable: editable.has(column),
        })),
    };
  } finally {
    await client.close();
  }
}

async function updateResourceField(
  runtimeConfig: Awaited<ReturnType<typeof loadRuntimeConfig>>,
  input: AdminConsoleResourceFieldUpdate,
): Promise<void> {
  const definition = findResourceDefinition(input.kind);
  const fieldSpec = definition.editableFields.find((candidate) => candidate.column === input.column);
  if (!fieldSpec) {
    throw new Error(`El camp ${input.column} no es editable en ${definition.label}.`);
  }

  const value = parseFieldValue(input.value, fieldSpec);
  const client = await connectDatabaseClient(runtimeConfig);
  try {
    const assignments = [`${quoteIdentifier(fieldSpec.column)} = $1`];
    if (await tableHasColumn(client, definition.tableName, 'updated_at')) {
      assignments.push(`${quoteIdentifier('updated_at')} = now()`);
    }

    const rows = await queryRows(
      client,
      `update ${quoteIdentifier(definition.tableName)}
          set ${assignments.join(', ')}
        where ${quoteIdentifier(definition.idColumn)} = $2
        returning ${quoteIdentifier(definition.idColumn)}`,
      [value, normalizeResourceId(input.id)],
    );

    if (rows.length === 0) {
      throw new Error(`No s'ha actualitzat cap fila de ${definition.label}.`);
    }
  } finally {
    await client.close();
  }
}

async function deleteResource(
  runtimeConfig: Awaited<ReturnType<typeof loadRuntimeConfig>>,
  input: AdminConsoleResourceDeleteInput,
): Promise<void> {
  const definition = findResourceDefinition(input.kind);
  const client = await connectDatabaseClient(runtimeConfig);
  try {
    if (!input.hardDelete && definition.softDelete) {
      const assignments: string[] = [`${quoteIdentifier(definition.softDelete.column)} = $1`];
      const values: unknown[] = [definition.softDelete.value === 'now' ? new Date() : definition.softDelete.value];

      if (definition.softDelete.timestampColumn) {
        assignments.push(`${quoteIdentifier(definition.softDelete.timestampColumn)} = now()`);
      }
      if (definition.softDelete.actorColumn) {
        values.push(input.operatorTelegramUserId);
        assignments.push(`${quoteIdentifier(definition.softDelete.actorColumn)} = $${values.length}`);
      }
      if (await tableHasColumn(client, definition.tableName, 'updated_at')) {
        assignments.push(`${quoteIdentifier('updated_at')} = now()`);
      }

      values.push(normalizeResourceId(input.id));
      const rows = await queryRows(
        client,
        `update ${quoteIdentifier(definition.tableName)}
            set ${assignments.join(', ')}
          where ${quoteIdentifier(definition.idColumn)} = $${values.length}
          returning ${quoteIdentifier(definition.idColumn)}`,
        values,
      );

      if (rows.length === 0) {
        throw new Error(`No s'ha trobat cap fila per eliminar en ${definition.label}.`);
      }
      return;
    }

    const rows = await queryRows(
      client,
      `delete from ${quoteIdentifier(definition.tableName)}
        where ${quoteIdentifier(definition.idColumn)} = $1
        returning ${quoteIdentifier(definition.idColumn)}`,
      [normalizeResourceId(input.id)],
    );

    if (rows.length === 0) {
      throw new Error(`No s'ha trobat cap fila per eliminar en ${definition.label}.`);
    }
  } finally {
    await client.close();
  }
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

function resource(
  kind: AdminConsoleResourceKind,
  label: string,
  tableName: string,
  idColumn: string,
  titleColumn: string,
  subtitleColumns: string[],
  listColumns: string[],
  editableFields: AdminConsoleResourceDefinition['editableFields'],
  softDelete?: AdminConsoleResourceDefinition['softDelete'],
): AdminConsoleResourceDefinition {
  const definition: AdminConsoleResourceDefinition = {
    kind,
    label,
    tableName,
    idColumn,
    titleColumn,
    subtitleColumns,
    listColumns,
    editableFields,
  };
  if (softDelete) {
    definition.softDelete = softDelete;
  }
  return definition;
}

function field(
  column: string,
  label: string,
  type: AdminConsoleFieldType,
  nullable = false,
): AdminConsoleResourceDefinition['editableFields'][number] {
  return { column, label, type, nullable };
}

function findResourceDefinition(kind: AdminConsoleResourceKind): AdminConsoleResourceDefinition {
  const definition = resourceDefinitions.find((candidate) => candidate.kind === kind);
  if (!definition) {
    throw new Error(`Recurs no suportat: ${kind}`);
  }
  return definition;
}

function uniqueColumns(columns: string[]): string[] {
  return [...new Set(columns)];
}

function buildSearchWhere(
  definition: AdminConsoleResourceDefinition,
  search: string,
): { sql: string; values: unknown[] } {
  const searchableColumns = uniqueColumns([definition.idColumn, definition.titleColumn, ...definition.subtitleColumns, ...definition.listColumns]);
  const clauses = searchableColumns.map((column, index) => `${quoteIdentifier(column)}::text ilike $${index + 1}`);
  return {
    sql: `where ${clauses.join(' or ')}`,
    values: searchableColumns.map(() => `%${search}%`),
  };
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Identificador SQL no segur: ${identifier}`);
  }
  return `"${identifier}"`;
}

function normalizeResourceId(id: number | string): number | string {
  if (typeof id === 'number') {
    return id;
  }
  const numeric = Number(id);
  return Number.isFinite(numeric) && String(Math.trunc(numeric)) === id ? numeric : id;
}

function labelForColumn(definition: AdminConsoleResourceDefinition, column: string): string {
  return definition.editableFields.find((fieldSpec) => fieldSpec.column === column)?.label ?? column;
}

function inferFieldType(value: unknown): AdminConsoleFieldType {
  if (typeof value === 'number' || typeof value === 'bigint') {
    return 'number';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  if (value instanceof Date) {
    return 'timestamp';
  }
  if (typeof value === 'object' && value !== null) {
    return 'json';
  }
  return 'string';
}

function parseFieldValue(
  rawValue: string,
  fieldSpec: AdminConsoleResourceDefinition['editableFields'][number],
): unknown {
  const trimmed = rawValue.trim();
  if (fieldSpec.nullable && (trimmed === '' || trimmed.toLowerCase() === 'null')) {
    return null;
  }

  switch (fieldSpec.type) {
    case 'number': {
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        throw new Error(`${fieldSpec.label} ha de ser numeric.`);
      }
      return parsed;
    }
    case 'boolean':
      if (['true', '1', 'yes', 'si', 'sí', 'y'].includes(trimmed.toLowerCase())) {
        return true;
      }
      if (['false', '0', 'no', 'n'].includes(trimmed.toLowerCase())) {
        return false;
      }
      throw new Error(`${fieldSpec.label} ha de ser true/false.`);
    case 'json':
      try {
        return JSON.parse(trimmed);
      } catch {
        throw new Error(`${fieldSpec.label} ha de ser JSON valid.`);
      }
    case 'timestamp': {
      const date = new Date(trimmed);
      if (Number.isNaN(date.getTime())) {
        throw new Error(`${fieldSpec.label} ha de ser una data valida.`);
      }
      return date;
    }
    case 'string':
    default:
      return rawValue;
  }
}

async function tableHasColumn(client: DatabaseClient, tableName: string, columnName: string): Promise<boolean> {
  const rows = await queryRows(
    client,
    `select 1 from information_schema.columns where table_name = $1 and column_name = $2 limit 1`,
    [tableName, columnName],
  );
  return rows.length > 0;
}

function formatCell(value: unknown): string {
  if (value === null || typeof value === 'undefined') {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
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
