import {
  createClubTable,
  deactivateClubTable,
  getClubTable,
  listClubTables,
  updateClubTableMetadata,
  type ClubTableRecord,
  type ClubTableRepository,
} from '../tables/table-catalog.js';
import { createDatabaseClubTableRepository } from '../tables/table-catalog-store.js';
import type { TelegramActor } from './actor-store.js';
import type { AuthorizationService } from '../authorization/service.js';
import type { TelegramChatContext } from './chat-context.js';
import type { ConversationSessionRuntime } from './conversation-session.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import { formatTelegramTableDetails, formatTelegramTableListMessage } from './table-presentation.js';

const createFlowKey = 'table-admin-create';
const editFlowKey = 'table-admin-edit';
const deactivateFlowKey = 'table-admin-deactivate';

export const tableAdminCallbackPrefixes = {
  inspect: 'table_admin:inspect:',
  edit: 'table_admin:edit:',
  deactivate: 'table_admin:deactivate:',
} as const;

export const tableAdminLabels = {
  openMenu: 'Taules',
  create: 'Crear taula',
  list: 'Llistar taules',
  edit: 'Editar taula',
  deactivate: 'Desactivar taula',
  start: '/start',
  help: '/help',
  skipOptional: 'Ometre',
  noCapacity: 'Sense capacitat',
  keepCurrent: 'Mantenir valor actual',
  clearDescription: 'Esborrar descripcio',
  confirmCreate: 'Guardar taula',
  confirmEdit: 'Guardar canvis',
  confirmDeactivate: 'Confirmar desactivacio',
  cancel: '/cancel',
} as const;

export interface TelegramTableAdminContext {
  messageText?: string | undefined;
  callbackData?: string | undefined;
  reply(message: string, options?: TelegramReplyOptions): Promise<unknown>;
  runtime: {
    actor: TelegramActor;
    authorization: AuthorizationService;
    session: ConversationSessionRuntime;
    chat: TelegramChatContext;
    services: {
      database: {
        db: unknown;
      };
    };
    bot: {
      publicName: string;
      clubName: string;
      sendPrivateMessage(telegramUserId: number, message: string): Promise<void>;
    };
  };
  tableRepository?: ClubTableRepository;
}

export async function handleTelegramTableAdminText(
  context: TelegramTableAdminContext,
): Promise<boolean> {
  const text = context.messageText?.trim();
  if (!text || context.runtime.chat.kind !== 'private' || !canManageTables(context)) {
    return false;
  }

  if (isTableAdminSession(context.runtime.session.current?.flowKey)) {
    return handleActiveTableSession(context, text);
  }

  if (text === tableAdminLabels.openMenu || text === '/tables') {
    await context.reply('Gestio de taules: tria una accio.', buildTableAdminMenuOptions());
    return true;
  }

  if (text === tableAdminLabels.create || text === '/table_create') {
    await context.runtime.session.start({
      flowKey: createFlowKey,
      stepKey: 'display-name',
      data: {},
    });
    await context.reply(
      'Escriu el nom visible de la taula.',
      buildSingleCancelKeyboard(),
    );
    return true;
  }

  if (text === tableAdminLabels.list || text === '/table_list') {
    await replyWithTableList(context, 'list');
    return true;
  }

  if (text === tableAdminLabels.edit || text === '/table_edit') {
    await replyWithTableList(context, 'edit');
    return true;
  }

  if (text === tableAdminLabels.deactivate || text === '/table_deactivate') {
    await replyWithTableList(context, 'deactivate');
    return true;
  }

  return false;
}

