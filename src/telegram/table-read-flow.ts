import { getClubTable, listClubTables, type ClubTableRepository } from '../tables/table-catalog.js';
import { createDatabaseClubTableRepository } from '../tables/table-catalog-store.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import { formatTelegramTableDetails, formatTelegramTableListMessage } from './table-presentation.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';

export const tableReadCallbackPrefixes = {
  inspect: 'table_read:inspect:',
} as const;

export type TelegramTableReadContext = TelegramCommandHandlerContext & {
  tableRepository?: ClubTableRepository;
};

export async function handleTelegramTableReadCommand(
  context: TelegramTableReadContext,
): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const tables = await listClubTables({
    repository: resolveTableRepository(context),
  });

  if (tables.length === 0) {
    await context.reply(createTelegramI18n(language).tableRead.noActiveTables);
    return;
  }

  await context.reply(formatTelegramTableListMessage({ tables, audience: 'member', language }), {
    parseMode: 'HTML',
  });
}

export async function handleTelegramTableReadCallback(
  context: TelegramTableReadContext,
): Promise<boolean> {
  const callbackData = context.callbackData;
  if (!callbackData || !callbackData.startsWith(tableReadCallbackPrefixes.inspect)) {
    return false;
  }

  const tableId = parseTableId(callbackData, tableReadCallbackPrefixes.inspect);
  const table = await getClubTable({
    repository: resolveTableRepository(context),
    tableId,
  });

  if (!table || table.lifecycleStatus !== 'active') {
    throw new Error(`Club table ${tableId} not found`);
  }

  await context.reply(formatTelegramTableDetails({ table, audience: 'member', language: normalizeBotLanguage(context.runtime.bot.language, 'ca') }), { parseMode: 'HTML' });
  return true;
}

export async function handleTelegramTableReadStartText(context: TelegramTableReadContext): Promise<boolean> {
  const tableId = parseStartPayload(context.messageText, 'table_read_');
  if (tableId === null || context.runtime.chat.kind !== 'private' || !context.runtime.actor.isApproved) {
    return false;
  }

  const table = await getClubTable({
    repository: resolveTableRepository(context),
    tableId,
  });

  if (!table || table.lifecycleStatus !== 'active') {
    throw new Error(`Club table ${tableId} not found`);
  }

  await context.reply(formatTelegramTableDetails({ table, audience: 'member', language: normalizeBotLanguage(context.runtime.bot.language, 'ca') }), { parseMode: 'HTML' });
  return true;
}

function parseTableId(callbackData: string, prefix: string): number {
  const value = Number(callbackData.slice(prefix.length));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('No s ha pogut identificar la taula seleccionada.');
  }

  return value;
}

function resolveTableRepository(context: TelegramTableReadContext): ClubTableRepository {
  if (context.tableRepository) {
    return context.tableRepository;
  }

  return createDatabaseClubTableRepository({
    database: context.runtime.services.database.db as never,
  });
}

function parseStartPayload(messageText: string | undefined, prefix: string): number | null {
  const payload = messageText?.trim().split(/\s+/).slice(1).join(' ');
  if (!payload || !payload.startsWith(prefix)) {
    return null;
  }

  const value = Number(payload.slice(prefix.length));
  return Number.isInteger(value) && value > 0 ? value : null;
}
