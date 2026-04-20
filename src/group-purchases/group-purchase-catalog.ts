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
  participantDisplayName: string | null;
  participantUsername: string | null;
  status: GroupPurchaseParticipantStatus;
  joinedAt: string;
  updatedAt: string;
  removedAt: string | null;
  confirmedAt: string | null;
  paidAt: string | null;
  deliveredAt: string | null;
}

export interface GroupPurchaseParticipantFieldValueRecord {
  purchaseId: number;
  participantTelegramUserId: number;
  fieldId: number;
  value: unknown;
  updatedAt: string;
}

export interface GroupPurchaseMessageRecord {
  id: number;
  purchaseId: number;
  authorTelegramUserId: number;
  body: string;
  createdAt: string;
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
  updatePurchaseLifecycleStatus(input: {
    purchaseId: number;
    lifecycleStatus: GroupPurchaseLifecycleStatus;
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
  listParticipantFieldValues(
    purchaseId: number,
    participantTelegramUserId: number,
  ): Promise<GroupPurchaseParticipantFieldValueRecord[]>;
  replaceParticipantFieldValues(input: {
    purchaseId: number;
    participantTelegramUserId: number;
    values: Array<{ fieldId: number; value: unknown }>;
  }): Promise<GroupPurchaseParticipantFieldValueRecord[]>;
  createMessage(input: {
    purchaseId: number;
    authorTelegramUserId: number;
    body: string;
  }): Promise<GroupPurchaseMessageRecord>;
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
  const normalizedFields = normalizeFields(fields, { allowEmpty: normalizedMode === 'shared_cost' });
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

export async function setGroupPurchaseLifecycleStatus({
  repository,
  purchaseId,
  nextStatus,
}: {
  repository: GroupPurchaseRepository;
  purchaseId: number;
  nextStatus: GroupPurchaseLifecycleStatus;
}): Promise<GroupPurchaseRecord> {
  const purchase = await loadPurchaseOrThrow(repository, purchaseId);
  if (purchase.lifecycleStatus === nextStatus) {
    return purchase;
  }
  if ((purchase.lifecycleStatus === 'archived' || purchase.lifecycleStatus === 'cancelled') && nextStatus === 'open') {
    throw new Error(`Group purchase ${purchaseId} cannot be reopened from ${purchase.lifecycleStatus}`);
  }

  return repository.updatePurchaseLifecycleStatus({
    purchaseId,
    lifecycleStatus: nextStatus,
  });
}

export async function updateGroupPurchaseParticipantFieldValues({
  repository,
  purchaseId,
  participantTelegramUserId,
  valuesByFieldKey,
}: {
  repository: GroupPurchaseRepository;
  purchaseId: number;
  participantTelegramUserId: number;
  valuesByFieldKey: Record<string, unknown>;
}): Promise<GroupPurchaseParticipantFieldValueRecord[]> {
  const detail = await repository.getPurchaseDetail(purchaseId);
  if (!detail) {
    throw new Error(`Group purchase ${purchaseId} not found`);
  }

  const participant = await repository.findParticipant(purchaseId, participantTelegramUserId);
  if (!participant || participant.status === 'removed') {
    throw new Error(`Group purchase participant ${participantTelegramUserId} for purchase ${purchaseId} not found`);
  }

  const normalizedValues = detail.fields.map((field) => {
    const rawValue = valuesByFieldKey[field.fieldKey];
    if ((rawValue === undefined || rawValue === null || rawValue === '') && field.isRequired) {
      throw new Error(`Field ${field.fieldKey} is required`);
    }

    return {
      fieldId: field.id,
      value: normalizeParticipantFieldValue(field, rawValue),
    };
  });

  return repository.replaceParticipantFieldValues({
    purchaseId,
    participantTelegramUserId,
    values: normalizedValues,
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

function normalizeFields(fields: GroupPurchaseFieldInput[], { allowEmpty = false }: { allowEmpty?: boolean } = {}): GroupPurchaseFieldInput[] {
  if (fields.length === 0 && !allowEmpty) {
    throw new Error('Group purchases require at least one configurable field');
  }

  if (fields.length === 0) {
    return [];
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

function normalizeParticipantFieldValue(field: GroupPurchaseFieldRecord, rawValue: unknown): unknown {
  if (field.fieldType === 'integer') {
    if (typeof rawValue !== 'string' && typeof rawValue !== 'number') {
      throw new Error(`Field ${field.fieldKey} expects an integer value`);
    }
    const parsed = typeof rawValue === 'number' ? rawValue : Number(String(rawValue).trim());
    if (!Number.isInteger(parsed)) {
      throw new Error(`Field ${field.fieldKey} expects an integer value`);
    }
    const min = typeof field.config?.min === 'number' ? field.config.min : undefined;
    const max = typeof field.config?.max === 'number' ? field.config.max : undefined;
    if (min !== undefined && parsed < min) {
      throw new Error(`Field ${field.fieldKey} must be at least ${min}`);
    }
    if (max !== undefined && parsed > max) {
      throw new Error(`Field ${field.fieldKey} must be at most ${max}`);
    }
    return parsed;
  }

  if (field.fieldType === 'single_choice') {
    const normalized = String(rawValue ?? '').trim();
    const options = Array.isArray(field.config?.options) ? field.config.options : [];
    const match = options.find((option) => {
      if (!option || typeof option !== 'object') {
        return false;
      }
      const value = 'value' in option ? String(option.value) : '';
      const label = 'label' in option ? String(option.label) : '';
      return normalized === value || normalized === label;
    });
    if (!match || typeof match !== 'object' || !('value' in match)) {
      throw new Error(`Field ${field.fieldKey} expects one of the configured options`);
    }
    return match.value;
  }

  const normalized = String(rawValue ?? '').trim();
  if (field.isRequired && normalized.length === 0) {
    throw new Error(`Field ${field.fieldKey} is required`);
  }
  const maxLength = typeof field.config?.maxLength === 'number' ? field.config.maxLength : undefined;
  if (maxLength !== undefined && normalized.length > maxLength) {
    throw new Error(`Field ${field.fieldKey} must not exceed ${maxLength} characters`);
  }
  return normalized;
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
