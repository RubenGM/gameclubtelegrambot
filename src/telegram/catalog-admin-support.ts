import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { appendAuditEvent, type AuditLogRepository } from '../audit/audit-log.js';
import { createDatabaseAuditLogRepository } from '../audit/audit-log-store.js';
import {
  createCatalogDescriptionTranslator,
  type CatalogDescriptionTranslator,
} from '../catalog/catalog-description-translation.js';
import {
  createHttpCatalogLookupService,
  type CatalogLookupCandidate,
  type CatalogLookupService,
} from '../catalog/catalog-lookup-service.js';
import {
  createCatalogItem,
  createCatalogMedia,
  deactivateCatalogItem,
  setCatalogItemOwner,
  type CatalogLoanRecord,
  type CatalogLoanRepository,
  listCatalogGroups,
  listCatalogItems,
  removeCatalogMedia,
  type CatalogMediaType,
  updateCatalogItem,
  updateCatalogMedia,
  type CatalogFamilyRecord,
  type CatalogGroupRecord,
  type CatalogItemRecord,
  type CatalogItemType,
  type CatalogRepository,
} from '../catalog/catalog-model.js';
import {
  storeCatalogMediaAttachment,
  storeCatalogMediaExternalImage,
  type CatalogMediaExternalImageDownloader,
  type CatalogMediaExternalImageProgressStep,
  type CatalogMediaAttachmentInput,
} from '../catalog/catalog-media-storage.js';
import type {
  BoardGameGeekCollectionDescriptor,
  BoardGameGeekCollectionError,
  BoardGameGeekCollectionKey,
  BoardGameGeekCollectionImportResult,
  BoardGameGeekCollectionListResult,
  BoardGameGeekCollectionImportService,
  WikipediaBoardGameCatalogDraft,
  WikipediaBoardGameImportResult,
  WikipediaBoardGameImportService,
} from '../catalog/wikipedia-boardgame-import-service.js';
import { createDatabaseCatalogRepository } from '../catalog/catalog-store.js';
import { createDatabaseCatalogLoanRepository } from '../catalog/catalog-loan-store.js';
import { createDatabaseStorageRepository } from '../storage/storage-catalog-store.js';
import type { StorageCategoryRepository } from '../storage/storage-catalog.js';
import { createBoardGameGeekCollectionImportService, createWikipediaBoardGameImportService } from '../catalog/wikipedia-boardgame-import-service.js';
import { buildOpencodeRunArgs, runOpencodeImageQueryCapture } from '../scripts/opencode-image-query.js';
import {
  buildLoanItemButton,
  canReturnLoan,
  catalogLoanCallbackPrefixes,
  formatLoanAvailabilityLines,
  handleTelegramCatalogLoanCallback,
  resolveLoanBorrowerDisplayName,
  showAdminLoanDashboard,
  type TelegramCatalogLoanContext,
} from './catalog-loan-flow.js';
import { buildDateOptions } from './schedule-keyboards.js';
import {
  buildCatalogAdminMenuOptions,
  buildCoverSaveOptions,
  buildCreateConfirmOptions,
  buildCreateFieldMenuOptions as buildCatalogCreateFieldMenuOptions,
  buildCreateOptionalKeyboard,
  buildDeactivateConfirmOptions,
  buildBggCollectionChoiceOptions,
  buildEditConfirmOptions,
  buildEditFamilyOptions,
  buildEditFieldMenuOptions as buildCatalogEditFieldMenuOptions,
  buildEditGroupOptions,
  buildEditMediaTypeOptions,
  buildEditOptionalKeyboard,
  buildEditTypeOptions,
  buildFamilyOptions as buildCatalogFamilyOptions,
  buildGroupOptions,
  buildKeepCurrentKeyboard,
  buildMediaConfirmOptions,
  buildMediaDeleteConfirmOptions,
  buildMediaEditConfirmOptions,
  buildMediaTypeOptions,
  buildSingleCancelKeyboard,
  buildSkipOptionalKeyboard,
  buildTypeOptions,
  buildWikipediaCandidateOptions,
  buildWikipediaUrlOptions,
} from './catalog-admin-keyboards.js';
import { formatCatalogAdminDraftSummary } from './catalog-admin-draft-summary.js';
import { buildCatalogAdminItemDetailButtons } from './catalog-admin-detail-buttons.js';
import { formatCatalogAdminGroupDetails, formatCatalogAdminItemDetails } from './catalog-admin-details.js';
import { sendCatalogItemCoverIfPresent } from './catalog-cover-media.js';
import {
  buildCatalogAdminBrowseFamilyKeyboard,
  buildCatalogAdminBrowseSearchKeyboard,
  buildCatalogAdminSelectionKeyboard,
  formatCatalogAdminFamilyBrowseMessage,
  formatCatalogAdminItemList,
  formatCatalogAdminSearchResultsMessage,
} from './catalog-admin-browse-ui.js';
import { parseCatalogAdminCallbackRoute } from './catalog-admin-callback-routing.js';
import {
  startCatalogAdminBrowseSearchSession,
  startCatalogAdminAddMediaSession,
  startCatalogAdminDeactivateSession,
  startCatalogAdminDeleteMediaSession,
  startCatalogAdminEditMediaSession,
  startCatalogAdminEditSelectionSession,
} from './catalog-admin-callback-sessions.js';
import { handleCatalogAdminCreateSession } from './catalog-admin-create-flow.js';
import {
  handleCatalogAdminMediaDeleteSession,
  handleCatalogAdminMediaSession,
} from './catalog-admin-media-flow.js';
import {
  buildCatalogAdminFamilyOptions,
  buildCatalogAdminFamilyPrompt,
  buildCatalogAdminGroupedInspectKeyboard,
  buildCatalogAdminGroupPrompt,
  chunkKeyboard,
  familyKindForItemType,
  listPopularCatalogFamilies,
} from './catalog-admin-family-group-ui.js';
import { handleCatalogAdminEditSession } from './catalog-admin-edit-flow.js';
import {
  replyWithCatalogAdminGroupInspection,
  replyWithCatalogAdminItemInspection,
} from './catalog-admin-inspection-replies.js';
import {
  buildCatalogAdminItemDeepLink as buildCatalogAdminItemDeepLinkUrl,
  formatCatalogBrowseItemLine,
  formatCatalogItemSummaryLine,
  formatCatalogListDate,
  formatCatalogLoanSummary,
  parseCatalogAdminStartPayload as parseCatalogAdminStartPayloadValue,
} from './catalog-admin-list-formatting.js';
import { buildTelegramStartUrl } from './deep-links.js';
import {
  asNullableNumber,
  asNullableString,
  asLookupCandidate,
  asLookupCandidates,
  asStringArray,
  parseCommaSeparatedItemNames,
  parseItemId,
  parseLookupCandidateInput,
  parseOptionalJsonObject,
  parseOptionalPositiveInteger,
  parseWikipediaTitleFromUrl,
} from './catalog-admin-parsing.js';
import { parseCatalogFamilyInput, parseCatalogGroupInput } from './catalog-admin-repository-parsing.js';
import {
  escapeHtml,
  formatCatalogDescriptionLine,
  formatCatalogItemSummaryDetails,
  formatHtmlField,
  renderCatalogItemType,
  renderCatalogOptionalObject,
  renderCatalogPlayerRange,
} from './catalog-presentation.js';
import { createDatabaseMembershipAccessRepository } from '../membership/access-flow-store.js';
import type { MembershipAccessRepository, MembershipUserRecord } from '../membership/access-flow.js';
import { formatTelegramUserLink } from './telegram-user-links.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import type { AuthorizationService } from '../authorization/service.js';
import type { TelegramActor } from './actor-store.js';
import type { TelegramChatContext } from './chat-context.js';
import type { ConversationSessionRuntime } from './conversation-session.js';
import type { TelegramPhotoMediaInput } from './telegram-media.js';
import {
  createDatabaseAppMetadataSessionStorage,
  type AppMetadataSessionStorage,
} from './conversation-session-store.js';
import type { TelegramReplyButton, TelegramReplyOptions } from './runtime-boundary.js';

const createFlowKey = 'catalog-admin-create';
const bulkCreateFlowKey = 'catalog-admin-bulk-create';
const editFlowKey = 'catalog-admin-edit';
const deactivateFlowKey = 'catalog-admin-deactivate';
const mediaFlowKey = 'catalog-admin-media';
const mediaDeleteFlowKey = 'catalog-admin-media-delete';
const browseFlowKey = 'catalog-admin-browse';
const bggCollectionImportFlowKey = 'catalog-admin-bgg-collection-import';
const catalogAdminStartPayloadPrefix = 'catalog_admin_item_';
const catalogAdminFullItemStartPayloadPrefix = 'catalog_admin_item_full_';
const bulkCreateRateLimitMs = 700;
const bulkCreateItemLimit = 100;
const catalogOwnerSelectorPageSize = 8;

type BulkCreateStatus = 'added' | 'alreadyExists' | 'noMatch' | 'ambiguous' | 'error';

type CatalogImportedImageMediaResult =
  | { status: 'created'; mediaId: number; url: string }
  | { status: 'already-exists'; mediaId: number }
  | { status: 'no-image-url' }
  | { status: 'failed' };

type BulkCreateSummaryItem = {
  input: string;
  status: BulkCreateStatus;
  title?: string;
  itemId?: number;
  candidates?: string[];
  reason?: string;
};

export const catalogAdminCallbackPrefixes = {
  browseMenu: 'catalog_admin:browse_menu',
  browseFamily: 'catalog_admin:browse_family:',
  browseLetters: 'catalog_admin:browse_letters:',
  browseSearch: 'catalog_admin:browse_search',
  inspect: 'catalog_admin:inspect:',
  inspectGroup: 'catalog_admin:inspect_group:',
  edit: 'catalog_admin:edit:',
  createActivity: 'catalog_admin:create_activity:',
  autocorrect: 'catalog_admin:autocorrect:',
  autocorrectBggCandidate: 'catalog_admin:autocorrect_bgg:',
  translateDescription: 'catalog_admin:translate_description:',
  setOwnerSelf: 'catalog_admin:owner_self:',
  selectOwner: 'catalog_admin:owner_select:',
  ownerPage: 'catalog_admin:owner_page:',
  clearOwner: 'catalog_admin:owner_clear:',
  deactivate: 'catalog_admin:deactivate:',
  addMedia: 'catalog_admin:add_media:',
  editMedia: 'catalog_admin:edit_media:',
  deleteMedia: 'catalog_admin:delete_media:',
} as const;

const catalogCoverTitleModel = process.env.GAMECLUB_COVER_TITLE_MODEL?.trim() || 'openai/gpt-5.4-mini';
const catalogBggDescriptionTranslationModel = process.env.GAMECLUB_BGG_DESCRIPTION_TRANSLATION_MODEL?.trim() || 'openai/gpt-5.4-mini';
const catalogOpencodeBin = process.env.GAMECLUB_OPENCODE_BIN?.trim() || 'opencode';

export const catalogAdminLabels = {
  openMenu: 'Cataleg',
  create: 'Crear item',
  list: 'Llistar items',
  listBoardGames: 'Llistar jocs de taula',
  listExpansions: 'Llistar expansions',
  listBooks: 'Llistar llibres',
  listRpgBooks: 'Llistar llibres RPG',
  searchByName: 'Cerca per nom',
  importBggCollection: 'Importar col.leccio BGG',
  edit: 'Editar item',
  addMedia: 'Afegir media',
  deactivate: 'Desactivar item',
  typeBoardGame: 'Joc de taula',
  typeBook: 'Llibre',
  typeRpgBook: 'Llibre RPG',
  typeAccessory: 'Accessori',
  noFamily: 'Sense familia',
  noGroup: 'Sense grup',
  skipOptional: 'Ometre',
  keepCurrent: 'Mantenir valor actual',
  confirmCreate: 'Guardar item',
  confirmEdit: 'Guardar canvis',
  confirmDeactivate: 'Confirmar desactivacio',
  confirmMediaCreate: 'Guardar media',
  confirmMediaEdit: 'Guardar canvis media',
  confirmMediaDelete: 'Confirmar eliminacio media',
  mediaTypeImage: 'Imatge',
  mediaTypeLink: 'Enllac',
  mediaTypeDocument: 'Document',
  editFieldDisplayName: 'Nom visible',
  editFieldItemType: 'Tipus',
  editFieldFamily: 'Familia',
  editFieldGroup: 'Grup',
  editFieldOriginalName: 'Nom original',
  editFieldDescription: 'Descripcio',
  editFieldLanguage: 'Llengua',
  editFieldPublisher: 'Editorial',
  editFieldPublicationYear: 'Any publicacio',
  editFieldPlayerMin: 'Minim jugadors',
  editFieldPlayerMax: 'Maxim jugadors',
  editFieldRecommendedAge: 'Edat recomanada',
  editFieldPlayTimeMinutes: 'Durada',
  editFieldExternalRefs: 'Referencies externes',
  editFieldMetadata: 'Metadata',
  importLookupData: 'Importar dades',
  skipLookupImport: 'No importar dades',
  manualWikipediaUrl: 'Entrar URL manualment',
  refineLookupByAuthor: 'Refinar amb autor',
  keepTypedTitle: 'Quedar-me amb el meu titol',
  useApiTitle: 'Fer servir el titol de la API',
  bulkCreate: 'Afegir múltiples',
  askBulkNames: 'Escriu els noms separats per coma. Si usen coma literal, no els separis de moment.',
  bulkCreateAcknowledged: 'Gràcies! Ara processaré els resultats en segon pla. Quan acabi t\'enviaré un resum per aquí.',
  bulkCreateSummaryHeader: 'Resum de la càrrega múltiple:',
  bulkCreateSummaryAdded: 'Creats',
  bulkCreateSummaryAlreadyExists: 'Ja existia',
  bulkCreateSummaryNoMatch: 'Sense coincidència clara',
  bulkCreateSummaryAmbiguous: 'Ambigus',
  bulkCreateSummaryError: 'Errors',
  bulkCreateSummaryManualFallback: 'Pots fer la resta manualment un a un amb aquesta opció: Crear item.',
  bulkCreateManualButton: 'Afegir manualment',
  bulkCreateComplete: 'Completar',
  bulkCreateCompleted: 'Procés completat.',
  start: 'Inici',
  cancel: '/cancel',
} as const;

export interface TelegramCatalogAdminContext {
  messageText?: string | undefined;
  callbackData?: string | undefined;
  messageMedia?: {
    attachmentKind: string;
    fileId?: string | null;
    fileUniqueId?: string | null;
    caption?: string | null;
    originalFileName?: string | null;
    mimeType?: string | null;
    fileSizeBytes?: number | null;
    mediaGroupId?: string | null;
    messageId: number;
  } | undefined;
  reply(message: string, options?: TelegramReplyOptions): Promise<unknown>;
  runtime: {
    actor: TelegramActor;
    authorization: AuthorizationService;
    session: ConversationSessionRuntime;
    chat: TelegramChatContext;
    services: {
      database: {
        db: unknown;
      };
    };
    wikipediaBoardGameImportService?: WikipediaBoardGameImportService;
    boardGameGeekCollectionImportService?: BoardGameGeekCollectionImportService;
    bot: {
      publicName: string;
      clubName: string;
      language?: string;
      sendPrivateMessage(telegramUserId: number, message: string, options?: TelegramReplyOptions): Promise<void>;
      createForumTopic?(input: { chatId: number; name: string }): Promise<{ chatId: number; name: string; messageThreadId: number }>;
      copyMessage?(input: { fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }): Promise<{ messageId: number }>;
      forwardMessage?(input: { fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }): Promise<{ messageId: number }>;
      sendMediaGroup?(input: { chatId: number; media: TelegramPhotoMediaInput[]; messageThreadId?: number }): Promise<Array<{ messageId: number }>>;
      downloadFile?(input: { fileId: string; destinationPath: string }): Promise<void>;
      editMessageText?(input: { chatId: number; messageId: number; text: string; options?: TelegramReplyOptions }): Promise<void>;
    };
    descriptionTranslator?: CatalogDescriptionTranslator;
  };
  catalogRepository?: CatalogRepository;
  catalogLoanRepository?: CatalogLoanRepository;
  membershipRepository?: TelegramCatalogLoanContext['membershipRepository'] | undefined;
  auditRepository?: AuditLogRepository;
  storageRepository?: StorageCategoryRepository;
  storageDefaultChatStore?: AppMetadataSessionStorage;
  catalogLookupService?: CatalogLookupService;
  wikipediaBoardGameImportService?: WikipediaBoardGameImportService;
  boardGameGeekCollectionImportService?: BoardGameGeekCollectionImportService;
  coverTitleResolver?: (input: { imagePath: string; question: string; model: string }) => Promise<string>;
  descriptionTranslator?: CatalogDescriptionTranslator;
  externalImageDownloader?: CatalogMediaExternalImageDownloader;
}

