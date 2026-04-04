import { getClubTable, listClubTables, type ClubTableRepository } from '../tables/table-catalog.js';
import { createDatabaseClubTableRepository } from '../tables/table-catalog-store.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import { formatTelegramTableDetails, formatTelegramTableListMessage } from './table-presentation.js';

export const tableReadCallbackPrefixes = {
  inspect: 'table_read:inspect:',
} as const;

export type TelegramTableReadContext = TelegramCommandHandlerContext & {
  tableRepository?: ClubTableRepository;
};

export async function handleTelegramTableReadCommand(
  context: TelegramTableReadContext,
): Promise<void> {
  const tables = await listClubTables({
    repository: resolveTableRepository(context),
  });

  if (tables.length === 0) {
    await context.reply('No hi ha cap taula activa disponible ara mateix.');
    return;
  }

  await context.reply(formatTelegramTableListMessage({ tables, audience: 'member' }), {
    inlineKeyboard: tables.map((table) => [
      {
        text: `Veure ${table.displayName}`,
        callbackData: `${tableReadCallbackPrefixes.inspect}${table.id}`,
      },
    ]),
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

  await context.reply(formatTelegramTableDetails({ table, audience: 'member' }));
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
