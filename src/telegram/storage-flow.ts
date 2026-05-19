import { createDatabaseStorageRepository } from '../storage/storage-catalog-store.js';
import {
  createStorageCategory,
  createStorageEntry,
  moveStorageCategoryParent,
  moveStorageEntryCategory,
  parseStorageCaptionMetadata,
  parseStorageTagInput,
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
import {
  createDatabaseStorageCategorySubscriptionRepository,
  type StorageCategorySubscriptionRepository,
} from '../storage/storage-category-subscription-store.js';
import { appendAuditEvent } from '../audit/audit-log.js';
import { createDatabaseAuditLogRepository } from '../audit/audit-log-store.js';
import { TelegramInteractionError, type TelegramCommandHandlerContext } from './command-registry.js';
import {
  createDatabaseAppMetadataSessionStorage,
  type AppMetadataSessionStorage,
} from './conversation-session-store.js';
import { buildTelegramStartUrl } from './deep-links.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import type { TelegramInlineButton, TelegramReplyButton, TelegramReplyOptions } from './runtime-boundary.js';
import { escapeHtml } from './schedule-presentation.js';
import { buildGlobalNavigationRow, buildPersistentReplyKeyboard } from './submenu-keyboards.js';
import type { TelegramPhotoMediaInput } from './telegram-media.js';

const storageUploadFlowKey = 'storage-upload';
const storageRootStartPayload = 'storage_root';
const storageEntryStartPayloadPrefix = 'storage_entry_';
const storageTagStartPayloadPrefix = 'storage_tag_';
const storageTagsStartPayloadPrefix = 'storage_tags_';
const storageCategoryStartPayloadPrefix = 'storage_category_';
const storageSelectCategoryStartPayloadPrefix = 'storage_select_category_';
const storageEditCategoryStartPayloadPrefix = 'storage_edit_category_';
const storageEditEntryStartPayloadPrefix = 'storage_edit_entry_';
const storageSelectRootCategoryStartPayload = 'storage_select_category_root';
export const storageCallbackPrefixes = {
  root: 'storage:root',
  viewCategory: 'storage:view_category:',
  viewEntry: 'storage:view_entry:',
  selectCategory: 'storage:select_category:',
  editCategory: 'storage:edit_category:',
  uploadCategory: 'storage:upload_category:',
  editEntry: 'storage:edit_entry:',
  deleteEntry: 'storage:delete_entry:',
  addEntryTags: 'storage:add_entry_tags:',
  removeEntryTags: 'storage:remove_entry_tags:',
  unsubscribeCategory: 'storage:unsubscribe_category:',
  categoryPage: 'storage:category_page:',
  categoryGoToPage: 'storage:category_goto:',
  uploadPreviewAccept: 'storage:upload_preview_accept',
  uploadPreviewDescription: 'storage:upload_preview_description',
  uploadPreviewTags: 'storage:upload_preview_tags',
  uploadPreviewImages: 'storage:upload_preview_images',
  uploadPreviewAcceptWithoutTags: 'storage:upload_preview_accept_without_tags',
  uploadPreviewCancel: 'storage:upload_preview_cancel',
} as const;
const storageListPageSize = 20;
const storageTagListPageSize = 20;
const storageCategoryListPageSize = 50;
const internalStorageCategorySlugs = new Set(['catalog-media', 'catalog_media']);
const internalStorageCategoryDisplayNames = new Set(['imagenes de catalogo', 'imágenes de catálogo']);
const storageListFlowKey = 'storage-list';
const storageSearchFlowKey = 'storage-search';
const storageTagListFlowKey = 'storage-tag-list';
const storageAddImagesFlowKey = 'storage-add-images';
const storageForwardedImportFlowKey = 'storage-forwarded-import';
const storageEditEntryFlowKey = 'storage-edit-entry';
const storageCreateCategoryFlowKey = 'storage-create-category';
const storageDefaultChatFlowKey = 'storage-default-chat';
const storageArchiveCategoryFlowKey = 'storage-archive-category';
const storageReactivateCategoryFlowKey = 'storage-reactivate-category';
const storageDeleteEntryFlowKey = 'storage-delete-entry';
const storageGrantAccessFlowKey = 'storage-grant-access';
const storageRevokeAccessFlowKey = 'storage-revoke-access';
const storageViewAccessFlowKey = 'storage-view-access';
const storageSubscribeFlowKey = 'storage-subscribe';
const storageUnsubscribeFlowKey = 'storage-unsubscribe';
const storageCategoryViewFlowKey = 'storage-category-view';
const storageRenameCategoryFlowKey = 'storage-rename-category';
const storageMoveCategoryParentFlowKey = 'storage-move-category-parent';
const storageTopicMediaGroupWindowMs = 1500;
const storageLargeAttachmentForwardThresholdBytes = 50 * 1024 * 1024;
const storageMaxAttachmentSizeBytes = 2 * 1024 * 1024 * 1024;
const storageChatRequestId = 41101;
const storageDefaultChatMetadataKey = 'storage.default_chat';

type PendingTopicMediaGroup = {
  repository: StorageCategoryRepository;
  subscriptionRepository: StorageCategorySubscriptionRepository;
  bot: StorageFlowContext['runtime']['bot'];
  language: 'ca' | 'es' | 'en';
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
  attachmentKind: 'document' | 'photo' | 'video' | 'audio' | 'text';
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

type StorageCategoryChoice = Pick<StorageCategoryRecord, 'id' | 'displayName' | 'parentCategoryId'>;

type StorageFlowContext = TelegramCommandHandlerContext & {
  storageRepository?: StorageCategoryRepository | undefined;
  storageCategoryAccessRepository?: StorageCategoryAccessRepository | undefined;
  storageCategorySubscriptionRepository?: StorageCategorySubscriptionRepository | undefined;
  storageDefaultChatStore?: AppMetadataSessionStorage | undefined;
  messageMedia?: TelegramCommandHandlerContext['messageMedia'];
  sharedChat?: TelegramCommandHandlerContext['sharedChat'];
  messageThreadId?: number | undefined;
  messageId?: number | undefined;
  isForwardedMessage?: boolean | undefined;
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
        media: TelegramPhotoMediaInput[];
        messageThreadId?: number;
      }) => Promise<Array<{ messageId: number }>>;
      deleteMessage?: (input: {
        chatId: number;
        messageId: number;
      }) => Promise<void>;
      editMessageText?: (input: {
        chatId: number;
        messageId: number;
        text: string;
        options?: TelegramReplyOptions;
      }) => Promise<void>;
    };
  };
};

export async function handleTelegramStorageCommand(context: StorageFlowContext): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).storage;
  const categories = await listMenuCategories(context);
  const rootCategories = filterStorageCategoriesByParent(categories, null);
  const summaries = await buildStorageCategorySummaries(context, categories);
  await context.reply(
    rootCategories.length === 0
      ? texts.selectMenu
      : `${escapeHtml(texts.selectMenu)}\n\n${formatStorageCategoryListMessage({ categories: rootCategories, language, summaries })}`,
    rootCategories.length === 0
      ? buildStorageMenuOptions(language, context)
      : { ...buildStorageCategoryListReplyOptions({ language, context }), parseMode: 'HTML' },
  );
}

