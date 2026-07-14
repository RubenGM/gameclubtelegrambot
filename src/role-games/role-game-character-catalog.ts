import {
  canManageRoleGameOperationally,
  type RoleGameActor,
  type RoleGameMemberRecord,
  type RoleGameRecord,
  type RoleGameRepository,
} from './role-game-catalog.js';

export type RoleGameCharacterVisibility = 'players' | 'private';
export type RoleGameCharacterAttachmentVisibility = 'players' | 'private';
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
    visibility: RoleGameCharacterAttachmentVisibility;
    uploadedByTelegramUserId: number;
  }): Promise<RoleGameCharacterAttachmentRecord>;
  findAttachmentById(attachmentId: number): Promise<RoleGameCharacterAttachmentRecord | null>;
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

function isConfirmedActorMembership(
  actor: RoleGameActor,
  game: RoleGameRecord,
  membership: RoleGameMemberRecord | null,
): membership is RoleGameMemberRecord {
  return isConfirmedRoleGameMember(membership, game.id)
    && membership.telegramUserId === actor.telegramUserId;
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
