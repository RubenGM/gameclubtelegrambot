import {
  abandonRoleGameCharacter,
  addRoleGameCharacterAttachment,
  approveRoleGameCharacterClaim,
  assignRoleGameCharacter,
  canEditRoleGameCharacter,
  canRequestRoleGameCharacter,
  canViewRoleGameCharacter,
  canViewRoleGameCharacterAttachment,
  cancelRoleGameCharacterRequest,
  createRoleGameCharacter,
  rejectRoleGameCharacterClaim,
  removeRoleGameCharacterAttachment,
  replaceRoleGameCharacterAttachmentStorageEntry,
  requestRoleGameCharacter,
  transferRoleGameCharacter,
  unassignRoleGameCharacter,
  updateRoleGameCharacterAttachmentVisibility,
  updateRoleGameCharacter,
  type RoleGameCharacterClaimRequestRecord,
  type RoleGameCharacterAttachmentVisibility,
  type RoleGameCharacterRecord,
  type RoleGameCharacterRepository,
  type RoleGameCharacterVisibility,
} from '../role-games/role-game-character-catalog.js';
import { createDatabaseRoleGameCharacterRepository } from '../role-games/role-game-character-store.js';
import {
  canManageRoleGameOperationally,
  type RoleGameActor,
  type RoleGameMemberRecord,
  type RoleGameRecord,
  type RoleGameRepository,
} from '../role-games/role-game-catalog.js';
import { createDatabaseRoleGameRepository } from '../role-games/role-game-catalog-store.js';
import type { MembershipAccessRepository } from '../membership/access-flow.js';
import { createDatabaseMembershipAccessRepository } from '../membership/access-flow-store.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import { createStorageCategory, createStorageEntry, type StorageCategoryRecord, type StorageCategoryRepository } from '../storage/storage-catalog.js';
import { createDatabaseStorageRepository } from '../storage/storage-catalog-store.js';
import { internalRoleGameHandoutPurpose } from '../storage/storage-internal-purpose.js';
import { createDatabaseAppMetadataSessionStorage, type AppMetadataSessionStorage } from './conversation-session-store.js';
import { createTelegramI18n, normalizeBotLanguage, type BotLanguage } from './i18n.js';
import { escapeHtml } from './schedule-presentation.js';
import {
  buildRoleGameCharacterActionConfirmKeyboard,
  buildRoleGameCharacterAttachmentDetailKeyboard,
  buildRoleGameCharacterAttachmentsKeyboard,
  buildRoleGameCharacterConfirmKeyboard,
  buildRoleGameCharacterDetailKeyboard,
  buildRoleGameCharacterListKeyboard,
  buildRoleGameCharacterMenuKeyboard,
  buildRoleGameCharacterStepKeyboard,
} from './role-game-character-keyboards.js';

export const roleGameCharacterPageSize = 6;
const roleGameCharacterFlowKey = 'role-game-characters';
const roleGameCharacterStartPayloadPrefix = 'role_character_';
const storageDefaultChatMetadataKey = 'storage.default_chat';
const roleGameHandoutCategorySlug = 'role-handouts';
const roleGameHandoutCategoryName = 'Handouts de rol';

type CharacterListView = 'mine' | 'campaign' | 'unassigned';
type CharacterAction = 'request' | 'cancel-request' | 'abandon' | 'unassign' | 'assign' | 'transfer' | 'approve' | 'reject' | 'remove-attachment';
type CharacterCreateStep = 'owner' | 'name' | 'description' | 'url' | 'visibility' | 'confirm';
type CharacterEditField = 'name' | 'description' | 'url' | 'visibility';

interface RoleGameCharacterDraft {
  gameId: number;
  assignedMemberId: number | null;
  name?: string;
  description?: string | null;
  externalUrl?: string | null;
  visibility?: RoleGameCharacterVisibility;
}

interface RoleGameCharacterSessionData {
  gameId: number;
  view: 'menu' | CharacterListView | 'detail' | 'claims' | 'claim-detail' | 'members' | 'create' | 'edit' | 'confirm-action' | 'attachments' | 'attachment-detail' | 'attachment-upload';
  page: number;
  total: number;
  characterButtons: Record<string, number>;
  attachmentButtons: Record<string, number>;
  memberButtons?: Record<string, number>;
  claimButtons?: Record<string, number>;
  selectedCharacterId?: number;
  selectedClaimId?: number;
  selectedAttachmentId?: number;
  pendingStorageEntryId?: number;
  uploadMode?: 'add' | 'replace';
  createStep?: CharacterCreateStep;
  draft?: RoleGameCharacterDraft;
  editField?: CharacterEditField;
  pendingAction?: CharacterAction;
  pendingMemberId?: number;
}

export type TelegramRoleGameCharacterContext = TelegramCommandHandlerContext & {
  roleGameRepository?: RoleGameRepository;
  characterRepository?: RoleGameCharacterRepository;
  membershipRepository?: MembershipAccessRepository;
  storageRepository?: StorageCategoryRepository;
  storageDefaultChatStore?: AppMetadataSessionStorage;
};

export function buildVisibleRoleGameCharacterPage({
  characters,
  page,
}: { characters: RoleGameCharacterRecord[]; page: number }): {
  items: RoleGameCharacterRecord[];
  page: number;
  pages: number;
  total: number;
} {
  const total = characters.length;
  const pages = Math.max(1, Math.ceil(total / roleGameCharacterPageSize));
  const clamped = Math.min(Math.max(1, Number.isSafeInteger(page) ? page : 1), pages);
  const offset = (clamped - 1) * roleGameCharacterPageSize;
  return { items: characters.slice(offset, offset + roleGameCharacterPageSize), page: clamped, pages, total };
}

export function buildRoleGameCharacterButtonMap(
  characters: RoleGameCharacterRecord[],
  reservedLabels: string[],
): Record<string, number> {
  const counts = new Map<string, number>();
  for (const character of characters) counts.set(character.name, (counts.get(character.name) ?? 0) + 1);
  const reserved = new Set(reservedLabels);
  return Object.fromEntries(characters.map((character) => {
    const ambiguous = (counts.get(character.name) ?? 0) > 1 || reserved.has(character.name);
    return [ambiguous ? `${character.name} · #${character.id}` : character.name, character.id];
  }));
}

export function parseRoleGameCharacterStartPayload(text: string | undefined): number | null {
  const normalized = text?.trim();
  if (!normalized) return null;
  const payload = normalized.startsWith('/start ') ? normalized.slice('/start '.length).trim() : normalized;
  const match = payload.match(/^role_character_([1-9]\d*)$/u);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? id : null;
}

export function isSupportedRoleGameCharacterAttachmentKind(kind: string): kind is 'document' | 'photo' | 'video' | 'audio' {
  return kind === 'document' || kind === 'photo' || kind === 'video' || kind === 'audio';
}

export function isRoleGameCharacterSession(context: TelegramRoleGameCharacterContext): boolean {
  return context.runtime.session.current?.flowKey === roleGameCharacterFlowKey;
}

export async function openRoleGameCharacters(
  context: TelegramRoleGameCharacterContext,
  gameId: number,
  language = normalizeBotLanguage(context.runtime.bot.language, 'ca'),
): Promise<boolean> {
  const access = await loadGameAccess(context, gameId);
  if (!access || (!access.canManage && access.member?.status !== 'confirmed')) return false;
  await context.runtime.session.start({
    flowKey: roleGameCharacterFlowKey,
    stepKey: 'menu',
    data: { ...emptySession(gameId, 'menu') },
  });
  const t = createTelegramI18n(language).roleGames;
  await context.reply(t.charactersMenuTitle.replace('{title}', access.game.title), buildRoleGameCharacterMenuKeyboard({
    language,
    canManage: access.canManage,
  }));
  return true;
}

