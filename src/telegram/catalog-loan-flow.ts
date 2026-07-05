import type { CatalogItemRecord, CatalogLoanRecord, CatalogLoanRepository, CatalogRepository } from '../catalog/catalog-model.js';
export type { CatalogLoanRecord } from '../catalog/catalog-model.js';
import { createDatabaseCatalogRepository } from '../catalog/catalog-store.js';
import { createDatabaseCatalogLoanRepository } from '../catalog/catalog-loan-store.js';
import { parseCatalogStorageEntryUrl } from '../catalog/catalog-media-storage.js';
import { createDatabaseMembershipAccessRepository } from '../membership/access-flow-store.js';
import { catalogLoanNewsCategoryByItemType, type NewsGroupRepository } from '../news/news-group-catalog.js';
import { createDatabaseNewsGroupRepository } from '../news/news-group-store.js';
import { createDatabaseStorageRepository } from '../storage/storage-catalog-store.js';
import type { StorageCategoryRepository, StorageEntryMessageRecord } from '../storage/storage-catalog.js';
import type { MembershipAccessRepository, MembershipUserRecord } from '../membership/access-flow.js';
import { escapeHtml, formatCatalogItemSummaryDetails, formatHtmlField } from './catalog-presentation.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import type { TelegramInlineButton, TelegramReplyButton, TelegramReplyOptions } from './runtime-boundary.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import { formatMembershipDisplayName, resolveTelegramDisplayName } from '../membership/display-name.js';
import { buildTelegramStartUrl } from './deep-links.js';
import { formatTelegramUserLink } from './telegram-user-links.js';

const loanEditFlowKey = 'catalog-loan-edit';
const catalogAdminBrowseFlowKey = 'catalog-admin-browse';
const catalogAdminEditCallbackPrefix = 'catalog_admin:edit:';
const catalogAdminCreateActivityCallbackPrefix = 'catalog_admin:create_activity:';
const catalogAdminDeactivateCallbackPrefix = 'catalog_admin:deactivate:';
const catalogReadFullItemStartPayloadPrefix = 'catalog_read_item_full_';

export const catalogLoanCallbackPrefixes = {
  openMyLoans: 'catalog_loan:my_loans',
  adminDashboard: 'catalog_loan:admin_dashboard',
  adminDashboardPage: 'catalog_loan:admin_dashboard:',
  create: 'catalog_loan:create:',
  return: 'catalog_loan:return:',
  edit: 'catalog_loan:edit:',
} as const;

const adminLoanDashboardPageSize = 5;

export type TelegramCatalogLoanContext = TelegramCommandHandlerContext & {
  catalogRepository?: CatalogRepository;
  catalogLoanRepository?: CatalogLoanRepository;
  membershipRepository?: MembershipAccessRepository;
  newsGroupRepository?: NewsGroupRepository;
  storageRepository?: StorageCategoryRepository;
};

type LoanDisplayContext = {
  runtime: {
    bot?: {
      language?: string;
    };
    services: {
      database: {
        db: unknown;
      };
    };
  };
  membershipRepository?: MembershipAccessRepository | undefined;
};

type LoanRepositoryContext = {
  catalogLoanRepository?: CatalogLoanRepository;
  runtime: {
    services: {
      database: {
        db: unknown;
      };
    };
  };
};

type LoanActorContext = {
  runtime: {
    actor: {
      telegramUserId: number;
      isAdmin: boolean;
    };
  };
};

type AdminLoanDashboardContext = LoanRepositoryContext & {
  reply(message: string, options?: TelegramReplyOptions): Promise<unknown>;
  runtime: LoanRepositoryContext['runtime'] & {
    actor: {
      isAdmin: boolean;
    };
    bot: {
      language?: string;
    };
  };
};

