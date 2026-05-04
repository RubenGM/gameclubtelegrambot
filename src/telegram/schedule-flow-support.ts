import { appendAuditEvent, type AuditLogRepository } from '../audit/audit-log.js';
import { createDatabaseAuditLogRepository } from '../audit/audit-log-store.js';
import { createDatabaseMembershipAccessRepository } from '../membership/access-flow-store.js';
import { createDatabaseNewsGroupRepository } from '../news/news-group-store.js';
import { buildTelegramStartUrl } from './deep-links.js';
import {
  cancelScheduleEvent,
  createScheduleEvent,
  getScheduleEventAttendance,
  getScheduleEventEndsAt,
  joinScheduleEvent,
  leaveScheduleEvent,
  listScheduleEvents,
  updateScheduleEvent,
  type ScheduleEventRecord,
  type ScheduleRepository,
} from '../schedule/schedule-catalog.js';
import {
  getScheduleTableCapacityAdvisories,
  listSchedulableTables,
  requireSchedulableTableSelection,
  resolveScheduleTableReference,
} from '../schedule/schedule-table-selection.js';
import { createDatabaseScheduleRepository } from '../schedule/schedule-catalog-store.js';
import type { ClubTableRecord, ClubTableRepository } from '../tables/table-catalog.js';
import { createDatabaseClubTableRepository } from '../tables/table-catalog-store.js';
import type { MembershipAccessRepository, MembershipUserRecord } from '../membership/access-flow.js';
import {
  findRelevantVenueEventsForRange,
  type VenueEventRecord,
  type VenueEventRepository,
} from '../venue-events/venue-event-catalog.js';
import { createDatabaseVenueEventRepository } from '../venue-events/venue-event-catalog-store.js';
import type { TelegramActor } from './actor-store.js';
import type { AuthorizationService } from '../authorization/service.js';
import type { TelegramChatContext } from './chat-context.js';
import type { ConversationSessionRuntime } from './conversation-session.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import type { NewsGroupRepository } from '../news/news-group-catalog.js';
import { formatMembershipDisplayName } from '../membership/display-name.js';
import {
  buildScheduleDayButtons,
  buildScheduleDetailActionOptions,
  escapeHtml,
  formatDayHeading,
  formatEventTime,
  formatHtmlField,
  formatParticipantCount,
  formatScheduleEventDetails,
  formatScheduleListMessage,
  formatTimestamp,
  groupScheduleEventsByDay,
  sortScheduleEvents,
} from './schedule-presentation.js';
import {
  asNullableNumber,
  asNullableString,
  buildTimeFromHourAndMinute,
  buildStartsAt,
  formatLocalDateInput,
  formatLocalTimeInput,
  parseCapacity,
  parseDate,
  parseDurationHours,
  parseDurationHoursMinutes,
  parseDayKey,
  parseEntityId,
  parseInitialOccupiedSeats,
  parseOptionalDurationMinutes,
  parseScheduleStartPayload,
  parseTableSelection,
  parseTime,
  parseTimeHour,
  parseTimeMinuteSelection,
} from './schedule-parsing.js';
import { formatScheduleDraftSummary } from './schedule-draft-summary.js';
import { formatScheduleListWithVenueImpact } from './schedule-list-impact.js';
import { notifyScheduleConflicts, publishCalendarSnapshotToNewsGroups } from './schedule-notifications.js';
import {
  buildAttendanceModeOptions,
  buildCancelConfirmOptions,
  buildCreateConfirmOptions,
  buildCreateDurationOptions,
  buildDateOptions,
  buildDescriptionOptions,
  buildEditConfirmOptions,
  buildEditDateOptions,
  buildEditDescriptionOptions,
  buildEditDurationOptions,
  buildEditFieldMenuOptionsForEvent,
  buildEditInitialOccupiedSeatsOptions,
  buildEditTableOptions,
  buildEditTimeMinuteOptions,
  buildInitialOccupiedSeatsOptions,
  buildKeepCurrentKeyboard,
  buildReminderPreferenceOptions,
  buildScheduleMenuOptions,
  buildSingleBackCancelKeyboard,
  buildSingleCancelKeyboard,
  buildTableSelectionOptions,
  buildTimeMinuteOptions,
  scheduleLabels,
} from './schedule-keyboards.js';

const createFlowKey = 'schedule-create';
const editFlowKey = 'schedule-edit';
const cancelFlowKey = 'schedule-cancel';
const joinReminderFlowKey = 'schedule-join-reminder';
const scheduleStartPayloadPrefix = 'schedule_event_';

export const scheduleCallbackPrefixes = {
  inspect: 'schedule:inspect:',
  join: 'schedule:join:',
  leave: 'schedule:leave:',
  day: 'schedule:day:',
  selectEdit: 'schedule:select_edit:',
  selectCancel: 'schedule:select_cancel:',
  tableSelection: 'schedule:table:',
} as const;

const defaultScheduleDurationMinutes = 180;

function getUtcDayStartIso(date = new Date()): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

function parseAttendanceModeSelection(
  text: string,
  texts: ReturnType<typeof createTelegramI18n>['schedule'],
): 'open' | 'closed' | null {
  if (text === texts.attendanceOpen || text === scheduleLabels.attendanceOpen) {
    return 'open';
  }
  if (text === texts.attendanceClosed || text === scheduleLabels.attendanceClosed) {
    return 'closed';
  }

  return null;
}

export interface TelegramScheduleContext {
  messageText?: string | undefined;
  callbackData?: string | undefined;
  reply(message: string, options?: TelegramReplyOptions): Promise<unknown>;
  runtime: {
    actor: TelegramActor;
    authorization: AuthorizationService;
    session: ConversationSessionRuntime;
    chat: TelegramChatContext;
    services: {
      database: {
        db: unknown;
      };
    };
    bot: {
      publicName: string;
      clubName: string;
      language?: string;
      sendPrivateMessage(telegramUserId: number, message: string): Promise<void>;
      sendGroupMessage?(chatId: number, message: string, options?: TelegramReplyOptions): Promise<void>;
    };
  };
  scheduleRepository?: ScheduleRepository;
  tableRepository?: ClubTableRepository;
  venueEventRepository?: VenueEventRepository;
  auditRepository?: AuditLogRepository;
  membershipRepository?: MembershipAccessRepository;
  newsGroupRepository?: NewsGroupRepository;
}

