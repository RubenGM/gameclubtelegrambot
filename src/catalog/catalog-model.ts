export type CatalogFamilyKind = 'board-game-line' | 'rpg-line' | 'generic-line';
export type CatalogItemType = 'board-game' | 'expansion' | 'rpg-book' | 'accessory';
export type CatalogItemLifecycleStatus = 'active' | 'deactivated';
export type CatalogMediaType = 'image' | 'link' | 'document';

export interface CatalogFamilyRecord {
  id: number;
  slug: string;
  displayName: string;
  description: string | null;
  familyKind: CatalogFamilyKind;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogItemRecord {
  id: number;
  familyId: number | null;
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

export interface CatalogRepository {
  createFamily(input: {
    slug: string;
    displayName: string;
    description: string | null;
    familyKind: CatalogFamilyKind;
  }): Promise<CatalogFamilyRecord>;
  findFamilyById(familyId: number): Promise<CatalogFamilyRecord | null>;
  listFamilies(): Promise<CatalogFamilyRecord[]>;
  createItem(input: {
    familyId: number | null;
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
    includeDeactivated: boolean;
  }): Promise<CatalogItemRecord[]>;
  createMedia(input: {
    familyId: number | null;
    itemId: number | null;
    mediaType: CatalogMediaType;
    url: string;
    altText: string | null;
    sortOrder: number;
  }): Promise<CatalogMediaRecord>;
  listMedia(input: { familyId?: number; itemId?: number }): Promise<CatalogMediaRecord[]>;
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

export async function createCatalogItem({
  repository,
  familyId,
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
  if (familyId !== null) {
    const family = await repository.findFamilyById(familyId);
    if (!family) {
      throw new Error(`Catalog family ${familyId} not found`);
    }
  }

  const normalizedPlayerCountMin = normalizePositiveInteger(playerCountMin, 'El minim de jugadors ha de ser un enter positiu');
  const normalizedPlayerCountMax = normalizePositiveInteger(playerCountMax, 'El maxim de jugadors ha de ser un enter positiu');
  if (
    normalizedPlayerCountMin !== null &&
    normalizedPlayerCountMax !== null &&
    normalizedPlayerCountMax < normalizedPlayerCountMin
  ) {
    throw new Error('El maxim de jugadors no pot ser inferior al minim');
  }

  return repository.createItem({
    familyId,
    itemType: normalizeItemType(itemType),
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
  includeDeactivated = false,
}: {
  repository: CatalogRepository;
  familyId?: number;
  includeDeactivated?: boolean;
}): Promise<CatalogItemRecord[]> {
  return repository.listItems({
    ...(familyId !== undefined ? { familyId } : {}),
    includeDeactivated,
  });
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

function normalizeSlug(slug: string): string {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) {
    throw new Error('El slug de la familia es obligatori');
  }
  return normalized;
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
  if (value !== 'board-game' && value !== 'expansion' && value !== 'rpg-book' && value !== 'accessory') {
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
