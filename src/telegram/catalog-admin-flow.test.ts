import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

import type { AuditLogEventRecord, AuditLogRepository } from '../audit/audit-log.js';
import type { CatalogLookupCandidate, CatalogLookupService } from '../catalog/catalog-lookup-service.js';
import type {
  CatalogFamilyRecord,
  CatalogGroupRecord,
  CatalogItemRecord,
  CatalogMediaRecord,
  CatalogLoanRecord,
  CatalogLoanRepository,
  CatalogRepository,
} from '../catalog/catalog-model.js';
import type { MembershipAccessRepository, MembershipUserRecord } from '../membership/access-flow.js';
import { normalizeDisplayName } from '../membership/display-name.js';
import type { WikipediaBoardGameImportService } from '../catalog/wikipedia-boardgame-import-service.js';
import type { BoardGameGeekCollectionImportService } from '../catalog/wikipedia-boardgame-import-service.js';
import type { CatalogMediaExternalImageDownloader } from '../catalog/catalog-media-storage.js';
import type { StorageCategoryRecord, StorageCategoryRepository, StorageEntryDetailRecord } from '../storage/storage-catalog.js';
import type { ConversationSessionRecord } from './conversation-session.js';
import type { AppMetadataSessionStorage } from './conversation-session-store.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import type { TelegramPhotoMediaInput } from './telegram-media.js';
import {
  catalogAdminCallbackPrefixes,
  catalogAdminLabels,
  handleTelegramCatalogAdminCallback,
  handleTelegramCatalogAdminMessage,
  handleTelegramCatalogAdminStartText,
  handleTelegramCatalogAdminText,
  type TelegramCatalogAdminContext,
} from './catalog-admin-flow.js';

function successButton(text: string) {
  return { text, semanticRole: 'success' as const };
}

function dangerButton(text: string) {
  return { text, semanticRole: 'danger' as const };
}

function buttonText(button: string | { text: string }): string {
  return typeof button === 'string' ? button : button.text;
}

function createRepository({
  families = [],
  groups = [],
  items = [],
  media = [],
}: {
  families?: CatalogFamilyRecord[];
  groups?: CatalogGroupRecord[];
  items?: CatalogItemRecord[];
  media?: CatalogMediaRecord[];
} = {}): CatalogRepository {
  const familyMap = new Map(families.map((family) => [family.id, family]));
  const groupMap = new Map(groups.map((group) => [group.id, group]));
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const mediaMap = new Map(media.map((entry) => [entry.id, entry]));
  let nextFamilyId = Math.max(0, ...families.map((family) => family.id)) + 1;
  let nextItemId = Math.max(0, ...items.map((item) => item.id)) + 1;
  let nextMediaId = Math.max(0, ...media.map((entry) => entry.id)) + 1;

  return {
    async createFamily(input) {
      const createdAt = '2026-04-04T10:00:00.000Z';
      const family: CatalogFamilyRecord = {
        id: nextFamilyId,
        slug: input.slug,
        displayName: input.displayName,
        description: input.description,
        familyKind: input.familyKind,
        createdAt,
        updatedAt: createdAt,
      };
      nextFamilyId += 1;
      familyMap.set(family.id, family);
      return family;
    },
    async findFamilyById(familyId) {
      return familyMap.get(familyId) ?? null;
    },
    async listFamilies() {
      return Array.from(familyMap.values());
    },
    async createGroup() {
      throw new Error('not implemented');
    },
    async findGroupById(groupId) {
      return groupMap.get(groupId) ?? null;
    },
    async listGroups({ familyId }) {
      return Array.from(groupMap.values()).filter((group) => familyId === undefined || group.familyId === familyId);
    },
    async createItem(input) {
      const createdAt = '2026-04-04T10:00:00.000Z';
      const item: CatalogItemRecord = {
        id: nextItemId,
        familyId: input.familyId,
        groupId: input.groupId,
        itemType: input.itemType,
        displayName: input.displayName,
        originalName: input.originalName,
        description: input.description,
        language: input.language,
        publisher: input.publisher,
        publicationYear: input.publicationYear,
        playerCountMin: input.playerCountMin,
        playerCountMax: input.playerCountMax,
        recommendedAge: input.recommendedAge,
        playTimeMinutes: input.playTimeMinutes,
        externalRefs: input.externalRefs,
        metadata: input.metadata,
        lifecycleStatus: 'active',
        createdAt,
        updatedAt: createdAt,
        deactivatedAt: null,
      };
      nextItemId += 1;
      itemMap.set(item.id, item);
      return item;
    },
    async findItemById(itemId) {
      return itemMap.get(itemId) ?? null;
    },
    async listItems({ includeDeactivated }) {
      return Array.from(itemMap.values()).filter((item) => includeDeactivated || item.lifecycleStatus === 'active');
    },
    async updateItem(input) {
      const existing = itemMap.get(input.itemId);
      if (!existing) {
        throw new Error('unknown item');
      }
      const next: CatalogItemRecord = {
        ...existing,
        familyId: input.familyId,
        groupId: input.groupId,
        itemType: input.itemType,
        displayName: input.displayName,
        originalName: input.originalName,
        description: input.description,
        language: input.language,
        publisher: input.publisher,
        publicationYear: input.publicationYear,
        playerCountMin: input.playerCountMin,
        playerCountMax: input.playerCountMax,
        recommendedAge: input.recommendedAge,
        playTimeMinutes: input.playTimeMinutes,
        externalRefs: input.externalRefs,
        metadata: input.metadata,
        updatedAt: '2026-04-04T11:00:00.000Z',
      };
      itemMap.set(next.id, next);
      return next;
    },
    async setItemOwner(input) {
      const existing = itemMap.get(input.itemId);
      if (!existing) {
        throw new Error('unknown item');
      }
      const next: CatalogItemRecord = {
        ...existing,
        ownerTelegramUserId: input.ownerTelegramUserId,
        updatedAt: '2026-04-04T11:30:00.000Z',
      };
      itemMap.set(next.id, next);
      return next;
    },
    async deactivateItem({ itemId }) {
      const existing = itemMap.get(itemId);
      if (!existing) {
        throw new Error('unknown item');
      }
      const next: CatalogItemRecord = {
        ...existing,
        lifecycleStatus: 'deactivated',
        updatedAt: '2026-04-04T12:00:00.000Z',
        deactivatedAt: '2026-04-04T12:00:00.000Z',
      };
      itemMap.set(next.id, next);
      return next;
    },
    async createMedia(input): Promise<CatalogMediaRecord> {
      const entry: CatalogMediaRecord = {
        id: nextMediaId,
        familyId: input.familyId,
        itemId: input.itemId,
        mediaType: input.mediaType,
        url: input.url,
        altText: input.altText,
        sortOrder: input.sortOrder,
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      };
      nextMediaId += 1;
      mediaMap.set(entry.id, entry);
      return entry;
    },
    async listMedia({ familyId, itemId }) {
      return Array.from(mediaMap.values()).filter((entry) => {
        if (familyId !== undefined) {
          return entry.familyId === familyId;
        }
        if (itemId !== undefined) {
          return entry.itemId === itemId;
        }
        return true;
      });
    },
    async updateMedia(input) {
      const existing = mediaMap.get(input.mediaId);
      if (!existing) {
        throw new Error(`unknown media ${input.mediaId}`);
      }
      const next: CatalogMediaRecord = {
        ...existing,
        mediaType: input.mediaType,
        url: input.url,
        altText: input.altText,
        sortOrder: input.sortOrder,
        updatedAt: '2026-04-04T11:00:00.000Z',
      };
      mediaMap.set(next.id, next);
      return next;
    },
    async deleteMedia({ mediaId }) {
      return mediaMap.delete(mediaId);
    },
  };
}

function createAuditRepository(): AuditLogRepository & { __events: AuditLogEventRecord[] } {
  const events: AuditLogEventRecord[] = [];
  return {
    async appendEvent(input) {
      events.push({
        actorTelegramUserId: input.actorTelegramUserId,
        actionKey: input.actionKey,
        targetType: input.targetType,
        targetId: input.targetId,
        summary: input.summary,
        details: input.details ?? null,
        createdAt: '2026-04-04T10:00:00.000Z',
      });
    },
    __events: events,
  };
}

function createLoanRepository(initialLoans: CatalogLoanRecord[] = []): CatalogLoanRepository {
  const loans = new Map(initialLoans.map((loan) => [loan.id, loan]));

  return {
    async createLoan() { throw new Error('not implemented'); },
    async findLoanById(loanId) { return loans.get(loanId) ?? null; },
    async findActiveLoanByItemId(itemId) {
      return Array.from(loans.values()).find((loan) => loan.itemId === itemId && loan.returnedAt === null) ?? null;
    },
    async listActiveLoansByBorrower() { return []; },
    async listActiveLoansWithItems() { return []; },
    async listLoansByItem(itemId) { return Array.from(loans.values()).filter((loan) => loan.itemId === itemId); },
    async listActiveLoansDueBefore() { return []; },
    async updateLoan() { throw new Error('not implemented'); },
    async closeLoan() { throw new Error('not implemented'); },
  };
}

function createMembershipRepository(users: MembershipUserRecord[] = []): MembershipAccessRepository {
  const userMap = new Map(users.map((user) => [user.telegramUserId, user]));

  return {
    async findUserByTelegramUserId(telegramUserId) {
      return userMap.get(telegramUserId) ?? null;
    },
    async syncUserProfile(input) {
      const existing = userMap.get(input.telegramUserId);
      if (!existing) {
        return null;
      }

      const next: MembershipUserRecord = {
        ...existing,
        ...(input.username !== undefined ? { username: input.username ?? null } : {}),
        displayName: normalizeDisplayName(input.displayName) ?? existing.displayName,
      };
      userMap.set(next.telegramUserId, next);
      return next;
    },
    async upsertPendingUser() { throw new Error('not implemented'); },
    async listPendingUsers() { return []; },
    async listManageableUsers() { return Array.from(userMap.values()).sort((left, right) => left.displayName.localeCompare(right.displayName) || left.telegramUserId - right.telegramUserId); },
    async listRevocableUsers() { return Array.from(userMap.values()).filter((user) => user.status === 'approved' && !user.isAdmin); },
    async listApprovedAdminUsers() { return Array.from(userMap.values()).filter((user) => user.status === 'approved' && user.isAdmin); },
    async findLatestRevocation() { return null; },
    async backfillDisplayNames() { return 0; },
    async appendStatusAuditLog() { throw new Error('not implemented'); },
    async approveMembershipRequest() { throw new Error('not implemented'); },
    async rejectMembershipRequest() { throw new Error('not implemented'); },
    async revokeMembershipAccess() { throw new Error('not implemented'); },
  };
}

function createMemoryMetadataStorage(initialValues: Record<string, string> = {}): AppMetadataSessionStorage {
  const values = new Map(Object.entries(initialValues));
  return {
    async get(key) {
      return values.get(key) ?? null;
    },
    async set(key, value) {
      values.set(key, value);
    },
    async delete(key) {
      return values.delete(key);
    },
    async listByPrefix(prefix) {
      return Array.from(values.entries())
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value }));
    },
  };
}

function createStorageRepository(): StorageCategoryRepository & { __entries: StorageEntryDetailRecord[] } {
  const categories = new Map<number, StorageCategoryRecord>();
  const entries: StorageEntryDetailRecord[] = [];
  let nextCategoryId = 1;
  let nextEntryId = 1;
  let nextEntryMessageId = 1;

  return {
    async createCategory(input) {
      const category: StorageCategoryRecord = {
        id: nextCategoryId,
        slug: input.slug,
        displayName: input.displayName,
        parentCategoryId: input.parentCategoryId,
        description: input.description,
        storageChatId: input.storageChatId,
        storageThreadId: input.storageThreadId,
        categoryPurpose: input.categoryPurpose ?? 'user_uploads',
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        archivedAt: null,
      };
      nextCategoryId += 1;
      categories.set(category.id, category);
      return category;
    },
    async updateCategoryLifecycleStatus() { throw new Error('not implemented'); },
    async updateCategoryMetadata() { throw new Error('not implemented'); },
    async updateCategoryParent() { throw new Error('not implemented'); },
    async findCategoryById(categoryId) { return categories.get(categoryId) ?? null; },
    async findCategoryByStorageThread(storageChatId, storageThreadId) {
      return Array.from(categories.values()).find((category) => category.storageChatId === storageChatId && category.storageThreadId === storageThreadId) ?? null;
    },
    async listCategories() {
      return Array.from(categories.values());
    },
    async createEntry(input) {
      const category = categories.get(input.categoryId);
      if (!category) {
        throw new Error('unknown category');
      }
      const detail: StorageEntryDetailRecord = {
        entry: {
          id: nextEntryId,
          categoryId: input.categoryId,
          createdByTelegramUserId: input.createdByTelegramUserId,
          sourceKind: input.sourceKind,
          description: input.description,
          tags: input.tags,
          lifecycleStatus: 'active',
          createdAt: '2026-04-04T10:00:00.000Z',
          updatedAt: '2026-04-04T10:00:00.000Z',
          deletedAt: null,
          deletedByTelegramUserId: null,
        },
        category,
        messages: input.messages.map((message) => ({
          id: nextEntryMessageId++,
          entryId: nextEntryId,
          storageChatId: message.storageChatId,
          storageMessageId: message.storageMessageId,
          storageThreadId: message.storageThreadId,
          telegramFileId: message.telegramFileId ?? null,
          telegramFileUniqueId: message.telegramFileUniqueId ?? null,
          attachmentKind: message.attachmentKind,
          caption: message.caption ?? null,
          originalFileName: message.originalFileName ?? null,
          mimeType: message.mimeType ?? null,
          fileSizeBytes: message.fileSizeBytes ?? null,
          mediaGroupId: message.mediaGroupId ?? null,
          sortOrder: message.sortOrder,
          createdAt: '2026-04-04T10:00:00.000Z',
        })),
      };
      nextEntryId += 1;
      entries.push(detail);
      return detail;
    },
    async appendEntryMessages() { throw new Error('not implemented'); },
    async updateEntryMetadata() { throw new Error('not implemented'); },
    async updateEntryCategory() { throw new Error('not implemented'); },
    async updateEntryLifecycleStatus() { throw new Error('not implemented'); },
    async getEntryDetail(entryId) {
      return entries.find((detail) => detail.entry.id === entryId) ?? null;
    },
    async listEntryDetailsByCategory(categoryId) {
      return entries.filter((detail) => detail.entry.categoryId === categoryId);
    },
    async searchEntryDetails() {
      return entries;
    },
    __entries: entries,
  };
}

