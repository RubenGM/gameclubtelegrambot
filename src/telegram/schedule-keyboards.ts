import { createTelegramI18n, type BotLanguage } from './i18n.js';
import { buildUpcomingDateRows } from './schedule-presentation.js';
import type { TelegramReplyButton, TelegramReplyKeyboardButton, TelegramReplyOptions } from './runtime-boundary.js';
import { buildSubmenuReplyKeyboard } from './submenu-keyboards.js';

export const scheduleLabels = {
  openMenu: 'Activitats',
  list: 'Veure activitats',
  create: 'Crear activitat',
  createSimple: 'Crear (simple)',
  edit: 'Editar activitat',
  cancel: 'Cancel.lar activitat',
  editFieldTitle: 'Titol',
  editFieldDescription: 'Descripcio',
  editFieldDate: 'Data inici',
  editFieldTime: 'Hora inici',
  editFieldDuration: 'Durada',
  editFieldAttendanceMode: 'Tipus de taula',
  editFieldCapacity: 'Places',
  editFieldInitialOccupiedSeats: 'Places ocupades inicials',
  editFieldPublicVisibility: 'Visibilitat',
  editFieldTable: 'Taula',
  editFieldEquipment: 'Equipament',
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
  publicVisibilityYes: 'Pública',
  publicVisibilityNo: 'Només socis',
  initialOccupiedSeatsZero: '0',
  confirmCreate: 'Guardar activitat',
  confirmEdit: 'Guardar canvis',
  confirmCancel: 'Confirmar cancel·lació',
  reminder2h: '2h abans',
  reminder24h: '24h abans',
  reminderCustom: 'Personalitzat',
  reminderNone: 'Sense recordatori',
} as const;

export function buildScheduleMenuOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return buildSubmenuReplyKeyboard({ language, rows: [[texts.list, texts.create, texts.createSimple], [texts.edit, texts.cancel]] });
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

export function buildSingleBackCancelKeyboard(language: BotLanguage = 'ca', creation = false): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[creation ? texts.creationBack : texts.back], ...(creation ? [[texts.exitCreation]] : []), [dangerButton(scheduleLabels.cancelFlow)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildTimeMinuteOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[':00', ':15'], [':30', ':45'], [texts.creationBack], [texts.exitCreation], [dangerButton(scheduleLabels.cancelFlow)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildCreateTitleOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return { ...buildSingleBackCancelKeyboard(language, true), replyKeyboard: [[texts.exitCreation], [dangerButton(scheduleLabels.cancelFlow)]] };
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
    replyKeyboard: [[successButton(texts.skipOptional)], [texts.creationBack], [texts.exitCreation], [dangerButton(scheduleLabels.cancelFlow)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildDateOptions(botLanguage: string, creation = false): TelegramReplyOptions {
  const texts = createTelegramI18n((botLanguage as BotLanguage) ?? 'ca').schedule;
  return {
    replyKeyboard: [...buildUpcomingDateRows(botLanguage), [creation ? texts.creationBack : texts.back], ...(creation ? [[texts.exitCreation]] : []), [dangerButton(scheduleLabels.cancelFlow)]],
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

export function buildCreateDurationOptions(language: BotLanguage = 'ca', creation = false): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[creation ? texts.createDefaultDuration : texts.durationNone, texts.durationHours], [texts.durationHoursMinutes, texts.durationMinutes], [creation ? texts.creationBack : texts.back], ...(creation ? [[texts.exitCreation]] : []), [dangerButton(scheduleLabels.cancelFlow)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildCreateConfirmOptions(language: BotLanguage = 'ca', data?: { attendanceMode?: unknown }): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [
      [texts.editFieldTitle, texts.editFieldDate],
      [texts.editFieldTime, texts.editFieldDuration],
      [texts.editFieldAttendanceMode, texts.editFieldCapacity],
      ...(data?.attendanceMode === 'open' ? [[texts.editFieldPublicVisibility, texts.editFieldInitialOccupiedSeats]] : []),
      [texts.editFieldTable, texts.editFieldEquipment],
      [texts.editFieldDescription],
      [successButton(texts.confirmCreate)],
      [texts.creationBack],
      [texts.exitCreation],
      [dangerButton(scheduleLabels.cancelFlow)],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildCreateTimeOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const navigation = buildSingleBackCancelKeyboard(language, true);
  return { ...navigation, replyKeyboard: [['10:00', '16:00'], ['18:00', '20:00'], ...(navigation.replyKeyboard ?? [])] };
}

export function buildCreateCapacityOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const navigation = buildSingleBackCancelKeyboard(language, true);
  return { ...navigation, replyKeyboard: [['2', '4', '6'], ...(navigation.replyKeyboard ?? [])] };
}

export function buildAttendanceModeOptions(language: BotLanguage = 'ca', creation = false): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.attendanceOpen, texts.attendanceClosed], [creation ? texts.creationBack : texts.back], ...(creation ? [[texts.exitCreation]] : []), [dangerButton(scheduleLabels.cancelFlow)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildPublicVisibilityOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.publicVisibilityYes, texts.publicVisibilityNo], [texts.creationBack], [texts.exitCreation], [dangerButton(scheduleLabels.cancelFlow)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildEditPublicVisibilityOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.keepCurrent], [texts.publicVisibilityYes, texts.publicVisibilityNo], [dangerButton(scheduleLabels.cancelFlow)]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildInitialOccupiedSeatsOptions(language: BotLanguage = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.initialOccupiedSeatsZero], [texts.creationBack], [texts.exitCreation], [dangerButton(scheduleLabels.cancelFlow)]],
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
  hasPublicVisibility,
  language = 'ca',
}: {
  hasInitialOccupiedSeats: boolean;
  hasPublicVisibility?: boolean;
  language?: BotLanguage;
}): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [
      [texts.editFieldTitle, texts.editFieldDate],
      [texts.editFieldTime, texts.editFieldDuration],
      [texts.editFieldCapacity, texts.editFieldAttendanceMode],
      ...(hasInitialOccupiedSeats ? [[texts.editFieldInitialOccupiedSeats]] : []),
      ...(hasPublicVisibility ? [[texts.editFieldPublicVisibility]] : []),
      [texts.editFieldTable, texts.editFieldEquipment],
      [texts.editFieldDescription],
      [texts.confirmEdit],
      [dangerButton(scheduleLabels.cancelFlow)],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function buildEquipmentSelectionOptions({
  equipment,
  selectedEquipmentIds,
  language = 'ca',
  creation = false,
}: {
  equipment: Array<{ id: number; displayName: string }>;
  selectedEquipmentIds: number[];
  language?: BotLanguage;
  creation?: boolean;
}): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  const selected = new Set(selectedEquipmentIds);
  const labels = equipment.map((item) => selected.has(item.id) ? `✓ ${item.displayName}` : item.displayName);
  return {
    replyKeyboard: [
      ...chunkTableButtons(labels),
      [successButton(selected.size === 0 ? texts.noEquipment : texts.finishEquipment)],
      [creation ? texts.creationBack : texts.back], ...(creation ? [[texts.exitCreation]] : []),
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
  creation = false,
}: {
  tableNames: string[];
  language?: BotLanguage;
  creation?: boolean;
}): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [...chunkTableButtons(tableNames), [successButton(texts.noTable)], [creation ? texts.creationBack : texts.back], ...(creation ? [[texts.exitCreation]] : []), [dangerButton(scheduleLabels.cancelFlow)]],
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
  const options = buildTableSelectionOptions({ tableNames, language, creation: false });
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
