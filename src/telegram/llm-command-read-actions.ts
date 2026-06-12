import { createDatabaseCatalogLoanRepository } from '../catalog/catalog-loan-store.js';
import { createDatabaseCatalogRepository } from '../catalog/catalog-store.js';
import { createDatabaseGroupPurchaseRepository } from '../group-purchases/group-purchase-catalog-store.js';
import { createDatabaseLfgRepository } from '../lfg/lfg-catalog-store.js';
import { createDatabaseNewsGroupRepository } from '../news/news-group-store.js';
import { createDatabaseNoticeRepository } from '../notices/notice-catalog-store.js';
import { createDatabaseScheduleRepository } from '../schedule/schedule-catalog-store.js';
import { createDatabaseStorageRepository } from '../storage/storage-catalog-store.js';
import type { TelegramLlmCommandContext } from './llm-command-flow.js';
import type { LlmCommandIntent } from './llm-command-actions.js';

const maxPublicResults = 5;

export async function executeTelegramLlmReadAction(
  context: TelegramLlmCommandContext,
  input: {
    intent: string;
    params: Record<string, unknown>;
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
      return renderScheduleEvents(await listScheduleUpcoming(context, textParam(input.params, 'query')), 'Próximas actividades');
    case 'catalog.search':
      return renderCatalogItems(await searchCatalog(context, textParam(input.params, 'query')), 'Resultados del catálogo');
    case 'catalog.detail':
      return renderCatalogItems(await searchCatalog(context, textParam(input.params, 'query')), 'Detalle del catálogo');
    case 'catalog.loan.list':
      return renderCatalogLoans(await listCatalogLoans(context), 'Tus préstamos activos');
    case 'storage.search':
      return renderStorageEntries(await searchStorage(context, input.params), 'Resultados de Storage');
    case 'storage.category.list':
      return renderStorageCategories(await listStorageCategories(context), 'Categorías de Storage');
    case 'storage.entry.detail':
      return renderStorageEntries(await searchStorage(context, input.params), 'Detalle de Storage');
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

async function listScheduleUpcoming(context: TelegramLlmCommandContext, query: string | null) {
  const events = await createDatabaseScheduleRepository({ database: context.runtime.services.database.db }).listEvents({
    includeCancelled: false,
    startsAtFrom: new Date().toISOString(),
  });
  return filterByQuery(events, query, (event) => [event.title, event.description]);
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

async function searchStorage(context: TelegramLlmCommandContext, params: Record<string, unknown>) {
  const repository = createDatabaseStorageRepository({ database: context.runtime.services.database.db });
  const categories = await listStorageCategories(context);
  const query = textParam(params, 'query') ?? textParam(params, 'tag') ?? '';
  const raw = query
    ? await repository.searchEntryDetails({ categoryIds: categories.map((category) => category.id), query })
    : (await Promise.all(categories.map((category) => repository.listEntryDetailsByCategory(category.id)))).flat();
  const fileExtensions = arrayParam(params, 'fileExtensions').map((extension) => extension.replace(/^\./, '').toLowerCase());
  return raw
    .filter((detail) => detail.entry.lifecycleStatus === 'active')
    .filter((detail) => fileExtensions.length === 0 || detail.messages.some((message) => {
      const fileName = message.originalFileName?.toLowerCase() ?? '';
      return fileExtensions.some((extension) => fileName.endsWith(`.${extension}`));
    }));
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

function renderScheduleEvents(events: Array<{ title: string; startsAt: string; capacity: number }>, title: string): string {
  if (events.length === 0) {
    return `${title}: no hay resultados.`;
  }
  return renderList(title, events, (event) => `${event.title} - ${formatDateTime(event.startsAt)} (${event.capacity} plazas)`);
}

function renderCatalogItems(items: Array<{ displayName: string; originalName: string | null; itemType: string }>, title: string): string {
  if (items.length === 0) {
    return `${title}: no hay resultados.`;
  }
  return renderList(title, items, (item) => `${item.displayName}${item.originalName ? ` (${item.originalName})` : ''} - ${item.itemType}`);
}

function renderCatalogLoans(loans: Array<{ itemDisplayName?: string; itemId: number; dueAt: string | null }>, title: string): string {
  if (loans.length === 0) {
    return `${title}: no hay préstamos activos.`;
  }
  return renderList(title, loans, (loan) => `${loan.itemDisplayName ?? `Item ${loan.itemId}`}${loan.dueAt ? ` - vence ${formatDate(loan.dueAt)}` : ''}`);
}

function renderStorageCategories(categories: Array<{ displayName: string }>, title: string): string {
  if (categories.length === 0) {
    return `${title}: no hay categorías visibles.`;
  }
  return renderList(title, categories, (category) => category.displayName);
}

function renderStorageEntries(entries: Array<{ entry: { description: string | null; tags: string[] }; category: { displayName: string }; messages: Array<{ originalFileName: string | null; attachmentKind: string }> }>, title: string): string {
  if (entries.length === 0) {
    return `${title}: no hay resultados.`;
  }
  return renderList(title, entries, (detail) => {
    const fileName = detail.messages.find((message) => message.originalFileName)?.originalFileName;
    const kind = detail.messages[0]?.attachmentKind ?? 'entrada';
    return `${detail.entry.description ?? fileName ?? kind} - ${detail.category.displayName}`;
  });
}

function renderNotices(notices: Array<{ text: string; creatorDisplayName: string; expiresAt: string | null }>, title: string): string {
  if (notices.length === 0) {
    return `${title}: no hay avisos activos.`;
  }
  return renderList(title, notices, (notice) => `${notice.text.slice(0, 80)} - ${notice.creatorDisplayName}${notice.expiresAt ? ` (vence ${formatDate(notice.expiresAt)})` : ''}`);
}

function renderGroupPurchases(purchases: Array<{ title: string; joinDeadlineAt: string | null }>, title: string): string {
  if (purchases.length === 0) {
    return `${title}: no hay compras abiertas.`;
  }
  return renderList(title, purchases, (purchase) => `${purchase.title}${purchase.joinDeadlineAt ? ` - apuntarse hasta ${formatDate(purchase.joinDeadlineAt)}` : ''}`);
}

function renderLfg(lfg: { players: Array<{ displayName: string; description: string }>; groups: Array<{ title: string; seatsAvailable: number | null }> }, title: string): string {
  const rows = [
    ...lfg.players.map((player) => `Jugador: ${player.displayName} - ${player.description.slice(0, 80)}`),
    ...lfg.groups.map((group) => `Grupo: ${group.title}${group.seatsAvailable !== null ? ` (${group.seatsAvailable} plazas)` : ''}`),
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
      : `Suscripciones /news activas aquí: ${status.subscriptions.join(', ')}.`;
  }
  return `Hay ${status.enabledGroups ?? 0} grupos con /news habilitado.`;
}

function renderList<T>(title: string, rows: T[], format: (row: T) => string): string {
  const shown = rows.slice(0, maxPublicResults);
  const suffix = rows.length > shown.length ? `\n\nHay ${rows.length - shown.length} resultados más. Abre el privado para seguir.` : '';
  return `${title}:\n\n${shown.map((row, index) => `${index + 1}. ${format(row)}`).join('\n')}${suffix}`;
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
