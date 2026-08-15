import { appendAuditEvent, type AuditLogRepository } from '../audit/audit-log.js';
import { createDatabaseAuditLogRepository } from '../audit/audit-log-store.js';
import type { AuthorizationService } from '../authorization/service.js';
import {
  createClubEquipment,
  deactivateClubEquipment,
  getClubEquipment,
  listClubEquipment,
  updateClubEquipmentMetadata,
  type ClubEquipmentRecord,
  type ClubEquipmentRepository,
} from '../equipment/equipment-catalog.js';
import { createDatabaseClubEquipmentRepository } from '../equipment/equipment-catalog-store.js';
import type { TelegramActor } from './actor-store.js';
import type { TelegramChatContext } from './chat-context.js';
import type { ConversationSessionRuntime } from './conversation-session.js';
import { createTelegramI18n, normalizeBotLanguage, supportedBotLanguages, type BotLanguage } from './i18n.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import { escapeHtml } from './schedule-presentation.js';
import { buildSubmenuReplyKeyboard } from './submenu-keyboards.js';

const createFlowKey = 'equipment-admin-create';
const editFlowKey = 'equipment-admin-edit';
const deactivateFlowKey = 'equipment-admin-deactivate';

export const equipmentAdminCallbackPrefixes = {
  inspect: 'equipment_admin:inspect:',
  edit: 'equipment_admin:edit:',
  deactivate: 'equipment_admin:deactivate:',
} as const;

export interface TelegramEquipmentAdminContext {
  messageText?: string;
  callbackData?: string;
  reply(message: string, options?: TelegramReplyOptions): Promise<unknown>;
  runtime: {
    actor: TelegramActor;
    authorization: AuthorizationService;
    session: ConversationSessionRuntime;
    chat: TelegramChatContext;
    services: { database: { db: unknown } };
    bot: { language?: string };
  };
  equipmentRepository?: ClubEquipmentRepository;
  auditRepository?: AuditLogRepository;
}

export async function handleTelegramEquipmentAdminText(context: TelegramEquipmentAdminContext): Promise<boolean> {
  const text = context.messageText?.trim();
  if (!text || context.runtime.chat.kind !== 'private' || !canManageEquipment(context)) return false;
  if (isEquipmentSession(context.runtime.session.current?.flowKey)) {
    return handleActiveSession(context, text);
  }

  const language = resolveLanguage(context);
  const texts = createTelegramI18n(language).equipmentAdmin;
  if (matchesEquipmentText(text, 'openMenu') || text === '/equipment') {
    await context.reply(texts.selectMenu, buildEquipmentMenu(language));
    return true;
  }
  if (matchesEquipmentText(text, 'create') || text === '/equipment_create') {
    await context.runtime.session.start({ flowKey: createFlowKey, stepKey: 'display-name', data: {} });
    await context.reply(texts.askName, cancelKeyboard());
    return true;
  }
  if (matchesEquipmentText(text, 'list') || text === '/equipment_list') {
    await replyWithEquipmentList(context, 'list');
    return true;
  }
  if (matchesEquipmentText(text, 'edit') || text === '/equipment_edit') {
    await replyWithEquipmentList(context, 'edit');
    return true;
  }
  if (matchesEquipmentText(text, 'deactivate') || text === '/equipment_deactivate') {
    await replyWithEquipmentList(context, 'deactivate');
    return true;
  }
  return false;
}