export async function handleTelegramCatalogAdminText(context: TelegramCatalogAdminContext): Promise<boolean> {
  const text = context.messageText?.trim();
  if (!text || context.runtime.chat.kind !== 'private' || !canAccessCatalog(context)) {
    return false;
  }

  if (isCatalogAdminSession(context.runtime.session.current?.flowKey)) {
    return handleActiveCatalogSession(context, text);
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const i18n = createTelegramI18n(language);
  const texts = i18n.catalogAdmin;

  const letterCommandPayload = parseCatalogAdminLetterStartPayload(text);
  if (letterCommandPayload !== null) {
    await showCatalogLettersBrowse(context, letterCommandPayload);
    return true;
  }

  if (text === texts.bulkCreateComplete || text === catalogAdminLabels.bulkCreateComplete) {
    await context.runtime.session.cancel();
    await context.reply(texts.bulkCreateCompleted, buildCatalogAdminMenuOptions(language));
    return true;
  }

  if (text === i18n.actionMenu.catalog || text === catalogAdminLabels.openMenu || text === '/catalog') {
    await showCatalogBrowseMenu(context);
    return true;
  }
  if (text === texts.bulkCreate || text === catalogAdminLabels.bulkCreate || text === '/catalog_bulk') {
    await context.runtime.session.start({ flowKey: bulkCreateFlowKey, stepKey: 'bulk-item-type', data: {} });
    await context.reply(texts.askItemType, buildTypeOptions(language));
    return true;
  }
  if (text === i18n.catalogLoan.adminDashboard || text === '/loan_admin' || text === '/loans_admin') {
    await showAdminLoanDashboard(context);
    return true;
  }
  if (text === texts.create || text === catalogAdminLabels.create || text === '/catalog_create') {
    await context.runtime.session.start({ flowKey: createFlowKey, stepKey: 'item-type', data: {} });
    await context.reply(texts.askItemType, buildTypeOptions(language));
    return true;
  }
  if (text === texts.listBoardGames || text === catalogAdminLabels.listBoardGames) {
    await replyWithCatalogList(context, 'list', 'board-game');
    return true;
  }
  if (text === texts.listExpansions || text === catalogAdminLabels.listExpansions) {
    await replyWithCatalogList(context, 'list', 'expansion');
    return true;
  }
  if (text === texts.listBooks || text === catalogAdminLabels.listBooks) {
    await replyWithCatalogList(context, 'list', 'book');
    return true;
  }
  if (text === texts.listRpgBooks || text === catalogAdminLabels.listRpgBooks) {
    await replyWithCatalogList(context, 'list', 'rpg-book');
    return true;
  }
  if (text === texts.list || text === catalogAdminLabels.list || text === '/catalog_list') {
    await replyWithCatalogList(context, 'list');
    return true;
  }
  if (text === texts.edit || text === catalogAdminLabels.edit || text === '/catalog_edit') {
    if (!canAdministerCatalog(context)) {
      await replyAdminOnly(context);
      return true;
    }
    await replyWithCatalogList(context, 'edit');
    return true;
  }
  if (text === texts.deactivate || text === catalogAdminLabels.deactivate || text === '/catalog_deactivate') {
    if (!canAdministerCatalog(context)) {
      await replyAdminOnly(context);
      return true;
    }
    await replyWithCatalogList(context, 'deactivate');
    return true;
  }
  if (text === texts.searchByName || text === catalogAdminLabels.searchByName || text === '/catalog_search') {
    await context.runtime.session.start({ flowKey: browseFlowKey, stepKey: 'search-query', data: {} });
    await context.reply(texts.askSearchQuery, buildSingleCancelKeyboard());
    return true;
  }
  if (text === texts.importBggCollection || text === catalogAdminLabels.importBggCollection) {
    if (!canAdministerCatalog(context)) {
      await replyAdminOnly(context);
      return true;
    }
    await context.runtime.session.start({ flowKey: bggCollectionImportFlowKey, stepKey: 'bgg-username', data: {} });
    await context.reply(texts.askBggCollectionUsername, buildSingleCancelKeyboard());
    return true;
  }
  return false;
}

export async function handleTelegramCatalogAdminMessage(context: TelegramCatalogAdminContext): Promise<boolean> {
  if (context.runtime.chat.kind !== 'private' || !canAccessCatalog(context)) {
    return false;
  }

  const session = context.runtime.session.current;
  if (!context.messageMedia) {
    return false;
  }

  if (session?.flowKey === createFlowKey && session.stepKey === 'display-name') {
    return handleCreateSession(context, '', session.stepKey, session.data);
  }

  if (session?.flowKey === mediaFlowKey && (session.stepKey === 'input' || session.stepKey === 'attachment')) {
    return handleActiveCatalogSession(context, '');
  }

  return false;
}

export async function handleTelegramCatalogAdminStartText(context: TelegramCatalogAdminContext): Promise<boolean> {
  if (context.messageText?.trim() === '/start catalog_admin' && context.runtime.chat.kind === 'private' && canAccessCatalog(context)) {
    await showCatalogBrowseMenu(context);
    return true;
  }

  const letterPayload = parseCatalogAdminLetterStartPayload(context.messageText);
  if (letterPayload !== null && context.runtime.chat.kind === 'private' && canAccessCatalog(context)) {
    await showCatalogLettersBrowse(context, letterPayload);
    return true;
  }

  const fullPayload = parseCatalogAdminStartPayloadValue(context.messageText, catalogAdminFullItemStartPayloadPrefix);
  const payload = fullPayload ?? parseCatalogAdminStartPayload(context.messageText);
  if (payload === null || context.runtime.chat.kind !== 'private' || !canAccessCatalog(context)) {
    return false;
  }

  const item = await loadItemOrThrow(context, payload);
  await replyWithCatalogAdminItemDetail(context, item, normalizeBotLanguage(context.runtime.bot.language, 'ca'), { full: fullPayload !== null });
  return true;
}

export async function handleTelegramCatalogAdminCallback(context: TelegramCatalogAdminContext): Promise<boolean> {
  const callbackData = context.callbackData;
  if (!callbackData || context.runtime.chat.kind !== 'private' || !canAccessCatalog(context)) {
    return false;
  }

  const route = parseCatalogAdminCallbackRoute(callbackData, catalogAdminCallbackPrefixes);
  if (route === null) {
    return false;
  }

  if (route.kind === 'browse-menu') {
    await showCatalogBrowseMenu(context);
    return true;
  }
  if (route.kind === 'browse-search') {
    await startCatalogAdminBrowseSearchSession({
      session: context.runtime.session,
      reply: context.reply,
      language: normalizeBotLanguage(context.runtime.bot.language, 'ca'),
      browseFlowKey,
    });
    return true;
  }
  if (route.kind === 'browse-family') {
    await showCatalogFamilyBrowse(context, route.familyId);
    return true;
  }
  if (route.kind === 'browse-letters') {
    await showCatalogLettersBrowse(context, route.initials);
    return true;
  }

  if (route.kind === 'inspect-item') {
    const item = await loadItemOrThrow(context, route.itemId);
    await replyWithCatalogAdminItemDetail(context, item, normalizeBotLanguage(context.runtime.bot.language, 'ca'));
    return true;
  }
  if (route.kind === 'inspect-group') {
    const group = await loadGroupOrThrow(context, route.groupId);
    const items = await listCatalogItems({ repository: resolveCatalogRepository(context), groupId: route.groupId, includeDeactivated: true });
    const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
    const inlineKeyboard = await Promise.all(
      items.map(async (item) => {
        const loan = await loadActiveLoanByItemIdAdmin(context, item.id);
        return buildLoanItemButton(loan, item.id, item.displayName, undefined, language, loan ? canReturnLoan(context, loan) : true);
      }),
    );
    await replyWithCatalogAdminGroupInspection({
      reply: context.reply,
      detailsMessage: await formatCatalogGroupDetails(context, group),
      inlineKeyboard,
    });
    return true;
  }
  if (route.kind === 'edit-item') {
    if (!canAdministerCatalog(context)) {
      await replyAdminOnly(context);
      return true;
    }
    const item = await loadItemOrThrow(context, route.itemId);
    const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
    await startCatalogAdminEditSelectionSession({
      session: context.runtime.session,
      reply: context.reply,
      language,
      editFlowKey,
      itemId: route.itemId,
      item,
      itemDetailsMessage: await formatCatalogItemDetails(context, item),
      itemTypeSupportsPlayers,
    });
    return true;
  }
  if (route.kind === 'create-activity') {
    const item = await loadItemOrThrow(context, route.itemId);
    if (item.itemType !== 'board-game') {
      return false;
    }
    const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
    const loanWarning = await buildCreateActivityLoanWarning(context, item.id, language);
    const datePrompt = createTelegramI18n(language).schedule.askDate;
    await context.runtime.session.start({
      flowKey: 'schedule-create',
      stepKey: 'date',
      data: { title: item.displayName, catalogItemId: item.id },
    });
    await context.reply(loanWarning ? `${loanWarning}\n\n${datePrompt}` : datePrompt, buildDateOptions(context.runtime.bot.language ?? language));
    return true;
  }
  if (route.kind === 'autocorrect-item') {
    if (!canAdministerCatalog(context)) {
      await replyAdminOnly(context);
      return true;
    }
    const item = await loadItemOrThrow(context, route.itemId);
    await handleCatalogAdminAutocorrectItem(context, item);
    return true;
  }
  if (route.kind === 'autocorrect-bgg-candidate') {
    if (!canAdministerCatalog(context)) {
      await replyAdminOnly(context);
      return true;
    }
    const item = await loadItemOrThrow(context, route.itemId);
    await handleCatalogAdminAutocorrectItem(context, item, { boardGameGeekId: route.boardGameGeekId });
    return true;
  }
  if (route.kind === 'translate-description') {
    if (!canAdministerCatalog(context)) {
      await replyAdminOnly(context);
      return true;
    }
    const item = await loadItemOrThrow(context, route.itemId);
    await handleCatalogAdminTranslateDescription(context, item);
    return true;
  }
  if (route.kind === 'set-owner-self') {
    if (!canAdministerCatalog(context)) {
      await replyAdminOnly(context);
      return true;
    }
    await assignCatalogItemOwner(context, route.itemId, context.runtime.actor.telegramUserId);
    return true;
  }
  if (route.kind === 'owner-page') {
    if (!canAdministerCatalog(context)) {
      await replyAdminOnly(context);
      return true;
    }
    await replyWithCatalogOwnerSelector(context, route.itemId, route.page);
    return true;
  }
  if (route.kind === 'select-owner') {
    if (!canAdministerCatalog(context)) {
      await replyAdminOnly(context);
      return true;
    }
    await assignCatalogItemOwner(context, route.itemId, route.ownerTelegramUserId);
    return true;
  }
  if (route.kind === 'clear-owner') {
    if (!canAdministerCatalog(context)) {
      await replyAdminOnly(context);
      return true;
    }
    await clearCatalogItemOwner(context, route.itemId);
    return true;
  }
  if (route.kind === 'deactivate-item') {
    if (!canAdministerCatalog(context)) {
      await replyAdminOnly(context);
      return true;
    }
    const item = await loadItemOrThrow(context, route.itemId);
    const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
    await startCatalogAdminDeactivateSession({
      session: context.runtime.session,
      reply: context.reply,
      language,
      deactivateFlowKey,
      itemId: route.itemId,
      itemDetailsMessage: await formatCatalogItemDetails(context, item),
    });
    return true;
  }
  if (route.kind === 'add-media') {
    if (!canAdministerCatalog(context)) {
      await replyAdminOnly(context);
      return true;
    }
    const item = await loadItemOrThrow(context, route.itemId);
    const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
    await startCatalogAdminAddMediaSession({
      session: context.runtime.session,
      reply: context.reply,
      language,
      mediaFlowKey,
      itemId: item.id,
    });
    return true;
  }
  if (route.kind === 'edit-media') {
    if (!canAdministerCatalog(context)) {
      await replyAdminOnly(context);
      return true;
    }
    const media = await loadMediaOrThrow(context, route.mediaId);
    const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
    await startCatalogAdminEditMediaSession({
      session: context.runtime.session,
      reply: context.reply,
      language,
      mediaFlowKey,
      media,
    });
    return true;
  }
  if (route.kind === 'delete-media') {
    if (!canAdministerCatalog(context)) {
      await replyAdminOnly(context);
      return true;
    }
    const media = await loadMediaOrThrow(context, route.mediaId);
    const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
    await startCatalogAdminDeleteMediaSession({
      session: context.runtime.session,
      reply: context.reply,
      language,
      mediaDeleteFlowKey,
      media,
    });
    return true;
  }

  return false;
}

async function handleCatalogAdminAutocorrectItem(
  context: TelegramCatalogAdminContext,
  item: CatalogItemRecord,
  options: { boardGameGeekId?: string } = {},
): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).catalogAdmin;
  const repository = resolveCatalogRepository(context);
  const progressState = createAutocorrectProgressState('api');
  const progress = await startEditableProgress(context, formatAutocorrectProgress(texts, progressState));

  const importResult = await importCatalogAutocorrectDraft(context, item, options);
  if (!importResult.ok) {
    finishAutocorrectProgressStep(progressState);
    if (importResult.candidates && importResult.candidates.length > 0) {
      await progress.complete(
        `${texts.autocorrectAmbiguousTitle}\n\n${formatCatalogAutocorrectCandidates(importResult.candidates)}\n\n${formatAutocorrectDurations(texts, progressState)}`,
        buildCatalogAutocorrectCandidateOptions({ itemId: item.id, candidates: importResult.candidates, texts }),
      );
      return;
    }
    await progress.complete(`${texts.autocorrectItemFailed.replace('{reason}', importResult.reason)}\n\n${formatAutocorrectDurations(texts, progressState)}`);
    return;
  }

  await moveAutocorrectProgress(progress, texts, progressState, 'translation');
  const draft = importResult.draft;
  const translatedDraft = await translateBggDraftDescriptionIfNeeded(context, draft);

  await moveAutocorrectProgress(progress, texts, progressState, 'saving');
  const metadata = cleanCatalogAutocorrectMetadata(draft.metadata, draft.externalRefs);
  const updated = await updateCatalogItem({
    repository,
    itemId: item.id,
    familyId: item.familyId,
    groupId: item.groupId,
    itemType: draft.itemType,
    displayName: draft.displayName || item.displayName,
    originalName: draft.originalName,
    description: translatedDraft.description,
    language: translatedDraft.language,
    publisher: translatedDraft.publisher,
    publicationYear: translatedDraft.publicationYear,
    playerCountMin: translatedDraft.playerCountMin,
    playerCountMax: translatedDraft.playerCountMax,
    recommendedAge: translatedDraft.recommendedAge,
    playTimeMinutes: translatedDraft.playTimeMinutes,
    externalRefs: null,
    metadata,
  });

  await appendAuditEvent({
    repository: resolveAuditRepository(context),
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    actionKey: 'catalog.item.autocorrected',
    targetType: 'catalog-item',
    targetId: updated.id,
    summary: `Item de cataleg autocorregit: ${updated.displayName}`,
    details: { source: metadata?.source ?? importResult.source, query: importResult.query, boardGameGeekId: metadata?.boardGameGeekId ?? readBoardGameGeekId(draft.externalRefs) },
  });

  await moveAutocorrectProgress(progress, texts, progressState, 'coverDownload');
  const coverResult = await tryCreateImportedImageMedia(
    context,
    updated,
    { metadata: draft.metadata, externalRefs: draft.externalRefs },
    {
      onExternalImageProgress: async (step) => {
        await moveAutocorrectProgress(progress, texts, progressState, mapExternalImageProgressStep(step));
      },
    },
  );
  finishAutocorrectCoverProgress(progressState, coverResult);
  await moveAutocorrectProgress(progress, texts, progressState, 'detail');
  await replyWithCatalogAdminItemDetail(context, updated, language);
  finishAutocorrectProgressStep(progressState);
  await progress.complete(`${texts.autocorrectItemUpdated}\n${formatAutocorrectCoverResult(coverResult, texts)}\n\n${formatAutocorrectDurations(texts, progressState)}`);
}

async function replyWithCatalogAdminItemDetail(
  context: TelegramCatalogAdminContext,
  item: CatalogItemRecord,
  language: 'ca' | 'es' | 'en',
  { full = false }: { full?: boolean } = {},
): Promise<void> {
  await sendCatalogItemCoverIfPresent(context, { itemId: item.id });
  await context.runtime.session.start({
    flowKey: browseFlowKey,
    stepKey: 'detail',
    data: { itemId: item.id },
  });
  await replyWithCatalogAdminItemInspection({
    reply: context.reply,
    detailsMessage: full ? await formatCatalogItemDetails(context, item) : await formatCatalogItemSummary(context, item),
    replyKeyboard: await buildCatalogItemDetailReplyKeyboard(context, item, language),
  });
}

async function handleCatalogAdminTranslateDescription(
  context: TelegramCatalogAdminContext,
  item: CatalogItemRecord,
): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).catalogAdmin;
  const description = item.description?.trim();
  if (!description) {
    await context.reply(texts.translateDescriptionMissing);
    return;
  }

  await context.reply(texts.translatingDescription);

  try {
    const translator = resolveCatalogDescriptionTranslator(context);
    const translated = normalizeTranslatedDescription(await translator({
      description,
      model: catalogBggDescriptionTranslationModel,
      targetLanguage: 'es',
    }));
    if (!translated) {
      await context.reply(texts.translateDescriptionFailed.replace('{reason}', 'OpenCode no ha devuelto una traduccion valida.'));
      return;
    }

    const updated = await updateCatalogItem({
      repository: resolveCatalogRepository(context),
      itemId: item.id,
      familyId: item.familyId,
      groupId: item.groupId,
      itemType: item.itemType,
      displayName: item.displayName,
      originalName: item.originalName,
      description: translated,
      language: item.language,
      publisher: item.publisher,
      publicationYear: item.publicationYear,
      playerCountMin: item.playerCountMin,
      playerCountMax: item.playerCountMax,
      recommendedAge: item.recommendedAge,
      playTimeMinutes: item.playTimeMinutes,
      externalRefs: item.externalRefs,
      metadata: item.metadata,
    });

    await appendAuditEvent({
      repository: resolveAuditRepository(context),
      actorTelegramUserId: context.runtime.actor.telegramUserId,
      actionKey: 'catalog.item.description_translated',
      targetType: 'catalog-item',
      targetId: updated.id,
      summary: `Descripcio de cataleg traduida: ${updated.displayName}`,
      details: {
        model: catalogBggDescriptionTranslationModel,
        originalLength: description.length,
        translatedLength: translated.length,
      },
    });

    console.info(JSON.stringify({
      event: 'catalog.description.translation.completed',
      model: catalogBggDescriptionTranslationModel,
      itemId: item.id,
      title: item.displayName,
      originalLength: description.length,
      translatedLength: translated.length,
    }));
    await context.reply(texts.translateDescriptionUpdated);
    await replyWithCatalogAdminItemDetail(context, updated, language);
  } catch (error) {
    const reason = formatTranslationErrorReason(error);
    console.warn(JSON.stringify({
      event: 'catalog.description.translation.failed',
      model: catalogBggDescriptionTranslationModel,
      itemId: item.id,
      title: item.displayName,
      error: reason,
    }));
    await context.reply(texts.translateDescriptionFailed.replace('{reason}', reason));
  }
}

async function assignCatalogItemOwner(context: TelegramCatalogAdminContext, itemId: number, ownerTelegramUserId: number): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).catalogAdmin;
  const owner = await resolveMembershipRepository(context).findUserByTelegramUserId(ownerTelegramUserId);
  if (!owner || owner.status !== 'approved') {
    await context.reply(texts.ownerSelectorEmpty);
    return;
  }
  const updated = await setCatalogItemOwner({
    repository: resolveCatalogRepository(context),
    itemId,
    ownerTelegramUserId,
  });
  await appendAuditEvent({
    repository: resolveAuditRepository(context),
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    actionKey: 'catalog.item.owner_updated',
    targetType: 'catalog-item',
    targetId: String(itemId),
    summary: 'Propietari de cataleg actualitzat',
    details: { ownerTelegramUserId },
  });
  await context.reply(texts.ownerAssigned);
  await replyWithCatalogAdminItemDetail(context, updated, language);
}

async function clearCatalogItemOwner(context: TelegramCatalogAdminContext, itemId: number): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).catalogAdmin;
  const updated = await setCatalogItemOwner({
    repository: resolveCatalogRepository(context),
    itemId,
    ownerTelegramUserId: null,
  });
  await appendAuditEvent({
    repository: resolveAuditRepository(context),
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    actionKey: 'catalog.item.owner_cleared',
    targetType: 'catalog-item',
    targetId: String(itemId),
    summary: 'Propietari de cataleg eliminat',
    details: {},
  });
  await context.reply(texts.ownerCleared);
  await replyWithCatalogAdminItemDetail(context, updated, language);
}