export async function handleTelegramScheduleText(context: TelegramScheduleContext): Promise<boolean> {
  const text = context.messageText?.trim();
  if (!text || context.runtime.chat.kind !== 'private' || !context.runtime.actor.isApproved) {
    return false;
  }

  if (isScheduleSession(context.runtime.session.current?.flowKey)) {
    return handleActiveScheduleSession(context, text);
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const i18n = createTelegramI18n(language);
  const texts = i18n.schedule;

  if (text === i18n.actionMenu.schedule || text === scheduleLabels.openMenu || text === '/schedule') {
    return replyWithInspectableEventList(context, { includeMenuKeyboard: true });
  }

  if (text === texts.create || text === scheduleLabels.create || text === '/schedule_create') {
    await context.runtime.session.start({ flowKey: createFlowKey, stepKey: 'title', data: {} });
    await context.reply(texts.askTitle, buildSingleBackCancelKeyboard(language));
    return true;
  }

  if (text === texts.list || text === scheduleLabels.list || text === '/schedule_list') {
    return replyWithInspectableEventList(context);
  }

  if (text === texts.edit || text === scheduleLabels.edit || text === '/schedule_edit') {
    return replyWithManageableEventList(context, 'edit');
  }

  if (text === texts.cancel || text === scheduleLabels.cancel || text === '/schedule_cancel') {
    return replyWithManageableEventList(context, 'cancel');
  }

  return false;
}

export async function handleTelegramScheduleStartText(context: TelegramScheduleContext): Promise<boolean> {
  const eventId = parseScheduleStartPayload(context.messageText, scheduleStartPayloadPrefix);
  if (eventId === null || context.runtime.chat.kind !== 'private' || !context.runtime.actor.isApproved) {
    return false;
  }

  const event = await loadEventOrThrow(context, eventId);
  await context.reply(await formatScheduleEventView(context, event), {
    ...buildScheduleDetailActionOptions({
      actor: context.runtime.actor,
      event,
      isAttending: await isActorAttending(context, event.id),
      language: normalizeBotLanguage(context.runtime.bot.language, 'ca'),
      callbackPrefixes: scheduleCallbackPrefixes,
    }),
    parseMode: 'HTML',
  });
  return true;
}

export async function handleTelegramScheduleCallback(context: TelegramScheduleContext): Promise<boolean> {
  const callbackData = context.callbackData;
  if (!callbackData || context.runtime.chat.kind !== 'private' || !context.runtime.actor.isApproved) {
    return false;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).schedule;

  if (callbackData.startsWith(scheduleCallbackPrefixes.inspect)) {
    const eventId = parseEntityId(callbackData, scheduleCallbackPrefixes.inspect, 'activitat');
    const event = await loadEventOrThrow(context, eventId);
    await context.reply(await formatScheduleEventView(context, event), {
      ...buildScheduleDetailActionOptions({
        actor: context.runtime.actor,
        event,
        isAttending: await isActorAttending(context, event.id),
        language: normalizeBotLanguage(context.runtime.bot.language, 'ca'),
        callbackPrefixes: scheduleCallbackPrefixes,
      }),
      parseMode: 'HTML',
    });
    return true;
  }

  if (callbackData.startsWith(scheduleCallbackPrefixes.join)) {
    const eventId = parseEntityId(callbackData, scheduleCallbackPrefixes.join, 'activitat');
    const event = await loadEventOrThrow(context, eventId);
    await joinScheduleEvent({
      repository: resolveScheduleRepository(context),
      eventId,
      participantTelegramUserId: context.runtime.actor.telegramUserId,
      actorTelegramUserId: context.runtime.actor.telegramUserId,
    });
    await context.runtime.session.start({
      flowKey: joinReminderFlowKey,
      stepKey: 'select',
      data: { eventId },
    });
    await context.reply(
      `T'has apuntat correctament a <b>${escapeHtml(event.title)}</b>\n${await formatScheduleEventView(context, await loadEventOrThrow(context, eventId))}\n\n${texts.askReminderPreference}`,
      {
        ...buildReminderPreferenceOptions(language),
        parseMode: 'HTML',
      },
    );
    return true;
  }

  if (callbackData.startsWith(scheduleCallbackPrefixes.leave)) {
    const eventId = parseEntityId(callbackData, scheduleCallbackPrefixes.leave, 'activitat');
    const event = await loadEventOrThrow(context, eventId);
    await leaveScheduleEvent({
      repository: resolveScheduleRepository(context),
      eventId,
      participantTelegramUserId: context.runtime.actor.telegramUserId,
      actorTelegramUserId: context.runtime.actor.telegramUserId,
    });
    await context.reply(
      `Has sortit correctament de <b>${escapeHtml(event.title)}</b>\n${await formatScheduleEventView(context, await loadEventOrThrow(context, eventId))}`,
      {
        ...buildScheduleDetailActionOptions({
          actor: context.runtime.actor,
          event,
          isAttending: false,
          language: normalizeBotLanguage(context.runtime.bot.language, 'ca'),
          callbackPrefixes: scheduleCallbackPrefixes,
        }),
        parseMode: 'HTML',
      },
    );
    return true;
  }

  if (callbackData.startsWith(scheduleCallbackPrefixes.day)) {
    const dayKey = parseDayKey(callbackData, scheduleCallbackPrefixes.day);
    await replyWithInspectableEventList(context, { dayKey });
    return true;
  }

  if (callbackData.startsWith(scheduleCallbackPrefixes.selectEdit)) {
    const eventId = parseEntityId(callbackData, scheduleCallbackPrefixes.selectEdit, 'activitat');
    const event = await loadEventOrThrow(context, eventId);
    if (!canManageEvent(context.runtime.actor, context.runtime.authorization, event)) {
      await context.reply(createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca')).schedule.noEditOthers);
      return true;
    }

    await context.runtime.session.start({
      flowKey: editFlowKey,
      stepKey: 'select-field',
      data: { eventId },
    });
    await context.reply(
      `${formatScheduleEventDetails({ event, tableName: await loadTableName(context, event.tableId), language })}\n\n${texts.selectFieldPrompt}`,
      { ...buildEditFieldMenuOptionsForEvent({ hasInitialOccupiedSeats: event.attendanceMode === 'open', language }), parseMode: 'HTML' },
    );
    return true;
  }

  if (callbackData.startsWith(scheduleCallbackPrefixes.selectCancel)) {
    const eventId = parseEntityId(callbackData, scheduleCallbackPrefixes.selectCancel, 'activitat');
    const event = await loadEventOrThrow(context, eventId);
    if (!canManageEvent(context.runtime.actor, context.runtime.authorization, event)) {
      await context.reply(createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca')).schedule.noCancelOthers);
      return true;
    }

    await context.runtime.session.start({
      flowKey: cancelFlowKey,
      stepKey: 'confirm',
      data: { eventId },
    });
    await context.reply(
      `${formatScheduleEventDetails({ event, tableName: await loadTableName(context, event.tableId), language })}\n\n${texts.confirmCancelPrompt}`,
      { ...buildCancelConfirmOptions(language), parseMode: 'HTML' },
    );
    return true;
  }

  if (callbackData.startsWith(scheduleCallbackPrefixes.tableSelection)) {
    return handleTableSelectionCallback(context, callbackData);
  }

  return false;
}

function isScheduleSession(flowKey: string | undefined): boolean {
  return flowKey === createFlowKey || flowKey === editFlowKey || flowKey === cancelFlowKey || flowKey === joinReminderFlowKey;
}

async function handleActiveScheduleSession(context: TelegramScheduleContext, text: string): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session) {
    return false;
  }

  if (session.flowKey === createFlowKey) {
    return handleCreateSession(context, text, session.stepKey, session.data);
  }
  if (session.flowKey === editFlowKey) {
    return handleEditSession(context, text, session.stepKey, session.data);
  }
  if (session.flowKey === cancelFlowKey) {
    return handleCancelSession(context, text, session.data);
  }
  if (session.flowKey === joinReminderFlowKey) {
    return handleJoinReminderSession(context, text, session.stepKey, session.data);
  }

  return false;
}

async function handleCreateSession(
  context: TelegramScheduleContext,
  text: string,
  stepKey: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).schedule;
  if (text === texts.back) {
    return handleCreateSessionBack(context, stepKey, data, language);
  }

  if (stepKey === 'title') {
    await context.runtime.session.advance({ stepKey: 'date', data: { title: text } });
    await context.reply(texts.askDate, buildDateOptions(resolveBotLanguage(context)));
    return true;
  }

  if (stepKey === 'description') {
    await replyCreateConfirm(context, {
      ...data,
      description: text === texts.skipOptional || text === scheduleLabels.skipOptional ? null : text,
    });
    return true;
  }

  if (stepKey === 'date') {
    const date = parseDate(text);
    if (date instanceof Error) {
      await context.reply(texts.invalidDate, buildDateOptions(resolveBotLanguage(context)));
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'time', data: { ...data, date } });
    await context.reply(texts.askTime, buildSingleBackCancelKeyboard(language));
    return true;
  }

  if (stepKey === 'time') {
    const time = parseTime(text);
    if (!(time instanceof Error)) {
      await context.runtime.session.advance({ stepKey: 'duration-mode', data: { ...data, time } });
      await context.reply(texts.askDuration, buildCreateDurationOptions(language));
      return true;
    }
    const timeHour = parseTimeHour(text);
    if (timeHour instanceof Error) {
      await context.reply(texts.invalidTime, buildSingleBackCancelKeyboard(language));
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'time-minute', data: { ...data, timeHour } });
    await context.reply(texts.askTime, buildTimeMinuteOptions(language));
    return true;
  }

  if (stepKey === 'time-minute') {
    const timeHour = typeof data.timeHour === 'string' ? data.timeHour : null;
    if (timeHour === null) {
      await context.runtime.session.advance({ stepKey: 'time', data });
      await context.reply(texts.askTime, buildSingleBackCancelKeyboard(language));
      return true;
    }
    const minuteSelection = parseTimeMinuteSelection(text);
    if (minuteSelection instanceof Error) {
      await context.reply(texts.invalidTime, buildTimeMinuteOptions(language));
      return true;
    }
    const time = buildTimeFromHourAndMinute(timeHour, minuteSelection);
    await context.runtime.session.advance({ stepKey: 'duration-mode', data: { ...data, time } });
    await context.reply(texts.askDuration, buildCreateDurationOptions(language));
    return true;
  }

  if (stepKey === 'duration-mode') {
    if (text === texts.durationNone || text === scheduleLabels.durationNone) {
      await context.runtime.session.advance({ stepKey: 'attendance-mode', data: { ...data, durationMinutes: 120 } });
      await context.reply(texts.askAttendanceMode, buildAttendanceModeOptions(language));
      return true;
    }
    if (text === texts.durationHours || text === scheduleLabels.durationHours) {
      await context.runtime.session.advance({ stepKey: 'duration-hours', data });
      await context.reply(texts.askDurationHours, buildSingleBackCancelKeyboard(language));
      return true;
    }
    if (text === texts.durationHoursMinutes || text === scheduleLabels.durationHoursMinutes) {
      await context.runtime.session.advance({ stepKey: 'duration-hours-minutes', data });
      await context.reply(texts.askDurationHoursMinutes, buildSingleBackCancelKeyboard(language));
      return true;
    }
    if (text === texts.durationMinutes || text === scheduleLabels.durationMinutes) {
      await context.runtime.session.advance({ stepKey: 'duration', data });
      await context.reply(texts.askDurationMinutes, buildSingleBackCancelKeyboard(language));
      return true;
    }
    await context.reply(texts.askDuration, buildCreateDurationOptions(language));
    return true;
  }

  if (stepKey === 'duration-hours') {
    const durationMinutes = parseDurationHours(text);
    if (durationMinutes instanceof Error) {
      await context.reply(texts.invalidDurationHours, buildSingleBackCancelKeyboard(language));
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'attendance-mode', data: { ...data, durationMinutes } });
    await context.reply(texts.askAttendanceMode, buildAttendanceModeOptions(language));
    return true;
  }

  if (stepKey === 'duration-hours-minutes') {
    const durationMinutes = parseDurationHoursMinutes(text);
    if (durationMinutes instanceof Error) {
      await context.reply(texts.invalidDurationHoursMinutes, buildSingleBackCancelKeyboard(language));
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'attendance-mode', data: { ...data, durationMinutes } });
    await context.reply(texts.askAttendanceMode, buildAttendanceModeOptions(language));
    return true;
  }

  if (stepKey === 'duration') {
    const durationMinutes = parseOptionalDurationMinutes({
      value: text,
      language,
      skipOptionalLabels: [scheduleLabels.skipOptional],
      defaultDurationMinutes: defaultScheduleDurationMinutes,
    });
    if (durationMinutes instanceof Error) {
      await context.reply(texts.invalidDurationMinutes, buildSingleBackCancelKeyboard(language));
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'attendance-mode', data: { ...data, durationMinutes } });
    await context.reply(texts.askAttendanceMode, buildAttendanceModeOptions(language));
    return true;
  }

  if (stepKey === 'attendance-mode') {
    const attendanceMode = parseAttendanceModeSelection(text, texts);
    if (attendanceMode === null) {
      await context.reply(texts.invalidAttendanceMode, buildAttendanceModeOptions(language));
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'capacity', data: { ...data, attendanceMode } });
    await context.reply(texts.askCapacity, buildSingleBackCancelKeyboard(language));
    return true;
  }

  if (stepKey === 'capacity') {
    const capacity = parseCapacity(text);
    if (capacity instanceof Error) {
      await context.reply(texts.invalidCapacity, buildSingleBackCancelKeyboard(language));
      return true;
    }
    const attendanceMode = data.attendanceMode;
    if (attendanceMode !== 'open' && attendanceMode !== 'closed') {
      await context.runtime.session.advance({ stepKey: 'attendance-mode', data });
      await context.reply(texts.askAttendanceMode, buildAttendanceModeOptions(language));
      return true;
    }
    const nextData = { ...data, capacity };
    if (attendanceMode === 'open') {
      await context.runtime.session.advance({ stepKey: 'initial-occupied-seats', data: nextData });
      await context.reply(texts.askInitialOccupiedSeats, buildInitialOccupiedSeatsOptions(language));
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'table', data: { ...nextData, initialOccupiedSeats: 0 } });
    await context.reply(texts.askTable, buildTableSelectionOptions({ tableNames: await listSchedulableTableNames(context), language }));
    return true;
  }

  if (stepKey === 'initial-occupied-seats') {
    const initialOccupiedSeats = parseInitialOccupiedSeats(text);
    if (initialOccupiedSeats instanceof Error) {
      await context.reply(texts.invalidInitialOccupiedSeats, buildInitialOccupiedSeatsOptions(language));
      return true;
    }
    const capacity = typeof data.capacity === 'number' ? data.capacity : Number(data.capacity);
    if (!Number.isInteger(capacity) || capacity <= 0) {
      await context.runtime.session.advance({ stepKey: 'capacity', data });
      await context.reply(texts.askCapacity, buildSingleBackCancelKeyboard(language));
      return true;
    }
    if (initialOccupiedSeats > capacity) {
      await context.reply(texts.invalidInitialOccupiedSeatsRange, buildInitialOccupiedSeatsOptions(language));
      return true;
    }
    const nextData = { ...data, initialOccupiedSeats };
    await context.runtime.session.advance({ stepKey: 'table', data: nextData });
    await context.reply(texts.askTable, buildTableSelectionOptions({ tableNames: await listSchedulableTableNames(context), language }));
    return true;
  }

  if (stepKey === 'table') {
    return advanceCreateTableSelection(context, data, text);
  }

  if (stepKey === 'confirm') {
    if (text === texts.editFieldDescription || text === scheduleLabels.editFieldDescription) {
      await context.runtime.session.advance({ stepKey: 'description', data });
      await context.reply(texts.askDescription, buildDescriptionOptions(language));
      return true;
    }
    if (text !== texts.confirmCreate && text !== scheduleLabels.confirmCreate) {
      await context.reply(texts.confirmCreatePrompt, buildCreateConfirmOptions(language));
      return true;
    }
    try {
      await requireSchedulableTableSelection({
        repository: resolveTableRepository(context),
        tableId: asNullableNumber(data.tableId),
      });
    } catch {
      await context.runtime.session.advance({ stepKey: 'table', data });
      await context.reply(texts.inactiveTableCreate, buildTableSelectionOptions({ tableNames: await listSchedulableTableNames(context), language }));
      return true;
    }
    const created = await createScheduleEvent({
      repository: resolveScheduleRepository(context),
      title: String(data.title ?? ''),
      description: asNullableString(data.description),
      startsAt: buildStartsAt(String(data.date ?? ''), String(data.time ?? '')),
      durationMinutes: Number(data.durationMinutes),
      organizerTelegramUserId: context.runtime.actor.telegramUserId,
      createdByTelegramUserId: context.runtime.actor.telegramUserId,
      tableId: asNullableNumber(data.tableId),
      attendanceMode: String(data.attendanceMode) === 'closed' ? 'closed' : 'open',
      initialOccupiedSeats: Number(data.initialOccupiedSeats ?? 0),
      capacity: Number(data.capacity),
    });
    await appendAuditEvent({
      repository: resolveAuditRepository(context),
      actorTelegramUserId: context.runtime.actor.telegramUserId,
      actionKey: 'schedule.created',
      targetType: 'schedule-event',
      targetId: created.id,
      summary: `Activitat creada: ${created.title}`,
      details: {
        startsAt: created.startsAt,
        capacity: created.capacity,
        tableId: created.tableId,
      },
    });
    await context.runtime.session.cancel();
    await context.reply(
      `${texts.created.replace('.', '')}: <b>${escapeHtml(created.title)}</b>\n${await formatScheduleEventView(context, created)}`,
      { ...buildScheduleMenuOptions(language), parseMode: 'HTML' },
    );
    await notifyScheduleConflicts({
      eventId: created.id,
      actorTelegramUserId: context.runtime.actor.telegramUserId,
      scheduleRepository: resolveScheduleRepository(context),
      loadEvent: async (eventId) => loadEventOrThrow(context, eventId),
      sendPrivateMessage: async (telegramUserId, message) => context.runtime.bot.sendPrivateMessage(telegramUserId, message),
    });
    await publishCalendarSnapshotToNewsGroups({
      change: {
        action: 'created',
        event: created,
      },
      ...buildCalendarBroadcastDependencies(context),
    });
    return true;
  }

  return false;
}

