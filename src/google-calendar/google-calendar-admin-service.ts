import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

import type { ScheduleRepository } from '../schedule/schedule-catalog.js';
import {
  buildGoogleCalendarUrl,
  createGoogleCalendarClient,
  inspectGoogleCalendarServiceAccountJson,
  parseGoogleCalendarIdentifier,
  resolveGoogleCalendarServiceAccountIdentity,
  type GoogleCalendarClient,
  type GoogleCalendarServiceAccountConfig,
  type GoogleCalendarServiceAccountIdentity,
  type GoogleCalendarSummary,
} from './google-calendar-client.js';
import type {
  GoogleCalendarSettings,
  GoogleCalendarSettingsStore,
  GoogleCalendarVisibility,
} from './google-calendar-settings.js';
import { synchronizeScheduleEventsToCalendar } from './google-calendar-sync.js';

const maxServiceAccountBytes = 256 * 1024;

export type GoogleCalendarCredentialSource = 'web-file' | 'environment' | 'none';

export interface GoogleCalendarAdminState {
  settings: GoogleCalendarSettings;
  credentials: {
    configured: boolean;
    source: GoogleCalendarCredentialSource;
    identity: GoogleCalendarServiceAccountIdentity | null;
    webFilePath: string | null;
  };
  calendars: GoogleCalendarSummary[];
  connectionError: string | null;
}

export interface GoogleCalendarAdminService {
  loadState(): Promise<GoogleCalendarAdminState>;
  saveCredentials(rawJson: Buffer | string): Promise<GoogleCalendarServiceAccountIdentity>;
  removeWebCredentials(): Promise<void>;
  testConnection(): Promise<{ calendars: number; clientEmail: string }>;
  configureCalendar(input: { calendarIdOrUrl: string; visibility: GoogleCalendarVisibility }): Promise<GoogleCalendarSummary>;
  setVisibility(visibility: GoogleCalendarVisibility): Promise<void>;
  setSynchronization(enabled: boolean): Promise<{ synchronized: number }>;
}