function createContext({
  repository = createRepository(),
  catalogLoanRepository = createLoanRepository(),
  membershipRepository = createMembershipRepository(),
  auditRepository = createAuditRepository(),
  catalogLookupService,
  wikipediaBoardGameImportService,
  boardGameGeekCollectionImportService,
  coverTitleResolver,
  descriptionTranslator,
  externalImageDownloader,
  sendPrivateMessage,
  storageRepository,
  storageDefaultChatStore,
  createForumTopic,
  copyMessage,
  forwardMessage,
  sendMediaGroup,
  isAdmin = true,
  language = 'ca',
}: {
  repository?: CatalogRepository;
  catalogLoanRepository?: CatalogLoanRepository;
  membershipRepository?: MembershipAccessRepository;
  auditRepository?: AuditLogRepository;
  catalogLookupService?: CatalogLookupService;
  wikipediaBoardGameImportService?: WikipediaBoardGameImportService;
  boardGameGeekCollectionImportService?: BoardGameGeekCollectionImportService;
  coverTitleResolver?: (input: { imagePath: string; question: string; model: string }) => Promise<string>;
  descriptionTranslator?: (input: { description: string; model: string; targetLanguage: 'es' }) => Promise<string>;
  externalImageDownloader?: CatalogMediaExternalImageDownloader;
  sendPrivateMessage?: (telegramUserId: number, message: string, options?: TelegramReplyOptions) => Promise<void>;
  storageRepository?: StorageCategoryRepository;
  storageDefaultChatStore?: AppMetadataSessionStorage;
  createForumTopic?: TelegramCatalogAdminContext['runtime']['bot']['createForumTopic'];
  copyMessage?: TelegramCatalogAdminContext['runtime']['bot']['copyMessage'];
  forwardMessage?: TelegramCatalogAdminContext['runtime']['bot']['forwardMessage'];
  sendMediaGroup?: TelegramCatalogAdminContext['runtime']['bot']['sendMediaGroup'];
  isAdmin?: boolean;
  language?: 'ca' | 'es' | 'en';
} = {}) {
  const replies: Array<{ message: string; options?: TelegramReplyOptions | undefined }> = [];
  let currentSession: { flowKey: string; stepKey: string; data: Record<string, unknown> } | null = null;

  const context: TelegramCatalogAdminContext = {
    reply: async (message: string, options?: TelegramReplyOptions) => {
      replies.push({ message, ...(options ? { options } : {}) });
      return { message_id: replies.length };
    },
    runtime: {
      actor: {
        telegramUserId: 99,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin,
        permissions: [],
      },
      authorization: {
        authorize: (permissionKey: string) => ({ allowed: permissionKey === 'catalog.manage', permissionKey, reason: 'admin-override' }),
        can: (permissionKey: string) => permissionKey === 'catalog.manage',
      },
      session: {
        get current() {
          if (!currentSession) return null;
          return {
            key: 'telegram.session:1:99',
            flowKey: currentSession.flowKey,
            stepKey: currentSession.stepKey,
            data: currentSession.data,
            createdAt: '2026-04-04T10:00:00.000Z',
            updatedAt: '2026-04-04T10:00:00.000Z',
            expiresAt: '2026-04-05T10:00:00.000Z',
          } satisfies ConversationSessionRecord;
        },
        start: async ({ flowKey, stepKey, data = {} }: { flowKey: string; stepKey: string; data?: Record<string, unknown> }) => {
          currentSession = { flowKey, stepKey, data };
          return context.runtime.session.current!;
        },
        advance: async ({ stepKey, data }: { stepKey: string; data: Record<string, unknown> }) => {
          if (!currentSession) throw new Error('no session');
          currentSession = { flowKey: currentSession.flowKey, stepKey, data };
          return context.runtime.session.current!;
        },
        cancel: async () => {
          const hadSession = currentSession !== null;
          currentSession = null;
          return hadSession;
        },
      },
      chat: { kind: 'private', chatId: 1 },
      services: { database: { db: undefined as never } },
      bot: {
        publicName: 'Game Club Bot',
        clubName: 'Game Club',
        language,
        sendPrivateMessage: sendPrivateMessage ?? (async () => {}),
        downloadFile: async ({ destinationPath }) => {
          await writeFile(destinationPath, 'fake image');
        },
        editMessageText: async ({ messageId, text, options }) => {
          const index = messageId - 1;
          if (replies[index]) {
            replies[index] = { message: text, ...(options ? { options } : {}) };
          }
        },
        ...(createForumTopic ? { createForumTopic } : {}),
        ...(copyMessage ? { copyMessage } : {}),
        ...(forwardMessage ? { forwardMessage } : {}),
        ...(sendMediaGroup ? { sendMediaGroup } : {}),
      },
    },
    catalogRepository: repository,
    catalogLoanRepository,
    membershipRepository,
    auditRepository,
    ...(storageRepository ? { storageRepository } : {}),
    ...(storageDefaultChatStore ? { storageDefaultChatStore } : {}),
    ...(catalogLookupService ? { catalogLookupService } : {}),
    ...(wikipediaBoardGameImportService ? { wikipediaBoardGameImportService } : {}),
    ...(boardGameGeekCollectionImportService ? { boardGameGeekCollectionImportService } : {}),
    ...(coverTitleResolver ? { coverTitleResolver } : {}),
    ...(descriptionTranslator ? { descriptionTranslator } : {}),
    ...(externalImageDownloader ? { externalImageDownloader } : {}),
  };

  return { context, replies, getCurrentSession: () => currentSession };
}

test('handleTelegramCatalogAdminText opens the catalog admin menu', async () => {
  const { context, replies } = createContext();
  context.messageText = catalogAdminLabels.openMenu;

  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /No hi ha cap ítem de catàleg disponible ara mateix\./);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [
    ['Crear ítem', catalogAdminLabels.bulkCreate],
    ['Préstecs actius'],
    [catalogAdminLabels.listBoardGames, catalogAdminLabels.listBooks],
    [catalogAdminLabels.listRpgBooks, catalogAdminLabels.listExpansions],
    [catalogAdminLabels.searchByName, 'Importar col·lecció BGG'],
    [catalogAdminLabels.start, 'Ajuda'],
  ]);
});

test('handleTelegramCatalogAdminText accepts Spanish catalog action buttons', async () => {
  const { context, replies } = createContext({ language: 'es' });

  context.messageText = 'Catálogo';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /No hay ningún ítem de catálogo disponible ahora mismo\./);

  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [
    ['Crear ítem', 'Añadir múltiples'],
    ['Préstamos activos'],
    ['Listar juegos de mesa', 'Listar libros'],
    ['Listar libros RPG', 'Listar expansiones'],
    ['Buscar por nombre', 'Importar colección BGG'],
    ['Inicio', 'Ayuda'],
  ]);

  context.messageText = 'Listar juegos de mesa';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  context.messageText = 'Listar libros';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  context.messageText = 'Listar libros RPG';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  context.messageText = 'Listar expansiones';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  context.messageText = 'Buscar por nombre';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Escribe el nombre, o parte del nombre,/);
});

test('handleTelegramCatalogAdminText rejects BGG collection import for non-admin members', async () => {
  const { context, replies, getCurrentSession } = createContext({ isAdmin: false, language: 'es' });

  context.messageText = 'Importar colección BGG';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /solo administradores|administrador/i);
});

test('handleTelegramCatalogAdminText rejects bulk BGG update for non-admin members', async () => {
  const { context, replies } = createContext({ isAdmin: false, language: 'es' });

  context.messageText = '/update_bgg';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.match(replies.at(-1)?.message ?? '', /solo administradores|administrador/i);
});

test('handleTelegramCatalogAdminText accepts bulk BGG update while a catalog session is active', async () => {
  const { context, replies } = createContext({ language: 'es' });
  await context.runtime.session.start({ flowKey: 'catalog-admin-browse', stepKey: 'detail', data: { itemId: 99 } });

  context.messageText = '/update_bgg';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.equal(replies.length, 1);
  assert.match(replies[0]?.message ?? '', /<b>Actualización BGG completada<\/b>/);
  assert.match(replies[0]?.message ?? '', /No hay juegos de mesa ni expansiones activos/);
});

