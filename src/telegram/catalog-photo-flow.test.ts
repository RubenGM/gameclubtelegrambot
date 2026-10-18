import test from 'node:test';
import assert from 'node:assert/strict';

import type { CatalogItemRecord, CatalogLoanRecord, CatalogLoanRepository, CatalogRepository } from '../catalog/catalog-model.js';
import type { WikipediaBoardGameImportResult } from '../catalog/wikipedia-boardgame-import-service.js';
import type { TelegramCatalogAdminContext } from './catalog-admin-flow.js';
import type { ConversationSessionRecord } from './conversation-session.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import { handleCatalogPhotoCallback, handleCatalogPhotoMessage, handleCatalogPhotoText } from './catalog-photo-flow.js';

function item(overrides: Partial<CatalogItemRecord> = {}): CatalogItemRecord {
  return {
    id: 1, familyId: null, groupId: null, itemType: 'board-game', displayName: 'Wingspan', originalName: 'Wingspan',
    description: null, language: null, publisher: null, publicationYear: null, playerCountMin: null, playerCountMax: null,
    recommendedAge: null, playTimeMinutes: null, storagePosition: null, externalRefs: null, metadata: null,
    lifecycleStatus: 'active', createdAt: '2026-10-18T10:00:00Z', updatedAt: '2026-10-18T10:00:00Z', deactivatedAt: null,
    ...overrides,
  };
}

function harness(initialItems: CatalogItemRecord[] = [], detectedTitle = 'Wingspan') {
  const items = new Map(initialItems.map((entry) => [entry.id, entry]));
  const activeLoans = new Map<number, CatalogLoanRecord>();
  const createdItems: CatalogItemRecord[] = [];
  const loanedItems: CatalogItemRecord[] = [];
  const activities: CatalogItemRecord[] = [];
  const cessions: CatalogItemRecord[] = [];
  const audits: Array<{ item: CatalogItemRecord; action: string }> = [];
  const savedCovers: CatalogItemRecord[] = [];
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  let session: ConversationSessionRecord | null = null;
  let detections = 0;
  let imports = 0;
  let importResult: WikipediaBoardGameImportResult = { ok: false, error: { type: 'not-found', message: 'No encontrado' } };
  const repository = {
    async listItems() { return [...items.values()].filter((entry) => entry.lifecycleStatus === 'active'); },
    async findItemById(id: number) { return items.get(id) ?? null; },
    async createItem(input: Parameters<CatalogRepository['createItem']>[0]) {
      const created = item({ ...input, id: Math.max(0, ...items.keys()) + 1 });
      items.set(created.id, created);
      createdItems.push(created);
      return created;
    },
    async setItemOwner(input: { itemId: number; ownerTelegramUserId: number | null }) {
      const existing = items.get(input.itemId);
      assert.ok(existing);
      existing.ownerTelegramUserId = input.ownerTelegramUserId;
      return existing;
    },
  } as unknown as CatalogRepository;
  const context: TelegramCatalogAdminContext = {
    messageMedia: { attachmentKind: 'photo', fileId: 'photo', messageId: 10 },
    async reply(message, options) {
      replies.push({ message, ...(options ? { options } : {}) });
      return { message_id: replies.length };
    },
    runtime: {
      actor: { telegramUserId: 99, status: 'approved', isApproved: true, isBlocked: false, isAdmin: false, permissions: [] },
      authorization: { authorize: (permissionKey) => ({ allowed: false, permissionKey, reason: 'no-match' }), can: () => false },
      chat: { kind: 'private', chatId: 1 },
      services: { database: { db: undefined } },
      session: {
        get current() { return session; },
        async start({ flowKey, stepKey, data = {} }) {
          session = { key: 'telegram.session:1:99', flowKey, stepKey, data, createdAt: '2026-10-18T10:00:00Z', updatedAt: '2026-10-18T10:00:00Z', expiresAt: '2099-01-01T00:00:00Z' };
          return session;
        },
        async advance({ stepKey, data }) {
          assert.ok(session);
          session = { ...session, stepKey, ...(data ? { data } : {}) };
          return session;
        },
        async cancel() { const existed = !!session; session = null; return existed; },
      },
      bot: {
        publicName: 'Test Bot', clubName: 'Club', language: 'es', async sendPrivateMessage() {},
        async editMessageText({ messageId, text, options }) {
          replies[messageId - 1] = { message: text, ...(options ? { options } : {}) };
        },
      },
    },
    catalogRepository: repository,
    catalogLoanRepository: {
      async findActiveLoanByItemId(id: number) { return activeLoans.get(id) ?? null; },
      async listLoansByItem(id: number) { const loan = activeLoans.get(id); return loan ? [loan] : []; },
    } as CatalogLoanRepository,
  };
  const dependencies = {
    async detectTitle() { detections += 1; return { displayName: detectedTitle, coverAttachment: { fileId: 'photo' } }; },
    async importTitle() { imports += 1; return importResult; },
    async saveCover(_context: TelegramCatalogAdminContext, entry: CatalogItemRecord) { savedCovers.push(entry); },
    async createLoan(_context: TelegramCatalogAdminContext, entry: CatalogItemRecord) { loanedItems.push(entry); },
    async createActivity(_context: TelegramCatalogAdminContext, entry: CatalogItemRecord) { activities.push(entry); },
    async publishCession(_context: TelegramCatalogAdminContext, entry: CatalogItemRecord) { cessions.push(entry); return true; },
    async auditCreated(_context: TelegramCatalogAdminContext, entry: CatalogItemRecord, action: 'borrow' | 'cede') { audits.push({ item: entry, action }); },
  };
  function callback(action: string): string {
    const found = replies.flatMap((reply) => reply.options?.inlineKeyboard?.flat() ?? [])
      .map((button) => button.callbackData).filter((value): value is string => !!value)
      .reverse().find((value) => value.startsWith('catalog_photo:') && value.split(':').slice(2).join(':') === action);
    assert.ok(found, `Missing callback ${action}: ${JSON.stringify(replies)}`);
    return found;
  }
  async function click(action: string) {
    context.callbackData = callback(action);
    return handleCatalogPhotoCallback(context, dependencies);
  }
  return {
    context, dependencies, items, activeLoans, createdItems, loanedItems, activities, cessions, audits, savedCovers, replies, callback, click,
    get session() { return session; },
    get detections() { return detections; },
    get imports() { return imports; },
    setImportResult(result: WikipediaBoardGameImportResult) { importResult = result; },
  };
}

