export interface AuditLogEventRecord {
  actorTelegramUserId: number | null;
  actionKey: string;
  targetType: string;
  targetId: string;
  summary: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditLogAppendInput {
  actorTelegramUserId: number | null;
  actionKey: string;
  targetType: string;
  targetId: string;
  summary: string;
  details?: Record<string, unknown> | null;
}

export interface AuditLogRepository {
  appendEvent(input: AuditLogAppendInput): Promise<void>;
}

export async function appendAuditEvent({
  repository,
  actorTelegramUserId,
  actionKey,
  targetType,
  targetId,
  summary,
  details,
}: {
  repository: AuditLogRepository;
  actorTelegramUserId: number | null;
  actionKey: string;
  targetType: string;
  targetId: string | number;
  summary: string;
  details?: Record<string, unknown> | null;
}): Promise<void> {
  await repository.appendEvent({
    actorTelegramUserId: normalizeActorId(actorTelegramUserId),
    actionKey: normalizeRequiredText(actionKey, 'actionKey'),
    targetType: normalizeRequiredText(targetType, 'targetType'),
    targetId: normalizeRequiredText(String(targetId), 'targetId'),
    summary: normalizeRequiredText(summary, 'summary'),
    details: normalizeDetails(details),
  });
}

function normalizeActorId(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('actorTelegramUserId ha de ser un enter positiu o null');
  }
  return value;
}

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${fieldName} es obligatori`);
  }
  return normalized;
}

function normalizeDetails(details: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (details === undefined || details === null) {
    return null;
  }
  return details;
}
