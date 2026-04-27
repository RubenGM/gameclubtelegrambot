import { appendAuditEvent, type AuditLogRepository } from '../audit/audit-log.js';
import { createDatabaseAuditLogRepository } from '../audit/audit-log-store.js';
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
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
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
  start: 'Inici',
  help: 'Ajuda',
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
      language?: string;
      sendPrivateMessage(telegramUserId: number, message: string): Promise<void>;
    };
  };
  tableRepository?: ClubTableRepository;
  auditRepository?: AuditLogRepository;
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

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const i18n = createTelegramI18n(language);
  const texts = i18n.tableAdmin;

  if (text === i18n.actionMenu.tables || text === tableAdminLabels.openMenu || text === '/tables') {
    await context.reply(texts.selectMenu, buildTableAdminMenuOptions(language));
    return true;
  }

  if (text === texts.create || text === tableAdminLabels.create || text === '/table_create') {
    await context.runtime.session.start({
      flowKey: createFlowKey,
      stepKey: 'display-name',
      data: {},
    });
    await context.reply(texts.askName, buildSingleCancelKeyboard(language));
    return true;
  }

  if (text === texts.list || text === tableAdminLabels.list || text === '/table_list') {
    await replyWithTableList(context, 'list', language);
    return true;
  }

  if (text === texts.edit || text === tableAdminLabels.edit || text === '/table_edit') {
    await replyWithTableList(context, 'edit', language);
    return true;
  }

  if (text === texts.deactivate || text === tableAdminLabels.deactivate || text === '/table_deactivate') {
    await replyWithTableList(context, 'deactivate', language);
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

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).tableAdmin;

  if (callbackData.startsWith(tableAdminCallbackPrefixes.inspect)) {
    const tableId = parseTableId(callbackData, tableAdminCallbackPrefixes.inspect);
    const table = await loadTableOrThrow(context, tableId);
    await context.reply(formatTableDetails(table), { parseMode: 'HTML' });
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
      `${formatTableDetails(table)}\n\n${texts.askName}`,
      { ...buildEditNameOptions(language), parseMode: 'HTML' },
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
      `${formatTableDetails(table)}\n\n${texts.askDeactivate}`,
      { ...buildDeactivateConfirmOptions(language), parseMode: 'HTML' },
    );
    return true;
  }

  return false;
}

