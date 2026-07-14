export type RoleGameType = 'campaign' | 'one_shot';
export type RoleGameStatus = 'draft' | 'active' | 'paused' | 'closed' | 'cancelled';
export type RoleGameVisibility = 'private' | 'members' | 'public';
export type RoleGamePublicJoinPolicy = 'members_only' | 'members_and_external';
export type RoleGameEntryMode = 'invite_only' | 'request';
export type RoleGameAcceptanceMode = 'manual_review' | 'auto_until_full';
export type RoleGameSchedulingMode = 'manual' | 'recurring';
export type RoleGameMemberRole = 'primary_gm' | 'coorganizer' | 'player';
export type RoleGameMemberStatus = 'invited' | 'requested' | 'confirmed' | 'waitlisted' | 'left' | 'removed' | 'rejected';
export type RoleGameMemberManagementAction =
  | 'confirm'
  | 'reject'
  | 'remove'
  | 'cancel_invitation'
  | 'promote'
  | 'demote';
export type RoleGameMaterialVisibility = 'players' | 'gm_only';
export type RoleGameMaterialDeliveryState = 'not_sent' | 'sent' | 'revealed';
export type RoleGameSessionSource = 'one_shot_initial' | 'manual' | 'recurring';
export type RoleGameMaterialDeliveryMode = 'send_only' | 'send_and_reveal' | 'reveal_only';
export type RoleGameMaterialDeliveryStatus = 'sent' | 'failed';

export interface RoleGameActor {
  telegramUserId: number;
  isAdmin: boolean;
  isApproved?: boolean;
}

export interface RoleGameRecurrenceRule {
  intervalWeeks: number;
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  time: string;
}

