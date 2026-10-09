import { formatCalendarMessage, loadUpcomingCalendarEntries } from './calendar-summary.js';
import { escapeHtml, formatDayHeading, formatTimestamp } from './schedule-presentation.js';
import { detectScheduleConflicts, getScheduleEventEndsAt, type ScheduleEventRecord, type ScheduleRepository } from '../schedule/schedule-catalog.js';
import type { ClubTableRepository } from '../tables/table-catalog.js';
import type { VenueEventRepository } from '../venue-events/venue-event-catalog.js';
import type { NewsGroupRepository } from '../news/news-group-catalog.js';
import { eventsNewsGroupCategory, publicEventsNewsGroupCategory } from '../news/news-group-catalog.js';
import type { AppMetadataSessionStorage } from './conversation-session-store.js';
import type { TelegramSentMessage } from './runtime-boundary.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import { buildTelegramStartUrl } from './deep-links.js';
import { buildGoogleCalendarEmbedUrl } from '../google-calendar/google-calendar-client.js';
import { createAppMetadataGoogleCalendarSettingsStore } from '../google-calendar/google-calendar-settings.js';
import type { TelegramRichMessageTransport } from './rich-message-transport.js';
import { buildCalendarRichMessage } from './calendar-rich-message.js';
import { splitTelegramOutgoingMessage } from './outgoing-message-sanitizer.js';