export async function handleTelegramTableAdminStartText(context: TelegramTableAdminContext): Promise<boolean> {
  const tableId = parseStartPayload(context.messageText, 'table_admin_');
  if (tableId === null || context.runtime.chat.kind !== 'private' || !canManageTables(context)) {
    return false;
  }

  const table = await loadTableOrThrow(context, tableId);
  await context.reply(formatTableDetails(table), { parseMode: 'HTML' });
  return true;
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
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).tableAdmin;
  if (stepKey === 'display-name') {
    await context.runtime.session.advance({
      stepKey: 'description',
      data: { displayName: text },
    });
    await context.reply(
      texts.askDescription,
      buildDescriptionOptions(language),
    );
    return true;
  }

  if (stepKey === 'description') {
    await context.runtime.session.advance({
      stepKey: 'capacity',
      data: {
        ...data,
        description: text === texts.skipOptional || text === tableAdminLabels.skipOptional ? null : text,
      },
    });
    await context.reply(
      texts.askCapacity,
      buildCapacityOptions(language),
    );
    return true;
  }

  if (stepKey === 'capacity') {
    const recommendedCapacity = parseCapacity(text, language);
    if (recommendedCapacity instanceof Error) {
      await context.reply(
        texts.invalidCapacity,
        buildCapacityOptions(language),
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
      `${formatDraftSummary(nextData, texts)}\n\nTria una opcio per confirmar o cancel.lar.`,
      buildCreateConfirmOptions(language),
    );
    return true;
  }

  if (stepKey === 'confirm') {
    if (text !== texts.confirmCreate && text !== tableAdminLabels.confirmCreate) {
      await context.reply(texts.confirmCreatePrompt, buildCreateConfirmOptions(language));
      return true;
    }

    const repository = resolveTableRepository(context);
    const table = await createClubTable({
      repository,
      displayName: String(data.displayName ?? ''),
      description: (data.description as string | null | undefined) ?? null,
      recommendedCapacity: (data.recommendedCapacity as number | null | undefined) ?? null,
    });
    await appendAuditEvent({
      repository: resolveAuditRepository(context),
      actorTelegramUserId: context.runtime.actor.telegramUserId,
      actionKey: 'table.created',
      targetType: 'club-table',
      targetId: table.id,
      summary: `Taula creada: ${table.displayName}`,
      details: {
        displayName: table.displayName,
        recommendedCapacity: table.recommendedCapacity,
        lifecycleStatus: table.lifecycleStatus,
      },
    });
    await context.runtime.session.cancel();
    await context.reply(
      `${texts.created}: ${table.displayName} (#${table.id}).`,
      buildTableAdminMenuOptions(language),
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
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).tableAdmin;
  const tableId = Number(data.tableId);
  const table = await loadTableOrThrow(context, tableId);

  if (stepKey === 'display-name') {
    await context.runtime.session.advance({
      stepKey: 'description',
      data: {
        ...data,
        displayName: text === texts.keepCurrent || text === tableAdminLabels.keepCurrent ? table.displayName : text,
      },
    });
    await context.reply(
      texts.askDescription,
      buildEditDescriptionOptions(language),
    );
    return true;
  }

  if (stepKey === 'description') {
    const description =
      text === texts.keepCurrent || text === tableAdminLabels.keepCurrent
        ? table.description
        : text === texts.clearDescription || text === tableAdminLabels.clearDescription
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
      texts.askCapacity,
      buildEditCapacityOptions(language),
    );
    return true;
  }

  if (stepKey === 'capacity') {
    const recommendedCapacity =
      text === texts.keepCurrent || text === tableAdminLabels.keepCurrent
        ? table.recommendedCapacity
        : parseCapacity(text, language);

    if (recommendedCapacity instanceof Error) {
      await context.reply(
        texts.invalidCapacity,
        buildEditCapacityOptions(language),
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
      `${formatDraftSummary(nextData, texts)}\n\nTria una opcio per confirmar o cancel.lar.`,
      buildEditConfirmOptions(language),
    );
    return true;
  }

  if (stepKey === 'confirm') {
    if (text !== texts.confirmEdit && text !== tableAdminLabels.confirmEdit) {
      await context.reply(texts.confirmEditPrompt, buildEditConfirmOptions(language));
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
    await appendAuditEvent({
      repository: resolveAuditRepository(context),
      actorTelegramUserId: context.runtime.actor.telegramUserId,
      actionKey: 'table.updated',
      targetType: 'club-table',
      targetId: updated.id,
      summary: `Taula actualitzada: ${updated.displayName}`,
      details: {
        previousDisplayName: table.displayName,
        displayName: updated.displayName,
        previousRecommendedCapacity: table.recommendedCapacity,
        recommendedCapacity: updated.recommendedCapacity,
      },
    });
    await context.runtime.session.cancel();
    await context.reply(
      `${texts.saved}: ${updated.displayName} (#${updated.id}).`,
      buildTableAdminMenuOptions(language),
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
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).tableAdmin;
  if (text !== texts.confirmDeactivate && text !== tableAdminLabels.confirmDeactivate) {
    await context.reply(
      'Per desactivar la taula, tria el boto de confirmacio o cancel.la el proces.',
      buildDeactivateConfirmOptions(language),
    );
    return true;
  }

  const tableId = Number(data.tableId);
  const table = await deactivateClubTable({
    repository: resolveTableRepository(context),
    tableId,
  });
  await appendAuditEvent({
    repository: resolveAuditRepository(context),
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    actionKey: 'table.deactivated',
    targetType: 'club-table',
    targetId: table.id,
    summary: `Taula desactivada: ${table.displayName}`,
    details: {
      displayName: table.displayName,
      lifecycleStatus: table.lifecycleStatus,
      deactivatedAt: table.deactivatedAt,
    },
  });
  await context.runtime.session.cancel();
    await context.reply(
      `${texts.deactivated}: ${table.displayName} (#${table.id}).`,
      buildTableAdminMenuOptions(language),
    );
  return true;
}

function buildTableAdminMenuOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const i18n = createTelegramI18n(language);
  const texts = i18n.tableAdmin;
  return {
    replyKeyboard: [
      [texts.create, texts.list],
      [texts.edit, texts.deactivate],
      [i18n.actionMenu.start, i18n.actionMenu.help],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function resolveAuditRepository(context: TelegramTableAdminContext): AuditLogRepository {
  if (context.auditRepository) {
    return context.auditRepository;
  }
  return createDatabaseAuditLogRepository({ database: context.runtime.services.database.db as never });
}

function buildDescriptionOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).tableAdmin;
  return {
    replyKeyboard: [[successButton(texts.skipOptional)], [dangerButton(tableAdminLabels.cancel)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildCapacityOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).tableAdmin;
  return {
    replyKeyboard: [[successButton(texts.noCapacity)], [dangerButton(tableAdminLabels.cancel)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildCreateConfirmOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).tableAdmin;
  return {
    replyKeyboard: [[successButton(texts.confirmCreate)], [dangerButton(tableAdminLabels.cancel)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildEditNameOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).tableAdmin;
  return {
    replyKeyboard: [[texts.keepCurrent], [dangerButton(tableAdminLabels.cancel)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildEditDescriptionOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).tableAdmin;
  return {
    replyKeyboard: [
      [texts.keepCurrent, texts.clearDescription],
      [dangerButton(tableAdminLabels.cancel)],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildEditCapacityOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).tableAdmin;
  return {
    replyKeyboard: [
      [texts.keepCurrent, texts.noCapacity],
      [dangerButton(tableAdminLabels.cancel)],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildEditConfirmOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).tableAdmin;
  return {
    replyKeyboard: [[successButton(texts.confirmEdit)], [dangerButton(tableAdminLabels.cancel)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildDeactivateConfirmOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).tableAdmin;
  return {
    replyKeyboard: [[dangerButton(texts.confirmDeactivate)], [dangerButton(tableAdminLabels.cancel)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildSingleCancelKeyboard(_language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  return {
    replyKeyboard: [[dangerButton(tableAdminLabels.cancel)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function successButton(text: string) {
  return { text, semanticRole: 'success' as const };
}

function dangerButton(text: string) {
  return { text, semanticRole: 'danger' as const };
}

async function replyWithTableList(
  context: TelegramTableAdminContext,
  mode: 'list' | 'edit' | 'deactivate',
  language: 'ca' | 'es' | 'en' = 'ca',
): Promise<void> {
  const texts = createTelegramI18n(language).tableAdmin;
  const tables = await listClubTables({
    repository: resolveTableRepository(context),
    includeDeactivated: mode === 'list',
  });

  if (tables.length === 0) {
    await context.reply(texts.noTables, buildTableAdminMenuOptions(language));
    return;
  }

  if (mode === 'list') {
    await context.reply(formatTableListMessage(tables), { parseMode: 'HTML' });
    return;
  }

  await context.reply(`Tria la taula que vols ${mode === 'edit' ? 'editar' : 'desactivar'}.`, {
    inlineKeyboard: tables.map((table) => [{
      text: table.displayName,
      callbackData: mode === 'edit'
        ? `${tableAdminCallbackPrefixes.edit}${table.id}`
        : `${tableAdminCallbackPrefixes.deactivate}${table.id}`,
    }]),
  });
}

function formatTableListMessage(tables: ClubTableRecord[]): string {
  return formatTelegramTableListMessage({ tables, audience: 'admin' });
}

function formatTableDetails(table: ClubTableRecord): string {
  return formatTelegramTableDetails({ table, audience: 'admin' });
}

function formatDraftSummary(data: Record<string, unknown>, texts = createTelegramI18n('ca').tableAdmin): string {
  return [
    texts.draftSummary,
    `- Nom: ${String(data.displayName ?? '')}`,
    `- ${texts.descriptionField}: ${(data.description as string | null | undefined) ?? texts.noDescription}`,
    `- Capacitat recomanada: ${(data.recommendedCapacity as number | null | undefined) ?? texts.noValue}`,
  ].join('\n');
}

function parseCapacity(text: string, language: 'ca' | 'es' | 'en' = 'ca'): number | null | Error {
  const texts = createTelegramI18n(language).tableAdmin;
  if (text === texts.noCapacity || text === tableAdminLabels.noCapacity) {
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

function parseStartPayload(messageText: string | undefined, prefix: string): number | null {
  const payload = messageText?.trim().split(/\s+/).slice(1).join(' ');
  if (!payload || !payload.startsWith(prefix)) {
    return null;
  }

  const value = Number(payload.slice(prefix.length));
  return Number.isInteger(value) && value > 0 ? value : null;
}

function hasOwn(data: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(data, key);
}