export async function handleTelegramCatalogLoanCallback(context: TelegramCatalogLoanContext): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).catalogLoan;
  const callbackData = context.callbackData;
  if (!callbackData) {
    return false;
  }

  if (callbackData === catalogLoanCallbackPrefixes.openMyLoans) {
    await showMyLoans(context);
    return true;
  }

  if (callbackData === catalogLoanCallbackPrefixes.adminDashboard) {
    await showAdminLoanDashboard(context, 1);
    return true;
  }

  if (callbackData.startsWith(catalogLoanCallbackPrefixes.adminDashboardPage)) {
    await showAdminLoanDashboard(context, parseDashboardPage(callbackData));
    return true;
  }

  if (callbackData.startsWith(catalogLoanCallbackPrefixes.create)) {
    const itemId = parseEntityId(callbackData, catalogLoanCallbackPrefixes.create);
    const repository = resolveLoanRepository(context);
    const item = await resolveCatalogItem(context, itemId);
    if (!item) {
      throw new Error(`Catalog item ${itemId} not found`);
    }

    const created = await repository.createLoan({
      itemId,
      borrowerTelegramUserId: context.runtime.actor.telegramUserId,
      borrowerDisplayName: await resolveDisplayName(context),
      loanedByTelegramUserId: context.runtime.actor.telegramUserId,
      dueAt: null,
      notes: null,
    });

    await replyWithItemDetail(context, created.itemId, language);
    await publishCatalogLoanNewsGroups(context, {
      action: 'borrowed',
      item,
      userName: await resolvePreferredUserName(context, context.runtime.actor.telegramUserId),
    });
    return true;
  }

  if (callbackData.startsWith(catalogLoanCallbackPrefixes.return)) {
    const loanId = parseEntityId(callbackData, catalogLoanCallbackPrefixes.return);
    const repository = resolveLoanRepository(context);
    const loan = await repository.findLoanById(loanId);
    if (!loan) {
      throw new Error(`Catalog loan ${loanId} not found`);
    }
    if (!canReturnLoan(context, loan)) {
      await context.reply(texts.noPermission);
      return true;
    }
    const item = await resolveCatalogItem(context, loan.itemId);
    if (!item) {
      throw new Error(`Catalog item ${loan.itemId} not found`);
    }

    const returned = await repository.closeLoan({
      loanId,
      returnedByTelegramUserId: context.runtime.actor.telegramUserId,
    });
    await replyWithItemDetail(context, returned.itemId, language);
    await publishCatalogLoanNewsGroups(context, {
      action: 'returned',
      item,
      userName: await resolvePreferredUserName(context, context.runtime.actor.telegramUserId),
    });
    return true;
  }

  if (callbackData.startsWith(catalogLoanCallbackPrefixes.edit)) {
    const loanId = parseEntityId(callbackData, catalogLoanCallbackPrefixes.edit);
    const repository = resolveLoanRepository(context);
    const loan = await repository.findLoanById(loanId);
    if (!loan) {
      throw new Error(`Catalog loan ${loanId} not found`);
    }
    if (!canEditLoan(context, loan)) {
      await context.reply(texts.noPermission);
      return true;
    }

    await context.runtime.session.start({
      flowKey: loanEditFlowKey,
      stepKey: 'notes',
      data: { loanId },
    });

    await context.reply(
      texts.editPrompt.replace('{name}', loan.borrowerDisplayName),
      buildSingleCancelKeyboard(),
    );
    return true;
  }

  return false;
}

export async function handleTelegramCatalogLoanText(context: TelegramCatalogLoanContext): Promise<boolean> {
  const session = context.runtime.session.current;
  const text = context.messageText?.trim();
  if (!session || session.flowKey !== loanEditFlowKey || !text) {
    return false;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).catalogLoan;

  const repository = resolveLoanRepository(context);
  const loanId = asNumber(session.data.loanId);
  if (loanId === null) {
    await context.runtime.session.cancel();
    return false;
  }

  const loan = await repository.findLoanById(loanId);
  if (!loan) {
    await context.runtime.session.cancel();
    throw new Error(`Catalog loan ${loanId} not found`);
  }
  if (!canEditLoan(context, loan)) {
    await context.runtime.session.cancel();
    await context.reply(texts.noPermission);
    return true;
  }

  if (session.stepKey === 'notes') {
    await context.runtime.session.advance({
      stepKey: 'dueAt',
      data: { loanId, notes: normalizeOptionalInput(text) },
    });
    await context.reply(texts.dueDatePrompt);
    return true;
  }

  if (session.stepKey === 'dueAt') {
    const notes = normalizeOptionalInput(asString(session.data.notes));
    const dueAt = parseOptionalDate(text);
    await repository.updateLoan({
      loanId,
      notes,
      dueAt,
    });
    await context.runtime.session.cancel();
    const updated = await repository.findLoanById(loanId);
    await context.reply(
      `${texts.updated}${updated ? `\n${language === 'es' ? 'Notas' : language === 'en' ? 'Notes' : 'Notes'}: ${updated.notes ?? texts.noNotes}\n${texts.availabilityExpected}: ${updated.dueAt ?? texts.noDate}` : ''}`,
      buildSingleCancelKeyboard(),
    );
    return true;
  }

  return false;
}

