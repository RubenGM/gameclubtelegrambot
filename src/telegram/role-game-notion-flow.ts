import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import {
  createRoleGameMaterial,
  type RoleGameNotionSourceRecord,
  type RoleGameRecord,
} from '../role-games/role-game-catalog.js';
import { createStorageEntry, type StorageEntryMessageInput } from '../storage/storage-catalog.js';
import { parseNotionPageReference } from '../notion/notion-client.js';
import { createNotionClient, type NotionClient } from '../notion/notion-client.js';
import { decryptNotionCredential, encryptNotionCredential } from '../notion/notion-credential-crypto.js';
import { renderNotionDocument, type RenderedNotionDocument } from '../notion/notion-renderer.js';
import { startTelegramEditableProgress } from './editable-progress.js';
import { buildTelegramStartUrl } from './deep-links.js';
import { createTelegramI18n, type BotLanguage } from './i18n.js';
import type { TelegramReplyButton, TelegramReplyOptions } from './runtime-boundary.js';
import {
  canManageCurrentRoleGame,
  ensureRoleGameHandoutCategory,
  resolveRepository,
  resolveStorageRepository,
  type TelegramRoleGameContext,
} from './role-game-flow.js';

export const roleGameNotionFlowKey = 'role-game-notion';
export const roleGameNotionBrowseStartPayloadPrefix = 'role_notion_';

type NotionStep = 'dashboard' | 'connect-token' | 'link-source' | 'link-confirm' | 'browse-pages' | 'browse-page-input' | 'import-page' | 'import-confirm' | 'unlink-confirm' | 'dismiss-changes-confirm';

interface NotionSessionData {
  gameId: number;
  categoryId: number | null;
  sourceId?: number;
  rootPageId?: string;
  rootPageUrl?: string;
  rootTitle?: string;
  pageId?: string;
  pageUrl?: string;
  pageTitle?: string;
  previewHash?: string;
  encryptedApiToken?: string;
  browsePageId?: string;
  browsePage?: number;
}

const notionBrowsePageSize = 12;

export interface NotionBrowsePageItem {
  notionPageId: string;
  parentNotionPageId: string | null;
  title: string | null;
  status: string;
}

export function buildNotionBrowseWindow<T extends NotionBrowsePageItem>({
  pages,
  parentPageId,
  requestedPage,
  pageSize = notionBrowsePageSize,
}: {
  pages: T[];
  parentPageId: string;
  requestedPage: number;
  pageSize?: number;
}): { items: T[]; page: number; total: number; totalPages: number; from: number; to: number } {
  const children = pages.filter((page) => page.status === 'active' && page.parentNotionPageId === parentPageId);
  const total = children.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const items = children.slice((page - 1) * pageSize, page * pageSize);
  return { items, page, total, totalPages, from, to: total === 0 ? 0 : from + items.length - 1 };
}

export function buildRoleGameNotionBrowseStartPayload({
  gameId,
  sourceId,
  pageId,
}: {
  gameId: number;
  sourceId: number;
  pageId: string;
}): string | null {
  const compactPageId = pageId.replaceAll('-', '').toLowerCase();
  if (!Number.isSafeInteger(gameId) || gameId < 1 || !Number.isSafeInteger(sourceId) || sourceId < 1 || !/^[a-f0-9]{32}$/.test(compactPageId)) {
    return null;
  }
  return `${roleGameNotionBrowseStartPayloadPrefix}${gameId}_${sourceId}_${compactPageId}`;
}

export function parseRoleGameNotionBrowseStartPayload(text: string | undefined): {
  gameId: number;
  sourceId: number;
  pageId: string;
} | null {
  const normalized = text?.trim();
  if (!normalized) return null;
  const payload = normalized.startsWith('/start ') ? normalized.slice('/start '.length).trim() : normalized;
  const match = new RegExp(`^${roleGameNotionBrowseStartPayloadPrefix}(\\d+)_(\\d+)_([a-fA-F0-9]{32})$`).exec(payload);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const gameId = Number(match[1]);
  const sourceId = Number(match[2]);
  if (!Number.isSafeInteger(gameId) || gameId < 1 || !Number.isSafeInteger(sourceId) || sourceId < 1) return null;
  const compactPageId = match[3].toLowerCase();
  return {
    gameId,
    sourceId,
    pageId: `${compactPageId.slice(0, 8)}-${compactPageId.slice(8, 12)}-${compactPageId.slice(12, 16)}-${compactPageId.slice(16, 20)}-${compactPageId.slice(20)}`,
  };
}

export function isRoleGameNotionSession(context: TelegramRoleGameContext): boolean {
  return context.runtime.session.current?.flowKey === roleGameNotionFlowKey;
}

export async function openRoleGameNotion(
  context: TelegramRoleGameContext,
  { gameId, categoryId, language }: { gameId: number; categoryId: number | null; language: BotLanguage },
): Promise<boolean> {
  const texts = createTelegramI18n(language).roleGames;
  if (!context.runtime.notionCredentialEncryptionKey) {
    await context.reply(texts.notionNotConfigured);
    return true;
  }
  const repository = resolveRepository(context);
  const game = await repository.findGameById(gameId);
  const membership = game ? await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId) : null;
  if (!game || !canManageCurrentRoleGame(context, game, membership) || !repository.notion) {
    await context.reply(texts.permissionDenied);
    return true;
  }
  const source = await repository.notion.findSourceByRoleGameId(game.id);
  return replyWithNotionDashboard(context, { game, categoryId, source, language });
}