export async function handleTelegramEquipmentAdminCallback(context: TelegramEquipmentAdminContext): Promise<boolean> {
  const callbackData = context.callbackData;
  if (!callbackData || context.runtime.chat.kind !== 'private' || !canManageEquipment(context)) return false;
  const language = resolveLanguage(context);
  const texts = createTelegramI18n(language).equipmentAdmin;

  if (callbackData.startsWith(equipmentAdminCallbackPrefixes.inspect)) {
    const equipment = await loadEquipment(context, parseId(callbackData, equipmentAdminCallbackPrefixes.inspect));
    await context.reply(formatEquipmentDetails(equipment, language), { parseMode: 'HTML' });
    return true;
  }
  if (callbackData.startsWith(equipmentAdminCallbackPrefixes.edit)) {
    const equipment = await loadEquipment(context, parseId(callbackData, equipmentAdminCallbackPrefixes.edit));
    await context.runtime.session.start({ flowKey: editFlowKey, stepKey: 'display-name', data: { equipmentId: equipment.id } });
    await context.reply(`${formatEquipmentDetails(equipment, language)}\n\n${texts.askName}`, {
      ...keepCurrentKeyboard(language), parseMode: 'HTML',
    });
    return true;
  }
  if (callbackData.startsWith(equipmentAdminCallbackPrefixes.deactivate)) {
    const equipment = await loadEquipment(context, parseId(callbackData, equipmentAdminCallbackPrefixes.deactivate));
    await context.runtime.session.start({ flowKey: deactivateFlowKey, stepKey: 'confirm', data: { equipmentId: equipment.id } });
    await context.reply(`${formatEquipmentDetails(equipment, language)}\n\n${texts.askDeactivate}`, {
      ...confirmDeactivateKeyboard(language), parseMode: 'HTML',
    });
    return true;
  }
  return false;
}

export async function handleTelegramEquipmentAdminStartText(context: TelegramEquipmentAdminContext): Promise<boolean> {
  const payload = context.messageText?.trim().split(/\s+/).slice(1).join(' ') ?? '';
  if (!payload.startsWith('equipment_admin_') || context.runtime.chat.kind !== 'private' || !canManageEquipment(context)) return false;
  const equipmentId = Number(payload.slice('equipment_admin_'.length));
  if (!Number.isInteger(equipmentId) || equipmentId <= 0) return false;
  const equipment = await loadEquipment(context, equipmentId);
  await context.reply(formatEquipmentDetails(equipment, resolveLanguage(context)), { parseMode: 'HTML' });
  return true;
}

async function handleActiveSession(context: TelegramEquipmentAdminContext, text: string): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session) return false;
  const language = resolveLanguage(context);
  const texts = createTelegramI18n(language).equipmentAdmin;

  if (session.flowKey === createFlowKey) {
    if (session.stepKey === 'display-name') {
      await context.runtime.session.advance({ stepKey: 'description', data: { displayName: text } });
      await context.reply(texts.askDescription, descriptionKeyboard(language));
      return true;
    }
    if (session.stepKey === 'description') {
      const data = { ...session.data, description: text === texts.skipOptional ? null : text };
      await context.runtime.session.advance({ stepKey: 'confirm', data });
      await context.reply(formatDraft(data, language), confirmCreateKeyboard(language));
      return true;
    }
    if (session.stepKey === 'confirm') {
      if (text !== texts.confirmCreate) {
        await context.reply(texts.confirmCreatePrompt, confirmCreateKeyboard(language));
        return true;
      }
      const equipment = await createClubEquipment({
        repository: resolveEquipmentRepository(context),
        displayName: String(session.data.displayName ?? ''),
        description: (session.data.description as string | null | undefined) ?? null,
      });
      await auditEquipment(context, 'equipment.created', equipment, `Equipament creat: ${equipment.displayName}`);
      await context.runtime.session.cancel();
      await context.reply(`${texts.created}: ${equipment.displayName} (#${equipment.id}).`, buildEquipmentMenu(language));
      return true;
    }
  }

  if (session.flowKey === editFlowKey) {
    const equipment = await loadEquipment(context, Number(session.data.equipmentId));
    if (session.stepKey === 'display-name') {
      await context.runtime.session.advance({
        stepKey: 'description',
        data: { ...session.data, displayName: text === texts.keepCurrent ? equipment.displayName : text },
      });
      await context.reply(texts.askDescription, editDescriptionKeyboard(language));
      return true;
    }
    if (session.stepKey === 'description') {
      const description = text === texts.keepCurrent
        ? equipment.description
        : text === texts.clearDescription ? null : text;
      const data = { ...session.data, description };
      await context.runtime.session.advance({ stepKey: 'confirm', data });
      await context.reply(formatDraft(data, language), confirmEditKeyboard(language));
      return true;
    }
    if (session.stepKey === 'confirm') {
      if (text !== texts.confirmEdit) {
        await context.reply(texts.confirmEditPrompt, confirmEditKeyboard(language));
        return true;
      }
      const updated = await updateClubEquipmentMetadata({
        repository: resolveEquipmentRepository(context),
        equipmentId: equipment.id,
        displayName: String(session.data.displayName ?? equipment.displayName),
        description: Object.prototype.hasOwnProperty.call(session.data, 'description')
          ? session.data.description as string | null
          : equipment.description,
      });
      await auditEquipment(context, 'equipment.updated', updated, `Equipament actualitzat: ${updated.displayName}`);
      await context.runtime.session.cancel();
      await context.reply(`${texts.saved} ${updated.displayName} (#${updated.id}).`, buildEquipmentMenu(language));
      return true;
    }
  }

  if (session.flowKey === deactivateFlowKey) {
    if (text !== texts.confirmDeactivate) {
      await context.reply(texts.askDeactivate, confirmDeactivateKeyboard(language));
      return true;
    }
    const equipment = await deactivateClubEquipment({
      repository: resolveEquipmentRepository(context), equipmentId: Number(session.data.equipmentId),
    });
    await auditEquipment(context, 'equipment.deactivated', equipment, `Equipament desactivat: ${equipment.displayName}`);
    await context.runtime.session.cancel();
    await context.reply(`${texts.deactivated} ${equipment.displayName} (#${equipment.id}).`, buildEquipmentMenu(language));
    return true;
  }
  return false;
}

