import {
  cancelVenueEvent,
  createVenueEvent,
  listVenueEvents,
  updateVenueEvent,
  type VenueEventRecord,
  type VenueEventRepository,
} from '../venue-events/venue-event-catalog.js';
import { createDatabaseVenueEventRepository } from '../venue-events/venue-event-catalog-store.js';
import type { ScheduleRepository } from '../schedule/schedule-catalog.js';
import { createDatabaseScheduleRepository } from '../schedule/schedule-catalog-store.js';
import { buildVenueEventImpactSignal } from '../venue-events/venue-event-impact-signals.js';
import type { TelegramActor } from './actor-store.js';
import type { AuthorizationService } from '../authorization/service.js';
import type { TelegramChatContext } from './chat-context.js';
import type { ConversationSessionRuntime } from './conversation-session.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

const createFlowKey = 'venue-event-admin-create';
const editFlowKey = 'venue-event-admin-edit';
const cancelFlowKey = 'venue-event-admin-cancel';

export const venueEventAdminCallbackPrefixes = {
  inspect: 'venue_event_admin:inspect:',
  edit: 'venue_event_admin:edit:',
  cancel: 'venue_event_admin:cancel:',
} as const;

export const venueEventAdminLabels = {
  openMenu: 'Esdeveniments local',
  create: 'Crear esdeveniment',
  list: 'Llistar esdeveniments',
  edit: 'Editar esdeveniment',
  cancel: 'Cancel.lar esdeveniment',
  skipOptional: 'Ometre',
  keepCurrent: 'Mantenir valor actual',
  allDay: 'Tot el dia',
  specificTime: 'Especificar horari',
  scopePartial: 'Impacte parcial',
  scopeFull: 'Ocupacio total',
  impactLow: 'Impacte baix',
  impactMedium: 'Impacte mig',
  impactHigh: 'Impacte alt',
  confirmCreate: 'Guardar esdeveniment',
  confirmEdit: 'Guardar canvis',
  confirmCancel: 'Confirmar cancel.lacio',
  start: '/start',
  help: '/help',
  cancelFlow: '/cancel',
} as const;

export interface TelegramVenueEventAdminContext {
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
  venueEventRepository?: VenueEventRepository;
  scheduleRepository?: ScheduleRepository;
}

export async function handleTelegramVenueEventAdminText(context: TelegramVenueEventAdminContext): Promise<boolean> {
  const text = context.messageText?.trim();
  if (!text || context.runtime.chat.kind !== 'private' || !canManageVenueEvents(context)) {
    return false;
  }

  if (isVenueEventSession(context.runtime.session.current?.flowKey)) {
    return handleActiveVenueEventSession(context, text);
  }

  if (text === venueEventAdminLabels.openMenu || text === '/venue_events') {
    await context.reply('Gestio d esdeveniments del local: tria una accio.', buildVenueEventMenuOptions());
    return true;
  }

  if (text === venueEventAdminLabels.create || text === '/venue_event_create') {
    await context.runtime.session.start({ flowKey: createFlowKey, stepKey: 'name', data: {} });
    await context.reply('Escriu el nom visible de l esdeveniment del local.', buildSingleCancelKeyboard());
    return true;
  }

  if (text === venueEventAdminLabels.list || text === '/venue_event_list') {
    await replyWithVenueEventList(context, 'list');
    return true;
  }

  if (text === venueEventAdminLabels.edit || text === '/venue_event_edit') {
    await replyWithVenueEventList(context, 'edit');
    return true;
  }

  if (text === venueEventAdminLabels.cancel || text === '/venue_event_cancel') {
    await replyWithVenueEventList(context, 'cancel');
    return true;
  }

  return false;
}

