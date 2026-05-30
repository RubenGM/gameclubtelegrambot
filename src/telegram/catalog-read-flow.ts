import type { CatalogMediaRecord, CatalogRepository, CatalogFamilyRecord, CatalogGroupRecord, CatalogItemRecord } from '../catalog/catalog-model.js';
import { createDatabaseCatalogRepository } from '../catalog/catalog-store.js';
import { createDatabaseMembershipAccessRepository } from '../membership/access-flow-store.js';
import type { MembershipAccessRepository } from '../membership/access-flow.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import {
  formatMemberCatalogFamilyDetails,
  formatMemberCatalogGroupDetails,
  formatMemberCatalogItemDetails,
  formatCatalogItemSummaryDetails,
  formatMemberCatalogOverview,
  formatHtmlField,
  renderCatalogItemType,
} from './catalog-presentation.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import {
  buildLoanDetailButtons,
  canReturnLoan,
  catalogLoanCallbackPrefixes,
  formatLoanAvailabilityLines,
  resolveLoanBorrowerDisplayName,
  type CatalogLoanRecord,
  loadActiveLoanByItemId,
  loadActiveLoansByBorrower,
  handleTelegramCatalogLoanCallback,
  type TelegramCatalogLoanContext,
} from './catalog-loan-flow.js';
import { catalogAdminCallbackPrefixes, handleTelegramCatalogAdminCallback } from './catalog-admin-flow.js';
import type { TelegramInlineButton, TelegramReplyButton, TelegramReplyOptions } from './runtime-boundary.js';
import { buildTelegramStartUrl } from './deep-links.js';
import { sendCatalogItemCoverIfPresent } from './catalog-cover-media.js';
import { formatTelegramUserLink } from './telegram-user-links.js';

const catalogReadFlowKey = 'catalog-read';
const catalogReadPageSize = 5;
const catalogReadFullItemStartPayloadPrefix = 'catalog_read_item_full_';

export const catalogReadCallbackPrefixes = {
  overview: 'catalog_read:overview',
  pageNext: 'catalog_read:page:next',
  pagePrev: 'catalog_read:page:prev',
  back: 'catalog_read:back',
  myLoans: 'catalog_read:my_loans',
  inspectLetter: 'catalog_read:letter:',
  inspectFamily: 'catalog_read:family:',
  inspectGroup: 'catalog_read:group:',
  inspectItem: 'catalog_read:item:',
} as const;

export type TelegramCatalogReadContext = TelegramCatalogLoanContext & {
  catalogRepository?: CatalogRepository;
};

type CatalogReadView = 'overview' | 'search' | 'letter' | 'family' | 'group' | 'item' | 'my-loans';

interface CatalogReadState {
  view: CatalogReadView;
  page: number;
  query?: string;
  initial?: string;
  familyId?: number;
  groupId?: number;
  itemId?: number;
  returnState?: CatalogReadState;
}

interface CatalogBrowseEntry {
  kind: 'letter' | 'family' | 'group' | 'item';
  id: number;
  label: string;
  subtitle: string;
  initial?: string;
}

export async function handleTelegramCatalogReadCommand(context: TelegramCatalogReadContext): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const query = parseCatalogSearchQuery(context.messageText?.trim() ?? '');
  const state: CatalogReadState = query ? { view: 'search', page: 1, query } : { view: 'overview', page: 1 };

  await persistCatalogReadState(context, state);
  await renderCatalogReadState(context, state, language);
}