test('a cover in Spanish finds an alternate title and asks before any action', async () => {
  const h = harness([item({ displayName: 'The Castles of Burgundy', metadata: { alternateNames: ['Los castillos de Borgoña'] } })], 'Los castillos de Borgona');
  assert.equal(await handleCatalogPhotoMessage(h.context, h.dependencies), true);
  assert.ok(h.callback('select:1'));
  assert.equal(h.loanedItems.length, 0);
  assert.equal(h.createdItems.length, 0);
  await h.click('select:1');
  assert.ok(h.callback('borrow:1'));
  assert.ok(h.callback('activity:1'));
  assert.equal(h.activities.length, 0);
});

test('multiple copies require choosing the physical item', async () => {
  const h = harness([item(), item({ id: 2, storagePosition: 'B2' })]);
  await handleCatalogPhotoMessage(h.context, h.dependencies);
  assert.ok(h.callback('select:1'));
  assert.ok(h.callback('select:2'));
  assert.equal(h.loanedItems.length + h.activities.length + h.createdItems.length, 0);
});

test('borrowing requires a separate confirmation and consumes it once', async () => {
  const h = harness([item()]);
  await handleCatalogPhotoMessage(h.context, h.dependencies);
  await h.click('select:1');
  await h.click('borrow:1');
  assert.equal(h.loanedItems.length, 0);
  const confirmation = h.callback('confirm');
  h.context.callbackData = confirmation;
  await handleCatalogPhotoCallback(h.context, h.dependencies);
  assert.deepEqual(h.loanedItems.map((entry) => entry.id), [1]);
  h.context.callbackData = confirmation;
  await handleCatalogPhotoCallback(h.context, h.dependencies);
  assert.equal(h.loanedItems.length, 1);
  assert.equal(h.session, null);
});

