import { createDatabaseCatalogLoanRepository } from '../catalog/catalog-loan-store.js';
import { createDatabaseCatalogRepository } from '../catalog/catalog-store.js';
import { createDatabaseGroupPurchaseRepository } from '../group-purchases/group-purchase-catalog-store.js';
import { createDatabaseLfgRepository } from '../lfg/lfg-catalog-store.js';
import { createDatabaseNewsGroupRepository } from '../news/news-group-store.js';
import { createDatabaseNoticeRepository } from '../notices/notice-catalog-store.js';
import { createDatabaseScheduleRepository } from '../schedule/schedule-catalog-store.js';
import { createDatabaseStorageRepository } from '../storage/storage-catalog-store.js';
import type { StorageEntryDetailRecord } from '../storage/storage-catalog.js';
import type { TelegramLlmCommandContext } from './llm-command-flow.js';
import type { LlmCommandIntent } from './llm-command-actions.js';
import { buildTelegramStartUrl } from './deep-links.js';
import { escapeHtml } from './schedule-presentation.js';

const maxPublicResults = 5;

export async function executeTelegramLlmReadAction(
  context: TelegramLlmCommandContext,
  input: {
    intent: string;
    params: Record<string, unknown>;
    userText?: string;
    progress?: { update(message: string): Promise<boolean> };
  },
): Promise<string> {
  const intent = input.intent as LlmCommandIntent;
  switch (intent) {
    case 'help.capabilities':
      return 'Puedes preguntarme por actividades, catálogo, Storage, compras conjuntas, avisos, préstamos, LFG y estado básico de noticias.';
    case 'schedule.today':
      return renderScheduleEvents(await listScheduleToday(context), 'Actividades de hoy');
    case 'schedule.upcoming':
    case 'schedule.search':
      return renderScheduleEvents(await listScheduleUpcoming(context, input.params), scheduleTitle(input.params));
    case 'catalog.search':
      return renderCatalogItems(await searchCatalog(context, textParam(input.params, 'query')), 'Resultados del catálogo');
    case 'catalog.detail':
      return renderCatalogItems(await searchCatalog(context, textParam(input.params, 'query')), 'Detalle del catálogo');
    case 'catalog.loan.list':
      return renderCatalogLoans(await listCatalogLoans(context), 'Tus préstamos activos');
    case 'storage.search':
      return renderStorageEntries(await searchStorage(context, input.params, input.userText, input.progress), 'Resultados de Storage');
    case 'storage.category.list':
      return renderStorageCategories(await listStorageCategories(context), 'Categorías de Storage');
    case 'storage.entry.detail':
      return renderStorageEntries(await searchStorage(context, input.params, input.userText, input.progress), 'Detalle de Storage');
    case 'notice.list':
      return renderNotices(await listActiveNotices(context), 'Avisos activos');
    case 'group_purchase.list':
      return renderGroupPurchases(await listOpenGroupPurchases(context), 'Compras conjuntas abiertas');
    case 'group_purchase.detail':
      return renderGroupPurchases(await listOpenGroupPurchases(context, textParam(input.params, 'query')), 'Detalle de compra conjunta');
    case 'lfg.list':
      return renderLfg(await listLfg(context), 'Búsquedas LFG activas');
    case 'news.status':
      return renderNewsStatus(await listNewsStatus(context));
    default:
      return 'Esta lectura todavía no está conectada al asistente. Usa el menú normal para continuar.';
  }
}

async function listScheduleToday(context: TelegramLlmCommandContext) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return createDatabaseScheduleRepository({ database: context.runtime.services.database.db }).listEvents({
    includeCancelled: false,
    startsAtFrom: start.toISOString(),
    startsAtTo: end.toISOString(),
  });
}