async function handleJoinReminderSession(
  context: TelegramScheduleContext,
  text: string,
  stepKey: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).schedule;
  const eventId = Number(data.eventId);
  if (!Number.isInteger(eventId)) {
    await context.runtime.session.cancel();
    return false;
  }

  if (stepKey === 'custom') {
    const reminderLeadHours = Number(text);
    if (!Number.isInteger(reminderLeadHours) || reminderLeadHours < 1 || reminderLeadHours > 168) {
      await context.reply(texts.invalidCustomReminderHours, buildSingleCancelKeyboard());
      return true;
    }
    return saveJoinReminderPreference(context, eventId, reminderLeadHours, `${reminderLeadHours}h abans`);
  }

  if (text === texts.reminder2h || text === scheduleLabels.reminder2h) {
    return saveJoinReminderPreference(context, eventId, 2, texts.reminder2h);
  }
  if (text === texts.reminder24h || text === scheduleLabels.reminder24h) {
    return saveJoinReminderPreference(context, eventId, 24, texts.reminder24h);
  }
  if (text === texts.reminderNone || text === scheduleLabels.reminderNone) {
    return saveJoinReminderPreference(context, eventId, null, texts.reminderNone);
  }
  if (text === texts.reminderCustom || text === scheduleLabels.reminderCustom) {
    await context.runtime.session.advance({ stepKey: 'custom', data });
    await context.reply(texts.askCustomReminderHours, buildSingleCancelKeyboard());
    return true;
  }

  await context.reply(texts.askReminderPreference, buildReminderPreferenceOptions(language));
  return true;
}

