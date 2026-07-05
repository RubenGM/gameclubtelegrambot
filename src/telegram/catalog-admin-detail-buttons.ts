import type { CatalogItemType, CatalogLoanRecord, CatalogMediaRecord } from '../catalog/catalog-model.js';
import { buildLoanDetailButtons } from './catalog-loan-flow.js';
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
    ...createActivityButtons,
    ...media.flatMap((entry) => [[
      { text: `${texts.confirmMediaEdit} #${entry.id}`, callbackData: `${editMediaPrefix}${entry.id}` },
      { text: `${texts.confirmMediaDelete} #${entry.id}`, callbackData: `${deleteMediaPrefix}${entry.id}` },
    ]]),
    ...buildLoanDetailButtons({ loan, itemId, language, deleteCallbackData: `${deactivatePrefix}${itemId}`, canReturn: canReturnLoan }),
  ];
}
