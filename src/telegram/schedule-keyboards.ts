import { createTelegramI18n, type BotLanguage } from './i18n.js';
import { buildUpcomingDateRows } from './schedule-presentation.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

export const scheduleLabels = {
  openMenu: 'Activitats',
  list: 'Veure activitats',
  create: 'Crear activitat',
  edit: 'Editar activitat',
  cancel: 'Cancel.lar activitat',
  editFieldTitle: 'Titol',
  editFieldDescription: 'Descripcio',
  editFieldDate: 'Data inici',
  editFieldTime: 'Hora inici',
  editFieldDuration: 'Durada',
  editFieldCapacity: 'Places',
  editFieldTable: 'Taula',
  start: 'Inici',
  help: 'Ajuda',
  cancelFlow: '/cancel',
  skipOptional: 'Ometre',
  keepCurrent: 'Mantenir valor actual',
  noTable: 'Sense taula',
  keepCurrentDuration: 'Mantenir durada actual',
  defaultDuration: '180 min per defecte',
  confirmCreate: 'Guardar activitat',
  confirmEdit: 'Guardar canvis',
  confirmCancel: 'Confirmar cancel.lacio',
} as const;

export function buildScheduleMenuOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const i18n = createTelegramI18n(language);
  const texts = i18n.schedule;
  return {
    replyKeyboard: [[texts.list, texts.create], [texts.edit, texts.cancel], [i18n.actionMenu.start, i18n.actionMenu.help]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildSingleCancelKeyboard(): TelegramReplyOptions {
  return {
    replyKeyboard: [[scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildDescriptionOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.skipOptional], [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildDateOptions(botLanguage: string): TelegramReplyOptions {
  return {
    replyKeyboard: [...buildUpcomingDateRows(botLanguage), [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildEditDateOptions(botLanguage: string, language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.keepCurrent], ...buildUpcomingDateRows(botLanguage), [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildEditDescriptionOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.keepCurrent], [texts.skipOptional], [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildEditTitleOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[scheduleLabels.keepCurrent], [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildEditDurationOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[scheduleLabels.keepCurrent], [scheduleLabels.skipOptional], [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildCreateDurationOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.skipOptional], [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildCreateConfirmOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.confirmCreate], [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildEditConfirmOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.confirmEdit], [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildKeepCurrentKeyboard(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.keepCurrent], [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildEditFieldMenuOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [
      [texts.editFieldTitle, texts.editFieldDescription],
      [texts.editFieldDate, texts.editFieldTime],
      [texts.editFieldDuration, texts.editFieldCapacity],
      [texts.editFieldTable],
      [texts.confirmEdit],
      [scheduleLabels.cancelFlow],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildCancelConfirmOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.confirmCancel], [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildTableSelectionOptions({
  tableNames,
  language = 'ca',
}: {
  tableNames: string[];
  language?: BotLanguage;
}): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [...chunkTableButtons(tableNames), [texts.noTable], [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildEditTableOptions({
  tableNames,
  language = 'ca',
}: {
  tableNames: string[];
  language?: BotLanguage;
}): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  const options = buildTableSelectionOptions({ tableNames, language });
  return {
    ...options,
    replyKeyboard: [[texts.keepCurrent], ...(options.replyKeyboard ?? []).filter((row) => row[0] !== scheduleLabels.cancelFlow), [scheduleLabels.cancelFlow]],
  };
}

function chunkTableButtons(tableNames: string[]): string[][] {
  const rows: string[][] = [];

  for (let index = 0; index < tableNames.length; index += 2) {
    rows.push(tableNames.slice(index, index + 2));
  }

  return rows;
}
