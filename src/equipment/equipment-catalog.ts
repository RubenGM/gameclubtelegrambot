export type ClubEquipmentLifecycleStatus = 'active' | 'deactivated';

export interface ClubEquipmentRecord {
  id: number;
  displayName: string;
  description: string | null;
  lifecycleStatus: ClubEquipmentLifecycleStatus;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
}

export interface ClubEquipmentRepository {
  createEquipment(input: {
    displayName: string;
    description: string | null;
  }): Promise<ClubEquipmentRecord>;
  findEquipmentById(equipmentId: number): Promise<ClubEquipmentRecord | null>;
  listEquipment(input: { includeDeactivated: boolean }): Promise<ClubEquipmentRecord[]>;
  updateEquipment(input: {
    equipmentId: number;
    displayName: string;
    description: string | null;
  }): Promise<ClubEquipmentRecord>;
  deactivateEquipment(input: { equipmentId: number }): Promise<ClubEquipmentRecord>;
}

export async function createClubEquipment({
  repository,
  displayName,
  description,
}: {
  repository: ClubEquipmentRepository;
  displayName: string;
  description?: string | null;
}): Promise<ClubEquipmentRecord> {
  return repository.createEquipment({
    displayName: normalizeDisplayName(displayName),
    description: normalizeDescription(description),
  });
}

export async function getClubEquipment({
  repository,
  equipmentId,
}: {
  repository: ClubEquipmentRepository;
  equipmentId: number;
}): Promise<ClubEquipmentRecord | null> {
  return repository.findEquipmentById(equipmentId);
}

export async function listClubEquipment({
  repository,
  includeDeactivated = false,
}: {
  repository: ClubEquipmentRepository;
  includeDeactivated?: boolean;
}): Promise<ClubEquipmentRecord[]> {
  return repository.listEquipment({ includeDeactivated });
}

export async function updateClubEquipmentMetadata({
  repository,
  equipmentId,
  displayName,
  description,
}: {
  repository: ClubEquipmentRepository;
  equipmentId: number;
  displayName: string;
  description?: string | null;
}): Promise<ClubEquipmentRecord> {
  const existing = await repository.findEquipmentById(equipmentId);
  if (!existing) {
    throw new Error(`Club equipment ${equipmentId} not found`);
  }

  return repository.updateEquipment({
    equipmentId,
    displayName: normalizeDisplayName(displayName),
    description: normalizeDescription(description),
  });
}

export async function deactivateClubEquipment({
  repository,
  equipmentId,
}: {
  repository: ClubEquipmentRepository;
  equipmentId: number;
}): Promise<ClubEquipmentRecord> {
  const existing = await repository.findEquipmentById(equipmentId);
  if (!existing) {
    throw new Error(`Club equipment ${equipmentId} not found`);
  }
  if (existing.lifecycleStatus === 'deactivated') {
    return existing;
  }
  return repository.deactivateEquipment({ equipmentId });
}

function normalizeDisplayName(displayName: string): string {
  const normalized = displayName.trim();
  if (!normalized) {
    throw new Error("El nom visible de l'equipament és obligatori");
  }
  return normalized;
}

function normalizeDescription(description: string | null | undefined): string | null {
  const normalized = description?.trim();
  return normalized ? normalized : null;
}