export async function handleTelegramVenueEventAdminCallback(context: TelegramVenueEventAdminContext): Promise<boolean> {
  const callbackData = context.callbackData;
  if (!callbackData || context.runtime.chat.kind !== 'private' || !canManageVenueEvents(context)) {
    return false;
  }

  if (callbackData.startsWith(venueEventAdminCallbackPrefixes.inspect)) {
    const eventId = parseVenueEventId(callbackData, venueEventAdminCallbackPrefixes.inspect);
    const event = await loadVenueEventOrThrow(context, eventId);
    await context.reply(formatVenueEventDetails(event));
    return true;
  }

  if (callbackData.startsWith(venueEventAdminCallbackPrefixes.edit)) {
    const eventId = parseVenueEventId(callbackData, venueEventAdminCallbackPrefixes.edit);
    const event = await loadVenueEventOrThrow(context, eventId);
    await context.runtime.session.start({ flowKey: editFlowKey, stepKey: 'name', data: { eventId } });
    await context.reply(`${formatVenueEventDetails(event)}\n\nEscriu el nou nom o tria una opcio del teclat.`, buildKeepCurrentOptions());
    return true;
  }

  if (callbackData.startsWith(venueEventAdminCallbackPrefixes.cancel)) {
    const eventId = parseVenueEventId(callbackData, venueEventAdminCallbackPrefixes.cancel);
    const event = await loadVenueEventOrThrow(context, eventId);
    await context.runtime.session.start({ flowKey: cancelFlowKey, stepKey: 'confirm', data: { eventId } });
    await context.reply(`${formatVenueEventDetails(event)}\n\nAquest esdeveniment deixara d afectar les vistes operatives futures.`, buildCancelConfirmOptions());
    return true;
  }

  return false;
}

function canManageVenueEvents(context: TelegramVenueEventAdminContext): boolean {
  return context.runtime.actor.isAdmin || context.runtime.authorization.can('venue_event.manage');
}

function isVenueEventSession(flowKey: string | undefined): boolean {
  return flowKey === createFlowKey || flowKey === editFlowKey || flowKey === cancelFlowKey;
}

async function handleActiveVenueEventSession(context: TelegramVenueEventAdminContext, text: string): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session) return false;

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

