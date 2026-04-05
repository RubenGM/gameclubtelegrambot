import { appendAuditEvent, type AuditLogRepository } from '../audit/audit-log.js';
import { createDatabaseAuditLogRepository } from '../audit/audit-log-store.js';
import {
  createHttpCatalogLookupService,
  type CatalogLookupCandidate,
  type CatalogLookupService,
} from '../catalog/catalog-lookup-service.js';
import {
  createCatalogFamily,
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
import type { WikipediaBoardGameCatalogDraft, WikipediaBoardGameImportResult, WikipediaBoardGameImportService } from '../catalog/wikipedia-boardgame-import-service.js';
import { createDatabaseCatalogRepository } from '../catalog/catalog-store.js';
import { createDatabaseCatalogLoanRepository } from '../catalog/catalog-loan-store.js';
import { createWikipediaBoardGameImportService } from '../catalog/wikipedia-boardgame-import-service.js';
import { buildLoanDetailButtons, buildLoanItemButton, formatLoanAvailabilityLines, resolveLoanBorrowerDisplayName, type TelegramCatalogLoanContext } from './catalog-loan-flow.js';
import { buildTelegramStartUrl } from './deep-links.js';
import {
  escapeHtml,
  formatCatalogDescriptionLine,
  formatHtmlField,
  renderCatalogItemType,
  renderCatalogOptionalObject,
  renderCatalogPlayerRange,
} from './catalog-presentation.js';
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
const catalogAdminStartPayloadPrefix = 'catalog_admin_item_';

export const catalogAdminCallbackPrefixes = {
  browseMenu: 'catalog_admin:browse_menu',
  browseFamily: 'catalog_admin:browse_family:',
  browseSearch: 'catalog_admin:browse_search',
  inspect: 'catalog_admin:inspect:',
  inspectGroup: 'catalog_admin:inspect_group:',
  edit: 'catalog_admin:edit:',
  deactivate: 'catalog_admin:deactivate:',
  editMedia: 'catalog_admin:edit_media:',
  deleteMedia: 'catalog_admin:delete_media:',
} as const;

export const catalogAdminLabels = {
  openMenu: 'Cataleg',
  create: 'Crear item',
  list: 'Llistar items',
  searchByName: 'Cerca per nom',
  edit: 'Editar item',
  deactivate: 'Desactivar item',
  typeBoardGame: 'Joc de taula',
  typeExpansion: 'Expansio',
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
  start: '/start',
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
}

export async function handleTelegramCatalogAdminText(context: TelegramCatalogAdminContext): Promise<boolean> {
  const text = context.messageText?.trim();
  if (!text || context.runtime.chat.kind !== 'private' || !canManageCatalog(context)) {
    return false;
  }

  if (isCatalogAdminSession(context.runtime.session.current?.flowKey)) {
    return handleActiveCatalogSession(context, text);
  }

  if (text === catalogAdminLabels.openMenu || text === '/catalog') {
    await showCatalogBrowseMenu(context);
    return true;
  }
  if (text === catalogAdminLabels.create || text === '/catalog_create') {
    await context.runtime.session.start({ flowKey: createFlowKey, stepKey: 'item-type', data: {} });
    await context.reply('Selecciona el tipus d item.', buildTypeOptions());
    return true;
  }
  if (text === catalogAdminLabels.list || text === '/catalog_list') {
    await replyWithCatalogList(context, 'list');
    return true;
  }
  if (text === catalogAdminLabels.edit || text === '/catalog_edit') {
    await replyWithCatalogList(context, 'edit');
    return true;
  }
  if (text === catalogAdminLabels.deactivate || text === '/catalog_deactivate') {
    await replyWithCatalogList(context, 'deactivate');
    return true;
  }
  return false;
}

export async function handleTelegramCatalogAdminStartText(context: TelegramCatalogAdminContext): Promise<boolean> {
  const payload = parseCatalogAdminStartPayload(context.messageText);
  if (payload === null || context.runtime.chat.kind !== 'private' || !canManageCatalog(context)) {
    return false;
  }

  const item = await loadItemOrThrow(context, payload);
  await context.reply(await formatCatalogItemDetails(context, item), {
    parseMode: 'HTML',
    inlineKeyboard: await buildCatalogItemDetailButtons(context, item),
  });
  return true;
}

export async function handleTelegramCatalogAdminCallback(context: TelegramCatalogAdminContext): Promise<boolean> {
  const callbackData = context.callbackData;
  if (!callbackData || context.runtime.chat.kind !== 'private' || !canManageCatalog(context)) {
    return false;
  }

  if (callbackData === catalogAdminCallbackPrefixes.browseMenu) {
    await showCatalogBrowseMenu(context);
    return true;
  }
  if (callbackData === catalogAdminCallbackPrefixes.browseSearch) {
    await context.runtime.session.start({ flowKey: browseFlowKey, stepKey: 'search-query', data: {} });
    await context.reply('Escriu el nom, o part del nom, del que vols cercar al cataleg.', buildSingleCancelKeyboard());
    return true;
  }
  if (callbackData.startsWith(catalogAdminCallbackPrefixes.browseFamily)) {
    const familyId = parseItemId(callbackData, catalogAdminCallbackPrefixes.browseFamily);
    await showCatalogFamilyBrowse(context, familyId);
    return true;
  }

  if (callbackData.startsWith(catalogAdminCallbackPrefixes.inspect)) {
    const itemId = parseItemId(callbackData, catalogAdminCallbackPrefixes.inspect);
    const item = await loadItemOrThrow(context, itemId);
    await context.reply(await formatCatalogItemDetails(context, item), {
      parseMode: 'HTML',
      inlineKeyboard: await buildCatalogItemDetailButtons(context, item),
    });
    return true;
  }
  if (callbackData.startsWith(catalogAdminCallbackPrefixes.inspectGroup)) {
    const groupId = parseItemId(callbackData, catalogAdminCallbackPrefixes.inspectGroup);
    const group = await loadGroupOrThrow(context, groupId);
    const items = await listCatalogItems({ repository: resolveCatalogRepository(context), groupId, includeDeactivated: true });
    const inlineKeyboard = await Promise.all(
      items.map(async (item) => buildLoanItemButton(await loadActiveLoanByItemIdAdmin(context, item.id), item.id, item.displayName)),
    );
    await context.reply(await formatCatalogGroupDetails(context, group), {
      inlineKeyboard,
    });
    return true;
  }
  if (callbackData.startsWith(catalogAdminCallbackPrefixes.edit)) {
    const itemId = parseItemId(callbackData, catalogAdminCallbackPrefixes.edit);
    const item = await loadItemOrThrow(context, itemId);
    await context.runtime.session.start({ flowKey: editFlowKey, stepKey: 'select-field', data: { itemId } });
    await context.reply(`${await formatCatalogItemDetails(context, item)}

Quin camp vols editar primer?`, { ...buildEditFieldMenuOptions(item.itemType), parseMode: 'HTML' });
    return true;
  }
  if (callbackData.startsWith(catalogAdminCallbackPrefixes.deactivate)) {
    const itemId = parseItemId(callbackData, catalogAdminCallbackPrefixes.deactivate);
    const item = await loadItemOrThrow(context, itemId);
    await context.runtime.session.start({ flowKey: deactivateFlowKey, stepKey: 'confirm', data: { itemId } });
    await context.reply(`${await formatCatalogItemDetails(context, item)}

Si el desactives, deixara d aparéixer als fluxos operatius futurs pero es mantindra per a consultes historiques.`, { ...buildDeactivateConfirmOptions(), parseMode: 'HTML' });
    return true;
  }
  if (callbackData.startsWith(catalogAdminCallbackPrefixes.editMedia)) {
    const mediaId = parseItemId(callbackData, catalogAdminCallbackPrefixes.editMedia);
    const media = await loadMediaOrThrow(context, mediaId);
    await context.runtime.session.start({
      flowKey: mediaFlowKey,
      stepKey: 'media-type',
      data: {
        mediaId,
        itemId: media.itemId,
        mediaType: media.mediaType,
        url: media.url,
        altText: media.altText,
        sortOrder: media.sortOrder,
      },
    });
    await context.reply('Selecciona el tipus de media o mantingues el valor actual.', buildEditMediaTypeOptions());
    return true;
  }
  if (callbackData.startsWith(catalogAdminCallbackPrefixes.deleteMedia)) {
    const mediaId = parseItemId(callbackData, catalogAdminCallbackPrefixes.deleteMedia);
    const media = await loadMediaOrThrow(context, mediaId);
    await context.runtime.session.start({ flowKey: mediaDeleteFlowKey, stepKey: 'confirm', data: { mediaId, itemId: media.itemId } });
    await context.reply(`Vols eliminar aquest media?
- ${media.mediaType} · ${media.url}`, buildMediaDeleteConfirmOptions());
    return true;
  }
  return false;
}

function canManageCatalog(context: TelegramCatalogAdminContext): boolean {
  return context.runtime.actor.isAdmin || context.runtime.authorization.can('catalog.manage');
}

function isCatalogAdminSession(flowKey: string | undefined): boolean {
  return flowKey === createFlowKey || flowKey === editFlowKey || flowKey === deactivateFlowKey || flowKey === mediaFlowKey || flowKey === mediaDeleteFlowKey || flowKey === browseFlowKey;
}

async function handleActiveCatalogSession(context: TelegramCatalogAdminContext, text: string): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session) {
    return false;
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
    return handleMediaSession(context, text, session.stepKey, session.data);
  }
  if (session.flowKey === mediaDeleteFlowKey) {
    return handleMediaDeleteSession(context, text, session.data);
  }
  if (session.flowKey === browseFlowKey) {
    return handleBrowseSession(context, text, session.stepKey, session.data);
  }
  return false;
}