export async function openRoleGameNotionBrowsePage(
  context: TelegramRoleGameContext,
  { gameId, sourceId, pageId, language }: { gameId: number; sourceId: number; pageId: string; language: BotLanguage },
): Promise<boolean> {
  const texts = createTelegramI18n(language).roleGames;
  if (!context.runtime.notionCredentialEncryptionKey) {
    await context.reply(texts.notionNotConfigured);
    return true;
  }
  const repository = resolveRepository(context);
  const game = await repository.findGameById(gameId);
  const membership = game ? await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId) : null;
  if (!game || !canManageCurrentRoleGame(context, game, membership) || !repository.notion) {
    await context.reply(texts.permissionDenied);
    return true;
  }
  const source = await repository.notion.findSourceByRoleGameId(game.id);
  if (!source || source.id !== sourceId || source.status !== 'active') {
    await context.reply(texts.notionSourceMissing);
    return true;
  }
  const page = await repository.notion.findSourcePage(source.id, pageId);
  if (!page || page.status !== 'active') {
    await context.reply(texts.notionPageOutsideSource);
    return true;
  }
  const pages = await repository.notion.listSourcePages(source.id);
  const hasChildren = pages.some((entry) => entry.status === 'active' && entry.parentNotionPageId === page.notionPageId);
  if (hasChildren) {
    return replyWithNotionBrowser(context, { game, categoryId: null, source, pageId: page.notionPageId, requestedPage: 1, language });
  }
  return previewNotionPage(context, { game, categoryId: null, source, pageId: page.notionPageId, language });
}

