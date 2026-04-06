import type { CatalogMediaRecord, CatalogRepository, CatalogFamilyRecord, CatalogGroupRecord, CatalogItemRecord } from '../catalog/catalog-model.js';
import { createDatabaseCatalogRepository } from '../catalog/catalog-store.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import {
  formatMemberCatalogFamilyDetails,
  formatMemberCatalogGroupDetails,
  formatMemberCatalogItemDetails,
  formatMemberCatalogOverview,
  renderCatalogItemType,
} from './catalog-presentation.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import {
  buildLoanDetailButtons,
  buildLoanItemButton,
  catalogLoanCallbackPrefixes,
  formatLoanAvailabilityLines,
  resolveLoanBorrowerDisplayName,
  type CatalogLoanRecord,
  loadActiveLoanByItemId,
  loadActiveLoansByBorrower,
  type TelegramCatalogLoanContext,
} from './catalog-loan-flow.js';
import { catalogAdminCallbackPrefixes } from './catalog-admin-flow.js';
import type { TelegramInlineButton, TelegramReplyOptions } from './runtime-boundary.js';
import { buildTelegramStartUrl } from './deep-links.js';

const catalogReadFlowKey = 'catalog-read';
const catalogReadPageSize = 5;

export const catalogReadCallbackPrefixes = {
  overview: 'catalog_read:overview',
  pageNext: 'catalog_read:page:next',
  pagePrev: 'catalog_read:page:prev',
  back: 'catalog_read:back',
  myLoans: 'catalog_read:my_loans',
  inspectFamily: 'catalog_read:family:',
  inspectGroup: 'catalog_read:group:',
  inspectItem: 'catalog_read:item:',
} as const;

export type TelegramCatalogReadContext = TelegramCatalogLoanContext & {
  catalogRepository?: CatalogRepository;
};

type CatalogReadView = 'overview' | 'search' | 'family' | 'group' | 'item' | 'my-loans';

interface CatalogReadState {
  view: CatalogReadView;
  page: number;
  query?: string;
  familyId?: number;
  groupId?: number;
  itemId?: number;
  returnState?: CatalogReadState;
}

interface CatalogBrowseEntry {
  kind: 'family' | 'group' | 'item';
  id: number;
  label: string;
  subtitle: string;
}

export async function handleTelegramCatalogReadCommand(context: TelegramCatalogReadContext): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const query = parseCatalogSearchQuery(context.messageText?.trim() ?? '');
  const state: CatalogReadState = query ? { view: 'search', page: 1, query } : { view: 'overview', page: 1 };

  await persistCatalogReadState(context, state);
  await renderCatalogReadState(context, state, language);
}

export async function handleTelegramCatalogReadStartText(context: TelegramCatalogReadContext): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const itemId = parseStartPayload(context.messageText, 'catalog_read_item_');
  if (itemId === null || context.runtime.chat.kind !== 'private' || !context.runtime.actor.isApproved) {
    return false;
  }

  const { families, groups, items, media } = await loadCatalogData(context);
  const item = itemById(items, itemId);
  if (!item) {
    throw new Error(`Catalog item ${itemId} not found`);
  }

  const family = item.familyId !== null ? familyById(families, item.familyId) ?? null : null;
  const group = item.groupId !== null ? groupById(groups, item.groupId) ?? null : null;
  const loan = await loadActiveLoanByItemId(context, item.id);
  await context.reply(
    formatMemberCatalogItemDetails({
      item,
      family,
      group,
      media: media.filter((entry) => entry.itemId === item.id).sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id),
      availabilityLines: await formatLoanAvailabilityLines(context, loan),
      language,
    }),
    {
      inlineKeyboard: buildLoanDetailButtons({
        loan,
        itemId: item.id,
        ...(context.runtime.actor.isAdmin
          ? { deleteCallbackData: `${catalogAdminCallbackPrefixes.deactivate}${item.id}` }
          : {}),
      }),
      parseMode: 'HTML',
    },
  );
  return true;
}

