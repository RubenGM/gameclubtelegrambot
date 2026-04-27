import type { CatalogItemType } from '../catalog/catalog-model.js';
import { createTelegramI18n } from './i18n.js';
import type { TelegramReplyButton, TelegramReplyKeyboardButton, TelegramReplyOptions } from './runtime-boundary.js';
import { buildSubmenuReplyKeyboard } from './submenu-keyboards.js';

export function buildCatalogAdminMenuOptions(language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildSubmenuReplyKeyboard({ language, rows: [
    [texts.create, texts.listBoardGames],
    [texts.listBooks, texts.listRpgBooks],
    [texts.listExpansions, texts.searchByName],
    [texts.importBggCollection],
  ] });
}

export function buildTypeOptions(language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([
    [texts.typeBoardGame],
    [texts.typeBook, texts.typeRpgBook],
    [texts.typeAccessory],
    [dangerButton(texts.cancel)],
  ]);
}

export function buildEditTypeOptions(language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([
    [texts.keepCurrent],
    [texts.typeBoardGame],
    [texts.typeBook, texts.typeRpgBook],
    [texts.typeAccessory],
    [dangerButton(texts.cancel)],
  ]);
}

export function buildFamilyOptions({
  allowNoFamily,
  popularFamilyNames,
  language = 'ca',
}: {
  allowNoFamily: boolean;
  popularFamilyNames: string[];
  language?: 'ca' | 'es' | 'en';
}): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  if (!allowNoFamily) {
    return buildReplyKeyboard([[successButton(texts.noFamily)], [dangerButton(texts.cancel)]]);
  }

  const replyKeyboard: TelegramReplyKeyboardButton[][] = chunkKeyboard(popularFamilyNames, 3);
  replyKeyboard.push([successButton(texts.noFamily)], [dangerButton(texts.cancel)]);
  return buildReplyKeyboard(replyKeyboard);
}

export function buildEditFamilyOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([[texts.keepCurrent, successButton(texts.noFamily)], [dangerButton(texts.cancel)]]);
}

export function buildGroupOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([[successButton(texts.noGroup)], [dangerButton(texts.cancel)]]);
}

export function buildEditGroupOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([[texts.keepCurrent, successButton(texts.noGroup)], [dangerButton(texts.cancel)]]);
}

export function buildSkipOptionalKeyboard(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([[successButton(texts.skipOptional)], [dangerButton(texts.cancel)]]);
}

export function buildCreateOptionalKeyboard(currentValue: unknown, language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  return currentValue === null || currentValue === undefined
    ? buildSkipOptionalKeyboard(language)
    : buildEditOptionalKeyboard(language);
}

export function buildEditOptionalKeyboard(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([[texts.keepCurrent, successButton(texts.skipOptional)], [dangerButton(texts.cancel)]]);
}

export function buildEditFieldMenuOptions({
  itemType,
  itemTypeSupportsPlayers,
  language = 'ca',
}: {
  itemType: CatalogItemType;
  itemTypeSupportsPlayers: (itemType: CatalogItemType) => boolean;
  language?: 'ca' | 'es' | 'en';
}): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  const replyKeyboard: TelegramReplyKeyboardButton[][] = [
    [texts.editFieldDisplayName, texts.editFieldItemType],
    [texts.editFieldFamily, texts.editFieldGroup],
    [texts.editFieldOriginalName, texts.editFieldDescription],
    [texts.editFieldLanguage, texts.editFieldPublisher],
    [texts.editFieldPublicationYear, texts.editFieldRecommendedAge],
    [texts.editFieldPlayTimeMinutes],
    [texts.editFieldExternalRefs, texts.editFieldMetadata],
  ];
  if (itemTypeSupportsPlayers(itemType)) {
    replyKeyboard.splice(5, 0, [texts.editFieldPlayerMin, texts.editFieldPlayerMax]);
  }
  replyKeyboard.push([successButton(texts.confirmEdit)], [dangerButton(texts.cancel)]);
  return buildReplyKeyboard(replyKeyboard);
}

