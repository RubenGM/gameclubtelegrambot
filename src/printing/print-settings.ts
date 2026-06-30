import type { AppMetadataSessionStorage } from '../telegram/conversation-session-store.js';

export interface PrintingSettings {
  mode: PrintingMode;
  cupsQueue: string;
}

export type PrintingMode = 'disabled' | 'test' | 'enabled';

export interface PrintingSettingsStore {
  getSettings(): Promise<PrintingSettings>;
  saveSettings(settings: PrintingSettings): Promise<void>;
}

const settingsKey = 'printing.settings';

export function createAppMetadataPrintingSettingsStore({
  storage,
  defaultQueue,
}: {
  storage: AppMetadataSessionStorage;
  defaultQueue: string;
}): PrintingSettingsStore {
  return {
    async getSettings() {
      const raw = await storage.get(settingsKey);
      if (!raw) {
        return { mode: 'disabled', cupsQueue: defaultQueue };
      }

      return normalizePrintingSettings(JSON.parse(raw), defaultQueue);
    },
    async saveSettings(settings) {
      await storage.set(settingsKey, JSON.stringify(normalizePrintingSettings(settings, defaultQueue)));
    },
  };
}

function normalizePrintingSettings(value: unknown, defaultQueue: string): PrintingSettings {
  if (typeof value !== 'object' || value === null) {
    return { mode: 'disabled', cupsQueue: defaultQueue };
  }

  const candidate = value as Partial<PrintingSettings> & { enabled?: boolean };
  return {
    mode: normalizePrintingMode(candidate),
    cupsQueue: typeof candidate.cupsQueue === 'string' && candidate.cupsQueue.trim()
      ? candidate.cupsQueue.trim()
      : defaultQueue,
  };
}

function normalizePrintingMode(candidate: Partial<PrintingSettings> & { enabled?: boolean }): PrintingMode {
  if (candidate.mode === 'enabled' || candidate.mode === 'test' || candidate.mode === 'disabled') {
    return candidate.mode;
  }
  return candidate.enabled === true ? 'enabled' : 'disabled';
}