async function listScheduleUpcoming(context: TelegramLlmCommandContext, params: Record<string, unknown>) {
  const dateRange = textParam(params, 'dateRange');
  const from = dateRange === 'this_week' ? startOfToday() : new Date();
  const to = dateRange === 'this_week' ? endOfCurrentWeek(from) : null;
  const events = await createDatabaseScheduleRepository({ database: context.runtime.services.database.db }).listEvents({
    includeCancelled: false,
    startsAtFrom: from.toISOString(),
    ...(to ? { startsAtTo: to.toISOString() } : {}),
  });
  return filterByQuery(events, textParam(params, 'query'), (event) => [event.title, event.description]);
}

async function searchCatalog(context: TelegramLlmCommandContext, query: string | null) {
  const repository = createDatabaseCatalogRepository({ database: context.runtime.services.database.db });
  const items = await repository.listItems({ includeDeactivated: false });
  return filterByQuery(items, query, (item) => [
    item.displayName,
    item.originalName,
    item.description,
    item.publisher,
    item.itemType,
  ]);
}

async function listCatalogLoans(context: TelegramLlmCommandContext) {
  const repository = createDatabaseCatalogLoanRepository({ database: context.runtime.services.database.db });
  if (repository.listActiveLoansWithItemsByBorrower) {
    return repository.listActiveLoansWithItemsByBorrower(context.runtime.actor.telegramUserId);
  }
  return repository.listActiveLoansWithItems();
}

async function listStorageCategories(context: TelegramLlmCommandContext) {
  const categories = await createDatabaseStorageRepository({ database: context.runtime.services.database.db }).listCategories();
  return categories.filter((category) => category.lifecycleStatus === 'active' && category.categoryPurpose === 'user_uploads');
}

async function searchStorage(
  context: TelegramLlmCommandContext,
  params: Record<string, unknown>,
  userText?: string,
  progress?: { update(message: string): Promise<boolean> },
) {
  const repository = createDatabaseStorageRepository({ database: context.runtime.services.database.db });
  const categories = await listStorageCategories(context);
  const query = textParam(params, 'query') ?? textParam(params, 'tag') ?? '';
  const raw = query
    ? await repository.searchEntryDetails({ categoryIds: categories.map((category) => category.id), query })
    : (await Promise.all(categories.map((category) => repository.listEntryDetailsByCategory(category.id)))).flat();
  const fileExtensions = arrayParam(params, 'fileExtensions').map((extension) => extension.replace(/^\./, '').toLowerCase());
  const details = raw
    .filter((detail) => detail.entry.lifecycleStatus === 'active')
    .filter((detail) => fileExtensions.length === 0 || detail.messages.some((message) => {
      const fileName = message.originalFileName?.toLowerCase() ?? '';
      return fileExtensions.some((extension) => fileName.endsWith(`.${extension}`));
    }));
  return refineStorageSearchWithLlm(context, {
    userText: userText ?? query,
    query,
    params,
    details,
    ...(progress ? { progress } : {}),
  });
}

async function listActiveNotices(context: TelegramLlmCommandContext) {
  return createDatabaseNoticeRepository({ database: context.runtime.services.database.db }).listActiveNotices({
    limit: 20,
  });
}

async function listOpenGroupPurchases(context: TelegramLlmCommandContext, query: string | null = null) {
  const purchases = await createDatabaseGroupPurchaseRepository({ database: context.runtime.services.database.db }).listPurchases();
  return filterByQuery(
    purchases.filter((purchase) => purchase.lifecycleStatus === 'open'),
    query,
    (purchase) => [purchase.title, purchase.description],
  );
}

async function listLfg(context: TelegramLlmCommandContext) {
  const repository = createDatabaseLfgRepository({ database: context.runtime.services.database.db });
  const [players, groups] = await Promise.all([
    repository.listActivePlayerAds(),
    repository.listActiveGroupAds(),
  ]);
  return { players, groups };
}