export async function handleTelegramRoleGameCharacterStartText(
  context: TelegramRoleGameCharacterContext,
): Promise<boolean> {
  const characterId = parseRoleGameCharacterStartPayload(context.messageText);
  if (characterId === null || context.runtime.chat.kind !== 'private') return false;
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const loaded = await loadVisibleCharacter(context, characterId);
  if (!loaded) {
    await context.reply(createTelegramI18n(language).roleGames.characterUnavailable);
    return true;
  }
  return replyWithCharacterDetail(context, loaded, language);
}

export async function handleTelegramRoleGameCharacterText(
  context: TelegramRoleGameCharacterContext,
): Promise<boolean> {
  const text = context.messageText?.trim();
  if (!text || context.runtime.chat.kind !== 'private' || context.runtime.actor.isBlocked || !isRoleGameCharacterSession(context)) return false;
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const t = createTelegramI18n(language).roleGames;
  const data = readSession(context);
  if (!data) return false;
  if (text === t.cancel) {
    if (data.pendingStorageEntryId) {
      await cleanupStorageEntry(context, data.pendingStorageEntryId);
    }
    await context.runtime.session.cancel();
    await context.reply(createTelegramI18n(language).common.flowCancelled);
    return true;
  }
  const access = await loadGameAccess(context, data.gameId);
  if (!access || (!access.canManage && access.member?.status !== 'confirmed')) {
    await context.runtime.session.cancel();
    await context.reply(t.characterUnavailable);
    return true;
  }
  if (text === t.backToGame) {
    await context.runtime.session.cancel();
    return false;
  }
  if (text === t.backToCharacters) return openRoleGameCharacters(context, access.game.id, language);
  if (text === t.backToCharacter && data.selectedCharacterId) {
    const loaded = await loadVisibleCharacter(context, data.selectedCharacterId);
    if (!loaded) return replyUnavailable(context, language);
    return replyWithCharacterDetail(context, loaded, language);
  }
  if (data.view === 'menu') return handleMenuText(context, access, text, language);
  if (data.view === 'mine' || data.view === 'campaign' || data.view === 'unassigned') {
    return handleListText(context, access, data, text, language);
  }
  if (data.view === 'detail') return handleDetailText(context, access, data, text, language);
  if (data.view === 'create') return handleCreateText(context, access, data, text, language);
  if (data.view === 'edit') return handleEditText(context, access, data, text, language);
  if (data.view === 'members') return handleMemberSelection(context, access, data, text, language);
  if (data.view === 'claims' || data.view === 'claim-detail') return handleClaimsText(context, access, data, text, language);
  if (data.view === 'confirm-action') return handleConfirmedAction(context, access, data, text, language);
  if (data.view === 'attachments' || data.view === 'attachment-detail' || data.view === 'attachment-upload') {
    return handleAttachmentText(context, access, data, text, language);
  }
  return false;
}

export async function handleTelegramRoleGameCharacterMessage(
  context: TelegramRoleGameCharacterContext,
): Promise<boolean> {
  if (!isRoleGameCharacterSession(context) || context.runtime.chat.kind !== 'private' || context.runtime.actor.isBlocked) return false;
  const data = readSession(context);
  if (!data || data.view !== 'attachment-upload' || !data.selectedCharacterId || !data.uploadMode) return false;
  const media = context.messageMedia;
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const t = createTelegramI18n(language).roleGames;
  if (!media || !isSupportedRoleGameCharacterAttachmentKind(media.attachmentKind)) {
    await context.reply(t.promptCharacterAttachment, buildRoleGameCharacterStepKeyboard({ language }));
    return true;
  }
  const loaded = await loadVisibleCharacter(context, data.selectedCharacterId);
  if (!loaded || !canEditRoleGameCharacter(actor(context), loaded.access.game, loaded.access.member, loaded.character)) return replyUnavailable(context, language);
  try {
    const entryId = await copyCharacterAttachmentToStorage(context, loaded.access.game.id, media);
    if (data.uploadMode === 'replace' && data.selectedAttachmentId) {
      const previous = await characterRepository(context).findAttachmentById(data.selectedAttachmentId);
      if (!previous || previous.characterId !== loaded.character.id) {
        await cleanupStorageEntry(context, entryId);
        return replyWithCharacterAttachments(context, loaded, language, t.characterActionStale);
      }
      try {
        await replaceRoleGameCharacterAttachmentStorageEntry({
          roleGameRepository: roleRepository(context), characterRepository: characterRepository(context), actor: actor(context),
          attachmentId: previous.id, internalStorageEntryId: entryId,
        });
      } catch (error) {
        await cleanupStorageEntry(context, entryId);
        throw error;
      }
      await cleanupStorageEntry(context, previous.internalStorageEntryId);
      return replyWithCharacterAttachments(context, loaded, language, t.characterAttachmentSaved);
    }
    await context.runtime.session.start({
      flowKey: roleGameCharacterFlowKey,
      stepKey: 'attachment-visibility',
      data: { ...data, pendingStorageEntryId: entryId },
    });
    await context.reply(t.promptCharacterAttachmentVisibility, buildRoleGameCharacterStepKeyboard({ language, rows: [[
      { text: t.characterAttachmentPlayers, semanticRole: 'primary' },
      { text: t.characterAttachmentPrivate, semanticRole: 'primary' },
    ]] }));
    return true;
  } catch (error) {
    context.runtime.logger?.warn?.({ error, characterId: data.selectedCharacterId }, 'role_game.character.attachment.copy.failed');
    await context.reply(t.characterAttachmentStorageError, buildRoleGameCharacterStepKeyboard({ language }));
    return true;
  }
}

interface GameAccess {
  game: RoleGameRecord;
  member: RoleGameMemberRecord | null;
  members: RoleGameMemberRecord[];
  canManage: boolean;
}

async function loadGameAccess(context: TelegramRoleGameCharacterContext, gameId: number): Promise<GameAccess | null> {
  const repository = roleRepository(context);
  const game = await repository.findGameById(gameId);
  if (!game) return null;
  const [member, members] = await Promise.all([
    repository.findMemberByTelegramUserId(game.id, context.runtime.actor.telegramUserId),
    repository.listMembers(game.id),
  ]);
  return {
    game,
    member,
    members,
    canManage: canManageRoleGameOperationally(actor(context), game, member),
  };
}

async function handleMenuText(
  context: TelegramRoleGameCharacterContext,
  access: GameAccess,
  text: string,
  language: BotLanguage,
): Promise<boolean> {
  const t = createTelegramI18n(language).roleGames;
  if (text === t.myCharacters) return replyWithCharacterList(context, access, 'mine', 1, language);
  if (text === t.campaignCharacters) return replyWithCharacterList(context, access, 'campaign', 1, language);
  if (text === t.unassignedCharacters) return replyWithCharacterList(context, access, 'unassigned', 1, language);
  if (text === t.createCharacter) return startCreateCharacter(context, access, language);
  if (access.canManage && text === t.characterClaims) return replyWithClaims(context, access, 1, language);
  if (access.canManage && text === t.assignCharacter) return replyWithCharacterList(context, access, 'unassigned', 1, language);
  return false;
}

async function visibleCharacters(context: TelegramRoleGameCharacterContext, access: GameAccess): Promise<RoleGameCharacterRecord[]> {
  return (await characterRepository(context).listCharacters(access.game.id)).filter((character) =>
    canViewRoleGameCharacter(actor(context), access.game, access.member, character));
}