async function saveJoinReminderPreference(
  context: TelegramScheduleContext,
  eventId: number,
  reminderLeadHours: number | null,
  label: string,
): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).schedule;
  await resolveScheduleRepository(context).upsertParticipant({
    eventId,
    participantTelegramUserId: context.runtime.actor.telegramUserId,
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    status: 'active',
    reminderLeadHours,
    reminderPreferenceConfigured: true,
  });
  await context.runtime.session.cancel();
  await context.reply(texts.reminderConfigured.replace('{label}', label), buildScheduleMenuOptions(language));
  return true;
}

async function handleCreateSessionBack(
  context: TelegramScheduleContext,
  stepKey: string,
  data: Record<string, unknown>,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const texts = createTelegramI18n(language).schedule;
  const descriptionPatch = data.description === undefined ? {} : { description: data.description };

  if (stepKey === 'title') {
    await context.runtime.session.cancel();
    await context.reply(texts.selectMenu, buildScheduleMenuOptions(language));
    return true;
  }

  if (stepKey === 'description') {
    await replyCreateConfirm(context, data);
    return true;
  }

  if (stepKey === 'date') {
    await context.runtime.session.advance({ stepKey: 'title', data: {} });
    await context.reply(texts.askTitle, buildSingleBackCancelKeyboard(language));
    return true;
  }

  if (stepKey === 'time') {
    await context.runtime.session.advance({ stepKey: 'date', data: { ...data, time: undefined } });
    await context.reply(texts.askDate, buildDateOptions(resolveBotLanguage(context)));
    return true;
  }

  if (stepKey === 'time-minute') {
    await context.runtime.session.advance({
      stepKey: 'time',
      data: { title: data.title, ...descriptionPatch, date: data.date },
    });
    await context.reply(texts.askTime, buildSingleBackCancelKeyboard(language));
    return true;
  }

  if (stepKey === 'duration-mode') {
    await context.runtime.session.advance({
      stepKey: 'time',
      data: { title: data.title, ...descriptionPatch, date: data.date },
    });
    await context.reply(texts.askTime, buildSingleBackCancelKeyboard(language));
    return true;
  }

  if (stepKey === 'duration-hours' || stepKey === 'duration-hours-minutes' || stepKey === 'duration') {
    await context.runtime.session.advance({
      stepKey: 'duration-mode',
      data: { title: data.title, ...descriptionPatch, date: data.date, time: data.time },
    });
    await context.reply(texts.askDuration, buildCreateDurationOptions(language));
    return true;
  }

  if (stepKey === 'attendance-mode') {
    await context.runtime.session.advance({
      stepKey: 'duration-mode',
      data: { title: data.title, ...descriptionPatch, date: data.date, time: data.time },
    });
    await context.reply(texts.askDuration, buildCreateDurationOptions(language));
    return true;
  }

  if (stepKey === 'capacity') {
    await context.runtime.session.advance({
      stepKey: 'attendance-mode',
      data: {
        title: data.title,
        ...descriptionPatch,
        date: data.date,
        time: data.time,
        durationMinutes: data.durationMinutes,
      },
    });
    await context.reply(texts.askAttendanceMode, buildAttendanceModeOptions(language));
    return true;
  }

  if (stepKey === 'initial-occupied-seats') {
    await context.runtime.session.advance({
      stepKey: 'capacity',
      data: {
        title: data.title,
        ...descriptionPatch,
        date: data.date,
        time: data.time,
        durationMinutes: data.durationMinutes,
        attendanceMode: data.attendanceMode,
      },
    });
    await context.reply(texts.askCapacity, buildSingleBackCancelKeyboard(language));
    return true;
  }

  if (stepKey === 'table') {
    if (data.attendanceMode === 'open') {
      await context.runtime.session.advance({
        stepKey: 'initial-occupied-seats',
        data: {
          title: data.title,
          ...descriptionPatch,
          date: data.date,
          time: data.time,
          durationMinutes: data.durationMinutes,
          attendanceMode: data.attendanceMode,
          capacity: data.capacity,
        },
      });
      await context.reply(texts.askInitialOccupiedSeats, buildInitialOccupiedSeatsOptions(language));
      return true;
    }

    await context.runtime.session.advance({
      stepKey: 'capacity',
      data: {
        title: data.title,
        ...descriptionPatch,
        date: data.date,
        time: data.time,
        durationMinutes: data.durationMinutes,
        attendanceMode: data.attendanceMode,
      },
    });
    await context.reply(texts.askCapacity, buildSingleBackCancelKeyboard(language));
    return true;
  }

  if (stepKey === 'confirm') {
    await context.runtime.session.advance({
      stepKey: 'table',
      data: {
        title: data.title,
        ...descriptionPatch,
        date: data.date,
        time: data.time,
        durationMinutes: data.durationMinutes,
        attendanceMode: data.attendanceMode,
        capacity: data.capacity,
        initialOccupiedSeats: data.initialOccupiedSeats,
      },
    });
    await context.reply(texts.askTable, buildTableSelectionOptions({ tableNames: await listSchedulableTableNames(context), language }));
    return true;
  }

  return true;
}

