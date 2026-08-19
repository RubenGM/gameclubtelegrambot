import type { CatalogItemType, CatalogLoanRecord, CatalogMediaRecord } from '../catalog/catalog-model.js';
import { buildLoanDetailButtons, catalogLoanCallbackPrefixes } from './catalog-loan-flow.js';
import { createTelegramI18n } from './i18n.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

export function buildCatalogAdminItemDetailButtons({
  itemId,
  itemType,
  loan,
  media,
  language,
  canAdminister,
  canReturnLoan,
  editPrefix,
  createActivityPrefix,
  autocorrectPrefix,
  quickBggMetadataPrefix,
  translateDescriptionPrefix,
  setOwnerSelfPrefix,
  selectOwnerPrefix,
  clearOwnerPrefix,
  addMediaPrefix,
  editMediaPrefix,
  deleteMediaPrefix,
  deactivatePrefix,
}: {
  itemId: number;
  itemType: CatalogItemType;
  loan: CatalogLoanRecord | null;
  media: CatalogMediaRecord[];
  language: 'ca' | 'es' | 'en';
  canAdminister: boolean;
  canReturnLoan: boolean;
  editPrefix: string;
  createActivityPrefix: string;
  autocorrectPrefix: string;
  quickBggMetadataPrefix: string;
  translateDescriptionPrefix: string;
  setOwnerSelfPrefix: string;
  selectOwnerPrefix: string;
  clearOwnerPrefix: string;
  addMediaPrefix: string;
  editMediaPrefix: string;
  deleteMediaPrefix: string;
  deactivatePrefix: string;
}): NonNullable<TelegramReplyOptions['inlineKeyboard']> {
  const texts = createTelegramI18n(language).catalogAdmin;
  const createActivityButtons = itemType === 'board-game'
    ? [[{ text: texts.createActivity, callbackData: `${createActivityPrefix}${itemId}` }]]
    : [];

  if (!canAdminister) {
    return [...createActivityButtons, ...buildLoanDetailButtons({ loan, itemId, language, canReturn: canReturnLoan })];
  }

  return buildCatalogAdminItemAdministrationButtons({
    itemId,
    itemType,
    loan,
    media,
    language,
    editPrefix,
    autocorrectPrefix,
    quickBggMetadataPrefix,
    translateDescriptionPrefix,
    setOwnerSelfPrefix,
    selectOwnerPrefix,
    clearOwnerPrefix,
    addMediaPrefix,
    editMediaPrefix,
    deleteMediaPrefix,
    deactivatePrefix,
  });
}

export function buildCatalogAdminItemAdministrationButtons({
  itemId,
  itemType,
  loan,
  media,
  language,
  editPrefix,
  autocorrectPrefix,
  quickBggMetadataPrefix,
  translateDescriptionPrefix,
  setOwnerSelfPrefix,
  selectOwnerPrefix,
  clearOwnerPrefix,
  addMediaPrefix,
  editMediaPrefix,
  deleteMediaPrefix,
  deactivatePrefix,
}: {
  itemId: number;
  itemType: CatalogItemType;
  loan: CatalogLoanRecord | null;
  media: CatalogMediaRecord[];
  language: 'ca' | 'es' | 'en';
  editPrefix: string;
  autocorrectPrefix: string;
  quickBggMetadataPrefix: string;
  translateDescriptionPrefix: string;
  setOwnerSelfPrefix: string;
  selectOwnerPrefix: string;
  clearOwnerPrefix: string;
  addMediaPrefix: string;
  editMediaPrefix: string;
  deleteMediaPrefix: string;
  deactivatePrefix: string;
}): NonNullable<TelegramReplyOptions['inlineKeyboard']> {
  const i18n = createTelegramI18n(language);
  const texts = i18n.catalogAdmin;

  return [
    [{ text: texts.edit, callbackData: `${editPrefix}${itemId}` }],
    [{ text: texts.autocorrectItem, callbackData: `${autocorrectPrefix}${itemId}` }],
    ...(itemType === 'board-game' || itemType === 'expansion'
      ? [[{ text: texts.quickBggMetadataImport, callbackData: `${quickBggMetadataPrefix}${itemId}` }]]
      : []),
    [{ text: texts.translateDescription, callbackData: `${translateDescriptionPrefix}${itemId}` }],
    [{ text: texts.assignOwnerSelf, callbackData: `${setOwnerSelfPrefix}${itemId}` }],
    [{ text: texts.assignOwnerOther, callbackData: `${selectOwnerPrefix}${itemId}:1` }],
    [{ text: texts.clearOwner, callbackData: `${clearOwnerPrefix}${itemId}` }],
    [{ text: texts.addMedia, callbackData: `${addMediaPrefix}${itemId}` }],
    ...media.flatMap((entry) => [[
      { text: `${texts.confirmMediaEdit} #${entry.id}`, callbackData: `${editMediaPrefix}${entry.id}` },
      { text: `${texts.confirmMediaDelete} #${entry.id}`, callbackData: `${deleteMediaPrefix}${entry.id}` },
    ]]),
    ...(!loan ? [[{
      text: i18n.catalogLoan.adminCreate,
      callbackData: `${catalogLoanCallbackPrefixes.adminCreate}${itemId}`,
    }]] : []),
    [{ text: i18n.catalogLoan.deleteItem, callbackData: `${deactivatePrefix}${itemId}` }],
  ];
}