async function replyWithCatalogOwnerSelector(context: TelegramCatalogAdminContext, itemId: number, page: number): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).catalogAdmin;
  const membershipRepository = resolveMembershipRepository(context);
  const users = (membershipRepository.listManageableUsers
    ? await membershipRepository.listManageableUsers()
    : [...(await membershipRepository.listApprovedAdminUsers()), ...(await membershipRepository.listRevocableUsers())])
    .filter((user) => user.status === 'approved')
    .sort((left, right) => left.displayName.localeCompare(right.displayName) || left.telegramUserId - right.telegramUserId);
  if (users.length === 0) {
    await context.reply(texts.ownerSelectorEmpty);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(users.length / catalogOwnerSelectorPageSize));
  const resolvedPage = Math.min(Math.max(page, 1), totalPages);
  const pageUsers = users.slice((resolvedPage - 1) * catalogOwnerSelectorPageSize, resolvedPage * catalogOwnerSelectorPageSize);
  const lines = [
    escapeHtml(texts.ownerSelectorTitle),
    '',
    language === 'ca' ? `Pàgina ${resolvedPage}/${totalPages}` : language === 'es' ? `Página ${resolvedPage}/${totalPages}` : `Page ${resolvedPage}/${totalPages}`,
    ...pageUsers.map((user) => `- ${formatTelegramUserLink(user)}`),
  ];
  const rows: NonNullable<TelegramReplyOptions['inlineKeyboard']> = pageUsers.map((user) => [{
    text: user.displayName,
    callbackData: `${catalogAdminCallbackPrefixes.selectOwner}${itemId}:${user.telegramUserId}`,
  }]);
  if (totalPages > 1) {
    rows.push([
      { text: language === 'es' ? 'Anterior' : language === 'en' ? 'Previous' : 'Anterior', callbackData: `${catalogAdminCallbackPrefixes.ownerPage}${itemId}:${Math.max(1, resolvedPage - 1)}` },
      { text: language === 'es' ? 'Siguiente' : language === 'en' ? 'Next' : 'Següent', callbackData: `${catalogAdminCallbackPrefixes.ownerPage}${itemId}:${Math.min(totalPages, resolvedPage + 1)}` },
    ]);
  }
  rows.push([{ text: texts.browseBack, callbackData: `${catalogAdminCallbackPrefixes.inspect}${itemId}` }]);

  await context.reply(lines.join('\n'), { parseMode: 'HTML', inlineKeyboard: rows });
}

type CatalogAutocorrectDraft = WikipediaBoardGameCatalogDraft;
type CatalogAutocorrectCandidate = {
  boardGameGeekId: string;
  label: string;
};

async function importCatalogAutocorrectDraft(
  context: TelegramCatalogAdminContext,
  item: CatalogItemRecord,
  options: { boardGameGeekId?: string } = {},
): Promise<
  | { ok: true; draft: CatalogAutocorrectDraft; source: string; query: string }
  | { ok: false; reason: string; candidates?: CatalogAutocorrectCandidate[] }
> {
  if (item.itemType === 'board-game' || item.itemType === 'expansion') {
    const title = item.displayName;
    const bggId = options.boardGameGeekId ?? readBoardGameGeekIdFromItem(item);
    const primaryQuery = bggId ? `${title} [API #${bggId}]` : title;
    const service = resolveWikipediaBoardGameImportService(context);
    const result = await service.importByTitle(primaryQuery);
    if (result.ok && (options.boardGameGeekId || isCatalogAutocorrectDraftCompatibleWithItem(item, result.draft))) {
      return { ok: true, draft: result.draft, source: 'boardgamegeek', query: primaryQuery };
    }

    if (result.ok && bggId && !options.boardGameGeekId) {
      const fallbackResult = await service.importByTitle(title);
      return mapBoardGameAutocorrectImportResult({
        item,
        query: title,
        result: fallbackResult,
        allowIncompatibleDraft: false,
      });
    }

    if (result.ok) {
      return {
        ok: false,
        reason: formatCatalogAutocorrectMismatchReason(item, result.draft),
      };
    }

    const fallbackResult = bggId && !options.boardGameGeekId
      ? await service.importByTitle(title)
      : result;
    return mapBoardGameAutocorrectImportResult({
      item,
      query: fallbackResult === result ? primaryQuery : title,
      result: fallbackResult,
      allowIncompatibleDraft: Boolean(options.boardGameGeekId),
    });
  }

  if (item.itemType === 'book' || item.itemType === 'rpg-book') {
    const title = item.originalName ?? item.displayName;
    let candidates: CatalogLookupCandidate[];
    try {
      candidates = await resolveCatalogLookupService(context).search({ itemType: item.itemType, query: title });
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'Open Library lookup failed' };
    }
    const candidate = candidates[0];
    if (!candidate) {
      return { ok: false, reason: 'No se ha encontrado ninguna coincidencia en Open Library.' };
    }
    return {
      ok: true,
      source: candidate.source,
      query: title,
      draft: {
        familyId: null,
        groupId: null,
        itemType: item.itemType,
        displayName: candidate.title,
        originalName: candidate.importedData.originalName,
        description: candidate.importedData.description,
        language: candidate.importedData.language,
        publisher: candidate.importedData.publisher,
        publicationYear: candidate.importedData.publicationYear,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: candidate.importedData.externalRefs,
        metadata: candidate.importedData.metadata,
      },
    };
  }

  return { ok: false, reason: 'Este tipo de item no tiene una API de autocorreccion configurada.' };
}

function mapBoardGameAutocorrectImportResult({
  item,
  query,
  result,
  allowIncompatibleDraft,
}: {
  item: CatalogItemRecord;
  query: string;
  result: WikipediaBoardGameImportResult;
  allowIncompatibleDraft: boolean;
}):
  | { ok: true; draft: CatalogAutocorrectDraft; source: string; query: string }
  | { ok: false; reason: string; candidates?: CatalogAutocorrectCandidate[] } {
  if (!result.ok) {
    const candidates = result.error.type === 'ambiguous'
      ? parseCatalogAutocorrectCandidates(result.error.candidates ?? [])
      : [];
    return {
      ok: false,
      reason: result.error.message,
      ...(candidates.length > 0 ? { candidates } : {}),
    };
  }

  if (!allowIncompatibleDraft && !isCatalogAutocorrectDraftCompatibleWithItem(item, result.draft)) {
    return {
      ok: false,
      reason: formatCatalogAutocorrectMismatchReason(item, result.draft),
    };
  }

  return { ok: true, draft: result.draft, source: 'boardgamegeek', query };
}

function isCatalogAutocorrectDraftCompatibleWithItem(
  item: CatalogItemRecord,
  draft: CatalogAutocorrectDraft,
): boolean {
  const itemTitle = normalizeCatalogAutocorrectTitle(item.displayName);
  const draftTitles = [draft.displayName, draft.originalName]
    .map((value) => normalizeCatalogAutocorrectTitle(value ?? ''))
    .filter((value) => value.length > 0);

  return draftTitles.some((draftTitle) => draftTitle === itemTitle);
}

function formatCatalogAutocorrectMismatchReason(
  item: CatalogItemRecord,
  draft: CatalogAutocorrectDraft,
): string {
  const returnedTitle = draft.displayName || draft.originalName || 'otro titulo';
  return `La API ha devuelto "${returnedTitle}" al autocorregir "${item.displayName}". No he actualizado el item para evitar reemplazarlo por otro juego.`;
}