async function handleEditSession(
  context: TelegramScheduleContext,
  text: string,
  stepKey: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).schedule;
  const event = await loadEventOrThrow(context, Number(data.eventId));
    if (stepKey === 'select-field') {
      if (text === texts.confirmEdit || text === scheduleLabels.confirmEdit) {
        await persistEditedScheduleEvent(context, event, data);
        return true;
      }
    if (text === texts.editFieldTitle || text === scheduleLabels.editFieldTitle) {
      await context.runtime.session.advance({ stepKey: 'title', data });
      await context.reply(texts.askEditTitle, buildSingleCancelKeyboard());
      return true;
    }
    if (text === texts.editFieldDescription || text === scheduleLabels.editFieldDescription) {
      await context.runtime.session.advance({ stepKey: 'description', data });
      await context.reply(texts.askEditDescription, buildEditDescriptionOptions(language));
      return true;
    }
    if (text === texts.editFieldDate || text === scheduleLabels.editFieldDate) {
      await context.runtime.session.advance({ stepKey: 'date', data });
      await context.reply(texts.askEditDate, buildEditDateOptions(resolveBotLanguage(context), language));
      return true;
    }
    if (text === texts.editFieldTime || text === scheduleLabels.editFieldTime) {
      await context.runtime.session.advance({ stepKey: 'time', data });
      await context.reply(texts.askEditTime, buildKeepCurrentKeyboard(language));
      return true;
    }
    if (text === texts.editFieldDuration || text === scheduleLabels.editFieldDuration) {
      await context.runtime.session.advance({ stepKey: 'duration-mode', data });
      await context.reply(texts.askEditDuration, buildEditDurationOptions(language));
      return true;
    }
    if (text === texts.editFieldCapacity || text === scheduleLabels.editFieldCapacity) {
      await context.runtime.session.advance({ stepKey: 'capacity', data });
      await context.reply(texts.askEditCapacity, buildKeepCurrentKeyboard(language));
      return true;
    }
    if (event.attendanceMode === 'open' && (text === texts.editFieldInitialOccupiedSeats || text === scheduleLabels.editFieldInitialOccupiedSeats)) {
      await context.runtime.session.advance({ stepKey: 'initial-occupied-seats', data });
      await context.reply(texts.askEditInitialOccupiedSeats, buildEditInitialOccupiedSeatsOptions(language));
      return true;
    }
    if (text === texts.editFieldTable || text === scheduleLabels.editFieldTable) {
      await context.runtime.session.advance({ stepKey: 'table', data });
      await context.reply(texts.askEditTable, buildEditTableOptions({ tableNames: await listSchedulableTableNames(context), language }));
      return true;
    }
    await context.reply(texts.selectFieldPrompt, buildEditFieldMenuOptionsForEvent({ hasInitialOccupiedSeats: event.attendanceMode === 'open', language }));
    return true;
  }

  if (stepKey === 'title') {
    const title = text === texts.keepCurrent || text === scheduleLabels.keepCurrent ? event.title : text;
    return returnToEditMenu(context, event, data, { title });
  }
  if (stepKey === 'description') {
    const description = text === texts.keepCurrent || text === scheduleLabels.keepCurrent ? event.description : text === texts.skipOptional || text === scheduleLabels.skipOptional ? null : text;
    return returnToEditMenu(context, event, data, { description, title: data.title ?? event.title });
  }
  if (stepKey === 'date') {
    const currentDate = formatLocalDateInput(event.startsAt);
    const date = text === texts.keepCurrent || text === scheduleLabels.keepCurrent ? currentDate : parseDate(text);
    if (date instanceof Error) {
      await context.reply(texts.invalidDate, buildEditDateOptions(resolveBotLanguage(context), language));
      return true;
    }
    return returnToEditMenu(context, event, data, { date });
  }
  if (stepKey === 'time') {
    const currentTime = formatLocalTimeInput(event.startsAt);
    if (text === texts.keepCurrent || text === scheduleLabels.keepCurrent) {
      return returnToEditMenu(context, event, data, { time: currentTime });
    }
    const time = parseTime(text);
    if (!(time instanceof Error)) {
      return returnToEditMenu(context, event, data, { time });
    }
    const timeHour = parseTimeHour(text);
    if (timeHour instanceof Error) {
      await context.reply(texts.invalidTime, buildKeepCurrentKeyboard(language));
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'time-minute', data: { ...data, timeHour } });
    await context.reply(texts.askEditTime, buildEditTimeMinuteOptions(language));
    return true;
  }
  if (stepKey === 'time-minute') {
    const currentTime = formatLocalTimeInput(event.startsAt);
    if (text === texts.keepCurrent || text === scheduleLabels.keepCurrent) {
      return returnToEditMenu(context, event, data, { time: currentTime });
    }
    const timeHour = typeof data.timeHour === 'string' ? data.timeHour : null;
    if (timeHour === null) {
      await context.runtime.session.advance({ stepKey: 'time', data });
      await context.reply(texts.askEditTime, buildKeepCurrentKeyboard(language));
      return true;
    }
    const minuteSelection = parseTimeMinuteSelection(text);
    if (minuteSelection instanceof Error) {
      await context.reply(texts.invalidTime, buildEditTimeMinuteOptions(language));
      return true;
    }
    const time = buildTimeFromHourAndMinute(timeHour, minuteSelection);
    return returnToEditMenu(context, event, data, { time });
  }
  if (stepKey === 'duration-mode') {
    if (text === texts.keepCurrent || text === scheduleLabels.keepCurrent) {
      return returnToEditMenu(context, event, data, { durationMinutes: event.durationMinutes });
    }
    if (text === texts.durationNone || text === scheduleLabels.durationNone) {
      return returnToEditMenu(context, event, data, { durationMinutes: 120 });
    }
    if (text === texts.durationHours || text === scheduleLabels.durationHours) {
      await context.runtime.session.advance({ stepKey: 'duration-hours', data });
      await context.reply(texts.askEditDurationHours, buildKeepCurrentKeyboard(language));
      return true;
    }
    if (text === texts.durationHoursMinutes || text === scheduleLabels.durationHoursMinutes) {
      await context.runtime.session.advance({ stepKey: 'duration-hours-minutes', data });
      await context.reply(texts.askEditDurationHoursMinutes, buildKeepCurrentKeyboard(language));
      return true;
    }
    if (text === texts.durationMinutes || text === scheduleLabels.durationMinutes) {
      await context.runtime.session.advance({ stepKey: 'duration', data });
      await context.reply(texts.askEditDurationMinutes, buildKeepCurrentKeyboard(language));
      return true;
    }
    await context.reply(texts.askEditDuration, buildEditDurationOptions(language));
    return true;
  }
  if (stepKey === 'duration-hours') {
    if (text === texts.keepCurrent || text === scheduleLabels.keepCurrent) {
      return returnToEditMenu(context, event, data, { durationMinutes: event.durationMinutes });
    }
    const durationMinutes = parseDurationHours(text);
    if (durationMinutes instanceof Error) {
      await context.reply(texts.invalidDurationHours, buildKeepCurrentKeyboard(language));
      return true;
    }
    return returnToEditMenu(context, event, data, { durationMinutes });
  }
  if (stepKey === 'duration-hours-minutes') {
    if (text === texts.keepCurrent || text === scheduleLabels.keepCurrent) {
      return returnToEditMenu(context, event, data, { durationMinutes: event.durationMinutes });
    }
    const durationMinutes = parseDurationHoursMinutes(text);
    if (durationMinutes instanceof Error) {
      await context.reply(texts.invalidDurationHoursMinutes, buildKeepCurrentKeyboard(language));
      return true;
    }
    return returnToEditMenu(context, event, data, { durationMinutes });
  }
  if (stepKey === 'duration') {
    const durationMinutes =
      text === texts.keepCurrent || text === scheduleLabels.keepCurrent
        ? event.durationMinutes
        : parseOptionalDurationMinutes({
            value: text,
            language,
           skipOptionalLabels: [scheduleLabels.skipOptional],
           defaultDurationMinutes: defaultScheduleDurationMinutes,
         });
    if (durationMinutes instanceof Error) {
      await context.reply(texts.invalidDurationMinutes, buildKeepCurrentKeyboard(language));
      return true;
    }
    return returnToEditMenu(context, event, data, { durationMinutes });
  }
  if (stepKey === 'capacity') {
    const capacity = text === texts.keepCurrent || text === scheduleLabels.keepCurrent ? event.capacity : parseCapacity(text);
    if (capacity instanceof Error) {
      await context.reply(texts.invalidCapacity, buildKeepCurrentKeyboard(language));
      return true;
    }
    if (event.attendanceMode === 'open') {
      const initialOccupiedSeats = Number(data.initialOccupiedSeats ?? event.initialOccupiedSeats);
      const attendance = await getScheduleEventAttendance({ repository: resolveScheduleRepository(context), eventId: event.id });
      const activeParticipantCount = attendance.activeParticipantTelegramUserIds.length;
      if (capacity < initialOccupiedSeats + activeParticipantCount) {
        await context.reply(texts.invalidInitialOccupiedSeatsRange, buildKeepCurrentKeyboard(language));
        return true;
      }
    }
    return returnToEditMenu(context, event, data, { capacity });
  }
  if (stepKey === 'initial-occupied-seats') {
    if (text === texts.keepCurrent || text === scheduleLabels.keepCurrent) {
      return returnToEditMenu(context, event, data, { initialOccupiedSeats: event.initialOccupiedSeats });
    }
    const initialOccupiedSeats = parseInitialOccupiedSeats(text);
    if (initialOccupiedSeats instanceof Error) {
      await context.reply(texts.invalidInitialOccupiedSeats, buildEditInitialOccupiedSeatsOptions(language));
      return true;
    }
    const capacity = Number(data.capacity ?? event.capacity);
    const attendance = await getScheduleEventAttendance({ repository: resolveScheduleRepository(context), eventId: event.id });
    const activeParticipantCount = attendance.activeParticipantTelegramUserIds.length;
    if (initialOccupiedSeats > capacity || initialOccupiedSeats > capacity - activeParticipantCount) {
      await context.reply(texts.invalidInitialOccupiedSeatsRange, buildEditInitialOccupiedSeatsOptions(language));
      return true;
    }
    return returnToEditMenu(context, event, data, { initialOccupiedSeats });
  }
  if (stepKey === 'table') {
    if (text === texts.keepCurrent || text === scheduleLabels.keepCurrent) {
      return returnToEditMenu(context, event, data, { tableId: event.tableId });
    }
    return advanceEditTableSelection(context, event, data, text);
  }
  if (stepKey === 'confirm') {
    await persistEditedScheduleEvent(context, event, data);
    return true;
  }

  return false;
}

