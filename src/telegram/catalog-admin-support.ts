import { appendAuditEvent, type AuditLogRepository } from '../audit/audit-log.js';
import { createDatabaseAuditLogRepository } from '../audit/audit-log-store.js';
import {
  createHttpCatalogLookupService,
  type CatalogLookupCandidate,
  type CatalogLookupService,
} from '../catalog/catalog-lookup-service.js';
import {
  createCatalogItem,
  createCatalogMedia,
  deactivateCatalogItem,
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
import { createBoardGameGeekCollectionImportService, createWikipediaBoardGameImportService } from '../catalog/wikipedia-boardgame-import-service.js';
import { buildLoanItemButton, formatLoanAvailabilityLines, resolveLoanBorrowerDisplayName, type TelegramCatalogLoanContext } from './catalog-loan-flow.js';
import { buildDescriptionOptions } from './schedule-keyboards.js';
import {
  buildCatalogAdminMenuOptions,
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
import {
  asNullableNumber,
  asNullableString,
  asLookupCandidate,
  asLookupCandidates,
  asStringArray,
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
  formatHtmlField,
  renderCatalogItemType,
  renderCatalogOptionalObject,
  renderCatalogPlayerRange,
} from './catalog-presentation.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import type { AuthorizationService } from '../authorization/service.js';
import type { TelegramActor } from './actor-store.js';
import type { TelegramChatContext } from './chat-context.js';
import type { ConversationSessionRuntime } from './conversation-session.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

const createFlowKey = 'catalog-admin-create';
const editFlowKey = 'catalog-admin-edit';
const deactivateFlowKey = 'catalog-admin-deactivate';
const mediaFlowKey = 'catalog-admin-media';
const mediaDeleteFlowKey = 'catalog-admin-media-delete';
const browseFlowKey = 'catalog-admin-browse';
const bggCollectionImportFlowKey = 'catalog-admin-bgg-collection-import';
const catalogAdminStartPayloadPrefix = 'catalog_admin_item_';

export const catalogAdminCallbackPrefixes = {
  browseMenu: 'catalog_admin:browse_menu',
  browseFamily: 'catalog_admin:browse_family:',
  browseSearch: 'catalog_admin:browse_search',
  inspect: 'catalog_admin:inspect:',
  inspectGroup: 'catalog_admin:inspect_group:',
  edit: 'catalog_admin:edit:',
  createActivity: 'catalog_admin:create_activity:',
  deactivate: 'catalog_admin:deactivate:',
  editMedia: 'catalog_admin:edit_media:',
  deleteMedia: 'catalog_admin:delete_media:',
} as const;

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
  start: 'Inici',
  cancel: '/cancel',
} as const;

export interface TelegramCatalogAdminContext {
  messageText?: string | undefined;
  callbackData?: string | undefined;
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
      sendPrivateMessage(telegramUserId: number, message: string): Promise<void>;
    };
  };
  catalogRepository?: CatalogRepository;
  catalogLoanRepository?: CatalogLoanRepository;
  membershipRepository?: TelegramCatalogLoanContext['membershipRepository'] | undefined;
  auditRepository?: AuditLogRepository;
  catalogLookupService?: CatalogLookupService;
  wikipediaBoardGameImportService?: WikipediaBoardGameImportService;
  boardGameGeekCollectionImportService?: BoardGameGeekCollectionImportService;
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

  if (text === i18n.actionMenu.catalog || text === catalogAdminLabels.openMenu || text === '/catalog') {
    await showCatalogBrowseMenu(context);
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

export async function handleTelegramCatalogAdminStartText(context: TelegramCatalogAdminContext): Promise<boolean> {
  const payload = parseCatalogAdminStartPayload(context.messageText);
  if (payload === null || context.runtime.chat.kind !== 'private' || !canAccessCatalog(context)) {
    return false;
  }

  const item = await loadItemOrThrow(context, payload);
  await replyWithCatalogAdminItemInspection({
    reply: context.reply,
    detailsMessage: await formatCatalogItemDetails(context, item),
    inlineKeyboard: await buildCatalogItemDetailButtons(context, item, normalizeBotLanguage(context.runtime.bot.language, 'ca')),
  });
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

  if (route.kind === 'inspect-item') {
    const item = await loadItemOrThrow(context, route.itemId);
    await replyWithCatalogAdminItemInspection({
      reply: context.reply,
      detailsMessage: await formatCatalogItemDetails(context, item),
      inlineKeyboard: await buildCatalogItemDetailButtons(context, item, normalizeBotLanguage(context.runtime.bot.language, 'ca')),
    });
    return true;
  }
  if (route.kind === 'inspect-group') {
    const group = await loadGroupOrThrow(context, route.groupId);
    const items = await listCatalogItems({ repository: resolveCatalogRepository(context), groupId: route.groupId, includeDeactivated: true });
    const inlineKeyboard = await Promise.all(
      items.map(async (item) => buildLoanItemButton(await loadActiveLoanByItemIdAdmin(context, item.id), item.id, item.displayName)),
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
    await context.runtime.session.start({
      flowKey: 'schedule-create',
      stepKey: 'description',
      data: { title: item.displayName },
    });
    await context.reply(createTelegramI18n(language).schedule.askDescription, buildDescriptionOptions(language));
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

function canAccessCatalog(context: TelegramCatalogAdminContext): boolean {
  return context.runtime.actor.isApproved && !context.runtime.actor.isBlocked;
}

function canAdministerCatalog(context: TelegramCatalogAdminContext): boolean {
  return context.runtime.actor.isAdmin;
}

function isCatalogAdminSession(flowKey: string | undefined): boolean {
  return flowKey === createFlowKey || flowKey === editFlowKey || flowKey === deactivateFlowKey || flowKey === mediaFlowKey || flowKey === mediaDeleteFlowKey || flowKey === browseFlowKey || flowKey === bggCollectionImportFlowKey;
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
    importWikipediaErrorMessage,
    formatDraftSummary: (draftData) => formatDraftSummary(context, draftData),
  });
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
  const texts = createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca')).catalogAdmin;
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
  const itemRows = await Promise.all(items.map(async (item) => buildLoanItemButton(await loadActiveLoanByItemIdAdmin(context, item.id), item.id, item.displayName, catalogAdminCallbackPrefixes.inspect)));
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

async function handleBrowseSession(context: TelegramCatalogAdminContext, text: string, stepKey: string, data: Record<string, unknown>): Promise<boolean> {
  const texts = createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca')).catalogAdmin;
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
  const itemRows = await Promise.all(matches.map(async (item) => buildLoanItemButton(await loadActiveLoanByItemIdAdmin(context, item.id), item.id, item.displayName, catalogAdminCallbackPrefixes.inspect)));

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
    inspectKeyboard: await buildGroupedInspectKeyboard(context, items),
    editPrefix: catalogAdminCallbackPrefixes.edit,
    deactivatePrefix: catalogAdminCallbackPrefixes.deactivate,
  });
  await context.reply(
    mode === 'list' ? await formatCatalogItemList(context, items, itemTypeFilter !== undefined) : mode === 'edit' ? texts.chooseItemToEdit : texts.chooseItemToDeactivate,
    mode === 'list'
      ? { ...buildCatalogAdminMenuOptions(normalizeBotLanguage(context.runtime.bot.language, 'ca')), inlineKeyboard, parseMode: 'HTML' }
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

  await context.runtime.session.cancel();
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
  });
}