export async function handleTelegramRoleGameNotionText(
  context: TelegramRoleGameContext,
  text: string,
  language: BotLanguage,
): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== roleGameNotionFlowKey) return false;
  const data = session.data as Partial<NotionSessionData>;
  const gameId = typeof data.gameId === 'number' ? data.gameId : NaN;
  const categoryId = typeof data.categoryId === 'number' ? data.categoryId : null;
  const texts = createTelegramI18n(language).roleGames;
  const repository = resolveRepository(context);
  const game = Number.isSafeInteger(gameId) ? await repository.findGameById(gameId) : null;
  const membership = game ? await repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId) : null;
  if (!game || !canManageCurrentRoleGame(context, game, membership) || !repository.notion) {
    await context.runtime.session.cancel();
    await context.reply(texts.permissionDenied);
    return true;
  }
  if (!context.runtime.notionCredentialEncryptionKey) {
    await context.runtime.session.cancel();
    await context.reply(texts.notionNotConfigured);
    return true;
  }

  if (text === texts.cancel) {
    await context.runtime.session.cancel();
    await context.reply(createTelegramI18n(language).common.flowCancelled);
    return true;
  }
  if (text === texts.backToMaterials) {
    await context.runtime.session.cancel();
    return false;
  }

  const step = session.stepKey as NotionStep;
  if (step === 'dashboard') {
    const source = await repository.notion.findSourceByRoleGameId(game.id);
    if (text === texts.notionLinkSource) {
      await context.runtime.session.advance({ stepKey: 'connect-token', data: { gameId: game.id, categoryId } satisfies NotionSessionData });
      await context.reply(texts.notionTokenPrompt, notionKeyboard({ language, cancelOnly: true }));
      return true;
    }
    if (text === texts.notionImportPage) {
      if (!source || source.status !== 'active') {
        await context.reply(texts.notionSourceMissing, notionKeyboard({ language, source, pendingChanges: 0 }));
        return true;
      }
      await context.runtime.session.advance({
        stepKey: 'import-page',
        data: { gameId: game.id, categoryId, sourceId: source.id } satisfies NotionSessionData,
      });
      await context.reply(texts.notionPagePrompt, notionKeyboard({ language, cancelOnly: true }));
      return true;
    }
    if (text === texts.notionBrowsePages) {
      if (!source || source.status !== 'active') {
        await context.reply(texts.notionSourceMissing, notionKeyboard({ language, source, pendingChanges: 0 }));
        return true;
      }
      const progress = await startTelegramEditableProgress(context, texts.notionRefreshing, { editFailedEvent: 'role-games.notion.browse.progress-edit.failed' });
      try {
        const client = await resolveSourceNotionClient(context, source);
        await indexNotionSourceTree({ client, repository: repository.notion, source, rootPageId: source.rootPageId });
        const refreshed = await repository.notion.setSourceStatus({ sourceId: source.id, status: 'active', lastSyncedAt: new Date().toISOString() });
        await progress.complete(texts.notionBrowseReady);
        return replyWithNotionBrowser(context, { game, categoryId, source: refreshed, pageId: refreshed.rootPageId, requestedPage: 1, language });
      } catch (error) {
        await repository.notion.setSourceStatus({ sourceId: source.id, status: 'error', lastError: error instanceof Error ? error.message : texts.invalidCreateValue });
        await progress.complete(error instanceof Error ? error.message : texts.invalidCreateValue, notionKeyboard({ language, source, pendingChanges: 0 }));
        return true;
      }
    }
    if (text === texts.notionRefreshSource && source) {
      const progress = await startTelegramEditableProgress(context, texts.notionRefreshing, { editFailedEvent: 'role-games.notion.refresh.progress-edit.failed' });
      try {
        const client = await resolveSourceNotionClient(context, source);
        await indexNotionSourceTree({ client, repository: repository.notion, source, rootPageId: source.rootPageId });
        const refreshed = await repository.notion.setSourceStatus({ sourceId: source.id, status: 'active', lastSyncedAt: new Date().toISOString() });
        const pendingChanges = await repository.notion.listChanges({ sourceId: source.id, statuses: ['pending'], limit: 200 });
        await progress.complete(texts.notionSourceRefreshed, notionKeyboard({ language, source: refreshed, pendingChanges: pendingChanges.length }));
      } catch (error) {
        await repository.notion.setSourceStatus({ sourceId: source.id, status: 'error', lastError: error instanceof Error ? error.message : texts.invalidCreateValue });
        await progress.complete(error instanceof Error ? error.message : texts.invalidCreateValue, notionKeyboard({ language, source, pendingChanges: 0 }));
      }
      return true;
    }
    if (text === texts.notionUnlinkSource && source) {
      await context.runtime.session.advance({
        stepKey: 'unlink-confirm',
        data: { gameId: game.id, categoryId, sourceId: source.id } satisfies NotionSessionData,
      });
      await context.reply(texts.notionUnlinkConfirm, notionKeyboard({ language, confirmUnlink: true }));
      return true;
    }
    if (text === texts.notionDismissChanges && source) {
      await context.runtime.session.advance({
        stepKey: 'dismiss-changes-confirm',
        data: { gameId: game.id, categoryId, sourceId: source.id } satisfies NotionSessionData,
      });
      await context.reply(texts.notionDismissChangesConfirm, notionKeyboard({ language, confirmDismiss: true }));
      return true;
    }
    if (source && text === texts.notionPendingChanges.replace('{count}', String((await repository.notion.listChanges({ sourceId: source.id, statuses: ['pending'], limit: 50 })).length))) {
      return replyWithNotionChanges(context, { game, categoryId, source, language });
    }
    return false;
  }

  if (step === 'connect-token') {
    const encryptionKey = context.runtime.notionCredentialEncryptionKey!;
    const encryptedApiToken = encryptNotionCredential(text.trim(), encryptionKey);
    await context.runtime.session.advance({
      stepKey: 'link-source',
      data: { gameId: game.id, categoryId, encryptedApiToken } satisfies NotionSessionData,
    });
    await deleteSensitiveTelegramMessage(context);
    await context.reply(texts.notionTokenSaved, notionKeyboard({ language, cancelOnly: true }));
    await context.reply(texts.notionSourcePrompt, notionKeyboard({ language, cancelOnly: true }));
    return true;
  }

  if (step === 'link-source') {
    let reference;
    try {
      reference = parseNotionPageReference(text);
    } catch (error) {
      await context.reply(error instanceof Error ? error.message : texts.invalidCreateValue, notionKeyboard({ language, cancelOnly: true }));
      return true;
    }
    const progress = await startTelegramEditableProgress(context, texts.notionImporting, { editFailedEvent: 'role-games.notion.link.progress-edit.failed' });
    try {
      const client = createNotionClient({ apiToken: decryptNotionCredential(data.encryptedApiToken ?? '', context.runtime.notionCredentialEncryptionKey!) });
      const document = await client.readPageDocument(reference.pageId);
      if (document.page.archived || document.page.inTrash) throw new Error(texts.notionSourceMissing);
      await context.runtime.session.advance({
        stepKey: 'link-confirm',
        data: buildNotionLinkConfirmationSessionData({
          gameId: game.id,
          categoryId,
          encryptedApiToken: data.encryptedApiToken,
          rootPageId: document.page.id,
          rootPageUrl: document.page.url ?? reference.canonicalUrl,
          rootTitle: document.page.title,
        }),
      });
      await progress.complete(texts.notionSourcePreview.replace('{title}', document.page.title), notionKeyboard({ language, confirmLink: true }));
    } catch (error) {
      await progress.complete(error instanceof Error ? error.message : texts.invalidCreateValue, notionKeyboard({ language, cancelOnly: true }));
    }
    return true;
  }

  if (step === 'link-confirm') {
    if (text !== texts.notionConfirmLink || !data.rootPageId || !data.rootPageUrl) return false;
    const progress = await startTelegramEditableProgress(context, texts.notionImporting, { editFailedEvent: 'role-games.notion.index.progress-edit.failed' });
    try {
      const client = createNotionClient({ apiToken: decryptNotionCredential(data.encryptedApiToken ?? '', context.runtime.notionCredentialEncryptionKey!) });
      const source = await repository.notion.upsertSource({
        roleGameId: game.id,
        rootPageId: data.rootPageId,
        rootPageUrl: data.rootPageUrl,
        title: data.rootTitle ?? null,
        status: 'active',
        linkedByTelegramUserId: context.runtime.actor.telegramUserId,
        tokenOwnerTelegramUserId: context.runtime.actor.telegramUserId,
        encryptedApiToken: data.encryptedApiToken ?? null,
        webhookPathSecret: randomBytes(32).toString('base64url'),
        lastSyncedAt: new Date().toISOString(),
      });
      await indexNotionSourceTree({ client, repository: repository.notion, source, rootPageId: source.rootPageId });
      await progress.complete(texts.notionSourceLinked, notionKeyboard({ language, source, pendingChanges: 0 }));
      await context.runtime.session.start({ stepKey: 'dashboard', flowKey: roleGameNotionFlowKey, data: { gameId: game.id, categoryId } satisfies NotionSessionData });
    } catch (error) {
      await progress.complete(error instanceof Error ? error.message : texts.invalidCreateValue, notionKeyboard({ language, cancelOnly: true }));
    }
    return true;
  }

  if (step === 'import-page') {
    let reference;
    try {
      reference = parseNotionPageReference(text);
    } catch (error) {
      await context.reply(error instanceof Error ? error.message : texts.invalidCreateValue, notionKeyboard({ language, cancelOnly: true }));
      return true;
    }
    const source = typeof data.sourceId === 'number' ? await repository.notion.findSourceByRoleGameId(game.id) : null;
    if (!source || source.id !== data.sourceId || source.status !== 'active') {
      await context.reply(texts.notionSourceMissing);
      return replyWithNotionDashboard(context, { game, categoryId, source: null, language });
    }
    const sourcePage = await repository.notion.findSourcePage(source.id, reference.pageId);
    if (!sourcePage || sourcePage.status !== 'active') {
      await context.reply(texts.notionPageOutsideSource, notionKeyboard({ language, cancelOnly: true }));
      return true;
    }
    return previewNotionPage(context, { game, categoryId, source, pageId: sourcePage.notionPageId, language });
  }

  if (step === 'browse-pages' || step === 'browse-page-input') {
    const source = typeof data.sourceId === 'number' ? await repository.notion.findSourceByRoleGameId(game.id) : null;
    const browsePageId = typeof data.browsePageId === 'string' ? data.browsePageId : source?.rootPageId;
    if (!source || !browsePageId || source.id !== data.sourceId || source.status !== 'active') {
      await context.reply(texts.notionSourceMissing);
      return replyWithNotionDashboard(context, { game, categoryId, source: null, language });
    }
    if (step === 'browse-page-input') {
      if (text === texts.notionBack) {
        return replyWithNotionDashboard(context, { game, categoryId, source, language });
      }
      const requestedPage = Number.parseInt(text, 10);
      if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) {
        await context.reply(texts.invalidCreateValue, notionBrowseKeyboard({ language, currentPage: 1, totalPages: 1 }));
        return true;
      }
      return replyWithNotionBrowser(context, { game, categoryId, source, pageId: browsePageId, requestedPage, language });
    }
    const pages = await repository.notion.listSourcePages(source.id);
    if (text === texts.notionBack) {
      return replyWithNotionDashboard(context, { game, categoryId, source, language });
    }
    if (text === texts.notionPendingChanges.replace('{count}', String((await repository.notion.listChanges({ sourceId: source.id, statuses: ['pending'], limit: 200 })).length))) {
      return replyWithNotionChanges(context, { game, categoryId, source, language });
    }
    if (text === texts.notionBrowseImportCurrent) {
      return previewNotionPage(context, { game, categoryId, source, pageId: browsePageId, language });
    }
    if (text === texts.notionBrowseUp) {
      const current = pages.find((page) => page.notionPageId === browsePageId);
      const parentPageId = current?.parentNotionPageId ?? source.rootPageId;
      return replyWithNotionBrowser(context, { game, categoryId, source, pageId: parentPageId, requestedPage: 1, language });
    }
    if (text === texts.previousPage || text === texts.nextPage) {
      const requestedPage = (typeof data.browsePage === 'number' ? data.browsePage : 1) + (text === texts.nextPage ? 1 : -1);
      return replyWithNotionBrowser(context, { game, categoryId, source, pageId: browsePageId, requestedPage, language });
    }
    if (text === texts.notionBrowseGoToPage) {
      await context.runtime.session.advance({
        stepKey: 'browse-page-input',
        data: { gameId: game.id, categoryId, sourceId: source.id, browsePageId, browsePage: data.browsePage ?? 1 } satisfies NotionSessionData,
      });
      await context.reply(texts.notionBrowsePagePrompt, notionBrowseKeyboard({ language, currentPage: data.browsePage ?? 1, totalPages: 1 }));
      return true;
    }
    return false;
  }

  if (step === 'import-confirm') {
    if (text !== texts.notionConfirmImport || typeof data.sourceId !== 'number' || !data.pageId) return false;
    const source = await repository.notion.findSourceByRoleGameId(game.id);
    if (!source || source.id !== data.sourceId || source.status !== 'active') {
      await context.reply(texts.notionSourceMissing);
      return true;
    }
    return importNotionPage(context, {
      game,
      categoryId,
      source,
      pageId: data.pageId,
      language,
      ...(data.previewHash ? { expectedHash: data.previewHash } : {}),
    });
  }

  if (step === 'unlink-confirm') {
    if (text !== texts.notionUnlinkSource || typeof data.sourceId !== 'number') return false;
    await repository.notion.deleteSourceForRoleGame(game.id);
    await context.runtime.session.start({ stepKey: 'dashboard', flowKey: roleGameNotionFlowKey, data: { gameId: game.id, categoryId } satisfies NotionSessionData });
    await context.reply(texts.notionSourceUnlinked, notionKeyboard({ language, source: null, pendingChanges: 0 }));
    return true;
  }
  if (step === 'dismiss-changes-confirm') {
    if (text !== texts.notionDismissChanges || typeof data.sourceId !== 'number') return false;
    const source = await repository.notion.findSourceByRoleGameId(game.id);
    if (!source || source.id !== data.sourceId) {
      await context.reply(texts.notionSourceMissing);
      return true;
    }
    const changes = await repository.notion.listChanges({ sourceId: source.id, statuses: ['pending'], limit: 200 });
    await Promise.all(changes.map((change) => repository.notion!.updateChange({
      changeId: change.id,
      status: 'dismissed',
      reviewedByTelegramUserId: context.runtime.actor.telegramUserId,
      reviewedAt: new Date().toISOString(),
    })));
    await context.runtime.session.start({ stepKey: 'dashboard', flowKey: roleGameNotionFlowKey, data: { gameId: game.id, categoryId } satisfies NotionSessionData });
    await context.reply(texts.notionChangesDismissed, notionKeyboard({ language, source, pendingChanges: 0 }));
    return true;
  }
  return false;
}