async function returnToEditMenu(
  context: TelegramScheduleContext,
  event: ScheduleEventRecord,
  data: Record<string, unknown>,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).schedule;
  const nextData = { ...data, ...patch };
  await context.runtime.session.advance({ stepKey: 'select-field', data: nextData });
    await context.reply(
      `${await formatScheduleDraftSummary({
        botLanguage: resolveBotLanguage(context),
        data: nextData,
        eventOrOrganizer: event,
        organizerTelegramUserId: event.organizerTelegramUserId,
        tableRepository: resolveTableRepository(context),
        resolveOrganizerDisplayName: async (telegramUserId) => resolveMemberDisplayName(context, telegramUserId),
      })}\n\n${texts.selectFieldPrompt}`,
      { ...buildEditFieldMenuOptionsForEvent({ hasInitialOccupiedSeats: event.attendanceMode === 'open', language }), parseMode: 'HTML' },
    );
  return true;
}

async function persistEditedScheduleEvent(
  context: TelegramScheduleContext,
  event: ScheduleEventRecord,
  data: Record<string, unknown>,
): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).schedule;
  try {
    await requireSchedulableTableSelection({
      repository: resolveTableRepository(context),
      tableId: asNullableNumber(data.tableId),
    });
  } catch {
    await context.runtime.session.advance({ stepKey: 'table', data });
    await context.reply(texts.inactiveTableEdit, buildEditTableOptions({ tableNames: await listSchedulableTableNames(context), language }));
    return;
  }

  const updated = await updateScheduleEvent({
    repository: resolveScheduleRepository(context),
    eventId: Number(data.eventId),
    title: String(data.title ?? event.title),
    description: Object.prototype.hasOwnProperty.call(data, 'description')
      ? asNullableString(data.description)
      : event.description,
    startsAt: buildStartsAt(String(data.date ?? formatLocalDateInput(event.startsAt)), String(data.time ?? formatLocalTimeInput(event.startsAt))),
    durationMinutes: Number(data.durationMinutes ?? event.durationMinutes),
    organizerTelegramUserId: event.organizerTelegramUserId,
    tableId: asNullableNumber(data.tableId),
    attendanceMode: event.attendanceMode,
    initialOccupiedSeats: Number(data.initialOccupiedSeats ?? event.initialOccupiedSeats),
    capacity: Number(data.capacity ?? event.capacity),
  });
  await appendAuditEvent({
    repository: resolveAuditRepository(context),
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    actionKey: 'schedule.updated',
    targetType: 'schedule-event',
    targetId: updated.id,
    summary: `Activitat actualitzada: ${updated.title}`,
    details: {
      previousStartsAt: event.startsAt,
      startsAt: updated.startsAt,
      previousCapacity: event.capacity,
      capacity: updated.capacity,
      previousTableId: event.tableId,
      tableId: updated.tableId,
    },
  });
  await context.runtime.session.cancel();
  await context.reply(
    `${texts.updated.replace('.', '')}: <b>${escapeHtml(updated.title)}</b>\n${formatScheduleEventDetails({ event: updated, tableName: await loadTableName(context, updated.tableId), language })}`,
    { ...buildScheduleMenuOptions(language), parseMode: 'HTML' },
  );
  await notifyScheduleConflicts({
    eventId: updated.id,
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    scheduleRepository: resolveScheduleRepository(context),
    loadEvent: async (eventId) => loadEventOrThrow(context, eventId),
    sendPrivateMessage: async (telegramUserId, message) => context.runtime.bot.sendPrivateMessage(telegramUserId, message),
  });
    await publishCalendarSnapshotToNewsGroups({
      change: {
        action: 'updated',
        event: updated,
      },
      ...buildCalendarBroadcastDependencies(context),
    });
}

async function handleCancelSession(
  context: TelegramScheduleContext,
  text: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).schedule;
  if (text !== texts.confirmCancel && text !== scheduleLabels.confirmCancel) {
    await context.reply(texts.confirmCancelPrompt, buildCancelConfirmOptions(language));
    return true;
  }
  const cancelled = await cancelScheduleEvent({
    repository: resolveScheduleRepository(context),
    eventId: Number(data.eventId),
    actorTelegramUserId: context.runtime.actor.telegramUserId,
  });
  await appendAuditEvent({
    repository: resolveAuditRepository(context),
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    actionKey: 'schedule.cancelled',
    targetType: 'schedule-event',
    targetId: cancelled.id,
    summary: `Activitat cancel.lada: ${cancelled.title}`,
    details: {
      startsAt: cancelled.startsAt,
      cancelledAt: cancelled.cancelledAt,
      cancellationReason: cancelled.cancellationReason,
    },
  });
  await context.runtime.session.cancel();
  await context.reply(`${texts.cancelled.replace('.', '')}: <b>${escapeHtml(cancelled.title)}</b>`, { ...buildScheduleMenuOptions(language), parseMode: 'HTML' });
    await publishCalendarSnapshotToNewsGroups({
      change: {
        action: 'deleted',
        event: cancelled,
      },
      ...buildCalendarBroadcastDependencies(context),
    });
  return true;
}