export async function handleTelegramCatalogReadCallback(context: TelegramCatalogReadContext): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const callbackData = context.callbackData;
  if (!callbackData) {
    return false;
  }

  if (callbackData === catalogReadCallbackPrefixes.overview) {
    const state: CatalogReadState = { view: 'overview', page: 1 };
    await persistCatalogReadState(context, state);
    await renderCatalogReadState(context, state, language);
    return true;
  }

  if (callbackData === catalogReadCallbackPrefixes.pageNext || callbackData === catalogReadCallbackPrefixes.pagePrev) {
    const current = readCatalogReadState(context);
    if (!current || !isListView(current.view)) {
      return false;
    }

    const nextPage = callbackData === catalogReadCallbackPrefixes.pageNext ? current.page + 1 : current.page - 1;
    const nextState = { ...current, page: nextPage };
    await persistCatalogReadState(context, nextState);
    await renderCatalogReadState(context, nextState, language);
    return true;
  }

  if (callbackData === catalogReadCallbackPrefixes.back) {
    const current = readCatalogReadState(context);
    const returnState = current?.returnState;
    if (!returnState) {
      return false;
    }

    await persistCatalogReadState(context, returnState);
    await renderCatalogReadState(context, returnState, language);
    return true;
  }

  if (callbackData === catalogReadCallbackPrefixes.myLoans) {
    const nextState: CatalogReadState = { view: 'my-loans', page: 1, returnState: readCatalogReadState(context) ?? { view: 'overview', page: 1 } };
    await persistCatalogReadState(context, nextState);
    await renderCatalogReadState(context, nextState, language);
    return true;
  }

  if (callbackData.startsWith(catalogReadCallbackPrefixes.inspectFamily)) {
    const familyId = parseEntityId(callbackData, catalogReadCallbackPrefixes.inspectFamily);
    const { families, groups, items } = await loadCatalogData(context);
    const family = familyById(families, familyId);
    if (!family) {
      throw new Error(`Catalog family ${familyId} not found`);
    }

    const current = readCatalogReadState(context);
    const nextState: CatalogReadState = { view: 'family', page: 1, familyId, returnState: current ?? { view: 'overview', page: 1 } };
    await persistCatalogReadState(context, nextState);
    await renderCatalogReadState(context, nextState, language);
    return true;
  }

  if (callbackData.startsWith(catalogReadCallbackPrefixes.inspectGroup)) {
    const groupId = parseEntityId(callbackData, catalogReadCallbackPrefixes.inspectGroup);
    const { families, groups, items } = await loadCatalogData(context);
    const group = groupById(groups, groupId);
    if (!group) {
      throw new Error(`Catalog group ${groupId} not found`);
    }

    const current = readCatalogReadState(context);
    const nextState: CatalogReadState = { view: 'group', page: 1, groupId, returnState: current ?? { view: 'overview', page: 1 } };
    await persistCatalogReadState(context, nextState);
    await renderCatalogReadState(context, nextState, language);
    return true;
  }

  if (callbackData.startsWith(catalogReadCallbackPrefixes.inspectItem)) {
    const itemId = parseEntityId(callbackData, catalogReadCallbackPrefixes.inspectItem);
    const { families, groups, items, media } = await loadCatalogData(context);
    const item = itemById(items, itemId);
    if (!item) {
      throw new Error(`Catalog item ${itemId} not found`);
    }

    const current = readCatalogReadState(context);
    const nextState: CatalogReadState = { view: 'item', page: 1, itemId, returnState: current ?? { view: 'overview', page: 1 } };
    await persistCatalogReadState(context, nextState);
    await renderCatalogReadState(context, nextState, language);
    return true;
  }

  return false;
}

