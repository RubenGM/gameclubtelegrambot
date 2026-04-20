import {
  changeGroupPurchaseParticipantStatus,
  createGroupPurchase,
  joinGroupPurchase,
  updateGroupPurchaseParticipantFieldValues,
  type GroupPurchaseFieldInput,
  type GroupPurchaseRepository,
} from '../group-purchases/group-purchase-catalog.js';
import { createDatabaseGroupPurchaseRepository } from '../group-purchases/group-purchase-catalog-store.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import {
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

const createFlowKey = 'group-purchase-create';
const participantFieldFlowKey = 'group-purchase-participant-fields';

export const groupPurchaseCallbackPrefixes = {
  join: 'group_purchase:join:',
  editValues: 'group_purchase:edit_values:',
  leave: 'group_purchase:leave:',
  confirm: 'group_purchase:confirm:',
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
  if (context.runtime.session.current?.flowKey === participantFieldFlowKey) {
    return handleActiveParticipantFieldFlow(context, text, language);
  }

  if (text === i18n.actionMenu.groupPurchases || text === groupPurchaseLabels.openMenu || text === '/group_purchases') {
    await handleTelegramGroupPurchaseCommand(context);
    return true;
  }

  if (text === texts.list || text === groupPurchaseLabels.list) {
    const purchases = await resolveRepository(context).listPurchases();
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
  if (purchaseId === null || context.runtime.chat.kind !== 'private' || !context.runtime.actor.isApproved) {
    return false;
  }

  const detail = await resolveRepository(context).getPurchaseDetail(purchaseId);
  if (!detail) {
    throw new Error(`Group purchase ${purchaseId} not found`);
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  await context.reply(formatGroupPurchaseDetailMessage({ detail, language }), buildGroupPurchaseDetailOptions(context, detail, language));
  return true;
}

export async function handleTelegramGroupPurchaseCallback(context: TelegramGroupPurchaseContext): Promise<boolean> {
  const callbackData = context.callbackData;
  if (!callbackData || context.runtime.chat.kind !== 'private' || !context.runtime.actor.isApproved) {
    return false;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');

  if (callbackData.startsWith(groupPurchaseCallbackPrefixes.join)) {
    const purchaseId = parseEntityId(callbackData, groupPurchaseCallbackPrefixes.join, 'group purchase');
    await joinGroupPurchase({
      repository: resolveRepository(context),
      purchaseId,
      participantTelegramUserId: context.runtime.actor.telegramUserId,
    });
    await context.runtime.session.start({
      flowKey: participantFieldFlowKey,
      stepKey: 'field',
      data: { purchaseId, fieldIndex: 0, valuesByFieldKey: {} },
    });
    await replyWithCurrentParticipantField(context, { purchaseId, fieldIndex: 0, valuesByFieldKey: {} }, language);
    return true;
  }

  if (callbackData.startsWith(groupPurchaseCallbackPrefixes.editValues)) {
    const purchaseId = parseEntityId(callbackData, groupPurchaseCallbackPrefixes.editValues, 'group purchase');
    await context.runtime.session.start({
      flowKey: participantFieldFlowKey,
      stepKey: 'field',
      data: { purchaseId, fieldIndex: 0, valuesByFieldKey: {} },
    });
    await replyWithCurrentParticipantField(context, { purchaseId, fieldIndex: 0, valuesByFieldKey: {} }, language);
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
  await context.runtime.session.cancel();
  const nextDetail = await loadPurchaseDetailOrThrow(context, draft.purchaseId);
  await context.reply(formatGroupPurchaseDetailMessage({ detail: nextDetail, language }), buildGroupPurchaseDetailOptions(context, nextDetail, language));
  return true;
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
    await context.reply(texts.askJoinDeadline, buildGroupPurchaseSkipCancelKeyboard(language));
    return true;
  }

  if (session.stepKey === 'unit-label') {
    await context.runtime.session.advance({
      stepKey: 'join-deadline',
      data: { ...draft, unitLabel: text === texts.skipOptional ? null : text.trim() },
    });
    await context.reply(texts.askJoinDeadline, buildGroupPurchaseSkipCancelKeyboard(language));
    return true;
  }

  if (session.stepKey === 'join-deadline') {
    const joinDeadlineAt = text === texts.skipOptional ? null : parseDeadline(text);
    if (text !== texts.skipOptional && joinDeadlineAt === null) {
      await context.reply(texts.invalidDeadline, buildGroupPurchaseSkipCancelKeyboard(language));
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'confirm-deadline', data: { ...draft, joinDeadlineAt } });
    await context.reply(texts.askConfirmDeadline, buildGroupPurchaseSkipCancelKeyboard(language));
    return true;
  }

  if (session.stepKey === 'confirm-deadline') {
    const confirmDeadlineAt = text === texts.skipOptional ? null : parseDeadline(text);
    if (text !== texts.skipOptional && confirmDeadlineAt === null) {
      await context.reply(texts.invalidDeadline, buildGroupPurchaseSkipCancelKeyboard(language));
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
      if ((draft.fields ?? []).length === 0) {
        await context.reply(texts.fieldRequiredMessage, buildGroupPurchaseFieldMenuOptions(language));
        return true;
      }
      await context.runtime.session.advance({ stepKey: 'confirm', data: draft as unknown as Record<string, unknown> });
      await context.reply(texts.createSummary, buildGroupPurchaseSaveOptions(language));
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
      await context.reply(texts.createSummary, buildGroupPurchaseSaveOptions(language));
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
  const match = text.trim().match(/^(\d{2})\/(\d{2})$/);
  if (!match) {
    return null;
  }
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = new Date().getUTCFullYear();
  const date = new Date(Date.UTC(year, month - 1, day, 23, 59, 59));
  if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1) {
    return null;
  }
  return date.toISOString();
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
  const inlineKeyboard: Array<Array<{ text: string; callbackData: string }>> = [];

  if (!participant && detail.purchase.lifecycleStatus === 'open') {
    inlineKeyboard.push([{ text: texts.joinAction, callbackData: `${groupPurchaseCallbackPrefixes.join}${detail.purchase.id}` }]);
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

function parseEntityId(callbackData: string, prefix: string, label: string): number {
  const value = Number(callbackData.slice(prefix.length));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Could not identify ${label}`);
  }
  return value;
}
