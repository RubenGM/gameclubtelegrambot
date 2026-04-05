import type { CatalogLoanRecord, CatalogLoanRepository, CatalogRepository } from '../catalog/catalog-model.js';
export type { CatalogLoanRecord } from '../catalog/catalog-model.js';
import { createDatabaseCatalogRepository } from '../catalog/catalog-store.js';
import { createDatabaseCatalogLoanRepository } from '../catalog/catalog-loan-store.js';
import { createDatabaseMembershipAccessRepository } from '../membership/access-flow-store.js';
import type { MembershipAccessRepository, MembershipUserRecord } from '../membership/access-flow.js';
import { escapeHtml, formatHtmlField } from './catalog-presentation.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import type { TelegramInlineButton, TelegramReplyOptions } from './runtime-boundary.js';

const loanEditFlowKey = 'catalog-loan-edit';

export const catalogLoanCallbackPrefixes = {
  openMyLoans: 'catalog_loan:my_loans',
  create: 'catalog_loan:create:',
  return: 'catalog_loan:return:',
  edit: 'catalog_loan:edit:',
} as const;

export type TelegramCatalogLoanContext = TelegramCommandHandlerContext & {
  catalogRepository?: CatalogRepository;
  catalogLoanRepository?: CatalogLoanRepository;
  membershipRepository?: MembershipAccessRepository;
};

type LoanDisplayContext = {
  runtime: {
    services: {
      database: {
        db: unknown;
      };
    };
  };
  membershipRepository?: MembershipAccessRepository | undefined;
};

