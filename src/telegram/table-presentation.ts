import type { ClubTableRecord } from '../tables/table-catalog.js';
import { createTelegramI18n, normalizeBotLanguage, type BotLanguage } from './i18n.js';
import { buildTelegramStartUrl } from './deep-links.js';

export function formatTelegramTableListMessage({
  tables,
  audience,
  language = 'ca',
}: {
  tables: ClubTableRecord[];
  audience: 'admin' | 'member';
  language?: BotLanguage;
}): string {
  const texts = createTelegramI18n(normalizeBotLanguage(language, 'ca'));
  const title: string = audience === 'admin' ? texts.tableAdmin.listRegistered : texts.tableRead.available;

  return [title]
    .concat(tables.map((table) => `- ${formatTablePrimaryLabel({ table, audience })}`))
    .join('\n');
}

export function formatTelegramTableDetails({
  table,
  audience,
  language = 'ca',
}: {
  table: ClubTableRecord;
  audience: 'admin' | 'member';
  language?: BotLanguage;
}): string {
  const texts = createTelegramI18n(normalizeBotLanguage(language, 'ca'));
  const lines = [formatTablePrimaryLabel({ table, audience })];

  if (audience === 'admin') {
    lines.push(`${texts.tableAdmin.status}: ${table.lifecycleStatus === 'active' ? texts.tableAdmin.active : texts.tableAdmin.deactivatedLabel}`);
  }

  lines.push(`${texts.tableAdmin.description}: ${escapeHtml(table.description ?? texts.tableAdmin.noDescription)}`);
  lines.push(`${texts.tableAdmin.recommendedCapacity}: ${escapeHtml(table.recommendedCapacity?.toString() ?? texts.tableAdmin.noValue)}`);

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
    return `<a href="${href}"><b>${escapeHtml(table.displayName)}</b></a> (#${table.id})${table.lifecycleStatus === 'deactivated' ? ` [${createTelegramI18n('ca').tableAdmin.deactivatedLabel}]` : ''}`;
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
