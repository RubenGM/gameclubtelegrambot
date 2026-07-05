import { createDatabaseCatalogLoanRepository } from '../catalog/catalog-loan-store.js';
import { createDatabaseCatalogRepository } from '../catalog/catalog-store.js';
import { createDatabaseGroupPurchaseRepository } from '../group-purchases/group-purchase-catalog-store.js';
import { createDatabaseLfgRepository } from '../lfg/lfg-catalog-store.js';
import { createDatabaseNewsGroupRepository } from '../news/news-group-store.js';
import { createDatabaseNoticeRepository } from '../notices/notice-catalog-store.js';
import { createDatabaseScheduleRepository } from '../schedule/schedule-catalog-store.js';
import { createDatabaseStorageRepository } from '../storage/storage-catalog-store.js';
import type { CatalogItemRecord, CatalogItemType } from '../catalog/catalog-model.js';
import type { StorageCategoryRecord, StorageEntryDetailRecord } from '../storage/storage-catalog.js';
import type { TelegramLlmCommandContext } from './llm-command-flow.js';
import type { LlmCommandIntent } from './llm-command-actions.js';
import type { LlmCommandGenerateJsonOptions } from './llm-command-service.js';
import { buildTelegramStartUrl } from './deep-links.js';
import { escapeHtml } from './schedule-presentation.js';

export const llmCommandDirectReadResultLimit = 12;
export const llmCommandGroupedReadResultLimit = 5;

export async function executeTelegramLlmReadAction(
  context: TelegramLlmCommandContext,
  input: {
    intent: string;
    params: Record<string, unknown>;
    userText?: string;
    progress?: { update(message: string): Promise<boolean> };
    modelOptions?: LlmCommandGenerateJsonOptions;
  },
): Promise<string> {
  const intent = input.intent as LlmCommandIntent;
  switch (intent) {
    case 'help.capabilities':
      return 'Puedes preguntarme por actividades, catálogo, Storage, compras conjuntas, avisos, préstamos, LFG y estado básico de noticias.';
    case 'general.answer':
      return 'Puedo responder preguntas generales, pero no he recibido una respuesta directa de la IA. Prueba a formularlo de nuevo.';
    case 'bot.search':
      return searchAcrossBotSources(context, input.params, input.userText, input.progress, input.modelOptions);
    case 'schedule.today':
      return renderScheduleEvents(await listScheduleToday(context), 'Actividades de hoy');
    case 'schedule.upcoming':
    case 'schedule.search':
      return renderScheduleEvents(await listScheduleUpcoming(context, input.params), scheduleTitle(input.params));
    case 'catalog.search':
      return renderCatalogItems(await searchCatalog(context, input.params), 'Resultados del catálogo');
    case 'catalog.detail':
      return renderCatalogDetailItems(
        context,
        await searchCatalog(context, resolveCatalogDetailParams(context, input.params)),
        input.userText,
        input.progress,
        input.modelOptions,
      );
    case 'catalog.recommend':
      return recommendCatalogItems(context, input.params, input.userText, input.progress, input.modelOptions);
    case 'catalog.loan.list':
      return renderCatalogLoans(await listCatalogLoans(context), 'Tus préstamos activos');
    case 'storage.search':
      return renderStorageEntries(await searchStorage(context, input.params, input.userText, input.progress, input.modelOptions), 'Resultados de Storage');
    case 'storage.category.list':
      return renderStorageCategories(await listStorageCategories(context), 'Categorías de Storage');
    case 'storage.entry.detail':
      return renderStorageEntries(await searchStorage(context, input.params, input.userText, input.progress, input.modelOptions), 'Detalle de Storage');
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

async function searchCatalog(context: TelegramLlmCommandContext, params: Record<string, unknown>) {
  const repository = createDatabaseCatalogRepository({ database: context.runtime.services.database.db });
  const query = textParam(params, 'query');
  const playerCount = numberParam(params, 'playerCount');
  const itemType = catalogItemTypeParam(params);
  const availableOnly = booleanParam(params, 'availableOnly') === true;
  const items = await repository.listItems({ includeDeactivated: false });
  const activeLoanItemIds = availableOnly ? await listActiveCatalogLoanItemIds(context) : new Set<number>();
  return filterByQuery(items, query, (item) => [
    item.displayName,
    item.originalName,
    item.description,
    item.publisher,
    item.itemType,
  ])
    .filter((item) => itemType === null || item.itemType === itemType)
    .filter((item) => playerCount === null || catalogItemSupportsPlayerCount(item, playerCount))
    .filter((item) => !availableOnly || !activeLoanItemIds.has(item.id));
}

function resolveCatalogDetailParams(
  context: TelegramLlmCommandContext,
  params: Record<string, unknown>,
): Record<string, unknown> {
  if (textParam(params, 'query')) {
    return params;
  }
  const inferredQuery = inferCatalogQueryFromReplyContext(context.replyToBotMessageContext?.text ?? null);
  return inferredQuery ? { ...params, query: inferredQuery } : params;
}

export function inferCatalogQueryFromReplyContext(replyText: string | null | undefined): string | null {
  if (!replyText) {
    return null;
  }
  const lines = replyText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const catalogHeaderIndex = lines.findIndex((line) => /^cat[aá]logo(?:\s*\/|\s*$)/i.test(line));
  if (catalogHeaderIndex === -1) {
    return null;
  }
  for (const line of lines.slice(catalogHeaderIndex + 1)) {
    if (isCatalogReplyMetadataLine(line)) {
      continue;
    }
    return line.replace(/^<[^>]+>|<\/[^>]+>$/g, '').trim() || null;
  }
  return null;
}

function isCatalogReplyMetadataLine(line: string): boolean {
  return /^(disponibilidad|jugadores|duraci[oó]n|ver detalles|detalle del cat[aá]logo)\b/i.test(line)
    || /^\d+\./.test(line);
}

async function listCatalogLoans(context: TelegramLlmCommandContext) {
  const repository = createDatabaseCatalogLoanRepository({ database: context.runtime.services.database.db });
  if (repository.listActiveLoansWithItemsByBorrower) {
    return repository.listActiveLoansWithItemsByBorrower(context.runtime.actor.telegramUserId);
  }
  return repository.listActiveLoansWithItems();
}

async function listActiveCatalogLoanItemIds(context: TelegramLlmCommandContext): Promise<Set<number>> {
  const repository = createDatabaseCatalogLoanRepository({ database: context.runtime.services.database.db });
  const loans = await repository.listActiveLoansWithItems();
  return new Set(loans.map((loan) => loan.itemId));
}

async function recommendCatalogItems(
  context: TelegramLlmCommandContext,
  params: Record<string, unknown>,
  userText?: string,
  progress?: { update(message: string): Promise<boolean> },
  modelOptions?: LlmCommandGenerateJsonOptions,
): Promise<string> {
  const repository = createDatabaseCatalogRepository({ database: context.runtime.services.database.db });
  const activeLoanItemIds = await listActiveCatalogLoanItemIds(context);
  const query = textParam(params, 'query');
  const playerCount = numberParam(params, 'playerCount');
  const requestedItemType = catalogItemTypeParam(params);
  const itemType = requestedItemType ?? 'board-game';
  const availableOnly = booleanParam(params, 'availableOnly') !== false;
  const allItems = await repository.listItems({ includeDeactivated: false });
  const candidateSet = selectCatalogRecommendationCandidateSet({
    items: allItems,
    activeLoanItemIds,
    query,
    playerCount,
    itemType,
    availableOnly,
  });

  if (candidateSet.candidates.length === 0) {
    return describeEmptyCatalogRecommendation({ playerCount, availableOnly, itemType });
  }

  const service = context.runtime.llmCommandService;
  if (!service?.generateJson) {
    return renderCatalogRecommendationFallback(candidateSet);
  }

  await progress?.update('He encontrado juegos candidatos. Estoy eligiendo una recomendación...');
  try {
    const parsed = await runCatalogRecommendationWithProgress(
      () => service.generateJson(
        buildCatalogRecommendationPrompt({
          userText: userText ?? '',
          params,
          playerCount,
          candidateSet,
        }),
        'src/telegram/llm-catalog-recommendation.schema.json',
        modelOptions,
      ),
      progress,
    );
    return renderCatalogRecommendationFromLlm(parsed, candidateSet);
  } catch {
    return renderCatalogRecommendationFallback(candidateSet);
  }
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
  modelOptions?: LlmCommandGenerateJsonOptions,
) {
  const repository = createDatabaseStorageRepository({ database: context.runtime.services.database.db });
  const categories = await listStorageCategories(context);
  const query = textParam(params, 'query') ?? textParam(params, 'tag') ?? '';
  const raw = query
    ? mergeStorageEntryDetails([
      await repository.searchEntryDetails({ categoryIds: categories.map((category) => category.id), query }),
      ...(await Promise.all(resolveStorageCategoryMatchIds(categories, query).map((categoryId) => repository.listEntryDetailsByCategory(categoryId)))),
    ].flat())
    : (await Promise.all(categories.map((category) => repository.listEntryDetailsByCategory(category.id)))).flat();
  const fileExtensions = normalizeStorageFileExtensionsForSearch(arrayParam(params, 'fileExtensions'));
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
    categories,
    ...(progress ? { progress } : {}),
    ...(modelOptions ? { modelOptions } : {}),
  });
}

