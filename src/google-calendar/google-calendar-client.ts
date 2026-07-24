import { createSign } from 'node:crypto';

import type { GoogleCalendarVisibility } from './google-calendar-settings.js';
import type { ScheduleEventRecord } from '../schedule/schedule-catalog.js';

const calendarScope = 'https://www.googleapis.com/auth/calendar';
const tokenEndpoint = 'https://oauth2.googleapis.com/token';
const calendarApiBaseUrl = 'https://www.googleapis.com/calendar/v3';

export interface GoogleCalendarServiceAccountConfig {
  serviceAccountJson?: string | undefined;
}

export interface GoogleCalendarSummary {
  id: string;
  summary: string;
  accessRole: string;
}

export interface GoogleCalendarClient {
  listAccessibleCalendars(): Promise<GoogleCalendarSummary[]>;
  getCalendar(calendarId: string): Promise<GoogleCalendarSummary>;
  setVisibility(calendarId: string, visibility: GoogleCalendarVisibility): Promise<void>;
  upsertScheduleEvent(input: { calendarId: string; event: ScheduleEventRecord }): Promise<void>;
  deleteScheduleEvent(input: { calendarId: string; scheduleEventId: number }): Promise<void>;
}

export class GoogleCalendarConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleCalendarConfigurationError';
  }
}

export class GoogleCalendarApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'GoogleCalendarApiError';
  }
}

export function createGoogleCalendarClient({
  config,
  fetchFn = fetch,
  now = () => Date.now(),
}: {
  config: GoogleCalendarServiceAccountConfig | undefined;
  fetchFn?: typeof fetch;
  now?: () => number;
}): GoogleCalendarClient {
  const credentials = parseCredentials(config?.serviceAccountJson);
  let cachedToken: { value: string; expiresAt: number } | null = null;

  const accessToken = async (): Promise<string> => {
    if (cachedToken && cachedToken.expiresAt > now() + 60_000) return cachedToken.value;
    const issuedAt = Math.floor(now() / 1000);
    const assertion = signJwt({
      iss: credentials.clientEmail,
      scope: calendarScope,
      aud: tokenEndpoint,
      iat: issuedAt,
      exp: issuedAt + 3600,
    }, credentials.privateKey);
    const response = await fetchFn(tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    const payload = await readJson(response);
    if (!response.ok || typeof payload.access_token !== 'string') {
      throw new GoogleCalendarApiError('Google no pudo autorizar la cuenta de servicio.', response.status);
    }
    const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 3600;
    cachedToken = { value: payload.access_token, expiresAt: now() + expiresIn * 1000 };
    return cachedToken.value;
  };

  const request = async (path: string, init: RequestInit = {}): Promise<Record<string, unknown>> => {
    const token = await accessToken();
    const response = await fetchFn(`${calendarApiBaseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    if (response.status === 204) return {};
    const payload = await readJson(response);
    if (!response.ok) {
      const errorMessage = readGoogleErrorMessage(payload) ?? `Google Calendar devolvió HTTP ${response.status}.`;
      throw new GoogleCalendarApiError(errorMessage, response.status);
    }
    return payload;
  };

  return {
    async listAccessibleCalendars() {
      const payload = await request('/users/me/calendarList?minAccessRole=writer&maxResults=250');
      return parseCalendarItems(payload.items);
    },
    async getCalendar(calendarId) {
      const payload = await request(`/calendars/${encodeURIComponent(calendarId)}`);
      return parseCalendar(payload, calendarId);
    },
    async setVisibility(calendarId, visibility) {
      const path = `/calendars/${encodeURIComponent(calendarId)}/acl`;
      const payload = await request(path);
      const rules = Array.isArray(payload.items) ? payload.items : [];
      const publicRule = rules.find((rule) => isPublicAclRule(rule));
      if (visibility === 'public') {
        if (publicRule && typeof publicRule === 'object' && typeof (publicRule as { id?: unknown }).id === 'string') {
          await request(`${path}/${encodeURIComponent((publicRule as { id: string }).id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ role: 'reader' }),
          });
        } else {
          await request(path, {
            method: 'POST',
            body: JSON.stringify({ role: 'reader', scope: { type: 'default' } }),
          });
        }
        return;
      }
      if (publicRule && typeof publicRule === 'object' && typeof (publicRule as { id?: unknown }).id === 'string') {
        await request(`${path}/${encodeURIComponent((publicRule as { id: string }).id)}`, { method: 'DELETE' });
      }
    },
    async upsertScheduleEvent({ calendarId, event }) {
      const eventId = googleEventId(event.id);
      const payload = JSON.stringify(toGoogleEvent(event));
      const path = `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
      try {
        await request(path, { method: 'PUT', body: payload });
      } catch (error) {
        if (!(error instanceof GoogleCalendarApiError) || error.status !== 404) throw error;
        await request(`/calendars/${encodeURIComponent(calendarId)}/events`, {
          method: 'POST',
          body: JSON.stringify({ ...toGoogleEvent(event), id: eventId }),
        });
      }
    },
    async deleteScheduleEvent({ calendarId, scheduleEventId }) {
      try {
        await request(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId(scheduleEventId))}`, {
          method: 'DELETE',
        });
      } catch (error) {
        if (error instanceof GoogleCalendarApiError && error.status === 404) return;
        throw error;
      }
    },
  };
}

