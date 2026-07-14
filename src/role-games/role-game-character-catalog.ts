import {
  canManageRoleGameOperationally,
  type RoleGameActor,
  type RoleGameMemberRecord,
  type RoleGameRecord,
  type RoleGameRepository,
} from './role-game-catalog.js';

export type RoleGameCharacterVisibility = 'players' | 'private';
export type RoleGameCharacterAttachmentVisibility = 'players' | 'private';
export type RoleGameCharacterAttachmentKind = 'attachment' | 'portrait';
export type RoleGameCharacterClaimStatus = 'requested' | 'approved' | 'rejected' | 'cancelled';

export interface RoleGameCharacterRecord {
  id: number;
  roleGameId: number;
  assignedMemberId: number | null;
  name: string;
  description: string | null;
  externalUrl: string | null;
  visibility: RoleGameCharacterVisibility;
  createdByTelegramUserId: number;
  createdAt: string;
  updatedAt: string;
  assignedAt: string | null;
  unassignedAt: string | null;
}

export interface RoleGameCharacterAttachmentRecord {
  id: number;
  characterId: number;
  internalStorageEntryId: number;
  kind: RoleGameCharacterAttachmentKind;
  visibility: RoleGameCharacterAttachmentVisibility;
  uploadedByTelegramUserId: number;
  createdAt: string;
  updatedAt: string;
  removedAt: string | null;
  removedByTelegramUserId: number | null;
}

