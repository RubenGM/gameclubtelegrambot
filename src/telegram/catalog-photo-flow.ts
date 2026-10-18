import { randomBytes } from 'node:crypto';
import { createCatalogItem, setCatalogItemOwner, type CatalogItemRecord } from '../catalog/catalog-model.js';
import { catalogItemNames, normalizeCatalogSearchText } from '../catalog/catalog-names.js';
import { createDatabaseCatalogRepository } from '../catalog/catalog-store.js';
import { loadActiveLoanByItemId, resolveLoanBorrowerDisplayName, type TelegramCatalogLoanContext } from './catalog-loan-flow.js';
import type { WikipediaBoardGameImportResult } from '../catalog/wikipedia-boardgame-import-service.js';
import type { TelegramCatalogAdminContext } from './catalog-admin-flow.js';
import { buildCatalogAdminMenuOptions } from './catalog-admin-keyboards.js';
import { escapeHtml } from './catalog-presentation.js';
import { buildTelegramStartUrl } from './deep-links.js';
import { startTelegramEditableProgress } from './editable-progress.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import { catalogPhotoTexts } from './i18n-catalog-photo.js';
import type { TelegramInlineButton, TelegramReplyOptions } from './runtime-boundary.js';

export const catalogPhotoCallbackPrefix = 'catalog_photo:';
const flowKey = 'catalog-photo';
const pageSize = 5;

export { catalogPhotoTexts } from './i18n-catalog-photo.js';

export interface CatalogPhotoDependencies {
  detectTitle(context: TelegramCatalogAdminContext, onRetry?: () => Promise<void>): Promise<string | { displayName: string; coverAttachment?: Record<string, unknown> } | Error | null>;
  importTitle(context: TelegramCatalogAdminContext, title: string): Promise<WikipediaBoardGameImportResult>;
  saveCover(context: TelegramCatalogAdminContext, item: CatalogItemRecord, attachment: Record<string, unknown>): Promise<void>;
  createLoan(context: TelegramCatalogAdminContext, item: CatalogItemRecord): Promise<void>;
  createActivity(context: TelegramCatalogAdminContext, item: CatalogItemRecord): Promise<void>;
  publishCession(context: TelegramCatalogAdminContext, item: CatalogItemRecord): Promise<boolean>;
  auditCreated(context: TelegramCatalogAdminContext, item: CatalogItemRecord, action: 'borrow' | 'cede'): Promise<void>;
}

function canUse(context: TelegramCatalogAdminContext): boolean {
  return context.runtime.chat.kind === 'private' && context.runtime.actor.isApproved && !context.runtime.actor.isBlocked;
}

function repository(context: TelegramCatalogAdminContext) {
  return context.catalogRepository ?? createDatabaseCatalogRepository({ database: context.runtime.services.database.db as never });
}

function texts(context: TelegramCatalogAdminContext) {
  return catalogPhotoTexts[normalizeBotLanguage(context.runtime.bot.language, 'ca')];
}

function isCurrent(context: TelegramCatalogAdminContext, data: Record<string, unknown>): boolean {
  const session = context.runtime.session.current;
  return canUse(context) && session?.flowKey === flowKey && session.data.token === data.token
    && session.data.actorId === context.runtime.actor.telegramUserId && session.data.chatId === context.runtime.chat.chatId
    && session.expiresAt > new Date().toISOString();
}

function button(data: Record<string, unknown>, text: string, action: string): TelegramInlineButton {
  return { text, callbackData: `${catalogPhotoCallbackPrefix}${data.token}:${action}` };
}

async function start(context: TelegramCatalogAdminContext, stepKey: string) {
  const data = { token: randomBytes(6).toString('hex'), actorId: context.runtime.actor.telegramUserId, chatId: context.runtime.chat.chatId };
  await context.runtime.session.start({ flowKey, stepKey, data });
  return data;
}

