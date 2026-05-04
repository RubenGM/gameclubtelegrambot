import { createDatabaseStorageRepository } from '../storage/storage-catalog-store.js';
import {
  createStorageCategory,
  createStorageEntry,
  parseStorageCaptionMetadata,
  setStorageCategoryLifecycleStatus,
  type StorageCategoryRecord,
  type StorageCategoryRepository,
  type StorageEntryDetailRecord,
  type StorageEntryMessageRecord,
} from '../storage/storage-catalog.js';
import {
  createDatabaseStorageCategoryAccessRepository,
  type StorageCategoryAccessRepository,
  type StorageCategoryAccessUserRecord,
} from '../storage/storage-category-access-store.js';
import { appendAuditEvent } from '../audit/audit-log.js';
import { createDatabaseAuditLogRepository } from '../audit/audit-log-store.js';
import { TelegramInteractionError, type TelegramCommandHandlerContext } from './command-registry.js';
import { buildTelegramStartUrl } from './deep-links.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import type { TelegramReplyButton, TelegramReplyOptions } from './runtime-boundary.js';
import { escapeHtml } from './schedule-presentation.js';
import { buildGlobalNavigationRow, buildPersistentReplyKeyboard } from './submenu-keyboards.js';

const storageUploadFlowKey = 'storage-upload';
const storageEntryStartPayloadPrefix = 'storage_entry_';
const storageListPageSize = 20;
const storageListFlowKey = 'storage-list';
const storageSearchFlowKey = 'storage-search';
const storageOpenEntryFlowKey = 'storage-open-entry';
const storageAddImagesFlowKey = 'storage-add-images';
const storageCreateCategoryFlowKey = 'storage-create-category';
const storageArchiveCategoryFlowKey = 'storage-archive-category';
const storageReactivateCategoryFlowKey = 'storage-reactivate-category';
const storageDeleteEntryFlowKey = 'storage-delete-entry';
const storageGrantAccessFlowKey = 'storage-grant-access';
const storageRevokeAccessFlowKey = 'storage-revoke-access';
const storageViewAccessFlowKey = 'storage-view-access';
const storageTopicMediaGroupWindowMs = 1500;
const storageChatRequestId = 41101;

type PendingTopicMediaGroup = {
  repository: StorageCategoryRepository;
  categoryId: number;
  createdByTelegramUserId: number;
  messages: Array<{
    storageChatId: number;
    storageMessageId: number;
    storageThreadId: number;
    telegramFileId: string | null;
    telegramFileUniqueId: string | null;
    attachmentKind: DmUploadDraftMessage['attachmentKind'];
    caption: string | null;
    originalFileName: string | null;
    mimeType: string | null;
    fileSizeBytes: number | null;
    mediaGroupId: string;
    sortOrder: number;
  }>;
  timer: ReturnType<typeof setTimeout> | null;
};

const pendingStorageTopicMediaGroups = new Map<string, PendingTopicMediaGroup>();

type DmUploadDraftMessage = {
  fromChatId: number;
  fromMessageId: number;
  attachmentKind: 'document' | 'photo' | 'video' | 'audio';
  telegramFileId: string | null;
  telegramFileUniqueId: string | null;
  caption: string | null;
  originalFileName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  mediaGroupId: string | null;
  sortOrder: number;
};

type StorageUserChoice = {
  telegramUserId: number;
  username: string | null;
  displayName: string;
  status: string;
  isAdmin: boolean;
  label: string;
};

type StorageFlowContext = TelegramCommandHandlerContext & {
  storageRepository?: StorageCategoryRepository | undefined;
  storageCategoryAccessRepository?: StorageCategoryAccessRepository | undefined;
  messageMedia?: TelegramCommandHandlerContext['messageMedia'];
  sharedChat?: TelegramCommandHandlerContext['sharedChat'];
  messageThreadId?: number | undefined;
  runtime: TelegramCommandHandlerContext['runtime'] & {
    bot: TelegramCommandHandlerContext['runtime']['bot'] & {
      getMe?: () => Promise<{ id: number; username?: string }>;
      getChat?: (chatId: number) => Promise<{ id: number; type: string; title?: string; isForum?: boolean }>;
      getChatMember?: (chatId: number, userId: number) => Promise<{ status: string; canManageTopics?: boolean }>;
      createForumTopic?: (input: { chatId: number; name: string }) => Promise<{ chatId: number; name: string; messageThreadId: number }>;
      copyMessage?: (input: {
        fromChatId: number;
        messageId: number;
        toChatId: number;
        messageThreadId?: number;
      }) => Promise<{ messageId: number }>;
      deleteMessage?: (input: {
        chatId: number;
        messageId: number;
      }) => Promise<void>;
    };
  };
};

export async function handleTelegramStorageCommand(context: StorageFlowContext): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).storage;
  await context.reply(texts.selectMenu, buildStorageMenuOptions(language, context));
}