async function buildCatalogItemDetailButtons(
  context: TelegramCatalogAdminContext,
  item: CatalogItemRecord,
  language: 'ca' | 'es' | 'en',
): Promise<NonNullable<TelegramReplyOptions['inlineKeyboard']>> {
  const loan = await loadActiveLoanByItemIdAdmin(context, item.id);
  const media = await resolveCatalogRepository(context).listMedia({ itemId: item.id });
  return buildCatalogAdminItemDetailButtons({
    itemId: item.id,
    itemType: item.itemType,
    loan,
    media,
    language,
    canAdminister: canAdministerCatalog(context),
    editPrefix: catalogAdminCallbackPrefixes.edit,
    createActivityPrefix: catalogAdminCallbackPrefixes.createActivity,
    editMediaPrefix: catalogAdminCallbackPrefixes.editMedia,
    deleteMediaPrefix: catalogAdminCallbackPrefixes.deleteMedia,
    deactivatePrefix: catalogAdminCallbackPrefixes.deactivate,
  });
}

async function formatCatalogItemDetails(context: TelegramCatalogAdminContext, item: CatalogItemRecord): Promise<string> {
  const familyName = await loadFamilyName(context, item.familyId);
  const groupName = await loadGroupName(context, item.groupId);
  const media = await resolveCatalogRepository(context).listMedia({ itemId: item.id });
  const loan = await loadActiveLoanByItemIdAdmin(context, item.id);
  return formatCatalogAdminItemDetails({
    botLanguage: normalizeBotLanguage(context.runtime.bot.language, 'ca'),
    item,
    familyName,
    groupName,
    media,
    loanAvailabilityLines: await formatLoanAvailabilityLines(context, loan),
    itemTypeSupportsPlayers,
  });
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

function parseCatalogAdminStartPayload(messageText: string | undefined): number | null {
  return parseCatalogAdminStartPayloadValue(messageText, catalogAdminStartPayloadPrefix);
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
    return await resolveWikipediaBoardGameImportService(context).importByTitle(title);
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

  for (const draft of importResult.items) {
    const bggId = readBoardGameGeekId(draft.externalRefs);
    if (!bggId) {
      skipped += 1;
      continue;
    }

    const existingByBggId = allItems.find((item) => readBoardGameGeekId(item.externalRefs) === bggId);
    if (existingByBggId) {
      await updateCatalogItem({
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
      await updateCatalogItem({
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

function normalizeCatalogMatchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
