import { formatCalendarMessage, loadUpcomingCalendarEntries } from './calendar-summary.js';
import { escapeHtml, formatDayHeading, formatTimestamp } from './schedule-presentation.js';
import { detectScheduleConflicts, getScheduleEventEndsAt, type ScheduleEventRecord, type ScheduleRepository } from '../schedule/schedule-catalog.js';
import type { ClubTableRepository } from '../tables/table-catalog.js';
import type { VenueEventRepository } from '../venue-events/venue-event-catalog.js';
import type { NewsGroupRepository } from '../news/news-group-catalog.js';
import { eventsNewsGroupCategory } from '../news/news-group-catalog.js';
import type { AppMetadataSessionStorage } from './conversation-session-store.js';
import type { TelegramSentMessage } from './runtime-boundary.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';

export interface ScheduleCalendarChange {
  action: 'created' | 'updated' | 'deleted';
  event: ScheduleEventRecord;
}

export async function notifyScheduleConflicts({
  eventId,
  actorTelegramUserId,
  scheduleRepository,
  loadEvent,
  sendPrivateMessage,
  botLanguage,
}: {
  eventId: number;
  actorTelegramUserId: number;
  scheduleRepository: ScheduleRepository;
  loadEvent: (eventId: number) => Promise<ScheduleEventRecord>;
  sendPrivateMessage: (telegramUserId: number, message: string) => Promise<void>;
  botLanguage?: string;
}): Promise<void> {
  const conflicts = await detectScheduleConflicts({
    repository: scheduleRepository,
    eventId,
    actorTelegramUserId,
  });

  if (conflicts.overlappingEventIds.length === 0) {
    return;
  }

  const subjectEvent = await loadEvent(eventId);
  const overlappingEvents = await Promise.all(conflicts.overlappingEventIds.map((id) => loadEvent(id)));
  const overlapSummary = overlappingEvents
    .map((event) => `${event.title} (${formatTimestamp(event.startsAt)} - ${formatTimestamp(getScheduleEventEndsAt(event))})`)
    .join('\n- ');
  const texts = createTelegramI18n(normalizeBotLanguage(botLanguage, 'ca')).schedule;

  await Promise.all(
    conflicts.impactedTelegramUserIds.map((telegramUserId) =>
      sendPrivateMessage(
        telegramUserId,
        [
          texts.conflictDetected,
          formatScheduleText(texts.conflictSubject, {
            title: subjectEvent.title,
            startsAt: formatTimestamp(subjectEvent.startsAt),
            endsAt: formatTimestamp(getScheduleEventEndsAt(subjectEvent)),
          }),
          formatScheduleText(texts.conflictAffected, { summary: overlapSummary }),
          texts.conflictUnblocked,
        ].join('\n'),
      ),
    ),
  );
}

export async function publishCalendarSnapshotToNewsGroups({
  change,
  sendGroupMessage,
  deleteMessage,
  editMessageText,
  snapshotStorage,
  newsGroupRepository,
  database,
  botLanguage,
  scheduleRepository,
  venueEventRepository,
  tableRepository,
  resolveActorDisplayName,
}: {
  change: ScheduleCalendarChange;
  sendGroupMessage?: (chatId: number, message: string, options?: { parseMode?: 'HTML'; messageThreadId?: number }) => Promise<TelegramSentMessage | void>;
  deleteMessage?: (input: { chatId: number; messageId: number }) => Promise<void>;
  editMessageText?: (input: { chatId: number; messageId: number; text: string; options?: { parseMode?: 'HTML' } }) => Promise<void>;
  snapshotStorage?: AppMetadataSessionStorage;
  newsGroupRepository: NewsGroupRepository;
  database: unknown;
  botLanguage?: string;
  scheduleRepository?: ScheduleRepository;
  venueEventRepository?: VenueEventRepository;
  tableRepository?: ClubTableRepository;
  resolveActorDisplayName: () => Promise<string>;
}): Promise<void> {
  if (!sendGroupMessage) {
    return;
  }

  const groups = await newsGroupRepository.listSubscribedGroupsByCategory(eventsNewsGroupCategory);
  if (groups.length === 0) {
    return;
  }
  const language = normalizeBotLanguage(botLanguage, 'ca');
  const texts = createTelegramI18n(language).schedule;

  const entries = await loadUpcomingCalendarEntries({
    database,
    ...(scheduleRepository ? { scheduleRepository } : {}),
    ...(venueEventRepository ? { venueEventRepository } : {}),
    ...(tableRepository ? { tableRepository } : {}),
  });
  const message = entries.length > 0
    ? `${texts.calendarBroadcastTitle}\n${formatCalendarMessage(entries, language)}`
    : texts.calendarBroadcastEmpty;
  const footer = await formatCalendarBroadcastFooter({
    change,
    language,
    resolveActorDisplayName,
  });
  const replacedText = texts.calendarBroadcastReplaced;

  await Promise.all(
    groups.map(async (group) => {
      const text = `${message}\n\n${footer}`;
      try {
        const sent = await sendGroupMessage(group.chatId, text, {
          parseMode: 'HTML',
          ...(group.messageThreadId ? { messageThreadId: group.messageThreadId } : {}),
        });
        await rememberAndDeletePreviousCalendarSnapshot({
          chatId: group.chatId,
          messageThreadId: group.messageThreadId,
          sent,
          replacedText,
          ...(deleteMessage ? { deleteMessage } : {}),
          ...(editMessageText ? { editMessageText } : {}),
          ...(snapshotStorage ? { snapshotStorage } : {}),
        });
      } catch (error) {
        console.warn(JSON.stringify({
          event: 'schedule.calendar-broadcast.group-send.failed',
          chatId: group.chatId,
          messageThreadId: group.messageThreadId,
          error: error instanceof Error ? error.message : String(error),
        }));
        // La notificació de grup no ha de bloquejar l'edició de l'activitat.
      }
    }),
  );
}

