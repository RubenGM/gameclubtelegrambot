import { appendAuditEvent, type AuditLogRepository } from '../audit/audit-log.js';
import { createDatabaseAuditLogRepository } from '../audit/audit-log-store.js';
import {
  changeGroupPurchaseParticipantStatus,
  createGroupPurchase,
  joinGroupPurchase,
  setGroupPurchaseLifecycleStatus,
  updateGroupPurchaseParticipantFieldValues,
  type GroupPurchaseFieldInput,
  type GroupPurchaseRepository,
} from '../group-purchases/group-purchase-catalog.js';
import { createDatabaseGroupPurchaseRepository } from '../group-purchases/group-purchase-catalog-store.js';
import type { NewsGroupRepository } from '../news/news-group-catalog.js';
import { createDatabaseNewsGroupRepository } from '../news/news-group-store.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import { buildTelegramStartUrl } from './deep-links.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import {
  buildGroupPurchaseDateOptions,
  buildGroupPurchaseFieldMenuOptions,
  buildGroupPurchaseMenuOptions,
  buildGroupPurchaseModeOptions,
  buildGroupPurchaseSaveOptions,
  buildGroupPurchaseSingleCancelKeyboard,
  buildGroupPurchaseSkipCancelKeyboard,
  buildGroupPurchaseYesNoOptions,
  groupPurchaseLabels,
} from './group-purchase-keyboards.js';
import { formatGroupPurchaseDetailMessage, formatGroupPurchaseListMessage } from './group-purchase-presentation.js';
import { escapeHtml } from './schedule-presentation.js';
import { parseDate } from './schedule-parsing.js';

const createFlowKey = 'group-purchase-create';
const editFlowKey = 'group-purchase-edit';
const participantFieldFlowKey = 'group-purchase-participant-fields';
const publishMessageFlowKey = 'group-purchase-publish-message';

export const groupPurchaseCallbackPrefixes = {
  join: 'group_purchase:join:',
  joinInterested: 'group_purchase:join_interested:',
  joinConfirmed: 'group_purchase:join_confirmed:',
  editValues: 'group_purchase:edit_values:',
  leave: 'group_purchase:leave:',
  confirm: 'group_purchase:confirm:',
  manageParticipants: 'group_purchase:manage_participants:',
  participantStatus: 'group_purchase:participant_status:',
  publishMessage: 'group_purchase:publish_message:',
  lifecycle: 'group_purchase:lifecycle:',
  editPurchase: 'group_purchase:edit_purchase:',
  publishGroup: 'group_purchase:publish_group:',
} as const;

interface GroupPurchaseCreateDraft {
  title?: string;
  description?: string | null;
  purchaseMode?: 'per_item' | 'shared_cost';
  unitPriceCents?: number | null;
  totalPriceCents?: number | null;
  unitLabel?: string | null;
  joinDeadlineAt?: string | null;
  confirmDeadlineAt?: string | null;
  fields?: GroupPurchaseFieldInput[];
  pendingFieldType?: 'integer' | 'single_choice' | 'text';
  pendingFieldLabel?: string;
}

interface GroupPurchaseParticipantFieldDraft {
  purchaseId: number;
  fieldIndex: number;
  valuesByFieldKey: Record<string, unknown>;
  targetStatus: 'interested' | 'confirmed';
}

interface GroupPurchasePublishMessageDraft {
  purchaseId: number;
}

interface GroupPurchaseEditDraft {
  purchaseId: number;
  title?: string;
}

export type TelegramGroupPurchaseContext = TelegramCommandHandlerContext & {
  groupPurchaseRepository?: GroupPurchaseRepository;
};

export async function handleTelegramGroupPurchaseCommand(context: TelegramGroupPurchaseContext): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  await context.reply(createTelegramI18n(language).groupPurchases.selectMenu, buildGroupPurchaseMenuOptions(language));
}