export function buildNotionLinkConfirmationSessionData({
  gameId,
  categoryId,
  encryptedApiToken,
  rootPageId,
  rootPageUrl,
  rootTitle,
}: {
  gameId: number;
  categoryId: number | null;
  encryptedApiToken: string | undefined;
  rootPageId: string;
  rootPageUrl: string;
  rootTitle: string;
}): NotionSessionData & Record<string, unknown> {
  return {
    gameId,
    categoryId,
    ...(encryptedApiToken ? { encryptedApiToken } : {}),
    rootPageId,
    rootPageUrl,
    rootTitle,
  };
}

async function replyWithNotionDashboard(
  context: TelegramRoleGameContext,
  { game, categoryId, source, language }: { game: RoleGameRecord; categoryId: number | null; source: RoleGameNotionSourceRecord | null; language: BotLanguage },
): Promise<boolean> {
  const repository = resolveRepository(context);
  const pendingChanges = source ? await repository.notion?.listChanges({ sourceId: source.id, statuses: ['pending'], limit: 100 }) ?? [] : [];
  await context.runtime.session.start({
    flowKey: roleGameNotionFlowKey,
    stepKey: 'dashboard',
    data: { gameId: game.id, categoryId } satisfies NotionSessionData,
  });
  const texts = createTelegramI18n(language).roleGames;
  const lines = [
    `<b>${texts.notion}</b>`,
    source
      ? `${escapeHtml(source.title ?? source.rootPageId)}\n${escapeHtml(source.rootPageUrl)}`
      : texts.notionSourceMissing,
    source && !source.encryptedApiToken ? `⚠️ ${texts.notionTokenMissing}` : null,
    source?.webhookPathSecret ? `Webhook: <code>https://cawa.hopto.org/webhooks/notion/${escapeHtml(source.webhookPathSecret)}</code>` : null,
    source?.lastError ? `⚠️ ${escapeHtml(source.lastError)}` : null,
  ].filter((line): line is string => Boolean(line));
  await context.reply(lines.join('\n\n'), { ...notionKeyboard({ language, source, pendingChanges: pendingChanges.length }), parseMode: 'HTML' });
  return true;
}

