import { createDatabaseScheduleRepository } from '../schedule/schedule-catalog-store.js';
import { listScheduleEvents } from '../schedule/schedule-catalog.js';
import {
  buildGoogleCalendarUrl,
  createGoogleCalendarClient,
  parseGoogleCalendarIdentifier,
} from '../google-calendar/google-calendar-client.js';
import {
  createAppMetadataGoogleCalendarSettingsStore,
  type GoogleCalendarSettings,
  type GoogleCalendarSettingsStore,
  type GoogleCalendarVisibility,
} from '../google-calendar/google-calendar-settings.js';
import { synchronizeScheduleEventsToCalendar } from '../google-calendar/google-calendar-sync.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import { createDatabaseAppMetadataSessionStorage } from './conversation-session-store.js';
import { startTelegramEditableProgress } from './editable-progress.js';
import type { TelegramInlineButton } from './runtime-boundary.js';

const flowKey = 'google-calendar-admin';
const callbackPrefix = 'google_calendar:';

export const googleCalendarAdminCallbackPrefixes = {
  open: `${callbackPrefix}open`,
  select: `${callbackPrefix}select`,
  selectManual: `${callbackPrefix}select_manual`,
  choose: `${callbackPrefix}choose:`,
  visibility: `${callbackPrefix}visibility`,
  confirmVisibility: `${callbackPrefix}confirm_visibility:`,
  sync: `${callbackPrefix}sync`,
  enableSync: `${callbackPrefix}enable_sync`,
  disableSync: `${callbackPrefix}disable_sync`,
} as const;

type GoogleCalendarAdminContext = TelegramCommandHandlerContext & {
  googleCalendarSettingsStore?: GoogleCalendarSettingsStore;
};

export async function handleTelegramGoogleCalendarAdminText(context: GoogleCalendarAdminContext): Promise<boolean> {
  const text = context.messageText?.trim() ?? '';
  const session = context.runtime.session.current;
  const opensMenu = text === '/google_calendar' || ['Calendar Google', 'Calendari Google', 'Google Calendar'].includes(text);
  if (!text || (!opensMenu && session?.flowKey !== flowKey)) {
    return false;
  }
  if (!isAdmin(context)) {
    await context.reply('Solo los administradores pueden gestionar Google Calendar.');
    return true;
  }
  if (session?.flowKey !== flowKey || session.stepKey !== 'manual-calendar') {
    await sendGoogleCalendarAdminMenu(context);
    return true;
  }
  const calendarId = parseGoogleCalendarIdentifier(text);
  if (!calendarId) {
    await context.reply('Envía el ID del calendario o un enlace de Google Calendar que contenga “cid”.');
    return true;
  }
  await selectCalendar(context, calendarId);
  return true;
}

export async function handleTelegramGoogleCalendarAdminCallback(context: GoogleCalendarAdminContext): Promise<boolean> {
  const data = context.callbackData;
  if (!data || !data.startsWith(callbackPrefix)) return false;
  if (!isAdmin(context)) {
    await context.reply('Solo los administradores pueden gestionar Google Calendar.');
    return true;
  }
  if (data === googleCalendarAdminCallbackPrefixes.open) {
    await sendGoogleCalendarAdminMenu(context);
    return true;
  }
  if (data === googleCalendarAdminCallbackPrefixes.select) {
    await openCalendarSelector(context);
    return true;
  }
  if (data === googleCalendarAdminCallbackPrefixes.selectManual) {
    await context.runtime.session.start({ flowKey, stepKey: 'manual-calendar', data: {} });
    await context.reply('Envía el ID del calendario o su enlace de Google Calendar.');
    return true;
  }
  if (data.startsWith(googleCalendarAdminCallbackPrefixes.choose)) {
    const index = Number(data.slice(googleCalendarAdminCallbackPrefixes.choose.length));
    const session = context.runtime.session.current;
    const calendarIds = Array.isArray(session?.data.calendarIds) ? session.data.calendarIds : [];
    const calendarId = typeof calendarIds[index] === 'string' ? calendarIds[index] : null;
    if (!calendarId) {
      await context.reply('La selección ha caducado. Vuelve a abrir la lista de calendarios.');
      return true;
    }
    await selectCalendar(context, calendarId);
    return true;
  }
  if (data === googleCalendarAdminCallbackPrefixes.visibility) {
    await promptVisibilityChange(context);
    return true;
  }
  if (data.startsWith(googleCalendarAdminCallbackPrefixes.confirmVisibility)) {
    const visibility = data.slice(googleCalendarAdminCallbackPrefixes.confirmVisibility.length) as GoogleCalendarVisibility;
    if (visibility !== 'public' && visibility !== 'private') return false;
    await applyVisibility(context, visibility);
    return true;
  }
  if (data === googleCalendarAdminCallbackPrefixes.sync) {
    await promptSynchronizationChange(context);
    return true;
  }
  if (data === googleCalendarAdminCallbackPrefixes.disableSync) {
    const settings = await store(context).getSettings();
    await store(context).saveSettings({ ...settings, syncEnabled: false });
    await sendGoogleCalendarAdminMenu(context, 'Sincronización automática detenida. Los eventos ya creados en Google Calendar no se borran.');
    return true;
  }
  if (data === googleCalendarAdminCallbackPrefixes.enableSync) {
    await enableSynchronization(context);
    return true;
  }
  return false;
}