export async function handleTelegramGroupPurchaseText(context: TelegramGroupPurchaseContext): Promise<boolean> {
  const text = context.messageText?.trim();
  if (
    !text ||
    context.runtime.chat.kind !== 'private' ||
    !context.runtime.actor.isApproved ||
    context.runtime.actor.isBlocked
  ) {
    return false;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const i18n = createTelegramI18n(language);
  const texts = i18n.groupPurchases;

  if (context.runtime.session.current?.flowKey === createFlowKey) {
    return handleActiveCreateFlow(context, text, language);
  }
  if (context.runtime.session.current?.flowKey === editFlowKey) {
    return handleActiveEditFlow(context, text, language);
  }
  if (context.runtime.session.current?.flowKey === participantFieldFlowKey) {
    return handleActiveParticipantFieldFlow(context, text, language);
  }
  if (context.runtime.session.current?.flowKey === publishMessageFlowKey) {
    return handleActivePublishMessageFlow(context, text, language);
  }

  if (text === i18n.actionMenu.groupPurchases || text === groupPurchaseLabels.openMenu || text === '/group_purchases') {
    await handleTelegramGroupPurchaseCommand(context);
    return true;
  }

  if (text === texts.list || text === groupPurchaseLabels.list) {
    const purchases = (await resolveRepository(context).listPurchases()).filter(
      (purchase) => purchase.lifecycleStatus !== 'archived' && purchase.lifecycleStatus !== 'cancelled',
    );
    await context.reply(
      purchases.length === 0 ? texts.noPurchases : formatGroupPurchaseListMessage({ purchases, language }),
      {
        ...buildGroupPurchaseMenuOptions(language),
        ...(purchases.length > 0 ? { parseMode: 'HTML' as const } : {}),
      },
    );
    return true;
  }

  if (text === texts.create || text === groupPurchaseLabels.create) {
    await context.runtime.session.start({ flowKey: createFlowKey, stepKey: 'title', data: { fields: [] } });
    await context.reply(texts.askTitle, buildGroupPurchaseSingleCancelKeyboard());
    return true;
  }

  return false;
}

export async function handleTelegramGroupPurchaseStartText(context: TelegramGroupPurchaseContext): Promise<boolean> {
  const purchaseId = parseStartPayload(context.messageText, 'group_purchase_');
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  if (context.runtime.chat.kind !== 'private' || !context.runtime.actor.isApproved) {
    return false;
  }

  if (purchaseId !== null) {
    const detail = await resolveRepository(context).getPurchaseDetail(purchaseId);
    if (!detail) {
      throw new Error(`Group purchase ${purchaseId} not found`);
    }

    await context.reply(formatGroupPurchaseDetailMessage({ detail, language }), buildGroupPurchaseDetailOptions(context, detail, language));
    return true;
  }

  const participantTarget = parseParticipantStartPayload(context.messageText);
  if (!participantTarget) {
    return false;
  }

  const detail = await loadPurchaseDetailOrThrow(context, participantTarget.purchaseId);
  const participantValuesByUserId = await loadParticipantValuesByUserId(context, detail);
  await context.reply(
    buildParticipantDetailMessage(detail, participantTarget.participantTelegramUserId, language, participantValuesByUserId),
    buildParticipantDetailOptions(detail, participantTarget.participantTelegramUserId, language),
  );
  return true;
}

export async function handleTelegramGroupPurchaseCallback(context: TelegramGroupPurchaseContext): Promise<boolean> {
  const callbackData = context.callbackData;
  if (!callbackData || context.runtime.chat.kind !== 'private' || !context.runtime.actor.isApproved) {
    return false;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');

  if (
    callbackData.startsWith(groupPurchaseCallbackPrefixes.join) ||
    callbackData.startsWith(groupPurchaseCallbackPrefixes.joinInterested) ||
    callbackData.startsWith(groupPurchaseCallbackPrefixes.joinConfirmed)
  ) {
    const isLegacyJoin = callbackData.startsWith(groupPurchaseCallbackPrefixes.join);
    const isJoinConfirmed = callbackData.startsWith(groupPurchaseCallbackPrefixes.joinConfirmed);
    const purchaseId = parseEntityId(
      callbackData,
      isLegacyJoin
        ? groupPurchaseCallbackPrefixes.join
        : isJoinConfirmed
          ? groupPurchaseCallbackPrefixes.joinConfirmed
          : groupPurchaseCallbackPrefixes.joinInterested,
      'group purchase',
    );
    const detail = await loadPurchaseDetailOrThrow(context, purchaseId);
    const participant = await joinGroupPurchase({
      repository: resolveRepository(context),
      purchaseId,
      participantTelegramUserId: context.runtime.actor.telegramUserId,
    });
    const targetStatus: 'interested' | 'confirmed' = isJoinConfirmed ? 'confirmed' : 'interested';
    if (targetStatus === 'confirmed' && detail.fields.length === 0) {
      await changeGroupPurchaseParticipantStatus({
        repository: resolveRepository(context),
        purchaseId,
        participantTelegramUserId: participant.participantTelegramUserId,
        actorRole: 'self',
        nextStatus: 'confirmed',
      });
    }
    if (detail.fields.length === 0) {
      const nextDetail = await loadPurchaseDetailOrThrow(context, purchaseId);
      await context.reply(formatGroupPurchaseDetailMessage({ detail: nextDetail, language }), buildGroupPurchaseDetailOptions(context, nextDetail, language));
      return true;
    }
    await context.runtime.session.start({
      flowKey: participantFieldFlowKey,
      stepKey: 'field',
      data: { purchaseId, fieldIndex: 0, valuesByFieldKey: {}, targetStatus },
    });
    await replyWithCurrentParticipantField(context, { purchaseId, fieldIndex: 0, valuesByFieldKey: {}, targetStatus }, language);
    return true;
  }

  if (callbackData.startsWith(groupPurchaseCallbackPrefixes.editValues)) {
    const purchaseId = parseEntityId(callbackData, groupPurchaseCallbackPrefixes.editValues, 'group purchase');
    const detail = await loadPurchaseDetailOrThrow(context, purchaseId);
    if (detail.fields.length === 0) {
      await context.reply(formatGroupPurchaseDetailMessage({ detail, language }), buildGroupPurchaseDetailOptions(context, detail, language));
      return true;
    }
    await context.runtime.session.start({
      flowKey: participantFieldFlowKey,
      stepKey: 'field',
      data: { purchaseId, fieldIndex: 0, valuesByFieldKey: {}, targetStatus: 'interested' },
    });
    await replyWithCurrentParticipantField(context, { purchaseId, fieldIndex: 0, valuesByFieldKey: {}, targetStatus: 'interested' }, language);
    return true;
  }

  if (callbackData.startsWith(groupPurchaseCallbackPrefixes.leave)) {
    const purchaseId = parseEntityId(callbackData, groupPurchaseCallbackPrefixes.leave, 'group purchase');
    await changeGroupPurchaseParticipantStatus({
      repository: resolveRepository(context),
      purchaseId,
      participantTelegramUserId: context.runtime.actor.telegramUserId,
      actorRole: 'self',
      nextStatus: 'removed',
    });
    const detail = await loadPurchaseDetailOrThrow(context, purchaseId);
    await context.reply(formatGroupPurchaseDetailMessage({ detail, language }), buildGroupPurchaseDetailOptions(context, detail, language));
    return true;
  }

  if (callbackData.startsWith(groupPurchaseCallbackPrefixes.manageParticipants)) {
    const purchaseId = parseEntityId(callbackData, groupPurchaseCallbackPrefixes.manageParticipants, 'group purchase');
    const detail = await loadPurchaseDetailOrThrow(context, purchaseId);
    const participantValuesByUserId = await loadParticipantValuesByUserId(context, detail);
    await context.reply(buildParticipantManagementMessage(detail, language, participantValuesByUserId), buildParticipantManagementOptions(detail, language));
    return true;
  }

  if (callbackData.startsWith(groupPurchaseCallbackPrefixes.editPurchase)) {
    const purchaseId = parseEntityId(callbackData, groupPurchaseCallbackPrefixes.editPurchase, 'group purchase');
    await context.runtime.session.start({
      flowKey: editFlowKey,
      stepKey: 'title',
      data: { purchaseId },
    });
    await context.reply(createTelegramI18n(language).groupPurchases.askEditTitle, buildGroupPurchaseSingleCancelKeyboard());
    return true;
  }

  if (callbackData.startsWith(groupPurchaseCallbackPrefixes.participantStatus)) {
    const payload = callbackData.slice(groupPurchaseCallbackPrefixes.participantStatus.length).split(':');
    const purchaseId = Number(payload[0]);
    const participantTelegramUserId = Number(payload[1]);
    const nextStatus = payload[2];
    if (!Number.isInteger(purchaseId) || !Number.isInteger(participantTelegramUserId) || !nextStatus) {
      throw new Error('Could not identify group purchase participant status change');
    }
    const participant = await changeGroupPurchaseParticipantStatus({
      repository: resolveRepository(context),
      purchaseId,
      participantTelegramUserId,
      actorRole: 'manager',
      nextStatus: nextStatus as 'interested' | 'confirmed' | 'paid' | 'delivered' | 'removed',
    });
    const detail = await loadPurchaseDetailOrThrow(context, purchaseId);
    await appendAuditEvent({
      repository: resolveAuditRepository(context),
      actorTelegramUserId: context.runtime.actor.telegramUserId,
      actionKey: 'group_purchase.participant_status_changed',
      targetType: 'group-purchase-participant',
      targetId: `${purchaseId}:${participantTelegramUserId}`,
      summary: `Group purchase participant status changed to ${participant.status}`,
      details: { purchaseId, participantTelegramUserId, status: participant.status },
    });
    await context.runtime.bot.sendPrivateMessage(
      participantTelegramUserId,
      `Your status in ${detail.purchase.title} is now ${participant.status}.`,
    );
    const participantValuesByUserId = await loadParticipantValuesByUserId(context, detail);
    await context.reply(
      buildParticipantManagementMessage(detail, language, participantValuesByUserId),
      buildParticipantManagementOptions(detail, language),
    );
    return true;
  }

  if (callbackData.startsWith(groupPurchaseCallbackPrefixes.lifecycle)) {
    const payload = callbackData.slice(groupPurchaseCallbackPrefixes.lifecycle.length).split(':');
    const purchaseId = Number(payload[0]);
    const nextStatus = payload[1];
    if (!Number.isInteger(purchaseId) || !nextStatus) {
      throw new Error('Could not identify group purchase lifecycle change');
    }
    const purchase = await setGroupPurchaseLifecycleStatus({
      repository: resolveRepository(context),
      purchaseId,
      nextStatus: nextStatus as 'open' | 'closed' | 'archived' | 'cancelled',
    });
    await appendAuditEvent({
      repository: resolveAuditRepository(context),
      actorTelegramUserId: context.runtime.actor.telegramUserId,
      actionKey: `group_purchase.${purchase.lifecycleStatus}`,
      targetType: 'group-purchase',
      targetId: purchase.id,
      summary: `Group purchase set to ${purchase.lifecycleStatus}`,
      details: { lifecycleStatus: purchase.lifecycleStatus },
    });
    if (purchase.lifecycleStatus === 'archived') {
      await context.reply(createTelegramI18n(language).groupPurchases.selectMenu, buildGroupPurchaseMenuOptions(language));
      return true;
    }
    const detail = await loadPurchaseDetailOrThrow(context, purchaseId);
    await context.reply(formatGroupPurchaseDetailMessage({ detail, language }), buildGroupPurchaseDetailOptions(context, detail, language));
    return true;
  }

  if (callbackData.startsWith(groupPurchaseCallbackPrefixes.publishMessage)) {
    const purchaseId = parseEntityId(callbackData, groupPurchaseCallbackPrefixes.publishMessage, 'group purchase');
    await context.runtime.session.start({
      flowKey: publishMessageFlowKey,
      stepKey: 'body',
      data: { purchaseId },
    });
    await context.reply(createTelegramI18n(language).groupPurchases.askPublishMessage, buildGroupPurchaseSingleCancelKeyboard());
    return true;
  }

  if (callbackData.startsWith(groupPurchaseCallbackPrefixes.publishGroup)) {
    const purchaseId = parseEntityId(callbackData, groupPurchaseCallbackPrefixes.publishGroup, 'group purchase');
    const detail = await loadPurchaseDetailOrThrow(context, purchaseId);
    await publishGroupPurchaseAnnouncement(context, detail, language);
    await context.reply(formatGroupPurchaseDetailMessage({ detail, language }), buildGroupPurchaseDetailOptions(context, detail, language));
    return true;
  }

  if (callbackData.startsWith(groupPurchaseCallbackPrefixes.confirm)) {
    const purchaseId = parseEntityId(callbackData, groupPurchaseCallbackPrefixes.confirm, 'group purchase');
    await changeGroupPurchaseParticipantStatus({
      repository: resolveRepository(context),
      purchaseId,
      participantTelegramUserId: context.runtime.actor.telegramUserId,
      actorRole: 'self',
      nextStatus: 'confirmed',
    });
    const detail = await loadPurchaseDetailOrThrow(context, purchaseId);
    await context.reply(formatGroupPurchaseDetailMessage({ detail, language }), buildGroupPurchaseDetailOptions(context, detail, language));
    return true;
  }

  return false;
}

function resolveRepository(context: TelegramGroupPurchaseContext): GroupPurchaseRepository {
  if (context.groupPurchaseRepository) {
    return context.groupPurchaseRepository;
  }

  return createDatabaseGroupPurchaseRepository({
    database: context.runtime.services.database.db as never,
  });
}

function resolveAuditRepository(context: TelegramGroupPurchaseContext): AuditLogRepository {
  const maybeContext = context as TelegramGroupPurchaseContext & { auditRepository?: AuditLogRepository };
  if (maybeContext.auditRepository) {
    return maybeContext.auditRepository;
  }

  return createDatabaseAuditLogRepository({
    database: context.runtime.services.database.db as never,
  });
}

function resolveNewsGroupRepository(context: TelegramGroupPurchaseContext): NewsGroupRepository {
  const maybeContext = context as TelegramGroupPurchaseContext & { newsGroupRepository?: NewsGroupRepository };
  if (maybeContext.newsGroupRepository) {
    return maybeContext.newsGroupRepository;
  }

  return createDatabaseNewsGroupRepository({
    database: context.runtime.services.database.db as never,
  });
}

async function handleActiveParticipantFieldFlow(
  context: TelegramGroupPurchaseContext,
  text: string,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== participantFieldFlowKey) {
    return false;
  }

  const draft = session.data as unknown as GroupPurchaseParticipantFieldDraft;
  const detail = await loadPurchaseDetailOrThrow(context, draft.purchaseId);
  const field = detail.fields[draft.fieldIndex];
  if (!field) {
    await context.runtime.session.cancel();
    return true;
  }

  const nextValuesByFieldKey = {
    ...draft.valuesByFieldKey,
    [field.fieldKey]: text,
  };

  if (draft.fieldIndex + 1 < detail.fields.length) {
    const nextDraft = {
      ...draft,
      fieldIndex: draft.fieldIndex + 1,
      valuesByFieldKey: nextValuesByFieldKey,
    };
    await context.runtime.session.advance({ stepKey: 'field', data: nextDraft });
    await replyWithCurrentParticipantField(context, nextDraft, language);
    return true;
  }

  await updateGroupPurchaseParticipantFieldValues({
    repository: resolveRepository(context),
    purchaseId: draft.purchaseId,
    participantTelegramUserId: context.runtime.actor.telegramUserId,
    valuesByFieldKey: nextValuesByFieldKey,
  });
  if (draft.targetStatus === 'confirmed') {
    await changeGroupPurchaseParticipantStatus({
      repository: resolveRepository(context),
      purchaseId: draft.purchaseId,
      participantTelegramUserId: context.runtime.actor.telegramUserId,
      actorRole: 'self',
      nextStatus: 'confirmed',
    });
  }
  await context.runtime.session.cancel();
  const nextDetail = await loadPurchaseDetailOrThrow(context, draft.purchaseId);
  await context.reply(formatGroupPurchaseDetailMessage({ detail: nextDetail, language }), buildGroupPurchaseDetailOptions(context, nextDetail, language));
  return true;
}

async function handleActivePublishMessageFlow(
  context: TelegramGroupPurchaseContext,
  text: string,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== publishMessageFlowKey) {
    return false;
  }

  const draft = session.data as unknown as GroupPurchasePublishMessageDraft;
  const detail = await loadPurchaseDetailOrThrow(context, draft.purchaseId);
  await resolveRepository(context).createMessage({
    purchaseId: draft.purchaseId,
    authorTelegramUserId: context.runtime.actor.telegramUserId,
    body: text,
  });
  await appendAuditEvent({
    repository: resolveAuditRepository(context),
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    actionKey: 'group_purchase.message_published',
    targetType: 'group-purchase',
    targetId: draft.purchaseId,
    summary: `Group purchase message published for ${detail.purchase.title}`,
    details: {
      recipientCount: detail.participants.filter((participant) => participant.status !== 'removed').length,
    },
  });

  const senderLabel = context.from?.first_name?.trim() || context.from?.username?.trim() || `Usuari ${context.runtime.actor.telegramUserId}`;
  const message = `Este es un mensaje sobre la compra conjunta <a href="${buildGroupPurchaseLink(draft.purchaseId)}">${escapeHtml(detail.purchase.title)}</a>, enviado por ${escapeHtml(senderLabel)}:\n\n${escapeHtml(text)}`;

  await Promise.all(
    detail.participants
      .filter((participant) => participant.status !== 'removed')
      .map(async (participant) => {
        await context.runtime.bot.sendPrivateMessage(participant.participantTelegramUserId, message, { parseMode: 'HTML' });
      }),
  );

  await context.runtime.session.cancel();
  const nextDetail = await loadPurchaseDetailOrThrow(context, draft.purchaseId);
  await context.reply(formatGroupPurchaseDetailMessage({ detail: nextDetail, language }), buildGroupPurchaseDetailOptions(context, nextDetail, language));
  return true;
}