async function handleTableSelectionCallback(context: TelegramScheduleContext, callbackData: string): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).schedule;
  const session = context.runtime.session.current;
  if (!session || (session.stepKey !== 'table' && session.stepKey !== 'confirm')) {
    return false;
  }

  const tableId = parseTableSelection(callbackData, scheduleCallbackPrefixes.tableSelection);
  let selectedTable: ClubTableRecord | null;
  try {
    selectedTable = await requireSchedulableTableSelection({
      repository: resolveTableRepository(context),
      tableId,
    });
  } catch {
    await context.reply(texts.inactiveTableCreate, buildTableSelectionOptions({ tableNames: await listSchedulableTableNames(context), language }));
    return true;
  }

  const nextData = { ...session.data, tableId };
  await context.runtime.session.advance({ stepKey: 'confirm', data: nextData });
  const event = session.flowKey === editFlowKey ? await loadEventOrThrow(context, Number(session.data.eventId)) : null;
    await context.reply(
      `${await formatScheduleDraftSummary({
        botLanguage: resolveBotLanguage(context),
        data: nextData,
        selectedTable,
        tableRepository: resolveTableRepository(context),
        resolveOrganizerDisplayName: async (telegramUserId) => resolveMemberDisplayName(context, telegramUserId),
        ...(event ? { eventOrOrganizer: event, organizerTelegramUserId: event.organizerTelegramUserId } : {}),
      })}\n\n${texts.confirmPrompt}`,
      { ...(session.flowKey === editFlowKey ? buildEditConfirmOptions(language) : buildCreateConfirmOptions(language)), parseMode: 'HTML' },
    );
  return true;
}

async function advanceCreateTableSelection(
  context: TelegramScheduleContext,
  data: Record<string, unknown>,
  text: string,
): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).schedule;
  if (text === texts.noTable || text === scheduleLabels.noTable) {
    await replyCreateConfirm(context, { ...data, tableId: null });
    return true;
  }

  const selectedTable = await findSchedulableTableByDisplayName(context, text);
  if (!selectedTable) {
    await context.reply(texts.invalidTableCreate, buildTableSelectionOptions({ tableNames: await listSchedulableTableNames(context), language }));
    return true;
  }

  const nextData = { ...data, tableId: selectedTable.id };
  await replyCreateConfirm(context, nextData, selectedTable);
  return true;
}

async function replyCreateConfirm(
  context: TelegramScheduleContext,
  data: Record<string, unknown>,
  selectedTable?: ClubTableRecord | null,
): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).schedule;
  await context.runtime.session.advance({ stepKey: 'confirm', data });
  await context.reply(
    `${await formatScheduleDraftSummary({
      botLanguage: resolveBotLanguage(context),
      data,
      tableRepository: resolveTableRepository(context),
      resolveOrganizerDisplayName: async (telegramUserId) => resolveMemberDisplayName(context, telegramUserId),
      ...(selectedTable === undefined ? {} : { selectedTable }),
    })}\n\n${texts.confirmPrompt}`,
    { ...buildCreateConfirmOptions(language), parseMode: 'HTML' },
  );
}

async function advanceEditTableSelection(
  context: TelegramScheduleContext,
  event: ScheduleEventRecord,
  data: Record<string, unknown>,
  text: string,
): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).schedule;
  if (text === texts.noTable || text === scheduleLabels.noTable) {
    return returnToEditMenu(context, event, data, { tableId: null });
  }

  const selectedTable = await findSchedulableTableByDisplayName(context, text);
  if (!selectedTable) {
    await context.reply(texts.invalidTableEdit, buildEditTableOptions({ tableNames: await listSchedulableTableNames(context), language }));
    return true;
  }

  return returnToEditMenu(context, event, data, { tableId: selectedTable.id });
}

async function findSchedulableTableByDisplayName(context: TelegramScheduleContext, text: string): Promise<ClubTableRecord | null> {
  const normalizedText = text.trim();
  const tables = await listSchedulableTables({ repository: resolveTableRepository(context) });
  return tables.find((table) => table.displayName === normalizedText) ?? null;
}

async function listSchedulableTableNames(context: TelegramScheduleContext): Promise<string[]> {
  const tables = await listSchedulableTables({ repository: resolveTableRepository(context) });
  return tables.map((table) => table.displayName);
}

async function replyWithManageableEventList(
  context: TelegramScheduleContext,
  mode: 'edit' | 'cancel',
): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).schedule;
  const events = (await loadUpcomingScheduleEvents(context)).filter((event) => canManageEvent(context.runtime.actor, context.runtime.authorization, event));
  if (events.length === 0) {
    await context.reply(mode === 'edit' ? texts.noEditableEvents : texts.noCancellableEvents, buildScheduleMenuOptions(language));
    return true;
  }

  await context.reply(formatScheduleListMessage(events, language), {
    parseMode: 'HTML',
    inlineKeyboard: events.map((event) => [
      {
        text: `${mode === 'edit' ? texts.listEditAction : texts.listCancelAction} ${event.title}`,
        callbackData: `${mode === 'edit' ? scheduleCallbackPrefixes.selectEdit : scheduleCallbackPrefixes.selectCancel}${event.id}`,
      },
    ]),
  });
  return true;
}

function canManageEvent(actor: TelegramActor, authorization: AuthorizationService, event: ScheduleEventRecord): boolean {
  return actor.isAdmin || authorization.can('schedule.manage') || event.organizerTelegramUserId === actor.telegramUserId;
}

function resolveScheduleRepository(context: TelegramScheduleContext): ScheduleRepository {
  if (context.scheduleRepository) {
    return context.scheduleRepository;
  }
  return createDatabaseScheduleRepository({ database: context.runtime.services.database.db as never });
}

function resolveTableRepository(context: TelegramScheduleContext): ClubTableRepository {
  if (context.tableRepository) {
    return context.tableRepository;
  }
  return createDatabaseClubTableRepository({ database: context.runtime.services.database.db as never });
}

function resolveAuditRepository(context: TelegramScheduleContext): AuditLogRepository {
  if (context.auditRepository) {
    return context.auditRepository;
  }
  return createDatabaseAuditLogRepository({ database: context.runtime.services.database.db as never });
}

function resolveMembershipRepository(context: TelegramScheduleContext): MembershipAccessRepository {
  if (context.membershipRepository) {
    return context.membershipRepository;
  }
  return createDatabaseMembershipAccessRepository({ database: context.runtime.services.database.db as never });
}

function resolveNewsGroupRepository(context: TelegramScheduleContext): NewsGroupRepository {
  if (context.newsGroupRepository) {
    return context.newsGroupRepository;
  }
  return createDatabaseNewsGroupRepository({ database: context.runtime.services.database.db as never });
}

async function loadEventOrThrow(context: TelegramScheduleContext, eventId: number): Promise<ScheduleEventRecord> {
  const event = await resolveScheduleRepository(context).findEventById(eventId);
  if (!event) {
    throw new Error(`Schedule event ${eventId} not found`);
  }
  return event;
}

async function loadTableName(context: TelegramScheduleContext, tableId: number | null): Promise<string | null> {
  const table = await resolveScheduleTableReference({
    repository: resolveTableRepository(context),
    tableId,
  });
  return table?.displayName ?? null;
}

