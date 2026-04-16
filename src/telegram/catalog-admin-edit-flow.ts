import type { CatalogItemRecord, CatalogItemType } from '../catalog/catalog-model.js';
import { createTelegramI18n } from './i18n.js';
import { buildGroupOptions, buildTypeOptions } from './catalog-admin-keyboards.js';
import { handleCatalogAdminEditSelectionStep } from './catalog-admin-edit-selection.js';
import { parseCatalogAdminEditStepPatch } from './catalog-admin-edit-step-parsing.js';
import { asNullableNumber } from './catalog-admin-parsing.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import type { ConversationSessionRuntime } from './conversation-session.js';

type SessionRuntime = Pick<ConversationSessionRuntime, 'advance'>;

type EditLabels = {
  confirmEdit: string;
  editFieldDisplayName: string;
  editFieldItemType: string;
  editFieldFamily: string;
  editFieldGroup: string;
  editFieldOriginalName: string;
  editFieldDescription: string;
  editFieldLanguage: string;
  editFieldPublisher: string;
  editFieldPublicationYear: string;
  editFieldPlayerMin: string;
  editFieldPlayerMax: string;
  editFieldRecommendedAge: string;
  editFieldPlayTimeMinutes: string;
  editFieldExternalRefs: string;
  editFieldMetadata: string;
};

export async function handleCatalogAdminEditSession({
  session,
  reply,
  language,
  text,
  stepKey,
  data,
  item,
  labels,
  getDraftItemType,
  getDraftFamilyId,
  buildEditFieldMenuOptions,
  buildFamilyPrompt,
  buildFamilyOptions,
  buildGroupPrompt,
  parseItemTypeLabel,
  parseFamilyInput,
  parseGroupInput,
  withCompatibleGroup,
  updateEditDraftAndReturn,
  saveEditDraftAndReturn,
}: {
  session: SessionRuntime;
  reply: (message: string, options?: TelegramReplyOptions) => Promise<unknown>;
  language: 'ca' | 'es' | 'en';
  text: string;
  stepKey: string;
  data: Record<string, unknown>;
  item: CatalogItemRecord;
  labels: EditLabels;
  getDraftItemType: (item: CatalogItemRecord, data: Record<string, unknown>) => CatalogItemType;
  getDraftFamilyId: (item: CatalogItemRecord, data: Record<string, unknown>) => number | null;
  buildEditFieldMenuOptions: (itemType: CatalogItemType) => TelegramReplyOptions;
  buildFamilyPrompt: (itemType: CatalogItemType) => Promise<string>;
  buildFamilyOptions: (itemType: CatalogItemType) => Promise<TelegramReplyOptions>;
  buildGroupPrompt: (familyId: number | null) => Promise<string>;
  parseItemTypeLabel: (text: string, language: 'ca' | 'es' | 'en') => CatalogItemType | Error;
  parseFamilyInput: (text: string, itemType: CatalogItemType) => Promise<number | null | Error>;
  parseGroupInput: (text: string, familyId: number | null) => Promise<number | null | Error>;
  withCompatibleGroup: (data: Record<string, unknown>, familyId: number | null) => Promise<Record<string, unknown>>;
  updateEditDraftAndReturn: (item: CatalogItemRecord, data: Record<string, unknown>, patch: Record<string, unknown>) => Promise<boolean>;
  saveEditDraftAndReturn: (item: CatalogItemRecord, data: Record<string, unknown>) => Promise<boolean>;
}): Promise<boolean> {
  const texts = createTelegramI18n(language).catalogAdmin;
  if (stepKey === 'select-field') {
    const selectionResult = await handleCatalogAdminEditSelectionStep({
      session,
      reply,
      language,
      text,
      data,
      currentItemType: getDraftItemType(item, data),
      currentFamilyId: getDraftFamilyId(item, data),
      labels,
      buildEditFieldMenuOptions,
      buildFamilyPrompt: () => buildFamilyPrompt(getDraftItemType(item, data)),
      buildFamilyOptions: () => buildFamilyOptions(getDraftItemType(item, data)),
      buildGroupPrompt: () => buildGroupPrompt(getDraftFamilyId(item, data)),
    });
    if (selectionResult.kind === 'save') {
      return saveEditDraftAndReturn(item, data);
    }
    return true;
  }
  if (stepKey === 'display-name') {
    return updateEditDraftAndReturn(item, data, { displayName: text });
  }
  if (stepKey === 'item-type') {
    const itemType = parseItemTypeLabel(text, language);
    if (itemType instanceof Error) {
      await reply(texts.invalidType, buildTypeOptions(language));
      return true;
    }
    return updateEditDraftAndReturn(item, data, {
      itemType,
      ...(!itemTypeSupportsPlayers(itemType) ? { playerCountMin: null, playerCountMax: null } : {}),
    });
  }
  if (stepKey === 'family') {
    const familyId = await parseFamilyInput(text, getDraftItemType(item, data));
    if (familyId instanceof Error) {
      await reply(texts.invalidFamily, await buildFamilyOptions(getDraftItemType(item, data)));
      return true;
    }
    const nextData = await withCompatibleGroup(data, familyId);
    return updateEditDraftAndReturn(item, data, nextData);
  }
  if (stepKey === 'group') {
    const groupId = await parseGroupInput(text, getDraftFamilyId(item, data));
    if (groupId instanceof Error) {
      await reply(texts.invalidGroup, buildGroupOptions(language));
      return true;
    }
    return updateEditDraftAndReturn(item, data, { groupId });
  }

  const editStepPatch = parseCatalogAdminEditStepPatch({
    stepKey,
    text,
    language,
    candidateMin: hasOwn(data, 'playerCountMin') ? asNullableNumber(data.playerCountMin) : item.playerCountMin,
  });
  if (editStepPatch === null) {
    return false;
  }
  if (editStepPatch.kind === 'invalid') {
    await reply(editStepPatch.message, editStepPatch.options);
    return true;
  }
  return updateEditDraftAndReturn(item, data, editStepPatch.patch);
}

function hasOwn(data: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(data, key);
}

function itemTypeSupportsPlayers(itemType: CatalogItemType): boolean {
  return itemType !== 'book' && itemType !== 'rpg-book';
}