function normalizeCatalogAutocorrectTitle(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseCatalogAutocorrectCandidates(candidateLabels: string[]): CatalogAutocorrectCandidate[] {
  return candidateLabels.flatMap((label) => {
    const match = label.match(/\[API #(\d+)\]\s*$/i);
    const boardGameGeekId = match?.[1];
    return boardGameGeekId ? [{ boardGameGeekId, label }] : [];
  });
}

function formatCatalogAutocorrectCandidates(candidates: CatalogAutocorrectCandidate[]): string {
  return candidates.map((candidate, index) => `${index + 1}. ${candidate.label}`).join('\n');
}

function buildCatalogAutocorrectCandidateOptions({
  itemId,
  candidates,
  texts,
}: {
  itemId: number;
  candidates: CatalogAutocorrectCandidate[];
  texts: ReturnType<typeof createTelegramI18n>['catalogAdmin'];
}): TelegramReplyOptions {
  return {
    inlineKeyboard: [
      ...candidates.map((candidate) => [{
        text: truncateInlineButtonText(candidate.label),
        callbackData: `${catalogAdminCallbackPrefixes.autocorrectBggCandidate}${itemId}:${candidate.boardGameGeekId}`,
      }]),
      [{ text: texts.autocorrectAmbiguousBackToDetail, callbackData: `${catalogAdminCallbackPrefixes.inspect}${itemId}` }],
    ],
  };
}

function truncateInlineButtonText(value: string): string {
  const maxLength = 60;
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function formatAutocorrectCoverResult(
  result: CatalogImportedImageMediaResult,
  texts: ReturnType<typeof createTelegramI18n>['catalogAdmin'],
): string {
  switch (result.status) {
    case 'created':
      return texts.autocorrectCoverImported.replace('{mediaId}', String(result.mediaId));
    case 'already-exists':
      return texts.autocorrectCoverAlreadyExists.replace('{mediaId}', String(result.mediaId));
    case 'no-image-url':
      return texts.autocorrectCoverMissing;
    case 'failed':
      return texts.autocorrectCoverFailed;
  }
}

type CatalogAutocorrectProgressStep = 'api' | 'translation' | 'saving' | 'coverDownload' | 'coverUpload' | 'detail';
type CatalogAutocorrectProgressStatus = 'pending' | 'active' | 'done' | 'skipped';

type CatalogAutocorrectProgressState = {
  activeStep: CatalogAutocorrectProgressStep | null;
  activeStartedAt: number | null;
  durations: Partial<Record<CatalogAutocorrectProgressStep, number>>;
  skipped: Set<CatalogAutocorrectProgressStep>;
};

const catalogAutocorrectProgressSteps: CatalogAutocorrectProgressStep[] = [
  'api',
  'translation',
  'saving',
  'coverDownload',
  'coverUpload',
  'detail',
];

function formatAutocorrectProgress(
  texts: ReturnType<typeof createTelegramI18n>['catalogAdmin'],
  state: CatalogAutocorrectProgressState,
): string {
  const lines = catalogAutocorrectProgressSteps.map((step) => formatAutocorrectProgressLine(texts, state, step));
  return `${texts.autocorrectProgressTitle}\n\n${lines.join('\n')}`;
}

function formatAutocorrectDurations(
  texts: ReturnType<typeof createTelegramI18n>['catalogAdmin'],
  state: CatalogAutocorrectProgressState,
): string {
  return `${texts.autocorrectProgressDurationsTitle}\n${catalogAutocorrectProgressSteps
    .map((step) => formatAutocorrectProgressLine(texts, state, step))
    .join('\n')}`;
}

function createAutocorrectProgressState(activeStep: CatalogAutocorrectProgressStep): CatalogAutocorrectProgressState {
  return {
    activeStep,
    activeStartedAt: Date.now(),
    durations: {},
    skipped: new Set(),
  };
}

async function moveAutocorrectProgress(
  progress: { update(message: string): Promise<void> },
  texts: ReturnType<typeof createTelegramI18n>['catalogAdmin'],
  state: CatalogAutocorrectProgressState,
  nextStep: CatalogAutocorrectProgressStep,
): Promise<void> {
  if (state.activeStep === nextStep) {
    return;
  }
  finishAutocorrectProgressStep(state);
  state.activeStep = nextStep;
  state.activeStartedAt = Date.now();
  state.skipped.delete(nextStep);
  await progress.update(formatAutocorrectProgress(texts, state));
}

function finishAutocorrectProgressStep(state: CatalogAutocorrectProgressState): void {
  if (!state.activeStep || state.activeStartedAt === null) {
    return;
  }
  state.durations[state.activeStep] = Date.now() - state.activeStartedAt;
  state.activeStep = null;
  state.activeStartedAt = null;
}

function skipAutocorrectProgressStep(state: CatalogAutocorrectProgressState, step: CatalogAutocorrectProgressStep): void {
  if (state.activeStep === step) {
    state.activeStep = null;
    state.activeStartedAt = null;
  }
  delete state.durations[step];
  state.skipped.add(step);
}

function finishAutocorrectCoverProgress(
  state: CatalogAutocorrectProgressState,
  result: CatalogImportedImageMediaResult,
): void {
  if (result.status === 'already-exists' || result.status === 'no-image-url') {
    skipAutocorrectProgressStep(state, 'coverDownload');
    skipAutocorrectProgressStep(state, 'coverUpload');
    return;
  }
  if (state.activeStep === 'coverDownload') {
    finishAutocorrectProgressStep(state);
    skipAutocorrectProgressStep(state, 'coverUpload');
    return;
  }
  if (state.activeStep === 'coverUpload') {
    finishAutocorrectProgressStep(state);
  }
}

function formatAutocorrectProgressLine(
  texts: ReturnType<typeof createTelegramI18n>['catalogAdmin'],
  state: CatalogAutocorrectProgressState,
  step: CatalogAutocorrectProgressStep,
): string {
  const label = resolveAutocorrectProgressStepLabel(texts, step);
  const status = resolveAutocorrectProgressStepStatus(state, step);
  const duration = state.durations[step];
  if (status === 'done') {
    return `✅ ${label} (${formatAutocorrectDuration(duration ?? 0)})`;
  }
  if (status === 'active') {
    return `⏳ ${label}`;
  }
  if (status === 'skipped') {
    return `⏭️ ${label} (${texts.autocorrectProgressSkipped})`;
  }
  return `⬜ ${label}`;
}

function resolveAutocorrectProgressStepStatus(
  state: CatalogAutocorrectProgressState,
  step: CatalogAutocorrectProgressStep,
): CatalogAutocorrectProgressStatus {
  if (state.skipped.has(step)) {
    return 'skipped';
  }
  if (state.activeStep === step) {
    return 'active';
  }
  if (typeof state.durations[step] === 'number') {
    return 'done';
  }
  return 'pending';
}

function resolveAutocorrectProgressStepLabel(
  texts: ReturnType<typeof createTelegramI18n>['catalogAdmin'],
  step: CatalogAutocorrectProgressStep,
): string {
  switch (step) {
    case 'api':
      return texts.autocorrectProgressApi;
    case 'translation':
      return texts.autocorrectProgressTranslation;
    case 'saving':
      return texts.autocorrectProgressSaving;
    case 'coverDownload':
      return texts.autocorrectProgressCoverDownload;
    case 'coverUpload':
      return texts.autocorrectProgressCoverUpload;
    case 'detail':
      return texts.autocorrectProgressDetail;
  }
}

function formatAutocorrectDuration(milliseconds: number): string {
  return `${Math.max(0, Math.round(milliseconds))} ms`;
}

function mapExternalImageProgressStep(step: CatalogMediaExternalImageProgressStep): CatalogAutocorrectProgressStep {
  return step === 'download' ? 'coverDownload' : 'coverUpload';
}

async function startEditableProgress(
  context: TelegramCatalogAdminContext,
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
        event: 'catalog.autocorrect.progress-edit.failed',
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

function canAccessCatalog(context: TelegramCatalogAdminContext): boolean {
  return context.runtime.actor.isApproved && !context.runtime.actor.isBlocked;
}

function canAdministerCatalog(context: TelegramCatalogAdminContext): boolean {
  return context.runtime.actor.isAdmin;
}

function isCatalogAdminSession(flowKey: string | undefined): boolean {
  return flowKey === createFlowKey
    || flowKey === bulkCreateFlowKey
    || flowKey === editFlowKey
    || flowKey === deactivateFlowKey
    || flowKey === mediaFlowKey
    || flowKey === mediaDeleteFlowKey
    || flowKey === browseFlowKey
    || flowKey === bggCollectionImportFlowKey;
}

async function handleActiveCatalogSession(context: TelegramCatalogAdminContext, text: string): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session) {
    return false;
  }
  if (isCatalogAdminOnlySession(session.flowKey) && !canAdministerCatalog(context)) {
    await context.runtime.session.cancel();
    await replyAdminOnly(context);
    return true;
  }
  if (session.flowKey === createFlowKey) {
    return handleCreateSession(context, text, session.stepKey, session.data);
  }
  if (session.flowKey === bulkCreateFlowKey) {
    return handleBulkCreateSession(context, text, session.stepKey, session.data);
  }
  if (session.flowKey === editFlowKey) {
    return handleEditSession(context, text, session.stepKey, session.data);
  }
  if (session.flowKey === deactivateFlowKey) {
    return handleDeactivateSession(context, text, session.data);
  }
  if (session.flowKey === mediaFlowKey) {
    return handleCatalogAdminMediaSession({
      session: context.runtime.session,
      reply: context.reply,
      language: normalizeBotLanguage(context.runtime.bot.language, 'ca'),
      text,
      stepKey: session.stepKey,
      data: session.data,
      repository: resolveCatalogRepository(context),
      auditRepository: resolveAuditRepository(context),
      actorTelegramUserId: context.runtime.actor.telegramUserId,
      menuLanguage: normalizeBotLanguage(context.runtime.bot.language, 'ca'),
      confirmMediaCreateLabel: catalogAdminLabels.confirmMediaCreate,
      confirmMediaEditLabel: catalogAdminLabels.confirmMediaEdit,
      messageMedia: toCatalogMediaAttachment(context),
      storeAttachment: (attachment) => storeCatalogAttachmentMedia(context, attachment),
      storeExternalImage: (url) => storeCatalogExternalImageMedia(context, url),
    });
  }
  if (session.flowKey === mediaDeleteFlowKey) {
    return handleCatalogAdminMediaDeleteSession({
      session: context.runtime.session,
      reply: context.reply,
      language: normalizeBotLanguage(context.runtime.bot.language, 'ca'),
      text,
      data: session.data,
      repository: resolveCatalogRepository(context),
      auditRepository: resolveAuditRepository(context),
      actorTelegramUserId: context.runtime.actor.telegramUserId,
      menuLanguage: normalizeBotLanguage(context.runtime.bot.language, 'ca'),
      confirmMediaDeleteLabel: catalogAdminLabels.confirmMediaDelete,
    });
  }
  if (session.flowKey === browseFlowKey) {
    return handleBrowseSession(context, text, session.stepKey, session.data);
  }
  if (session.flowKey === bggCollectionImportFlowKey) {
    return handleBggCollectionImportSession(context, text, session.stepKey);
  }
  return false;
}

function isCatalogAdminOnlySession(flowKey: string): boolean {
  return flowKey === editFlowKey || flowKey === deactivateFlowKey || flowKey === mediaFlowKey || flowKey === mediaDeleteFlowKey || flowKey === bggCollectionImportFlowKey;
}

async function handleBulkCreateSession(
  context: TelegramCatalogAdminContext,
  text: string,
  stepKey: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).catalogAdmin;

  if (text === texts.bulkCreateManualButton || text === catalogAdminLabels.bulkCreateManualButton) {
    return handleBulkManualCreateText(context);
  }

  if (text === texts.bulkCreateComplete || text === catalogAdminLabels.bulkCreateComplete) {
    await context.runtime.session.cancel();
    await context.reply(texts.bulkCreateCompleted, buildCatalogAdminMenuOptions(language));
    return true;
  }

  if (stepKey === 'bulk-item-type') {
    const itemType = parseItemTypeLabel(text, language);
    if (itemType instanceof Error) {
      await context.reply(texts.invalidType, buildTypeOptions(language));
      return true;
    }
    await context.runtime.session.advance({
      stepKey: 'bulk-item-names',
      data: { ...data, itemType },
    });
    await context.reply(texts.askBulkNames, buildSingleCancelKeyboard(language));
    return true;
  }

  if (stepKey === 'bulk-item-names') {
    const itemType = String(data.itemType) as CatalogItemType;
    const parsedItemNames = parseCommaSeparatedItemNames(text);
    const itemNames = parsedItemNames.slice(0, bulkCreateItemLimit);
    if (itemNames.length === 0) {
      await context.reply(texts.askBulkNames, buildSingleCancelKeyboard(language));
      return true;
    }

    const skippedInputCount = parsedItemNames.length - itemNames.length;
    await context.runtime.session.cancel();
    await context.reply(texts.bulkCreateAcknowledged);
    void runCatalogBulkCreateJob({
      context,
      actorTelegramUserId: context.runtime.actor.telegramUserId,
      language,
      itemType,
      itemNames,
      skippedInputCount,
    });
    return true;
  }

  return false;
}

async function runCatalogBulkCreateJob({
  context,
  actorTelegramUserId,
  language,
  itemType,
  itemNames,
  skippedInputCount,
}: {
  context: TelegramCatalogAdminContext;
  actorTelegramUserId: number;
  language: 'ca' | 'es' | 'en';
  itemType: CatalogItemType;
  itemNames: string[];
  skippedInputCount: number;
}): Promise<void> {
  const texts = createTelegramI18n(language).catalogAdmin;
  const summaryItems: BulkCreateSummaryItem[] = [];

  for (let index = 0; index < itemNames.length; index += 1) {
    const input = itemNames[index];
    if (!input) {
      continue;
    }

    try {
      summaryItems.push(await resolveCatalogBulkCreateItem(context, itemType, input));
    } catch (error) {
      summaryItems.push({
        input,
        status: 'error',
        reason: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    if (index < itemNames.length - 1) {
      await sleepMs(bulkCreateRateLimitMs);
    }
  }

  const summaryMessage = formatCatalogBulkCreateSummary({
    itemType,
    summaryItems,
    skippedInputCount,
    language,
  });
  const hasManualItems = getBulkManualSummaryItems(summaryItems).length > 0;

  if (hasManualItems) {
    await context.runtime.session.start({
      flowKey: bulkCreateFlowKey,
      stepKey: 'bulk-manual-choice',
      data: { itemType },
    });
  }

  const summaryOptions = buildBulkCreateSummaryOptions(language, hasManualItems);

  try {
    await context.runtime.bot.sendPrivateMessage(actorTelegramUserId, summaryMessage, summaryOptions);
  } catch {
    await context.reply(`${texts.bulkCreateSummaryPrivateFailure}\n\n${summaryMessage}`, summaryOptions);
  }
}

async function handleBulkManualCreateText(context: TelegramCatalogAdminContext): Promise<boolean> {
  const session = context.runtime.session.current;
  if (session?.flowKey !== bulkCreateFlowKey) {
    return false;
  }

  const itemType = String(session.data.itemType) as CatalogItemType;
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).catalogAdmin;

  await context.runtime.session.start({
    flowKey: createFlowKey,
    stepKey: 'display-name',
    data: { itemType },
  });
  await context.reply(texts.askDisplayName, buildSingleCancelKeyboard(language));
  return true;
}

async function resolveCatalogBulkCreateItem(
  context: TelegramCatalogAdminContext,
  itemType: CatalogItemType,
  input: string,
): Promise<BulkCreateSummaryItem> {
  const normalizedInput = normalizeCatalogMatchText(input);
  const repository = resolveCatalogRepository(context);
  const existingMatch = (await repository.listItems({ includeDeactivated: false }))
    .find((candidate) => candidate.itemType === itemType && normalizeCatalogMatchText(candidate.displayName) === normalizedInput);
  if (existingMatch) {
    return {
      input,
      status: 'alreadyExists',
      title: existingMatch.displayName,
      itemId: existingMatch.id,
    };
  }

  if (itemType === 'book' || itemType === 'rpg-book') {
    const lookupResult = await resolveCatalogLookupService(context).search({
      itemType,
      query: input,
    }).catch(() => [] as CatalogLookupCandidate[]);

    if (lookupResult.length === 1) {
      const candidate = lookupResult[0];
      if (!candidate) {
        throw new Error('No valid lookup candidate found');
      }

      const created = await createCatalogItem({
        repository,
        familyId: null,
        groupId: null,
        itemType,
        displayName: candidate.title,
        originalName: candidate.importedData.originalName,
        description: candidate.summary,
        language: candidate.importedData.language,
        publisher: candidate.importedData.publisher,
        publicationYear: candidate.importedData.publicationYear,
        playerCountMin: null,
        playerCountMax: null,
        recommendedAge: null,
        playTimeMinutes: null,
        externalRefs: candidate.importedData.externalRefs,
        metadata: candidate.importedData.metadata,
      });

      await appendAuditEvent({
        repository: resolveAuditRepository(context),
        actorTelegramUserId: context.runtime.actor.telegramUserId,
        actionKey: 'catalog.item.created',
        targetType: 'catalog-item',
        targetId: created.id,
        summary: `Item de cataleg importat: ${created.displayName}`,
        details: { itemType: created.itemType, familyId: created.familyId, groupId: created.groupId, lifecycleStatus: created.lifecycleStatus },
      });
      await tryCreateImportedImageMedia(context, created, candidate.importedData);

      return {
        input,
        status: 'added',
        title: created.displayName,
        itemId: created.id,
      };
    }

    if (lookupResult.length > 1) {
      return {
        input,
        status: 'ambiguous',
        candidates: lookupResult.map((candidate) => candidate.title),
      };
    }

    return {
      input,
      status: 'noMatch',
    };
  }

  if (itemType === 'board-game') {
    const result = await importWikipediaBoardGameDraft(context, input);
    if (!result.ok) {
      if (result.error.type === 'ambiguous') {
        return {
          input,
          status: 'ambiguous',
          candidates: result.error.candidates ?? [],
        };
      }

      if (result.error.type === 'not-found') {
        return {
          input,
          status: 'noMatch',
        };
      }

      return {
        input,
        status: 'error',
        reason: result.error.message,
      };
    }

    const draft = result.draft;
    const created = await createCatalogItem({
      repository,
      familyId: draft.familyId,
      groupId: draft.groupId,
      itemType: draft.itemType,
      displayName: draft.displayName || input,
      originalName: draft.originalName,
      description: draft.description,
      language: draft.language,
      publisher: draft.publisher,
      publicationYear: draft.publicationYear,
      playerCountMin: draft.playerCountMin,
      playerCountMax: draft.playerCountMax,
      recommendedAge: draft.recommendedAge,
      playTimeMinutes: draft.playTimeMinutes,
      externalRefs: draft.externalRefs,
      metadata: draft.metadata,
    });

    await appendAuditEvent({
      repository: resolveAuditRepository(context),
      actorTelegramUserId: context.runtime.actor.telegramUserId,
      actionKey: 'catalog.item.created',
      targetType: 'catalog-item',
      targetId: created.id,
      summary: `Item de cataleg importat: ${created.displayName}`,
      details: { itemType: created.itemType, familyId: created.familyId, groupId: created.groupId, lifecycleStatus: created.lifecycleStatus },
    });
    await tryCreateImportedImageMedia(context, created, draft);

    return {
      input,
      status: 'added',
      title: created.displayName,
      itemId: created.id,
    };
  }

  return {
    input,
    status: 'noMatch',
  };
}

function formatCatalogBulkCreateSummary({
  itemType,
  summaryItems,
  skippedInputCount,
  language,
}: {
  itemType: CatalogItemType;
  summaryItems: BulkCreateSummaryItem[];
  skippedInputCount: number;
  language: 'ca' | 'es' | 'en';
}): string {
  const texts = createTelegramI18n(language).catalogAdmin;
  const labels = {
    itemType,
    added: summaryItems.filter((entry) => entry.status === 'added'),
    alreadyExists: summaryItems.filter((entry) => entry.status === 'alreadyExists'),
    noMatch: summaryItems.filter((entry) => entry.status === 'noMatch'),
    ambiguous: summaryItems.filter((entry) => entry.status === 'ambiguous'),
    error: summaryItems.filter((entry) => entry.status === 'error'),
  };
  const manualItems = getBulkManualSummaryItems(summaryItems);
  const totalInputCount = summaryItems.length + skippedInputCount;

  const sections: string[] = [
    `<b>${texts.bulkCreateSummaryHeader}</b>`,
    texts.bulkCreateSummaryType.replace('{type}', escapeHtml(catalogItemTypeLabel(itemType, texts))),
    texts.bulkCreateSummaryProcessed.replace('{count}', String(totalInputCount)),
  ];

  if (labels.added.length > 0) {
    sections.push('', `<b>${texts.bulkCreateSummaryAdded} (${labels.added.length})</b>`);
    sections.push(...labels.added.map((item) => `- ${escapeHtml(item.title ?? item.input)}`));
  }

  if (labels.alreadyExists.length > 0) {
    sections.push('', `<b>${texts.bulkCreateSummaryAlreadyExists} (${labels.alreadyExists.length})</b>`);
    sections.push(...labels.alreadyExists.map((item) => `- ${escapeHtml(item.title ?? item.input)}`));
  }

  if (manualItems.length > 0) {
    sections.push('', `<b>${texts.bulkCreateSummaryManualReview} (${manualItems.length})</b>`);
    sections.push(texts.bulkCreateSummaryManualHint);
    sections.push(...labels.noMatch.map((item) => `${formatBulkManualSummaryLine(item)} · ${texts.bulkCreateSummaryNoMatch}`));
    sections.push(...labels.ambiguous.flatMap((item) => formatBulkAmbiguousSummaryLines(item, texts)));
    sections.push(...labels.error.map((item) => `${formatBulkManualSummaryLine(item)} · ${texts.bulkCreateSummaryError}: ${escapeHtml(item.reason ?? 'error')}`));
  }

  if (skippedInputCount > 0) {
    sections.push('');
    sections.push(`- ${texts.bulkCreateSummarySkipped}`.replace('{count}', String(skippedInputCount)));
  }

  sections.push('', manualItems.length > 0 ? texts.bulkCreateSummaryManualFallback : texts.bulkCreateSummaryAllDone);

  return sections.join('\n');
}

function formatBulkManualSummaryLine(item: BulkCreateSummaryItem): string {
  return `- <code>${escapeHtml(item.input)}</code>`;
}

function formatBulkAmbiguousSummaryLines(
  item: BulkCreateSummaryItem,
  texts: ReturnType<typeof createTelegramI18n>['catalogAdmin'],
): string[] {
  const lines = [`${formatBulkManualSummaryLine(item)} · ${texts.bulkCreateSummaryAmbiguous}`];
  const candidates = item.candidates?.slice(0, 3) ?? [];
  if (candidates.length > 0) {
    lines.push(`  ${texts.bulkCreateSummaryCandidateIntro}`);
    lines.push(...candidates.map((candidate, index) => `  ${index + 1}. ${escapeHtml(candidate)}`));
  }
  const hiddenCandidateCount = Math.max(0, (item.candidates?.length ?? 0) - candidates.length);
  if (hiddenCandidateCount > 0) {
    lines.push(`  ${texts.bulkCreateSummaryMoreCandidates.replace('{count}', String(hiddenCandidateCount))}`);
  }
  return lines;
}

function getBulkManualSummaryItems(summaryItems: BulkCreateSummaryItem[]): BulkCreateSummaryItem[] {
  return [
    ...summaryItems.filter((entry) => entry.status === 'noMatch'),
    ...summaryItems.filter((entry) => entry.status === 'ambiguous'),
    ...summaryItems.filter((entry) => entry.status === 'error'),
  ];
}

function buildBulkCreateSummaryOptions(language: 'ca' | 'es' | 'en', hasManualItems: boolean): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return {
    parseMode: 'HTML',
    replyKeyboard: [
      ...(hasManualItems ? [[{ text: texts.bulkCreateManualButton, semanticRole: 'primary' as const }]] : []),
      [{ text: texts.bulkCreateComplete, semanticRole: 'success' }],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function catalogItemTypeLabel(
  itemType: CatalogItemType,
  texts: ReturnType<typeof createTelegramI18n>['catalogAdmin'],
): string {
  if (itemType === 'board-game') {
    return texts.typeBoardGame;
  }
  if (itemType === 'book') {
    return texts.typeBook;
  }
  if (itemType === 'rpg-book') {
    return texts.typeRpgBook;
  }
  return texts.typeAccessory;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function replyAdminOnly(context: TelegramCatalogAdminContext): Promise<void> {
  await context.reply(createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca')).common.accessDeniedAdmin);
}

async function handleCreateSession(
  context: TelegramCatalogAdminContext,
  text: string,
  stepKey: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  return handleCatalogAdminCreateSession({
    session: context.runtime.session,
    reply: context.reply,
    language,
    text,
    stepKey,
    data,
    labels: {
      confirmCreate: catalogAdminLabels.confirmCreate,
      editFieldDisplayName: catalogAdminLabels.editFieldDisplayName,
      editFieldItemType: catalogAdminLabels.editFieldItemType,
      editFieldFamily: catalogAdminLabels.editFieldFamily,
      editFieldGroup: catalogAdminLabels.editFieldGroup,
      editFieldOriginalName: catalogAdminLabels.editFieldOriginalName,
      editFieldDescription: catalogAdminLabels.editFieldDescription,
      editFieldLanguage: catalogAdminLabels.editFieldLanguage,
      editFieldPublisher: catalogAdminLabels.editFieldPublisher,
      editFieldPublicationYear: catalogAdminLabels.editFieldPublicationYear,
      editFieldPlayerMin: catalogAdminLabels.editFieldPlayerMin,
      editFieldPlayerMax: catalogAdminLabels.editFieldPlayerMax,
      editFieldRecommendedAge: catalogAdminLabels.editFieldRecommendedAge,
      editFieldPlayTimeMinutes: catalogAdminLabels.editFieldPlayTimeMinutes,
      editFieldExternalRefs: catalogAdminLabels.editFieldExternalRefs,
      editFieldMetadata: catalogAdminLabels.editFieldMetadata,
    },
    parseItemTypeLabel,
    buildCreateFieldMenuOptions: (itemType) => buildCreateFieldMenuOptions(itemType, language),
    buildEditFieldMenuOptions: (itemType) => buildEditFieldMenuOptions(itemType, language),
    buildFamilyPrompt: (itemType) => buildFamilyPrompt(context, itemType),
    buildFamilyOptions: (itemType) => buildFamilyOptions(context, itemType, language),
    buildGroupPrompt: (familyId) => buildGroupPrompt(context, familyId),
    updateCreateDraftAndReturn: (currentData, patch) => updateCreateDraftAndReturn(context, currentData, patch, language),
    saveCreateDraftAndReturn: (currentData) => saveCreateDraftAndReturn(context, currentData, language),
    parseFamilyInput: (inputText, itemType) => parseFamilyInput(context, inputText, itemType),
    parseGroupInput: (inputText, familyId) => parseGroupInput(context, inputText, familyId),
    searchCatalogLookupCandidates: (input) => searchCatalogLookupCandidates(context, input),
    importWikipediaBoardGameDraft: (title) => importWikipediaBoardGameDraft(context, title),
    createWikipediaImportedBoardGame: (baseData, draft, sourceTitle) => createWikipediaImportedBoardGame(context, baseData, draft, sourceTitle),
    detectDisplayNameFromAttachment: () => detectDisplayNameFromAttachment(context),
    importWikipediaErrorMessage,
    formatDraftSummary: (draftData) => formatDraftSummary(context, draftData),
  });
}

async function detectDisplayNameFromAttachment(context: TelegramCatalogAdminContext): Promise<string | { displayName: string; coverAttachment?: Record<string, unknown> } | Error | null> {
  const media = context.messageMedia;
  if (!media) {
    return null;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).catalogAdmin;

  if (!media.fileId) {
    return new Error(texts.coverTitleMissingFile);
  }
  if (media.attachmentKind !== 'photo' && !media.mimeType?.startsWith('image/')) {
    return new Error(texts.coverTitleUnsupportedAttachment);
  }
  if (!context.runtime.bot.downloadFile) {
    return new Error(texts.coverTitleUnavailable);
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'gameclub-cover-'));
  const imagePath = join(tempDir, `cover${extensionForMedia(media)}`);
  const debugDir = process.env.GAMECLUB_COVER_DEBUG_DIR?.trim() || join(tmpdir(), 'gameclub-cover-debug');
  const shouldKeepDebugFile = true;
  const effectiveImagePath = shouldKeepDebugFile
    ? join(debugDir!, `cover-${Date.now()}${extensionForMedia(media)}`)
    : imagePath;

  try {
    await mkdir(debugDir, { recursive: true });
    await context.runtime.bot.downloadFile({ fileId: media.fileId, destinationPath: effectiveImagePath });
    const downloaded = await stat(effectiveImagePath);
    console.info(JSON.stringify({
      event: 'catalog.cover-title.downloaded',
      attachmentKind: media.attachmentKind,
      mimeType: media.mimeType ?? null,
      originalFileName: media.originalFileName ?? null,
      fileSizeBytes: downloaded.size,
      imagePath: effectiveImagePath,
      debugFileKept: shouldKeepDebugFile,
    }));
    console.info(JSON.stringify({
      event: 'catalog.cover-title.opencode-command',
      command: catalogOpencodeBin,
      args: buildOpencodeRunArgs({
        imagePath: effectiveImagePath,
        question: texts.coverTitleQuestion,
        model: catalogCoverTitleModel,
      }),
    }));
    const resolver = context.coverTitleResolver ?? ((input) => runOpencodeImageQueryCapture({
      imagePath: input.imagePath,
      question: input.question,
      model: input.model,
      opencodeBin: catalogOpencodeBin,
    }));
    const detected = await resolver({
      imagePath: effectiveImagePath,
      question: texts.coverTitleQuestion,
      model: catalogCoverTitleModel,
    });
    const normalized = normalizeDetectedCoverTitle(detected);
    console.info(JSON.stringify({
      event: 'catalog.cover-title.detected',
      model: catalogCoverTitleModel,
      rawPreview: detected.slice(0, 500),
      normalized,
    }));
    return normalized ? { displayName: normalized, ...(toCatalogMediaAttachment(context) ? { coverAttachment: toCatalogMediaAttachment(context) as unknown as Record<string, unknown> } : {}) } : new Error(texts.coverTitleNoResult);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'catalog.cover-title.failed',
      error: error instanceof Error ? error.message : String(error),
    }));
    return new Error(error instanceof Error ? error.message : texts.coverTitleNoResult);
  } finally {
    if (!shouldKeepDebugFile) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

function extensionForMedia(media: NonNullable<TelegramCatalogAdminContext['messageMedia']>): string {
  if (media.attachmentKind === 'photo') {
    return '.jpg';
  }

  const original = media.originalFileName?.trim();
  const match = original?.match(/\.[A-Za-z0-9]{1,8}$/);
  if (match) {
    return match[0].toLowerCase();
  }

  if (media.mimeType === 'image/png') {
    return '.png';
  }
  if (media.mimeType === 'image/webp') {
    return '.webp';
  }
  if (media.mimeType === 'image/gif') {
    return '.gif';
  }
  return '.jpg';
}

function normalizeDetectedCoverTitle(value: string): string {
  if (/ProviderModelNotFoundError|Model not found|Error:/i.test(value)) {
    return '';
  }

  const cleanedLines = value
    .replace(/\u001b\[[0-9;]*m/g, '')
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('>') && !/^sqlite-migration:/i.test(line) && !/^database migration/i.test(line));

  const candidate = cleanedLines.at(-1) ?? '';
  return candidate
    .replace(/^nombre(?: completo)?\s*:\s*/i, '')
    .replace(/^t[ií]tulo\s*:\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
}

async function handleEditSession(
  context: TelegramCatalogAdminContext,
  text: string,
  stepKey: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const itemId = Number(data.itemId);
  const item = await loadItemOrThrow(context, itemId);
  return handleCatalogAdminEditSession({
    session: context.runtime.session,
    reply: context.reply,
    language,
    text,
    stepKey,
    data,
    item,
    labels: {
      confirmEdit: catalogAdminLabels.confirmEdit,
      editFieldDisplayName: catalogAdminLabels.editFieldDisplayName,
      editFieldItemType: catalogAdminLabels.editFieldItemType,
      editFieldFamily: catalogAdminLabels.editFieldFamily,
      editFieldGroup: catalogAdminLabels.editFieldGroup,
      editFieldOriginalName: catalogAdminLabels.editFieldOriginalName,
      editFieldDescription: catalogAdminLabels.editFieldDescription,
      editFieldLanguage: catalogAdminLabels.editFieldLanguage,
      editFieldPublisher: catalogAdminLabels.editFieldPublisher,
      editFieldPublicationYear: catalogAdminLabels.editFieldPublicationYear,
      editFieldPlayerMin: catalogAdminLabels.editFieldPlayerMin,
      editFieldPlayerMax: catalogAdminLabels.editFieldPlayerMax,
      editFieldRecommendedAge: catalogAdminLabels.editFieldRecommendedAge,
      editFieldPlayTimeMinutes: catalogAdminLabels.editFieldPlayTimeMinutes,
      editFieldExternalRefs: catalogAdminLabels.editFieldExternalRefs,
      editFieldMetadata: catalogAdminLabels.editFieldMetadata,
    },
    getDraftItemType,
    getDraftFamilyId,
    buildEditFieldMenuOptions: (itemType) => buildEditFieldMenuOptions(itemType, language),
    buildFamilyPrompt: (itemType) => buildFamilyPrompt(context, itemType),
    buildFamilyOptions: (itemType) => buildFamilyOptions(context, itemType, language),
    buildGroupPrompt: (familyId) => buildGroupPrompt(context, familyId),
    parseItemTypeLabel,
    parseFamilyInput: (inputText, itemType) => parseFamilyInput(context, inputText, itemType),
    parseGroupInput: (inputText, familyId) => parseGroupInput(context, inputText, familyId),
    withCompatibleGroup: (nextData, familyId) => withCompatibleGroup(context, item, { ...nextData, familyId }, familyId),
    updateEditDraftAndReturn: (currentItem, currentData, patch) => updateEditDraftAndReturn(context, currentItem, currentData, patch),
    saveEditDraftAndReturn: (currentItem, currentData) => saveEditDraftAndReturn(context, currentItem, currentData),
  });
}

async function handleDeactivateSession(
  context: TelegramCatalogAdminContext,
  text: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).catalogAdmin;
  if (text !== texts.confirmDeactivate && text !== catalogAdminLabels.confirmDeactivate) {
    await context.reply(texts.confirmDeactivatePrompt, buildDeactivateConfirmOptions(language));
    return true;
  }
  const item = await deactivateCatalogItem({ repository: resolveCatalogRepository(context), itemId: Number(data.itemId) });
  await appendAuditEvent({
    repository: resolveAuditRepository(context),
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    actionKey: 'catalog.item.deactivated',
    targetType: 'catalog-item',
    targetId: item.id,
    summary: `Item de cataleg desactivat: ${item.displayName}`,
    details: { displayName: item.displayName, lifecycleStatus: item.lifecycleStatus, deactivatedAt: item.deactivatedAt },
  });
  await context.runtime.session.cancel();
    await context.reply(`${texts.deactivated}: ${item.displayName} (#${item.id}).`, buildCatalogAdminMenuOptions(normalizeBotLanguage(context.runtime.bot.language, 'ca')));
  return true;
}

async function buildFamilyOptions(
  context: TelegramCatalogAdminContext,
  itemType: CatalogItemType,
  language: 'ca' | 'es' | 'en' = 'ca',
): Promise<TelegramReplyOptions> {
  return buildCatalogAdminFamilyOptions({
    repository: resolveCatalogRepository(context),
    itemType,
    language,
  });
}

function getDraftItemTypeFromData(data: Record<string, unknown>): CatalogItemType {
  return String(data.itemType ?? 'board-game') as CatalogItemType;
}

function buildEditFieldMenuOptions(itemType: CatalogItemType, language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  return buildCatalogEditFieldMenuOptions({ itemType, itemTypeSupportsPlayers, language });
}

function buildCreateFieldMenuOptions(itemType: CatalogItemType, language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  return buildCatalogCreateFieldMenuOptions({ itemType, itemTypeSupportsPlayers, language });
}

async function showCatalogBrowseMenu(context: TelegramCatalogAdminContext): Promise<void> {
  await replyWithCatalogList(context, 'list');
}

async function showCatalogFamilyBrowse(context: TelegramCatalogAdminContext, familyId: number): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).catalogAdmin;
  const repository = resolveCatalogRepository(context);
  const family = await repository.findFamilyById(familyId);
  if (!family) {
    throw new Error(`Catalog family ${familyId} not found`);
  }

  const groups = await repository.listGroups({ familyId });
  const items = await repository.listItems({ familyId, includeDeactivated: true });
  const loanRepository = resolveCatalogLoanRepository(context);
  const activeLoans = await loadActiveLoansByItemMap(loanRepository, items);
  const looseItems = items.filter((item) => item.groupId === null);
  const groupSections = await Promise.all(groups.map(async (group) => ({
    group,
    itemLines: await Promise.all(items
      .filter((item) => item.groupId === group.id)
      .map((item) => formatCatalogListItemLine(context, item, activeLoans.get(item.id) ?? null))),
  })));
  const looseItemLines = await Promise.all(looseItems.map((item) => formatCatalogListItemLine(context, item, activeLoans.get(item.id) ?? null)));
  const itemRows = await Promise.all(items.map(async (item) => {
    const loan = await loadActiveLoanByItemIdAdmin(context, item.id);
    return buildLoanItemButton(loan, item.id, item.displayName, catalogAdminCallbackPrefixes.inspect, language, loan ? canReturnLoan(context, loan) : true);
  }));
  await context.reply(formatCatalogAdminFamilyBrowseMessage({
    family,
    texts,
    groupSections,
    looseItemLines,
  }), {
    parseMode: 'HTML',
    inlineKeyboard: buildCatalogAdminBrowseFamilyKeyboard({
      itemRows,
      texts,
      browseSearchCallbackData: catalogAdminCallbackPrefixes.browseSearch,
      browseMenuCallbackData: catalogAdminCallbackPrefixes.browseMenu,
    }),
  });
}

async function showCatalogLettersBrowse(context: TelegramCatalogAdminContext, initials: string): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).catalogAdmin;
  const normalizedInitials = normalizeCatalogInitials(initials);
  const initialSet = new Set(normalizedInitials.split(''));
  const repository = resolveCatalogRepository(context);
  const items = (await listCatalogItems({ repository, includeDeactivated: false }))
    .filter((item) => item.itemType !== 'expansion')
    .filter((item) => initialSet.has(getCatalogAdminItemInitial(item)));

  if (items.length === 0) {
    await context.reply(`No he trobat cap item per a ${normalizedInitials}.`, {
      inlineKeyboard: [[{ text: texts.browseBack, callbackData: catalogAdminCallbackPrefixes.browseMenu }]],
    });
    return;
  }

  const loanRepository = resolveCatalogLoanRepository(context);
  const activeLoans = await loadActiveLoansByItemMap(loanRepository, items);
  const sortedItems = items
    .slice()
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
  const itemLines = await Promise.all(sortedItems
    .map((item) => formatCatalogListItemLine(context, item, activeLoans.get(item.id) ?? null)));

  await context.reply([`<b>${formatCatalogInitialsLabel(normalizedInitials)}</b>`, ...itemLines].join('\n'), {
    parseMode: 'HTML',
  });
}

function normalizeCatalogInitials(value: string): string {
  return Array.from(new Set(value.trim().toUpperCase().replace(/[^A-Z#]/g, '').split(''))).join('');
}

function getCatalogAdminItemInitial(item: CatalogItemRecord): string {
  const first = item.displayName.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').at(0)?.toUpperCase() ?? '#';
  return /^[A-Z]$/.test(first) ? first : '#';
}

function formatCatalogInitialsLabel(initials: string): string {
  return initials.split('').join(' ');
}

async function handleBrowseSession(context: TelegramCatalogAdminContext, text: string, stepKey: string, data: Record<string, unknown>): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).catalogAdmin;
  if (stepKey === 'detail') {
    return handleCatalogAdminDetailKeyboardText(context, text, data, language);
  }
  if (stepKey !== 'search-query') {
    return false;
  }

  const query = text.trim();
  if (!query) {
    await context.reply(texts.invalidSearchName, buildSingleCancelKeyboard());
    return true;
  }

  const repository = resolveCatalogRepository(context);
  const items = await repository.listItems({ includeDeactivated: false });
  const groups = await repository.listGroups({});
  const families = await repository.listFamilies();
  const matches = searchCatalogItemsByName({ items, groups, families, query });
  const loanRepository = resolveCatalogLoanRepository(context);

  await context.runtime.session.cancel();

  if (matches.length === 0) {
    await context.reply(`No he trobat cap coincidencia per a "${query}".`, {
      inlineKeyboard: [[{ text: texts.browseBack, callbackData: catalogAdminCallbackPrefixes.browseMenu }]],
    });
    return true;
  }

  const activeLoans = await loadActiveLoansByItemMap(loanRepository, matches);
  const itemLines = await Promise.all(matches.map((item) => formatCatalogListItemLine(context, item, activeLoans.get(item.id) ?? null)));
  const itemRows = await Promise.all(matches.map(async (item) => {
    const loan = await loadActiveLoanByItemIdAdmin(context, item.id);
    return buildLoanItemButton(loan, item.id, item.displayName, catalogAdminCallbackPrefixes.inspect, language, loan ? canReturnLoan(context, loan) : true);
  }));

  await context.reply(formatCatalogAdminSearchResultsMessage(query, itemLines), {
    parseMode: 'HTML',
    inlineKeyboard: buildCatalogAdminBrowseSearchKeyboard({
      itemRows,
      browseBackText: texts.browseBack,
      browseMenuCallbackData: catalogAdminCallbackPrefixes.browseMenu,
    }),
  });
  return true;
}

async function handleCatalogAdminDetailKeyboardText(
  context: TelegramCatalogAdminContext,
  text: string,
  data: Record<string, unknown>,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const itemId = asNullableNumber(data.itemId);
  if (itemId === null) {
    await context.runtime.session.cancel();
    return false;
  }
  const item = await loadItemOrThrow(context, itemId);
  const buttons = (await buildCatalogItemDetailButtons(context, item, language)).flat();
  const action = buttons.find((button) => button.text === text);
  if (!action?.callbackData) {
    return false;
  }
  const previousCallbackData = context.callbackData;
  context.callbackData = action.callbackData;
  if (action.callbackData.startsWith(catalogLoanCallbackPrefixes.create)
    || action.callbackData.startsWith(catalogLoanCallbackPrefixes.return)
    || action.callbackData === catalogLoanCallbackPrefixes.openMyLoans) {
    try {
      await handleTelegramCatalogLoanCallback(context as TelegramCatalogLoanContext);
      return true;
    } finally {
      if (previousCallbackData === undefined) {
        delete context.callbackData;
      } else {
        context.callbackData = previousCallbackData;
      }
    }
  }
  try {
    await handleTelegramCatalogAdminCallback(context);
    return true;
  } finally {
    if (previousCallbackData === undefined) {
      delete context.callbackData;
    } else {
      context.callbackData = previousCallbackData;
    }
  }
}

async function replyWithCatalogList(
  context: TelegramCatalogAdminContext,
  mode: 'list' | 'edit' | 'deactivate',
  itemTypeFilter?: CatalogItemType,
): Promise<void> {
  const texts = createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca')).catalogAdmin;
  const items = (await listCatalogItems({ repository: resolveCatalogRepository(context), includeDeactivated: false }))
    .filter((item) => itemTypeFilter ? item.itemType === itemTypeFilter : item.itemType !== 'expansion');
  if (items.length === 0) {
    await context.reply(texts.noItems, buildCatalogAdminMenuOptions(normalizeBotLanguage(context.runtime.bot.language, 'ca')));
    return;
  }
  const inlineKeyboard = buildCatalogAdminSelectionKeyboard({
    items,
    mode,
    inspectKeyboard: [],
    editPrefix: catalogAdminCallbackPrefixes.edit,
    deactivatePrefix: catalogAdminCallbackPrefixes.deactivate,
  });
  await context.reply(
    mode === 'list' ? await formatCatalogItemList(context, items, itemTypeFilter !== undefined) : mode === 'edit' ? texts.chooseItemToEdit : texts.chooseItemToDeactivate,
    mode === 'list'
      ? { ...buildCatalogAdminMenuOptions(normalizeBotLanguage(context.runtime.bot.language, 'ca')), parseMode: 'HTML' }
      : { inlineKeyboard },
  );
}

function itemTypeSupportsPlayers(itemType: CatalogItemType): boolean {
  return itemType !== 'book' && itemType !== 'rpg-book';
}

function getDraftItemType(item: CatalogItemRecord, data: Record<string, unknown>): CatalogItemType {
  return String(data.itemType ?? item.itemType) as CatalogItemType;
}

function getDraftFamilyId(item: CatalogItemRecord, data: Record<string, unknown>): number | null {
  return hasOwn(data, 'familyId') ? asNullableNumber(data.familyId) : item.familyId;
}

function buildCatalogItemDraft(item: CatalogItemRecord, data: Record<string, unknown>) {
  const itemType = getDraftItemType(item, data);
  const supportsPlayers = itemTypeSupportsPlayers(itemType);
  return {
    familyId: hasOwn(data, 'familyId') ? asNullableNumber(data.familyId) : item.familyId,
    groupId: hasOwn(data, 'groupId') ? asNullableNumber(data.groupId) : item.groupId,
    itemType,
    displayName: String(data.displayName ?? item.displayName),
    originalName: hasOwn(data, 'originalName') ? asNullableString(data.originalName) : item.originalName,
    description: hasOwn(data, 'description') ? asNullableString(data.description) : item.description,
    language: hasOwn(data, 'language') ? asNullableString(data.language) : item.language,
    publisher: hasOwn(data, 'publisher') ? asNullableString(data.publisher) : item.publisher,
    publicationYear: hasOwn(data, 'publicationYear') ? asNullableNumber(data.publicationYear) : item.publicationYear,
    playerCountMin: supportsPlayers
      ? hasOwn(data, 'playerCountMin') ? asNullableNumber(data.playerCountMin) : item.playerCountMin
      : null,
    playerCountMax: supportsPlayers
      ? hasOwn(data, 'playerCountMax') ? asNullableNumber(data.playerCountMax) : item.playerCountMax
      : null,
    recommendedAge: hasOwn(data, 'recommendedAge') ? asNullableNumber(data.recommendedAge) : item.recommendedAge,
    playTimeMinutes: hasOwn(data, 'playTimeMinutes') ? asNullableNumber(data.playTimeMinutes) : item.playTimeMinutes,
    externalRefs: hasOwn(data, 'externalRefs') ? asNullableObject(data.externalRefs) : item.externalRefs,
    metadata: hasOwn(data, 'metadata') ? asNullableObject(data.metadata) : item.metadata,
  };
}

async function updateEditDraftAndReturn(
  context: TelegramCatalogAdminContext,
  item: CatalogItemRecord,
  data: Record<string, unknown>,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const nextData = { ...data, ...patch };
  await context.runtime.session.advance({ stepKey: 'select-field', data: nextData });
  await context.reply(createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca')).catalogAdmin.fieldUpdated, buildEditFieldMenuOptions(getDraftItemType(item, nextData)));
  return true;
}

async function updateCreateDraftAndReturn(
  context: TelegramCatalogAdminContext,
  data: Record<string, unknown>,
  patch: Record<string, unknown>,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const nextData = { ...data, ...patch };
  const itemType = getDraftItemTypeFromData(nextData);
  await context.runtime.session.advance({ stepKey: 'select-field', data: nextData });
  await context.reply(createTelegramI18n(language).catalogAdmin.fieldUpdated, buildCreateFieldMenuOptions(itemType, language));
  return true;
}

async function saveCreateDraftAndReturn(
  context: TelegramCatalogAdminContext,
  data: Record<string, unknown>,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const texts = createTelegramI18n(language).catalogAdmin;
  const itemType = getDraftItemTypeFromData(data);
  const displayName = String(data.displayName ?? '').trim();
  if (!displayName) {
    await context.reply(texts.askDisplayName, buildSingleCancelKeyboard(language));
    return true;
  }

  const item = await createCatalogItem({
    repository: resolveCatalogRepository(context),
    familyId: (data.familyId as number | null | undefined) ?? null,
    groupId: (data.groupId as number | null | undefined) ?? null,
    itemType,
    displayName,
    originalName: asNullableString(data.originalName),
    description: asNullableString(data.description),
    language: asNullableString(data.language),
    publisher: asNullableString(data.publisher),
    publicationYear: asNullableNumber(data.publicationYear),
    playerCountMin: asNullableNumber(data.playerCountMin),
    playerCountMax: asNullableNumber(data.playerCountMax),
    recommendedAge: asNullableNumber(data.recommendedAge),
    playTimeMinutes: asNullableNumber(data.playTimeMinutes),
    externalRefs: asNullableObject(data.externalRefs),
    metadata: asNullableObject(data.metadata),
  });

  await appendAuditEvent({
    repository: resolveAuditRepository(context),
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    actionKey: 'catalog.item.created',
    targetType: 'catalog-item',
    targetId: item.id,
    summary: `Item de cataleg creat: ${item.displayName}`,
    details: { itemType: item.itemType, familyId: item.familyId, groupId: item.groupId, lifecycleStatus: item.lifecycleStatus },
  });
  await tryCreateImportedImageMedia(context, item, data);

  await context.runtime.session.cancel();
  if (await startCoverSaveConfirmationIfNeeded(context, item, data, language)) {
    return true;
  }
  await context.reply(`${texts.created}: ${item.displayName} (#${item.id}).`, buildCatalogAdminMenuOptions(language));
  return true;
}

async function saveEditDraftAndReturn(
  context: TelegramCatalogAdminContext,
  item: CatalogItemRecord,
  data: Record<string, unknown>,
): Promise<boolean> {
  const draft = buildCatalogItemDraft(item, data);
  const updated = await updateCatalogItem({
    repository: resolveCatalogRepository(context),
    itemId: item.id,
    familyId: draft.familyId,
    groupId: draft.groupId,
    itemType: draft.itemType,
    displayName: draft.displayName,
    originalName: draft.originalName,
    description: draft.description,
    language: draft.language,
    publisher: draft.publisher,
    publicationYear: draft.publicationYear,
    playerCountMin: draft.playerCountMin,
    playerCountMax: draft.playerCountMax,
    recommendedAge: draft.recommendedAge,
    playTimeMinutes: draft.playTimeMinutes,
    externalRefs: draft.externalRefs,
    metadata: draft.metadata,
  });
  await appendAuditEvent({
    repository: resolveAuditRepository(context),
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    actionKey: 'catalog.item.updated',
    targetType: 'catalog-item',
    targetId: updated.id,
    summary: `Item de cataleg actualitzat: ${updated.displayName}`,
    details: {
      previousDisplayName: item.displayName,
      displayName: updated.displayName,
      previousFamilyId: item.familyId,
      familyId: updated.familyId,
      previousGroupId: item.groupId,
      groupId: updated.groupId,
    },
  });
  await context.runtime.session.cancel();
    await context.reply(`Item de cataleg actualitzat correctament: ${updated.displayName} (#${updated.id}).`, buildCatalogAdminMenuOptions(normalizeBotLanguage(context.runtime.bot.language, 'ca')));
  return true;
}

async function withCompatibleGroup(
  context: TelegramCatalogAdminContext,
  item: CatalogItemRecord,
  data: Record<string, unknown>,
  familyId: number | null,
): Promise<Record<string, unknown>> {
  const currentGroupId = hasOwn(data, 'groupId') ? asNullableNumber(data.groupId) : item.groupId;
  if (currentGroupId === null) {
    return { ...data, familyId, groupId: null };
  }
  const group = await resolveCatalogRepository(context).findGroupById(currentGroupId);
  if (!group || group.familyId !== familyId) {
    return { ...data, familyId, groupId: null };
  }
  return { ...data, familyId, groupId: currentGroupId };
}

async function formatCatalogItemList(
  context: TelegramCatalogAdminContext,
  items: CatalogItemRecord[],
  omitTypeLabel = false,
): Promise<string> {
  const texts = createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca')).catalogAdmin;
  const repository = resolveCatalogRepository(context);
  const loanRepository = resolveCatalogLoanRepository(context);
  const families = await repository.listFamilies();
  const groups = await listCatalogGroups({ repository });
  const activeLoans = await loadActiveLoansByItemMap(loanRepository, items);
  const itemLines = new Map<number, string>(await Promise.all(items.map(async (item): Promise<[number, string]> => [
    item.id,
    await formatCatalogListItemLine(context, item, activeLoans.get(item.id) ?? null, 'Disponible', omitTypeLabel),
  ])));
  return formatCatalogAdminItemList({
    texts,
    families,
    groups,
    items,
    itemLines,
    browseLettersPrefix: catalogAdminCallbackPrefixes.browseLetters,
  });
}

async function buildCatalogItemDetailButtons(
  context: TelegramCatalogAdminContext,
  item: CatalogItemRecord,
  language: 'ca' | 'es' | 'en',
): Promise<NonNullable<TelegramReplyOptions['inlineKeyboard']>> {
  const loan = await loadActiveLoanByItemIdAdmin(context, item.id);
  const media = await resolveCatalogRepository(context).listMedia({ itemId: item.id });
  const initial = getCatalogAdminItemInitial(item);
  return [
    [
      { text: createTelegramI18n(language).catalogAdmin.browseBack, callbackData: catalogAdminCallbackPrefixes.browseMenu },
      { text: formatCatalogInitialsLabel(initial), callbackData: `${catalogAdminCallbackPrefixes.browseLetters}${initial}` },
    ],
    ...buildCatalogAdminItemDetailButtons({
      itemId: item.id,
      itemType: item.itemType,
      loan,
      media,
      language,
      canAdminister: canAdministerCatalog(context),
      canReturnLoan: loan ? canReturnLoan(context, loan) : true,
      editPrefix: catalogAdminCallbackPrefixes.edit,
      createActivityPrefix: catalogAdminCallbackPrefixes.createActivity,
      autocorrectPrefix: catalogAdminCallbackPrefixes.autocorrect,
      translateDescriptionPrefix: catalogAdminCallbackPrefixes.translateDescription,
      setOwnerSelfPrefix: catalogAdminCallbackPrefixes.setOwnerSelf,
      selectOwnerPrefix: catalogAdminCallbackPrefixes.ownerPage,
      clearOwnerPrefix: catalogAdminCallbackPrefixes.clearOwner,
      addMediaPrefix: catalogAdminCallbackPrefixes.addMedia,
      editMediaPrefix: catalogAdminCallbackPrefixes.editMedia,
      deleteMediaPrefix: catalogAdminCallbackPrefixes.deleteMedia,
      deactivatePrefix: catalogAdminCallbackPrefixes.deactivate,
    }),
  ];
}

async function buildCatalogItemDetailReplyKeyboard(
  context: TelegramCatalogAdminContext,
  item: CatalogItemRecord,
  language: 'ca' | 'es' | 'en',
): Promise<NonNullable<TelegramReplyOptions['replyKeyboard']>> {
  const inlineRows = await buildCatalogItemDetailButtons(context, item, language);
  const loan = await loadActiveLoanByItemIdAdmin(context, item.id);
  const texts = createTelegramI18n(language);
  const rows: NonNullable<TelegramReplyOptions['replyKeyboard']> = [];
  if (loan && loan.borrowerTelegramUserId === context.runtime.actor.telegramUserId && canReturnLoan(context, loan)) {
    rows.push([successButton(texts.catalogLoan.retornar)]);
  }
  if (item.itemType === 'board-game') {
    rows.push([successButton(texts.catalogAdmin.createActivity)]);
  }
  rows.push([texts.catalogLoan.veurePrestecs]);

  const prioritizedTexts = new Set(rows.flat().map((button) => typeof button === 'string' ? button : button.text));
  rows.push(...inlineRows
    .map((row) => row.filter((button) => !prioritizedTexts.has(button.text)).map((button) => button.text))
    .filter((row) => row.length > 0));
  return rows;
}

function successButton(text: string): TelegramReplyButton {
  return { text, semanticRole: 'success' };
}

async function formatCatalogItemSummary(context: TelegramCatalogAdminContext, item: CatalogItemRecord): Promise<string> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const loan = await loadActiveLoanByItemIdAdmin(context, item.id);
  return formatCatalogItemSummaryDetails({
    breadcrumbLine: buildCatalogAdminItemBreadcrumb(item, language),
    item,
    availabilityLine: formatCatalogAdminAvailabilityLine(loan, language),
    borrowerLine: await formatCatalogAdminBorrowerLine(context, loan, language),
    ownerLine: await formatCatalogOwnerLine(context, item, { includeEmpty: false }),
    detailsUrl: buildTelegramStartUrl(`${catalogAdminFullItemStartPayloadPrefix}${item.id}`),
    language,
  });
}

function formatCatalogAdminAvailabilityLine(loan: CatalogLoanRecord | null, language: 'ca' | 'es' | 'en'): string {
  const texts = createTelegramI18n(language).catalogLoan;
  return formatHtmlField(texts.availabilityAvailable, loan ? texts.availabilityLoaned : texts.available);
}

async function formatCatalogAdminBorrowerLine(context: TelegramCatalogAdminContext, loan: CatalogLoanRecord | null, language: 'ca' | 'es' | 'en'): Promise<string | null> {
  if (!loan) {
    return null;
  }
  const texts = createTelegramI18n(language).catalogLoan;
  return formatHtmlField(texts.availabilityHas, escapeHtml(await resolveLoanBorrowerDisplayName(context, loan)));
}

async function formatCatalogItemDetails(context: TelegramCatalogAdminContext, item: CatalogItemRecord): Promise<string> {
  const familyName = await loadFamilyName(context, item.familyId);
  const groupName = await loadGroupName(context, item.groupId);
  const media = await resolveCatalogRepository(context).listMedia({ itemId: item.id });
  const loan = await loadActiveLoanByItemIdAdmin(context, item.id);
  return formatCatalogAdminItemDetails({
    botLanguage: normalizeBotLanguage(context.runtime.bot.language, 'ca'),
    breadcrumbLine: buildCatalogAdminItemBreadcrumb(item, normalizeBotLanguage(context.runtime.bot.language, 'ca')),
    item,
    familyName,
    groupName,
    media,
    loanAvailabilityLines: await formatLoanAvailabilityLines(context, loan),
    ownerLine: await formatCatalogOwnerLine(context, item),
    itemTypeSupportsPlayers,
  });
}

async function formatCatalogOwnerLine(
  context: TelegramCatalogAdminContext,
  item: CatalogItemRecord,
  { includeEmpty = true }: { includeEmpty?: boolean } = {},
): Promise<string | null> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
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

async function formatCatalogGroupDetails(context: TelegramCatalogAdminContext, group: CatalogGroupRecord): Promise<string> {
  const familyName = await loadFamilyName(context, group.familyId);
  const items = await listCatalogItems({ repository: resolveCatalogRepository(context), groupId: group.id, includeDeactivated: true });
  const loanRepository = resolveCatalogLoanRepository(context);
  const activeLoans = await loadActiveLoansByItemMap(loanRepository, items);
  return formatCatalogAdminGroupDetails({
    botLanguage: normalizeBotLanguage(context.runtime.bot.language, 'ca'),
    group,
    familyName,
    itemLines: items.length > 0
      ? await Promise.all(items.map((item) => formatCatalogListItemLine(context, item, activeLoans.get(item.id) ?? null)))
      : [],
  });
}

async function formatCatalogListItemLine(
  context: TelegramCatalogAdminContext,
  item: CatalogItemRecord,
  loan: CatalogLoanRecord | null,
  fallbackAvailability: string = 'Disponible',
  omitTypeLabel = false,
): Promise<string> {
  return formatCatalogBrowseItemLine({
    item,
    fallbackAvailability,
    omitTypeLabel,
    availableLabel: createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca')).catalogLoan.available,
    startPayloadPrefix: catalogAdminStartPayloadPrefix,
    ...(loan
      ? {
          loanBorrowerDisplayName: await resolveLoanBorrowerDisplayName(context, loan),
          loanCreatedAt: loan.createdAt,
        }
      : {}),
  });
}

function buildCatalogAdminItemDeepLink(itemId: number): string {
  return buildCatalogAdminItemDeepLinkUrl(itemId, catalogAdminStartPayloadPrefix);
}

function buildCatalogAdminItemBreadcrumb(item: CatalogItemRecord, language: 'ca' | 'es' | 'en'): string {
  const initial = getCatalogItemInitial(item);
  const href = buildTelegramStartUrl(`catalog_admin_letters_${serializeCatalogInitialsStartPayload(initial)}`);
  const texts = createTelegramI18n(language);
  return `<a href="${escapeHtml(buildTelegramStartUrl('catalog_admin'))}">${escapeHtml(texts.actionMenu.catalog)}</a> / <a href="${escapeHtml(href)}">${escapeHtml(initial)}</a>`;
}

function parseCatalogAdminStartPayload(messageText: string | undefined): number | null {
  return parseCatalogAdminStartPayloadValue(messageText, catalogAdminStartPayloadPrefix);
}

function parseCatalogAdminLetterStartPayload(messageText: string | undefined): string | null {
  const trimmed = messageText?.trim();
  if (!trimmed) {
    return null;
  }

  const prefix = 'catalog_admin_letters_';
  const directCommand = new RegExp(`^/${prefix}([A-Za-z0-9_-]+)(?:@[A-Za-z0-9_]+)?$`).exec(trimmed);
  if (directCommand?.[1]) {
    const value = deserializeCatalogInitialsStartPayload(directCommand[1]);
    return value ? value : null;
  }

  const compactCommand = /^\/cat_([A-Za-z0-9_-]+)(?:@[A-Za-z0-9_]+)?$/.exec(trimmed);
  if (compactCommand?.[1]) {
    const value = deserializeCatalogInitialsStartPayload(compactCommand[1]);
    return value ? value : null;
  }

  const [command, ...rest] = trimmed.split(/\s+/);
  if (command?.split('@')[0] !== '/start') {
    return null;
  }

  const payload = rest.join(' ');
  if (!payload || !payload.startsWith(prefix)) {
    return null;
  }

  const value = deserializeCatalogInitialsStartPayload(payload.slice(prefix.length));
  return value ? value : null;
}

function deserializeCatalogInitialsStartPayload(value: string): string {
  const decoded = decodeURIComponent(value).trim();
  if (decoded.startsWith('hash_')) {
    return normalizeCatalogInitials(`#${decoded.slice('hash_'.length)}`);
  }

  return normalizeCatalogInitials(decoded);
}

function getCatalogItemInitial(item: CatalogItemRecord): string {
  const first = item.displayName.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').at(0)?.toUpperCase() ?? '#';
  return /^[A-Z]$/.test(first) ? first : '#';
}

function serializeCatalogInitialsStartPayload(value: string): string {
  const normalized = normalizeCatalogInitials(value);
  if (normalized.startsWith('#')) {
    return `hash_${normalized.slice(1)}`;
  }

  return normalized;
}

async function formatDraftSummary(context: TelegramCatalogAdminContext, data: Record<string, unknown>): Promise<string> {
  return formatCatalogAdminDraftSummary({
    botLanguage: normalizeBotLanguage(context.runtime.bot.language, 'ca'),
    data,
    resolveFamilyName: async (familyId) => loadFamilyName(context, familyId),
    resolveGroupName: async (groupId) => loadGroupName(context, groupId),
    itemTypeSupportsPlayers,
  });
}

function parseItemTypeLabel(text: string, language: 'ca' | 'es' | 'en'): CatalogItemType | Error {
  const labels = createTelegramI18n(language).catalogAdmin;
  switch (text) {
    case labels.typeBoardGame:
      return 'board-game';
    case labels.typeBook:
      return 'book';
    case labels.typeRpgBook:
      return 'rpg-book';
    case labels.typeAccessory:
      return 'accessory';
    default:
      return new Error('invalid-item-type');
  }
}

async function parseFamilyInput(
  context: TelegramCatalogAdminContext,
  text: string,
  itemType: CatalogItemType,
): Promise<number | null | Error> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).catalogAdmin;
  const repository = resolveCatalogRepository(context);
  return parseCatalogFamilyInput({
    repository,
    text,
    itemType,
    noFamilyLabel: texts.noFamily,
    normalizeFamilyLookupKey,
    buildFamilySlug,
    familyKindForItemType,
  });
}

async function parseGroupInput(
  context: TelegramCatalogAdminContext,
  text: string,
  familyId: number | null,
): Promise<number | null | Error> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).catalogAdmin;
  return parseCatalogGroupInput({
    repository: resolveCatalogRepository(context),
    text,
    familyId,
    noGroupLabel: texts.noGroup,
  });
}