async function listNewsStatus(context: TelegramLlmCommandContext) {
  if (context.runtime.chat.kind === 'private') {
    const groups = await createDatabaseNewsGroupRepository({ database: context.runtime.services.database.db }).listGroups();
    return { enabledGroups: groups.filter((group) => group.isEnabled).length };
  }
  const subscriptions = await createDatabaseNewsGroupRepository({ database: context.runtime.services.database.db }).listSubscriptionsByChatId(
    context.runtime.chat.chatId,
    { messageThreadId: context.messageThreadId ?? null },
  );
  return { subscriptions: subscriptions.map((subscription) => subscription.categoryKey) };
}

function renderScheduleEvents(events: Array<{ id: number; title: string; startsAt: string; capacity: number }>, title: string): string {
  if (events.length === 0) {
    return `${title}: no hay resultados.`;
  }
  return renderList(title, events, (event) => `${linkToStart(`schedule_event_${event.id}`, event.title)} - ${escapeHtml(formatDateTime(event.startsAt))} (${event.capacity} plazas)`);
}

function renderCatalogItems(items: Array<{ id: number; displayName: string; originalName: string | null; itemType: string }>, title: string): string {
  if (items.length === 0) {
    return `${title}: no hay resultados.`;
  }
  return renderList(
    title,
    items,
    (item) => `${linkToStart(`catalog_read_item_${item.id}`, item.displayName)}${item.originalName ? ` (${escapeHtml(item.originalName)})` : ''} - ${escapeHtml(item.itemType)}`,
    linkToStart('catalog_read', 'Abrir catálogo completo'),
  );
}

function renderCatalogLoans(loans: Array<{ itemDisplayName?: string; itemId: number; dueAt: string | null }>, title: string): string {
  if (loans.length === 0) {
    return `${title}: no hay préstamos activos.`;
  }
  return renderList(title, loans, (loan) => `${linkToStart(`catalog_read_item_${loan.itemId}`, loan.itemDisplayName ?? `Item ${loan.itemId}`)}${loan.dueAt ? ` - vence ${escapeHtml(formatDate(loan.dueAt))}` : ''}`);
}

function renderStorageCategories(categories: Array<{ id: number; displayName: string }>, title: string): string {
  if (categories.length === 0) {
    return `${title}: no hay categorías visibles.`;
  }
  return renderList(title, categories, (category) => linkToStart(`storage_category_${category.id}`, category.displayName));
}

function renderStorageEntries(entries: Array<{ entry: { id: number; description: string | null; tags: string[] }; category: { id: number; displayName: string }; messages: Array<{ originalFileName: string | null; attachmentKind: string }> }>, title: string): string {
  if (entries.length === 0) {
    return `${title}: no hay resultados.`;
  }
  return renderList(
    title,
    entries,
    (detail) => {
      const fileName = detail.messages.find((message) => message.originalFileName)?.originalFileName;
      const kind = detail.messages[0]?.attachmentKind ?? 'entrada';
      return `${linkToStart(`storage_entry_${detail.entry.id}`, detail.entry.description ?? fileName ?? kind)} - ${escapeHtml(detail.category.displayName)}`;
    },
    resolveStorageMoreLink(entries),
  );
}

function renderNotices(notices: Array<{ text: string; creatorDisplayName: string; expiresAt: string | null }>, title: string): string {
  if (notices.length === 0) {
    return `${title}: no hay avisos activos.`;
  }
  return renderList(title, notices, (notice) => `${escapeHtml(notice.text.slice(0, 80))} - ${escapeHtml(notice.creatorDisplayName)}${notice.expiresAt ? ` (vence ${escapeHtml(formatDate(notice.expiresAt))})` : ''}`);
}

function renderGroupPurchases(purchases: Array<{ id: number; title: string; joinDeadlineAt: string | null }>, title: string): string {
  if (purchases.length === 0) {
    return `${title}: no hay compras abiertas.`;
  }
  return renderList(title, purchases, (purchase) => `${linkToStart(`group_purchase_${purchase.id}`, purchase.title)}${purchase.joinDeadlineAt ? ` - apuntarse hasta ${escapeHtml(formatDate(purchase.joinDeadlineAt))}` : ''}`);
}