async function handleActiveEditFlow(
  context: TelegramGroupPurchaseContext,
  text: string,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== editFlowKey) {
    return false;
  }

  const draft = session.data as unknown as GroupPurchaseEditDraft;
  const texts = createTelegramI18n(language).groupPurchases;

  if (session.stepKey === 'title') {
    await context.runtime.session.advance({
      stepKey: 'description',
      data: { ...draft, title: text.trim() },
    });
    await context.reply(texts.askEditDescription, buildGroupPurchaseSkipCancelKeyboard(language));
    return true;
  }

  if (session.stepKey === 'description') {
    const detail = await loadPurchaseDetailOrThrow(context, draft.purchaseId);
    const updated = await resolveRepository(context).updatePurchase({
      purchaseId: draft.purchaseId,
      title: draft.title ?? detail.purchase.title,
      description: text === texts.skipOptional ? null : text.trim(),
      joinDeadlineAt: detail.purchase.joinDeadlineAt,
      confirmDeadlineAt: detail.purchase.confirmDeadlineAt,
      totalPriceCents: detail.purchase.totalPriceCents,
      unitPriceCents: detail.purchase.unitPriceCents,
      unitLabel: detail.purchase.unitLabel,
      allocationFieldKey: detail.purchase.allocationFieldKey,
    });
    await appendAuditEvent({
      repository: resolveAuditRepository(context),
      actorTelegramUserId: context.runtime.actor.telegramUserId,
      actionKey: 'group_purchase.updated',
      targetType: 'group-purchase',
      targetId: updated.id,
      summary: `Group purchase updated: ${updated.title}`,
      details: { title: updated.title },
    });
    await context.runtime.session.cancel();
    const nextDetail = await loadPurchaseDetailOrThrow(context, draft.purchaseId);
    await context.reply(formatGroupPurchaseDetailMessage({ detail: nextDetail, language }), buildGroupPurchaseDetailOptions(context, nextDetail, language));
    return true;
  }

  return false;
}