async function replyWithCharacterList(
  context: TelegramRoleGameCharacterContext,
  access: GameAccess,
  view: CharacterListView,
  page: number,
  language: BotLanguage,
): Promise<boolean> {
  let characters = await visibleCharacters(context, access);
  if (view === 'mine') characters = characters.filter((item) => item.assignedMemberId === access.member?.id);
  if (view === 'unassigned') characters = characters.filter((item) => item.assignedMemberId === null);
  const result = buildVisibleRoleGameCharacterPage({ characters, page });
  const reserved = characterReservedLabels(language);
  const characterButtons = buildRoleGameCharacterButtonMap(result.items, reserved);
  await context.runtime.session.start({
    flowKey: roleGameCharacterFlowKey,
    stepKey: view,
    data: { ...emptySession(access.game.id, view), page: result.page, total: result.total, characterButtons },
  });
  const t = createTelegramI18n(language).roleGames;
  const header = view === 'mine' ? t.myCharacters : view === 'campaign' ? t.campaignCharacters : t.unassignedCharacters;
  const lines = result.items.map((item) => `• ${escapeHtml(item.name)}${item.assignedMemberId === null ? ` · ${escapeHtml(t.characterUnassigned)}` : ''}`);
  const footer = t.characterListFooter
    .replace('{from}', String(result.total === 0 ? 0 : (result.page - 1) * roleGameCharacterPageSize + 1))
    .replace('{to}', String(Math.min(result.page * roleGameCharacterPageSize, result.total)))
    .replace('{total}', String(result.total)).replace('{page}', String(result.page)).replace('{pages}', String(result.pages));
  await context.reply([`<b>${escapeHtml(header)}</b>`, lines.length ? lines.join('\n') : escapeHtml(t.noCharacters), footer].join('\n\n'), {
    ...buildRoleGameCharacterListKeyboard({
      language,
      characterButtons,
      hasPreviousPage: result.page > 1,
      hasNextPage: result.page < result.pages,
    }),
    parseMode: 'HTML',
  });
  return true;
}

async function handleListText(
  context: TelegramRoleGameCharacterContext,
  access: GameAccess,
  data: RoleGameCharacterSessionData,
  text: string,
  language: BotLanguage,
): Promise<boolean> {
  const t = createTelegramI18n(language).roleGames;
  const view = data.view as CharacterListView;
  if (text === t.previousPage) return replyWithCharacterList(context, access, view, data.page - 1, language);
  if (text === t.nextPage) return replyWithCharacterList(context, access, view, data.page + 1, language);
  const id = data.characterButtons[text];
  if (!id) return false;
  const loaded = await loadVisibleCharacter(context, id);
  if (!loaded || loaded.access.game.id !== access.game.id) return replyWithCharacterList(context, access, view, data.page, language);
  return replyWithCharacterDetail(context, loaded, language);
}

async function loadVisibleCharacter(context: TelegramRoleGameCharacterContext, characterId: number): Promise<{ character: RoleGameCharacterRecord; access: GameAccess } | null> {
  const character = await characterRepository(context).findCharacterById(characterId);
  if (!character) return null;
  const access = await loadGameAccess(context, character.roleGameId);
  if (!access || !canViewRoleGameCharacter(actor(context), access.game, access.member, character)) return null;
  return { character, access };
}

async function replyWithCharacterDetail(
  context: TelegramRoleGameCharacterContext,
  loaded: { character: RoleGameCharacterRecord; access: GameAccess },
  language: BotLanguage,
  prefix?: string,
): Promise<boolean> {
  const { character, access } = loaded;
  const attachments = await characterRepository(context).listAttachments(character.id);
  const visibleAttachments = attachments.filter((attachment) =>
    canViewRoleGameCharacterAttachment(actor(context), access.game, access.member, character, attachment));
  const ownClaim = access.member ? (await characterRepository(context).listClaimRequests({
    roleGameId: access.game.id,
    characterId: character.id,
    requestedByMemberId: access.member.id,
    status: 'requested',
  }))[0] ?? null : null;
  const owner = character.assignedMemberId === null
    ? null
    : access.members.find((member) => member.id === character.assignedMemberId) ?? null;
  const t = createTelegramI18n(language).roleGames;
  const canEdit = canEditRoleGameCharacter(actor(context), access.game, access.member, character);
  const canRequest = canRequestRoleGameCharacter(actor(context), access.game, access.member, character) && !ownClaim;
  await context.runtime.session.start({
    flowKey: roleGameCharacterFlowKey,
    stepKey: 'detail',
    data: { ...emptySession(access.game.id, 'detail'), selectedCharacterId: character.id },
  });
  const message = [
    prefix,
    `<b>${escapeHtml(t.characterDetailTitle)}: ${escapeHtml(character.name)}</b>`,
    `${escapeHtml(t.descriptionLabel)}: ${escapeHtml(character.description ?? t.noDescription)}`,
    character.externalUrl ? `URL: <a href="${escapeHtml(character.externalUrl)}">${escapeHtml(character.externalUrl)}</a>` : null,
    `${escapeHtml(t.visibilityLabel)}: ${escapeHtml(character.visibility === 'players' ? t.characterVisibilityPlayers : t.characterVisibilityPrivate)}`,
    `${escapeHtml(t.characterOwner)}: ${owner ? escapeHtml(await memberLabel(context, owner, language)) : escapeHtml(t.characterUnassigned)}`,
    `${escapeHtml(t.characterCreator)}: ${character.createdByTelegramUserId}`,
    `${escapeHtml(t.characterCreatedAt)}: ${escapeHtml(new Date(character.createdAt).toLocaleString(language))}`,
    `${escapeHtml(t.characterAttachments)}: ${visibleAttachments.length}`,
  ].filter((line): line is string => Boolean(line)).join('\n');
  await context.reply(message, {
    ...buildRoleGameCharacterDetailKeyboard({
      language,
      canEdit,
      canManage: access.canManage,
      canRequest,
      hasOwnPendingRequest: Boolean(ownClaim),
      isOwner: character.assignedMemberId === access.member?.id,
      isAssigned: character.assignedMemberId !== null,
    }),
    parseMode: 'HTML',
  });
  return true;
}

async function handleDetailText(context: TelegramRoleGameCharacterContext, access: GameAccess, data: RoleGameCharacterSessionData, text: string, language: BotLanguage): Promise<boolean> {
  if (!data.selectedCharacterId) return false;
  const loaded = await loadVisibleCharacter(context, data.selectedCharacterId);
  if (!loaded || loaded.access.game.id !== access.game.id) return replyUnavailable(context, language);
  const t = createTelegramI18n(language).roleGames;
  const character = loaded.character;
  if (text === t.editCharacter && canEditRoleGameCharacter(actor(context), access.game, access.member, character)) {
    await context.runtime.session.start({ flowKey: roleGameCharacterFlowKey, stepKey: 'edit', data: { ...emptySession(access.game.id, 'edit'), selectedCharacterId: character.id } });
    await context.reply(t.editCharacter, buildRoleGameCharacterStepKeyboard({ language, rows: [[
      { text: t.characterEditName, semanticRole: 'primary' }, { text: t.characterEditDescription, semanticRole: 'primary' },
    ], [{ text: t.characterEditUrl, semanticRole: 'primary' }, { text: t.characterEditVisibility, semanticRole: 'primary' }]] }));
    return true;
  }
  if (text === t.manageCharacterAttachments) {
    return replyWithCharacterAttachments(context, loaded, language);
  }
  const claims = access.member ? await characterRepository(context).listClaimRequests({ roleGameId: access.game.id, characterId: character.id, requestedByMemberId: access.member.id, status: 'requested' }) : [];
  if (text === t.requestCharacter && canRequestRoleGameCharacter(actor(context), access.game, access.member, character) && claims.length === 0) return askConfirmation(context, data, 'request', language);
  if (text === t.cancelCharacterRequest && claims[0]) return askConfirmation(context, { ...data, selectedClaimId: claims[0].id }, 'cancel-request', language);
  if (text === t.abandonCharacter && character.assignedMemberId === access.member?.id) return askConfirmation(context, data, 'abandon', language);
  if (text === t.unassignCharacter && access.canManage && character.assignedMemberId !== null) return askConfirmation(context, data, 'unassign', language);
  if (text === t.assignCharacter && access.canManage && character.assignedMemberId === null) return replyWithMemberSelection(context, access, character.id, 'assign', language);
  if (text === t.transferCharacter && access.canManage && character.assignedMemberId !== null) return replyWithMemberSelection(context, access, character.id, 'transfer', language);
  return false;
}