async function handleCreateSession(context: TelegramVenueEventAdminContext, text: string, stepKey: string, data: Record<string, unknown>): Promise<boolean> {
  if (stepKey === 'name') {
    await context.runtime.session.advance({ stepKey: 'description', data: { name: text } });
    await context.reply('Escriu una descripcio opcional o tria una opcio del teclat.', buildDescriptionOptions());
    return true;
  }
  if (stepKey === 'description') {
    await context.runtime.session.advance({ stepKey: 'start-date', data: { ...data, description: text === venueEventAdminLabels.skipOptional ? null : text } });
    await context.reply('Escriu la data d inici en format dd/MM o dd/MM/yyyy.', buildDateOptions(context));
    return true;
  }
  if (stepKey === 'start-date') {
    const date = parseDate(text);
    if (date instanceof Error) {
      await context.reply('La data ha de tenir format dd/MM o dd/MM/yyyy.', buildDateOptions(context));
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'time-mode', data: { ...data, startDate: date } });
    await context.reply('Vols indicar un esdeveniment de tot el dia o especificar l horari?', buildTimeModeOptions());
    return true;
  }
  if (stepKey === 'time-mode') {
    if (text === venueEventAdminLabels.allDay) {
      await context.runtime.session.advance({
        stepKey: 'scope',
        data: {
          ...data,
          allDay: true,
          startTime: '00:00',
          endDate: String(data.startDate ?? ''),
          endTime: '00:00',
        },
      });
      await context.reply('Selecciona l abast d ocupacio del local.', buildScopeOptions());
      return true;
    }
    if (text !== venueEventAdminLabels.specificTime) {
      await context.reply('Tria una de les opcions del teclat.', buildTimeModeOptions());
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'start-time', data: { ...data, allDay: false } });
    await context.reply('Escriu l hora d inici en format HH:MM.', buildSingleCancelKeyboard());
    return true;
  }
  if (stepKey === 'start-time') {
    const time = parseTime(text);
    if (time instanceof Error) {
      await context.reply('L hora ha de tenir format HH:MM.', buildSingleCancelKeyboard());
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'end-date', data: { ...data, startTime: time } });
    await context.reply('Escriu la data de finalitzacio en format dd/MM o dd/MM/yyyy.', buildDateOptions(context));
    return true;
  }
  if (stepKey === 'end-date') {
    const date = parseDate(text);
    if (date instanceof Error) {
      await context.reply('La data ha de tenir format dd/MM o dd/MM/yyyy.', buildDateOptions(context));
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'end-time', data: { ...data, endDate: date } });
    await context.reply('Escriu l hora de finalitzacio en format HH:MM.', buildSingleCancelKeyboard());
    return true;
  }
  if (stepKey === 'end-time') {
    const time = parseTime(text);
    if (time instanceof Error) {
      await context.reply('L hora ha de tenir format HH:MM.', buildSingleCancelKeyboard());
      return true;
    }
    const nextData = { ...data, endTime: time };
    const rangeError = validateRange(nextData);
    if (rangeError) {
      await context.reply(rangeError, buildSingleCancelKeyboard());
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'scope', data: nextData });
    await context.reply('Selecciona l abast d ocupacio del local.', buildScopeOptions());
    return true;
  }
  if (stepKey === 'scope') {
    const scope = parseScopeLabel(text);
    if (scope instanceof Error) {
      await context.reply('Tria una de les opcions d ocupacio del teclat.', buildScopeOptions());
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'impact', data: { ...data, occupancyScope: scope } });
    await context.reply('Selecciona el nivell d impacte.', buildImpactOptions());
    return true;
  }
  if (stepKey === 'impact') {
    const impactLevel = parseImpactLabel(text);
    if (impactLevel instanceof Error) {
      await context.reply('Tria una de les opcions d impacte del teclat.', buildImpactOptions());
      return true;
    }
    const nextData = { ...data, impactLevel };
    await context.runtime.session.advance({ stepKey: 'confirm', data: nextData });
    await context.reply(`${formatDraftSummary(nextData)}\n\nConfirma o cancel.la el flux.`, buildCreateConfirmOptions());
    return true;
  }
  if (stepKey === 'confirm') {
    if (text !== venueEventAdminLabels.confirmCreate) {
      await context.reply('Per guardar l esdeveniment, tria el boto de confirmacio o cancel.la el flux.', buildCreateConfirmOptions());
      return true;
    }
    const startsAt = data.allDay === true ? buildAllDayStart(String(data.startDate ?? '')) : buildTimestamp(String(data.startDate ?? ''), String(data.startTime ?? ''));
    const endsAt = data.allDay === true ? buildAllDayEnd(String(data.startDate ?? '')) : buildTimestamp(String(data.endDate ?? ''), String(data.endTime ?? ''));
    const created = await createVenueEvent({
      repository: resolveVenueEventRepository(context),
      name: String(data.name ?? ''),
      description: asNullableString(data.description),
      startsAt,
      endsAt,
      occupancyScope: String(data.occupancyScope ?? 'partial') as 'partial' | 'full',
      impactLevel: String(data.impactLevel ?? 'medium') as 'low' | 'medium' | 'high',
    });
    await context.runtime.session.cancel();
    await context.reply(`Esdeveniment del local creat correctament: ${created.name}\n${formatVenueEventDetails(created)}`, buildVenueEventMenuOptions());
    await notifyVenueEventImpact({ context, venueEventId: created.id, changeType: 'created' });
    return true;
  }
  return false;
}