export async function handleCatalogPhotoText(context: TelegramCatalogAdminContext, dependencies: CatalogPhotoDependencies): Promise<boolean> {
  if (!canUse(context)) return false;
  const text = context.messageText?.trim() ?? '';
  const current = context.runtime.session.current;
  if (text === '/catalog_photo' || Object.values(catalogPhotoTexts).some((locale) => locale.open === text)) {
    await start(context, 'photo');
    await context.reply(texts(context).prompt, buildCatalogAdminMenuOptions(normalizeBotLanguage(context.runtime.bot.language, 'ca'), context.runtime.actor.isAdmin));
    return true;
  }
  if (current?.flowKey !== flowKey || !text || text.startsWith('/')) return false;
  // Navigation remains available through the normal dispatcher.
  const i18n = createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca'));
  if (([i18n.actionMenu.start, i18n.actionMenu.help, i18n.actionMenu.catalog] as string[]).includes(text)) return false;
  if (current.stepKey !== 'photo' && current.stepKey !== 'correct') return false;
  await search(context, dependencies, text, current.data);
  return true;
}

export async function handleCatalogPhotoMessage(context: TelegramCatalogAdminContext, dependencies: CatalogPhotoDependencies): Promise<boolean> {
  if (!canUse(context) || !context.messageMedia) return false;
  const current = context.runtime.session.current;
  const passive = !current || current.flowKey === 'catalog-read'
    || (current.flowKey === 'llm-command' && current.stepKey === 'awaiting-input')
    || (current.flowKey === 'catalog-admin-browse' && ['menu', 'search-query', 'detail', 'letters'].includes(current.stepKey));
  if (!passive && current?.flowKey !== flowKey) return false;
  if (current?.flowKey === flowKey && current.stepKey === 'saving') return false;
  const media = context.messageMedia;
  if (media.attachmentKind !== 'photo' && !media.mimeType?.startsWith('image/')) return false;
  const implicit = current?.flowKey !== flowKey;
  if (implicit && (media.caption?.trim() || context.isForwardedMessage || context.replyToBotMessage)) return false;
  // A background conversation is preserved until a game has actually been identified.
  const previousSession = JSON.stringify(current);
  const data = implicit ? null : await start(context, 'detecting');
  const progress = await startTelegramEditableProgress(context, texts(context).detecting, { editFailedEvent: 'catalog.photo.progress-edit.failed' });
  let detected: Awaited<ReturnType<CatalogPhotoDependencies['detectTitle']>>;
  try { detected = await dependencies.detectTitle(context, async () => { await progress.update(texts(context).retrying); }); }
  catch { detected = new Error(createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca')).catalogAdmin.coverTitleNoResult); }
  if (!canUse(context) || (data ? !isCurrent(context, data) : JSON.stringify(context.runtime.session.current) !== previousSession)) return true;
  const detectedTitle = !detected || detected instanceof Error ? '' : typeof detected === 'string' ? detected : detected.displayName;
  if (!detectedTitle.trim() || /^UNKNOWN[.!]?$/i.test(detectedTitle.trim())) {
    if (implicit) {
      await progress.complete(texts(context).notIdentified);
      return true;
    }
    if (!data) return true;
    await context.runtime.session.advance({ stepKey: 'correct', data });
    await progress.complete(`${detected instanceof Error ? escapeHtml(detected.message) + '\n\n' : ''}${texts(context).correctPrompt}`, { parseMode: 'HTML' });
    return true;
  }
  const photoData = data ?? await start(context, 'detecting');
  await search(context, dependencies, detectedTitle, { ...photoData, ...(detected && !(detected instanceof Error) && typeof detected === 'object' && detected.coverAttachment ? { coverAttachment: detected.coverAttachment } : {}) }, progress);
  return true;
}

function bggId(item: { externalRefs?: Record<string, unknown> | null; metadata?: Record<string, unknown> | null }): string | null {
  const value = item.externalRefs?.boardGameGeekId ?? item.metadata?.boardGameGeekId;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}

async function findMatches(context: TelegramCatalogAdminContext, query: string, draft?: Record<string, unknown>) {
  const items = (await repository(context).listItems({ includeDeactivated: false }))
    .filter((item) => item.lifecycleStatus === 'active' && (item.itemType === 'board-game' || item.itemType === 'expansion'));
  const names = [query, ...(draft ? catalogItemNames(draft as unknown as CatalogItemRecord) : [])].map(normalizeCatalogSearchText).filter(Boolean);
  const id = draft ? bggId(draft) : null;
  const exact = items.filter((item) => (id && bggId(item) === id) || catalogItemNames(item).some((name) => names.includes(normalizeCatalogSearchText(name))));
  if (exact.length) return exact;
  const tokens = normalizeCatalogSearchText(query).split(' ').filter(Boolean);
  return tokens.length ? items.filter((item) => catalogItemNames(item).some((name) => tokens.every((token) => normalizeCatalogSearchText(name).includes(token)))) : [];
}

async function search(context: TelegramCatalogAdminContext, dependencies: CatalogPhotoDependencies, query: string, data: Record<string, unknown>, existingProgress?: Awaited<ReturnType<typeof startTelegramEditableProgress>>) {
  query = query.trim().slice(0, 250);
  if (!query) return;
  const progress = existingProgress ?? await startTelegramEditableProgress(context, texts(context).searching, { editFailedEvent: 'catalog.photo.progress-edit.failed' });
  await progress.update(texts(context).searching);
  let matches = await findMatches(context, query);
  let draft: Record<string, unknown> | undefined;
  if (!matches.length) {
    try {
      const imported = await dependencies.importTitle(context, query);
      if (imported.ok) {
        draft = imported.draft as unknown as Record<string, unknown>;
        matches = await findMatches(context, query, draft);
      }
    } catch (error) {
      console.warn(JSON.stringify({ event: 'catalog.photo.lookup.failed', error: error instanceof Error ? error.message : String(error) }));
    }
  }
  if (!isCurrent(context, data)) return;
  const nextData = { ...data, query, draft: draft ?? null, candidateIds: matches.map((item) => item.id) };
  await context.runtime.session.advance({ stepKey: 'matches', data: nextData });
  const result = await renderMatches(context, nextData, matches, 1);
  await progress.complete(result.message, result.options);
}

async function renderMatches(context: TelegramCatalogAdminContext, data: Record<string, unknown>, matches: CatalogItemRecord[], requestedPage: number) {
  const t = texts(context);
  const rows: TelegramInlineButton[][] = [];
  const lines: string[] = [];
  if (matches.length) {
    lines.push(t.found);
    const pages = Math.ceil(matches.length / pageSize);
    const page = Math.max(1, Math.min(pages, requestedPage));
    for (const item of matches.slice((page - 1) * pageSize, page * pageSize)) {
      const loan = await loadActiveLoanByItemId(context as TelegramCatalogLoanContext, item.id);
      const title = escapeHtml(item.displayName);
      lines.push(`<a href="${escapeHtml(buildTelegramStartUrl(`catalog_read_item_${item.id}`))}">${title}</a>${item.storagePosition ? ` · ${escapeHtml(item.storagePosition)}` : ''}${loan ? ` · ${escapeHtml(createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca')).catalogAdmin.loanedTo.replace('{name}', await resolveLoanBorrowerDisplayName(context, loan)))}` : ''}`);
      rows.push([button(data, `${item.displayName.slice(0, 45)} (#${item.id})`, `select:${item.id}`)]);
    }
    if (pages > 1) {
      lines.push('', t.page.replace('{page}', String(page)).replace('{pages}', String(pages)));
      rows.push([...(page > 1 ? [button(data, t.previous, `page:${page - 1}`)] : []), ...(page < pages ? [button(data, t.next, `page:${page + 1}`)] : [])]);
    }
  } else {
    lines.push(t.missing.replace('{title}', escapeHtml(String(data.query))));
    rows.push([button(data, t.newBorrow, 'new-borrow')], [button(data, t.cede, 'new-cede')]);
  }
  rows.push([button(data, t.correct, 'correct'), button(data, t.cancel, 'cancel')]);
  return { message: lines.join('\n\n'), options: { parseMode: 'HTML', inlineKeyboard: rows } satisfies TelegramReplyOptions };
}

export async function handleCatalogPhotoCallback(context: TelegramCatalogAdminContext, dependencies: CatalogPhotoDependencies): Promise<boolean> {
  if (!context.callbackData?.startsWith(catalogPhotoCallbackPrefix)) return false;
  if (!canUse(context)) return true;
  const [token, action, rawId] = context.callbackData.slice(catalogPhotoCallbackPrefix.length).split(':');
  const current = context.runtime.session.current;
  if (current?.flowKey !== flowKey || token !== current.data.token || !isCurrent(context, current.data)) {
    await context.reply(texts(context).expired);
    return true;
  }
  const data = current.data;
  const t = texts(context);
  if (current.stepKey === 'saving') return true;
  if (action === 'cancel') {
    await context.runtime.session.cancel();
    await context.reply(t.cancel, buildCatalogAdminMenuOptions(normalizeBotLanguage(context.runtime.bot.language, 'ca'), context.runtime.actor.isAdmin));
    return true;
  }
  if (action === 'correct') {
    // A corrected title must get a new confirmation token.
    const corrected = await start(context, 'correct');
    await context.runtime.session.advance({ stepKey: 'correct', data: { ...corrected, ...(data.coverAttachment ? { coverAttachment: data.coverAttachment } : {}) } });
    await context.reply(t.correctPrompt);
    return true;
  }
  const candidateIds = Array.isArray(data.candidateIds) ? data.candidateIds : [];
  if (action === 'page' && current.stepKey === 'matches') {
    const matches = (await repository(context).listItems({ includeDeactivated: false })).filter((item) => candidateIds.includes(item.id) && item.lifecycleStatus === 'active');
    const result = await renderMatches(context, data, matches, Number(rawId) || 1);
    await context.reply(result.message, result.options);
    return true;
  }
  if (['select', 'borrow', 'activity'].includes(action ?? '')) {
    const itemId = Number(rawId);
    if (!Number.isSafeInteger(itemId) || !candidateIds.includes(itemId)) return true;
    const item = await repository(context).findItemById(itemId);
    if (!item || item.lifecycleStatus !== 'active') {
      await context.reply(t.unavailable);
      return true;
    }
    if (action === 'select' && current.stepKey === 'matches') {
      await context.runtime.session.advance({ stepKey: 'selected', data: { ...data, itemId } });
      const loan = await loadActiveLoanByItemId(context as TelegramCatalogLoanContext, item.id);
      await context.reply(`<b>${escapeHtml(item.displayName)}</b>${loan ? `\n\n${escapeHtml(t.loaned.replace('{user}', await resolveLoanBorrowerDisplayName(context, loan)))}` : ''}`, {
        parseMode: 'HTML', inlineKeyboard: [
          ...(item.itemType === 'board-game' ? [[button(data, t.activity, `activity:${itemId}`)]] : []),
          ...(!loan ? [[button(data, t.borrow, `borrow:${itemId}`)]] : []),
          [button(data, t.correct, 'correct'), button(data, t.cancel, 'cancel')],
        ],
      });
    } else if (current.stepKey === 'selected' && data.itemId === itemId) {
      if (action === 'activity' && item.itemType === 'board-game') {
        await context.runtime.session.cancel();
        await dependencies.createActivity(context, item);
      } else if (action === 'borrow') {
        await context.runtime.session.advance({ stepKey: 'confirm', data: { ...data, action: 'borrow', itemId } });
        await confirm(context, data, t.confirmBorrow.replace('{title}', item.displayName));
      }
    }
    return true;
  }
  if ((action === 'new-borrow' || action === 'new-cede') && current.stepKey === 'matches' && candidateIds.length === 0) {
    const cede = action === 'new-cede';
    await context.runtime.session.advance({ stepKey: 'confirm', data: { ...data, action: cede ? 'cede' : 'borrow' } });
    await confirm(context, data, (cede ? t.confirmCede : t.confirmNewBorrow).replace('{title}', String(data.query)));
    return true;
  }
  if (action !== 'confirm' || current.stepKey !== 'confirm' || !['borrow', 'cede'].includes(String(data.action))) return true;
  await complete(context, dependencies, data);
  return true;
}

async function confirm(context: TelegramCatalogAdminContext, data: Record<string, unknown>, message: string) {
  await context.reply(escapeHtml(message), { parseMode: 'HTML', inlineKeyboard: [[button(data, texts(context).confirm, 'confirm')], [button(data, texts(context).cancel, 'cancel')]] });
}

async function complete(context: TelegramCatalogAdminContext, dependencies: CatalogPhotoDependencies, data: Record<string, unknown>) {
  const t = texts(context);
  let item = typeof data.itemId === 'number' ? await repository(context).findItemById(data.itemId) : null;
  const creating = !data.itemId;
  if (creating) {
    const matches = await findMatches(context, String(data.query), data.draft && typeof data.draft === 'object' ? data.draft as Record<string, unknown> : undefined);
    if (matches.length) {
      const nextData = { ...data, candidateIds: matches.map((entry) => entry.id) };
      await context.runtime.session.advance({ stepKey: 'matches', data: nextData });
      const result = await renderMatches(context, nextData, matches, 1);
      await context.reply(result.message, result.options);
      return;
    }
  } else if (!item || item.lifecycleStatus !== 'active') {
    await context.reply(t.unavailable);
    return;
  }
  if (item && data.action === 'borrow') {
    const loan = await loadActiveLoanByItemId(context as TelegramCatalogLoanContext, item.id);
    if (loan) {
      await context.runtime.session.cancel();
      await context.reply(t.loaned.replace('{user}', await resolveLoanBorrowerDisplayName(context, loan)));
      return;
    }
  }
  await context.runtime.session.advance({ stepKey: 'saving', data });
  const progress = await startTelegramEditableProgress(context, t.saving, { editFailedEvent: 'catalog.photo.save-progress-edit.failed' });
  try {
    if (!item) {
      const draft = data.draft && typeof data.draft === 'object' ? data.draft as Partial<CatalogItemRecord> : {};
      item = await createCatalogItem({
        repository: repository(context), familyId: null, groupId: null, itemType: draft.itemType === 'expansion' ? 'expansion' : 'board-game',
        displayName: String(data.query), originalName: draft.originalName ?? draft.displayName ?? null,
        description: draft.description ?? null, language: draft.language ?? null, publisher: draft.publisher ?? null,
        publicationYear: draft.publicationYear ?? null, playerCountMin: draft.playerCountMin ?? null,
        playerCountMax: draft.playerCountMax ?? null, recommendedAge: draft.recommendedAge ?? null, playTimeMinutes: draft.playTimeMinutes ?? null,
        externalRefs: draft.externalRefs ?? null,
        metadata: { ...draft.metadata, pendingCatalogReview: true, photoRegistration: data.action, createdByTelegramUserId: context.runtime.actor.telegramUserId },
      });
      // Keep the created ID before cover storage, audit or publication can fail.
      await context.runtime.session.advance({ stepKey: 'saving', data: { ...data, itemId: item.id } });
      if (data.action === 'cede') item = await setCatalogItemOwner({ repository: repository(context), itemId: item.id, ownerTelegramUserId: context.runtime.actor.telegramUserId });
      await dependencies.auditCreated(context, item, data.action as 'borrow' | 'cede');
      if (data.coverAttachment && typeof data.coverAttachment === 'object') {
        try { await dependencies.saveCover(context, item, data.coverAttachment as Record<string, unknown>); }
        catch (error) { console.warn(JSON.stringify({ event: 'catalog.photo.cover.failed', itemId: item.id, error: error instanceof Error ? error.message : String(error) })); }
      }
    }
    await context.runtime.session.cancel();
    if (data.action === 'borrow') {
      await dependencies.createLoan(context, item);
      await progress.complete(createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca')).catalogLoan.hasBorrowed.replace('{item}', item.displayName));
    } else {
      const queued = await dependencies.publishCession(context, item);
      await progress.complete(`${escapeHtml(t.ceded.replace('{title}', item.displayName))}\n\n<a href="${escapeHtml(buildTelegramStartUrl(`catalog_read_item_${item.id}`))}">${escapeHtml(item.displayName)}</a>\n\n${queued ? t.queued : t.queueFailed}`, {
        parseMode: 'HTML', ...buildCatalogAdminMenuOptions(normalizeBotLanguage(context.runtime.bot.language, 'ca'), context.runtime.actor.isAdmin),
      });
    }
  } catch (error) {
    console.error(JSON.stringify({ event: 'catalog.photo.save.failed', itemId: item?.id ?? null, error: error instanceof Error ? error.message : String(error) }));
    // A repeat of the old confirmation cannot create another item or another loan.
    await context.runtime.session.cancel();
    await progress.complete(`${t.failed}${item ? `\n\n<a href="${escapeHtml(buildTelegramStartUrl(`catalog_read_item_${item.id}`))}">${escapeHtml(item.displayName)}</a>` : ''}`, { parseMode: 'HTML' });
  }
}
