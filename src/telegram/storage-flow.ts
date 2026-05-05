import { createDatabaseStorageRepository } from '../storage/storage-catalog-store.js';
import {
  createStorageCategory,
  createStorageEntry,
  parseStorageCaptionMetadata,
  setStorageCategoryLifecycleStatus,
  updateStorageEntryMetadata,
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
const storageCategoryStartPayloadPrefix = 'storage_category_';
const storageEditCategoryStartPayloadPrefix = 'storage_edit_category_';
const storageEditEntryStartPayloadPrefix = 'storage_edit_entry_';
export const storageCallbackPrefixes = {
  editEntry: 'storage:edit_entry:',
  deleteEntry: 'storage:delete_entry:',
} as const;
const storageListPageSize = 20;
const storageCategoryListPageSize = 50;
const storageListFlowKey = 'storage-list';
const storageSearchFlowKey = 'storage-search';
const storageOpenEntryFlowKey = 'storage-open-entry';
const storageAddImagesFlowKey = 'storage-add-images';
const storageEditEntryFlowKey = 'storage-edit-entry';
const storageCreateCategoryFlowKey = 'storage-create-category';
const storageArchiveCategoryFlowKey = 'storage-archive-category';
const storageReactivateCategoryFlowKey = 'storage-reactivate-category';
const storageDeleteEntryFlowKey = 'storage-delete-entry';
const storageGrantAccessFlowKey = 'storage-grant-access';
const storageRevokeAccessFlowKey = 'storage-revoke-access';
const storageViewAccessFlowKey = 'storage-view-access';
const storageTopicMediaGroupWindowMs = 1500;
const storageLargeAttachmentForwardThresholdBytes = 50 * 1024 * 1024;
const storageMaxAttachmentSizeBytes = 2 * 1024 * 1024 * 1024;
const storageChatRequestId = 41101;
const storageChatAdministratorRights = {
  isAnonymous: false,
  canManageChat: true,
  canDeleteMessages: false,
  canManageVideoChats: false,
  canRestrictMembers: false,
  canPromoteMembers: false,
  canChangeInfo: false,
  canInviteUsers: true,
  canPostStories: false,
  canEditStories: false,
  canDeleteStories: false,
  canPinMessages: false,
  canManageTopics: true,
};

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
      forwardMessage?: (input: {
        fromChatId: number;
        messageId: number;
        toChatId: number;
        messageThreadId?: number;
      }) => Promise<{ messageId: number }>;
      sendMediaGroup?: (input: {
        chatId: number;
        media: Array<{ type: 'photo'; media: string; caption?: string }>;
        messageThreadId?: number;
      }) => Promise<Array<{ messageId: number }>>;
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
  const categories = await listMenuCategories(context);
  await context.reply(
    categories.length === 0
      ? texts.selectMenu
      : `${escapeHtml(texts.selectMenu)}\n\n${formatStorageCategoryListMessage({ categories, language })}`,
    categories.length === 0 ? buildStorageMenuOptions(language, context) : { ...buildStorageMenuOptions(language, context), parseMode: 'HTML' },
  );
}

async function listMenuCategories(context: StorageFlowContext): Promise<StorageCategoryRecord[]> {
  try {
    return canManageStorageCategories(context)
      ? (await resolveRepository(context).listCategories()).filter((category) => category.lifecycleStatus === 'active')
      : await listReadableCategories(context);
  } catch {
    return [];
  }
}

export async function handleTelegramStorageStartText(context: StorageFlowContext): Promise<boolean> {
  const text = context.messageText?.trim();
  if (!text || context.runtime.chat.kind !== 'private' || !context.runtime.actor.isApproved || context.runtime.actor.isBlocked) {
    return false;
  }

  const entryId = parseStartPayload(text, storageEntryStartPayloadPrefix);
  if (entryId !== null) {
    const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
    return sendStorageEntryDetail(context, entryId, language);
  }

  const editEntryId = parseStartPayload(text, storageEditEntryStartPayloadPrefix);
  if (editEntryId !== null) {
    const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
    return startStorageEntryMetadataEdit(context, editEntryId, language);
  }

  const editCategoryId = parseStartPayload(text, storageEditCategoryStartPayloadPrefix);
  if (editCategoryId !== null) {
    const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
    return sendStorageEditableEntryList(context, editCategoryId, language);
  }

  const categoryId = parseStartPayload(text, storageCategoryStartPayloadPrefix);
  if (categoryId !== null) {
    const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
    if (
      context.runtime.session.current?.flowKey === storageUploadFlowKey &&
      context.runtime.session.current.stepKey === 'upload-category'
    ) {
      return handleActiveUploadFlow(context, text, language);
    }
    if (
      context.runtime.session.current?.flowKey === storageCreateCategoryFlowKey &&
      context.runtime.session.current.stepKey === 'create-category-parent'
    ) {
      return selectCreateCategoryParent(context, categoryId, language);
    }
    return sendStorageCategoryEntryList(context, categoryId, language);
  }

  return false;
}

async function startStorageEntryMetadataEdit(
  context: StorageFlowContext,
  entryId: number,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const texts = createTelegramI18n(language).storage;
  const detail = await resolveRepository(context).getEntryDetail(entryId);
  if (
    !detail ||
    detail.entry.lifecycleStatus !== 'active' ||
    !canEditStorageEntry(context, detail)
  ) {
    await context.reply(texts.invalidEntryId, buildStorageMenuOptions(language, context));
    return true;
  }

  await context.runtime.session.start({
    flowKey: storageEditEntryFlowKey,
    stepKey: 'edit-entry-action',
    data: {
      entryId: detail.entry.id,
      categoryId: detail.category.id,
      currentDescription: detail.entry.description,
      currentTags: detail.entry.tags,
    },
  });
  await context.reply(texts.askEditAction, buildEditEntryActionOptions(language));
  return true;
}