export async function sendGoogleCalendarAdminMenu(context: GoogleCalendarAdminContext, notice?: string): Promise<void> {
  const settings = await store(context).getSettings();
  const lines = [
    notice ? `<b>${escapeHtml(notice)}</b>` : null,
    notice ? '' : null,
    '<b>Calendar Google</b>',
    '',
    `Calendario: <b>${escapeHtml(settings.calendarId ?? 'sin seleccionar')}</b>`,
    `Accesibilidad: <b>${settings.visibility === 'public' ? 'público' : 'privado'}</b>`,
    `Sincronización bot → Calendar: <b>${settings.syncEnabled ? 'activa' : 'detenida'}</b>`,
    '',
    'Agenda sigue siendo la fuente de verdad. Las modificaciones hechas directamente en Google Calendar no se importan al bot.',
  ].filter((line): line is string => line !== null);
  await context.reply(lines.join('\n'), { parseMode: 'HTML', inlineKeyboard: menuKeyboard(settings) });
}

async function openCalendarSelector(context: GoogleCalendarAdminContext): Promise<void> {
  const calendars = await client(context).listAccessibleCalendars();
  if (calendars.length === 0) {
    await context.reply('La cuenta de servicio no puede modificar ningún calendario. Comparte el calendario con ella y dale permiso para gestionar el uso compartido.');
    return;
  }
  const limited = calendars.slice(0, 20);
  await context.runtime.session.start({
    flowKey,
    stepKey: 'select-calendar',
    data: { calendarIds: limited.map((calendar) => calendar.id) },
  });
  await context.reply('Selecciona el calendario asociado al bot:', {
    inlineKeyboard: [
      ...limited.map((calendar, index) => [{
        text: truncate(calendar.summary),
        callbackData: `${googleCalendarAdminCallbackPrefixes.choose}${index}`,
        semanticRole: 'secondary' as const,
      }]),
      [{ text: 'Introducir ID o enlace', callbackData: googleCalendarAdminCallbackPrefixes.selectManual, semanticRole: 'primary' as const }],
    ],
  });
}

async function selectCalendar(context: GoogleCalendarAdminContext, calendarId: string): Promise<void> {
  const selected = await client(context).getCalendar(calendarId);
  const current = await store(context).getSettings();
  await store(context).saveSettings({
    ...current,
    calendarId: selected.id,
    calendarUrl: buildGoogleCalendarUrl(selected.id),
    syncEnabled: false,
  });
  await context.runtime.session.cancel();
  await sendGoogleCalendarAdminMenu(context, `Calendario seleccionado: ${selected.summary}. La sincronización queda detenida hasta que la inicies.`);
}

async function promptVisibilityChange(context: GoogleCalendarAdminContext): Promise<void> {
  const settings = await requireCalendar(context);
  if (!settings) return;
  const next = settings.visibility === 'private' ? 'public' : 'private';
  const impact = next === 'public'
    ? 'Cualquier persona podrá ver los detalles de este calendario en Google Calendar.'
    : 'Se eliminará el acceso público al calendario. Los accesos individuales o de grupo no se modificarán.';
  await context.reply(`${impact}\n\n¿Confirmas cambiarlo a ${next === 'public' ? 'público' : 'privado'}?`, {
    inlineKeyboard: [[
      { text: 'Confirmar', callbackData: `${googleCalendarAdminCallbackPrefixes.confirmVisibility}${next}`, semanticRole: next === 'public' ? 'danger' : 'success' },
      { text: 'Cancelar', callbackData: googleCalendarAdminCallbackPrefixes.open, semanticRole: 'navigation' },
    ]],
  });
}