export async function handleTelegramStorageStartText(context: StorageFlowContext): Promise<boolean> {
  const text = context.messageText?.trim();
  if (!text || context.runtime.chat.kind !== 'private' || !context.runtime.actor.isApproved || context.runtime.actor.isBlocked) {
    return false;
  }

  const entryId = parseStartPayload(text, storageEntryStartPayloadPrefix);
  if (entryId === null) {
    return false;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  return sendStorageEntryDetail(context, entryId, language);
}

export async function handleTelegramStorageText(context: StorageFlowContext): Promise<boolean> {
  const text = context.messageText?.trim();
  if (!text || context.runtime.chat.kind !== 'private' || !context.runtime.actor.isApproved || context.runtime.actor.isBlocked) {
    return false;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const i18n = createTelegramI18n(language);
  const texts = i18n.storage;
  const actionMenuTexts = i18n.actionMenu;
  if (await handleTelegramStorageStartText(context)) {
    return true;
  }

  if (context.runtime.session.current?.flowKey === storageUploadFlowKey) {
    return handleActiveUploadFlow(context, text, language);
  }
  if (context.runtime.session.current?.flowKey === storageListFlowKey) {
    return handleActiveListFlow(context, text, language);
  }
  if (context.runtime.session.current?.flowKey === storageSearchFlowKey) {
    return handleActiveSearchFlow(context, text, language);
  }
  if (context.runtime.session.current?.flowKey === storageOpenEntryFlowKey) {
    return handleActiveOpenEntryFlow(context, text, language);
  }
  if (context.runtime.session.current?.flowKey === storageAddImagesFlowKey) {
    return handleActiveAddImagesFlow(context, text, language);
  }
  if (context.runtime.session.current?.flowKey === storageCreateCategoryFlowKey) {
    return handleActiveCreateCategoryFlow(context, text, language);
  }
  if (context.runtime.session.current?.flowKey === storageArchiveCategoryFlowKey) {
    return handleActiveArchiveCategoryFlow(context, text, language);
  }
  if (context.runtime.session.current?.flowKey === storageReactivateCategoryFlowKey) {
    return handleActiveReactivateCategoryFlow(context, text, language);
  }
  if (context.runtime.session.current?.flowKey === storageDeleteEntryFlowKey) {
    return handleActiveDeleteEntryFlow(context, text, language);
  }
  if (context.runtime.session.current?.flowKey === storageGrantAccessFlowKey) {
    return handleActiveGrantAccessFlow(context, text, language);
  }
  if (context.runtime.session.current?.flowKey === storageRevokeAccessFlowKey) {
    return handleActiveRevokeAccessFlow(context, text, language);
  }
  if (context.runtime.session.current?.flowKey === storageViewAccessFlowKey) {
    return handleActiveViewAccessFlow(context, text, language);
  }

  if (text === '/storage' || text === texts.openMenu || text === actionMenuTexts.storage) {
    await handleTelegramStorageCommand(context);
    return true;
  }

  if (text === texts.listCategories) {
    const categories = canManageStorageCategories(context)
      ? await resolveRepository(context).listCategories()
      : await listReadableCategories(context);
    await context.reply(
      categories.length === 0
        ? texts.noReadableCategories
        : `${texts.categoriesHeader}\n${categories.map(formatStorageCategoryListItem).join('\n')}`,
      buildStorageMenuOptions(language, context),
    );
    return true;
  }

  if (text === texts.listFiles) {
    const categories = await listReadableCategories(context);
    if (categories.length === 0) {
      await context.reply(texts.noCategoriesForAction, buildStorageMenuOptions(language, context));
      return true;
    }
    await context.runtime.session.start({
      flowKey: storageListFlowKey,
      stepKey: 'list-category',
      data: {
        categories: categories.map((category) => ({ id: category.id, displayName: category.displayName })),
      },
    });
    await context.reply(texts.askListCategory, buildCategoryChoiceOptions(categories, language));
    return true;
  }

  if (text === texts.searchFiles) {
    await context.runtime.session.start({
      flowKey: storageSearchFlowKey,
      stepKey: 'search-query',
      data: {},
    });
    await context.reply(texts.askSearchQuery, buildSingleCancelOptions());
    return true;
  }

  if (text === texts.openEntry) {
    await context.runtime.session.start({
      flowKey: storageOpenEntryFlowKey,
      stepKey: 'open-entry-id',
      data: {},
    });
    await context.reply(texts.askOpenEntryId, buildSingleCancelOptions());
    return true;
  }

  if (text === texts.addImages) {
    await context.runtime.session.start({
      flowKey: storageAddImagesFlowKey,
      stepKey: 'add-images-entry-id',
      data: {},
    });
    await context.reply(texts.askAddImagesEntryId, buildSingleCancelOptions());
    return true;
  }

  if (text === texts.grantAccess && canManageStorageCategories(context)) {
    const categories = await resolveRepository(context).listCategories();
    if (categories.length === 0) {
      await context.reply(texts.noCategoriesForAction, buildStorageMenuOptions(language, context));
      return true;
    }
    await context.runtime.session.start({
      flowKey: storageGrantAccessFlowKey,
      stepKey: 'grant-access-category',
      data: {
        categories: categories.map((category) => ({ id: category.id, displayName: category.displayName })),
      },
    });
    await context.reply(texts.askGrantAccessCategory, buildCategoryChoiceOptions(categories, language));
    return true;
  }

  if (text === texts.viewAccess && canManageStorageCategories(context)) {
    const categories = await resolveRepository(context).listCategories();
    if (categories.length === 0) {
      await context.reply(texts.noCategoriesForAction, buildStorageMenuOptions(language, context));
      return true;
    }
    await context.runtime.session.start({
      flowKey: storageViewAccessFlowKey,
      stepKey: 'view-access-category',
      data: {
        categories: categories.map((category) => ({ id: category.id, displayName: category.displayName })),
      },
    });
    await context.reply(texts.askViewAccessCategory, buildCategoryChoiceOptions(categories, language));
    return true;
  }

  if (text === texts.revokeAccess && canManageStorageCategories(context)) {
    const categories = await resolveRepository(context).listCategories();
    if (categories.length === 0) {
      await context.reply(texts.noCategoriesForAction, buildStorageMenuOptions(language, context));
      return true;
    }
    await context.runtime.session.start({
      flowKey: storageRevokeAccessFlowKey,
      stepKey: 'revoke-access-category',
      data: {
        categories: categories.map((category) => ({ id: category.id, displayName: category.displayName })),
      },
    });
    await context.reply(texts.askRevokeAccessCategory, buildCategoryChoiceOptions(categories, language));
    return true;
  }

  if (text === texts.createCategory && canManageStorageCategories(context)) {
    await context.runtime.session.start({
      flowKey: storageCreateCategoryFlowKey,
      stepKey: 'create-category-slug',
      data: {},
    });
    await context.reply(texts.askCategorySlug, buildSingleCancelOptions());
    return true;
  }

  if (text === texts.archiveCategory && canManageStorageCategories(context)) {
    const categories = await resolveRepository(context).listCategories();
    if (categories.length === 0) {
      await context.reply(texts.noCategoriesForAction, buildStorageMenuOptions(language, context));
      return true;
    }
    await context.runtime.session.start({
      flowKey: storageArchiveCategoryFlowKey,
      stepKey: 'archive-category-select',
      data: {
        categories: categories.map((category) => ({ id: category.id, displayName: category.displayName })),
      },
    });
    await context.reply(texts.askArchiveCategory, buildCategoryChoiceOptions(categories, language));
    return true;
  }

  if (text === texts.reactivateCategory && canManageStorageCategories(context)) {
    const categories = (await resolveRepository(context).listCategories()).filter((category) => category.lifecycleStatus === 'archived');
    if (categories.length === 0) {
      await context.reply(texts.noCategoriesForAction, buildStorageMenuOptions(language, context));
      return true;
    }
    await context.runtime.session.start({
      flowKey: storageReactivateCategoryFlowKey,
      stepKey: 'reactivate-category-select',
      data: {
        categories: categories.map((category) => ({ id: category.id, displayName: category.displayName })),
      },
    });
    await context.reply(texts.askReactivateCategory, buildCategoryChoiceOptions(categories, language));
    return true;
  }

  if (text === texts.deleteEntry && canManageStorageEntries(context)) {
    await context.runtime.session.start({
      flowKey: storageDeleteEntryFlowKey,
      stepKey: 'delete-entry-id',
      data: {},
    });
    await context.reply(texts.askDeleteEntryId, buildSingleCancelOptions());
    return true;
  }

  if (text === texts.upload) {
    const categories = await listUploadableCategories(context);
    if (categories.length === 0) {
      await context.reply(texts.noCategoriesForAction, buildStorageMenuOptions(language, context));
      return true;
    }
    await context.runtime.session.start({
      flowKey: storageUploadFlowKey,
      stepKey: 'upload-category',
      data: {
        categories: categories.map((category) => ({ id: category.id, displayName: category.displayName })),
      },
    });
    await context.reply(texts.askUploadCategory, buildCategoryChoiceOptions(categories, language));
    return true;
  }

  return false;
}

async function handleActiveCreateCategoryFlow(context: StorageFlowContext, text: string, language: 'ca' | 'es' | 'en'): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageCreateCategoryFlowKey) {
    return false;
  }

  const texts = createTelegramI18n(language).storage;
  if (session.stepKey === 'create-category-slug') {
    await context.runtime.session.advance({
      stepKey: 'create-category-name',
      data: { slug: text },
    });
    await context.reply(texts.askCategoryName, buildSingleCancelOptions());
    return true;
  }

  if (session.stepKey === 'create-category-name') {
    await context.runtime.session.advance({
      stepKey: 'create-category-description',
      data: { ...session.data, displayName: text },
    });
    await context.reply(texts.askCategoryDescription, buildSkipOptionalOptions(language));
    return true;
  }

  if (session.stepKey === 'create-category-description') {
    await context.runtime.session.advance({
      stepKey: 'create-category-chat-select',
      data: { ...session.data, description: text === texts.skipOptional ? null : text },
    });
    await context.reply(texts.askCategoryStorageChat, buildStorageChatSelectOptions(language));
    return true;
  }

  if (session.stepKey === 'create-category-chat-select') {
    if (text === texts.manualCategorySetup) {
      await context.runtime.session.advance({
        stepKey: 'create-category-chat-id',
        data: session.data,
      });
      await context.reply(texts.askCategoryChatIdManual, buildSingleCancelOptions());
      return true;
    }

    const chatId = parseSignedInteger(text);
    if (chatId !== null) {
      await context.runtime.session.advance({
        stepKey: 'create-category-thread-id',
        data: { ...session.data, storageChatId: chatId },
      });
      await context.reply(texts.askCategoryThreadIdManual, buildSingleCancelOptions());
      return true;
    }

    await context.reply(texts.askCategoryStorageChat, buildStorageChatSelectOptions(language));
    return true;
  }

  if (session.stepKey === 'create-category-chat-id') {
    const chatId = parseSignedInteger(text);
    if (chatId === null) {
      await context.reply(texts.invalidNumber, buildSingleCancelOptions());
      return true;
    }
    await context.runtime.session.advance({
      stepKey: 'create-category-thread-id',
      data: { ...session.data, storageChatId: chatId },
    });
    await context.reply(texts.askCategoryThreadIdManual, buildSingleCancelOptions());
    return true;
  }

  if (session.stepKey === 'create-category-thread-id') {
    const threadId = parsePositiveInteger(text);
    if (threadId === null) {
      await context.reply(texts.invalidNumber, buildSingleCancelOptions());
      return true;
    }
    await createCategoryFromDraft(context, {
      language,
      storageChatId: asSignedNumber(session.data.storageChatId),
      storageThreadId: threadId,
      setupMode: 'manual',
    });
    return true;
  }

  return false;
}