export function normalizeStorageFileExtensionsForSearch(fileExtensions: string[]): string[] {
  return Array.from(new Set(fileExtensions
    .map((extension) => extension.replace(/^\./, '').trim().toLowerCase())
    .filter((extension) => extension.length > 0 && extension !== 'stl')));
}

function mergeStorageEntryDetails(details: StorageEntryDetailRecord[]): StorageEntryDetailRecord[] {
  const byId = new Map<number, StorageEntryDetailRecord>();
  for (const detail of details) {
    if (!byId.has(detail.entry.id)) {
      byId.set(detail.entry.id, detail);
    }
  }
  return [...byId.values()];
}

export function resolveStorageCategoryMatchIds(categories: StorageCategoryRecord[], query: string): number[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return [];
  }

  const matchedCategories = categories.filter((category) => storageCategoryMatchesQuery(category, normalizedQuery));
  const specificMatches = matchedCategories.filter((category) => !matchedCategories.some((candidate) => (
    candidate.id !== category.id && collectStorageCategoryDescendantIds(category.id, categories).includes(candidate.id)
  )));
  const ids = new Set<number>();
  for (const category of specificMatches) {
    ids.add(category.id);
    for (const descendantId of collectStorageCategoryDescendantIds(category.id, categories)) {
      ids.add(descendantId);
    }
  }
  return [...ids];
}

function storageCategoryMatchesQuery(category: StorageCategoryRecord, normalizedQuery: string): boolean {
  return [category.displayName, category.slug, category.description]
    .map((value) => normalizeSearchText(value ?? ''))
    .filter((value) => value.length >= 3)
    .some((value) => value.includes(normalizedQuery) || normalizedQuery.includes(value));
}