async function handleEditSession(context: TelegramVenueEventAdminContext, text: string, stepKey: string, data: Record<string, unknown>): Promise<boolean> {
  const event = await loadVenueEventOrThrow(context, Number(data.eventId));
  if (stepKey === 'name') {
    await context.runtime.session.advance({ stepKey: 'description', data: { ...data, name: text === venueEventAdminLabels.keepCurrent ? event.name : text } });
    await context.reply('Escriu una descripcio opcional o tria una opcio del teclat.', buildEditDescriptionOptions());
    return true;
  }
  if (stepKey === 'description') {
    await context.runtime.session.advance({ stepKey: 'start-date', data: { ...data, description: text === venueEventAdminLabels.keepCurrent ? event.description : text === venueEventAdminLabels.skipOptional ? null : text } });
    await context.reply('Escriu la data d inici en format dd/MM o dd/MM/yyyy, o mantingues el valor actual.', buildEditDateOptions(context));
    return true;
  }
  if (stepKey === 'start-date') {
    const value = text === venueEventAdminLabels.keepCurrent ? event.startsAt.slice(0, 10) : parseDate(text);
    if (value instanceof Error) {
      await context.reply('La data ha de tenir format dd/MM o dd/MM/yyyy.', buildEditDateOptions(context));
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'time-mode', data: { ...data, startDate: value } });
    await context.reply('Vols indicar un esdeveniment de tot el dia o especificar l horari?', buildEditTimeModeOptions());
    return true;
  }
  if (stepKey === 'time-mode') {
    if (text === venueEventAdminLabels.allDay) {
      await context.runtime.session.advance({
        stepKey: 'scope',
        data: {
          ...data,
          allDay: true,
          startTime: '00:00',
          endDate: String(data.startDate ?? event.startsAt.slice(0, 10)),
          endTime: '00:00',
        },
      });
      await context.reply('Selecciona l abast d ocupacio del local o mantingues el valor actual.', buildEditScopeOptions());
      return true;
    }
    if (text !== venueEventAdminLabels.specificTime) {
      await context.reply('Tria una de les opcions del teclat.', buildEditTimeModeOptions());
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'start-time', data: { ...data, allDay: false } });
    await context.reply('Escriu l hora d inici en format HH:MM o mantingues el valor actual.', buildKeepCurrentOptions());
    return true;
  }
  if (stepKey === 'start-time') {
    const value = text === venueEventAdminLabels.keepCurrent ? event.startsAt.slice(11, 16) : parseTime(text);
    if (value instanceof Error) {
      await context.reply('L hora ha de tenir format HH:MM.', buildKeepCurrentOptions());
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'end-date', data: { ...data, startTime: value } });
    await context.reply('Escriu la data de finalitzacio en format dd/MM o dd/MM/yyyy, o mantingues el valor actual.', buildEditDateOptions(context));
    return true;
  }
  if (stepKey === 'end-date') {
    const value = text === venueEventAdminLabels.keepCurrent ? event.endsAt.slice(0, 10) : parseDate(text);
    if (value instanceof Error) {
      await context.reply('La data ha de tenir format dd/MM o dd/MM/yyyy.', buildEditDateOptions(context));
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'end-time', data: { ...data, endDate: value } });
    await context.reply('Escriu l hora de finalitzacio en format HH:MM o mantingues el valor actual.', buildKeepCurrentOptions());
    return true;
  }
  if (stepKey === 'end-time') {
    const value = text === venueEventAdminLabels.keepCurrent ? event.endsAt.slice(11, 16) : parseTime(text);
    if (value instanceof Error) {
      await context.reply('L hora ha de tenir format HH:MM.', buildKeepCurrentOptions());
      return true;
    }
    const nextData = { ...data, endTime: value };
    const rangeError = validateRange(nextData);
    if (rangeError) {
      await context.reply(rangeError, buildKeepCurrentOptions());
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'scope', data: nextData });
    await context.reply('Selecciona l abast d ocupacio del local o mantingues el valor actual.', buildEditScopeOptions());
    return true;
  }
  if (stepKey === 'scope') {
    const value = text === venueEventAdminLabels.keepCurrent ? event.occupancyScope : parseScopeLabel(text);
    if (value instanceof Error) {
      await context.reply('Tria una de les opcions d ocupacio del teclat.', buildEditScopeOptions());
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'impact', data: { ...data, occupancyScope: value } });
    await context.reply('Selecciona el nivell d impacte o mantingues el valor actual.', buildEditImpactOptions());
    return true;
  }
  if (stepKey === 'impact') {
    const value = text === venueEventAdminLabels.keepCurrent ? event.impactLevel : parseImpactLabel(text);
    if (value instanceof Error) {
      await context.reply('Tria una de les opcions d impacte del teclat.', buildEditImpactOptions());
      return true;
    }
    const nextData = { ...data, impactLevel: value };
    await context.runtime.session.advance({ stepKey: 'confirm', data: nextData });
    await context.reply(`${formatDraftSummary(nextData)}\n\nConfirma o cancel.la el flux.`, buildEditConfirmOptions());
    return true;
  }
  if (stepKey === 'confirm') {
    if (text !== venueEventAdminLabels.confirmEdit) {
      await context.reply('Per guardar els canvis, tria el boto de confirmacio o cancel.la el flux.', buildEditConfirmOptions());
      return true;
    }
    const updated = await updateVenueEvent({
      repository: resolveVenueEventRepository(context),
      eventId: event.id,
      name: String(data.name ?? event.name),
      description: asNullableString(data.description),
      startsAt: data.allDay === true ? buildAllDayStart(String(data.startDate ?? event.startsAt.slice(0, 10))) : buildTimestamp(String(data.startDate ?? event.startsAt.slice(0, 10)), String(data.startTime ?? event.startsAt.slice(11, 16))),
      endsAt: data.allDay === true ? buildAllDayEnd(String(data.startDate ?? event.startsAt.slice(0, 10))) : buildTimestamp(String(data.endDate ?? event.endsAt.slice(0, 10)), String(data.endTime ?? event.endsAt.slice(11, 16))),
      occupancyScope: String(data.occupancyScope ?? event.occupancyScope) as 'partial' | 'full',
      impactLevel: String(data.impactLevel ?? event.impactLevel) as 'low' | 'medium' | 'high',
    });
    await context.runtime.session.cancel();
    await context.reply(`Esdeveniment del local actualitzat correctament: ${updated.name}\n${formatVenueEventDetails(updated)}`, buildVenueEventMenuOptions());
    await notifyVenueEventImpact({ context, venueEventId: updated.id, changeType: 'updated' });
    return true;
  }
  return false;
}

