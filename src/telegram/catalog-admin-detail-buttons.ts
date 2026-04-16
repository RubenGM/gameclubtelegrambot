import type { CatalogLoanRecord, CatalogMediaRecord } from '../catalog/catalog-model.js';
import { buildLoanDetailButtons } from './catalog-loan-flow.js';
import { createTelegramI18n } from './i18n.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

export function buildCatalogAdminItemDetailButtons({
  itemId,
  loan,
  media,
  language,
  canAdminister,
  editPrefix,
  editMediaPrefix,
  deleteMediaPrefix,
  deactivatePrefix,
}: {
  itemId: number;
  loan: CatalogLoanRecord | null;
  media: CatalogMediaRecord[];
  language: 'ca' | 'es' | 'en';
  canAdminister: boolean;
  editPrefix: string;
  editMediaPrefix: string;
  deleteMediaPrefix: string;
  deactivatePrefix: string;
}): NonNullable<TelegramReplyOptions['inlineKeyboard']> {
  if (!canAdminister) {
    return buildLoanDetailButtons({ loan, itemId, language });
  }

  const texts = createTelegramI18n(language).catalogAdmin;
  return [
    [{ text: texts.edit, callbackData: `${editPrefix}${itemId}` }],
    ...media.flatMap((entry) => [[
      { text: `${texts.confirmMediaEdit} #${entry.id}`, callbackData: `${editMediaPrefix}${entry.id}` },
      { text: `${texts.confirmMediaDelete} #${entry.id}`, callbackData: `${deleteMediaPrefix}${entry.id}` },
    ]]),
    ...buildLoanDetailButtons({ loan, itemId, language, deleteCallbackData: `${deactivatePrefix}${itemId}` }),
  ];
}