function collectStorageCategoryDescendantIds(categoryId: number, categories: StorageCategoryRecord[]): number[] {
  const childrenByParent = new Map<number | null, StorageCategoryRecord[]>();
  for (const category of categories) {
    const siblings = childrenByParent.get(category.parentCategoryId) ?? [];
    siblings.push(category);
    childrenByParent.set(category.parentCategoryId, siblings);
  }

  const ids = new Set<number>();
  const stack = [...(childrenByParent.get(categoryId) ?? []).map((category) => category.id)];
  while (stack.length > 0) {
    const currentId = stack.pop();
    if (currentId === undefined || ids.has(currentId)) {
      continue;
    }
    ids.add(currentId);
    for (const child of childrenByParent.get(currentId) ?? []) {
      stack.push(child.id);
    }
  }
  return [...ids];
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

type BotSearchSource = 'schedule' | 'catalog' | 'storage' | 'group_purchases' | 'notices' | 'lfg';

interface BotSearchResultSet {
  query: string;
  sources: BotSearchSource[];
  schedule: Awaited<ReturnType<typeof listScheduleUpcoming>>;
  catalog: Awaited<ReturnType<typeof searchCatalog>>;
  storage: Awaited<ReturnType<typeof searchStorage>>;
  groupPurchases: Awaited<ReturnType<typeof listOpenGroupPurchases>>;
  notices: Awaited<ReturnType<typeof listActiveNotices>>;
  lfg: Awaited<ReturnType<typeof listLfg>>;
}

async function searchAcrossBotSources(
  context: TelegramLlmCommandContext,
  params: Record<string, unknown>,
  userText?: string,
  progress?: { update(message: string): Promise<boolean> },
  modelOptions?: LlmCommandGenerateJsonOptions,
): Promise<string> {
  const query = textParam(params, 'query') ?? textParam(params, 'tag') ?? userText?.trim() ?? '';
  if (!query) {
    return 'Dime qué quieres buscar y miraré en agenda, catálogo, Storage, compras, avisos y LFG.';
  }

  const sources = botSearchSourcesParam(params);
  await progress?.update('Petición entendida. Consultando agenda, catálogo, Storage y el resto de fuentes...');
  const [schedule, catalog, storage, groupPurchases, notices, lfg] = await Promise.all([
    sources.includes('schedule') ? listScheduleUpcoming(context, { query }) : Promise.resolve([]),
    sources.includes('catalog') ? searchCatalog(context, { ...params, query }) : Promise.resolve([]),
    sources.includes('storage') ? searchStorage(context, { ...params, query }, userText ?? query, progress, modelOptions) : Promise.resolve([]),
    sources.includes('group_purchases') ? listOpenGroupPurchases(context, query) : Promise.resolve([]),
    sources.includes('notices')
      ? listActiveNotices(context).then((notices) => filterByQuery(notices, query, (notice) => [notice.text, notice.creatorDisplayName]))
      : Promise.resolve([]),
    sources.includes('lfg') ? listLfg(context).then((lfg) => filterLfgByQuery(lfg, query)) : Promise.resolve({ players: [], groups: [] }),
  ]);
  const results: BotSearchResultSet = {
    query,
    sources,
    schedule,
    catalog,
    storage,
    groupPurchases,
    notices,
    lfg,
  };

  return answerReadWithLlm(context, {
    source: 'bot.search',
    userText: userText ?? query,
    records: formatBotSearchReadAnswerData(results),
    fallback: renderBotSearchResults(results),
    links: botSearchAnswerLinks(results),
    ...(progress ? { progress } : {}),
    ...(modelOptions ? { modelOptions } : {}),
  });
}

function renderBotSearchResults(results: BotSearchResultSet): string {
  const sections = [
    renderBotSearchSection(
      'Agenda',
      results.schedule,
      (event) => `${linkToStart(`schedule_event_${event.id}`, event.title)} - ${escapeHtml(formatDateTime(event.startsAt))} (${event.capacity} plazas) · ${linkToStart(`schedule_details_${event.id}`, 'detalle')}`,
    ),
    renderBotSearchSection(
      'Catálogo',
      results.catalog,
      (item) => {
        const players = renderPlayerRange(item.playerCountMin ?? null, item.playerCountMax ?? null);
        return `${linkToStart(`catalog_read_item_${item.id}`, item.displayName)}${item.originalName ? ` (${escapeHtml(item.originalName)})` : ''} - ${escapeHtml(item.itemType)}${players ? ` - ${players}` : ''}`;
      },
      linkToStart('catalog_read', 'Abrir catálogo'),
    ),
    renderBotSearchSection(
      'Storage',
      results.storage,
      (detail) => {
        const fileName = detail.messages.find((message) => message.originalFileName)?.originalFileName;
        const kind = detail.messages[0]?.attachmentKind ?? 'entrada';
        return `${linkToStart(`storage_entry_${detail.entry.id}`, detail.entry.description ?? fileName ?? kind)} - ${escapeHtml(detail.category.displayName)}`;
      },
      resolveStorageMoreLink(results.storage),
    ),
    renderBotSearchSection(
      'Compras conjuntas',
      results.groupPurchases,
      (purchase) => `${linkToStart(`group_purchase_${purchase.id}`, purchase.title)}${purchase.joinDeadlineAt ? ` - apuntarse hasta ${escapeHtml(formatDate(purchase.joinDeadlineAt))}` : ''}`,
    ),
    renderBotSearchSection(
      'Avisos',
      results.notices,
      (notice) => `#${notice.id} ${escapeHtml(notice.text.slice(0, 80))} - ${escapeHtml(notice.creatorDisplayName)}${notice.expiresAt ? ` (vence ${escapeHtml(formatDate(notice.expiresAt))})` : ''}`,
    ),
    renderBotSearchSection(
      'LFG',
      [
        ...results.lfg.players.map((player) => ({ kind: 'Jugador', title: player.displayName, text: player.description })),
        ...results.lfg.groups.map((group) => ({ kind: 'Grupo', title: group.title, text: group.seatsAvailable !== null ? `${group.seatsAvailable} plazas` : '' })),
      ],
      (entry) => `${escapeHtml(entry.kind)}: ${escapeHtml(entry.title)}${entry.text ? ` - ${escapeHtml(entry.text.slice(0, 80))}` : ''}`,
    ),
  ].filter((section): section is string => Boolean(section));

  if (sections.length === 0) {
    return `No he encontrado resultados para ${escapeHtml(results.query)} en ${formatBotSearchSourceList(results.sources)}.`;
  }

  const actionLinks = renderBotSearchActionLinks(results);
  return [
    `He encontrado resultados para ${escapeHtml(results.query)} en ${sections.length} fuente${sections.length === 1 ? '' : 's'}:`,
    '',
    sections.join('\n\n'),
    ...(actionLinks ? ['', actionLinks] : []),
  ].join('\n');
}

function renderBotSearchSection<T>(
  title: string,
  rows: T[],
  format: (row: T) => string,
  moreLink: string | null = null,
): string | null {
  if (rows.length === 0) {
    return null;
  }
  const shown = rows.slice(0, llmCommandGroupedReadResultLimit);
  const more = rows.length > shown.length
    ? `\nHay ${rows.length - shown.length} resultados más.${moreLink ? ` ${moreLink}.` : ''}`
    : '';
  return `<b>${escapeHtml(title)}</b>:\n${shown.map((row, index) => `${index + 1}. ${format(row)}`).join('\n')}${more}`;
}

function renderBotSearchActionLinks(results: BotSearchResultSet): string | null {
  const links = [
    results.sources.includes('catalog') ? linkToStart('catalog_read', 'Abrir catálogo') : null,
    results.sources.includes('storage') ? linkToStart('storage_root', 'Abrir Storage') : null,
    results.sources.includes('storage') ? linkToStart('storage_tags', 'Ver tags de Storage') : null,
  ].filter((link): link is string => Boolean(link));
  if (links.length === 0) {
    return null;
  }
  return `Acciones: ${links.join(' · ')}`;
}

function botSearchAnswerLinks(results: BotSearchResultSet): string[] {
  return [
    ...results.schedule.slice(0, 2).map((event) => linkToStart(`schedule_details_${event.id}`, event.title)),
    ...results.catalog.slice(0, 2).map((item) => linkToStart(`catalog_read_item_${item.id}`, item.displayName)),
    ...results.storage.slice(0, 2).map((detail) => {
      const fileName = detail.messages.find((message) => message.originalFileName)?.originalFileName;
      const kind = detail.messages[0]?.attachmentKind ?? 'entrada';
      return linkToStart(`storage_entry_${detail.entry.id}`, detail.entry.description ?? fileName ?? kind);
    }),
    ...results.groupPurchases.slice(0, 2).map((purchase) => linkToStart(`group_purchase_${purchase.id}`, purchase.title)),
    results.sources.includes('catalog') ? linkToStart('catalog_read', 'Abrir catálogo') : null,
    results.sources.includes('storage') ? linkToStart('storage_root', 'Abrir Storage') : null,
  ].filter((link): link is string => Boolean(link));
}

function formatBotSearchReadAnswerData(results: BotSearchResultSet): Record<string, unknown> {
  return {
    query: results.query,
    sources: results.sources,
    schedule: results.schedule.slice(0, 10).map((event) => ({
      id: event.id,
      title: event.title,
      startsAt: event.startsAt,
      capacity: event.capacity,
      url: buildTelegramStartUrl(`schedule_details_${event.id}`),
    })),
    catalog: results.catalog.slice(0, 10).map(formatCatalogReadAnswerItem),
    storage: results.storage.slice(0, 10).map((detail) => ({
      id: detail.entry.id,
      name: detail.entry.description,
      category: detail.category.displayName,
      tags: detail.entry.tags,
      files: detail.messages.slice(0, 5).map((message) => ({
        attachmentKind: message.attachmentKind,
        fileName: message.originalFileName,
      })),
      url: buildTelegramStartUrl(`storage_entry_${detail.entry.id}`),
    })),
    groupPurchases: results.groupPurchases.slice(0, 10).map((purchase) => ({
      id: purchase.id,
      title: purchase.title,
      joinDeadlineAt: purchase.joinDeadlineAt,
      url: buildTelegramStartUrl(`group_purchase_${purchase.id}`),
    })),
    notices: results.notices.slice(0, 10).map((notice) => ({
      text: notice.text,
      creatorDisplayName: notice.creatorDisplayName,
      expiresAt: notice.expiresAt,
    })),
    lfg: {
      players: results.lfg.players.slice(0, 10).map((player) => ({
        displayName: player.displayName,
        description: player.description,
      })),
      groups: results.lfg.groups.slice(0, 10).map((group) => ({
        title: group.title,
        description: group.description,
        seatsAvailable: group.seatsAvailable,
      })),
    },
  };
}

function formatBotSearchSourceList(sources: BotSearchSource[]): string {
  return sources.map((source) => ({
    schedule: 'agenda',
    catalog: 'catálogo',
    storage: 'Storage',
    group_purchases: 'compras conjuntas',
    notices: 'avisos',
    lfg: 'LFG',
  })[source]).join(', ');
}

function filterLfgByQuery(
  lfg: Awaited<ReturnType<typeof listLfg>>,
  query: string,
): Awaited<ReturnType<typeof listLfg>> {
  return {
    players: filterByQuery(lfg.players, query, (player) => [player.displayName, player.description]),
    groups: filterByQuery(lfg.groups, query, (group) => [group.title, group.description]),
  };
}

function renderScheduleEvents(events: Array<{ id: number; title: string; startsAt: string; capacity: number }>, title: string): string {
  if (events.length === 0) {
    return `${title}: no hay resultados.`;
  }
  return renderList(title, events, (event) => `${linkToStart(`schedule_event_${event.id}`, event.title)} - ${escapeHtml(formatDateTime(event.startsAt))} (${event.capacity} plazas)`);
}

function renderCatalogItems(items: Array<{ id: number; displayName: string; originalName: string | null; itemType: string; playerCountMin?: number | null; playerCountMax?: number | null }>, title: string): string {
  if (items.length === 0) {
    return `${title}: no hay resultados.`;
  }
  return renderList(
    title,
    items,
    (item) => {
      const players = renderPlayerRange(item.playerCountMin ?? null, item.playerCountMax ?? null);
      return `${linkToStart(`catalog_read_item_${item.id}`, item.displayName)}${item.originalName ? ` (${escapeHtml(item.originalName)})` : ''} - ${escapeHtml(item.itemType)}${players ? ` - ${players}` : ''}`;
    },
    linkToStart('catalog_read', 'Abrir catálogo completo'),
  );
}

async function renderCatalogDetailItems(
  context: TelegramLlmCommandContext,
  items: CatalogItemRecord[],
  userText?: string,
  progress?: { update(message: string): Promise<boolean> },
  modelOptions?: LlmCommandGenerateJsonOptions,
): Promise<string> {
  if (items.length === 0) {
    return 'Detalle del catálogo: no hay resultados.';
  }
  if (items.length !== 1) {
    return renderCatalogItems(items, 'Detalle del catálogo');
  }

  const item = items[0];
  if (!item) {
    return 'Detalle del catálogo: no hay resultados.';
  }

  const fallback = renderCatalogDetailFallback(item);
  return answerReadWithLlm(context, {
    source: 'catalog.detail',
    userText: userText ?? '',
    records: [formatCatalogReadAnswerItem(item)],
    fallback,
    links: [linkToStart(`catalog_read_item_${item.id}`, item.displayName)],
    ...(progress ? { progress } : {}),
    ...(modelOptions ? { modelOptions } : {}),
  });
}

function renderCatalogDetailFallback(item: CatalogItemRecord): string {
  const details = [
    escapeHtml(item.itemType),
    renderPlayerRange(item.playerCountMin, item.playerCountMax),
    item.playTimeMinutes !== null ? `${item.playTimeMinutes} min` : null,
    renderCatalogWeightValue(item),
  ].filter(Boolean).join(' - ');
  return `Detalle del catálogo:\n\n1. ${linkToStart(`catalog_read_item_${item.id}`, item.displayName)}${item.originalName ? ` (${escapeHtml(item.originalName)})` : ''}${details ? ` - ${details}` : ''}`;
}

function renderCatalogWeightValue(item: CatalogItemRecord): string | null {
  const weight = catalogAverageWeight(item);
  return weight === null ? null : `peso ${formatWeight(weight)}/5`;
}

function formatCatalogReadAnswerItem(item: CatalogItemRecord): Record<string, unknown> {
  return {
    id: item.id,
    displayName: item.displayName,
    originalName: item.originalName,
    itemType: item.itemType,
    description: item.description,
    language: item.language,
    publisher: item.publisher,
    publicationYear: item.publicationYear,
    players: {
      min: item.playerCountMin,
      max: item.playerCountMax,
    },
    recommendedAge: item.recommendedAge,
    playTimeMinutes: item.playTimeMinutes,
    bgg: extractCatalogBggMetadata(item.metadata),
    metadata: item.metadata,
    url: buildTelegramStartUrl(`catalog_read_item_${item.id}`),
  };
}

function extractCatalogBggMetadata(metadata: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }
  return {
    averageWeight: metadata.averageWeight ?? null,
    averageRating: metadata.averageRating ?? null,
    bayesAverage: metadata.bayesAverage ?? null,
    usersRated: metadata.usersRated ?? null,
    rank: metadata.rank ?? null,
    bestPlayerCounts: metadata.bestPlayerCounts ?? [],
    recommendedPlayerCounts: metadata.recommendedPlayerCounts ?? [],
    categories: metadata.categories ?? [],
    mechanics: metadata.mechanics ?? [],
  };
}

