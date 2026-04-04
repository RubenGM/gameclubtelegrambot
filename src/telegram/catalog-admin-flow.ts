import { appendAuditEvent, type AuditLogRepository } from '../audit/audit-log.js';
import { createDatabaseAuditLogRepository } from '../audit/audit-log-store.js';
import {
  createCatalogItem,
  deactivateCatalogItem,
  listCatalogGroups,
  listCatalogItems,
  updateCatalogItem,
  type CatalogFamilyRecord,
  type CatalogGroupRecord,
  type CatalogItemRecord,
  type CatalogItemType,
  type CatalogRepository,
} from '../catalog/catalog-model.js';
import { createDatabaseCatalogRepository } from '../catalog/catalog-store.js';
import type { AuthorizationService } from '../authorization/service.js';
import type { TelegramActor } from './actor-store.js';
import type { TelegramChatContext } from './chat-context.js';
import type { ConversationSessionRuntime } from './conversation-session.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

const createFlowKey = 'catalog-admin-create';
const editFlowKey = 'catalog-admin-edit';
const deactivateFlowKey = 'catalog-admin-deactivate';

export const catalogAdminCallbackPrefixes = {
  inspect: 'catalog_admin:inspect:',
  inspectGroup: 'catalog_admin:inspect_group:',
  edit: 'catalog_admin:edit:',
  deactivate: 'catalog_admin:deactivate:',
} as const;