async function handleCancelSession(context: TelegramVenueEventAdminContext, text: string, data: Record<string, unknown>): Promise<boolean> {
  if (text !== venueEventAdminLabels.confirmCancel) {
    await context.reply('Per cancel.lar l esdeveniment, tria el boto de confirmacio o cancel.la el flux.', buildCancelConfirmOptions());
    return true;
  }
  const cancelled = await cancelVenueEvent({ repository: resolveVenueEventRepository(context), eventId: Number(data.eventId) });
  await context.runtime.session.cancel();
  await context.reply(`Esdeveniment del local cancel.lat correctament: ${cancelled.name}`, buildVenueEventMenuOptions());
  await notifyVenueEventImpact({ context, venueEventId: cancelled.id, changeType: 'cancelled' });
  return true;
}

async function replyWithVenueEventList(context: TelegramVenueEventAdminContext, mode: 'list' | 'edit' | 'cancel'): Promise<void> {
  const events = await listVenueEvents({ repository: resolveVenueEventRepository(context) });
  if (events.length === 0) {
    await context.reply('No hi ha esdeveniments del local actius ara mateix.', buildVenueEventMenuOptions());
    return;
  }
  await context.reply(formatVenueEventListMessage(events), {
    inlineKeyboard: events.map((event) => [{
      text: `${mode === 'list' ? 'Veure' : mode === 'edit' ? 'Editar' : 'Cancel.lar'} ${event.name}`,
      callbackData: `${mode === 'list' ? venueEventAdminCallbackPrefixes.inspect : mode === 'edit' ? venueEventAdminCallbackPrefixes.edit : venueEventAdminCallbackPrefixes.cancel}${event.id}`,
    }]),
  });
}