function catalogAverageWeight(item: CatalogItemRecord): number | null {
  const value = item.metadata?.averageWeight;
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatWeight(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
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
  const shown = rows.slice(0, llmCommandDirectReadResultLimit);
  const suffix = rows.length > shown.length
    ? `\n\nHay ${rows.length - shown.length} resultados más.${moreLink ? ` ${moreLink}.` : ''}`
    : '';
  return `${escapeHtml(title)}:\n\n${shown.map((row, index) => `${index + 1}. ${format(row)}`).join('\n')}${suffix}`;
}

async function answerReadWithLlm(
  context: TelegramLlmCommandContext,
  input: {
    source: string;
    userText: string;
    records: unknown;
    fallback: string;
    links?: string[];
    progress?: { update(message: string): Promise<boolean> };
    modelOptions?: LlmCommandGenerateJsonOptions;
  },
): Promise<string> {
  const service = context.runtime.llmCommandService;
  if (!service?.generateJson) {
    return input.fallback;
  }

  await input.progress?.update('He recuperado datos del bot. Estoy redactando la respuesta...');
  try {
    const parsed = await runReadAnswerWithProgress(
      () => service.generateJson(
        buildReadAnswerPrompt(context, input),
        'src/telegram/llm-read-answer.schema.json',
        input.modelOptions,
      ),
      input.progress,
    );
    const answer = parseReadAnswer(parsed);
    if (!answer) {
      return input.fallback;
    }
    return appendGeneratedLinks(escapeHtml(answer), input.links ?? []);
  } catch {
    return input.fallback;
  }
}

async function runReadAnswerWithProgress<T>(
  task: () => Promise<T>,
  progress?: { update(message: string): Promise<boolean> },
): Promise<T> {
  if (!progress) {
    return task();
  }
  let index = 0;
  let editInFlight = false;
  const messages = [
    'Sigo preparando una respuesta con los datos recuperados...',
    'Estoy revisando el contexto y los resultados reales del bot...',
    'La redacción con IA está tardando más de lo normal...',
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

function buildReadAnswerPrompt(
  context: TelegramLlmCommandContext,
  input: {
    source: string;
    userText: string;
    records: unknown;
  },
): string {
  return [
    'Eres el asistente conversacional de un bot de club.',
    'El bot ya ha elegido una capacidad, ha consultado sus datos reales y te entrega esos datos en JSON.',
    'Responde a la petición del usuario usando solo los datos proporcionados y el contexto del mensaje respondido si existe.',
    'Si los datos no bastan para responder con seguridad, dilo de forma clara y menciona que dato falta.',
    'No inventes IDs, enlaces, fechas, disponibilidad, reglas, dificultad, resultados ni contenido que no aparezca en los datos.',
    'No uses HTML ni Markdown. El bot añadira enlaces utiles despues de tu respuesta.',
    'Se breve y responde en el idioma natural del usuario cuando sea evidente.',
    '',
    `Fuente consultada: ${input.source}`,
    `Mensaje del usuario: ${input.userText}`,
    context.replyToBotMessageContext?.text ? `Mensaje del bot respondido: ${context.replyToBotMessageContext.text}` : 'Mensaje del bot respondido: (ninguno)',
    'Datos recuperados:',
    JSON.stringify(input.records),
    '',
    'Devuelve solo JSON valido con esta forma: {"answer":"respuesta breve en texto plano"}.',
  ].join('\n');
}

function parseReadAnswer(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  const answer = (parsed as { answer?: unknown }).answer;
  return typeof answer === 'string' && answer.trim() ? answer.trim() : null;
}

function appendGeneratedLinks(answer: string, links: string[]): string {
  const uniqueLinks = Array.from(new Set(links)).slice(0, 5);
  if (uniqueLinks.length === 0) {
    return answer;
  }
  return `${answer}\n\nEnlaces: ${uniqueLinks.join(' · ')}`;
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

interface CatalogRecommendationCandidate {
  item: CatalogItemRecord;
  available: boolean;
  matchNote: string | null;
}

type CatalogRecommendationMode = 'exact' | 'nearby_players' | 'borrowed' | 'missing_player_metadata';

interface CatalogRecommendationCandidateSet {
  mode: CatalogRecommendationMode;
  intro: string;
  candidates: CatalogRecommendationCandidate[];
}

async function runCatalogRecommendationWithProgress<T>(
  task: () => Promise<T>,
  progress?: { update(message: string): Promise<boolean> },
): Promise<T> {
  if (!progress) {
    return task();
  }
  let index = 0;
  let editInFlight = false;
  const messages = [
    'Sigo revisando juegos compatibles...',
    'Estoy comparando jugadores, descripción y duración...',
    'La recomendación está tardando más de lo normal...',
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

function buildCatalogRecommendationPrompt(input: {
  userText: string;
  params: Record<string, unknown>;
  playerCount: number | null;
  candidateSet: CatalogRecommendationCandidateSet;
}): string {
  return [
    'Eres un recomendador de juegos de mesa para el catalogo de un club.',
    'El bot ya ha filtrado candidatos reales del catalogo por disponibilidad, tipo y numero de jugadores cuando corresponde.',
    'Si los candidatos son fallback, respeta el aviso del bot y no digas que cumplen el filtro exacto.',
    'Elige de 1 a 3 candidatos que encajen mejor con la peticion. No inventes juegos ni IDs.',
    'Devuelve solo JSON valido con esta forma: {"intro":"breve","selectedIds":[1],"reasons":[{"id":1,"reason":"breve"}]}.',
    'No incluyas HTML ni Markdown. El bot añadira los enlaces a los juegos.',
    '',
    `Peticion original del usuario: ${input.userText}`,
    `Parametros interpretados: ${JSON.stringify(input.params)}`,
    `Numero de jugadores pedido: ${input.playerCount ?? 'no especificado'}`,
    `Modo de candidatos: ${input.candidateSet.mode}`,
    `Aviso obligatorio del bot: ${input.candidateSet.intro}`,
    'Candidatos:',
    JSON.stringify(input.candidateSet.candidates.map(formatCatalogRecommendationCandidate)),
  ].join('\n');
}

function formatCatalogRecommendationCandidate(candidate: CatalogRecommendationCandidate): Record<string, unknown> {
  const item = candidate.item;
  return {
    id: item.id,
    displayName: item.displayName,
    originalName: item.originalName,
    itemType: item.itemType,
    description: item.description,
    language: item.language,
    publisher: item.publisher,
    publicationYear: item.publicationYear,
    players: {
      min: item.playerCountMin,
      max: item.playerCountMax,
    },
    recommendedAge: item.recommendedAge,
    playTimeMinutes: item.playTimeMinutes,
    available: candidate.available,
    matchNote: candidate.matchNote,
    bgg: extractCatalogRecommendationBggMetadata(item.metadata),
    metadata: item.metadata,
  };
}

function extractCatalogRecommendationBggMetadata(metadata: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }
  return {
    averageWeight: metadata.averageWeight ?? null,
    averageRating: metadata.averageRating ?? null,
    bayesAverage: metadata.bayesAverage ?? null,
    usersRated: metadata.usersRated ?? null,
    rank: metadata.rank ?? null,
    bestPlayerCounts: metadata.bestPlayerCounts ?? [],
    recommendedPlayerCounts: metadata.recommendedPlayerCounts ?? [],
    categories: metadata.categories ?? [],
    mechanics: metadata.mechanics ?? [],
  };
}

function renderCatalogRecommendationFromLlm(
  parsed: unknown,
  candidateSet: CatalogRecommendationCandidateSet,
): string {
  const byId = new Map(candidateSet.candidates.map((candidate) => [candidate.item.id, candidate]));
  const selectedIds = parseSelectedRecommendationIds(parsed, byId);
  if (selectedIds.length === 0) {
    return renderCatalogRecommendationFallback(candidateSet);
  }
  const reasonById = parseRecommendationReasons(parsed, new Set(selectedIds));
  const parsedIntro = parseRecommendationIntro(parsed);
  const intro = candidateSet.mode === 'exact' && parsedIntro ? parsedIntro : candidateSet.intro;
  const rows = selectedIds
    .map((id) => byId.get(id))
    .filter((candidate): candidate is CatalogRecommendationCandidate => Boolean(candidate))
    .map((candidate) => {
      const reason = reasonById.get(candidate.item.id);
      const details = [
        renderPlayerRange(candidate.item.playerCountMin, candidate.item.playerCountMax),
        candidate.item.playTimeMinutes !== null ? `${candidate.item.playTimeMinutes} min` : null,
        candidate.available ? 'disponible' : 'prestado',
      ].filter(Boolean).join(', ');
      const note = candidate.matchNote ? ` ${escapeHtml(candidate.matchNote)}` : '';
      return `${linkToStart(`catalog_read_item_${candidate.item.id}`, candidate.item.displayName)}${details ? ` (${escapeHtml(details)})` : ''}${note}${reason ? ` - ${escapeHtml(reason)}` : ''}`;
    });
  return `${escapeHtml(intro)}\n\n${rows.map((row, index) => `${index + 1}. ${row}`).join('\n')}`;
}

function renderCatalogRecommendationFallback(candidateSet: CatalogRecommendationCandidateSet): string {
  return `${escapeHtml(candidateSet.intro)}\n\n${candidateSet.candidates.slice(0, 3).map((candidate, index) => {
    const players = renderPlayerRange(candidate.item.playerCountMin, candidate.item.playerCountMax);
    const details = [
      players,
      candidate.item.playTimeMinutes !== null ? `${candidate.item.playTimeMinutes} min` : null,
      candidate.available ? 'disponible' : 'prestado',
    ].filter(Boolean).join(', ');
    const note = candidate.matchNote ? ` ${escapeHtml(candidate.matchNote)}` : '';
    return `${index + 1}. ${linkToStart(`catalog_read_item_${candidate.item.id}`, candidate.item.displayName)}${details ? ` (${escapeHtml(details)})` : ''}${note}`;
  }).join('\n')}`;
}

export function selectCatalogRecommendationCandidateSet(input: {
  items: CatalogItemRecord[];
  activeLoanItemIds: Set<number>;
  query: string | null;
  playerCount: number | null;
  itemType: CatalogItemType;
  availableOnly: boolean;
}): CatalogRecommendationCandidateSet {
  const baseItems = rankCatalogRecommendationItems(
    input.items.filter((item) => item.itemType === input.itemType),
    input.query,
  );
  const availableFilter = (item: CatalogItemRecord) => !input.availableOnly || !input.activeLoanItemIds.has(item.id);
  const toCandidate = (item: CatalogItemRecord, matchNote: string | null = null): CatalogRecommendationCandidate => ({
    item,
    available: !input.activeLoanItemIds.has(item.id),
    matchNote,
  });

  const exact = baseItems
    .filter((item) => input.playerCount === null || catalogItemSupportsPlayerCount(item, input.playerCount))
    .filter(availableFilter)
    .slice(0, 40)
    .map((item) => toCandidate(item));
  if (exact.length > 0) {
    return {
      mode: 'exact',
      intro: input.playerCount === null
        ? 'He encontrado estos juegos disponibles que podrían encajar:'
        : `He encontrado estos juegos disponibles para ${input.playerCount} personas:`,
      candidates: exact,
    };
  }

  if (input.playerCount !== null) {
    const playerCount = input.playerCount;
    const nearbyCounts = [playerCount - 1, playerCount + 1].filter((count) => count > 0);
    const nearby = baseItems
      .filter((item) => !catalogItemSupportsPlayerCount(item, playerCount))
      .filter((item) => nearbyCounts.some((count) => catalogItemSupportsPlayerCount(item, count)))
      .filter(availableFilter)
      .slice(0, 40)
      .map((item) => toCandidate(item, '(opción cercana por número de jugadores)'));
    if (nearby.length > 0) {
      return {
        mode: 'nearby_players',
        intro: `No he encontrado juegos disponibles exactamente para ${playerCount} personas. Te dejo opciones cercanas por número de jugadores:`,
        candidates: nearby,
      };
    }
  }

  if (input.availableOnly) {
    const borrowed = baseItems
      .filter((item) => input.activeLoanItemIds.has(item.id))
      .filter((item) => input.playerCount === null || catalogItemSupportsPlayerCount(item, input.playerCount))
      .slice(0, 40)
      .map((item) => toCandidate(item, '(ahora mismo está prestado)'));
    if (borrowed.length > 0) {
      return {
        mode: 'borrowed',
        intro: input.playerCount === null
          ? 'No he encontrado juegos disponibles con ese filtro. Estos encajan, pero ahora están prestados:'
          : `No he encontrado juegos disponibles para ${input.playerCount} personas. Estos encajan, pero ahora están prestados:`,
        candidates: borrowed,
      };
    }
  }

  if (input.playerCount !== null) {
    const missingMetadata = baseItems
      .filter((item) => item.playerCountMin === null && item.playerCountMax === null)
      .filter(availableFilter)
      .slice(0, 40)
      .map((item) => toCandidate(item, '(sin metadatos de jugadores)'));
    if (missingMetadata.length > 0) {
      return {
        mode: 'missing_player_metadata',
        intro: `No he encontrado juegos disponibles con metadatos que confirmen ${input.playerCount} personas. Estas opciones disponibles no tienen ese dato completo:`,
        candidates: missingMetadata,
      };
    }
  }

  return {
    mode: 'exact',
    intro: 'No he encontrado recomendaciones con los filtros actuales.',
    candidates: [],
  };
}

function describeEmptyCatalogRecommendation(input: {
  playerCount: number | null;
  availableOnly: boolean;
  itemType: CatalogItemType;
}): string {
  const type = input.itemType === 'board-game' ? 'juegos de mesa' : 'ítems del catálogo';
  const players = input.playerCount === null ? '' : ` para ${input.playerCount} personas`;
  const availability = input.availableOnly ? ' disponibles' : '';
  return `No he encontrado ${type}${availability}${players} con los metadatos actuales.`;
}

function rankCatalogRecommendationItems(items: CatalogItemRecord[], query: string | null): CatalogItemRecord[] {
  const normalizedQuery = normalizeSearchText(query ?? '');
  if (!normalizedQuery) {
    return items;
  }

  const tokens = expandCatalogRecommendationQueryTokens(tokenizeSearchText(normalizedQuery));
  const referenceItems = items.filter((item) => normalizeSearchText(catalogRecommendationTextCorpus(item)).includes(normalizedQuery));
  const referenceIds = new Set(referenceItems.map((item) => item.id));
  const referenceTerms = new Set(referenceItems.flatMap(catalogRecommendationMetadataTerms));
  const candidates = referenceIds.size > 0 && referenceIds.size < items.length
    ? items.filter((item) => !referenceIds.has(item.id))
    : items;

  return candidates
    .map((item, index) => ({
      item,
      index,
      score: scoreCatalogRecommendationItem(item, normalizedQuery, tokens, referenceTerms),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.item);
}

function scoreCatalogRecommendationItem(
  item: CatalogItemRecord,
  normalizedQuery: string,
  tokens: string[],
  referenceTerms: Set<string>,
): number {
  const textCorpus = normalizeSearchText(catalogRecommendationTextCorpus(item));
  const fullCorpus = normalizeSearchText([
    catalogRecommendationTextCorpus(item),
    JSON.stringify(item.metadata ?? {}),
  ].join(' '));
  let score = fullCorpus.includes(normalizedQuery) ? 20 : 0;
  for (const token of tokens) {
    if (fullCorpus.includes(token)) {
      score += 3;
    }
  }
  for (const term of catalogRecommendationMetadataTerms(item)) {
    if (referenceTerms.has(term)) {
      score += 2;
    }
  }
  if (textCorpus.includes(normalizedQuery)) {
    score += 4;
  }
  return score;
}

function catalogRecommendationTextCorpus(item: CatalogItemRecord): string {
  return [
    item.displayName,
    item.originalName,
    item.description,
    item.publisher,
    item.itemType,
  ].filter(Boolean).join(' ');
}

function catalogRecommendationMetadataTerms(item: CatalogItemRecord): string[] {
  const metadata = item.metadata;
  if (!metadata || typeof metadata !== 'object') {
    return [];
  }
  return [
    ...unknownStringArray((metadata as { mechanics?: unknown }).mechanics),
    ...unknownStringArray((metadata as { categories?: unknown }).categories),
  ].map(normalizeSearchText).filter(Boolean);
}

function unknownStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

function tokenizeSearchText(value: string): string[] {
  const ignored = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'para', 'por', 'con', 'y', 'o', 'style', 'estilo']);
  return value
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !ignored.has(token));
}

function expandCatalogRecommendationQueryTokens(tokens: string[]): string[] {
  const expanded = new Set(tokens);
  const hasDeck = tokens.includes('deck');
  const hasBuild = tokens.some((token) => token.startsWith('build') || token.startsWith('constru'));
  if (hasDeck && hasBuild) {
    ['deck', 'bag', 'pool', 'building', 'construction'].forEach((token) => expanded.add(token));
  }
  return Array.from(expanded);
}

function parseSelectedRecommendationIds(
  parsed: unknown,
  candidates: Map<number, CatalogRecommendationCandidate>,
): number[] {
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { selectedIds?: unknown }).selectedIds)) {
    return [];
  }
  const selected: number[] = [];
  for (const value of (parsed as { selectedIds: unknown[] }).selectedIds) {
    const id = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (Number.isInteger(id) && candidates.has(id) && !selected.includes(id)) {
      selected.push(id);
    }
    if (selected.length >= 3) {
      break;
    }
  }
  return selected;
}

function parseRecommendationReasons(parsed: unknown, selectedIds: Set<number>): Map<number, string> {
  const reasons = new Map<number, string>();
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { reasons?: unknown }).reasons)) {
    return reasons;
  }
  for (const entry of (parsed as { reasons: unknown[] }).reasons) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const rawId = (entry as { id?: unknown }).id;
    const id = typeof rawId === 'number' ? rawId : typeof rawId === 'string' ? Number(rawId) : Number.NaN;
    const reason = (entry as { reason?: unknown }).reason;
    if (Number.isInteger(id) && selectedIds.has(id) && typeof reason === 'string' && reason.trim()) {
      reasons.set(id, reason.trim());
    }
  }
  return reasons;
}

