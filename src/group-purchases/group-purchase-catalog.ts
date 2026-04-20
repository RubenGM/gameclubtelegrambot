export type GroupPurchaseMode = 'shared_cost' | 'per_item';
export type GroupPurchaseLifecycleStatus = 'open' | 'closed' | 'archived' | 'cancelled';
export type GroupPurchaseFieldType = 'integer' | 'single_choice' | 'text';
export type GroupPurchaseParticipantStatus = 'interested' | 'confirmed' | 'paid' | 'delivered' | 'removed';

export interface GroupPurchaseRecord {
  id: number;
  title: string;
  description: string | null;
  purchaseMode: GroupPurchaseMode;
  lifecycleStatus: GroupPurchaseLifecycleStatus;
  createdByTelegramUserId: number;
  joinDeadlineAt: string | null;
  confirmDeadlineAt: string | null;
  totalPriceCents: number | null;
  unitPriceCents: number | null;
  unitLabel: string | null;
  allocationFieldKey: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
}

export interface GroupPurchaseFieldRecord {
  id: number;
  purchaseId: number;
  fieldKey: string;
  label: string;
  fieldType: GroupPurchaseFieldType;
  isRequired: boolean;
  sortOrder: number;
  config: Record<string, unknown> | null;
  affectsQuantity: boolean;
}

export interface GroupPurchaseParticipantRecord {
  purchaseId: number;
  participantTelegramUserId: number;
  status: GroupPurchaseParticipantStatus;
  joinedAt: string;
  updatedAt: string;
  removedAt: string | null;
  confirmedAt: string | null;
  paidAt: string | null;
  deliveredAt: string | null;
}

export interface GroupPurchaseDetailRecord {
  purchase: GroupPurchaseRecord;
  fields: GroupPurchaseFieldRecord[];
  participants: GroupPurchaseParticipantRecord[];
}

export interface GroupPurchaseFieldInput {
  fieldKey: string;
  label: string;
  fieldType: GroupPurchaseFieldType;
  isRequired: boolean;
  sortOrder: number;
  config?: Record<string, unknown> | null;
  affectsQuantity: boolean;
}

export interface GroupPurchaseRepository {
  createPurchase(input: {
    title: string;
    description: string | null;
    purchaseMode: GroupPurchaseMode;
    createdByTelegramUserId: number;
    joinDeadlineAt: string | null;
    confirmDeadlineAt: string | null;
    totalPriceCents: number | null;
    unitPriceCents: number | null;
    unitLabel: string | null;
    allocationFieldKey: string | null;
    fields: GroupPurchaseFieldInput[];
  }): Promise<GroupPurchaseDetailRecord>;
  updatePurchase(input: {
    purchaseId: number;
    title: string;
    description: string | null;
    joinDeadlineAt: string | null;
    confirmDeadlineAt: string | null;
    totalPriceCents: number | null;
    unitPriceCents: number | null;
    unitLabel: string | null;
    allocationFieldKey: string | null;
  }): Promise<GroupPurchaseRecord>;
  findPurchaseById(purchaseId: number): Promise<GroupPurchaseRecord | null>;
  listPurchases(): Promise<GroupPurchaseRecord[]>;
  getPurchaseDetail(purchaseId: number): Promise<GroupPurchaseDetailRecord | null>;
  findParticipant(purchaseId: number, participantTelegramUserId: number): Promise<GroupPurchaseParticipantRecord | null>;
  listParticipants(purchaseId: number): Promise<GroupPurchaseParticipantRecord[]>;
  upsertParticipant(input: {
    purchaseId: number;
    participantTelegramUserId: number;
    status: GroupPurchaseParticipantStatus;
  }): Promise<GroupPurchaseParticipantRecord>;
}

