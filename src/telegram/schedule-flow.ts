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
import { createDatabaseScheduleRepository } from '../schedule/schedule-catalog-store.js';
import { listClubTables, type ClubTableRecord, type ClubTableRepository } from '../tables/table-catalog.js';
import { createDatabaseClubTableRepository } from '../tables/table-catalog-store.js';
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
  start: '/start',
  help: '/help',
  cancelFlow: '/cancel',
  skipOptional: 'Ometre',
  keepCurrent: 'Mantenir valor actual',
  noTable: 'Sense taula',
  keepCurrentDuration: 'Mantenir durada actual',
  confirmCreate: 'Guardar activitat',
  confirmEdit: 'Guardar canvis',
  confirmCancel: 'Confirmar cancel.lacio',
} as const;

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
      sendPrivateMessage(telegramUserId: number, message: string): Promise<void>;
    };
  };
  scheduleRepository?: ScheduleRepository;
  tableRepository?: ClubTableRepository;
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
    await context.reply('Gestio d activitats: tria una accio.', buildScheduleMenuOptions());
    return true;
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
    await context.reply(await formatScheduleEventView(context, event), buildAttendanceActionOptions(context, event, await isActorAttending(context, event.id)));
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
      `T has apuntat correctament a ${event.title}\n${await formatScheduleEventView(context, await loadEventOrThrow(context, eventId))}`,
      buildAttendanceActionOptions(context, event, true),
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
      `Has sortit correctament de ${event.title}\n${await formatScheduleEventView(context, await loadEventOrThrow(context, eventId))}`,
      buildAttendanceActionOptions(context, event, false),
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
      stepKey: 'title',
      data: { eventId },
    });
    await context.reply(
      `${formatScheduleEventDetails({ event, tableName: await loadTableName(context, event.tableId) })}\n\nEscriu el nou titol o tria una opcio del teclat.`,
      buildEditTitleOptions(),
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
      buildCancelConfirmOptions(),
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
    await context.reply('Escriu la data en format YYYY-MM-DD.', buildSingleCancelKeyboard());
    return true;
  }

  if (stepKey === 'date') {
    const date = parseDate(text);
    if (date instanceof Error) {
      await context.reply('La data ha de tenir format YYYY-MM-DD.', buildSingleCancelKeyboard());
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
    await context.reply('Escriu la durada en minuts com a numero enter positiu.', buildSingleCancelKeyboard());
    return true;
  }

  if (stepKey === 'duration') {
    const durationMinutes = parsePositiveInteger(text);
    if (durationMinutes instanceof Error) {
      await context.reply('La durada ha de ser un enter positiu en minuts.', buildSingleCancelKeyboard());
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
    if (text !== scheduleLabels.noTable) {
      await context.reply('Per continuar, tria una taula dels botons o selecciona Sense taula.', await buildTableSelectionOptions(context));
      return true;
    }
    const nextData = { ...data, tableId: null };
    await context.runtime.session.advance({ stepKey: 'confirm', data: nextData });
    await context.reply(`${await formatDraftSummary(context, nextData)}\n\nConfirma o cancel.la el flux.`, buildCreateConfirmOptions());
    return true;
  }

  if (stepKey === 'confirm') {
    if (text !== scheduleLabels.confirmCreate) {
      await context.reply('Per guardar l activitat, tria el boto de confirmacio o cancel.la el flux.', buildCreateConfirmOptions());
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
    await context.runtime.session.cancel();
    await context.reply(
      `Activitat creada correctament: ${created.title}\n${await formatScheduleEventView(context, created)}`,
      buildScheduleMenuOptions(),
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

  if (stepKey === 'title') {
    const title = text === scheduleLabels.keepCurrent ? event.title : text;
    await context.runtime.session.advance({ stepKey: 'description', data: { ...data, title } });
    await context.reply('Escriu una descripcio opcional o tria una opcio del teclat.', buildEditDescriptionOptions());
    return true;
  }
  if (stepKey === 'description') {
    const description = text === scheduleLabels.keepCurrent ? event.description : text === scheduleLabels.skipOptional ? null : text;
    await context.runtime.session.advance({ stepKey: 'date', data: { ...data, title: data.title ?? event.title, description } });
    await context.reply('Escriu la data en format YYYY-MM-DD o mantingues el valor actual.', buildEditTitleOptions());
    return true;
  }
  if (stepKey === 'date') {
    const currentDate = event.startsAt.slice(0, 10);
    const date = text === scheduleLabels.keepCurrent ? currentDate : parseDate(text);
    if (date instanceof Error) {
      await context.reply('La data ha de tenir format YYYY-MM-DD.', buildEditTitleOptions());
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'time', data: { ...data, date } });
    await context.reply('Escriu l hora en format HH:MM o mantingues el valor actual.', buildEditTitleOptions());
    return true;
  }
  if (stepKey === 'time') {
    const currentTime = event.startsAt.slice(11, 16);
    const time = text === scheduleLabels.keepCurrent ? currentTime : parseTime(text);
    if (time instanceof Error) {
      await context.reply('L hora ha de tenir format HH:MM.', buildEditTitleOptions());
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'duration', data: { ...data, time } });
    await context.reply('Escriu la durada en minuts o mantingues el valor actual.', buildEditDurationOptions());
    return true;
  }
  if (stepKey === 'duration') {
    const durationMinutes = text === scheduleLabels.keepCurrent ? event.durationMinutes : parsePositiveInteger(text);
    if (durationMinutes instanceof Error) {
      await context.reply('La durada ha de ser un enter positiu en minuts.', buildEditDurationOptions());
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'capacity', data: { ...data, durationMinutes } });
    await context.reply('Escriu la capacitat com a numero enter positiu o mantingues el valor actual.', buildEditTitleOptions());
    return true;
  }
  if (stepKey === 'capacity') {
    const capacity = text === scheduleLabels.keepCurrent ? event.capacity : parseCapacity(text);
    if (capacity instanceof Error) {
      await context.reply('La capacitat ha de ser un enter positiu.', buildEditTitleOptions());
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'table', data: { ...data, capacity } });
    await context.reply('Tria una taula opcional, mantingues la taula actual o elimina-la.', await buildEditTableOptions(context));
    return true;
  }
  if (stepKey === 'table') {
    if (text === scheduleLabels.keepCurrent) {
      const nextData = { ...data, tableId: event.tableId };
      await context.runtime.session.advance({ stepKey: 'confirm', data: nextData });
      await context.reply(`${await formatDraftSummary(context, nextData, event.organizerTelegramUserId)}\n\nConfirma o cancel.la el flux.`, buildEditConfirmOptions());
      return true;
    }
    if (text !== scheduleLabels.noTable) {
      await context.reply('Per continuar, tria una taula dels botons, mantingues el valor actual o selecciona Sense taula.', await buildEditTableOptions(context));
      return true;
    }
    const nextData = { ...data, tableId: null };
    await context.runtime.session.advance({ stepKey: 'confirm', data: nextData });
    await context.reply(`${await formatDraftSummary(context, nextData, event.organizerTelegramUserId)}\n\nConfirma o cancel.la el flux.`, buildEditConfirmOptions());
    return true;
  }
  if (stepKey === 'confirm') {
    if (text !== scheduleLabels.confirmEdit) {
      await context.reply('Per guardar els canvis, tria el boto de confirmacio o cancel.la el flux.', buildEditConfirmOptions());
      return true;
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
    await context.runtime.session.cancel();
    await context.reply(
      `Activitat actualitzada correctament: ${updated.title}\n${formatScheduleEventDetails({ event: updated, tableName: await loadTableName(context, updated.tableId) })}`,
      buildScheduleMenuOptions(),
    );
    await notifyScheduleConflicts({ context, eventId: updated.id });
    return true;
  }

  return false;
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
  await context.runtime.session.cancel();
  await context.reply(`Activitat cancel.lada correctament: ${cancelled.title}`, buildScheduleMenuOptions());
  return true;
}

async function handleTableSelectionCallback(context: TelegramScheduleContext, callbackData: string): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || (session.stepKey !== 'table' && session.stepKey !== 'confirm')) {
    return false;
  }

  const tableId = parseTableSelection(callbackData);
  const nextData = { ...session.data, tableId };
  await context.runtime.session.advance({ stepKey: 'confirm', data: nextData });
  const event = session.flowKey === editFlowKey ? await loadEventOrThrow(context, Number(session.data.eventId)) : null;
  await context.reply(
    `${await formatDraftSummary(context, nextData, event?.organizerTelegramUserId)}\n\nConfirma o cancel.la el flux.`,
    session.flowKey === editFlowKey ? buildEditConfirmOptions() : buildCreateConfirmOptions(),
  );
  return true;
}