async function replyWithCharacterAttachments(
  context: TelegramRoleGameCharacterContext,
  loaded: { character: RoleGameCharacterRecord; access: GameAccess },
  language: BotLanguage,
  prefix?: string,
  requestedPage = 1,
): Promise<boolean> {
  const { character, access } = loaded;
  const attachments = (await characterRepository(context).listAttachments(character.id)).filter((attachment) =>
    canViewRoleGameCharacterAttachment(actor(context), access.game, access.member, character, attachment));
  const t = createTelegramI18n(language).roleGames;
  const pages = Math.max(1, Math.ceil(attachments.length / roleGameCharacterPageSize));
  const page = Math.min(Math.max(1, requestedPage), pages);
  const pageItems = attachments.slice((page - 1) * roleGameCharacterPageSize, page * roleGameCharacterPageSize);
  const labels = Object.fromEntries(pageItems.map((attachment) => [
    `${t.characterAttachment.replace('{id}', String(attachment.id))} · ${attachment.visibility === 'players' ? t.characterAttachmentPlayers : t.characterAttachmentPrivate}`,
    attachment.id,
  ]));
  await context.runtime.session.start({
    flowKey: roleGameCharacterFlowKey,
    stepKey: 'attachments',
    data: { ...emptySession(access.game.id, 'attachments'), selectedCharacterId: character.id, attachmentButtons: labels, page, total: attachments.length },
  });
  await context.reply([prefix, `<b>${escapeHtml(t.characterAttachmentList)}</b>`, attachments.length ? Object.keys(labels).map((label) => `• ${escapeHtml(label)}`).join('\n') : t.noCharacterAttachments].filter(Boolean).join('\n\n'), {
    ...buildRoleGameCharacterAttachmentsKeyboard({
      language,
      attachmentButtons: labels,
      canEdit: canEditRoleGameCharacter(actor(context), access.game, access.member, character),
      hasPreviousPage: page > 1,
      hasNextPage: page < pages,
    }),
    parseMode: 'HTML',
  });
  return true;
}

async function handleAttachmentText(
  context: TelegramRoleGameCharacterContext,
  access: GameAccess,
  data: RoleGameCharacterSessionData,
  text: string,
  language: BotLanguage,
): Promise<boolean> {
  if (!data.selectedCharacterId) return false;
  const loaded = await loadVisibleCharacter(context, data.selectedCharacterId);
  if (!loaded || loaded.access.game.id !== access.game.id) return replyUnavailable(context, language);
  const t = createTelegramI18n(language).roleGames;
  const canEdit = canEditRoleGameCharacter(actor(context), access.game, access.member, loaded.character);
  if (text === t.manageCharacterAttachments) return replyWithCharacterAttachments(context, loaded, language);
  if (data.view === 'attachments') {
    if (text === t.previousPage) return replyWithCharacterAttachments(context, loaded, language, undefined, data.page - 1);
    if (text === t.nextPage) return replyWithCharacterAttachments(context, loaded, language, undefined, data.page + 1);
    if (text === t.addCharacterAttachment && canEdit) return startAttachmentUpload(context, data, 'add', language);
    const attachmentId = data.attachmentButtons[text];
    if (!attachmentId) return false;
    const attachment = await characterRepository(context).findAttachmentById(attachmentId);
    if (!attachment || !canViewRoleGameCharacterAttachment(actor(context), access.game, access.member, loaded.character, attachment)) return replyWithCharacterAttachments(context, loaded, language);
    const detail = await storageRepository(context).getEntryDetail(attachment.internalStorageEntryId);
    if (detail && context.runtime.bot.copyMessage) {
      for (const message of detail.messages) await context.runtime.bot.copyMessage({ fromChatId: message.storageChatId, messageId: message.storageMessageId, toChatId: context.runtime.actor.telegramUserId });
    }
    await context.runtime.session.start({ flowKey: roleGameCharacterFlowKey, stepKey: 'attachment-detail', data: { ...data, view: 'attachment-detail', selectedAttachmentId: attachment.id } });
    await context.reply(`${t.characterAttachment.replace('{id}', String(attachment.id))}\n${attachment.visibility === 'players' ? t.characterAttachmentPlayers : t.characterAttachmentPrivate}`, buildRoleGameCharacterAttachmentDetailKeyboard({ language, canEdit }));
    return true;
  }
  if (data.view === 'attachment-detail' && data.selectedAttachmentId) {
    const attachment = await characterRepository(context).findAttachmentById(data.selectedAttachmentId);
    if (!attachment || attachment.characterId !== loaded.character.id) return replyWithCharacterAttachments(context, loaded, language);
    if (text === t.replaceCharacterAttachment && canEdit) return startAttachmentUpload(context, data, 'replace', language);
    if (text === t.changeCharacterAttachmentVisibility && canEdit) {
      const visibility: RoleGameCharacterAttachmentVisibility = attachment.visibility === 'players' ? 'private' : 'players';
      try {
        await updateRoleGameCharacterAttachmentVisibility({ roleGameRepository: roleRepository(context), characterRepository: characterRepository(context), actor: actor(context), attachmentId: attachment.id, visibility });
        return replyWithCharacterAttachments(context, loaded, language, t.characterAttachmentSaved);
      } catch { return replyWithCharacterAttachments(context, loaded, language, t.characterActionStale); }
    }
    if (text === t.removeCharacterAttachment && canEdit) return askConfirmation(context, data, 'remove-attachment', language);
    return false;
  }
  if (data.view === 'attachment-upload' && data.pendingStorageEntryId) {
    const visibility: RoleGameCharacterAttachmentVisibility | null = text === t.characterAttachmentPlayers ? 'players' : text === t.characterAttachmentPrivate ? 'private' : null;
    if (!visibility) return false;
    try {
      await addRoleGameCharacterAttachment({ roleGameRepository: roleRepository(context), characterRepository: characterRepository(context), actor: actor(context), characterId: loaded.character.id, internalStorageEntryId: data.pendingStorageEntryId, visibility });
      return replyWithCharacterAttachments(context, loaded, language, t.characterAttachmentSaved);
    } catch (error) {
      await cleanupStorageEntry(context, data.pendingStorageEntryId);
      context.runtime.logger?.warn?.({ error, characterId: loaded.character.id }, 'role_game.character.attachment.link.failed');
      return replyWithCharacterAttachments(context, loaded, language, t.characterAttachmentStorageError);
    }
  }
  return false;
}

async function startAttachmentUpload(context: TelegramRoleGameCharacterContext, data: RoleGameCharacterSessionData, mode: 'add' | 'replace', language: BotLanguage): Promise<boolean> {
  const { pendingStorageEntryId: _pendingStorageEntryId, ...cleanData } = data;
  await context.runtime.session.start({ flowKey: roleGameCharacterFlowKey, stepKey: 'attachment-upload', data: { ...cleanData, view: 'attachment-upload', uploadMode: mode } });
  await context.reply(createTelegramI18n(language).roleGames.promptCharacterAttachment, buildRoleGameCharacterStepKeyboard({ language }));
  return true;
}

async function startCreateCharacter(context: TelegramRoleGameCharacterContext, access: GameAccess, language: BotLanguage): Promise<boolean> {
  const t = createTelegramI18n(language).roleGames;
  if (access.canManage) {
    return promptCreateOwner(context, access, { gameId: access.game.id, assignedMemberId: null }, language, 1);
  }
  if (!access.member || access.member.status !== 'confirmed') return false;
  return promptCreateName(context, { gameId: access.game.id, assignedMemberId: access.member.id }, language);
}

async function promptCreateName(context: TelegramRoleGameCharacterContext, draft: RoleGameCharacterDraft, language: BotLanguage): Promise<boolean> {
  await context.runtime.session.start({ flowKey: roleGameCharacterFlowKey, stepKey: 'name', data: { ...emptySession(draft.gameId, 'create'), createStep: 'name', draft } });
  await context.reply(createTelegramI18n(language).roleGames.promptCharacterName, buildRoleGameCharacterStepKeyboard({ language }));
  return true;
}