export async function createGroupPurchase({
  repository,
  title,
  description,
  purchaseMode,
  createdByTelegramUserId,
  joinDeadlineAt,
  confirmDeadlineAt,
  totalPriceCents,
  unitPriceCents,
  unitLabel,
  fields,
}: {
  repository: GroupPurchaseRepository;
  title: string;
  description?: string | null;
  purchaseMode: GroupPurchaseMode;
  createdByTelegramUserId: number;
  joinDeadlineAt?: string | null;
  confirmDeadlineAt?: string | null;
  totalPriceCents?: number | null;
  unitPriceCents?: number | null;
  unitLabel?: string | null;
  fields: GroupPurchaseFieldInput[];
}): Promise<GroupPurchaseDetailRecord> {
  const normalizedMode = normalizePurchaseMode(purchaseMode);
  const normalizedFields = normalizeFields(fields);
  const quantityField = resolveQuantityField(normalizedFields);

  if (normalizedMode === 'per_item' && (!quantityField || quantityField.fieldType !== 'integer')) {
    throw new Error('Per-item purchases require exactly one integer quantity field');
  }

  if (normalizedMode === 'shared_cost' && quantityField && quantityField.fieldType !== 'integer') {
    throw new Error('Shared-cost allocation field must be an integer field');
  }

  const normalizedJoinDeadline = normalizeOptionalIsoDate(joinDeadlineAt);
  const normalizedConfirmDeadline = normalizeOptionalIsoDate(confirmDeadlineAt);
  if (
    normalizedJoinDeadline !== null &&
    normalizedConfirmDeadline !== null &&
    normalizedConfirmDeadline < normalizedJoinDeadline
  ) {
    throw new Error('Confirmation deadline cannot be earlier than join deadline');
  }

  return repository.createPurchase({
    title: normalizeTitle(title),
    description: normalizeOptionalText(description),
    purchaseMode: normalizedMode,
    createdByTelegramUserId: normalizeTelegramUserId(createdByTelegramUserId, 'creator'),
    joinDeadlineAt: normalizedJoinDeadline,
    confirmDeadlineAt: normalizedConfirmDeadline,
    totalPriceCents: normalizeOptionalMoney(totalPriceCents),
    unitPriceCents: normalizeOptionalMoney(unitPriceCents),
    unitLabel: normalizeOptionalLabel(unitLabel),
    allocationFieldKey: quantityField?.fieldKey ?? null,
    fields: normalizedFields,
  });
}

export async function joinGroupPurchase({
  repository,
  purchaseId,
  participantTelegramUserId,
  now = () => new Date(),
}: {
  repository: GroupPurchaseRepository;
  purchaseId: number;
  participantTelegramUserId: number;
  now?: () => Date;
}): Promise<GroupPurchaseParticipantRecord> {
  const purchase = await loadPurchaseOrThrow(repository, purchaseId);
  ensureJoinAllowed(purchase, now().toISOString());

  return repository.upsertParticipant({
    purchaseId,
    participantTelegramUserId: normalizeTelegramUserId(participantTelegramUserId, 'participant'),
    status: 'interested',
  });
}

export async function changeGroupPurchaseParticipantStatus({
  repository,
  purchaseId,
  participantTelegramUserId,
  actorRole,
  nextStatus,
  now = () => new Date(),
}: {
  repository: GroupPurchaseRepository;
  purchaseId: number;
  participantTelegramUserId: number;
  actorRole: 'self' | 'manager';
  nextStatus: GroupPurchaseParticipantStatus;
  now?: () => Date;
}): Promise<GroupPurchaseParticipantRecord> {
  const purchase = await loadPurchaseOrThrow(repository, purchaseId);
  const participant = await repository.findParticipant(purchaseId, participantTelegramUserId);
  if (!participant) {
    throw new Error(`Group purchase participant ${participantTelegramUserId} for purchase ${purchaseId} not found`);
  }

  if (purchase.lifecycleStatus === 'archived' || purchase.lifecycleStatus === 'cancelled') {
    throw new Error(`Group purchase ${purchaseId} does not allow participant changes`);
  }

  if (actorRole === 'self') {
    if (nextStatus === 'confirmed') {
      if (purchase.lifecycleStatus !== 'open') {
        throw new Error(`Group purchase ${purchaseId} is closed for self confirmation`);
      }
      if (purchase.confirmDeadlineAt !== null && purchase.confirmDeadlineAt < now().toISOString()) {
        throw new Error(`Group purchase ${purchaseId} can no longer be confirmed by participants`);
      }
      if (participant.status !== 'interested') {
        throw new Error(`Participant ${participantTelegramUserId} must be interested before confirming`);
      }
    } else if (nextStatus !== 'removed') {
      throw new Error(`Only managers can set status ${nextStatus}`);
    }
  }

  return repository.upsertParticipant({
    purchaseId,
    participantTelegramUserId: normalizeTelegramUserId(participantTelegramUserId, 'participant'),
    status: nextStatus,
  });
}