async function replyWithManageableEventList(
  context: TelegramScheduleContext,
  mode: 'edit' | 'cancel',
): Promise<boolean> {
  const repository = resolveScheduleRepository(context);
  const events = (await listScheduleEvents({ repository })).filter((event) => canManageEvent(context.runtime.actor, context.runtime.authorization, event));
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

async function loadEventOrThrow(context: TelegramScheduleContext, eventId: number): Promise<ScheduleEventRecord> {
  const event = await resolveScheduleRepository(context).findEventById(eventId);
  if (!event) {
    throw new Error(`Schedule event ${eventId} not found`);
  }
  return event;
}

async function loadTableName(context: TelegramScheduleContext, tableId: number | null): Promise<string | null> {
  if (!tableId) {
    return null;
  }
  const table = await resolveTableRepository(context).findTableById(tableId);
  return table?.displayName ?? null;
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
    replyKeyboard: [[scheduleLabels.keepCurrent], [scheduleLabels.cancelFlow]],
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

function buildCancelConfirmOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[scheduleLabels.confirmCancel], [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

async function buildTableSelectionOptions(context: TelegramScheduleContext): Promise<TelegramReplyOptions> {
  const tables = await listClubTables({ repository: resolveTableRepository(context) });
  return {
    inlineKeyboard: [
      [{ text: scheduleLabels.noTable, callbackData: `${scheduleCallbackPrefixes.tableSelection}none` }],
      ...tables.map((table) => [{ text: table.displayName, callbackData: `${scheduleCallbackPrefixes.tableSelection}${table.id}` }]),
    ],
    replyKeyboard: [[scheduleLabels.noTable], [scheduleLabels.cancelFlow]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

async function buildEditTableOptions(context: TelegramScheduleContext): Promise<TelegramReplyOptions> {
  const options = await buildTableSelectionOptions(context);
  return {
    ...options,
    replyKeyboard: [[scheduleLabels.keepCurrent], [scheduleLabels.noTable], [scheduleLabels.cancelFlow]],
  };
}

function formatScheduleListMessage(events: ScheduleEventRecord[]): string {
  return ['Activitats disponibles:'].concat(events.map((event) => `- ${event.title} (${event.startsAt.slice(0, 16).replace('T', ' ')})`)).join('\n');
}

function formatScheduleEventDetails({ event, tableName }: { event: ScheduleEventRecord; tableName: string | null }): string {
  return [
    event.title,
    `Inici: ${event.startsAt.slice(0, 16).replace('T', ' ')}`,
    `Places: ${event.capacity}`,
    `Taula: ${tableName ?? 'Sense taula'}`,
    `Descripcio: ${event.description ?? 'Sense descripcio'}`,
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

  return [
    formatScheduleEventDetails({ event, tableName: await loadTableName(context, event.tableId) }),
    `Final: ${getScheduleEventEndsAt(event).slice(0, 16).replace('T', ' ')}`,
    `Places ocupades: ${attendance.snapshot.occupiedSeats}/${attendance.snapshot.capacity}`,
    `Places lliures: ${attendance.snapshot.availableSeats}`,
    `Assistents: ${attendance.activeParticipantTelegramUserIds.length > 0 ? attendance.activeParticipantTelegramUserIds.join(', ') : 'Cap'}`,
  ].join('\n');
}

async function replyWithInspectableEventList(context: TelegramScheduleContext): Promise<boolean> {
  const events = await listScheduleEvents({ repository: resolveScheduleRepository(context) });
  if (events.length === 0) {
    await context.reply('No hi ha activitats programades ara mateix.', buildScheduleMenuOptions());
    return true;
  }

  await context.reply(formatScheduleListMessage(events), {
    inlineKeyboard: events.map((event) => [{ text: `Veure ${event.title}`, callbackData: `${scheduleCallbackPrefixes.inspect}${event.id}` }]),
  });
  return true;
}

function buildAttendanceActionOptions(
  context: TelegramScheduleContext,
  event: ScheduleEventRecord,
  isAttending: boolean,
): TelegramReplyOptions {
  return {
    inlineKeyboard: [[
      {
        text: isAttending ? 'Sortir' : 'Apuntar-me',
        callbackData: `${isAttending ? scheduleCallbackPrefixes.leave : scheduleCallbackPrefixes.join}${event.id}`,
      },
    ]],
  };
}

async function isActorAttending(context: TelegramScheduleContext, eventId: number): Promise<boolean> {
  const participant = await resolveScheduleRepository(context).findParticipant(eventId, context.runtime.actor.telegramUserId);
  return participant?.status === 'active';
}

async function formatDraftSummary(
  context: TelegramScheduleContext,
  data: Record<string, unknown>,
  organizerTelegramUserId?: number,
): Promise<string> {
  return [
    `Titol: ${String(data.title ?? '')}`,
    `Descripcio: ${asNullableString(data.description) ?? 'Sense descripcio'}`,
    `Inici: ${buildStartsAt(String(data.date ?? ''), String(data.time ?? '')).slice(0, 16).replace('T', ' ')}`,
    `Durada: ${Number(data.durationMinutes)} min`,
    `Places: ${Number(data.capacity)}`,
    `Taula: ${(await loadTableName(context, asNullableNumber(data.tableId))) ?? 'Sense taula'}`,
    ...(organizerTelegramUserId ? [`Organitzador: ${organizerTelegramUserId}`] : []),
  ].join('\n');
}

function parseDate(value: string): string | Error {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Error('invalid-date');
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

function buildStartsAt(date: string, time: string): string {
  return `${date}T${time}:00.000Z`;
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
