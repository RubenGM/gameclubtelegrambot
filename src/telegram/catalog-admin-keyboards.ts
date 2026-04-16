import type { CatalogItemType } from '../catalog/catalog-model.js';
import { createTelegramI18n } from './i18n.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

export function buildCatalogAdminMenuOptions(language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
  const i18n = createTelegramI18n(language);
  const texts = i18n.catalogAdmin;
  return buildReplyKeyboard([
    [texts.create, texts.listBoardGames],
    [texts.listBooks, texts.listRpgBooks],
    [texts.searchByName],
    [i18n.actionMenu.start],
  ]);
}

export function buildTypeOptions(language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([
    [texts.typeBoardGame],
    [texts.typeBook, texts.typeRpgBook],
    [texts.typeAccessory],
    [texts.cancel],
  ]);
}

export function buildEditTypeOptions(language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([
    [texts.keepCurrent],
    [texts.typeBoardGame],
    [texts.typeBook, texts.typeRpgBook],
    [texts.typeAccessory],
    [texts.cancel],
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
    return buildReplyKeyboard([[texts.noFamily], [texts.cancel]]);
  }

  const replyKeyboard = chunkKeyboard(popularFamilyNames, 3);
  replyKeyboard.push([texts.noFamily], [texts.cancel]);
  return buildReplyKeyboard(replyKeyboard);
}

export function buildEditFamilyOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([[texts.keepCurrent, texts.noFamily], [texts.cancel]]);
}

export function buildGroupOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([[texts.noGroup], [texts.cancel]]);
}

export function buildEditGroupOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([[texts.keepCurrent, texts.noGroup], [texts.cancel]]);
}

export function buildSkipOptionalKeyboard(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([[texts.skipOptional], [texts.cancel]]);
}

export function buildCreateOptionalKeyboard(currentValue: unknown, language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  return currentValue === null || currentValue === undefined
    ? buildSkipOptionalKeyboard(language)
    : buildEditOptionalKeyboard(language);
}

export function buildEditOptionalKeyboard(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([[texts.keepCurrent, texts.skipOptional], [texts.cancel]]);
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
  const replyKeyboard: string[][] = [
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
  replyKeyboard.push([texts.confirmEdit], [texts.cancel]);
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
  const replyKeyboard: string[][] = [
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
  replyKeyboard.push([texts.searchOnlineServices]);
  replyKeyboard.push([texts.confirmCreate], [texts.cancel]);
  return buildReplyKeyboard(replyKeyboard);
}

export function buildCreateConfirmOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([[texts.confirmCreate], [texts.cancel]]);
}

export function buildEditConfirmOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([[texts.confirmEdit], [texts.cancel]]);
}

export function buildDeactivateConfirmOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([[texts.confirmDeactivate], [texts.cancel]]);
}

export function buildMediaTypeOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([
    [texts.mediaTypeImage, texts.mediaTypeLink],
    [texts.mediaTypeDocument],
    [texts.cancel],
  ]);
}

export function buildEditMediaTypeOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([
    [texts.keepCurrent],
    [texts.mediaTypeImage, texts.mediaTypeLink],
    [texts.mediaTypeDocument],
    [texts.cancel],
  ]);
}

export function buildMediaConfirmOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([[texts.confirmMediaCreate], [texts.cancel]]);
}

export function buildMediaEditConfirmOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([[texts.confirmMediaEdit], [texts.cancel]]);
}

export function buildMediaDeleteConfirmOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([[texts.confirmMediaDelete], [texts.cancel]]);
}

export function buildKeepCurrentKeyboard(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([[texts.keepCurrent], [texts.cancel]]);
}

export function buildSingleCancelKeyboard(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([[texts.cancel]]);
}

export function buildWikipediaUrlOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return buildReplyKeyboard([[texts.skipLookupImport], [texts.cancel]]);
}

export function buildWikipediaCandidateOptions(candidateTitles: string[], language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  const replyKeyboard = chunkKeyboard(candidateTitles, 2);
  replyKeyboard.push([texts.manualWikipediaUrl], [texts.skipLookupImport], [texts.cancel]);
  return buildReplyKeyboard(replyKeyboard);
}

function buildReplyKeyboard(replyKeyboard: string[][]): TelegramReplyOptions {
  return {
    replyKeyboard,
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function chunkKeyboard(values: string[], size: number): string[][] {
  const rows: string[][] = [];
  for (let index = 0; index < values.length; index += size) {
    rows.push(values.slice(index, index + size));
  }
  return rows;
}