async function handleActiveCreateFlow(
  context: TelegramGroupPurchaseContext,
  text: string,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== createFlowKey) {
    return false;
  }

  const texts = createTelegramI18n(language).groupPurchases;
  const draft = readCreateDraft(session.data);

  if (session.stepKey === 'title') {
    await context.runtime.session.advance({ stepKey: 'description', data: { ...draft, title: text } });
    await context.reply(texts.askDescription, buildGroupPurchaseSkipCancelKeyboard(language));
    return true;
  }

  if (session.stepKey === 'description') {
    await context.runtime.session.advance({
      stepKey: 'mode',
      data: { ...draft, description: text === texts.skipOptional ? null : text.trim() },
    });
    await context.reply(texts.askMode, buildGroupPurchaseModeOptions(language));
    return true;
  }

  if (session.stepKey === 'mode') {
    const purchaseMode = parseModeSelection(text, language);
    if (!purchaseMode) {
      await context.reply(texts.invalidMode, buildGroupPurchaseModeOptions(language));
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'price', data: { ...draft, purchaseMode } });
    await context.reply(
      purchaseMode === 'per_item' ? texts.askUnitPrice : texts.askTotalPrice,
      buildGroupPurchaseSkipCancelKeyboard(language),
    );
    return true;
  }

  if (session.stepKey === 'price') {
    const cents = text === texts.skipOptional ? null : parseMoneyToCents(text);
    if (text !== texts.skipOptional && cents === null) {
      await context.reply(texts.invalidMoney, buildGroupPurchaseSkipCancelKeyboard(language));
      return true;
    }
    if (draft.purchaseMode === 'per_item') {
      await context.runtime.session.advance({ stepKey: 'unit-label', data: { ...draft, unitPriceCents: cents } });
      await context.reply(texts.askUnitLabel, buildGroupPurchaseSkipCancelKeyboard(language));
      return true;
    }

    await context.runtime.session.advance({ stepKey: 'join-deadline', data: { ...draft, totalPriceCents: cents } });
    await context.reply(texts.askJoinDeadline, buildGroupPurchaseDateOptions(language));
    return true;
  }

  if (session.stepKey === 'unit-label') {
    await context.runtime.session.advance({
      stepKey: 'join-deadline',
      data: { ...draft, unitLabel: text === texts.skipOptional ? null : text.trim() },
    });
    await context.reply(texts.askJoinDeadline, buildGroupPurchaseDateOptions(language));
    return true;
  }

  if (session.stepKey === 'join-deadline') {
    const joinDeadlineAt = text === texts.skipOptional ? null : parseDeadline(text);
    if (text !== texts.skipOptional && joinDeadlineAt === null) {
      await context.reply(texts.invalidDeadline, buildGroupPurchaseDateOptions(language));
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'confirm-deadline', data: { ...draft, joinDeadlineAt } });
    await context.reply(texts.askConfirmDeadline, buildGroupPurchaseDateOptions(language));
    return true;
  }

  if (session.stepKey === 'confirm-deadline') {
    const confirmDeadlineAt = text === texts.skipOptional ? null : parseDeadline(text);
    if (text !== texts.skipOptional && confirmDeadlineAt === null) {
      await context.reply(texts.invalidDeadline, buildGroupPurchaseDateOptions(language));
      return true;
    }
    await context.runtime.session.advance({
      stepKey: 'field-menu',
      data: { ...draft, confirmDeadlineAt, fields: draft.fields ?? [] },
    });
    await context.reply(texts.fieldMenu, buildGroupPurchaseFieldMenuOptions(language));
    return true;
  }

  if (session.stepKey === 'field-menu') {
    const fieldType = parseFieldTypeSelection(text, language);
    if (fieldType) {
      await context.runtime.session.advance({ stepKey: 'field-label', data: { ...draft, pendingFieldType: fieldType } });
      await context.reply(texts.askFieldLabel, buildGroupPurchaseSingleCancelKeyboard());
      return true;
    }
    if (text === texts.continueFields) {
      if ((draft.fields ?? []).length === 0 && draft.purchaseMode !== 'shared_cost') {
        await context.reply(texts.fieldRequiredMessage, buildGroupPurchaseFieldMenuOptions(language));
        return true;
      }
      if (draft.purchaseMode === 'per_item' && !hasQuantityField(draft.fields ?? [])) {
        await context.reply(texts.perItemQuantityFieldRequired, buildGroupPurchaseFieldMenuOptions(language));
        return true;
      }
      await context.runtime.session.advance({ stepKey: 'confirm', data: draft as unknown as Record<string, unknown> });
      await context.reply(formatCreateSummary(draft, language), buildGroupPurchaseSaveOptions(language));
      return true;
    }
    await context.reply(texts.fieldMenu, buildGroupPurchaseFieldMenuOptions(language));
    return true;
  }

  if (session.stepKey === 'field-label') {
    const pendingFieldLabel = text.trim();
    if (pendingFieldLabel.length === 0) {
      await context.reply(texts.askFieldLabel, buildGroupPurchaseSingleCancelKeyboard());
      return true;
    }
    if (draft.pendingFieldType === 'single_choice') {
      await context.runtime.session.advance({ stepKey: 'field-options', data: { ...draft, pendingFieldLabel } });
      await context.reply(texts.askFieldOptions, buildGroupPurchaseSingleCancelKeyboard());
      return true;
    }
    if (draft.pendingFieldType === 'integer') {
      await context.runtime.session.advance({ stepKey: 'field-affects-quantity', data: { ...draft, pendingFieldLabel } });
      await context.reply(texts.askFieldAffectsQuantity, buildGroupPurchaseYesNoOptions(language));
      return true;
    }
    await context.runtime.session.advance({
      stepKey: 'field-menu',
      data: {
        ...draft,
        fields: [...(draft.fields ?? []), buildField({ label: pendingFieldLabel, fieldType: 'text', affectsQuantity: false })],
        pendingFieldLabel: undefined,
        pendingFieldType: undefined,
      },
    });
    await context.reply(texts.fieldMenu, buildGroupPurchaseFieldMenuOptions(language));
    return true;
  }

  if (session.stepKey === 'field-options') {
    const options = text
      .split(',')
      .map((option) => option.trim())
      .filter((option) => option.length > 0);
    if (options.length === 0 || !draft.pendingFieldLabel) {
      await context.reply(texts.invalidFieldOptions, buildGroupPurchaseSingleCancelKeyboard());
      return true;
    }
    await context.runtime.session.advance({
      stepKey: 'field-menu',
      data: {
        ...draft,
        fields: [
          ...(draft.fields ?? []),
          buildField({
            label: draft.pendingFieldLabel,
            fieldType: 'single_choice',
            affectsQuantity: false,
            config: { options: options.map((option) => ({ value: slugify(option), label: option })) },
          }),
        ],
        pendingFieldLabel: undefined,
        pendingFieldType: undefined,
      },
    });
    await context.reply(texts.fieldMenu, buildGroupPurchaseFieldMenuOptions(language));
    return true;
  }

  if (session.stepKey === 'field-affects-quantity') {
    const affectsQuantity = parseYesNoSelection(text, language);
    if (affectsQuantity === null || !draft.pendingFieldLabel) {
      await context.reply(texts.invalidYesNo, buildGroupPurchaseYesNoOptions(language));
      return true;
    }
    await context.runtime.session.advance({
      stepKey: 'field-menu',
      data: {
        ...draft,
        fields: [
          ...(draft.fields ?? []),
          buildField({
            label: draft.pendingFieldLabel,
            fieldType: 'integer',
            affectsQuantity,
            config: affectsQuantity ? { min: 1 } : null,
          }),
        ],
        pendingFieldLabel: undefined,
        pendingFieldType: undefined,
      },
    });
    await context.reply(texts.fieldMenu, buildGroupPurchaseFieldMenuOptions(language));
    return true;
  }

  if (session.stepKey === 'confirm') {
    if (text !== texts.savePurchase) {
      await context.reply(formatCreateSummary(draft, language), buildGroupPurchaseSaveOptions(language));
      return true;
    }
    const detail = await createGroupPurchase({
      repository: resolveRepository(context),
      title: draft.title ?? '',
      description: draft.description ?? null,
      purchaseMode: draft.purchaseMode ?? 'per_item',
      createdByTelegramUserId: context.runtime.actor.telegramUserId,
      joinDeadlineAt: draft.joinDeadlineAt ?? null,
      confirmDeadlineAt: draft.confirmDeadlineAt ?? null,
      totalPriceCents: draft.totalPriceCents ?? null,
      unitPriceCents: draft.unitPriceCents ?? null,
      unitLabel: draft.unitLabel ?? null,
      fields: draft.fields ?? [],
    });
    await appendAuditEvent({
      repository: resolveAuditRepository(context),
      actorTelegramUserId: context.runtime.actor.telegramUserId,
      actionKey: 'group_purchase.created',
      targetType: 'group-purchase',
      targetId: detail.purchase.id,
      summary: `Group purchase created: ${detail.purchase.title}`,
      details: { purchaseMode: detail.purchase.purchaseMode },
    });
    await context.runtime.session.cancel();
    await context.reply(formatGroupPurchaseDetailMessage({ detail, language }), {
      ...buildGroupPurchaseMenuOptions(language),
      parseMode: 'HTML',
    });
    return true;
  }

  return false;
}