async function listMenuCategories(context: StorageFlowContext): Promise<StorageCategoryRecord[]> {
  try {
    return canManageStorageCategories(context)
      ? (await resolveRepository(context).listCategories()).filter(isVisibleUserStorageCategory)
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

  if (parseExactStartPayload(text) === storageRootStartPayload) {
    await handleTelegramStorageCommand(context);
    return true;
  }

  const exactPayload = parseExactStartPayload(text);
  if (exactPayload === 'storage_tags') {
    const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
    return sendStorageTagList(context, 1, language);
  }

  if (exactPayload?.startsWith(storageTagsStartPayloadPrefix)) {
    const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
    return sendStorageTagList(context, parsePositiveInteger(exactPayload.slice(storageTagsStartPayloadPrefix.length)) ?? 1, language);
  }

  if (exactPayload?.startsWith(storageTagStartPayloadPrefix)) {
    const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
    return sendStorageTagResults(context, exactPayload.slice(storageTagStartPayloadPrefix.length), language);
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

  if (parseExactStartPayload(text) === storageSelectRootCategoryStartPayload) {
    const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
    if (
      context.runtime.session.current?.flowKey === storageMoveCategoryParentFlowKey &&
      context.runtime.session.current.stepKey === 'move-category-parent'
    ) {
      return selectStorageCategoryParent(context, null, language);
    }
    await context.reply(createTelegramI18n(language).storage.invalidCategory, buildStorageMenuOptions(language, context));
    return true;
  }

  const selectedCategoryId = parseStartPayload(text, storageSelectCategoryStartPayloadPrefix);
  if (selectedCategoryId !== null) {
    const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
    if (
      context.runtime.session.current?.flowKey === storageSearchFlowKey &&
      context.runtime.session.current.stepKey === 'search-scope'
    ) {
      return showStorageSearchCategoryNode(context, selectedCategoryId, language);
    }
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
      return selectCreateCategoryParent(context, selectedCategoryId, language);
    }
    if (
      context.runtime.session.current?.flowKey === storageEditEntryFlowKey &&
      context.runtime.session.current.stepKey === 'edit-entry-move-category'
    ) {
      return showStorageEntryMoveCategoryNode(context, selectedCategoryId, language);
    }
    if (
      context.runtime.session.current?.flowKey === storageMoveCategoryParentFlowKey &&
      context.runtime.session.current.stepKey === 'move-category-parent'
    ) {
      return selectStorageCategoryParent(context, selectedCategoryId, language);
    }
    if (
      context.runtime.session.current?.flowKey === storageForwardedImportFlowKey &&
      context.runtime.session.current.stepKey === 'forwarded-category'
    ) {
      return showForwardedStorageCategoryNode(context, selectedCategoryId, language);
    }
    if (
      context.runtime.session.current?.flowKey === storageSubscribeFlowKey &&
      context.runtime.session.current.stepKey === 'subscribe-category'
    ) {
      return selectStorageSubscriptionCategory(context, selectedCategoryId, language);
    }
    await context.reply(createTelegramI18n(language).storage.invalidCategory, buildStorageMenuOptions(language, context));
    return true;
  }

  const categoryId = parseStartPayload(text, storageCategoryStartPayloadPrefix);
  if (categoryId !== null) {
    const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
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

async function startStorageEntryAddTags(
  context: StorageFlowContext,
  entryId: number,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const texts = createTelegramI18n(language).storage;
  const detail = await resolveRepository(context).getEntryDetail(entryId);
  if (!detail || detail.entry.lifecycleStatus !== 'active' || !canManageStorageEntryTags(context, detail)) {
    await context.reply(texts.invalidEntryId, buildStorageMenuOptions(language, context));
    return true;
  }

  await context.runtime.session.start({
    flowKey: storageEditEntryFlowKey,
    stepKey: 'add-entry-tags',
    data: {
      entryId: detail.entry.id,
      currentTags: detail.entry.tags,
    },
  });
  await context.reply(
    texts.askAddTags.replace('{current}', formatCurrentTags(detail.entry.tags, language)),
    buildSingleCancelOptions(),
  );
  return true;
}

async function startStorageEntryRemoveTags(
  context: StorageFlowContext,
  entryId: number,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const texts = createTelegramI18n(language).storage;
  const detail = await resolveRepository(context).getEntryDetail(entryId);
  if (!detail || detail.entry.lifecycleStatus !== 'active' || detail.entry.tags.length === 0 || !canManageStorageEntryTags(context, detail)) {
    await context.reply(texts.invalidEntryId, buildStorageMenuOptions(language, context));
    return true;
  }

  await context.runtime.session.start({
    flowKey: storageEditEntryFlowKey,
    stepKey: 'remove-entry-tags',
    data: {
      entryId: detail.entry.id,
      currentTags: detail.entry.tags,
    },
  });
  await context.reply(texts.askRemoveTags, buildTagChoiceOptions(detail.entry.tags, language));
  return true;
}

async function selectStorageEntryMoveCategory(
  context: StorageFlowContext,
  categoryId: number,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const session = context.runtime.session.current;
  const texts = createTelegramI18n(language).storage;
  if (!session || session.flowKey !== storageEditEntryFlowKey || session.stepKey !== 'edit-entry-move-category') {
    await context.reply(texts.invalidCategory, buildStorageMenuOptions(language, context));
    return true;
  }

  const categories = await listUploadableCategories(context);
  const selected = categories.find((category) => category.id === categoryId);
  if (!selected) {
    await context.reply(texts.invalidCategory, {
      ...buildSingleCancelOptions(),
      parseMode: 'HTML',
    });
    return true;
  }

  const previousCategoryId = asNumber(session.data.categoryId);
  const updated = await moveStorageEntryCategory({
    repository: resolveRepository(context),
    entryId: asNumber(session.data.entryId),
    categoryId: selected.id,
  });
  await appendAuditEvent({
    repository: resolveAuditRepository(context),
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    actionKey: 'storage.entry.category_moved',
    targetType: 'storage-entry',
    targetId: updated.entry.id,
    summary: 'Categoria actualitzada a entrada de storage',
    details: {
      previousCategoryId,
      nextCategoryId: updated.category.id,
    },
  });
  await context.runtime.session.advance({
    stepKey: 'edit-entry-action',
    data: {
      ...session.data,
      categoryId: updated.category.id,
      currentDescription: updated.entry.description,
      currentTags: updated.entry.tags,
    },
  });
  await context.reply(
    `${texts.entryCategoryMoved
      .replace('{id}', String(updated.entry.id))
      .replace('{category}', updated.category.displayName)}\n\n${texts.askEditAction}`,
    buildEditEntryActionOptions(language),
  );
  return true;
}

async function showStorageEntryMoveCategoryNode(
  context: StorageFlowContext,
  categoryId: number,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const session = context.runtime.session.current;
  const texts = createTelegramI18n(language).storage;
  if (!session || session.flowKey !== storageEditEntryFlowKey || session.stepKey !== 'edit-entry-move-category') {
    await context.reply(texts.invalidCategory, buildStorageMenuOptions(language, context));
    return true;
  }

  const categories = asCategoryChoices(session.data.categories);
  const selected = categories.find((category) => category.id === categoryId);
  if (!selected) {
    await context.reply(texts.invalidCategory, buildMoveEntryCategoryOptions({ categories, currentCategoryId: asNullableNumber(session.data.currentMoveCategoryId), language }));
    return true;
  }

  await context.runtime.session.advance({
    stepKey: 'edit-entry-move-category',
    data: {
      ...session.data,
      currentMoveCategoryId: selected.id,
    },
  });
  await context.reply(
    formatMoveEntryCategoryPrompt({ categories, currentCategoryId: selected.id, language }),
    buildMoveEntryCategoryOptions({ categories, currentCategoryId: selected.id, language }),
  );
  return true;
}

export async function handleTelegramStorageCallback(context: StorageFlowContext): Promise<boolean> {
  const callbackData = context.callbackData;
  if (!callbackData || context.runtime.chat.kind !== 'private' || !context.runtime.actor.isApproved || context.runtime.actor.isBlocked) {
    return false;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  if (callbackData === storageCallbackPrefixes.root) {
    await context.runtime.session.cancel();
    await handleTelegramStorageCommand(context);
    return true;
  }

  if (callbackData.startsWith(storageCallbackPrefixes.viewCategory)) {
    const categoryId = parseCallbackEntityId(callbackData, storageCallbackPrefixes.viewCategory);
    if (categoryId === null) {
      await context.reply(createTelegramI18n(language).storage.invalidCategory, buildStorageMenuOptions(language, context));
      return true;
    }
    return sendStorageCategoryEntryList(context, categoryId, language);
  }

  if (callbackData.startsWith(storageCallbackPrefixes.viewEntry)) {
    const entryId = parseCallbackEntityId(callbackData, storageCallbackPrefixes.viewEntry);
    if (entryId === null) {
      await context.reply(createTelegramI18n(language).storage.invalidEntryId, buildStorageMenuOptions(language, context));
      return true;
    }
    return sendStorageEntryDetail(context, entryId, language);
  }

  if (callbackData.startsWith(storageCallbackPrefixes.selectCategory)) {
    const categoryId = parseCallbackEntityId(callbackData, storageCallbackPrefixes.selectCategory);
    if (categoryId === null) {
      await context.reply(createTelegramI18n(language).storage.invalidCategory, buildStorageMenuOptions(language, context));
      return true;
    }
    return handleSelectedStorageCategoryCallback(context, categoryId, language);
  }

  if (callbackData.startsWith(storageCallbackPrefixes.editCategory)) {
    const categoryId = parseCallbackEntityId(callbackData, storageCallbackPrefixes.editCategory);
    if (categoryId === null) {
      await context.reply(createTelegramI18n(language).storage.invalidCategory, buildStorageMenuOptions(language, context));
      return true;
    }
    return sendStorageEditableEntryList(context, categoryId, language);
  }

  if (callbackData.startsWith(storageCallbackPrefixes.uploadCategory)) {
    const categoryId = parseCallbackEntityId(callbackData, storageCallbackPrefixes.uploadCategory);
    const texts = createTelegramI18n(language).storage;
    const category = categoryId === null ? null : await resolveRepository(context).findCategoryById(categoryId);
    if (!category || category.lifecycleStatus !== 'active') {
      await context.reply(texts.invalidCategory, buildStorageMenuOptions(language, context));
      return true;
    }
    await context.runtime.session.start({
      flowKey: storageUploadFlowKey,
      stepKey: 'upload-media',
      data: { categoryId: category.id, categoryDisplayName: category.displayName, messages: [] },
    });
    await context.reply(texts.askUploadMedia, buildUploadMediaOptions(language));
    return true;
  }

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

  if (callbackData.startsWith(storageCallbackPrefixes.addEntryTags)) {
    const entryId = parseCallbackEntityId(callbackData, storageCallbackPrefixes.addEntryTags);
    if (entryId === null) {
      await context.reply(createTelegramI18n(language).storage.invalidEntryId, buildStorageMenuOptions(language, context));
      return true;
    }
    return startStorageEntryAddTags(context, entryId, language);
  }

  if (callbackData.startsWith(storageCallbackPrefixes.removeEntryTags)) {
    const entryId = parseCallbackEntityId(callbackData, storageCallbackPrefixes.removeEntryTags);
    if (entryId === null) {
      await context.reply(createTelegramI18n(language).storage.invalidEntryId, buildStorageMenuOptions(language, context));
      return true;
    }
    return startStorageEntryRemoveTags(context, entryId, language);
  }

  if (callbackData.startsWith(storageCallbackPrefixes.unsubscribeCategory)) {
    const categoryId = parseCallbackEntityId(callbackData, storageCallbackPrefixes.unsubscribeCategory);
    const texts = createTelegramI18n(language).storage;
    if (categoryId === null) {
      await context.reply(texts.invalidCategory, buildStorageMenuOptions(language, context));
      return true;
    }
    const category = await resolveRepository(context).findCategoryById(categoryId);
    const removed = await resolveSubscriptionRepository(context).deleteSubscription({
      telegramUserId: context.runtime.actor.telegramUserId,
      categoryId,
    });
    await context.reply(
      removed
        ? texts.subscriptionRemoved.replace('{category}', category?.displayName ?? String(categoryId))
        : texts.subscriptionNotFound.replace('{category}', category?.displayName ?? String(categoryId)),
      buildStorageMenuOptions(language, context),
    );
    return true;
  }

  if (callbackData.startsWith(storageCallbackPrefixes.categoryPage)) {
    const page = parseCategoryPageCallback(callbackData, storageCallbackPrefixes.categoryPage);
    if (!page) {
      await context.reply(createTelegramI18n(language).storage.invalidNumber, buildStorageMenuOptions(language, context));
      return true;
    }
    return sendStorageCategoryEntryList(context, page.categoryId, language, page.page);
  }

  if (callbackData.startsWith(storageCallbackPrefixes.categoryGoToPage)) {
    const categoryId = parseCallbackEntityId(callbackData, storageCallbackPrefixes.categoryGoToPage);
    if (categoryId === null) {
      await context.reply(createTelegramI18n(language).storage.invalidCategory, buildStorageMenuOptions(language, context));
      return true;
    }
    await context.runtime.session.start({
      flowKey: storageListFlowKey,
      stepKey: 'category-page-input',
      data: { categoryId },
    });
    await context.reply(createTelegramI18n(language).storage.askListPage, buildSingleCancelOptions());
    return true;
  }

  if (callbackData === storageCallbackPrefixes.uploadPreviewAccept) {
    return handleStorageUploadPreviewAction(context, 'accept', language);
  }

  if (callbackData === storageCallbackPrefixes.uploadPreviewAcceptWithoutTags) {
    return handleStorageUploadPreviewAction(context, 'accept-without-tags', language);
  }

  if (callbackData === storageCallbackPrefixes.uploadPreviewDescription) {
    return handleStorageUploadPreviewAction(context, 'description', language);
  }

  if (callbackData === storageCallbackPrefixes.uploadPreviewTags) {
    return handleStorageUploadPreviewAction(context, 'tags', language);
  }

  if (callbackData === storageCallbackPrefixes.uploadPreviewImages) {
    return handleStorageUploadPreviewAction(context, 'images', language);
  }

  if (callbackData === storageCallbackPrefixes.uploadPreviewCancel) {
    await context.runtime.session.cancel();
    await handleTelegramStorageCommand(context);
    return true;
  }

  return false;
}

async function handleSelectedStorageCategoryCallback(
  context: StorageFlowContext,
  selectedCategoryId: number,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const current = context.runtime.session.current;
  if (
    current?.flowKey === storageSearchFlowKey &&
    current.stepKey === 'search-scope'
  ) {
    return showStorageSearchCategoryNode(context, selectedCategoryId, language);
  }
  if (
    current?.flowKey === storageUploadFlowKey &&
    current.stepKey === 'upload-category'
  ) {
    return showStorageUploadCategoryNode(context, selectedCategoryId, language);
  }
  if (
    current?.flowKey === storageCreateCategoryFlowKey &&
    current.stepKey === 'create-category-parent'
  ) {
    return selectCreateCategoryParent(context, selectedCategoryId, language);
  }
  if (
    current?.flowKey === storageEditEntryFlowKey &&
    current.stepKey === 'edit-entry-move-category'
  ) {
    return selectStorageEntryMoveCategory(context, selectedCategoryId, language);
  }
  if (
    current?.flowKey === storageMoveCategoryParentFlowKey &&
    current.stepKey === 'move-category-parent'
  ) {
    return selectStorageCategoryParent(context, selectedCategoryId, language);
  }
  if (
    current?.flowKey === storageSubscribeFlowKey &&
    current.stepKey === 'subscribe-category'
  ) {
    return selectStorageSubscriptionCategory(context, selectedCategoryId, language);
  }

  await context.reply(createTelegramI18n(language).storage.invalidCategory, buildStorageMenuOptions(language, context));
  return true;
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
      tagCounts: await buildReadableStorageTagCounts(context),
    }),
    { ...buildStorageEntryChoiceOptions(editableDetails), parseMode: 'HTML' },
  );
  return true;
}

async function sendStorageCategoryEntryList(
  context: StorageFlowContext,
  categoryId: number,
  language: 'ca' | 'es' | 'en',
  page = 1,
): Promise<boolean> {
  const texts = createTelegramI18n(language).storage;
  const categories = await listReadableCategories(context);
  const category = categories.find((candidate) => candidate.id === categoryId);
  if (!category) {
    await context.reply(texts.invalidCategory, buildStorageMenuOptions(language, context));
    return true;
  }

  const details = await resolveRepository(context).listEntryDetailsByCategory(category.id);
  const visibleDetails = details.filter((detail) => detail.entry.lifecycleStatus === 'active');
  const children = categories.filter((candidate) => candidate.parentCategoryId === category.id);
  const summaries = await buildStorageCategorySummaries(context, categories);
  const tagCounts = await buildReadableStorageTagCounts(context);
  await context.runtime.session.start({
    flowKey: storageCategoryViewFlowKey,
    stepKey: 'category-view',
    data: {
      categoryId: category.id,
      parentCategoryId: category.parentCategoryId,
      categoryDisplayName: category.displayName,
      page,
    },
  });
  await context.reply(
    formatStorageCategoryDetailMessage({
      category,
      childCategories: children,
      details: visibleDetails,
      allCategories: categories,
      summaries,
      language,
      page,
      tagCounts,
    }),
    buildStorageCategoryEntryListOptions({
      context,
      category,
      page,
      totalItems: visibleDetails.length,
      language,
    }),
  );
  return true;
}

function buildStorageCategoryEntryListOptions({
  context,
  category,
  page,
  totalItems,
  language,
}: {
  context: StorageFlowContext;
  category: StorageCategoryRecord;
  page: number;
  totalItems: number;
  language: 'ca' | 'es' | 'en';
}): TelegramReplyOptions {
  const paginationRow = buildStorageCategoryPaginationRow({ page, totalItems, language });
  return {
    ...buildStorageCategoryViewReplyOptions({
      context,
      category,
      language,
      ...(paginationRow.length > 0 ? { paginationRow } : {}),
    }),
    parseMode: 'HTML',
  };
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
    parseStartPayload(text, storageSelectCategoryStartPayloadPrefix) !== null
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
  if (context.runtime.session.current?.flowKey === storageTagListFlowKey) {
    return handleActiveTagListFlow(context, text, language);
  }
  if (context.runtime.session.current?.flowKey === storageAddImagesFlowKey) {
    return handleActiveAddImagesFlow(context, text, language);
  }
  if (context.runtime.session.current?.flowKey === storageForwardedImportFlowKey) {
    return handleActiveForwardedImportFlow(context, text, language);
  }
  if (context.runtime.session.current?.flowKey === storageEditEntryFlowKey) {
    return handleActiveEditEntryFlow(context, text, language);
  }
  if (context.runtime.session.current?.flowKey === storageCreateCategoryFlowKey) {
    return handleActiveCreateCategoryFlow(context, text, language);
  }
  if (context.runtime.session.current?.flowKey === storageDefaultChatFlowKey) {
    return handleActiveDefaultChatFlow(context, text, language);
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
  if (context.runtime.session.current?.flowKey === storageSubscribeFlowKey) {
    return handleActiveSubscribeFlow(context, text, language);
  }
  if (context.runtime.session.current?.flowKey === storageUnsubscribeFlowKey) {
    return handleActiveUnsubscribeFlow(context, text, language);
  }
  if (context.runtime.session.current?.flowKey === storageRenameCategoryFlowKey) {
    return handleActiveRenameCategoryFlow(context, text, language);
  }
  if (context.runtime.session.current?.flowKey === storageMoveCategoryParentFlowKey) {
    return handleActiveMoveCategoryParentFlow(context, text, language);
  }
  if (context.runtime.session.current?.flowKey === storageCategoryViewFlowKey) {
    const handledCategoryAction = await handleActiveCategoryViewAction(context, text, language);
    if (handledCategoryAction) {
      return true;
    }
  }

  if (text === '/storage' || text === texts.openMenu || text === actionMenuTexts.storage) {
    await handleTelegramStorageCommand(context);
    return true;
  }

  if (text === texts.listCategories) {
    const categories = canManageStorageCategories(context)
      ? (await resolveRepository(context).listCategories()).filter(isVisibleUserStorageCategory)
      : await listReadableCategories(context);
    const rootCategories = filterStorageCategoriesByParent(categories, null);
    const summaries = await buildStorageCategorySummaries(context, categories);
    await context.reply(
      rootCategories.length === 0
        ? texts.noReadableCategories
        : formatStorageCategoryListMessage({
          categories: rootCategories,
          language,
          summaries,
        }),
      rootCategories.length === 0
        ? buildStorageMenuOptions(language, context)
        : { ...buildStorageCategoryListReplyOptions({ language, context }), parseMode: 'HTML' },
    );
    return true;
  }

  if (text === texts.listTags) {
    return sendStorageTagList(context, 1, language);
  }

  const selectedVisibleCategory = await findVisibleStorageCategoryByDisplayName(context, text);
  if (selectedVisibleCategory) {
    return sendStorageCategoryEntryList(context, selectedVisibleCategory.id, language);
  }

  if (text === texts.searchFiles) {
    const categories = await listReadableCategories(context);
    await context.runtime.session.start({
      flowKey: storageSearchFlowKey,
      stepKey: categories.length === 0 ? 'search-query' : 'search-mode',
      data: {
        categories: toStorageCategoryChoices(categories),
      },
    });
    await context.reply(
      categories.length === 0
        ? formatStorageSearchQueryPrompt(language)
        : formatStorageSearchModePrompt(language),
      categories.length === 0 ? { ...buildSingleCancelOptions(), parseMode: 'HTML' } : buildStorageSearchModeOptions(language),
    );
    return true;
  }

  if (text === texts.mySubscriptions) {
    await sendStorageSubscriptionSummary(context, language);
    return true;
  }

  if (text === texts.subscribeCategory) {
    const categories = await listReadableCategories(context);
    if (categories.length === 0) {
      await context.reply(texts.noReadableCategories, buildStorageMenuOptions(language, context));
      return true;
    }
    await context.runtime.session.start({
      flowKey: storageSubscribeFlowKey,
      stepKey: 'subscribe-category',
      data: {
        categories: toStorageCategoryChoices(categories),
      },
    });
    await context.reply(
      `${escapeHtml(texts.askSubscribeCategory)}\n${formatStorageCategoryListMessage({ categories, language, linkMode: 'select' })}`,
      { ...buildSingleCancelOptions(), parseMode: 'HTML' },
    );
    return true;
  }

  if (text === texts.unsubscribeCategory) {
    const categories = await listSubscribedReadableCategories(context);
    if (categories.length === 0) {
      await context.reply(texts.noStorageSubscriptions, buildStorageMenuOptions(language, context));
      return true;
    }
    await context.runtime.session.start({
      flowKey: storageUnsubscribeFlowKey,
      stepKey: 'unsubscribe-category',
      data: {
        categories: toStorageCategoryChoices(categories),
      },
    });
    await context.reply(texts.askUnsubscribeCategory, buildCategoryChoiceOptions(categories, language));
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
        categories: toStorageCategoryChoices(categories),
      },
    });
    await context.reply(
      `${escapeHtml(texts.askEditCategory)}\n${formatStorageCategoryLinks(categories, language, categories, { linkMode: 'edit' }).join('\n')}`,
      { ...buildSingleCancelOptions(), parseMode: 'HTML' },
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
        categories: toStorageCategoryChoices(categories),
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
        categories: toStorageCategoryChoices(categories),
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
        categories: toStorageCategoryChoices(categories),
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

  if (text === texts.configureDefaultStorageChat && canManageStorageCategories(context)) {
    await context.runtime.session.start({
      flowKey: storageDefaultChatFlowKey,
      stepKey: 'default-chat-select',
      data: {},
    });
    await context.reply(texts.askDefaultStorageChat, buildStorageDefaultChatSelectOptions(language));
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
        categories: toStorageCategoryChoices(categories),
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
        categories: toStorageCategoryChoices(categories),
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
        categories: toStorageCategoryChoices(categories),
        currentMoveCategoryId: null,
      },
    });
    await context.reply(
      formatMoveEntryCategoryPrompt({ categories: toStorageCategoryChoices(categories), currentCategoryId: null, language, prompt: texts.askUploadCategory }),
      buildUploadCategoryOptions({ categories: toStorageCategoryChoices(categories), currentCategoryId: null, language }),
    );
    return true;
  }

  return false;
}

async function handleActiveSubscribeFlow(context: StorageFlowContext, text: string, language: 'ca' | 'es' | 'en'): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageSubscribeFlowKey) {
    return false;
  }

  const texts = createTelegramI18n(language).storage;
  if (session.stepKey === 'subscribe-category') {
    const categories = asCategoryChoices(session.data.categories);
    const selected = categories.find((category) => category.displayName === text);
    return selectStorageSubscriptionCategory(context, selected?.id ?? NaN, language);
  }

  if (session.stepKey === 'subscribe-scope') {
    const categoryId = asNumber(session.data.categoryId);
    if (text !== texts.subscribeScopeCategoryOnly && text !== texts.subscribeScopeWithSubcategories) {
      await context.reply(texts.invalidSubscriptionScope, buildStorageSubscriptionScopeOptions(language));
      return true;
    }
    const includeSubcategories = text === texts.subscribeScopeWithSubcategories;
    const category = await resolveRepository(context).findCategoryById(categoryId);
    if (!category || category.lifecycleStatus !== 'active') {
      await context.runtime.session.cancel();
      await context.reply(texts.invalidCategory, buildStorageMenuOptions(language, context));
      return true;
    }
    await resolveSubscriptionRepository(context).upsertSubscription({
      telegramUserId: context.runtime.actor.telegramUserId,
      categoryId,
      includeSubcategories,
    });
    await context.runtime.session.cancel();
    await context.reply(
      (includeSubcategories ? texts.subscriptionSavedWithSubcategories : texts.subscriptionSavedCategoryOnly)
        .replace('{category}', category.displayName),
      buildStorageMenuOptions(language, context),
    );
    return true;
  }

  return false;
}

async function selectStorageSubscriptionCategory(
  context: StorageFlowContext,
  categoryId: number,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const texts = createTelegramI18n(language).storage;
  const categories = await listReadableCategories(context);
  const selected = categories.find((category) => category.id === categoryId);
  if (!selected) {
    await context.reply(texts.invalidCategory, buildCategoryChoiceOptions(categories, language));
    return true;
  }

  await context.runtime.session.advance({
    stepKey: 'subscribe-scope',
    data: { categoryId: selected.id, categoryDisplayName: selected.displayName },
  });
  await context.reply(texts.askSubscriptionScope.replace('{category}', selected.displayName), buildStorageSubscriptionScopeOptions(language));
  return true;
}

async function handleActiveUnsubscribeFlow(context: StorageFlowContext, text: string, language: 'ca' | 'es' | 'en'): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageUnsubscribeFlowKey) {
    return false;
  }

  const texts = createTelegramI18n(language).storage;
  const categories = await listSubscribedReadableCategories(context);
  const selected = categories.find((category) => category.displayName === text);
  if (!selected) {
    await context.reply(texts.invalidCategory, buildCategoryChoiceOptions(categories, language));
    return true;
  }

  const removed = await resolveSubscriptionRepository(context).deleteSubscription({
    telegramUserId: context.runtime.actor.telegramUserId,
    categoryId: selected.id,
  });
  await context.runtime.session.cancel();
  await context.reply(
    removed ? texts.subscriptionRemoved.replace('{category}', selected.displayName) : texts.subscriptionNotFound.replace('{category}', selected.displayName),
    buildStorageMenuOptions(language, context),
  );
  return true;
}

async function handleActiveTagListFlow(context: StorageFlowContext, text: string, language: 'ca' | 'es' | 'en'): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageTagListFlowKey) {
    return false;
  }

  const texts = createTelegramI18n(language).storage;
  const page = asOptionalNumber(session.data.page) ?? 1;
  const totalItems = asOptionalNumber(session.data.totalItems) ?? 0;
  if (session.stepKey === 'tag-results') {
    const tag = asNullableString(session.data.tag);
    if (!tag) {
      return false;
    }
    if (text === texts.paginationPrevious) {
      return sendStorageTagResults(context, tag, language, Math.max(1, page - 1));
    }
    if (text === texts.paginationNext) {
      return sendStorageTagResults(context, tag, language, Math.min(calculateStorageListTotalPages(totalItems), page + 1));
    }
    return false;
  }

  if (text === texts.paginationPrevious) {
    return sendStorageTagList(context, Math.max(1, page - 1), language);
  }
  if (text === texts.paginationNext) {
    return sendStorageTagList(context, Math.min(calculateStorageTagListTotalPages(totalItems), page + 1), language);
  }
  return false;
}

