import { appendAuditEvent, type AuditLogRepository } from '../audit/audit-log.js';
import { createDatabaseAuditLogRepository } from '../audit/audit-log-store.js';
import { createDatabaseMembershipAccessRepository } from '../membership/access-flow-store.js';
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

const createFlowKey = 'schedule-create';
const editFlowKey = 'schedule-edit';
const cancelFlowKey = 'schedule-cancel';

export const scheduleCallbackPrefixes = {
  inspect: 'schedule:inspect:',
  join: 'schedule:join:',
  leave: 'schedule:leave:',
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
    };
  };
  scheduleRepository?: ScheduleRepository;
  tableRepository?: ClubTableRepository;
  venueEventRepository?: VenueEventRepository;
  auditRepository?: AuditLogRepository;
  membershipRepository?: MembershipAccessRepository;
}

export async function handleTelegramScheduleText(context: TelegramScheduleContext): Promise<boolean> {
  const text = context.messageText?.trim();
  if (!text || context.runtime.chat.kind !== 'private' || !context.runtime.actor.isApproved) {
    return false;
  }

  if (isScheduleSession(context.runtime.session.current?.flowKey)) {
    return handleActiveScheduleSession(context, text);
  }

  if (text === scheduleLabels.openMenu || text === '/schedule') {
    return replyWithInspectableEventList(context, { includeMenuKeyboard: true });
  }

  if (text === scheduleLabels.create || text === '/schedule_create') {
    await context.runtime.session.start({ flowKey: createFlowKey, stepKey: 'title', data: {} });
    await context.reply('Escriu el titol de l activitat.', buildSingleCancelKeyboard());
    return true;
  }

  if (text === scheduleLabels.list || text === '/schedule_list') {
    return replyWithInspectableEventList(context);
  }

  if (text === scheduleLabels.edit || text === '/schedule_edit') {
    return replyWithManageableEventList(context, 'edit');
  }

  if (text === scheduleLabels.cancel || text === '/schedule_cancel') {
    return replyWithManageableEventList(context, 'cancel');
  }

  return false;
}