function parseStartPayload(messageText: string | undefined, prefix: string): number | null {
  const payload = messageText?.trim().split(/\s+/).slice(1).join(' ');
  if (!payload || !payload.startsWith(prefix)) {
    return null;
  }

  const value = Number(payload.slice(prefix.length));
  return Number.isInteger(value) && value > 0 ? value : null;
}

function readCreateDraft(data: Record<string, unknown>): GroupPurchaseCreateDraft {
  return data as GroupPurchaseCreateDraft;
}

function parseModeSelection(text: string, language: 'ca' | 'es' | 'en'): 'per_item' | 'shared_cost' | null {
  const texts = createTelegramI18n(language).groupPurchases;
  if (text === texts.modePerItem) {
    return 'per_item';
  }
  if (text === texts.modeSharedCost) {
    return 'shared_cost';
  }
  return null;
}

function parseFieldTypeSelection(text: string, language: 'ca' | 'es' | 'en'): 'integer' | 'single_choice' | 'text' | null {
  const texts = createTelegramI18n(language).groupPurchases;
  if (text === texts.addIntegerField) return 'integer';
  if (text === texts.addChoiceField) return 'single_choice';
  if (text === texts.addTextField) return 'text';
  return null;
}

function parseYesNoSelection(text: string, language: 'ca' | 'es' | 'en'): boolean | null {
  const texts = createTelegramI18n(language).groupPurchases;
  if (text === texts.yes) return true;
  if (text === texts.no) return false;
  return null;
}