async function handleCreateSession(
  context: TelegramCatalogAdminContext,
  text: string,
  stepKey: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  if (stepKey === 'item-type') {
    const itemType = parseItemTypeLabel(text);
    if (itemType instanceof Error) {
      await context.reply('Tria un tipus valid del teclat.', buildTypeOptions());
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'display-name', data: { ...data, itemType } });
    await context.reply('Escriu el titol visible de l item.', buildSingleCancelKeyboard());
    return true;
  }
  if (stepKey === 'display-name') {
    const itemType = String(data.itemType) as CatalogItemType;
    const nextData = { ...data, displayName: text };
    if (itemType === 'board-game') {
      await context.reply('Buscant a Wikipedia el joc i la millor coincidencia...', buildSingleCancelKeyboard());
      const importResult = await importWikipediaBoardGameDraft(context, text);
      if (importResult.ok) {
        await createWikipediaImportedBoardGame(context, nextData, importResult.draft, text);
        return true;
      }

      if (importResult.error.type === 'ambiguous') {
        await context.runtime.session.advance({
          stepKey: 'wikipedia-candidate-choice',
          data: {
            ...nextData,
            wikipediaCandidates: importResult.error.candidates ?? [],
          },
        });
        await context.reply(
          `${importResult.error.message}\n\nEscull una de les opcions, entra la URL manualment o omet la importacio.`,
          buildWikipediaCandidateOptions(importResult.error.candidates ?? []),
        );
        return true;
      }

      await context.runtime.session.advance({ stepKey: 'wikipedia-url', data: nextData });
      await context.reply(
        `${importWikipediaErrorMessage(importResult)}\n\nSi tens la URL completa de la pagina de Wikipedia, enganxa-la ara. Si no, tria No importar dades per continuar manualment.`,
        buildWikipediaUrlOptions(),
      );
      return true;
    }
    const lookupCandidates = await searchCatalogLookupCandidates(context, {
      itemType,
      displayName: text,
    });
    if (lookupCandidates.length > 0) {
      await context.runtime.session.advance({ stepKey: 'lookup-choice', data: { ...nextData, lookupCandidates } });
      await context.reply(
        buildLookupChoicePrompt(lookupCandidates),
        buildLookupChoiceOptions(lookupCandidates),
      );
      return true;
    }

    await context.runtime.session.advance({ stepKey: 'family', data: nextData });
    await context.reply(await buildFamilyPrompt(context, itemType), await buildFamilyOptions(context, itemType));
    return true;
  }
  if (stepKey === 'family') {
    const itemType = String(data.itemType) as CatalogItemType;
    const familyId = await parseFamilyInput(context, text, itemType);
    if (familyId instanceof Error) {
      await context.reply(
        itemType === 'rpg-book' || itemType === 'book'
          ? 'Escriu o tria una familia valida, o continua sense familia.'
          : 'Tria una familia valida pel seu id o continua sense familia.',
        await buildFamilyOptions(context, itemType),
      );
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'group', data: { ...data, familyId } });
    await context.reply(await buildGroupPrompt(context, familyId), buildGroupOptions());
    return true;
  }
  if (stepKey === 'lookup-choice') {
    if (text === catalogAdminLabels.skipLookupImport) {
      const itemType = String(data.itemType) as CatalogItemType;
      await context.runtime.session.advance({ stepKey: 'family', data });
      await context.reply(await buildFamilyPrompt(context, itemType), await buildFamilyOptions(context, itemType));
      return true;
    }
    if (text === catalogAdminLabels.refineLookupByAuthor) {
      await context.runtime.session.advance({ stepKey: 'lookup-author', data });
      await context.reply('Escriu el nom de l autor per refinar la cerca.', buildSingleCancelKeyboard());
      return true;
    }
    const lookupCandidate = parseLookupCandidateInput(text, data.lookupCandidates);
    if (lookupCandidate instanceof Error) {
      const refined = await refineLookupCandidatesByAuthor(context, data, text);
      if (refined) {
        return true;
      }
      await context.reply('Tria una coincidencia valida, escriu un autor per refinar la cerca o continua sense importar dades.', buildLookupChoiceOptions(asLookupCandidates(data.lookupCandidates)));
      return true;
    }

    const nextData = applyLookupCandidateToDraft(data, lookupCandidate);
    if (!isExactTitleMatch(String(data.displayName ?? ''), lookupCandidate.title)) {
      await context.runtime.session.advance({ stepKey: 'lookup-title-choice', data: { ...nextData, selectedLookupCandidate: lookupCandidate } });
      await context.reply(
        buildLookupTitleChoicePrompt(String(data.displayName ?? ''), lookupCandidate.title),
        buildLookupTitleChoiceOptions(),
      );
      return true;
    }

    const itemType = String(data.itemType) as CatalogItemType;
    await context.runtime.session.advance({ stepKey: 'family', data: nextData });
    await context.reply(await buildFamilyPrompt(context, itemType), await buildFamilyOptions(context, itemType));
    return true;
  }
  if (stepKey === 'lookup-title-choice') {
    const itemType = String(data.itemType) as CatalogItemType;
    const lookupCandidate = asLookupCandidate(data.selectedLookupCandidate);
    if (text === catalogAdminLabels.keepTypedTitle) {
      await context.runtime.session.advance({ stepKey: 'family', data: { ...data, displayName: String(data.displayName ?? '') } });
      await context.reply(await buildFamilyPrompt(context, itemType), await buildFamilyOptions(context, itemType));
      return true;
    }
    if (text === catalogAdminLabels.useApiTitle) {
      await context.runtime.session.advance({ stepKey: 'family', data: { ...data, displayName: lookupCandidate.title } });
      await context.reply(await buildFamilyPrompt(context, itemType), await buildFamilyOptions(context, itemType));
      return true;
    }
    await context.reply('Tria quin titol vols fer servir abans de continuar.', buildLookupTitleChoiceOptions());
    return true;
  }
  if (stepKey === 'lookup-author') {
    const refined = await refineLookupCandidatesByAuthor(context, data, text);
    if (refined) {
      return true;
    }
    await context.reply('No he trobat cap coincidencia amb aquest autor. Escriu un altre autor o cancel.la el flux.', buildSingleCancelKeyboard());
    return true;
  }
  if (stepKey === 'wikipedia-url') {
    const itemType = String(data.itemType) as CatalogItemType;
    if (text === catalogAdminLabels.skipLookupImport) {
      await context.runtime.session.advance({ stepKey: 'family', data });
      await context.reply(await buildFamilyPrompt(context, itemType), await buildFamilyOptions(context, itemType));
      return true;
    }

    const wikipediaTitle = parseWikipediaTitleFromUrl(text);
    if (!wikipediaTitle) {
      await context.reply('Enganxa una URL valida de Wikipedia o tria No importar dades per continuar manualment.', buildWikipediaUrlOptions());
      return true;
    }

    await context.reply('Torno a provar la importacio amb la pagina de Wikipedia que has passat...', buildSingleCancelKeyboard());
    const importResult = await importWikipediaBoardGameDraft(context, wikipediaTitle);
    if (importResult.ok) {
      await createWikipediaImportedBoardGame(context, data, importResult.draft, wikipediaTitle);
      return true;
    }

    await context.reply(
      `${importWikipediaErrorMessage(importResult)}\n\nSi vols, enganxa una altra URL o tria No importar dades per continuar manualment.`,
      buildWikipediaUrlOptions(),
    );
    return true;
  }
  if (stepKey === 'wikipedia-candidate-choice') {
    const itemType = String(data.itemType) as CatalogItemType;
    const wikipediaCandidates = asStringArray(data.wikipediaCandidates);
    if (text === catalogAdminLabels.skipLookupImport) {
      await context.runtime.session.advance({ stepKey: 'family', data });
      await context.reply(await buildFamilyPrompt(context, itemType), await buildFamilyOptions(context, itemType));
      return true;
    }

    if (text === catalogAdminLabels.manualWikipediaUrl) {
      await context.runtime.session.advance({ stepKey: 'wikipedia-url', data });
      await context.reply('Enganxa la URL completa de la pagina de Wikipedia.', buildWikipediaUrlOptions());
      return true;
    }

    const selectedTitle = wikipediaCandidates.find((candidate) => candidate === text)
      ?? wikipediaCandidates.find((candidate) => normalizeTitleForComparison(candidate) === normalizeTitleForComparison(text));
    if (!selectedTitle) {
      await context.reply('Escull una de les opcions del teclat, entra la URL manualment o omet la importacio.', buildWikipediaCandidateOptions(wikipediaCandidates));
      return true;
    }

    await context.reply(`Torno a provar la importacio amb ${selectedTitle}...`, buildSingleCancelKeyboard());
    const importResult = await importWikipediaBoardGameDraft(context, selectedTitle);
    if (importResult.ok) {
      await createWikipediaImportedBoardGame(context, data, importResult.draft, selectedTitle);
      return true;
    }

    if (importResult.error.type === 'ambiguous') {
      await context.runtime.session.advance({
        stepKey: 'wikipedia-candidate-choice',
        data: {
          ...data,
          wikipediaCandidates: importResult.error.candidates ?? wikipediaCandidates,
        },
      });
      await context.reply(
        `${importResult.error.message}\n\nEscull una de les opcions, entra la URL manualment o omet la importacio.`,
        buildWikipediaCandidateOptions(importResult.error.candidates ?? wikipediaCandidates),
      );
      return true;
    }

    await context.reply(
      `${importWikipediaErrorMessage(importResult)}\n\nPots provar una altra opcio, entrar la URL manualment o ometre la importacio.`,
      buildWikipediaCandidateOptions(wikipediaCandidates),
    );
    return true;
  }
  if (stepKey === 'group') {
    const groupId = await parseGroupInput(context, text, asNullableNumber(data.familyId));
    if (groupId instanceof Error) {
      await context.reply('Tria un grup valid pel seu id o continua sense grup.', buildGroupOptions());
      return true;
    }
    const nextData = { ...data, groupId };
    if (String(data.itemType ?? 'board-game') === 'board-game') {
      await context.runtime.session.advance({ stepKey: 'confirm', data: nextData });
      await context.reply(`${await formatDraftSummary(context, nextData)}

Tria una opcio per confirmar o cancel.lar.`, { ...buildCreateConfirmOptions(), parseMode: 'HTML' });
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'original-name', data: nextData });
    await context.reply('Escriu el nom original opcional o tria una opcio del teclat.', buildCreateOptionalKeyboard(asNullableString(data.originalName)));
    return true;
  }
  if (stepKey === 'original-name') {
    await context.runtime.session.advance({
      stepKey: 'description',
      data: {
        ...data,
        originalName: text === catalogAdminLabels.keepCurrent ? asNullableString(data.originalName) : text === catalogAdminLabels.skipOptional ? null : text,
      },
    });
    await context.reply('Escriu una descripcio opcional o tria una opcio del teclat.', buildCreateOptionalKeyboard(asNullableString(data.description)));
    return true;
  }
  if (stepKey === 'description') {
    await context.runtime.session.advance({
      stepKey: 'language',
      data: {
        ...data,
        description: text === catalogAdminLabels.keepCurrent ? asNullableString(data.description) : text === catalogAdminLabels.skipOptional ? null : text,
      },
    });
    await context.reply('Escriu la llengua principal o tria una opcio del teclat.', buildCreateOptionalKeyboard(asNullableString(data.language)));
    return true;
  }
  if (stepKey === 'language') {
    await context.runtime.session.advance({
      stepKey: 'publisher',
      data: {
        ...data,
        language: text === catalogAdminLabels.keepCurrent ? asNullableString(data.language) : text === catalogAdminLabels.skipOptional ? null : text,
      },
    });
    await context.reply('Escriu l editorial o tria una opcio del teclat.', buildCreateOptionalKeyboard(asNullableString(data.publisher)));
    return true;
  }
  if (stepKey === 'publisher') {
    await context.runtime.session.advance({
      stepKey: 'publication-year',
      data: {
        ...data,
        publisher: text === catalogAdminLabels.keepCurrent ? asNullableString(data.publisher) : text === catalogAdminLabels.skipOptional ? null : text,
      },
    });
    await context.reply('Escriu l any de publicacio o tria una opcio del teclat.', buildCreateOptionalKeyboard(asNullableNumber(data.publicationYear)));
    return true;
  }
  if (stepKey === 'publication-year') {
    const publicationYear = text === catalogAdminLabels.keepCurrent ? asNullableNumber(data.publicationYear) : parseOptionalPositiveInteger(text);
    if (publicationYear instanceof Error) {
      await context.reply('L any de publicacio ha de ser un enter positiu valid o omet el camp.', buildCreateOptionalKeyboard(asNullableNumber(data.publicationYear)));
      return true;
    }
    const nextStepKey = itemTypeSupportsPlayers(String(data.itemType ?? 'board-game') as CatalogItemType) ? 'player-min' : 'recommended-age';
    await context.runtime.session.advance({ stepKey: nextStepKey, data: { ...data, publicationYear } });
    await context.reply(
      nextStepKey === 'player-min' ? 'Escriu el minim de jugadors o tria una opcio del teclat.' : 'Escriu l edat recomanada o tria una opcio del teclat.',
      nextStepKey === 'player-min'
        ? buildCreateOptionalKeyboard(asNullableNumber(data.playerCountMin))
        : buildCreateOptionalKeyboard(asNullableNumber(data.recommendedAge)),
    );
    return true;
  }
  if (stepKey === 'player-min') {
    const playerCountMin = text === catalogAdminLabels.keepCurrent ? asNullableNumber(data.playerCountMin) : parseOptionalPositiveInteger(text);
    if (playerCountMin instanceof Error) {
      await context.reply('El minim de jugadors ha de ser un enter positiu valid o omet el camp.', buildCreateOptionalKeyboard(asNullableNumber(data.playerCountMin)));
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'player-max', data: { ...data, playerCountMin } });
    await context.reply('Escriu el maxim de jugadors o tria una opcio del teclat.', buildCreateOptionalKeyboard(asNullableNumber(data.playerCountMax)));
    return true;
  }
  if (stepKey === 'player-max') {
    const playerCountMax = text === catalogAdminLabels.keepCurrent ? asNullableNumber(data.playerCountMax) : parseOptionalPositiveInteger(text);
    if (playerCountMax instanceof Error) {
      await context.reply('El maxim de jugadors ha de ser un enter positiu valid o omet el camp.', buildCreateOptionalKeyboard(asNullableNumber(data.playerCountMax)));
      return true;
    }
    if (
      playerCountMax !== null &&
      typeof data.playerCountMin === 'number' &&
      playerCountMax < data.playerCountMin
    ) {
      await context.reply('El maxim de jugadors no pot ser inferior al minim. Escriu un enter positiu valid o omet el camp.', buildCreateOptionalKeyboard(asNullableNumber(data.playerCountMax)));
      return true;
    }
    const nextData = { ...data, playerCountMax };
    await context.runtime.session.advance({ stepKey: 'recommended-age', data: nextData });
    await context.reply('Escriu l edat recomanada o tria una opcio del teclat.', buildCreateOptionalKeyboard(asNullableNumber(data.recommendedAge)));
    return true;
  }
  if (stepKey === 'recommended-age') {
    const recommendedAge = text === catalogAdminLabels.keepCurrent ? asNullableNumber(data.recommendedAge) : parseOptionalPositiveInteger(text);
    if (recommendedAge instanceof Error) {
      await context.reply('L edat recomanada ha de ser un enter positiu valid o omet el camp.', buildCreateOptionalKeyboard(asNullableNumber(data.recommendedAge)));
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'play-time-minutes', data: { ...data, recommendedAge } });
    await context.reply('Escriu la durada en minuts o tria una opcio del teclat.', buildCreateOptionalKeyboard(asNullableNumber(data.playTimeMinutes)));
    return true;
  }
  if (stepKey === 'play-time-minutes') {
    const playTimeMinutes = text === catalogAdminLabels.keepCurrent ? asNullableNumber(data.playTimeMinutes) : parseOptionalPositiveInteger(text);
    if (playTimeMinutes instanceof Error) {
      await context.reply('La durada ha de ser un enter positiu valid o omet el camp.', buildCreateOptionalKeyboard(asNullableNumber(data.playTimeMinutes)));
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'external-refs', data: { ...data, playTimeMinutes } });
    await context.reply('Escriu referencies externes en JSON o tria una opcio del teclat.', buildCreateOptionalKeyboard(asNullableObject(data.externalRefs)));
    return true;
  }
  if (stepKey === 'external-refs') {
    const externalRefs = text === catalogAdminLabels.keepCurrent ? asNullableObject(data.externalRefs) : parseOptionalJsonObject(text);
    if (externalRefs instanceof Error) {
      await context.reply('Les referencies externes han de ser un objecte JSON valid o omet el camp.', buildCreateOptionalKeyboard(asNullableObject(data.externalRefs)));
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'metadata', data: { ...data, externalRefs } });
    await context.reply('Escriu metadata addicional en JSON o tria una opcio del teclat.', buildCreateOptionalKeyboard(asNullableObject(data.metadata)));
    return true;
  }
    if (stepKey === 'metadata') {
      const metadata = text === catalogAdminLabels.keepCurrent ? asNullableObject(data.metadata) : parseOptionalJsonObject(text);
      if (metadata instanceof Error) {
        await context.reply('La metadata ha de ser un objecte JSON valid o omet el camp.', buildCreateOptionalKeyboard(asNullableObject(data.metadata)));
        return true;
      }
      const nextData = { ...data, metadata };
      await context.runtime.session.advance({ stepKey: 'confirm', data: nextData });
      await context.reply(`${await formatDraftSummary(context, nextData)}

Tria una opcio per confirmar o cancel.lar.`, buildCreateConfirmOptions());
      return true;
    }
  if (stepKey === 'confirm') {
    if (text !== catalogAdminLabels.confirmCreate) {
      await context.reply('Per guardar l item, tria el boto de confirmacio o cancel.la el flux.', buildCreateConfirmOptions());
      return true;
    }
    const item = await createCatalogItem({
      repository: resolveCatalogRepository(context),
      familyId: (data.familyId as number | null | undefined) ?? null,
      groupId: (data.groupId as number | null | undefined) ?? null,
      itemType: String(data.itemType ?? 'board-game') as CatalogItemType,
      displayName: String(data.displayName ?? ''),
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
    if (item.itemType === 'board-game') {
      await context.runtime.session.start({
        flowKey: editFlowKey,
        stepKey: 'select-field',
        data: { itemId: item.id },
      });
      await context.reply(
        `Item de cataleg creat correctament: ${item.displayName} (#${item.id}). Ara el pots editar camp a camp.`,
        buildEditFieldMenuOptions(item.itemType),
      );
      return true;
    }
    await context.runtime.session.cancel();
    await context.reply(`Item de cataleg creat correctament: ${item.displayName} (#${item.id}).`, buildCatalogAdminMenuOptions());
    return true;
  }
  return false;
}

async function handleEditSession(
  context: TelegramCatalogAdminContext,
  text: string,
  stepKey: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  const itemId = Number(data.itemId);
  const item = await loadItemOrThrow(context, itemId);
  if (stepKey === 'select-field') {
    if (text === catalogAdminLabels.confirmEdit) {
      await saveEditDraftAndReturn(context, item, data);
      return true;
    }
    const currentItemType = getDraftItemType(item, data);
    switch (text) {
      case catalogAdminLabels.editFieldDisplayName:
        await context.runtime.session.advance({ stepKey: 'display-name', data });
        await context.reply('Escriu el nou nom visible.', buildSingleCancelKeyboard());
        return true;
      case catalogAdminLabels.editFieldItemType:
        await context.runtime.session.advance({ stepKey: 'item-type', data });
        await context.reply('Selecciona el nou tipus d item.', buildTypeOptions());
        return true;
      case catalogAdminLabels.editFieldFamily:
        await context.runtime.session.advance({ stepKey: 'family', data });
        await context.reply(await buildFamilyPrompt(context, currentItemType), await buildFamilyOptions(context, currentItemType));
        return true;
      case catalogAdminLabels.editFieldGroup:
        await context.runtime.session.advance({ stepKey: 'group', data });
        await context.reply(await buildGroupPrompt(context, getDraftFamilyId(item, data)), buildGroupOptions());
        return true;
      case catalogAdminLabels.editFieldOriginalName:
        await context.runtime.session.advance({ stepKey: 'original-name', data });
        await context.reply('Escriu el nou nom original o omet el camp.', buildSkipOptionalKeyboard());
        return true;
      case catalogAdminLabels.editFieldDescription:
        await context.runtime.session.advance({ stepKey: 'description', data });
        await context.reply('Escriu la nova descripcio o omet el camp.', buildSkipOptionalKeyboard());
        return true;
      case catalogAdminLabels.editFieldLanguage:
        await context.runtime.session.advance({ stepKey: 'language', data });
        await context.reply('Escriu la nova llengua o omet el camp.', buildSkipOptionalKeyboard());
        return true;
      case catalogAdminLabels.editFieldPublisher:
        await context.runtime.session.advance({ stepKey: 'publisher', data });
        await context.reply('Escriu la nova editorial o omet el camp.', buildSkipOptionalKeyboard());
        return true;
      case catalogAdminLabels.editFieldPublicationYear:
        await context.runtime.session.advance({ stepKey: 'publication-year', data });
        await context.reply('Escriu el nou any de publicacio o omet el camp.', buildSkipOptionalKeyboard());
        return true;
      case catalogAdminLabels.editFieldPlayerMin:
        await context.runtime.session.advance({ stepKey: 'player-min', data });
        await context.reply('Escriu el nou minim de jugadors o omet el camp.', buildSkipOptionalKeyboard());
        return true;
      case catalogAdminLabels.editFieldPlayerMax:
        await context.runtime.session.advance({ stepKey: 'player-max', data });
        await context.reply('Escriu el nou maxim de jugadors o omet el camp.', buildSkipOptionalKeyboard());
        return true;
      case catalogAdminLabels.editFieldRecommendedAge:
        await context.runtime.session.advance({ stepKey: 'recommended-age', data });
        await context.reply('Escriu la nova edat recomanada o omet el camp.', buildSkipOptionalKeyboard());
        return true;
      case catalogAdminLabels.editFieldPlayTimeMinutes:
        await context.runtime.session.advance({ stepKey: 'play-time-minutes', data });
        await context.reply('Escriu la nova durada en minuts o omet el camp.', buildSkipOptionalKeyboard());
        return true;
      case catalogAdminLabels.editFieldExternalRefs:
        await context.runtime.session.advance({ stepKey: 'external-refs', data });
        await context.reply('Escriu les noves referencies externes en JSON o omet el camp.', buildSkipOptionalKeyboard());
        return true;
      case catalogAdminLabels.editFieldMetadata:
        await context.runtime.session.advance({ stepKey: 'metadata', data });
        await context.reply('Escriu la nova metadata en JSON o omet el camp.', buildSkipOptionalKeyboard());
        return true;
      default:
        await context.reply('Tria un camp del teclat o guarda els canvis quan hagis acabat.', buildEditFieldMenuOptions(currentItemType));
        return true;
    }
  }
  if (stepKey === 'display-name') {
    return updateEditDraftAndReturn(context, item, data, { displayName: text });
  }
  if (stepKey === 'item-type') {
    const itemType = parseItemTypeLabel(text);
    if (itemType instanceof Error) {
      await context.reply('Tria un tipus valid del teclat.', buildTypeOptions());
      return true;
    }
    return updateEditDraftAndReturn(context, item, data, {
      itemType,
      ...(!itemTypeSupportsPlayers(itemType) ? { playerCountMin: null, playerCountMax: null } : {}),
    });
  }
  if (stepKey === 'family') {
    const familyId = await parseFamilyInput(context, text, getDraftItemType(item, data));
    if (familyId instanceof Error) {
      await context.reply('Tria una familia valida pel seu id o continua sense familia.', await buildFamilyOptions(context, getDraftItemType(item, data)));
      return true;
    }
    const nextData = await withCompatibleGroup(context, item, { ...data, familyId }, familyId);
    return updateEditDraftAndReturn(context, item, data, nextData);
  }
  if (stepKey === 'group') {
    const groupId = await parseGroupInput(context, text, getDraftFamilyId(item, data));
    if (groupId instanceof Error) {
      await context.reply('Tria un grup valid pel seu id o continua sense grup.', buildGroupOptions());
      return true;
    }
    return updateEditDraftAndReturn(context, item, data, { groupId });
  }
  if (stepKey === 'original-name') {
    return updateEditDraftAndReturn(context, item, data, { originalName: text === catalogAdminLabels.skipOptional ? null : text });
  }
  if (stepKey === 'description') {
    return updateEditDraftAndReturn(context, item, data, { description: text === catalogAdminLabels.skipOptional ? null : text });
  }
  if (stepKey === 'language') {
    return updateEditDraftAndReturn(context, item, data, { language: text === catalogAdminLabels.skipOptional ? null : text });
  }
  if (stepKey === 'publisher') {
    return updateEditDraftAndReturn(context, item, data, { publisher: text === catalogAdminLabels.skipOptional ? null : text });
  }
  if (stepKey === 'publication-year') {
    const publicationYear = parseOptionalPositiveInteger(text);
    if (publicationYear instanceof Error) {
      await context.reply('L any de publicacio ha de ser un enter positiu valid o omet el camp.', buildSkipOptionalKeyboard());
      return true;
    }
    return updateEditDraftAndReturn(context, item, data, { publicationYear });
  }
  if (stepKey === 'player-min') {
    const playerCountMin = parseOptionalPositiveInteger(text);
    if (playerCountMin instanceof Error) {
      await context.reply('El minim de jugadors ha de ser un enter positiu valid o omet el camp.', buildSkipOptionalKeyboard());
      return true;
    }
    return updateEditDraftAndReturn(context, item, data, { playerCountMin });
  }
  if (stepKey === 'player-max') {
    const playerCountMax = parseOptionalPositiveInteger(text);
    if (playerCountMax instanceof Error) {
      await context.reply('El maxim de jugadors ha de ser un enter positiu valid o omet el camp.', buildSkipOptionalKeyboard());
      return true;
    }
    const candidateMin = hasOwn(data, 'playerCountMin') ? asNullableNumber(data.playerCountMin) : item.playerCountMin;
    if (playerCountMax !== null && candidateMin !== null && playerCountMax < candidateMin) {
      await context.reply('El maxim de jugadors no pot ser inferior al minim. Escriu un enter positiu valid o omet el camp.', buildSkipOptionalKeyboard());
      return true;
    }
    return updateEditDraftAndReturn(context, item, data, { playerCountMax });
  }
  if (stepKey === 'recommended-age') {
    const recommendedAge = parseOptionalPositiveInteger(text);
    if (recommendedAge instanceof Error) {
      await context.reply('L edat recomanada ha de ser un enter positiu valid o omet el camp.', buildSkipOptionalKeyboard());
      return true;
    }
    return updateEditDraftAndReturn(context, item, data, { recommendedAge });
  }
  if (stepKey === 'play-time-minutes') {
    const playTimeMinutes = parseOptionalPositiveInteger(text);
    if (playTimeMinutes instanceof Error) {
      await context.reply('La durada ha de ser un enter positiu valid o omet el camp.', buildSkipOptionalKeyboard());
      return true;
    }
    return updateEditDraftAndReturn(context, item, data, { playTimeMinutes });
  }
  if (stepKey === 'external-refs') {
    const externalRefs = parseOptionalJsonObject(text);
    if (externalRefs instanceof Error) {
      await context.reply('Les referencies externes han de ser un objecte JSON valid o omet el camp.', buildSkipOptionalKeyboard());
      return true;
    }
    return updateEditDraftAndReturn(context, item, data, { externalRefs });
  }
  if (stepKey === 'metadata') {
    const metadata = parseOptionalJsonObject(text);
    if (metadata instanceof Error) {
      await context.reply('La metadata ha de ser un objecte JSON valid o omet el camp.', buildSkipOptionalKeyboard());
      return true;
    }
    return updateEditDraftAndReturn(context, item, data, { metadata });
  }
  return false;
}

async function handleDeactivateSession(
  context: TelegramCatalogAdminContext,
  text: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  if (text !== catalogAdminLabels.confirmDeactivate) {
    await context.reply('Per desactivar l item, tria el boto de confirmacio o cancel.la el flux.', buildDeactivateConfirmOptions());
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
  await context.reply(`Item de cataleg desactivat correctament: ${item.displayName} (#${item.id}).`, buildCatalogAdminMenuOptions());
  return true;
}

async function handleMediaSession(
  context: TelegramCatalogAdminContext,
  text: string,
  stepKey: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  const isEditing = typeof data.mediaId === 'number';
  if (stepKey === 'media-type') {
    const mediaType = text === catalogAdminLabels.keepCurrent ? String(data.mediaType) : parseMediaTypeLabel(text);
    if (mediaType instanceof Error) {
      await context.reply('Tria un tipus de media valid del teclat.', isEditing ? buildEditMediaTypeOptions() : buildMediaTypeOptions());
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'url', data: { ...data, mediaType } });
    await context.reply('Escriu la URL del media.', isEditing ? buildKeepCurrentKeyboard() : buildSingleCancelKeyboard());
    return true;
  }
  if (stepKey === 'url') {
    await context.runtime.session.advance({
      stepKey: 'alt-text',
      data: { ...data, url: text === catalogAdminLabels.keepCurrent ? String(data.url ?? '') : text },
    });
    await context.reply(
      'Escriu el text alternatiu opcional o tria una opcio del teclat.',
      isEditing ? buildEditOptionalKeyboard() : buildSkipOptionalKeyboard(),
    );
    return true;
  }
  if (stepKey === 'alt-text') {
    await context.runtime.session.advance({
      stepKey: 'sort-order',
      data: {
        ...data,
        altText: text === catalogAdminLabels.keepCurrent ? asNullableString(data.altText) : text === catalogAdminLabels.skipOptional ? null : text,
      },
    });
    await context.reply(
      'Escriu l ordre del media o omet el camp per usar 0.',
      isEditing ? buildEditOptionalKeyboard() : buildSkipOptionalKeyboard(),
    );
    return true;
  }
  if (stepKey === 'sort-order') {
    const sortOrder = text === catalogAdminLabels.keepCurrent ? asNullableNumber(data.sortOrder) ?? 0 : parseOptionalNonNegativeInteger(text);
    if (sortOrder instanceof Error) {
      await context.reply(
        'L ordre del media ha de ser un enter positiu o zero, o pots ometre el camp.',
        isEditing ? buildEditOptionalKeyboard() : buildSkipOptionalKeyboard(),
      );
      return true;
    }
    const nextData = { ...data, sortOrder };
    await context.runtime.session.advance({ stepKey: 'confirm', data: nextData });
    await context.reply(buildMediaDraftSummary(nextData), isEditing ? buildMediaEditConfirmOptions() : buildMediaConfirmOptions());
    return true;
  }
  if (stepKey === 'confirm') {
    const expected = isEditing ? catalogAdminLabels.confirmMediaEdit : catalogAdminLabels.confirmMediaCreate;
    const options = isEditing ? buildMediaEditConfirmOptions() : buildMediaConfirmOptions();
    if (text !== expected) {
      await context.reply('Per guardar el media, tria el boto de confirmacio o cancel.la el flux.', options);
      return true;
    }
    const media = isEditing
      ? await updateCatalogMedia({
        repository: resolveCatalogRepository(context),
        mediaId: Number(data.mediaId),
        mediaType: String(data.mediaType) as CatalogMediaType,
        url: String(data.url ?? ''),
        altText: asNullableString(data.altText),
        sortOrder: asNullableNumber(data.sortOrder) ?? 0,
      })
      : await createCatalogMedia({
        repository: resolveCatalogRepository(context),
        familyId: null,
        itemId: Number(data.itemId),
        mediaType: String(data.mediaType) as CatalogMediaType,
        url: String(data.url ?? ''),
        altText: asNullableString(data.altText),
        ...(asNullableNumber(data.sortOrder) !== null ? { sortOrder: asNullableNumber(data.sortOrder)! } : {}),
      });
    await appendAuditEvent({
      repository: resolveAuditRepository(context),
      actorTelegramUserId: context.runtime.actor.telegramUserId,
      actionKey: isEditing ? 'catalog.media.updated' : 'catalog.media.created',
      targetType: 'catalog-media',
      targetId: media.id,
      summary: isEditing ? `Media de cataleg actualitzat #${media.id}` : `Media de cataleg creat per l item #${media.itemId}`,
      details: { itemId: media.itemId, mediaType: media.mediaType, url: media.url, sortOrder: media.sortOrder },
    });
    await context.runtime.session.cancel();
    await context.reply(
      isEditing ? `Media actualitzat correctament (#${media.id}).` : `Media afegit correctament a l item #${media.itemId}.`,
      buildCatalogAdminMenuOptions(),
    );
    return true;
  }
  return false;
}

async function handleMediaDeleteSession(
  context: TelegramCatalogAdminContext,
  text: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  if (text !== catalogAdminLabels.confirmMediaDelete) {
    await context.reply('Per eliminar el media, tria el boto de confirmacio o cancel.la el flux.', buildMediaDeleteConfirmOptions());
    return true;
  }
  await removeCatalogMedia({ repository: resolveCatalogRepository(context), mediaId: Number(data.mediaId) });
  await appendAuditEvent({
    repository: resolveAuditRepository(context),
    actorTelegramUserId: context.runtime.actor.telegramUserId,
    actionKey: 'catalog.media.deleted',
    targetType: 'catalog-media',
    targetId: Number(data.mediaId),
    summary: `Media de cataleg eliminat #${Number(data.mediaId)}`,
    details: { itemId: asNullableNumber(data.itemId) },
  });
  await context.runtime.session.cancel();
  await context.reply(`Media eliminat correctament (#${Number(data.mediaId)}).`, buildCatalogAdminMenuOptions());
  return true;
}

function buildCatalogAdminMenuOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [
      [catalogAdminLabels.create, catalogAdminLabels.list],
      [catalogAdminLabels.edit, catalogAdminLabels.deactivate],
      [catalogAdminLabels.searchByName],
      [catalogAdminLabels.start],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildTypeOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [
      [catalogAdminLabels.typeBoardGame, catalogAdminLabels.typeExpansion],
      [catalogAdminLabels.typeBook, catalogAdminLabels.typeRpgBook],
      [catalogAdminLabels.typeAccessory],
      [catalogAdminLabels.cancel],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildEditTypeOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [
      [catalogAdminLabels.keepCurrent],
      [catalogAdminLabels.typeBoardGame, catalogAdminLabels.typeExpansion],
      [catalogAdminLabels.typeBook, catalogAdminLabels.typeRpgBook],
      [catalogAdminLabels.typeAccessory],
      [catalogAdminLabels.cancel],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

async function buildFamilyOptions(
  context: TelegramCatalogAdminContext,
  itemType: CatalogItemType,
): Promise<TelegramReplyOptions> {
  if (itemType !== 'rpg-book' && itemType !== 'book' && itemType !== 'board-game') {
    return {
      replyKeyboard: [[catalogAdminLabels.noFamily], [catalogAdminLabels.cancel]],
      resizeKeyboard: true,
      persistentKeyboard: true,
    };
  }

  const popularFamilies = await listPopularFamilies(context, itemType);
  const replyKeyboard = chunkKeyboard(popularFamilies.map((family) => family.displayName), 3);
  replyKeyboard.push([catalogAdminLabels.noFamily], [catalogAdminLabels.cancel]);
  return {
    replyKeyboard,
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildEditFamilyOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[catalogAdminLabels.keepCurrent, catalogAdminLabels.noFamily], [catalogAdminLabels.cancel]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildGroupOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[catalogAdminLabels.noGroup], [catalogAdminLabels.cancel]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildEditGroupOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[catalogAdminLabels.keepCurrent, catalogAdminLabels.noGroup], [catalogAdminLabels.cancel]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildSkipOptionalKeyboard(): TelegramReplyOptions {
  return {
    replyKeyboard: [[catalogAdminLabels.skipOptional], [catalogAdminLabels.cancel]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildCreateOptionalKeyboard(currentValue: unknown): TelegramReplyOptions {
  return currentValue === null || currentValue === undefined
    ? buildSkipOptionalKeyboard()
    : buildEditOptionalKeyboard();
}

function buildEditOptionalKeyboard(): TelegramReplyOptions {
  return {
    replyKeyboard: [[catalogAdminLabels.keepCurrent, catalogAdminLabels.skipOptional], [catalogAdminLabels.cancel]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildEditFieldMenuOptions(itemType: CatalogItemType): TelegramReplyOptions {
  const replyKeyboard: string[][] = [
    [catalogAdminLabels.editFieldDisplayName, catalogAdminLabels.editFieldItemType],
    [catalogAdminLabels.editFieldFamily, catalogAdminLabels.editFieldGroup],
    [catalogAdminLabels.editFieldOriginalName, catalogAdminLabels.editFieldDescription],
    [catalogAdminLabels.editFieldLanguage, catalogAdminLabels.editFieldPublisher],
    [catalogAdminLabels.editFieldPublicationYear, catalogAdminLabels.editFieldRecommendedAge],
    [catalogAdminLabels.editFieldPlayTimeMinutes],
    [catalogAdminLabels.editFieldExternalRefs, catalogAdminLabels.editFieldMetadata],
  ];
  if (itemTypeSupportsPlayers(itemType)) {
    replyKeyboard.splice(5, 0, [catalogAdminLabels.editFieldPlayerMin, catalogAdminLabels.editFieldPlayerMax]);
  }
  replyKeyboard.push([catalogAdminLabels.confirmEdit], [catalogAdminLabels.cancel]);
  return {
    replyKeyboard,
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildCreateConfirmOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[catalogAdminLabels.confirmCreate], [catalogAdminLabels.cancel]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildEditConfirmOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[catalogAdminLabels.confirmEdit], [catalogAdminLabels.cancel]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildDeactivateConfirmOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[catalogAdminLabels.confirmDeactivate], [catalogAdminLabels.cancel]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildMediaTypeOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [
      [catalogAdminLabels.mediaTypeImage, catalogAdminLabels.mediaTypeLink],
      [catalogAdminLabels.mediaTypeDocument],
      [catalogAdminLabels.cancel],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildEditMediaTypeOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [
      [catalogAdminLabels.keepCurrent],
      [catalogAdminLabels.mediaTypeImage, catalogAdminLabels.mediaTypeLink],
      [catalogAdminLabels.mediaTypeDocument],
      [catalogAdminLabels.cancel],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildMediaConfirmOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[catalogAdminLabels.confirmMediaCreate], [catalogAdminLabels.cancel]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildMediaEditConfirmOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[catalogAdminLabels.confirmMediaEdit], [catalogAdminLabels.cancel]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildMediaDeleteConfirmOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[catalogAdminLabels.confirmMediaDelete], [catalogAdminLabels.cancel]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildKeepCurrentKeyboard(): TelegramReplyOptions {
  return {
    replyKeyboard: [[catalogAdminLabels.keepCurrent], [catalogAdminLabels.cancel]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildSingleCancelKeyboard(): TelegramReplyOptions {
  return {
    replyKeyboard: [[catalogAdminLabels.cancel]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildWikipediaUrlOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[catalogAdminLabels.skipLookupImport], [catalogAdminLabels.cancel]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildWikipediaCandidateOptions(candidateTitles: string[]): TelegramReplyOptions {
  const replyKeyboard = chunkKeyboard(candidateTitles, 2);
  replyKeyboard.push([catalogAdminLabels.manualWikipediaUrl], [catalogAdminLabels.skipLookupImport], [catalogAdminLabels.cancel]);
  return {
    replyKeyboard,
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

async function showCatalogBrowseMenu(context: TelegramCatalogAdminContext): Promise<void> {
  await replyWithCatalogList(context, 'list');
}

async function showCatalogFamilyBrowse(context: TelegramCatalogAdminContext, familyId: number): Promise<void> {
  const repository = resolveCatalogRepository(context);
  const family = await repository.findFamilyById(familyId);
  if (!family) {
    throw new Error(`Catalog family ${familyId} not found`);
  }

  const groups = await repository.listGroups({ familyId });
  const items = await repository.listItems({ familyId, includeDeactivated: true });
  const loanRepository = resolveCatalogLoanRepository(context);
  const activeLoans = await loadActiveLoansByItemMap(loanRepository, items);
  const lines = [
    `<b>Categoria:</b> ${escapeHtml(family.displayName)} (#${family.id})`,
    formatHtmlField('Descripcio', escapeHtml(family.description ?? 'Sense descripcio')),
  ];

  for (const group of groups) {
    const groupItems = items.filter((item) => item.groupId === group.id);
    lines.push(`<b>Grup:</b> ${escapeHtml(group.displayName)} (#${group.id})`);
    for (const item of groupItems) {
      lines.push(await formatCatalogListItemLine(context, item, activeLoans.get(item.id) ?? null));
    }
  }

  const looseItems = items.filter((item) => item.groupId === null);
  if (looseItems.length > 0) {
    lines.push('Items sense grup:');
    for (const item of looseItems) {
      lines.push(await formatCatalogListItemLine(context, item, activeLoans.get(item.id) ?? null));
    }
  }

  const itemRows = await Promise.all(items.map(async (item) => buildLoanItemButton(await loadActiveLoanByItemIdAdmin(context, item.id), item.id, item.displayName, catalogAdminCallbackPrefixes.inspect)));
  await context.reply(lines.join('\n'), {
    parseMode: 'HTML',
    inlineKeyboard: [
      ...itemRows,
      [{ text: 'Cerca per nom', callbackData: catalogAdminCallbackPrefixes.browseSearch }],
      [{ text: 'Tornar al cataleg', callbackData: catalogAdminCallbackPrefixes.browseMenu }],
    ],
  });
}

async function handleBrowseSession(context: TelegramCatalogAdminContext, text: string, stepKey: string, data: Record<string, unknown>): Promise<boolean> {
  if (stepKey !== 'search-query') {
    return false;
  }

  const query = text.trim();
  if (!query) {
    await context.reply('Escriu un nom valid per cercar.', buildSingleCancelKeyboard());
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
      inlineKeyboard: [[{ text: 'Tornar al cataleg', callbackData: catalogAdminCallbackPrefixes.browseMenu }]],
    });
    return true;
  }

  const activeLoans = await loadActiveLoansByItemMap(loanRepository, matches);
  const lines = [`Resultats per a "${query}":`];
  for (const item of matches) {
    lines.push(await formatCatalogListItemLine(context, item, activeLoans.get(item.id) ?? null));
  }

  await context.reply(lines.join('\n'), {
    parseMode: 'HTML',
    inlineKeyboard: [
      ...await Promise.all(matches.map(async (item) => buildLoanItemButton(await loadActiveLoanByItemIdAdmin(context, item.id), item.id, item.displayName, catalogAdminCallbackPrefixes.inspect))),
      [{ text: 'Tornar al cataleg', callbackData: catalogAdminCallbackPrefixes.browseMenu }],
    ],
  });
  return true;
}

async function replyWithCatalogList(
  context: TelegramCatalogAdminContext,
  mode: 'list' | 'edit' | 'deactivate',
): Promise<void> {
  const items = await listCatalogItems({ repository: resolveCatalogRepository(context), includeDeactivated: false });
  if (items.length === 0) {
    await context.reply('No hi ha cap item de cataleg disponible ara mateix.', buildCatalogAdminMenuOptions());
    return;
  }
  const inlineKeyboard = mode === 'list'
    ? await buildGroupedInspectKeyboard(context, items)
    : items.map((item) => [{
      text: item.displayName,
      callbackData: mode === 'edit'
        ? `${catalogAdminCallbackPrefixes.edit}${item.id}`
        : `${catalogAdminCallbackPrefixes.deactivate}${item.id}`,
    }]);
  await context.reply(
    mode === 'list' ? await formatCatalogItemList(context, items) : `Tria l item que vols ${mode === 'edit' ? 'editar' : 'desactivar'}.`,
    mode === 'list'
      ? { ...buildCatalogAdminMenuOptions(), inlineKeyboard, parseMode: 'HTML' }
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
  await context.reply('Camp actualitzat. Tria un altre camp o guarda els canvis.', buildEditFieldMenuOptions(getDraftItemType(item, nextData)));
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
  await context.reply(`Item de cataleg actualitzat correctament: ${updated.displayName} (#${updated.id}).`, buildCatalogAdminMenuOptions());
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

async function formatCatalogItemList(context: TelegramCatalogAdminContext, items: CatalogItemRecord[]): Promise<string> {
  const repository = resolveCatalogRepository(context);
  const loanRepository = resolveCatalogLoanRepository(context);
  const families = await repository.listFamilies();
  const groups = await listCatalogGroups({ repository });
  const familyNames = new Map(families.map((family) => [family.id, family.displayName]));
  const groupNames = new Map(groups.map((group) => [group.id, group.displayName]));
  const activeLoans = await loadActiveLoansByItemMap(loanRepository, items);
  const groupedItems = items.filter((item) => item.groupId !== null);
  const standaloneItems = items.filter((item) => item.groupId === null);
  const lines: string[] = [];

  for (const group of groups) {
    const groupItems = groupedItems.filter((item) => item.groupId === group.id);
    if (groupItems.length === 0) {
      continue;
    }
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(`Grup: ${escapeHtml(group.displayName)} · ${escapeHtml(group.familyId ? familyNames.get(group.familyId) ?? `Familia #${group.familyId}` : 'Sense familia')}`);
    lines.push('------');
    lines.push('');
    for (const item of groupItems) {
      lines.push(await formatCatalogListItemLine(context, item, activeLoans.get(item.id) ?? null));
    }
  }

  const standaloneItemsWithFamily = standaloneItems.filter((item) => item.familyId !== null);
  const standaloneItemsWithoutFamily = standaloneItems.filter((item) => item.familyId === null);

  for (const family of families) {
    const familyItems = standaloneItemsWithFamily.filter((item) => item.familyId === family.id);
    if (familyItems.length === 0) {
      continue;
    }
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(`Familia: ${escapeHtml(family.displayName)}`);
    lines.push('------');
    lines.push('');
    for (const item of familyItems) {
      lines.push(await formatCatalogListItemLine(context, item, activeLoans.get(item.id) ?? null));
    }
  }

  if (standaloneItemsWithoutFamily.length > 0) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push('Sense grup:');
    lines.push('------');
    lines.push('');
    for (const item of standaloneItemsWithoutFamily) {
      lines.push(await formatCatalogListItemLine(context, item, activeLoans.get(item.id) ?? null, 'Sense familia'));
    }
  }

  for (const item of groupedItems) {
    if (item.groupId !== null && !groupNames.has(item.groupId)) {
      if (lines.length > 0) {
        lines.push('');
      }
      lines.push(`Grup sense definir: ${item.groupId}`);
      lines.push('------');
      lines.push('');
      lines.push(await formatCatalogListItemLine(context, item, activeLoans.get(item.id) ?? null));
    }
  }

  return lines.join('\n');
}

async function buildCatalogItemDetailButtons(
  context: TelegramCatalogAdminContext,
  item: CatalogItemRecord,
): Promise<NonNullable<TelegramReplyOptions['inlineKeyboard']>> {
  const media = await resolveCatalogRepository(context).listMedia({ itemId: item.id });
  const loan = await loadActiveLoanByItemIdAdmin(context, item.id);
  return [
    [{ text: 'Editar item', callbackData: `${catalogAdminCallbackPrefixes.edit}${item.id}` }],
    ...media.flatMap((entry) => [[
      { text: `Editar media #${entry.id}`, callbackData: `${catalogAdminCallbackPrefixes.editMedia}${entry.id}` },
      { text: `Eliminar media #${entry.id}`, callbackData: `${catalogAdminCallbackPrefixes.deleteMedia}${entry.id}` },
    ]]),
    ...buildLoanDetailButtons({ loan, itemId: item.id, canEdit: loan ? isEditableLoan(context, loan) : false }),
  ];
}

async function formatCatalogItemDetails(context: TelegramCatalogAdminContext, item: CatalogItemRecord): Promise<string> {
  const familyName = await loadFamilyName(context, item.familyId);
  const groupName = await loadGroupName(context, item.groupId);
  const media = await resolveCatalogRepository(context).listMedia({ itemId: item.id });
  const loan = await loadActiveLoanByItemIdAdmin(context, item.id);
  const mediaLines = media.length === 0
    ? []
    : [
      formatHtmlField('Media', `${media.length} element${media.length === 1 ? '' : 's'}`),
      ...media.map((entry) => `- #${entry.id}: ${escapeHtml(entry.mediaType)} · ${escapeHtml(entry.url)}`),
    ];
  const descriptionLine = formatCatalogDescriptionLine(item.itemType, item.description);
  return [
    `<b>${escapeHtml(item.displayName)}</b> (#${item.id})`,
    formatHtmlField('Tipus', renderCatalogItemType(item.itemType)),
    formatHtmlField('Familia', escapeHtml(familyName ?? 'Sense familia')),
    formatHtmlField('Grup', escapeHtml(groupName ?? 'Sense grup')),
    ...(await formatLoanAvailabilityLines(context, loan)),
    ...(item.originalName ? [formatHtmlField('Nom original', escapeHtml(item.originalName))] : []),
    ...(descriptionLine ? [descriptionLine] : []),
    ...(item.language ? [formatHtmlField('Llengua', escapeHtml(item.language))] : []),
    ...(item.publisher ? [formatHtmlField('Editorial', escapeHtml(item.publisher))] : []),
    ...(item.publicationYear !== null ? [formatHtmlField('Any publicacio', String(item.publicationYear))] : []),
    ...(itemTypeSupportsPlayers(item.itemType) && (item.playerCountMin !== null || item.playerCountMax !== null)
      ? [formatHtmlField('Jugadors', renderCatalogPlayerRange(item.playerCountMin, item.playerCountMax))]
      : []),
    ...(item.recommendedAge !== null ? [formatHtmlField('Edat recomanada', String(item.recommendedAge))] : []),
    ...(item.playTimeMinutes !== null ? [formatHtmlField('Durada', String(item.playTimeMinutes))] : []),
    ...(item.externalRefs ? [`Referencies externes: ${escapeHtml(renderCatalogOptionalObject(item.externalRefs))}`] : []),
    ...(item.metadata ? [`Metadata: ${escapeHtml(renderCatalogOptionalObject(item.metadata))}`] : []),
    ...mediaLines,
    formatHtmlField('Estat', item.lifecycleStatus),
  ].join('\n');
}

async function formatCatalogGroupDetails(context: TelegramCatalogAdminContext, group: CatalogGroupRecord): Promise<string> {
  const familyName = await loadFamilyName(context, group.familyId);
  const items = await listCatalogItems({ repository: resolveCatalogRepository(context), groupId: group.id, includeDeactivated: true });
  const loanRepository = resolveCatalogLoanRepository(context);
  const activeLoans = await loadActiveLoansByItemMap(loanRepository, items);
  return [
    `<b>${escapeHtml(group.displayName)}</b>`,
    formatHtmlField('Familia', escapeHtml(familyName ?? 'Sense familia')),
    formatHtmlField('Descripcio', escapeHtml(group.description ?? 'Sense descripcio')),
    '<b>Items:</b>',
    ...(items.length > 0 ? await Promise.all(items.map((item) => formatCatalogListItemLine(context, item, activeLoans.get(item.id) ?? null))) : ['- Cap item assignat']),
  ].join('\n');
}

async function formatCatalogListItemLine(
  context: TelegramCatalogAdminContext,
  item: CatalogItemRecord,
  loan: CatalogLoanRecord | null,
  fallbackAvailability: string = 'Disponible',
): Promise<string> {
  const typeLabel = escapeHtml(renderCatalogItemType(item.itemType));
  const availability = loan
    ? `<i>${[typeLabel, `Prestat a ${escapeHtml(await resolveLoanBorrowerDisplayName(context, loan))}`, `des de ${escapeHtml(formatCatalogListDate(loan.createdAt))}`].join(' · ')}</i>`
    : `<i>${[typeLabel, escapeHtml(fallbackAvailability)].join(' · ')}</i>`;
  return `- <a href="${escapeHtml(buildCatalogAdminItemDeepLink(item.id))}"><b>${escapeHtml(item.displayName)}</b></a> · ${availability}`;
}

function buildCatalogAdminItemDeepLink(itemId: number): string {
  return buildTelegramStartUrl(`${catalogAdminStartPayloadPrefix}${itemId}`);
}

function parseCatalogAdminStartPayload(messageText: string | undefined): number | null {
  const payload = messageText?.trim().split(/\s+/).slice(1).join(' ');
  if (!payload || !payload.startsWith(catalogAdminStartPayloadPrefix)) {
    return null;
  }

  const value = Number(payload.slice(catalogAdminStartPayloadPrefix.length));
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

function formatCatalogListDate(value: string): string {
  return new Intl.DateTimeFormat('ca-ES', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value));
}

async function formatDraftSummary(context: TelegramCatalogAdminContext, data: Record<string, unknown>): Promise<string> {
  const familyName = await loadFamilyName(context, asNullableNumber(data.familyId));
  const groupName = await loadGroupName(context, asNullableNumber(data.groupId));
  const itemType = String(data.itemType ?? 'board-game') as CatalogItemType;
  return [
    '<b>Resum de l item:</b>',
    formatHtmlField('Nom', escapeHtml(String(data.displayName ?? ''))),
    formatHtmlField('Tipus', escapeHtml(renderCatalogItemType(itemType))),
    formatHtmlField('Familia', escapeHtml(familyName ?? 'Sense familia')),
    formatHtmlField('Grup', escapeHtml(groupName ?? 'Sense grup')),
    formatHtmlField('Nom original', escapeHtml(asNullableString(data.originalName) ?? 'Sense valor')),
    formatHtmlField('Descripcio', escapeHtml(asNullableString(data.description) ?? 'Sense descripcio')),
    formatHtmlField('Llengua', escapeHtml(asNullableString(data.language) ?? 'Sense valor')),
    formatHtmlField('Editorial', escapeHtml(asNullableString(data.publisher) ?? 'Sense valor')),
    formatHtmlField('Any publicacio', escapeHtml(String(asNullableNumber(data.publicationYear) ?? 'Sense valor'))),
    ...(itemTypeSupportsPlayers(itemType)
      ? [formatHtmlField('Jugadors', escapeHtml(renderCatalogPlayerRange(asNullableNumber(data.playerCountMin), asNullableNumber(data.playerCountMax))))]
      : []),
    formatHtmlField('Edat recomanada', escapeHtml(String(asNullableNumber(data.recommendedAge) ?? 'Sense valor'))),
    formatHtmlField('Durada', escapeHtml(String(asNullableNumber(data.playTimeMinutes) ?? 'Sense valor'))),
    formatHtmlField('Referencies externes', escapeHtml(renderCatalogOptionalObject(asNullableObject(data.externalRefs)))),
    formatHtmlField('Metadata', escapeHtml(renderCatalogOptionalObject(asNullableObject(data.metadata)))),
  ].join('\n');
}

function parseItemTypeLabel(text: string): CatalogItemType | Error {
  switch (text) {
    case catalogAdminLabels.typeBoardGame:
      return 'board-game';
    case catalogAdminLabels.typeExpansion:
      return 'expansion';
    case catalogAdminLabels.typeBook:
      return 'book';
    case catalogAdminLabels.typeRpgBook:
      return 'rpg-book';
    case catalogAdminLabels.typeAccessory:
      return 'accessory';
    default:
      return new Error('invalid-item-type');
  }
}

function parseMediaTypeLabel(text: string): CatalogMediaType | Error {
  switch (text) {
    case catalogAdminLabels.mediaTypeImage:
      return 'image';
    case catalogAdminLabels.mediaTypeLink:
      return 'link';
    case catalogAdminLabels.mediaTypeDocument:
      return 'document';
    default:
      return new Error('invalid-media-type');
  }
}

async function parseFamilyInput(
  context: TelegramCatalogAdminContext,
  text: string,
  itemType: CatalogItemType,
): Promise<number | null | Error> {
  if (text === catalogAdminLabels.noFamily) {
    return null;
  }
  const repository = resolveCatalogRepository(context);
  const value = Number(text);
  if (Number.isInteger(value) && value > 0) {
    const family = await repository.findFamilyById(value);
    if (!family) {
      return new Error('unknown-family');
    }
    return value;
  }

  const normalizedText = normalizeFamilyLookupKey(text);
  if (!normalizedText) {
    return new Error('invalid-family-name');
  }

  const existingFamily = (await repository.listFamilies()).find((family) => {
    return normalizeFamilyLookupKey(family.displayName) === normalizedText || normalizeFamilyLookupKey(family.slug) === normalizedText;
  });
  if (existingFamily) {
    return existingFamily.id;
  }
  if (itemType !== 'rpg-book' && itemType !== 'book' && itemType !== 'board-game') {
    return new Error('unknown-family');
  }

  const createdFamily = await createCatalogFamily({
    repository,
    slug: buildFamilySlug(text),
    displayName: text.trim(),
    familyKind: familyKindForItemType(itemType),
  });
  return createdFamily.id;
}

async function parseGroupInput(
  context: TelegramCatalogAdminContext,
  text: string,
  familyId: number | null,
): Promise<number | null | Error> {
  if (text === catalogAdminLabels.noGroup) {
    return null;
  }
  const value = Number(text);
  if (!Number.isInteger(value) || value <= 0) {
    return new Error('invalid-group-id');
  }
  const group = await resolveCatalogRepository(context).findGroupById(value);
  if (!group) {
    return new Error('unknown-group');
  }
  if (group.familyId !== familyId) {
    return new Error('group-family-mismatch');
  }
  return value;
}

function parseOptionalPositiveInteger(text: string): number | null | Error {
  if (text === catalogAdminLabels.skipOptional) {
    return null;
  }
  const value = Number(text);
  if (!Number.isInteger(value) || value <= 0) {
    return new Error('invalid-number');
  }
  return value;
}

function parseOptionalNonNegativeInteger(text: string): number | null | Error {
  if (text === catalogAdminLabels.skipOptional) {
    return null;
  }
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0) {
    return new Error('invalid-number');
  }
  return value;
}

function parseOptionalJsonObject(text: string): Record<string, unknown> | null | Error {
  if (text === catalogAdminLabels.skipOptional) {
    return null;
  }
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return new Error('invalid-json-object');
    }
    return value as Record<string, unknown>;
  } catch {
    return new Error('invalid-json-object');
  }
}

function parseLookupCandidateInput(text: string, value: unknown): CatalogLookupCandidate | Error {
  const candidates = asLookupCandidates(value);
  return candidates.find((candidate) => candidate.title === text) ?? new Error('invalid-lookup-candidate');
}

function parseItemId(callbackData: string, prefix: string): number {
  const value = Number(callbackData.slice(prefix.length));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('No s ha pogut identificar l item seleccionat.');
  }
  return value;
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
  const parts = [`- ${item.displayName} (#${item.id})`, renderCatalogItemType(item.itemType)];
  if (extraSuffix) {
    parts.push(extraSuffix);
  }
  if (loan) {
    parts.push(await formatLoanSummary(context, loan));
  }
  return parts.join(' · ');
}

async function formatLoanSummary(context: TelegramCatalogAdminContext, loan: CatalogLoanRecord): Promise<string> {
  const parts = [`Prestat a ${await resolveLoanBorrowerDisplayName(context, loan)}`, `des de ${formatDateLabel(loan.createdAt)}`];
  if (loan.dueAt) {
    parts.push(`fins ${formatDateLabel(loan.dueAt)}`);
  }
  return parts.join(' · ');
}

function formatDateLabel(value: string): string {
  return value.slice(0, 10).split('-').reverse().join('/');
}

function countItemsForFamily(items: CatalogItemRecord[], familyId: number): number {
  return items.filter((item) => item.familyId === familyId).length;
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
  return family?.displayName ?? `Familia #${familyId}`;
}

async function loadGroupName(context: TelegramCatalogAdminContext, groupId: number | null): Promise<string | null> {
  if (groupId === null) {
    return null;
  }
  const group = await resolveCatalogRepository(context).findGroupById(groupId);
  return group?.displayName ?? `Grup #${groupId}`;
}

async function buildFamilyPrompt(context: TelegramCatalogAdminContext, itemType: CatalogItemType): Promise<string> {
  const families = await resolveCatalogRepository(context).listFamilies();
  if (itemType === 'rpg-book' || itemType === 'book' || itemType === 'board-game') {
    const popularFamilies = await listPopularFamilies(context, itemType);
    if (popularFamilies.length === 0) {
      if (itemType === 'board-game') {
        return 'Escriu la familia del joc de taula. Si no existeix, la creare. També pots continuar sense familia.';
      }
      return itemType === 'rpg-book'
        ? 'Escriu la familia del llibre RPG. Si no existeix, la creare. També pots continuar sense familia.'
        : 'Escriu la familia del llibre. Si no existeix, la creare. També pots continuar sense familia.';
    }
    if (itemType === 'board-game') {
      return 'Escriu o tria una familia del joc de taula. Si no existeix, la creare. També pots continuar sense familia.';
    }
    return itemType === 'rpg-book'
      ? 'Escriu o tria una familia del llibre RPG. Si no existeix, la creare. També pots continuar sense familia.'
      : 'Escriu o tria una familia del llibre. Si no existeix, la creare. També pots continuar sense familia.';
  }
  if (families.length === 0) {
    return 'No hi ha families creades. Continua sense familia o escriu /cancel.';
  }
  return ['Escriu l id de la familia o continua sense familia.', ...families.map(formatFamilyOption)].join('\n');
}

async function listPopularFamilies(
  context: TelegramCatalogAdminContext,
  itemType: CatalogItemType,
): Promise<CatalogFamilyRecord[]> {
  const repository = resolveCatalogRepository(context);
  const [families, items] = await Promise.all([
    repository.listFamilies(),
    listCatalogItems({ repository, includeDeactivated: false }),
  ]);
  const compatibleFamilies = families.filter((family) => family.familyKind === familyKindForItemType(itemType));
  const counts = new Map<number, number>();
  for (const item of items) {
    if (item.itemType !== itemType || item.familyId === null) {
      continue;
    }
    counts.set(item.familyId, (counts.get(item.familyId) ?? 0) + 1);
  }
  return compatibleFamilies
    .slice()
    .sort((left, right) => {
      const popularityDifference = (counts.get(right.id) ?? 0) - (counts.get(left.id) ?? 0);
      if (popularityDifference !== 0) {
        return popularityDifference;
      }
      return left.displayName.localeCompare(right.displayName);
    })
    .slice(0, 6);
}

function familyKindForItemType(itemType: CatalogItemType): CatalogFamilyRecord['familyKind'] {
  switch (itemType) {
    case 'rpg-book':
      return 'rpg-line';
    case 'book':
      return 'generic-line';
    case 'board-game':
    case 'expansion':
      return 'board-game-line';
    case 'accessory':
      return 'generic-line';
  }
}

function chunkKeyboard(values: string[], size: number): string[][] {
  const rows: string[][] = [];
  for (let index = 0; index < values.length; index += size) {
    rows.push(values.slice(index, index + size));
  }
  return rows;
}

function normalizeFamilyLookupKey(value: string): string {
  return value.trim().toLowerCase();
}

function buildFamilySlug(value: string): string {
  return normalizeFamilyLookupKey(value).replace(/\s+/g, '-');
}

function formatFamilyOption(family: CatalogFamilyRecord): string {
  return `- #${family.id}: ${family.displayName}`;
}

async function buildGroupPrompt(context: TelegramCatalogAdminContext, familyId: number | null): Promise<string> {
  if (familyId === null) {
    return 'Sense familia no hi ha grups compatibles. Continua sense grup o escriu /cancel.';
  }
  const groups = await listCatalogGroups({ repository: resolveCatalogRepository(context), ...(familyId !== null ? { familyId } : {}) });
  if (groups.length === 0) {
    return 'No hi ha grups compatibles. Continua sense grup o escriu /cancel.';
  }
  return ['Escriu l id del grup o continua sense grup.', ...groups.map(formatGroupOption)].join('\n');
}

function formatGroupOption(group: CatalogGroupRecord): string {
  return `- #${group.id}: ${group.displayName}`;
}

async function buildGroupedInspectKeyboard(
  context: TelegramCatalogAdminContext,
  items: CatalogItemRecord[],
): Promise<NonNullable<TelegramReplyOptions['inlineKeyboard']>> {
  const groups = await listCatalogGroups({ repository: resolveCatalogRepository(context) });
  const grouped = groups
    .filter((group) => items.some((item) => item.groupId === group.id))
    .map((group) => [{ text: `Veure grup ${group.displayName}`, callbackData: `${catalogAdminCallbackPrefixes.inspectGroup}${group.id}` }]);
  const itemRows = items.map((item) => [{ text: item.displayName, callbackData: `${catalogAdminCallbackPrefixes.inspect}${item.id}` }]);
  return [...grouped, ...itemRows];
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function asNullableObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asLookupCandidate(value: unknown): CatalogLookupCandidate {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid lookup candidate');
  }
  return value as CatalogLookupCandidate;
}

function asLookupCandidates(value: unknown): CatalogLookupCandidate[] {
  return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === 'object') as CatalogLookupCandidate[] : [];
}

function buildMediaDraftSummary(data: Record<string, unknown>): string {
  return [
    'Resum del media:',
    `- Tipus: ${String(data.mediaType ?? '')}`,
    `- URL: ${String(data.url ?? '')}`,
    `- Text alternatiu: ${asNullableString(data.altText) ?? 'Sense valor'}`,
    `- Ordre: ${asNullableNumber(data.sortOrder) ?? 0}`,
  ].join('\n');
}

function isExactTitleMatch(left: string, right: string): boolean {
  return normalizeTitleForComparison(left) === normalizeTitleForComparison(right);
}

function normalizeTitleForComparison(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
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

function buildLookupChoicePrompt(candidates: CatalogLookupCandidate[]): string {
  return [
    'He trobat aquestes coincidencies externes. Tria la que vols importar, escriu un autor per refinar la cerca o continua sense dades externes:',
    ...candidates.map((candidate) => `- ${candidate.title} · ${candidate.summary}`),
  ].join('\n');
}

function buildLookupChoiceOptions(candidates: CatalogLookupCandidate[]): TelegramReplyOptions {
  return {
    replyKeyboard: [...candidates.map((candidate) => [candidate.title]), [catalogAdminLabels.refineLookupByAuthor], [catalogAdminLabels.skipLookupImport], [catalogAdminLabels.cancel]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

async function refineLookupCandidatesByAuthor(
  context: TelegramCatalogAdminContext,
  data: Record<string, unknown>,
  author: string,
): Promise<boolean> {
  const normalizedAuthor = author.trim();
  if (!normalizedAuthor) {
    return false;
  }
  const itemType = String(data.itemType) as CatalogItemType;
  const refinedCandidates = await searchCatalogLookupCandidates(context, {
    itemType,
    displayName: String(data.displayName ?? ''),
    author: normalizedAuthor,
  });
  if (refinedCandidates.length === 0) {
    return false;
  }
  await context.runtime.session.advance({ stepKey: 'lookup-choice', data: { ...data, lookupCandidates: refinedCandidates, lookupAuthor: normalizedAuthor } });
  await context.reply(buildLookupChoicePrompt(refinedCandidates), buildLookupChoiceOptions(refinedCandidates));
  return true;
}

function buildLookupTitleChoicePrompt(typedTitle: string, apiTitle: string): string {
  return [
    'El titol trobat a la API no coincideix exactament amb el que has escrit.',
    `- El teu titol: ${typedTitle}`,
    `- Titol API: ${apiTitle}`,
    'Tria quin titol vols fer servir.',
  ].join('\n');
}

function buildLookupTitleChoiceOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[catalogAdminLabels.keepTypedTitle], [catalogAdminLabels.useApiTitle], [catalogAdminLabels.cancel]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function applyLookupCandidateToDraft(
  data: Record<string, unknown>,
  candidate: CatalogLookupCandidate,
): Record<string, unknown> {
  return {
    ...data,
    originalName: candidate.importedData.originalName,
    description: candidate.importedData.description,
    language: candidate.importedData.language,
    publisher: candidate.importedData.publisher,
    publicationYear: candidate.importedData.publicationYear,
    externalRefs: candidate.importedData.externalRefs,
    metadata: candidate.importedData.metadata,
  };
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

  return createWikipediaBoardGameImportService();
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
        message: 'No he pogut connectar amb Wikipedia en aquest moment.',
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
  await context.reply('Seleccionant la millor opcio i descarregant els detalls finals...', buildEditFieldMenuOptions(item.itemType));
  await context.reply(
    `He importat dades de Wikipedia per ${item.displayName}.\n\n${await formatDraftSummary(context, importedData as unknown as Record<string, unknown>)}\n\nTria un camp del teclat o guarda els canvis quan hagis acabat.`,
    { ...buildEditFieldMenuOptions(item.itemType), parseMode: 'HTML' },
  );
}

function parseWikipediaTitleFromUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!url.hostname.endsWith('wikipedia.org')) {
      return null;
    }

    if (url.pathname.startsWith('/wiki/')) {
      const encodedTitle = url.pathname.slice('/wiki/'.length);
      return decodeURIComponent(encodedTitle).replace(/_/g, ' ').trim() || null;
    }

    const title = url.searchParams.get('title');
    return title ? decodeURIComponent(title).replace(/_/g, ' ').trim() || null : null;
  } catch {
    return null;
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

function importWikipediaErrorMessage(result: Extract<WikipediaBoardGameImportResult, { ok: false }>): string {
  if (result.error.type === 'not-found') {
    return 'No he trobat aquest joc a Wikipedia. Continuem manualment.';
  }

  if (result.error.type === 'connection') {
    return 'No he pogut connectar amb Wikipedia. Continuem manualment.';
  }

  return 'No he pogut importar les dades de Wikipedia. Continuem manualment.';
}