test('availability is checked again immediately before confirming a loan', async () => {
  const h = harness([item()]);
  await handleCatalogPhotoMessage(h.context, h.dependencies);
  await h.click('select:1');
  await h.click('borrow:1');
  h.activeLoans.set(1, { id: 5, itemId: 1, borrowerTelegramUserId: 123, borrowerDisplayName: 'Otra socia', returnedAt: null } as CatalogLoanRecord);
  await h.click('confirm');
  assert.equal(h.loanedItems.length, 0);
  assert.match(h.replies.map((reply) => reply.message).join('\n'), /prestad|disponib/i);
});

for (const action of ['borrow', 'cede'] as const) {
  test(`an unknown title creates a confirmed ${action} with the correct ownership`, async () => {
    const h = harness([], 'Juego desconocido');
    await handleCatalogPhotoMessage(h.context, h.dependencies);
    await h.click(`new-${action}`);
    assert.equal(h.createdItems.length, 0);
    await h.click('confirm');
    assert.equal(h.createdItems.length, 1);
    assert.equal(h.createdItems[0]?.displayName, 'Juego desconocido');
    assert.equal(h.createdItems[0]?.ownerTelegramUserId ?? null, action === 'cede' ? 99 : null);
    assert.equal(h.createdItems[0]?.metadata?.pendingCatalogReview, true);
    assert.equal(h.loanedItems.length, action === 'borrow' ? 1 : 0);
    assert.equal(h.cessions.length, action === 'cede' ? 1 : 0);
    assert.deepEqual(h.audits.map((audit) => audit.action), [action]);
    assert.equal(h.savedCovers.length, 1);
  });
}

test('a duplicate arriving while confirmation is displayed prevents silent creation', async () => {
  const h = harness([], 'Wingspan');
  await handleCatalogPhotoMessage(h.context, h.dependencies);
  await h.click('new-borrow');
  h.items.set(42, item({ id: 42 }));
  await h.click('confirm');
  assert.equal(h.createdItems.length, 0);
  assert.equal(h.loanedItems.length, 0);
  assert.ok(h.callback('select:42'));
});

test('a stale callback cannot act on a newer photo session', async () => {
  const h = harness([item()]);
  await handleCatalogPhotoMessage(h.context, h.dependencies);
  const oldSelection = h.callback('select:1');
  await handleCatalogPhotoMessage(h.context, h.dependencies);
  const currentToken = h.session?.data.token;
  h.context.callbackData = oldSelection;
  await handleCatalogPhotoCallback(h.context, h.dependencies);
  assert.equal(h.session?.stepKey, 'matches');
  assert.equal(h.session?.data.token, currentToken);
  assert.equal(h.loanedItems.length + h.activities.length + h.createdItems.length, 0);
});

test('a callback cannot be reused by another actor or after losing access', async () => {
  for (const changeActor of [true, false]) {
    const h = harness([item()]);
    await handleCatalogPhotoMessage(h.context, h.dependencies);
    await h.click('select:1');
    await h.click('borrow:1');
    h.context.callbackData = h.callback('confirm');
    if (changeActor) h.context.runtime.actor.telegramUserId = 123;
    else { h.context.runtime.actor.isApproved = false; h.context.runtime.actor.status = 'pending'; }
    await handleCatalogPhotoCallback(h.context, h.dependencies);
    assert.equal(h.loanedItems.length, 0);
  }
});