async function handleActiveForwardedImportFlow(context: StorageFlowContext, text: string, language: 'ca' | 'es' | 'en'): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageForwardedImportFlowKey) {
    return false;
  }

  const texts = createTelegramI18n(language).storage;
  if (session.stepKey === 'forwarded-action') {
    if (text !== texts.forwardedAddToStorage) {
      await context.reply(texts.invalidForwardedAction, buildForwardedImportActionOptions(language));
      return true;
    }
    const categories = await listUploadableCategories(context);
    if (categories.length === 0) {
      await context.runtime.session.cancel();
      await context.reply(texts.noCategoriesForAction, buildStorageMenuOptions(language, context));
      return true;
    }
    await context.runtime.session.advance({
      stepKey: 'forwarded-category',
      data: {
        ...session.data,
        categories: toStorageCategoryChoices(categories),
        currentMoveCategoryId: null,
      },
    });
    await context.reply(
      formatMoveEntryCategoryPrompt({ categories, currentCategoryId: null, language, prompt: texts.askUploadCategory }),
      buildMoveEntryCategoryOptions({ categories, currentCategoryId: null, language }),
    );
    return true;
  }

  if (session.stepKey === 'forwarded-category') {
    const categories = asCategoryChoices(session.data.categories);
    const currentCategoryId = asNullableNumber(session.data.currentMoveCategoryId);
    const currentCategory = currentCategoryId === null ? null : categories.find((category) => category.id === currentCategoryId) ?? null;
    if (currentCategory && text === texts.selectCurrentMoveCategory.replace('{category}', currentCategory.displayName)) {
      return selectForwardedStorageCategory(context, currentCategory.id, language);
    }

    if (text === texts.back) {
      const parentCategoryId = currentCategory ? asNullableNumber(currentCategory.parentCategoryId) : null;
      await context.runtime.session.advance({
        stepKey: 'forwarded-category',
        data: {
          ...session.data,
          currentMoveCategoryId: parentCategoryId,
        },
      });
      await context.reply(
        formatMoveEntryCategoryPrompt({ categories, currentCategoryId: parentCategoryId, language, prompt: texts.askUploadCategory }),
        buildMoveEntryCategoryOptions({ categories, currentCategoryId: parentCategoryId, language }),
      );
      return true;
    }

    const selected = categories.find((category) => category.displayName === text);
    if (selected) {
      return showForwardedStorageCategoryNode(context, selected.id, language);
    }

    await context.reply(texts.invalidCategory, buildMoveEntryCategoryOptions({ categories, currentCategoryId, language }));
    return true;
  }

  return false;
}

async function showForwardedStorageCategoryNode(
  context: StorageFlowContext,
  categoryId: number,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const session = context.runtime.session.current;
  const texts = createTelegramI18n(language).storage;
  if (!session || session.flowKey !== storageForwardedImportFlowKey || session.stepKey !== 'forwarded-category') {
    await context.reply(texts.invalidCategory, buildStorageMenuOptions(language, context));
    return true;
  }

  const categories = asCategoryChoices(session.data.categories);
  const selected = categories.find((category) => category.id === categoryId);
  if (!selected) {
    await context.reply(texts.invalidCategory, buildMoveEntryCategoryOptions({ categories, currentCategoryId: asNullableNumber(session.data.currentMoveCategoryId), language }));
    return true;
  }

  await context.runtime.session.advance({
    stepKey: 'forwarded-category',
    data: {
      ...session.data,
      currentMoveCategoryId: selected.id,
    },
  });
  await context.reply(
    formatMoveEntryCategoryPrompt({ categories, currentCategoryId: selected.id, language, prompt: texts.askUploadCategory }),
    buildMoveEntryCategoryOptions({ categories, currentCategoryId: selected.id, language }),
  );
  return true;
}

async function selectForwardedStorageCategory(
  context: StorageFlowContext,
  categoryId: number,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const session = context.runtime.session.current;
  const texts = createTelegramI18n(language).storage;
  if (!session || session.flowKey !== storageForwardedImportFlowKey || session.stepKey !== 'forwarded-category') {
    await context.reply(texts.invalidCategory, buildStorageMenuOptions(language, context));
    return true;
  }
  const categories = asCategoryChoices(session.data.categories);
  const selected = categories.find((category) => category.id === categoryId);
  if (!selected) {
    await context.reply(texts.invalidCategory, buildMoveEntryCategoryOptions({ categories, currentCategoryId: asNullableNumber(session.data.currentMoveCategoryId), language }));
    return true;
  }

  const messages = asDraftMessages(session.data.messages);
  const data = {
    categoryId: selected.id,
    categoryDisplayName: selected.displayName,
    messages,
    description: resolveDefaultUploadDescription(messages, language),
    tags: collectDraftStorageTags(messages),
  };
  await context.runtime.session.start({
    flowKey: storageUploadFlowKey,
    stepKey: 'upload-tags',
    data,
  });
  await context.reply(texts.askTags, buildSkipOptionalOptions(language));
  return true;
}

async function sendStorageSubscriptionSummary(context: StorageFlowContext, language: 'ca' | 'es' | 'en'): Promise<void> {
  const texts = createTelegramI18n(language).storage;
  const subscriptions = await resolveSubscriptionRepository(context).listSubscriptionsByUser(context.runtime.actor.telegramUserId);
  if (subscriptions.length === 0) {
    await context.reply(texts.noStorageSubscriptions, buildStorageMenuOptions(language, context));
    return;
  }

  const categories = await resolveRepository(context).listCategories();
  const byId = new Map(categories.map((category) => [category.id, category]));
  const lines = [escapeHtml(texts.storageSubscriptionsHeader)];
  for (const subscription of subscriptions) {
    const category = byId.get(subscription.categoryId);
    if (!category) {
      continue;
    }
    const scope = subscription.includeSubcategories ? texts.subscriptionScopeWithSubcategoriesLabel : texts.subscriptionScopeCategoryOnlyLabel;
    lines.push(`- <b>${escapeHtml(formatStorageCategoryPath(category, categories))}</b> · ${escapeHtml(scope)}`);
  }
  await context.reply(lines.join('\n'), { ...buildStorageMenuOptions(language, context), parseMode: 'HTML' });
}

async function handleActiveCreateCategoryFlow(context: StorageFlowContext, text: string, language: 'ca' | 'es' | 'en'): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageCreateCategoryFlowKey) {
    return false;
  }

  const texts = createTelegramI18n(language).storage;
  if (session.stepKey === 'create-category-name') {
    const categories = (await resolveRepository(context).listCategories()).filter((category) => category.lifecycleStatus === 'active');
    const fixedParentCategoryId = asOptionalNumber(session.data.fixedParentCategoryId);
    await context.runtime.session.advance({
      stepKey: 'create-category-parent',
      data: {
        ...session.data,
        displayName: text,
        categories: toStorageCategoryChoices(categories),
      },
    });
    if (fixedParentCategoryId !== null) {
      return selectCreateCategoryParent(context, fixedParentCategoryId, language);
    }
    await context.reply(formatCreateCategoryParentPrompt(categories, language), { ...buildSkipOptionalOptions(language), parseMode: 'HTML' });
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
      stepKey: 'create-category-chat-select',
      data: { ...session.data, slug: text, description: null },
    });
    return createCategoryWithDefaultStorageChatOrFallback(context, language);
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
    stepKey: 'create-category-chat-select',
    data: { ...session.data, parentCategoryId: selectedParentId, slug: generatedSlug, description: null },
  });
  return createCategoryWithDefaultStorageChatOrFallback(context, language);
}

async function handleActiveDefaultChatFlow(context: StorageFlowContext, text: string, language: 'ca' | 'es' | 'en'): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageDefaultChatFlowKey) {
    return false;
  }

  const texts = createTelegramI18n(language).storage;
  if (session.stepKey !== 'default-chat-select') {
    return false;
  }

  const chatId = parseSignedInteger(text);
  if (chatId === null) {
    await context.reply(texts.askDefaultStorageChat, buildStorageDefaultChatSelectOptions(language));
    return true;
  }

  return saveDefaultStorageChatFromSelection(context, chatId, language);
}

async function handleActiveCategoryViewAction(
  context: StorageFlowContext,
  text: string,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageCategoryViewFlowKey || session.stepKey !== 'category-view') {
    return false;
  }

  const texts = createTelegramI18n(language).storage;
  const categoryId = asNumber(session.data.categoryId);
  const page = Number(session.data.page ?? 1);
  const category = await resolveRepository(context).findCategoryById(categoryId);
  if (!category || category.lifecycleStatus !== 'active') {
    await context.runtime.session.cancel();
    await context.reply(texts.invalidCategory, buildStorageMenuOptions(language, context));
    return true;
  }
  const categories = await listReadableCategories(context);
  const childCategory = categories.find((candidate) => candidate.parentCategoryId === category.id && candidate.displayName === text);
  if (childCategory) {
    return sendStorageCategoryEntryList(context, childCategory.id, language);
  }

  if (text === texts.openMenu || text === createTelegramI18n(language).actionMenu.storage) {
    await context.runtime.session.cancel();
    await handleTelegramStorageCommand(context);
    return true;
  }

  if (text === texts.back) {
    await context.runtime.session.cancel();
    if (category.parentCategoryId !== null) {
      return sendStorageCategoryEntryList(context, category.parentCategoryId, language);
    }
    await handleTelegramStorageCommand(context);
    return true;
  }

  if (text === texts.paginationPrevious) {
    return sendStorageCategoryEntryList(context, category.id, language, Math.max(1, page - 1));
  }

  if (text === texts.paginationNext) {
    return sendStorageCategoryEntryList(context, category.id, language, page + 1);
  }

  if (text === texts.paginationGoToPage) {
    await context.runtime.session.start({
      flowKey: storageListFlowKey,
      stepKey: 'category-page-input',
      data: { categoryId: category.id },
    });
    await context.reply(texts.askListPage, buildSingleCancelOptions());
    return true;
  }

  if (text === texts.upload) {
    await context.runtime.session.start({
      flowKey: storageUploadFlowKey,
      stepKey: 'upload-media',
      data: { categoryId: category.id, categoryDisplayName: category.displayName, messages: [] },
    });
    await context.reply(texts.askUploadMedia, buildUploadMediaOptions(language));
    return true;
  }

  if (text === texts.addSubcategory && canManageStorageCategories(context)) {
    await context.runtime.session.start({
      flowKey: storageCreateCategoryFlowKey,
      stepKey: 'create-category-name',
      data: { fixedParentCategoryId: category.id },
    });
    await context.reply(texts.askCategoryName, buildSingleCancelOptions());
    return true;
  }

  if (text === texts.renameCategory && canManageStorageCategories(context)) {
    await context.runtime.session.start({
      flowKey: storageRenameCategoryFlowKey,
      stepKey: 'rename-category-name',
      data: { categoryId: category.id },
    });
    await context.reply(texts.askRenameCategory, buildSingleCancelOptions());
    return true;
  }

  if (text === texts.changeCategoryParent && canManageStorageCategories(context)) {
    const parentChoices = buildStorageCategoryParentChoices(category, await listActiveCategories(context));
    await context.runtime.session.start({
      flowKey: storageMoveCategoryParentFlowKey,
      stepKey: 'move-category-parent',
      data: { categoryId: category.id },
    });
    await context.reply(
      formatMoveCategoryParentPrompt({ category, parentChoices, allCategories: categories, language }),
      { ...buildSingleCancelOptions(), parseMode: 'HTML' },
    );
    return true;
  }

  return false;
}

async function handleActiveRenameCategoryFlow(
  context: StorageFlowContext,
  text: string,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageRenameCategoryFlowKey || session.stepKey !== 'rename-category-name') {
    return false;
  }
  if (!canManageStorageCategories(context)) {
    await context.runtime.session.cancel();
    await context.reply(createTelegramI18n(language).storage.invalidCategory, buildStorageMenuOptions(language, context));
    return true;
  }

  const repository = resolveRepository(context);
  const renamed = await repository.updateCategoryMetadata({
    categoryId: asNumber(session.data.categoryId),
    displayName: text,
  });
  await appendAuditEvent({
    repository: resolveAuditRepository(context),
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    actionKey: 'storage.category.renamed',
    targetType: 'storage-category',
    targetId: renamed.id,
    summary: 'Categoria de storage renombrada',
    details: { displayName: renamed.displayName },
  });
  await context.runtime.session.cancel();
  await context.reply(
    createTelegramI18n(language).storage.categoryRenamed.replace('{name}', renamed.displayName),
    buildStorageMenuOptions(language, context),
  );
  return sendStorageCategoryEntryList(context, renamed.id, language);
}

async function handleActiveMoveCategoryParentFlow(
  context: StorageFlowContext,
  text: string,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageMoveCategoryParentFlowKey || session.stepKey !== 'move-category-parent') {
    return false;
  }
  const texts = createTelegramI18n(language).storage;
  if (!canManageStorageCategories(context)) {
    await context.runtime.session.cancel();
    await context.reply(texts.invalidCategory, buildStorageMenuOptions(language, context));
    return true;
  }
  if (text === texts.skipOptional) {
    return selectStorageCategoryParent(context, null, language);
  }

  const categoryId = asNumber(session.data.categoryId);
  const category = await resolveRepository(context).findCategoryById(categoryId);
  const parentChoices = category ? buildStorageCategoryParentChoices(category, await listActiveCategories(context)) : [];
  const selected = parentChoices.find((candidate) => candidate.displayName === text);
  if (!selected) {
    await context.reply(texts.invalidCategory, {
      ...buildSingleCancelOptions(),
      parseMode: 'HTML',
    });
    return true;
  }
  return selectStorageCategoryParent(context, selected.id, language);
}

async function selectStorageCategoryParent(
  context: StorageFlowContext,
  parentCategoryId: number | null,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const session = context.runtime.session.current;
  const texts = createTelegramI18n(language).storage;
  if (!session || session.flowKey !== storageMoveCategoryParentFlowKey || session.stepKey !== 'move-category-parent') {
    await context.reply(texts.invalidCategory, buildStorageMenuOptions(language, context));
    return true;
  }
  if (!canManageStorageCategories(context)) {
    await context.runtime.session.cancel();
    await context.reply(texts.invalidCategory, buildStorageMenuOptions(language, context));
    return true;
  }

  const repository = resolveRepository(context);
  const categoryId = asNumber(session.data.categoryId);
  const category = await repository.findCategoryById(categoryId);
  const activeCategories = await listActiveCategories(context);
  if (!category || category.lifecycleStatus !== 'active') {
    await context.runtime.session.cancel();
    await context.reply(texts.invalidCategory, buildStorageMenuOptions(language, context));
    return true;
  }

  const parentChoices = buildStorageCategoryParentChoices(category, activeCategories);
  const selectedParent = parentCategoryId === null
    ? null
    : parentChoices.find((candidate) => candidate.id === parentCategoryId) ?? null;
  if (parentCategoryId !== null && !selectedParent) {
    await context.reply(
      `${escapeHtml(texts.invalidCategory)}\n${formatMoveCategoryParentPrompt({ category, parentChoices, allCategories: activeCategories, language })}`,
      { ...buildSingleCancelOptions(), parseMode: 'HTML' },
    );
    return true;
  }

  const previousParentCategoryId = category.parentCategoryId;
  const moved = await moveStorageCategoryParent({
    repository,
    categoryId: category.id,
    parentCategoryId: selectedParent?.id ?? null,
  });
  await appendAuditEvent({
    repository: resolveAuditRepository(context),
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    actionKey: 'storage.category.moved',
    targetType: 'storage-category',
    targetId: moved.id,
    summary: 'Categoria de storage movida',
    details: {
      previousParentCategoryId,
      nextParentCategoryId: moved.parentCategoryId,
    },
  });
  await context.runtime.session.cancel();
  await context.reply(
    moved.parentCategoryId === null
      ? texts.categoryParentMovedToRoot.replace('{category}', moved.displayName)
      : texts.categoryParentMoved.replace('{category}', moved.displayName).replace('{parent}', selectedParent?.displayName ?? String(moved.parentCategoryId)),
    buildStorageMenuOptions(language, context),
  );
  return sendStorageCategoryEntryList(context, moved.id, language);
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
  if (!session || session.flowKey !== storageListFlowKey) {
    return false;
  }

  const texts = createTelegramI18n(language).storage;
  if (session.stepKey === 'category-page-input') {
    const page = parsePositiveInteger(text);
    if (page === null) {
      await context.reply(texts.invalidNumber, buildSingleCancelOptions());
      return true;
    }
    await context.runtime.session.cancel();
    return sendStorageCategoryEntryList(context, asNumber(session.data.categoryId), language, page);
  }

  if (session.stepKey !== 'list-category') {
    return false;
  }

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
      tagCounts: await buildReadableStorageTagCounts(context),
    }),
    { ...buildStorageMenuOptions(language, context), parseMode: 'HTML' },
  );
  return true;
}

