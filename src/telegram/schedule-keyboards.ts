import { createTelegramI18n, type BotLanguage } from './i18n.js';
import { buildUpcomingDateRows } from './schedule-presentation.js';
import type { TelegramReplyButton, TelegramReplyKeyboardButton, TelegramReplyOptions } from './runtime-boundary.js';
import { buildSubmenuReplyKeyboard } from './submenu-keyboards.js';

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
  editFieldInitialOccupiedSeats: 'Places ocupades inicials',
  editFieldTable: 'Taula',
  start: 'Inici',
  help: 'Ajuda',
  cancelFlow: '/cancel',
  skipOptional: 'Ometre',
  keepCurrent: 'Mantenir valor actual',
  noTable: 'Sense taula',
  keepCurrentDuration: 'Mantenir durada actual',
  defaultDuration: '180 min per defecte',
  durationNone: 'Sense durada',
  durationHours: 'Hores',
  durationHoursMinutes: 'Hores i minuts',
  durationMinutes: 'Minuts',
  attendanceOpen: 'Abierta',
  attendanceClosed: 'Cerrada',
  initialOccupiedSeatsZero: '0',
  confirmCreate: 'Guardar activitat',
  confirmEdit: 'Guardar canvis',
  confirmCancel: 'Confirmar cancel.lacio',
  reminder2h: '2h abans',
  reminder24h: '24h abans',
  reminderCustom: 'Personalitzat',
  reminderNone: 'Sense recordatori',
} as const;

export function buildScheduleMenuOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return buildSubmenuReplyKeyboard({ language, rows: [[texts.list, texts.create], [texts.edit, texts.cancel]] });
}

export function buildReminderPreferenceOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.reminder2h, texts.reminder24h], [texts.reminderCustom, texts.reminderNone]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildSingleCancelKeyboard(): TelegramReplyOptions {
  return {
    replyKeyboard: [[dangerButton(scheduleLabels.cancelFlow)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildSingleBackCancelKeyboard(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.back], [dangerButton(scheduleLabels.cancelFlow)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildTimeMinuteOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[':00', ':15'], [':30', ':45'], [texts.back], [dangerButton(scheduleLabels.cancelFlow)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildEditTimeMinuteOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.keepCurrent], [':00', ':15'], [':30', ':45'], [dangerButton(scheduleLabels.cancelFlow)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildDescriptionOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[successButton(texts.skipOptional)], [texts.back], [dangerButton(scheduleLabels.cancelFlow)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildDateOptions(botLanguage: string): TelegramReplyOptions {
  const texts = createTelegramI18n((botLanguage as BotLanguage) ?? 'ca').schedule;
  return {
    replyKeyboard: [...buildUpcomingDateRows(botLanguage), [texts.back], [dangerButton(scheduleLabels.cancelFlow)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildEditDateOptions(botLanguage: string, language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.keepCurrent], ...buildUpcomingDateRows(botLanguage), [dangerButton(scheduleLabels.cancelFlow)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildEditDescriptionOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.keepCurrent], [texts.skipOptional], [dangerButton(scheduleLabels.cancelFlow)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildEditTitleOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[scheduleLabels.keepCurrent], [dangerButton(scheduleLabels.cancelFlow)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildEditDurationOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.keepCurrent], [texts.durationNone, texts.durationHours], [texts.durationHoursMinutes, texts.durationMinutes], [dangerButton(scheduleLabels.cancelFlow)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildCreateDurationOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.durationNone, texts.durationHours], [texts.durationHoursMinutes, texts.durationMinutes], [texts.back], [dangerButton(scheduleLabels.cancelFlow)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildCreateConfirmOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.editFieldDescription], [successButton(texts.confirmCreate)], [texts.back], [dangerButton(scheduleLabels.cancelFlow)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildAttendanceModeOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.attendanceOpen, texts.attendanceClosed], [texts.back], [dangerButton(scheduleLabels.cancelFlow)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildInitialOccupiedSeatsOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.initialOccupiedSeatsZero], [texts.back], [dangerButton(scheduleLabels.cancelFlow)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildEditInitialOccupiedSeatsOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.keepCurrent], [texts.initialOccupiedSeatsZero], [dangerButton(scheduleLabels.cancelFlow)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildEditConfirmOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.confirmEdit], [dangerButton(scheduleLabels.cancelFlow)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildKeepCurrentKeyboard(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.keepCurrent], [dangerButton(scheduleLabels.cancelFlow)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildEditFieldMenuOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [
      [texts.editFieldTitle, texts.editFieldDate],
      [texts.editFieldTime, texts.editFieldDuration],
      [texts.editFieldCapacity, texts.editFieldTable],
      [texts.editFieldDescription],
      [texts.confirmEdit],
      [dangerButton(scheduleLabels.cancelFlow)],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildEditFieldMenuOptionsForEvent({
  hasInitialOccupiedSeats,
  language = 'ca',
}: {
  hasInitialOccupiedSeats: boolean;
  language?: BotLanguage;
}): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [
      [texts.editFieldTitle, texts.editFieldDate],
      [texts.editFieldTime, texts.editFieldDuration],
      [texts.editFieldCapacity],
      ...(hasInitialOccupiedSeats ? [[texts.editFieldInitialOccupiedSeats]] : []),
      [texts.editFieldTable],
      [texts.editFieldDescription],
      [texts.confirmEdit],
      [dangerButton(scheduleLabels.cancelFlow)],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildCancelConfirmOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.confirmCancel], [dangerButton(scheduleLabels.cancelFlow)]],
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
    replyKeyboard: [...chunkTableButtons(tableNames), [successButton(texts.noTable)], [texts.back], [dangerButton(scheduleLabels.cancelFlow)]],
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
    replyKeyboard: [[texts.keepCurrent], ...(options.replyKeyboard ?? []).filter((row) => firstButtonText(row) !== scheduleLabels.cancelFlow), [dangerButton(scheduleLabels.cancelFlow)]],
  };
}

function successButton(text: string): TelegramReplyButton {
  return { text, semanticRole: 'success' };
}

function dangerButton(text: string): TelegramReplyButton {
  return { text, semanticRole: 'danger' };
}

function firstButtonText(row: TelegramReplyKeyboardButton[]): string | undefined {
  const firstButton = row[0];
  if (typeof firstButton === 'string') {
    return firstButton;
  }

  return firstButton?.text;
}

function chunkTableButtons(tableNames: string[]): string[][] {
  const rows: string[][] = [];

  for (let index = 0; index < tableNames.length; index += 2) {
    rows.push(tableNames.slice(index, index + 2));
  }

  return rows;
}