async function loadMediaOrThrow(context: TelegramCatalogAdminContext, mediaId: number) {
  const media = (await resolveCatalogRepository(context).listMedia({})).find((entry) => entry.id === mediaId);
  if (!media) {
    throw new Error(`Catalog media ${mediaId} not found`);
  }
  return media;
}

async function loadItemOrThrow(context: TelegramCatalogAdminContext, itemId: number): Promise<CatalogItemRecord> {
  const item = await resolveCatalogRepository(context).findItemById(itemId);
  if (!item) {
    throw new Error(`Catalog item ${itemId} not found`);
  }
  return item;
}

async function loadGroupOrThrow(context: TelegramCatalogAdminContext, groupId: number): Promise<CatalogGroupRecord> {
  const group = await resolveCatalogRepository(context).findGroupById(groupId);
  if (!group) {
    throw new Error(`Catalog group ${groupId} not found`);
  }
  return group;
}

async function loadActiveLoanByItemIdAdmin(context: TelegramCatalogAdminContext, itemId: number) {
  const repository = resolveCatalogLoanRepository(context);
  const loans = await repository.listLoansByItem(itemId);
  return loans.find((loan) => loan.returnedAt === null) ?? repository.findActiveLoanByItemId(itemId);
}

async function buildCreateActivityLoanWarning(
  context: TelegramCatalogAdminContext,
  itemId: number,
  language: 'ca' | 'es' | 'en',
): Promise<string | null> {
  let loan: CatalogLoanRecord | null = null;
  try {
    loan = await loadActiveLoanByItemIdAdmin(context, itemId);
  } catch {
    return null;
  }

  if (!loan) {
    return null;
  }

  const borrower = await resolveLoanBorrowerDisplayName(context, loan);
  const dueDate = loan.dueAt ? formatLoanWarningDate(loan.dueAt) : null;
  const texts = createTelegramI18n(language).catalogAdmin;
  const dueDateText = dueDate ? texts.createActivityLoanWarningDueDate.replace('{date}', dueDate) : '';
  return texts.createActivityLoanWarning
    .replace('{borrower}', borrower)
    .replace('{dueDate}', dueDateText);
}