async function handleActiveArchiveCategoryFlow(context: StorageFlowContext, text: string, language: 'ca' | 'es' | 'en'): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageArchiveCategoryFlowKey || session.stepKey !== 'archive-category-select') {
    return false;
  }

  const texts = createTelegramI18n(language).storage;
  const categories = asCategoryChoices(session.data.categories);
  const selected = categories.find((category) => category.displayName === text);
  if (!selected) {
    await context.reply(texts.invalidCategory, buildCategoryChoiceOptions(await resolveRepository(context).listCategories(), language));
    return true;
  }

  const archived = await setStorageCategoryLifecycleStatus({
    repository: resolveRepository(context),
    categoryId: selected.id,
    nextStatus: 'archived',
  });
  await appendAuditEvent({
    repository: resolveAuditRepository(context),
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    actionKey: 'storage.category.archived',
    targetType: 'storage-category',
    targetId: archived.id,
    summary: 'Categoria de storage arxivada',
  });
  await context.runtime.session.cancel();
  await context.reply(texts.categoryArchived.replace('{name}', archived.displayName), buildStorageMenuOptions(language, context));
  return true;
}

async function handleActiveReactivateCategoryFlow(context: StorageFlowContext, text: string, language: 'ca' | 'es' | 'en'): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageReactivateCategoryFlowKey || session.stepKey !== 'reactivate-category-select') {
    return false;
  }

  const texts = createTelegramI18n(language).storage;
  const categories = asCategoryChoices(session.data.categories);
  const selected = categories.find((category) => category.displayName === text);
  if (!selected) {
    await context.reply(
      texts.invalidCategory,
      buildCategoryChoiceOptions((await resolveRepository(context).listCategories()).filter((category) => category.lifecycleStatus === 'archived'), language),
    );
    return true;
  }

  const reactivated = await setStorageCategoryLifecycleStatus({
    repository: resolveRepository(context),
    categoryId: selected.id,
    nextStatus: 'active',
  });
  await appendAuditEvent({
    repository: resolveAuditRepository(context),
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    actionKey: 'storage.category.reactivated',
    targetType: 'storage-category',
    targetId: reactivated.id,
    summary: 'Categoria de storage reactivada',
  });
  await context.runtime.session.cancel();
  await context.reply(texts.categoryReactivated.replace('{name}', reactivated.displayName), buildStorageMenuOptions(language, context));
  return true;
}

async function handleActiveDeleteEntryFlow(context: StorageFlowContext, text: string, language: 'ca' | 'es' | 'en'): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageDeleteEntryFlowKey || session.stepKey !== 'delete-entry-id') {
    return false;
  }

  const texts = createTelegramI18n(language).storage;
  const entryId = parsePositiveInteger(text);
  if (entryId === null) {
    await context.reply(texts.invalidNumber, buildStorageMenuOptions(language, context));
    return true;
  }

  const detail = await resolveRepository(context).getEntryDetail(entryId);
  if (!detail || !canManageStorageEntries(context)) {
    await context.reply(texts.invalidEntryId, buildSingleCancelOptions());
    return true;
  }

  await resolveRepository(context).updateEntryLifecycleStatus({
    entryId,
    lifecycleStatus: 'deleted',
    deletedByTelegramUserId: context.runtime.actor.telegramUserId,
  });
  await appendAuditEvent({
    repository: resolveAuditRepository(context),
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    actionKey: 'storage.entry.deleted',
    targetType: 'storage-entry',
    targetId: entryId,
    summary: 'Entrada de storage esborrada logicament',
  });
  await context.runtime.session.cancel();
  await context.reply(texts.entryDeleted.replace('{id}', String(entryId)), buildStorageMenuOptions(language, context));
  return true;
}

async function handleActiveGrantAccessFlow(context: StorageFlowContext, text: string, language: 'ca' | 'es' | 'en'): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageGrantAccessFlowKey) {
    return false;
  }

  const texts = createTelegramI18n(language).storage;
  if (session.stepKey === 'grant-access-category') {
    const categories = asCategoryChoices(session.data.categories);
    const selected = categories.find((category) => category.displayName === text);
    if (!selected) {
      await context.reply(texts.invalidCategory, buildCategoryChoiceOptions(await resolveRepository(context).listCategories(), language));
      return true;
    }
    const users = await resolveStorageCategoryAccessRepository(context).listApprovedUsers();
    if (users.length === 0) {
      await context.runtime.session.cancel();
      await context.reply(texts.noApprovedUsersForAccess, buildStorageMenuOptions(language, context));
      return true;
    }
    await context.runtime.session.advance({
      stepKey: 'grant-access-user',
      data: {
        categoryId: selected.id,
        categoryDisplayName: selected.displayName,
        users: users.map(toStorageUserChoice),
      },
    });
    await context.reply(texts.askGrantAccessUser, buildStorageUserChoiceOptions(users, language));
    return true;
  }

  if (session.stepKey === 'grant-access-user') {
    const userChoices = asStorageUserChoices(session.data.users);
    const userId = resolveSelectedStorageUserId(text, userChoices);
    if (userId === null) {
      await context.reply(texts.invalidUserChoice, buildStorageUserChoiceOptions(userChoices, language));
      return true;
    }

    const accessRepository = resolveStorageCategoryAccessRepository(context);
    const user = await accessRepository.findUserByTelegramUserId(userId);
    if (!user) {
      await context.reply(texts.invalidUserId, buildStorageMenuOptions(language, context));
      return true;
    }
    if (user.status !== 'approved') {
      await context.reply(texts.userMustBeApproved, buildStorageMenuOptions(language, context));
      return true;
    }

    await accessRepository.grantCategoryAccess({
      subjectTelegramUserId: userId,
      categoryId: asNumber(session.data.categoryId),
      changedByTelegramUserId: context.runtime.actor.telegramUserId,
    });
    await context.runtime.session.cancel();
    await context.reply(
      texts.categoryAccessGranted
        .replace('{user}', formatStorageUserLabel(userChoices.find((user) => user.telegramUserId === userId) ?? user))
        .replace('{category}', String(session.data.categoryDisplayName ?? '')),
      buildStorageMenuOptions(language, context),
    );
    return true;
  }

  return false;
}

async function handleActiveRevokeAccessFlow(context: StorageFlowContext, text: string, language: 'ca' | 'es' | 'en'): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageRevokeAccessFlowKey) {
    return false;
  }

  const texts = createTelegramI18n(language).storage;
  if (session.stepKey === 'revoke-access-category') {
    const categories = asCategoryChoices(session.data.categories);
    const selected = categories.find((category) => category.displayName === text);
    if (!selected) {
      await context.reply(texts.invalidCategory, buildCategoryChoiceOptions(await resolveRepository(context).listCategories(), language));
      return true;
    }
    const users = await resolveStorageCategoryAccessRepository(context).listCategoryAccessUsers(selected.id);
    if (users.length === 0) {
      await context.runtime.session.cancel();
      await context.reply(texts.noCategoryAccessUsers, buildStorageMenuOptions(language, context));
      return true;
    }
    await context.runtime.session.advance({
      stepKey: 'revoke-access-user',
      data: {
        categoryId: selected.id,
        categoryDisplayName: selected.displayName,
        users: users.map(toStorageUserChoice),
      },
    });
    await context.reply(texts.askRevokeAccessUser, buildStorageUserChoiceOptions(users, language));
    return true;
  }

  if (session.stepKey === 'revoke-access-user') {
    const userChoices = asStorageUserChoices(session.data.users);
    const userId = resolveSelectedStorageUserId(text, userChoices);
    if (userId === null) {
      await context.reply(texts.invalidUserChoice, buildStorageUserChoiceOptions(userChoices, language));
      return true;
    }

    const accessRepository = resolveStorageCategoryAccessRepository(context);
    const user = await accessRepository.findUserByTelegramUserId(userId);
    if (!user) {
      await context.reply(texts.invalidUserId, buildStorageMenuOptions(language, context));
      return true;
    }

    await accessRepository.revokeCategoryAccess({
      subjectTelegramUserId: userId,
      categoryId: asNumber(session.data.categoryId),
      changedByTelegramUserId: context.runtime.actor.telegramUserId,
    });
    await context.runtime.session.cancel();
    await context.reply(
      texts.categoryAccessRevoked
        .replace('{user}', formatStorageUserLabel(userChoices.find((user) => user.telegramUserId === userId) ?? user))
        .replace('{category}', String(session.data.categoryDisplayName ?? '')),
      buildStorageMenuOptions(language, context),
    );
    return true;
  }

  return false;
}

async function handleActiveViewAccessFlow(context: StorageFlowContext, text: string, language: 'ca' | 'es' | 'en'): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageViewAccessFlowKey || session.stepKey !== 'view-access-category') {
    return false;
  }

  const texts = createTelegramI18n(language).storage;
  const categories = asCategoryChoices(session.data.categories);
  const selected = categories.find((category) => category.displayName === text);
  if (!selected) {
    await context.reply(texts.invalidCategory, buildCategoryChoiceOptions(await resolveRepository(context).listCategories(), language));
    return true;
  }

  const users = await resolveStorageCategoryAccessRepository(context).listCategoryAccessUsers(selected.id);
  await context.runtime.session.cancel();
  await context.reply(formatCategoryAccessMessage({
    categoryDisplayName: selected.displayName,
    users,
    language,
  }), buildStorageMenuOptions(language, context));
  return true;
}