function resolveVenueEventRepository(context: TelegramVenueEventAdminContext): VenueEventRepository {
  if (context.venueEventRepository) return context.venueEventRepository;
  return createDatabaseVenueEventRepository({ database: context.runtime.services.database.db as never });
}

function resolveScheduleRepository(context: TelegramVenueEventAdminContext): ScheduleRepository {
  if (context.scheduleRepository) return context.scheduleRepository;
  return createDatabaseScheduleRepository({ database: context.runtime.services.database.db as never });
}

async function loadVenueEventOrThrow(context: TelegramVenueEventAdminContext, eventId: number): Promise<VenueEventRecord> {
  const event = await resolveVenueEventRepository(context).findVenueEventById(eventId);
  if (!event) throw new Error(`Venue event ${eventId} not found`);
  return event;
}

function buildVenueEventMenuOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[venueEventAdminLabels.create, venueEventAdminLabels.list], [venueEventAdminLabels.edit, venueEventAdminLabels.cancel], [venueEventAdminLabels.start, venueEventAdminLabels.help]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildSingleCancelKeyboard(): TelegramReplyOptions {
  return { replyKeyboard: [[venueEventAdminLabels.cancelFlow]], resizeKeyboard: true, persistentKeyboard: true };
}
function buildDescriptionOptions(): TelegramReplyOptions {
  return { replyKeyboard: [[venueEventAdminLabels.skipOptional], [venueEventAdminLabels.cancelFlow]], resizeKeyboard: true, persistentKeyboard: true };
}
function buildDateOptions(context: TelegramVenueEventAdminContext): TelegramReplyOptions {
  return { replyKeyboard: [...buildUpcomingDateRows(resolveBotLanguage(context)), [venueEventAdminLabels.cancelFlow]], resizeKeyboard: true, persistentKeyboard: true };
}
function buildTimeModeOptions(): TelegramReplyOptions {
  return { replyKeyboard: [[venueEventAdminLabels.allDay, venueEventAdminLabels.specificTime], [venueEventAdminLabels.cancelFlow]], resizeKeyboard: true, persistentKeyboard: true };
}
function buildEditDateOptions(context: TelegramVenueEventAdminContext): TelegramReplyOptions {
  return { replyKeyboard: [[venueEventAdminLabels.keepCurrent], ...buildUpcomingDateRows(resolveBotLanguage(context)), [venueEventAdminLabels.cancelFlow]], resizeKeyboard: true, persistentKeyboard: true };
}
function buildEditTimeModeOptions(): TelegramReplyOptions {
  return { replyKeyboard: [[venueEventAdminLabels.allDay, venueEventAdminLabels.specificTime], [venueEventAdminLabels.cancelFlow]], resizeKeyboard: true, persistentKeyboard: true };
}
function buildKeepCurrentOptions(): TelegramReplyOptions {
  return { replyKeyboard: [[venueEventAdminLabels.keepCurrent], [venueEventAdminLabels.cancelFlow]], resizeKeyboard: true, persistentKeyboard: true };
}
function buildEditDescriptionOptions(): TelegramReplyOptions {
  return { replyKeyboard: [[venueEventAdminLabels.keepCurrent], [venueEventAdminLabels.skipOptional], [venueEventAdminLabels.cancelFlow]], resizeKeyboard: true, persistentKeyboard: true };
}
function buildScopeOptions(): TelegramReplyOptions {
  return { replyKeyboard: [[venueEventAdminLabels.scopePartial, venueEventAdminLabels.scopeFull], [venueEventAdminLabels.cancelFlow]], resizeKeyboard: true, persistentKeyboard: true };
}
function buildEditScopeOptions(): TelegramReplyOptions {
  return { replyKeyboard: [[venueEventAdminLabels.keepCurrent], [venueEventAdminLabels.scopePartial, venueEventAdminLabels.scopeFull], [venueEventAdminLabels.cancelFlow]], resizeKeyboard: true, persistentKeyboard: true };
}
function buildImpactOptions(): TelegramReplyOptions {
  return { replyKeyboard: [[venueEventAdminLabels.impactLow, venueEventAdminLabels.impactMedium, venueEventAdminLabels.impactHigh], [venueEventAdminLabels.cancelFlow]], resizeKeyboard: true, persistentKeyboard: true };
}
function buildEditImpactOptions(): TelegramReplyOptions {
  return { replyKeyboard: [[venueEventAdminLabels.keepCurrent], [venueEventAdminLabels.impactLow, venueEventAdminLabels.impactMedium, venueEventAdminLabels.impactHigh], [venueEventAdminLabels.cancelFlow]], resizeKeyboard: true, persistentKeyboard: true };
}
function buildCreateConfirmOptions(): TelegramReplyOptions {
  return { replyKeyboard: [[venueEventAdminLabels.confirmCreate], [venueEventAdminLabels.cancelFlow]], resizeKeyboard: true, persistentKeyboard: true };
}
function buildEditConfirmOptions(): TelegramReplyOptions {
  return { replyKeyboard: [[venueEventAdminLabels.confirmEdit], [venueEventAdminLabels.cancelFlow]], resizeKeyboard: true, persistentKeyboard: true };
}
function buildCancelConfirmOptions(): TelegramReplyOptions {
  return { replyKeyboard: [[venueEventAdminLabels.confirmCancel], [venueEventAdminLabels.cancelFlow]], resizeKeyboard: true, persistentKeyboard: true };
}