export async function handleTelegramCatalogReadText(context: TelegramCatalogReadContext): Promise<boolean> {
  const text = context.messageText?.trim();
  if (
    !text ||
    context.runtime.chat.kind !== 'private' ||
    !context.runtime.actor.isApproved ||
    context.runtime.actor.isBlocked
  ) {
    return false;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  if (await handleCatalogReadDetailKeyboardText(context, text, language)) {
    return true;
  }
  if (context.runtime.actor.isAdmin) {
    return false;
  }
  if (text !== createTelegramI18n(language).actionMenu.catalog) {
    return false;
  }

  await handleTelegramCatalogReadCommand({ ...context, messageText: '/catalog_search' });
  return true;
}

export async function handleTelegramCatalogReadStartText(context: TelegramCatalogReadContext): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  if (context.messageText?.trim() === '/start catalog_read' && context.runtime.chat.kind === 'private' && context.runtime.actor.isApproved) {
    const state: CatalogReadState = { view: 'overview', page: 1 };
    await persistCatalogReadState(context, state);
    await renderCatalogReadState(context, state, language);
    return true;
  }

  const initials = parseStartInitial(context.messageText, 'catalog_read_letter_');
  if (initials !== null && context.runtime.chat.kind === 'private' && context.runtime.actor.isApproved) {
    const state: CatalogReadState = { view: 'letter', page: 1, initial: initials, returnState: { view: 'overview', page: 1 } };
    await persistCatalogReadState(context, state);
    await renderCatalogReadState(context, state, language);
    return true;
  }

  const fullItemId = parseStartPayload(context.messageText, catalogReadFullItemStartPayloadPrefix);
  const itemId = fullItemId ?? parseStartPayload(context.messageText, 'catalog_read_item_');
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
  await persistCatalogReadState(context, { view: 'item', page: 1, itemId, returnState: { view: 'overview', page: 1 } });
  await replyWithCatalogReadItemDetail(context, {
    item,
    family,
    group,
    media: media.filter((entry) => entry.itemId === item.id).sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id),
    loan,
    language,
    full: fullItemId !== null,
  });
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

  if (callbackData.startsWith(catalogReadCallbackPrefixes.inspectLetter)) {
    const initials = parseInitial(callbackData, catalogReadCallbackPrefixes.inspectLetter);
    const current = readCatalogReadState(context);
    const nextState: CatalogReadState = { view: 'letter', page: 1, initial: initials, returnState: current ?? { view: 'overview', page: 1 } };
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
    const entries = buildOverviewEntries({ items, language });
    const page = paginateEntries(entries, state.page);
    await context.reply(
      `${formatMemberCatalogOverview({ families, groups, items, language })}\n\n${formatEntryPage(page.items, page.page, page.totalPages, language)}`,
      { ...buildListNavigationOptions([], state, page.totalPages > 1, language), parseMode: 'HTML' },
    );
    return;
  }

  if (state.view === 'letter') {
    const initials = normalizeInitialSet(state.initial ?? '');
    const results = await buildLetterEntries(context, { items, activeLoansByItemId, initials });
    const page = paginateEntries(results, state.page);
    const lines = [
      formatLetterHeading(initials, results.length, language),
      formatEntryPage(page.items, page.page, page.totalPages, language),
    ];
    await context.reply(lines.join('\n\n'), { ...buildListNavigationOptions([], state, page.totalPages > 1, language), parseMode: 'HTML' });
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
    await context.reply(lines.join('\n'), { ...buildListNavigationOptions([], state, page.totalPages > 1, language), parseMode: 'HTML' });
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
      { ...buildListNavigationOptions([], state, page.totalPages > 1, language), parseMode: 'HTML' },
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
      { ...buildListNavigationOptions([], state, page.totalPages > 1, language), parseMode: 'HTML' },
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
    await replyWithCatalogReadItemDetail(context, { item, family, group, media, loan, language, full: false });
  }
}