async function handleActiveListFlow(context: StorageFlowContext, text: string, language: 'ca' | 'es' | 'en'): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageListFlowKey || session.stepKey !== 'list-category') {
    return false;
  }

  const texts = createTelegramI18n(language).storage;
  const categories = asCategoryChoices(session.data.categories);
  const selected = categories.find((category) => category.displayName === text);
  if (!selected) {
    await context.reply(texts.invalidCategory, buildCategoryChoiceOptions(await listReadableCategories(context), language));
    return true;
  }

  const repository = resolveRepository(context);
  const details = await repository.listEntryDetailsByCategory(selected.id);
  await context.runtime.session.cancel();
  if (details.length === 0) {
    await context.reply(texts.noEntriesInCategory, buildStorageMenuOptions(language, context));
    return true;
  }

  await context.reply(
    formatStorageListMessage({
      categoryDisplayName: selected.displayName,
      details,
      language,
    }),
    { ...buildStorageMenuOptions(language, context), parseMode: 'HTML' },
  );
  return true;
}

async function handleActiveSearchFlow(context: StorageFlowContext, text: string, language: 'ca' | 'es' | 'en'): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageSearchFlowKey || session.stepKey !== 'search-query') {
    return false;
  }

  const texts = createTelegramI18n(language).storage;
  const categories = await listReadableCategories(context);
  const details = await resolveRepository(context).searchEntryDetails({
    categoryIds: categories.map((category) => category.id),
    query: text,
  });
  await context.runtime.session.cancel();
  await context.reply(
    details.length === 0
      ? texts.noSearchResults
      : `${escapeHtml(texts.searchResultsHeader)}\n${details.slice(0, storageListPageSize).map((detail) => formatStorageSummaryEntry(detail, language, { includeCategory: true })).join('\n')}${details.length > storageListPageSize ? `\n${escapeHtml(formatStorageListLimitedFooter(details.length, storageListPageSize, language))}` : ''}`,
    details.length === 0 ? buildStorageMenuOptions(language, context) : { ...buildStorageMenuOptions(language, context), parseMode: 'HTML' },
  );
  return true;
}

async function handleActiveOpenEntryFlow(context: StorageFlowContext, text: string, language: 'ca' | 'es' | 'en'): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageOpenEntryFlowKey || session.stepKey !== 'open-entry-id') {
    return false;
  }

  const texts = createTelegramI18n(language).storage;
  const entryId = parsePositiveInteger(text);
  if (entryId === null) {
    await context.reply(texts.invalidNumber, buildStorageMenuOptions(language, context));
    return true;
  }

  const detail = await resolveRepository(context).getEntryDetail(entryId);
  if (
    !detail ||
    detail.entry.lifecycleStatus !== 'active' ||
    !context.runtime.authorization.can('storage.entry.read', { type: 'storage-category', id: String(detail.category.id) })
  ) {
    await context.reply(texts.invalidEntryId, buildStorageMenuOptions(language, context));
    return true;
  }

  await context.runtime.session.cancel();
  return sendStorageEntryDetail(context, detail.entry.id, language, detail);
}

async function sendStorageEntryDetail(
  context: StorageFlowContext,
  entryId: number,
  language: 'ca' | 'es' | 'en',
  loadedDetail?: StorageEntryDetailRecord,
): Promise<boolean> {
  const texts = createTelegramI18n(language).storage;
  const detail = loadedDetail ?? await resolveRepository(context).getEntryDetail(entryId);
  if (
    !detail ||
    detail.entry.lifecycleStatus !== 'active' ||
    !context.runtime.authorization.can('storage.entry.read', { type: 'storage-category', id: String(detail.category.id) })
  ) {
    await context.reply(texts.invalidEntryId, buildStorageMenuOptions(language, context));
    return true;
  }

  await context.reply(formatStorageEntryDetail(detail, language), { ...buildStorageMenuOptions(language, context), parseMode: 'HTML' });

  try {
    await copyStorageEntryToCurrentChat(context, detail);
  } catch {
    await resolveRepository(context).updateEntryLifecycleStatus({
      entryId: detail.entry.id,
      lifecycleStatus: 'missing_source',
    });
    await appendAuditEvent({
      repository: resolveAuditRepository(context),
      actorTelegramUserId: context.runtime.actor.telegramUserId,
      actionKey: 'storage.entry.missing_source',
      targetType: 'storage-entry',
      targetId: detail.entry.id,
      summary: 'Entrada de storage marcada com a font perduda',
    });
    await context.reply(texts.entrySourceMissing.replace('{id}', String(detail.entry.id)), buildStorageMenuOptions(language, context));
    return true;
  }

  await context.reply(
    texts.entryOpened
      .replace('{id}', String(detail.entry.id))
      .replace('{category}', detail.category.displayName)
      .replace('{count}', String(detail.messages.length)),
    buildStorageMenuOptions(language, context),
  );
  return true;
}

async function handleActiveAddImagesFlow(context: StorageFlowContext, text: string, language: 'ca' | 'es' | 'en'): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageAddImagesFlowKey) {
    return false;
  }

  const texts = createTelegramI18n(language).storage;
  if (session.stepKey === 'add-images-entry-id') {
    const entryId = parsePositiveInteger(text);
    if (entryId === null) {
      await context.reply(texts.invalidNumber, buildSingleCancelOptions());
      return true;
    }

    const detail = await resolveRepository(context).getEntryDetail(entryId);
    if (
      !detail ||
      detail.entry.lifecycleStatus !== 'active' ||
      !context.runtime.authorization.can('storage.entry.upload', { type: 'storage-category', id: String(detail.category.id) })
    ) {
      await context.reply(texts.invalidEntryId, buildStorageMenuOptions(language, context));
      return true;
    }

    await context.runtime.session.advance({
      stepKey: 'add-images-media',
      data: {
        entryId: detail.entry.id,
        categoryId: detail.category.id,
        messages: [],
      },
    });
    await context.reply(texts.askAddImagesMedia, buildUploadMediaOptions(language));
    return true;
  }

  if (session.stepKey === 'add-images-media') {
    if (text !== texts.finishAttachments) {
      return false;
    }

    const messages = asDraftMessages(session.data.messages);
    if (messages.length === 0) {
      await context.reply(texts.addImagesNeedsImage, buildUploadMediaOptions(language));
      return true;
    }

    const updated = await persistEntryImageAppend({
      context,
      entryId: asNumber(session.data.entryId),
      messages,
    });
    await appendAuditEvent({
      repository: resolveAuditRepository(context),
      actorTelegramUserId: context.runtime.actor.telegramUserId,
      actionKey: 'storage.entry.images_added',
      targetType: 'storage-entry',
      targetId: updated.entry.id,
      summary: 'Imatges afegides a entrada de storage',
      details: { count: messages.length },
    });
    await context.runtime.session.cancel();
    await context.reply(
      texts.imagesAdded
        .replace('{id}', String(updated.entry.id))
        .replace('{count}', String(messages.length)),
      buildStorageMenuOptions(language, context),
    );
    return true;
  }

  return false;
}

export async function handleTelegramStorageMessage(context: StorageFlowContext): Promise<boolean> {
  if (context.sharedChat && context.runtime.chat.kind === 'private' && context.runtime.session.current?.flowKey === storageCreateCategoryFlowKey) {
    return handleSharedStorageChat(context);
  }

  if (!context.messageMedia) {
    return false;
  }

  if (context.runtime.chat.kind === 'private' && context.runtime.session.current?.flowKey === storageUploadFlowKey) {
    return handlePrivateUploadMedia(context);
  }

  if (context.runtime.chat.kind === 'private' && context.runtime.session.current?.flowKey === storageAddImagesFlowKey) {
    return handlePrivateAddImagesMedia(context);
  }

  if (context.runtime.chat.kind === 'group' || context.runtime.chat.kind === 'group-news') {
    return handleTopicUpload(context);
  }

  return false;
}

