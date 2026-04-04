import type { ClubTableRecord } from '../tables/table-catalog.js';

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

  lines.push(`Descripcio: ${table.description ?? 'Sense descripcio'}`);
  lines.push(`Capacitat recomanada: ${table.recommendedCapacity ?? 'Sense valor'}`);

  return lines.join('\n');
}

function formatTablePrimaryLabel({
  table,
  audience,
}: {
  table: ClubTableRecord;
  audience: 'admin' | 'member';
}): string {
  if (audience === 'admin') {
    return `${table.displayName} (#${table.id})${table.lifecycleStatus === 'deactivated' ? ' [desactivada]' : ''}`;
  }

  return table.displayName;
}