async function formatParticipantLabels(context: TelegramScheduleContext, telegramUserIds: number[]): Promise<string[]> {
  const repository = resolveMembershipRepository(context);
  const participants = await Promise.all(
    telegramUserIds.map(async (telegramUserId) => ({
      telegramUserId,
      user: await repository.findUserByTelegramUserId(telegramUserId),
    })),
  );

  return participants.map(({ telegramUserId, user }) => formatParticipantLabel(telegramUserId, user));
}

function formatParticipantLabel(
  telegramUserId: number,
  user: { displayName: string; username?: string | null } | null,
): string {
  if (!user) {
    return `Usuari ${telegramUserId}`;
  }

  if (user.username) {
    return `${user.displayName} (@${user.username})`;
  }

  return user.displayName;
}

async function formatScheduleEventView(
  context: TelegramScheduleContext,
  event: ScheduleEventRecord,
): Promise<string> {
  const texts = createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca')).schedule;
  const attendance = await getScheduleEventAttendance({
    repository: resolveScheduleRepository(context),
    eventId: event.id,
  });

  const relevantVenueEvents = await listRelevantVenueEventsForScheduleEvent(context, event);
  const participantLabels = await formatParticipantLabels(context, attendance.activeParticipantTelegramUserIds);
  const detailLines = [
    formatScheduleEventDetails({ event, tableName: await loadTableName(context, event.tableId) }),
    formatHtmlField(texts.detailsEnd, getScheduleEventEndsAt(event).slice(0, 16).replace('T', ' ')),
    ...(event.attendanceMode === 'open'
      ? [
          formatHtmlField(texts.detailsOccupiedSeats, `${attendance.snapshot.occupiedSeats}/${attendance.snapshot.capacity}`),
          formatHtmlField(texts.detailsFreeSeats, String(attendance.snapshot.availableSeats)),
          formatHtmlField(texts.detailsAttendees, participantLabels.length > 0 ? participantLabels.map(escapeHtml).join(', ') : texts.none),
        ]
      : []),
  ];

  return [
    ...detailLines,
    ...(relevantVenueEvents.length > 0
      ? [
          '<b>Esdeveniments del local rellevants:</b>',
          ...relevantVenueEvents.map(
            (venueEvent) =>
              `- ${escapeHtml(venueEvent.name)} (${formatTimestamp(venueEvent.startsAt)} - ${formatTimestamp(venueEvent.endsAt)}, ocupacio ${escapeHtml(venueEvent.occupancyScope)}, impacte ${escapeHtml(venueEvent.impactLevel)})`,
          ),
          'Aixo no bloqueja automaticament l activitat; serveix com a context per decidir millor.',
        ]
      : []),
  ].join('\n');
}

async function replyWithInspectableEventList(
  context: TelegramScheduleContext,
  options: { includeMenuKeyboard?: boolean; dayKey?: string } = {},
): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).schedule;
  const events = await loadUpcomingScheduleEvents(context);
  if (events.length === 0) {
    await context.reply(texts.noScheduledEvents, buildScheduleMenuOptions(language));
    return true;
  }

  const dayKey = options.dayKey;
  const filteredEvents = dayKey ? events.filter((event) => event.startsAt.startsWith(dayKey)) : events;
  if (filteredEvents.length === 0) {
    await context.reply(texts.noScheduledEventsDay, buildScheduleMenuOptions(language));
    return true;
  }

  const listMessage = await formatScheduleListWithVenueImpact({
    events: filteredEvents,
    language,
    loadAttendance: async (eventId) => {
      const attendance = await getScheduleEventAttendance({
        repository: resolveScheduleRepository(context),
        eventId,
      });
      return attendance.snapshot;
    },
    loadTableName: async (event) => loadTableName(context, event.tableId),
    loadRelevantVenueEvents: async (event) => listRelevantVenueEventsForScheduleEvent(context, event),
  });
  if (options.includeMenuKeyboard) {
    await context.reply(listMessage, { parseMode: 'HTML', ...buildScheduleMenuOptions(language) });
  } else {
    await context.reply(listMessage, { parseMode: 'HTML' });
  }
  return true;
}

async function isActorAttending(context: TelegramScheduleContext, eventId: number): Promise<boolean> {
  const participant = await resolveScheduleRepository(context).findParticipant(eventId, context.runtime.actor.telegramUserId);
  return participant?.status === 'active';
}

async function resolveMemberDisplayName(context: TelegramScheduleContext, telegramUserId: number): Promise<string> {
  const user = await resolveMembershipRepository(context).findUserByTelegramUserId(telegramUserId);
  if (user) {
    return formatMembershipDisplayName(user);
  }

  return 'Usuari';
}

function resolveBotLanguage(context: TelegramScheduleContext): string {
  return context.runtime.bot.language ?? 'ca';
}

function buildCalendarBroadcastDependencies(context: TelegramScheduleContext): Omit<
  Parameters<typeof publishCalendarSnapshotToNewsGroups>[0],
  'change'
> {
  const sendGroupMessage = context.runtime.bot.sendGroupMessage;

  return {
    ...(sendGroupMessage
      ? {
          sendGroupMessage: async (chatId: number, message: string, options?: { parseMode?: 'HTML' }) =>
            sendGroupMessage(chatId, message, options),
        }
      : {}),
    newsGroupRepository: resolveNewsGroupRepository(context),
    database: context.runtime.services.database.db,
    botLanguage: resolveBotLanguage(context),
    ...(context.scheduleRepository ? { scheduleRepository: context.scheduleRepository } : {}),
    ...(context.venueEventRepository ? { venueEventRepository: context.venueEventRepository } : {}),
    ...(context.tableRepository ? { tableRepository: context.tableRepository } : {}),
    resolveActorDisplayName: async () => resolveBroadcastMemberName(context, context.runtime.actor.telegramUserId),
  };
}

function resolveVenueEventRepository(context: TelegramScheduleContext): VenueEventRepository {
  if (context.venueEventRepository) {
    return context.venueEventRepository;
  }

  return createDatabaseVenueEventRepository({
    database: context.runtime.services.database.db as never,
  });
}

async function listRelevantVenueEventsForScheduleEvent(
  context: TelegramScheduleContext,
  event: ScheduleEventRecord,
): Promise<VenueEventRecord[]> {
  return findRelevantVenueEventsForRange({
    repository: resolveVenueEventRepository(context),
    startsAt: event.startsAt,
    endsAt: getScheduleEventEndsAt(event),
  });
}

async function loadUpcomingScheduleEvents(context: TelegramScheduleContext): Promise<ScheduleEventRecord[]> {
  await deletePastScheduleEvents(context);
  const events = await listScheduleEvents({
    repository: resolveScheduleRepository(context),
    includeCancelled: false,
    startsAtFrom: getUtcDayStartIso(),
  });
  return sortScheduleEvents(events);
}

async function deletePastScheduleEvents(context: TelegramScheduleContext): Promise<void> {
  const repository = resolveScheduleRepository(context);
  const cutoff = getUtcDayStartIso();
  const pastEvents = await listScheduleEvents({
    repository,
    includeCancelled: false,
    startsAtTo: cutoff,
  });

  for (const event of pastEvents.filter((entry) => entry.startsAt < cutoff)) {
    await cancelScheduleEvent({
      repository,
      eventId: event.id,
      actorTelegramUserId: context.runtime.actor.telegramUserId,
      reason: 'Expired automatically',
    });
  }
}

async function resolveBroadcastMemberName(context: TelegramScheduleContext, telegramUserId: number): Promise<string> {
  const user = await resolveMembershipRepository(context).findUserByTelegramUserId(telegramUserId);
  if (!user) {
    return 'Usuari';
  }

  return formatMembershipDisplayName(user);
}