async function renderCatalogReadState(context: TelegramCatalogReadContext, state: CatalogReadState, language: 'ca' | 'es' | 'en'): Promise<void> {
  const { families, groups, items } = await loadCatalogData(context);
  const activeLoansByItemId = await loadActiveLoansByItemMap(context, items);
  const texts = createTelegramI18n(language);

  if (state.view === 'overview') {
    const entries = await buildOverviewEntries(context, { families, items, activeLoansByItemId });
    const page = paginateEntries(entries, state.page);
    const loanCount = (await loadActiveLoansByBorrower(context, context.runtime.actor.telegramUserId)).length;
    const buttonRows = await buildBrowseButtonRows(context, page.items);
    if (loanCount > 0) {
      buttonRows.unshift([{ text: texts.catalogRead.myLoans, callbackData: catalogReadCallbackPrefixes.myLoans }]);
    }
    await context.reply(
      `${formatMemberCatalogOverview({ families, groups, items, language })}\n\n${formatEntryPage(page.items, page.page, page.totalPages, language)}`,
      { ...buildListNavigationOptions(buttonRows, state, page.totalPages > 1, language), parseMode: 'HTML' },
    );
    return;
  }

  if (state.view === 'search') {
    const results = await searchCatalogItems(context, { families, groups, items, activeLoansByItemId, query: state.query ?? '' });
    if (results.length === 0) {
      await context.reply(texts.catalogRead.noResults.replace('{query}', state.query ?? ''));
      return;
    }

    const page = paginateEntries(results, state.page);
    const lines = [texts.catalogRead.searchResults.replace('{query}', state.query ?? ''), formatEntryPage(page.items, page.page, page.totalPages, language)];
    await context.reply(lines.join('\n'), { ...buildListNavigationOptions(await buildBrowseButtonRows(context, page.items), state, page.totalPages > 1, language), parseMode: 'HTML' });
    return;
  }

  if (state.view === 'family') {
    const family = state.familyId !== undefined ? familyById(families, state.familyId) ?? null : null;
    if (!family) {
      throw new Error(`Catalog family ${state.familyId ?? 'unknown'} not found`);
    }

    const entries = await buildFamilyEntries(context, { family, groups, items, activeLoansByItemId });
    const page = paginateEntries(entries, state.page);
    await context.reply(
      `${formatMemberCatalogFamilyDetails({ family, groups, items, language })}\n\n${formatEntryPage(page.items, page.page, page.totalPages, language)}`,
      { ...buildListNavigationOptions(await buildBrowseButtonRows(context, page.items), state, page.totalPages > 1, language), parseMode: 'HTML' },
    );
    return;
  }

  if (state.view === 'group') {
    const group = state.groupId !== undefined ? groupById(groups, state.groupId) ?? null : null;
    if (!group) {
      throw new Error(`Catalog group ${state.groupId ?? 'unknown'} not found`);
    }

    const entries = await buildGroupEntries(context, { group, items, activeLoansByItemId });
    const page = paginateEntries(entries, state.page);
    await context.reply(
      `${formatMemberCatalogGroupDetails({ group, family: group.familyId !== null ? familyById(families, group.familyId) ?? null : null, items, language })}\n\n${formatEntryPage(page.items, page.page, page.totalPages, language)}`,
      { ...buildListNavigationOptions(await buildBrowseButtonRows(context, page.items), state, page.totalPages > 1, language), parseMode: 'HTML' },
    );
    return;
  }

  if (state.view === 'my-loans') {
    const loans = await loadActiveLoansByBorrower(context, context.runtime.actor.telegramUserId);
    if (loans.length === 0) {
      await context.reply(texts.catalogRead.noLoans);
      return;
    }

    const page = paginateEntries(loans, state.page);
    const catalog = resolveCatalogRepository(context);
    const loanLines = [texts.catalogRead.myLoans + ':'];
    for (const loan of page.items) {
      const item = await catalog.findItemById(loan.itemId);
      loanLines.push(`- ${item ? `<a href="${buildTelegramStartUrl(`catalog_read_item_${item.id}`)}"><b>${escapeHtml(item.displayName)}</b></a>` : `Item ${loan.itemId}`} · ${loan.dueAt ?? texts.catalogLoan.noDate}`);
    }
    const loanRows = await buildLoanRows(context, page.items, language);
    await context.reply(loanLines.join('\n'), { ...buildListNavigationOptions(loanRows, state, page.totalPages > 1, language), parseMode: 'HTML' });
    return;
  }

  if (state.view === 'item') {
    const item = state.itemId !== undefined ? itemById(items, state.itemId) ?? null : null;
    if (!item) {
      throw new Error(`Catalog item ${state.itemId ?? 'unknown'} not found`);
    }

    const family = item.familyId !== null ? familyById(families, item.familyId) ?? null : null;
    const group = item.groupId !== null ? groupById(groups, item.groupId) ?? null : null;
    const media = (await loadCatalogData(context)).media.filter((entry) => entry.itemId === item.id).sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id);
    const loan = await loadActiveLoanByItemId(context, item.id);
    await context.reply(
      formatMemberCatalogItemDetails({
        item,
        family,
        group,
        media,
        availabilityLines: await formatLoanAvailabilityLines(context, loan),
        language,
      }),
    {
      inlineKeyboard: buildLoanDetailButtons({
        loan,
        itemId: item.id,
        ...(context.runtime.actor.isAdmin
          ? { deleteCallbackData: `${catalogAdminCallbackPrefixes.deactivate}${item.id}` }
          : {}),
      }),
      parseMode: 'HTML',
    },
  );
  }
}

