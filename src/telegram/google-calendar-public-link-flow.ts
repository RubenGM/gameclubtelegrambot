import { createAppMetadataGoogleCalendarSettingsStore } from '../google-calendar/google-calendar-settings.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import { createDatabaseAppMetadataSessionStorage } from './conversation-session-store.js';

export async function handleTelegramGoogleCalendarPublicLinkTrigger(context: TelegramCommandHandlerContext): Promise<boolean> {
  if (context.runtime.chat.kind === 'private' || !matchesCalendarTrigger(context.messageText, context.runtime.bot.username)) return false;
  const settings = await resolveStore(context).getSettings();
  const message = settings.calendarUrl
    ? `Si quieres estar al día del calendario de actividades del club únete al Google Calendar: ${settings.calendarUrl}`
    : 'El Google Calendar del club todavía no está configurado.';
  await context.reply(message, context.messageThreadId && context.messageThreadId > 0 ? { messageThreadId: context.messageThreadId } : undefined);
  if (!context.messageId || !context.runtime.bot.deleteMessage) return true;
  try {
    await context.runtime.bot.deleteMessage({ chatId: context.runtime.chat.chatId, messageId: context.messageId });
  } catch (error) {
    context.runtime.logger?.warn?.({ error: error instanceof Error ? error.message : String(error), chatId: context.runtime.chat.chatId, messageId: context.messageId }, 'telegram.google-calendar.trigger-delete.failed');
  }
  return true;
}

function resolveStore(context: TelegramCommandHandlerContext & { googleCalendarSettingsStore?: ReturnType<typeof createAppMetadataGoogleCalendarSettingsStore> }) {
  return context.googleCalendarSettingsStore ?? createAppMetadataGoogleCalendarSettingsStore({
    storage: createDatabaseAppMetadataSessionStorage({ database: context.runtime.services.database.db }),
  });
}

function matchesCalendarTrigger(text: string | undefined, username: string | undefined): boolean {
  if (!text || !username?.trim()) return false;
  const escaped = username.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^@${escaped}\\s+calendar\\s*$`, 'i').test(text.trim());
}