export async function loadActiveLoanByItemId(context: TelegramCatalogLoanContext, itemId: number): Promise<CatalogLoanRecord | null> {
  const repository = resolveLoanRepository(context);
  const loans = await repository.listLoansByItem(itemId);
  return loans.find((loan) => loan.returnedAt === null) ?? repository.findActiveLoanByItemId(itemId);
}

export async function loadActiveLoansByBorrower(context: TelegramCatalogLoanContext, borrowerTelegramUserId: number): Promise<CatalogLoanRecord[]> {
  return resolveLoanRepository(context).listActiveLoansByBorrower(borrowerTelegramUserId);
}

export async function formatLoanAvailabilityLines(context: LoanDisplayContext, loan: CatalogLoanRecord | null): Promise<string[]> {
  const language = normalizeBotLanguage(context.runtime.bot?.language, 'ca');
  const texts = createTelegramI18n(language).catalogLoan;
  if (!loan) {
    return [formatHtmlField(texts.availabilityAvailable, texts.available)];
  }

  const lines = [
    formatHtmlField(texts.availabilityAvailable, texts.availabilityLoaned),
    formatHtmlField(texts.availabilityHas, escapeHtml(await resolveLoanBorrowerDisplayName(context, loan))),
    formatHtmlField(texts.availabilityFrom, formatLoanDate(loan.createdAt)),
  ];
  if (loan.dueAt) {
    lines.push(formatHtmlField(texts.availabilityExpected, formatLoanDate(loan.dueAt)));
  }
  if (loan.notes) {
    lines.push(formatHtmlField(texts.availabilityNotes, escapeHtml(loan.notes)));
  }
  return lines;
}

export function formatLoanSubtitle(loan: CatalogLoanRecord, language: 'ca' | 'es' | 'en' = 'ca'): string {
  const texts = createTelegramI18n(language).catalogLoan;
  return loan.dueAt ? `${texts.availabilityLoaned} · ${texts.availabilityExpected} ${loan.dueAt}` : texts.availabilityLoaned;
}

export function canEditLoan(context: TelegramCatalogLoanContext, loan: CatalogLoanRecord): boolean {
  return context.runtime.actor.isAdmin || loan.loanedByTelegramUserId === context.runtime.actor.telegramUserId;
}

export function canReturnLoan(context: LoanActorContext, loan: CatalogLoanRecord): boolean {
  return context.runtime.actor.isAdmin
    || loan.borrowerTelegramUserId === context.runtime.actor.telegramUserId
    || loan.loanedByTelegramUserId === context.runtime.actor.telegramUserId;
}

export function buildLoanItemButton(
  loan: CatalogLoanRecord | null,
  itemId: number,
  itemLabel: string,
  inspectCallbackPrefix: string = 'catalog_read:item:',
  language: 'ca' | 'es' | 'en' = 'ca',
  canReturn = true,
): TelegramInlineButton[] {
  const texts = createTelegramI18n(language).catalogLoan;
  if (!loan) {
    return [
      { text: itemLabel, callbackData: `${inspectCallbackPrefix}${itemId}` },
      { text: texts.prendrePrestat, callbackData: `${catalogLoanCallbackPrefixes.create}${itemId}` },
    ];
  }

  const buttons: TelegramInlineButton[] = [
    { text: itemLabel, callbackData: `${inspectCallbackPrefix}${itemId}` },
  ];
  if (canReturn) {
    buttons.push({ text: texts.retornar, callbackData: `${catalogLoanCallbackPrefixes.return}${loan.id}` });
  }
  return buttons;
}

