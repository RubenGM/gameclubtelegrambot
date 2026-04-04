export type ClubTableLifecycleStatus = 'active' | 'deactivated';

export interface ClubTableRecord {
  id: number;
  displayName: string;
  description: string | null;
  recommendedCapacity: number | null;
  lifecycleStatus: ClubTableLifecycleStatus;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
}

export interface ClubTableRepository {
  createTable(input: {
    displayName: string;
    description: string | null;
    recommendedCapacity: number | null;
  }): Promise<ClubTableRecord>;
  findTableById(tableId: number): Promise<ClubTableRecord | null>;
  listTables(input: { includeDeactivated: boolean }): Promise<ClubTableRecord[]>;
  updateTable(input: {
    tableId: number;
    displayName: string;
    description: string | null;
    recommendedCapacity: number | null;
  }): Promise<ClubTableRecord>;
  deactivateTable(input: { tableId: number }): Promise<ClubTableRecord>;
}

export async function createClubTable({
  repository,
  displayName,
  description,
  recommendedCapacity,
}: {
  repository: ClubTableRepository;
  displayName: string;
  description?: string | null;
  recommendedCapacity?: number | null;
}): Promise<ClubTableRecord> {
  return repository.createTable({
    displayName: normalizeDisplayName(displayName),
    description: normalizeDescription(description),
    recommendedCapacity: normalizeRecommendedCapacity(recommendedCapacity),
  });
}

export async function getClubTable({
  repository,
  tableId,
}: {
  repository: ClubTableRepository;
  tableId: number;
}): Promise<ClubTableRecord | null> {
  return repository.findTableById(tableId);
}

export async function listClubTables({
  repository,
  includeDeactivated = false,
}: {
  repository: ClubTableRepository;
  includeDeactivated?: boolean;
}): Promise<ClubTableRecord[]> {
  return repository.listTables({ includeDeactivated });
}

export async function updateClubTableMetadata({
  repository,
  tableId,
  displayName,
  description,
  recommendedCapacity,
}: {
  repository: ClubTableRepository;
  tableId: number;
  displayName: string;
  description?: string | null;
  recommendedCapacity?: number | null;
}): Promise<ClubTableRecord> {
  const existing = await repository.findTableById(tableId);
  if (!existing) {
    throw new Error(`Club table ${tableId} not found`);
  }

  return repository.updateTable({
    tableId,
    displayName: normalizeDisplayName(displayName),
    description: normalizeDescription(description),
    recommendedCapacity: normalizeRecommendedCapacity(recommendedCapacity),
  });
}

export async function deactivateClubTable({
  repository,
  tableId,
}: {
  repository: ClubTableRepository;
  tableId: number;
}): Promise<ClubTableRecord> {
  const existing = await repository.findTableById(tableId);
  if (!existing) {
    throw new Error(`Club table ${tableId} not found`);
  }

  if (existing.lifecycleStatus === 'deactivated') {
    return existing;
  }

  return repository.deactivateTable({ tableId });
}

function normalizeDisplayName(displayName: string): string {
  const normalized = displayName.trim();
  if (!normalized) {
    throw new Error('El nom visible de la taula es obligatori');
  }

  return normalized;
}

function normalizeDescription(description: string | null | undefined): string | null {
  const normalized = description?.trim();
  return normalized ? normalized : null;
}

function normalizeRecommendedCapacity(recommendedCapacity: number | null | undefined): number | null {
  if (recommendedCapacity === undefined || recommendedCapacity === null) {
    return null;
  }

  if (!Number.isInteger(recommendedCapacity) || recommendedCapacity <= 0) {
    throw new Error('La capacitat recomanada ha de ser un enter positiu');
  }

  return recommendedCapacity;
}