export const catalogAdminLabels = {
  openMenu: 'Cataleg',
  create: 'Crear item',
  list: 'Llistar items',
  edit: 'Editar item',
  deactivate: 'Desactivar item',
  typeBoardGame: 'Joc de taula',
  typeExpansion: 'Expansio',
  typeRpgBook: 'Llibre RPG',
  typeAccessory: 'Accessori',
  noFamily: 'Sense familia',
  noGroup: 'Sense grup',
  skipOptional: 'Ometre',
  keepCurrent: 'Mantenir valor actual',
  confirmCreate: 'Guardar item',
  confirmEdit: 'Guardar canvis',
  confirmDeactivate: 'Confirmar desactivacio',
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
      sendPrivateMessage(telegramUserId: number, message: string): Promise<void>;
    };
  };
  catalogRepository?: CatalogRepository;
  auditRepository?: AuditLogRepository;
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
    await context.reply('Gestio de cataleg: tria una accio.', buildCatalogAdminMenuOptions());
    return true;
  }
  if (text === catalogAdminLabels.create || text === '/catalog_create') {
    await context.runtime.session.start({ flowKey: createFlowKey, stepKey: 'display-name', data: {} });
    await context.reply('Escriu el nom visible de l item.', buildSingleCancelKeyboard());
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

export async function handleTelegramCatalogAdminCallback(context: TelegramCatalogAdminContext): Promise<boolean> {
  const callbackData = context.callbackData;
  if (!callbackData || context.runtime.chat.kind !== 'private' || !canManageCatalog(context)) {
    return false;
  }

  if (callbackData.startsWith(catalogAdminCallbackPrefixes.inspect)) {
    const itemId = parseItemId(callbackData, catalogAdminCallbackPrefixes.inspect);
    const item = await loadItemOrThrow(context, itemId);
    await context.reply(await formatCatalogItemDetails(context, item));
    return true;
  }
  if (callbackData.startsWith(catalogAdminCallbackPrefixes.inspectGroup)) {
    const groupId = parseItemId(callbackData, catalogAdminCallbackPrefixes.inspectGroup);
    const group = await loadGroupOrThrow(context, groupId);
    await context.reply(await formatCatalogGroupDetails(context, group), {
      inlineKeyboard: (await listCatalogItems({ repository: resolveCatalogRepository(context), groupId, includeDeactivated: true })).map((item) => [{
        text: item.displayName,
        callbackData: `${catalogAdminCallbackPrefixes.inspect}${item.id}`,
      }]),
    });
    return true;
  }
  if (callbackData.startsWith(catalogAdminCallbackPrefixes.edit)) {
    const itemId = parseItemId(callbackData, catalogAdminCallbackPrefixes.edit);
    const item = await loadItemOrThrow(context, itemId);
    await context.runtime.session.start({ flowKey: editFlowKey, stepKey: 'display-name', data: { itemId } });
    await context.reply(`${await formatCatalogItemDetails(context, item)}

Escriu el nou nom o tria una opcio del teclat.`, buildKeepCurrentKeyboard());
    return true;
  }
  if (callbackData.startsWith(catalogAdminCallbackPrefixes.deactivate)) {
    const itemId = parseItemId(callbackData, catalogAdminCallbackPrefixes.deactivate);
    const item = await loadItemOrThrow(context, itemId);
    await context.runtime.session.start({ flowKey: deactivateFlowKey, stepKey: 'confirm', data: { itemId } });
    await context.reply(`${await formatCatalogItemDetails(context, item)}

Si el desactives, deixara d aparéixer als fluxos operatius futurs pero es mantindra per a consultes historiques.`, buildDeactivateConfirmOptions());
    return true;
  }
  return false;
}

function canManageCatalog(context: TelegramCatalogAdminContext): boolean {
  return context.runtime.actor.isAdmin || context.runtime.authorization.can('catalog.manage');
}

function isCatalogAdminSession(flowKey: string | undefined): boolean {
  return flowKey === createFlowKey || flowKey === editFlowKey || flowKey === deactivateFlowKey;
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
  return false;
}

async function handleCreateSession(
  context: TelegramCatalogAdminContext,
  text: string,
  stepKey: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  if (stepKey === 'display-name') {
    await context.runtime.session.advance({ stepKey: 'item-type', data: { displayName: text } });
    await context.reply('Selecciona el tipus d item.', buildTypeOptions());
    return true;
  }
  if (stepKey === 'item-type') {
    const itemType = parseItemTypeLabel(text);
    if (itemType instanceof Error) {
      await context.reply('Tria un tipus valid del teclat.', buildTypeOptions());
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'family', data: { ...data, itemType } });
    await context.reply(await buildFamilyPrompt(context), buildFamilyOptions());
    return true;
  }
  if (stepKey === 'family') {
    const familyId = await parseFamilyInput(context, text);
    if (familyId instanceof Error) {
      await context.reply('Tria una familia valida pel seu id o continua sense familia.', buildFamilyOptions());
      return true;
    }
    const nextData = { ...data, familyId };
    await context.runtime.session.advance({ stepKey: 'group', data: nextData });
    await context.reply(await buildGroupPrompt(context, familyId), buildGroupOptions());
    return true;
  }
  if (stepKey === 'group') {
    const groupId = await parseGroupInput(context, text, asNullableNumber(data.familyId));
    if (groupId instanceof Error) {
      await context.reply('Tria un grup valid pel seu id o continua sense grup.', buildGroupOptions());
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'description', data: { ...data, groupId } });
    await context.reply('Escriu una descripcio opcional o tria una opcio del teclat.', buildSkipOptionalKeyboard());
    return true;
  }
  if (stepKey === 'description') {
    await context.runtime.session.advance({
      stepKey: 'language',
      data: { ...data, description: text === catalogAdminLabels.skipOptional ? null : text },
    });
    await context.reply('Escriu la llengua principal o tria una opcio del teclat.', buildSkipOptionalKeyboard());
    return true;
  }
  if (stepKey === 'language') {
    await context.runtime.session.advance({
      stepKey: 'publication-year',
      data: { ...data, language: text === catalogAdminLabels.skipOptional ? null : text },
    });
    await context.reply('Escriu l any de publicacio o tria una opcio del teclat.', buildSkipOptionalKeyboard());
    return true;
  }
  if (stepKey === 'publication-year') {
    const publicationYear = parseOptionalPositiveInteger(text);
    if (publicationYear instanceof Error) {
      await context.reply('L any de publicacio ha de ser un enter positiu valid o omet el camp.', buildSkipOptionalKeyboard());
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'player-min', data: { ...data, publicationYear } });
    await context.reply('Escriu el minim de jugadors o tria una opcio del teclat.', buildSkipOptionalKeyboard());
    return true;
  }
  if (stepKey === 'player-min') {
    const playerCountMin = parseOptionalPositiveInteger(text);
    if (playerCountMin instanceof Error) {
      await context.reply('El minim de jugadors ha de ser un enter positiu valid o omet el camp.', buildSkipOptionalKeyboard());
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'player-max', data: { ...data, playerCountMin } });
    await context.reply('Escriu el maxim de jugadors o tria una opcio del teclat.', buildSkipOptionalKeyboard());
    return true;
  }
  if (stepKey === 'player-max') {
    const playerCountMax = parseOptionalPositiveInteger(text);
    if (playerCountMax instanceof Error) {
      await context.reply('El maxim de jugadors ha de ser un enter positiu valid o omet el camp.', buildSkipOptionalKeyboard());
      return true;
    }
    if (
      playerCountMax !== null &&
      typeof data.playerCountMin === 'number' &&
      playerCountMax < data.playerCountMin
    ) {
      await context.reply('El maxim de jugadors no pot ser inferior al minim. Escriu un enter positiu valid o omet el camp.', buildSkipOptionalKeyboard());
      return true;
    }
    const nextData = { ...data, playerCountMax };
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
      description: asNullableString(data.description),
      language: asNullableString(data.language),
      publicationYear: asNullableNumber(data.publicationYear),
      playerCountMin: asNullableNumber(data.playerCountMin),
      playerCountMax: asNullableNumber(data.playerCountMax),
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
  if (stepKey === 'display-name') {
    await context.runtime.session.advance({
      stepKey: 'item-type',
      data: { ...data, displayName: text === catalogAdminLabels.keepCurrent ? item.displayName : text },
    });
    await context.reply('Selecciona el tipus d item o mantingues el valor actual.', buildEditTypeOptions());
    return true;
  }
  if (stepKey === 'item-type') {
    const itemType = text === catalogAdminLabels.keepCurrent ? item.itemType : parseItemTypeLabel(text);
    if (itemType instanceof Error) {
      await context.reply('Tria un tipus valid del teclat.', buildEditTypeOptions());
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'family', data: { ...data, itemType } });
    await context.reply(await buildFamilyPrompt(context), buildEditFamilyOptions());
    return true;
  }
  if (stepKey === 'family') {
    const familyId =
      text === catalogAdminLabels.keepCurrent ? item.familyId : await parseFamilyInput(context, text);
    if (familyId instanceof Error) {
      await context.reply('Tria una familia valida pel seu id o continua sense familia.', buildEditFamilyOptions());
      return true;
    }
    const nextData = { ...data, familyId };
    await context.runtime.session.advance({ stepKey: 'group', data: nextData });
    await context.reply(await buildGroupPrompt(context, familyId), buildEditGroupOptions());
    return true;
  }
  if (stepKey === 'group') {
    const groupId =
      text === catalogAdminLabels.keepCurrent
        ? item.groupId
        : await parseGroupInput(context, text, hasOwn(data, 'familyId') ? asNullableNumber(data.familyId) : item.familyId);
    if (groupId instanceof Error) {
      await context.reply('Tria un grup valid pel seu id o continua sense grup.', buildEditGroupOptions());
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'description', data: { ...data, groupId } });
    await context.reply('Escriu la nova descripcio o tria una opcio del teclat.', buildEditOptionalKeyboard());
    return true;
  }
  if (stepKey === 'description') {
    await context.runtime.session.advance({
      stepKey: 'language',
      data: { ...data, description: text === catalogAdminLabels.keepCurrent ? item.description : text === catalogAdminLabels.skipOptional ? null : text },
    });
    await context.reply('Escriu la nova llengua o tria una opcio del teclat.', buildEditOptionalKeyboard());
    return true;
  }
  if (stepKey === 'language') {
    await context.runtime.session.advance({
      stepKey: 'publication-year',
      data: { ...data, language: text === catalogAdminLabels.keepCurrent ? item.language : text === catalogAdminLabels.skipOptional ? null : text },
    });
    await context.reply('Escriu el nou any de publicacio o tria una opcio del teclat.', buildEditOptionalKeyboard());
    return true;
  }
  if (stepKey === 'publication-year') {
    const publicationYear = text === catalogAdminLabels.keepCurrent ? item.publicationYear : parseOptionalPositiveInteger(text);
    if (publicationYear instanceof Error) {
      await context.reply('L any de publicacio ha de ser un enter positiu valid o omet el camp.', buildEditOptionalKeyboard());
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'player-min', data: { ...data, publicationYear } });
    await context.reply('Escriu el nou minim de jugadors o tria una opcio del teclat.', buildEditOptionalKeyboard());
    return true;
  }
  if (stepKey === 'player-min') {
    const playerCountMin = text === catalogAdminLabels.keepCurrent ? item.playerCountMin : parseOptionalPositiveInteger(text);
    if (playerCountMin instanceof Error) {
      await context.reply('El minim de jugadors ha de ser un enter positiu valid o omet el camp.', buildEditOptionalKeyboard());
      return true;
    }
    await context.runtime.session.advance({ stepKey: 'player-max', data: { ...data, playerCountMin } });
    await context.reply('Escriu el nou maxim de jugadors o tria una opcio del teclat.', buildEditOptionalKeyboard());
    return true;
  }
  if (stepKey === 'player-max') {
    const playerCountMax = text === catalogAdminLabels.keepCurrent ? item.playerCountMax : parseOptionalPositiveInteger(text);
    if (playerCountMax instanceof Error) {
      await context.reply('El maxim de jugadors ha de ser un enter positiu valid o omet el camp.', buildEditOptionalKeyboard());
      return true;
    }
    const candidateMin = asNullableNumber(data.playerCountMin);
    if (playerCountMax !== null && candidateMin !== null && playerCountMax < candidateMin) {
      await context.reply('El maxim de jugadors no pot ser inferior al minim. Escriu un enter positiu valid o omet el camp.', buildEditOptionalKeyboard());
      return true;
    }
    const nextData = { ...data, playerCountMax };
    await context.runtime.session.advance({ stepKey: 'confirm', data: nextData });
    await context.reply(`${await formatDraftSummary(context, nextData)}

Tria una opcio per confirmar o cancel.lar.`, buildEditConfirmOptions());
    return true;
  }
  if (stepKey === 'confirm') {
    if (text !== catalogAdminLabels.confirmEdit) {
      await context.reply('Per guardar els canvis, tria el boto de confirmacio o cancel.la el flux.', buildEditConfirmOptions());
      return true;
    }
    const updated = await updateCatalogItem({
      repository: resolveCatalogRepository(context),
      itemId,
      familyId: hasOwn(data, 'familyId') ? (data.familyId as number | null) : item.familyId,
      groupId: hasOwn(data, 'groupId') ? (data.groupId as number | null) : item.groupId,
      itemType: String(data.itemType ?? item.itemType) as CatalogItemType,
      displayName: String(data.displayName ?? item.displayName),
      description: hasOwn(data, 'description') ? asNullableString(data.description) : item.description,
      language: hasOwn(data, 'language') ? asNullableString(data.language) : item.language,
      publicationYear: hasOwn(data, 'publicationYear') ? asNullableNumber(data.publicationYear) : item.publicationYear,
      playerCountMin: hasOwn(data, 'playerCountMin') ? asNullableNumber(data.playerCountMin) : item.playerCountMin,
      playerCountMax: hasOwn(data, 'playerCountMax') ? asNullableNumber(data.playerCountMax) : item.playerCountMax,
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

function buildCatalogAdminMenuOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [
      [catalogAdminLabels.create, catalogAdminLabels.list],
      [catalogAdminLabels.edit, catalogAdminLabels.deactivate],
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
      [catalogAdminLabels.typeRpgBook, catalogAdminLabels.typeAccessory],
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
      [catalogAdminLabels.typeRpgBook, catalogAdminLabels.typeAccessory],
      [catalogAdminLabels.cancel],
    ],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildFamilyOptions(): TelegramReplyOptions {
  return {
    replyKeyboard: [[catalogAdminLabels.noFamily], [catalogAdminLabels.cancel]],
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

function buildEditOptionalKeyboard(): TelegramReplyOptions {
  return {
    replyKeyboard: [[catalogAdminLabels.keepCurrent, catalogAdminLabels.skipOptional], [catalogAdminLabels.cancel]],
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

async function replyWithCatalogList(
  context: TelegramCatalogAdminContext,
  mode: 'list' | 'edit' | 'deactivate',
): Promise<void> {
  const items = await listCatalogItems({ repository: resolveCatalogRepository(context), includeDeactivated: mode === 'list' });
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
    { inlineKeyboard },
  );
}

async function formatCatalogItemList(context: TelegramCatalogAdminContext, items: CatalogItemRecord[]): Promise<string> {
  const repository = resolveCatalogRepository(context);
  const families = await repository.listFamilies();
  const groups = await listCatalogGroups({ repository });
  const familyNames = new Map(families.map((family) => [family.id, family.displayName]));
  const groupNames = new Map(groups.map((group) => [group.id, group.displayName]));
  const groupedItems = items.filter((item) => item.groupId !== null);
  const standaloneItems = items.filter((item) => item.groupId === null);
  const lines = ['Items de cataleg:'];

  for (const group of groups) {
    const groupItems = groupedItems.filter((item) => item.groupId === group.id);
    if (groupItems.length === 0) {
      continue;
    }
    lines.push(`Grup: ${group.displayName} (#${group.id}) · ${group.familyId ? familyNames.get(group.familyId) ?? `Familia #${group.familyId}` : 'Sense familia'}`);
    for (const item of groupItems) {
      lines.push(`- ${item.displayName} (#${item.id}) · ${renderItemType(item.itemType)}`);
    }
  }

  if (standaloneItems.length > 0) {
    lines.push('Sense grup:');
    for (const item of standaloneItems) {
      lines.push(`- ${item.displayName} (#${item.id}) · ${renderItemType(item.itemType)} · ${item.familyId ? familyNames.get(item.familyId) ?? `Familia #${item.familyId}` : 'Sense familia'}`);
    }
  }

  for (const item of groupedItems) {
    if (item.groupId !== null && !groupNames.has(item.groupId)) {
      lines.push(`- ${item.displayName} (#${item.id}) · ${renderItemType(item.itemType)} · Grup #${item.groupId}`);
    }
  }

  return lines.join('\n');
}

async function formatCatalogItemDetails(context: TelegramCatalogAdminContext, item: CatalogItemRecord): Promise<string> {
  const familyName = await loadFamilyName(context, item.familyId);
  const groupName = await loadGroupName(context, item.groupId);
  return [
    `${item.displayName} (#${item.id})`,
    `Tipus: ${renderItemType(item.itemType)}`,
    `Familia: ${familyName ?? 'Sense familia'}`,
    `Grup: ${groupName ?? 'Sense grup'}`,
    `Descripcio: ${item.description ?? 'Sense descripcio'}`,
    `Llengua: ${item.language ?? 'Sense valor'}`,
    `Any publicacio: ${item.publicationYear ?? 'Sense valor'}`,
    `Jugadors: ${renderPlayerRange(item.playerCountMin, item.playerCountMax)}`,
    `Estat: ${item.lifecycleStatus}`,
  ].join('\n');
}

async function formatCatalogGroupDetails(context: TelegramCatalogAdminContext, group: CatalogGroupRecord): Promise<string> {
  const familyName = await loadFamilyName(context, group.familyId);
  const items = await listCatalogItems({ repository: resolveCatalogRepository(context), groupId: group.id, includeDeactivated: true });
  return [
    `${group.displayName} (#${group.id})`,
    `Familia: ${familyName ?? 'Sense familia'}`,
    `Descripcio: ${group.description ?? 'Sense descripcio'}`,
    'Items:',
    ...(items.length > 0 ? items.map((item) => `- ${item.displayName} (#${item.id}) · ${renderItemType(item.itemType)}`) : ['- Cap item assignat']),
  ].join('\n');
}

async function formatDraftSummary(context: TelegramCatalogAdminContext, data: Record<string, unknown>): Promise<string> {
  const familyName = await loadFamilyName(context, asNullableNumber(data.familyId));
  const groupName = await loadGroupName(context, asNullableNumber(data.groupId));
  return [
    'Resum de l item:',
    `- Nom: ${String(data.displayName ?? '')}`,
    `- Tipus: ${renderItemType(String(data.itemType ?? 'board-game') as CatalogItemType)}`,
    `- Familia: ${familyName ?? 'Sense familia'}`,
    `- Grup: ${groupName ?? 'Sense grup'}`,
    `- Descripcio: ${asNullableString(data.description) ?? 'Sense descripcio'}`,
    `- Llengua: ${asNullableString(data.language) ?? 'Sense valor'}`,
    `- Any publicacio: ${asNullableNumber(data.publicationYear) ?? 'Sense valor'}`,
    `- Jugadors: ${renderPlayerRange(asNullableNumber(data.playerCountMin), asNullableNumber(data.playerCountMax))}`,
  ].join('\n');
}

function parseItemTypeLabel(text: string): CatalogItemType | Error {
  switch (text) {
    case catalogAdminLabels.typeBoardGame:
      return 'board-game';
    case catalogAdminLabels.typeExpansion:
      return 'expansion';
    case catalogAdminLabels.typeRpgBook:
      return 'rpg-book';
    case catalogAdminLabels.typeAccessory:
      return 'accessory';
    default:
      return new Error('invalid-item-type');
  }
}

async function parseFamilyInput(context: TelegramCatalogAdminContext, text: string): Promise<number | null | Error> {
  if (text === catalogAdminLabels.noFamily) {
    return null;
  }
  const value = Number(text);
  if (!Number.isInteger(value) || value <= 0) {
    return new Error('invalid-family-id');
  }
  const family = await resolveCatalogRepository(context).findFamilyById(value);
  if (!family) {
    return new Error('unknown-family');
  }
  return value;
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

function parseItemId(callbackData: string, prefix: string): number {
  const value = Number(callbackData.slice(prefix.length));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('No s ha pogut identificar l item seleccionat.');
  }
  return value;
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

async function buildFamilyPrompt(context: TelegramCatalogAdminContext): Promise<string> {
  const families = await resolveCatalogRepository(context).listFamilies();
  if (families.length === 0) {
    return 'No hi ha families creades. Continua sense familia o escriu /cancel.';
  }
  return ['Escriu l id de la familia o continua sense familia.', ...families.map(formatFamilyOption)].join('\n');
}

function formatFamilyOption(family: CatalogFamilyRecord): string {
  return `- #${family.id}: ${family.displayName}`;
}

async function buildGroupPrompt(context: TelegramCatalogAdminContext, familyId: number | null): Promise<string> {
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
  const standalone = items
    .filter((item) => item.groupId === null)
    .map((item) => [{ text: `Veure ${item.displayName}`, callbackData: `${catalogAdminCallbackPrefixes.inspect}${item.id}` }]);
  return [...grouped, ...standalone];
}

function renderItemType(itemType: CatalogItemType): string {
  switch (itemType) {
    case 'board-game':
      return 'Joc de taula';
    case 'expansion':
      return 'Expansio';
    case 'rpg-book':
      return 'Llibre RPG';
    case 'accessory':
      return 'Accessori';
  }
}

function renderPlayerRange(min: number | null, max: number | null): string {
  if (min === null && max === null) {
    return 'Sense valor';
  }
  if (min !== null && max !== null) {
    return `${min}-${max}`;
  }
  return String(min ?? max);
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
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
