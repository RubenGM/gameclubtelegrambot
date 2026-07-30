import type { AppMetadataSessionStorage } from '../telegram/conversation-session-store.js';

export interface ScheduleWebCreateSettings {
  enabled: boolean;
  publicBaseUrl: string;
}

export interface ScheduleWebCreateSettingsStore {
  load(): Promise<ScheduleWebCreateSettings>;
  save(settings: ScheduleWebCreateSettings): Promise<ScheduleWebCreateSettings>;
}

export const defaultScheduleWebCreateSettings: ScheduleWebCreateSettings = {
  enabled: false,
  publicBaseUrl: 'https://cawa.hopto.org',
};

const settingsKey = 'schedule.web_create.settings';

export function createAppMetadataScheduleWebCreateSettingsStore({
  storage,
}: {
  storage: AppMetadataSessionStorage;
}): ScheduleWebCreateSettingsStore {
  return {
    async load() {
      return parseScheduleWebCreateSettings(await storage.get(settingsKey));
    },
    async save(settings) {
      const normalized = normalizeScheduleWebCreateSettings(settings);
      await storage.set(settingsKey, JSON.stringify(normalized));
      return normalized;
    },
  };
}

export function parseScheduleWebCreateSettings(raw: string | null): ScheduleWebCreateSettings {
  if (!raw) {
    return defaultScheduleWebCreateSettings;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ScheduleWebCreateSettings>;
    return normalizeScheduleWebCreateSettings({
      enabled: parsed.enabled === true,
      publicBaseUrl: typeof parsed.publicBaseUrl === 'string'
        ? parsed.publicBaseUrl
        : defaultScheduleWebCreateSettings.publicBaseUrl,
    });
  } catch {
    return defaultScheduleWebCreateSettings;
  }
}

export function normalizeScheduleWebCreateSettings(
  settings: ScheduleWebCreateSettings,
): ScheduleWebCreateSettings {
  const publicBaseUrl = normalizePublicBaseUrl(settings.publicBaseUrl);
  return {
    enabled: settings.enabled === true,
    publicBaseUrl,
  };
}

function normalizePublicBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('La URL pública del formulario no es válida.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('La URL pública debe usar HTTP o HTTPS.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('La URL pública no puede incluir credenciales, parámetros ni fragmentos.');
  }

  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}