async function replyWithNotionBrowser(
  context: TelegramRoleGameContext,
  { game, categoryId, source, pageId, requestedPage, language }: { game: RoleGameRecord; categoryId: number | null; source: RoleGameNotionSourceRecord; pageId: string; requestedPage: number; language: BotLanguage },
): Promise<boolean> {
  const repository = resolveRepository(context);
  const texts = createTelegramI18n(language).roleGames;
  const pages = await repository.notion!.listSourcePages(source.id);
  const current = pages.find((page) => page.notionPageId === pageId && page.status === 'active')
    ?? pages.find((page) => page.notionPageId === source.rootPageId && page.status === 'active');
  if (!current) {
    await context.reply(texts.notionSourceMissing);
    return replyWithNotionDashboard(context, { game, categoryId, source: null, language });
  }
  const window = buildNotionBrowseWindow({ pages, parentPageId: current.notionPageId, requestedPage });
  const pagesWithChildren = new Set(pages
    .filter((page) => page.status === 'active' && page.parentNotionPageId !== null)
    .map((page) => page.parentNotionPageId)
    .filter((pageId): pageId is string => pageId !== null));
  const pendingChanges = await repository.notion!.listChanges({ sourceId: source.id, statuses: ['pending'], limit: 200 });
  const pendingPageIds = new Set(pendingChanges
    .map((change) => change.sourcePageId)
    .filter((sourcePageId): sourcePageId is number => sourcePageId !== null)
    .map((sourcePageId) => pages.find((page) => page.id === sourcePageId)?.notionPageId)
    .filter((notionPageId): notionPageId is string => Boolean(notionPageId)));
  const lines = [
    `<b>${texts.notionBrowseHeader}</b>`,
    `<b>${escapeHtml(current.title ?? current.notionPageId)}</b>`,
    texts.notionBrowseHint,
    '',
    ...(window.items.length > 0
      ? window.items.map((page, index) => formatNotionBrowsePageLink({
        gameId: game.id,
        sourceId: source.id,
        page,
        index,
        hasChildren: pagesWithChildren.has(page.notionPageId),
        hasPendingChange: pendingPageIds.has(page.notionPageId),
      }))
      : [texts.notionBrowseNoChildren]),
    ...(window.totalPages > 1 ? ['', texts.listPageFooter
      .replace('{from}', String(window.from))
      .replace('{to}', String(window.to))
      .replace('{total}', String(window.total))
      .replace('{page}', String(window.page))
      .replace('{pages}', String(window.totalPages))] : []),
  ];
  await context.runtime.session.start({
    flowKey: roleGameNotionFlowKey,
    stepKey: 'browse-pages',
    data: {
      gameId: game.id,
      categoryId,
      sourceId: source.id,
      browsePageId: current.notionPageId,
      browsePage: window.page,
    } satisfies NotionSessionData,
  });
  await context.reply(lines.join('\n'), {
    ...notionBrowseKeyboard({ language, currentPage: window.page, totalPages: window.totalPages, hasParent: current.notionPageId !== source.rootPageId, pendingChanges: pendingChanges.length }),
    parseMode: 'HTML',
  });
  return true;
}

function formatNotionBrowsePageLink({
  gameId,
  sourceId,
  page,
  index,
  hasChildren,
  hasPendingChange,
}: {
  gameId: number;
  sourceId: number;
  page: NotionBrowsePageItem;
  index: number;
  hasChildren: boolean;
  hasPendingChange: boolean;
}): string {
  const label = `${hasPendingChange ? '⚠️ ' : ''}${hasChildren ? '📁' : '📄'} ${index + 1}. ${escapeHtml(page.title ?? page.notionPageId)}`;
  const payload = buildRoleGameNotionBrowseStartPayload({ gameId, sourceId, pageId: page.notionPageId });
  return payload ? `<a href="${escapeHtml(buildTelegramStartUrl(payload))}">${label}</a>` : label;
}

async function replyWithNotionChanges(
  context: TelegramRoleGameContext,
  { game, categoryId, source, language }: { game: RoleGameRecord; categoryId: number | null; source: RoleGameNotionSourceRecord; language: BotLanguage },
): Promise<boolean> {
  const repository = resolveRepository(context);
  const changes = await repository.notion?.listChanges({ sourceId: source.id, statuses: ['pending'], limit: 50 }) ?? [];
  const texts = createTelegramI18n(language).roleGames;
  if (changes.length === 0) {
    await context.reply(texts.notionChangesEmpty, notionKeyboard({ language, source, pendingChanges: 0 }));
    return true;
  }
  const pages = await repository.notion?.listSourcePages(source.id) ?? [];
  const byId = new Map(pages.map((page) => [page.id, page]));
  await context.reply([
    `<b>${texts.notionChangesHeader}</b>`,
    '',
    ...changes.map((change) => {
      const page = change.sourcePageId ? byId.get(change.sourcePageId) : null;
      return `• ${escapeHtml(page?.title ?? page?.notionPageId ?? change.changeKind)}`;
    }),
  ].join('\n'), { ...notionKeyboard({ language, source, pendingChanges: changes.length }), parseMode: 'HTML' });
  await context.runtime.session.start({ flowKey: roleGameNotionFlowKey, stepKey: 'dashboard', data: { gameId: game.id, categoryId } satisfies NotionSessionData });
  return true;
}