function parseRecommendationIntro(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  const intro = (parsed as { intro?: unknown }).intro;
  return typeof intro === 'string' && intro.trim() ? intro.trim() : null;
}

async function refineStorageSearchWithLlm(
  context: TelegramLlmCommandContext,
  input: {
    userText: string;
    query: string;
    params: Record<string, unknown>;
    details: StorageEntryDetailRecord[];
    categories: StorageCategoryRecord[];
    progress?: { update(message: string): Promise<boolean> };
    modelOptions?: LlmCommandGenerateJsonOptions;
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
    categories: input.categories,
  });
  try {
    const parsed = await runStorageRefinementWithProgress(
      () => service.generateJson(prompt, undefined, input.modelOptions),
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
  categories: StorageCategoryRecord[];
}): string {
  return [
    'Eres un filtro semantico para resultados de Storage de un club.',
    'Tu unica tarea es elegir que candidatos coinciden realmente con lo que pide el usuario.',
    'Storage mezcla STL para impresion 3D, libros, manuales, aventuras, fichas, mapas, imagenes y otros archivos.',
    'Si el usuario pide libros/manuales/material de rol/PDF/documentos, no selecciones miniaturas, estatuas, dioramas o modelos STL salvo que tambien sean claramente el material pedido.',
    'Si el usuario pide STL/modelos 3D/figuras/estatuas/miniaturas/dioramas/impresion 3D, selecciona modelos STL relevantes.',
    'Devuelve solo JSON valido con esta forma: {"selectedIds":[1,2,3],"reason":"breve"}.',
    'Usa selectedIds=[] si ningun candidato encaja.',
    '',
    `Peticion original del usuario: ${input.userText}`,
    `Busqueda textual usada para obtener candidatos: ${input.userQuery}`,
    `Parametros interpretados: ${JSON.stringify(input.params)}`,
    'Candidatos:',
    JSON.stringify(input.candidates.map((candidate) => formatStorageRefinementCandidate(candidate, input.categories))),
  ].join('\n');
}