export async function handleTelegramStorageCallback(context: StorageFlowContext): Promise<boolean> {
  const callbackData = context.callbackData;
  if (!callbackData || context.runtime.chat.kind !== 'private' || !context.runtime.actor.isApproved || context.runtime.actor.isBlocked) {
    return false;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  if (callbackData.startsWith(storageCallbackPrefixes.editEntry)) {
    const entryId = parseCallbackEntityId(callbackData, storageCallbackPrefixes.editEntry);
    if (entryId === null) {
      await context.reply(createTelegramI18n(language).storage.invalidEntryId, buildStorageMenuOptions(language, context));
      return true;
    }
    return startStorageEntryMetadataEdit(context, entryId, language);
  }

  if (callbackData.startsWith(storageCallbackPrefixes.deleteEntry)) {
    const entryId = parseCallbackEntityId(callbackData, storageCallbackPrefixes.deleteEntry);
    if (entryId === null) {
      await context.reply(createTelegramI18n(language).storage.invalidEntryId, buildStorageMenuOptions(language, context));
      return true;
    }
    return deleteStorageEntryFromDetailAction(context, entryId, language);
  }

  return false;
}

async function sendStorageEditableEntryList(
  context: StorageFlowContext,
  categoryId: number,
  language: 'ca' | 'es' | 'en',
  { sessionData = {} }: { sessionData?: Record<string, unknown> } = {},
): Promise<boolean> {
  const texts = createTelegramI18n(language).storage;
  const categories = await listUploadableCategories(context);
  const category = categories.find((candidate) => candidate.id === categoryId);
  if (!category) {
    await context.reply(texts.invalidCategory, buildStorageMenuOptions(language, context));
    return true;
  }

  const editableDetails = await listEditableEntryDetails(context, category.id);
  if (editableDetails.length === 0) {
    await context.reply(texts.noEntriesInCategory, buildStorageMenuOptions(language, context));
    return true;
  }

  await context.runtime.session.start({
    flowKey: storageEditEntryFlowKey,
    stepKey: 'edit-entry-select',
    data: {
      ...sessionData,
      categoryId: category.id,
      entries: editableDetails.map((detail) => ({ id: detail.entry.id })),
    },
  });
  await context.reply(
    formatStorageEditEntryListMessage({
      categoryDisplayName: category.displayName,
      details: editableDetails,
      language,
    }),
    { ...buildStorageEntryChoiceOptions(editableDetails), parseMode: 'HTML' },
  );
  return true;
}

async function sendStorageCategoryEntryList(
  context: StorageFlowContext,
  categoryId: number,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const texts = createTelegramI18n(language).storage;
  const categories = await listReadableCategories(context);
  const category = categories.find((candidate) => candidate.id === categoryId);
  if (!category) {
    await context.reply(texts.invalidCategory, buildStorageMenuOptions(language, context));
    return true;
  }

  const details = await resolveRepository(context).listEntryDetailsByCategory(category.id);
  const children = categories.filter((candidate) => candidate.parentCategoryId === category.id);
  if (details.length === 0 && children.length === 0) {
    await context.reply(texts.noEntriesInCategory, buildStorageMenuOptions(language, context));
    return true;
  }

  await context.reply(
    formatStorageCategoryDetailMessage({
      category,
      childCategories: children,
      details,
      allCategories: categories,
      language,
    }),
    { ...buildStorageMenuOptions(language, context), parseMode: 'HTML' },
  );
  return true;
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
  if (
    context.runtime.session.current?.flowKey === storageUploadFlowKey &&
    context.runtime.session.current.stepKey === 'upload-category' &&
    parseStartPayload(text, storageCategoryStartPayloadPrefix) !== null
  ) {
    return handleActiveUploadFlow(context, text, language);
  }
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
  if (context.runtime.session.current?.flowKey === storageEditEntryFlowKey) {
    return handleActiveEditEntryFlow(context, text, language);
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
      ? (await resolveRepository(context).listCategories()).filter((category) => category.lifecycleStatus === 'active')
      : await listReadableCategories(context);
    await context.reply(
      categories.length === 0
        ? texts.noReadableCategories
        : formatStorageCategoryListMessage({
          categories,
          language,
        }),
      categories.length === 0 ? buildStorageMenuOptions(language, context) : { ...buildStorageMenuOptions(language, context), parseMode: 'HTML' },
    );
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

  if (text === texts.editEntry) {
    const categories = await listUploadableCategories(context);
    if (categories.length === 0) {
      await context.reply(texts.noCategoriesForAction, buildStorageMenuOptions(language, context));
      return true;
    }
    await context.runtime.session.start({
      flowKey: storageEditEntryFlowKey,
      stepKey: 'edit-category',
      data: {
        categories: categories.map((category) => ({ id: category.id, displayName: category.displayName })),
      },
    });
    await context.reply(
      `${escapeHtml(texts.askEditCategory)}\n${formatStorageCategoryLinks(categories, language, categories, { linkMode: 'edit' }).join('\n')}`,
      { ...buildCategoryChoiceOptions(categories, language), parseMode: 'HTML' },
    );
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
      stepKey: 'create-category-name',
      data: {},
    });
    await context.reply(texts.askCategoryName, buildSingleCancelOptions());
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
    await context.reply(
      `${escapeHtml(texts.askUploadCategory)}\n${formatStorageCategoryListMessage({ categories, language, labelMode: 'full-path' })}`,
      { ...buildCategoryChoiceOptions(categories, language), parseMode: 'HTML' },
    );
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
  if (session.stepKey === 'create-category-name') {
    const categories = (await resolveRepository(context).listCategories()).filter((category) => category.lifecycleStatus === 'active');
    await context.runtime.session.advance({
      stepKey: 'create-category-parent',
      data: {
        ...session.data,
        displayName: text,
        categories: categories.map((category) => ({ id: category.id, displayName: category.displayName })),
      },
    });
    await context.reply(formatCreateCategoryParentPrompt(categories, language), {
      ...buildSkipOptionalOptions(language),
      parseMode: 'HTML',
    });
    return true;
  }

  if (session.stepKey === 'create-category-parent') {
    if (text === texts.skipOptional) {
      return selectCreateCategoryParent(context, null, language);
    }

    const categories = asCategoryChoices(session.data.categories);
    const selected = categories.find((category) => category.displayName === text);
    return selectCreateCategoryParent(context, selected?.id ?? NaN, language);
  }

  if (session.stepKey === 'create-category-slug') {
    await context.runtime.session.advance({
      stepKey: 'create-category-description',
      data: { ...session.data, slug: text },
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

async function selectCreateCategoryParent(
  context: StorageFlowContext,
  parentCategoryId: number | null,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageCreateCategoryFlowKey || session.stepKey !== 'create-category-parent') {
    return false;
  }

  const texts = createTelegramI18n(language).storage;
  const activeCategories = (await resolveRepository(context).listCategories()).filter((category) => category.lifecycleStatus === 'active');
  const selectedParentId = parentCategoryId === null ? null : Number(parentCategoryId);
  if (selectedParentId !== null && !activeCategories.some((category) => category.id === selectedParentId)) {
    await context.reply(`${escapeHtml(texts.invalidCategory)}\n${formatCreateCategoryParentPrompt(activeCategories, language)}`, {
      ...buildSkipOptionalOptions(language),
      parseMode: 'HTML',
    });
    return true;
  }

  const generatedSlug = buildStorageCategorySlug({
    displayName: asNullableString(session.data.displayName) ?? '',
    parentCategoryId: selectedParentId,
    categories: activeCategories,
  });
  if (!generatedSlug || activeCategories.some((category) => category.slug === generatedSlug)) {
    await context.runtime.session.advance({
      stepKey: 'create-category-slug',
      data: { ...session.data, parentCategoryId: selectedParentId },
    });
    await context.reply(texts.askCategorySlug, buildSingleCancelOptions());
    return true;
  }

  await context.runtime.session.advance({
    stepKey: 'create-category-description',
    data: { ...session.data, parentCategoryId: selectedParentId, slug: generatedSlug },
  });
  await context.reply(texts.askCategoryDescription, buildSkipOptionalOptions(language));
  return true;
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
  if (!session || session.flowKey !== storageDeleteEntryFlowKey) {
    return false;
  }

  const texts = createTelegramI18n(language).storage;
  if (session.stepKey === 'delete-entry-confirm') {
    const entryId = asNumber(session.data.entryId);
    if (text !== 'DELETE') {
      await context.reply(texts.invalidDeleteEntryConfirm.replace('{id}', String(entryId)), buildSingleCancelOptions());
      return true;
    }

    await deleteStorageEntry(context, entryId);
    await context.runtime.session.cancel();
    await context.reply(texts.entryDeleted.replace('{id}', String(entryId)), buildStorageMenuOptions(language, context));
    return true;
  }

  if (session.stepKey !== 'delete-entry-id') {
    return false;
  }

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

  await context.runtime.session.advance({
    stepKey: 'delete-entry-confirm',
    data: { entryId },
  });
  await context.reply(texts.askDeleteEntryConfirm.replace('{id}', String(entryId)), buildSingleCancelOptions());
  return true;
}

async function deleteStorageEntryFromDetailAction(
  context: StorageFlowContext,
  entryId: number,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const texts = createTelegramI18n(language).storage;
  const detail = await resolveRepository(context).getEntryDetail(entryId);
  if (!detail || detail.entry.lifecycleStatus !== 'active' || !canEditStorageEntry(context, detail)) {
    await context.reply(texts.invalidEntryId, buildStorageMenuOptions(language, context));
    return true;
  }

  await context.runtime.session.start({
    flowKey: storageDeleteEntryFlowKey,
    stepKey: 'delete-entry-confirm',
    data: { entryId },
  });
  await context.reply(texts.askDeleteEntryConfirm.replace('{id}', String(entryId)), buildSingleCancelOptions());
  return true;
}

async function deleteStorageEntry(context: StorageFlowContext, entryId: number): Promise<void> {
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

  const allCategories = await resolveRepository(context).listCategories();
  await context.reply(formatStorageEntryDetail(detail, language, allCategories), buildStorageEntryDetailOptions(context, detail, language));

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

async function handleActiveEditEntryFlow(context: StorageFlowContext, text: string, language: 'ca' | 'es' | 'en'): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageEditEntryFlowKey) {
    return false;
  }

  const texts = createTelegramI18n(language).storage;
  if (session.stepKey === 'edit-category') {
    const categories = asCategoryChoices(session.data.categories);
    const selected = categories.find((category) => category.displayName === text);
    if (!selected) {
      await context.reply(texts.invalidCategory, buildCategoryChoiceOptions(await listUploadableCategories(context), language));
      return true;
    }

    return sendStorageEditableEntryList(context, selected.id, language, { sessionData: session.data });
  }

  if (session.stepKey === 'edit-entry-select') {
    const entryId = parseEntryChoice(text, asEntryChoices(session.data.entries));
    if (entryId === null) {
      await context.reply(texts.invalidEntryId, buildStorageEntryChoiceOptions(await listEditableEntryDetails(context, asNumber(session.data.categoryId))));
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

    return startStorageEntryMetadataEdit(context, detail.entry.id, language);
  }

  if (session.stepKey === 'edit-entry-action') {
    if (text === texts.uploadModifyDescription) {
      await context.runtime.session.advance({
        stepKey: 'edit-entry-description',
        data: session.data,
      });
      await context.reply(
        texts.askEditDescription.replace('{current}', asNullableString(session.data.currentDescription) ?? texts.entryNoDescription),
        buildSkipOptionalOptions(language),
      );
      return true;
    }

    if (text === texts.addImages) {
      await context.runtime.session.advance({
        stepKey: 'add-images-media',
        data: {
          ...session.data,
          messages: [],
        },
      });
      await context.reply(texts.askAddImagesMedia, buildUploadMediaOptions(language));
      return true;
    }

    if (text === texts.finishEdit) {
      await context.runtime.session.cancel();
      await context.reply(texts.selectMenu, buildStorageMenuOptions(language, context));
      return true;
    }

    await context.reply(texts.invalidEditAction, buildEditEntryActionOptions(language));
    return true;
  }

  if (session.stepKey === 'edit-entry-description') {
    const currentDescription = asNullableString(session.data.currentDescription);
    await context.runtime.session.advance({
      stepKey: 'edit-entry-tags',
      data: {
        ...session.data,
        description: text === texts.skipOptional ? currentDescription : text,
      },
    });
    await context.reply(
      texts.askEditTags.replace('{current}', formatCurrentTags(asStringArray(session.data.currentTags), language)),
      buildSkipOptionalOptions(language),
    );
    return true;
  }

  if (session.stepKey === 'edit-entry-tags') {
    const currentTags = asStringArray(session.data.currentTags);
    const updated = await updateStorageEntryMetadata({
      repository: resolveRepository(context),
      entryId: asNumber(session.data.entryId),
      description: asNullableString(session.data.description),
      tags: text === texts.skipOptional ? currentTags : parseStorageCaptionMetadata(text).tags,
    });
    await appendAuditEvent({
      repository: resolveAuditRepository(context),
      actorTelegramUserId: context.runtime.actor.telegramUserId,
      actionKey: 'storage.entry.metadata_updated',
      targetType: 'storage-entry',
      targetId: updated.entry.id,
      summary: 'Metadades actualitzades a entrada de storage',
      details: {
        description: updated.entry.description,
        tags: updated.entry.tags,
      },
    });
    await context.runtime.session.advance({
      stepKey: 'edit-entry-action',
      data: {
        ...session.data,
        currentDescription: updated.entry.description,
        currentTags: updated.entry.tags,
        description: updated.entry.description,
      },
    });
    await context.reply(
      `${texts.entryMetadataUpdated.replace('{id}', String(updated.entry.id))}\n\n${texts.askEditAction}`,
      buildEditEntryActionOptions(language),
    );
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
    await context.runtime.session.advance({
      stepKey: 'edit-entry-action',
      data: {
        ...session.data,
        messages: [],
      },
    });
    await context.reply(
      `${texts.imagesAdded
        .replace('{id}', String(updated.entry.id))
        .replace('{count}', String(messages.length))}\n\n${texts.askEditAction}`,
      buildEditEntryActionOptions(language),
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

  if (context.runtime.chat.kind === 'private' && context.runtime.session.current?.flowKey === storageEditEntryFlowKey) {
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
    parentCategoryId: asOptionalNumber(session.data.parentCategoryId),
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
    details: { slug: created.slug, parentCategoryId: created.parentCategoryId, setupMode, storageChatId, storageThreadId },
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
    const selectedCategoryId = parseStartPayload(text, storageCategoryStartPayloadPrefix);
    const selected = selectedCategoryId === null
      ? categories.find((category) => category.displayName === text)
      : categories.find((category) => category.id === selectedCategoryId);
    if (!selected) {
      const uploadableCategories = await listUploadableCategories(context);
      await context.reply(
        `${escapeHtml(texts.invalidCategory)}\n${formatStorageCategoryListMessage({ categories: uploadableCategories, language, labelMode: 'full-path' })}`,
        { ...buildCategoryChoiceOptions(uploadableCategories, language), parseMode: 'HTML' },
      );
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

    if (messages.length > 1) {
      await context.runtime.session.advance({
        stepKey: 'upload-grouping',
        data: { ...session.data, messages },
      });
      await context.reply(texts.askUploadGrouping, buildUploadGroupingOptions(language));
      return true;
    }

    await advanceUploadPreview(context, session.data, messages, language);
    return true;
  }

  if (session.stepKey === 'upload-grouping') {
    const messages = asDraftMessages(session.data.messages);
    if (text === texts.uploadSeparate) {
      const savedEntries = [];
      for (const message of messages) {
        savedEntries.push(await persistPrivateUpload({
          context,
          categoryId: asNumber(session.data.categoryId),
          categoryDisplayName: String(session.data.categoryDisplayName ?? ''),
          description: resolveDefaultUploadDescription([message], language),
          tags: [],
          messages: [message],
        }));
      }
      await context.runtime.session.cancel();
      await context.reply(
        texts.savedSeparate
          .replace('{category}', String(session.data.categoryDisplayName ?? savedEntries[0]?.category.displayName ?? ''))
          .replace('{count}', String(savedEntries.length)),
        buildStorageMenuOptions(language, context),
      );
      return true;
    }

    if (text !== texts.uploadTogether) {
      await context.reply(texts.invalidUploadGrouping, buildUploadGroupingOptions(language));
      return true;
    }

    await advanceUploadPreview(context, { ...session.data, uploadGrouping: 'together' }, messages, language);
    return true;
  }

  if (session.stepKey === 'upload-preview') {
    if (text === texts.uploadAccept) {
      const saved = await persistPrivateUpload({
        context,
        categoryId: asNumber(session.data.categoryId),
        categoryDisplayName: String(session.data.categoryDisplayName ?? ''),
        description: asNullableString(session.data.description),
        tags: asStringArray(session.data.tags),
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

    if (text === texts.uploadModifyDescription) {
      await context.runtime.session.advance({
        stepKey: 'upload-description',
        data: session.data,
      });
      await context.reply(formatAskUploadDescription(texts.askDescription, asDraftMessages(session.data.messages), language), buildSkipOptionalOptions(language));
      return true;
    }

    if (text === texts.addImages) {
      await context.runtime.session.advance({
        stepKey: 'upload-preview-images',
        data: session.data,
      });
      await context.reply(texts.askUploadPreviewImages, buildUploadMediaOptions(language));
      return true;
    }

    await context.reply(texts.invalidUploadPreviewAction, buildUploadPreviewOptions(language));
    return true;
  }

  if (session.stepKey === 'upload-description') {
    const messages = asDraftMessages(session.data.messages);
    const data = {
      ...session.data,
      description: text === texts.skipOptional ? resolveDefaultUploadDescription(messages, language) : text,
    };
    await context.runtime.session.advance({
      stepKey: 'upload-preview',
      data,
    });
    await context.reply(formatUploadPreview(data, language), { ...buildUploadPreviewOptions(language), parseMode: 'HTML' });
    return true;
  }

  if (session.stepKey === 'upload-preview-images') {
    if (text !== texts.finishAttachments) {
      return false;
    }

    const messages = asDraftMessages(session.data.messages);
    await context.runtime.session.advance({
      stepKey: 'upload-preview',
      data: {
        ...session.data,
        messages,
      },
    });
    await context.reply(formatUploadPreview({ ...session.data, messages }, language), { ...buildUploadPreviewOptions(language), parseMode: 'HTML' });
    return true;
  }

  return false;
}

async function handlePrivateUploadMedia(context: StorageFlowContext): Promise<boolean> {
  const session = context.runtime.session.current;
  const media = context.messageMedia;
  if (!session || !['upload-media', 'upload-preview-images'].includes(session.stepKey) || !media || !isSupportedAttachmentKind(media.attachmentKind)) {
    return false;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).storage;
  if (session.stepKey === 'upload-preview-images' && media.attachmentKind !== 'photo') {
    await context.reply(texts.addImagesNeedsPhoto, buildUploadMediaOptions(language));
    return true;
  }
  if (isOversizedStorageAttachment(media.fileSizeBytes ?? null)) {
    await context.reply(
      texts.attachmentTooLarge
        .replace('{size}', formatStorageFileSize(media.fileSizeBytes ?? storageMaxAttachmentSizeBytes))
        .replace('{limit}', formatStorageFileSize(storageMaxAttachmentSizeBytes)),
      buildUploadMediaOptions(language),
    );
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
    stepKey: session.stepKey,
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
  if (isOversizedStorageAttachment(media.fileSizeBytes ?? null)) {
    await context.reply(
      texts.attachmentTooLarge
        .replace('{size}', formatStorageFileSize(media.fileSizeBytes ?? storageMaxAttachmentSizeBytes))
        .replace('{limit}', formatStorageFileSize(storageMaxAttachmentSizeBytes)),
      buildUploadMediaOptions(language),
    );
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
      const copied = await transferStorageMessageToTopic({
        context,
        message,
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
      const copied = await transferStorageMessageToTopic({
        context,
        message,
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

async function transferStorageMessageToTopic({
  context,
  message,
  toChatId,
  messageThreadId,
}: {
  context: StorageFlowContext;
  message: DmUploadDraftMessage;
  toChatId: number;
  messageThreadId: number;
}): Promise<{ messageId: number }> {
  const input = {
    fromChatId: message.fromChatId,
    messageId: message.fromMessageId,
    toChatId,
    messageThreadId,
  };
  if (isLargeStorageAttachment(message) && context.runtime.bot.forwardMessage) {
    return context.runtime.bot.forwardMessage(input);
  }
  if (!context.runtime.bot.copyMessage) {
    throw new Error('Telegram bot runtime does not support copyMessage');
  }

  try {
    return await context.runtime.bot.copyMessage(input);
  } catch (error) {
    if (!context.runtime.bot.forwardMessage) {
      throw error;
    }
    return context.runtime.bot.forwardMessage(input);
  }
}

function isLargeStorageAttachment(message: DmUploadDraftMessage): boolean {
  return message.fileSizeBytes !== null && message.fileSizeBytes >= storageLargeAttachmentForwardThresholdBytes;
}

function isOversizedStorageAttachment(fileSizeBytes: number | null): boolean {
  return fileSizeBytes !== null && fileSizeBytes > storageMaxAttachmentSizeBytes;
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

async function listEditableEntryDetails(context: StorageFlowContext, categoryId: number): Promise<StorageEntryDetailRecord[]> {
  const details = await resolveRepository(context).listEntryDetailsByCategory(categoryId);
  return details.filter(
    (detail) =>
      detail.entry.lifecycleStatus === 'active' &&
      context.runtime.authorization.can('storage.entry.upload', { type: 'storage-category', id: String(detail.category.id) }),
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
    [primaryButton(texts.listCategories)],
    [secondaryButton(texts.searchFiles), primaryButton(texts.openEntry)],
    [successButton(texts.upload), successButton(texts.addImages)],
    [secondaryButton(texts.editEntry)],
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

function buildStorageEntryChoiceOptions(details: StorageEntryDetailRecord[]): TelegramReplyOptions {
  return {
    replyKeyboard: [
      ...details.slice(0, storageListPageSize).map((detail) => [formatStorageEntryChoiceLabel(detail)]),
      [dangerButton('/cancel')],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function formatStorageEntryChoiceLabel(detail: StorageEntryDetailRecord): string {
  return `#${detail.entry.id} - ${detail.entry.description ?? detail.messages[0]?.originalFileName ?? detail.category.displayName}`;
}

function buildUploadMediaOptions(language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).storage;
  return {
    replyKeyboard: [[successButton(texts.finishAttachments)], [dangerButton('/cancel')]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildUploadGroupingOptions(language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).storage;
  return {
    replyKeyboard: [[successButton(texts.uploadTogether)], [secondaryButton(texts.uploadSeparate)], [dangerButton('/cancel')]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildUploadPreviewOptions(language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).storage;
  return {
    replyKeyboard: [
      [successButton(texts.uploadAccept)],
      [secondaryButton(texts.uploadModifyDescription), successButton(texts.addImages)],
      [dangerButton('/cancel')],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildStorageEntryDetailOptions(
  context: StorageFlowContext,
  detail: StorageEntryDetailRecord,
  language: 'ca' | 'es' | 'en',
): TelegramReplyOptions {
  const texts = createTelegramI18n(language).storage;
  if (!canEditStorageEntry(context, detail)) {
    return { ...buildStorageMenuOptions(language, context), parseMode: 'HTML' };
  }

  return {
    parseMode: 'HTML',
    inlineKeyboard: [[
      { text: texts.editButton, callbackData: `${storageCallbackPrefixes.editEntry}${detail.entry.id}` },
      { text: texts.deleteButton, callbackData: `${storageCallbackPrefixes.deleteEntry}${detail.entry.id}`, semanticRole: 'danger' },
    ]],
  };
}

function buildEditEntryActionOptions(language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).storage;
  return {
    replyKeyboard: [
      [secondaryButton(texts.uploadModifyDescription), successButton(texts.addImages)],
      [successButton(texts.finishEdit)],
      [dangerButton('/cancel')],
    ],
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
            userAdministratorRights: storageChatAdministratorRights,
            botAdministratorRights: storageChatAdministratorRights,
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

function formatAskUploadDescription(template: string, messages: DmUploadDraftMessage[], language: 'ca' | 'es' | 'en'): string {
  return template.replace('{default}', resolveDefaultUploadDescription(messages, language) ?? createTelegramI18n(language).storage.skipOptional);
}

async function advanceUploadPreview(
  context: StorageFlowContext,
  sessionData: Record<string, unknown>,
  messages: DmUploadDraftMessage[],
  language: 'ca' | 'es' | 'en',
): Promise<void> {
  const data = {
    ...sessionData,
    messages,
    description: resolveDefaultUploadDescription(messages, language),
    tags: [],
  };
  await context.runtime.session.advance({
    stepKey: 'upload-preview',
    data,
  });
  await context.reply(formatUploadPreview(data, language), { ...buildUploadPreviewOptions(language), parseMode: 'HTML' });
}

function formatUploadPreview(data: Record<string, unknown>, language: 'ca' | 'es' | 'en'): string {
  const texts = createTelegramI18n(language).storage;
  const messages = asDraftMessages(data.messages);
  const tags = asStringArray(data.tags);
  const lines = [
    `<b>${escapeHtml(texts.uploadPreviewHeader)}</b>`,
    `<b>${escapeHtml(texts.uploadPreviewCategory)}:</b> ${escapeHtml(String(data.categoryDisplayName ?? ''))}`,
    `<b>${escapeHtml(texts.entryFieldDescription)}:</b> ${escapeHtml(asNullableString(data.description) ?? texts.entryNoDescription)}`,
    `<b>${escapeHtml(texts.entryFieldTags)}:</b> ${tags.length > 0 ? tags.map((tag) => `#${escapeHtml(tag)}`).join(', ') : escapeHtml(texts.entryNoTags)}`,
    `<b>${escapeHtml(texts.entryFieldAttachments)}:</b> ${messages.length}`,
    ...messages.map((message, index) => `  ${index + 1}. ${formatDraftStorageAttachment(message, language)}`),
  ];
  return lines.join('\n');
}

function formatDraftStorageAttachment(message: DmUploadDraftMessage, language: 'ca' | 'es' | 'en'): string {
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

function resolveDefaultUploadDescription(messages: DmUploadDraftMessage[], language: 'ca' | 'es' | 'en'): string | null {
  for (const message of messages) {
    const normalized = normalizeUploadFileName(message.originalFileName);
    if (normalized) {
      return normalized;
    }
  }

  const firstKind = messages[0]?.attachmentKind;
  if (!firstKind) {
    return null;
  }

  const fallbackByLanguage = {
    ca: {
      document: 'document',
      photo: 'foto',
      video: 'video',
      audio: 'audio',
    },
    es: {
      document: 'documento',
      photo: 'foto',
      video: 'video',
      audio: 'audio',
    },
    en: {
      document: 'document',
      photo: 'photo',
      video: 'video',
      audio: 'audio',
    },
  } satisfies Record<'ca' | 'es' | 'en', Record<DmUploadDraftMessage['attachmentKind'], string>>;

  return fallbackByLanguage[language][firstKind];
}

function normalizeUploadFileName(fileName: string | null): string | null {
  if (!fileName) {
    return null;
  }

  const withoutPath = fileName.split(/[\\/]/).pop() ?? fileName;
  const withoutExtension = withoutPath.replace(/\.[^.]+$/, '');
  const normalized = withoutExtension
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized || null;
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

function asEntryChoices(value: unknown): Array<{ id: number }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => ({
      id: typeof entry === 'object' && entry !== null && 'id' in entry ? Number(entry.id) : NaN,
    }))
    .filter((entry) => Number.isInteger(entry.id) && entry.id > 0);
}

function parseEntryChoice(text: string, entries: Array<{ id: number }>): number | null {
  const explicitId = parsePositiveInteger(text);
  if (explicitId !== null && entries.some((entry) => entry.id === explicitId)) {
    return explicitId;
  }
  const prefixedId = text.match(/^#(\d+)\b/)?.[1];
  if (!prefixedId) {
    return null;
  }
  const parsed = parsePositiveInteger(prefixedId);
  return parsed !== null && entries.some((entry) => entry.id === parsed) ? parsed : null;
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

function asOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return asNumber(value);
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

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function formatCurrentTags(tags: string[], language: 'ca' | 'es' | 'en'): string {
  return tags.length > 0 ? tags.map((tag) => `#${tag}`).join(' ') : createTelegramI18n(language).storage.entryNoTags;
}

async function copyStorageEntryToCurrentChat(context: StorageFlowContext, detail: StorageEntryDetailRecord): Promise<void> {
  if (!context.runtime.bot.copyMessage) {
    throw new Error('Telegram bot runtime does not support copyMessage');
  }

  const albumPhotoIds = detail.messages
    .filter((message) => message.attachmentKind === 'photo' && message.telegramFileId)
    .map((message) => message.telegramFileId as string);
  if (albumPhotoIds.length > 1 && context.runtime.bot.sendMediaGroup) {
    for (let index = 0; index < albumPhotoIds.length; index += 10) {
      await context.runtime.bot.sendMediaGroup({
        chatId: context.runtime.chat.chatId,
        media: albumPhotoIds.slice(index, index + 10).map((fileId) => ({ type: 'photo', media: fileId })),
      });
    }
  }

  for (const message of detail.messages) {
    if (albumPhotoIds.length > 1 && message.attachmentKind === 'photo' && message.telegramFileId) {
      continue;
    }
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
  linkMode = 'detail',
}: {
  categoryDisplayName: string;
  details: StorageEntryDetailRecord[];
  language: 'ca' | 'es' | 'en';
  linkMode?: 'detail' | 'edit';
}): string {
  const texts = createTelegramI18n(language).storage;
  const visibleDetails = details.slice(0, storageListPageSize);
  const lines = [
    escapeHtml(texts.listHeader.replace('{category}', categoryDisplayName)),
    ...visibleDetails.map((detail) => formatStorageSummaryEntry(detail, language, { linkMode })),
  ];
  if (details.length > visibleDetails.length) {
    lines.push(formatStorageListLimitedFooter(details.length, visibleDetails.length, language));
  }
  return lines.join('\n');
}

function formatStorageEditEntryListMessage({
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
    ...visibleDetails.map((detail) => formatStorageSummaryEntry(detail, language, { linkMode: 'edit' })),
  ];
  if (details.length > visibleDetails.length) {
    lines.push(formatStorageListLimitedFooter(details.length, visibleDetails.length, language));
  }
  return lines.join('\n');
}

function formatStorageCategoryDetailMessage({
  category,
  childCategories,
  details,
  allCategories,
  language,
}: {
  category: StorageCategoryRecord;
  childCategories: StorageCategoryRecord[];
  details: StorageEntryDetailRecord[];
  allCategories: StorageCategoryRecord[];
  language: 'ca' | 'es' | 'en';
}): string {
  const texts = createTelegramI18n(language).storage;
  const lines = [
    `<a href="${escapeHtml(buildStorageCategoryDeepLink(category.id))}"><b>${escapeHtml(formatStorageCategoryPath(category, allCategories))}</b></a>`,
  ];

  if (childCategories.length > 0) {
    lines.push('', escapeHtml(texts.categoryChildrenHeader), ...formatStorageCategoryLinks(childCategories, language, allCategories));
  }

  if (details.length > 0) {
    const sortedDetails = sortStorageEntryDetailsAlphabetically(details);
    lines.push(
      '',
      escapeHtml(texts.categoryEntriesHeader),
      ...sortedDetails.slice(0, storageListPageSize).map((detail) => formatStorageSummaryEntry(detail, language, {
        hideAttachmentCount: true,
        linkTarget: 'description',
      })),
    );
    if (details.length > storageListPageSize) {
      lines.push(escapeHtml(formatStorageListLimitedFooter(details.length, storageListPageSize, language)));
    }
  }

  return lines.join('\n');
}

function formatStorageCategoryListMessage({
  categories,
  language,
  labelMode = 'local',
}: {
  categories: StorageCategoryRecord[];
  language: 'ca' | 'es' | 'en';
  labelMode?: 'local' | 'full-path';
}): string {
  const texts = createTelegramI18n(language).storage;
  const visibleCategories = categories.slice(0, storageCategoryListPageSize);
  const lines = [
    escapeHtml(texts.categoriesHeader),
    ...formatStorageCategoryLinks(visibleCategories, language, categories, { labelMode }),
  ];
  if (categories.length > visibleCategories.length) {
    lines.push(formatStorageCategoryLimitedFooter(categories.length, visibleCategories.length, language));
  }
  return lines.join('\n');
}

function formatCreateCategoryParentPrompt(categories: StorageCategoryRecord[], language: 'ca' | 'es' | 'en'): string {
  const texts = createTelegramI18n(language).storage;
  if (categories.length === 0) {
    return escapeHtml(texts.askCategoryParent);
  }
  return `${escapeHtml(texts.askCategoryParent)}\n${formatStorageCategoryListMessage({ categories, language })}`;
}

function formatStorageCategoryLinks(
  categories: StorageCategoryRecord[],
  language: 'ca' | 'es' | 'en',
  allCategories: StorageCategoryRecord[] = categories,
  { linkMode = 'detail', labelMode = 'local' }: { linkMode?: 'detail' | 'edit'; labelMode?: 'local' | 'full-path' } = {},
): string[] {
  return orderStorageCategoriesForTree(categories, allCategories).map((category) => {
    const depth = resolveStorageCategoryDepth(category, allCategories);
    const prefix = `${'  '.repeat(depth)}- `;
    const href = linkMode === 'edit'
      ? buildTelegramStartUrl(`${storageEditCategoryStartPayloadPrefix}${category.id}`)
      : buildStorageCategoryDeepLink(category.id);
    const label = labelMode === 'full-path' ? formatStorageCategoryPath(category, allCategories) : category.displayName;
    return `${prefix}<a href="${escapeHtml(href)}"><b>${escapeHtml(label)}</b></a>`;
  });
}

function formatStorageCategoryPath(category: StorageCategoryRecord, allCategories: StorageCategoryRecord[]): string {
  const byId = new Map(allCategories.map((candidate) => [candidate.id, candidate]));
  const segments = [category.displayName];
  let current = category;
  const visited = new Set<number>([category.id]);
  while (current.parentCategoryId !== null) {
    const parent = byId.get(current.parentCategoryId);
    if (!parent || visited.has(parent.id)) {
      break;
    }
    segments.unshift(parent.displayName);
    visited.add(parent.id);
    current = parent;
  }
  return segments.join(' / ');
}

function buildStorageCategorySlug({
  displayName,
  parentCategoryId,
  categories,
}: {
  displayName: string;
  parentCategoryId: number | null;
  categories: StorageCategoryRecord[];
}): string | null {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const segments = [displayName];
  const visited = new Set<number>();
  let currentParentId = parentCategoryId;
  while (currentParentId !== null) {
    if (visited.has(currentParentId)) {
      return null;
    }
    const parent = byId.get(currentParentId);
    if (!parent) {
      return null;
    }
    segments.unshift(parent.displayName);
    visited.add(parent.id);
    currentParentId = parent.parentCategoryId;
  }

  const slugSegments = segments.map(normalizeStorageCategorySlugSegment);
  if (slugSegments.some((segment) => segment.length === 0)) {
    return null;
  }

  const slug = slugSegments.join('_');
  return slug.length <= 128 ? slug : null;
}

function normalizeStorageCategorySlugSegment(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function orderStorageCategoriesForTree(categories: StorageCategoryRecord[], allCategories: StorageCategoryRecord[]): StorageCategoryRecord[] {
  const selectedIds = new Set(categories.map((category) => category.id));
  const childrenByParent = new Map<number | null, StorageCategoryRecord[]>();
  for (const category of categories) {
    const parentId = category.parentCategoryId !== null && selectedIds.has(category.parentCategoryId) ? category.parentCategoryId : null;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(category);
    childrenByParent.set(parentId, siblings);
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort(compareStorageCategories);
  }

  const ordered: StorageCategoryRecord[] = [];
  const visit = (parentId: number | null) => {
    for (const category of childrenByParent.get(parentId) ?? []) {
      ordered.push(category);
      visit(category.id);
    }
  };
  visit(null);

  if (ordered.length !== categories.length) {
    const orderedIds = new Set(ordered.map((category) => category.id));
    ordered.push(...categories.filter((category) => !orderedIds.has(category.id)).sort(compareStorageCategories));
  }

  return ordered;
}

function compareStorageCategories(left: StorageCategoryRecord, right: StorageCategoryRecord): number {
  return left.displayName.localeCompare(right.displayName) || left.id - right.id;
}

function resolveStorageCategoryDepth(category: StorageCategoryRecord, allCategories: StorageCategoryRecord[]): number {
  const byId = new Map(allCategories.map((candidate) => [candidate.id, candidate]));
  let depth = 0;
  let current = category;
  const visited = new Set<number>([category.id]);
  while (current.parentCategoryId !== null) {
    const parent = byId.get(current.parentCategoryId);
    if (!parent || visited.has(parent.id)) {
      break;
    }
    depth += 1;
    visited.add(parent.id);
    current = parent;
  }
  return depth;
}

function buildStorageCategoryDeepLink(categoryId: number): string {
  return buildTelegramStartUrl(`${storageCategoryStartPayloadPrefix}${categoryId}`);
}

function formatStorageCategoryLimitedFooter(total: number, shown: number, language: 'ca' | 'es' | 'en'): string {
  return createTelegramI18n(language).storage.listLimitedCategoriesFooter
    .replace('{shown}', String(shown))
    .replace('{total}', String(total));
}

function formatStorageSummaryEntry(
  detail: StorageEntryDetailRecord,
  language: 'ca' | 'es' | 'en',
  {
    includeCategory = false,
    linkMode = 'detail',
    hideAttachmentCount = false,
    linkTarget = 'title',
  }: {
    includeCategory?: boolean;
    linkMode?: 'detail' | 'edit';
    hideAttachmentCount?: boolean;
    linkTarget?: 'title' | 'description';
  } = {},
): string {
  const description = detail.entry.description ?? createTelegramI18n(language).storage.entryNoDescription;
  const title = includeCategory ? `${detail.category.displayName} · #${detail.entry.id}` : `#${detail.entry.id}`;
  const texts = createTelegramI18n(language).storage;
  const attachmentSummary = `${texts.entryFieldAttachments}: ${detail.messages.length}`;
  const tags = detail.entry.tags.length > 0 ? ` · ${detail.entry.tags.map((tag) => `#${tag}`).join(', ')}` : '';
  const payloadPrefix = linkMode === 'edit' ? storageEditEntryStartPayloadPrefix : storageEntryStartPayloadPrefix;
  const url = escapeHtml(buildTelegramStartUrl(`${payloadPrefix}${detail.entry.id}`));
  const linkedTitle = `<a href="${url}"><b>${escapeHtml(title)}</b></a>`;
  const linkedDescription = `<a href="${url}">${escapeHtml(description)}</a>`;
  if (linkTarget === 'description') {
    return `- ${linkedDescription}${escapeHtml(tags)}`;
  }
  return `- ${linkedTitle} · ${escapeHtml(description)}${hideAttachmentCount ? '' : ` · ${escapeHtml(attachmentSummary)}`}${escapeHtml(tags)}`;
}

function sortStorageEntryDetailsAlphabetically(details: StorageEntryDetailRecord[]): StorageEntryDetailRecord[] {
  return [...details].sort((left, right) => {
    const leftLabel = formatStorageEntrySortLabel(left);
    const rightLabel = formatStorageEntrySortLabel(right);
    return leftLabel.localeCompare(rightLabel, undefined, { sensitivity: 'base', numeric: true }) || left.entry.id - right.entry.id;
  });
}

function formatStorageEntrySortLabel(detail: StorageEntryDetailRecord): string {
  return (detail.entry.description ?? detail.messages.find((message) => message.originalFileName)?.originalFileName ?? '').trim();
}

function formatStorageListLimitedFooter(total: number, shown: number, language: 'ca' | 'es' | 'en'): string {
  return createTelegramI18n(language).storage.listLimitedFooter
    .replace('{shown}', String(shown))
    .replace('{total}', String(total));
}

function formatStorageEntryDetail(
  detail: StorageEntryDetailRecord,
  language: 'ca' | 'es' | 'en',
  allCategories: StorageCategoryRecord[] = [detail.category],
): string {
  const texts = createTelegramI18n(language).storage;
  const lines = [
    `<b>#${detail.entry.id}</b> · <a href="${escapeHtml(buildStorageCategoryDeepLink(detail.category.id))}">${escapeHtml(formatStorageCategoryPath(detail.category, allCategories))}</a>`,
    `<b>${escapeHtml(texts.entryFieldDescription)}:</b> ${escapeHtml(detail.entry.description ?? texts.entryNoDescription)}`,
    `<b>${escapeHtml(texts.entryFieldUploadedAt)}:</b> ${escapeHtml(formatStorageDateTime(detail.entry.createdAt))}`,
  ];
  if (detail.entry.tags.length > 0) {
    lines.push(`<b>${escapeHtml(texts.entryFieldTags)}:</b> ${detail.entry.tags.map((tag) => `#${escapeHtml(tag)}`).join(', ')}`);
  }
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

function canManageStorageCategories(context: StorageFlowContext): boolean {
  return context.runtime.actor.isAdmin || context.runtime.authorization.can('storage.category.manage');
}

function canManageStorageEntries(context: StorageFlowContext): boolean {
  return context.runtime.actor.isAdmin || context.runtime.authorization.can('storage.entry.manage');
}

function canEditStorageEntry(context: StorageFlowContext, detail: StorageEntryDetailRecord): boolean {
  return (
    canManageStorageEntries(context) ||
    detail.entry.createdByTelegramUserId === context.runtime.actor.telegramUserId
  );
}

function parsePositiveInteger(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseCallbackEntityId(callbackData: string, prefix: string): number | null {
  const parsed = Number(callbackData.slice(prefix.length));
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
