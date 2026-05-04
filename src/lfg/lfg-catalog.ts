export type LfgAdStatus = 'active' | 'resolved' | 'cancelled';

export interface LfgPlayerAdRecord {
  id: number;
  telegramUserId: number;
  displayName: string;
  username: string | null;
  description: string;
  status: LfgAdStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  cancelledAt: string | null;
}

export interface LfgGroupAdRecord {
  id: number;
  createdByTelegramUserId: number;
  creatorDisplayName: string;
  creatorUsername: string | null;
  title: string;
  description: string;
  seatsAvailable: number | null;
  status: LfgAdStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  cancelledAt: string | null;
}

export interface LfgRepository {
  upsertActivePlayerAd(input: {
    telegramUserId: number;
    displayName: string;
    description: string;
  }): Promise<LfgPlayerAdRecord>;
  createGroupAd(input: {
    createdByTelegramUserId: number;
    creatorDisplayName: string;
    title: string;
    description: string;
    seatsAvailable: number | null;
  }): Promise<LfgGroupAdRecord>;
  updatePlayerAd(input: {
    adId: number;
    telegramUserId: number;
    displayName: string;
    description: string;
  }): Promise<LfgPlayerAdRecord>;
  updateGroupAd(input: {
    adId: number;
    actorTelegramUserId: number;
    title: string;
    description: string;
    seatsAvailable: number | null;
  }): Promise<LfgGroupAdRecord>;
  setPlayerAdStatus(input: {
    adId: number;
    actorTelegramUserId: number;
    status: Exclude<LfgAdStatus, 'active'>;
  }): Promise<LfgPlayerAdRecord>;
  setGroupAdStatus(input: {
    adId: number;
    actorTelegramUserId: number;
    status: Exclude<LfgAdStatus, 'active'>;
  }): Promise<LfgGroupAdRecord>;
  listActivePlayerAds(): Promise<LfgPlayerAdRecord[]>;
  listActiveGroupAds(): Promise<LfgGroupAdRecord[]>;
  listActiveAdsByUser(telegramUserId: number): Promise<{
    playerAds: LfgPlayerAdRecord[];
    groupAds: LfgGroupAdRecord[];
  }>;
  findPlayerAdById(adId: number): Promise<LfgPlayerAdRecord | null>;
  findGroupAdById(adId: number): Promise<LfgGroupAdRecord | null>;
}

export async function upsertLfgPlayerAd({
  repository,
  telegramUserId,
  displayName,
  description,
}: {
  repository: LfgRepository;
  telegramUserId: number;
  displayName: string;
  description: string;
}): Promise<LfgPlayerAdRecord> {
  return repository.upsertActivePlayerAd({
    telegramUserId: normalizeTelegramUserId(telegramUserId, 'player'),
    displayName: normalizeDisplayName(displayName),
    description: normalizeDescription(description),
  });
}

export async function createLfgGroupAd({
  repository,
  createdByTelegramUserId,
  creatorDisplayName,
  title,
  description,
  seatsAvailable,
}: {
  repository: LfgRepository;
  createdByTelegramUserId: number;
  creatorDisplayName: string;
  title: string;
  description: string;
  seatsAvailable?: number | null;
}): Promise<LfgGroupAdRecord> {
  return repository.createGroupAd({
    createdByTelegramUserId: normalizeTelegramUserId(createdByTelegramUserId, 'creator'),
    creatorDisplayName: normalizeDisplayName(creatorDisplayName),
    title: normalizeTitle(title),
    description: normalizeDescription(description),
    seatsAvailable: normalizeOptionalSeats(seatsAvailable),
  });
}

export async function updateLfgPlayerAd({
  repository,
  adId,
  telegramUserId,
  displayName,
  description,
}: {
  repository: LfgRepository;
  adId: number;
  telegramUserId: number;
  displayName: string;
  description: string;
}): Promise<LfgPlayerAdRecord> {
  await ensureOwnedActivePlayerAd(repository, adId, telegramUserId);
  return repository.updatePlayerAd({
    adId: normalizeEntityId(adId, 'player ad'),
    telegramUserId: normalizeTelegramUserId(telegramUserId, 'player'),
    displayName: normalizeDisplayName(displayName),
    description: normalizeDescription(description),
  });
}

export async function updateLfgGroupAd({
  repository,
  adId,
  actorTelegramUserId,
  title,
  description,
  seatsAvailable,
}: {
  repository: LfgRepository;
  adId: number;
  actorTelegramUserId: number;
  title: string;
  description: string;
  seatsAvailable?: number | null;
}): Promise<LfgGroupAdRecord> {
  await ensureOwnedActiveGroupAd(repository, adId, actorTelegramUserId);
  return repository.updateGroupAd({
    adId: normalizeEntityId(adId, 'group ad'),
    actorTelegramUserId: normalizeTelegramUserId(actorTelegramUserId, 'creator'),
    title: normalizeTitle(title),
    description: normalizeDescription(description),
    seatsAvailable: normalizeOptionalSeats(seatsAvailable),
  });
}