function formatStorageRefinementCandidate(detail: StorageEntryDetailRecord, categories: StorageCategoryRecord[]): Record<string, unknown> {
  return {
    id: detail.entry.id,
    description: detail.entry.description,
    category: detail.category.displayName,
    categoryPath: buildStorageCategoryPath(detail.category.id, categories),
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

export function buildStorageCategoryPath(categoryId: number, categories: StorageCategoryRecord[]): string[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const path: string[] = [];
  const seenIds = new Set<number>();
  let current = byId.get(categoryId) ?? null;
  while (current && !seenIds.has(current.id)) {
    path.unshift(current.displayName);
    seenIds.add(current.id);
    current = current.parentCategoryId === null ? null : byId.get(current.parentCategoryId) ?? null;
  }
  return path;
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

function botSearchSourcesParam(params: Record<string, unknown>): BotSearchSource[] {
  const allowed: BotSearchSource[] = ['schedule', 'catalog', 'storage', 'group_purchases', 'notices', 'lfg'];
  const requested = new Set(arrayParam(params, 'sources'));
  const selected = allowed.filter((source) => requested.has(source));
  return selected.length > 0 ? selected : allowed;
}

function numberParam(params: Record<string, unknown>, key: string): number | null {
  const value = params[key];
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function booleanParam(params: Record<string, unknown>, key: string): boolean | null {
  const value = params[key];
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'si', 'sí', 'available', 'disponible'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no'].includes(normalized)) {
    return false;
  }
  return null;
}

function catalogItemTypeParam(params: Record<string, unknown>): CatalogItemType | null {
  const value = textParam(params, 'itemType');
  if (
    value === 'board-game' ||
    value === 'expansion' ||
    value === 'book' ||
    value === 'rpg-book' ||
    value === 'accessory'
  ) {
    return value;
  }
  return null;
}

function catalogItemSupportsPlayerCount(item: CatalogItemRecord, playerCount: number): boolean {
  if (item.playerCountMin === null && item.playerCountMax === null) {
    return false;
  }
  return (item.playerCountMin === null || item.playerCountMin <= playerCount)
    && (item.playerCountMax === null || item.playerCountMax >= playerCount);
}

function renderPlayerRange(min: number | null, max: number | null): string | null {
  if (min === null && max === null) {
    return null;
  }
  if (min !== null && max !== null && min === max) {
    return `${min} jugadores`;
  }
  if (min !== null && max !== null) {
    return `${min}-${max} jugadores`;
  }
  if (min !== null) {
    return `desde ${min} jugadores`;
  }
  return `hasta ${max} jugadores`;
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