export async function handleTelegramTableAdminCallback(
  context: TelegramTableAdminContext,
): Promise<boolean> {
  const callbackData = context.callbackData;
  if (!callbackData || context.runtime.chat.kind !== 'private' || !canManageTables(context)) {
    return false;
  }

  if (callbackData.startsWith(tableAdminCallbackPrefixes.inspect)) {
    const tableId = parseTableId(callbackData, tableAdminCallbackPrefixes.inspect);
    const table = await loadTableOrThrow(context, tableId);
    await context.reply(formatTableDetails(table));
    return true;
  }

  if (callbackData.startsWith(tableAdminCallbackPrefixes.edit)) {
    const tableId = parseTableId(callbackData, tableAdminCallbackPrefixes.edit);
    const table = await loadTableOrThrow(context, tableId);
    await context.runtime.session.start({
      flowKey: editFlowKey,
      stepKey: 'display-name',
      data: { tableId },
    });
    await context.reply(
      `${formatTableDetails(table)}\n\nEscriu el nou nom visible o tria una opcio del teclat.`,
      buildEditNameOptions(),
    );
    return true;
  }

  if (callbackData.startsWith(tableAdminCallbackPrefixes.deactivate)) {
    const tableId = parseTableId(callbackData, tableAdminCallbackPrefixes.deactivate);
    const table = await loadTableOrThrow(context, tableId);
    await context.runtime.session.start({
      flowKey: deactivateFlowKey,
      stepKey: 'confirm',
      data: { tableId },
    });
    await context.reply(
      `${formatTableDetails(table)}\n\nSi la desactives, deixara d aparéixer a la gestio operativa futura pero es mantindra per a consultes historiques.`,
      buildDeactivateConfirmOptions(),
    );
    return true;
  }

  return false;
}

function canManageTables(context: TelegramTableAdminContext): boolean {
  return context.runtime.actor.isAdmin || context.runtime.authorization.can('table.manage');
}

function isTableAdminSession(flowKey: string | undefined): boolean {
  return flowKey === createFlowKey || flowKey === editFlowKey || flowKey === deactivateFlowKey;
}

async function handleActiveTableSession(
  context: TelegramTableAdminContext,
  text: string,
): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session) {
    return false;
  }

  if (session.flowKey === createFlowKey) {
    return handleCreateSession(context, text, session.stepKey, session.data);
  }

  if (session.flowKey === editFlowKey) {
    return handleEditSession(context, text, session.stepKey, session.data);
  }

  if (session.flowKey === deactivateFlowKey) {
    return handleDeactivateSession(context, text, session.data);
  }

  return false;
}

async function handleCreateSession(
  context: TelegramTableAdminContext,
  text: string,
  stepKey: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  if (stepKey === 'display-name') {
    await context.runtime.session.advance({
      stepKey: 'description',
      data: { displayName: text },
    });
    await context.reply(
      'Escriu una descripcio opcional o tria una opcio del teclat.',
      buildDescriptionOptions(),
    );
    return true;
  }

  if (stepKey === 'description') {
    await context.runtime.session.advance({
      stepKey: 'capacity',
      data: {
        ...data,
        description: text === tableAdminLabels.skipOptional ? null : text,
      },
    });
    await context.reply(
      'Escriu la capacitat recomanada com a numero enter positiu o tria una opcio del teclat.',
      buildCapacityOptions(),
    );
    return true;
  }

  if (stepKey === 'capacity') {
    const recommendedCapacity = parseCapacity(text);
    if (recommendedCapacity instanceof Error) {
      await context.reply(
        'La capacitat recomanada ha de ser un enter positiu. Escriu un numero valid o tria una opcio del teclat.',
        buildCapacityOptions(),
      );
      return true;
    }

    const nextData = {
      ...data,
      recommendedCapacity,
    };
    await context.runtime.session.advance({
      stepKey: 'confirm',
      data: nextData,
    });
    await context.reply(
      `${formatDraftSummary(nextData)}\n\nTria una opcio per confirmar o cancel.lar.`,
      buildCreateConfirmOptions(),
    );
    return true;
  }

  if (stepKey === 'confirm') {
    if (text !== tableAdminLabels.confirmCreate) {
      await context.reply('Per guardar la taula, tria el boto de confirmacio o cancel.la el flux.', buildCreateConfirmOptions());
      return true;
    }

    const repository = resolveTableRepository(context);
    const table = await createClubTable({
      repository,
      displayName: String(data.displayName ?? ''),
      description: (data.description as string | null | undefined) ?? null,
      recommendedCapacity: (data.recommendedCapacity as number | null | undefined) ?? null,
    });
    await context.runtime.session.cancel();
    await context.reply(
      `Taula creada correctament: ${table.displayName} (#${table.id}).`,
      buildTableAdminMenuOptions(),
    );
    return true;
  }

  return false;
}