function formatLoanWarningDate(value: string): string {
  const date = new Date(value);
  return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function isEditableLoan(context: TelegramCatalogAdminContext, loan: CatalogLoanRecord): boolean {
  return context.runtime.actor.isAdmin || loan.loanedByTelegramUserId === context.runtime.actor.telegramUserId;
}

function resolveCatalogLoanRepository(context: TelegramCatalogAdminContext): CatalogLoanRepository {
  if (context.catalogLoanRepository) {
    return context.catalogLoanRepository;
  }

  return createDatabaseCatalogLoanRepository({ database: context.runtime.services.database.db as never });
}

async function loadActiveLoansByItemMap(
  repository: CatalogLoanRepository,
  items: CatalogItemRecord[],
): Promise<Map<number, CatalogLoanRecord>> {
  const pairs = await Promise.all(items.map(async (item) => {
    const loans = await repository.listLoansByItem(item.id);
    return [item.id, loans.find((loan) => loan.returnedAt === null) ?? await repository.findActiveLoanByItemId(item.id)] as const;
  }));
  return new Map(pairs.filter(([, loan]) => loan !== null) as Array<readonly [number, CatalogLoanRecord]>);
}

async function formatCatalogItemLine(context: TelegramCatalogAdminContext, item: CatalogItemRecord, loan: CatalogLoanRecord | null, extraSuffix?: string | null): Promise<string> {
  return formatCatalogItemSummaryLine({
    item,
    loanSummary: loan ? await formatLoanSummary(context, loan) : null,
    ...(extraSuffix === undefined ? {} : { extraSuffix }),
  });
}

async function formatLoanSummary(context: TelegramCatalogAdminContext, loan: CatalogLoanRecord): Promise<string> {
  return formatCatalogLoanSummary({
    borrowerDisplayName: await resolveLoanBorrowerDisplayName(context, loan),
    loan,
  });
}

function searchCatalogItemsByName({
  items,
  groups,
  families,
  query,
}: {
  items: CatalogItemRecord[];
  groups: CatalogGroupRecord[];
  families: CatalogFamilyRecord[];
  query: string;
}): CatalogItemRecord[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return [];
  }

  return items.filter((item) => {
    const family = item.familyId !== null ? families.find((candidate) => candidate.id === item.familyId) : null;
    const group = item.groupId !== null ? groups.find((candidate) => candidate.id === item.groupId) : null;
    return matchesText([
      item.displayName,
      item.originalName,
      family?.displayName,
      group?.displayName,
    ], tokens);
  });
}