async function replyWithCatalogReadItemDetail(
  context: TelegramCatalogReadContext,
  input: {
    item: CatalogItemRecord;
    family: CatalogFamilyRecord | null;
    group: CatalogGroupRecord | null;
    media: CatalogMediaRecord[];
    loan: CatalogLoanRecord | null;
    language: 'ca' | 'es' | 'en';
    full?: boolean;
  },
): Promise<void> {
  await sendCatalogItemCoverIfPresent(context, { itemId: input.item.id, media: input.media });
  const ownerLine = await formatCatalogReadOwnerLine(context, input.item, input.language, { includeEmpty: Boolean(input.full) });
  await context.reply(
    input.full
      ? formatMemberCatalogItemDetails({
          breadcrumbLine: buildCatalogReadItemBreadcrumb(input.item, input.language),
          item: input.item,
          family: input.family,
          group: input.group,
          media: input.media,
          availabilityLines: await formatLoanAvailabilityLines(context, input.loan),
          ownerLine,
          language: input.language,
        })
      : formatCatalogItemSummaryDetails({
          breadcrumbLine: buildCatalogReadItemBreadcrumb(input.item, input.language),
          item: input.item,
          availabilityLine: formatCatalogReadAvailabilityLine(input.loan, input.language),
          borrowerLine: await formatCatalogReadBorrowerLine(context, input.loan, input.language),
          ownerLine,
          detailsUrl: buildTelegramStartUrl(`${catalogReadFullItemStartPayloadPrefix}${input.item.id}`),
          language: input.language,
        }),
    {
      ...buildCatalogReadItemReplyOptions(context, input.item, input.loan, input.language),
      parseMode: 'HTML',
    },
  );
}

async function formatCatalogReadOwnerLine(
  context: TelegramCatalogReadContext,
  item: CatalogItemRecord,
  language: 'ca' | 'es' | 'en',
  { includeEmpty = true }: { includeEmpty?: boolean } = {},
): Promise<string | null> {
  const texts = createTelegramI18n(language).catalogAdmin;
  if (item.ownerTelegramUserId == null) {
    return includeEmpty ? formatHtmlField(texts.owner, escapeHtml(texts.noOwner)) : null;
  }
  const owner = await resolveMembershipRepository(context).findUserByTelegramUserId(item.ownerTelegramUserId);
  if (!owner) {
    return formatHtmlField(texts.owner, escapeHtml(`#${item.ownerTelegramUserId}`));
  }
  return formatHtmlField(texts.owner, formatTelegramUserLink(owner));
}

function formatCatalogReadAvailabilityLine(loan: CatalogLoanRecord | null, language: 'ca' | 'es' | 'en'): string {
  const texts = createTelegramI18n(language).catalogLoan;
  return formatHtmlField(texts.availabilityAvailable, loan ? texts.availabilityLoaned : texts.available);
}

async function formatCatalogReadBorrowerLine(context: TelegramCatalogReadContext, loan: CatalogLoanRecord | null, language: 'ca' | 'es' | 'en'): Promise<string | null> {
  if (!loan) {
    return null;
  }
  const texts = createTelegramI18n(language).catalogLoan;
  return formatHtmlField(texts.availabilityHas, escapeHtml(await resolveLoanBorrowerDisplayName(context, loan)));
}

function buildCatalogReadItemReplyOptions(
  context: TelegramCatalogReadContext,
  item: CatalogItemRecord,
  loan: CatalogLoanRecord | null,
  language: 'ca' | 'es' | 'en',
): TelegramReplyOptions {
  const loanRows = buildLoanDetailButtons({
    loan,
    itemId: item.id,
    language,
    canReturn: loan ? canReturnLoan(context, loan) : true,
    ...(context.runtime.actor.isAdmin
      ? { deleteCallbackData: `${catalogAdminCallbackPrefixes.deactivate}${item.id}` }
      : {}),
  });
  const texts = createTelegramI18n(language);
  const rows: TelegramReplyOptions['replyKeyboard'] = [];
  if (loan && loan.borrowerTelegramUserId === context.runtime.actor.telegramUserId && canReturnLoan(context, loan)) {
    rows.push([successButton(texts.catalogLoan.retornar)]);
  }
  if (item.itemType === 'board-game') {
    rows.push([successButton(texts.catalogAdmin.createActivity)]);
  }
  rows.push([texts.catalogLoan.veurePrestecs]);
  rows.push([overviewButton(language).text, formatInitialSetLabel(getCatalogItemInitial(item))]);

  const prioritizedTexts = new Set(rows.flat().map((button) => typeof button === 'string' ? button : button.text));
  rows.push(...loanRows
    .map((row) => row.filter((button) => !prioritizedTexts.has(button.text)).map((button) => button.text))
    .filter((row) => row.length > 0));
  return { replyKeyboard: rows, resizeKeyboard: true, persistentKeyboard: true };
}