export async function handleTelegramCatalogLoanCallback(context: TelegramCatalogLoanContext): Promise<boolean> {
  const callbackData = context.callbackData;
  if (!callbackData) {
    return false;
  }

  if (callbackData === catalogLoanCallbackPrefixes.openMyLoans) {
    await showMyLoans(context);
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

    await context.reply(`Has prestat ${item.displayName}.`, await buildItemLoanNavigationOptions(context, created.itemId));
    return true;
  }

  if (callbackData.startsWith(catalogLoanCallbackPrefixes.return)) {
    const loanId = parseEntityId(callbackData, catalogLoanCallbackPrefixes.return);
    const repository = resolveLoanRepository(context);
    const loan = await repository.findLoanById(loanId);
    if (!loan) {
      throw new Error(`Catalog loan ${loanId} not found`);
    }

    const returned = await repository.closeLoan({
      loanId,
      returnedByTelegramUserId: context.runtime.actor.telegramUserId,
    });
    const item = await resolveCatalogItem(context, returned.itemId);
    await context.reply(`Has retornat ${item?.displayName ?? 'l item'}.`, await buildItemLoanNavigationOptions(context, returned.itemId));
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
      await context.reply('No tens permisos per editar aquest prestec.');
      return true;
    }

    await context.runtime.session.start({
      flowKey: loanEditFlowKey,
      stepKey: 'notes',
      data: { loanId },
    });

    await context.reply(
      `Editant ${loan.borrowerDisplayName} · introdueix les notes o escriu "-" per deixar-les buides.`,
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
    await context.reply('No tens permisos per editar aquest prestec.');
    return true;
  }

  if (session.stepKey === 'notes') {
    await context.runtime.session.advance({
      stepKey: 'dueAt',
      data: { loanId, notes: normalizeOptionalInput(text) },
    });
    await context.reply('Introdueix la data de retorn prevista (YYYY-MM-DD, dd/MM/yyyy) o escriu "-" per deixar-la buida.');
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
      `Prestec actualitzat.${updated ? `\nNotes: ${updated.notes ?? 'Sense notes'}\nRetorn previst: ${updated.dueAt ?? 'Sense data'}` : ''}`,
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
  if (!loan) {
    return [formatHtmlField('Disponibilitat', 'Disponible')];
  }

  const lines = [
    formatHtmlField('Disponibilitat', 'En préstec'),
    formatHtmlField('Té', escapeHtml(await resolveLoanBorrowerDisplayName(context, loan))),
    formatHtmlField('Des de', formatLoanDate(loan.createdAt)),
  ];
  if (loan.dueAt) {
    lines.push(formatHtmlField('Retorn previst', formatLoanDate(loan.dueAt)));
  }
  if (loan.notes) {
    lines.push(formatHtmlField('Notes', escapeHtml(loan.notes)));
  }
  return lines;
}

export function formatLoanSubtitle(loan: CatalogLoanRecord): string {
  return loan.dueAt ? `En préstec · fins ${loan.dueAt}` : 'En préstec';
}

export function canEditLoan(context: TelegramCatalogLoanContext, loan: CatalogLoanRecord): boolean {
  return context.runtime.actor.isAdmin || loan.loanedByTelegramUserId === context.runtime.actor.telegramUserId;
}

export function buildLoanItemButton(loan: CatalogLoanRecord | null, itemId: number, itemLabel: string): TelegramInlineButton[] {
  if (!loan) {
    return [
      { text: itemLabel, callbackData: `catalog_read:item:${itemId}` },
      { text: 'Emportar', callbackData: `${catalogLoanCallbackPrefixes.create}${itemId}` },
    ];
  }

  return [
    { text: itemLabel, callbackData: `catalog_read:item:${itemId}` },
    { text: 'Retornar', callbackData: `${catalogLoanCallbackPrefixes.return}${loan.id}` },
  ];
}

export function buildLoanDetailButtons({
  loan,
  itemId,
  canEdit,
}: {
  loan: CatalogLoanRecord | null;
  itemId: number;
  canEdit: boolean;
}): TelegramInlineButton[][] {
  const rows: TelegramInlineButton[][] = [];
  if (loan) {
    rows.push([{ text: 'Retornar', callbackData: `${catalogLoanCallbackPrefixes.return}${loan.id}` }]);
    if (canEdit) {
      rows.push([{ text: 'Editar préstec', callbackData: `${catalogLoanCallbackPrefixes.edit}${loan.id}` }]);
    }
  } else {
    rows.push([{ text: 'Emportar', callbackData: `${catalogLoanCallbackPrefixes.create}${itemId}` }]);
  }

  rows.push([{ text: 'Veure préstecs', callbackData: catalogLoanCallbackPrefixes.openMyLoans }]);
  rows.push([{ text: 'Veure cataleg', callbackData: 'catalog_read:overview' }]);
  return rows;
}

export async function showMyLoans(context: TelegramCatalogLoanContext): Promise<void> {
  const loans = await loadActiveLoansByBorrower(context, context.runtime.actor.telegramUserId);
  if (loans.length === 0) {
    await context.reply('No tens cap préstec actiu.');
    return;
  }

  const catalog = resolveCatalogRepository(context);
  const lines = ['Els meus préstecs:'];
  const rows: TelegramReplyOptions['inlineKeyboard'] = [];

  for (const loan of loans) {
    const item = await catalog.findItemById(loan.itemId);
    lines.push(`- ${item?.displayName ?? `Item ${loan.itemId}`} · ${formatLoanSubtitle(loan)}`);
    rows.push([
      { text: item?.displayName ?? `Item ${loan.itemId}`, callbackData: `catalog_read:item:${loan.itemId}` },
      { text: 'Retornar', callbackData: `${catalogLoanCallbackPrefixes.return}${loan.id}` },
    ]);
  }

  await context.reply(lines.join('\n'), {
    inlineKeyboard: rows,
  });
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
): Promise<TelegramReplyOptions> {
  const loan = await loadActiveLoanByItemId(context, itemId);
  const inlineKeyboard = buildLoanDetailButtons({ loan, itemId, canEdit: loan ? canEditLoan(context, loan) : false });
  return { inlineKeyboard };
}

function resolveLoanRepository(context: TelegramCatalogLoanContext): CatalogLoanRepository {
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

function parseOptionalDate(text: string): string | null {
  const normalized = normalizeOptionalInput(text);
  if (!normalized) {
    return null;
  }

  const iso = parseDateLike(normalized);
  if (!iso) {
    throw new Error('La data de retorn no es valida.');
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
    return formatMembershipDisplayName(user, context.runtime.actor.telegramUserId);
  }

  return context.from?.first_name ?? context.from?.username ?? `Usuari ${context.runtime.actor.telegramUserId}`;
}

export async function resolveLoanBorrowerDisplayName(context: LoanDisplayContext, loan: CatalogLoanRecord): Promise<string> {
  const user = await loadMembershipUser(context, loan.borrowerTelegramUserId);
  if (user) {
    return formatMembershipDisplayName(user, loan.borrowerTelegramUserId);
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

function formatMembershipDisplayName(user: MembershipUserRecord, fallbackTelegramUserId: number): string {
  if (user.username) {
    return `${user.displayName} (@${user.username})`;
  }

  return user.displayName || `Usuari ${fallbackTelegramUserId}`;
}

function formatLoanDate(value: string): string {
  return value.slice(0, 10).split('-').reverse().join('/');
}