export function buildGoogleCalendarUrl(calendarId: string): string {
  return `https://calendar.google.com/calendar/u/0?cid=${Buffer.from(calendarId, 'utf8').toString('base64url')}`;
}

export function parseGoogleCalendarIdentifier(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return isSafeCalendarId(trimmed) ? trimmed : null;
  try {
    const url = new URL(trimmed);
    if (!/(^|\.)google\.com$/i.test(url.hostname)) return null;
    const cid = url.searchParams.get('cid');
    if (!cid) return null;
    const decoded = Buffer.from(cid, 'base64url').toString('utf8').trim();
    return isSafeCalendarId(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function isSafeCalendarId(value: string): boolean {
  return value.length > 2 && value.length <= 255 && !/\s/.test(value);
}

function googleEventId(scheduleEventId: number): string {
  return `gameclubschedule${scheduleEventId}`;
}

function toGoogleEvent(event: ScheduleEventRecord): Record<string, unknown> {
  const endsAt = new Date(new Date(event.startsAt).getTime() + event.durationMinutes * 60_000).toISOString();
  const description = [
    event.description?.trim() || null,
    `Plazas: ${event.capacity}`,
    `Actividad del club #${event.id}`,
  ].filter((line): line is string => Boolean(line)).join('\n\n');
  return {
    summary: event.title,
    description,
    start: { dateTime: event.startsAt, timeZone: 'Europe/Madrid' },
    end: { dateTime: endsAt, timeZone: 'Europe/Madrid' },
    extendedProperties: { private: { gameclubScheduleEventId: String(event.id) } },
  };
}

function parseCredentials(raw: string | undefined): { clientEmail: string; privateKey: string } {
  if (!raw?.trim()) {
    throw new GoogleCalendarConfigurationError('Falta GAMECLUB_GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON.');
  }
  try {
    const value = JSON.parse(raw) as { client_email?: unknown; private_key?: unknown };
    if (typeof value.client_email !== 'string' || !value.client_email.trim() || typeof value.private_key !== 'string' || !value.private_key.trim()) {
      throw new Error('missing fields');
    }
    return { clientEmail: value.client_email.trim(), privateKey: value.private_key.replace(/\\n/g, '\n') };
  } catch {
    throw new GoogleCalendarConfigurationError('GAMECLUB_GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON no contiene una cuenta de servicio válida.');
  }
}

function signJwt(payload: Record<string, unknown>, privateKey: string): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(payload)}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey).toString('base64url')}`;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const payload: unknown = await response.json();
    return payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseCalendarItems(value: unknown): GoogleCalendarSummary[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
      try { return [parseCalendar(item)]; } catch { return []; }
    })
    : [];
}

function parseCalendar(value: unknown, fallbackId?: string): GoogleCalendarSummary {
  const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const id = typeof item.id === 'string' ? item.id : fallbackId;
  if (!id) throw new GoogleCalendarApiError('Google no devolvió un identificador de calendario válido.', 502);
  return {
    id,
    summary: typeof item.summary === 'string' && item.summary.trim() ? item.summary.trim() : id,
    accessRole: typeof item.accessRole === 'string' ? item.accessRole : 'unknown',
  };
}

function isPublicAclRule(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const scope = (value as { scope?: unknown }).scope;
  return Boolean(scope && typeof scope === 'object' && (scope as { type?: unknown }).type === 'default');
}

function readGoogleErrorMessage(payload: Record<string, unknown>): string | null {
  const error = payload.error;
  if (!error || typeof error !== 'object') return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message.trim() : null;
}