async function handleEditSession(
  context: TelegramTableAdminContext,
  text: string,
  stepKey: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  const tableId = Number(data.tableId);
  const table = await loadTableOrThrow(context, tableId);

  if (stepKey === 'display-name') {
    await context.runtime.session.advance({
      stepKey: 'description',
      data: {
        ...data,
        displayName: text === tableAdminLabels.keepCurrent ? table.displayName : text,
      },
    });
    await context.reply(
      'Escriu la nova descripcio o tria una opcio del teclat.',
      buildEditDescriptionOptions(),
    );
    return true;
  }

  if (stepKey === 'description') {
    const description =
      text === tableAdminLabels.keepCurrent
        ? table.description
        : text === tableAdminLabels.clearDescription
          ? null
          : text;

    await context.runtime.session.advance({
      stepKey: 'capacity',
      data: {
        ...data,
        description,
      },
    });
    await context.reply(
      'Escriu la nova capacitat recomanada o tria una opcio del teclat.',
      buildEditCapacityOptions(),
    );
    return true;
  }

  if (stepKey === 'capacity') {
    const recommendedCapacity =
      text === tableAdminLabels.keepCurrent
        ? table.recommendedCapacity
        : parseCapacity(text);

    if (recommendedCapacity instanceof Error) {
      await context.reply(
        'La capacitat recomanada ha de ser un enter positiu. Escriu un numero valid o tria una opcio del teclat.',
        buildEditCapacityOptions(),
      );
      return true;
    }

    const nextData = {
      ...data,
      recommendedCapacity,
    };
    await context.runtime.session.advance({
      stepKey: 'confirm',
      data: nextData,
    });
    await context.reply(
      `${formatDraftSummary(nextData)}\n\nTria una opcio per confirmar o cancel.lar.`,
      buildEditConfirmOptions(),
    );
    return true;
  }

  if (stepKey === 'confirm') {
    if (text !== tableAdminLabels.confirmEdit) {
      await context.reply('Per guardar els canvis, tria el boto de confirmacio o cancel.la el flux.', buildEditConfirmOptions());
      return true;
    }

    const updated = await updateClubTableMetadata({
      repository: resolveTableRepository(context),
      tableId,
      displayName: String(data.displayName ?? table.displayName),
      description: hasOwn(data, 'description')
        ? (data.description as string | null)
        : table.description,
      recommendedCapacity: hasOwn(data, 'recommendedCapacity')
        ? (data.recommendedCapacity as number | null)
        : table.recommendedCapacity,
    });
    await context.runtime.session.cancel();
    await context.reply(
      `Taula actualitzada correctament: ${updated.displayName} (#${updated.id}).`,
      buildTableAdminMenuOptions(),
    );
    return true;
  }

  return false;
}

async function handleDeactivateSession(
  context: TelegramTableAdminContext,
  text: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  if (text !== tableAdminLabels.confirmDeactivate) {
    await context.reply(
      'Per desactivar la taula, tria el boto de confirmacio o cancel.la el flux.',
      buildDeactivateConfirmOptions(),
    );
    return true;
  }

  const tableId = Number(data.tableId);
  const table = await deactivateClubTable({
    repository: resolveTableRepository(context),
    tableId,
  });
  await context.runtime.session.cancel();
  await context.reply(
    `Taula desactivada correctament: ${table.displayName} (#${table.id}).`,
    buildTableAdminMenuOptions(),
  );
  return true;
}

function buildTableAdminMenuOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [
      [tableAdminLabels.create, tableAdminLabels.list],
      [tableAdminLabels.edit, tableAdminLabels.deactivate],
      [tableAdminLabels.start],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildDescriptionOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[tableAdminLabels.skipOptional], [tableAdminLabels.cancel]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildCapacityOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[tableAdminLabels.noCapacity], [tableAdminLabels.cancel]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildCreateConfirmOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[tableAdminLabels.confirmCreate], [tableAdminLabels.cancel]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildEditNameOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[tableAdminLabels.keepCurrent], [tableAdminLabels.cancel]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildEditDescriptionOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [
      [tableAdminLabels.keepCurrent, tableAdminLabels.clearDescription],
      [tableAdminLabels.cancel],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildEditCapacityOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [
      [tableAdminLabels.keepCurrent, tableAdminLabels.noCapacity],
      [tableAdminLabels.cancel],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildEditConfirmOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[tableAdminLabels.confirmEdit], [tableAdminLabels.cancel]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildDeactivateConfirmOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[tableAdminLabels.confirmDeactivate], [tableAdminLabels.cancel]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildSingleCancelKeyboard(): TelegramReplyOptions {
  return {
    replyKeyboard: [[tableAdminLabels.cancel]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

async function replyWithTableList(
  context: TelegramTableAdminContext,
  mode: 'list' | 'edit' | 'deactivate',
): Promise<void> {
  const tables = await listClubTables({
    repository: resolveTableRepository(context),
    includeDeactivated: mode === 'list',
  });

  if (tables.length === 0) {
    await context.reply('No hi ha cap taula disponible ara mateix.', buildTableAdminMenuOptions());
    return;
  }

  const inlineKeyboard = tables.map((table) => [
    {
      text: mode === 'list' ? `Veure ${table.displayName}` : table.displayName,
      callbackData:
        mode === 'list'
          ? `${tableAdminCallbackPrefixes.inspect}${table.id}`
          : mode === 'edit'
            ? `${tableAdminCallbackPrefixes.edit}${table.id}`
            : `${tableAdminCallbackPrefixes.deactivate}${table.id}`,
    },
  ]);

  await context.reply(
    mode === 'list'
      ? formatTableListMessage(tables)
      : `Tria la taula que vols ${mode === 'edit' ? 'editar' : 'desactivar'}.`,
    { inlineKeyboard },
  );
}

function formatTableListMessage(tables: ClubTableRecord[]): string {
  return formatTelegramTableListMessage({ tables, audience: 'admin' });
}

function formatTableDetails(table: ClubTableRecord): string {
  return formatTelegramTableDetails({ table, audience: 'admin' });
}

function formatDraftSummary(data: Record<string, unknown>): string {
  return [
    'Resum de la taula:',
    `- Nom: ${String(data.displayName ?? '')}`,
    `- Descripcio: ${(data.description as string | null | undefined) ?? 'Sense descripcio'}`,
    `- Capacitat recomanada: ${(data.recommendedCapacity as number | null | undefined) ?? 'Sense valor'}`,
  ].join('\n');
}

function parseCapacity(text: string): number | null | Error {
  if (text === tableAdminLabels.noCapacity) {
    return null;
  }

  const value = Number(text);
  if (!Number.isInteger(value) || value <= 0) {
    return new Error('invalid-capacity');
  }

  return value;
}

function parseTableId(callbackData: string, prefix: string): number {
  const value = Number(callbackData.slice(prefix.length));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('No s ha pogut identificar la taula seleccionada.');
  }

  return value;
}

async function loadTableOrThrow(
  context: TelegramTableAdminContext,
  tableId: number,
): Promise<ClubTableRecord> {
  const table = await getClubTable({
    repository: resolveTableRepository(context),
    tableId,
  });
  if (!table) {
    throw new Error(`Club table ${tableId} not found`);
  }

  return table;
}

function resolveTableRepository(context: TelegramTableAdminContext): ClubTableRepository {
  if (context.tableRepository) {
    return context.tableRepository;
  }

  return createDatabaseClubTableRepository({
    database: context.runtime.services.database.db as never,
  });
}

function hasOwn(data: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(data, key);
}