async function handleCatalogReadDetailKeyboardText(
  context: TelegramCatalogReadContext,
  text: string,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const state = readCatalogReadState(context);
  if (!state || state.view !== 'item' || state.itemId === undefined) {
    return false;
  }
  if (text === overviewButton(language).text) {
    await handleTelegramCatalogReadCallback({ ...context, callbackData: catalogReadCallbackPrefixes.overview });
    return true;
  }
  const { items } = await loadCatalogData(context);
  const item = itemById(items, state.itemId);
  if (!item) {
    return false;
  }
  if (text === formatInitialSetLabel(getCatalogItemInitial(item))) {
    await handleTelegramCatalogReadCallback({ ...context, callbackData: `${catalogReadCallbackPrefixes.inspectLetter}${getCatalogItemInitial(item)}` });
    return true;
  }
  const adminTexts = createTelegramI18n(language).catalogAdmin;
  if (item.itemType === 'board-game' && text === adminTexts.createActivity) {
    await withTemporaryCallbackData(context, `${catalogAdminCallbackPrefixes.createActivity}${item.id}`, async () => {
      await handleTelegramCatalogAdminCallback(context);
    });
    return true;
  }
  const loan = await loadActiveLoanByItemId(context, item.id);
  const buttons = buildLoanDetailButtons({
    loan,
    itemId: item.id,
    language,
    canReturn: loan ? canReturnLoan(context, loan) : true,
  }).flat();
  const action = buttons.find((button) => button.text === text);
  if (!action?.callbackData) {
    return false;
  }
  await withTemporaryCallbackData(context, action.callbackData, async () => {
    await handleTelegramCatalogLoanCallback(context);
  });
  return true;
}

async function withTemporaryCallbackData(
  context: TelegramCatalogReadContext,
  callbackData: string,
  run: () => Promise<void>,
): Promise<void> {
  const previousCallbackData = context.callbackData;
  context.callbackData = callbackData;
  try {
    await run();
  } finally {
    if (previousCallbackData === undefined) {
      delete context.callbackData;
    } else {
      context.callbackData = previousCallbackData;
    }
  }
}

function successButton(text: string): TelegramReplyButton {
  return { text, semanticRole: 'success' };
}

function resolveMembershipRepository(context: TelegramCatalogReadContext): MembershipAccessRepository {
  return context.membershipRepository ?? createDatabaseMembershipAccessRepository({ database: context.runtime.services.database.db as never });
}

function buildCatalogReadItemBreadcrumb(item: CatalogItemRecord, language: 'ca' | 'es' | 'en'): string {
  const initial = getCatalogItemInitial(item);
  const rootHref = buildTelegramStartUrl('catalog_read');
  const letterHref = buildTelegramStartUrl(`catalog_read_letter_${serializeInitialSetForStartPayload(initial)}`);
  const texts = createTelegramI18n(language);
  return `<a href="${escapeHtml(rootHref)}">${escapeHtml(texts.actionMenu.catalog)}</a> / <a href="${escapeHtml(letterHref)}">${escapeHtml(formatInitialSetLabel(initial))}</a>`;
}