async function previewNotionPage(
  context: TelegramRoleGameContext,
  { game, categoryId, source, pageId, language }: { game: RoleGameRecord; categoryId: number | null; source: RoleGameNotionSourceRecord; pageId: string; language: BotLanguage },
): Promise<boolean> {
  const repository = resolveRepository(context);
  const client = await resolveSourceNotionClient(context, source);
  const texts = createTelegramI18n(language).roleGames;
  const progress = await startTelegramEditableProgress(context, texts.notionImporting, { editFailedEvent: 'role-games.notion.preview.progress-edit.failed' });
  try {
    const document = await client.readPageDocument(pageId);
    const rendered = renderNotionDocument(document);
    const indexedPage = await repository.notion!.findSourcePage(source.id, document.page.id);
    const page = await repository.notion!.upsertSourcePage({
      sourceId: source.id,
      notionPageId: document.page.id,
      parentNotionPageId: indexedPage?.parentNotionPageId ?? null,
      pageUrl: document.page.url ?? `https://www.notion.so/${document.page.id.replaceAll('-', '')}`,
      title: document.page.title,
      status: document.page.archived || document.page.inTrash ? 'trashed' : 'active',
      lastNotionEditedAt: document.page.lastEditedTime,
      latestContentFingerprint: rendered.contentHash,
    });
    await repository.notion!.createPageRevision({
      sourcePageId: page.id,
      roleGameMaterialId: null,
      revisionKind: 'previewed',
      notionLastEditedAt: document.page.lastEditedTime,
      contentHash: rendered.contentHash,
      blockIds: document.blocks.map((block) => block.id),
      renderedContent: rendered.messages.join('\n\n'),
      capturedByTelegramUserId: context.runtime.actor.telegramUserId,
    });
    await context.runtime.session.start({
      flowKey: roleGameNotionFlowKey,
      stepKey: 'import-confirm',
      data: {
        gameId: game.id,
        categoryId,
        sourceId: source.id,
        pageId: document.page.id,
        ...(document.page.url ? { pageUrl: document.page.url } : {}),
        pageTitle: rendered.title,
        previewHash: rendered.contentHash,
      } satisfies NotionSessionData,
    });
    const warningParts = [
      rendered.truncated ? texts.notionPreviewTruncated : null,
      rendered.unsupportedBlockTypes.length > 0 ? texts.notionPreviewUnsupported.replace('{types}', rendered.unsupportedBlockTypes.join(', ')) : null,
      rendered.files.filter((entry) => entry.file.kind === 'external').length > 0 ? texts.notionPreviewExternalFiles : null,
    ].filter((entry): entry is string => Boolean(entry));
    await progress.complete([
      texts.notionPreviewHeader.replace('{title}', rendered.title),
      texts.notionPreviewInfo
        .replace('{blocks}', String(document.blockCount))
        .replace('{messages}', String(rendered.messages.length))
        .replace('{files}', String(rendered.files.length)),
      warningParts.length > 0 ? texts.notionPreviewWarnings.replace('{warnings}', warningParts.join('; ')) : null,
    ].filter((entry): entry is string => Boolean(entry)).join('\n\n'), notionKeyboard({ language, confirmImport: true }));
    for (const message of rendered.messages.slice(0, 2)) {
      await context.reply(message, { parseMode: 'HTML' });
    }
  } catch (error) {
    await progress.complete(error instanceof Error ? error.message : texts.invalidCreateValue, notionKeyboard({ language, cancelOnly: true }));
  }
  return true;
}