function formatVenueEventListMessage(events: VenueEventRecord[]): string {
  return ['Esdeveniments del local:'].concat(events.map((event) => `- ${event.name} (${formatVenueEventTimeSummary(event)})`)).join('\n');
}

function formatVenueEventDetails(event: VenueEventRecord): string {
  return [event.name, `Horari: ${formatVenueEventTimeSummary(event)}`, `Ocupacio: ${event.occupancyScope}`, `Impacte: ${event.impactLevel}`, `Descripcio: ${event.description ?? 'Sense descripcio'}`].join('\n');
}

function formatDraftSummary(data: Record<string, unknown>): string {
  const allDay = data.allDay === true;
  return [
    `Nom: ${String(data.name ?? '')}`,
    `Descripcio: ${asNullableString(data.description) ?? 'Sense descripcio'}`,
    `Horari: ${allDay ? `Tot el dia (${formatVenueEventDateLabel(String(data.startDate ?? ''))})` : `${formatTimestamp(buildTimestamp(String(data.startDate ?? ''), String(data.startTime ?? '')))} - ${formatTimestamp(buildTimestamp(String(data.endDate ?? ''), String(data.endTime ?? '')))}`}`,
    `Ocupacio: ${String(data.occupancyScope ?? '')}`,
    `Impacte: ${String(data.impactLevel ?? '')}`,
  ].join('\n');
}