function parseMoneyToCents(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    return null;
  }
  return Math.round(Number(normalized) * 100);
}

function parseDeadline(text: string): string | null {
  const parsed = parseDate(text);
  if (parsed instanceof Error) {
    return null;
  }
  const [yearText, monthText, dayText] = parsed.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day, 23, 59, 59));
  return date.toISOString();
}

function hasQuantityField(fields: GroupPurchaseFieldInput[]): boolean {
  return fields.some((field) => field.fieldType === 'integer' && field.affectsQuantity);
}

function formatCreateSummary(draft: GroupPurchaseCreateDraft, language: 'ca' | 'es' | 'en'): string {
  const texts = createTelegramI18n(language).groupPurchases;
  const fieldLines = (draft.fields ?? []).map((field) => {
    const typeLabel = field.fieldType === 'integer' ? 'numero' : field.fieldType === 'single_choice' ? 'opcio' : 'text';
    const extra = field.affectsQuantity ? ', quantitat' : '';
    return `- ${field.label} (${typeLabel}${extra})`;
  });

  return [
    texts.createSummary,
    '',
    `Titol: ${draft.title ?? '-'}`,
    `Descripcio: ${draft.description ?? 'Sense descripcio'}`,
    `Mode: ${draft.purchaseMode === 'shared_cost' ? texts.modeSharedCost : texts.modePerItem}`,
    draft.purchaseMode === 'shared_cost'
      ? `Cost total: ${draft.totalPriceCents === null || draft.totalPriceCents === undefined ? 'Sense cost' : formatMoney(draft.totalPriceCents)}`
      : `Preu unitari: ${draft.unitPriceCents === null || draft.unitPriceCents === undefined ? 'Sense preu' : formatMoney(draft.unitPriceCents)}`,
    `Unitat visible: ${draft.unitLabel ?? 'Sense unitat visible'}`,
    `Data limit per apuntar-se: ${formatDeadlineSummary(draft.joinDeadlineAt)}`,
    `Data limit per confirmar-se: ${formatDeadlineSummary(draft.confirmDeadlineAt)}`,
    'Camps:',
    ...fieldLines,
  ].join('\n');
}