export interface RoleGameRecord {
  id: number;
  type: RoleGameType;
  status: RoleGameStatus;
  title: string;
  system: string;
  description: string | null;
  visibility: RoleGameVisibility;
  publicJoinPolicy: RoleGamePublicJoinPolicy;
  entryMode: RoleGameEntryMode;
  acceptanceMode: RoleGameAcceptanceMode;
  capacity: number;
  primaryGmTelegramUserId: number;
  defaultDurationMinutes: number;
  defaultTableId: number | null;
  defaultAttendanceMode: 'open' | 'closed';
  defaultIsPublicScheduleEvent: boolean;
  autoAddConfirmedPlayers: boolean;
  allowPlayerManualScheduling: boolean;
  schedulingMode: RoleGameSchedulingMode;
  recurrenceRule: RoleGameRecurrenceRule | null;
  recurrenceWindowCount: number;
  createdByTelegramUserId: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface RoleGameMemberRecord {
  id: number;
  roleGameId: number;
  telegramUserId: number;
  role: RoleGameMemberRole;
  status: RoleGameMemberStatus;
  isExternal: boolean;
  playerNote: string | null;
  requestedByTelegramUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoleGameSessionRecord {
  id: number;
  roleGameId: number;
  scheduleEventId: number;
  source: RoleGameSessionSource;
  generatedForStartsAt: string | null;
  createdByTelegramUserId: number;
  createdAt: string;
}

export interface RoleGameMaterialRecord {
  id: number;
  roleGameId: number;
  internalStorageEntryId: number;
  title: string;
  description: string | null;
  visibility: RoleGameMaterialVisibility;
  deliveryState: RoleGameMaterialDeliveryState;
  uploadedByTelegramUserId: number;
  createdAt: string;
  updatedAt: string;
  revealedAt: string | null;
}

export interface RoleGameMaterialDeliveryRecord {
  id: number;
  roleGameMaterialId: number;
  recipientTelegramUserId: number;
  sentByTelegramUserId: number;
  deliveryMode: RoleGameMaterialDeliveryMode;
  status: RoleGameMaterialDeliveryStatus;
  errorCode: string | null;
  sentAt: string;
}

export interface CreateRoleGameInput {
  type: RoleGameType;
  title: string;
  system: string;
  description: string | null;
  visibility: RoleGameVisibility;
  publicJoinPolicy: RoleGamePublicJoinPolicy;
  entryMode: RoleGameEntryMode;
  acceptanceMode: RoleGameAcceptanceMode;
  capacity: number;
  primaryGmTelegramUserId: number;
  createdByTelegramUserId: number;
  defaultDurationMinutes: number;
  defaultTableId: number | null;
  defaultAttendanceMode: 'open' | 'closed';
  defaultIsPublicScheduleEvent: boolean;
  autoAddConfirmedPlayers: boolean;
  allowPlayerManualScheduling: boolean;
  schedulingMode: RoleGameSchedulingMode;
  recurrenceRule: RoleGameRecurrenceRule | null;
  recurrenceWindowCount: number;
}

export interface CreateRoleGameMemberInput {
  roleGameId: number;
  telegramUserId: number;
  role: RoleGameMemberRole;
  status: RoleGameMemberStatus;
  isExternal: boolean;
  playerNote?: string | null;
  requestedByTelegramUserId: number | null;
}

export interface UpdateRoleGameInput {
  gameId: number;
  status?: RoleGameStatus;
  title?: string;
  system?: string;
  description?: string | null;
  visibility?: RoleGameVisibility;
  publicJoinPolicy?: RoleGamePublicJoinPolicy;
  entryMode?: RoleGameEntryMode;
  acceptanceMode?: RoleGameAcceptanceMode;
  capacity?: number;
  primaryGmTelegramUserId?: number;
  defaultDurationMinutes?: number;
  defaultTableId?: number | null;
  defaultAttendanceMode?: 'open' | 'closed';
  defaultIsPublicScheduleEvent?: boolean;
  autoAddConfirmedPlayers?: boolean;
  allowPlayerManualScheduling?: boolean;
  schedulingMode?: RoleGameSchedulingMode;
  recurrenceRule?: RoleGameRecurrenceRule | null;
  recurrenceWindowCount?: number;
  closedAt?: string | null;
}

export interface ListVisibleRoleGamesInput {
  actor: RoleGameActor;
}

export type CreateOrUpdateRoleGameMemberInput = CreateRoleGameMemberInput;

export interface CreateRoleGameSessionLinkInput {
  roleGameId: number;
  scheduleEventId: number;
  source: RoleGameSessionSource;
  generatedForStartsAt: string | null;
  createdByTelegramUserId: number;
}

export interface CreateRoleGameMaterialInput {
  roleGameId: number;
  internalStorageEntryId: number;
  title: string;
  description: string | null;
  visibility: RoleGameMaterialVisibility;
  deliveryState: RoleGameMaterialDeliveryState;
  uploadedByTelegramUserId: number;
}

export interface UpdateRoleGameMaterialVisibilityInput {
  materialId: number;
  visibility: RoleGameMaterialVisibility;
  deliveryState: RoleGameMaterialDeliveryState;
}

export interface CreateRoleGameMaterialDeliveryInput {
  roleGameMaterialId: number;
  recipientTelegramUserId: number;
  sentByTelegramUserId: number;
  deliveryMode: RoleGameMaterialDeliveryMode;
  status: RoleGameMaterialDeliveryStatus;
  errorCode: string | null;
}

export interface RoleGameRepository {
  createGame(input: CreateRoleGameInput): Promise<RoleGameRecord>;
  findGameById(gameId: number): Promise<RoleGameRecord | null>;
  updateGame(input: UpdateRoleGameInput): Promise<RoleGameRecord>;
  listRecurringGames?(): Promise<RoleGameRecord[]>;
  listVisibleGames(input: ListVisibleRoleGamesInput): Promise<RoleGameRecord[]>;
  listGamesForUser(telegramUserId: number): Promise<RoleGameRecord[]>;
  createOrUpdateMember(input: CreateOrUpdateRoleGameMemberInput): Promise<RoleGameMemberRecord>;
  findMember(gameId: number, telegramUserId: number): Promise<RoleGameMemberRecord | null>;
  findMemberByTelegramUserId(gameId: number, telegramUserId: number): Promise<RoleGameMemberRecord | null>;
  findMemberById(memberId: number): Promise<RoleGameMemberRecord | null>;
  listMembers(gameId: number): Promise<RoleGameMemberRecord[]>;
  countConfirmedPlayers(gameId: number): Promise<number>;
  createMember(input: CreateRoleGameMemberInput): Promise<RoleGameMemberRecord>;
  createSessionLink(input: CreateRoleGameSessionLinkInput): Promise<RoleGameSessionRecord>;
  listSessionLinks(gameId: number): Promise<RoleGameSessionRecord[]>;
  createMaterial(input: CreateRoleGameMaterialInput): Promise<RoleGameMaterialRecord>;
  findMaterialById(materialId: number): Promise<RoleGameMaterialRecord | null>;
  listMaterials(gameId: number): Promise<RoleGameMaterialRecord[]>;
  updateMaterialVisibility(input: UpdateRoleGameMaterialVisibilityInput): Promise<RoleGameMaterialRecord>;
  createMaterialDelivery(input: CreateRoleGameMaterialDeliveryInput): Promise<RoleGameMaterialDeliveryRecord>;
  requestSeat(input: {
    roleGameId: number;
    telegramUserId: number;
    actorTelegramUserId: number;
    isExternal: boolean;
  }): Promise<RoleGameMemberRecord>;
  confirmMemberSeat(input: {
    memberId: number;
    actorTelegramUserId: number;
    expectedStatuses: Array<'requested' | 'invited' | 'waitlisted'>;
  }): Promise<RoleGameMemberRecord>;
  setMemberRole(input: {
    memberId: number;
    role: 'player' | 'coorganizer';
    expectedRole: RoleGameMemberRole;
    expectedStatus: 'confirmed';
    actorTelegramUserId: number;
  }): Promise<RoleGameMemberRecord>;
  setMemberStatus(input: {
    memberId: number;
    status: RoleGameMemberStatus;
    expectedStatus: RoleGameMemberStatus;
    expectedRole: RoleGameMemberRole;
    actorTelegramUserId: number;
  }): Promise<RoleGameMemberRecord>;
}

export async function createRoleGame({
  repository,
  ...input
}: CreateRoleGameInput & { repository: RoleGameRepository }): Promise<RoleGameRecord> {
  return repository.createGame(normalizeCreateRoleGameInput(input));
}

export async function requestRoleGameSeat({
  repository,
  gameId,
  telegramUserId,
  actor,
}: {
  repository: RoleGameRepository;
  gameId: number;
  telegramUserId: number;
  actor: RoleGameActor;
}): Promise<RoleGameMemberRecord> {
  const normalizedGameId = normalizeEntityId(gameId, 'role game');
  const normalizedTelegramUserId = normalizeTelegramUserId(telegramUserId, 'applicant');
  const normalizedActor: RoleGameActor = {
    ...actor,
    telegramUserId: normalizeTelegramUserId(actor.telegramUserId, 'actor'),
  };
  const game = await repository.findGameById(normalizedGameId);
  if (!game) {
    throw new Error(`Role game ${normalizedGameId} not found`);
  }
  if (game.status !== 'active') {
    throw new Error(`Role game ${normalizedGameId} is not active`);
  }
  if (game.entryMode !== 'request') {
    throw new Error(`Role game ${normalizedGameId} does not accept seat requests`);
  }
  const existing = await repository.findMemberByTelegramUserId(normalizedGameId, normalizedTelegramUserId);
  if (!canRequestRoleGameSeat(normalizedActor, game, existing)) {
    throw new Error(`Actor ${normalizedActor.telegramUserId} cannot request a seat in role game ${normalizedGameId}`);
  }

  return repository.requestSeat({
    roleGameId: normalizedGameId,
    telegramUserId: normalizedTelegramUserId,
    actorTelegramUserId: normalizedActor.telegramUserId,
    isExternal: normalizedActor.isApproved !== true,
  });
}

export async function setRoleGameMemberStatus({
  repository,
  memberId,
  status,
  actorTelegramUserId,
}: {
  repository: RoleGameRepository;
  memberId: number;
  status: RoleGameMemberStatus;
  actorTelegramUserId: number;
}): Promise<RoleGameMemberRecord> {
  const normalizedMemberId = normalizeEntityId(memberId, 'role game member');
  const member = await repository.findMemberById(normalizedMemberId);
  if (!member) {
    throw new Error(`Role game member ${normalizedMemberId} not found`);
  }
  if (status === 'confirmed' && member.role === 'player') {
    if (member.status === 'confirmed') {
      return member;
    }
    if (!isConfirmableRoleGameMemberStatus(member.status)) {
      throw new Error(`Role game member ${normalizedMemberId} cannot confirm from status ${member.status}`);
    }
    return repository.confirmMemberSeat({
      memberId: normalizedMemberId,
      actorTelegramUserId: normalizeTelegramUserId(actorTelegramUserId, 'actor'),
      expectedStatuses: [member.status],
    });
  }
  return repository.setMemberStatus({
    memberId: normalizedMemberId,
    status,
    expectedStatus: member.status,
    expectedRole: member.role,
    actorTelegramUserId: normalizeTelegramUserId(actorTelegramUserId, 'actor'),
  });
}

export async function manageRoleGameMember({
  repository,
  actor,
  game,
  actorMembership,
  member,
  action,
}: {
  repository: RoleGameRepository;
  actor: RoleGameActor;
  game: RoleGameRecord;
  actorMembership: RoleGameMemberRecord | null;
  member: RoleGameMemberRecord;
  action: RoleGameMemberManagementAction;
}): Promise<RoleGameMemberRecord> {
  const gameId = normalizeEntityId(game.id, 'role game');
  const memberId = normalizeEntityId(member.id, 'role game member');
  const actorTelegramUserId = normalizeTelegramUserId(actor.telegramUserId, 'actor');
  const currentGame = await repository.findGameById(gameId);
  if (!currentGame) {
    throw new Error(`Role game ${gameId} not found`);
  }
  const currentMember = await repository.findMemberById(memberId);
  if (!currentMember) {
    throw new Error(`Role game member ${memberId} not found`);
  }
  if (currentMember.roleGameId !== currentGame.id) {
    throw new Error(`Role game member ${memberId} does not belong to role game ${currentGame.id}`);
  }
  if (currentMember.status !== member.status || currentMember.role !== member.role) {
    throw new Error(`Role game member ${memberId} has stale status`);
  }
  if (currentMember.role === 'primary_gm') {
    throw new Error(`Role game member ${memberId} is the primary GM`);
  }

  const normalizedActor: RoleGameActor = { ...actor, telegramUserId: actorTelegramUserId };
  void actorMembership;
  const currentActorMembership = await repository.findMemberByTelegramUserId(currentGame.id, actorTelegramUserId);
  const hasFullManagement = canManageRoleGame(normalizedActor, currentGame, currentActorMembership);
  const hasOperationalManagement = canManageRoleGameOperationally(normalizedActor, currentGame, currentActorMembership);

  if (action === 'confirm' || action === 'reject') {
    if (!hasOperationalManagement) {
      throw new Error(`Actor ${actorTelegramUserId} does not have permission to ${action} role game members`);
    }
    if (!hasFullManagement && currentMember.status !== 'requested') {
      throw new Error(`Actor ${actorTelegramUserId} does not have permission to ${action} this role game member`);
    }
  } else if (!hasFullManagement) {
    throw new Error(`Actor ${actorTelegramUserId} does not have permission to ${action} role game members`);
  }

  if (action === 'confirm') {
    if (!isConfirmableRoleGameMemberStatus(currentMember.status)) {
      throw new Error(`Role game member ${memberId} cannot confirm from status ${currentMember.status}`);
    }
    return repository.confirmMemberSeat({
      memberId,
      actorTelegramUserId,
      expectedStatuses: [currentMember.status],
    });
  }
  if (action === 'reject') {
    assertMemberStatus(currentMember, 'requested', action);
    return repository.setMemberStatus({
      memberId,
      status: 'rejected',
      expectedStatus: currentMember.status,
      expectedRole: currentMember.role,
      actorTelegramUserId,
    });
  }
  if (action === 'remove') {
    if (currentMember.status !== 'waitlisted' && currentMember.status !== 'confirmed') {
      throw new Error(`Role game member ${memberId} cannot remove from status ${currentMember.status}`);
    }
    return repository.setMemberStatus({
      memberId,
      status: 'removed',
      expectedStatus: currentMember.status,
      expectedRole: currentMember.role,
      actorTelegramUserId,
    });
  }
  if (action === 'cancel_invitation') {
    assertMemberStatus(currentMember, 'invited', action);
    return repository.setMemberStatus({
      memberId,
      status: 'removed',
      expectedStatus: currentMember.status,
      expectedRole: currentMember.role,
      actorTelegramUserId,
    });
  }
  if (action === 'promote') {
    assertMemberStatus(currentMember, 'confirmed', action);
    assertMemberRole(currentMember, 'player', action);
    if (currentMember.telegramUserId === actorTelegramUserId) {
      throw new Error(`Actor ${actorTelegramUserId} cannot promote themselves`);
    }
    return repository.setMemberRole({
      memberId,
      role: 'coorganizer',
      expectedRole: currentMember.role,
      expectedStatus: 'confirmed',
      actorTelegramUserId,
    });
  }
  assertMemberStatus(currentMember, 'confirmed', action);
  assertMemberRole(currentMember, 'coorganizer', action);
  return repository.setMemberRole({
    memberId,
    role: 'player',
    expectedRole: currentMember.role,
    expectedStatus: 'confirmed',
    actorTelegramUserId,
  });
}

export async function resolveRoleGameSeatRequest({
  repository,
  memberId,
  status,
  actorTelegramUserId,
}: {
  repository: RoleGameRepository;
  memberId: number;
  status: 'confirmed' | 'rejected';
  actorTelegramUserId: number;
}): Promise<RoleGameMemberRecord> {
  const normalizedMemberId = normalizeEntityId(memberId, 'role game member');
  const normalizedActorTelegramUserId = normalizeTelegramUserId(actorTelegramUserId, 'actor');
  const member = await repository.findMemberById(normalizedMemberId);
  if (!member || member.role !== 'player' || member.status !== 'requested') {
    throw new Error(`Role game member ${normalizedMemberId} is not a pending player request`);
  }

  if (status === 'confirmed') {
    return repository.confirmMemberSeat({
      memberId: normalizedMemberId,
      actorTelegramUserId: normalizedActorTelegramUserId,
      expectedStatuses: ['requested'],
    });
  }

  return repository.setMemberStatus({
    memberId: normalizedMemberId,
    status,
    expectedStatus: member.status,
    expectedRole: member.role,
    actorTelegramUserId: normalizedActorTelegramUserId,
  });
}

export function canViewRoleGameMaterial(
  actor: RoleGameActor,
  game: RoleGameRecord,
  membership: RoleGameMemberRecord | null,
  material: RoleGameMaterialRecord,
): boolean {
  if (material.roleGameId !== game.id) {
    return false;
  }
  if (actor.isAdmin || game.primaryGmTelegramUserId === actor.telegramUserId) {
    return true;
  }
  if (membership?.telegramUserId !== actor.telegramUserId || membership.status !== 'confirmed') {
    return false;
  }
  if (membership.role === 'coorganizer') {
    return true;
  }
  return material.visibility === 'players';
}

export async function createRoleGameMaterial({
  repository,
  ...input
}: Omit<CreateRoleGameMaterialInput, 'deliveryState'> & {
  deliveryState?: RoleGameMaterialDeliveryState;
  repository: RoleGameRepository;
}): Promise<RoleGameMaterialRecord> {
  return repository.createMaterial({
    ...input,
    roleGameId: normalizeEntityId(input.roleGameId, 'role game'),
    internalStorageEntryId: normalizeEntityId(input.internalStorageEntryId, 'storage entry'),
    title: normalizeText(input.title, 'material title', 1, 255),
    description: normalizeOptionalText(input.description),
    uploadedByTelegramUserId: normalizeTelegramUserId(input.uploadedByTelegramUserId, 'uploader'),
    deliveryState: input.deliveryState ?? 'not_sent',
  });
}

export async function revealRoleGameMaterial({
  repository,
  materialId,
}: {
  repository: RoleGameRepository;
  materialId: number;
}): Promise<RoleGameMaterialRecord> {
  return repository.updateMaterialVisibility({
    materialId: normalizeEntityId(materialId, 'role game material'),
    visibility: 'players',
    deliveryState: 'revealed',
  });
}

export async function recordRoleGameMaterialDelivery({
  repository,
  ...input
}: CreateRoleGameMaterialDeliveryInput & { repository: RoleGameRepository }): Promise<RoleGameMaterialDeliveryRecord> {
  return repository.createMaterialDelivery({
    ...input,
    roleGameMaterialId: normalizeEntityId(input.roleGameMaterialId, 'role game material'),
    recipientTelegramUserId: normalizeTelegramUserId(input.recipientTelegramUserId, 'recipient'),
    sentByTelegramUserId: normalizeTelegramUserId(input.sentByTelegramUserId, 'sender'),
    errorCode: normalizeOptionalText(input.errorCode),
  });
}

export function canViewRoleGame(
  actor: RoleGameActor,
  game: RoleGameRecord,
  membership: RoleGameMemberRecord | null,
): boolean {
  if (actor.isAdmin || game.primaryGmTelegramUserId === actor.telegramUserId) {
    return true;
  }
  if (membership && isActiveMemberStatus(membership.status)) {
    return true;
  }
  if (game.visibility === 'public') {
    return true;
  }
  if (game.visibility === 'members') {
    return actor.isApproved === true;
  }
  return false;
}

export function canRequestRoleGameSeat(
  actor: RoleGameActor,
  game: RoleGameRecord,
  membership: RoleGameMemberRecord | null,
): boolean {
  if (
    game.status !== 'active' ||
    game.entryMode !== 'request' ||
    actor.isAdmin ||
    game.primaryGmTelegramUserId === actor.telegramUserId ||
    membership !== null ||
    !canViewRoleGame(actor, game, membership)
  ) {
    return false;
  }
  if (actor.isApproved === true) {
    return true;
  }
  return game.type === 'one_shot' &&
    game.visibility === 'public' &&
    game.publicJoinPolicy === 'members_and_external';
}

export function canManageRoleGame(
  actor: RoleGameActor,
  game: RoleGameRecord,
  _membership: RoleGameMemberRecord | null,
): boolean {
  return actor.isAdmin || game.primaryGmTelegramUserId === actor.telegramUserId;
}

export function canManageRoleGameOperationally(
  actor: RoleGameActor,
  game: RoleGameRecord,
  membership: RoleGameMemberRecord | null,
): boolean {
  if (canManageRoleGame(actor, game, membership)) {
    return true;
  }
  return membership?.telegramUserId === actor.telegramUserId && membership.role === 'coorganizer' && membership.status === 'confirmed';
}

function isConfirmableRoleGameMemberStatus(
  status: RoleGameMemberStatus,
): status is 'requested' | 'invited' | 'waitlisted' {
  return status === 'requested' || status === 'invited' || status === 'waitlisted';
}

function assertMemberStatus(
  member: RoleGameMemberRecord,
  expectedStatus: RoleGameMemberStatus,
  action: RoleGameMemberManagementAction,
): void {
  if (member.status !== expectedStatus) {
    throw new Error(`Role game member ${member.id} cannot ${action} from status ${member.status}`);
  }
}

function assertMemberRole(
  member: RoleGameMemberRecord,
  expectedRole: RoleGameMemberRole,
  action: RoleGameMemberManagementAction,
): void {
  if (member.role !== expectedRole) {
    throw new Error(`Role game member ${member.id} cannot ${action} with role ${member.role}`);
  }
}

function normalizeCreateRoleGameInput(input: CreateRoleGameInput): CreateRoleGameInput {
  const recurrenceRule = input.recurrenceRule ? normalizeRecurrenceRule(input.recurrenceRule) : null;
  if (input.schedulingMode === 'manual' && recurrenceRule !== null) {
    throw new Error('Manual role games cannot define a recurrence rule');
  }
  if (input.schedulingMode === 'recurring' && recurrenceRule === null) {
    throw new Error('Recurring role games require a recurrence rule');
  }

  return {
    ...input,
    title: normalizeText(input.title, 'title', 3, 255),
    system: normalizeText(input.system, 'system', 2, 120),
    description: normalizeOptionalText(input.description),
    capacity: normalizePositiveInteger(input.capacity, 'capacity', 1, 50),
    primaryGmTelegramUserId: normalizeTelegramUserId(input.primaryGmTelegramUserId, 'primary GM'),
    createdByTelegramUserId: normalizeTelegramUserId(input.createdByTelegramUserId, 'creator'),
    defaultDurationMinutes: normalizePositiveInteger(input.defaultDurationMinutes, 'default duration minutes', 15, 24 * 60),
    defaultTableId: input.defaultTableId === null ? null : normalizeEntityId(input.defaultTableId, 'table'),
    recurrenceRule,
    recurrenceWindowCount: normalizeNonNegativeInteger(input.recurrenceWindowCount, 'recurrence window count', 24),
  };
}

function normalizeRecurrenceRule(rule: RoleGameRecurrenceRule): RoleGameRecurrenceRule {
  return {
    intervalWeeks: normalizePositiveInteger(rule.intervalWeeks, 'recurrence interval weeks', 1, 52),
    weekday: normalizeWeekday(rule.weekday),
    time: normalizeTime(rule.time),
  };
}

function normalizeText(value: string, field: string, minLength: number, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length < minLength) {
    throw new Error(`Role game ${field} must be at least ${minLength} characters`);
  }
  if (normalized.length > maxLength) {
    throw new Error(`Role game ${field} must be at most ${maxLength} characters`);
  }
  return normalized;
}

function normalizeOptionalText(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length === 0 ? null : normalized;
}

function normalizeTelegramUserId(value: number, label: string): number {
  return normalizePositiveInteger(value, `${label} Telegram user ID`, 1, Number.MAX_SAFE_INTEGER);
}

function normalizeEntityId(value: number, label: string): number {
  return normalizePositiveInteger(value, `${label} ID`, 1, Number.MAX_SAFE_INTEGER);
}

function normalizePositiveInteger(value: number, field: string, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Role game ${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function normalizeNonNegativeInteger(value: number, field: string, max: number): number {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(`Role game ${field} must be an integer between 0 and ${max}`);
  }
  return value;
}

function normalizeWeekday(value: number): RoleGameRecurrenceRule['weekday'] {
  if (!Number.isInteger(value) || value < 0 || value > 6) {
    throw new Error('Role game recurrence weekday must be an integer between 0 and 6');
  }
  return value as RoleGameRecurrenceRule['weekday'];
}

function normalizeTime(value: string): string {
  if (!/^\d{2}:\d{2}$/.test(value)) {
    throw new Error('Role game recurrence time must use HH:mm format');
  }
  const [hoursText, minutesText] = value.split(':');
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (hours > 23 || minutes > 59) {
    throw new Error('Role game recurrence time must be a valid 24-hour time');
  }
  return value;
}

function isActiveMemberStatus(status: RoleGameMemberStatus): boolean {
  return status === 'invited' || status === 'requested' || status === 'confirmed' || status === 'waitlisted';
}