function buildListNavigationOptions(rows: TelegramInlineButton[][], state: CatalogReadState, showPaging: boolean, language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
  const texts = createTelegramI18n(language);
  return {
    inlineKeyboard: [
      ...rows,
      ...(showPaging ? [pagingButtons(language)] : []),
      ...(state.returnState ? [[{ text: language === 'es' ? 'Volver' : language === 'en' ? 'Back' : 'Tornar enrere', callbackData: catalogReadCallbackPrefixes.back }]] : []),
      [overviewButton(language)],
    ],
  };
}

async function buildBrowseButtonRows(context: TelegramCatalogReadContext, entries: CatalogBrowseEntry[]): Promise<TelegramInlineButton[][]> {
  const rows: TelegramInlineButton[][] = [];

  for (const entry of entries) {
    if (entry.kind === 'family') {
      rows.push([{ text: entry.label, callbackData: `${catalogReadCallbackPrefixes.inspectFamily}${entry.id}` }]);
      continue;
    }

    if (entry.kind === 'group') {
      rows.push([{ text: entry.label, callbackData: `${catalogReadCallbackPrefixes.inspectGroup}${entry.id}` }]);
      continue;
    }

    const loan = await loadActiveLoanByItemId(context, entry.id);
    rows.push(buildLoanItemButton(loan, entry.id, entry.label));
  }

  return rows;
}

async function buildLoanRows(context: TelegramCatalogReadContext, loans: CatalogLoanRecord[], language: 'ca' | 'es' | 'en'): Promise<TelegramInlineButton[][]> {
  const catalog = resolveCatalogRepository(context);
  const rows: TelegramInlineButton[][] = [];

  for (const loan of loans) {
    const item = await catalog.findItemById(loan.itemId);
    const row: TelegramInlineButton[] = [
      { text: item?.displayName ?? `Item ${loan.itemId}`, callbackData: `catalog_read:item:${loan.itemId}` },
      { text: language === 'es' ? 'Devolver' : language === 'en' ? 'Return' : 'Retornar', callbackData: `${catalogLoanCallbackPrefixes.return}${loan.id}` },
    ];
    rows.push(row);
  }

  return rows;
}

function overviewButton(language: 'ca' | 'es' | 'en') {
  return { text: language === 'es' ? 'Ver catalogo' : language === 'en' ? 'View catalog' : 'Veure cataleg', callbackData: catalogReadCallbackPrefixes.overview };
}

function pagingButtons(language: 'ca' | 'es' | 'en'): Array<{ text: string; callbackData: string }> {
  return [
    { text: language === 'es' ? 'Anterior' : language === 'en' ? 'Previous' : 'Anterior', callbackData: catalogReadCallbackPrefixes.pagePrev },
    { text: language === 'es' ? 'Siguiente' : language === 'en' ? 'Next' : 'Següent', callbackData: catalogReadCallbackPrefixes.pageNext },
  ];
}

function paginateEntries<T>(entries: T[], page: number): { items: T[]; page: number; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(entries.length / catalogReadPageSize));
  const resolvedPage = Math.min(Math.max(page, 1), totalPages);
  const start = (resolvedPage - 1) * catalogReadPageSize;
  return {
    items: entries.slice(start, start + catalogReadPageSize),
    page: resolvedPage,
    totalPages,
  };
}

function formatEntryPage(entries: CatalogBrowseEntry[], page: number, totalPages: number, language: 'ca' | 'es' | 'en'): string {
  const lines = [language === 'ca' ? `Pàgina ${page}/${totalPages}` : language === 'es' ? `Página ${page}/${totalPages}` : `Page ${page}/${totalPages}`];
  if (entries.length === 0) {
    lines.push(language === 'ca' ? '- Cap resultat' : language === 'es' ? '- Ningun resultado' : '- No results');
    return lines.join('\n');
  }

  for (const entry of entries) {
    lines.push(`- ${formatCatalogBrowseEntryLabel(entry)} · ${entry.subtitle}`);
  }
  return lines.join('\n');
}