function renderLfg(lfg: { players: Array<{ displayName: string; description: string }>; groups: Array<{ title: string; seatsAvailable: number | null }> }, title: string): string {
  const rows = [
    ...lfg.players.map((player) => `Jugador: ${escapeHtml(player.displayName)} - ${escapeHtml(player.description.slice(0, 80))}`),
    ...lfg.groups.map((group) => `Grupo: ${escapeHtml(group.title)}${group.seatsAvailable !== null ? ` (${group.seatsAvailable} plazas)` : ''}`),
  ];
  if (rows.length === 0) {
    return `${title}: no hay búsquedas activas.`;
  }
  return renderList(title, rows, (row) => row);
}

function renderNewsStatus(status: { enabledGroups?: number; subscriptions?: string[] }): string {
  if (status.subscriptions) {
    return status.subscriptions.length === 0
      ? 'Este chat no tiene suscripciones /news activas en este contexto.'
      : `Suscripciones /news activas aquí: ${status.subscriptions.map(escapeHtml).join(', ')}.`;
  }
  return `Hay ${status.enabledGroups ?? 0} grupos con /news habilitado.`;
}

function renderList<T>(title: string, rows: T[], format: (row: T) => string, moreLink: string | null = null): string {
  const shown = rows.slice(0, maxPublicResults);
  const suffix = rows.length > shown.length
    ? `\n\nHay ${rows.length - shown.length} resultados más.${moreLink ? ` ${moreLink}.` : ''}`
    : '';
  return `${escapeHtml(title)}:\n\n${shown.map((row, index) => `${index + 1}. ${format(row)}`).join('\n')}${suffix}`;
}

function linkToStart(payload: string, label: string): string {
  return `<a href="${escapeHtml(buildTelegramStartUrl(payload))}">${escapeHtml(label)}</a>`;
}

function resolveStorageMoreLink(entries: Array<{ category: { id: number; displayName: string } }>): string {
  const firstCategory = entries[0]?.category;
  if (firstCategory && entries.every((entry) => entry.category.id === firstCategory.id)) {
    return linkToStart(`storage_category_${firstCategory.id}`, `Ver todos en ${firstCategory.displayName}`);
  }
  return linkToStart('storage_root', 'Abrir Storage');
}

async function refineStorageSearchWithLlm(
  context: TelegramLlmCommandContext,
  input: {
    userText: string;
    query: string;
    params: Record<string, unknown>;
    details: StorageEntryDetailRecord[];
    progress?: { update(message: string): Promise<boolean> };
  },
): Promise<StorageEntryDetailRecord[]> {
  const service = context.runtime.llmCommandService;
  if (!service?.generateJson || !input.query || input.details.length === 0) {
    return input.details;
  }

  const candidates = input.details.slice(0, 40);
  await input.progress?.update('He encontrado candidatos en Storage. Estoy filtrando los que encajan con lo que has pedido...');
  const prompt = buildStorageRefinementPrompt({
    userText: input.userText,
    userQuery: input.query,
    params: input.params,
    candidates,
  });
  try {
    const parsed = await runStorageRefinementWithProgress(
      () => service.generateJson(prompt),
      input.progress,
    );
    const selectedIds = parseStorageRefinementIds(parsed, new Set(candidates.map((detail) => detail.entry.id)));
    if (selectedIds === null) {
      return input.details;
    }
    const selected = input.details.filter((detail) => selectedIds.has(detail.entry.id));
    return selected;
  } catch {
    return input.details;
  }
}