export interface RoleGameCharacterClaimRequestRecord {
  id: number;
  characterId: number;
  requestedByMemberId: number;
  status: RoleGameCharacterClaimStatus;
  resolvedByTelegramUserId: number | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface RoleGameCharacterDraft {
  name: string;
  description: string | null;
  externalUrl: string | null;
  visibility: RoleGameCharacterVisibility;
}

export interface RoleGameCharacterRepository {
  createCharacter(input: {
    roleGameId: number;
    assignedMemberId: number | null;
    name: string;
    description: string | null;
    externalUrl: string | null;
    visibility: RoleGameCharacterVisibility;
    createdByTelegramUserId: number;
  }): Promise<RoleGameCharacterRecord>;
  findCharacterById(characterId: number): Promise<RoleGameCharacterRecord | null>;
  listCharacters(roleGameId: number): Promise<RoleGameCharacterRecord[]>;
  updateCharacter(input: {
    characterId: number;
    expectedUpdatedAt: string;
    name: string;
    description: string | null;
    externalUrl: string | null;
    visibility: RoleGameCharacterVisibility;
    actorTelegramUserId: number;
  }): Promise<RoleGameCharacterRecord>;
  assignCharacter(input: CharacterAssignmentInput): Promise<RoleGameCharacterRecord>;
  transferCharacter(input: CharacterTransferInput): Promise<RoleGameCharacterRecord>;
  unassignCharacter(input: CharacterUnassignmentInput): Promise<RoleGameCharacterRecord>;
  createAttachment(input: {
    characterId: number;
    internalStorageEntryId: number;
    kind: RoleGameCharacterAttachmentKind;
    visibility: RoleGameCharacterAttachmentVisibility;
    uploadedByTelegramUserId: number;
  }): Promise<RoleGameCharacterAttachmentRecord>;
  findAttachmentById(attachmentId: number): Promise<RoleGameCharacterAttachmentRecord | null>;
  findPortrait(characterId: number): Promise<RoleGameCharacterAttachmentRecord | null>;
  listAttachments(characterId: number): Promise<RoleGameCharacterAttachmentRecord[]>;
  updateAttachmentVisibility(input: {
    attachmentId: number;
    expectedVisibility: RoleGameCharacterAttachmentVisibility;
    visibility: RoleGameCharacterAttachmentVisibility;
    actorTelegramUserId: number;
  }): Promise<RoleGameCharacterAttachmentRecord>;
  replaceAttachmentStorageEntry(input: {
    attachmentId: number;
    expectedInternalStorageEntryId: number;
    internalStorageEntryId: number;
    actorTelegramUserId: number;
  }): Promise<RoleGameCharacterAttachmentRecord>;
  removeAttachment(input: {
    attachmentId: number;
    expectedRemovedAt: null;
    actorTelegramUserId: number;
  }): Promise<RoleGameCharacterAttachmentRecord>;
  createClaimRequest(input: {
    characterId: number;
    requestedByMemberId: number;
  }): Promise<RoleGameCharacterClaimRequestRecord>;
  findClaimRequestById(requestId: number): Promise<RoleGameCharacterClaimRequestRecord | null>;
  listClaimRequests(input: {
    roleGameId: number;
    characterId?: number;
    requestedByMemberId?: number;
    status?: RoleGameCharacterClaimStatus;
  }): Promise<RoleGameCharacterClaimRequestRecord[]>;
  resolveClaimRequest(input: {
    requestId: number;
    status: 'approved' | 'rejected';
    expectedStatus: 'requested';
    actorTelegramUserId: number;
  }): Promise<{
    request: RoleGameCharacterClaimRequestRecord;
    character: RoleGameCharacterRecord;
  }>;
  cancelClaimRequest(input: {
    requestId: number;
    expectedStatus: 'requested';
    requestedByMemberId: number;
  }): Promise<RoleGameCharacterClaimRequestRecord>;
}

export interface CharacterAssignmentInput {
  characterId: number;
  assignedMemberId: number;
  expectedAssignedMemberId: null;
  actorTelegramUserId: number;
}

export interface CharacterTransferInput {
  characterId: number;
  assignedMemberId: number;
  expectedAssignedMemberId: number;
  actorTelegramUserId: number;
}

export interface CharacterUnassignmentInput {
  characterId: number;
  expectedAssignedMemberId: number;
  actorTelegramUserId: number;
}

export function normalizeRoleGameCharacterDraft(input: RoleGameCharacterDraft): RoleGameCharacterDraft {
  const name = normalizeRequiredText(input.name, 'character name', 120);
  const description = normalizeOptionalText(input.description, 'character description', 3000);
  const externalUrl = normalizeExternalUrl(input.externalUrl);
  if (input.visibility !== 'players' && input.visibility !== 'private') {
    throw new Error('Character visibility must be players or private');
  }
  return { name, description, externalUrl, visibility: input.visibility };
}

export function canViewRoleGameCharacter(
  actor: RoleGameActor,
  game: RoleGameRecord,
  actorMembership: RoleGameMemberRecord | null,
  character: RoleGameCharacterRecord,
): boolean {
  if (character.roleGameId !== game.id) {
    return false;
  }
  if (canManageRoleGameOperationally(actor, game, actorMembership)) {
    return true;
  }
  if (!isConfirmedActorMembership(actor, game, actorMembership)) {
    return false;
  }
  return character.assignedMemberId === actorMembership.id || character.visibility === 'players';
}

export function canEditRoleGameCharacter(
  actor: RoleGameActor,
  game: RoleGameRecord,
  actorMembership: RoleGameMemberRecord | null,
  character: RoleGameCharacterRecord,
): boolean {
  if (character.roleGameId !== game.id) {
    return false;
  }
  if (canManageRoleGameOperationally(actor, game, actorMembership)) {
    return true;
  }
  return isConfirmedActorMembership(actor, game, actorMembership)
    && character.assignedMemberId === actorMembership.id;
}

export function canRequestRoleGameCharacter(
  actor: RoleGameActor,
  game: RoleGameRecord,
  actorMembership: RoleGameMemberRecord | null,
  character: RoleGameCharacterRecord,
): boolean {
  return character.roleGameId === game.id
    && character.assignedMemberId === null
    && character.visibility === 'players'
    && isConfirmedActorMembership(actor, game, actorMembership);
}

export function canViewRoleGameCharacterAttachment(
  actor: RoleGameActor,
  game: RoleGameRecord,
  actorMembership: RoleGameMemberRecord | null,
  character: RoleGameCharacterRecord,
  attachment: RoleGameCharacterAttachmentRecord,
): boolean {
  if (attachment.characterId !== character.id || attachment.removedAt !== null) {
    return false;
  }
  if (!canViewRoleGameCharacter(actor, game, actorMembership, character)) {
    return false;
  }
  if (canManageRoleGameOperationally(actor, game, actorMembership)) {
    return true;
  }
  return actorMembership !== null
    && character.assignedMemberId === actorMembership.id
    || attachment.visibility === 'players';
}

export function isConfirmedRoleGameMember(
  member: RoleGameMemberRecord | null,
  gameId: number,
): member is RoleGameMemberRecord {
  return member?.roleGameId === gameId && member.status === 'confirmed';
}

export interface RoleGameCharacterDomainRepositories {
  roleGameRepository: RoleGameRepository;
  characterRepository: RoleGameCharacterRepository;
}

export async function createRoleGameCharacter({
  roleGameRepository,
  characterRepository,
  actor,
  gameId,
  assignedMemberId,
  draft,
}: RoleGameCharacterDomainRepositories & {
  actor: RoleGameActor;
  gameId: number;
  assignedMemberId: number | null;
  draft: RoleGameCharacterDraft;
}): Promise<RoleGameCharacterRecord> {
  const normalizedGameId = normalizeEntityId(gameId, 'role game');
  const game = await requireGame(roleGameRepository, normalizedGameId);
  const actorMembership = await roleGameRepository.findMemberByTelegramUserId(
    normalizedGameId,
    actor.telegramUserId,
  );
  const canManage = canManageRoleGameOperationally(actor, game, actorMembership);
  let assignedMember: RoleGameMemberRecord | null = null;
  if (assignedMemberId !== null) {
    assignedMember = await roleGameRepository.findMemberById(
      normalizeEntityId(assignedMemberId, 'role game member'),
    );
    if (!isConfirmedRoleGameMember(assignedMember, normalizedGameId)) {
      throw new Error('Character owner must be a confirmed member of the role game');
    }
  }
  if (!canManage) {
    if (!isConfirmedActorMembership(actor, game, actorMembership)
      || assignedMember?.id !== actorMembership.id) {
      throw new Error('Actor does not have permission to create this character');
    }
  }
  const normalizedDraft = normalizeRoleGameCharacterDraft(draft);
  return characterRepository.createCharacter({
    roleGameId: normalizedGameId,
    assignedMemberId: assignedMember?.id ?? null,
    ...normalizedDraft,
    createdByTelegramUserId: actor.telegramUserId,
  });
}

export async function transferRoleGameCharacter({
  roleGameRepository,
  characterRepository,
  actor,
  characterId,
  assignedMemberId,
}: RoleGameCharacterDomainRepositories & {
  actor: RoleGameActor;
  characterId: number;
  assignedMemberId: number;
}): Promise<RoleGameCharacterRecord> {
  const character = await requireCharacter(characterRepository, characterId);
  if (character.assignedMemberId === null) {
    throw new Error(`Role game character ${character.id} is not currently assigned`);
  }
  const game = await requireGame(roleGameRepository, character.roleGameId);
  const actorMembership = await roleGameRepository.findMemberByTelegramUserId(
    game.id,
    actor.telegramUserId,
  );
  if (!canManageRoleGameOperationally(actor, game, actorMembership)) {
    throw new Error('Actor does not have permission to transfer this character');
  }
  const assignedMember = await roleGameRepository.findMemberById(
    normalizeEntityId(assignedMemberId, 'role game member'),
  );
  if (!isConfirmedRoleGameMember(assignedMember, game.id)) {
    throw new Error('Character owner must be a confirmed member of the role game');
  }
  if (assignedMember.id === character.assignedMemberId) {
    throw new Error('Character transfer target must be a different confirmed member');
  }
  return characterRepository.transferCharacter({
    characterId: character.id,
    assignedMemberId: assignedMember.id,
    expectedAssignedMemberId: character.assignedMemberId,
    actorTelegramUserId: actor.telegramUserId,
  });
}

export async function assignRoleGameCharacter({
  roleGameRepository,
  characterRepository,
  actor,
  characterId,
  assignedMemberId,
}: RoleGameCharacterDomainRepositories & {
  actor: RoleGameActor;
  characterId: number;
  assignedMemberId: number;
}): Promise<RoleGameCharacterRecord> {
  const character = await requireCharacter(characterRepository, characterId);
  if (character.assignedMemberId !== null) {
    throw new Error(`Role game character ${character.id} is already assigned`);
  }
  const { game } = await requireManagerForCharacter({
    roleGameRepository,
    actor,
    character,
    action: 'assign',
  });
  const assignedMember = await roleGameRepository.findMemberById(
    normalizeEntityId(assignedMemberId, 'role game member'),
  );
  if (!isConfirmedRoleGameMember(assignedMember, game.id)) {
    throw new Error('Character owner must be a confirmed member of the role game');
  }
  return characterRepository.assignCharacter({
    characterId: character.id,
    assignedMemberId: assignedMember.id,
    expectedAssignedMemberId: null,
    actorTelegramUserId: actor.telegramUserId,
  });
}

export async function abandonRoleGameCharacter({
  roleGameRepository,
  characterRepository,
  actor,
  characterId,
}: RoleGameCharacterDomainRepositories & {
  actor: RoleGameActor;
  characterId: number;
}): Promise<RoleGameCharacterRecord> {
  const character = await requireCharacter(characterRepository, characterId);
  const game = await requireGame(roleGameRepository, character.roleGameId);
  const actorMembership = await roleGameRepository.findMemberByTelegramUserId(game.id, actor.telegramUserId);
  if (!isConfirmedActorMembership(actor, game, actorMembership)
    || character.assignedMemberId !== actorMembership.id) {
    throw new Error('Actor does not have permission to abandon this character');
  }
  return characterRepository.unassignCharacter({
    characterId: character.id,
    expectedAssignedMemberId: actorMembership.id,
    actorTelegramUserId: actor.telegramUserId,
  });
}

export async function unassignRoleGameCharacter({
  roleGameRepository,
  characterRepository,
  actor,
  characterId,
}: RoleGameCharacterDomainRepositories & {
  actor: RoleGameActor;
  characterId: number;
}): Promise<RoleGameCharacterRecord> {
  const character = await requireCharacter(characterRepository, characterId);
  if (character.assignedMemberId === null) {
    return character;
  }
  await requireManagerForCharacter({
    roleGameRepository,
    actor,
    character,
    action: 'unassign',
  });
  return characterRepository.unassignCharacter({
    characterId: character.id,
    expectedAssignedMemberId: character.assignedMemberId,
    actorTelegramUserId: actor.telegramUserId,
  });
}

export async function updateRoleGameCharacter({
  roleGameRepository,
  characterRepository,
  actor,
  characterId,
  draft,
}: RoleGameCharacterDomainRepositories & {
  actor: RoleGameActor;
  characterId: number;
  draft: RoleGameCharacterDraft;
}): Promise<RoleGameCharacterRecord> {
  const character = await requireCharacter(characterRepository, characterId);
  const game = await requireGame(roleGameRepository, character.roleGameId);
  const actorMembership = await roleGameRepository.findMemberByTelegramUserId(game.id, actor.telegramUserId);
  if (!canEditRoleGameCharacter(actor, game, actorMembership, character)) {
    throw new Error('Actor does not have permission to edit this character');
  }
  const normalized = normalizeRoleGameCharacterDraft(draft);
  return characterRepository.updateCharacter({
    characterId: character.id,
    expectedUpdatedAt: character.updatedAt,
    ...normalized,
    actorTelegramUserId: actor.telegramUserId,
  });
}

export async function requestRoleGameCharacter({
  roleGameRepository,
  characterRepository,
  actor,
  characterId,
}: RoleGameCharacterDomainRepositories & {
  actor: RoleGameActor;
  characterId: number;
}): Promise<RoleGameCharacterClaimRequestRecord> {
  const character = await requireCharacter(characterRepository, characterId);
  const game = await requireGame(roleGameRepository, character.roleGameId);
  const actorMembership = await roleGameRepository.findMemberByTelegramUserId(
    game.id,
    actor.telegramUserId,
  );
  if (!canRequestRoleGameCharacter(actor, game, actorMembership, character) || !actorMembership) {
    throw new Error('Actor does not have permission to request this character');
  }
  return characterRepository.createClaimRequest({
    characterId: character.id,
    requestedByMemberId: actorMembership.id,
  });
}

export async function cancelRoleGameCharacterRequest({
  roleGameRepository,
  characterRepository,
  actor,
  requestId,
}: RoleGameCharacterDomainRepositories & {
  actor: RoleGameActor;
  requestId: number;
}): Promise<RoleGameCharacterClaimRequestRecord> {
  const request = await requireClaim(characterRepository, requestId);
  if (request.status !== 'requested') {
    throw new Error(`Role game character claim ${request.id} has stale state`);
  }
  const character = await requireCharacter(characterRepository, request.characterId);
  const game = await requireGame(roleGameRepository, character.roleGameId);
  const actorMembership = await roleGameRepository.findMemberByTelegramUserId(game.id, actor.telegramUserId);
  if (!isConfirmedActorMembership(actor, game, actorMembership)
    || actorMembership.id !== request.requestedByMemberId) {
    throw new Error('Actor does not have permission to cancel this character request');
  }
  return characterRepository.cancelClaimRequest({
    requestId: request.id,
    expectedStatus: 'requested',
    requestedByMemberId: actorMembership.id,
  });
}

export async function approveRoleGameCharacterClaim(
  input: RoleGameCharacterDomainRepositories & { actor: RoleGameActor; requestId: number },
): Promise<{ request: RoleGameCharacterClaimRequestRecord; character: RoleGameCharacterRecord }> {
  return resolveRoleGameCharacterClaim({ ...input, status: 'approved' });
}

export async function rejectRoleGameCharacterClaim(
  input: RoleGameCharacterDomainRepositories & { actor: RoleGameActor; requestId: number },
): Promise<{ request: RoleGameCharacterClaimRequestRecord; character: RoleGameCharacterRecord }> {
  return resolveRoleGameCharacterClaim({ ...input, status: 'rejected' });
}

export async function addRoleGameCharacterAttachment({
  roleGameRepository,
  characterRepository,
  actor,
  characterId,
  internalStorageEntryId,
  visibility,
}: RoleGameCharacterDomainRepositories & {
  actor: RoleGameActor;
  characterId: number;
  internalStorageEntryId: number;
  visibility: RoleGameCharacterAttachmentVisibility;
}): Promise<RoleGameCharacterAttachmentRecord> {
  const character = await requireEditableCharacter({
    roleGameRepository,
    characterRepository,
    actor,
    characterId,
    action: 'add an attachment to',
  });
  return characterRepository.createAttachment({
    characterId: character.id,
    internalStorageEntryId: normalizeEntityId(internalStorageEntryId, 'storage entry'),
    kind: 'attachment',
    visibility: normalizeAttachmentVisibility(visibility),
    uploadedByTelegramUserId: actor.telegramUserId,
  });
}

export async function setRoleGameCharacterPortrait({
  roleGameRepository,
  characterRepository,
  actor,
  characterId,
  internalStorageEntryId,
}: RoleGameCharacterDomainRepositories & {
  actor: RoleGameActor;
  characterId: number;
  internalStorageEntryId: number;
}): Promise<{ portrait: RoleGameCharacterAttachmentRecord; previousStorageEntryId: number | null }> {
  const character = await requireEditableCharacter({
    roleGameRepository,
    characterRepository,
    actor,
    characterId,
    action: 'set the portrait for',
  });
  const storageEntryId = normalizeEntityId(internalStorageEntryId, 'storage entry');
  const current = await characterRepository.findPortrait(character.id);
  if (current) {
    const portrait = await characterRepository.replaceAttachmentStorageEntry({
      attachmentId: current.id,
      expectedInternalStorageEntryId: current.internalStorageEntryId,
      internalStorageEntryId: storageEntryId,
      actorTelegramUserId: actor.telegramUserId,
    });
    return { portrait, previousStorageEntryId: current.internalStorageEntryId };
  }
  const portrait = await characterRepository.createAttachment({
    characterId: character.id,
    internalStorageEntryId: storageEntryId,
    kind: 'portrait',
    visibility: character.visibility,
    uploadedByTelegramUserId: actor.telegramUserId,
  });
  return { portrait, previousStorageEntryId: null };
}

export async function removeRoleGameCharacterPortrait({
  roleGameRepository,
  characterRepository,
  actor,
  characterId,
}: RoleGameCharacterDomainRepositories & {
  actor: RoleGameActor;
  characterId: number;
}): Promise<RoleGameCharacterAttachmentRecord | null> {
  await requireEditableCharacter({
    roleGameRepository,
    characterRepository,
    actor,
    characterId,
    action: 'remove the portrait from',
  });
  const portrait = await characterRepository.findPortrait(normalizeEntityId(characterId, 'role game character'));
  if (!portrait) return null;
  return characterRepository.removeAttachment({
    attachmentId: portrait.id,
    expectedRemovedAt: null,
    actorTelegramUserId: actor.telegramUserId,
  });
}

export async function updateRoleGameCharacterAttachmentVisibility({
  roleGameRepository,
  characterRepository,
  actor,
  attachmentId,
  visibility,
}: RoleGameCharacterDomainRepositories & {
  actor: RoleGameActor;
  attachmentId: number;
  visibility: RoleGameCharacterAttachmentVisibility;
}): Promise<RoleGameCharacterAttachmentRecord> {
  const { attachment } = await requireEditableAttachment({
    roleGameRepository,
    characterRepository,
    actor,
    attachmentId,
    action: 'change visibility for',
  });
  return characterRepository.updateAttachmentVisibility({
    attachmentId: attachment.id,
    expectedVisibility: attachment.visibility,
    visibility: normalizeAttachmentVisibility(visibility),
    actorTelegramUserId: actor.telegramUserId,
  });
}

export async function replaceRoleGameCharacterAttachmentStorageEntry({
  roleGameRepository,
  characterRepository,
  actor,
  attachmentId,
  internalStorageEntryId,
}: RoleGameCharacterDomainRepositories & {
  actor: RoleGameActor;
  attachmentId: number;
  internalStorageEntryId: number;
}): Promise<RoleGameCharacterAttachmentRecord> {
  const { attachment } = await requireEditableAttachment({
    roleGameRepository,
    characterRepository,
    actor,
    attachmentId,
    action: 'replace',
  });
  return characterRepository.replaceAttachmentStorageEntry({
    attachmentId: attachment.id,
    expectedInternalStorageEntryId: attachment.internalStorageEntryId,
    internalStorageEntryId: normalizeEntityId(internalStorageEntryId, 'storage entry'),
    actorTelegramUserId: actor.telegramUserId,
  });
}

export async function removeRoleGameCharacterAttachment({
  roleGameRepository,
  characterRepository,
  actor,
  attachmentId,
}: RoleGameCharacterDomainRepositories & {
  actor: RoleGameActor;
  attachmentId: number;
}): Promise<RoleGameCharacterAttachmentRecord> {
  const { attachment } = await requireEditableAttachment({
    roleGameRepository,
    characterRepository,
    actor,
    attachmentId,
    action: 'remove',
  });
  return characterRepository.removeAttachment({
    attachmentId: attachment.id,
    expectedRemovedAt: null,
    actorTelegramUserId: actor.telegramUserId,
  });
}

function isConfirmedActorMembership(
  actor: RoleGameActor,
  game: RoleGameRecord,
  membership: RoleGameMemberRecord | null,
): membership is RoleGameMemberRecord {
  return isConfirmedRoleGameMember(membership, game.id)
    && membership.telegramUserId === actor.telegramUserId;
}

async function requireGame(repository: RoleGameRepository, gameId: number): Promise<RoleGameRecord> {
  const game = await repository.findGameById(gameId);
  if (!game) {
    throw new Error(`Role game ${gameId} not found`);
  }
  return game;
}

async function requireCharacter(
  repository: RoleGameCharacterRepository,
  characterId: number,
): Promise<RoleGameCharacterRecord> {
  const normalizedCharacterId = normalizeEntityId(characterId, 'role game character');
  const character = await repository.findCharacterById(normalizedCharacterId);
  if (!character) {
    throw new Error(`Role game character ${normalizedCharacterId} not found`);
  }
  return character;
}

async function requireClaim(
  repository: RoleGameCharacterRepository,
  requestId: number,
): Promise<RoleGameCharacterClaimRequestRecord> {
  const normalizedRequestId = normalizeEntityId(requestId, 'role game character claim');
  const request = await repository.findClaimRequestById(normalizedRequestId);
  if (!request) {
    throw new Error(`Role game character claim ${normalizedRequestId} not found`);
  }
  return request;
}

async function requireAttachment(
  repository: RoleGameCharacterRepository,
  attachmentId: number,
): Promise<RoleGameCharacterAttachmentRecord> {
  const normalizedAttachmentId = normalizeEntityId(attachmentId, 'role game character attachment');
  const attachment = await repository.findAttachmentById(normalizedAttachmentId);
  if (!attachment || attachment.removedAt !== null) {
    throw new Error(`Role game character attachment ${normalizedAttachmentId} not found`);
  }
  return attachment;
}

async function requireEditableCharacter({
  roleGameRepository,
  characterRepository,
  actor,
  characterId,
  action,
}: RoleGameCharacterDomainRepositories & {
  actor: RoleGameActor;
  characterId: number;
  action: string;
}): Promise<RoleGameCharacterRecord> {
  const character = await requireCharacter(characterRepository, characterId);
  const game = await requireGame(roleGameRepository, character.roleGameId);
  const actorMembership = await roleGameRepository.findMemberByTelegramUserId(game.id, actor.telegramUserId);
  if (!canEditRoleGameCharacter(actor, game, actorMembership, character)) {
    throw new Error(`Actor does not have permission to ${action} this character`);
  }
  return character;
}

async function requireEditableAttachment({
  roleGameRepository,
  characterRepository,
  actor,
  attachmentId,
  action,
}: RoleGameCharacterDomainRepositories & {
  actor: RoleGameActor;
  attachmentId: number;
  action: string;
}): Promise<{
  character: RoleGameCharacterRecord;
  attachment: RoleGameCharacterAttachmentRecord;
}> {
  const attachment = await requireAttachment(characterRepository, attachmentId);
  const character = await requireEditableCharacter({
    roleGameRepository,
    characterRepository,
    actor,
    characterId: attachment.characterId,
    action,
  });
  return { character, attachment };
}

async function requireManagerForCharacter({
  roleGameRepository,
  actor,
  character,
  action,
}: {
  roleGameRepository: RoleGameRepository;
  actor: RoleGameActor;
  character: RoleGameCharacterRecord;
  action: string;
}): Promise<{ game: RoleGameRecord; actorMembership: RoleGameMemberRecord | null }> {
  const game = await requireGame(roleGameRepository, character.roleGameId);
  const actorMembership = await roleGameRepository.findMemberByTelegramUserId(game.id, actor.telegramUserId);
  if (!canManageRoleGameOperationally(actor, game, actorMembership)) {
    throw new Error(`Actor does not have permission to ${action} this character`);
  }
  return { game, actorMembership };
}

async function resolveRoleGameCharacterClaim({
  roleGameRepository,
  characterRepository,
  actor,
  requestId,
  status,
}: RoleGameCharacterDomainRepositories & {
  actor: RoleGameActor;
  requestId: number;
  status: 'approved' | 'rejected';
}): Promise<{ request: RoleGameCharacterClaimRequestRecord; character: RoleGameCharacterRecord }> {
  const request = await requireClaim(characterRepository, requestId);
  if (request.status !== 'requested') {
    throw new Error(`Role game character claim ${request.id} has stale state`);
  }
  const character = await requireCharacter(characterRepository, request.characterId);
  const { game } = await requireManagerForCharacter({
    roleGameRepository,
    actor,
    character,
    action: status === 'approved' ? 'approve' : 'reject',
  });
  if (status === 'approved') {
    const requester = await roleGameRepository.findMemberById(request.requestedByMemberId);
    if (!isConfirmedRoleGameMember(requester, game.id)) {
      throw new Error('Character requester must still be a confirmed member of the role game');
    }
  }
  return characterRepository.resolveClaimRequest({
    requestId: request.id,
    status,
    expectedStatus: 'requested',
    actorTelegramUserId: actor.telegramUserId,
  });
}

function normalizeEntityId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} id must be a positive integer`);
  }
  return value;
}

function normalizeAttachmentVisibility(
  value: RoleGameCharacterAttachmentVisibility,
): RoleGameCharacterAttachmentVisibility {
  if (value !== 'players' && value !== 'private') {
    throw new Error('Character attachment visibility must be players or private');
  }
  return value;
}

function normalizeRequiredText(value: string, label: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new Error(`${label} must contain between 1 and ${maxLength} characters`);
  }
  return normalized;
}

function normalizeOptionalText(value: string | null, label: string, maxLength: number): string | null {
  if (value === null) {
    return null;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }
  if (normalized.length > maxLength) {
    throw new Error(`${label} must contain at most ${maxLength} characters`);
  }
  return normalized;
}

function normalizeExternalUrl(value: string | null): string | null {
  const normalized = normalizeOptionalText(value, 'character URL', 2048);
  if (normalized === null) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('Character URL must use http or https');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Character URL must use http or https');
  }
  return normalized;
}
