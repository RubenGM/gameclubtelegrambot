import { connectPostgresDatabase, createPostgresConnectionString } from '../infrastructure/database/connection.js';
import type { RuntimeConfig } from '../config/runtime-config.js';

export interface TelegramMenuUxAuditEvent {
  actionKey: 'telegram.menu.shown' | 'telegram.menu.action_selected';
  targetId: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface TelegramMenuUxSummary {
  menuShownCount: number;
  actionSelectedCount: number;
  interactionRate: number;
  distinctMenus: number;
  distinctActions: number;
}

export interface TelegramMenuUxTopAction {
  telemetryActionKey: string;
  actionId: string;
  labelSample: string;
  selectionCount: number;
  share: number;
}

export interface TelegramMenuUxRoleSummary {
  actorRole: string;
  menuShownCount: number;
  actionSelectedCount: number;
  interactionRate: number;
  topActionKey: string | null;
}

export interface TelegramMenuUxReportSnapshot {
  windowDays: number;
  generatedAt: string;
  summary: TelegramMenuUxSummary;
  topActions: TelegramMenuUxTopAction[];
  roleBreakdown: TelegramMenuUxRoleSummary[];
}

export interface TelegramMenuUxReportClient {
  query(sqlText: string, values?: readonly unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  close(): Promise<void>;
}

export interface TelegramMenuUxReportOperations {
  readReport(windowDays: number): Promise<TelegramMenuUxReportSnapshot>;
}

export function buildTelegramMenuUxReportSnapshot({
  windowDays,
  generatedAt,
  events,
}: {
  windowDays: number;
  generatedAt: string;
  events: TelegramMenuUxAuditEvent[];
}): TelegramMenuUxReportSnapshot {
  const menuIds = new Set<string>();
  const actionKeys = new Set<string>();
  const actionCounts = new Map<string, { actionId: string; labelSample: string; selectionCount: number }>();
  const roleSummary = new Map<string, { menuShownCount: number; actionSelectedCount: number; topActionCounts: Map<string, number> }>();

  let menuShownCount = 0;
  let actionSelectedCount = 0;

  for (const event of events) {
    const menuId = resolveText(event.details?.menuId) ?? event.targetId;
    if (menuId) {
      menuIds.add(menuId);
    }

    const actorRole = resolveText(event.details?.actorRole);
    if (event.actionKey === 'telegram.menu.shown') {
      menuShownCount += 1;
      if (actorRole) {
        const role = ensureRoleSummary(roleSummary, actorRole);
        role.menuShownCount += 1;
      }
      continue;
    }

    const telemetryActionKey = resolveText(event.details?.telemetryActionKey);
    const actionId = resolveText(event.details?.actionId);
    const label = resolveText(event.details?.label);
    if (!telemetryActionKey || !actionId || !label) {
      continue;
    }

    actionSelectedCount += 1;
    actionKeys.add(telemetryActionKey);

    const existingAction = actionCounts.get(telemetryActionKey);
    if (existingAction) {
      existingAction.selectionCount += 1;
    } else {
      actionCounts.set(telemetryActionKey, {
        actionId,
        labelSample: label,
        selectionCount: 1,
      });
    }

    if (actorRole) {
      const role = ensureRoleSummary(roleSummary, actorRole);
      role.actionSelectedCount += 1;
      role.topActionCounts.set(telemetryActionKey, (role.topActionCounts.get(telemetryActionKey) ?? 0) + 1);
    }
  }

  return {
    windowDays,
    generatedAt,
    summary: {
      menuShownCount,
      actionSelectedCount,
      interactionRate: ratio(actionSelectedCount, menuShownCount),
      distinctMenus: menuIds.size,
      distinctActions: actionKeys.size,
    },
    topActions: Array.from(actionCounts.entries())
      .map(([telemetryActionKey, action]) => ({
        telemetryActionKey,
        actionId: action.actionId,
        labelSample: action.labelSample,
        selectionCount: action.selectionCount,
        share: ratio(action.selectionCount, actionSelectedCount),
      }))
      .sort((left, right) => right.selectionCount - left.selectionCount || left.telemetryActionKey.localeCompare(right.telemetryActionKey)),
    roleBreakdown: Array.from(roleSummary.entries())
      .map(([actorRole, summary]) => ({
        actorRole,
        menuShownCount: summary.menuShownCount,
        actionSelectedCount: summary.actionSelectedCount,
        interactionRate: ratio(summary.actionSelectedCount, summary.menuShownCount),
        topActionKey: resolveTopActionKey(summary.topActionCounts),
      }))
      .sort((left, right) => roleOrder(left.actorRole) - roleOrder(right.actorRole) || left.actorRole.localeCompare(right.actorRole)),
  };
}

export async function readTelegramMenuUxReportForConfig({
  config,
  windowDays,
  now = new Date(),
  connect = connectTelegramMenuUxReportClient,
}: {
  config: RuntimeConfig;
  windowDays: number;
  now?: Date;
  connect?: (config: RuntimeConfig) => Promise<TelegramMenuUxReportClient>;
}): Promise<TelegramMenuUxReportSnapshot> {
  const client = await connect(config);
  try {
    const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const result = await client.query(
      `select action_key, target_id, details, created_at
         from audit_log
        where action_key = any($1::text[])
          and created_at >= $2::timestamptz
        order by created_at desc`,
      [['telegram.menu.shown', 'telegram.menu.action_selected'], since],
    );

    return buildTelegramMenuUxReportSnapshot({
      windowDays,
      generatedAt: now.toISOString(),
      events: result.rows.map(normalizeAuditRow).filter((event): event is TelegramMenuUxAuditEvent => event !== null),
    });
  } finally {
    await client.close();
  }
}

export function createTelegramMenuUxReportOperations({
  config,
}: {
  config: RuntimeConfig;
}): TelegramMenuUxReportOperations {
  return {
    async readReport(windowDays: number) {
      return readTelegramMenuUxReportForConfig({ config, windowDays });
    },
  };
}

function ensureRoleSummary(
  roleSummary: Map<string, { menuShownCount: number; actionSelectedCount: number; topActionCounts: Map<string, number> }>,
  actorRole: string,
) {
  const existing = roleSummary.get(actorRole);
  if (existing) {
    return existing;
  }

  const created = {
    menuShownCount: 0,
    actionSelectedCount: 0,
    topActionCounts: new Map<string, number>(),
  };
  roleSummary.set(actorRole, created);
  return created;
}

function resolveTopActionKey(counts: Map<string, number>): string | null {
  let topActionKey: string | null = null;
  let topCount = -1;
  for (const [actionKey, count] of counts.entries()) {
    if (count > topCount || (count === topCount && topActionKey !== null && actionKey.localeCompare(topActionKey) < 0)) {
      topActionKey = actionKey;
      topCount = count;
    }
  }

  return topActionKey;
}

function roleOrder(actorRole: string): number {
  switch (actorRole) {
    case 'member':
      return 0;
    case 'admin':
      return 1;
    case 'pending':
      return 2;
    case 'blocked':
      return 3;
    default:
      return 4;
  }
}

function normalizeAuditRow(row: Record<string, unknown>): TelegramMenuUxAuditEvent | null {
  const actionKey = row.action_key;
  if (actionKey !== 'telegram.menu.shown' && actionKey !== 'telegram.menu.action_selected') {
    return null;
  }

  const targetId = resolveText(row.target_id);
  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : resolveText(row.created_at);
  if (!targetId || !createdAt) {
    return null;
  }

  return {
    actionKey,
    targetId,
    details: isRecord(row.details) ? row.details : null,
    createdAt,
  };
}

function resolveText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ratio(value: number, total: number): number {
  if (total <= 0) {
    return 0;
  }

  return Number((value / total).toFixed(4));
}

async function connectTelegramMenuUxReportClient(config: RuntimeConfig): Promise<TelegramMenuUxReportClient> {
  const database = await connectPostgresDatabase({
    connectionString: createPostgresConnectionString(config.database),
    ssl: config.database.ssl,
    logger: {
      error() {
        // Operator-facing scripts surface their own errors.
      },
    },
  });

  return {
    async query(sqlText: string, values?: readonly unknown[]) {
      const result = await database.pool.query(sqlText, values as unknown[] | undefined);
      return {
        rows: result.rows as Array<Record<string, unknown>>,
      };
    },
    async close() {
      await database.close();
    },
  };
}