async function replyWithEquipmentList(context: TelegramEquipmentAdminContext, mode: 'list' | 'edit' | 'deactivate'): Promise<void> {
  const language = resolveLanguage(context);
  const texts = createTelegramI18n(language).equipmentAdmin;
  const equipment = await listClubEquipment({
    repository: resolveEquipmentRepository(context), includeDeactivated: mode === 'list',
  });
  if (equipment.length === 0) {
    await context.reply(texts.noEquipment, buildEquipmentMenu(language));
    return;
  }
  if (mode === 'list') {
    await context.reply([
      `<b>${escapeHtml(texts.listRegistered)}</b>`,
      ...equipment.map((item) => `- <b>${escapeHtml(item.displayName)}</b> (#${item.id})${item.lifecycleStatus === 'deactivated' ? ` [${escapeHtml(texts.deactivatedLabel)}]` : ''}`),
    ].join('\n'), { parseMode: 'HTML' });
    return;
  }
  await context.reply(mode === 'edit' ? texts.edit : texts.deactivate, {
    inlineKeyboard: equipment.map((item) => [{
      text: item.displayName,
      callbackData: `${mode === 'edit' ? equipmentAdminCallbackPrefixes.edit : equipmentAdminCallbackPrefixes.deactivate}${item.id}`,
    }]),
  });
}

function formatEquipmentDetails(equipment: ClubEquipmentRecord, language: BotLanguage): string {
  const texts = createTelegramI18n(language).equipmentAdmin;
  return [
    `<b>${escapeHtml(equipment.displayName)}</b> (#${equipment.id})`,
    `${escapeHtml(texts.status)}: ${escapeHtml(equipment.lifecycleStatus === 'active' ? texts.active : texts.deactivatedLabel)}`,
    `${escapeHtml(texts.description)}: ${escapeHtml(equipment.description ?? texts.noDescription)}`,
  ].join('\n');
}

function formatDraft(data: Record<string, unknown>, language: BotLanguage): string {
  const texts = createTelegramI18n(language).equipmentAdmin;
  return `<b>${escapeHtml(String(data.displayName ?? ''))}</b>\n${escapeHtml(texts.description)}: ${escapeHtml(String(data.description ?? texts.noDescription))}`;
}

async function loadEquipment(context: TelegramEquipmentAdminContext, equipmentId: number): Promise<ClubEquipmentRecord> {
  const equipment = await getClubEquipment({ repository: resolveEquipmentRepository(context), equipmentId });
  if (!equipment) throw new Error(`Club equipment ${equipmentId} not found`);
  return equipment;
}