function buildListNavigationOptions(rows: TelegramInlineButton[][], state: CatalogReadState, showPaging: boolean, language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
  const navigationRows: TelegramInlineButton[][] = [];
  if (showPaging) {
    navigationRows.push(pagingButtons(language));
  }
  if (state.returnState) {
    navigationRows.push([{ text: language === 'es' ? 'Volver' : language === 'en' ? 'Back' : 'Tornar enrere', callbackData: catalogReadCallbackPrefixes.back }]);
  }
  if (state.view !== 'overview') {
    navigationRows.push([overviewButton(language)]);
  }
  const inlineKeyboard = [...rows, ...navigationRows];
  if (inlineKeyboard.length === 0) {
    return {};
  }

  return {
    inlineKeyboard,
  };
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
  return { text: language === 'es' ? 'Ver catálogo' : language === 'en' ? 'View catalog' : 'Veure catàleg', callbackData: catalogReadCallbackPrefixes.overview };
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
    lines.push(`- ${formatCatalogBrowseEntryLabel(entry)}${entry.subtitle ? `\n${escapeHtml(entry.subtitle)}` : ''}`);
  }
  return lines.join('\n');
}

function formatCatalogBrowseEntryLabel(entry: CatalogBrowseEntry): string {
  if (entry.kind === 'letter') {
    return `<a href="${buildTelegramStartUrl(`catalog_read_letter_${serializeInitialSetForStartPayload(entry.initial ?? entry.label)}`)}"><b>${escapeHtml(entry.label)}</b></a>`;
  }

  if (entry.kind !== 'item') {
    return escapeHtml(entry.label);
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

function parseStartInitial(messageText: string | undefined, prefix: string): string | null {
  const payload = messageText?.trim().split(/\s+/).slice(1).join(' ');
  if (!payload || !payload.startsWith(prefix)) {
    return null;
  }

  const value = deserializeInitialSetFromStartPayload(payload.slice(prefix.length));
  return value ? value : null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildOverviewEntries({ items, language }: { items: CatalogItemRecord[]; language: 'ca' | 'es' | 'en'; }): CatalogBrowseEntry[] {
  const buckets = new Map<string, CatalogItemRecord[]>();

  for (const item of items) {
    const initial = getCatalogItemInitial(item);
    buckets.set(initial, [...(buckets.get(initial) ?? []), item]);
  }

  const sortedInitials = Array.from(buckets.keys()).sort((left, right) => left.localeCompare(right));
  return chunkArray(sortedInitials, 3)
    .map((initials, index) => {
      const bucketItems = initials.flatMap((initial) => buckets.get(initial) ?? []);
      const initialSet = initials.join('');
      return {
      kind: 'letter' as const,
      id: index + 1,
      label: `${formatInitialSetLabel(initialSet)} - ${bucketItems.length} ${articleCountLabel(bucketItems.length, language)}`,
      subtitle: formatLetterCounts(bucketItems, language).join('\n'),
      initial: initialSet,
      };
    });
}

async function buildLetterEntries(context: TelegramCatalogReadContext, { items, activeLoansByItemId, initials }: { items: CatalogItemRecord[]; activeLoansByItemId: Map<number, CatalogLoanRecord>; initials: string; }): Promise<CatalogBrowseEntry[]> {
  const initialSet = new Set(normalizeInitialSet(initials).split(''));
  return Promise.all(items
    .filter((item) => initialSet.has(getCatalogItemInitial(item)))
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
    .map(async (item) => ({
      kind: 'item' as const,
      id: item.id,
      label: item.displayName,
      subtitle: await formatItemSubtitle(context, item, activeLoansByItemId.get(item.id) ?? null),
    })));
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

  return `${renderCatalogItemType(item.itemType)} · Prestat a ${escapeHtml(await resolveLoanBorrowerDisplayName(context, loan))} des de ${formatLoanDate(loan.createdAt)}`;
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

function parseInitial(callbackData: string, prefix: string): string {
  const value = decodeURIComponent(callbackData.slice(prefix.length)).trim();
  if (!value) {
    throw new Error('No s ha pogut identificar la lletra seleccionada.');
  }

  return value;
}

function getCatalogItemInitial(item: CatalogItemRecord): string {
  const first = item.displayName.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').at(0)?.toUpperCase() ?? '#';
  return /^[A-Z]$/.test(first) ? first : '#';
}

function formatLetterHeading(initials: string, count: number, language: 'ca' | 'es' | 'en'): string {
  const label = formatInitialSetLabel(initials);
  const title = language === 'es'
    ? `Artículos en ${label}`
    : language === 'en'
      ? `Items in ${label}`
      : `Articles a ${label}`;
  return `<b>${escapeHtml(title)}</b> · ${count} ${articleCountLabel(count, language)}`;
}

function normalizeInitialSet(value: string): string {
  return Array.from(new Set(value.trim().toUpperCase().replace(/[^A-Z#]/g, '').split(''))).join('');
}

function serializeInitialSetForStartPayload(value: string): string {
  const normalized = normalizeInitialSet(value);
  if (normalized.startsWith('#')) {
    return `hash_${normalized.slice(1)}`;
  }

  return normalized;
}

function deserializeInitialSetFromStartPayload(value: string): string {
  const decoded = decodeURIComponent(value).trim();
  if (decoded.startsWith('hash_')) {
    return normalizeInitialSet(`#${decoded.slice('hash_'.length)}`);
  }

  return normalizeInitialSet(decoded);
}

function formatInitialSetLabel(initials: string): string {
  return normalizeInitialSet(initials).split('').join(' ');
}

function chunkArray<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function formatLetterCounts(items: CatalogItemRecord[], language: 'ca' | 'es' | 'en'): string[] {
  const boardGameCount = items.filter((item) => item.itemType === 'board-game' || item.itemType === 'expansion').length;
  const bookCount = items.filter((item) => item.itemType === 'book' || item.itemType === 'rpg-book').length;
  const accessoryCount = items.filter((item) => item.itemType === 'accessory').length;
  const lines: string[] = [];

  if (boardGameCount > 0) {
    lines.push(`${boardGameCount} ${boardGameCountLabel(boardGameCount, language)}`);
  }
  if (bookCount > 0) {
    lines.push(`${bookCount} ${bookCountLabel(bookCount, language)}`);
  }
  if (accessoryCount > 0) {
    lines.push(`${accessoryCount} ${accessoryCountLabel(accessoryCount, language)}`);
  }

  return lines;
}

function articleCountLabel(count: number, language: 'ca' | 'es' | 'en'): string {
  if (language === 'es') {
    return count === 1 ? 'artículo' : 'artículos';
  }
  if (language === 'en') {
    return count === 1 ? 'item' : 'items';
  }
  return count === 1 ? 'article' : 'articles';
}

function boardGameCountLabel(count: number, language: 'ca' | 'es' | 'en'): string {
  if (language === 'es') {
    return count === 1 ? 'juego de mesa' : 'juegos de mesa';
  }
  if (language === 'en') {
    return count === 1 ? 'board game' : 'board games';
  }
  return count === 1 ? 'joc de taula' : 'jocs de taula';
}

function bookCountLabel(count: number, language: 'ca' | 'es' | 'en'): string {
  if (language === 'es') {
    return count === 1 ? 'libro' : 'libros';
  }
  if (language === 'en') {
    return count === 1 ? 'book' : 'books';
  }
  return count === 1 ? 'llibre' : 'llibres';
}

function accessoryCountLabel(count: number, language: 'ca' | 'es' | 'en'): string {
  if (language === 'es') {
    return count === 1 ? 'accesorio' : 'accesorios';
  }
  if (language === 'en') {
    return count === 1 ? 'accessory' : 'accessories';
  }
  return count === 1 ? 'accessori' : 'accessoris';
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
  return view === 'overview' || view === 'search' || view === 'letter' || view === 'family' || view === 'group';
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