async function handleCreateText(context: TelegramRoleGameCharacterContext, access: GameAccess, data: RoleGameCharacterSessionData, text: string, language: BotLanguage): Promise<boolean> {
  const t = createTelegramI18n(language).roleGames;
  const draft = data.draft;
  if (!draft || draft.gameId !== access.game.id || !data.createStep) return false;
  if (data.createStep === 'owner') {
    if (!access.canManage) return replyUnavailable(context, language);
    if (text === t.previousPage) return promptCreateOwner(context, access, draft, language, data.page - 1);
    if (text === t.nextPage) return promptCreateOwner(context, access, draft, language, data.page + 1);
    if (text === t.leaveCharacterUnassigned) return promptCreateName(context, { ...draft, assignedMemberId: null }, language);
    const memberId = data.memberButtons?.[text];
    if (!memberId || !access.members.some((member) => member.id === memberId && member.status === 'confirmed')) return false;
    return promptCreateName(context, { ...draft, assignedMemberId: memberId }, language);
  }
  if (data.createStep === 'name') {
    const next = { ...draft, name: text };
    await saveCreateStep(context, next, 'description', language, t.promptCharacterDescription, [[{ text: t.skipCharacterField, semanticRole: 'navigation' }]]);
    return true;
  }
  if (data.createStep === 'description') {
    const next = { ...draft, description: text === t.skipCharacterField ? null : text };
    await saveCreateStep(context, next, 'url', language, t.promptCharacterUrl, [[{ text: t.skipCharacterField, semanticRole: 'navigation' }]]);
    return true;
  }
  if (data.createStep === 'url') {
    const url = text === t.skipCharacterField ? null : text;
    if (url !== null && !isValidExternalUrl(url)) {
      await context.reply(t.characterInvalidValue, buildRoleGameCharacterStepKeyboard({ language, rows: [[{ text: t.skipCharacterField, semanticRole: 'navigation' }]] }));
      return true;
    }
    const next = { ...draft, externalUrl: url };
    await saveCreateStep(context, next, 'visibility', language, t.promptCharacterVisibility, [[
      { text: t.characterVisibilityPlayers, semanticRole: 'primary' }, { text: t.characterVisibilityPrivate, semanticRole: 'primary' },
    ]]);
    return true;
  }
  if (data.createStep === 'visibility') {
    const visibility: RoleGameCharacterVisibility | null = text === t.characterVisibilityPlayers ? 'players' : text === t.characterVisibilityPrivate ? 'private' : null;
    if (!visibility) return false;
    const next = { ...draft, visibility };
    await context.runtime.session.start({ flowKey: roleGameCharacterFlowKey, stepKey: 'confirm', data: { ...emptySession(access.game.id, 'create'), createStep: 'confirm', draft: next } });
    await context.reply(formatDraft(next, t), buildRoleGameCharacterConfirmKeyboard(language));
    return true;
  }
  if (data.createStep === 'confirm' && text === t.confirmCreateCharacter && draft.name && draft.visibility) {
    try {
      const character = await createRoleGameCharacter({ roleGameRepository: roleRepository(context), characterRepository: characterRepository(context), actor: actor(context), gameId: access.game.id, assignedMemberId: draft.assignedMemberId, draft: { name: draft.name, description: draft.description ?? null, externalUrl: draft.externalUrl ?? null, visibility: draft.visibility } });
      const loaded = await loadVisibleCharacter(context, character.id);
      return loaded ? replyWithCharacterDetail(context, loaded, language, t.characterSaved) : replyUnavailable(context, language);
    } catch {
      await context.reply(t.characterInvalidValue, buildRoleGameCharacterConfirmKeyboard(language));
      return true;
    }
  }
  return false;
}

async function promptCreateOwner(context: TelegramRoleGameCharacterContext, access: GameAccess, draft: RoleGameCharacterDraft, language: BotLanguage, requestedPage: number): Promise<boolean> {
  const t = createTelegramI18n(language).roleGames;
  const members = access.members.filter((member) => member.status === 'confirmed');
  const pages = Math.max(1, Math.ceil(members.length / roleGameCharacterPageSize));
  const page = Math.min(Math.max(1, requestedPage), pages);
  const pageMembers = members.slice((page - 1) * roleGameCharacterPageSize, page * roleGameCharacterPageSize);
  const memberButtons = await buildMemberButtons(context, pageMembers, language, [t.leaveCharacterUnassigned, ...characterReservedLabels(language)]);
  const navigation = [];
  if (page > 1) navigation.push({ text: t.previousPage, semanticRole: 'navigation' as const });
  if (page < pages) navigation.push({ text: t.nextPage, semanticRole: 'navigation' as const });
  await context.runtime.session.start({ flowKey: roleGameCharacterFlowKey, stepKey: 'owner', data: { ...emptySession(access.game.id, 'create'), createStep: 'owner', draft, memberButtons, page, total: members.length } });
  await context.reply(t.promptCharacterOwner, buildRoleGameCharacterStepKeyboard({ language, rows: [
    ...Object.keys(memberButtons).map((label) => [{ text: label, semanticRole: 'primary' as const }]),
    ...(navigation.length ? [navigation] : []),
    [{ text: t.leaveCharacterUnassigned, semanticRole: 'navigation' }],
  ] }));
  return true;
}

async function saveCreateStep(context: TelegramRoleGameCharacterContext, draft: RoleGameCharacterDraft, step: CharacterCreateStep, language: BotLanguage, prompt: string, rows: Array<Array<{ text: string; semanticRole: 'primary' | 'navigation' }>>): Promise<void> {
  await context.runtime.session.start({ flowKey: roleGameCharacterFlowKey, stepKey: step, data: { ...emptySession(draft.gameId, 'create'), createStep: step, draft } });
  await context.reply(prompt, buildRoleGameCharacterStepKeyboard({ language, rows }));
}

async function handleEditText(context: TelegramRoleGameCharacterContext, access: GameAccess, data: RoleGameCharacterSessionData, text: string, language: BotLanguage): Promise<boolean> {
  if (!data.selectedCharacterId) return false;
  const loaded = await loadVisibleCharacter(context, data.selectedCharacterId);
  if (!loaded || !canEditRoleGameCharacter(actor(context), access.game, access.member, loaded.character)) return replyUnavailable(context, language);
  const t = createTelegramI18n(language).roleGames;
  if (text === t.characterActionCancelled) return replyWithCharacterDetail(context, loaded, language, t.characterActionCancelled);
  if (data.editField && data.draft && text === t.confirmCharacterAction) {
    try {
      const updated = await updateRoleGameCharacter({
        roleGameRepository: roleRepository(context), characterRepository: characterRepository(context), actor: actor(context),
        characterId: loaded.character.id,
        draft: {
          name: data.draft.name ?? loaded.character.name,
          description: data.draft.description ?? null,
          externalUrl: data.draft.externalUrl ?? null,
          visibility: data.draft.visibility ?? loaded.character.visibility,
        },
      });
      const refreshed = await loadVisibleCharacter(context, updated.id);
      return refreshed ? replyWithCharacterDetail(context, refreshed, language, t.characterSaved) : replyUnavailable(context, language);
    } catch {
      return replyWithCharacterDetail(context, loaded, language, t.characterActionStale);
    }
  }
  const field: CharacterEditField | null = text === t.characterEditName ? 'name' : text === t.characterEditDescription ? 'description' : text === t.characterEditUrl ? 'url' : text === t.characterEditVisibility ? 'visibility' : null;
  if (!data.editField && field) {
    await context.runtime.session.start({ flowKey: roleGameCharacterFlowKey, stepKey: `edit-${field}`, data: { ...data, editField: field } });
    const rows = field === 'visibility' ? [[{ text: t.characterVisibilityPlayers, semanticRole: 'primary' as const }, { text: t.characterVisibilityPrivate, semanticRole: 'primary' as const }]] : field === 'description' || field === 'url' ? [[{ text: t.clearCharacterField, semanticRole: 'navigation' as const }]] : [];
    await context.reply(field === 'name' ? t.promptCharacterName : field === 'description' ? t.promptCharacterDescription : field === 'url' ? t.promptCharacterUrl : t.promptCharacterVisibility, buildRoleGameCharacterStepKeyboard({ language, rows }));
    return true;
  }
  if (!data.editField) return false;
  const current = loaded.character;
  let draft = { name: current.name, description: current.description, externalUrl: current.externalUrl, visibility: current.visibility };
  if (data.editField === 'name') draft = { ...draft, name: text };
  if (data.editField === 'description') draft = { ...draft, description: text === t.clearCharacterField ? null : text };
  if (data.editField === 'url') {
    const value = text === t.clearCharacterField ? null : text;
    if (value !== null && !isValidExternalUrl(value)) { await context.reply(t.characterInvalidValue); return true; }
    draft = { ...draft, externalUrl: value };
  }
  if (data.editField === 'visibility') {
    const value = text === t.characterVisibilityPlayers ? 'players' : text === t.characterVisibilityPrivate ? 'private' : null;
    if (!value) return false;
    draft = { ...draft, visibility: value };
  }
  await context.runtime.session.start({
    flowKey: roleGameCharacterFlowKey,
    stepKey: 'edit-confirm',
    data: { ...data, draft: { gameId: access.game.id, assignedMemberId: current.assignedMemberId, ...draft } },
  });
  await context.reply(formatDraft({ gameId: access.game.id, assignedMemberId: current.assignedMemberId, ...draft }, t), buildRoleGameCharacterActionConfirmKeyboard(language));
  return true;
}