async function handleSharedStorageChat(context: StorageFlowContext): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageCreateCategoryFlowKey || session.stepKey !== 'create-category-chat-select' || !context.sharedChat) {
    return false;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).storage;
  if (context.sharedChat.requestId !== storageChatRequestId) {
    await context.reply(texts.invalidSharedChatRequest, buildStorageChatSelectOptions(language));
    return true;
  }

  const validation = await validateStorageChatSelection(context, context.sharedChat.chatId);
  if (!validation.ok) {
    await context.reply(validation.message, buildStorageChatSelectOptions(language));
    return true;
  }

  const topicName = String(session.data.displayName ?? texts.openMenu).trim() || texts.openMenu;
  await context.reply(texts.creatingCategoryTopic.replace('{chat}', validation.chatTitle), buildSingleCancelOptions());
  try {
    const topic = await context.runtime.bot.createForumTopic?.({ chatId: context.sharedChat.chatId, name: topicName });
    if (!topic) {
      await context.reply(texts.storageBotCannotCreateTopic, buildStorageChatSelectOptions(language));
      return true;
    }

    await createCategoryFromDraft(context, {
      language,
      storageChatId: context.sharedChat.chatId,
      storageThreadId: topic.messageThreadId,
      setupMode: 'guided',
      chatTitle: validation.chatTitle,
      topicName: topic.name,
    });
  } catch {
    await context.reply(texts.storageTopicCreateFailed, buildStorageChatSelectOptions(language));
  }

  return true;
}

async function validateStorageChatSelection(context: StorageFlowContext, chatId: number): Promise<
  | { ok: true; chatTitle: string }
  | { ok: false; message: string }
> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).storage;
  if (!context.runtime.bot.getChat || !context.runtime.bot.getMe || !context.runtime.bot.getChatMember || !context.runtime.bot.createForumTopic) {
    return { ok: false, message: texts.storageGuidedSetupUnavailable };
  }

  try {
    const chat = await context.runtime.bot.getChat(chatId);
    const chatTitle = chat.title?.trim() || String(chat.id);
    if (chat.type !== 'supergroup') {
      return { ok: false, message: texts.storageChatMustBeSupergroup };
    }
    if (chat.isForum !== true) {
      return { ok: false, message: texts.storageChatMustHaveTopics };
    }

    const me = await context.runtime.bot.getMe();
    const member = await context.runtime.bot.getChatMember(chatId, me.id);
    if (!['administrator', 'creator'].includes(member.status)) {
      return { ok: false, message: texts.storageBotMustBeAdmin };
    }
    if (member.status !== 'creator' && member.canManageTopics !== true) {
      return { ok: false, message: texts.storageBotCannotManageTopics };
    }

    return { ok: true, chatTitle };
  } catch {
    return { ok: false, message: texts.storageChatValidationFailed };
  }
}

async function createCategoryFromDraft(
  context: StorageFlowContext,
  {
    language,
    storageChatId,
    storageThreadId,
    setupMode,
    chatTitle,
    topicName,
  }: {
    language: 'ca' | 'es' | 'en';
    storageChatId: number;
    storageThreadId: number;
    setupMode: 'guided' | 'manual';
    chatTitle?: string;
    topicName?: string;
  },
): Promise<void> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageCreateCategoryFlowKey) {
    throw new Error('Storage category creation requires an active session');
  }

  const texts = createTelegramI18n(language).storage;
  const created = await createStorageCategory({
    repository: resolveRepository(context),
    slug: String(session.data.slug ?? ''),
    displayName: String(session.data.displayName ?? ''),
    description: asNullableString(session.data.description),
    storageChatId,
    storageThreadId,
  });
  await appendAuditEvent({
    repository: resolveAuditRepository(context),
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    actionKey: 'storage.category.created',
    targetType: 'storage-category',
    targetId: created.id,
    summary: 'Categoria de storage creada',
    details: { slug: created.slug, setupMode, storageChatId, storageThreadId },
  });
  await context.runtime.session.cancel();
  const message = setupMode === 'guided'
    ? texts.categoryCreatedGuided
      .replace('{name}', created.displayName)
      .replace('{slug}', created.slug)
      .replace('{chat}', chatTitle ?? String(storageChatId))
      .replace('{topic}', topicName ?? String(storageThreadId))
    : texts.categoryCreated.replace('{name}', created.displayName).replace('{slug}', created.slug);
  await context.reply(message, buildStorageMenuOptions(language, context));
}

async function handleActiveUploadFlow(context: StorageFlowContext, text: string, language: 'ca' | 'es' | 'en'): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageUploadFlowKey) {
    return false;
  }

  const texts = createTelegramI18n(language).storage;
  if (session.stepKey === 'upload-category') {
    const categories = asCategoryChoices(session.data.categories);
    const selected = categories.find((category) => category.displayName === text);
    if (!selected) {
      await context.reply(texts.invalidCategory, buildCategoryChoiceOptions(await listUploadableCategories(context), language));
      return true;
    }

    await context.runtime.session.advance({
      stepKey: 'upload-media',
      data: { categoryId: selected.id, categoryDisplayName: selected.displayName, messages: [] },
    });
    await context.reply(texts.askUploadMedia, buildUploadMediaOptions(language));
    return true;
  }

  if (session.stepKey === 'upload-media') {
    if (text !== texts.finishAttachments) {
      return false;
    }

    const messages = asDraftMessages(session.data.messages);
    if (messages.length === 0) {
      await context.reply(texts.uploadNeedsAttachment, buildUploadMediaOptions(language));
      return true;
    }

    await context.runtime.session.advance({
      stepKey: 'upload-description',
      data: { ...session.data, messages },
    });
    await context.reply(texts.askDescription, buildSkipOptionalOptions(language));
    return true;
  }

  if (session.stepKey === 'upload-description') {
    await context.runtime.session.advance({
      stepKey: 'upload-tags',
      data: {
        ...session.data,
        description: text === texts.skipOptional ? null : text,
      },
    });
    await context.reply(texts.askTags, buildSkipOptionalOptions(language));
    return true;
  }

  if (session.stepKey === 'upload-tags') {
    const description = asNullableString(session.data.description);
    const tags = text === texts.skipOptional ? [] : parseStorageCaptionMetadata(text).tags;
    const saved = await persistPrivateUpload({
      context,
      categoryId: asNumber(session.data.categoryId),
      categoryDisplayName: String(session.data.categoryDisplayName ?? ''),
      description,
      tags,
      messages: asDraftMessages(session.data.messages),
    });
    await context.runtime.session.cancel();
    await context.reply(
      texts.saved
        .replace('{category}', saved.category.displayName)
        .replace('{count}', String(saved.messages.length)),
      buildStorageMenuOptions(language, context),
    );
    return true;
  }

  return false;
}

async function handlePrivateUploadMedia(context: StorageFlowContext): Promise<boolean> {
  const session = context.runtime.session.current;
  const media = context.messageMedia;
  if (!session || session.stepKey !== 'upload-media' || !media || !isSupportedAttachmentKind(media.attachmentKind)) {
    return false;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).storage;
  const draftMessages = asDraftMessages(session.data.messages);
  draftMessages.push({
    fromChatId: context.runtime.chat.chatId,
    fromMessageId: media.messageId,
    attachmentKind: media.attachmentKind,
    telegramFileId: media.fileId ?? null,
    telegramFileUniqueId: media.fileUniqueId ?? null,
    caption: media.caption ?? null,
    originalFileName: media.originalFileName ?? null,
    mimeType: media.mimeType ?? null,
    fileSizeBytes: media.fileSizeBytes ?? null,
    mediaGroupId: media.mediaGroupId ?? null,
    sortOrder: draftMessages.length,
  });

  await context.runtime.session.advance({
    stepKey: 'upload-media',
    data: {
      ...session.data,
      messages: draftMessages,
    },
  });
  await context.reply(texts.uploadRecorded.replace('{count}', String(draftMessages.length)), buildUploadMediaOptions(language));
  return true;
}

async function handlePrivateAddImagesMedia(context: StorageFlowContext): Promise<boolean> {
  const session = context.runtime.session.current;
  const media = context.messageMedia;
  if (!session || session.stepKey !== 'add-images-media' || !media) {
    return false;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).storage;
  if (media.attachmentKind !== 'photo') {
    await context.reply(texts.addImagesNeedsPhoto, buildUploadMediaOptions(language));
    return true;
  }

  const draftMessages = asDraftMessages(session.data.messages);
  draftMessages.push({
    fromChatId: context.runtime.chat.chatId,
    fromMessageId: media.messageId,
    attachmentKind: media.attachmentKind,
    telegramFileId: media.fileId ?? null,
    telegramFileUniqueId: media.fileUniqueId ?? null,
    caption: media.caption ?? null,
    originalFileName: media.originalFileName ?? null,
    mimeType: media.mimeType ?? null,
    fileSizeBytes: media.fileSizeBytes ?? null,
    mediaGroupId: media.mediaGroupId ?? null,
    sortOrder: draftMessages.length,
  });

  await context.runtime.session.advance({
    stepKey: 'add-images-media',
    data: {
      ...session.data,
      messages: draftMessages,
    },
  });
  await context.reply(texts.imageRecorded.replace('{count}', String(draftMessages.length)), buildUploadMediaOptions(language));
  return true;
}