export async function handleTelegramScheduleCallback(context: TelegramScheduleContext): Promise<boolean> {
  const callbackData = context.callbackData;
  if (!callbackData || context.runtime.chat.kind !== 'private' || !context.runtime.actor.isApproved) {
    return false;
  }

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

  if (callbackData.startsWith(scheduleCallbackPrefixes.selectEdit)) {
    const eventId = parseEntityId(callbackData, scheduleCallbackPrefixes.selectEdit, 'activitat');
    const event = await loadEventOrThrow(context, eventId);
    if (!canManageEvent(context.runtime.actor, context.runtime.authorization, event)) {
      await context.reply('No pots modificar una activitat creada per una altra persona.');
      return true;
    }

    await context.runtime.session.start({
      flowKey: editFlowKey,
      stepKey: 'select-field',
      data: { eventId },
    });
    await context.reply(
      `${formatScheduleEventDetails({ event, tableName: await loadTableName(context, event.tableId) })}\n\nTria un camp per editar o guarda els canvis.`,
      { ...buildEditFieldMenuOptions(), parseMode: 'HTML' },
    );
    return true;
  }

  if (callbackData.startsWith(scheduleCallbackPrefixes.selectCancel)) {
    const eventId = parseEntityId(callbackData, scheduleCallbackPrefixes.selectCancel, 'activitat');
    const event = await loadEventOrThrow(context, eventId);
    if (!canManageEvent(context.runtime.actor, context.runtime.authorization, event)) {
      await context.reply('No pots cancel.lar una activitat creada per una altra persona.');
      return true;
    }

    await context.runtime.session.start({
      flowKey: cancelFlowKey,
      stepKey: 'confirm',
      data: { eventId },
    });
    await context.reply(
      `${formatScheduleEventDetails({ event, tableName: await loadTableName(context, event.tableId) })}\n\nConfirma si vols cancel.lar aquesta activitat.`,
      { ...buildCancelConfirmOptions(), parseMode: 'HTML' },
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
  if (stepKey === 'title') {
    await context.runtime.session.advance({ stepKey: 'description', data: { title: text } });
    await context.reply('Escriu una descripcio opcional o tria una opcio del teclat.', buildDescriptionOptions());
    return true;
  }

  if (stepKey === 'description') {
    await context.runtime.session.advance({
      stepKey: 'date',
      data: { ...data, description: text === scheduleLabels.skipOptional ? null : text },
    });
    await context.reply('Escriu la data en format dd/MM o dd/MM/yyyy.', buildDateOptions(context));
    return true;
  }

  if (stepKey === 'date') {
    const date = parseDate(text);
    if (date instanceof Error) {
      await context.reply('La data ha de tenir format dd/MM o dd/MM/yyyy.', buildDateOptions(context));
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'time', data: { ...data, date } });
    await context.reply('Escriu l hora en format HH:MM.', buildSingleCancelKeyboard());
    return true;
  }

  if (stepKey === 'time') {
    const time = parseTime(text);
    if (time instanceof Error) {
      await context.reply('L hora ha de tenir format HH:MM.', buildSingleCancelKeyboard());
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'duration', data: { ...data, time } });
    await context.reply('Escriu la durada en minuts com a numero enter positiu o omet el camp per usar 180 minuts.', buildCreateDurationOptions());
    return true;
  }

  if (stepKey === 'duration') {
    const durationMinutes = parseOptionalDurationMinutes(text);
    if (durationMinutes instanceof Error) {
      await context.reply('La durada ha de ser un enter positiu en minuts o pots ometre-la per usar 180 minuts.', buildCreateDurationOptions());
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'capacity', data: { ...data, durationMinutes } });
    await context.reply('Escriu la capacitat com a numero enter positiu.', buildSingleCancelKeyboard());
    return true;
  }

  if (stepKey === 'capacity') {
    const capacity = parseCapacity(text);
    if (capacity instanceof Error) {
      await context.reply('La capacitat ha de ser un enter positiu.', buildSingleCancelKeyboard());
      return true;
    }
    const nextData = { ...data, capacity };
    await context.runtime.session.advance({ stepKey: 'table', data: nextData });
    await context.reply('Tria una taula opcional o continua sense taula.', await buildTableSelectionOptions(context));
    return true;
  }

  if (stepKey === 'table') {
    return advanceCreateTableSelection(context, data, text);
  }

  if (stepKey === 'confirm') {
    if (text !== scheduleLabels.confirmCreate) {
      await context.reply('Per guardar l activitat, tria el boto de confirmacio o cancel.la el flux.', buildCreateConfirmOptions());
      return true;
    }
    try {
      await requireSchedulableTableSelection({
        repository: resolveTableRepository(context),
        tableId: asNullableNumber(data.tableId),
      });
    } catch {
      await context.runtime.session.advance({ stepKey: 'table', data });
      await context.reply('La taula seleccionada ja no esta activa. Torna a triar una taula activa o continua sense taula.', await buildTableSelectionOptions(context));
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
      `Activitat creada correctament: <b>${escapeHtml(created.title)}</b>\n${await formatScheduleEventView(context, created)}`,
      { ...buildScheduleMenuOptions(), parseMode: 'HTML' },
    );
    await notifyScheduleConflicts({ context, eventId: created.id });
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
  const event = await loadEventOrThrow(context, Number(data.eventId));
    if (stepKey === 'select-field') {
      if (text === scheduleLabels.confirmEdit) {
        await persistEditedScheduleEvent(context, event, data);
        return true;
      }
    if (text === scheduleLabels.editFieldTitle) {
      await context.runtime.session.advance({ stepKey: 'title', data });
      await context.reply('Escriu el nou titol de l activitat.', buildSingleCancelKeyboard());
      return true;
    }
    if (text === scheduleLabels.editFieldDescription) {
      await context.runtime.session.advance({ stepKey: 'description', data });
      await context.reply('Escriu la nova descripcio opcional o tria una opcio del teclat.', buildEditDescriptionOptions());
      return true;
    }
    if (text === scheduleLabels.editFieldDate) {
      await context.runtime.session.advance({ stepKey: 'date', data });
      await context.reply('Escriu la data en format dd/MM o dd/MM/yyyy, o mantingues el valor actual.', buildEditDateOptions(context));
      return true;
    }
    if (text === scheduleLabels.editFieldTime) {
      await context.runtime.session.advance({ stepKey: 'time', data });
      await context.reply('Escriu l hora en format HH:MM o mantingues el valor actual.', buildKeepCurrentKeyboard());
      return true;
    }
    if (text === scheduleLabels.editFieldDuration) {
      await context.runtime.session.advance({ stepKey: 'duration', data });
      await context.reply('Escriu la durada en minuts o mantingues el valor actual.', buildKeepCurrentKeyboard());
      return true;
    }
    if (text === scheduleLabels.editFieldCapacity) {
      await context.runtime.session.advance({ stepKey: 'capacity', data });
      await context.reply('Escriu la capacitat com a numero enter positiu o mantingues el valor actual.', buildKeepCurrentKeyboard());
      return true;
    }
    if (text === scheduleLabels.editFieldTable) {
      await context.runtime.session.advance({ stepKey: 'table', data });
      await context.reply('Tria una taula opcional, mantingues la taula actual o elimina-la.', await buildEditTableOptions(context));
      return true;
    }
    await context.reply('Tria un camp del teclat o guarda els canvis quan hagis acabat.', buildEditFieldMenuOptions());
    return true;
  }

  if (stepKey === 'title') {
    const title = text === scheduleLabels.keepCurrent ? event.title : text;
    return returnToEditMenu(context, event, data, { title });
  }
  if (stepKey === 'description') {
    const description = text === scheduleLabels.keepCurrent ? event.description : text === scheduleLabels.skipOptional ? null : text;
    return returnToEditMenu(context, event, data, { description, title: data.title ?? event.title });
  }
  if (stepKey === 'date') {
    const currentDate = event.startsAt.slice(0, 10);
    const date = text === scheduleLabels.keepCurrent ? currentDate : parseDate(text);
    if (date instanceof Error) {
      await context.reply('La data ha de tenir format dd/MM o dd/MM/yyyy.', buildEditDateOptions(context));
      return true;
    }
    return returnToEditMenu(context, event, data, { date });
  }
  if (stepKey === 'time') {
    const currentTime = event.startsAt.slice(11, 16);
    const time = text === scheduleLabels.keepCurrent ? currentTime : parseTime(text);
    if (time instanceof Error) {
      await context.reply('L hora ha de tenir format HH:MM.', buildKeepCurrentKeyboard());
      return true;
    }
    return returnToEditMenu(context, event, data, { time });
  }
  if (stepKey === 'duration') {
    const durationMinutes = text === scheduleLabels.keepCurrent ? event.durationMinutes : parseOptionalDurationMinutes(text);
    if (durationMinutes instanceof Error) {
      await context.reply('La durada ha de ser un enter positiu en minuts.', buildKeepCurrentKeyboard());
      return true;
    }
    return returnToEditMenu(context, event, data, { durationMinutes });
  }
  if (stepKey === 'capacity') {
    const capacity = text === scheduleLabels.keepCurrent ? event.capacity : parseCapacity(text);
    if (capacity instanceof Error) {
      await context.reply('La capacitat ha de ser un enter positiu.', buildKeepCurrentKeyboard());
      return true;
    }
    return returnToEditMenu(context, event, data, { capacity });
  }
  if (stepKey === 'table') {
    if (text === scheduleLabels.keepCurrent) {
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
  const nextData = { ...data, ...patch };
  await context.runtime.session.advance({ stepKey: 'select-field', data: nextData });
  await context.reply(
    `${await formatDraftSummary(context, nextData, event, event.organizerTelegramUserId)}\n\nTria un camp per editar o guarda els canvis.`,
    { ...buildEditFieldMenuOptions(), parseMode: 'HTML' },
  );
  return true;
}

async function persistEditedScheduleEvent(
  context: TelegramScheduleContext,
  event: ScheduleEventRecord,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await requireSchedulableTableSelection({
      repository: resolveTableRepository(context),
      tableId: asNullableNumber(data.tableId),
    });
  } catch {
    await context.runtime.session.advance({ stepKey: 'table', data });
    await context.reply('La taula seleccionada ja no esta activa. Torna a triar una taula activa, mantenir la taula actual o eliminar-la.', await buildEditTableOptions(context));
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
    `Activitat actualitzada correctament: <b>${escapeHtml(updated.title)}</b>\n${formatScheduleEventDetails({ event: updated, tableName: await loadTableName(context, updated.tableId) })}`,
    { ...buildScheduleMenuOptions(), parseMode: 'HTML' },
  );
  await notifyScheduleConflicts({ context, eventId: updated.id });
}

async function handleCancelSession(
  context: TelegramScheduleContext,
  text: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  if (text !== scheduleLabels.confirmCancel) {
    await context.reply('Per cancel.lar l activitat, tria el boto de confirmacio o cancel.la el flux.', buildCancelConfirmOptions());
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
  await context.reply(`Activitat cancel.lada correctament: <b>${escapeHtml(cancelled.title)}</b>`, { ...buildScheduleMenuOptions(), parseMode: 'HTML' });
  return true;
}

async function handleTableSelectionCallback(context: TelegramScheduleContext, callbackData: string): Promise<boolean> {
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
    await context.reply('La taula seleccionada ja no esta activa. Tria una taula activa o continua sense taula.', await buildTableSelectionOptions(context));
    return true;
  }

  const nextData = { ...session.data, tableId };
  await context.runtime.session.advance({ stepKey: 'confirm', data: nextData });
  const event = session.flowKey === editFlowKey ? await loadEventOrThrow(context, Number(session.data.eventId)) : null;
  await context.reply(
    `${await formatDraftSummary(context, nextData, event ?? undefined, event?.organizerTelegramUserId, selectedTable)}\n\nConfirma o cancel.la el flux.`,
    { ...(session.flowKey === editFlowKey ? buildEditConfirmOptions() : buildCreateConfirmOptions()), parseMode: 'HTML' },
  );
  return true;
}

async function advanceCreateTableSelection(
  context: TelegramScheduleContext,
  data: Record<string, unknown>,
  text: string,
): Promise<boolean> {
  if (text === scheduleLabels.noTable) {
    const nextData = { ...data, tableId: null };
    await context.runtime.session.advance({ stepKey: 'confirm', data: nextData });
    await context.reply(`${await formatDraftSummary(context, nextData, undefined)}\n\nConfirma o cancel.la el flux.`, { ...buildCreateConfirmOptions(), parseMode: 'HTML' });
    return true;
  }

  const selectedTable = await findSchedulableTableByDisplayName(context, text);
  if (!selectedTable) {
    await context.reply('Per continuar, tria una taula dels botons o selecciona Sense taula.', await buildTableSelectionOptions(context));
    return true;
  }

  const nextData = { ...data, tableId: selectedTable.id };
  await context.runtime.session.advance({ stepKey: 'confirm', data: nextData });
  await context.reply(`${await formatDraftSummary(context, nextData, undefined, undefined, selectedTable)}\n\nConfirma o cancel.la el flux.`, { ...buildCreateConfirmOptions(), parseMode: 'HTML' });
  return true;
}

async function advanceEditTableSelection(
  context: TelegramScheduleContext,
  event: ScheduleEventRecord,
  data: Record<string, unknown>,
  text: string,
): Promise<boolean> {
  if (text === scheduleLabels.noTable) {
    return returnToEditMenu(context, event, data, { tableId: null });
  }

  const selectedTable = await findSchedulableTableByDisplayName(context, text);
  if (!selectedTable) {
    await context.reply('Per continuar, tria una taula dels botons, mantingues el valor actual o selecciona Sense taula.', await buildEditTableOptions(context));
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
  const events = (await loadUpcomingScheduleEvents(context)).filter((event) => canManageEvent(context.runtime.actor, context.runtime.authorization, event));
  if (events.length === 0) {
    await context.reply(
      mode === 'edit'
        ? 'No tens cap activitat editable ara mateix.'
        : 'No tens cap activitat cancel.lable ara mateix.',
      buildScheduleMenuOptions(),
    );
    return true;
  }

  await context.reply(formatScheduleListMessage(events), {
    parseMode: 'HTML',
    inlineKeyboard: events.map((event) => [
      {
        text: `${mode === 'edit' ? 'Editar' : 'Cancel.lar'} ${event.title}`,
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

function buildScheduleMenuOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[scheduleLabels.list, scheduleLabels.create], [scheduleLabels.edit, scheduleLabels.cancel], [scheduleLabels.start, scheduleLabels.help]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildSingleCancelKeyboard(): TelegramReplyOptions {
  return {
    replyKeyboard: [[scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildDescriptionOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[scheduleLabels.skipOptional], [scheduleLabels.cancelFlow]],
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

function buildEditDateOptions(context: TelegramScheduleContext): TelegramReplyOptions {
  return {
    replyKeyboard: [[scheduleLabels.keepCurrent], ...buildUpcomingDateRows(resolveBotLanguage(context)), [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildEditDescriptionOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[scheduleLabels.keepCurrent], [scheduleLabels.skipOptional], [scheduleLabels.cancelFlow]],
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

function buildCreateDurationOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[scheduleLabels.skipOptional], [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildCreateConfirmOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[scheduleLabels.confirmCreate], [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildEditConfirmOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[scheduleLabels.confirmEdit], [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildKeepCurrentKeyboard(): TelegramReplyOptions {
  return {
    replyKeyboard: [[scheduleLabels.keepCurrent], [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildEditFieldMenuOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [
      [scheduleLabels.editFieldTitle, scheduleLabels.editFieldDescription],
      [scheduleLabels.editFieldDate, scheduleLabels.editFieldTime],
      [scheduleLabels.editFieldDuration, scheduleLabels.editFieldCapacity],
      [scheduleLabels.editFieldTable],
      [scheduleLabels.confirmEdit],
      [scheduleLabels.cancelFlow],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildCancelConfirmOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[scheduleLabels.confirmCancel], [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

async function buildTableSelectionOptions(context: TelegramScheduleContext): Promise<TelegramReplyOptions> {
  const tables = await listSchedulableTables({ repository: resolveTableRepository(context) });
  return {
    replyKeyboard: [...chunkTableButtons(tables.map((table) => table.displayName)), [scheduleLabels.noTable], [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

async function buildEditTableOptions(context: TelegramScheduleContext): Promise<TelegramReplyOptions> {
  const options = await buildTableSelectionOptions(context);
  return {
    ...options,
    replyKeyboard: [[scheduleLabels.keepCurrent], ...(options.replyKeyboard ?? []).filter((row) => row[0] !== scheduleLabels.cancelFlow), [scheduleLabels.cancelFlow]],
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

function formatScheduleEventDetails({ event, tableName }: { event: ScheduleEventRecord; tableName: string | null }): string {
  return [
    `<b>${escapeHtml(event.title)}</b>`,
    formatHtmlField('Inici', formatTimestamp(event.startsAt)),
    formatHtmlField('Durada', `${event.durationMinutes} min`),
    formatHtmlField('Places', String(event.capacity)),
    formatHtmlField('Taula', escapeHtml(tableName ?? 'Sense taula')),
    formatHtmlField('Descripcio', escapeHtml(event.description ?? 'Sense descripcio')),
  ].join('\n');
}

async function formatScheduleEventView(
  context: TelegramScheduleContext,
  event: ScheduleEventRecord,
): Promise<string> {
  const attendance = await getScheduleEventAttendance({
    repository: resolveScheduleRepository(context),
    eventId: event.id,
  });

  const relevantVenueEvents = await listRelevantVenueEventsForScheduleEvent(context, event);
  const participantLabels = await formatParticipantLabels(context, attendance.activeParticipantTelegramUserIds);

  return [
    formatScheduleEventDetails({ event, tableName: await loadTableName(context, event.tableId) }),
    formatHtmlField('Final', getScheduleEventEndsAt(event).slice(0, 16).replace('T', ' ')),
    formatHtmlField('Places ocupades', `${attendance.snapshot.occupiedSeats}/${attendance.snapshot.capacity}`),
    formatHtmlField('Places lliures', String(attendance.snapshot.availableSeats)),
    formatHtmlField('Assistents', participantLabels.length > 0 ? participantLabels.map(escapeHtml).join(', ') : 'Cap'),
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
  const rows: TelegramReplyOptions['inlineKeyboard'] = [
    [{ text: isAttending ? 'Sortir' : 'Apuntar-me', callbackData: `${isAttending ? scheduleCallbackPrefixes.leave : scheduleCallbackPrefixes.join}${event.id}` }],
  ];

  if (canEditScheduleEvent(context.runtime.actor, event)) {
    rows.push([
      { text: 'Editar activitat', callbackData: `${scheduleCallbackPrefixes.selectEdit}${event.id}` },
      { text: 'Eliminar activitat', callbackData: `${scheduleCallbackPrefixes.selectCancel}${event.id}` },
    ]);
  }

  return { inlineKeyboard: rows };
}

async function replyWithInspectableEventList(
  context: TelegramScheduleContext,
  options: { includeMenuKeyboard?: boolean } = {},
): Promise<boolean> {
  const events = await loadUpcomingScheduleEvents(context);
  if (events.length === 0) {
    await context.reply('No hi ha activitats programades ara mateix.', buildScheduleMenuOptions());
    return true;
  }

  const listMessage = await formatScheduleListWithVenueImpact(context, events);

  await context.reply(listMessage, {
    parseMode: 'HTML',
    inlineKeyboard: events.map((event) => [{ text: `Veure ${event.title}`, callbackData: `${scheduleCallbackPrefixes.inspect}${event.id}` }]),
    ...(options.includeMenuKeyboard ? buildScheduleMenuOptions() : {}),
  });
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
    `Titol: ${escapeHtml(title)}`,
    `Descripcio: ${escapeHtml(description ?? 'Sense descripcio')}`,
    `Inici: ${formatTimestamp(buildStartsAt(date, time))}`,
    `Durada: ${durationMinutes} min`,
    `Places: ${capacity}`,
    `Taula: ${table?.displayName ?? 'Sense taula'}`,
    ...advisories.map(escapeHtml),
    ...(effectiveOrganizerTelegramUserId ? [`Organitzador: ${escapeHtml(await resolveMemberDisplayName(context, effectiveOrganizerTelegramUserId))}`] : []),
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

function parseOptionalDurationMinutes(value: string): number | Error {
  if (value === scheduleLabels.skipOptional) {
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
    lines.push(`<b>${formatDayHeading(dayKey)}</b>`);
    for (const event of dayEvents) {
      const attendance = await getScheduleEventAttendance({
        repository: resolveScheduleRepository(context),
        eventId: event.id,
      });
      lines.push(`- <b>${escapeHtml(event.title)}</b> (${formatEventTime(event.startsAt)}) · ${formatParticipantCount(attendance.snapshot.occupiedSeats, attendance.snapshot.capacity)}`);
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