test('handleTelegramCatalogAdminText bulk updates stale BGG metadata with progress summary', async () => {
  const repository = createRepository({
    items: [
      {
        id: 2,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Old BGG Game',
        originalName: 'Old BGG Game',
        description: 'Manual description',
        language: 'ES',
        publisher: 'Manual Publisher',
        publicationYear: 2001,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: 10,
        playTimeMinutes: 60,
        externalRefs: { boardGameGeekId: '12' },
        metadata: { source: 'boardgamegeek', boardGameGeekId: '12', customFlag: true },
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
      {
        id: 3,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Fresh BGG Game',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: { boardGameGeekId: '13' },
        metadata: { source: 'boardgamegeek', boardGameGeekId: '13', averageWeight: 2.1 },
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
      {
        id: 4,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Manual Game',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
      {
        id: 5,
        familyId: null,
        groupId: null,
        itemType: 'expansion',
        displayName: 'Old BGG Expansion',
        originalName: 'Old BGG Expansion',
        description: 'Manual expansion description',
        language: null,
        publisher: 'Manual Expansion Publisher',
        publicationYear: 2005,
        playerCountMin: 1,
        playerCountMax: 5,
        recommendedAge: 10,
        playTimeMinutes: 90,
        externalRefs: { boardGameGeekId: '15' },
        metadata: { source: 'boardgamegeek', boardGameGeekId: '15' },
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
      {
        id: 6,
        familyId: null,
        groupId: null,
        itemType: 'book',
        displayName: 'BGG Book Should Be Ignored',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: { boardGameGeekId: '16' },
        metadata: { source: 'boardgamegeek', boardGameGeekId: '16' },
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const importCalls: string[] = [];
  const translationCalls: string[] = [];
  const wikipediaBoardGameImportService: WikipediaBoardGameImportService = {
    async importByTitle(title) {
      importCalls.push(title);
      const boardGameGeekId = title.includes('#15') ? '15' : '12';
      return {
        ok: true,
        draft: {
          familyId: null,
          groupId: null,
          itemType: title.includes('#15') ? 'expansion' : 'board-game',
          displayName: title,
          originalName: title,
          description: 'Imported description',
          language: null,
          publisher: 'Imported Publisher',
          publicationYear: 2020,
          playerCountMin: 1,
          playerCountMax: 5,
          recommendedAge: 12,
          playTimeMinutes: 120,
          externalRefs: {
            boardGameGeekId,
            boardGameGeekUrl: `https://boardgamegeek.com/boardgame/${boardGameGeekId}`,
          },
          metadata: {
            source: 'boardgamegeek',
            boardGameGeekId,
            boardGameGeekUrl: `https://boardgamegeek.com/boardgame/${boardGameGeekId}`,
            averageWeight: boardGameGeekId === '15' ? 3.1 : 2.4,
            averageRating: 7.5,
            usersRated: 1000,
            bestPlayerCounts: ['4'],
            recommendedPlayerCounts: ['3', '4'],
          },
        },
      };
    },
  };
  const { context, replies } = createContext({
    repository,
    wikipediaBoardGameImportService,
    language: 'es',
    descriptionTranslator: async (input) => {
      translationCalls.push(input.description);
      return 'No debería usarse';
    },
  });

  context.messageText = '/update_bgg';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.deepEqual(importCalls, ['Old BGG Expansion [API #15]', 'Old BGG Game [API #12]']);
  assert.deepEqual(translationCalls, []);
  assert.equal(replies.length, 1);
  assert.match(replies[0]?.message ?? '', /<b>Actualización BGG completada<\/b>/);
  assert.match(replies[0]?.message ?? '', /\[████████████\] 4\/4/);
  assert.match(replies[0]?.message ?? '', /actualizados 2/);
  assert.match(replies[0]?.message ?? '', /al día 1/);
  assert.match(replies[0]?.message ?? '', /sin BGG 1/);
  assert.match(replies[0]?.message ?? '', /errores 0/);

  const updatedGame = await repository.findItemById(2);
  assert.equal(updatedGame?.displayName, 'Old BGG Game');
  assert.equal(updatedGame?.description, 'Manual description');
  assert.equal(updatedGame?.publisher, 'Manual Publisher');
  assert.equal(updatedGame?.publicationYear, 2001);
  assert.deepEqual(updatedGame?.metadata, {
    source: 'boardgamegeek',
    boardGameGeekId: '12',
    customFlag: true,
    boardGameGeekUrl: 'https://boardgamegeek.com/boardgame/12',
    averageWeight: 2.4,
    averageRating: 7.5,
    usersRated: 1000,
    bestPlayerCounts: ['4'],
    recommendedPlayerCounts: ['3', '4'],
  });
  const updatedExpansion = await repository.findItemById(5);
  assert.equal(updatedExpansion?.publisher, 'Manual Expansion Publisher');
  assert.equal((updatedExpansion?.metadata as Record<string, unknown> | null)?.averageWeight, 3.1);
});

test('handleTelegramCatalogAdminText imports a BGG collection and refreshes existing items', async () => {
  const repository = createRepository({
    items: [
      {
        id: 2,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Before Pending',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: { boardGameGeekId: '12' },
        metadata: { source: 'boardgamegeek', boardGameGeekId: '12' },
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
      {
        id: 3,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Root old',
        originalName: 'Root old',
        description: 'old description',
        language: null,
        publisher: 'Old Publisher',
        publicationYear: 2017,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: 8,
        playTimeMinutes: 60,
        externalRefs: { boardGameGeekId: '101', boardGameGeekUrl: 'https://boardgamegeek.com/boardgame/101' },
        metadata: { source: 'boardgamegeek', boardGameGeekId: '101' },
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
      {
        id: 4,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Next Pending',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: { boardGameGeekId: '14' },
        metadata: { source: 'boardgamegeek', boardGameGeekId: '14' },
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
      {
        id: 5,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Fresh BGG Game',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: { boardGameGeekId: '15' },
        metadata: { source: 'boardgamegeek', boardGameGeekId: '15', averageWeight: 2.1 },
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const auditRepository = createAuditRepository();
  const collectionCalls: string[] = [];
  const boardGameGeekCollectionImportService: BoardGameGeekCollectionImportService = {
    async listCollections(username) {
      return {
        ok: true,
        username,
        collections: [{ key: 'owned' }],
        canWriteCollectionName: true,
      };
    },
    async importCollection({ username, collectionKey }) {
      collectionCalls.push(`${username}:${collectionKey ?? 'manual'}`);
      return {
        ok: true,
        username,
        collectionKey: collectionKey ?? 'owned',
        totalCount: 2,
        items: [
          {
            familyId: null,
            groupId: null,
            itemType: 'board-game',
            displayName: 'Root',
            originalName: 'Root',
            description: 'Woodland war game',
            language: null,
            publisher: 'Leder Games',
            publicationYear: 2018,
            playerCountMin: 2,
            playerCountMax: 4,
            recommendedAge: 10,
            playTimeMinutes: 90,
            externalRefs: { boardGameGeekId: '101', boardGameGeekUrl: 'https://boardgamegeek.com/boardgame/101' },
            metadata: { source: 'boardgamegeek', boardGameGeekId: '101', imageUrl: 'https://example.com/root.jpg' },
          },
          {
            familyId: null,
            groupId: null,
            itemType: 'expansion',
            displayName: 'Riverfolk Expansion',
            originalName: 'Riverfolk Expansion',
            description: 'Root expansion',
            language: null,
            publisher: 'Leder Games',
            publicationYear: 2018,
            playerCountMin: 1,
            playerCountMax: 6,
            recommendedAge: 10,
            playTimeMinutes: 90,
            externalRefs: { boardGameGeekId: '202', boardGameGeekUrl: 'https://boardgamegeek.com/boardgame/202' },
            metadata: { source: 'boardgamegeek', boardGameGeekId: '202', imageUrl: 'https://example.com/riverfolk.jpg' },
          },
        ],
        errors: [],
      };
    },
    async importByUsername(username) {
      return {
        ok: true,
        username,
        collectionKey: 'owned',
        totalCount: 2,
        items: [
          {
            familyId: null,
            groupId: null,
            itemType: 'board-game',
            displayName: 'Root',
            originalName: 'Root',
            description: 'Woodland war game',
            language: null,
            publisher: 'Leder Games',
            publicationYear: 2018,
            playerCountMin: 2,
            playerCountMax: 4,
            recommendedAge: 10,
            playTimeMinutes: 90,
            externalRefs: { boardGameGeekId: '101', boardGameGeekUrl: 'https://boardgamegeek.com/boardgame/101' },
            metadata: { source: 'boardgamegeek', boardGameGeekId: '101', imageUrl: 'https://example.com/root.jpg' },
          },
          {
            familyId: null,
            groupId: null,
            itemType: 'expansion',
            displayName: 'Riverfolk Expansion',
            originalName: 'Riverfolk Expansion',
            description: 'Root expansion',
            language: null,
            publisher: 'Leder Games',
            publicationYear: 2018,
            playerCountMin: 1,
            playerCountMax: 6,
            recommendedAge: 10,
            playTimeMinutes: 90,
            externalRefs: { boardGameGeekId: '202', boardGameGeekUrl: 'https://boardgamegeek.com/boardgame/202' },
            metadata: { source: 'boardgamegeek', boardGameGeekId: '202', imageUrl: 'https://example.com/riverfolk.jpg' },
          },
        ],
        errors: [],
      };
    },
  };
  const { context, replies, getCurrentSession } = createContext({
    repository,
    auditRepository,
    boardGameGeekCollectionImportService,
  });

  context.messageText = catalogAdminLabels.importBggCollection;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.flowKey, 'catalog-admin-bgg-collection-import');
  assert.equal(getCurrentSession()?.stepKey, 'bgg-username');

  context.messageText = 'ruben';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  context.messageText = 'Propia';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.deepEqual(collectionCalls, ['ruben:owned']);
  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /ruben/);
  assert.match(replies.at(-1)?.message ?? '', /Creats:\s*1/i);
  assert.match(replies.at(-1)?.message ?? '', /Actualitzats:\s*1/i);
  assert.equal((await repository.findItemById(3))?.displayName, 'Root');
  assert.equal((await repository.findItemById(3))?.publisher, 'Leder Games');
  assert.equal((await repository.findItemById(3))?.recommendedAge, 10);
  const importedExpansion = (await repository.listItems({ includeDeactivated: true }))
    .find((item) => item.externalRefs?.boardGameGeekId === '202');
  assert.equal(importedExpansion?.itemType, 'expansion');
  assert.equal(importedExpansion?.displayName, 'Riverfolk Expansion');
  assert.equal(auditRepository.__events.filter((event) => event.actionKey === 'catalog.item.updated').length, 1);
  assert.equal(auditRepository.__events.filter((event) => event.actionKey === 'catalog.item.created').length, 1);
});

test('handleTelegramCatalogAdminText shows expansion counts in the compact initial index', async () => {
  const repository = createRepository({
    items: [
      {
        id: 7,
        familyId: null,
        groupId: null,
        itemType: 'expansion',
        displayName: 'Riverfolk Expansion',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: { boardGameGeekId: '202' },
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const { context, replies } = createContext({ repository, language: 'es' });

  context.messageText = 'Listar expansiones';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.match(replies.at(-1)?.message ?? '', /R - 1 artículo/);
  assert.match(replies.at(-1)?.message ?? '', /1 juego de mesa/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Riverfolk Expansion/);
});

test('handleTelegramCatalogAdminText lets approved non-admin members open the catalog menu and start creation', async () => {
  const { context, replies, getCurrentSession } = createContext({ isAdmin: false, language: 'es' });

  context.messageText = 'Catálogo';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /No hay ningún ítem de catálogo disponible ahora mismo\./);

  context.messageText = 'Crear ítem';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.flowKey, 'catalog-admin-create');
  assert.equal(getCurrentSession()?.stepKey, 'item-type');
});

test('handleTelegramCatalogAdminText starts bulk create flow', async () => {
  const { context, getCurrentSession } = createContext();

  context.messageText = catalogAdminLabels.bulkCreate;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.flowKey, 'catalog-admin-bulk-create');
  assert.equal(getCurrentSession()?.stepKey, 'bulk-item-type');
});

test('handleTelegramCatalogAdminText runs bulk create and sends summary as private message', async () => {
  const privateMessages: string[] = [];
  const privateMessageOptions: Array<TelegramReplyOptions | undefined> = [];
  const auditRepository = createAuditRepository();
  const wikipediaBoardGameImportService: WikipediaBoardGameImportService = {
    async importByTitle(title) {
      return {
        ok: true,
        draft: {
          familyId: null,
          groupId: null,
          itemType: 'board-game',
          displayName: title,
          originalName: title,
          description: null,
          language: null,
          publisher: null,
          publicationYear: 2024,
          playerCountMin: null,
          playerCountMax: null,
          recommendedAge: null,
          playTimeMinutes: null,
          externalRefs: {},
          metadata: { source: 'wikipedia', wikipediaUrl: null },
        },
      };
    },
  };

  const { context, replies, getCurrentSession } = createContext({
    wikipediaBoardGameImportService,
    auditRepository,
    sendPrivateMessage: async (_telegramUserId, message, options) => {
      privateMessages.push(message);
      privateMessageOptions.push(options);
    },
  });

  context.messageText = catalogAdminLabels.bulkCreate;
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  context.messageText = catalogAdminLabels.typeBoardGame;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'bulk-item-names');

  context.messageText = 'Root';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /Càrrega múltiple/);

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(privateMessages.length, 1);
  const summaryMessage = privateMessages[0];
  assert.ok(summaryMessage);
  assert.match(summaryMessage, /<b>Resum de la càrrega múltiple<\/b>/);
  assert.match(summaryMessage, /Creats \(1\)/);
  assert.match(summaryMessage, /- Root/);
  assert.doesNotMatch(summaryMessage, /- \.\.\./);
  assert.deepEqual(privateMessageOptions[0]?.replyKeyboard, [[{ text: catalogAdminLabels.bulkCreateComplete, semanticRole: 'success' }]]);
  assert.equal(auditRepository.__events.some((event) => event.actionKey === 'catalog.item.created'), true);

  context.messageText = catalogAdminLabels.bulkCreateComplete;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Procés completat/);
});

test('handleTelegramCatalogAdminText offers unresolved bulk names as copyable text with manual create button', async () => {
  const privateMessages: string[] = [];
  const privateMessageOptions: Array<TelegramReplyOptions | undefined> = [];
  const wikipediaBoardGameImportService: WikipediaBoardGameImportService = {
    async importByTitle() {
      return {
        ok: false,
        error: { type: 'not-found', message: 'not found' },
      };
    },
  };
  const { context, replies, getCurrentSession } = createContext({
    wikipediaBoardGameImportService,
    sendPrivateMessage: async (_telegramUserId, message, options) => {
      privateMessages.push(message);
      privateMessageOptions.push(options);
    },
  });

  context.messageText = catalogAdminLabels.bulkCreate;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.typeBoardGame;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Unknown Game';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  await new Promise((resolve) => setTimeout(resolve, 20));
  const summaryMessage = privateMessages[0];
  assert.ok(summaryMessage);
  assert.match(summaryMessage, /Per revisar manualment/);
  assert.match(summaryMessage, /<code>Unknown Game<\/code>/);
  assert.doesNotMatch(summaryMessage, /- \.\.\./);
  assert.equal(privateMessageOptions[0]?.parseMode, 'HTML');
  assert.deepEqual(privateMessageOptions[0]?.replyKeyboard, [
    [{ text: catalogAdminLabels.bulkCreateManualButton, semanticRole: 'primary' }],
    [{ text: catalogAdminLabels.bulkCreateComplete, semanticRole: 'success' }],
  ]);
  assert.equal(getCurrentSession()?.flowKey, 'catalog-admin-bulk-create');
  assert.equal(getCurrentSession()?.stepKey, 'bulk-manual-choice');

  context.messageText = catalogAdminLabels.bulkCreateManualButton;
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.equal(getCurrentSession()?.flowKey, 'catalog-admin-create');
  assert.equal(getCurrentSession()?.stepKey, 'display-name');
  assert.match(replies.at(-1)?.message ?? '', /Escriu el nom de l'ítem/);
});

test('handleTelegramCatalogAdminText accepts Spanish item type buttons when creating', async () => {
  const { context, getCurrentSession, replies } = createContext({ language: 'es' });

  context.messageText = 'Crear ítem';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard, [
    ['Juego de mesa'],
    ['Libro', 'Libro RPG'],
    ['Accesorio'],
    [dangerButton('/cancel')],
  ]);
  context.messageText = 'Juego de mesa';

  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'display-name');
  assert.match(replies.at(-1)?.message ?? '', /Escribe el nombre del ítem para buscar datos automáticamente en la API\./);
  assert.deepEqual(replies.at(-2)?.options?.replyKeyboard, [
    ['Juego de mesa'],
    ['Libro', 'Libro RPG'],
    ['Accesorio'],
    [dangerButton('/cancel')],
  ]);
});

test('handleTelegramCatalogAdminText creates a board game and opens edit mode immediately', async () => {
  const repository = createRepository({
    families: [
      {
        id: 7,
        slug: 'arkham-horror',
        displayName: 'Arkham Horror',
        description: null,
        familyKind: 'board-game-line',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
    ],
    groups: [
      {
        id: 11,
        familyId: 7,
        slug: 'base-line',
        displayName: 'Linia base',
        description: null,
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
    ],
  });
  const auditRepository = createAuditRepository();
  let importCalls: string[] = [];
  const wikipediaBoardGameImportService: WikipediaBoardGameImportService = {
    async importByTitle(title) {
      importCalls.push(title);
      return {
        ok: true,
        draft: {
          familyId: null,
          groupId: null,
          itemType: 'board-game',
          displayName: 'Root',
          originalName: 'Root',
          description: null,
          language: null,
          publisher: 'Dire Wolf',
          publicationYear: 2024,
          playerCountMin: 1,
          playerCountMax: 4,
          recommendedAge: null,
          playTimeMinutes: 60,
          externalRefs: {
            wikipediaUrl: 'https://en.wikipedia.org/wiki/Root_(board_game)',
          },
          metadata: {
            source: 'wikipedia',
            wikipediaUrl: 'https://en.wikipedia.org/wiki/Root_(board_game)',
            wikidataId: 'Q36910373',
            designers: ['Cole Wehrle'],
            illustrators: ['Kyle Ferrin'],
            genres: ['Board game'],
            notes: [],
            editionType: null,
          },
        },
      };
    },
  };
  const { context, getCurrentSession, replies } = createContext({ repository, auditRepository, wikipediaBoardGameImportService });

  context.messageText = catalogAdminLabels.create;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.typeBoardGame;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Escriu el nom de l'ítem per buscar dades automàticament a l'API/);

  context.messageText = 'Root';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.match(replies.at(-3)?.message ?? '', /Buscant.*API/);
  assert.match(replies.at(-2)?.message ?? '', /Importació des de l'API completada/);
  assert.match(replies.at(-1)?.message ?? '', /He importat dades externes per Root/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Resum de l'ítem:<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Nom:<\/b>/);
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.[0]?.[0], catalogAdminLabels.editFieldDisplayName);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');
  assert.deepEqual(importCalls, ['Root']);

  context.messageText = catalogAdminLabels.editFieldPublisher;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Devir';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  context.messageText = catalogAdminLabels.confirmEdit;
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /Ítem de catàleg actualitzat correctament: Root/);
  const created = await repository.findItemById(1);
  assert.equal(created?.displayName, 'Root');
  assert.equal(created?.itemType, 'board-game');
  assert.equal(created?.familyId, null);
  assert.equal(created?.groupId, null);
  assert.equal(created?.publisher, 'Devir');
  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'catalog.item.updated');
});

test('handleTelegramCatalogAdminMessage detects a catalog title from a cover image while creating', async () => {
  const repository = createRepository();
  const auditRepository = createAuditRepository();
  const importCalls: string[] = [];
  const wikipediaBoardGameImportService: WikipediaBoardGameImportService = {
    async importByTitle(title) {
      importCalls.push(title);
      return {
        ok: true,
        draft: {
          familyId: null,
          groupId: null,
          itemType: 'board-game',
          displayName: title,
          originalName: title,
          description: `${title} description`,
          language: null,
          publisher: null,
          publicationYear: null,
          playerCountMin: null,
          playerCountMax: null,
          recommendedAge: null,
          playTimeMinutes: null,
          externalRefs: {},
          metadata: { source: 'boardgamegeek' },
        },
      };
    },
  };
  const resolverCalls: Array<{ imagePath: string; question: string; model: string }> = [];
  const { context, replies, getCurrentSession } = createContext({
    repository,
    auditRepository,
    wikipediaBoardGameImportService,
    coverTitleResolver: async (input) => {
      resolverCalls.push(input);
      return '> build · gpt-5.4-mini\n\nNombre: "Root"';
    },
  });

  context.messageText = catalogAdminLabels.create;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.typeBoardGame;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = undefined;
  context.messageMedia = {
    attachmentKind: 'photo',
    fileId: 'telegram-photo-file-id',
    messageId: 44,
    originalFileName: null,
    mimeType: null,
  };

  assert.equal(await handleTelegramCatalogAdminMessage(context), true);

  assert.equal(resolverCalls.length, 1);
  assert.match(resolverCalls[0]?.imagePath ?? '', /cover-\d+\.jpg$/);
  assert.match(resolverCalls[0]?.question ?? '', /nom complet visible/i);
  assert.equal(resolverCalls[0]?.model, 'gpt-5.4');
  assert.deepEqual(importCalls, ['Root']);
  assert.ok(replies.some((reply) => /Nom detectat: Root/.test(reply.message)));
  assert.equal(getCurrentSession()?.stepKey, 'cover-confirm');
  assert.match(replies.at(-1)?.message ?? '', /guardar aquesta portada/);
  assert.equal((await repository.findItemById(1))?.displayName, 'Root');
});

test('handleTelegramCatalogAdminText localizes the wikipedia import handoff', async () => {
  const repository = createRepository();
  const wikipediaBoardGameImportService: WikipediaBoardGameImportService = {
    async importByTitle() {
      return {
        ok: true,
        draft: {
          familyId: null,
          groupId: null,
          itemType: 'board-game',
          displayName: 'A & B',
          originalName: null,
          description: null,
          language: null,
          publisher: null,
          publicationYear: null,
          playerCountMin: null,
          playerCountMax: null,
          recommendedAge: null,
          playTimeMinutes: null,
          externalRefs: null,
          metadata: null,
        },
      };
    },
  };
  const { context, replies, getCurrentSession } = createContext({ repository, wikipediaBoardGameImportService, language: 'es' });

  context.messageText = catalogAdminLabels.create;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Juego de mesa';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'A & B';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.equal(getCurrentSession()?.stepKey, 'select-field');
  assert.match(replies.at(-2)?.message ?? '', /Importación desde la API completada/);
  assert.match(replies.at(-1)?.message ?? '', /He importado datos externos para A &amp; B\./);
  assert.match(replies.at(-1)?.message ?? '', /Elige un campo del teclado o guarda los cambios cuando hayas terminado\./);
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.[0]?.[0], 'Nombre visible');
  assert.equal(buttonText(replies.at(-1)?.options?.replyKeyboard?.at(-2)?.[0] as string | { text: string }), 'Guardar cambios');
});

test('handleTelegramCatalogAdminText shows a URL fallback when Wikipedia import fails', async () => {
  const repository = createRepository();
  const wikipediaBoardGameImportService: WikipediaBoardGameImportService = {
    async importByTitle() {
      return {
        ok: false,
        error: { type: 'connection', message: 'down' },
      };
    },
  };
  const { context, replies, getCurrentSession } = createContext({ repository, wikipediaBoardGameImportService });

  context.messageText = catalogAdminLabels.create;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.typeBoardGame;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Unknown Game';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.match(replies.at(-2)?.message ?? '', /Buscant.*API/);
  assert.match(replies.at(-1)?.message ?? '', /Enganxa una referència manual vàlida/);
  assert.equal(buttonText(replies.at(-1)?.options?.replyKeyboard?.[0]?.[0] as string | { text: string }), catalogAdminLabels.skipLookupImport);
  assert.equal(getCurrentSession()?.stepKey, 'wikipedia-url');

  context.messageText = catalogAdminLabels.skipLookupImport;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');
  context.messageText = catalogAdminLabels.editFieldFamily;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'family');
  assert.match(replies.at(-1)?.message ?? '', /Escriu la família del joc de taula/);
});

test('handleTelegramCatalogAdminText retries Wikipedia import when the user pastes a full url', async () => {
  const repository = createRepository();
  const importCalls: string[] = [];
  const wikipediaBoardGameImportService: WikipediaBoardGameImportService = {
    async importByTitle(title) {
      importCalls.push(title);
      if (title === 'Root (board game)') {
        return {
          ok: true,
          draft: {
            familyId: null,
            groupId: null,
            itemType: 'board-game',
            displayName: 'Root',
            originalName: 'Root',
            description: null,
            language: null,
            publisher: 'Dire Wolf',
            publicationYear: 2024,
            playerCountMin: 2,
            playerCountMax: 4,
            recommendedAge: 13,
            playTimeMinutes: 90,
            externalRefs: {
              wikipediaUrl: 'https://en.wikipedia.org/wiki/Root_(board_game)',
            },
            metadata: {
              source: 'wikipedia',
              wikipediaUrl: 'https://en.wikipedia.org/wiki/Root_(board_game)',
            },
          },
        };
      }
      return { ok: false, error: { type: 'not-found', message: 'No s ha trobat el joc a Wikipedia.' } };
    },
  };
  const { context, replies, getCurrentSession } = createContext({ repository, wikipediaBoardGameImportService });

  context.messageText = catalogAdminLabels.create;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.typeBoardGame;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Unknown Game';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  context.messageText = 'https://en.wikipedia.org/wiki/Root_(board_game)';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.deepEqual(importCalls, ['Unknown Game', 'Root (board game)']);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');
  assert.match(replies.at(-1)?.message ?? '', /He importat dades externes per Root/);
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.[0]?.[0], catalogAdminLabels.editFieldDisplayName);
});

test('handleTelegramCatalogAdminText lets the user choose among ambiguous Wikipedia candidates', async () => {
  const repository = createRepository();
  const importCalls: string[] = [];
  const wikipediaBoardGameImportService: WikipediaBoardGameImportService = {
    async importByTitle(title) {
      importCalls.push(title);
      if (title === 'Azul (board game)') {
        return {
          ok: true,
          draft: {
            familyId: null,
            groupId: null,
            itemType: 'board-game',
            displayName: 'Azul',
            originalName: 'Azul',
            description: null,
            language: null,
            publisher: 'Plan B Games',
            publicationYear: 2017,
            playerCountMin: 2,
            playerCountMax: 4,
            recommendedAge: 8,
            playTimeMinutes: 45,
            externalRefs: {
              wikipediaUrl: 'https://en.wikipedia.org/wiki/Azul_(board_game)',
            },
            metadata: {
              source: 'wikipedia',
              wikipediaUrl: 'https://en.wikipedia.org/wiki/Azul_(board_game)',
            },
          },
        };
      }

      return {
        ok: false,
        error: {
          type: 'ambiguous',
          message: 'He trobat diverses pàgines candidates a Wikipedia.',
          candidates: ['Azul', 'Azul (board game)', 'Azul: Summer Pavilion'],
        },
      };
    },
  };
  const { context, replies, getCurrentSession } = createContext({ repository, wikipediaBoardGameImportService });

  context.messageText = catalogAdminLabels.create;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.typeBoardGame;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Azul';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.equal(getCurrentSession()?.stepKey, 'wikipedia-candidate-choice');
  assert.match(replies.at(-1)?.message ?? '', /He trobat diverses pàgines candidates a Wikipedia/);
  assert.match(replies.at(-1)?.message ?? '', /Azul \(board game\)/);
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.[0]?.includes('Azul'), true);
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.flat().map((button) => buttonText(button as string | { text: string })).includes('Azul (board game)'), true);
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.flat().map((button) => buttonText(button as string | { text: string })).includes(catalogAdminLabels.skipLookupImport), true);

  context.messageText = 'Azul (board game)';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.deepEqual(importCalls, ['Azul', 'Azul (board game)']);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');
  assert.match(replies.at(-1)?.message ?? '', /He importat dades externes per Azul/);
});

test('handleTelegramCatalogAdminText creates a regular book through lookup first and then family by name', async () => {
  const repository = createRepository({
    families: [
      {
        id: 1,
        slug: 'mundodisco',
        displayName: 'Mundodisco',
        description: null,
        familyKind: 'generic-line',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
    ],
    items: [
      {
        id: 8,
        familyId: 1,
        groupId: null,
        itemType: 'book',
        displayName: 'Guards! Guards!',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const catalogLookupService: CatalogLookupService = {
    async search(): Promise<CatalogLookupCandidate[]> {
      return [
        {
          source: 'open-library',
          sourceId: '/works/OL999W',
          title: 'El color de la magia',
          summary: 'Terry Pratchett · 1983',
          importedData: {
            originalName: 'The Colour of Magic',
            description: null,
            language: 'SPA',
            publisher: 'Debolsillo',
            publicationYear: 1983,
            externalRefs: {
              openLibraryKey: '/works/OL999W',
              openLibraryUrl: 'https://openlibrary.org/works/OL999W',
            },
            metadata: {
              source: 'open-library',
              author: 'Terry Pratchett',
            },
          },
        },
      ];
    },
  };
  const { context, replies, getCurrentSession } = createContext({ repository, catalogLookupService });

  context.messageText = catalogAdminLabels.create;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.[1]?.[0], catalogAdminLabels.typeBook);

  context.messageText = catalogAdminLabels.typeBook;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'El nom de la rosa';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.equal(getCurrentSession()?.stepKey, 'lookup-choice');
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.[0]?.[0], 'El color de la magia');

  context.messageText = 'El color de la magia';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'lookup-title-choice');

  context.messageText = "Fer servir el títol de l'API";
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.flat().includes('Família'), true);

  context.messageText = 'Família';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'family');
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.[0]?.[0], 'Mundodisco');

  context.messageText = 'Mundodisco';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');

  context.messageText = catalogAdminLabels.editFieldGroup;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'group');

  context.messageText = catalogAdminLabels.noGroup;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.confirmCreate;
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.equal(getCurrentSession(), null);
  const created = await repository.findItemById(9);
  assert.equal(created?.itemType, 'book');
  assert.equal(created?.displayName, 'El color de la magia');
  assert.equal(created?.familyId, 1);
  assert.equal(created?.publisher, 'Debolsillo');
});

test('handleTelegramCatalogAdminText offers Open Library matches for rpg books and imports the selected one on confirmation', async () => {
  const lookupCalls: Array<{ itemType: string; query: string }> = [];
  const catalogLookupService: CatalogLookupService = {
    async search(input) {
      lookupCalls.push(input);
      return [
        {
          source: 'open-library',
          sourceId: '/works/OL123W',
          title: 'Player\'s Handbook',
          summary: 'Wizards RPG Team · Wizards of the Coast · 2024',
          importedData: {
            originalName: 'Player\'s Handbook: 2024 Edition',
            description: null,
            language: 'ENG',
            publisher: 'Wizards of the Coast',
            publicationYear: 2024,
            externalRefs: {
              openLibraryKey: '/works/OL123W',
              openLibraryUrl: 'https://openlibrary.org/works/OL123W',
            },
            metadata: {
              source: 'open-library',
              author: 'Wizards RPG Team',
            },
          },
        },
        {
          source: 'open-library',
          sourceId: '/works/OL456W',
          title: 'Player\'s Handbook Alt',
          summary: 'Alternate · 2014',
          importedData: {
            originalName: 'Player\'s Handbook Alt',
            description: null,
            language: 'ENG',
            publisher: 'Alternate Publisher',
            publicationYear: 2014,
            externalRefs: { openLibraryKey: '/works/OL456W', openLibraryUrl: 'https://openlibrary.org/works/OL456W' },
            metadata: { source: 'open-library' },
          },
        },
      ];
    },
  };
  const { context, replies, getCurrentSession } = createContext({ catalogLookupService });

  context.messageText = catalogAdminLabels.create;
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.typeRpgBook;
  await handleTelegramCatalogAdminText(context);
  context.messageText = 'Manual del jugador (2024)';
  await handleTelegramCatalogAdminText(context);

  assert.deepEqual(lookupCalls, [{ itemType: 'rpg-book', query: 'Manual del jugador (2024)' }]);
  assert.equal(getCurrentSession()?.stepKey, 'lookup-choice');
  assert.match(replies.at(-1)?.message ?? '', /He trobat aquestes coincidències/);
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.[0]?.[0], 'Player\'s Handbook');

  context.messageText = 'Player\'s Handbook';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'lookup-title-choice');
  assert.match(replies.at(-1)?.message ?? '', /no coincideix exactament/);

  context.messageText = 'Quedar-me amb el meu títol';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.flat().includes('Família'), true);

  context.messageText = 'Família';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'family');
  context.messageText = 'Dungeons and Dragons 5';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');
  context.messageText = catalogAdminLabels.editFieldGroup;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'group');
  context.messageText = catalogAdminLabels.noGroup;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.keepCurrent;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.confirmCreate;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession(), null);
  assert.match(replies.at(-1)?.message ?? '', /Ítem de catàleg creat correctament: Manual del jugador \(2024\)/);
});