export async function resolveLfgPlayerAd(input: {
  repository: LfgRepository;
  adId: number;
  actorTelegramUserId: number;
}): Promise<LfgPlayerAdRecord> {
  return setPlayerAdTerminalStatus({ ...input, status: 'resolved' });
}

export async function cancelLfgPlayerAd(input: {
  repository: LfgRepository;
  adId: number;
  actorTelegramUserId: number;
}): Promise<LfgPlayerAdRecord> {
  return setPlayerAdTerminalStatus({ ...input, status: 'cancelled' });
}

export async function resolveLfgGroupAd(input: {
  repository: LfgRepository;
  adId: number;
  actorTelegramUserId: number;
}): Promise<LfgGroupAdRecord> {
  return setGroupAdTerminalStatus({ ...input, status: 'resolved' });
}

export async function cancelLfgGroupAd(input: {
  repository: LfgRepository;
  adId: number;
  actorTelegramUserId: number;
}): Promise<LfgGroupAdRecord> {
  return setGroupAdTerminalStatus({ ...input, status: 'cancelled' });
}

async function setPlayerAdTerminalStatus({
  repository,
  adId,
  actorTelegramUserId,
  status,
}: {
  repository: LfgRepository;
  adId: number;
  actorTelegramUserId: number;
  status: Exclude<LfgAdStatus, 'active'>;
}): Promise<LfgPlayerAdRecord> {
  await ensureOwnedActivePlayerAd(repository, adId, actorTelegramUserId);
  return repository.setPlayerAdStatus({
    adId: normalizeEntityId(adId, 'player ad'),
    actorTelegramUserId: normalizeTelegramUserId(actorTelegramUserId, 'actor'),
    status,
  });
}

async function setGroupAdTerminalStatus({
  repository,
  adId,
  actorTelegramUserId,
  status,
}: {
  repository: LfgRepository;
  adId: number;
  actorTelegramUserId: number;
  status: Exclude<LfgAdStatus, 'active'>;
}): Promise<LfgGroupAdRecord> {
  await ensureOwnedActiveGroupAd(repository, adId, actorTelegramUserId);
  return repository.setGroupAdStatus({
    adId: normalizeEntityId(adId, 'group ad'),
    actorTelegramUserId: normalizeTelegramUserId(actorTelegramUserId, 'actor'),
    status,
  });
}

async function ensureOwnedActivePlayerAd(repository: LfgRepository, adId: number, actorTelegramUserId: number): Promise<void> {
  const normalizedAdId = normalizeEntityId(adId, 'player ad');
  const normalizedActorId = normalizeTelegramUserId(actorTelegramUserId, 'actor');
  const ad = await repository.findPlayerAdById(normalizedAdId);
  if (!ad) {
    throw new Error(`LFG player ad ${normalizedAdId} not found`);
  }
  if (ad.telegramUserId !== normalizedActorId) {
    throw new Error(`LFG player ad ${normalizedAdId} is owned by another user`);
  }
  if (ad.status !== 'active') {
    throw new Error(`LFG player ad ${normalizedAdId} is not active`);
  }
}

async function ensureOwnedActiveGroupAd(repository: LfgRepository, adId: number, actorTelegramUserId: number): Promise<void> {
  const normalizedAdId = normalizeEntityId(adId, 'group ad');
  const normalizedActorId = normalizeTelegramUserId(actorTelegramUserId, 'actor');
  const ad = await repository.findGroupAdById(normalizedAdId);
  if (!ad) {
    throw new Error(`LFG group ad ${normalizedAdId} not found`);
  }
  if (ad.createdByTelegramUserId !== normalizedActorId) {
    throw new Error(`LFG group ad ${normalizedAdId} is owned by another user`);
  }
  if (ad.status !== 'active') {
    throw new Error(`LFG group ad ${normalizedAdId} is not active`);
  }
}

function normalizeDescription(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length < 10) {
    throw new Error('LFG description must be at least 10 characters long');
  }
  if (normalized.length > 500) {
    throw new Error('LFG description must be 500 characters or fewer');
  }
  return normalized;
}

function normalizeTitle(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length < 3) {
    throw new Error('LFG group ad title must be at least 3 characters long');
  }
  if (normalized.length > 120) {
    throw new Error('LFG group ad title must be 120 characters or fewer');
  }
  return normalized;
}

function normalizeDisplayName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length === 0) {
    throw new Error('LFG display name cannot be empty');
  }
  return normalized.slice(0, 255);
}

function normalizeOptionalSeats(value: number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Number.isInteger(value) || value < 1 || value > 99) {
    throw new Error('LFG seats available must be an integer between 1 and 99');
  }
  return value;
}

function normalizeTelegramUserId(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${label} Telegram user ID`);
  }
  return value;
}

function normalizeEntityId(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${label} ID`);
  }
  return value;
}