async function auditEquipment(context: TelegramEquipmentAdminContext, actionKey: string, equipment: ClubEquipmentRecord, summary: string): Promise<void> {
  await appendAuditEvent({
    repository: context.auditRepository ?? createDatabaseAuditLogRepository({ database: context.runtime.services.database.db as never }),
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    actionKey,
    targetType: 'club-equipment',
    targetId: equipment.id,
    summary,
    details: { displayName: equipment.displayName, lifecycleStatus: equipment.lifecycleStatus },
  });
}

function resolveEquipmentRepository(context: TelegramEquipmentAdminContext): ClubEquipmentRepository {
  return context.equipmentRepository ?? createDatabaseClubEquipmentRepository({ database: context.runtime.services.database.db as never });
}

function canManageEquipment(context: TelegramEquipmentAdminContext): boolean {
  return context.runtime.actor.isAdmin || context.runtime.authorization.can('equipment.manage');
}

function resolveLanguage(context: TelegramEquipmentAdminContext): BotLanguage {
  return normalizeBotLanguage(context.runtime.bot.language, 'ca');
}

function matchesEquipmentText(text: string, key: keyof ReturnType<typeof createTelegramI18n>['equipmentAdmin']): boolean {
  return supportedBotLanguages.some((language) => createTelegramI18n(language).equipmentAdmin[key] === text);
}

function isEquipmentSession(flowKey: string | undefined): boolean {
  return flowKey === createFlowKey || flowKey === editFlowKey || flowKey === deactivateFlowKey;
}

function parseId(value: string, prefix: string): number {
  const id = Number(value.slice(prefix.length));
  if (!Number.isInteger(id) || id <= 0) throw new Error("No s'ha pogut identificar l'equipament.");
  return id;
}

function buildEquipmentMenu(language: BotLanguage): TelegramReplyOptions {
  const texts = createTelegramI18n(language).equipmentAdmin;
  return buildSubmenuReplyKeyboard({ language, rows: [[texts.create, texts.list], [texts.edit, texts.deactivate]] });
}

function cancelKeyboard(): TelegramReplyOptions {
  return { replyKeyboard: [[{ text: '/cancel', semanticRole: 'danger' }]], resizeKeyboard: true, persistentKeyboard: true };
}

function descriptionKeyboard(language: BotLanguage): TelegramReplyOptions {
  const texts = createTelegramI18n(language).equipmentAdmin;
  return { replyKeyboard: [[{ text: texts.skipOptional, semanticRole: 'success' }], [{ text: '/cancel', semanticRole: 'danger' }]], resizeKeyboard: true, persistentKeyboard: true };
}

function keepCurrentKeyboard(language: BotLanguage): TelegramReplyOptions {
  return { replyKeyboard: [[createTelegramI18n(language).equipmentAdmin.keepCurrent], [{ text: '/cancel', semanticRole: 'danger' }]], resizeKeyboard: true, persistentKeyboard: true };
}

function editDescriptionKeyboard(language: BotLanguage): TelegramReplyOptions {
  const texts = createTelegramI18n(language).equipmentAdmin;
  return { replyKeyboard: [[texts.keepCurrent, texts.clearDescription], [{ text: '/cancel', semanticRole: 'danger' }]], resizeKeyboard: true, persistentKeyboard: true };
}

function confirmCreateKeyboard(language: BotLanguage): TelegramReplyOptions {
  return { replyKeyboard: [[{ text: createTelegramI18n(language).equipmentAdmin.confirmCreate, semanticRole: 'success' }], [{ text: '/cancel', semanticRole: 'danger' }]], resizeKeyboard: true, persistentKeyboard: true };
}

function confirmEditKeyboard(language: BotLanguage): TelegramReplyOptions {
  return { replyKeyboard: [[{ text: createTelegramI18n(language).equipmentAdmin.confirmEdit, semanticRole: 'success' }], [{ text: '/cancel', semanticRole: 'danger' }]], resizeKeyboard: true, persistentKeyboard: true };
}

function confirmDeactivateKeyboard(language: BotLanguage): TelegramReplyOptions {
  return { replyKeyboard: [[{ text: createTelegramI18n(language).equipmentAdmin.confirmDeactivate, semanticRole: 'danger' }], [{ text: '/cancel', semanticRole: 'danger' }]], resizeKeyboard: true, persistentKeyboard: true };
}