async function importNotionPage(
  context: TelegramRoleGameContext,
  { game, categoryId, source, pageId, language, expectedHash }: { game: RoleGameRecord; categoryId: number | null; source: RoleGameNotionSourceRecord; pageId: string; language: BotLanguage; expectedHash?: string },
): Promise<boolean> {
  const repository = resolveRepository(context);
  const client = await resolveSourceNotionClient(context, source);
  const storageRepository = resolveStorageRepository(context);
  const texts = createTelegramI18n(language).roleGames;
  const progress = await startTelegramEditableProgress(context, texts.notionImporting, { editFailedEvent: 'role-games.notion.import.progress-edit.failed' });
  try {
    const document = await client.readPageDocument(pageId);
    const rendered = renderNotionDocument(document);
    if (expectedHash && expectedHash !== rendered.contentHash) {
      await progress.complete(texts.notionPreviewChanged, notionKeyboard({ language, cancelOnly: true }));
      return previewNotionPage(context, { game, categoryId, source, pageId, language });
    }
    const category = await ensureRoleGameHandoutCategory(context, storageRepository);
    if (!category || !context.runtime.bot.sendGroupMessage) throw new Error(texts.materialStorageNotConfigured);
    const storedMessages: StorageEntryMessageInput[] = [];
    for (const [index, message] of rendered.messages.entries()) {
      await progress.update(`${texts.notionImporting} ${index + 1}/${rendered.messages.length}`);
      const sent = await context.runtime.bot.sendGroupMessage(category.storageChatId, message, {
        parseMode: 'HTML',
        messageThreadId: category.storageThreadId,
      });
      if (!sent) throw new Error(texts.notionTelegramTextNotConfirmed);
      storedMessages.push({
        storageChatId: category.storageChatId,
        storageMessageId: sent.messageId,
        storageThreadId: category.storageThreadId,
        attachmentKind: 'text',
        caption: null,
        sortOrder: storedMessages.length,
      });
    }
    for (const entry of rendered.files.filter((file) => file.file.kind === 'notion_file')) {
      if (!context.runtime.bot.sendDocument) break;
      const freshFile = await client.refreshBlockFile(entry.blockId) ?? entry.file;
      const downloaded = await client.downloadFile(freshFile);
      const dir = await mkdtemp(join(tmpdir(), 'gameclub-notion-'));
      const filename = safeFilename(downloaded.filename ?? freshFile.name ?? 'notion-attachment');
      const filePath = join(dir, filename);
      try {
        await writeFile(filePath, downloaded.bytes);
        const sent = await context.runtime.bot.sendDocument({
          chatId: category.storageChatId,
          filePath,
          messageThreadId: category.storageThreadId,
          ...(freshFile.name ? { caption: freshFile.name } : {}),
        });
        if (!sent) throw new Error(texts.notionTelegramFileNotConfirmed);
        storedMessages.push({
          storageChatId: category.storageChatId,
          storageMessageId: sent.messageId,
          storageThreadId: category.storageThreadId,
          attachmentKind: 'document',
          originalFileName: filename,
          mimeType: downloaded.contentType,
          sortOrder: storedMessages.length,
        });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
    const storageEntry = await createStorageEntry({
      repository: storageRepository,
      categoryId: category.id,
      createdByTelegramUserId: context.runtime.actor.telegramUserId,
      sourceKind: 'topic_direct',
      description: texts.notionImportedDescription.replace('{title}', rendered.title),
      tags: ['rol', `partida-${game.id}`, 'notion'],
      messages: storedMessages,
    });
    const material = await createRoleGameMaterial({
      repository,
      roleGameId: game.id,
      categoryId,
      internalStorageEntryId: storageEntry.entry.id,
      title: rendered.title,
      description: 'Importado desde Notion.',
      visibility: 'gm_only',
      uploadedByTelegramUserId: context.runtime.actor.telegramUserId,
    });
    const indexedPage = await repository.notion!.findSourcePage(source.id, document.page.id);
    const sourcePage = await repository.notion!.upsertSourcePage({
      sourceId: source.id,
      notionPageId: document.page.id,
      parentNotionPageId: indexedPage?.parentNotionPageId ?? null,
      pageUrl: document.page.url ?? `https://www.notion.so/${document.page.id.replaceAll('-', '')}`,
      title: document.page.title,
      status: document.page.archived || document.page.inTrash ? 'trashed' : 'active',
      lastNotionEditedAt: document.page.lastEditedTime,
      latestContentFingerprint: rendered.contentHash,
      latestRoleGameMaterialId: material.id,
      firstImportedAt: new Date().toISOString(),
      lastImportedAt: new Date().toISOString(),
    });
    await repository.notion!.createPageRevision({
      sourcePageId: sourcePage.id,
      roleGameMaterialId: material.id,
      revisionKind: 'imported',
      notionLastEditedAt: document.page.lastEditedTime,
      contentHash: rendered.contentHash,
      blockIds: document.blocks.map((block) => block.id),
      renderedContent: rendered.messages.join('\n\n'),
      capturedByTelegramUserId: context.runtime.actor.telegramUserId,
    });
    const pendingChanges = await repository.notion!.listChanges({ sourceId: source.id, statuses: ['pending'], limit: 200 });
    await Promise.all(pendingChanges
      .filter((change) => change.sourcePageId === sourcePage.id)
      .map((change) => repository.notion!.updateChange({
        changeId: change.id,
        status: 'imported',
        reviewedByTelegramUserId: context.runtime.actor.telegramUserId,
        reviewedAt: new Date().toISOString(),
      })));
    const remainingChanges = pendingChanges.filter((change) => change.sourcePageId !== sourcePage.id).length;
    await context.runtime.session.start({ flowKey: roleGameNotionFlowKey, stepKey: 'dashboard', data: { gameId: game.id, categoryId } satisfies NotionSessionData });
    await progress.complete(texts.notionImported, notionKeyboard({ language, source, pendingChanges: remainingChanges }));
  } catch (error) {
    await progress.complete(error instanceof Error ? error.message : texts.invalidCreateValue, notionKeyboard({ language, cancelOnly: true }));
  }
  return true;
}

async function indexNotionSourceTree({
  client,
  repository,
  source,
  rootPageId,
}: {
  client: NotionClient;
  repository: NonNullable<ReturnType<typeof resolveRepository>['notion']>;
  source: RoleGameNotionSourceRecord;
  rootPageId: string;
}): Promise<void> {
  const queue: Array<{ pageId: string; parentPageId: string | null }> = [{ pageId: rootPageId, parentPageId: null }];
  const seen = new Set<string>();
  while (queue.length > 0 && seen.size < 200) {
    const item = queue.shift()!;
    if (seen.has(item.pageId)) continue;
    seen.add(item.pageId);
    const document = await client.readPageDocument(item.pageId, { maxBlocks: 1_000, maxDepth: 8 });
    await repository.upsertSourcePage({
      sourceId: source.id,
      notionPageId: document.page.id,
      parentNotionPageId: item.parentPageId,
      pageUrl: document.page.url ?? `https://www.notion.so/${document.page.id.replaceAll('-', '')}`,
      title: document.page.title,
      status: document.page.archived || document.page.inTrash ? 'trashed' : 'active',
      lastNotionEditedAt: document.page.lastEditedTime,
    });
    for (const block of flattenBlocks(document.blocks)) {
      if (block.type === 'child_page' && !seen.has(block.id)) queue.push({ pageId: block.id, parentPageId: document.page.id });
    }
  }
}

function flattenBlocks(blocks: Array<{ children: unknown[] } & { type: string; id: string }>): Array<{ children: unknown[]; type: string; id: string }> {
  const output: Array<{ children: unknown[]; type: string; id: string }> = [];
  const visit = (block: { children: unknown[]; type: string; id: string }) => {
    output.push(block);
    for (const child of block.children as Array<{ children: unknown[]; type: string; id: string }>) visit(child);
  };
  blocks.forEach(visit);
  return output;
}

function notionKeyboard({
  language,
  source,
  pendingChanges = 0,
  cancelOnly = false,
  confirmLink = false,
  confirmImport = false,
  confirmUnlink = false,
  confirmDismiss = false,
}: {
  language: BotLanguage;
  source?: RoleGameNotionSourceRecord | null;
  pendingChanges?: number;
  cancelOnly?: boolean;
  confirmLink?: boolean;
  confirmImport?: boolean;
  confirmUnlink?: boolean;
  confirmDismiss?: boolean;
}): TelegramReplyOptions {
  const texts = createTelegramI18n(language).roleGames;
  if (cancelOnly) return keyboard([[{ text: texts.cancel, semanticRole: 'danger' }]], language);
  if (confirmLink) return keyboard([[{ text: texts.notionConfirmLink, semanticRole: 'success' }], [{ text: texts.cancel, semanticRole: 'danger' }]], language);
  if (confirmImport) return keyboard([[{ text: texts.notionConfirmImport, semanticRole: 'success' }], [{ text: texts.cancel, semanticRole: 'danger' }]], language);
  if (confirmUnlink) return keyboard([[{ text: texts.notionUnlinkSource, semanticRole: 'danger' }], [{ text: texts.cancel, semanticRole: 'danger' }]], language);
  if (confirmDismiss) return keyboard([[{ text: texts.notionDismissChanges, semanticRole: 'danger' }], [{ text: texts.cancel, semanticRole: 'danger' }]], language);
  const rows: TelegramReplyButton[][] = [
    [{ text: source?.encryptedApiToken ? texts.notionBrowsePages : texts.notionLinkSource, semanticRole: 'primary' }],
  ];
  if (source) {
    rows.push(
      [{ text: texts.notionImportPage, semanticRole: 'secondary' }],
      [{ text: texts.notionRefreshSource, semanticRole: 'primary' }],
      [{ text: texts.notionPendingChanges.replace('{count}', String(pendingChanges)), semanticRole: 'primary' }],
      [{ text: texts.notionDismissChanges, semanticRole: 'danger' }],
      [{ text: texts.notionUnlinkSource, semanticRole: 'danger' }],
    );
  }
  rows.push([{ text: texts.backToMaterials, semanticRole: 'navigation' }]);
  return keyboard(rows, language);
}

function notionBrowseKeyboard({
  language,
  currentPage,
  totalPages,
  hasParent = false,
  pendingChanges = 0,
}: {
  language: BotLanguage;
  currentPage: number;
  totalPages: number;
  hasParent?: boolean;
  pendingChanges?: number;
}): TelegramReplyOptions {
  const texts = createTelegramI18n(language).roleGames;
  const rows: TelegramReplyButton[][] = [
    [{ text: texts.notionBrowseImportCurrent, semanticRole: 'success' }],
  ];
  const navigation: TelegramReplyButton[] = [];
  if (hasParent) navigation.push({ text: texts.notionBrowseUp, semanticRole: 'navigation' });
  if (currentPage > 1) navigation.push({ text: texts.previousPage, semanticRole: 'navigation' });
  if (currentPage < totalPages) navigation.push({ text: texts.nextPage, semanticRole: 'navigation' });
  if (navigation.length > 0) rows.push(navigation);
  if (totalPages > 3) rows.push([{ text: texts.notionBrowseGoToPage, semanticRole: 'navigation' }]);
  rows.push(
    [{ text: texts.notionPendingChanges.replace('{count}', String(pendingChanges)), semanticRole: 'primary' }],
    [{ text: texts.notionBack, semanticRole: 'navigation' }],
  );
  return keyboard(rows, language);
}

function keyboard(rows: TelegramReplyButton[][], language: BotLanguage): TelegramReplyOptions {
  const i18n = createTelegramI18n(language);
  return { replyKeyboard: [...rows, [{ text: i18n.actionMenu.start, semanticRole: 'navigation' }, { text: i18n.actionMenu.help, semanticRole: 'help' }]], resizeKeyboard: true, persistentKeyboard: true };
}

function safeFilename(value: string): string {
  const normalized = basename(value).replace(/[^A-Za-z0-9._-]/g, '_');
  return normalized.slice(0, 180) || 'notion-attachment';
}

async function resolveSourceNotionClient(context: TelegramRoleGameContext, source: RoleGameNotionSourceRecord): Promise<NotionClient> {
  const encryptionKey = context.runtime.notionCredentialEncryptionKey;
  if (!encryptionKey || !source.encryptedApiToken) throw new Error(createTelegramI18n(context.runtime.bot.language ?? 'ca').roleGames.notionTokenMissing);
  return createNotionClient({ apiToken: decryptNotionCredential(source.encryptedApiToken, encryptionKey) });
}

async function deleteSensitiveTelegramMessage(context: TelegramRoleGameContext): Promise<void> {
  if (context.runtime.chat.kind !== 'private' || !context.messageId || !context.runtime.bot.deleteMessage) return;
  try {
    await context.runtime.bot.deleteMessage({ chatId: context.runtime.chat.chatId, messageId: context.messageId });
  } catch (error) {
    context.runtime.logger?.warn?.({ event: 'role-games.notion.token.delete.failed', error: error instanceof Error ? error.message : String(error) }, 'Could not delete Notion token message');
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