async function applyVisibility(context: GoogleCalendarAdminContext, visibility: GoogleCalendarVisibility): Promise<void> {
  const settings = await requireCalendar(context);
  if (!settings?.calendarId) return;
  await client(context).setVisibility(settings.calendarId, visibility);
  await store(context).saveSettings({ ...settings, visibility });
  await sendGoogleCalendarAdminMenu(context, `Accesibilidad cambiada a ${visibility === 'public' ? 'público' : 'privado'}.`);
}

async function promptSynchronizationChange(context: GoogleCalendarAdminContext): Promise<void> {
  const settings = await requireCalendar(context);
  if (!settings) return;
  if (settings.syncEnabled) {
    await context.reply('¿Quieres detener la sincronización automática? Los eventos ya creados no se eliminarán.', {
      inlineKeyboard: [[
        { text: 'Detener sincronización', callbackData: googleCalendarAdminCallbackPrefixes.disableSync, semanticRole: 'danger' },
        { text: 'Cancelar', callbackData: googleCalendarAdminCallbackPrefixes.open, semanticRole: 'navigation' },
      ]],
    });
    return;
  }
  await context.reply('Al iniciarla se sincronizarán todas las actividades futuras y los cambios posteriores se enviarán automáticamente.', {
    inlineKeyboard: [[
      { text: 'Iniciar sincronización', callbackData: googleCalendarAdminCallbackPrefixes.enableSync, semanticRole: 'success' },
      { text: 'Cancelar', callbackData: googleCalendarAdminCallbackPrefixes.open, semanticRole: 'navigation' },
    ]],
  });
}

async function enableSynchronization(context: GoogleCalendarAdminContext): Promise<void> {
  const settings = await requireCalendar(context);
  if (!settings?.calendarId) return;
  const progress = await startTelegramEditableProgress(context, 'Comprobando el calendario Google…', {
    editFailedEvent: 'google-calendar.admin.progress-edit.failed',
  });
  try {
    const googleClient = client(context);
    await googleClient.setVisibility(settings.calendarId, settings.visibility);
    await progress.update('Sincronizando las actividades futuras…');
    const events = await listScheduleEvents({
      repository: createDatabaseScheduleRepository({ database: context.runtime.services.database.db }),
      includeCancelled: false,
      startsAtFrom: new Date().toISOString(),
    });
    await synchronizeScheduleEventsToCalendar({ events, calendarId: settings.calendarId, config: context.runtime.googleCalendar });
    await store(context).saveSettings({ ...settings, syncEnabled: true });
    await progress.complete(`Sincronización automática iniciada. Se han sincronizado ${events.length} actividades futuras.`);
  } catch (error) {
    await progress.complete(`No se pudo iniciar la sincronización: ${escapeHtml(safeError(error))}. La sincronización sigue detenida.`);
  }
}

async function requireCalendar(context: GoogleCalendarAdminContext): Promise<GoogleCalendarSettings | null> {
  const settings = await store(context).getSettings();
  if (settings.calendarId) return settings;
  await context.reply('Primero selecciona el calendario de Google que quieres asociar al bot.');
  return null;
}

function client(context: GoogleCalendarAdminContext) {
  return createGoogleCalendarClient({ config: context.runtime.googleCalendar });
}

function store(context: GoogleCalendarAdminContext): GoogleCalendarSettingsStore {
  return context.googleCalendarSettingsStore ?? createAppMetadataGoogleCalendarSettingsStore({
    storage: createDatabaseAppMetadataSessionStorage({ database: context.runtime.services.database.db }),
  });
}

function isAdmin(context: GoogleCalendarAdminContext): boolean {
  return context.runtime.chat.kind === 'private' && context.runtime.actor.isAdmin && !context.runtime.actor.isBlocked;
}

function menuKeyboard(settings: GoogleCalendarSettings): TelegramInlineButton[][] {
  return [
    [{ text: 'Seleccionar calendario', callbackData: googleCalendarAdminCallbackPrefixes.select, semanticRole: 'primary' }],
    [{ text: `Accesibilidad: ${settings.visibility === 'public' ? 'público' : 'privado'}`, callbackData: googleCalendarAdminCallbackPrefixes.visibility, semanticRole: 'secondary' }],
    [{ text: settings.syncEnabled ? 'Detener sincronización' : 'Iniciar sincronización', callbackData: googleCalendarAdminCallbackPrefixes.sync, semanticRole: settings.syncEnabled ? 'danger' : 'success' }],
    [{ text: 'Actualizar estado', callbackData: googleCalendarAdminCallbackPrefixes.open, semanticRole: 'navigation' }],
  ];
}

function truncate(value: string): string {
  return value.length > 56 ? `${value.slice(0, 53)}...` : value;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(?:private_key|token|secret)\S*/gi, '<oculto>').slice(0, 300);
}