async function runStorageRefinementWithProgress<T>(
  task: () => Promise<T>,
  progress?: { update(message: string): Promise<boolean> },
): Promise<T> {
  if (!progress) {
    return task();
  }
  let index = 0;
  let editInFlight = false;
  const messages = [
    'Sigo revisando los candidatos de Storage...',
    'Estoy comparando descripción, categoría, tags y archivos...',
    'La revisión semántica está tardando más de lo normal...',
  ];
  const interval = setInterval(() => {
    const message = messages[Math.min(index, messages.length - 1)];
    index += 1;
    if (!message || editInFlight) {
      return;
    }
    editInFlight = true;
    void progress.update(message).finally(() => {
      editInFlight = false;
    });
  }, 8000);
  try {
    return await task();
  } finally {
    clearInterval(interval);
  }
}

function buildStorageRefinementPrompt(input: {
  userText: string;
  userQuery: string;
  params: Record<string, unknown>;
  candidates: StorageEntryDetailRecord[];
}): string {
  return [
    'Eres un filtro semantico para resultados de Storage de un club.',
    'Tu unica tarea es elegir que candidatos coinciden realmente con lo que pide el usuario.',
    'Storage mezcla STL para impresion 3D, libros, manuales, aventuras, fichas, mapas, imagenes y otros archivos.',
    'Si el usuario pide libros/manuales/material de rol/PDF/documentos, no selecciones miniaturas, estatuas, dioramas o modelos STL salvo que tambien sean claramente el material pedido.',
    'Si el usuario pide STL/modelos/miniaturas/impresion 3D, selecciona modelos STL relevantes.',
    'Devuelve solo JSON valido con esta forma: {"selectedIds":[1,2,3],"reason":"breve"}.',
    'Usa selectedIds=[] si ningun candidato encaja.',
    '',
    `Peticion original del usuario: ${input.userText}`,
    `Busqueda textual usada para obtener candidatos: ${input.userQuery}`,
    `Parametros interpretados: ${JSON.stringify(input.params)}`,
    'Candidatos:',
    JSON.stringify(input.candidates.map(formatStorageRefinementCandidate)),
  ].join('\n');
}

function formatStorageRefinementCandidate(detail: StorageEntryDetailRecord): Record<string, unknown> {
  return {
    id: detail.entry.id,
    description: detail.entry.description,
    category: detail.category.displayName,
    categoryDescription: detail.category.description,
    sourceKind: detail.entry.sourceKind,
    tags: detail.entry.tags,
    files: detail.messages.slice(0, 6).map((message) => ({
      attachmentKind: message.attachmentKind,
      fileName: message.originalFileName,
      caption: message.caption,
      mimeType: message.mimeType,
    })),
  };
}

function parseStorageRefinementIds(parsed: unknown, allowedIds: Set<number>): Set<number> | null {
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { selectedIds?: unknown }).selectedIds)) {
    return null;
  }
  const ids = new Set<number>();
  for (const value of (parsed as { selectedIds: unknown[] }).selectedIds) {
    const id = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (Number.isInteger(id) && allowedIds.has(id)) {
      ids.add(id);
    }
  }
  return ids;
}

function filterByQuery<T>(items: T[], query: string | null, fields: (item: T) => Array<string | null | undefined>): T[] {
  const normalizedQuery = normalizeSearchText(query ?? '');
  if (!normalizedQuery) {
    return items;
  }
  return items.filter((item) => fields(item).some((field) => normalizeSearchText(field ?? '').includes(normalizedQuery)));
}

function textParam(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function scheduleTitle(params: Record<string, unknown>): string {
  return textParam(params, 'dateRange') === 'this_week' ? 'Actividades de esta semana' : 'Próximas actividades';
}

function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfCurrentWeek(from: Date): Date {
  const end = new Date(from);
  const day = end.getDay();
  const daysUntilNextMonday = day === 0 ? 1 : 8 - day;
  end.setDate(end.getDate() + daysUntilNextMonday);
  end.setHours(0, 0, 0, 0);
  return end;
}

function arrayParam(params: Record<string, unknown>, key: string): string[] {
  const value = params[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'short' }).format(new Date(value));
}