function formatDeadlineSummary(value: string | null | undefined): string {
  if (!value) {
    return 'Sense data limit';
  }
  const date = new Date(value);
  return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;
}

function formatMoney(cents: number): string {
  return `${(cents / 100).toFixed(2)} EUR`;
}

function buildField({
  label,
  fieldType,
  affectsQuantity,
  config = null,
}: {
  label: string;
  fieldType: 'integer' | 'single_choice' | 'text';
  affectsQuantity: boolean;
  config?: Record<string, unknown> | null;
}): GroupPurchaseFieldInput {
  return {
    fieldKey: slugify(label),
    label: label.trim(),
    fieldType,
    isRequired: true,
    sortOrder: 0,
    config,
    affectsQuantity,
  };
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .toLowerCase();
}

async function replyWithCurrentParticipantField(
  context: TelegramGroupPurchaseContext,
  draft: GroupPurchaseParticipantFieldDraft,
  language: 'ca' | 'es' | 'en',
): Promise<void> {
  const detail = await loadPurchaseDetailOrThrow(context, draft.purchaseId);
  const field = detail.fields[draft.fieldIndex];
  if (!field) {
    throw new Error(`Group purchase ${draft.purchaseId} field ${draft.fieldIndex} not found`);
  }

  const inlineKeyboard = field.fieldType === 'single_choice' && Array.isArray(field.config?.options)
    ? [field.config.options.map((option) => ({ text: String((option as { label?: unknown }).label ?? ''), callbackData: undefined }))]
    : undefined;
  void inlineKeyboard;

  await context.reply(field.label, buildParticipantFieldReplyOptions(field, language));
}

function buildParticipantFieldReplyOptions(
  field: { fieldType: string; config: Record<string, unknown> | null },
  language: 'ca' | 'es' | 'en',
) {
  if (field.fieldType === 'single_choice' && Array.isArray(field.config?.options)) {
    return {
      replyKeyboard: [field.config.options.map((option) => String((option as { label?: unknown }).label ?? '')), ['/cancel']],
      resizeKeyboard: true,
      persistentKeyboard: true,
    };
  }

  return buildGroupPurchaseSingleCancelKeyboard();
}

async function loadPurchaseDetailOrThrow(
  context: TelegramGroupPurchaseContext,
  purchaseId: number,
) {
  const detail = await resolveRepository(context).getPurchaseDetail(purchaseId);
  if (!detail) {
    throw new Error(`Group purchase ${purchaseId} not found`);
  }
  return detail;
}

function buildGroupPurchaseDetailOptions(
  context: TelegramGroupPurchaseContext,
  detail: Awaited<ReturnType<typeof loadPurchaseDetailOrThrow>>,
  language: 'ca' | 'es' | 'en',
) {
  const texts = createTelegramI18n(language).groupPurchases;
  const participant = detail.participants.find(
    (entry) =>
      entry.participantTelegramUserId === context.runtime.actor.telegramUserId &&
      entry.status !== 'removed',
  );
  const isManager = context.runtime.actor.isAdmin || detail.purchase.createdByTelegramUserId === context.runtime.actor.telegramUserId;
  const inlineKeyboard: Array<Array<{ text: string; callbackData: string }>> = [];

  if (!participant && detail.purchase.lifecycleStatus === 'open') {
    inlineKeyboard.push([{ text: texts.joinAction, callbackData: `${groupPurchaseCallbackPrefixes.joinInterested}${detail.purchase.id}` }]);
    if (!detail.purchase.confirmDeadlineAt || detail.purchase.confirmDeadlineAt >= new Date().toISOString()) {
      inlineKeyboard.push([{ text: texts.joinConfirmedAction, callbackData: `${groupPurchaseCallbackPrefixes.joinConfirmed}${detail.purchase.id}` }]);
    }
  }

  if (isManager) {
    inlineKeyboard.push([{ text: texts.editPurchaseAction, callbackData: `${groupPurchaseCallbackPrefixes.editPurchase}${detail.purchase.id}` }]);
    inlineKeyboard.push([{ text: texts.manageParticipantsAction, callbackData: `${groupPurchaseCallbackPrefixes.manageParticipants}${detail.purchase.id}` }]);
    inlineKeyboard.push([{ text: texts.publishMessageAction, callbackData: `${groupPurchaseCallbackPrefixes.publishMessage}${detail.purchase.id}` }]);
    inlineKeyboard.push([{ text: texts.publishGroupAction, callbackData: `${groupPurchaseCallbackPrefixes.publishGroup}${detail.purchase.id}` }]);
    inlineKeyboard.push([
      { text: 'Cerrar compra', callbackData: `${groupPurchaseCallbackPrefixes.lifecycle}${detail.purchase.id}:closed` },
      { text: 'Cancelar compra', callbackData: `${groupPurchaseCallbackPrefixes.lifecycle}${detail.purchase.id}:cancelled` },
      { text: 'Archivar', callbackData: `${groupPurchaseCallbackPrefixes.lifecycle}${detail.purchase.id}:archived` },
    ]);
  }

  if (participant) {
    inlineKeyboard.push([
      { text: texts.editValuesAction, callbackData: `${groupPurchaseCallbackPrefixes.editValues}${detail.purchase.id}` },
      { text: texts.leaveAction, callbackData: `${groupPurchaseCallbackPrefixes.leave}${detail.purchase.id}` },
    ]);
    if (participant.status === 'interested' && detail.purchase.lifecycleStatus === 'open') {
      inlineKeyboard.push([{ text: texts.confirmAction, callbackData: `${groupPurchaseCallbackPrefixes.confirm}${detail.purchase.id}` }]);
    }
  }

  return inlineKeyboard.length > 0
    ? { parseMode: 'HTML' as const, inlineKeyboard }
    : { parseMode: 'HTML' as const };
}

function buildGroupPurchaseLink(purchaseId: number): string {
  return buildTelegramStartUrl(`group_purchase_${purchaseId}`);
}