async function replyWithMemberSelection(context: TelegramRoleGameCharacterContext, access: GameAccess, characterId: number, action: 'assign' | 'transfer', language: BotLanguage, requestedPage = 1): Promise<boolean> {
  const current = action === 'transfer' ? await characterRepository(context).findCharacterById(characterId) : null;
  const members = access.members.filter((member) => member.status === 'confirmed' && member.id !== current?.assignedMemberId);
  const t = createTelegramI18n(language).roleGames;
  const pages = Math.max(1, Math.ceil(members.length / roleGameCharacterPageSize));
  const page = Math.min(Math.max(1, requestedPage), pages);
  const pageMembers = members.slice((page - 1) * roleGameCharacterPageSize, page * roleGameCharacterPageSize);
  const memberButtons = await buildMemberButtons(context, pageMembers, language, characterReservedLabels(language));
  const navigation = [];
  if (page > 1) navigation.push({ text: t.previousPage, semanticRole: 'navigation' as const });
  if (page < pages) navigation.push({ text: t.nextPage, semanticRole: 'navigation' as const });
  await context.runtime.session.start({ flowKey: roleGameCharacterFlowKey, stepKey: 'members', data: { ...emptySession(access.game.id, 'members'), selectedCharacterId: characterId, pendingAction: action, memberButtons, page, total: members.length } });
  await context.reply(t.characterSelectMember, buildRoleGameCharacterStepKeyboard({ language, rows: [...Object.keys(memberButtons).map((label) => [{ text: label, semanticRole: 'primary' as const }]), ...(navigation.length ? [navigation] : [])] }));
  return true;
}

async function handleMemberSelection(context: TelegramRoleGameCharacterContext, access: GameAccess, data: RoleGameCharacterSessionData, text: string, language: BotLanguage): Promise<boolean> {
  const t = createTelegramI18n(language).roleGames;
  if (data.selectedCharacterId && (data.pendingAction === 'assign' || data.pendingAction === 'transfer')) {
    if (text === t.previousPage) return replyWithMemberSelection(context, access, data.selectedCharacterId, data.pendingAction, language, data.page - 1);
    if (text === t.nextPage) return replyWithMemberSelection(context, access, data.selectedCharacterId, data.pendingAction, language, data.page + 1);
  }
  const memberId = data.memberButtons?.[text];
  if (!memberId || !data.selectedCharacterId || !data.pendingAction || !access.canManage || !access.members.some((member) => member.id === memberId && member.status === 'confirmed')) return false;
  return askConfirmation(context, { ...data, pendingMemberId: memberId }, data.pendingAction, language);
}

async function replyWithClaims(context: TelegramRoleGameCharacterContext, access: GameAccess, page: number, language: BotLanguage): Promise<boolean> {
  if (!access.canManage) return false;
  const claims = await characterRepository(context).listClaimRequests({ roleGameId: access.game.id, status: 'requested' });
  const characters = await characterRepository(context).listCharacters(access.game.id);
  const pages = Math.max(1, Math.ceil(claims.length / roleGameCharacterPageSize));
  const clampedPage = Math.min(Math.max(1, page), pages);
  const result = { items: claims.slice((clampedPage - 1) * roleGameCharacterPageSize, clampedPage * roleGameCharacterPageSize), total: claims.length, page: clampedPage, pages };
  const labels: Record<string, number> = {};
  for (const claim of result.items) {
    const character = characters.find((item) => item.id === claim.characterId);
    labels[`${character?.name ?? '#'} · #${claim.id}`] = claim.id;
  }
  await context.runtime.session.start({ flowKey: roleGameCharacterFlowKey, stepKey: 'claims', data: { ...emptySession(access.game.id, 'claims'), page: result.page, total: result.total, claimButtons: labels } });
  const t = createTelegramI18n(language).roleGames;
  await context.reply(result.total ? `<b>${escapeHtml(t.characterClaims)}</b>\n\n${Object.keys(labels).map((label) => `• ${escapeHtml(label)}`).join('\n')}` : t.characterNoClaims, buildRoleGameCharacterListKeyboard({ language, characterButtons: labels, hasPreviousPage: result.page > 1, hasNextPage: result.page < result.pages }));
  return true;
}

async function handleClaimsText(context: TelegramRoleGameCharacterContext, access: GameAccess, data: RoleGameCharacterSessionData, text: string, language: BotLanguage): Promise<boolean> {
  if (!access.canManage) return false;
  const t = createTelegramI18n(language).roleGames;
  if (data.view === 'claims') {
    if (text === t.previousPage) return replyWithClaims(context, access, data.page - 1, language);
    if (text === t.nextPage) return replyWithClaims(context, access, data.page + 1, language);
    const requestId = data.claimButtons?.[text];
    if (!requestId) return false;
    const request = await characterRepository(context).findClaimRequestById(requestId);
    if (!request || request.status !== 'requested') return replyWithClaims(context, access, data.page, language);
    const character = await characterRepository(context).findCharacterById(request.characterId);
    if (!character || character.roleGameId !== access.game.id) return replyWithClaims(context, access, data.page, language);
    await context.runtime.session.start({ flowKey: roleGameCharacterFlowKey, stepKey: 'claim-detail', data: { ...emptySession(access.game.id, 'claim-detail'), selectedClaimId: request.id, selectedCharacterId: character.id } });
    await context.reply(`<b>${escapeHtml(character.name)}</b> · #${request.id}`, buildRoleGameCharacterStepKeyboard({ language, rows: [[{ text: t.approveCharacterClaim, semanticRole: 'success' }, { text: t.rejectCharacterClaim, semanticRole: 'danger' }], [{ text: t.backToCharacters, semanticRole: 'navigation' }]] }));
    return true;
  }
  if (text === t.approveCharacterClaim) return askConfirmation(context, data, 'approve', language);
  if (text === t.rejectCharacterClaim) return askConfirmation(context, data, 'reject', language);
  return false;
}

async function askConfirmation(context: TelegramRoleGameCharacterContext, data: RoleGameCharacterSessionData, action: CharacterAction, language: BotLanguage): Promise<boolean> {
  await context.runtime.session.start({ flowKey: roleGameCharacterFlowKey, stepKey: 'confirm-action', data: { ...data, view: 'confirm-action', pendingAction: action } });
  await context.reply(createTelegramI18n(language).roleGames.confirmCharacterAction, buildRoleGameCharacterActionConfirmKeyboard(language));
  return true;
}