function formatCatalogBrowseEntryLabel(entry: CatalogBrowseEntry): string {
  if (entry.kind !== 'item') {
    return entry.label;
  }

  return `<a href="${buildTelegramStartUrl(`catalog_read_item_${entry.id}`)}"><b>${escapeHtml(entry.label)}</b></a>`;
}

function formatLoanDate(value: string): string {
  return value.slice(0, 10).split('-').reverse().join('/');
}

function parseStartPayload(messageText: string | undefined, prefix: string): number | null {
  const payload = messageText?.trim().split(/\s+/).slice(1).join(' ');
  if (!payload || !payload.startsWith(prefix)) {
    return null;
  }

  const value = Number(payload.slice(prefix.length));
  return Number.isInteger(value) && value > 0 ? value : null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function buildOverviewEntries(context: TelegramCatalogReadContext, { families, items, activeLoansByItemId }: { families: CatalogFamilyRecord[]; items: CatalogItemRecord[]; activeLoansByItemId: Map<number, CatalogLoanRecord>; }): Promise<CatalogBrowseEntry[]> {
  const entries: CatalogBrowseEntry[] = families
    .slice()
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
    .map((family) => ({
      kind: 'family' as const,
      id: family.id,
      label: family.displayName,
      subtitle: `${countFamilyItems(items, family.id)} item${countFamilyItems(items, family.id) === 1 ? '' : 's'}`,
    }));

  for (const item of items.filter((entry) => entry.familyId === null && entry.groupId === null).sort((left, right) => left.displayName.localeCompare(right.displayName))) {
    entries.push({ kind: 'item', id: item.id, label: item.displayName, subtitle: await formatItemSubtitle(context, item, activeLoansByItemId.get(item.id) ?? null) });
  }

  return entries;
}

async function buildFamilyEntries(context: TelegramCatalogReadContext, { family, groups, items, activeLoansByItemId }: { family: CatalogFamilyRecord; groups: CatalogGroupRecord[]; items: CatalogItemRecord[]; activeLoansByItemId: Map<number, CatalogLoanRecord>; }): Promise<CatalogBrowseEntry[]> {
  const entries: CatalogBrowseEntry[] = groups
    .filter((group) => group.familyId === family.id)
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
    .map((group) => ({
      kind: 'group' as const,
      id: group.id,
      label: group.displayName,
      subtitle: `${countGroupItems(items, group.id)} item${countGroupItems(items, group.id) === 1 ? '' : 's'}`,
    }));

  for (const item of items.filter((entry) => entry.familyId === family.id && entry.groupId === null).sort((left, right) => left.displayName.localeCompare(right.displayName))) {
    entries.push({ kind: 'item', id: item.id, label: item.displayName, subtitle: await formatItemSubtitle(context, item, activeLoansByItemId.get(item.id) ?? null) });
  }

  return entries;
}

async function buildGroupEntries(context: TelegramCatalogReadContext, { group, items, activeLoansByItemId }: { group: CatalogGroupRecord; items: CatalogItemRecord[]; activeLoansByItemId: Map<number, CatalogLoanRecord>; }): Promise<CatalogBrowseEntry[]> {
  return Promise.all(items
    .filter((item) => item.groupId === group.id)
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
    .map(async (item) => ({
      kind: 'item' as const,
      id: item.id,
      label: item.displayName,
      subtitle: await formatItemSubtitle(context, item, activeLoansByItemId.get(item.id) ?? null),
    })));
}

async function loadCatalogData(context: TelegramCatalogReadContext): Promise<{
  families: CatalogFamilyRecord[];
  groups: CatalogGroupRecord[];
  items: CatalogItemRecord[];
  media: CatalogMediaRecord[];
}> {
  const repository = resolveCatalogRepository(context);
  const [families, groups, items, media] = await Promise.all([
    repository.listFamilies(),
    repository.listGroups({}),
    repository.listItems({ includeDeactivated: false }),
    repository.listMedia({}),
  ]);

  return { families, groups, items, media };
}

async function loadActiveLoansByItemMap(context: TelegramCatalogReadContext, items: CatalogItemRecord[]): Promise<Map<number, CatalogLoanRecord>> {
  const pairs = await Promise.all(items.map(async (item) => [item.id, await loadActiveLoanByItemId(context, item.id)] as const));
  return new Map(pairs.filter(([, loan]) => loan !== null) as Array<readonly [number, CatalogLoanRecord]>);
}

async function searchCatalogItems(context: TelegramCatalogReadContext, {
  families,
  groups,
  items,
  activeLoansByItemId,
  query,
}: {
  families: CatalogFamilyRecord[];
  groups: CatalogGroupRecord[];
  items: CatalogItemRecord[];
  activeLoansByItemId: Map<number, CatalogLoanRecord>;
  query: string;
}): Promise<CatalogBrowseEntry[]> {
  const normalizedQuery = query.trim().toLowerCase();
  const tokens = normalizedQuery.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return [];
  }

  return Promise.all(items
    .filter((item) => {
      const family = item.familyId !== null ? familyById(families, item.familyId) : null;
      const group = item.groupId !== null ? groupById(groups, item.groupId) : null;
      return matchesText([
        item.displayName,
        item.originalName,
        item.description,
        item.publisher,
        item.language,
        item.itemType,
        family?.displayName,
        family?.description,
        group?.displayName,
        group?.description,
      ], tokens);
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
    .map(async (item) => ({
      kind: 'item' as const,
      id: item.id,
      label: item.displayName,
      subtitle: await formatItemSubtitle(context, item, activeLoansByItemId.get(item.id) ?? null),
    })));
}

async function formatItemSubtitle(context: TelegramCatalogReadContext, item: CatalogItemRecord, loan: CatalogLoanRecord | null): Promise<string> {
  if (!loan) {
    return renderCatalogItemType(item.itemType);
  }

  return `${renderCatalogItemType(item.itemType)} · Prestat a ${await resolveLoanBorrowerDisplayName(context, loan)} des de ${formatLoanDate(loan.createdAt)}`;
}

function parseCatalogSearchQuery(text: string): string | null {
  const prefix = '/catalog_search';
  if (!text.startsWith(prefix)) {
    return null;
  }

  const query = text.slice(prefix.length).trim();
  return query.length > 0 ? query : null;
}

function matchesText(values: Array<string | null | undefined>, tokens: string[]): boolean {
  const haystack = values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join(' ').toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function parseEntityId(callbackData: string, prefix: string): number {
  const value = Number(callbackData.slice(prefix.length));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('No s ha pogut identificar l element seleccionat.');
  }

  return value;
}

function resolveCatalogRepository(context: TelegramCatalogReadContext): CatalogRepository {
  if (context.catalogRepository) {
    return context.catalogRepository;
  }

  return createDatabaseCatalogRepository({ database: context.runtime.services.database.db as never });
}

function readCatalogReadState(context: TelegramCatalogReadContext): CatalogReadState | null {
  const current = context.runtime.session.current;
  if (!current || current.flowKey !== catalogReadFlowKey) {
    return null;
  }

  return current.data as unknown as CatalogReadState;
}

async function persistCatalogReadState(context: TelegramCatalogReadContext, state: CatalogReadState): Promise<void> {
  const current = context.runtime.session.current;
  if (current && current.flowKey === catalogReadFlowKey) {
    await context.runtime.session.advance({ stepKey: 'browse', data: state as unknown as Record<string, unknown> });
    return;
  }

  await context.runtime.session.start({ flowKey: catalogReadFlowKey, stepKey: 'browse', data: state as unknown as Record<string, unknown> });
}

function isListView(view: CatalogReadView): boolean {
  return view === 'overview' || view === 'search' || view === 'family' || view === 'group';
}

function familyById(families: CatalogFamilyRecord[], familyId: number): CatalogFamilyRecord | undefined {
  return families.find((family) => family.id === familyId);
}

function groupById(groups: CatalogGroupRecord[], groupId: number): CatalogGroupRecord | undefined {
  return groups.find((group) => group.id === groupId);
}

function itemById(items: CatalogItemRecord[], itemId: number): CatalogItemRecord | undefined {
  return items.find((item) => item.id === itemId);
}

function countFamilyItems(items: CatalogItemRecord[], familyId: number): number {
  return items.filter((item) => item.familyId === familyId).length;
}

function countGroupItems(items: CatalogItemRecord[], groupId: number): number {
  return items.filter((item) => item.groupId === groupId).length;
}