export function createGoogleCalendarAdminService({
  config,
  settingsStore,
  scheduleRepository,
  clientFactory = createGoogleCalendarClient,
}: {
  config: GoogleCalendarServiceAccountConfig;
  settingsStore: GoogleCalendarSettingsStore;
  scheduleRepository: ScheduleRepository;
  clientFactory?: (input: { config: GoogleCalendarServiceAccountConfig | undefined }) => GoogleCalendarClient;
}): GoogleCalendarAdminService {
  const createClient = () => clientFactory({ config });

  return {
    async loadState() {
      const [settings, webCredentials] = await Promise.all([
        settingsStore.getSettings(),
        readWebCredentialIdentity(config.serviceAccountFile),
      ]);
      const fallbackIdentity = webCredentials ? null : resolveEnvironmentIdentity(config.serviceAccountJson);
      const identity = webCredentials ?? fallbackIdentity;
      let calendars: GoogleCalendarSummary[] = [];
      let connectionError: string | null = null;
      if (identity) {
        try {
          calendars = await createClient().listAccessibleCalendars();
        } catch (error) {
          connectionError = safeGoogleCalendarError(error);
        }
      }
      return {
        settings,
        credentials: {
          configured: Boolean(identity),
          source: webCredentials ? 'web-file' : fallbackIdentity ? 'environment' : 'none',
          identity,
          webFilePath: webCredentials ? config.serviceAccountFile?.trim() ?? null : null,
        },
        calendars,
        connectionError,
      };
    },

    async saveCredentials(rawJson) {
      const content = Buffer.isBuffer(rawJson) ? rawJson : Buffer.from(rawJson, 'utf8');
      if (content.length === 0 || content.length > maxServiceAccountBytes) {
        throw new Error('El archivo JSON debe tener contenido y no superar 256 KiB.');
      }
      const raw = content.toString('utf8');
      const identity = inspectGoogleCalendarServiceAccountJson(raw);
      const target = requireCredentialFile(config);
      await mkdir(dirname(target), { recursive: true, mode: 0o750 });
      const temporary = `${target}.${randomBytes(8).toString('hex')}.tmp`;
      try {
        await writeFile(temporary, raw, { encoding: 'utf8', mode: 0o600 });
        await chmod(temporary, 0o600);
        await rename(temporary, target);
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
      return identity;
    },

    async removeWebCredentials() {
      const settings = await settingsStore.getSettings();
      await settingsStore.saveSettings({ ...settings, syncEnabled: false });
      const target = requireCredentialFile(config);
      await unlink(target).catch((error: unknown) => {
        if (!(error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) throw error;
      });
    },

    async testConnection() {
      const identity = resolveGoogleCalendarServiceAccountIdentity(config);
      if (!identity) throw new Error('Primero sube un JSON válido de cuenta de servicio.');
      const calendars = await createClient().listAccessibleCalendars();
      return { calendars: calendars.length, clientEmail: identity.clientEmail };
    },

    async configureCalendar({ calendarIdOrUrl, visibility }) {
      const calendarId = parseGoogleCalendarIdentifier(calendarIdOrUrl);
      if (!calendarId) throw new Error('Selecciona un calendario o introduce un ID/enlace válido.');
      const googleClient = createClient();
      const selected = await googleClient.getCalendar(calendarId);
      await googleClient.setVisibility(selected.id, visibility);
      const current = await settingsStore.getSettings();
      await settingsStore.saveSettings({
        ...current,
        calendarId: selected.id,
        calendarUrl: buildGoogleCalendarUrl(selected.id),
        visibility,
        syncEnabled: current.calendarId === selected.id ? current.syncEnabled : false,
      });
      return selected;
    },

    async setVisibility(visibility) {
      const settings = await requireSelectedCalendar(settingsStore);
      await createClient().setVisibility(settings.calendarId, visibility);
      await settingsStore.saveSettings({ ...settings, visibility });
    },

    async setSynchronization(enabled) {
      const settings = await settingsStore.getSettings();
      if (!enabled) {
        await settingsStore.saveSettings({ ...settings, syncEnabled: false });
        return { synchronized: 0 };
      }
      if (!settings.calendarId) throw new Error('Primero selecciona el calendario asociado al bot.');
      const googleClient = createClient();
      await googleClient.getCalendar(settings.calendarId);
      await googleClient.setVisibility(settings.calendarId, settings.visibility);
      const events = await scheduleRepository.listEvents({
        includeCancelled: false,
        startsAtFrom: new Date().toISOString(),
      });
      await synchronizeScheduleEventsToCalendar({
        events,
        calendarId: settings.calendarId,
        config,
        client: googleClient,
      });
      await settingsStore.saveSettings({ ...settings, syncEnabled: true });
      return { synchronized: events.length };
    },
  };
}

async function readWebCredentialIdentity(filePath: string | undefined): Promise<GoogleCalendarServiceAccountIdentity | null> {
  if (!filePath?.trim()) return null;
  try {
    return inspectGoogleCalendarServiceAccountJson(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null;
  }
}

function resolveEnvironmentIdentity(raw: string | undefined): GoogleCalendarServiceAccountIdentity | null {
  if (!raw?.trim()) return null;
  try {
    return inspectGoogleCalendarServiceAccountJson(raw);
  } catch {
    return null;
  }
}

function requireCredentialFile(config: GoogleCalendarServiceAccountConfig): string {
  const target = config.serviceAccountFile?.trim();
  if (!target) throw new Error('No se ha configurado el archivo seguro de credenciales de Google Calendar.');
  return target;
}

async function requireSelectedCalendar(settingsStore: GoogleCalendarSettingsStore): Promise<GoogleCalendarSettings & { calendarId: string }> {
  const settings = await settingsStore.getSettings();
  if (!settings.calendarId) throw new Error('Primero selecciona el calendario asociado al bot.');
  return settings as GoogleCalendarSettings & { calendarId: string };
}

export function safeGoogleCalendarError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(?:private_key|access_token|client_secret)[^\s,}]*/gi, '<oculto>').slice(0, 400);
}