async function handleActiveSearchFlow(context: StorageFlowContext, text: string, language: 'ca' | 'es' | 'en'): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageSearchFlowKey) {
    return false;
  }

  const texts = createTelegramI18n(language).storage;
  if (session.stepKey === 'search-mode') {
    if (text === texts.searchByTextOrTag) {
      await context.runtime.session.advance({
        stepKey: 'search-query',
        data: session.data,
      });
      await context.reply(formatStorageSearchQueryPrompt(language), { ...buildSingleCancelOptions(), parseMode: 'HTML' });
      return true;
    }

    if (text === texts.exploreSearchCategories) {
      const categories = asCategoryChoices(session.data.categories);
      await context.runtime.session.advance({
        stepKey: 'search-scope',
        data: {
          ...session.data,
          currentMoveCategoryId: null,
        },
      });
      await context.reply(
        formatMoveEntryCategoryPrompt({ categories, currentCategoryId: null, language, prompt: texts.askSearchScope }),
        buildSearchCategoryOptions({ categories, currentCategoryId: null, language }),
      );
      return true;
    }

    return runStorageSearch(context, text, language);
  }

  if (session.stepKey === 'search-scope') {
    const categories = asCategoryChoices(session.data.categories);
    const selectedCategoryId = parseStartPayload(text, storageSelectCategoryStartPayloadPrefix);
    if (selectedCategoryId !== null) {
      return showStorageSearchCategoryNode(context, selectedCategoryId, language);
    }

    const currentCategoryId = asNullableNumber(session.data.currentMoveCategoryId);
    const currentCategory = currentCategoryId === null ? null : categories.find((category) => category.id === currentCategoryId) ?? null;
    if (text === texts.back && currentCategory) {
      const parentCategoryId = currentCategory.parentCategoryId;
      await context.runtime.session.advance({
        stepKey: 'search-scope',
        data: {
          ...session.data,
          currentMoveCategoryId: parentCategoryId,
        },
      });
      await context.reply(
        formatMoveEntryCategoryPrompt({ categories, currentCategoryId: parentCategoryId, language, prompt: texts.askSearchScope }),
        buildSearchCategoryOptions({ categories, currentCategoryId: parentCategoryId, language }),
      );
      return true;
    }

    if (text === texts.selectCurrentSearchCategory && currentCategory) {
      return selectStorageSearchCategory(context, currentCategory.id, language);
    }

    return runStorageSearch(context, text, language);
  }

  if (session.stepKey !== 'search-query') {
    return false;
  }

  const categoryIds = asNumberArray(session.data.categoryIds);
  return runStorageSearch(context, text, language, categoryIds.length > 0 ? categoryIds : undefined);
}

async function showStorageSearchCategoryNode(
  context: StorageFlowContext,
  categoryId: number,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const session = context.runtime.session.current;
  const texts = createTelegramI18n(language).storage;
  if (!session || session.flowKey !== storageSearchFlowKey || session.stepKey !== 'search-scope') {
    await context.reply(texts.invalidCategory, buildStorageMenuOptions(language, context));
    return true;
  }

  const categories = asCategoryChoices(session.data.categories);
  const selected = categories.find((category) => category.id === categoryId);
  if (!selected) {
    const currentCategoryId = asNullableNumber(session.data.currentMoveCategoryId);
    await context.reply(
      texts.invalidCategory,
      buildSearchCategoryOptions({ categories, currentCategoryId, language }),
    );
    return true;
  }

  await context.runtime.session.advance({
    stepKey: 'search-scope',
    data: {
      ...session.data,
      currentMoveCategoryId: selected.id,
    },
  });
  await context.reply(
    formatMoveEntryCategoryPrompt({ categories, currentCategoryId: selected.id, language, prompt: texts.askSearchScope }),
    buildSearchCategoryOptions({ categories, currentCategoryId: selected.id, language }),
  );
  return true;
}

async function selectStorageSearchCategory(
  context: StorageFlowContext,
  categoryId: number,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const session = context.runtime.session.current;
  const texts = createTelegramI18n(language).storage;
  if (!session || session.flowKey !== storageSearchFlowKey || session.stepKey !== 'search-scope') {
    await context.reply(texts.invalidCategory, buildStorageMenuOptions(language, context));
    return true;
  }

  const categories = await listReadableCategories(context);
  const selected = categories.find((category) => category.id === categoryId);
  if (!selected) {
    await context.reply(texts.invalidCategory, buildSingleCancelOptions());
    return true;
  }
  const categoryIds = collectStorageCategoryDescendantIds(selected.id, categories);

  await context.runtime.session.advance({
    stepKey: 'search-query',
    data: { ...session.data, categoryIds, categoryDisplayName: selected.displayName },
  });
  await context.reply(texts.askSearchQueryInCategory.replace('{category}', selected.displayName), buildSingleCancelOptions());
  return true;
}

async function runStorageSearch(
  context: StorageFlowContext,
  query: string,
  language: 'ca' | 'es' | 'en',
  scopedCategoryIds?: number[],
): Promise<boolean> {
  const texts = createTelegramI18n(language).storage;
  const categories = await listReadableCategories(context);
  const categoryIds = scopedCategoryIds ?? categories.map((category) => category.id);
  const normalizedQuery = normalizeStorageSearchQuery(query);
  const details = await resolveRepository(context).searchEntryDetails({
    categoryIds,
    query: normalizedQuery,
  });
  const tagCounts = await buildReadableStorageTagCounts(context);
  await context.runtime.session.cancel();
  await context.reply(
    details.length === 0
      ? texts.noSearchResults
      : formatStorageSearchResultsMessage(details, categories, language, tagCounts),
    details.length === 0 ? buildStorageMenuOptions(language, context) : { ...buildStorageMenuOptions(language, context), parseMode: 'HTML' },
  );
  return true;
}

