import type { AppMetadataSessionStorage } from '../telegram/conversation-session-store.js';

export type GoogleCalendarVisibility = 'private' | 'public';

export interface GoogleCalendarSettings {
  calendarId: string | null;
  calendarUrl: string | null;
  visibility: GoogleCalendarVisibility;
  syncEnabled: boolean;
}

export interface GoogleCalendarSettingsStore {
  getSettings(): Promise<GoogleCalendarSettings>;
  saveSettings(settings: GoogleCalendarSettings): Promise<void>;
}

const settingsKey = 'google_calendar.settings';
const defaultSettings: GoogleCalendarSettings = {
  calendarId: null,
  calendarUrl: null,
  visibility: 'private',
  syncEnabled: false,
};

export function createAppMetadataGoogleCalendarSettingsStore({
  storage,
}: {
  storage: AppMetadataSessionStorage;
}): GoogleCalendarSettingsStore {
  return {
    async getSettings() {
      const raw = await storage.get(settingsKey);
      if (!raw) return { ...defaultSettings };
      try {
        return normalizeSettings(JSON.parse(raw));
      } catch {
        return { ...defaultSettings };
      }
    },
    async saveSettings(settings) {
      await storage.set(settingsKey, JSON.stringify(normalizeSettings(settings)));
    },
  };
}

function normalizeSettings(value: unknown): GoogleCalendarSettings {
  if (!value || typeof value !== 'object') return { ...defaultSettings };
  const candidate = value as Partial<GoogleCalendarSettings>;
  const calendarId = normalizeOptionalString(candidate.calendarId);
  return {
    calendarId,
    calendarUrl: calendarId ? normalizeOptionalString(candidate.calendarUrl) : null,
    visibility: candidate.visibility === 'public' ? 'public' : 'private',
    syncEnabled: candidate.syncEnabled === true && Boolean(calendarId),
  };
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