async function handleConfirmedAction(context: TelegramRoleGameCharacterContext, access: GameAccess, data: RoleGameCharacterSessionData, text: string, language: BotLanguage): Promise<boolean> {
  const t = createTelegramI18n(language).roleGames;
  if (text === t.characterActionCancelled) {
    if (data.selectedCharacterId) { const loaded = await loadVisibleCharacter(context, data.selectedCharacterId); if (loaded) return replyWithCharacterDetail(context, loaded, language, t.characterActionCancelled); }
    return openRoleGameCharacters(context, access.game.id, language);
  }
  if (text !== t.confirmCharacterAction || !data.pendingAction) return false;
  const repos = { roleGameRepository: roleRepository(context), characterRepository: characterRepository(context), actor: actor(context) };
  try {
    let notification: string = t.characterSaved;
    const currentCharacter = data.selectedCharacterId ? await characterRepository(context).findCharacterById(data.selectedCharacterId) : null;
    const previousOwner = currentCharacter?.assignedMemberId ? access.members.find((member) => member.id === currentCharacter.assignedMemberId) ?? null : null;
    const selectedClaim = data.selectedClaimId ? await characterRepository(context).findClaimRequestById(data.selectedClaimId) : null;
    const claimMember = selectedClaim ? access.members.find((member) => member.id === selectedClaim.requestedByMemberId) ?? null : null;
    const targetMember = data.pendingMemberId ? access.members.find((member) => member.id === data.pendingMemberId) ?? null : null;
    if (data.pendingAction === 'request' && data.selectedCharacterId) {
      await requestRoleGameCharacter({ ...repos, characterId: data.selectedCharacterId });
      notification = t.characterRequestCreated;
      await notifyCharacterChange(context, access.game.primaryGmTelegramUserId, language, 'request', currentCharacter?.name ?? '', access.game.title);
    }
    if (data.pendingAction === 'cancel-request' && data.selectedClaimId) { await cancelRoleGameCharacterRequest({ ...repos, requestId: data.selectedClaimId }); notification = t.characterRequestCancelled; }
    if (data.pendingAction === 'abandon' && data.selectedCharacterId) {
      await abandonRoleGameCharacter({ ...repos, characterId: data.selectedCharacterId });
      if (previousOwner) await notifyCharacterChange(context, previousOwner.telegramUserId, language, 'unassigned', currentCharacter?.name ?? '', access.game.title);
    }
    if (data.pendingAction === 'unassign' && data.selectedCharacterId) {
      await unassignRoleGameCharacter({ ...repos, characterId: data.selectedCharacterId });
      if (previousOwner) await notifyCharacterChange(context, previousOwner.telegramUserId, language, 'unassigned', currentCharacter?.name ?? '', access.game.title);
    }
    if (data.pendingAction === 'assign' && data.selectedCharacterId && data.pendingMemberId) {
      await assignRoleGameCharacter({ ...repos, characterId: data.selectedCharacterId, assignedMemberId: data.pendingMemberId });
      if (targetMember) await notifyCharacterChange(context, targetMember.telegramUserId, language, 'assigned', currentCharacter?.name ?? '', access.game.title);
    }
    if (data.pendingAction === 'transfer' && data.selectedCharacterId && data.pendingMemberId) {
      await transferRoleGameCharacter({ ...repos, characterId: data.selectedCharacterId, assignedMemberId: data.pendingMemberId });
      if (previousOwner) await notifyCharacterChange(context, previousOwner.telegramUserId, language, 'unassigned', currentCharacter?.name ?? '', access.game.title);
      if (targetMember) await notifyCharacterChange(context, targetMember.telegramUserId, language, 'assigned', currentCharacter?.name ?? '', access.game.title);
    }
    if (data.pendingAction === 'approve' && data.selectedClaimId) {
      const result = await approveRoleGameCharacterClaim({ ...repos, requestId: data.selectedClaimId });
      notification = t.characterClaimApproved;
      if (claimMember) await notifyCharacterChange(context, claimMember.telegramUserId, language, 'approved', result.character.name, access.game.title);
    }
    if (data.pendingAction === 'reject' && data.selectedClaimId) {
      const result = await rejectRoleGameCharacterClaim({ ...repos, requestId: data.selectedClaimId });
      notification = t.characterClaimRejected;
      if (claimMember) await notifyCharacterChange(context, claimMember.telegramUserId, language, 'rejected', result.character.name, access.game.title);
    }
    if (data.pendingAction === 'remove-attachment' && data.selectedAttachmentId) {
      const removed = await removeRoleGameCharacterAttachment({ ...repos, attachmentId: data.selectedAttachmentId });
      await cleanupStorageEntry(context, removed.internalStorageEntryId);
      notification = t.characterAttachmentRemoved;
    }
    await clearPendingAction(context, data);
    if (data.pendingAction === 'approve' || data.pendingAction === 'reject') return replyWithClaims(context, access, 1, language);
    if (data.selectedCharacterId) { const loaded = await loadVisibleCharacter(context, data.selectedCharacterId); if (loaded) return replyWithCharacterDetail(context, loaded, language, notification); }
    return openRoleGameCharacters(context, access.game.id, language);
  } catch (error) {
    context.runtime.logger?.warn?.({ error, action: data.pendingAction, characterId: data.selectedCharacterId, requestId: data.selectedClaimId }, 'role_game.character.action.failed');
    if (data.selectedCharacterId) { const loaded = await loadVisibleCharacter(context, data.selectedCharacterId); if (loaded) return replyWithCharacterDetail(context, loaded, language, t.characterActionStale); }
    return replyWithClaims(context, access, 1, language);
  }
}

async function clearPendingAction(context: TelegramRoleGameCharacterContext, data: RoleGameCharacterSessionData): Promise<void> {
  const { pendingAction: _pendingAction, pendingMemberId: _pendingMemberId, ...cleared } = data;
  await context.runtime.session.advance({ stepKey: 'refreshing', data: cleared });
}

async function notifyCharacterChange(
  context: TelegramRoleGameCharacterContext,
  telegramUserId: number,
  language: BotLanguage,
  kind: 'request' | 'assigned' | 'unassigned' | 'approved' | 'rejected',
  characterName: string,
  gameTitle: string,
): Promise<void> {
  const messages = {
    ca: {
      request: `Nova sol·licitud per al personatge «${characterName}» de ${gameTitle}.`,
      assigned: `T’han assignat el personatge «${characterName}» de ${gameTitle}.`,
      unassigned: `El personatge «${characterName}» de ${gameTitle} ha quedat sense assignar.`,
      approved: `S’ha aprovat la teva sol·licitud per a «${characterName}» de ${gameTitle}.`,
      rejected: `S’ha rebutjat la teva sol·licitud per a «${characterName}» de ${gameTitle}.`,
    },
    es: {
      request: `Nueva solicitud para el personaje «${characterName}» de ${gameTitle}.`,
      assigned: `Se te ha asignado el personaje «${characterName}» de ${gameTitle}.`,
      unassigned: `El personaje «${characterName}» de ${gameTitle} ha quedado sin asignar.`,
      approved: `Se ha aprobado tu solicitud para «${characterName}» de ${gameTitle}.`,
      rejected: `Se ha rechazado tu solicitud para «${characterName}» de ${gameTitle}.`,
    },
    en: {
      request: `New request for character “${characterName}” in ${gameTitle}.`,
      assigned: `You have been assigned character “${characterName}” in ${gameTitle}.`,
      unassigned: `Character “${characterName}” in ${gameTitle} is now unassigned.`,
      approved: `Your request for “${characterName}” in ${gameTitle} was approved.`,
      rejected: `Your request for “${characterName}” in ${gameTitle} was rejected.`,
    },
  } as const;
  try {
    await context.runtime.bot.sendPrivateMessage(telegramUserId, messages[language][kind]);
  } catch (error) {
    context.runtime.logger?.warn?.({ error, telegramUserId, kind }, 'role_game.character.notification.failed');
  }
}

function emptySession(gameId: number, view: RoleGameCharacterSessionData['view']): RoleGameCharacterSessionData {
  return { gameId, view, page: 1, total: 0, characterButtons: {}, attachmentButtons: {} };
}

function readSession(context: TelegramRoleGameCharacterContext): RoleGameCharacterSessionData | null {
  const data = context.runtime.session.current?.data as Partial<RoleGameCharacterSessionData> | undefined;
  if (!data || typeof data.gameId !== 'number' || data.gameId <= 0 || !data.view) return null;
  return { ...emptySession(data.gameId, data.view), ...data } as RoleGameCharacterSessionData;
}

