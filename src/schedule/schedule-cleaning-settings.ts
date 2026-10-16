import type { AppMetadataSessionStorage } from '../telegram/conversation-session-store.js';
import type { ScheduleCleaningSettings } from './schedule-catalog.js';

export const defaultScheduleCleaningSettings: ScheduleCleaningSettings = { weekday: 5, startsAt: '09:00', endsAt: '12:00' };
export const scheduleCleaningSettingsKey = 'schedule.cleaning.settings';

export interface ScheduleCleaningSettingsStore {
  get(): Promise<ScheduleCleaningSettings>;
  set(settings: ScheduleCleaningSettings): Promise<void>;
}

export function createAppMetadataScheduleCleaningSettingsStore({ storage }: { storage: AppMetadataSessionStorage }): ScheduleCleaningSettingsStore {
  return {
    async get() {
      const value = await storage.get(scheduleCleaningSettingsKey);
      if (value === null) return defaultScheduleCleaningSettings;
      try { return parseScheduleCleaningSettings(JSON.parse(value)); } catch { return defaultScheduleCleaningSettings; }
    },
    async set(settings) {
      const parsed = parseScheduleCleaningSettings(settings);
      if (JSON.stringify(parsed) === JSON.stringify(defaultScheduleCleaningSettings)) {
        await storage.delete(scheduleCleaningSettingsKey);
      } else {
        await storage.set(scheduleCleaningSettingsKey, JSON.stringify(parsed));
      }
    },
  };
}

export function parseScheduleCleaningSettings(value: unknown): ScheduleCleaningSettings {
  if (!value || typeof value !== 'object') throw new TypeError('Invalid schedule cleaning settings');
  const settings = value as Partial<ScheduleCleaningSettings>;
  if (!Number.isInteger(settings.weekday) || settings.weekday! < 0 || settings.weekday! > 6
    || !isTime(settings.startsAt) || !isTime(settings.endsAt) || settings.startsAt >= settings.endsAt) {
    throw new RangeError('Cleaning weekday and time range are invalid');
  }
  return { weekday: settings.weekday!, startsAt: settings.startsAt!, endsAt: settings.endsAt! };
}

function isTime(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}