test('handleTelegramCatalogAdminText lets lookup results be refined by author text', async () => {
  const lookupCalls: Array<{ itemType: string; query: string; author?: string }> = [];
  const catalogLookupService: CatalogLookupService = {
    async search(input) {
      lookupCalls.push(input);
      if (!input.author) {
        return [
          {
            source: 'open-library',
            sourceId: '/works/OL1W',
            title: 'The Very Hungry Caterpillar',
            summary: 'Eric Carle · 1969',
            importedData: {
              originalName: 'The Very Hungry Caterpillar',
              description: null,
              language: 'ENG',
              publisher: 'World Publishing',
              publicationYear: 1969,
              externalRefs: { openLibraryKey: '/works/OL1W', openLibraryUrl: 'https://openlibrary.org/works/OL1W' },
              metadata: { source: 'open-library', author: 'Eric Carle' },
            },
          },
        ];
      }
      return [
        {
          source: 'open-library',
          sourceId: '/works/OLEricW',
          title: 'Eric',
          summary: 'Terry Pratchett · 1990',
          importedData: {
            originalName: 'Eric',
            description: null,
            language: 'ENG',
            publisher: 'Victor Gollancz',
            publicationYear: 1990,
            externalRefs: { openLibraryKey: '/works/OLEricW', openLibraryUrl: 'https://openlibrary.org/works/OLEricW' },
            metadata: { source: 'open-library', author: 'Terry Pratchett' },
          },
        },
      ];
    },
  };
  const repository = createRepository();
  const { context, getCurrentSession, replies } = createContext({ repository, catalogLookupService });

  context.messageText = catalogAdminLabels.create;
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.typeBook;
  await handleTelegramCatalogAdminText(context);
  context.messageText = 'Eric';
  await handleTelegramCatalogAdminText(context);

  assert.equal(getCurrentSession()?.stepKey, 'lookup-choice');
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.at(-3)?.[0], catalogAdminLabels.refineLookupByAuthor);

  context.messageText = 'Terry Pratchett';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.deepEqual(lookupCalls, [
    { itemType: 'book', query: 'Eric' },
    { itemType: 'book', query: 'Eric', author: 'Terry Pratchett' },
  ]);
  assert.equal(getCurrentSession()?.stepKey, 'lookup-choice');
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.[0]?.[0], 'Eric');
});

test('handleTelegramCatalogAdminText creates an rpg book with minimum fields when Open Library is skipped', async () => {
  const repository = createRepository();
  const catalogLookupService: CatalogLookupService = {
    async search(): Promise<CatalogLookupCandidate[]> {
      return [
        {
          source: 'open-library',
          sourceId: '/works/OL123W',
          title: 'Player\'s Handbook',
          summary: 'Wizards RPG Team · Wizards of the Coast · 2024',
          importedData: {
            originalName: 'Player\'s Handbook',
            description: null,
            language: 'ENG',
            publisher: 'Wizards of the Coast',
            publicationYear: 2024,
            externalRefs: { openLibraryKey: '/works/OL123W', openLibraryUrl: 'https://openlibrary.org/works/OL123W' },
            metadata: { source: 'open-library' },
          },
        },
      ];
    },
  };
  const { context, getCurrentSession } = createContext({ repository, catalogLookupService });

  context.messageText = catalogAdminLabels.create;
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.typeRpgBook;
  await handleTelegramCatalogAdminText(context);
  context.messageText = 'Manual del jugador';
  await handleTelegramCatalogAdminText(context);
  context.messageText = 'No importar dades';
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.editFieldFamily;

  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'family');

  context.messageText = catalogAdminLabels.noFamily;

  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');
  context.messageText = catalogAdminLabels.editFieldGroup;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'group');
  context.messageText = catalogAdminLabels.noGroup;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.confirmCreate;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession(), null);

  const created = await repository.findItemById(1);
  assert.equal(created?.displayName, 'Manual del jugador');
  assert.equal(created?.originalName, null);
  assert.equal(created?.publisher, null);
  assert.equal(created?.externalRefs, null);
});

