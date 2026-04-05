import type { ClubTableRecord } from '../tables/table-catalog.js';
import { buildTelegramStartUrl } from './deep-links.js';

export function formatTelegramTableListMessage({
  tables,
  audience,
}: {
  tables: ClubTableRecord[];
  audience: 'admin' | 'member';
}): string {
  const title = audience === 'admin' ? 'Taules registrades:' : 'Taules disponibles:';

  return [title]
    .concat(tables.map((table) => `- ${formatTablePrimaryLabel({ table, audience })}`))
    .join('\n');
}

export function formatTelegramTableDetails({
  table,
  audience,
}: {
  table: ClubTableRecord;
  audience: 'admin' | 'member';
}): string {
  const lines = [formatTablePrimaryLabel({ table, audience })];

  if (audience === 'admin') {
    lines.push(`Estat: ${table.lifecycleStatus === 'active' ? 'activa' : 'desactivada'}`);
  }

  lines.push(`Descripcio: ${escapeHtml(table.description ?? 'Sense descripcio')}`);
  lines.push(`Capacitat recomanada: ${escapeHtml(table.recommendedCapacity?.toString() ?? 'Sense valor')}`);

  return lines.join('\n');
}

function formatTablePrimaryLabel({
  table,
  audience,
}: {
  table: ClubTableRecord;
  audience: 'admin' | 'member';
}): string {
  const href = buildTelegramStartUrl(audience === 'admin' ? `table_admin_${table.id}` : `table_read_${table.id}`);
  if (audience === 'admin') {
    return `<a href="${href}"><b>${escapeHtml(table.displayName)}</b></a> (#${table.id})${table.lifecycleStatus === 'deactivated' ? ' [desactivada]' : ''}`;
  }

  return `<a href="${href}"><b>${escapeHtml(table.displayName)}</b></a>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