async function handleTopicUpload(context: StorageFlowContext): Promise<boolean> {
  const media = context.messageMedia;
  if (!context.messageThreadId || !media || !isSupportedAttachmentKind(media.attachmentKind)) {
    return false;
  }

  if (!context.runtime.actor.isApproved || context.runtime.actor.isBlocked) {
    return false;
  }

  const repository = resolveRepository(context);
  const category = await repository.findCategoryByStorageThread(context.runtime.chat.chatId, context.messageThreadId);
  if (!category) {
    return false;
  }

  if (!context.runtime.authorization.can('storage.entry.upload', { type: 'storage-category', id: String(category.id) })) {
    return false;
  }

  if (media.mediaGroupId) {
    queueStorageTopicMediaGroupMessage({
      repository,
      categoryId: category.id,
      createdByTelegramUserId: context.runtime.actor.telegramUserId,
      storageChatId: context.runtime.chat.chatId,
      storageThreadId: context.messageThreadId,
      storageMessageId: media.messageId,
      telegramFileId: media.fileId ?? null,
      telegramFileUniqueId: media.fileUniqueId ?? null,
      attachmentKind: media.attachmentKind,
      caption: media.caption ?? null,
      originalFileName: media.originalFileName ?? null,
      mimeType: media.mimeType ?? null,
      fileSizeBytes: media.fileSizeBytes ?? null,
      mediaGroupId: media.mediaGroupId,
    });
    return true;
  }

  const metadata = parseStorageCaptionMetadata(context.messageMedia?.caption ?? null);
  await createStorageEntry({
    repository,
    categoryId: category.id,
    createdByTelegramUserId: context.runtime.actor.telegramUserId,
    sourceKind: 'topic_direct',
    description: metadata.description,
    tags: metadata.tags,
    messages: [
      {
        storageChatId: context.runtime.chat.chatId,
        storageMessageId: media.messageId,
        storageThreadId: context.messageThreadId,
        telegramFileId: media.fileId ?? null,
        telegramFileUniqueId: media.fileUniqueId ?? null,
        attachmentKind: media.attachmentKind,
        caption: media.caption ?? null,
        originalFileName: media.originalFileName ?? null,
        mimeType: media.mimeType ?? null,
        fileSizeBytes: media.fileSizeBytes ?? null,
        mediaGroupId: media.mediaGroupId ?? null,
        sortOrder: 0,
      },
    ],
  });
  return true;
}

async function persistPrivateUpload({
  context,
  categoryId,
  categoryDisplayName,
  description,
  tags,
  messages,
}: {
  context: StorageFlowContext;
  categoryId: number;
  categoryDisplayName: string;
  description: string | null;
  tags: string[];
  messages: DmUploadDraftMessage[];
}) {
  const repository = resolveRepository(context);
  const texts = createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca')).storage;
  const category = await repository.findCategoryById(categoryId);
  if (!category) {
    throw new Error(`Storage category ${categoryId} not found`);
  }
  if (!context.runtime.bot.copyMessage) {
    throw new Error('Telegram bot runtime does not support copyMessage');
  }

  const copiedMessages = [] as Array<{
      storageChatId: number;
      storageMessageId: number;
      storageThreadId: number;
      telegramFileId: string | null;
      telegramFileUniqueId: string | null;
      attachmentKind: DmUploadDraftMessage['attachmentKind'];
      caption: string | null;
      originalFileName: string | null;
      mimeType: string | null;
    fileSizeBytes: number | null;
    mediaGroupId: string | null;
    sortOrder: number;
  }>;

  try {
    for (const message of messages) {
      const copied = await context.runtime.bot.copyMessage({
        fromChatId: message.fromChatId,
        messageId: message.fromMessageId,
        toChatId: category.storageChatId,
        messageThreadId: category.storageThreadId,
      });
      copiedMessages.push({
        storageChatId: category.storageChatId,
        storageMessageId: copied.messageId,
        storageThreadId: category.storageThreadId,
        telegramFileId: message.telegramFileId,
        telegramFileUniqueId: message.telegramFileUniqueId,
        attachmentKind: message.attachmentKind,
        caption: message.caption,
        originalFileName: message.originalFileName,
        mimeType: message.mimeType,
        fileSizeBytes: message.fileSizeBytes,
        mediaGroupId: message.mediaGroupId,
        sortOrder: message.sortOrder,
      });
    }

    return await createStorageEntry({
      repository,
      categoryId,
      createdByTelegramUserId: context.runtime.actor.telegramUserId,
      sourceKind: 'dm_copy',
      description,
      tags,
      messages: copiedMessages,
    });
  } catch (error) {
    await cleanupCopiedStorageMessages(context, copiedMessages);
    throw new TelegramInteractionError(texts.saveFailed, { cancelSession: true });
  }
}

async function persistEntryImageAppend({
  context,
  entryId,
  messages,
}: {
  context: StorageFlowContext;
  entryId: number;
  messages: DmUploadDraftMessage[];
}): Promise<StorageEntryDetailRecord> {
  const repository = resolveRepository(context);
  const texts = createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca')).storage;
  const detail = await repository.getEntryDetail(entryId);
  if (!detail) {
    throw new Error(`Storage entry ${entryId} not found`);
  }
  if (!context.runtime.bot.copyMessage) {
    throw new Error('Telegram bot runtime does not support copyMessage');
  }

  const copiedMessages = [] as Array<{
    storageChatId: number;
    storageMessageId: number;
    storageThreadId: number;
    telegramFileId: string | null;
    telegramFileUniqueId: string | null;
    attachmentKind: DmUploadDraftMessage['attachmentKind'];
    caption: string | null;
    originalFileName: string | null;
    mimeType: string | null;
    fileSizeBytes: number | null;
    mediaGroupId: string | null;
    sortOrder: number;
  }>;

  try {
    for (const message of messages) {
      const copied = await context.runtime.bot.copyMessage({
        fromChatId: message.fromChatId,
        messageId: message.fromMessageId,
        toChatId: detail.category.storageChatId,
        messageThreadId: detail.category.storageThreadId,
      });
      copiedMessages.push({
        storageChatId: detail.category.storageChatId,
        storageMessageId: copied.messageId,
        storageThreadId: detail.category.storageThreadId,
        telegramFileId: message.telegramFileId,
        telegramFileUniqueId: message.telegramFileUniqueId,
        attachmentKind: message.attachmentKind,
        caption: message.caption,
        originalFileName: message.originalFileName,
        mimeType: message.mimeType,
        fileSizeBytes: message.fileSizeBytes,
        mediaGroupId: message.mediaGroupId,
        sortOrder: message.sortOrder,
      });
    }

    return await repository.appendEntryMessages({
      entryId,
      messages: copiedMessages,
    });
  } catch {
    await cleanupCopiedStorageMessages(context, copiedMessages);
    throw new TelegramInteractionError(texts.saveFailed, { cancelSession: true });
  }
}