test('handleTelegramCatalogAdminText lets rpg books pick a popular family or create a new one by name', async () => {
  const repository = createRepository({
    families: [
      {
        id: 3,
        slug: 'dungeons-and-dragons-5',
        displayName: 'Dungeons and Dragons 5',
        description: null,
        familyKind: 'rpg-line',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
      {
        id: 4,
        slug: 'call-of-cthulhu',
        displayName: 'Call of Cthulhu',
        description: null,
        familyKind: 'rpg-line',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
    ],
    items: [
      {
        id: 20,
        familyId: 3,
        groupId: null,
        itemType: 'rpg-book',
        displayName: 'Players Handbook',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
      {
        id: 21,
        familyId: 3,
        groupId: null,
        itemType: 'rpg-book',
        displayName: 'Monster Manual',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
      {
        id: 22,
        familyId: 4,
        groupId: null,
        itemType: 'rpg-book',
        displayName: 'Keeper Rulebook',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const catalogLookupService: CatalogLookupService = {
    async search() {
      return [];
    },
  };
  const { context, replies, getCurrentSession } = createContext({ repository, catalogLookupService });

  context.messageText = catalogAdminLabels.create;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.typeRpgBook;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Dungeon Master Guide';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.match(replies.at(-1)?.message ?? '', /Camp actualitzat\. Tria un altre camp o guarda els canvis\./);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');

  context.messageText = catalogAdminLabels.editFieldFamily;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Escriu o tria una família/);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard?.[0], ['Dungeons and Dragons 5', 'Call of Cthulhu']);
  assert.equal(buttonText(replies.at(-1)?.options?.replyKeyboard?.at(-2)?.[0] as string | { text: string }), 'Sense família');

  context.messageText = 'Dungeons and Dragons 5';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');

  context.messageText = catalogAdminLabels.editFieldGroup;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'group');

  context.messageText = catalogAdminLabels.noGroup;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.confirmCreate;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession(), null);

  const createdWithExistingFamily = (await repository.listItems({ includeDeactivated: true }))
    .find((item) => item.displayName === 'Dungeon Master Guide');
  assert.equal(createdWithExistingFamily?.familyId, 3);
  assert.equal(createdWithExistingFamily?.groupId, null);

  context.messageText = catalogAdminLabels.create;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.typeRpgBook;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Xanathar Guide';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.editFieldFamily;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Shadowdark RPG';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');

  context.messageText = catalogAdminLabels.editFieldGroup;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'group');

  context.messageText = catalogAdminLabels.noGroup;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.skipOptional;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = catalogAdminLabels.confirmCreate;
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  const families = await repository.listFamilies();
  const createdFamily = families.find((family) => family.displayName === 'Shadowdark RPG');
  assert.ok(createdFamily);
  assert.equal(createdFamily.familyKind, 'rpg-line');
  assert.equal(getCurrentSession(), null);
});

test('handleTelegramCatalogAdminCallback edits items through a field menu and deactivates them afterwards', async () => {
  const repository = createRepository({
    items: [
      {
        id: 3,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Root',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const auditRepository = createAuditRepository();
  const { context, replies } = createContext({ repository, auditRepository });

  context.callbackData = `${catalogAdminCallbackPrefixes.edit}3`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  delete context.callbackData;
  assert.match(replies.at(-1)?.message ?? '', /Tria un camp del teclat o guarda els canvis quan hagis acabat/);

  context.messageText = catalogAdminLabels.editFieldDisplayName;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Root Deluxe';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  context.messageText = catalogAdminLabels.editFieldPublisher;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Leder Games';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  context.messageText = catalogAdminLabels.editFieldRecommendedAge;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = '10';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  context.messageText = catalogAdminLabels.editFieldPlayTimeMinutes;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = '90';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  context.messageText = catalogAdminLabels.editFieldExternalRefs;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = '{"bggId":1234}';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  context.messageText = catalogAdminLabels.editFieldMetadata;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = '{"complexity":"medium"}';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  context.messageText = 'Guardar canvis';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.equal((await repository.findItemById(3))?.displayName, 'Root Deluxe');
  assert.equal((await repository.findItemById(3))?.publisher, 'Leder Games');
  assert.equal((await repository.findItemById(3))?.playerCountMin, 2);
  assert.equal((await repository.findItemById(3))?.playerCountMax, 4);
  assert.equal((await repository.findItemById(3))?.recommendedAge, 10);
  assert.equal((await repository.findItemById(3))?.playTimeMinutes, 90);
  assert.deepEqual((await repository.findItemById(3))?.externalRefs, { bggId: 1234 });
  assert.deepEqual((await repository.findItemById(3))?.metadata, { complexity: 'medium' });
  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'catalog.item.updated');

  context.callbackData = `${catalogAdminCallbackPrefixes.deactivate}3`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  delete context.callbackData;
  context.messageText = catalogAdminLabels.confirmDeactivate;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal((await repository.findItemById(3))?.lifecycleStatus, 'deactivated');
  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'catalog.item.deactivated');
});

test('handleTelegramCatalogAdminText skips player prompts for books and clears legacy player counts on edit', async () => {
  const repository = createRepository({
    items: [
      {
        id: 5,
        familyId: null,
        groupId: null,
        itemType: 'book',
        displayName: 'Mort',
        originalName: null,
        description: null,
        language: null,
        publisher: 'Mai Mes',
        publicationYear: 2020,
        playerCountMin: 1,
        playerCountMax: 2,
        recommendedAge: null,
        playTimeMinutes: 180,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const { context, replies } = createContext({ repository });

  context.callbackData = `${catalogAdminCallbackPrefixes.edit}5`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  delete context.callbackData;
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Jugadors/);

  context.messageText = 'Guardar canvis';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Jugadors:/);

  assert.equal((await repository.findItemById(5))?.playerCountMin, null);
  assert.equal((await repository.findItemById(5))?.playerCountMax, null);
});

test('handleTelegramCatalogAdminText shows category browse and loan state', async () => {
  const repository = createRepository({
    families: [
      {
        id: 7,
        slug: 'arkham-horror',
        displayName: 'Arkham Horror',
        description: null,
        familyKind: 'board-game-line',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
    ],
    groups: [
      {
        id: 11,
        familyId: 7,
        slug: 'second-edition',
        displayName: 'Second Edition',
        description: 'Base i expansions',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
    ],
    items: [
      {
        id: 3,
        familyId: 7,
        groupId: 11,
        itemType: 'board-game',
        displayName: 'Arkham Horror Core Set',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 1,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
      {
        id: 4,
        familyId: 7,
        groupId: 11,
        itemType: 'board-game',
        displayName: 'Dunwich Companion',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
      {
        id: 5,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Azul',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const catalogLoanRepository = createLoanRepository([
    {
      id: 21,
      itemId: 4,
      borrowerTelegramUserId: 77,
      borrowerDisplayName: 'Usuari 77',
      loanedByTelegramUserId: 99,
      dueAt: '2026-04-10T00:00:00.000Z',
      notes: null,
      returnedAt: null,
      returnedByTelegramUserId: null,
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
    },
  ]);
  const membershipRepository = createMembershipRepository([
    {
      telegramUserId: 77,
      displayName: 'Anna',
      status: 'approved',
      isAdmin: false,
    },
  ]);
  const { context, replies } = createContext({ repository, catalogLoanRepository, membershipRepository });

  context.messageText = catalogAdminLabels.listBoardGames;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Ítems de catàleg:/);
  assert.match(replies.at(-1)?.message ?? '', /<a href="https:\/\/t\.me\/cawa_management_bot\?start=catalog_admin_letters_AD"><b>A D - 3 artículos<\/b><\/a>/);
  assert.match(replies.at(-1)?.message ?? '', /A D - 3 artículos/);
  assert.match(replies.at(-1)?.message ?? '', /3 juegos de mesa/);
  assert.ok(replies.at(-1)?.options?.replyKeyboard?.flat().includes(catalogAdminLabels.searchByName));
  assert.equal(replies.at(-1)?.options?.inlineKeyboard, undefined);

  context.callbackData = `${catalogAdminCallbackPrefixes.browseLetters}AD`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /<b>Arkham Horror Core Set<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /<i>Joc de taula · Disponible<\/i>/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Azul<\/b>/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Sin familia/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /#\d+/);

  context.callbackData = `${catalogAdminCallbackPrefixes.browseFamily}7`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /<b>Categoria:<\/b> Arkham Horror/);
  assert.match(replies.at(-1)?.message ?? '', /Arkham Horror Core Set/);
  assert.equal(replies.at(-1)?.options?.inlineKeyboard?.flat().find((button) => button.text === 'Arkham Horror Core Set')?.callbackData, `${catalogAdminCallbackPrefixes.inspect}3`);
  assert.ok(replies.at(-1)?.options?.inlineKeyboard?.flat().some((button) => button.text === 'Azul'));

  context.callbackData = `${catalogAdminCallbackPrefixes.inspect}4`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /<b>Grup:<\/b> Second Edition/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Té:<\/b> Anna/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /<b>Des de:<\/b> 04\/04\/2026/);
  assert.match(replies.at(-1)?.message ?? '', /catalog_admin_item_full_4/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Sense valor/);
  assert.equal(replies.at(-1)?.options?.inlineKeyboard, undefined);
  assert.ok(replies.at(-1)?.options?.replyKeyboard?.flat().some((button) => button === 'Retornar'));

  context.callbackData = `${catalogAdminCallbackPrefixes.inspect}5`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /<b>Azul<\/b>/);
});

test('handleTelegramCatalogAdminCallback shows item details with localized admin actions', async () => {
  const repository = createRepository({
    items: [
      {
        id: 3,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Root',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const auditRepository = createAuditRepository();
  const { context, replies, getCurrentSession } = createContext({ repository, auditRepository, language: 'es' });

  context.callbackData = `${catalogAdminCallbackPrefixes.inspect}3`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Media:/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Descripcio:/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Sense valor/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /<b>Tipo:<\/b> Juego de mesa/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Jugadores:<\/b> 2-4/);
  assert.match(replies.at(-1)?.message ?? '', /catalog_admin_letters_R/);
  assert.match(replies.at(-1)?.message ?? '', /catalog_admin_item_full_3/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Grupo: Sin grupo/);
  assert.equal(replies.at(-1)?.options?.inlineKeyboard, undefined);
  const buttons = replies.at(-1)?.options?.replyKeyboard?.flat() ?? [];
  assert.ok(buttons.some((button) => buttonText(button) === 'Editar ítem'));
  assert.ok(buttons.some((button) => buttonText(button) === 'Autocorregir datos'));
  assert.ok(buttons.some((button) => buttonText(button) === 'Traducir descripción'));
  assert.ok(buttons.some((button) => buttonText(button) === 'Crear partida'));
  assert.ok(buttons.some((button) => buttonText(button) === 'Volver al catálogo'));
  assert.ok(buttons.some((button) => buttonText(button) === 'R'));
  assert.ok(buttons.some((button) => buttonText(button) === 'Eliminar ítem'));
  assert.ok(buttons.some((button) => buttonText(button) === 'Tomar prestado'));
  assert.ok(buttons.some((button) => buttonText(button) === 'Ver préstamos'));
  assert.ok(buttons.some((button) => buttonText(button) === 'Añadir media'));
});

test('handleTelegramCatalogAdminCallback appends BGG reimport notice for stale admin item details', async () => {
  const repository = createRepository({
    items: [
      {
        id: 3,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Old BGG Game',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: { bggId: '13' },
        metadata: { source: 'boardgamegeek', boardGameGeekId: '13' },
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
      {
        id: 4,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Fresh BGG Game',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: { boardGameGeekId: '42' },
        metadata: { source: 'boardgamegeek', boardGameGeekId: '42', averageWeight: 2.31 },
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const { context, replies } = createContext({ repository, language: 'es' });

  context.callbackData = `${catalogAdminCallbackPrefixes.inspect}3`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  const staleMessage = replies.at(-1)?.message ?? '';
  assert.match(staleMessage, /<b>Reimportación BGG recomendada:<\/b>/);
  assert.match(staleMessage.split('\n').at(-1) ?? '', /catalog_admin_bgg_meta_3/);
  assert.match(staleMessage.split('\n').at(-1) ?? '', /Importación BGG rápida/);
  const staleButtons = replies.at(-1)?.options?.replyKeyboard?.flat() ?? [];
  assert.ok(staleButtons.some((button) => buttonText(button) === 'Importación BGG rápida'));

  context.callbackData = `${catalogAdminCallbackPrefixes.inspect}4`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Reimportación BGG recomendada/);
});

test('handleTelegramCatalogAdminStartText refreshes only BGG metadata from the quick import link', async () => {
  const repository = createRepository({
    items: [
      {
        id: 2,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Before Pending',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: { boardGameGeekId: '12' },
        metadata: { source: 'boardgamegeek', boardGameGeekId: '12' },
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
      {
        id: 3,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Middle BGG Game',
        originalName: 'Middle BGG Game',
        description: 'Descripción manual',
        language: 'ES',
        publisher: 'Manual Publisher',
        publicationYear: 2000,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: 10,
        playTimeMinutes: 90,
        externalRefs: { bggId: '13' },
        metadata: { source: 'boardgamegeek', boardGameGeekId: '13', customFlag: true },
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
      {
        id: 4,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Next Pending',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: { boardGameGeekId: '14' },
        metadata: { source: 'boardgamegeek', boardGameGeekId: '14' },
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
      {
        id: 5,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Fresh BGG Game',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: { boardGameGeekId: '15' },
        metadata: { source: 'boardgamegeek', boardGameGeekId: '15', averageWeight: 2.1 },
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const importCalls: string[] = [];
  const translationCalls: string[] = [];
  const wikipediaBoardGameImportService: WikipediaBoardGameImportService = {
    async importByTitle(title) {
      importCalls.push(title);
      return {
        ok: true,
        draft: {
          familyId: null,
          groupId: null,
          itemType: 'board-game',
          displayName: 'CATAN',
          originalName: 'CATAN',
          description: 'Fresh BGG description',
          language: null,
          publisher: 'Kosmos',
          publicationYear: 1995,
          playerCountMin: 3,
          playerCountMax: 4,
          recommendedAge: 10,
          playTimeMinutes: 120,
          externalRefs: {
            boardGameGeekId: '13',
            boardGameGeekUrl: 'https://boardgamegeek.com/boardgame/13',
          },
          metadata: {
            source: 'boardgamegeek',
            boardGameGeekId: '13',
            boardGameGeekUrl: 'https://boardgamegeek.com/boardgame/13',
            averageRating: 7.126,
            bayesAverage: 6.991,
            usersRated: 130000,
            averageWeight: 2.3,
            numWeights: 5000,
            bestPlayerCounts: ['4'],
            recommendedPlayerCounts: ['3', '4'],
            categories: ['Negotiation'],
            mechanics: ['Trading'],
          },
        },
      };
    },
  };
  const { context, replies } = createContext({
    repository,
    wikipediaBoardGameImportService,
    language: 'es',
    descriptionTranslator: async (input) => {
      translationCalls.push(input.description);
      return 'No debería usarse';
    },
  });

  context.messageText = '/start catalog_admin_bgg_meta_3';
  assert.equal(await handleTelegramCatalogAdminStartText(context), true);

  assert.deepEqual(importCalls, ['Middle BGG Game [API #13]']);
  assert.deepEqual(translationCalls, []);
  const updated = await repository.findItemById(3);
  assert.equal(updated?.displayName, 'Middle BGG Game');
  assert.equal(updated?.description, 'Descripción manual');
  assert.equal(updated?.publisher, 'Manual Publisher');
  assert.equal(updated?.publicationYear, 2000);
  assert.equal(updated?.playerCountMin, 2);
  assert.equal(updated?.playTimeMinutes, 90);
  assert.deepEqual(updated?.metadata, {
    source: 'boardgamegeek',
    boardGameGeekId: '13',
    customFlag: true,
    boardGameGeekUrl: 'https://boardgamegeek.com/boardgame/13',
    averageRating: 7.126,
    bayesAverage: 6.991,
    usersRated: 130000,
    averageWeight: 2.3,
    numWeights: 5000,
    bestPlayerCounts: ['4'],
    recommendedPlayerCounts: ['3', '4'],
    categories: ['Negotiation'],
    mechanics: ['Trading'],
  });
  assert.match(replies[0]?.message ?? '', /Metadatos BGG actualizados/);
  const detailMessage = replies.at(-1)?.message ?? '';
  assert.doesNotMatch(detailMessage, /Reimportación BGG recomendada/);
  assert.match(detailMessage, /<b>Navegación BGG pendiente:<\/b>/);
  assert.match(detailMessage, /catalog_admin_item_2/);
  assert.match(detailMessage, /Anterior: Before Pending/);
  assert.match(detailMessage, /catalog_admin_item_4/);
  assert.match(detailMessage, /Siguiente: Next Pending/);
  assert.doesNotMatch(detailMessage, /catalog_admin_item_5/);
});

test('handleTelegramCatalogAdminCallback shows the storage cover before item details', async () => {
  const repository = createRepository({
    items: [
      {
        id: 3,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Root',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
    media: [
      {
        id: 8,
        familyId: null,
        itemId: 3,
        mediaType: 'image',
        url: 'storage:entry:1',
        altText: 'Root',
        sortOrder: 0,
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
    ],
  });
  const storageRepository = createStorageRepository();
  const category = await storageRepository.createCategory({
    slug: 'catalog-media',
    displayName: 'Catalog media',
    parentCategoryId: null,
    description: null,
    storageChatId: -100,
    storageThreadId: 10,
    categoryPurpose: 'catalog_media',
  });
  await storageRepository.createEntry({
    categoryId: category.id,
    createdByTelegramUserId: 99,
    sourceKind: 'dm_copy',
    description: 'Catalog media: Root',
    tags: ['catalog'],
    messages: [
      {
        storageChatId: -100,
        storageThreadId: 10,
        storageMessageId: 361,
        telegramFileId: 'photo-file',
        telegramFileUniqueId: 'photo-unique',
        attachmentKind: 'photo',
        caption: 'Root',
        originalFileName: null,
        mimeType: null,
        fileSizeBytes: null,
        mediaGroupId: null,
        sortOrder: 0,
      },
    ],
  });
  const copyCalls: Array<{ fromChatId: number; messageId: number; toChatId: number }> = [];
  const { context, replies } = createContext({
    repository,
    storageRepository,
    copyMessage: async (input) => {
      copyCalls.push(input);
      return { messageId: 1000 };
    },
  });

  context.callbackData = `${catalogAdminCallbackPrefixes.inspect}3`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);

  assert.deepEqual(copyCalls, [{ fromChatId: -100, messageId: 361, toChatId: 1 }]);
  assert.match(replies.at(-1)?.message ?? '', /<b>Root<\/b>/);
});

test('handleTelegramCatalogAdminCallback autocorrects a board game from BGG and imports cover media', async () => {
  const repository = createRepository({
    items: [
      {
        id: 236,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Maracaibo',
        originalName: 'Maracaibo',
        description: 'Old description',
        language: null,
        publisher: 'Old Publisher',
        publicationYear: 2018,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: 10,
        playTimeMinutes: 90,
        externalRefs: { boardGameGeekId: '276025', boardGameGeekUrl: 'https://boardgamegeek.com/boardgame/276025' },
        metadata: { source: 'boardgamegeek', boardGameGeekId: '276025', boardGameGeekUrl: 'https://boardgamegeek.com/boardgame/276025' },
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const auditRepository = createAuditRepository();
  const storageRepository = createStorageRepository();
  const storageDefaultChatStore = createMemoryMetadataStorage({
    'storage.default_chat': JSON.stringify({ chatId: -100123 }),
  });
  const importCalls: string[] = [];
  const translationCalls: string[] = [];
  const sentMedia: Array<{ chatId: number; media: TelegramPhotoMediaInput[]; messageThreadId?: number }> = [];
  const downloadedImages: string[] = [];
  const wikipediaBoardGameImportService: WikipediaBoardGameImportService = {
    async importByTitle(title) {
      importCalls.push(title);
      return {
        ok: true,
        draft: {
          familyId: null,
          groupId: null,
          itemType: 'board-game',
          displayName: 'Maracaibo',
          originalName: 'Maracaibo',
          description: 'Updated BGG description',
          language: null,
          publisher: "Game's Up",
          publicationYear: 2019,
          playerCountMin: 1,
          playerCountMax: 4,
          recommendedAge: 12,
          playTimeMinutes: 120,
          externalRefs: {
            boardGameGeekId: '276025',
            boardGameGeekUrl: 'https://boardgamegeek.com/boardgame/276025',
          },
          metadata: {
            boardGameGeekId: '276025',
            boardGameGeekUrl: 'https://boardgamegeek.com/boardgame/276025',
            averageRating: 8.07115,
            bayesAverage: 7.84537,
            usersRated: 58721,
            averageWeight: 3.7924,
            numWeights: 3650,
            bestPlayerCounts: ['3'],
            recommendedPlayerCounts: ['2', '3'],
            categories: ['Economic'],
            mechanics: ['Worker Placement'],
            imageUrl: 'https://cf.geekdo-images.com/maracaibo.jpg',
            thumbnailUrl: 'https://cf.geekdo-images.com/maracaibo-small.jpg',
          },
        },
      };
    },
  };
  const { context, replies } = createContext({
    repository,
    auditRepository,
    storageRepository,
    storageDefaultChatStore,
    wikipediaBoardGameImportService,
    language: 'es',
    createForumTopic: async ({ chatId, name }) => ({ chatId, name, messageThreadId: 456 }),
    sendMediaGroup: async (input) => {
      sentMedia.push(input);
      return [{ messageId: 777 }];
    },
    externalImageDownloader: async (url) => {
      downloadedImages.push(url);
      return {
        filePath: '/tmp/maracaibo.jpg',
        mimeType: 'image/jpeg',
        fileSizeBytes: 1234,
        originalFileName: 'maracaibo.jpg',
        cleanup: async () => {},
      };
    },
    descriptionTranslator: async (input) => {
      translationCalls.push(`${input.model}:${input.description}`);
      return 'Descripción traducida al castellano.';
    },
  });

  context.callbackData = `${catalogAdminCallbackPrefixes.autocorrect}236`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);

  assert.deepEqual(importCalls, ['Maracaibo [API #276025]']);
  assert.deepEqual(translationCalls, ['gpt-5.4:Updated BGG description']);
  const updated = await repository.findItemById(236);
  assert.equal(updated?.description, 'Descripción traducida al castellano.');
  assert.equal(updated?.publisher, "Game's Up");
  assert.equal(updated?.publicationYear, 2019);
  assert.equal(updated?.playerCountMin, 1);
  assert.equal(updated?.playerCountMax, 4);
  assert.equal(updated?.recommendedAge, 12);
  assert.equal(updated?.playTimeMinutes, 120);
  assert.equal(updated?.externalRefs, null);
  assert.deepEqual(updated?.metadata, {
    source: 'boardgamegeek',
    boardGameGeekId: '276025',
    boardGameGeekUrl: 'https://boardgamegeek.com/boardgame/276025',
    averageRating: 8.07115,
    bayesAverage: 7.84537,
    usersRated: 58721,
    averageWeight: 3.7924,
    numWeights: 3650,
    bestPlayerCounts: ['3'],
    recommendedPlayerCounts: ['2', '3'],
    categories: ['Economic'],
    mechanics: ['Worker Placement'],
  });
  assert.deepEqual(await repository.listMedia({ itemId: 236 }), [
    {
      id: 1,
      familyId: null,
      itemId: 236,
      mediaType: 'image',
      url: 'storage:entry:1',
      altText: 'Maracaibo',
      sortOrder: 0,
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
    },
  ]);
  assert.deepEqual(downloadedImages, ['https://cf.geekdo-images.com/maracaibo.jpg']);
  assert.deepEqual(sentMedia, [
    {
      chatId: -100123,
      messageThreadId: 456,
      media: [{ type: 'photo', media: { filePath: '/tmp/maracaibo.jpg' }, caption: 'Maracaibo' }],
    },
  ]);
  assert.match(replies[0]?.message ?? '', /Datos autocorregidos/i);
  assert.match(replies.at(-2)?.message ?? '', /Datos autocorregidos/i);
  assert.match(replies.at(-2)?.message ?? '', /Portada: importada como imagen principal \(#1\)/i);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Referencias externas/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Metadata/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Reimportación BGG recomendada/);
  assert.ok(auditRepository.__events.some((event) => event.actionKey === 'catalog.item.autocorrected' && event.targetId === '236'));
});

test('handleTelegramCatalogAdminCallback shows BGG candidates when autocorrect is ambiguous', async () => {
  const repository = createRepository({
    items: [
      {
        id: 13,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Catan',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const importCalls: string[] = [];
  const wikipediaBoardGameImportService: WikipediaBoardGameImportService = {
    async importByTitle(title) {
      importCalls.push(title);
      return {
        ok: false,
        error: {
          type: 'ambiguous',
          message: 'He trobat diverses coincidencies a la API.',
          candidates: [
            'CATAN (1995) [API #13]',
            'Catan: 3D Edition (2021) [API #386660]',
          ],
        },
      };
    },
  };
  const { context, replies } = createContext({
    repository,
    wikipediaBoardGameImportService,
    language: 'es',
  });

  context.callbackData = `${catalogAdminCallbackPrefixes.autocorrect}13`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);

  assert.deepEqual(importCalls, ['Catan']);
  assert.match(replies[0]?.message ?? '', /varias coincidencias/i);
  assert.match(replies[0]?.message ?? '', /CATAN \(1995\) \[API #13\]/);
  assert.deepEqual(replies[0]?.options?.inlineKeyboard?.slice(0, 2), [
    [{ text: 'CATAN (1995) [API #13]', callbackData: `${catalogAdminCallbackPrefixes.autocorrectBggCandidate}13:13` }],
    [{ text: 'Catan: 3D Edition (2021) [API #386660]', callbackData: `${catalogAdminCallbackPrefixes.autocorrectBggCandidate}13:386660` }],
  ]);
});

test('handleTelegramCatalogAdminCallback continues autocorrect with selected BGG candidate', async () => {
  const repository = createRepository({
    items: [
      {
        id: 13,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Catan',
        originalName: null,
        description: 'Old description',
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const importCalls: string[] = [];
  const wikipediaBoardGameImportService: WikipediaBoardGameImportService = {
    async importByTitle(title) {
      importCalls.push(title);
      return {
        ok: true,
        draft: {
          familyId: null,
          groupId: null,
          itemType: 'board-game',
          displayName: 'CATAN',
          originalName: 'CATAN',
          description: 'Updated Catan description',
          language: null,
          publisher: 'Kosmos',
          publicationYear: 1995,
          playerCountMin: 3,
          playerCountMax: 4,
          recommendedAge: 10,
          playTimeMinutes: 120,
          externalRefs: {
            boardGameGeekId: '13',
            boardGameGeekUrl: 'https://boardgamegeek.com/boardgame/13',
          },
          metadata: {
            source: 'boardgamegeek',
            boardGameGeekId: '13',
          },
        },
      };
    },
  };
  const { context, replies } = createContext({
    repository,
    wikipediaBoardGameImportService,
    language: 'ca',
  });

  context.callbackData = `${catalogAdminCallbackPrefixes.autocorrectBggCandidate}13:13`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);

  assert.deepEqual(importCalls, ['Catan [API #13]']);
  const updated = await repository.findItemById(13);
  assert.equal(updated?.displayName, 'CATAN');
  assert.equal(updated?.publisher, 'Kosmos');
  assert.deepEqual(updated?.metadata, {
    boardGameGeekId: '13',
    boardGameGeekUrl: 'https://boardgamegeek.com/boardgame/13',
    source: 'boardgamegeek',
  });
  assert.match(replies.at(-2)?.message ?? '', /Dades autocorregides correctament/);
  assert.match(replies.at(-2)?.message ?? '', /Durades:/);
});

test('handleTelegramCatalogAdminCallback autocorrect uses visible title before a stale original name', async () => {
  const repository = createRepository({
    items: [
      {
        id: 28,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Frosthaven',
        originalName: 'Gloomhaven',
        description: null,
        language: null,
        publisher: 'Cephalofair Games',
        publicationYear: 2017,
        playerCountMin: 1,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: 90,
        externalRefs: null,
        metadata: { source: 'boardgamegeek', boardGameGeekId: '174430' },
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const importCalls: string[] = [];
  const wikipediaBoardGameImportService: WikipediaBoardGameImportService = {
    async importByTitle(title) {
      importCalls.push(title);
      if (title.endsWith('[API #174430]')) {
        return {
          ok: true,
          draft: {
            familyId: null,
            groupId: null,
            itemType: 'board-game',
            displayName: 'Gloomhaven',
            originalName: 'Gloomhaven',
            description: 'Wrong game',
            language: null,
            publisher: 'Cephalofair Games',
            publicationYear: 2017,
            playerCountMin: 1,
            playerCountMax: 4,
            recommendedAge: 14,
            playTimeMinutes: 120,
            externalRefs: { boardGameGeekId: '174430' },
            metadata: { source: 'boardgamegeek', boardGameGeekId: '174430' },
          },
        };
      }
      return {
        ok: true,
        draft: {
          familyId: null,
          groupId: null,
          itemType: 'board-game',
          displayName: 'Frosthaven',
          originalName: 'Frosthaven',
          description: 'Correct game',
          language: null,
          publisher: 'Cephalofair Games',
          publicationYear: 2022,
          playerCountMin: 1,
          playerCountMax: 4,
          recommendedAge: 14,
          playTimeMinutes: 120,
          externalRefs: { boardGameGeekId: '295770' },
          metadata: { source: 'boardgamegeek', boardGameGeekId: '295770' },
        },
      };
    },
  };
  const { context } = createContext({
    repository,
    wikipediaBoardGameImportService,
  });

  context.callbackData = `${catalogAdminCallbackPrefixes.autocorrect}28`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);

  assert.deepEqual(importCalls, ['Frosthaven [API #174430]', 'Frosthaven']);
  const updated = await repository.findItemById(28);
  assert.equal(updated?.displayName, 'Frosthaven');
  assert.equal(updated?.originalName, 'Frosthaven');
  assert.equal(updated?.publicationYear, 2022);
  assert.deepEqual(updated?.metadata, { source: 'boardgamegeek', boardGameGeekId: '295770' });
});

test('handleTelegramCatalogAdminCallback autocorrects a book from Open Library', async () => {
  const repository = createRepository({
    items: [
      {
        id: 44,
        familyId: null,
        groupId: null,
        itemType: 'book',
        displayName: 'Dune',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: { openLibraryKey: '/works/OL893415W', openLibraryUrl: 'https://openlibrary.org/works/OL893415W' },
        metadata: { source: 'open-library', openLibraryUrl: 'https://openlibrary.org/works/OL893415W' },
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const lookupCalls: Array<{ itemType: string; query: string }> = [];
  const storageRepository = createStorageRepository();
  const storageDefaultChatStore = createMemoryMetadataStorage({
    'storage.default_chat': JSON.stringify({ chatId: -100123 }),
  });
  const sentMedia: Array<{ chatId: number; media: TelegramPhotoMediaInput[]; messageThreadId?: number }> = [];
  const catalogLookupService: CatalogLookupService = {
    async search(input) {
      lookupCalls.push({ itemType: input.itemType, query: input.query });
      return [
        {
          source: 'open-library',
          sourceId: '/works/OL893415W',
          title: 'Dune',
          summary: 'Frank Herbert · Ace Books · 1965',
          importedData: {
            originalName: 'Dune',
            description: null,
            language: 'ENG',
            publisher: 'Ace Books',
            publicationYear: 1965,
            externalRefs: {
              openLibraryKey: '/works/OL893415W',
              openLibraryUrl: 'https://openlibrary.org/works/OL893415W',
              coverUrl: 'https://covers.openlibrary.org/b/id/123-L.jpg',
            },
            metadata: {
              source: 'open-library',
              author: 'Frank Herbert',
              coverUrl: 'https://covers.openlibrary.org/b/id/123-L.jpg',
              openLibraryUrl: 'https://openlibrary.org/works/OL893415W',
            },
          },
        },
      ];
    },
  };
  const { context, replies } = createContext({
    repository,
    catalogLookupService,
    storageRepository,
    storageDefaultChatStore,
    language: 'es',
    createForumTopic: async ({ chatId, name }) => ({ chatId, name, messageThreadId: 456 }),
    sendMediaGroup: async (input) => {
      sentMedia.push(input);
      return [{ messageId: 777 }];
    },
    externalImageDownloader: async () => ({
      filePath: '/tmp/dune.jpg',
      mimeType: 'image/jpeg',
      fileSizeBytes: 1234,
      originalFileName: 'dune.jpg',
      cleanup: async () => {},
    }),
  });

  context.callbackData = `${catalogAdminCallbackPrefixes.autocorrect}44`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);

  assert.deepEqual(lookupCalls, [{ itemType: 'book', query: 'Dune' }]);
  const updated = await repository.findItemById(44);
  assert.equal(updated?.publisher, 'Ace Books');
  assert.equal(updated?.publicationYear, 1965);
  assert.equal(updated?.language, 'ENG');
  assert.equal(updated?.externalRefs, null);
  assert.deepEqual(updated?.metadata, {
    source: 'open-library',
    openLibraryKey: '/works/OL893415W',
  });
  assert.equal((await repository.listMedia({ itemId: 44 }))[0]?.url, 'storage:entry:1');
  assert.deepEqual(sentMedia, [
    {
      chatId: -100123,
      messageThreadId: 456,
      media: [{ type: 'photo', media: { filePath: '/tmp/dune.jpg' }, caption: 'Dune' }],
    },
  ]);
  assert.match(replies.at(-2)?.message ?? '', /Portada: importada como imagen principal \(#1\)/i);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Referencias externas/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Metadata/);
});

test('handleTelegramCatalogAdminCallback reports when autocorrect keeps an existing cover', async () => {
  const repository = createRepository({
    items: [
      {
        id: 232,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: '24h',
        originalName: '24h',
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: { source: 'boardgamegeek', boardGameGeekId: '285127' },
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
    media: [
      {
        id: 4,
        familyId: null,
        itemId: 232,
        mediaType: 'image',
        url: 'storage:entry:361',
        altText: '24h',
        sortOrder: 0,
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
    ],
  });
  const wikipediaBoardGameImportService: WikipediaBoardGameImportService = {
    async importByTitle() {
      return {
        ok: true,
        draft: {
          familyId: null,
          groupId: null,
          itemType: 'board-game',
          displayName: '24h',
          originalName: '24h',
          description: 'Updated description',
          language: null,
          publisher: 'Zacatrus',
          publicationYear: 2019,
          playerCountMin: 2,
          playerCountMax: 4,
          recommendedAge: 12,
          playTimeMinutes: 30,
          externalRefs: { boardGameGeekId: '285127' },
          metadata: {
            source: 'boardgamegeek',
            boardGameGeekId: '285127',
            imageUrl: 'https://cf.geekdo-images.com/24h.jpg',
          },
        },
      };
    },
  };
  const { context, replies } = createContext({
    repository,
    wikipediaBoardGameImportService,
    language: 'es',
    descriptionTranslator: async () => 'Descripcion traducida',
  });

  context.callbackData = `${catalogAdminCallbackPrefixes.autocorrect}232`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);

  assert.match(replies.at(-2)?.message ?? '', /Portada: ya había una imagen principal \(#4\)/i);
  assert.equal((await repository.listMedia({ itemId: 232 })).length, 1);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Metadata/);
});

test('handleTelegramCatalogAdminCallback translates only the current item description', async () => {
  const repository = createRepository({
    items: [
      {
        id: 262,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: '1960: The Making of the President',
        originalName: null,
        description: 'This is a long English description about the game.',
        language: null,
        publisher: 'GMT Games',
        publicationYear: 2007,
        playerCountMin: 2,
        playerCountMax: 2,
        recommendedAge: 12,
        playTimeMinutes: 120,
        externalRefs: null,
        metadata: { boardGameGeekId: '27708' },
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const auditRepository = createAuditRepository();
  const translationCalls: string[] = [];
  const { context, replies } = createContext({
    repository,
    auditRepository,
    language: 'es',
    descriptionTranslator: async (input) => {
      translationCalls.push(`${input.model}:${input.description}`);
      return 'Esta es una descripción larga en castellano sobre el juego.';
    },
  });

  context.callbackData = `${catalogAdminCallbackPrefixes.translateDescription}262`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);

  assert.deepEqual(translationCalls, ['gpt-5.4:This is a long English description about the game.']);
  const updated = await repository.findItemById(262);
  assert.equal(updated?.description, 'Esta es una descripción larga en castellano sobre el juego.');
  assert.equal(updated?.publisher, 'GMT Games');
  assert.deepEqual(updated?.metadata, { boardGameGeekId: '27708' });
  assert.match(replies[0]?.message ?? '', /Descripción traducida correctamente/i);
  assert.match(replies.at(-2)?.message ?? '', /Descripción traducida correctamente/i);
  assert.match(replies.at(-1)?.message ?? '', /1960: The Making of the President/);
  assert.ok(auditRepository.__events.some((event) => event.actionKey === 'catalog.item.description_translated' && event.targetId === '262'));
});

test('handleTelegramCatalogAdminCallback reports missing description when translating', async () => {
  const repository = createRepository({
    items: [
      {
        id: 263,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'No Description',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const { context, replies } = createContext({ repository, language: 'es' });

  context.callbackData = `${catalogAdminCallbackPrefixes.translateDescription}263`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);

  assert.match(replies.at(-1)?.message ?? '', /no tiene ninguna descripción/i);
});

test('handleTelegramCatalogAdminCallback starts activity creation from a board game detail', async () => {
  const repository = createRepository({
    items: [
      {
        id: 3,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Root',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const { context, replies, getCurrentSession } = createContext({ repository, language: 'es' });

  context.callbackData = `${catalogAdminCallbackPrefixes.createActivity}3`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);

  assert.deepEqual(getCurrentSession(), {
    flowKey: 'schedule-create',
    stepKey: 'date',
    data: { title: 'Root', catalogItemId: 3 },
  });
  assert.match(replies.at(-1)?.message ?? '', /Escribe la fecha de inicio/i);
  assert.equal(replies.at(-1)?.options?.resizeKeyboard, true);
  assert.equal(replies.at(-1)?.options?.persistentKeyboard, true);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard?.at(-2), ['Volver']);
  assert.deepEqual(replies.at(-1)?.options?.replyKeyboard?.at(-1), [dangerButton('/cancel')]);
  assert.equal(replies.at(-1)?.options?.replyKeyboard?.slice(0, 3).every((row) => row.length === 2), true);
});

test('handleTelegramCatalogAdminCallback warns when creating activity from a loaned board game', async () => {
  const repository = createRepository({
    items: [
      {
        id: 3,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Root',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const loanRepository = createLoanRepository([
    {
      id: 1,
      itemId: 3,
      borrowerTelegramUserId: 77,
      borrowerDisplayName: 'Marta',
      loanedByTelegramUserId: 99,
      dueAt: '2026-05-10T00:00:00.000Z',
      notes: null,
      returnedAt: null,
      returnedByTelegramUserId: null,
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
    },
  ]);
  const { context, replies, getCurrentSession } = createContext({ repository, catalogLoanRepository: loanRepository, language: 'ca' });

  context.callbackData = `${catalogAdminCallbackPrefixes.createActivity}3`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);

  assert.deepEqual(getCurrentSession(), {
    flowKey: 'schedule-create',
    stepKey: 'date',
    data: { title: 'Root', catalogItemId: 3 },
  });
  assert.match(replies.at(-1)?.message ?? '', /Atenció: aquest joc està prestat a Marta fins 10\/05/i);
  assert.match(replies.at(-1)?.message ?? '', /Pots continuar creant l'activitat igualment/i);
  assert.match(replies.at(-1)?.message ?? '', /Escriu la data d'inici/i);
});

test('handleTelegramCatalogAdminCallback warns without due date when loan has no due date', async () => {
  const repository = createRepository({
    items: [
      {
        id: 3,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Root',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const loanRepository = createLoanRepository([
    {
      id: 1,
      itemId: 3,
      borrowerTelegramUserId: 77,
      borrowerDisplayName: 'Marta',
      loanedByTelegramUserId: 99,
      dueAt: null,
      notes: null,
      returnedAt: null,
      returnedByTelegramUserId: null,
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
    },
  ]);
  const { context, replies } = createContext({ repository, catalogLoanRepository: loanRepository, language: 'ca' });

  context.callbackData = `${catalogAdminCallbackPrefixes.createActivity}3`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);

  assert.match(replies.at(-1)?.message ?? '', /Atenció: aquest joc està prestat a Marta\./i);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /fins/);
  assert.match(replies.at(-1)?.message ?? '', /Escriu la data d'inici/i);
});

test('handleTelegramCatalogAdminCallback hides admin-only item actions for approved non-admin members', async () => {
  const repository = createRepository({
    items: [
      {
        id: 3,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Root',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
    media: [
      {
        id: 8,
        familyId: null,
        itemId: 3,
        mediaType: 'image',
        url: 'https://example.com/root.png',
        altText: 'Root cover',
        sortOrder: 0,
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
    ],
  });
  const { context, replies } = createContext({ repository, isAdmin: false, language: 'es' });

  context.callbackData = `${catalogAdminCallbackPrefixes.inspect}3`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);

  const buttons = replies.at(-1)?.options?.replyKeyboard?.flat().map(buttonText) ?? [];
  assert.ok(!buttons.some((button) => button === 'Editar ítem'));
  assert.ok(!buttons.some((button) => button === 'Autocorregir datos'));
  assert.ok(!buttons.some((button) => button === 'Traducir descripción'));
  assert.ok(!buttons.some((button) => button === 'Eliminar ítem'));
  assert.ok(!buttons.some((button) => button === 'Guardar cambios de media #8'));
  assert.ok(!buttons.some((button) => button === 'Confirmar eliminación de media #8'));
  assert.ok(buttons.some((button) => button === 'Crear partida'));
  assert.ok(buttons.some((button) => button === 'Tomar prestado'));
  assert.ok(buttons.some((button) => button === 'Ver préstamos'));
});

test('handleTelegramCatalogAdminCallback hides return action from unrelated non-admin members', async () => {
  const repository = createRepository({
    items: [
      {
        id: 3,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Root',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const catalogLoanRepository = createLoanRepository([
    {
      id: 21,
      itemId: 3,
      borrowerTelegramUserId: 77,
      borrowerDisplayName: 'Marta',
      loanedByTelegramUserId: 88,
      dueAt: null,
      notes: null,
      returnedAt: null,
      returnedByTelegramUserId: null,
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
    },
  ]);
  const { context, replies } = createContext({ repository, catalogLoanRepository, isAdmin: false });

  context.callbackData = `${catalogAdminCallbackPrefixes.inspect}3`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);

  const buttons = replies.at(-1)?.options?.replyKeyboard?.flat() ?? [];
  assert.match(replies.at(-1)?.message ?? '', /<b>Té:<\/b> Marta/);
  assert.ok(!buttons.some((button) => button === 'Retornar'));
  assert.ok(buttons.some((button) => button === 'Veure préstecs'));
});

test('handleTelegramCatalogAdminCallback blocks non-admin edit and deactivate actions', async () => {
  const repository = createRepository({
    items: [
      {
        id: 3,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Root',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const { context, replies, getCurrentSession } = createContext({ repository, isAdmin: false });

  context.callbackData = `${catalogAdminCallbackPrefixes.edit}3`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /només està disponible per a administradors del club/i);
  assert.equal(getCurrentSession(), null);

  context.callbackData = `${catalogAdminCallbackPrefixes.deactivate}3`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /només està disponible per a administradors del club/i);
  assert.equal(getCurrentSession(), null);
});

test('handleTelegramCatalogAdminCallback lets admins add catalog media backed by Storage', async () => {
  const repository = createRepository({
    items: [
      {
        id: 3,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Root',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const storageRepository = createStorageRepository();
  const storageDefaultChatStore = createMemoryMetadataStorage({
    'storage.default_chat': JSON.stringify({ chatId: -100123 }),
  });
  const sentMedia: Array<{ chatId: number; media: TelegramPhotoMediaInput[]; messageThreadId?: number }> = [];
  const downloadedImages: string[] = [];
  const { context, replies, getCurrentSession } = createContext({
    repository,
    storageRepository,
    storageDefaultChatStore,
    createForumTopic: async ({ chatId, name }) => ({ chatId, name, messageThreadId: 456 }),
    sendMediaGroup: async (input) => {
      sentMedia.push(input);
      return [{ messageId: 777 }];
    },
    externalImageDownloader: async (url) => {
      downloadedImages.push(url);
      return {
        filePath: '/tmp/root-cover.jpg',
        mimeType: 'image/jpeg',
        fileSizeBytes: 1234,
        originalFileName: 'root-cover.jpg',
        cleanup: async () => {},
      };
    },
  });

  context.callbackData = `${catalogAdminCallbackPrefixes.inspect}3`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  assert.ok((replies.at(-1)?.options?.replyKeyboard?.flat() ?? []).some((button) => buttonText(button) === 'Afegir mèdia'));

  context.callbackData = `${catalogAdminCallbackPrefixes.addMedia}3`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'input');
  assert.match(replies.at(-1)?.message ?? '', /Escriu la URL o adjunta la imatge/);
  delete context.callbackData;

  context.messageText = 'https://example.com/root-cover.jpg';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession(), null);

  const media = await repository.listMedia({ itemId: 3 });
  assert.equal(media[0]?.url, 'storage:entry:1');
  assert.equal(media[0]?.sortOrder, 0);
  assert.equal(storageRepository.__entries[0]?.messages[0]?.storageMessageId, 777);
  assert.deepEqual(downloadedImages, ['https://example.com/root-cover.jpg']);
  assert.deepEqual(sentMedia, [
    {
      chatId: -100123,
      messageThreadId: 456,
      media: [{ type: 'photo', media: { filePath: '/tmp/root-cover.jpg' }, caption: 'Root' }],
    },
  ]);
});

test('handleTelegramCatalogAdminMessage stores an attached catalog cover in Storage', async () => {
  const repository = createRepository({
    items: [
      {
        id: 3,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Root',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const storageRepository = createStorageRepository();
  const copiedMessages: Array<{ fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }> = [];
  const { context, getCurrentSession } = createContext({
    repository,
    storageRepository,
    storageDefaultChatStore: createMemoryMetadataStorage({
      'storage.default_chat': JSON.stringify({ chatId: -100123 }),
    }),
    createForumTopic: async ({ chatId, name }) => ({ chatId, name, messageThreadId: 456 }),
    copyMessage: async (input) => {
      copiedMessages.push(input);
      return { messageId: 888 };
    },
  });

  context.callbackData = `${catalogAdminCallbackPrefixes.addMedia}3`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  delete context.callbackData;
  assert.equal(getCurrentSession()?.stepKey, 'input');

  context.messageText = undefined;
  context.messageMedia = {
    attachmentKind: 'photo',
    fileId: 'photo-file-id',
    fileUniqueId: 'photo-file-unique-id',
    messageId: 55,
    caption: 'Root cover',
  };
  assert.equal(await handleTelegramCatalogAdminMessage(context), true);
  assert.equal(getCurrentSession(), null);

  const media = await repository.listMedia({ itemId: 3 });
  assert.equal(media[0]?.url, 'storage:entry:1');
  assert.equal(storageRepository.__entries[0]?.messages[0]?.telegramFileUniqueId, 'photo-file-unique-id');
  assert.deepEqual(copiedMessages, [{ fromChatId: 1, messageId: 55, toChatId: -100123, messageThreadId: 456 }]);
});

test('handleTelegramCatalogAdminCallback lets admins edit and delete item media', async () => {
  const repository = createRepository({
    items: [
      {
        id: 3,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Root',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: 2,
        playerCountMax: 4,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
    media: [
      {
        id: 8,
        familyId: null,
        itemId: 3,
        mediaType: 'image',
        url: 'https://example.com/root.jpg',
        altText: 'Portada',
        sortOrder: 0,
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
    ],
  });
  const auditRepository = createAuditRepository();
  const { context, replies, getCurrentSession } = createContext({ repository, auditRepository });

  context.callbackData = 'catalog_admin:edit_media:8';
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  delete context.callbackData;
  assert.equal(getCurrentSession()?.stepKey, 'media-type');

  context.messageText = 'Enllaç';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'https://example.com/root';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Fitxa actualitzada';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = '3';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  context.messageText = 'Guardar canvis de mèdia';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession(), null);
  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'catalog.media.updated');

  assert.equal((await repository.listMedia({ itemId: 3 }))[0]?.url, 'https://example.com/root');

  context.callbackData = 'catalog_admin:delete_media:8';
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  delete context.callbackData;
  context.messageText = 'Confirmar eliminació de mèdia';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'catalog.media.deleted');

  context.callbackData = `${catalogAdminCallbackPrefixes.inspect}3`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Media:/);
});

test('handleTelegramCatalogAdminText hides deactivated items from the normal catalog list', async () => {
  const repository = createRepository({
    items: [
      {
        id: 1,
        familyId: null,
        groupId: null,
        itemType: 'rpg-book',
        displayName: 'Actiu',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
      {
        id: 2,
        familyId: null,
        groupId: null,
        itemType: 'rpg-book',
        displayName: 'Desactivat',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'deactivated',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T12:00:00.000Z',
        deactivatedAt: '2026-04-04T12:00:00.000Z',
      },
    ],
  });
  const { context, replies } = createContext({ repository });

  context.messageText = catalogAdminLabels.list;
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Ítems de catàleg:/);
  assert.match(replies.at(-1)?.message ?? '', /A - 1 artículo/);
  assert.match(replies.at(-1)?.message ?? '', /1 libro/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Desactivat/);

  context.callbackData = `${catalogAdminCallbackPrefixes.browseLetters}A`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /<a href="https:\/\/t\.me\/cawa_management_bot\?start=catalog_admin_item_1"><b>Actiu<\/b><\/a> · <i>Llibre RPG · Disponible<\/i>/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /#\d+/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Desactivat/);
  assert.equal(replies.at(-1)?.options?.inlineKeyboard, undefined);
});

test('handleTelegramCatalogAdminText groups standalone items under their family instead of Sense grup', async () => {
  const repository = createRepository({
    families: [
      {
        id: 1,
        slug: 'mundodisco',
        displayName: 'Mundodisco',
        description: null,
        familyKind: 'generic-line',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
    ],
    items: [
      {
        id: 2,
        familyId: 1,
        groupId: null,
        itemType: 'book',
        displayName: 'El color de la magia',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
      {
        id: 3,
        familyId: 1,
        groupId: null,
        itemType: 'book',
        displayName: 'Mort',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const catalogLoanRepository = createLoanRepository([
    {
      id: 21,
      itemId: 3,
      borrowerTelegramUserId: 77,
      borrowerDisplayName: 'Anna',
      loanedByTelegramUserId: 99,
      dueAt: '2026-04-10T00:00:00.000Z',
      notes: null,
      returnedAt: null,
      returnedByTelegramUserId: null,
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
    },
  ]);
  const { context, replies } = createContext({ repository, catalogLoanRepository });

  context.messageText = catalogAdminLabels.openMenu;
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Ítems de catàleg:/);
  assert.match(replies.at(-1)?.message ?? '', /E M - 2 artículos/);
  assert.match(replies.at(-1)?.message ?? '', /2 libros/);
  assert.ok(replies.at(-1)?.options?.replyKeyboard?.flat().includes(catalogAdminLabels.searchByName));

  context.callbackData = `${catalogAdminCallbackPrefixes.browseLetters}EM`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /<a href="https:\/\/t\.me\/cawa_management_bot\?start=catalog_admin_item_2"><b>El color de la magia<\/b><\/a>/);
  assert.match(replies.at(-1)?.message ?? '', /<i>Llibre · Disponible<\/i>/);
  assert.match(replies.at(-1)?.message ?? '', /<a href="https:\/\/t\.me\/cawa_management_bot\?start=catalog_admin_item_3"><b>Mort<\/b><\/a>/);
  assert.match(replies.at(-1)?.message ?? '', /<i>Llibre · Prestat a Anna · des de 04\/04\/2026<\/i>/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /#\d+/);
  assert.equal(replies.at(-1)?.options?.inlineKeyboard, undefined);

  context.callbackData = `${catalogAdminCallbackPrefixes.browseFamily}1`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /<b>Categoria:<\/b> Mundodisco/);
  assert.match(replies.at(-1)?.message ?? '', /Prestat a Anna/);
  assert.match(replies.at(-1)?.message ?? '', /des de 04\/04\/2026/);
  assert.ok(replies.at(-1)?.options?.inlineKeyboard?.flat().some((button) => button.text === 'Prendre prestat' || button.text === 'Retornar'));
});

test('handleTelegramCatalogAdminText can search catalog items by name', async () => {
  const repository = createRepository({
    families: [
      {
        id: 1,
        slug: 'mundodisco',
        displayName: 'Mundodisco',
        description: null,
        familyKind: 'generic-line',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
      },
    ],
    items: [
      {
        id: 2,
        familyId: 1,
        groupId: null,
        itemType: 'book',
        displayName: 'El color de la magia',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
      {
        id: 3,
        familyId: 1,
        groupId: null,
        itemType: 'book',
        displayName: 'Mort',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const catalogLoanRepository = createLoanRepository([
    {
      id: 31,
      itemId: 3,
      borrowerTelegramUserId: 55,
      borrowerDisplayName: 'Pau',
      loanedByTelegramUserId: 99,
      dueAt: null,
      notes: null,
      returnedAt: null,
      returnedByTelegramUserId: null,
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:00:00.000Z',
    },
  ]);
  const { context, replies, getCurrentSession } = createContext({ repository, catalogLoanRepository });

  context.callbackData = catalogAdminCallbackPrefixes.browseSearch;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  delete context.callbackData;
  assert.equal(getCurrentSession()?.stepKey, 'search-query');

  context.messageText = 'Mort';
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Resultats per a "Mort"/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Mort<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /<i>Llibre · Prestat a Pau · des de 04\/04\/2026<\/i>/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /#3/);
  assert.equal(replies.at(-1)?.options?.inlineKeyboard?.flat().find((button) => button.text === 'Mort')?.callbackData, `${catalogAdminCallbackPrefixes.inspect}3`);
  assert.ok(replies.at(-1)?.options?.inlineKeyboard?.flat().some((button) => button.text === 'Retornar'));
  assert.ok(!replies.at(-1)?.options?.inlineKeyboard?.flat().some((button) => button.text === 'Prendre prestat'));
});

test('handleTelegramCatalogAdminStartText opens an item detail from deep link payload', async () => {
  const repository = createRepository({
    items: [
      {
        id: 2,
        familyId: null,
        groupId: null,
        itemType: 'book',
        displayName: 'El color de la magia',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const { context, replies } = createContext({ repository });

  context.messageText = '/start catalog_admin_item_2';
  assert.equal(await handleTelegramCatalogAdminStartText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /<b>El color de la magia<\/b>/);
  const buttons = replies.at(-1)?.options?.replyKeyboard?.flat() ?? [];
  assert.ok(buttons.some((button) => button === 'Editar ítem'));
  assert.ok(buttons.some((button) => button === 'Eliminar ítem'));
  assert.ok(!buttons.some((button) => button === 'Editar préstec'));
  assert.ok(!buttons.some((button) => button === 'Veure catàleg'));
});

test('handleTelegramCatalogAdminStartText opens an initial bucket from deep link payload', async () => {
  const repository = createRepository({
    items: [
      {
        id: 1,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Jaipur',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
      {
        id: 2,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'King of Tokyo',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
      {
        id: 3,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Love Letter',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
      {
        id: 4,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Ark Nova',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const { context, replies } = createContext({ repository, language: 'es' });

  context.messageText = '/start catalog_admin_letters_JKL';
  assert.equal(await handleTelegramCatalogAdminStartText(context), true);

  assert.match(replies.at(-1)?.message ?? '', /<b>J K L<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Jaipur<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /<b>King of Tokyo<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Love Letter<\/b>/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Ark Nova/);
  assert.equal(replies.at(-1)?.options?.inlineKeyboard, undefined);
});

test('handleTelegramCatalogAdminText opens an initial bucket from internal command', async () => {
  const repository = createRepository({
    items: [
      {
        id: 1,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Jaipur',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
      {
        id: 2,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Ark Nova',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const { context, replies } = createContext({ repository, language: 'es' });

  context.messageText = '/cat_jkl';
  assert.equal(await handleTelegramCatalogAdminText(context), true);

  assert.match(replies.at(-1)?.message ?? '', /<b>J K L<\/b>/);
  assert.match(replies.at(-1)?.message ?? '', /<b>Jaipur<\/b>/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Ark Nova/);
  assert.equal(replies.at(-1)?.options?.inlineKeyboard, undefined);
});

test('handleTelegramCatalogAdminText falls back to minimum-field creation when lookup fails', async () => {
  const repository = createRepository();
  const catalogLookupService: CatalogLookupService = {
    async search() {
      throw new Error('lookup unavailable');
    },
  };
  const { context, getCurrentSession } = createContext({ repository, catalogLookupService });

  context.messageText = catalogAdminLabels.create;
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.typeRpgBook;
  await handleTelegramCatalogAdminText(context);
  context.messageText = 'Monster Manual';
  await handleTelegramCatalogAdminText(context);
  context.messageText = catalogAdminLabels.editFieldFamily;

  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'family');

  context.messageText = catalogAdminLabels.noFamily;

  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'select-field');
  context.messageText = catalogAdminLabels.editFieldGroup;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession()?.stepKey, 'group');
  context.messageText = catalogAdminLabels.noGroup;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  for (let step = 0; step < 11; step += 1) {
    context.messageText = catalogAdminLabels.skipOptional;
    assert.equal(await handleTelegramCatalogAdminText(context), true);
  }
  context.messageText = catalogAdminLabels.confirmCreate;
  assert.equal(await handleTelegramCatalogAdminText(context), true);
  assert.equal(getCurrentSession(), null);

  const created = await repository.findItemById(1);
  assert.equal(created?.displayName, 'Monster Manual');
  assert.equal(created?.publisher, null);
  assert.equal(created?.externalRefs, null);
});

test('catalog admin can assign an item owner from the paginated user selector', async () => {
  const repository = createRepository({
    items: [
      {
        id: 1,
        familyId: null,
        groupId: null,
        itemType: 'board-game',
        displayName: 'Dune Imperium',
        originalName: null,
        description: null,
        language: null,
        publisher: null,
        publicationYear: null,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: null,
        metadata: null,
        lifecycleStatus: 'active',
        createdAt: '2026-04-04T10:00:00.000Z',
        updatedAt: '2026-04-04T10:00:00.000Z',
        deactivatedAt: null,
      },
    ],
  });
  const membershipRepository = createMembershipRepository([
    { telegramUserId: 7, username: 'admin_user', displayName: 'Admin User', status: 'approved', isAdmin: true },
    { telegramUserId: 20, username: 'ana_owner', displayName: 'Ana Owner', status: 'approved', isAdmin: false },
    { telegramUserId: 21, username: null, displayName: 'Blocked User', status: 'blocked', isAdmin: false },
  ]);
  const auditRepository = createAuditRepository();
  const { context, replies } = createContext({ repository, membershipRepository, auditRepository, language: 'es' });

  context.callbackData = `${catalogAdminCallbackPrefixes.ownerPage}1:1`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Elige el propietario del ítem/);
  assert.match(replies.at(-1)?.message ?? '', /Ana Owner/);
  assert.doesNotMatch(replies.at(-1)?.message ?? '', /Blocked User/);

  context.callbackData = `${catalogAdminCallbackPrefixes.selectOwner}1:20`;
  assert.equal(await handleTelegramCatalogAdminCallback(context), true);

  const updated = await repository.findItemById(1);
  assert.equal(updated?.ownerTelegramUserId, 20);
  assert.match(replies.at(-1)?.message ?? '', /<b>Propietario:<\/b> <a href="https:\/\/t\.me\/ana_owner">Ana Owner \(@ana_owner\)<\/a>/);
  assert.equal(auditRepository.__events.at(-1)?.actionKey, 'catalog.item.owner_updated');
});
