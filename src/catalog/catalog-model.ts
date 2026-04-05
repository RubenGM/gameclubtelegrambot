export type CatalogFamilyKind = 'board-game-line' | 'rpg-line' | 'generic-line';
export type CatalogItemType = 'board-game' | 'expansion' | 'book' | 'rpg-book' | 'accessory';
export type CatalogItemLifecycleStatus = 'active' | 'deactivated';
export type CatalogMediaType = 'image' | 'link' | 'document';
export type CatalogLoanLifecycleStatus = 'active' | 'returned';

export interface CatalogFamilyRecord {
  id: number;
  slug: string;
  displayName: string;
  description: string | null;
  familyKind: CatalogFamilyKind;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogGroupRecord {
  id: number;
  familyId: number | null;
  slug: string;
  displayName: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogItemRecord {
  id: number;
  familyId: number | null;
  groupId: number | null;
  itemType: CatalogItemType;
  displayName: string;
  originalName: string | null;
  description: string | null;
  language: string | null;
  publisher: string | null;
  publicationYear: number | null;
  playerCountMin: number | null;
  playerCountMax: number | null;
  recommendedAge: number | null;
  playTimeMinutes: number | null;
  externalRefs: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  lifecycleStatus: CatalogItemLifecycleStatus;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
}

export interface CatalogMediaRecord {
  id: number;
  familyId: number | null;
  itemId: number | null;
  mediaType: CatalogMediaType;
  url: string;
  altText: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogLoanRecord {
  id: number;
  itemId: number;
  borrowerTelegramUserId: number;
  borrowerDisplayName: string;
  loanedByTelegramUserId: number;
  dueAt: string | null;
  notes: string | null;
  returnedAt: string | null;
  returnedByTelegramUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogRepository {
  createFamily(input: {
    slug: string;
    displayName: string;
    description: string | null;
    familyKind: CatalogFamilyKind;
  }): Promise<CatalogFamilyRecord>;
  findFamilyById(familyId: number): Promise<CatalogFamilyRecord | null>;
  listFamilies(): Promise<CatalogFamilyRecord[]>;
  createGroup(input: {
    familyId: number | null;
    slug: string;
    displayName: string;
    description: string | null;
  }): Promise<CatalogGroupRecord>;
  findGroupById(groupId: number): Promise<CatalogGroupRecord | null>;
  listGroups(input: { familyId?: number }): Promise<CatalogGroupRecord[]>;
  createItem(input: {
    familyId: number | null;
    groupId: number | null;
    itemType: CatalogItemType;
    displayName: string;
    originalName: string | null;
    description: string | null;
    language: string | null;
    publisher: string | null;
    publicationYear: number | null;
    playerCountMin: number | null;
    playerCountMax: number | null;
    recommendedAge: number | null;
    playTimeMinutes: number | null;
    externalRefs: Record<string, unknown> | null;
    metadata: Record<string, unknown> | null;
  }): Promise<CatalogItemRecord>;
  findItemById(itemId: number): Promise<CatalogItemRecord | null>;
  listItems(input: {
    familyId?: number;
    groupId?: number;
    includeDeactivated: boolean;
  }): Promise<CatalogItemRecord[]>;
  updateItem(input: {
    itemId: number;
    familyId: number | null;
    groupId: number | null;
    itemType: CatalogItemType;
    displayName: string;
    originalName: string | null;
    description: string | null;
    language: string | null;
    publisher: string | null;
    publicationYear: number | null;
    playerCountMin: number | null;
    playerCountMax: number | null;
    recommendedAge: number | null;
    playTimeMinutes: number | null;
    externalRefs: Record<string, unknown> | null;
    metadata: Record<string, unknown> | null;
  }): Promise<CatalogItemRecord>;
  deactivateItem(input: { itemId: number }): Promise<CatalogItemRecord>;
  createMedia(input: {
    familyId: number | null;
    itemId: number | null;
    mediaType: CatalogMediaType;
    url: string;
    altText: string | null;
    sortOrder: number;
  }): Promise<CatalogMediaRecord>;
  listMedia(input: { familyId?: number; itemId?: number }): Promise<CatalogMediaRecord[]>;
  updateMedia(input: {
    mediaId: number;
    mediaType: CatalogMediaType;
    url: string;
    altText: string | null;
    sortOrder: number;
  }): Promise<CatalogMediaRecord>;
  deleteMedia(input: { mediaId: number }): Promise<boolean>;
}

export interface CatalogLoanRepository {
  createLoan(input: {
    itemId: number;
    borrowerTelegramUserId: number;
    borrowerDisplayName: string;
    loanedByTelegramUserId: number;
    dueAt: string | null;
    notes: string | null;
  }): Promise<CatalogLoanRecord>;
  findLoanById(loanId: number): Promise<CatalogLoanRecord | null>;
  findActiveLoanByItemId(itemId: number): Promise<CatalogLoanRecord | null>;
  listActiveLoansByBorrower(borrowerTelegramUserId: number): Promise<CatalogLoanRecord[]>;
  listLoansByItem(itemId: number): Promise<CatalogLoanRecord[]>;
  updateLoan(input: { loanId: number; dueAt: string | null; notes: string | null }): Promise<CatalogLoanRecord>;
  closeLoan(input: { loanId: number; returnedByTelegramUserId: number }): Promise<CatalogLoanRecord>;
}

export interface CatalogLoanRepository {
  createLoan(input: {
    itemId: number;
    borrowerTelegramUserId: number;
    borrowerDisplayName: string;
    loanedByTelegramUserId: number;
    dueAt: string | null;
    notes: string | null;
  }): Promise<CatalogLoanRecord>;
  findLoanById(loanId: number): Promise<CatalogLoanRecord | null>;
  findActiveLoanByItemId(itemId: number): Promise<CatalogLoanRecord | null>;
  listActiveLoansByBorrower(borrowerTelegramUserId: number): Promise<CatalogLoanRecord[]>;
  listLoansByItem(itemId: number): Promise<CatalogLoanRecord[]>;
  updateLoan(input: {
    loanId: number;
    dueAt: string | null;
    notes: string | null;
  }): Promise<CatalogLoanRecord>;
  closeLoan(input: {
    loanId: number;
    returnedByTelegramUserId: number;
  }): Promise<CatalogLoanRecord>;
}

export async function createCatalogFamily({
  repository,
  slug,
  displayName,
  description,
  familyKind,
}: {
  repository: CatalogRepository;
  slug: string;
  displayName: string;
  description?: string | null;
  familyKind: CatalogFamilyKind;
}): Promise<CatalogFamilyRecord> {
  return repository.createFamily({
    slug: normalizeSlug(slug),
    displayName: normalizeRequiredText(displayName, 'El nom visible de la familia es obligatori'),
    description: normalizeOptionalText(description),
    familyKind: normalizeFamilyKind(familyKind),
  });
}

export async function createCatalogGroup({
  repository,
  familyId,
  slug,
  displayName,
  description,
}: {
  repository: CatalogRepository;
  familyId: number | null;
  slug: string;
  displayName: string;
  description?: string | null;
}): Promise<CatalogGroupRecord> {
  if (familyId !== null) {
    const family = await repository.findFamilyById(familyId);
    if (!family) {
      throw new Error(`Catalog family ${familyId} not found`);
    }
  }

  return repository.createGroup({
    familyId,
    slug: normalizeSlug(slug),
    displayName: normalizeRequiredText(displayName, 'El nom visible del grup es obligatori'),
    description: normalizeOptionalText(description),
  });
}

export async function listCatalogGroups({
  repository,
  familyId,
}: {
  repository: CatalogRepository;
  familyId?: number;
}): Promise<CatalogGroupRecord[]> {
  return repository.listGroups({ ...(familyId !== undefined ? { familyId } : {}) });
}

export async function createCatalogItem({
  repository,
  familyId,
  groupId,
  itemType,
  displayName,
  originalName,
  description,
  language,
  publisher,
  publicationYear,
  playerCountMin,
  playerCountMax,
  recommendedAge,
  playTimeMinutes,
  externalRefs,
  metadata,
}: {
  repository: CatalogRepository;
  familyId: number | null;
  groupId?: number | null;
  itemType: CatalogItemType;
  displayName: string;
  originalName?: string | null;
  description?: string | null;
  language?: string | null;
  publisher?: string | null;
  publicationYear?: number | null;
  playerCountMin?: number | null;
  playerCountMax?: number | null;
  recommendedAge?: number | null;
  playTimeMinutes?: number | null;
  externalRefs?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}): Promise<CatalogItemRecord> {
  await ensureFamilyAndGroupConsistency({ repository, familyId, groupId: groupId ?? null });
  const normalizedItemType = normalizeItemType(itemType);

  const normalizedPlayerCountMin = itemTypeSupportsPlayers(normalizedItemType)
    ? normalizePositiveInteger(playerCountMin, 'El minim de jugadors ha de ser un enter positiu')
    : null;
  const normalizedPlayerCountMax = itemTypeSupportsPlayers(normalizedItemType)
    ? normalizePositiveInteger(playerCountMax, 'El maxim de jugadors ha de ser un enter positiu')
    : null;
  if (
    normalizedPlayerCountMin !== null &&
    normalizedPlayerCountMax !== null &&
    normalizedPlayerCountMax < normalizedPlayerCountMin
  ) {
    throw new Error('El maxim de jugadors no pot ser inferior al minim');
  }

  return repository.createItem({
    familyId,
    groupId: groupId ?? null,
    itemType: normalizedItemType,
    displayName: normalizeRequiredText(displayName, 'El nom visible de l item es obligatori'),
    originalName: normalizeOptionalText(originalName),
    description: normalizeOptionalText(description),
    language: normalizeOptionalText(language),
    publisher: normalizeOptionalText(publisher),
    publicationYear: normalizePositiveInteger(publicationYear, 'L any de publicacio ha de ser un enter positiu'),
    playerCountMin: normalizedPlayerCountMin,
    playerCountMax: normalizedPlayerCountMax,
    recommendedAge: normalizePositiveInteger(recommendedAge, 'L edat recomanada ha de ser un enter positiu'),
    playTimeMinutes: normalizePositiveInteger(playTimeMinutes, 'La durada ha de ser un enter positiu'),
    externalRefs: normalizeObject(externalRefs),
    metadata: normalizeObject(metadata),
  });
}

export async function listCatalogItems({
  repository,
  familyId,
  groupId,
  includeDeactivated = false,
}: {
  repository: CatalogRepository;
  familyId?: number;
  groupId?: number;
  includeDeactivated?: boolean;
}): Promise<CatalogItemRecord[]> {
  return repository.listItems({
    ...(familyId !== undefined ? { familyId } : {}),
    ...(groupId !== undefined ? { groupId } : {}),
    includeDeactivated,
  });
}

export async function updateCatalogItem({
  repository,
  itemId,
  familyId,
  groupId,
  itemType,
  displayName,
  originalName,
  description,
  language,
  publisher,
  publicationYear,
  playerCountMin,
  playerCountMax,
  recommendedAge,
  playTimeMinutes,
  externalRefs,
  metadata,
}: {
  repository: CatalogRepository;
  itemId: number;
  familyId: number | null;
  groupId?: number | null;
  itemType: CatalogItemType;
  displayName: string;
  originalName?: string | null;
  description?: string | null;
  language?: string | null;
  publisher?: string | null;
  publicationYear?: number | null;
  playerCountMin?: number | null;
  playerCountMax?: number | null;
  recommendedAge?: number | null;
  playTimeMinutes?: number | null;
  externalRefs?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}): Promise<CatalogItemRecord> {
  const existing = await repository.findItemById(itemId);
  if (!existing) {
    throw new Error(`Catalog item ${itemId} not found`);
  }
  await ensureFamilyAndGroupConsistency({ repository, familyId, groupId: groupId ?? null });
  const normalizedItemType = normalizeItemType(itemType);

  const normalizedPlayerCountMin = itemTypeSupportsPlayers(normalizedItemType)
    ? normalizePositiveInteger(playerCountMin, 'El minim de jugadors ha de ser un enter positiu')
    : null;
  const normalizedPlayerCountMax = itemTypeSupportsPlayers(normalizedItemType)
    ? normalizePositiveInteger(playerCountMax, 'El maxim de jugadors ha de ser un enter positiu')
    : null;
  if (
    normalizedPlayerCountMin !== null &&
    normalizedPlayerCountMax !== null &&
    normalizedPlayerCountMax < normalizedPlayerCountMin
  ) {
    throw new Error('El maxim de jugadors no pot ser inferior al minim');
  }

  return repository.updateItem({
    itemId,
    familyId,
    groupId: groupId ?? null,
    itemType: normalizedItemType,
    displayName: normalizeRequiredText(displayName, 'El nom visible de l item es obligatori'),
    originalName: normalizeOptionalText(originalName),
    description: normalizeOptionalText(description),
    language: normalizeOptionalText(language),
    publisher: normalizeOptionalText(publisher),
    publicationYear: normalizePositiveInteger(publicationYear, 'L any de publicacio ha de ser un enter positiu'),
    playerCountMin: normalizedPlayerCountMin,
    playerCountMax: normalizedPlayerCountMax,
    recommendedAge: normalizePositiveInteger(recommendedAge, 'L edat recomanada ha de ser un enter positiu'),
    playTimeMinutes: normalizePositiveInteger(playTimeMinutes, 'La durada ha de ser un enter positiu'),
    externalRefs: normalizeObject(externalRefs),
    metadata: normalizeObject(metadata),
  });
}

export async function deactivateCatalogItem({
  repository,
  itemId,
}: {
  repository: CatalogRepository;
  itemId: number;
}): Promise<CatalogItemRecord> {
  const existing = await repository.findItemById(itemId);
  if (!existing) {
    throw new Error(`Catalog item ${itemId} not found`);
  }
  if (existing.lifecycleStatus === 'deactivated') {
    return existing;
  }
  return repository.deactivateItem({ itemId });
}

export async function createCatalogMedia({
  repository,
  familyId,
  itemId,
  mediaType,
  url,
  altText,
  sortOrder,
}: {
  repository: CatalogRepository;
  familyId: number | null;
  itemId: number | null;
  mediaType: CatalogMediaType;
  url: string;
  altText?: string | null;
  sortOrder?: number;
}): Promise<CatalogMediaRecord> {
  if ((familyId === null && itemId === null) || (familyId !== null && itemId !== null)) {
    throw new Error('El media ha d apuntar exactament a una familia o a un item');
  }

  if (familyId !== null) {
    const family = await repository.findFamilyById(familyId);
    if (!family) {
      throw new Error(`Catalog family ${familyId} not found`);
    }
  }
  if (itemId !== null) {
    const item = await repository.findItemById(itemId);
    if (!item) {
      throw new Error(`Catalog item ${itemId} not found`);
    }
  }

  return repository.createMedia({
    familyId,
    itemId,
    mediaType: normalizeMediaType(mediaType),
    url: normalizeRequiredText(url, 'La URL del media es obligatoria'),
    altText: normalizeOptionalText(altText),
    sortOrder: normalizeSortOrder(sortOrder),
  });
}

export async function updateCatalogMedia({
  repository,
  mediaId,
  mediaType,
  url,
  altText,
  sortOrder,
}: {
  repository: CatalogRepository;
  mediaId: number;
  mediaType: CatalogMediaType;
  url: string;
  altText?: string | null;
  sortOrder?: number;
}): Promise<CatalogMediaRecord> {
  const existing = (await repository.listMedia({})).find((entry) => entry.id === mediaId);
  if (!existing) {
    throw new Error(`Catalog media ${mediaId} not found`);
  }

  return repository.updateMedia({
    mediaId,
    mediaType: normalizeMediaType(mediaType),
    url: normalizeRequiredText(url, 'La URL del media es obligatoria'),
    altText: normalizeOptionalText(altText),
    sortOrder: normalizeSortOrder(sortOrder),
  });
}

export async function removeCatalogMedia({
  repository,
  mediaId,
}: {
  repository: CatalogRepository;
  mediaId: number;
}): Promise<void> {
  const deleted = await repository.deleteMedia({ mediaId });
  if (!deleted) {
    throw new Error(`Catalog media ${mediaId} not found`);
  }
}

function normalizeSlug(slug: string): string {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) {
    throw new Error('El slug de la familia es obligatori');
  }
  return normalized;
}

async function ensureFamilyAndGroupConsistency({
  repository,
  familyId,
  groupId,
}: {
  repository: CatalogRepository;
  familyId: number | null;
  groupId: number | null;
}): Promise<void> {
  if (familyId !== null) {
    const family = await repository.findFamilyById(familyId);
    if (!family) {
      throw new Error(`Catalog family ${familyId} not found`);
    }
  }
  if (groupId === null) {
    return;
  }

  const group = await repository.findGroupById(groupId);
  if (!group) {
    throw new Error(`Catalog group ${groupId} not found`);
  }
  if (group.familyId !== familyId) {
    throw new Error('La familia de l item ha de coincidir amb la del grup seleccionat');
  }
}

function normalizeRequiredText(value: string, message: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(message);
  }
  return normalized;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeFamilyKind(value: CatalogFamilyKind): CatalogFamilyKind {
  if (value !== 'board-game-line' && value !== 'rpg-line' && value !== 'generic-line') {
    throw new Error('El tipus de familia no es valid');
  }
  return value;
}

function normalizeItemType(value: CatalogItemType): CatalogItemType {
  if (value !== 'board-game' && value !== 'expansion' && value !== 'book' && value !== 'rpg-book' && value !== 'accessory') {
    throw new Error('El tipus d item no es valid');
  }
  return value;
}

function normalizeMediaType(value: CatalogMediaType): CatalogMediaType {
  if (value !== 'image' && value !== 'link' && value !== 'document') {
    throw new Error('El tipus de media no es valid');
  }
  return value;
}

function itemTypeSupportsPlayers(value: CatalogItemType): boolean {
  return value !== 'book' && value !== 'rpg-book';
}

function normalizePositiveInteger(value: number | null | undefined, message: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(message);
  }
  return value;
}

function normalizeObject(value: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  return value ?? null;
}

function normalizeSortOrder(value: number | undefined): number {
  if (value === undefined) {
    return 0;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('L ordre del media ha de ser un enter positiu o zero');
  }
  return value;
}