function normalizeStorageSearchQuery(query: string): string {
  return query.trim().replace(/^#(?=[A-Za-z0-9_-]+$)/, '');
}

async function sendStorageEntryDetail(
  context: StorageFlowContext,
  entryId: number,
  language: 'ca' | 'es' | 'en',
  loadedDetail?: StorageEntryDetailRecord,
): Promise<boolean> {
  const texts = createTelegramI18n(language).storage;
  const detail = loadedDetail ?? await resolveRepository(context).getEntryDetail(entryId);
  if (!detail || detail.entry.lifecycleStatus !== 'active') {
    await context.reply(texts.invalidEntryId, buildStorageMenuOptions(language, context));
    return true;
  }

  const allCategories = await resolveRepository(context).listCategories();
  const tagCounts = await buildReadableStorageTagCounts(context);
  await context.reply(formatStorageEntryDetail(detail, language, allCategories, tagCounts), buildStorageEntryDetailOptions(context, detail, language));

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

async function sendStorageTagList(
  context: StorageFlowContext,
  page: number,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const texts = createTelegramI18n(language).storage;
  const summaries = await buildReadableStorageTagSummaries(context);
  if (summaries.length === 0) {
    await context.reply(texts.noTags, buildStorageMenuOptions(language, context));
    return true;
  }
  const currentPage = clampStorageTagListPage(page, summaries.length);
  await context.runtime.session.start({
    flowKey: storageTagListFlowKey,
    stepKey: 'tag-list',
    data: { page: currentPage, totalItems: summaries.length },
  });
  await context.reply(
    formatStorageTagListMessage({ summaries, page: currentPage, language }),
    { ...buildStorageTagListOptions({ page: currentPage, totalItems: summaries.length, language, context }), parseMode: 'HTML' },
  );
  return true;
}

async function sendStorageTagResults(
  context: StorageFlowContext,
  rawTag: string,
  language: 'ca' | 'es' | 'en',
  page = 1,
): Promise<boolean> {
  const texts = createTelegramI18n(language).storage;
  const tag = normalizeStorageTagPayload(rawTag);
  if (!tag) {
    await context.reply(texts.noSearchResults, buildStorageMenuOptions(language, context));
    return true;
  }
  const categories = await listReadableCategories(context);
  const readableDetails = await listReadableStorageEntryDetails(context, categories);
  const details = readableDetails.filter((detail) => detail.entry.tags.includes(tag));
  const tagCounts = buildStorageTagCounts(readableDetails);
  const currentPage = clampStorageListPage(page, details.length);
  if (details.length > 0) {
    await context.runtime.session.start({
      flowKey: storageTagListFlowKey,
      stepKey: 'tag-results',
      data: { tag, page: currentPage, totalItems: details.length },
    });
  }
  await context.reply(
    details.length === 0
      ? texts.noSearchResults
      : formatStorageTagResultsMessage({ tag, details, categories, tagCounts, language, page: currentPage }),
    details.length === 0
      ? buildStorageMenuOptions(language, context)
      : { ...buildStorageTagResultsOptions({ page: currentPage, totalItems: details.length, language, context }), parseMode: 'HTML' },
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
    if (!detail || detail.entry.lifecycleStatus !== 'active' || !canEditStorageEntry(context, detail)) {
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
    if (!detail || detail.entry.lifecycleStatus !== 'active' || !canEditStorageEntry(context, detail)) {
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

    if (text === texts.moveCategory) {
      const categories = await listUploadableCategories(context);
      if (categories.length === 0) {
        await context.reply(texts.noCategoriesForAction, buildEditEntryActionOptions(language));
        return true;
      }

      await context.runtime.session.advance({
        stepKey: 'edit-entry-move-category',
        data: {
          ...session.data,
          categories: categories.map((category) => ({
            id: category.id,
            displayName: category.displayName,
            parentCategoryId: category.parentCategoryId,
          })),
          currentMoveCategoryId: null,
        },
      });
      await context.reply(
        formatMoveEntryCategoryPrompt({ categories, currentCategoryId: null, language }),
        buildMoveEntryCategoryOptions({ categories, currentCategoryId: null, language }),
      );
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

  if (session.stepKey === 'edit-entry-move-category') {
    const categories = asCategoryChoices(session.data.categories);
    const currentCategoryId = asNullableNumber(session.data.currentMoveCategoryId);
    const currentCategory = currentCategoryId === null ? null : categories.find((category) => category.id === currentCategoryId) ?? null;
    if (currentCategory && text === texts.selectCurrentMoveCategory.replace('{category}', currentCategory.displayName)) {
      return selectStorageEntryMoveCategory(context, currentCategory.id, language);
    }

    if (text === texts.back) {
      const parentCategoryId = currentCategory ? asNullableNumber(currentCategory.parentCategoryId) : null;
      await context.runtime.session.advance({
        stepKey: 'edit-entry-move-category',
        data: {
          ...session.data,
          currentMoveCategoryId: parentCategoryId,
        },
      });
      await context.reply(
        formatMoveEntryCategoryPrompt({ categories, currentCategoryId: parentCategoryId, language }),
        buildMoveEntryCategoryOptions({ categories, currentCategoryId: parentCategoryId, language }),
      );
      return true;
    }

    const selected = categories.find((category) => category.displayName === text);
    if (selected) {
      return showStorageEntryMoveCategoryNode(context, selected.id, language);
    }

    await context.reply(texts.invalidCategory, buildMoveEntryCategoryOptions({ categories, currentCategoryId, language }));
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
      tags: text === texts.skipOptional ? currentTags : parseStorageTagInput(text),
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

  if (session.stepKey === 'add-entry-tags') {
    const detail = await resolveRepository(context).getEntryDetail(asNumber(session.data.entryId));
    if (!detail || !canManageStorageEntryTags(context, detail)) {
      await context.runtime.session.cancel();
      await context.reply(texts.invalidEntryId, buildStorageMenuOptions(language, context));
      return true;
    }
    const nextTags = Array.from(new Set([...detail.entry.tags, ...parseStorageTagInput(text)])).sort();
    const updated = await updateStorageEntryMetadata({
      repository: resolveRepository(context),
      entryId: detail.entry.id,
      description: detail.entry.description,
      tags: nextTags,
    });
    await context.runtime.session.cancel();
    await context.reply(
      texts.entryMetadataUpdated.replace('{id}', String(updated.entry.id)),
      buildStorageMenuOptions(language, context),
    );
    return sendStorageEntryDetail(context, updated.entry.id, language, updated);
  }

  if (session.stepKey === 'remove-entry-tags') {
    const detail = await resolveRepository(context).getEntryDetail(asNumber(session.data.entryId));
    if (!detail || !canManageStorageEntryTags(context, detail)) {
      await context.runtime.session.cancel();
      await context.reply(texts.invalidEntryId, buildStorageMenuOptions(language, context));
      return true;
    }
    const selected = detail.entry.tags.find((tag) => formatStorageTagChoiceLabel(tag) === text || `#${tag}` === text || tag === text);
    if (!selected) {
      await context.reply(texts.invalidTagChoice, buildTagChoiceOptions(detail.entry.tags, language));
      return true;
    }
    const updated = await updateStorageEntryMetadata({
      repository: resolveRepository(context),
      entryId: detail.entry.id,
      description: detail.entry.description,
      tags: detail.entry.tags.filter((tag) => tag !== selected),
    });
    await context.runtime.session.cancel();
    await context.reply(
      texts.entryMetadataUpdated.replace('{id}', String(updated.entry.id)),
      buildStorageMenuOptions(language, context),
    );
    return sendStorageEntryDetail(context, updated.entry.id, language, updated);
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

  if (context.sharedChat && context.runtime.chat.kind === 'private' && context.runtime.session.current?.flowKey === storageDefaultChatFlowKey) {
    return handleSharedDefaultStorageChat(context);
  }

  if (!context.messageMedia && !isForwardedTextStorageMessage(context)) {
    return false;
  }

  if (context.runtime.chat.kind === 'private' && context.runtime.session.current?.flowKey === storageForwardedImportFlowKey) {
    return handleForwardedStorageMessage(context);
  }

  if (context.runtime.chat.kind === 'private' && context.runtime.session.current?.flowKey === storageUploadFlowKey) {
    return handlePrivateUploadMedia(context);
  }

  if (context.runtime.chat.kind === 'private' && context.runtime.session.current?.flowKey === storageCategoryViewFlowKey) {
    return handleCategoryViewUploadMedia(context);
  }

  if (context.runtime.chat.kind === 'private' && context.runtime.session.current?.flowKey === storageAddImagesFlowKey) {
    return handlePrivateAddImagesMedia(context);
  }

  if (context.runtime.chat.kind === 'private' && context.runtime.session.current?.flowKey === storageEditEntryFlowKey) {
    return handlePrivateAddImagesMedia(context);
  }

  if (context.runtime.chat.kind === 'private' && !context.runtime.session.current) {
    return handleForwardedStorageMessage(context);
  }

  if (context.runtime.chat.kind === 'group' || context.runtime.chat.kind === 'group-news') {
    return handleTopicUpload(context);
  }

  return false;
}

async function handleCategoryViewUploadMedia(context: StorageFlowContext): Promise<boolean> {
  const session = context.runtime.session.current;
  const media = context.messageMedia;
  if (!session || session.flowKey !== storageCategoryViewFlowKey || session.stepKey !== 'category-view' || !media || !isSupportedAttachmentKind(media.attachmentKind)) {
    return false;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).storage;
  const categoryId = asNumber(session.data.categoryId);
  const category = (await listUploadableCategories(context)).find((candidate) => candidate.id === categoryId);
  if (!category) {
    await context.reply(texts.invalidCategory, buildStorageMenuOptions(language, context));
    return true;
  }

  await context.runtime.session.start({
    flowKey: storageUploadFlowKey,
    stepKey: 'upload-media',
    data: { categoryId: category.id, categoryDisplayName: category.displayName, messages: [] },
  });
  return handlePrivateUploadMedia(context);
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

async function handleSharedDefaultStorageChat(context: StorageFlowContext): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageDefaultChatFlowKey || session.stepKey !== 'default-chat-select' || !context.sharedChat) {
    return false;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).storage;
  if (context.sharedChat.requestId !== storageChatRequestId) {
    await context.reply(texts.invalidSharedChatRequest, buildStorageDefaultChatSelectOptions(language));
    return true;
  }

  return saveDefaultStorageChatFromSelection(context, context.sharedChat.chatId, language);
}

async function saveDefaultStorageChatFromSelection(
  context: StorageFlowContext,
  chatId: number,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const texts = createTelegramI18n(language).storage;
  const validation = await validateStorageChatSelection(context, chatId);
  if (!validation.ok) {
    await context.reply(validation.message, buildStorageDefaultChatSelectOptions(language));
    return true;
  }

  await saveStorageDefaultChat(context, {
    chatId,
    chatTitle: validation.chatTitle,
  });
  await appendAuditEvent({
    repository: resolveAuditRepository(context),
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    actionKey: 'storage.default_chat.updated',
    targetType: 'storage-config',
    targetId: storageDefaultChatMetadataKey,
    summary: 'Supergrup per defecte de storage actualitzat',
    details: { storageChatId: chatId, chatTitle: validation.chatTitle },
  });
  await context.runtime.session.cancel();
  await context.reply(
    texts.defaultStorageChatSaved.replace('{chat}', validation.chatTitle),
    buildStorageMenuOptions(language, context),
  );
  return true;
}

async function createCategoryWithDefaultStorageChatOrFallback(
  context: StorageFlowContext,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const texts = createTelegramI18n(language).storage;
  const defaultChat = await loadStorageDefaultChat(context);
  if (!defaultChat) {
    await context.reply(texts.askCategoryStorageChat, buildStorageChatSelectOptions(language));
    return true;
  }

  const validation = await validateStorageChatSelection(context, defaultChat.chatId);
  if (!validation.ok) {
    await context.reply(
      `${texts.defaultStorageChatUnavailable}\n\n${validation.message}`,
      buildStorageChatSelectOptions(language),
    );
    return true;
  }

  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageCreateCategoryFlowKey || session.stepKey !== 'create-category-chat-select') {
    return false;
  }

  const topicName = String(session.data.displayName ?? texts.openMenu).trim() || texts.openMenu;
  await context.reply(texts.creatingCategoryTopic.replace('{chat}', validation.chatTitle), buildSingleCancelOptions());
  try {
    const topic = await context.runtime.bot.createForumTopic?.({ chatId: defaultChat.chatId, name: topicName });
    if (!topic) {
      await context.reply(texts.storageBotCannotCreateTopic, buildStorageChatSelectOptions(language));
      return true;
    }

    await createCategoryFromDraft(context, {
      language,
      storageChatId: defaultChat.chatId,
      storageThreadId: topic.messageThreadId,
      setupMode: 'default',
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

type StorageDefaultChat = {
  chatId: number;
  chatTitle: string;
  updatedAt: string;
};

function resolveStorageDefaultChatStore(context: StorageFlowContext): AppMetadataSessionStorage {
  return context.storageDefaultChatStore ?? createDatabaseAppMetadataSessionStorage({ database: context.runtime.services.database.db });
}

async function loadStorageDefaultChat(context: StorageFlowContext): Promise<StorageDefaultChat | null> {
  const raw = await resolveStorageDefaultChatStore(context).get(storageDefaultChatMetadataKey);
  if (!raw) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'chatId' in parsed &&
      'chatTitle' in parsed &&
      'updatedAt' in parsed &&
      typeof parsed.chatId === 'number' &&
      Number.isSafeInteger(parsed.chatId) &&
      typeof parsed.chatTitle === 'string' &&
      typeof parsed.updatedAt === 'string'
    ) {
      return {
        chatId: parsed.chatId,
        chatTitle: parsed.chatTitle,
        updatedAt: parsed.updatedAt,
      };
    }
  } catch {
    return null;
  }

  return null;
}

async function saveStorageDefaultChat(
  context: StorageFlowContext,
  input: { chatId: number; chatTitle: string },
): Promise<void> {
  const payload: StorageDefaultChat = {
    chatId: input.chatId,
    chatTitle: input.chatTitle,
    updatedAt: new Date().toISOString(),
  };
  await resolveStorageDefaultChatStore(context).set(storageDefaultChatMetadataKey, JSON.stringify(payload));
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
    setupMode: 'guided' | 'manual' | 'default';
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
  const message = setupMode === 'guided' || setupMode === 'default'
    ? texts.categoryCreatedGuided
      .replace('{name}', created.displayName)
      .replace('{slug}', created.slug)
      .replace('{chat}', chatTitle ?? String(storageChatId))
      .replace('{topic}', topicName ?? String(storageThreadId))
    : texts.categoryCreated.replace('{name}', created.displayName).replace('{slug}', created.slug);
  await context.reply(message, buildSingleCancelOptions());
  await sendStorageCategoryEntryList(context, created.id, language);
}

async function handleActiveUploadFlow(context: StorageFlowContext, text: string, language: 'ca' | 'es' | 'en'): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== storageUploadFlowKey) {
    return false;
  }

  const texts = createTelegramI18n(language).storage;
  if (session.stepKey === 'upload-category') {
    const categories = asCategoryChoices(session.data.categories);
    const selectedCategoryId = parseStartPayload(text, storageSelectCategoryStartPayloadPrefix);
    const currentCategoryId = asNullableNumber(session.data.currentMoveCategoryId);
    const currentCategory = currentCategoryId === null ? null : categories.find((category) => category.id === currentCategoryId) ?? null;

    if (selectedCategoryId !== null) {
      return showStorageUploadCategoryNode(context, selectedCategoryId, language);
    }

    if (text === texts.back && currentCategory) {
      const parentCategoryId = currentCategory.parentCategoryId;
      await context.runtime.session.advance({
        stepKey: 'upload-category',
        data: {
          ...session.data,
          currentMoveCategoryId: parentCategoryId,
        },
      });
      await context.reply(
        formatMoveEntryCategoryPrompt({ categories, currentCategoryId: parentCategoryId, language, prompt: texts.askUploadCategory }),
        buildUploadCategoryOptions({ categories, currentCategoryId: parentCategoryId, language }),
      );
      return true;
    }

    const selected = text === texts.selectCurrentUploadCategory && currentCategory
      ? currentCategory
      : categories.find((category) => category.displayName === text);
    if (!selected) {
      const uploadableCategories = await listUploadableCategories(context);
      const choices = toStorageCategoryChoices(uploadableCategories);
      await context.reply(
        `${escapeHtml(texts.invalidCategory)}\n${formatMoveEntryCategoryPrompt({ categories: choices, currentCategoryId, language, prompt: texts.askUploadCategory })}`,
        buildUploadCategoryOptions({ categories: choices, currentCategoryId, language }),
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
      for (const [index, message] of messages.entries()) {
        const fileName = formatDraftStorageAttachmentLabel(message, language);
        await context.reply(
          texts.uploadSeparateProgress
            .replace('{current}', String(index + 1))
            .replace('{total}', String(messages.length))
            .replace('{file}', fileName),
          buildSingleCancelOptions(),
        );

        try {
          savedEntries.push(await persistPrivateUpload({
            context,
            categoryId: asNumber(session.data.categoryId),
            categoryDisplayName: String(session.data.categoryDisplayName ?? ''),
            description: resolveDefaultUploadDescription([message], language),
            tags: [],
            messages: [message],
          }));
        } catch (error) {
          await context.runtime.session.cancel();
          await context.reply(
            texts.uploadSeparatePartialFailed
              .replace('{saved}', String(savedEntries.length))
              .replace('{total}', String(messages.length))
              .replace('{failed}', String(index + 1))
              .replace('{file}', fileName),
            buildStorageMenuOptions(language, context),
          );
          return true;
        }
      }
      await context.runtime.session.cancel();
      await context.reply(
        texts.savedSeparate
          .replace('{category}', String(session.data.categoryDisplayName ?? savedEntries[0]?.category.displayName ?? ''))
          .replace('{count}', String(savedEntries.length)),
        buildSingleCancelOptions(),
      );
      return sendStorageCategoryEntryList(context, asNumber(session.data.categoryId), language);
    }

    if (text !== texts.uploadTogether) {
      await context.reply(texts.invalidUploadGrouping, buildUploadGroupingOptions(language));
      return true;
    }

    await advanceUploadPreview(context, { ...session.data, uploadGrouping: 'together' }, messages, language);
    return true;
  }

  if (session.stepKey === 'upload-preview') {
    if (isStorageUploadAcceptText(text, language)) {
      return handleStorageUploadPreviewAction(context, 'accept', language);
    }

    if (text === texts.uploadModifyDescription) {
      return handleStorageUploadPreviewAction(context, 'description', language);
    }

    if (text === texts.addTagsButton) {
      return handleStorageUploadPreviewAction(context, 'tags', language);
    }

    if (text === texts.addImages) {
      return handleStorageUploadPreviewAction(context, 'images', language);
    }

    await context.reply(texts.invalidUploadPreviewAction, buildUploadPreviewOptions(language));
    return true;
  }

  if (session.stepKey === 'upload-confirm-no-tags') {
    if (text === texts.uploadAcceptWithoutTags) {
      return handleStorageUploadPreviewAction(context, 'accept-without-tags', language);
    }

    if (text === texts.addTagsButton) {
      return handleStorageUploadPreviewAction(context, 'tags', language);
    }

    await context.reply(texts.invalidUploadPreviewAction, buildUploadConfirmNoTagsOptions(language));
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

  if (session.stepKey === 'upload-tags') {
    const data = {
      ...session.data,
      tags: text === texts.skipOptional ? asStringArray(session.data.tags) : parseStorageTagInput(text),
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

function isStorageUploadAcceptText(text: string, language: 'ca' | 'es' | 'en'): boolean {
  const legacyAccept = {
    ca: 'Acceptar',
    es: 'Aceptar',
    en: 'Accept',
  } satisfies Record<'ca' | 'es' | 'en', string>;
  return text === createTelegramI18n(language).storage.uploadAccept || text === legacyAccept[language];
}

async function showStorageUploadCategoryNode(
  context: StorageFlowContext,
  categoryId: number,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const session = context.runtime.session.current;
  const texts = createTelegramI18n(language).storage;
  if (!session || session.flowKey !== storageUploadFlowKey || session.stepKey !== 'upload-category') {
    await context.reply(texts.invalidCategory, buildStorageMenuOptions(language, context));
    return true;
  }

  const categories = asCategoryChoices(session.data.categories);
  const selected = categories.find((category) => category.id === categoryId);
  if (!selected) {
    const currentCategoryId = asNullableNumber(session.data.currentMoveCategoryId);
    await context.reply(
      texts.invalidCategory,
      buildUploadCategoryOptions({ categories, currentCategoryId, language }),
    );
    return true;
  }

  await context.runtime.session.advance({
    stepKey: 'upload-category',
    data: {
      ...session.data,
      currentMoveCategoryId: selected.id,
    },
  });
  await context.reply(
    formatMoveEntryCategoryPrompt({ categories, currentCategoryId: selected.id, language, prompt: texts.askUploadCategory }),
    buildUploadCategoryOptions({ categories, currentCategoryId: selected.id, language }),
  );
  return true;
}

async function handleStorageUploadPreviewAction(
  context: StorageFlowContext,
  action: 'accept' | 'accept-without-tags' | 'description' | 'tags' | 'images',
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const session = context.runtime.session.current;
  const texts = createTelegramI18n(language).storage;
  if (!session || session.flowKey !== storageUploadFlowKey || !['upload-preview', 'upload-confirm-no-tags'].includes(session.stepKey)) {
    await context.reply(texts.invalidUploadPreviewAction, buildStorageMenuOptions(language, context));
    return true;
  }

  if (action === 'accept') {
    const tags = asStringArray(session.data.tags);
    if (tags.length === 0) {
      await context.runtime.session.advance({
        stepKey: 'upload-confirm-no-tags',
        data: session.data,
      });
      await context.reply(texts.confirmUploadWithoutTags, buildUploadConfirmNoTagsOptions(language));
      return true;
    }
    return completeStorageUpload(context, session.data, language);
  }

  if (action === 'accept-without-tags') {
    return completeStorageUpload(context, session.data, language);
  }

  if (action === 'description') {
    await context.runtime.session.advance({
      stepKey: 'upload-description',
      data: session.data,
    });
    await context.reply(formatAskUploadDescription(texts.askDescription, asDraftMessages(session.data.messages), language), buildSkipOptionalOptions(language));
    return true;
  }

  if (action === 'tags') {
    await context.runtime.session.advance({
      stepKey: 'upload-tags',
      data: session.data,
    });
    await context.reply(texts.askTags, buildSkipOptionalOptions(language));
    return true;
  }

  await context.runtime.session.advance({
    stepKey: 'upload-preview-images',
    data: session.data,
  });
  await context.reply(texts.askUploadPreviewImages, buildUploadMediaOptions(language));
  return true;
}

async function completeStorageUpload(
  context: StorageFlowContext,
  data: Record<string, unknown>,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const texts = createTelegramI18n(language).storage;
  const messages = asDraftMessages(data.messages);
  const progressState = createStorageUploadProgressState(messages, language);
  const progress = await startStorageEditableProgress(context, formatStorageUploadProgress(texts, progressState));
  const saved = await persistPrivateUpload({
    context,
    categoryId: asNumber(data.categoryId),
    categoryDisplayName: String(data.categoryDisplayName ?? ''),
    description: asNullableString(data.description),
    tags: asStringArray(data.tags),
    messages,
    onCopyProgress: async (event) => {
      updateStorageUploadCopyProgress(progressState, event);
      await progress.update(formatStorageUploadProgress(texts, progressState));
    },
    onProgressStep: async (step) => {
      await moveStorageUploadProgress(progress, texts, progressState, step);
    },
  });
  await context.runtime.session.cancel();
  finishStorageUploadProgressStep(progressState);
  await progress.update(formatStorageUploadProgress(texts, progressState));
  await progress.complete(
    texts.saved
      .replace('{category}', saved.category.displayName)
      .replace('{count}', String(saved.messages.length)),
    buildSingleCancelOptions(),
  );
  return sendStorageCategoryEntryList(context, saved.category.id, language);
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

async function handleForwardedStorageMessage(context: StorageFlowContext): Promise<boolean> {
  if (context.runtime.chat.kind !== 'private' || !context.runtime.actor.isApproved || context.runtime.actor.isBlocked) {
    return false;
  }
  const draft = buildForwardedStorageDraftMessage(context);
  if (!draft) {
    return false;
  }
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).storage;
  const session = context.runtime.session.current;
  if (session?.flowKey === storageForwardedImportFlowKey && session.stepKey === 'forwarded-action') {
    const currentMessages = asDraftMessages(session.data.messages);
    const messages = [...currentMessages, { ...draft, sortOrder: currentMessages.length }];
    await context.runtime.session.advance({
      stepKey: 'forwarded-action',
      data: { ...session.data, messages },
    });
    await context.reply(texts.forwardedMessageRecorded.replace('{count}', String(messages.length)), buildForwardedImportActionOptions(language));
    return true;
  }
  if (session) {
    return false;
  }
  await context.runtime.session.start({
    flowKey: storageForwardedImportFlowKey,
    stepKey: 'forwarded-action',
    data: { messages: [draft] },
  });
  await context.reply(texts.askForwardedMessageAction, buildForwardedImportActionOptions(language));
  return true;
}

function buildForwardedStorageDraftMessage(context: StorageFlowContext): DmUploadDraftMessage | null {
  if (context.isForwardedMessage !== true) {
    return null;
  }
  const media = context.messageMedia;
  if (media) {
    if (!isSupportedAttachmentKind(media.attachmentKind) || isOversizedStorageAttachment(media.fileSizeBytes ?? null)) {
      return null;
    }
    return {
      fromChatId: context.runtime.chat.chatId,
      fromMessageId: media.messageId,
      attachmentKind: media.attachmentKind,
      telegramFileId: media.fileId ?? null,
      telegramFileUniqueId: media.fileUniqueId ?? null,
      caption: media.caption ?? context.messageText ?? null,
      originalFileName: media.originalFileName ?? null,
      mimeType: media.mimeType ?? null,
      fileSizeBytes: media.fileSizeBytes ?? null,
      mediaGroupId: media.mediaGroupId ?? null,
      sortOrder: 0,
    };
  }
  const messageText = context.messageText?.trim();
  if (!messageText || context.messageId === undefined) {
    return null;
  }
  return {
    fromChatId: context.runtime.chat.chatId,
    fromMessageId: context.messageId,
    attachmentKind: 'text',
    telegramFileId: null,
    telegramFileUniqueId: null,
    caption: messageText,
    originalFileName: null,
    mimeType: null,
    fileSizeBytes: null,
    mediaGroupId: null,
    sortOrder: 0,
  };
}

function isForwardedTextStorageMessage(context: StorageFlowContext): boolean {
  return context.isForwardedMessage === true && Boolean(context.messageText?.trim()) && context.messageId !== undefined;
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

  if (media.mediaGroupId) {
    queueStorageTopicMediaGroupMessage({
      repository,
      subscriptionRepository: resolveSubscriptionRepository(context),
      bot: context.runtime.bot,
      language: normalizeBotLanguage(context.runtime.bot.language, 'ca'),
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
  const detail = await createStorageEntry({
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
  await notifyStorageEntrySubscribers(context, detail);
  return true;
}

async function persistPrivateUpload({
  context,
  categoryId,
  categoryDisplayName,
  description,
  tags,
  messages,
  onCopyProgress,
  onProgressStep,
}: {
  context: StorageFlowContext;
  categoryId: number;
  categoryDisplayName: string;
  description: string | null;
  tags: string[];
  messages: DmUploadDraftMessage[];
  onCopyProgress?: (event: StorageUploadCopyProgressEvent) => Promise<void> | void;
  onProgressStep?: (step: StorageUploadProgressStep) => Promise<void> | void;
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
    for (const [index, message] of messages.entries()) {
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
      await onCopyProgress?.({ kind: 'finished', index });
    }

    await onProgressStep?.('indexing');
    const detail = await createStorageEntry({
      repository,
      categoryId,
      createdByTelegramUserId: context.runtime.actor.telegramUserId,
      sourceKind: 'dm_copy',
      description,
      tags,
      messages: copiedMessages,
    });
    await onProgressStep?.('notifying');
    await notifyStorageEntrySubscribers(context, detail);
    return detail;
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

async function notifyStorageEntrySubscribers(context: StorageFlowContext, detail: StorageEntryDetailRecord): Promise<void> {
  await notifyStorageEntrySubscribersWithRuntime({
    bot: context.runtime.bot,
    subscriptionRepository: resolveSubscriptionRepository(context),
    detail,
    language: normalizeBotLanguage(context.runtime.bot.language, 'ca'),
  });
}

async function notifyStorageEntrySubscribersWithRuntime({
  bot,
  subscriptionRepository,
  detail,
  language,
}: {
  bot: StorageFlowContext['runtime']['bot'];
  subscriptionRepository: StorageCategorySubscriptionRepository;
  detail: StorageEntryDetailRecord;
  language: 'ca' | 'es' | 'en';
}): Promise<void> {
  const subscriptions = await subscriptionRepository.listSubscriptionsForEntryCategory(detail.category.id);
  const recipients = subscriptions.map((subscription) => subscription.telegramUserId);
  await Promise.all(recipients.map(async (telegramUserId) => {
    try {
      await bot.sendPrivateMessage(telegramUserId, formatStorageEntryNotification(detail, language), {
        parseMode: 'HTML',
        inlineKeyboard: [[
          { text: createTelegramI18n(language).storage.openEntryButton, url: buildTelegramStartUrl(`${storageEntryStartPayloadPrefix}${detail.entry.id}`) },
          { text: createTelegramI18n(language).storage.unsubscribeButton, callbackData: `${storageCallbackPrefixes.unsubscribeCategory}${detail.category.id}` },
        ]],
      });
    } catch (error) {
      console.error('Storage subscription notification failed', {
        telegramUserId,
        entryId: detail.entry.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }));
}

function queueStorageTopicMediaGroupMessage({
  repository,
  subscriptionRepository,
  bot,
  language,
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
  subscriptionRepository: StorageCategorySubscriptionRepository;
  bot: StorageFlowContext['runtime']['bot'];
  language: 'ca' | 'es' | 'en';
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
    subscriptionRepository,
    bot,
    language,
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

  const detail = await createStorageEntry({
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
  await notifyStorageEntrySubscribersWithRuntime({
    bot: pending.bot,
    subscriptionRepository: pending.subscriptionRepository,
    detail,
    language: pending.language,
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
  return listActiveCategories(context);
}

async function listUploadableCategories(context: StorageFlowContext): Promise<StorageCategoryRecord[]> {
  return listActiveCategories(context);
}

async function listActiveCategories(context: StorageFlowContext): Promise<StorageCategoryRecord[]> {
  const categories = await resolveRepository(context).listCategories();
  return categories.filter(isVisibleUserStorageCategory);
}

function isVisibleUserStorageCategory(category: StorageCategoryRecord): boolean {
  return category.lifecycleStatus === 'active'
    && category.categoryPurpose === 'user_uploads'
    && !internalStorageCategorySlugs.has(category.slug.toLowerCase())
    && !internalStorageCategoryDisplayNames.has(category.displayName.trim().toLowerCase());
}

async function findVisibleStorageCategoryByDisplayName(
  context: StorageFlowContext,
  displayName: string,
): Promise<StorageCategoryRecord | null> {
  const categories = canManageStorageCategories(context)
    ? await listActiveCategories(context)
    : await listReadableCategories(context);
  const matching = categories.filter((category) => category.displayName === displayName);
  return matching.length === 1 ? matching[0] ?? null : null;
}

function filterStorageCategoriesByParent(
  categories: StorageCategoryRecord[],
  parentCategoryId: number | null,
): StorageCategoryRecord[] {
  return categories.filter((category) => category.parentCategoryId === parentCategoryId);
}

function buildStorageCategoryParentChoices(
  category: StorageCategoryRecord,
  categories: StorageCategoryRecord[],
): StorageCategoryRecord[] {
  const excludedIds = new Set([category.id, ...collectStorageCategoryDescendantIds(category.id, categories)]);
  return categories.filter((candidate) => !excludedIds.has(candidate.id) && candidate.lifecycleStatus === 'active' && candidate.categoryPurpose === 'user_uploads');
}

async function buildStorageCategorySummaries(
  context: StorageFlowContext,
  categories: StorageCategoryRecord[],
): Promise<Map<number, { subcategoryCount: number; entryCount: number }>> {
  const repository = resolveRepository(context);
  const categoryIds = new Set(categories.map((category) => category.id));
  const entriesByCategory = new Map<number, number>();
  await Promise.all(categories.map(async (category) => {
    const details = await repository.listEntryDetailsByCategory(category.id);
    entriesByCategory.set(category.id, details.filter((detail) => detail.entry.lifecycleStatus === 'active').length);
  }));

  return new Map(categories.map((category) => {
    const descendantIds = collectStorageCategoryDescendantIds(category.id, categories)
      .filter((candidateId) => candidateId !== category.id && categoryIds.has(candidateId));
    const entryCount = [category.id, ...descendantIds].reduce(
      (total, candidateId) => total + (entriesByCategory.get(candidateId) ?? 0),
      0,
    );
    return [category.id, { subcategoryCount: descendantIds.length, entryCount }];
  }));
}

async function listSubscribedReadableCategories(context: StorageFlowContext): Promise<StorageCategoryRecord[]> {
  const [categories, subscriptions] = await Promise.all([
    listReadableCategories(context),
    resolveSubscriptionRepository(context).listSubscriptionsByUser(context.runtime.actor.telegramUserId),
  ]);
  const subscribedIds = new Set(subscriptions.map((subscription) => subscription.categoryId));
  return categories.filter((category) => subscribedIds.has(category.id));
}

async function listEditableEntryDetails(context: StorageFlowContext, categoryId: number): Promise<StorageEntryDetailRecord[]> {
  const details = await resolveRepository(context).listEntryDetailsByCategory(categoryId);
  return details.filter(
    (detail) => detail.entry.lifecycleStatus === 'active' && canEditStorageEntry(context, detail),
  );
}

function resolveRepository(context: StorageFlowContext): StorageCategoryRepository {
  return context.storageRepository ?? createDatabaseStorageRepository({ database: context.runtime.services.database.db });
}

function resolveStorageCategoryAccessRepository(context: StorageFlowContext): StorageCategoryAccessRepository {
  return context.storageCategoryAccessRepository ?? createDatabaseStorageCategoryAccessRepository({ database: context.runtime.services.database.db });
}

function resolveSubscriptionRepository(context: StorageFlowContext): StorageCategorySubscriptionRepository {
  return context.storageCategorySubscriptionRepository ?? createDatabaseStorageCategorySubscriptionRepository({ database: context.runtime.services.database.db });
}

function resolveAuditRepository(context: StorageFlowContext) {
  return createDatabaseAuditLogRepository({ database: context.runtime.services.database.db as never });
}

function buildStorageMenuOptions(language: 'ca' | 'es' | 'en', context?: StorageFlowContext): TelegramReplyOptions {
  const texts = createTelegramI18n(language).storage;
  const rows: Array<Array<string | TelegramReplyButton>> = [
    [primaryButton(texts.listCategories)],
    [secondaryButton(texts.listTags), secondaryButton(texts.searchFiles)],
    [secondaryButton(texts.mySubscriptions)],
    [successButton(texts.subscribeCategory), dangerButton(texts.unsubscribeCategory)],
    [successButton(texts.upload), successButton(texts.addImages)],
    [secondaryButton(texts.editEntry)],
  ];
  if (context && canManageStorageCategories(context)) {
    rows.push(
      [secondaryButton(texts.configureDefaultStorageChat)],
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

function buildStorageCategoryListReplyOptions({
  language,
  context,
}: {
  language: 'ca' | 'es' | 'en';
  context: StorageFlowContext;
}): TelegramReplyOptions {
  const baseRows = buildStorageMenuOptions(language, context).replyKeyboard ?? [];
  return buildPersistentReplyKeyboard(baseRows);
}

function buildStorageCategoryViewReplyOptions({
  context,
  category,
  language,
  paginationRow,
}: {
  context: StorageFlowContext;
  category: StorageCategoryRecord;
  language: 'ca' | 'es' | 'en';
  paginationRow?: Array<string | TelegramReplyButton>;
}): TelegramReplyOptions {
  const texts = createTelegramI18n(language).storage;
  const rows: Array<Array<string | TelegramReplyButton>> = [];
  if (paginationRow && paginationRow.length > 0) {
    rows.push(paginationRow);
  }
  if (canManageStorageCategories(context)) {
    rows.push([successButton(texts.addSubcategory), secondaryButton(texts.renameCategory)]);
    rows.push([secondaryButton(texts.changeCategoryParent)]);
  }
  if (context.runtime.actor.isApproved && !context.runtime.actor.isBlocked && category.lifecycleStatus === 'active') {
    rows.push([successButton(texts.upload)]);
  }
  rows.push([secondaryButton(texts.back)], buildGlobalNavigationRow(language));
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

function buildTagChoiceOptions(tags: string[], language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
  return {
    replyKeyboard: [
      ...tags.map((tag) => [formatStorageTagChoiceLabel(tag)]),
      [dangerButton('/cancel')],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildStorageTagListOptions({
  page,
  totalItems,
  language,
  context,
}: {
  page: number;
  totalItems: number;
  language: 'ca' | 'es' | 'en';
  context: StorageFlowContext;
}): TelegramReplyOptions {
  const paginationRow = buildStorageTagPaginationRow({ page, totalItems, language });
  const rows = buildStorageMenuOptions(language, context).replyKeyboard ?? [];
  return buildPersistentReplyKeyboard(paginationRow.length > 0 ? [paginationRow, ...rows] : rows);
}

function buildStorageCategoryPaginationOptions({
  page,
  totalItems,
  language,
}: {
  categoryId: number;
  page: number;
  totalItems: number;
  language: 'ca' | 'es' | 'en';
}): TelegramReplyOptions {
  const totalPages = calculateStorageListTotalPages(totalItems);
  if (totalPages <= 1) {
    return {};
  }

  return { replyKeyboard: [buildStorageCategoryPaginationRow({ page, totalItems, language })] };
}

function buildStorageCategoryPaginationRow({
  page,
  totalItems,
  language,
}: {
  page: number;
  totalItems: number;
  language: 'ca' | 'es' | 'en';
}): Array<string | TelegramReplyButton> {
  const totalPages = calculateStorageListTotalPages(totalItems);
  if (totalPages <= 1) {
    return [];
  }

  const texts = createTelegramI18n(language).storage;
  const currentPage = clampStorageListPage(page, totalItems);
  const row: Array<string | TelegramReplyButton> = [];
  if (currentPage > 1) {
    row.push(secondaryButton(texts.paginationPrevious));
  }
  row.push(secondaryButton(texts.paginationGoToPage));
  if (currentPage < totalPages) {
    row.push(secondaryButton(texts.paginationNext));
  }

  return row;
}

function buildStorageTagPaginationRow({
  page,
  totalItems,
  language,
}: {
  page: number;
  totalItems: number;
  language: 'ca' | 'es' | 'en';
}): Array<string | TelegramReplyButton> {
  const totalPages = calculateStorageTagListTotalPages(totalItems);
  if (totalPages <= 1) {
    return [];
  }

  const texts = createTelegramI18n(language).storage;
  const currentPage = clampStorageTagListPage(page, totalItems);
  const row: Array<string | TelegramReplyButton> = [];
  if (currentPage > 1) {
    row.push(secondaryButton(texts.paginationPrevious));
  }
  if (currentPage < totalPages) {
    row.push(secondaryButton(texts.paginationNext));
  }
  return row;
}

function buildStorageTagResultsOptions({
  page,
  totalItems,
  language,
  context,
}: {
  page: number;
  totalItems: number;
  language: 'ca' | 'es' | 'en';
  context: StorageFlowContext;
}): TelegramReplyOptions {
  const paginationRow = buildStorageCategoryPaginationRow({ page, totalItems, language });
  return buildPersistentReplyKeyboard([
    ...(paginationRow.length > 0 ? [paginationRow] : []),
    buildGlobalNavigationRow(language),
  ]);
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

function buildForwardedImportActionOptions(language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).storage;
  return {
    replyKeyboard: [[successButton(texts.forwardedAddToStorage)], [dangerButton('/cancel')]],
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
    inlineKeyboard: [
      [{ text: texts.uploadAccept, callbackData: storageCallbackPrefixes.uploadPreviewAccept }],
      [
        { text: texts.addTagsButton, callbackData: storageCallbackPrefixes.uploadPreviewTags },
        { text: texts.uploadModifyDescription, callbackData: storageCallbackPrefixes.uploadPreviewDescription },
      ],
      [{ text: texts.addImages, callbackData: storageCallbackPrefixes.uploadPreviewImages }],
      [{ text: '/cancel', callbackData: storageCallbackPrefixes.uploadPreviewCancel, semanticRole: 'danger' }],
    ],
    replyKeyboard: [
      [successButton(texts.uploadAccept)],
      [secondaryButton(texts.uploadModifyDescription), successButton(texts.addTagsButton)],
      [successButton(texts.addImages)],
      [dangerButton('/cancel')],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildUploadConfirmNoTagsOptions(language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).storage;
  return {
    inlineKeyboard: [
      [{ text: texts.addTagsButton, callbackData: storageCallbackPrefixes.uploadPreviewTags }],
      [{ text: texts.uploadAcceptWithoutTags, callbackData: storageCallbackPrefixes.uploadPreviewAcceptWithoutTags }],
      [{ text: '/cancel', callbackData: storageCallbackPrefixes.uploadPreviewCancel, semanticRole: 'danger' }],
    ],
    replyKeyboard: [
      [successButton(texts.addTagsButton)],
      [secondaryButton(texts.uploadAcceptWithoutTags)],
      [dangerButton('/cancel')],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildUploadCategoryOptions({
  categories,
  currentCategoryId,
  language,
}: {
  categories: StorageCategoryChoice[];
  currentCategoryId: number | null;
  language: 'ca' | 'es' | 'en';
}): TelegramReplyOptions {
  const texts = createTelegramI18n(language).storage;
  const currentCategory = currentCategoryId === null ? null : categories.find((category) => category.id === currentCategoryId) ?? null;
  const rows: Array<Array<string | TelegramReplyButton>> = [];
  if (currentCategory) {
    rows.push([successButton(texts.selectCurrentUploadCategory)]);
    rows.push([secondaryButton(texts.back)]);
  }
  rows.push([dangerButton('/cancel')]);
  return {
    replyKeyboard: rows,
    resizeKeyboard: true,
    persistentKeyboard: true,
    parseMode: 'HTML',
  };
}

function buildStorageSearchModeOptions(language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).storage;
  return {
    replyKeyboard: [
      [successButton(texts.searchByTextOrTag)],
      [secondaryButton(texts.exploreSearchCategories)],
      [dangerButton('/cancel')],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
    parseMode: 'HTML',
  };
}

function buildSearchCategoryOptions({
  categories,
  currentCategoryId,
  language,
}: {
  categories: StorageCategoryChoice[];
  currentCategoryId: number | null;
  language: 'ca' | 'es' | 'en';
}): TelegramReplyOptions {
  const texts = createTelegramI18n(language).storage;
  const currentCategory = currentCategoryId === null ? null : categories.find((category) => category.id === currentCategoryId) ?? null;
  const rows: Array<Array<string | TelegramReplyButton>> = [];
  if (currentCategory) {
    rows.push([successButton(texts.selectCurrentSearchCategory)]);
    rows.push([secondaryButton(texts.back)]);
  }
  rows.push([dangerButton('/cancel')]);
  return {
    replyKeyboard: rows,
    resizeKeyboard: true,
    persistentKeyboard: true,
    parseMode: 'HTML',
  };
}

function buildStorageSubscriptionScopeOptions(language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).storage;
  return {
    replyKeyboard: [
      [successButton(texts.subscribeScopeCategoryOnly)],
      [secondaryButton(texts.subscribeScopeWithSubcategories)],
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
  if (!canEditStorageEntry(context, detail) && !canManageStorageEntryTags(context, detail)) {
    return { ...buildStorageMenuOptions(language, context), parseMode: 'HTML' };
  }

  const firstRow: TelegramInlineButton[] = canEditStorageEntry(context, detail)
    ? [
        { text: texts.editButton, callbackData: `${storageCallbackPrefixes.editEntry}${detail.entry.id}` },
        { text: texts.deleteButton, callbackData: `${storageCallbackPrefixes.deleteEntry}${detail.entry.id}`, semanticRole: 'danger' },
      ]
    : [];
  const tagRow: TelegramInlineButton[] = canManageStorageEntryTags(context, detail)
    ? [
        { text: texts.addTagsButton, callbackData: `${storageCallbackPrefixes.addEntryTags}${detail.entry.id}`, semanticRole: 'success' },
        ...(detail.entry.tags.length > 0
          ? [{ text: texts.removeTagsButton, callbackData: `${storageCallbackPrefixes.removeEntryTags}${detail.entry.id}`, semanticRole: 'danger' as const }]
          : []),
      ]
    : [];
  return {
    parseMode: 'HTML',
    inlineKeyboard: [firstRow, tagRow].filter((row) => row.length > 0),
  };
}

function buildEditEntryActionOptions(language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).storage;
  return {
    replyKeyboard: [
      [secondaryButton(texts.uploadModifyDescription), successButton(texts.addImages)],
      [secondaryButton(texts.moveCategory)],
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

function buildStorageDefaultChatSelectOptions(language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
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
    stepKey: 'upload-tags',
    data,
  });
  await context.reply(createTelegramI18n(language).storage.askTags, buildSkipOptionalOptions(language));
}

function formatUploadPreview(data: Record<string, unknown>, language: 'ca' | 'es' | 'en'): string {
  const texts = createTelegramI18n(language).storage;
  const messages = asDraftMessages(data.messages);
  const tags = asStringArray(data.tags);
  const lines = [
    `<b>${escapeHtml(texts.uploadPreviewHeader)}</b>`,
    `<b>${escapeHtml(texts.uploadPreviewCategory)}:</b> ${escapeHtml(String(data.categoryDisplayName ?? ''))}`,
    `<b>${escapeHtml(texts.entryFieldDescription)}:</b> ${escapeHtml(asNullableString(data.description) ?? texts.entryNoDescription)}`,
    `<b>${escapeHtml(texts.entryFieldTags)}:</b> ${tags.length > 0 ? formatStorageTagLinks(tags, new Map(), language) : escapeHtml(texts.entryNoTags)}`,
    `<b>${escapeHtml(texts.entryFieldAttachments)}:</b> ${messages.length}`,
    ...messages.map((message, index) => `  ${index + 1}. ${formatDraftStorageAttachment(message, language)}`),
    '',
    escapeHtml(texts.uploadPreviewInstructions),
  ];
  return lines.join('\n');
}

function formatStorageSearchModePrompt(language: 'ca' | 'es' | 'en'): string {
  const texts = createTelegramI18n(language).storage;
  return [
    escapeHtml(texts.askSearchMode),
    '',
    escapeHtml(texts.searchTelegramArchiveHint),
    escapeHtml(texts.searchTagHint),
  ].join('\n');
}

function formatStorageSearchQueryPrompt(language: 'ca' | 'es' | 'en'): string {
  const texts = createTelegramI18n(language).storage;
  const tagListUrl = escapeHtml(buildTelegramStartUrl('storage_tags'));
  return [
    escapeHtml(texts.askSearchQuery),
    escapeHtml(texts.searchQueryExamples),
    `<a href="${tagListUrl}">${escapeHtml(texts.openTagListLink)}</a>`,
  ].join('\n');
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

function formatDraftStorageAttachmentLabel(message: DmUploadDraftMessage, language: 'ca' | 'es' | 'en'): string {
  return message.originalFileName ?? resolveDefaultUploadDescription([message], language) ?? message.attachmentKind;
}

function collectDraftStorageTags(messages: DmUploadDraftMessage[]): string[] {
  return Array.from(new Set(messages.flatMap((message) => parseStorageCaptionMetadata(message.caption).tags))).sort();
}

function resolveDefaultUploadDescription(messages: DmUploadDraftMessage[], language: 'ca' | 'es' | 'en'): string | null {
  const firstCaption = messages.find((message) => message.caption?.trim())?.caption;
  if (firstCaption) {
    return parseStorageCaptionMetadata(firstCaption).description ?? firstCaption.trim();
  }
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
      text: 'text',
    },
    es: {
      document: 'documento',
      photo: 'foto',
      video: 'video',
      audio: 'audio',
      text: 'texto',
    },
    en: {
      document: 'document',
      photo: 'photo',
      video: 'video',
      audio: 'audio',
      text: 'text',
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

function buildMoveEntryCategoryOptions({
  categories,
  currentCategoryId,
  language,
}: {
  categories: StorageCategoryChoice[];
  currentCategoryId: number | null;
  language: 'ca' | 'es' | 'en';
}): TelegramReplyOptions {
  const texts = createTelegramI18n(language).storage;
  const currentCategory = currentCategoryId === null ? null : categories.find((category) => category.id === currentCategoryId) ?? null;
  const rows: Array<Array<string | TelegramReplyButton>> = [];
  if (currentCategory) {
    rows.push([successButton(texts.selectCurrentMoveCategory.replace('{category}', currentCategory.displayName))]);
    rows.push([secondaryButton(texts.back)]);
  }
  rows.push([dangerButton('/cancel')]);
  return {
    replyKeyboard: rows,
    resizeKeyboard: true,
    persistentKeyboard: true,
    parseMode: 'HTML',
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

function asCategoryChoices(value: unknown): StorageCategoryChoice[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => ({
      id: typeof entry === 'object' && entry !== null && 'id' in entry ? Number(entry.id) : NaN,
      displayName: typeof entry === 'object' && entry !== null && 'displayName' in entry ? String(entry.displayName) : '',
      parentCategoryId: typeof entry === 'object' && entry !== null && 'parentCategoryId' in entry ? asNullableNumber(entry.parentCategoryId) : null,
    }))
    .filter((entry) => Number.isInteger(entry.id) && entry.id > 0 && entry.displayName.length > 0);
}

function toStorageCategoryChoices(categories: StorageCategoryRecord[]): StorageCategoryChoice[] {
  return categories.map((category) => ({
    id: category.id,
    displayName: category.displayName,
    parentCategoryId: category.parentCategoryId,
  }));
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
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

function asNumberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0) : [];
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
  tagCounts,
  linkMode = 'detail',
}: {
  categoryDisplayName: string;
  details: StorageEntryDetailRecord[];
  language: 'ca' | 'es' | 'en';
  tagCounts: Map<string, number>;
  linkMode?: 'detail' | 'edit';
}): string {
  const texts = createTelegramI18n(language).storage;
  const visibleDetails = details.slice(0, storageListPageSize);
  const lines = [
    escapeHtml(texts.listHeader.replace('{category}', categoryDisplayName)),
    ...visibleDetails.map((detail) => formatStorageSummaryEntry(detail, language, { linkMode, tagCounts })),
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
  tagCounts,
}: {
  categoryDisplayName: string;
  details: StorageEntryDetailRecord[];
  language: 'ca' | 'es' | 'en';
  tagCounts: Map<string, number>;
}): string {
  const texts = createTelegramI18n(language).storage;
  const visibleDetails = details.slice(0, storageListPageSize);
  const lines = [
    escapeHtml(texts.listHeader.replace('{category}', categoryDisplayName)),
    ...visibleDetails.map((detail) => formatStorageSummaryEntry(detail, language, { linkMode: 'edit', tagCounts })),
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
  summaries,
  language,
  page,
  tagCounts,
}: {
  category: StorageCategoryRecord;
  childCategories: StorageCategoryRecord[];
  details: StorageEntryDetailRecord[];
  allCategories: StorageCategoryRecord[];
  summaries?: Map<number, { subcategoryCount: number; entryCount: number }>;
  language: 'ca' | 'es' | 'en';
  page: number;
  tagCounts: Map<string, number>;
}): string {
  const texts = createTelegramI18n(language).storage;
  const lines = [
    formatStorageCategoryBreadcrumbs(category, allCategories, language),
  ];

  if (childCategories.length > 0) {
    lines.push('', escapeHtml(texts.categoryChildrenHeader), ...formatStorageCategoryLinks(childCategories, language, childCategories, {
      ...(summaries ? { summaries } : {}),
    }));
  }

  if (details.length > 0) {
    const sortedDetails = sortStorageEntryDetailsAlphabetically(details);
    const currentPage = clampStorageListPage(page, sortedDetails.length);
    const offset = (currentPage - 1) * storageListPageSize;
    const visibleDetails = sortedDetails.slice(offset, offset + storageListPageSize);
    lines.push(
      '',
      escapeHtml(texts.categoryEntriesHeader),
      ...visibleDetails.map((detail) => formatStorageSummaryEntry(detail, language, {
        hideAttachmentCount: true,
        linkTarget: 'description',
        showTags: false,
        tagCounts,
      })),
    );
    if (sortedDetails.length > storageListPageSize) {
      lines.push(escapeHtml(formatStorageListPageFooter({
        total: sortedDetails.length,
        shownFrom: offset + 1,
        shownTo: offset + visibleDetails.length,
        page: currentPage,
        totalPages: calculateStorageListTotalPages(sortedDetails.length),
        language,
      })));
    }
  }

  if (childCategories.length === 0 && details.length === 0) {
    lines.push('', escapeHtml(texts.noEntriesInCategory));
  }

  return lines.join('\n');
}

function formatStorageCategoryListMessage({
  categories,
  language,
  labelMode = 'local',
  linkMode = 'detail',
  summaries,
}: {
  categories: StorageCategoryRecord[];
  language: 'ca' | 'es' | 'en';
  labelMode?: 'local' | 'full-path';
  linkMode?: 'detail' | 'edit' | 'select';
  summaries?: Map<number, { subcategoryCount: number; entryCount: number }>;
}): string {
  const texts = createTelegramI18n(language).storage;
  const visibleCategories = categories.slice(0, storageCategoryListPageSize);
  const lines = [
    escapeHtml(texts.categoriesHeader),
    ...formatStorageCategoryLinks(visibleCategories, language, categories, {
      labelMode,
      linkMode,
      ...(summaries ? { summaries } : {}),
    }),
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
  return `${escapeHtml(texts.askCategoryParent)}\n${formatStorageCategoryListMessage({ categories, language, linkMode: 'select' })}`;
}

function formatMoveEntryCategoryPrompt({
  categories,
  currentCategoryId,
  language,
  prompt,
}: {
  categories: StorageCategoryChoice[];
  currentCategoryId: number | null;
  language: 'ca' | 'es' | 'en';
  prompt?: string;
}): string {
  const texts = createTelegramI18n(language).storage;
  const currentCategory = currentCategoryId === null ? null : categories.find((category) => category.id === currentCategoryId) ?? null;
  const childCategories = categories
    .filter((category) => category.parentCategoryId === currentCategoryId)
    .sort(compareStorageCategoryChoices);
  const lines = [escapeHtml(prompt ?? texts.askMoveCategory)];
  if (currentCategory) {
    lines.push('', `<b>${escapeHtml(formatStorageCategoryChoicePath(currentCategory, categories))}</b>`);
    lines.push(escapeHtml(texts.selectCurrentCategoryHint));
  }
  if (childCategories.length > 0) {
    lines.push(
      '',
      escapeHtml(texts.openSubcategoryHint),
      escapeHtml(texts.categoriesHeader),
      ...childCategories.map((category) => {
        const url = escapeHtml(buildTelegramStartUrl(`${storageSelectCategoryStartPayloadPrefix}${category.id}`));
        return `- <a href="${url}"><b>${escapeHtml(category.displayName)}</b></a>`;
      }),
    );
  }
  return lines.join('\n');
}

function compareStorageCategoryChoices(left: StorageCategoryChoice, right: StorageCategoryChoice): number {
  return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base', numeric: true }) || left.id - right.id;
}

function formatStorageCategoryChoicePath(category: StorageCategoryChoice, allCategories: StorageCategoryChoice[]): string {
  const byId = new Map(allCategories.map((candidate) => [candidate.id, candidate]));
  const segments = [category.displayName];
  const visited = new Set<number>([category.id]);
  let current = category;
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

function formatMoveCategoryParentPrompt({
  category,
  parentChoices,
  allCategories,
  language,
}: {
  category: StorageCategoryRecord;
  parentChoices: StorageCategoryRecord[];
  allCategories: StorageCategoryRecord[];
  language: 'ca' | 'es' | 'en';
}): string {
  const texts = createTelegramI18n(language).storage;
  const rootUrl = escapeHtml(buildTelegramStartUrl(storageSelectRootCategoryStartPayload));
  const rootLine = `- <a href="${rootUrl}"><b>${escapeHtml(texts.storageRootLabel)}</b></a>`;
  const lines = [
    escapeHtml(texts.askChangeCategoryParent.replace('{category}', category.displayName)),
    rootLine,
  ];
  if (parentChoices.length > 0) {
    lines.push(...formatStorageCategoryLinks(parentChoices, language, allCategories, { linkMode: 'select' }));
  }
  return lines.join('\n');
}

function formatStorageCategoryLinks(
  categories: StorageCategoryRecord[],
  language: 'ca' | 'es' | 'en',
  allCategories: StorageCategoryRecord[] = categories,
  {
    linkMode = 'detail',
    labelMode = 'local',
    summaries,
  }: {
    linkMode?: 'detail' | 'edit' | 'select';
    labelMode?: 'local' | 'full-path';
    summaries?: Map<number, { subcategoryCount: number; entryCount: number }>;
  } = {},
): string[] {
  return orderStorageCategoriesForTree(categories, allCategories).map((category) => {
    const depth = resolveStorageCategoryDepth(category, allCategories);
    const prefix = `${'  '.repeat(depth)}- `;
    const label = labelMode === 'full-path' ? formatStorageCategoryPath(category, allCategories) : category.displayName;
    const summary = summaries?.get(category.id);
    const summaryLabel = summary ? ` ${formatStorageCategorySummary(summary, language)}` : '';
    const payloadPrefix = linkMode === 'edit'
      ? storageEditCategoryStartPayloadPrefix
      : linkMode === 'select'
        ? storageSelectCategoryStartPayloadPrefix
        : storageCategoryStartPayloadPrefix;
    const url = escapeHtml(buildTelegramStartUrl(`${payloadPrefix}${category.id}`));
    return `${prefix}<a href="${url}"><b>${escapeHtml(label)}</b></a>${escapeHtml(summaryLabel)}`;
  });
}

function formatStorageCategorySummary(
  summary: { subcategoryCount: number; entryCount: number },
  language: 'ca' | 'es' | 'en',
): string {
  const labels = {
    ca: {
      subcategorySingular: 'subcategoria',
      subcategoryPlural: 'subcategories',
      fileSingular: 'arxiu',
      filePlural: 'arxius',
      empty: 'buida',
    },
    es: {
      subcategorySingular: 'subcategoría',
      subcategoryPlural: 'subcategorías',
      fileSingular: 'archivo',
      filePlural: 'archivos',
      empty: 'vacía',
    },
    en: {
      subcategorySingular: 'subcategory',
      subcategoryPlural: 'subcategories',
      fileSingular: 'file',
      filePlural: 'files',
      empty: 'empty',
    },
  }[language];
  if (summary.subcategoryCount === 0 && summary.entryCount === 0) {
    return `(${labels.empty})`;
  }
  const parts = [];
  if (summary.subcategoryCount > 0) {
    const subcategoryLabel = summary.subcategoryCount === 1 ? labels.subcategorySingular : labels.subcategoryPlural;
    parts.push(`${summary.subcategoryCount} ${subcategoryLabel}`);
  }
  if (summary.entryCount > 0) {
    const fileLabel = summary.entryCount === 1 ? labels.fileSingular : labels.filePlural;
    parts.push(`${summary.entryCount} ${fileLabel}`);
  }
  return `(${parts.join(', ')})`;
}

function formatStorageCategoryPath(category: StorageCategoryRecord, allCategories: StorageCategoryRecord[]): string {
  return resolveStorageCategoryPath(category, allCategories).map((segment) => segment.displayName).join(' / ');
}

function formatStorageCategoryBreadcrumbs(
  category: StorageCategoryRecord,
  allCategories: StorageCategoryRecord[],
  language: 'ca' | 'es' | 'en',
): string {
  const path = resolveStorageCategoryPath(category, allCategories);
  const rootLink = `<a href="${escapeHtml(buildTelegramStartUrl(storageRootStartPayload))}">${escapeHtml(createTelegramI18n(language).storage.openMenu)}</a>`;
  return [rootLink, ...path.map((segment, index) => {
    if (index === path.length - 1) {
      return `<b>${escapeHtml(segment.displayName)}</b>`;
    }
    return `<a href="${escapeHtml(buildStorageCategoryDeepLink(segment.id))}">${escapeHtml(segment.displayName)}</a>`;
  })].join(' / ');
}

function resolveStorageCategoryPath(category: StorageCategoryRecord, allCategories: StorageCategoryRecord[]): StorageCategoryRecord[] {
  const byId = new Map(allCategories.map((candidate) => [candidate.id, candidate]));
  const segments = [category];
  let current = category;
  const visited = new Set<number>([category.id]);
  while (current.parentCategoryId !== null) {
    const parent = byId.get(current.parentCategoryId);
    if (!parent || visited.has(parent.id)) {
      break;
    }
    segments.unshift(parent);
    visited.add(parent.id);
    current = parent;
  }
  return segments;
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

function buildStorageTagDeepLink(tag: string): string {
  return buildTelegramStartUrl(`${storageTagStartPayloadPrefix}${encodeStorageTagPayload(tag)}`);
}

function buildStorageTagsPageDeepLink(page: number): string {
  return buildTelegramStartUrl(`${storageTagsStartPayloadPrefix}${page}`);
}

function encodeStorageTagPayload(tag: string): string {
  return tag.replace(/[^A-Za-z0-9_-]/g, '');
}

function normalizeStorageTagPayload(tag: string): string | null {
  const normalized = tag.trim().toLowerCase().replace(/^#+/, '').replace(/[^a-z0-9_-]/g, '');
  return normalized.length > 0 ? normalized : null;
}

function collectStorageCategoryDescendantIds(categoryId: number, categories: StorageCategoryRecord[]): number[] {
  const childrenByParent = new Map<number | null, StorageCategoryRecord[]>();
  for (const category of categories) {
    const siblings = childrenByParent.get(category.parentCategoryId) ?? [];
    siblings.push(category);
    childrenByParent.set(category.parentCategoryId, siblings);
  }

  const ids = new Set<number>();
  const stack = [categoryId];
  while (stack.length > 0) {
    const currentId = stack.pop();
    if (currentId === undefined || ids.has(currentId)) {
      continue;
    }
    ids.add(currentId);
    for (const child of childrenByParent.get(currentId) ?? []) {
      stack.push(child.id);
    }
  }

  return [...ids];
}

function formatStorageCategoryLimitedFooter(total: number, shown: number, language: 'ca' | 'es' | 'en'): string {
  return createTelegramI18n(language).storage.listLimitedCategoriesFooter
    .replace('{shown}', String(shown))
    .replace('{total}', String(total));
}

function formatStorageSearchResultsMessage(
  details: StorageEntryDetailRecord[],
  categories: StorageCategoryRecord[],
  language: 'ca' | 'es' | 'en',
  tagCounts: Map<string, number>,
  options: { showTags?: boolean; page?: number; paginate?: boolean } = {},
): string {
  const texts = createTelegramI18n(language).storage;
  const currentPage = clampStorageListPage(options.page ?? 1, details.length);
  const offset = (currentPage - 1) * storageListPageSize;
  const lastVisibleIndex = offset + storageListPageSize;
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const sortedDetails = sortStorageEntryDetailsAlphabetically(details);
  const detailsByCategory = new Map<number, StorageEntryDetailRecord[]>();
  for (const detail of sortedDetails) {
    const group = detailsByCategory.get(detail.category.id) ?? [];
    group.push(detail);
    detailsByCategory.set(detail.category.id, group);
  }

  const sortedCategoryIds = [...detailsByCategory.keys()].sort((leftId, rightId) => {
    const left = categoryById.get(leftId) ?? detailsByCategory.get(leftId)?.[0]?.category;
    const right = categoryById.get(rightId) ?? detailsByCategory.get(rightId)?.[0]?.category;
    const leftPath = left ? formatStorageCategoryPath(left, categories) : '';
    const rightPath = right ? formatStorageCategoryPath(right, categories) : '';
    return leftPath.localeCompare(rightPath, undefined, { sensitivity: 'base', numeric: true }) || leftId - rightId;
  });

  const lines = [escapeHtml(texts.searchResultsHeader)];
  let shown = 0;
  let index = 0;
  for (const categoryId of sortedCategoryIds) {
    if (index >= lastVisibleIndex) {
      break;
    }
    const category = categoryById.get(categoryId) ?? detailsByCategory.get(categoryId)?.[0]?.category;
    if (!category) {
      continue;
    }
    let categoryHeaderPrinted = false;
    for (const detail of detailsByCategory.get(categoryId) ?? []) {
      if (index >= lastVisibleIndex) {
        break;
      }
      if (index < offset) {
        index += 1;
        continue;
      }
      if (!categoryHeaderPrinted) {
        lines.push(
          '',
          `<a href="${escapeHtml(buildStorageCategoryDeepLink(category.id))}"><b>${escapeHtml(formatStorageCategoryPath(category, categories))}</b></a>`,
        );
        categoryHeaderPrinted = true;
      }
      lines.push(formatStorageSearchResultEntry(detail, language, tagCounts, options));
      shown += 1;
      index += 1;
    }
  }

  if (details.length > storageListPageSize && options.paginate === true) {
    lines.push(escapeHtml(formatStorageListPageFooter({
      total: details.length,
      shownFrom: offset + 1,
      shownTo: offset + shown,
      page: currentPage,
      totalPages: calculateStorageListTotalPages(details.length),
      language,
    })));
  } else if (details.length > shown) {
    lines.push(escapeHtml(formatStorageListLimitedFooter(details.length, shown, language)));
  }

  return lines.join('\n');
}

function formatStorageSearchResultEntry(
  detail: StorageEntryDetailRecord,
  language: 'ca' | 'es' | 'en',
  tagCounts: Map<string, number>,
  { showTags = true }: { showTags?: boolean } = {},
): string {
  const description = detail.entry.description ?? createTelegramI18n(language).storage.entryNoDescription;
  const url = escapeHtml(buildTelegramStartUrl(`${storageEntryStartPayloadPrefix}${detail.entry.id}`));
  const tags = showTags && detail.entry.tags.length > 0 ? ` · ${formatStorageTagLinks(detail.entry.tags, tagCounts, language)}` : '';
  return `- <a href="${url}">${escapeHtml(description)}</a>${tags}`;
}

function formatStorageTagListMessage({
  summaries,
  page,
  language,
}: {
  summaries: StorageTagSummary[];
  page: number;
  language: 'ca' | 'es' | 'en';
}): string {
  const texts = createTelegramI18n(language).storage;
  const currentPage = clampStorageTagListPage(page, summaries.length);
  const offset = (currentPage - 1) * storageTagListPageSize;
  const visible = summaries.slice(offset, offset + storageTagListPageSize);
  const lines = [
    escapeHtml(texts.tagsHeader),
    ...visible.map((summary) => `- ${formatStorageTagLink(summary.tag, summary.count, language)}`),
  ];
  if (summaries.length > storageTagListPageSize) {
    lines.push(escapeHtml(formatStorageListPageFooter({
      total: summaries.length,
      shownFrom: offset + 1,
      shownTo: offset + visible.length,
      page: currentPage,
      totalPages: calculateStorageTagListTotalPages(summaries.length),
      language,
    })));
  }
  return lines.join('\n');
}

function formatStorageTagResultsMessage({
  tag,
  details,
  categories,
  tagCounts,
  language,
  page,
}: {
  tag: string;
  details: StorageEntryDetailRecord[];
  categories: StorageCategoryRecord[];
  tagCounts: Map<string, number>;
  language: 'ca' | 'es' | 'en';
  page: number;
}): string {
  const texts = createTelegramI18n(language).storage;
  return [
    texts.tagResultsHeader.replace('{tag}', formatStorageTagLink(tag, tagCounts.get(tag) ?? details.length, language)),
    '',
    formatStorageSearchResultsMessage(details, categories, language, tagCounts, { showTags: false, page, paginate: true }),
  ].join('\n');
}

function formatStorageTagLinks(tags: string[], tagCounts: Map<string, number>, language: 'ca' | 'es' | 'en'): string {
  return tags.map((tag) => formatStorageTagLink(tag, tagCounts.get(tag) ?? 0, language)).join(', ');
}

function formatStorageTagLink(tag: string, count: number, language: 'ca' | 'es' | 'en'): string {
  const label = createTelegramI18n(language).storage.tagFileCount
    .replace('{tag}', `#${tag}`)
    .replace('{count}', String(count));
  return `<a href="${escapeHtml(buildStorageTagDeepLink(tag))}">${escapeHtml(label)}</a>`;
}

function formatStorageTagChoiceLabel(tag: string): string {
  return `#${tag}`;
}

function formatStorageEntryNotification(detail: StorageEntryDetailRecord, language: 'ca' | 'es' | 'en'): string {
  const texts = createTelegramI18n(language).storage;
  const description = detail.entry.description ?? texts.entryNoDescription;
  const url = buildTelegramStartUrl(`${storageEntryStartPayloadPrefix}${detail.entry.id}`);
  return [
    `<b>${escapeHtml(texts.newStorageEntryNotification)}</b>`,
    `${escapeHtml(texts.uploadPreviewCategory)}: ${escapeHtml(detail.category.displayName)}`,
    `${escapeHtml(texts.entryFieldDescription)}: <a href="${escapeHtml(url)}">${escapeHtml(description)}</a>`,
  ].join('\n');
}

function formatStorageSummaryEntry(
  detail: StorageEntryDetailRecord,
  language: 'ca' | 'es' | 'en',
  {
    includeCategory = false,
    linkMode = 'detail',
    hideAttachmentCount = false,
    linkTarget = 'title',
    showTags = true,
    tagCounts = new Map<string, number>(),
  }: {
    includeCategory?: boolean;
    linkMode?: 'detail' | 'edit';
    hideAttachmentCount?: boolean;
    linkTarget?: 'title' | 'description';
    showTags?: boolean;
    tagCounts?: Map<string, number>;
  } = {},
): string {
  const description = detail.entry.description ?? createTelegramI18n(language).storage.entryNoDescription;
  const title = includeCategory ? `${detail.category.displayName} · #${detail.entry.id}` : `#${detail.entry.id}`;
  const texts = createTelegramI18n(language).storage;
  const attachmentSummary = `${texts.entryFieldAttachments}: ${detail.messages.length}`;
  const tags = showTags && detail.entry.tags.length > 0 ? ` · ${formatStorageTagLinks(detail.entry.tags, tagCounts, language)}` : '';
  const payloadPrefix = linkMode === 'edit' ? storageEditEntryStartPayloadPrefix : storageEntryStartPayloadPrefix;
  const url = escapeHtml(buildTelegramStartUrl(`${payloadPrefix}${detail.entry.id}`));
  const linkedTitle = `<a href="${url}"><b>${escapeHtml(title)}</b></a>`;
  const linkedDescription = `<a href="${url}">${escapeHtml(description)}</a>`;
  if (linkTarget === 'description') {
    return `- ${linkedDescription}${tags}`;
  }
  return `- ${linkedTitle} · ${escapeHtml(description)}${hideAttachmentCount ? '' : ` · ${escapeHtml(attachmentSummary)}`}${tags}`;
}

function sortStorageEntryDetailsAlphabetically(details: StorageEntryDetailRecord[]): StorageEntryDetailRecord[] {
  return [...details].sort((left, right) => {
    const leftLabel = formatStorageEntrySortLabel(left);
    const rightLabel = formatStorageEntrySortLabel(right);
    return leftLabel.localeCompare(rightLabel, undefined, { sensitivity: 'base', numeric: true }) || left.entry.id - right.entry.id;
  });
}

type StorageTagSummary = {
  tag: string;
  count: number;
};

async function buildReadableStorageTagCounts(context: StorageFlowContext): Promise<Map<string, number>> {
  const categories = await listReadableCategories(context);
  return buildStorageTagCounts(await listReadableStorageEntryDetails(context, categories));
}

async function buildReadableStorageTagSummaries(context: StorageFlowContext): Promise<StorageTagSummary[]> {
  return formatStorageTagSummaries(await buildReadableStorageTagCounts(context));
}

function buildStorageTagCounts(details: StorageEntryDetailRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const detail of details) {
    if (detail.entry.lifecycleStatus !== 'active') {
      continue;
    }
    for (const tag of new Set(detail.entry.tags)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return counts;
}

function formatStorageTagSummaries(counts: Map<string, number>): StorageTagSummary[] {
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag, undefined, { sensitivity: 'base', numeric: true }));
}

async function listReadableStorageEntryDetails(
  context: StorageFlowContext,
  categories?: StorageCategoryRecord[],
): Promise<StorageEntryDetailRecord[]> {
  const readableCategories = categories ?? await listReadableCategories(context);
  const detailsByCategory = await Promise.all(readableCategories.map((category) => resolveRepository(context).listEntryDetailsByCategory(category.id)));
  return detailsByCategory.flat().filter((detail) => detail.entry.lifecycleStatus === 'active');
}

function formatStorageEntrySortLabel(detail: StorageEntryDetailRecord): string {
  return (detail.entry.description ?? detail.messages.find((message) => message.originalFileName)?.originalFileName ?? '').trim();
}

function formatStorageListLimitedFooter(total: number, shown: number, language: 'ca' | 'es' | 'en'): string {
  return createTelegramI18n(language).storage.listLimitedFooter
    .replace('{shown}', String(shown))
    .replace('{total}', String(total));
}

function formatStorageListPageFooter({
  total,
  shownFrom,
  shownTo,
  page,
  totalPages,
  language,
}: {
  total: number;
  shownFrom: number;
  shownTo: number;
  page: number;
  totalPages: number;
  language: 'ca' | 'es' | 'en';
}): string {
  return createTelegramI18n(language).storage.listPageFooter
    .replace('{from}', String(shownFrom))
    .replace('{to}', String(shownTo))
    .replace('{total}', String(total))
    .replace('{page}', String(page))
    .replace('{pages}', String(totalPages));
}

function calculateStorageListTotalPages(totalItems: number): number {
  return Math.max(1, Math.ceil(totalItems / storageListPageSize));
}

function clampStorageListPage(page: number, totalItems: number): number {
  return Math.min(Math.max(1, page), calculateStorageListTotalPages(totalItems));
}

function calculateStorageTagListTotalPages(totalItems: number): number {
  return Math.max(1, Math.ceil(totalItems / storageTagListPageSize));
}

function clampStorageTagListPage(page: number, totalItems: number): number {
  return Math.min(Math.max(1, page), calculateStorageTagListTotalPages(totalItems));
}

function parseCategoryPageCallback(callbackData: string, prefix: string): { categoryId: number; page: number } | null {
  const [categoryIdValue, pageValue] = callbackData.slice(prefix.length).split(':');
  const categoryId = Number(categoryIdValue);
  const page = Number(pageValue);
  if (!Number.isInteger(categoryId) || categoryId <= 0 || !Number.isInteger(page) || page <= 0) {
    return null;
  }
  return { categoryId, page };
}

function formatStorageEntryDetail(
  detail: StorageEntryDetailRecord,
  language: 'ca' | 'es' | 'en',
  allCategories: StorageCategoryRecord[] = [detail.category],
  tagCounts: Map<string, number> = new Map(),
): string {
  const texts = createTelegramI18n(language).storage;
  const lines = [
    `<b>#${detail.entry.id}</b> · <a href="${escapeHtml(buildStorageCategoryDeepLink(detail.category.id))}">${escapeHtml(formatStorageCategoryPath(detail.category, allCategories))}</a>`,
    `<b>${escapeHtml(texts.entryFieldDescription)}:</b> ${escapeHtml(detail.entry.description ?? texts.entryNoDescription)}`,
    `<b>${escapeHtml(texts.entryFieldUploadedAt)}:</b> ${escapeHtml(formatStorageDateTime(detail.entry.createdAt))}`,
  ];
  if (detail.entry.tags.length > 0) {
    lines.push(`<b>${escapeHtml(texts.entryFieldTags)}:</b> ${formatStorageTagLinks(detail.entry.tags, tagCounts, language)}`);
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

type StorageUploadProgressStep = 'copying' | 'indexing' | 'notifying';
type StorageUploadProgressStatus = 'pending' | 'active' | 'done';

type StorageUploadProgressState = {
  activeStep: StorageUploadProgressStep | null;
  activeStartedAt: number | null;
  durations: Partial<Record<StorageUploadProgressStep, number>>;
  copyFiles: StorageUploadCopyFileProgress[];
};

const storageUploadProgressSteps: StorageUploadProgressStep[] = ['copying', 'indexing', 'notifying'];

type StorageUploadCopyFileProgress = {
  label: string;
  status: StorageUploadProgressStatus;
  startedAt: number | null;
  duration: number | null;
};

type StorageUploadCopyProgressEvent = {
  kind: 'finished';
  index: number;
};

function createStorageUploadProgressState(messages: DmUploadDraftMessage[], language: 'ca' | 'es' | 'en'): StorageUploadProgressState {
  return {
    activeStep: 'copying',
    activeStartedAt: Date.now(),
    durations: {},
    copyFiles: messages.map((message, index) => ({
      label: formatDraftStorageAttachmentLabel(message, language),
      status: index === 0 ? 'active' : 'pending',
      startedAt: index === 0 ? Date.now() : null,
      duration: null,
    })),
  };
}

function updateStorageUploadCopyProgress(
  state: StorageUploadProgressState,
  event: StorageUploadCopyProgressEvent,
): void {
  const file = state.copyFiles[event.index];
  if (!file) {
    return;
  }
  if (file.status === 'active' && file.startedAt !== null) {
    file.duration = Date.now() - file.startedAt;
  }
  file.status = 'done';
  file.startedAt = null;
  const nextFile = state.copyFiles[event.index + 1];
  if (nextFile && nextFile.status === 'pending') {
    nextFile.status = 'active';
    nextFile.startedAt = Date.now();
  }
}

async function moveStorageUploadProgress(
  progress: { update(message: string): Promise<void> },
  texts: ReturnType<typeof createTelegramI18n>['storage'],
  state: StorageUploadProgressState,
  nextStep: StorageUploadProgressStep,
): Promise<void> {
  if (state.activeStep === nextStep) {
    return;
  }
  finishStorageUploadProgressStep(state);
  state.activeStep = nextStep;
  state.activeStartedAt = Date.now();
  await progress.update(formatStorageUploadProgress(texts, state));
}

function finishStorageUploadProgressStep(state: StorageUploadProgressState): void {
  if (!state.activeStep || state.activeStartedAt === null) {
    return;
  }
  state.durations[state.activeStep] = Date.now() - state.activeStartedAt;
  state.activeStep = null;
  state.activeStartedAt = null;
}

function formatStorageUploadProgress(
  texts: ReturnType<typeof createTelegramI18n>['storage'],
  state: StorageUploadProgressState,
): string {
  return `${texts.uploadProgressTitle}\n\n${storageUploadProgressSteps
    .flatMap((step) => formatStorageUploadProgressLines(texts, state, step))
    .join('\n')}`;
}

function formatStorageUploadProgressLines(
  texts: ReturnType<typeof createTelegramI18n>['storage'],
  state: StorageUploadProgressState,
  step: StorageUploadProgressStep,
): string[] {
  const label = resolveStorageUploadProgressStepLabel(texts, step);
  const status = resolveStorageUploadProgressStepStatus(state, step);
  const duration = state.durations[step];
  const lines: string[] = [];
  if (status === 'done') {
    lines.push(`✅ ${label} (${formatStorageUploadDuration(duration ?? 0)})`);
  } else if (status === 'active') {
    lines.push(`⏳ ${label}`);
  } else {
    lines.push(`⬜ ${label}`);
  }
  if (step === 'copying') {
    lines.push(...state.copyFiles.map((file) => formatStorageUploadCopyFileProgressLine(file)));
  }
  return lines;
}

function formatStorageUploadCopyFileProgressLine(file: StorageUploadCopyFileProgress): string {
  if (file.status === 'done') {
    return `  ✅ ${file.label} (${formatStorageUploadDuration(file.duration ?? 0)})`;
  }
  if (file.status === 'active') {
    return `  ⏳ ${file.label}`;
  }
  return `  ⬜ ${file.label}`;
}

function resolveStorageUploadProgressStepStatus(
  state: StorageUploadProgressState,
  step: StorageUploadProgressStep,
): StorageUploadProgressStatus {
  if (state.activeStep === step) {
    return 'active';
  }
  if (typeof state.durations[step] === 'number') {
    return 'done';
  }
  return 'pending';
}

function resolveStorageUploadProgressStepLabel(
  texts: ReturnType<typeof createTelegramI18n>['storage'],
  step: StorageUploadProgressStep,
): string {
  switch (step) {
    case 'copying':
      return texts.uploadProgressCopying;
    case 'indexing':
      return texts.uploadProgressIndexing;
    case 'notifying':
      return texts.uploadProgressNotifying;
  }
}

function formatStorageUploadDuration(milliseconds: number): string {
  return `${Math.max(0, Math.round(milliseconds))} ms`;
}

async function startStorageEditableProgress(
  context: StorageFlowContext,
  message: string,
): Promise<{ update(message: string): Promise<void>; complete(message: string, options?: TelegramReplyOptions): Promise<void> }> {
  const sent = await context.reply(message);
  const messageId = extractTelegramReplyMessageId(sent);
  const chatId = context.runtime.chat?.chatId;
  const editMessageText = context.runtime.bot.editMessageText;
  let canEdit = Boolean(messageId && chatId && editMessageText);

  const tryEdit = async (nextMessage: string, options?: TelegramReplyOptions): Promise<boolean> => {
    if (!canEdit || !messageId || !chatId || !editMessageText) {
      return false;
    }
    try {
      await editMessageText({ chatId, messageId, text: nextMessage, ...(options ? { options } : {}) });
      return true;
    } catch (error) {
      canEdit = false;
      console.warn(JSON.stringify({
        event: 'storage.upload.progress-edit.failed',
        error: error instanceof Error ? error.message : String(error),
      }));
      return false;
    }
  };

  return {
    update: async (nextMessage) => {
      await tryEdit(nextMessage);
    },
    complete: async (nextMessage, options) => {
      if (!(await tryEdit(nextMessage, options))) {
        await context.reply(nextMessage, options);
      }
    },
  };
}

function extractTelegramReplyMessageId(value: unknown): number | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = (value as Record<string, unknown>).message_id
    ?? (value as Record<string, unknown>).messageId;
  return typeof candidate === 'number' && Number.isInteger(candidate) ? candidate : null;
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

function canManageStorageEntryTags(context: StorageFlowContext, detail: StorageEntryDetailRecord): boolean {
  return context.runtime.actor.isAdmin || detail.entry.createdByTelegramUserId === context.runtime.actor.telegramUserId;
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

function parseExactStartPayload(messageText: string): string | null {
  const [command, payload] = messageText.trim().split(/\s+/, 2);
  if (command !== '/start' || !payload) {
    return null;
  }
  return payload;
}

function parseSignedInteger(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed !== 0 ? parsed : null;
}

function isSupportedAttachmentKind(value: string): value is DmUploadDraftMessage['attachmentKind'] {
  return value === 'document' || value === 'photo' || value === 'video' || value === 'audio' || value === 'text';
}