function actor(context: TelegramRoleGameCharacterContext): RoleGameActor {
  return { telegramUserId: context.runtime.actor.telegramUserId, isAdmin: context.runtime.actor.isAdmin, isApproved: context.runtime.actor.isApproved };
}

function roleRepository(context: TelegramRoleGameCharacterContext): RoleGameRepository {
  return context.roleGameRepository ?? createDatabaseRoleGameRepository({ database: context.runtime.services.database.db });
}

function characterRepository(context: TelegramRoleGameCharacterContext): RoleGameCharacterRepository {
  return context.characterRepository ?? createDatabaseRoleGameCharacterRepository({ database: context.runtime.services.database.db });
}

function membershipRepository(context: TelegramRoleGameCharacterContext): MembershipAccessRepository {
  return context.membershipRepository ?? createDatabaseMembershipAccessRepository({ database: context.runtime.services.database.db });
}

function storageRepository(context: TelegramRoleGameCharacterContext): StorageCategoryRepository {
  return context.storageRepository ?? createDatabaseStorageRepository({ database: context.runtime.services.database.db });
}

async function findHandoutCategory(context: TelegramRoleGameCharacterContext): Promise<StorageCategoryRecord | null> {
  const repository = storageRepository(context);
  const categories = repository.listAllCategoriesForInternalUse
    ? await repository.listAllCategoriesForInternalUse()
    : await repository.listCategories();
  return categories.find((category) => category.lifecycleStatus === 'active' && category.categoryPurpose === internalRoleGameHandoutPurpose) ?? null;
}

async function ensureHandoutCategory(context: TelegramRoleGameCharacterContext): Promise<StorageCategoryRecord | null> {
  const existing = await findHandoutCategory(context);
  if (existing) return existing;
  if (!context.runtime.bot.createForumTopic) return null;
  const metadata = context.storageDefaultChatStore ?? createDatabaseAppMetadataSessionStorage({ database: context.runtime.services.database.db });
  const raw = await metadata.get(storageDefaultChatMetadataKey);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { chatId?: unknown };
    if (typeof value.chatId !== 'number' || !Number.isSafeInteger(value.chatId) || value.chatId === 0) return null;
    const topic = await context.runtime.bot.createForumTopic({ chatId: value.chatId, name: roleGameHandoutCategoryName });
    return await createStorageCategory({
      repository: storageRepository(context),
      slug: roleGameHandoutCategorySlug,
      displayName: roleGameHandoutCategoryName,
      parentCategoryId: null,
      description: 'Material interno de partidas de rol.',
      storageChatId: value.chatId,
      storageThreadId: topic.messageThreadId,
      categoryPurpose: internalRoleGameHandoutPurpose,
    });
  } catch (error) {
    context.runtime.logger?.warn?.({ error }, 'role_game.character.handout_storage.provision.failed');
    return findHandoutCategory(context);
  }
}

async function copyCharacterAttachmentToStorage(
  context: TelegramRoleGameCharacterContext,
  gameId: number,
  media: NonNullable<TelegramCommandHandlerContext['messageMedia']>,
): Promise<number> {
  const category = await ensureHandoutCategory(context);
  if (!category || !context.runtime.bot.copyMessage) throw new Error('Role game handout storage is not configured');
  const copied = await context.runtime.bot.copyMessage({
    fromChatId: context.runtime.chat.chatId,
    messageId: media.messageId,
    toChatId: category.storageChatId,
    messageThreadId: category.storageThreadId,
  });
  try {
    const detail = await createStorageEntry({
      repository: storageRepository(context),
      categoryId: category.id,
      createdByTelegramUserId: context.runtime.actor.telegramUserId,
      sourceKind: 'dm_copy',
      description: media.caption ?? media.originalFileName ?? null,
      tags: ['rol', `partida-${gameId}`, 'personaje'],
      messages: [{
        storageChatId: category.storageChatId,
        storageMessageId: copied.messageId,
        storageThreadId: category.storageThreadId,
        telegramFileId: media.fileId ?? null,
        telegramFileUniqueId: media.fileUniqueId ?? null,
        attachmentKind: media.attachmentKind as 'document' | 'photo' | 'video' | 'audio',
        caption: media.caption ?? null,
        originalFileName: media.originalFileName ?? null,
        mimeType: media.mimeType ?? null,
        fileSizeBytes: media.fileSizeBytes ?? null,
        mediaGroupId: media.mediaGroupId ?? null,
        sortOrder: 0,
      }],
    });
    return detail.entry.id;
  } catch (error) {
    if (context.runtime.bot.deleteMessage) {
      try {
        await context.runtime.bot.deleteMessage({ chatId: category.storageChatId, messageId: copied.messageId });
      } catch (cleanupError) {
        context.runtime.logger?.warn?.({ cleanupError, messageId: copied.messageId }, 'role_game.character.attachment.copy_cleanup.failed');
      }
    }
    throw error;
  }
}

async function cleanupStorageEntry(context: TelegramRoleGameCharacterContext, entryId: number): Promise<void> {
  try {
    await storageRepository(context).updateEntryLifecycleStatus({
      entryId,
      lifecycleStatus: 'deleted',
      deletedByTelegramUserId: context.runtime.actor.telegramUserId,
    });
  } catch (error) {
    context.runtime.logger?.warn?.({ error, entryId }, 'role_game.character.attachment.cleanup.failed');
  }
}

async function memberLabel(context: TelegramRoleGameCharacterContext, member: RoleGameMemberRecord, language: BotLanguage): Promise<string> {
  const user = await membershipRepository(context).findUserByTelegramUserId(member.telegramUserId);
  return user?.displayName ?? `${language === 'ca' ? 'Usuari' : language === 'en' ? 'User' : 'Usuario'} ${member.telegramUserId}`;
}

async function buildMemberButtons(context: TelegramRoleGameCharacterContext, members: RoleGameMemberRecord[], language: BotLanguage, reserved: string[]): Promise<Record<string, number>> {
  const pairs = await Promise.all(members.map(async (member) => ({ member, label: await memberLabel(context, member, language) })));
  const counts = new Map<string, number>();
  for (const pair of pairs) counts.set(pair.label, (counts.get(pair.label) ?? 0) + 1);
  const reservedSet = new Set(reserved);
  return Object.fromEntries(pairs.map(({ member, label }) => [(counts.get(label) ?? 0) > 1 || reservedSet.has(label) ? `${label} · #${member.id}` : label, member.id]));
}

function characterReservedLabels(language: BotLanguage): string[] {
  const i18n = createTelegramI18n(language);
  return [i18n.roleGames.previousPage, i18n.roleGames.nextPage, i18n.roleGames.backToCharacters, i18n.roleGames.backToGame, i18n.actionMenu.start, i18n.actionMenu.help];
}

function formatDraft(draft: RoleGameCharacterDraft, t: ReturnType<typeof createTelegramI18n>['roleGames']): string {
  return [`<b>${escapeHtml(draft.name ?? '')}</b>`, `${escapeHtml(t.descriptionLabel)}: ${escapeHtml(draft.description ?? t.noDescription)}`, draft.externalUrl ? `URL: ${escapeHtml(draft.externalUrl)}` : null, `${escapeHtml(t.visibilityLabel)}: ${escapeHtml(draft.visibility === 'private' ? t.characterVisibilityPrivate : t.characterVisibilityPlayers)}`].filter(Boolean).join('\n');
}

function isValidExternalUrl(value: string): boolean {
  if (value.length > 2048) return false;
  try { const parsed = new URL(value); return parsed.protocol === 'http:' || parsed.protocol === 'https:'; } catch { return false; }
}

async function replyUnavailable(context: TelegramRoleGameCharacterContext, language: BotLanguage): Promise<boolean> {
  await context.runtime.session.cancel();
  await context.reply(createTelegramI18n(language).roleGames.characterUnavailable);
  return true;
}