async function publishGroupPurchaseAnnouncement(
  context: TelegramGroupPurchaseContext,
  detail: Awaited<ReturnType<typeof loadPurchaseDetailOrThrow>>,
  language: 'ca' | 'es' | 'en',
): Promise<void> {
  const sendGroupMessage = context.runtime.bot.sendGroupMessage;
  if (!sendGroupMessage) {
    return;
  }

  const groups = await resolveNewsGroupRepository(context).listGroups({ includeDisabled: false });
  if (groups.length === 0) {
    return;
  }

  const texts = createTelegramI18n(language).groupPurchases;
  const message = [
    'Nova compra conjunta disponible:',
    `<a href="${buildGroupPurchaseLink(detail.purchase.id)}"><b>${escapeHtml(detail.purchase.title)}</b></a>`,
    `${texts.modeLabel}: ${escapeHtml(detail.purchase.purchaseMode === 'shared_cost' ? texts.modeSharedCost : texts.modePerItem)}`,
    ...(detail.purchase.description ? [escapeHtml(detail.purchase.description)] : []),
  ].join('\n');

  await Promise.all(
    groups.map(async (group) => {
      try {
        await sendGroupMessage(group.chatId, message, { parseMode: 'HTML' });
      } catch {
        // No bloqueja la publicació local.
      }
    }),
  );
}

function parseEntityId(callbackData: string, prefix: string, label: string): number {
  const value = Number(callbackData.slice(prefix.length));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Could not identify ${label}`);
  }
  return value;
}

function parseParticipantStartPayload(messageText: string | undefined): {
  purchaseId: number;
  participantTelegramUserId: number;
} | null {
  const payload = messageText?.trim().split(/\s+/).slice(1).join(' ');
  if (!payload?.startsWith('group_purchase_participant_')) {
    return null;
  }

  const match = payload.match(/^group_purchase_participant_(\d+)_(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    purchaseId: Number(match[1]),
    participantTelegramUserId: Number(match[2]),
  };
}

function buildParticipantManagementMessage(
  detail: Awaited<ReturnType<typeof loadPurchaseDetailOrThrow>>,
  language: 'ca' | 'es' | 'en',
  participantValuesByUserId: Map<number, string[]>,
): string {
  const texts = createTelegramI18n(language).groupPurchases;
  return [
    texts.participantsHeader,
    ...detail.participants.map((participant) => {
      const values = participantValuesByUserId.get(participant.participantTelegramUserId) ?? [];
      const name = participant.participantDisplayName ?? `Participant ${participant.participantTelegramUserId}`;
      const username = participant.participantUsername ? ` (@${participant.participantUsername})` : '';
      const suffix = values.length > 0 ? ` · ${values.join(' · ')}` : '';
      return `- <a href="${buildTelegramStartUrl(`group_purchase_participant_${detail.purchase.id}_${participant.participantTelegramUserId}`)}">${escapeHtml(name)}</a>${escapeHtml(username)} · ${escapeHtml(participant.status)}${escapeHtml(suffix)}`;
    }),
  ].join('\n');
}

function buildParticipantManagementOptions(
  detail: Awaited<ReturnType<typeof loadPurchaseDetailOrThrow>>,
  language: 'ca' | 'es' | 'en',
) {
  void detail;
  void language;
  return { parseMode: 'HTML' as const };
}

function buildParticipantDetailMessage(
  detail: Awaited<ReturnType<typeof loadPurchaseDetailOrThrow>>,
  participantTelegramUserId: number,
  language: 'ca' | 'es' | 'en',
  participantValuesByUserId: Map<number, string[]>,
): string {
  const participant = detail.participants.find((entry) => entry.participantTelegramUserId === participantTelegramUserId);
  if (!participant) {
    return 'Participant not found.';
  }

  const values = participantValuesByUserId.get(participantTelegramUserId) ?? [];
  const username = participant.participantUsername ? ` (@${participant.participantUsername})` : '';
  return [
    `${participant.participantDisplayName ?? `Participant ${participant.participantTelegramUserId}`}${username}`,
    `Estat: ${participant.status}`,
    ...(values.length > 0 ? values : []),
  ].join('\n');
}

function buildParticipantDetailOptions(
  detail: Awaited<ReturnType<typeof loadPurchaseDetailOrThrow>>,
  participantTelegramUserId: number,
  language: 'ca' | 'es' | 'en',
) {
  const participant = detail.participants.find((entry) => entry.participantTelegramUserId === participantTelegramUserId);
  const label = participant?.participantDisplayName ?? `Participant ${participantTelegramUserId}`;
  void language;
  return {
    parseMode: 'HTML' as const,
    inlineKeyboard: [
      [
        { text: `Interessat: ${label}`, callbackData: `${groupPurchaseCallbackPrefixes.participantStatus}${detail.purchase.id}:${participantTelegramUserId}:interested` },
        { text: `Confirmat: ${label}`, callbackData: `${groupPurchaseCallbackPrefixes.participantStatus}${detail.purchase.id}:${participantTelegramUserId}:confirmed` },
      ],
      [
        { text: `Pagat: ${label}`, callbackData: `${groupPurchaseCallbackPrefixes.participantStatus}${detail.purchase.id}:${participantTelegramUserId}:paid` },
        { text: `Entregat: ${label}`, callbackData: `${groupPurchaseCallbackPrefixes.participantStatus}${detail.purchase.id}:${participantTelegramUserId}:delivered` },
      ],
    ],
  };
}

async function loadParticipantValuesByUserId(
  context: TelegramGroupPurchaseContext,
  detail: Awaited<ReturnType<typeof loadPurchaseDetailOrThrow>>,
): Promise<Map<number, string[]>> {
  const participantValuesByUserId = new Map<number, string[]>();
  for (const participant of detail.participants) {
    const values = await resolveRepository(context).listParticipantFieldValues(detail.purchase.id, participant.participantTelegramUserId);
    participantValuesByUserId.set(
      participant.participantTelegramUserId,
      values.map((value) => {
        const field = detail.fields.find((entry) => entry.id === value.fieldId);
        return `${field?.label ?? 'Valor'}: ${String(value.value)}`;
      }),
    );
  }
  return participantValuesByUserId;
}