test('a photo cannot take over another active conversation or run in a group', async () => {
  const h = harness([item()]);
  await h.context.runtime.session.start({ flowKey: 'storage-upload', stepKey: 'attachment', data: { preserve: true } });
  assert.equal(await handleCatalogPhotoMessage(h.context, h.dependencies), false);
  assert.equal(h.session?.flowKey, 'storage-upload');
  assert.equal(h.detections, 0);
  await h.context.runtime.session.cancel();
  h.context.runtime.chat = { kind: 'group', chatId: -10 };
  assert.equal(await handleCatalogPhotoMessage(h.context, h.dependencies), false);
  assert.equal(h.detections, 0);
});

test('the explicit photo command starts a private flow without borrowing or scheduling dates', async () => {
  const h = harness();
  delete h.context.messageMedia;
  h.context.messageText = '/catalog_photo';
  assert.equal(await handleCatalogPhotoText(h.context, h.dependencies), true);
  assert.equal(h.session?.flowKey, 'catalog-photo');
  assert.equal(h.detections, 0);
  assert.equal(h.loanedItems.length + h.activities.length, 0);
});

test('initial photo recognition requires an approved and unblocked member', async () => {
  for (const blocked of [true, false]) {
    const h = harness([item()]);
    if (blocked) h.context.runtime.actor.isBlocked = true;
    else { h.context.runtime.actor.isApproved = false; h.context.runtime.actor.status = 'pending'; }
    assert.equal(await handleCatalogPhotoMessage(h.context, h.dependencies), false);
    assert.equal(h.detections, 0);
    assert.equal(h.session, null);
  }
});

test('forged callback IDs and skipped selection cannot borrow or create an item', async () => {
  const h = harness([item(), item({ id: 2, displayName: 'Catan', originalName: 'Catan' })]);
  await handleCatalogPhotoMessage(h.context, h.dependencies);
  const prefix = h.callback('select:1').split(':').slice(0, 2).join(':');
  for (const action of ['borrow:1', 'activity:1', 'select:2', 'borrow:2', 'new-borrow', 'new-cede', 'confirm']) {
    h.context.callbackData = `${prefix}:${action}`;
    assert.equal(await handleCatalogPhotoCallback(h.context, h.dependencies), true);
  }
  assert.equal(h.session?.stepKey, 'matches');
  assert.equal(h.loanedItems.length + h.activities.length + h.createdItems.length, 0);
  await h.click('select:1');
  h.context.callbackData = `${prefix}:borrow:2`;
  await handleCatalogPhotoCallback(h.context, h.dependencies);
  assert.equal(h.session?.stepKey, 'selected');
  assert.equal(h.loanedItems.length, 0);
});

test('a deactivated game cannot be borrowed after the confirmation was shown', async () => {
  const h = harness([item()]);
  await handleCatalogPhotoMessage(h.context, h.dependencies);
  await h.click('select:1');
  await h.click('borrow:1');
  h.items.get(1)!.lifecycleStatus = 'deactivated';
  await h.click('confirm');
  assert.equal(h.loanedItems.length, 0);
  assert.match(h.replies.at(-1)?.message ?? '', /no.*disponible/i);
});

test('an expired session cannot be confirmed', async () => {
  const h = harness([item()]);
  await handleCatalogPhotoMessage(h.context, h.dependencies);
  await h.click('select:1');
  await h.click('borrow:1');
  assert.ok(h.session);
  h.session.expiresAt = '2000-01-01T00:00:00Z';
  await h.click('confirm');
  assert.equal(h.loanedItems.length, 0);
});

test('provider identity finds the existing game even when the detected name differs', async () => {
  const h = harness([item({ externalRefs: { boardGameGeekId: '266192' } })], 'Envergadura');
  h.setImportResult({ ok: true, draft: { ...item({ displayName: 'Envergadura', originalName: 'Wingspan', externalRefs: { boardGameGeekId: '266192' } }) } });
  await handleCatalogPhotoMessage(h.context, h.dependencies);
  assert.equal(h.imports, 1);
  assert.ok(h.callback('select:1'));
  assert.equal(h.createdItems.length, 0);
});

