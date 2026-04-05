export interface NewsGroupRecord {
  chatId: number;
  isEnabled: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  enabledAt: string | null;
  disabledAt: string | null;
}

export interface NewsGroupSubscriptionRecord {
  chatId: number;
  categoryKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewsGroupRepository {
  findGroupByChatId(chatId: number): Promise<NewsGroupRecord | null>;
  listGroups(input?: { includeDisabled?: boolean }): Promise<NewsGroupRecord[]>;
  upsertGroup(input: {
    chatId: number;
    isEnabled: boolean;
    metadata?: Record<string, unknown> | null;
  }): Promise<NewsGroupRecord>;
  listSubscriptionsByChatId(chatId: number): Promise<NewsGroupSubscriptionRecord[]>;
  upsertSubscription(input: { chatId: number; categoryKey: string }): Promise<NewsGroupSubscriptionRecord>;
  deleteSubscription(input: { chatId: number; categoryKey: string }): Promise<boolean>;
  listSubscribedGroupsByCategory(categoryKey: string): Promise<NewsGroupRecord[]>;
  isNewsEnabledGroup(chatId: number): Promise<boolean>;
}

export async function upsertNewsGroup({
  repository,
  chatId,
  isEnabled,
  metadata,
}: {
  repository: NewsGroupRepository;
  chatId: number;
  isEnabled: boolean;
  metadata?: Record<string, unknown> | null;
}): Promise<NewsGroupRecord> {
  return repository.upsertGroup({
    chatId: normalizeChatId(chatId),
    isEnabled,
    ...(metadata !== undefined ? { metadata: normalizeMetadata(metadata) } : {}),
  });
}

export async function subscribeNewsGroup({
  repository,
  chatId,
  categoryKey,
}: {
  repository: NewsGroupRepository;
  chatId: number;
  categoryKey: string;
}): Promise<NewsGroupSubscriptionRecord> {
  return repository.upsertSubscription({
    chatId: normalizeChatId(chatId),
    categoryKey: normalizeCategoryKey(categoryKey),
  });
}

export async function unsubscribeNewsGroup({
  repository,
  chatId,
  categoryKey,
}: {
  repository: NewsGroupRepository;
  chatId: number;
  categoryKey: string;
}): Promise<boolean> {
  return repository.deleteSubscription({
    chatId: normalizeChatId(chatId),
    categoryKey: normalizeCategoryKey(categoryKey),
  });
}

export async function listNewsGroupsByCategory({
  repository,
  categoryKey,
}: {
  repository: NewsGroupRepository;
  categoryKey: string;
}): Promise<NewsGroupRecord[]> {
  return repository.listSubscribedGroupsByCategory(normalizeCategoryKey(categoryKey));
}

function normalizeChatId(chatId: number): number {
  if (!Number.isInteger(chatId) || chatId === 0) {
    throw new Error('El chat id del grup ha de ser un enter valid');
  }

  return chatId;
}

function normalizeCategoryKey(categoryKey: string): string {
  const normalized = categoryKey.trim();
  if (!normalized) {
    throw new Error('La clau de categoria es obligatoria');
  }

  return normalized;
}

function normalizeMetadata(metadata: Record<string, unknown> | null): Record<string, unknown> | null {
  return metadata;
}