function matchesText(values: Array<string | null | undefined>, tokens: string[]): boolean {
  const haystack = values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join(' ').toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

async function loadFamilyName(context: TelegramCatalogAdminContext, familyId: number | null): Promise<string | null> {
  if (familyId === null) {
    return null;
  }
  const family = await resolveCatalogRepository(context).findFamilyById(familyId);
  return family?.displayName ?? createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca')).catalogAdmin.familyFallback.replace('{id}', String(familyId));
}

async function loadGroupName(context: TelegramCatalogAdminContext, groupId: number | null): Promise<string | null> {
  if (groupId === null) {
    return null;
  }
  const group = await resolveCatalogRepository(context).findGroupById(groupId);
  return group?.displayName ?? createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca')).catalogAdmin.groupFallback.replace('{id}', String(groupId));
}

async function buildFamilyPrompt(context: TelegramCatalogAdminContext, itemType: CatalogItemType): Promise<string> {
  return buildCatalogAdminFamilyPrompt({
    repository: resolveCatalogRepository(context),
    itemType,
    language: normalizeBotLanguage(context.runtime.bot.language, 'ca'),
  });
}

function normalizeFamilyLookupKey(value: string): string {
  return value.trim().toLowerCase();
}

function buildFamilySlug(value: string): string {
  return normalizeFamilyLookupKey(value).replace(/\s+/g, '-');
}

async function buildGroupPrompt(context: TelegramCatalogAdminContext, familyId: number | null): Promise<string> {
  return buildCatalogAdminGroupPrompt({
    repository: resolveCatalogRepository(context),
    familyId,
    language: normalizeBotLanguage(context.runtime.bot.language, 'ca'),
  });
}

async function buildGroupedInspectKeyboard(
  context: TelegramCatalogAdminContext,
  items: CatalogItemRecord[],
): Promise<NonNullable<TelegramReplyOptions['inlineKeyboard']>> {
  return buildCatalogAdminGroupedInspectKeyboard({
    repository: resolveCatalogRepository(context),
    items,
    language: normalizeBotLanguage(context.runtime.bot.language, 'ca'),
    inspectPrefix: catalogAdminCallbackPrefixes.inspect,
    inspectGroupPrefix: catalogAdminCallbackPrefixes.inspectGroup,
  });
}

function asNullableObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

async function searchCatalogLookupCandidates(
  context: TelegramCatalogAdminContext,
  input: { itemType: CatalogItemType; displayName: string; author?: string },
): Promise<CatalogLookupCandidate[]> {
  try {
    return await resolveCatalogLookupService(context).search({ itemType: input.itemType, query: input.displayName, ...(input.author ? { author: input.author } : {}) });
  } catch {
    return [];
  }
}

function hasOwn(data: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(data, key);
}

function resolveCatalogRepository(context: TelegramCatalogAdminContext): CatalogRepository {
  if (context.catalogRepository) {
    return context.catalogRepository;
  }
  return createDatabaseCatalogRepository({ database: context.runtime.services.database.db as never });
}

function resolveMembershipRepository(context: TelegramCatalogAdminContext): MembershipAccessRepository {
  return context.membershipRepository ?? createDatabaseMembershipAccessRepository({ database: context.runtime.services.database.db as never });
}

function resolveCatalogStorageRepository(context: TelegramCatalogAdminContext): StorageCategoryRepository {
  return context.storageRepository ?? createDatabaseStorageRepository({ database: context.runtime.services.database.db as never });
}

function resolveCatalogStorageDefaultChatStore(context: TelegramCatalogAdminContext): AppMetadataSessionStorage {
  return context.storageDefaultChatStore ?? createDatabaseAppMetadataSessionStorage({ database: context.runtime.services.database.db as never });
}

function toCatalogMediaAttachment(context: TelegramCatalogAdminContext): CatalogMediaAttachmentInput | null {
  const media = context.messageMedia;
  if (!media) {
    return null;
  }
  return {
    fromChatId: context.runtime.chat.chatId,
    messageId: media.messageId,
    attachmentKind: media.attachmentKind,
    telegramFileId: media.fileId ?? null,
    telegramFileUniqueId: media.fileUniqueId ?? null,
    caption: media.caption ?? null,
    originalFileName: media.originalFileName ?? null,
    mimeType: media.mimeType ?? null,
    fileSizeBytes: media.fileSizeBytes ?? null,
    mediaGroupId: media.mediaGroupId ?? null,
  };
}

async function storeCatalogAttachmentMedia(
  context: TelegramCatalogAdminContext,
  attachment: CatalogMediaAttachmentInput,
): Promise<{ catalogMediaUrl: string } | Error> {
  const item = await loadItemOrThrow(context, Number(context.runtime.session.current?.data.itemId));
  const result = await storeCatalogMediaAttachment({
    repository: resolveCatalogStorageRepository(context),
    defaultChatStore: resolveCatalogStorageDefaultChatStore(context),
    bot: context.runtime.bot,
    actorTelegramUserId: context.runtime.actor.telegramUserId,
  }, {
    itemDisplayName: item.displayName,
    attachment,
  });
  return result.ok ? { catalogMediaUrl: result.catalogMediaUrl } : new Error(`No he podido guardar la imagen en Storage (${result.reason}).`);
}

async function storeCatalogExternalImageMedia(
  context: TelegramCatalogAdminContext,
  url: string,
): Promise<{ catalogMediaUrl: string } | Error> {
  const item = await loadItemOrThrow(context, Number(context.runtime.session.current?.data.itemId));
  const result = await storeCatalogMediaExternalImage({
    repository: resolveCatalogStorageRepository(context),
    defaultChatStore: resolveCatalogStorageDefaultChatStore(context),
    bot: context.runtime.bot,
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    ...(context.externalImageDownloader ? { externalImageDownloader: context.externalImageDownloader } : {}),
  }, {
    itemDisplayName: item.displayName,
    imageUrl: url,
  });
  if (!result.ok) {
    console.warn(JSON.stringify({
      event: 'catalog.external-image-storage.failed',
      itemId: item.id,
      reason: result.reason,
    }));
  }
  return result.ok ? { catalogMediaUrl: result.catalogMediaUrl } : new Error(`No he podido guardar la imagen en Storage (${result.reason}).`);
}

async function tryCreateImportedImageMedia(
  context: TelegramCatalogAdminContext,
  item: CatalogItemRecord,
  source: { metadata?: Record<string, unknown> | null; externalRefs?: Record<string, unknown> | null },
  options: {
    onExternalImageProgress?: (step: CatalogMediaExternalImageProgressStep) => Promise<void> | void;
  } = {},
): Promise<CatalogImportedImageMediaResult> {
  const repository = resolveCatalogRepository(context);
  const existingMedia = await repository.listMedia({ itemId: item.id });
  const existingImage = existingMedia.find((entry) => entry.mediaType === 'image');
  if (existingImage) {
    return { status: 'already-exists', mediaId: existingImage.id };
  }

  const imageUrl = extractImportedImageUrl(source.metadata) ?? extractImportedImageUrl(source.externalRefs);
  if (!imageUrl) {
    return { status: 'no-image-url' };
  }

  const startedAt = Date.now();
  console.info(JSON.stringify({
    event: 'catalog.cover-import.started',
    itemId: item.id,
    title: item.displayName,
    ...describeImportedImageUrl(imageUrl),
  }));
  try {
    const stored = await storeCatalogExternalImageMediaForItem(context, item, imageUrl, options);
    if (stored instanceof Error) {
      console.warn(JSON.stringify({
        event: 'catalog.cover-import.storage.failed',
        itemId: item.id,
        elapsedMs: Date.now() - startedAt,
        error: stored.message,
      }));
      return { status: 'failed' };
    }
    console.info(JSON.stringify({
      event: 'catalog.cover-import.storage.completed',
      itemId: item.id,
      status: 'stored',
      elapsedMs: Date.now() - startedAt,
    }));
    const mediaUrl = stored.catalogMediaUrl;
    try {
      const media = await createCatalogMedia({
        repository,
        familyId: null,
        itemId: item.id,
        mediaType: 'image',
        url: mediaUrl,
        altText: item.displayName,
        sortOrder: 0,
      });
      await appendAuditEvent({
        repository: resolveAuditRepository(context),
        actorTelegramUserId: context.runtime.actor.telegramUserId,
        actionKey: 'catalog.media.created',
        targetType: 'catalog-media',
        targetId: media.id,
        summary: `Portada de cataleg importada per l item #${item.id}`,
        details: { itemId: item.id, mediaType: media.mediaType, url: media.url, sortOrder: media.sortOrder },
      });
      return { status: 'created', mediaId: media.id, url: media.url };
    } catch {
      // La importacion de portada no debe bloquear el alta o sincronizacion del item.
      return { status: 'failed' };
    }
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'catalog.cover-import.storage.failed',
      itemId: item.id,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }));
    // La importacion de portada es best-effort y no debe bloquear altas o sincronizaciones.
    return { status: 'failed' };
  }
}

async function startCoverSaveConfirmationIfNeeded(
  context: TelegramCatalogAdminContext,
  item: CatalogItemRecord,
  data: Record<string, unknown>,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const attachment = data.coverAttachment;
  if (!attachment) {
    return false;
  }
  await context.runtime.session.start({
    flowKey: mediaFlowKey,
    stepKey: 'cover-confirm',
    data: {
      itemId: item.id,
      attachment,
      mediaType: 'image',
      source: 'attachment',
      altText: item.displayName,
      sortOrder: 0,
    },
  });
  await context.reply(createTelegramI18n(language).catalogAdmin.coverSavePrompt, buildCoverSaveOptions(language));
  return true;
}

async function storeCatalogExternalImageMediaForItem(
  context: TelegramCatalogAdminContext,
  item: CatalogItemRecord,
  url: string,
  options: {
    onExternalImageProgress?: (step: CatalogMediaExternalImageProgressStep) => Promise<void> | void;
  } = {},
): Promise<{ catalogMediaUrl: string } | Error> {
  const result = await storeCatalogMediaExternalImage({
    repository: resolveCatalogStorageRepository(context),
    defaultChatStore: resolveCatalogStorageDefaultChatStore(context),
    bot: context.runtime.bot,
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    ...(context.externalImageDownloader ? { externalImageDownloader: context.externalImageDownloader } : {}),
    ...(options.onExternalImageProgress ? { onExternalImageProgress: options.onExternalImageProgress } : {}),
  }, {
    itemDisplayName: item.displayName,
    imageUrl: url,
  });
  return result.ok ? { catalogMediaUrl: result.catalogMediaUrl } : new Error(`No he podido guardar la imagen en Storage (${result.reason}).`);
}

function extractImportedImageUrl(value: Record<string, unknown> | null | undefined): string | null {
  if (!value) {
    return null;
  }
  for (const key of ['imageUrl', 'coverUrl', 'thumbnailUrl']) {
    const candidate = value[key];
    if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate.trim())) {
      return candidate.trim();
    }
  }
  return null;
}

function describeImportedImageUrl(url: string): { imageHost: string; imageVariant: string } {
  let imageHost = 'unknown';
  try {
    imageHost = new URL(url).hostname;
  } catch {
    imageHost = 'invalid';
  }
  const imageVariant = url.includes('__small') || /thumbnail/i.test(url)
    ? 'thumbnail'
    : url.includes('__original') || /original/i.test(url)
      ? 'original'
      : 'unknown';
  return { imageHost, imageVariant };
}

function resolveAuditRepository(context: TelegramCatalogAdminContext): AuditLogRepository {
  if (context.auditRepository) {
    return context.auditRepository;
  }
  return createDatabaseAuditLogRepository({ database: context.runtime.services.database.db as never });
}

function resolveCatalogLookupService(context: TelegramCatalogAdminContext): CatalogLookupService {
  if (context.catalogLookupService) {
    return context.catalogLookupService;
  }
  return createHttpCatalogLookupService();
}

function resolveWikipediaBoardGameImportService(context: TelegramCatalogAdminContext): WikipediaBoardGameImportService {
  if (context.wikipediaBoardGameImportService) {
    return context.wikipediaBoardGameImportService;
  }

  if (context.runtime.wikipediaBoardGameImportService) {
    return context.runtime.wikipediaBoardGameImportService;
  }

  return createWikipediaBoardGameImportService();
}

function resolveBoardGameGeekCollectionImportService(context: TelegramCatalogAdminContext): BoardGameGeekCollectionImportService {
  if (context.boardGameGeekCollectionImportService) {
    return context.boardGameGeekCollectionImportService;
  }

  if (context.runtime.boardGameGeekCollectionImportService) {
    return context.runtime.boardGameGeekCollectionImportService;
  }

  return createBoardGameGeekCollectionImportService();
}

async function importWikipediaBoardGameDraft(
  context: TelegramCatalogAdminContext,
  title: string,
): Promise<WikipediaBoardGameImportResult> {
  try {
    const result = await resolveWikipediaBoardGameImportService(context).importByTitle(title);
    if (!result.ok) {
      return result;
    }
    return { ok: true, draft: await translateBggDraftDescriptionIfNeeded(context, result.draft) };
  } catch {
    return {
      ok: false,
      error: {
        type: 'connection',
        message: 'No he pogut connectar amb el cataleg extern en aquest moment.',
      },
    };
  }
}

async function translateBggDraftDescriptionIfNeeded(
  context: TelegramCatalogAdminContext,
  draft: WikipediaBoardGameCatalogDraft,
): Promise<WikipediaBoardGameCatalogDraft> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const description = draft.description;
  if (language !== 'es' || !description || !shouldTranslateBggDraftDescription(draft)) {
    return draft;
  }

  try {
    const translator = resolveCatalogDescriptionTranslator(context);
    const translated = normalizeTranslatedDescription(await translator({
      description,
      model: catalogBggDescriptionTranslationModel,
      targetLanguage: 'es',
    }));
    if (!translated) {
      return draft;
    }
    console.info(JSON.stringify({
      event: 'catalog.bgg-description.translation.completed',
      model: catalogBggDescriptionTranslationModel,
      title: draft.displayName,
      originalLength: description.length,
      translatedLength: translated.length,
    }));
    return { ...draft, description: translated };
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'catalog.bgg-description.translation.failed',
      model: catalogBggDescriptionTranslationModel,
      title: draft.displayName,
      error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
    }));
    return draft;
  }
}

function shouldTranslateBggDraftDescription(draft: WikipediaBoardGameCatalogDraft): boolean {
  const description = draft.description?.trim();
  if (!description || description.length < 20) {
    return false;
  }
  if (draft.itemType !== 'board-game' && draft.itemType !== 'expansion') {
    return false;
  }

  const metadata = asNullableObject(draft.metadata);
  return metadata?.source === 'boardgamegeek'
    || readBoardGameGeekId(draft.externalRefs) !== null
    || readBoardGameGeekId(metadata) !== null;
}

function resolveCatalogDescriptionTranslator(context: TelegramCatalogAdminContext): CatalogDescriptionTranslator {
  return context.descriptionTranslator
    ?? context.runtime.descriptionTranslator
    ?? createCatalogDescriptionTranslator({
      ...optionalCatalogDeepLConfig(process.env),
      ...optionalCatalogTranslationTimeout(process.env.GAMECLUB_DEEPL_TIMEOUT_MS),
      opencodeBin: catalogOpencodeBin,
    });
}

function optionalCatalogDeepLConfig(env: NodeJS.ProcessEnv): { deeplApiKey?: string; deeplApiUrl?: string } {
  return {
    ...(env.GAMECLUB_DEEPL_API_KEY?.trim() ? { deeplApiKey: env.GAMECLUB_DEEPL_API_KEY } : {}),
    ...(env.GAMECLUB_DEEPL_API_URL?.trim() ? { deeplApiUrl: env.GAMECLUB_DEEPL_API_URL } : {}),
  };
}

function optionalCatalogTranslationTimeout(value: string | undefined): { deeplTimeoutMs?: number } {
  if (!value?.trim()) {
    return {};
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? { deeplTimeoutMs: parsed } : {};
}

function normalizeTranslatedDescription(value: string): string {
  if (/ProviderModelNotFoundError|Model not found|Error:/i.test(value)) {
    return '';
  }

  const cleaned = value
    .replace(/\u001b\[[0-9;]*m/g, '')
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('>') && !/^sqlite-migration:/i.test(line) && !/^database migration/i.test(line))
    .join('\n')
    .replace(/^```(?:\w+)?\s*/i, '')
    .replace(/```$/i, '')
    .replace(/^traducci[oó]n(?: al castellano| al espa[nñ]ol)?:\s*/i, '')
    .replace(/^descripci[oó]n traducida:\s*/i, '')
    .trim();

  return cleaned.length >= 10 ? cleaned : '';
}

function formatTranslationErrorReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const cleaned = raw
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('>'))
    .join(' ')
    .trim();
  return cleaned.slice(0, 300) || 'error desconocido';
}