export function buildCreateFieldMenuOptions({
  itemType,
  itemTypeSupportsPlayers,
  language = 'ca',
}: {
  itemType: CatalogItemType;
  itemTypeSupportsPlayers: (itemType: CatalogItemType) => boolean;
  language?: 'ca' | 'es' | 'en';
}): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  const replyKeyboard: TelegramReplyKeyboardButton[][] = [
    [texts.editFieldDisplayName, texts.editFieldItemType],
    [texts.editFieldFamily, texts.editFieldGroup],
    [texts.editFieldOriginalName, texts.editFieldDescription],
    [texts.editFieldLanguage, texts.editFieldPublisher],
    [texts.editFieldPublicationYear, texts.editFieldRecommendedAge],
    [texts.editFieldPlayTimeMinutes],
    [texts.editFieldExternalRefs, texts.editFieldMetadata],
  ];
  if (itemTypeSupportsPlayers(itemType)) {
    replyKeyboard.splice(5, 0, [texts.editFieldPlayerMin, texts.editFieldPlayerMax]);
  }
  replyKeyboard.push([successButton(texts.searchOnlineServices)]);
  replyKeyboard.push([successButton(texts.confirmCreate)], [dangerButton(texts.cancel)]);
  return buildReplyKeyboard(replyKeyboard);
}

export function buildCreateConfirmOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([[successButton(texts.confirmCreate)], [dangerButton(texts.cancel)]]);
}

export function buildEditConfirmOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([[successButton(texts.confirmEdit)], [dangerButton(texts.cancel)]]);
}

export function buildDeactivateConfirmOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([[dangerButton(texts.confirmDeactivate)], [dangerButton(texts.cancel)]]);
}

export function buildMediaTypeOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([
    [texts.mediaTypeImage, texts.mediaTypeLink],
    [texts.mediaTypeDocument],
    [dangerButton(texts.cancel)],
  ]);
}

export function buildEditMediaTypeOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([
    [texts.keepCurrent],
    [texts.mediaTypeImage, texts.mediaTypeLink],
    [texts.mediaTypeDocument],
    [dangerButton(texts.cancel)],
  ]);
}

export function buildMediaConfirmOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([[successButton(texts.confirmMediaCreate)], [dangerButton(texts.cancel)]]);
}

export function buildMediaEditConfirmOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([[successButton(texts.confirmMediaEdit)], [dangerButton(texts.cancel)]]);
}

export function buildMediaDeleteConfirmOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([[dangerButton(texts.confirmMediaDelete)], [dangerButton(texts.cancel)]]);
}

export function buildKeepCurrentKeyboard(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([[texts.keepCurrent], [dangerButton(texts.cancel)]]);
}

export function buildSingleCancelKeyboard(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([[dangerButton(texts.cancel)]]);
}

export function buildBggCollectionChoiceOptions({
  collectionLabels,
  allowManualEntry,
  language = 'ca',
}: {
  collectionLabels: string[];
  allowManualEntry: boolean;
  language?: 'ca' | 'es' | 'en';
}): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  const replyKeyboard: TelegramReplyKeyboardButton[][] = chunkKeyboard(collectionLabels, 2);
  if (allowManualEntry) {
    replyKeyboard.push([texts.bggCollectionWriteManual]);
  }
  replyKeyboard.push([dangerButton(texts.cancel)]);
  return buildReplyKeyboard(replyKeyboard);
}

export function buildWikipediaUrlOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([[successButton(texts.skipLookupImport)], [dangerButton(texts.cancel)]]);
}

export function buildWikipediaCandidateOptions(candidateTitles: string[], language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  const replyKeyboard: TelegramReplyKeyboardButton[][] = chunkKeyboard(candidateTitles, 2);
  replyKeyboard.push([texts.manualWikipediaUrl], [successButton(texts.skipLookupImport)], [dangerButton(texts.cancel)]);
  return buildReplyKeyboard(replyKeyboard);
}

function buildReplyKeyboard(replyKeyboard: TelegramReplyKeyboardButton[][]): TelegramReplyOptions {
  return {
    replyKeyboard,
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function successButton(text: string): TelegramReplyButton {
  return { text, semanticRole: 'success' };
}

function dangerButton(text: string): TelegramReplyButton {
  return { text, semanticRole: 'danger' };
}

function chunkKeyboard(values: string[], size: number): string[][] {
  const rows: string[][] = [];
  for (let index = 0; index < values.length; index += size) {
    rows.push(values.slice(index, index + size));
  }
  return rows;
}