export function buildLoanDetailButtons({
  loan,
  itemId,
  language = 'ca',
  deleteCallbackData,
  includeAdminDashboard = false,
  canReturn = true,
}: {
  loan: CatalogLoanRecord | null;
  itemId: number;
  language?: 'ca' | 'es' | 'en';
  deleteCallbackData?: string;
  includeAdminDashboard?: boolean;
  canReturn?: boolean;
}): TelegramInlineButton[][] {
  const texts = createTelegramI18n(language).catalogLoan;
  const rows: TelegramInlineButton[][] = [];
  if (loan && canReturn) {
    rows.push([{ text: texts.retornar, callbackData: `${catalogLoanCallbackPrefixes.return}${loan.id}` }]);
  } else if (!loan) {
    rows.push([{ text: texts.prendrePrestat, callbackData: `${catalogLoanCallbackPrefixes.create}${itemId}` }]);
  }

  if (deleteCallbackData) {
    rows.push([{ text: texts.deleteItem, callbackData: deleteCallbackData }]);
  }

  rows.push([{ text: texts.veurePrestecs, callbackData: catalogLoanCallbackPrefixes.openMyLoans }]);
  if (includeAdminDashboard) {
    rows.push([{ text: texts.adminDashboard, callbackData: catalogLoanCallbackPrefixes.adminDashboard }]);
  }
  return rows;
}

export async function showMyLoans(context: TelegramCatalogLoanContext): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).catalogLoan;
  const loans = await loadActiveLoansByBorrower(context, context.runtime.actor.telegramUserId);
  if (loans.length === 0) {
    await context.reply(texts.noLoans);
    return;
  }

  const catalog = resolveCatalogRepository(context);
  const lines = [texts.myLoans + ':'];
  const rows: TelegramReplyOptions['inlineKeyboard'] = [];

  for (const loan of loans) {
    const item = await catalog.findItemById(loan.itemId);
    lines.push(`- ${item?.displayName ?? `Item ${loan.itemId}`} · ${formatLoanSubtitle(loan, language)}`);
    rows.push([
      { text: item?.displayName ?? `Item ${loan.itemId}`, callbackData: `catalog_read:item:${loan.itemId}` },
      { text: texts.retornar, callbackData: `${catalogLoanCallbackPrefixes.return}${loan.id}` },
    ]);
  }

  await context.reply(lines.join('\n'), {
    inlineKeyboard: rows,
  });
}