async function rememberAndDeletePreviousCalendarSnapshot({
  chatId,
  messageThreadId,
  sent,
  replacedText,
  deleteMessage,
  editMessageText,
  snapshotStorage,
}: {
  chatId: number;
  messageThreadId: number | null;
  sent: TelegramSentMessage | void;
  replacedText: string;
  deleteMessage?: (input: { chatId: number; messageId: number }) => Promise<void>;
  editMessageText?: (input: { chatId: number; messageId: number; text: string; options?: { parseMode?: 'HTML' } }) => Promise<void>;
  snapshotStorage?: AppMetadataSessionStorage;
}): Promise<void> {
  if (!snapshotStorage || !sent?.messageId) {
    return;
  }

  const key = buildCalendarSnapshotMessageKey(chatId, messageThreadId);
  const previous = parseCalendarSnapshotMessage(await snapshotStorage.get(key));

  await snapshotStorage.set(key, JSON.stringify({
    chatId,
    messageThreadId: messageThreadId ?? null,
    messageId: sent.messageId,
  }));

  if (!deleteMessage || !previous || previous.messageId === sent.messageId) {
    return;
  }

  try {
    await deleteMessage({ chatId: previous.chatId, messageId: previous.messageId });
  } catch (error) {
    const deleteError = error instanceof Error ? error.message : String(error);
    console.warn(JSON.stringify({
      event: 'schedule.calendar-broadcast.previous-delete.failed',
      chatId: previous.chatId,
      messageThreadId: previous.messageThreadId,
      messageId: previous.messageId,
      error: deleteError,
    }));

    if (!editMessageText) {
      return;
    }

    try {
      await editMessageText({
        chatId: previous.chatId,
        messageId: previous.messageId,
        text: replacedText,
        options: { parseMode: 'HTML' },
      });
    } catch (editError) {
      console.warn(JSON.stringify({
        event: 'schedule.calendar-broadcast.previous-replace.failed',
        chatId: previous.chatId,
        messageThreadId: previous.messageThreadId,
        messageId: previous.messageId,
        error: editError instanceof Error ? editError.message : String(editError),
        deleteError,
      }));
    }
  }
}

function buildCalendarSnapshotMessageKey(chatId: number, messageThreadId: number | null): string {
  return `telegram.schedule.calendar_snapshot:${chatId}:${messageThreadId ?? 0}`;
}

function parseCalendarSnapshotMessage(raw: string | null): { chatId: number; messageThreadId: number | null; messageId: number } | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const chatId = parsed.chatId;
    const messageId = parsed.messageId;
    const messageThreadId = parsed.messageThreadId;
    if (typeof chatId !== 'number' || typeof messageId !== 'number') {
      return null;
    }
    return {
      chatId,
      messageId,
      messageThreadId: typeof messageThreadId === 'number' ? messageThreadId : null,
    };
  } catch {
    return null;
  }
}

async function formatCalendarBroadcastFooter({
  change,
  language,
  resolveActorDisplayName,
}: {
  change: ScheduleCalendarChange;
  language: string;
  resolveActorDisplayName: () => Promise<string>;
}): Promise<string> {
  const userName = await resolveActorDisplayName();
  const texts = createTelegramI18n(normalizeBotLanguage(language, 'ca')).schedule;
  const actionLabel = change.action === 'created'
    ? texts.calendarBroadcastActionCreated
    : change.action === 'updated'
      ? texts.calendarBroadcastActionUpdated
      : texts.calendarBroadcastActionDeleted;

  return `<i>${escapeHtml(formatScheduleText(texts.calendarBroadcastFooter, {
    actor: userName,
    action: actionLabel,
    title: change.event.title,
    day: formatDayHeading(change.event.startsAt.slice(0, 10), language),
  }))}</i>`;
}

function formatScheduleText(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replaceAll(`{${key}}`, value),
    template,
  );
}
