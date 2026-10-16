import { createAppMetadataScheduleCleaningSettingsStore, type ScheduleCleaningSettingsStore } from '../schedule/schedule-cleaning-settings.js';
import { createDatabaseAppMetadataSessionStorage } from './conversation-session-store.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import { createTelegramI18n, normalizeBotLanguage, type BotLanguage } from './i18n.js';
import type { ScheduleCleaningSettings } from '../schedule/schedule-catalog.js';

export const scheduleCleaningAdminFlowKey = 'schedule-cleaning-admin';
export const scheduleCleaningAdminCallbackPrefix = 'schedule_cleaning:';
const days = {
  ca: ['diumenge', 'dilluns', 'dimarts', 'dimecres', 'dijous', 'divendres', 'dissabte'],
  es: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};

type Context = TelegramCommandHandlerContext & { scheduleCleaningSettingsStore?: ScheduleCleaningSettingsStore };

export async function handleTelegramScheduleCleaningAdminText(context: Context): Promise<boolean> {
  const text = context.messageText?.trim();
  const session = context.runtime.session.current;
  const label = createTelegramI18n(resolveLanguage(context)).actionMenu.scheduleCleaning;
  if (!text || (session?.flowKey !== scheduleCleaningAdminFlowKey && text !== label)) return false;
  if (!canManage(context)) { await context.reply(createTelegramI18n(resolveLanguage(context)).common.accessDeniedAdmin); return true; }
  if (session?.flowKey === scheduleCleaningAdminFlowKey) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) { await context.reply(texts[resolveLanguage(context)].invalidTime); return true; }
    const settings = await resolveStore(context).get();
    const next = { ...settings, [session.stepKey === 'start' ? 'startsAt' : 'endsAt']: text };
    if (next.startsAt >= next.endsAt) { await context.reply(texts[resolveLanguage(context)].invalidRange); return true; }
    await resolveStore(context).set(next);
    await context.runtime.session.cancel();
    await sendMenu(context, next, texts[resolveLanguage(context)].saved);
    return true;
  }
  await sendMenu(context, await resolveStore(context).get());
  return true;
}

export async function handleTelegramScheduleCleaningAdminCallback(context: Context): Promise<boolean> {
  const data = context.callbackData;
  if (!data?.startsWith(scheduleCleaningAdminCallbackPrefix)) return false;
  if (!canManage(context)) { await context.reply(createTelegramI18n(resolveLanguage(context)).common.accessDeniedAdmin); return true; }
  const action = data.slice(scheduleCleaningAdminCallbackPrefix.length);
  const store = resolveStore(context);
  let settings = await store.get();
  if (action.startsWith('day:')) {
    const weekday = Number(action.slice(4));
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return false;
    settings = { ...settings, weekday };
    await store.set(settings);
    await sendMenu(context, settings, texts[resolveLanguage(context)].saved);
    return true;
  }
  if (action === 'start' || action === 'end') {
    await context.runtime.session.start({ flowKey: scheduleCleaningAdminFlowKey, stepKey: action, data: {} });
    await context.reply(action === 'start' ? texts[resolveLanguage(context)].askStart : texts[resolveLanguage(context)].askEnd);
    return true;
  }
  if (action === 'open') { await sendMenu(context, settings); return true; }
  return false;
}

async function sendMenu(context: Context, settings: ScheduleCleaningSettings, confirmation?: string): Promise<void> {
  const language = resolveLanguage(context);
  const t = texts[language];
  await context.reply([
    confirmation,
    `<b>${t.title}</b>`,
    `${t.day}: <b>${days[language][settings.weekday]}</b>`,
    `${t.hours}: <b>${settings.startsAt}–${settings.endsAt}</b>`,
    t.note,
  ].filter(Boolean).join('\n'), {
    parseMode: 'HTML',
    inlineKeyboard: [
      days[language].slice(1, 6).map((day, index) => ({ text: day, callbackData: `${scheduleCleaningAdminCallbackPrefix}day:${index + 1}` })),
      [{ text: days[language][0]!, callbackData: `${scheduleCleaningAdminCallbackPrefix}day:0` }, { text: days[language][6]!, callbackData: `${scheduleCleaningAdminCallbackPrefix}day:6` }],
      [{ text: t.startButton, callbackData: `${scheduleCleaningAdminCallbackPrefix}start` }, { text: t.endButton, callbackData: `${scheduleCleaningAdminCallbackPrefix}end` }],
      [{ text: t.refresh, callbackData: `${scheduleCleaningAdminCallbackPrefix}open` }],
    ],
  });
}

function resolveStore(context: Context): ScheduleCleaningSettingsStore {
  return context.scheduleCleaningSettingsStore ?? createAppMetadataScheduleCleaningSettingsStore({ storage: createDatabaseAppMetadataSessionStorage({ database: context.runtime.services.database.db }) });
}
function resolveLanguage(context: Context): BotLanguage { return normalizeBotLanguage(context.runtime.bot.language, 'ca'); }
function canManage(context: Context): boolean { return context.runtime.chat.kind === 'private' && context.runtime.actor.isAdmin && !context.runtime.actor.isBlocked; }

const texts = {
  ca: { title: 'Neteja del club', day: 'Dia', hours: 'Horari', note: 'Les reserves que coincideixin amb aquesta franja es rebutjaran. Horari local del club (Europe/Madrid).', startButton: 'Canviar inici', endButton: 'Canviar final', refresh: 'Actualitzar', askStart: 'Escriu l’hora d’inici en format HH:MM.', askEnd: 'Escriu l’hora de final en format HH:MM.', invalidTime: 'Escriu una hora vàlida en format HH:MM (00:00–23:59).', invalidRange: 'L’hora de final ha de ser posterior a la d’inici.', saved: 'Configuració de neteja desada.' },
  es: { title: 'Limpieza del club', day: 'Día', hours: 'Horario', note: 'Las reservas que coincidan con esta franja se rechazarán. Horario local del club (Europe/Madrid).', startButton: 'Cambiar inicio', endButton: 'Cambiar final', refresh: 'Actualizar', askStart: 'Escribe la hora de inicio en formato HH:MM.', askEnd: 'Escribe la hora de fin en formato HH:MM.', invalidTime: 'Escribe una hora válida en formato HH:MM (00:00–23:59).', invalidRange: 'La hora de fin debe ser posterior a la de inicio.', saved: 'Configuración de limpieza guardada.' },
  en: { title: 'Club cleaning', day: 'Day', hours: 'Hours', note: 'Bookings overlapping this time will be rejected. Club local time (Europe/Madrid).', startButton: 'Change start', endButton: 'Change end', refresh: 'Refresh', askStart: 'Enter the start time as HH:MM.', askEnd: 'Enter the end time as HH:MM.', invalidTime: 'Enter a valid HH:MM time (00:00–23:59).', invalidRange: 'The end time must be later than the start time.', saved: 'Cleaning settings saved.' },
} as const;