export async function showAdminLoanDashboard(context: AdminLoanDashboardContext, requestedPage = 1): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).catalogLoan;
  if (!context.runtime.actor.isAdmin) {
    await context.reply(texts.adminDashboardNoPermission);
    return;
  }

  const loans = sortDashboardLoans(await resolveLoanRepository(context).listActiveLoansWithItems(), new Date());
  if (loans.length === 0) {
    await context.reply(texts.adminDashboardEmpty);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(loans.length / adminLoanDashboardPageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const pageLoans = loans.slice((page - 1) * adminLoanDashboardPageSize, page * adminLoanDashboardPageSize);
  const lines = [
    texts.adminDashboardHeader
      .replace('{count}', String(loans.length))
      .replace('{page}', String(page))
      .replace('{totalPages}', String(totalPages)),
    '',
  ];

  pageLoans.forEach((loan, index) => {
    lines.push(formatAdminLoanLine(loan, (page - 1) * adminLoanDashboardPageSize + index + 1, language, new Date()));
  });

  const inlineKeyboard = buildAdminLoanDashboardNavigation(page, totalPages, language);
  await context.reply(
    lines.join('\n\n'),
    inlineKeyboard.length > 0 ? { inlineKeyboard, parseMode: 'HTML' } : { parseMode: 'HTML' },
  );
}

function buildSingleCancelKeyboard(): TelegramReplyOptions {
  return {
    replyKeyboard: [['/cancel']],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

async function buildItemLoanNavigationOptions(
  context: TelegramCatalogLoanContext,
  itemId: number,
  language: 'ca' | 'es' | 'en' = 'ca',
): Promise<TelegramReplyOptions> {
  const loan = await loadActiveLoanByItemId(context, itemId);
  const inlineKeyboard = buildLoanDetailButtons({
    loan,
    itemId,
    language,
    canReturn: loan ? canReturnLoan(context, loan) : true,
  });
  return { inlineKeyboard };
}

async function replyWithItemDetail(
  context: TelegramCatalogLoanContext,
  itemId: number,
  language: 'ca' | 'es' | 'en',
): Promise<void> {
  const catalog = resolveCatalogRepository(context);
  const item = await catalog.findItemById(itemId);
  if (!item) {
    throw new Error(`Catalog item ${itemId} not found`);
  }

  const loan = await loadActiveLoanByItemId(context, itemId);
  const inlineKeyboard = buildLoanDetailButtons({
    loan,
    itemId,
    language,
    ...(context.runtime.actor.isAdmin ? { deleteCallbackData: `${catalogAdminDeactivateCallbackPrefix}${itemId}` } : {}),
    canReturn: loan ? canReturnLoan(context, loan) : true,
  });

  if (context.runtime.actor.isAdmin) {
    inlineKeyboard.unshift([{ text: createTelegramI18n(language).catalogAdmin.edit, callbackData: `${catalogAdminEditCallbackPrefix}${itemId}` }]);
  }
  if (item.itemType === 'board-game') {
    inlineKeyboard.unshift([{ text: createTelegramI18n(language).catalogAdmin.createActivity, callbackData: `${catalogAdminCreateActivityCallbackPrefix}${itemId}` }]);
  }

  await context.runtime.session.start({
    flowKey: catalogAdminBrowseFlowKey,
    stepKey: 'detail',
    data: { itemId },
  });

  await context.reply(
    formatCatalogItemSummaryDetails({
      item,
      availabilityLine: formatLoanAvailabilitySummaryLine(loan, language),
      borrowerLine: await formatLoanBorrowerSummaryLine(context, loan, language),
      ownerLine: await formatLoanOwnerSummaryLine(context, item, language),
      detailsUrl: buildTelegramStartUrl(`${catalogReadFullItemStartPayloadPrefix}${item.id}`),
      language,
    }),
    {
      replyKeyboard: buildCatalogLoanItemDetailReplyKeyboard({
        context,
        item,
        loan,
        actionRows: inlineKeyboard,
        language,
      }),
      resizeKeyboard: true,
      persistentKeyboard: true,
      parseMode: 'HTML',
    },
  );
}

function buildCatalogLoanItemDetailReplyKeyboard({
  context,
  item,
  loan,
  actionRows,
  language,
}: {
  context: TelegramCatalogLoanContext;
  item: CatalogItemRecord;
  loan: CatalogLoanRecord | null;
  actionRows: TelegramInlineButton[][];
  language: 'ca' | 'es' | 'en';
}): NonNullable<TelegramReplyOptions['replyKeyboard']> {
  const texts = createTelegramI18n(language);
  const rows: NonNullable<TelegramReplyOptions['replyKeyboard']> = [];
  if (loan && loan.borrowerTelegramUserId === context.runtime.actor.telegramUserId && canReturnLoan(context, loan)) {
    rows.push([successButton(texts.catalogLoan.retornar)]);
  }
  if (item.itemType === 'board-game') {
    rows.push([successButton(texts.catalogAdmin.createActivity)]);
  }
  rows.push([texts.catalogLoan.veurePrestecs]);
  rows.push([texts.catalogAdmin.browseBack, formatCatalogInitialsLabel(getCatalogItemInitial(item))]);

  const prioritizedTexts = new Set(rows.flat().map((button) => typeof button === 'string' ? button : button.text));
  rows.push(...actionRows
    .map((row) => row.filter((button) => !prioritizedTexts.has(button.text)).map((button) => button.text))
    .filter((row) => row.length > 0));
  rows.push([texts.actionMenu.start, texts.actionMenu.help]);
  return rows;
}

function successButton(text: string): TelegramReplyButton {
  return { text, semanticRole: 'success' };
}

function getCatalogItemInitial(item: CatalogItemRecord): string {
  const first = item.displayName.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').at(0)?.toUpperCase() ?? '#';
  return /^[A-Z]$/.test(first) ? first : '#';
}

function formatCatalogInitialsLabel(initials: string): string {
  return initials.split('').join(' ');
}

function formatLoanAvailabilitySummaryLine(loan: CatalogLoanRecord | null, language: 'ca' | 'es' | 'en'): string {
  const texts = createTelegramI18n(language).catalogLoan;
  return formatHtmlField(texts.availabilityAvailable, loan ? texts.availabilityLoaned : texts.available);
}

async function formatLoanBorrowerSummaryLine(context: TelegramCatalogLoanContext, loan: CatalogLoanRecord | null, language: 'ca' | 'es' | 'en'): Promise<string | null> {
  if (!loan) {
    return null;
  }
  const texts = createTelegramI18n(language).catalogLoan;
  return formatHtmlField(texts.availabilityHas, escapeHtml(await resolveLoanBorrowerDisplayName(context, loan)));
}

async function formatLoanOwnerSummaryLine(context: TelegramCatalogLoanContext, item: CatalogItemRecord, language: 'ca' | 'es' | 'en'): Promise<string | null> {
  if (item.ownerTelegramUserId == null) {
    return null;
  }
  const texts = createTelegramI18n(language).catalogAdmin;
  const owner = await loadMembershipUser(context, item.ownerTelegramUserId);
  if (!owner) {
    return formatHtmlField(texts.owner, escapeHtml(`#${item.ownerTelegramUserId}`));
  }
  return formatHtmlField(texts.owner, formatTelegramUserLink(owner));
}

function resolveLoanRepository(context: LoanRepositoryContext): CatalogLoanRepository {
  if (context.catalogLoanRepository) {
    return context.catalogLoanRepository;
  }

  return createDatabaseCatalogLoanRepository({ database: context.runtime.services.database.db as never });
}

function resolveCatalogRepository(context: TelegramCatalogLoanContext): CatalogRepository {
  if (context.catalogRepository) {
    return context.catalogRepository;
  }

  return createDatabaseCatalogRepository({ database: context.runtime.services.database.db as never });
}

function resolveNewsGroupRepository(context: TelegramCatalogLoanContext): NewsGroupRepository {
  return (
    context.newsGroupRepository ??
    createDatabaseNewsGroupRepository({ database: context.runtime.services.database.db as never })
  );
}

async function resolveCatalogItem(context: TelegramCatalogLoanContext, itemId: number) {
  const repository = resolveCatalogRepository(context);
  return repository ? repository.findItemById(itemId) : null;
}

function parseEntityId(callbackData: string, prefix: string): number {
  const value = Number(callbackData.slice(prefix.length));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('No s ha pogut identificar l element seleccionat.');
  }
  return value;
}

function parseDashboardPage(callbackData: string): number {
  const value = Number(callbackData.slice(catalogLoanCallbackPrefixes.adminDashboardPage.length));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('No s ha pogut identificar la pagina seleccionada.');
  }
  return value;
}

function parseOptionalDate(text: string): string | null {
  const normalized = normalizeOptionalInput(text);
  if (!normalized) {
    return null;
  }

  const iso = parseDateLike(normalized);
  if (!iso) {
    throw new Error('La data de retorn no és vàlida.');
  }

  return iso;
}

function parseDateLike(value: string): string | null {
  const isoCandidate = new Date(value);
  if (!Number.isNaN(isoCandidate.getTime())) {
    return isoCandidate.toISOString();
  }

  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) {
    return null;
  }

  const [, day, month, year] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeOptionalInput(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === '-') {
    return null;
  }
  return trimmed;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

async function resolveDisplayName(context: TelegramCatalogLoanContext): Promise<string> {
  const user = await loadMembershipUser(context, context.runtime.actor.telegramUserId);
  if (user) {
    return formatMembershipDisplayName(user);
  }

  return resolveTelegramDisplayName(context.from);
}

async function resolvePreferredUserName(context: TelegramCatalogLoanContext, telegramUserId: number): Promise<string> {
  const user = await loadMembershipUser(context, telegramUserId);
  if (user) {
    return formatMembershipDisplayName(user);
  }

  return resolveTelegramDisplayName(context.from);
}

export async function resolveLoanBorrowerDisplayName(context: LoanDisplayContext, loan: CatalogLoanRecord): Promise<string> {
  const user = await loadMembershipUser(context, loan.borrowerTelegramUserId);
  if (user) {
    return formatMembershipDisplayName(user);
  }

  return loan.borrowerDisplayName;
}

async function loadMembershipUser(context: LoanDisplayContext, telegramUserId: number): Promise<MembershipUserRecord | null> {
  const repository = resolveMembershipRepository(context);
  if (!repository) {
    return null;
  }

  return repository.findUserByTelegramUserId(telegramUserId);
}

function resolveMembershipRepository(context: LoanDisplayContext): MembershipAccessRepository | null {
  if (context.membershipRepository) {
    return context.membershipRepository;
  }

  if (!context.runtime.services.database.db) {
    return null;
  }

  return createDatabaseMembershipAccessRepository({ database: context.runtime.services.database.db as never });
}

function formatLoanDate(value: string): string {
  return value.slice(0, 10).split('-').reverse().join('/');
}

function sortDashboardLoans<T extends CatalogLoanRecord>(loans: T[], now: Date): T[] {
  return [...loans].sort((left, right) => {
    const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : null;
    const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : null;
    const leftOverdue = leftDue !== null && leftDue < now.getTime();
    const rightOverdue = rightDue !== null && rightDue < now.getTime();
    if (leftOverdue !== rightOverdue) {
      return leftOverdue ? -1 : 1;
    }
    if (leftDue !== null && rightDue !== null && leftDue !== rightDue) {
      return leftDue - rightDue;
    }
    if (leftDue !== null && rightDue === null) {
      return -1;
    }
    if (leftDue === null && rightDue !== null) {
      return 1;
    }
    const createdComparison = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    return createdComparison || left.id - right.id;
  });
}

function formatAdminLoanLine(
  loan: CatalogLoanRecord & { itemDisplayName: string },
  position: number,
  language: 'ca' | 'es' | 'en',
  now: Date,
): string {
  const texts = createTelegramI18n(language).catalogLoan;
  const dueText = loan.dueAt
    ? `${formatLoanDate(loan.dueAt)}${new Date(loan.dueAt).getTime() < now.getTime() ? ` (${texts.adminDashboardOverdue})` : ''}`
    : texts.adminDashboardNoDueDate;
  const itemLink = escapeHtml(buildTelegramStartUrl(`catalog_read_item_${loan.itemId}`));
  const borrowerLink = escapeHtml(buildTelegramStartUrl(`manage_user_${loan.borrowerTelegramUserId}`));
  return [
    `${position}. <a href="${itemLink}"><b>${escapeHtml(loan.itemDisplayName)}</b></a>`,
    `${texts.adminDashboardBorrower}: <a href="${borrowerLink}">${escapeHtml(loan.borrowerDisplayName)}</a>`,
    `${texts.adminDashboardLoanedAt}: ${formatLoanDate(loan.createdAt)}`,
    `${texts.adminDashboardDueAt}: ${dueText}`,
  ].join('\n');
}

function buildAdminLoanDashboardNavigation(
  page: number,
  totalPages: number,
  language: 'ca' | 'es' | 'en',
): TelegramInlineButton[][] {
  const texts = createTelegramI18n(language).catalogLoan;
  const rows: TelegramInlineButton[][] = [];
  const navigation: TelegramInlineButton[] = [];
  if (page > 1) {
    navigation.push({ text: texts.adminDashboardPrev, callbackData: `${catalogLoanCallbackPrefixes.adminDashboardPage}${page - 1}` });
  }
  if (page < totalPages) {
    navigation.push({ text: texts.adminDashboardNext, callbackData: `${catalogLoanCallbackPrefixes.adminDashboardPage}${page + 1}` });
  }
  if (navigation.length > 0) {
    rows.push(navigation);
  }
  return rows;
}

async function publishCatalogLoanNewsGroups(
  context: TelegramCatalogLoanContext,
  input: {
    action: 'borrowed' | 'returned';
    item: CatalogItemRecord;
    userName: string;
  },
): Promise<void> {
  const sendGroupMessage = context.runtime.bot.sendGroupMessage;
  if (!sendGroupMessage) {
    return;
  }

  const categoryKey = catalogLoanNewsCategoryByItemType[input.item.itemType as keyof typeof catalogLoanNewsCategoryByItemType];
  if (!categoryKey) {
    return;
  }

  const repository = resolveNewsGroupRepository(context);
  const groups = await repository.listSubscribedGroupsByCategory(categoryKey);
  if (groups.length === 0) {
    return;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).catalogLoan;
  const itemLink = `<a href="${escapeHtml(buildTelegramStartUrl(`catalog_read_item_${input.item.id}`))}">${escapeHtml(input.item.displayName)}</a>`;
  const message = input.action === 'borrowed'
    ? texts.groupBorrowed.replace('{user}', escapeHtml(input.userName)).replace('{item}', itemLink)
    : texts.groupReturned.replace('{user}', escapeHtml(input.userName)).replace('{item}', itemLink);

  const cover = input.action === 'borrowed' ? await resolveCatalogLoanCover(context, input.item.id) : null;

  await Promise.all(
    groups.map(async (group) => {
      try {
        const sentWithCaption = cover
          ? await trySendLoanCover(context, group.chatId, group.messageThreadId, cover, message)
          : false;
        if (!sentWithCaption) {
          await sendGroupMessage(group.chatId, message, {
            parseMode: 'HTML',
            ...(group.messageThreadId ? { messageThreadId: group.messageThreadId } : {}),
          });
        }
      } catch {
        // La notificació de grup no ha de bloquejar el préstec o retorn.
      }
    }),
  );
}

type CatalogLoanCover =
  | { kind: 'storage'; message: StorageEntryMessageRecord }
  | { kind: 'url'; url: string };

async function resolveCatalogLoanCover(context: TelegramCatalogLoanContext, itemId: number): Promise<CatalogLoanCover | null> {
  const catalog = resolveCatalogRepository(context);
  const media = (await catalog.listMedia({ itemId }))
    .filter((entry) => entry.mediaType === 'image')
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id);
  const primary = media[0];
  if (!primary) {
    return null;
  }

  const storageEntryId = parseCatalogStorageEntryUrl(primary.url);
  if (storageEntryId) {
    const detail = await resolveStorageRepository(context).getEntryDetail(storageEntryId);
    const message = detail?.messages
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id)
      .find((candidate) => candidate.attachmentKind === 'photo' || candidate.mimeType?.startsWith('image/'));
    return message ? { kind: 'storage', message } : null;
  }

  return /^https?:\/\//i.test(primary.url) ? { kind: 'url', url: primary.url } : null;
}

