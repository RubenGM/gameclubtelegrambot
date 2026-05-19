import type { AppMetadataSessionStorage } from '../telegram/conversation-session-store.js';
import { defaultHttpThemeName, resolveHttpTheme, type HttpThemeName } from './http-theme.js';

export interface WebSettings {
  theme: HttpThemeName;
  brand: {
    name: string;
    headline: string;
    primaryColor: string;
  };
  home: {
    intro: string;
  };
  clubInfo: {
    summary: string;
    address: string;
    openingHours: string;
    contact: string;
    rules: string;
  };
}

export interface WebSettingsStore {
  load(): Promise<WebSettings>;
  save(settings: WebSettings): Promise<void>;
}

const webSettingsKey = 'http.web.settings';

export const defaultWebSettings: WebSettings = {
  theme: defaultHttpThemeName,
  brand: {
    name: 'CAWA Girona',
    headline: 'Club de juegos, rol y wargames en Girona',
    primaryColor: '#184b1f',
  },
  home: {
    intro: 'CAWA Girona es un club de juegos, rol y wargames en Salt. Compartimos local, mesas, actividades y catalogo para jugar con regularidad y conocer gente con aficiones parecidas.',
  },
  clubInfo: {
    summary: 'CAWA Girona es un club multidisciplinar donde se junta gente con inquietudes por los wargames, los juegos de mesa, el rol y otras actividades del club.',
    address: 'Carrer Major 306, Salt, Girona',
    openingHours: '',
    contact: 'cawagirona@gmail.com',
    rules: '',
  },
};

export function createAppMetadataWebSettingsStore({
  storage,
}: {
  storage: AppMetadataSessionStorage;
}): WebSettingsStore {
  return {
    async load() {
      const raw = await storage.get(webSettingsKey);
      if (!raw) {
        return defaultWebSettings;
      }

      return parseWebSettings(raw);
    },
    async save(settings) {
      await storage.set(webSettingsKey, JSON.stringify(normalizeWebSettings(settings)));
    },
  };
}

export function parseWebSettings(raw: string): WebSettings {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultWebSettings;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return defaultWebSettings;
  }

  return normalizeWebSettings(parsed as Partial<WebSettings>);
}

export function normalizeWebSettings(input: Partial<WebSettings>): WebSettings {
  return {
    theme: resolveHttpTheme(input.theme).name,
    brand: {
      name: normalizeText(input.brand?.name, defaultWebSettings.brand.name, 120),
      headline: normalizeText(input.brand?.headline, defaultWebSettings.brand.headline, 180),
      primaryColor: normalizeColor(input.brand?.primaryColor, defaultWebSettings.brand.primaryColor),
    },
    home: {
      intro: normalizeText(input.home?.intro, defaultWebSettings.home.intro, 1000),
    },
    clubInfo: {
      summary: normalizeText(input.clubInfo?.summary, defaultWebSettings.clubInfo.summary, 2000),
      address: normalizeText(input.clubInfo?.address, defaultWebSettings.clubInfo.address, 240),
      openingHours: normalizeText(input.clubInfo?.openingHours, defaultWebSettings.clubInfo.openingHours, 500),
      contact: normalizeText(input.clubInfo?.contact, defaultWebSettings.clubInfo.contact, 240),
      rules: normalizeText(input.clubInfo?.rules, defaultWebSettings.clubInfo.rules, 2000),
    },
  };
}

function normalizeText(value: string | undefined, fallback: string, maxLength: number): string {
  const normalized = value?.trim();
  if (!normalized) {
    return fallback;
  }

  return normalized.slice(0, maxLength);
}

function normalizeColor(value: string | undefined, fallback: string): string {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^#[0-9a-f]{6}$/.test(normalized) ? normalized : fallback;
}