test('correcting the detected name retains the original cover for registration', async () => {
  const h = harness([], 'Título leído incorrectamente');
  await handleCatalogPhotoMessage(h.context, h.dependencies);
  await h.click('correct');
  h.context.messageText = 'Título corregido';
  assert.equal(await handleCatalogPhotoText(h.context, h.dependencies), true);
  await h.click('new-cede');
  await h.click('confirm');
  assert.equal(h.createdItems[0]?.displayName, 'Título corregido');
  assert.equal(h.savedCovers.length, 1);
});

test('organizing a game starts the activity flow for the selected item', async () => {
  const h = harness([item()]);
  await handleCatalogPhotoMessage(h.context, h.dependencies);
  await h.click('select:1');
  await h.click('activity:1');
  assert.deepEqual(h.activities.map((entry) => entry.id), [1]);
  assert.equal(h.loanedItems.length + h.createdItems.length, 0);
});

test('slow photo recognition cannot overwrite a conversation opened while it was running', async () => {
  const h = harness([item()]);
  let releaseDetection!: (value: { displayName: string; coverAttachment: { fileId: string } }) => void;
  let detectionStarted!: () => void;
  const started = new Promise<void>((resolve) => { detectionStarted = resolve; });
  h.dependencies.detectTitle = async () => {
    detectionStarted();
    return new Promise((resolve) => { releaseDetection = resolve; });
  };
  const photo = handleCatalogPhotoMessage(h.context, h.dependencies);
  await started;
  await h.context.runtime.session.start({ flowKey: 'storage-upload', stepKey: 'attachment', data: { preserve: true } });
  releaseDetection({ displayName: 'Wingspan', coverAttachment: { fileId: 'photo' } });
  assert.equal(await photo, true);
  assert.equal(h.session?.flowKey, 'storage-upload');
  assert.deepEqual(h.session?.data, { preserve: true });
  assert.equal(h.loanedItems.length + h.activities.length + h.createdItems.length, 0);
});

test('six matching copies paginate without selecting or borrowing a hidden item', async () => {
  const h = harness(Array.from({ length: 6 }, (_, index) => item({ id: index + 1, storagePosition: `A${index + 1}` })));
  await handleCatalogPhotoMessage(h.context, h.dependencies);
  const firstPage = h.replies.at(-1)!;
  assert.match(firstPage.message, /Página 1\/2/);
  assert.equal(firstPage.options?.inlineKeyboard?.flat().some((button) => button.callbackData?.endsWith(':select:6')), false);
  await h.click('page:2');
  const secondPage = h.replies.at(-1)!;
  assert.match(secondPage.message, /Página 2\/2/);
  assert.ok(h.callback('select:6'));
  assert.ok(h.callback('page:1'));
  assert.equal(h.loanedItems.length + h.activities.length, 0);
});

for (const editing of ['missing', 'fails'] as const) {
  test(`photo results remain actionable when progress editing ${editing}`, async () => {
    const h = harness([item()]);
    if (editing === 'missing') delete h.context.runtime.bot.editMessageText;
    else h.context.runtime.bot.editMessageText = async () => { throw new Error('message cannot be edited'); };
    assert.equal(await handleCatalogPhotoMessage(h.context, h.dependencies), true);
    const result = h.replies.at(-1)!;
    assert.ok(h.callback('select:1'));
    assert.equal(result.options?.replyKeyboard, undefined);
    assert.equal(h.session?.stepKey, 'matches');
  });
}

test('a failed cession announcement preserves the registered game and its owner', async () => {
  const h = harness([], 'Juego cedido');
  h.dependencies.publishCession = async (_context, entry) => { h.cessions.push(entry); return false; };
  await handleCatalogPhotoMessage(h.context, h.dependencies);
  await h.click('new-cede');
  await h.click('confirm');
  assert.equal(h.createdItems.length, 1);
  assert.equal(h.items.get(1)?.ownerTelegramUserId, 99);
  assert.equal(h.cessions.length, 1);
  assert.equal(h.session, null);
  assert.match(h.replies.at(-1)?.message ?? '', /no se ha podido encolar/i);
});
