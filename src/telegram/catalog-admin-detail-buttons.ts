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
  editPrefix,
  createActivityPrefix,
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
  editPrefix: string;
  createActivityPrefix: string;
  editMediaPrefix: string;
  deleteMediaPrefix: string;
  deactivatePrefix: string;
}): NonNullable<TelegramReplyOptions['inlineKeyboard']> {
  const texts = createTelegramI18n(language).catalogAdmin;
  const createActivityButtons = itemType === 'board-game'
    ? [[{ text: texts.createActivity, callbackData: `${createActivityPrefix}${itemId}` }]]
    : [];

  if (!canAdminister) {
    return [...createActivityButtons, ...buildLoanDetailButtons({ loan, itemId, language })];
  }

  return [
    [{ text: texts.edit, callbackData: `${editPrefix}${itemId}` }],
    ...createActivityButtons,
    ...media.flatMap((entry) => [[
      { text: `${texts.confirmMediaEdit} #${entry.id}`, callbackData: `${editMediaPrefix}${entry.id}` },
      { text: `${texts.confirmMediaDelete} #${entry.id}`, callbackData: `${deleteMediaPrefix}${entry.id}` },
    ]]),
    ...buildLoanDetailButtons({ loan, itemId, language, deleteCallbackData: `${deactivatePrefix}${itemId}` }),
  ];
}
