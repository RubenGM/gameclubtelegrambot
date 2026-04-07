import { appendAuditEvent, type AuditLogRepository } from '../audit/audit-log.js';
import { createDatabaseAuditLogRepository } from '../audit/audit-log-store.js';
import { createDatabaseMembershipAccessRepository } from '../membership/access-flow-store.js';
import { createDatabaseNewsGroupRepository } from '../news/news-group-store.js';
import { formatCalendarMessage, loadUpcomingCalendarEntries } from './calendar-summary.js';
import { buildTelegramStartUrl } from './deep-links.js';
import {
  cancelScheduleEvent,
  createScheduleEvent,
  detectScheduleConflicts,
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

const createFlowKey = 'schedule-create';
const editFlowKey = 'schedule-edit';
const cancelFlowKey = 'schedule-cancel';
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

export const scheduleLabels = {
  openMenu: 'Activitats',
  list: 'Veure activitats',
  create: 'Crear activitat',
  edit: 'Editar activitat',
  cancel: 'Cancel.lar activitat',
  editFieldTitle: 'Titol',
  editFieldDescription: 'Descripcio',
  editFieldDate: 'Data inici',
  editFieldTime: 'Hora inici',
  editFieldDuration: 'Durada',
  editFieldCapacity: 'Places',
  editFieldTable: 'Taula',
  start: '/start',
  help: '/help',
  cancelFlow: '/cancel',
  skipOptional: 'Ometre',
  keepCurrent: 'Mantenir valor actual',
  noTable: 'Sense taula',
  keepCurrentDuration: 'Mantenir durada actual',
  defaultDuration: '180 min per defecte',
  confirmCreate: 'Guardar activitat',
  confirmEdit: 'Guardar canvis',
  confirmCancel: 'Confirmar cancel.lacio',
} as const;

const defaultScheduleDurationMinutes = 180;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatHtmlField(label: string, value: string): string {
  return `<b>${escapeHtml(label)}:</b> ${value}`;
}

function getUtcDayStartIso(date = new Date()): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

function getEventDayKey(startsAt: string): string {
  return startsAt.slice(0, 10);
}

function formatDayHeading(dayKey: string): string {
  return dayKey.split('-').reverse().join('/');
}

function formatEventTime(startsAt: string): string {
  return startsAt.slice(11, 16);
}

function sortScheduleEvents(events: ScheduleEventRecord[]): ScheduleEventRecord[] {
  return events.slice().sort((left, right) => left.startsAt.localeCompare(right.startsAt));
}

function groupScheduleEventsByDay(events: ScheduleEventRecord[]): Map<string, ScheduleEventRecord[]> {
  const groups = new Map<string, ScheduleEventRecord[]>();
  for (const event of events) {
    const dayKey = getEventDayKey(event.startsAt);
    const bucket = groups.get(dayKey) ?? [];
    bucket.push(event);
    groups.set(dayKey, bucket);
  }

  return groups;
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
    await context.reply(texts.askTitle, buildSingleCancelKeyboard(language));
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
  const eventId = parseScheduleStartPayload(context.messageText);
  if (eventId === null || context.runtime.chat.kind !== 'private' || !context.runtime.actor.isApproved) {
    return false;
  }

  const event = await loadEventOrThrow(context, eventId);
  await context.reply(await formatScheduleEventView(context, event), {
    ...buildScheduleDetailActionOptions(context, event, await isActorAttending(context, event.id)),
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
    await context.reply(await formatScheduleEventView(context, event), { ...buildScheduleDetailActionOptions(context, event, await isActorAttending(context, event.id)), parseMode: 'HTML' });
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
    await context.reply(
      `T'has apuntat correctament a <b>${escapeHtml(event.title)}</b>\n${await formatScheduleEventView(context, await loadEventOrThrow(context, eventId))}`,
      { ...buildScheduleDetailActionOptions(context, event, true), parseMode: 'HTML' },
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
      { ...buildScheduleDetailActionOptions(context, event, false), parseMode: 'HTML' },
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
      { ...buildEditFieldMenuOptions(language), parseMode: 'HTML' },
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
  return flowKey === createFlowKey || flowKey === editFlowKey || flowKey === cancelFlowKey;
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
  if (stepKey === 'title') {
    await context.runtime.session.advance({ stepKey: 'description', data: { title: text } });
    await context.reply(texts.askDescription, buildDescriptionOptions(language));
    return true;
  }

  if (stepKey === 'description') {
    await context.runtime.session.advance({
      stepKey: 'date',
      data: { ...data, description: text === texts.skipOptional || text === scheduleLabels.skipOptional ? null : text },
    });
    await context.reply(texts.askDate, buildDateOptions(context));
    return true;
  }

  if (stepKey === 'date') {
    const date = parseDate(text);
    if (date instanceof Error) {
      await context.reply(texts.invalidDate, buildDateOptions(context));
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'time', data: { ...data, date } });
    await context.reply(texts.askTime, buildSingleCancelKeyboard(language));
    return true;
  }

  if (stepKey === 'time') {
    const time = parseTime(text);
    if (time instanceof Error) {
      await context.reply(texts.invalidTime, buildSingleCancelKeyboard(language));
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'duration', data: { ...data, time } });
    await context.reply(texts.askDuration, buildCreateDurationOptions(language));
    return true;
  }

  if (stepKey === 'duration') {
    const durationMinutes = parseOptionalDurationMinutes(text, language);
    if (durationMinutes instanceof Error) {
      await context.reply(texts.askDuration, buildCreateDurationOptions(language));
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'capacity', data: { ...data, durationMinutes } });
    await context.reply(texts.askCapacity, buildSingleCancelKeyboard(language));
    return true;
  }

  if (stepKey === 'capacity') {
    const capacity = parseCapacity(text);
    if (capacity instanceof Error) {
      await context.reply(texts.invalidCapacity, buildSingleCancelKeyboard(language));
      return true;
    }
    const nextData = { ...data, capacity };
    await context.runtime.session.advance({ stepKey: 'table', data: nextData });
    await context.reply(texts.askTable, await buildTableSelectionOptions(context, language));
    return true;
  }

  if (stepKey === 'table') {
    return advanceCreateTableSelection(context, data, text);
  }

  if (stepKey === 'confirm') {
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
      await context.reply(texts.inactiveTableCreate, await buildTableSelectionOptions(context, language));
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
    await notifyScheduleConflicts({ context, eventId: created.id });
    await publishCalendarSnapshotToNewsGroups(context, {
      action: 'created',
      event: created,
    });
    return true;
  }

  return false;
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
      await context.reply(texts.askEditTitle, buildSingleCancelKeyboard(language));
      return true;
    }
    if (text === texts.editFieldDescription || text === scheduleLabels.editFieldDescription) {
      await context.runtime.session.advance({ stepKey: 'description', data });
      await context.reply(texts.askEditDescription, buildEditDescriptionOptions(language));
      return true;
    }
    if (text === texts.editFieldDate || text === scheduleLabels.editFieldDate) {
      await context.runtime.session.advance({ stepKey: 'date', data });
      await context.reply(texts.askEditDate, buildEditDateOptions(context, language));
      return true;
    }
    if (text === texts.editFieldTime || text === scheduleLabels.editFieldTime) {
      await context.runtime.session.advance({ stepKey: 'time', data });
      await context.reply(texts.askEditTime, buildKeepCurrentKeyboard(language));
      return true;
    }
    if (text === texts.editFieldDuration || text === scheduleLabels.editFieldDuration) {
      await context.runtime.session.advance({ stepKey: 'duration', data });
      await context.reply(texts.askEditDuration, buildKeepCurrentKeyboard(language));
      return true;
    }
    if (text === texts.editFieldCapacity || text === scheduleLabels.editFieldCapacity) {
      await context.runtime.session.advance({ stepKey: 'capacity', data });
      await context.reply(texts.askEditCapacity, buildKeepCurrentKeyboard(language));
      return true;
    }
    if (text === texts.editFieldTable || text === scheduleLabels.editFieldTable) {
      await context.runtime.session.advance({ stepKey: 'table', data });
      await context.reply(texts.askEditTable, await buildEditTableOptions(context, language));
      return true;
    }
    await context.reply(texts.selectFieldPrompt, buildEditFieldMenuOptions(language));
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
    const currentDate = event.startsAt.slice(0, 10);
    const date = text === texts.keepCurrent || text === scheduleLabels.keepCurrent ? currentDate : parseDate(text);
    if (date instanceof Error) {
      await context.reply(texts.invalidDate, buildEditDateOptions(context, language));
      return true;
    }
    return returnToEditMenu(context, event, data, { date });
  }
  if (stepKey === 'time') {
    const currentTime = event.startsAt.slice(11, 16);
    const time = text === texts.keepCurrent || text === scheduleLabels.keepCurrent ? currentTime : parseTime(text);
    if (time instanceof Error) {
      await context.reply(texts.invalidTime, buildKeepCurrentKeyboard(language));
      return true;
    }
    return returnToEditMenu(context, event, data, { time });
  }
  if (stepKey === 'duration') {
    const durationMinutes = text === texts.keepCurrent || text === scheduleLabels.keepCurrent ? event.durationMinutes : parseOptionalDurationMinutes(text, language);
    if (durationMinutes instanceof Error) {
      await context.reply(texts.askEditDuration, buildKeepCurrentKeyboard(language));
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
    return returnToEditMenu(context, event, data, { capacity });
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
    `${await formatDraftSummary(context, nextData, event, event.organizerTelegramUserId)}\n\n${texts.selectFieldPrompt}`,
    { ...buildEditFieldMenuOptions(language), parseMode: 'HTML' },
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
    await context.reply(texts.inactiveTableEdit, await buildEditTableOptions(context, language));
    return;
  }

  const updated = await updateScheduleEvent({
    repository: resolveScheduleRepository(context),
    eventId: Number(data.eventId),
    title: String(data.title ?? event.title),
    description: asNullableString(data.description),
    startsAt: buildStartsAt(String(data.date ?? event.startsAt.slice(0, 10)), String(data.time ?? event.startsAt.slice(11, 16))),
    durationMinutes: Number(data.durationMinutes ?? event.durationMinutes),
    organizerTelegramUserId: event.organizerTelegramUserId,
    tableId: asNullableNumber(data.tableId),
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
  await notifyScheduleConflicts({ context, eventId: updated.id });
    await publishCalendarSnapshotToNewsGroups(context, {
      action: 'updated',
      event: updated,
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
    await publishCalendarSnapshotToNewsGroups(context, {
      action: 'deleted',
      event: cancelled,
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

  const tableId = parseTableSelection(callbackData);
  let selectedTable: ClubTableRecord | null;
  try {
    selectedTable = await requireSchedulableTableSelection({
      repository: resolveTableRepository(context),
      tableId,
    });
  } catch {
    await context.reply(texts.inactiveTableCreate, await buildTableSelectionOptions(context, language));
    return true;
  }

  const nextData = { ...session.data, tableId };
  await context.runtime.session.advance({ stepKey: 'confirm', data: nextData });
  const event = session.flowKey === editFlowKey ? await loadEventOrThrow(context, Number(session.data.eventId)) : null;
  await context.reply(
    `${await formatDraftSummary(context, nextData, event ?? undefined, event?.organizerTelegramUserId, selectedTable)}\n\n${texts.confirmPrompt}`,
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
    const nextData = { ...data, tableId: null };
    await context.runtime.session.advance({ stepKey: 'confirm', data: nextData });
    await context.reply(`${await formatDraftSummary(context, nextData, undefined)}\n\n${texts.confirmPrompt}`, { ...buildCreateConfirmOptions(language), parseMode: 'HTML' });
    return true;
  }

  const selectedTable = await findSchedulableTableByDisplayName(context, text);
  if (!selectedTable) {
    await context.reply(texts.invalidTableCreate, await buildTableSelectionOptions(context, language));
    return true;
  }

  const nextData = { ...data, tableId: selectedTable.id };
  await context.runtime.session.advance({ stepKey: 'confirm', data: nextData });
  await context.reply(`${await formatDraftSummary(context, nextData, undefined, undefined, selectedTable)}\n\n${texts.confirmPrompt}`, { ...buildCreateConfirmOptions(language), parseMode: 'HTML' });
  return true;
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
    await context.reply(texts.invalidTableEdit, await buildEditTableOptions(context, language));
    return true;
  }

  return returnToEditMenu(context, event, data, { tableId: selectedTable.id });
}

async function findSchedulableTableByDisplayName(context: TelegramScheduleContext, text: string): Promise<ClubTableRecord | null> {
  const normalizedText = text.trim();
  const tables = await listSchedulableTables({ repository: resolveTableRepository(context) });
  return tables.find((table) => table.displayName === normalizedText) ?? null;
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

  await context.reply(formatScheduleListMessage(events), {
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

function buildScheduleMenuOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.list, texts.create], [texts.edit, texts.cancel], [scheduleLabels.start, scheduleLabels.help]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildSingleCancelKeyboard(_language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  return {
    replyKeyboard: [[scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildDescriptionOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.skipOptional], [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildDateOptions(context: TelegramScheduleContext): TelegramReplyOptions {
  return {
    replyKeyboard: [...buildUpcomingDateRows(resolveBotLanguage(context)), [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildEditDateOptions(context: TelegramScheduleContext, language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.keepCurrent], ...buildUpcomingDateRows(resolveBotLanguage(context)), [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildEditDescriptionOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.keepCurrent], [texts.skipOptional], [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildEditTitleOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[scheduleLabels.keepCurrent], [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildEditDurationOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[scheduleLabels.keepCurrent], [scheduleLabels.skipOptional], [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildCreateDurationOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.skipOptional], [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildCreateConfirmOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.confirmCreate], [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildEditConfirmOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.confirmEdit], [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildKeepCurrentKeyboard(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.keepCurrent], [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildEditFieldMenuOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [
      [texts.editFieldTitle, texts.editFieldDescription],
      [texts.editFieldDate, texts.editFieldTime],
      [texts.editFieldDuration, texts.editFieldCapacity],
      [texts.editFieldTable],
      [texts.confirmEdit],
      [scheduleLabels.cancelFlow],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildCancelConfirmOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).schedule;
  return {
    replyKeyboard: [[texts.confirmCancel], [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

async function buildTableSelectionOptions(context: TelegramScheduleContext, language: 'ca' | 'es' | 'en' = 'ca'): Promise<TelegramReplyOptions> {
  const texts = createTelegramI18n(language).schedule;
  const tables = await listSchedulableTables({ repository: resolveTableRepository(context) });
  return {
    replyKeyboard: [...chunkTableButtons(tables.map((table) => table.displayName)), [texts.noTable], [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

async function buildEditTableOptions(context: TelegramScheduleContext, language: 'ca' | 'es' | 'en' = 'ca'): Promise<TelegramReplyOptions> {
  const texts = createTelegramI18n(language).schedule;
  const options = await buildTableSelectionOptions(context, language);
  return {
    ...options,
    replyKeyboard: [[texts.keepCurrent], ...(options.replyKeyboard ?? []).filter((row) => row[0] !== scheduleLabels.cancelFlow), [scheduleLabels.cancelFlow]],
  };
}

function chunkTableButtons(tableNames: string[]): string[][] {
  const rows: string[][] = [];

  for (let index = 0; index < tableNames.length; index += 2) {
    rows.push(tableNames.slice(index, index + 2));
  }

  return rows;
}

function formatScheduleListMessage(events: ScheduleEventRecord[]): string {
  const groupedEvents = groupScheduleEventsByDay(sortScheduleEvents(events));
  const lines: string[] = [];

  for (const [dayKey, dayEvents] of groupedEvents) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(`<b>${formatDayHeading(dayKey)}</b>`);
    for (const event of dayEvents) {
      lines.push(`- <b>${escapeHtml(event.title)}</b> (${formatEventTime(event.startsAt)}) · ${event.capacity} places`);
      if (event.description) {
        lines.push(`  <i>${escapeHtml(event.description)}</i>`);
      }
    }
  }

  return lines.join('\n');
}

function parseScheduleStartPayload(messageText: string | undefined): number | null {
  const payload = messageText?.trim().split(/\s+/).slice(1).join(' ');
  if (!payload || !payload.startsWith(scheduleStartPayloadPrefix)) {
    return null;
  }

  const eventId = Number(payload.slice(scheduleStartPayloadPrefix.length));
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return null;
  }

  return eventId;
}

function buildScheduleDayButtons(events: ScheduleEventRecord[], language: string): NonNullable<TelegramReplyOptions['inlineKeyboard']> {
  const dayKeys = Array.from(new Set(events.map((event) => event.startsAt.slice(0, 10))));
  return dayKeys.map((dayKey) => [{ text: formatScheduleDayButtonLabel(dayKey, language), callbackData: `${scheduleCallbackPrefixes.day}${dayKey}` }]);
}

function formatScheduleEventDetails({ event, tableName, language = 'ca' }: { event: ScheduleEventRecord; tableName: string | null; language?: 'ca' | 'es' | 'en' }): string {
  const texts = createTelegramI18n(normalizeBotLanguage(language, 'ca')).schedule;
  return [
    `<b>${escapeHtml(event.title)}</b>`,
    formatHtmlField(texts.detailsStart, formatTimestamp(event.startsAt)),
    formatHtmlField(texts.detailsDuration, `${event.durationMinutes} min`),
    formatHtmlField(texts.detailsSeats, String(event.capacity)),
    formatHtmlField(texts.detailsTable, escapeHtml(tableName ?? texts.noTable)),
    formatHtmlField(texts.detailsDescription, escapeHtml(event.description ?? texts.noDescription)),
  ].join('\n');
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

  return [
    formatScheduleEventDetails({ event, tableName: await loadTableName(context, event.tableId) }),
    formatHtmlField(texts.detailsEnd, getScheduleEventEndsAt(event).slice(0, 16).replace('T', ' ')),
    formatHtmlField(texts.detailsOccupiedSeats, `${attendance.snapshot.occupiedSeats}/${attendance.snapshot.capacity}`),
    formatHtmlField(texts.detailsFreeSeats, String(attendance.snapshot.availableSeats)),
    formatHtmlField(texts.detailsAttendees, participantLabels.length > 0 ? participantLabels.map(escapeHtml).join(', ') : texts.none),
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

function canEditScheduleEvent(actor: TelegramActor, event: ScheduleEventRecord): boolean {
  return actor.isAdmin || event.createdByTelegramUserId === actor.telegramUserId;
}

function buildScheduleDetailActionOptions(context: TelegramScheduleContext, event: ScheduleEventRecord, isAttending: boolean): TelegramReplyOptions {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).schedule;
  const rows: TelegramReplyOptions['inlineKeyboard'] = [
    [{ text: isAttending ? texts.leaveButton : texts.joinButton, callbackData: `${isAttending ? scheduleCallbackPrefixes.leave : scheduleCallbackPrefixes.join}${event.id}` }],
  ];

  if (canEditScheduleEvent(context.runtime.actor, event)) {
    rows.push([
      { text: texts.editButton, callbackData: `${scheduleCallbackPrefixes.selectEdit}${event.id}` },
      { text: texts.deleteButton, callbackData: `${scheduleCallbackPrefixes.selectCancel}${event.id}` },
    ]);
  }

  return { inlineKeyboard: rows };
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

  const listMessage = await formatScheduleListWithVenueImpact(context, filteredEvents);
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

async function formatDraftSummary(
  context: TelegramScheduleContext,
  data: Record<string, unknown>,
  eventOrOrganizer?: ScheduleEventRecord | number,
  organizerTelegramUserId?: number,
  selectedTable?: ClubTableRecord | null,
): Promise<string> {
  const texts = createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca')).schedule;
  const event = typeof eventOrOrganizer === 'object' && eventOrOrganizer !== null && 'startsAt' in eventOrOrganizer ? eventOrOrganizer : null;
  const effectiveOrganizerTelegramUserId = typeof eventOrOrganizer === 'number' ? eventOrOrganizer : organizerTelegramUserId;
  const title = String(data.title ?? event?.title ?? '');
  const description = data.description === undefined ? event?.description ?? null : asNullableString(data.description);
  const date = String(data.date ?? event?.startsAt.slice(0, 10) ?? '');
  const time = String(data.time ?? event?.startsAt.slice(11, 16) ?? '');
  const durationMinutes = Number(data.durationMinutes ?? event?.durationMinutes ?? 0);
  const capacity = Number(data.capacity ?? event?.capacity ?? 0);
  const effectiveTableId = data.tableId === undefined ? event?.tableId ?? null : asNullableNumber(data.tableId);

  const table = selectedTable === undefined
    ? await resolveScheduleTableReference({
        repository: resolveTableRepository(context),
        tableId: effectiveTableId,
      })
    : selectedTable;
  const advisories = getScheduleTableCapacityAdvisories({
    table,
    requestedCapacity: capacity,
  });

  return [
    `${texts.editFieldTitle}: ${escapeHtml(title)}`,
    `${texts.detailsDescription}: ${escapeHtml(description ?? texts.noDescription)}`,
    `${texts.detailsStart}: ${formatTimestamp(buildStartsAt(date, time))}`,
    `${texts.detailsDuration}: ${durationMinutes} min`,
    `${texts.detailsSeats}: ${capacity}`,
    `${texts.detailsTable}: ${table?.displayName ?? texts.noTable}`,
    ...advisories.map(escapeHtml),
    ...(effectiveOrganizerTelegramUserId ? [`${texts.detailsOrganizer}: ${escapeHtml(await resolveMemberDisplayName(context, effectiveOrganizerTelegramUserId))}`] : []),
  ].join('\n');
}

async function resolveMemberDisplayName(context: TelegramScheduleContext, telegramUserId: number): Promise<string> {
  const user = await resolveMembershipRepository(context).findUserByTelegramUserId(telegramUserId);
  if (user) {
    return formatMembershipDisplayName(user, telegramUserId);
  }

  return `Usuari ${telegramUserId}`;
}

function formatMembershipDisplayName(user: MembershipUserRecord, fallbackTelegramUserId: number): string {
  if (user.username) {
    return `${user.displayName} (@${user.username})`;
  }

  return user.displayName || `Usuari ${fallbackTelegramUserId}`;
}

function parseDate(value: string): string | Error {
  const normalizedValue = value.includes(',') ? value.slice(value.indexOf(',') + 1).trim() : value;

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return normalizedValue;
  }

  const match = normalizedValue.match(/^(\d{2})\/(\d{2})(?:\/(\d{4}))?$/);
  if (!match) {
    return new Error('invalid-date');
  }

  const [, dayText, monthText, yearText] = match;
  const year = Number(yearText ?? String(new Date().getUTCFullYear()));
  const month = Number(monthText);
  const day = Number(dayText);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(candidate.getTime()) ||
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return new Error('invalid-date');
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseTime(value: string): string | Error {
  return /^\d{2}:\d{2}$/.test(value) ? value : new Error('invalid-time');
}

function parseCapacity(value: string): number | Error {
  return parsePositiveInteger(value, 'invalid-capacity');
}

function parsePositiveInteger(value: string, code = 'invalid-positive-integer'): number | Error {
  if (!/^\d+$/.test(value)) {
    return new Error(code);
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : new Error(code);
}

function parseOptionalDurationMinutes(value: string, language: 'ca' | 'es' | 'en' = 'ca'): number | Error {
  const texts = createTelegramI18n(language).schedule;
  if (value === texts.skipOptional || value === scheduleLabels.skipOptional) {
    return defaultScheduleDurationMinutes;
  }
  return parsePositiveInteger(value, 'invalid-duration');
}

function buildStartsAt(date: string, time: string): string {
  return `${date}T${time}:00.000Z`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCFullYear())} ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

function buildUpcomingDateRows(language: string, now = new Date()): string[][] {
  const rows: string[][] = [];
  const values: string[] = [];

  for (let index = 0; index < 6; index += 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + index));
    values.push(formatUpcomingDateLabel(date, language));
  }

  for (let index = 0; index < values.length; index += 2) {
    rows.push(values.slice(index, index + 2));
  }

  return rows;
}

function formatUpcomingDateLabel(date: Date, language: string): string {
  const weekday = new Intl.DateTimeFormat(resolveLanguageLocale(language), {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(date);
  return `${capitalizeFirstLetter(weekday)}, ${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function resolveLanguageLocale(language: string): string {
  switch (language) {
    case 'ca':
      return 'ca-ES';
    case 'es':
      return 'es-ES';
    case 'en':
      return 'en-GB';
    default:
      return language;
  }
}

function capitalizeFirstLetter(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

function resolveBotLanguage(context: TelegramScheduleContext): string {
  return context.runtime.bot.language ?? 'ca';
}

function parseEntityId(callbackData: string, prefix: string, kind: string): number {
  const candidate = Number(callbackData.slice(prefix.length));
  if (!Number.isInteger(candidate) || candidate <= 0) {
    throw new Error(`No s ha pogut identificar la ${kind} seleccionada.`);
  }
  return candidate;
}

function parseDayKey(callbackData: string, prefix: string): string {
  const dayKey = callbackData.slice(prefix.length);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    throw new Error('No s ha pogut identificar el dia seleccionat.');
  }
  return dayKey;
}

function formatScheduleDayButtonLabel(dayKey: string, language: string): string {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  const weekday = new Intl.DateTimeFormat(resolveLanguageLocale(language), { weekday: 'long', timeZone: 'UTC' }).format(date);
  return `Veure ${capitalizeFirstLetter(weekday)} ${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function parseTableSelection(callbackData: string): number | null {
  const value = callbackData.slice(scheduleCallbackPrefixes.tableSelection.length);
  if (value === 'none') {
    return null;
  }
  const tableId = Number(value);
  if (!Number.isInteger(tableId) || tableId <= 0) {
    throw new Error('No s ha pogut identificar la taula seleccionada.');
  }
  return tableId;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
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

async function formatScheduleListWithVenueImpact(
  context: TelegramScheduleContext,
  events: ScheduleEventRecord[],
): Promise<string> {
  const lines: string[] = [];
  const groupedEvents = groupScheduleEventsByDay(sortScheduleEvents(events));

  for (const [dayKey, dayEvents] of groupedEvents) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(`<b>${formatDayHeading(dayKey)}</b>`);
    for (const event of dayEvents) {
      const attendance = await getScheduleEventAttendance({
        repository: resolveScheduleRepository(context),
        eventId: event.id,
      });
      lines.push(`- <a href="${escapeHtml(buildTelegramStartUrl(`schedule_event_${event.id}`))}"><b>${escapeHtml(event.title)}</b></a> (${formatEventTime(event.startsAt)}) · ${formatParticipantCount(attendance.snapshot.occupiedSeats, attendance.snapshot.capacity)}`);
      if (event.description) {
        lines.push(`  <i>${escapeHtml(event.description)}</i>`);
      }
      const relevantVenueEvents = await listRelevantVenueEventsForScheduleEvent(context, event);
      if (relevantVenueEvents.length > 0) {
        const summary = relevantVenueEvents
          .map((venueEvent) => `${escapeHtml(venueEvent.name)} (ocupacio ${escapeHtml(venueEvent.occupancyScope)}, impacte ${escapeHtml(venueEvent.impactLevel)})`)
          .join(', ');
        lines.push(`  <b>Impacte local:</b> ${summary}`);
      }
    }
  }

  return lines.join('\n');
}

function formatParticipantCount(occupiedSeats: number, capacity: number): string {
  return `${occupiedSeats}/${capacity} participants`;
}

async function notifyScheduleConflicts({
  context,
  eventId,
}: {
  context: TelegramScheduleContext;
  eventId: number;
}): Promise<void> {
  const conflicts = await detectScheduleConflicts({
    repository: resolveScheduleRepository(context),
    eventId,
    actorTelegramUserId: context.runtime.actor.telegramUserId,
  });

  if (conflicts.overlappingEventIds.length === 0) {
    return;
  }

  const subjectEvent = await loadEventOrThrow(context, eventId);
  const overlappingEvents = await Promise.all(conflicts.overlappingEventIds.map((id) => loadEventOrThrow(context, id)));
  const overlapSummary = overlappingEvents
    .map((event) => `${event.title} (${event.startsAt.slice(0, 16).replace('T', ' ')} - ${getScheduleEventEndsAt(event).slice(0, 16).replace('T', ' ')})`)
    .join('\n- ');

  await Promise.all(
    conflicts.impactedTelegramUserIds.map((telegramUserId) =>
      context.runtime.bot.sendPrivateMessage(
        telegramUserId,
        [
          'S ha detectat un possible conflicte amb les teves reserves del club.',
          `Nova activitat o canvi: ${subjectEvent.title} (${subjectEvent.startsAt.slice(0, 16).replace('T', ' ')} - ${getScheduleEventEndsAt(subjectEvent).slice(0, 16).replace('T', ' ')})`,
          `Altres activitats afectades:\n- ${overlapSummary}`,
          'El bot no ha bloquejat la reserva. Si us plau, coordina-t hi manualment amb la resta de persones implicades.',
        ].join('\n'),
      ),
    ),
  );
}

async function publishCalendarSnapshotToNewsGroups(
  context: TelegramScheduleContext,
  change: {
    action: 'created' | 'updated' | 'deleted';
    event: ScheduleEventRecord;
  },
): Promise<void> {
  const sendGroupMessage = context.runtime.bot.sendGroupMessage;
  if (!sendGroupMessage) {
    return;
  }

  const repository = context.newsGroupRepository ?? createDatabaseNewsGroupRepository({
    database: context.runtime.services.database.db as never,
  });
  const groups = await repository.listGroups({ includeDisabled: false });
  if (groups.length === 0) {
    return;
  }

  const entries = await loadUpcomingCalendarEntries({
    database: context.runtime.services.database.db,
    ...(context.scheduleRepository ? { scheduleRepository: context.scheduleRepository } : {}),
    ...(context.venueEventRepository ? { venueEventRepository: context.venueEventRepository } : {}),
    ...(context.tableRepository ? { tableRepository: context.tableRepository } : {}),
  });
  const message = entries.length > 0
    ? `Calendari actualitzat:\n${formatCalendarMessage(entries, context.runtime.bot.language ?? 'ca')}`
    : 'Calendari actualitzat: no hi ha activitats ni esdeveniments propers ara mateix.';
  const footer = await formatCalendarBroadcastFooter(context, change);

  await Promise.all(
    groups.map(async (group) => {
      try {
        await sendGroupMessage(group.chatId, `${message}\n\n${footer}`, { parseMode: 'HTML' });
      } catch {
        // La notificació de grup no ha de bloquejar l'edició de l'activitat.
      }
    }),
  );
}

async function formatCalendarBroadcastFooter(
  context: TelegramScheduleContext,
  change: {
    action: 'created' | 'updated' | 'deleted';
    event: ScheduleEventRecord;
  },
): Promise<string> {
  const userName = await resolveBroadcastMemberName(context, context.runtime.actor.telegramUserId);
  const actionLabel =
    change.action === 'created'
      ? 'creado'
      : change.action === 'updated'
        ? 'actualizado'
        : 'eliminado';

  return `<i>${escapeHtml(userName)} ha ${actionLabel} la actividad ${escapeHtml(change.event.title)} del ${escapeHtml(formatDayHeading(change.event.startsAt.slice(0, 10)))}</i>`;
}

async function resolveBroadcastMemberName(context: TelegramScheduleContext, telegramUserId: number): Promise<string> {
  const user = await resolveMembershipRepository(context).findUserByTelegramUserId(telegramUserId);
  if (!user) {
    return `Usuari ${telegramUserId}`;
  }

  if (user.displayName.trim().length > 0) {
    return user.displayName;
  }

  if (user.username && user.username.trim().length > 0) {
    return user.username;
  }

  return `Usuari ${telegramUserId}`;
}