async function createWikipediaImportedBoardGame(
  context: TelegramCatalogAdminContext,
  baseData: Record<string, unknown>,
  draft: WikipediaBoardGameCatalogDraft,
  sourceTitle: string,
): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).catalogAdmin;
  const importedData = {
    ...(baseData as Record<string, unknown>),
    ...draft,
    itemType: 'board-game' as const,
    displayName: draft.displayName || sourceTitle,
  } as WikipediaBoardGameCatalogDraft;
  const item = await createCatalogItem({
    repository: resolveCatalogRepository(context),
    familyId: importedData.familyId,
    groupId: importedData.groupId,
    itemType: importedData.itemType,
    displayName: importedData.displayName,
    originalName: importedData.originalName,
    description: importedData.description,
    language: importedData.language,
    publisher: importedData.publisher,
    publicationYear: importedData.publicationYear,
    playerCountMin: importedData.playerCountMin,
    playerCountMax: importedData.playerCountMax,
    recommendedAge: importedData.recommendedAge,
    playTimeMinutes: importedData.playTimeMinutes,
    externalRefs: importedData.externalRefs,
    metadata: importedData.metadata,
  });
  await appendAuditEvent({
    repository: resolveAuditRepository(context),
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    actionKey: 'catalog.item.created',
    targetType: 'catalog-item',
    targetId: item.id,
    summary: `Item de cataleg creat: ${item.displayName}`,
    details: { itemType: item.itemType, familyId: item.familyId, groupId: item.groupId, lifecycleStatus: item.lifecycleStatus },
  });
  if (!(importedData as unknown as Record<string, unknown>).coverAttachment) {
    await tryCreateImportedImageMedia(context, item, importedData);
  }
  if (await startCoverSaveConfirmationIfNeeded(context, item, importedData as unknown as Record<string, unknown>, language)) {
    return;
  }
  await context.runtime.session.start({
    flowKey: editFlowKey,
    stepKey: 'select-field',
    data: { itemId: item.id },
  });
  await context.reply(texts.wikipediaFinalizeImport, buildEditFieldMenuOptions(item.itemType, language));
  await context.reply(
    `${texts.wikipediaImportedDraft.replace('{name}', escapeHtml(item.displayName))}\n\n${await formatDraftSummary(context, importedData as unknown as Record<string, unknown>)}\n\n${texts.selectEditField}`,
    { ...buildEditFieldMenuOptions(item.itemType, language), parseMode: 'HTML' },
  );
}

function importWikipediaErrorMessage(result: Extract<WikipediaBoardGameImportResult, { ok: false }>): string {
  if (result.error.type === 'not-found') {
    return 'No he trobat aquest joc al cataleg extern. Continuem manualment.';
  }

  if (result.error.type === 'connection') {
    return 'No he pogut connectar amb el cataleg extern. Continuem manualment.';
  }

  return 'No he pogut importar les dades del cataleg extern. Continuem manualment.';
}

async function handleBggCollectionImportSession(
  context: TelegramCatalogAdminContext,
  text: string,
  stepKey: string,
): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const sessionData = context.runtime.session.current?.data ?? {};

  if (stepKey === 'bgg-username') {
    return handleBggCollectionUsernameStep(context, text, language);
  }

  if (stepKey === 'bgg-collection-choice') {
    return handleBggCollectionChoiceStep(context, text, sessionData, language);
  }

  if (stepKey === 'bgg-collection-manual-name') {
    return handleBggCollectionManualNameStep(context, text, sessionData, language);
  }

  return false;
}

async function handleBggCollectionUsernameStep(
  context: TelegramCatalogAdminContext,
  text: string,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const texts = createTelegramI18n(language).catalogAdmin;
  const username = text.trim();
  if (!username) {
    await context.reply(texts.invalidBggCollectionUsername, buildSingleCancelKeyboard(language));
    return true;
  }

  await context.reply(texts.loadingBggCollections, buildSingleCancelKeyboard(language));
  const listResult = await resolveBoardGameGeekCollectionImportService(context).listCollections(username);
  if (!listResult.ok) {
    return replyAfterBggCollectionListFailure(context, listResult, language);
  }

  if (listResult.collections.length === 0) {
    await context.runtime.session.advance({ stepKey: 'bgg-collection-manual-name', data: { username } });
    await context.reply(texts.askBggCollectionManualName, buildSingleCancelKeyboard(language));
    return true;
  }

  const collectionLabels = listResult.collections.map((collection) => formatBggCollectionLabel(language, collection));
  await context.runtime.session.advance({
    stepKey: 'bgg-collection-choice',
    data: {
      username,
      collectionKeys: listResult.collections.map((collection) => collection.key),
      collectionLabels,
      canWriteCollectionName: listResult.canWriteCollectionName,
    },
  });
  await context.reply(
    texts.askBggCollectionChoice,
    buildBggCollectionChoiceOptions({
      collectionLabels,
      allowManualEntry: listResult.canWriteCollectionName,
      language,
    }),
  );
  return true;
}

async function replyAfterBggCollectionListFailure(
  context: TelegramCatalogAdminContext,
  listResult: Extract<BoardGameGeekCollectionListResult, { ok: false }>,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const texts = createTelegramI18n(language).catalogAdmin;
  if (!listResult.error.canRetryManually) {
    await context.runtime.session.cancel();
    await context.reply(formatBggCollectionImportError(texts, listResult.error), buildCatalogAdminMenuOptions(language));
    return true;
  }

  await context.runtime.session.advance({
    stepKey: 'bgg-collection-manual-name',
    data: { username: listResult.error.username },
  });
  await context.reply(
    `${formatBggCollectionImportError(texts, listResult.error)} ${texts.askBggCollectionManualName}`,
    buildSingleCancelKeyboard(language),
  );
  return true;
}

async function handleBggCollectionChoiceStep(
  context: TelegramCatalogAdminContext,
  text: string,
  data: Record<string, unknown>,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const texts = createTelegramI18n(language).catalogAdmin;
  const username = typeof data.username === 'string' ? data.username : '';
  const collectionLabels = asStringArray(data.collectionLabels);
  const collectionKeys = asStringArray(data.collectionKeys) as BoardGameGeekCollectionKey[];
  const canWriteCollectionName = data.canWriteCollectionName === true;
  if (!username || collectionLabels.length !== collectionKeys.length) {
    await context.runtime.session.cancel();
    await context.reply(texts.bggCollectionImportFailed, buildCatalogAdminMenuOptions(language));
    return true;
  }

  if (canWriteCollectionName && text === texts.bggCollectionWriteManual) {
    await context.runtime.session.advance({ stepKey: 'bgg-collection-manual-name', data: { username } });
    await context.reply(texts.askBggCollectionManualName, buildSingleCancelKeyboard(language));
    return true;
  }

  const selectedIndex = collectionLabels.findIndex((label) => label === text);
  if (selectedIndex < 0) {
    await context.reply(
      texts.invalidBggCollectionChoice,
      buildBggCollectionChoiceOptions({
        collectionLabels,
        allowManualEntry: canWriteCollectionName,
        language,
      }),
    );
    return true;
  }

  const selectedCollectionKey = collectionKeys[selectedIndex];
  if (!selectedCollectionKey) {
    await context.reply(texts.invalidBggCollectionChoice, buildSingleCancelKeyboard(language));
    return true;
  }

  return importBggCollectionSelection(context, {
    username,
    collectionKey: selectedCollectionKey,
    language,
  });
}

async function handleBggCollectionManualNameStep(
  context: TelegramCatalogAdminContext,
  text: string,
  data: Record<string, unknown>,
  language: 'ca' | 'es' | 'en',
): Promise<boolean> {
  const texts = createTelegramI18n(language).catalogAdmin;
  const username = typeof data.username === 'string' ? data.username : '';
  const collectionName = text.trim();
  if (!username) {
    await context.runtime.session.cancel();
    await context.reply(texts.bggCollectionImportFailed, buildCatalogAdminMenuOptions(language));
    return true;
  }
  if (!collectionName) {
    await context.reply(texts.invalidBggCollectionManualName, buildSingleCancelKeyboard(language));
    return true;
  }

  return importBggCollectionSelection(context, {
    username,
    collectionName,
    language,
  });
}

async function importBggCollectionSelection(
  context: TelegramCatalogAdminContext,
  {
    username,
    collectionKey,
    collectionName,
    language,
  }: {
    username: string;
    collectionKey?: BoardGameGeekCollectionKey;
    collectionName?: string;
    language: 'ca' | 'es' | 'en';
  },
): Promise<boolean> {
  const texts = createTelegramI18n(language).catalogAdmin;
  await context.reply(texts.importingBggCollection, buildSingleCancelKeyboard(language));
  const importResult = await resolveBoardGameGeekCollectionImportService(context).importCollection({
    username,
    ...(collectionKey ? { collectionKey } : {}),
    ...(collectionName ? { collectionName } : {}),
  });
  if (!importResult.ok) {
    if (importResult.error.canRetryManually && importResult.error.reason !== 'unsupported-collection-name') {
      await context.runtime.session.advance({
        stepKey: 'bgg-collection-manual-name',
        data: { username },
      });
      await context.reply(
        `${formatBggCollectionImportError(texts, importResult.error)} ${texts.askBggCollectionManualName}`,
        buildSingleCancelKeyboard(language),
      );
      return true;
    }

    await context.runtime.session.cancel();
    await context.reply(formatBggCollectionImportError(texts, importResult.error), buildCatalogAdminMenuOptions(language));
    return true;
  }

  const summary = await reconcileBoardGameGeekCollectionImport(context, importResult);
  await context.runtime.session.cancel();
  await context.reply(
    texts.bggCollectionImportSummary
      .replace('{username}', importResult.username)
      .replace('{created}', String(summary.created))
      .replace('{updated}', String(summary.updated))
      .replace('{skipped}', String(summary.skipped))
      .replace('{errors}', String(summary.errors)),
    buildCatalogAdminMenuOptions(language),
  );
  return true;
}

function formatBggCollectionLabel(language: 'ca' | 'es' | 'en', collection: BoardGameGeekCollectionDescriptor): string {
  return renderBggCollectionKey(language, collection.key);
}

function renderBggCollectionKey(language: 'ca' | 'es' | 'en', key: BoardGameGeekCollectionKey): string {
  const labels = {
    owned: { ca: 'Propia', es: 'Propia', en: 'Owned' },
    wishlist: { ca: 'Wishlist', es: 'Wishlist', en: 'Wishlist' },
    preordered: { ca: 'Preordered', es: 'Preordered', en: 'Preordered' },
    'for-trade': { ca: 'For trade', es: 'For trade', en: 'For trade' },
    'want-to-play': { ca: 'Want to play', es: 'Want to play', en: 'Want to play' },
    'want-to-buy': { ca: 'Want to buy', es: 'Want to buy', en: 'Want to buy' },
    'previously-owned': { ca: 'Previously owned', es: 'Previously owned', en: 'Previously owned' },
  } as const;
  return labels[key][language];
}

function formatBggCollectionImportError(
  texts: ReturnType<typeof createTelegramI18n>['catalogAdmin'],
  error: BoardGameGeekCollectionError,
): string {
  const stageLabel = error.stage === 'list-collections'
    ? 'listar las colecciones'
    : error.stage === 'import-collection'
      ? 'importar la colección'
      : 'cargar los juegos de la colección';
  const statusLabel = typeof error.httpStatus === 'number' ? ` (HTTP ${error.httpStatus})` : '';

  if (error.reason === 'missing-api-key' || error.reason === 'auth-invalid') {
    return `${texts.bggCollectionImportFailed} Problema de configuración o autenticación de BoardGameGeek${statusLabel}.`;
  }
  if (error.reason === 'unsupported-collection-name') {
    const supported = (error.supportedCollectionKeys ?? []).join(', ');
    return `${texts.bggCollectionImportFailed} No reconozco esa colección de BoardGameGeek. Usa uno de estos nombres: ${supported}.`;
  }
  if (error.reason === 'not-ready') {
    return `${texts.bggCollectionImportFailed} BoardGameGeek no terminó de preparar la respuesta al ${stageLabel} para ${error.username}.`;
  }
  if (error.reason === 'no-importable-items') {
    return `${texts.bggCollectionImportFailed} No he encontrado items importables para ${error.username} al ${stageLabel}${statusLabel}.`;
  }
  if (error.reason === 'invalid-thing-response') {
    return `${texts.bggCollectionImportFailed} BoardGameGeek devolvió detalles no utilizables para ${error.username}.`;
  }

  return `${texts.bggCollectionImportFailed} Falló al ${stageLabel} para ${error.username}${statusLabel}.`;
}

async function reconcileBoardGameGeekCollectionImport(
  context: TelegramCatalogAdminContext,
  importResult: Extract<BoardGameGeekCollectionImportResult, { ok: true }>,
): Promise<{ created: number; updated: number; skipped: number; errors: number }> {
  const repository = resolveCatalogRepository(context);
  const allItems = await listCatalogItems({ repository, includeDeactivated: true });
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = importResult.errors.length;

  for (const rawDraft of importResult.items) {
    const draft = await translateBggDraftDescriptionIfNeeded(context, rawDraft);
    const bggId = readBoardGameGeekId(draft.externalRefs);
    if (!bggId) {
      skipped += 1;
      continue;
    }

    const existingByBggId = allItems.find((item) => readBoardGameGeekId(item.externalRefs) === bggId);
    if (existingByBggId) {
      const updatedItem = await updateCatalogItem({
        repository,
        itemId: existingByBggId.id,
        familyId: existingByBggId.familyId,
        groupId: existingByBggId.groupId,
        itemType: draft.itemType,
        displayName: draft.displayName,
        originalName: draft.originalName,
        description: draft.description,
        language: draft.language,
        publisher: draft.publisher,
        publicationYear: draft.publicationYear,
        playerCountMin: draft.playerCountMin,
        playerCountMax: draft.playerCountMax,
        recommendedAge: draft.recommendedAge,
        playTimeMinutes: draft.playTimeMinutes,
        externalRefs: draft.externalRefs,
        metadata: draft.metadata,
      });
      await tryCreateImportedImageMedia(context, updatedItem, draft);
      await appendAuditEvent({
        repository: resolveAuditRepository(context),
        actorTelegramUserId: context.runtime.actor.telegramUserId,
        actionKey: 'catalog.item.updated',
        targetType: 'catalog-item',
        targetId: existingByBggId.id,
        summary: `Item de cataleg actualitzat: ${draft.displayName}`,
        details: { source: 'bgg-collection-import', boardGameGeekId: bggId, username: importResult.username },
      });
      updated += 1;
      continue;
    }

    const matchingByName = allItems.filter((item) => item.itemType === draft.itemType && normalizeCatalogMatchText(item.displayName) === normalizeCatalogMatchText(draft.displayName));
    if (matchingByName.length > 1) {
      skipped += 1;
      errors += 1;
      continue;
    }

    if (matchingByName.length === 1 && matchingByName[0]) {
      const updatedItem = await updateCatalogItem({
        repository,
        itemId: matchingByName[0].id,
        familyId: matchingByName[0].familyId,
        groupId: matchingByName[0].groupId,
        itemType: draft.itemType,
        displayName: draft.displayName,
        originalName: draft.originalName,
        description: draft.description,
        language: draft.language,
        publisher: draft.publisher,
        publicationYear: draft.publicationYear,
        playerCountMin: draft.playerCountMin,
        playerCountMax: draft.playerCountMax,
        recommendedAge: draft.recommendedAge,
        playTimeMinutes: draft.playTimeMinutes,
        externalRefs: draft.externalRefs,
        metadata: draft.metadata,
      });
      await tryCreateImportedImageMedia(context, updatedItem, draft);
      await appendAuditEvent({
        repository: resolveAuditRepository(context),
        actorTelegramUserId: context.runtime.actor.telegramUserId,
        actionKey: 'catalog.item.updated',
        targetType: 'catalog-item',
        targetId: matchingByName[0].id,
        summary: `Item de cataleg actualitzat: ${draft.displayName}`,
        details: { source: 'bgg-collection-import', boardGameGeekId: bggId, username: importResult.username },
      });
      updated += 1;
      continue;
    }

    const createdItem = await createCatalogItem({
      repository,
      familyId: draft.familyId,
      groupId: draft.groupId,
      itemType: draft.itemType,
      displayName: draft.displayName,
      originalName: draft.originalName,
      description: draft.description,
      language: draft.language,
      publisher: draft.publisher,
      publicationYear: draft.publicationYear,
      playerCountMin: draft.playerCountMin,
      playerCountMax: draft.playerCountMax,
      recommendedAge: draft.recommendedAge,
      playTimeMinutes: draft.playTimeMinutes,
      externalRefs: draft.externalRefs,
      metadata: draft.metadata,
    });
    allItems.push(createdItem);
    await appendAuditEvent({
      repository: resolveAuditRepository(context),
      actorTelegramUserId: context.runtime.actor.telegramUserId,
      actionKey: 'catalog.item.created',
      targetType: 'catalog-item',
      targetId: createdItem.id,
      summary: `Item de cataleg creat: ${createdItem.displayName}`,
      details: { source: 'bgg-collection-import', boardGameGeekId: bggId, username: importResult.username },
    });
    await tryCreateImportedImageMedia(context, createdItem, draft);
    created += 1;
  }

  return { created, updated, skipped, errors };
}

function readBoardGameGeekId(externalRefs: Record<string, unknown> | null): string | null {
  const value = externalRefs?.boardGameGeekId;
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    return String(value);
  }
  return null;
}

function readBoardGameGeekIdFromItem(item: CatalogItemRecord): string | null {
  return readBoardGameGeekId(item.externalRefs)
    ?? readBoardGameGeekId(asNullableObject(item.metadata));
}

function cleanCatalogAutocorrectMetadata(
  metadata: Record<string, unknown> | null,
  externalRefs: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const source = asNullableString(metadata?.source);
  const bggId = readBoardGameGeekId(externalRefs) ?? readBoardGameGeekId(asNullableObject(metadata));
  const openLibraryKey = asNullableString(externalRefs?.openLibraryKey) ?? asNullableString(metadata?.openLibraryKey);

  const cleaned: Record<string, unknown> = {};
  if (source) {
    cleaned.source = source;
  }
  if (bggId) {
    cleaned.boardGameGeekId = bggId;
  }
  if (openLibraryKey) {
    cleaned.openLibraryKey = openLibraryKey;
  }

  if (Object.keys(cleaned).length === 0) {
    return null;
  }
  return cleaned;
}

function normalizeCatalogMatchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