function parseVenueEventId(callbackData: string, prefix: string): number {
  const candidate = Number(callbackData.slice(prefix.length));
  if (!Number.isInteger(candidate) || candidate <= 0) throw new Error('No s ha pogut identificar l esdeveniment seleccionat.');
  return candidate;
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
function parseTime(value: string): string | Error { return /^\d{2}:\d{2}$/.test(value) ? value : new Error('invalid-time'); }
function parseScopeLabel(value: string): 'partial' | 'full' | Error {
  if (value === venueEventAdminLabels.scopePartial) return 'partial';
  if (value === venueEventAdminLabels.scopeFull) return 'full';
  return new Error('invalid-scope');
}
function parseImpactLabel(value: string): 'low' | 'medium' | 'high' | Error {
  if (value === venueEventAdminLabels.impactLow) return 'low';
  if (value === venueEventAdminLabels.impactMedium) return 'medium';
  if (value === venueEventAdminLabels.impactHigh) return 'high';
  return new Error('invalid-impact');
}
function buildTimestamp(date: string, time: string): string { return `${date}T${time}:00.000Z`; }
function buildAllDayStart(date: string): string { return buildTimestamp(date, '00:00'); }
function buildAllDayEnd(date: string): string {
  const end = new Date(buildTimestamp(date, '00:00'));
  end.setUTCDate(end.getUTCDate() + 1);
  return end.toISOString();
}
function validateRange(data: Record<string, unknown>): string | null {
  const startsAt = new Date(buildTimestamp(String(data.startDate ?? ''), String(data.startTime ?? ''))).getTime();
  const endsAt = new Date(buildTimestamp(String(data.endDate ?? ''), String(data.endTime ?? ''))).getTime();
  return endsAt <= startsAt ? 'El final ha de ser posterior a l inici.' : null;
}
function formatTimestamp(value: string): string { return value.slice(0, 16).replace('T', ' '); }
function asNullableString(value: unknown): string | null { return typeof value === 'string' ? value : null; }

function formatVenueEventTimeSummary(event: VenueEventRecord): string {
  if (isAllDayVenueEvent(event)) {
    return `Tot el dia (${formatVenueEventDateLabel(event.startsAt.slice(0, 10))})`;
  }
  return `${formatTimestamp(event.startsAt)} - ${formatTimestamp(event.endsAt)}`;
}

function isAllDayVenueEvent(event: VenueEventRecord): boolean {
  const starts = new Date(event.startsAt);
  const ends = new Date(event.endsAt);
  return starts.getUTCHours() === 0 && starts.getUTCMinutes() === 0 && ends.getUTCHours() === 0 && ends.getUTCMinutes() === 0 && ends.getTime() - starts.getTime() === 24 * 60 * 60 * 1000;
}

function formatVenueEventDateLabel(value: string): string {
  return value.split('-').reverse().join('/');
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
  const weekday = new Intl.DateTimeFormat(resolveLanguageLocale(language), { weekday: 'long', timeZone: 'UTC' }).format(date);
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

function resolveBotLanguage(context: TelegramVenueEventAdminContext): string {
  return context.runtime.bot.language ?? 'ca';
}

async function notifyVenueEventImpact({
  context,
  venueEventId,
  changeType,
}: {
  context: TelegramVenueEventAdminContext;
  venueEventId: number;
  changeType: 'created' | 'updated' | 'cancelled';
}): Promise<void> {
  const signal = await buildVenueEventImpactSignal({
    venueEventRepository: resolveVenueEventRepository(context),
    scheduleRepository: resolveScheduleRepository(context),
    venueEventId,
    changeType,
    actorTelegramUserId: context.runtime.actor.telegramUserId,
  });

  if (signal.impactedTelegramUserIds.length === 0) {
    return;
  }

  const affectedSchedules = signal.affectedScheduleEvents
    .map((event) => `${event.title} (${formatTimestamp(event.startsAt)} - ${formatTimestamp(new Date(new Date(event.startsAt).getTime() + event.durationMinutes * 60000).toISOString())})`)
    .join('\n- ');

  const intro =
    changeType === 'cancelled'
      ? 'Ja no hi ha impacte actiu del local per aquest esdeveniment.'
      : 'S ha detectat un possible conflicte amb l ocupacio del local.';

  await Promise.all(
    signal.impactedTelegramUserIds.map((telegramUserId) =>
      context.runtime.bot.sendPrivateMessage(
        telegramUserId,
        [
          intro,
          `Esdeveniment del local: ${signal.venueEvent.name} (${formatTimestamp(signal.venueEvent.startsAt)} - ${formatTimestamp(signal.venueEvent.endsAt)})`,
          `Activitats afectades:\n- ${affectedSchedules}`,
        ].join('\n'),
      ),
    ),
  );
}