function normalizeTitle(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error('Group purchase title is required');
  }

  return normalized;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalLabel(value: string | null | undefined): string | null {
  return normalizeOptionalText(value);
}

function normalizePurchaseMode(value: GroupPurchaseMode): GroupPurchaseMode {
  if (value !== 'shared_cost' && value !== 'per_item') {
    throw new Error(`Unsupported purchase mode ${value}`);
  }

  return value;
}

function normalizeTelegramUserId(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Group purchase ${label} Telegram user id must be a positive integer`);
  }

  return value;
}

function normalizeOptionalIsoDate(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ISO date ${value}`);
  }

  return parsed.toISOString();
}

function normalizeOptionalMoney(value: number | null | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new Error('Money values must be a non-negative integer amount in cents');
  }

  return value;
}

function normalizeFields(fields: GroupPurchaseFieldInput[]): GroupPurchaseFieldInput[] {
  if (fields.length === 0) {
    throw new Error('Group purchases require at least one configurable field');
  }

  const normalized = fields.map((field) => {
    const fieldType = normalizeFieldType(field.fieldType);
    const config = normalizeFieldConfig(fieldType, field.config ?? null);

    return {
      fieldKey: normalizeFieldKey(field.fieldKey),
      label: normalizeTitle(field.label),
      fieldType,
      isRequired: field.isRequired,
      sortOrder: normalizeSortOrder(field.sortOrder),
      config,
      affectsQuantity: field.affectsQuantity,
    } satisfies GroupPurchaseFieldInput;
  });

  const affectingFields = normalized.filter((field) => field.affectsQuantity);
  if (affectingFields.length > 1) {
    throw new Error('Only one field can affect quantity or allocation');
  }

  return normalized;
}

function normalizeFieldKey(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error('Field key is required');
  }

  return normalized;
}

function normalizeFieldType(value: GroupPurchaseFieldType): GroupPurchaseFieldType {
  if (value !== 'integer' && value !== 'single_choice' && value !== 'text') {
    throw new Error(`Unsupported field type ${value}`);
  }

  return value;
}

function normalizeSortOrder(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('Field sort order must be a non-negative integer');
  }

  return value;
}

function normalizeFieldConfig(
  fieldType: GroupPurchaseFieldType,
  config: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (fieldType === 'single_choice') {
    const options = config?.options;
    if (!Array.isArray(options) || options.length === 0) {
      throw new Error('Single-choice fields require at least one option');
    }
  }

  return config;
}

function resolveQuantityField(fields: GroupPurchaseFieldInput[]): GroupPurchaseFieldInput | null {
  return fields.find((field) => field.affectsQuantity) ?? null;
}

async function loadPurchaseOrThrow(
  repository: GroupPurchaseRepository,
  purchaseId: number,
): Promise<GroupPurchaseRecord> {
  const purchase = await repository.findPurchaseById(purchaseId);
  if (!purchase) {
    throw new Error(`Group purchase ${purchaseId} not found`);
  }

  return purchase;
}

function ensureJoinAllowed(purchase: GroupPurchaseRecord, nowIso: string): void {
  if (purchase.lifecycleStatus !== 'open') {
    throw new Error(`Group purchase ${purchase.id} is no longer accepting new participants`);
  }

  if (purchase.joinDeadlineAt !== null && purchase.joinDeadlineAt < nowIso) {
    throw new Error(`Group purchase ${purchase.id} is no longer accepting new participants`);
  }
}
