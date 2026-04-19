import { createTelegramI18n, type BotLanguage } from './i18n.js';

export function parseScheduleStartPayload(messageText: string | undefined, payloadPrefix: string): number | null {
  const payload = messageText?.trim().split(/\s+/).slice(1).join(' ');
  if (!payload || !payload.startsWith(payloadPrefix)) {
    return null;
  }

  const eventId = Number(payload.slice(payloadPrefix.length));
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return null;
  }

  return eventId;
}

export function parseDate(value: string): string | Error {
  const normalizedValue = value.includes(',') ? value.slice(value.indexOf(',') + 1).trim() : value;

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return normalizedValue;
  }

  const match = normalizedValue.match(/^(\d{2})\/(\d{2})(?:\/(\d{4}))?$/);
  if (!match) {
    return new Error('invalid-date');
  }

  const [, dayText, monthText, yearText] = match;
  const year = Number(yearText ?? String(new Date().getUTCFullYear()));
  const month = Number(monthText);
  const day = Number(dayText);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(candidate.getTime()) ||
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return new Error('invalid-date');
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseTime(value: string): string | Error {
  return /^\d{2}:\d{2}$/.test(value) ? value : new Error('invalid-time');
}

export function parseTimeHour(value: string): string | Error {
  return /^\d{2}$/.test(value) ? value : new Error('invalid-time-hour');
}

export function parseTimeMinuteSelection(value: string): string | Error {
  return value === ':00' || value === ':15' || value === ':30' || value === ':45' ? value : new Error('invalid-time-minute');
}

export function buildTimeFromHourAndMinute(hour: string, minuteSelection: string): string {
  return `${hour}${minuteSelection}`;
}

export function parseCapacity(value: string): number | Error {
  return parsePositiveInteger(value, 'invalid-capacity');
}

export function parseOptionalDurationMinutes({
  value,
  language = 'ca',
  skipOptionalLabels,
  defaultDurationMinutes,
}: {
  value: string;
  language?: BotLanguage;
  skipOptionalLabels: string[];
  defaultDurationMinutes: number;
}): number | Error {
  const texts = createTelegramI18n(language).schedule;
  if (value === texts.skipOptional || skipOptionalLabels.includes(value)) {
    return defaultDurationMinutes;
  }
  return parsePositiveInteger(value, 'invalid-duration');
}

export function parseDurationHours(value: string): number | Error {
  const hours = parsePositiveInteger(value, 'invalid-duration-hours');
  return hours instanceof Error ? hours : hours * 60;
}

export function parseDurationHoursMinutes(value: string): number | Error {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return new Error('invalid-duration-hours-minutes');
  }
  const [, hoursText, minutesText] = match;
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
    return new Error('invalid-duration-hours-minutes');
  }
  const totalMinutes = hours * 60 + minutes;
  return totalMinutes > 0 ? totalMinutes : new Error('invalid-duration-hours-minutes');
}

export function buildStartsAt(date: string, time: string): string {
  return `${date}T${time}:00.000Z`;
}

export function parseEntityId(callbackData: string, prefix: string, kind: string): number {
  const candidate = Number(callbackData.slice(prefix.length));
  if (!Number.isInteger(candidate) || candidate <= 0) {
    throw new Error(`No s ha pogut identificar la ${kind} seleccionada.`);
  }
  return candidate;
}

export function parseDayKey(callbackData: string, prefix: string): string {
  const dayKey = callbackData.slice(prefix.length);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    throw new Error('No s ha pogut identificar el dia seleccionat.');
  }
  return dayKey;
}

export function parseTableSelection(callbackData: string, prefix: string): number | null {
  const value = callbackData.slice(prefix.length);
  if (value === 'none') {
    return null;
  }
  const tableId = Number(value);
  if (!Number.isInteger(tableId) || tableId <= 0) {
    throw new Error('No s ha pogut identificar la taula seleccionada.');
  }
  return tableId;
}

export function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function parsePositiveInteger(value: string, code = 'invalid-positive-integer'): number | Error {
  if (!/^\d+$/.test(value)) {
    return new Error(code);
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : new Error(code);
}