export interface ScheduleCalendarChange {
  action: 'created' | 'updated' | 'deleted';
  event: ScheduleEventRecord;
  previousEvent?: ScheduleEventRecord;
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

export interface PublishCalendarSnapshotInput {
  change: ScheduleCalendarChange;
  sendGroupMessage?: (chatId: number, message: string, options?: { parseMode?: 'HTML'; messageThreadId?: number }) => Promise<TelegramSentMessage | void>;
  sendRichMessage?: TelegramRichMessageTransport['sendRichMessage'];
  editRichMessage?: TelegramRichMessageTransport['editRichMessage'];
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
  now?: Date;
}

export type RefreshCalendarSnapshotsInput = Omit<PublishCalendarSnapshotInput, 'change' | 'resolveActorDisplayName'>;

/** Refresh subscribed snapshots from current data without inventing an activity change. */
export async function refreshCalendarSnapshotsToNewsGroups(input: RefreshCalendarSnapshotsInput): Promise<void> {
  await publishCalendarSnapshotForCategory({ ...input, categoryKey: eventsNewsGroupCategory, refreshExisting: true });
  await publishCalendarSnapshotForCategory({ ...input, categoryKey: publicEventsNewsGroupCategory, publicOnly: true, refreshExisting: true });
}

export async function publishCalendarSnapshotToNewsGroups(input: PublishCalendarSnapshotInput): Promise<void> {
  return publishCalendarSnapshotForCategory({
    ...input,
    categoryKey: eventsNewsGroupCategory,
  });
}

export async function publishPublicCalendarSnapshotToNewsGroups(input: PublishCalendarSnapshotInput): Promise<void> {
  return publishCalendarSnapshotForCategory({
    ...input,
    categoryKey: publicEventsNewsGroupCategory,
    publicOnly: true,
  });
}

async function publishCalendarSnapshotForCategory({
  change,
  sendGroupMessage,
  sendRichMessage,
  editRichMessage,
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
  categoryKey,
  publicOnly = false,
  now = new Date(),
  refreshExisting = false,
}: RefreshCalendarSnapshotsInput & {
  change?: ScheduleCalendarChange;
  resolveActorDisplayName?: () => Promise<string>;
  categoryKey: string;
  publicOnly?: boolean;
  refreshExisting?: boolean;
}): Promise<void> {
  if (!sendGroupMessage && !sendRichMessage) {
    return;
  }
  if (publicOnly && change && !change.event.isPublic && !change.previousEvent?.isPublic) return;

  const startsAtTo = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const withinHorizon = (event: ScheduleEventRecord) => new Date(event.startsAt).getTime() <= new Date(startsAtTo).getTime();
  // Moving an already visible activity out of the window must still refresh the feed.
  if (change && !withinHorizon(change.event) && !(change.previousEvent && withinHorizon(change.previousEvent))) {
    return;
  }

  const groups = await newsGroupRepository.listSubscribedGroupsByCategory(categoryKey);
  if (groups.length === 0) {
    return;
  }
  const language = normalizeBotLanguage(botLanguage, 'ca');
  const texts = createTelegramI18n(language).schedule;

  const entries = await loadUpcomingCalendarEntries({
    database,
    now,
    startsAtTo,
    ...(scheduleRepository ? { scheduleRepository } : {}),
    ...(venueEventRepository ? { venueEventRepository } : {}),
    ...(tableRepository ? { tableRepository } : {}),
    publicOnly,
  });
  const message = entries.length > 0
    ? `${publicOnly ? texts.publicCalendarBroadcastTitle : texts.calendarBroadcastTitle}\n${formatCalendarMessage(entries, language)}`
    : publicOnly
      ? texts.publicCalendarBroadcastEmpty
      : texts.calendarBroadcastEmpty;
  const footer = change && resolveActorDisplayName && (!publicOnly || change.event.isPublic)
    ? await formatCalendarBroadcastFooter({ change, language, resolveActorDisplayName })
    : '';
  const createAction = publicOnly
    ? ''
    : `\n\n<a href="${escapeHtml(buildTelegramStartUrl('schedule_create'))}"><b>${escapeHtml(texts.calendarBroadcastCreateAction)}</b></a>`;
  const googleCalendarAction = publicOnly
    ? ''
    : await buildGoogleCalendarBroadcastAction({ snapshotStorage, label: texts.calendarBroadcastGoogleCalendarAction });
  const replacedText = texts.calendarBroadcastReplaced;
  const text = `${message}${footer ? `\n\n${footer}` : ''}${createAction}${googleCalendarAction}`;
  const richMessage = buildCalendarRichMessage({
    entries,
    language,
    title: publicOnly ? texts.publicCalendarBroadcastTitle : texts.calendarBroadcastTitle,
    emptyText: publicOnly ? texts.publicCalendarBroadcastEmpty : texts.calendarBroadcastEmpty,
    footerHtml: footer,
    actionsHtml: [createAction, googleCalendarAction].filter(Boolean).map((action) => `<p>${action.trim()}</p>`).join(''),
    now,
    startsAtTo,
  });

  await Promise.all(
    groups.map(async (group) => {
      try {
        const options = {
          parseMode: 'HTML',
          ...(group.messageThreadId ? { messageThreadId: group.messageThreadId } : {}),
        } as const;
        // Normal activity changes keep a new notification and retire the previous snapshot.
        // Explicit format refreshes may edit the stored snapshot instead.
        if (refreshExisting && editRichMessage && snapshotStorage && splitTelegramOutgoingMessage(text, 'HTML').length === 1) {
          const previous = await loadPreviousCalendarSnapshot(snapshotStorage, categoryKey, group.chatId, group.messageThreadId);
          if (previous && (previous.messageIds?.length ?? 1) === 1) {
            let edited = true;
            try {
              await editRichMessage({ chatId: group.chatId, messageId: previous.messageId, richMessage, fallbackText: text, options });
            } catch (error) {
              if (!/message is not modified/i.test(error instanceof Error ? error.message : String(error))) {
                console.warn(JSON.stringify({ event: 'schedule.calendar-broadcast.current-edit.failed', chatId: group.chatId, messageThreadId: group.messageThreadId, messageId: previous.messageId, error: error instanceof Error ? error.message : String(error) }));
                if (!/message to edit not found|message (?:can'?t|cannot) be edited/i.test(error instanceof Error ? error.message : String(error))) throw error;
                edited = false;
              }
            }
            if (edited) {
              await rememberAndDeletePreviousCalendarSnapshot({ chatId: group.chatId, messageThreadId: group.messageThreadId, sent: { messageId: previous.messageId }, replacedText, categoryKey, snapshotStorage });
              return;
            }
          }
        }
        const sent = sendRichMessage
          ? await sendRichMessage({ chatId: group.chatId, richMessage, fallbackText: text, options })
          : await sendGroupMessage!(group.chatId, text, options);
        await rememberAndDeletePreviousCalendarSnapshot({
          chatId: group.chatId,
          messageThreadId: group.messageThreadId,
          sent,
          replacedText,
          ...(deleteMessage ? { deleteMessage } : {}),
          ...(editMessageText ? { editMessageText } : {}),
          ...(snapshotStorage ? { snapshotStorage } : {}),
          categoryKey,
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

async function buildGoogleCalendarBroadcastAction({
  snapshotStorage,
  label,
}: {
  snapshotStorage: AppMetadataSessionStorage | undefined;
  label: string;
}): Promise<string> {
  if (!snapshotStorage) return '';
  try {
    const settings = await createAppMetadataGoogleCalendarSettingsStore({ storage: snapshotStorage }).getSettings();
    if (!settings.calendarId) return '';
    return `\n\n<a href="${escapeHtml(buildGoogleCalendarEmbedUrl(settings.calendarId))}"><b>${escapeHtml(label)}</b></a>`;
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'schedule.calendar-broadcast.google-calendar-link.failed',
      error: error instanceof Error ? error.message : String(error),
    }));
    return '';
  }
}

async function rememberAndDeletePreviousCalendarSnapshot({
  chatId,
  messageThreadId,
  sent,
  replacedText,
  categoryKey,
  deleteMessage,
  editMessageText,
  snapshotStorage,
}: {
  chatId: number;
  messageThreadId: number | null;
  sent: TelegramSentMessage | void;
  replacedText: string;
  categoryKey: string;
  deleteMessage?: (input: { chatId: number; messageId: number }) => Promise<void>;
  editMessageText?: (input: { chatId: number; messageId: number; text: string; options?: { parseMode?: 'HTML' } }) => Promise<void>;
  snapshotStorage?: AppMetadataSessionStorage;
}): Promise<void> {
  if (!snapshotStorage || !sent?.messageId) {
    return;
  }

  const key = buildCalendarSnapshotMessageKey(categoryKey, chatId, messageThreadId);
  const previous = await loadPreviousCalendarSnapshot(snapshotStorage, categoryKey, chatId, messageThreadId);

  await snapshotStorage.set(key, JSON.stringify({
    chatId,
    messageThreadId: messageThreadId ?? null,
    messageId: sent.messageId,
    ...(sent.messageIds && sent.messageIds.length > 1 ? { messageIds: sent.messageIds } : {}),
  }));

  if (!deleteMessage || !previous || previous.messageId === sent.messageId) {
    return;
  }

  for (const previousMessageId of previous.messageIds ?? [previous.messageId]) {
    try {
      await deleteMessage({ chatId: previous.chatId, messageId: previousMessageId });
    } catch (error) {
      const deleteError = error instanceof Error ? error.message : String(error);
      console.warn(JSON.stringify({
        event: 'schedule.calendar-broadcast.previous-delete.failed',
        chatId: previous.chatId,
        messageThreadId: previous.messageThreadId,
        messageId: previousMessageId,
        error: deleteError,
      }));

      if (!editMessageText) {
        continue;
      }

      try {
        await editMessageText({
          chatId: previous.chatId,
          messageId: previousMessageId,
          text: replacedText,
          options: { parseMode: 'HTML' },
        });
      } catch (editError) {
        console.warn(JSON.stringify({
          event: 'schedule.calendar-broadcast.previous-replace.failed',
          chatId: previous.chatId,
          messageThreadId: previous.messageThreadId,
          messageId: previousMessageId,
          error: editError instanceof Error ? editError.message : String(editError),
          deleteError,
        }));
      }
    }
  }
}

async function loadPreviousCalendarSnapshot(storage: AppMetadataSessionStorage, categoryKey: string, chatId: number, messageThreadId: number | null) {
  const previous = parseCalendarSnapshotMessage(await storage.get(buildCalendarSnapshotMessageKey(categoryKey, chatId, messageThreadId)))
    ?? (categoryKey === eventsNewsGroupCategory ? parseCalendarSnapshotMessage(await storage.get(buildLegacyCalendarSnapshotMessageKey(chatId, messageThreadId))) : null);
  return previous?.chatId === chatId && (previous.messageThreadId ?? 0) === (messageThreadId ?? 0) ? previous : null;
}

function buildCalendarSnapshotMessageKey(categoryKey: string, chatId: number, messageThreadId: number | null): string {
  return `telegram.schedule.calendar_snapshot:${categoryKey}:${chatId}:${messageThreadId ?? 0}`;
}

function buildLegacyCalendarSnapshotMessageKey(chatId: number, messageThreadId: number | null): string {
  return `telegram.schedule.calendar_snapshot:${chatId}:${messageThreadId ?? 0}`;
}

function parseCalendarSnapshotMessage(raw: string | null): { chatId: number; messageThreadId: number | null; messageId: number; messageIds?: number[] } | null {
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
      ...(Array.isArray(parsed.messageIds) ? { messageIds: [...new Set([...parsed.messageIds.filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0), messageId])] } : {}),
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