function queueStorageTopicMediaGroupMessage({
  repository,
  categoryId,
  createdByTelegramUserId,
  storageChatId,
  storageThreadId,
  storageMessageId,
  telegramFileId,
  telegramFileUniqueId,
  attachmentKind,
  caption,
  originalFileName,
  mimeType,
  fileSizeBytes,
  mediaGroupId,
}: {
  repository: StorageCategoryRepository;
  categoryId: number;
  createdByTelegramUserId: number;
  storageChatId: number;
  storageThreadId: number;
  storageMessageId: number;
  telegramFileId: string | null;
  telegramFileUniqueId: string | null;
  attachmentKind: DmUploadDraftMessage['attachmentKind'];
  caption: string | null;
  originalFileName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  mediaGroupId: string;
}): void {
  const key = buildStorageTopicMediaGroupKey({ chatId: storageChatId, threadId: storageThreadId, mediaGroupId });
  const existing = pendingStorageTopicMediaGroups.get(key);

  if (existing?.timer) {
    clearTimeout(existing.timer);
  }

  const pending = existing ?? {
    repository,
    categoryId,
    createdByTelegramUserId,
    messages: [],
    timer: null,
  };

  pending.messages.push({
    storageChatId,
    storageMessageId,
    storageThreadId,
    telegramFileId,
    telegramFileUniqueId,
    attachmentKind,
    caption,
    originalFileName,
    mimeType,
    fileSizeBytes,
    mediaGroupId,
    sortOrder: pending.messages.length,
  });

  pending.timer = setTimeout(() => {
    void flushStorageTopicMediaGroupByKey(key).catch((error) => {
      console.error('Storage topic media group flush failed', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, storageTopicMediaGroupWindowMs);

  pendingStorageTopicMediaGroups.set(key, pending);
}

async function flushStorageTopicMediaGroupByKey(key: string): Promise<void> {
  const pending = pendingStorageTopicMediaGroups.get(key);
  if (!pending) {
    return;
  }

  if (pending.timer) {
    clearTimeout(pending.timer);
  }
  pendingStorageTopicMediaGroups.delete(key);

  const sortedMessages = [...pending.messages].sort((left, right) => left.storageMessageId - right.storageMessageId);
  const captionSource = sortedMessages.find((message) => Boolean(message.caption))?.caption ?? null;
  const metadata = parseStorageCaptionMetadata(captionSource);

  await createStorageEntry({
    repository: pending.repository,
    categoryId: pending.categoryId,
    createdByTelegramUserId: pending.createdByTelegramUserId,
    sourceKind: 'topic_direct',
    description: metadata.description,
    tags: metadata.tags,
    messages: sortedMessages.map((message, index) => ({
      ...message,
      sortOrder: index,
    })),
  });
}

function buildStorageTopicMediaGroupKey({
  chatId,
  threadId,
  mediaGroupId,
}: {
  chatId: number;
  threadId: number;
  mediaGroupId: string;
}): string {
  return `${chatId}:${threadId}:${mediaGroupId}`;
}

export async function __flushStorageTopicMediaGroupForTests({
  chatId,
  threadId,
  mediaGroupId,
}: {
  chatId: number;
  threadId: number;
  mediaGroupId: string;
}): Promise<void> {
  await flushStorageTopicMediaGroupByKey(buildStorageTopicMediaGroupKey({ chatId, threadId, mediaGroupId }));
}

export function __resetStorageTopicMediaGroupsForTests(): void {
  for (const pending of pendingStorageTopicMediaGroups.values()) {
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
  }
  pendingStorageTopicMediaGroups.clear();
}

async function cleanupCopiedStorageMessages(
  context: StorageFlowContext,
  copiedMessages: Array<{ storageChatId: number; storageMessageId: number }>,
): Promise<void> {
  if (!context.runtime.bot.deleteMessage) {
    return;
  }

  for (const copiedMessage of copiedMessages) {
    try {
      await context.runtime.bot.deleteMessage({
        chatId: copiedMessage.storageChatId,
        messageId: copiedMessage.storageMessageId,
      });
    } catch (error) {
      console.error('Storage copied message cleanup failed', {
        chatId: copiedMessage.storageChatId,
        messageId: copiedMessage.storageMessageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function listReadableCategories(context: StorageFlowContext): Promise<StorageCategoryRecord[]> {
  const categories = await resolveRepository(context).listCategories();
  return categories.filter(
    (category) =>
      category.lifecycleStatus === 'active' &&
      context.runtime.authorization.can('storage.entry.read', { type: 'storage-category', id: String(category.id) }),
  );
}

async function listUploadableCategories(context: StorageFlowContext): Promise<StorageCategoryRecord[]> {
  const categories = await resolveRepository(context).listCategories();
  return categories.filter(
    (category) =>
      category.lifecycleStatus === 'active' &&
      context.runtime.authorization.can('storage.entry.upload', { type: 'storage-category', id: String(category.id) }),
  );
}

function resolveRepository(context: StorageFlowContext): StorageCategoryRepository {
  return context.storageRepository ?? createDatabaseStorageRepository({ database: context.runtime.services.database.db });
}

function resolveStorageCategoryAccessRepository(context: StorageFlowContext): StorageCategoryAccessRepository {
  return context.storageCategoryAccessRepository ?? createDatabaseStorageCategoryAccessRepository({ database: context.runtime.services.database.db });
}

function resolveAuditRepository(context: StorageFlowContext) {
  return createDatabaseAuditLogRepository({ database: context.runtime.services.database.db as never });
}

function buildStorageMenuOptions(language: 'ca' | 'es' | 'en', context?: StorageFlowContext): TelegramReplyOptions {
  const texts = createTelegramI18n(language).storage;
  const rows: Array<Array<string | TelegramReplyButton>> = [
    [primaryButton(texts.listCategories), primaryButton(texts.listFiles)],
    [secondaryButton(texts.searchFiles), primaryButton(texts.openEntry)],
    [successButton(texts.upload), successButton(texts.addImages)],
  ];
  if (context && canManageStorageCategories(context)) {
    rows.push(
      [successButton(texts.createCategory), dangerButton(texts.archiveCategory)],
      [successButton(texts.reactivateCategory), secondaryButton(texts.viewAccess)],
      [successButton(texts.grantAccess), dangerButton(texts.revokeAccess)],
    );
  }
  if (context && canManageStorageEntries(context)) {
    rows.push([dangerButton(texts.deleteEntry)]);
  }
  rows.push(buildGlobalNavigationRow(language));
  return buildPersistentReplyKeyboard(rows);
}

function buildStorageUserChoiceOptions(
  users: Array<StorageCategoryAccessUserRecord | StorageUserChoice>,
  language: 'ca' | 'es' | 'en',
): TelegramReplyOptions {
  return {
    replyKeyboard: [
      ...users.map((user) => [formatStorageUserLabel(user)]),
      [dangerButton('/cancel')],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildCategoryChoiceOptions(categories: StorageCategoryRecord[], language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).storage;
  return {
    replyKeyboard: [
      ...categories.map((category) => [category.displayName]),
      [successButton(texts.skipOptional)],
      [dangerButton('/cancel')],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildUploadMediaOptions(language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).storage;
  return {
    replyKeyboard: [[successButton(texts.finishAttachments)], [dangerButton('/cancel')]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildStorageChatSelectOptions(language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).storage;
  return {
    replyKeyboard: [
      [
        {
          text: texts.shareStorageChat,
          semanticRole: 'primary',
          requestChat: {
            requestId: storageChatRequestId,
            chatIsChannel: false,
            chatIsForum: true,
            botIsMember: true,
          },
        },
      ],
      [secondaryButton(texts.manualCategorySetup)],
      [dangerButton('/cancel')],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildSkipOptionalOptions(language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).storage;
  return {
    replyKeyboard: [[successButton(texts.skipOptional)], [dangerButton('/cancel')]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildSingleCancelOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[dangerButton('/cancel')]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function successButton(text: string): TelegramReplyButton {
  return { text, semanticRole: 'success' };
}

function primaryButton(text: string): TelegramReplyButton {
  return { text, semanticRole: 'primary' };
}

function secondaryButton(text: string): TelegramReplyButton {
  return { text, semanticRole: 'secondary' };
}

function dangerButton(text: string): TelegramReplyButton {
  return { text, semanticRole: 'danger' };
}

function asCategoryChoices(value: unknown): Array<{ id: number; displayName: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => ({
      id: typeof entry === 'object' && entry !== null && 'id' in entry ? Number(entry.id) : NaN,
      displayName: typeof entry === 'object' && entry !== null && 'displayName' in entry ? String(entry.displayName) : '',
    }))
    .filter((entry) => Number.isInteger(entry.id) && entry.id > 0 && entry.displayName.length > 0);
}

function toStorageUserChoice(user: StorageCategoryAccessUserRecord): StorageUserChoice {
  return {
    telegramUserId: user.telegramUserId,
    username: user.username,
    displayName: user.displayName,
    status: user.status,
    isAdmin: user.isAdmin,
    label: formatStorageUserLabel(user),
  };
}

function asStorageUserChoices(value: unknown): StorageUserChoice[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const record = typeof entry === 'object' && entry !== null ? entry as Record<string, unknown> : {};
      return {
        telegramUserId: Number(record.telegramUserId),
        username: typeof record.username === 'string' ? record.username : null,
        displayName: typeof record.displayName === 'string' ? record.displayName : '',
        status: typeof record.status === 'string' ? record.status : '',
        isAdmin: record.isAdmin === true,
        label: typeof record.label === 'string' ? record.label : '',
      };
    })
    .filter((entry) => Number.isInteger(entry.telegramUserId) && entry.telegramUserId > 0 && entry.displayName.length > 0 && entry.label.length > 0);
}

function resolveSelectedStorageUserId(text: string, users: StorageUserChoice[]): number | null {
  const selected = users.find((user) => user.label === text);
  if (selected) {
    return selected.telegramUserId;
  }

  return parsePositiveInteger(text);
}

function formatStorageUserLabel(user: Pick<StorageCategoryAccessUserRecord, 'telegramUserId' | 'username' | 'displayName'>): string {
  const username = user.username?.trim();
  const usernameSuffix = username ? ` (@${username.replace(/^@/, '')})` : '';
  return `${user.displayName}${usernameSuffix} · ${user.telegramUserId}`;
}

function formatCategoryAccessMessage({
  categoryDisplayName,
  users,
  language,
}: {
  categoryDisplayName: string;
  users: StorageCategoryAccessUserRecord[];
  language: 'ca' | 'es' | 'en';
}): string {
  const texts = createTelegramI18n(language).storage;
  if (users.length === 0) {
    return texts.noCategoryAccessUsersForCategory.replace('{category}', categoryDisplayName);
  }

  return [
    texts.categoryAccessHeader.replace('{category}', categoryDisplayName),
    ...users.map((user) => `- ${formatStorageUserLabel(user)}`),
  ].join('\n');
}

function asDraftMessages(value: unknown): DmUploadDraftMessage[] {
  return Array.isArray(value) ? (value as DmUploadDraftMessage[]) : [];
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('Storage flow expected a positive integer');
  }
  return parsed;
}

function asSignedNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed === 0) {
    throw new Error('Storage flow expected a signed integer');
  }
  return parsed;
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

async function copyStorageEntryToCurrentChat(context: StorageFlowContext, detail: StorageEntryDetailRecord): Promise<void> {
  if (!context.runtime.bot.copyMessage) {
    throw new Error('Telegram bot runtime does not support copyMessage');
  }

  for (const message of detail.messages) {
    await context.runtime.bot.copyMessage({
      fromChatId: message.storageChatId,
      messageId: message.storageMessageId,
      toChatId: context.runtime.chat.chatId,
    });
  }
}

function formatStorageListMessage({
  categoryDisplayName,
  details,
  language,
}: {
  categoryDisplayName: string;
  details: StorageEntryDetailRecord[];
  language: 'ca' | 'es' | 'en';
}): string {
  const texts = createTelegramI18n(language).storage;
  const visibleDetails = details.slice(0, storageListPageSize);
  const lines = [
    escapeHtml(texts.listHeader.replace('{category}', categoryDisplayName)),
    ...visibleDetails.map((detail) => formatStorageSummaryEntry(detail, language)),
  ];
  if (details.length > visibleDetails.length) {
    lines.push(formatStorageListLimitedFooter(details.length, visibleDetails.length, language));
  }
  return lines.join('\n');
}

function formatStorageSummaryEntry(
  detail: StorageEntryDetailRecord,
  language: 'ca' | 'es' | 'en',
  { includeCategory = false }: { includeCategory?: boolean } = {},
): string {
  const description = detail.entry.description ?? createTelegramI18n(language).storage.entryNoDescription;
  const title = includeCategory ? `${detail.category.displayName} · #${detail.entry.id}` : `#${detail.entry.id}`;
  const texts = createTelegramI18n(language).storage;
  const attachmentSummary = `${texts.entryFieldAttachments}: ${detail.messages.length}`;
  const tags = detail.entry.tags.length > 0 ? ` · ${detail.entry.tags.map((tag) => `#${tag}`).join(', ')}` : '';
  return `- <a href="${escapeHtml(buildTelegramStartUrl(`${storageEntryStartPayloadPrefix}${detail.entry.id}`))}"><b>${escapeHtml(title)}</b></a> · ${escapeHtml(description)} · ${escapeHtml(attachmentSummary)}${escapeHtml(tags)}`;
}

function formatStorageListLimitedFooter(total: number, shown: number, language: 'ca' | 'es' | 'en'): string {
  return createTelegramI18n(language).storage.listLimitedFooter
    .replace('{shown}', String(shown))
    .replace('{total}', String(total));
}

function formatStorageEntryDetail(detail: StorageEntryDetailRecord, language: 'ca' | 'es' | 'en'): string {
  const texts = createTelegramI18n(language).storage;
  const lines = [
    `<a href="${escapeHtml(buildTelegramStartUrl(`${storageEntryStartPayloadPrefix}${detail.entry.id}`))}"><b>#${detail.entry.id}</b></a> · ${escapeHtml(detail.category.displayName)}`,
    `<b>${escapeHtml(texts.entryFieldDescription)}:</b> ${escapeHtml(detail.entry.description ?? texts.entryNoDescription)}`,
    `<b>${escapeHtml(texts.entryFieldTags)}:</b> ${detail.entry.tags.length > 0 ? detail.entry.tags.map((tag) => `#${escapeHtml(tag)}`).join(', ') : escapeHtml(texts.entryNoTags)}`,
    `<b>${escapeHtml(texts.entryFieldUploadedBy)}:</b> ${formatStorageUploaderLabel(detail, language)}`,
    `<b>${escapeHtml(texts.entryFieldUploadedAt)}:</b> ${escapeHtml(formatStorageDateTime(detail.entry.createdAt))}`,
    `<b>${escapeHtml(texts.entryFieldSource)}:</b> ${escapeHtml(formatStorageSourceKind(detail.entry.sourceKind, language))}`,
    `<b>${escapeHtml(texts.entryFieldAttachments)}:</b> ${detail.messages.length}`,
    ...detail.messages.map((message, index) => `  ${index + 1}. ${formatStorageAttachment(message, language)}`),
  ];
  return lines.join('\n');
}

function formatStorageAttachment(message: StorageEntryMessageRecord, language: 'ca' | 'es' | 'en'): string {
  const texts = createTelegramI18n(language).storage;
  const parts = [
    escapeHtml(message.attachmentKind),
    message.originalFileName ? `${escapeHtml(texts.entryFieldFileName)}: ${escapeHtml(message.originalFileName)}` : null,
    message.mimeType ? `${escapeHtml(texts.entryFieldMimeType)}: ${escapeHtml(message.mimeType)}` : null,
    message.fileSizeBytes === null ? null : `${escapeHtml(texts.entryFieldSize)}: ${escapeHtml(formatStorageFileSize(message.fileSizeBytes))}`,
    message.caption ? `${escapeHtml(texts.entryFieldCaption)}: ${escapeHtml(message.caption)}` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.join(' · ');
}

function formatStorageUploaderLabel(detail: StorageEntryDetailRecord, language: 'ca' | 'es' | 'en'): string {
  const uploader = detail.uploader;
  if (!uploader) {
    return escapeHtml(createTelegramI18n(language).storage.entryUnknownUploader.replace('{id}', String(detail.entry.createdByTelegramUserId)));
  }

  const normalizedUsername = uploader.username?.trim().replace(/^@/, '');
  const visibleText = normalizedUsername ? `${uploader.displayName} (@${normalizedUsername})` : `${uploader.displayName} (${uploader.telegramUserId})`;
  const escapedText = escapeHtml(visibleText);
  if (!normalizedUsername || !/^[A-Za-z0-9_]{5,32}$/.test(normalizedUsername)) {
    return escapedText;
  }
  return `<a href="https://t.me/${escapeHtml(normalizedUsername)}">${escapedText}</a>`;
}

function formatStorageSourceKind(sourceKind: StorageEntryDetailRecord['entry']['sourceKind'], language: 'ca' | 'es' | 'en'): string {
  const texts = createTelegramI18n(language).storage;
  return sourceKind === 'dm_copy' ? texts.sourceDmCopy : texts.sourceTopicDirect;
}

function formatStorageDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()} ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')} UTC`;
}

function formatStorageFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${Math.round(sizeBytes / 1024)} KB`;
  }
  return `${Math.round((sizeBytes / (1024 * 1024)) * 10) / 10} MB`;
}

function formatStorageCategoryListItem(category: StorageCategoryRecord): string {
  const suffix = category.lifecycleStatus === 'archived' ? ' [archived]' : '';
  return `- ${category.displayName} (\`${category.slug}\`)${suffix}`;
}

function canManageStorageCategories(context: StorageFlowContext): boolean {
  return context.runtime.actor.isAdmin || context.runtime.authorization.can('storage.category.manage');
}

function canManageStorageEntries(context: StorageFlowContext): boolean {
  return context.runtime.actor.isAdmin || context.runtime.authorization.can('storage.entry.manage');
}

function parsePositiveInteger(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseStartPayload(messageText: string, prefix: string): number | null {
  const payload = messageText.trim().split(/\s+/).slice(1).join(' ');
  if (!payload.startsWith(prefix)) {
    return null;
  }

  return parsePositiveInteger(payload.slice(prefix.length));
}

function parseSignedInteger(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed !== 0 ? parsed : null;
}

function isSupportedAttachmentKind(value: string): value is DmUploadDraftMessage['attachmentKind'] {
  return value === 'document' || value === 'photo' || value === 'video' || value === 'audio';
}