async function trySendLoanCover(
  context: TelegramCatalogLoanContext,
  chatId: number,
  messageThreadId: number | null,
  cover: CatalogLoanCover,
  caption: string,
): Promise<boolean> {
  if (cover.kind === 'storage') {
    try {
      await copyLoanCoverMessage(context, {
        fromChatId: cover.message.storageChatId,
        messageId: cover.message.storageMessageId,
        toChatId: chatId,
        ...(messageThreadId ? { messageThreadId } : {}),
      });
    } catch {
      return false;
    }
    return false;
  }

  if (!context.runtime.bot.sendMediaGroup) {
    return false;
  }
  try {
    await context.runtime.bot.sendMediaGroup({
      chatId,
      media: [{ type: 'photo', media: cover.url, caption }],
      ...(messageThreadId ? { messageThreadId } : {}),
    });
    return true;
  } catch {
    return false;
  }
}

async function copyLoanCoverMessage(
  context: TelegramCatalogLoanContext,
  input: { fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number },
): Promise<{ messageId: number } | null> {
  if (context.runtime.bot.copyMessage) {
    try {
      return await context.runtime.bot.copyMessage(input);
    } catch {
      // Use forwardMessage as a fallback for media Telegram cannot copy.
    }
  }
  return context.runtime.bot.forwardMessage ? context.runtime.bot.forwardMessage(input) : null;
}

function resolveStorageRepository(context: TelegramCatalogLoanContext): StorageCategoryRepository {
  return context.storageRepository ?? createDatabaseStorageRepository({ database: context.runtime.services.database.db as never });
}
