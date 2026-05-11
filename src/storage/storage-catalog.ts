export type StorageCategoryLifecycleStatus = 'active' | 'archived';
export type StorageCategoryPurpose = 'user_uploads' | 'catalog_media';
export type StorageEntrySourceKind = 'topic_direct' | 'dm_copy';
export type StorageEntryLifecycleStatus = 'active' | 'hidden' | 'deleted' | 'missing_source';
export type StorageAttachmentKind = 'document' | 'photo' | 'video' | 'audio';

export interface StorageCategoryRecord {
  id: number;
  slug: string;
  displayName: string;
  parentCategoryId: number | null;
  description: string | null;
  storageChatId: number;
  storageThreadId: number;
  categoryPurpose: StorageCategoryPurpose;
  lifecycleStatus: StorageCategoryLifecycleStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface StorageEntryRecord {
  id: number;
  categoryId: number;
  createdByTelegramUserId: number;
  sourceKind: StorageEntrySourceKind;
  description: string | null;
  tags: string[];
  lifecycleStatus: StorageEntryLifecycleStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deletedByTelegramUserId: number | null;
}

export interface StorageEntryMessageRecord {
  id: number;
  entryId: number;
  storageChatId: number;
  storageMessageId: number;
  storageThreadId: number;
  telegramFileId: string | null;
  telegramFileUniqueId: string | null;
  attachmentKind: StorageAttachmentKind;
  caption: string | null;
  originalFileName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  mediaGroupId: string | null;
  sortOrder: number;
  createdAt: string;
}

export interface StorageEntryUploaderRecord {
  telegramUserId: number;
  username: string | null;
  displayName: string;
}

export interface StorageEntryMessageInput {
  storageChatId: number;
  storageMessageId: number;
  storageThreadId: number;
  telegramFileId?: string | null;
  telegramFileUniqueId?: string | null;
  attachmentKind: StorageAttachmentKind;
  caption?: string | null;
  originalFileName?: string | null;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
  mediaGroupId?: string | null;
  sortOrder: number;
}

export interface StorageEntryDetailRecord {
  entry: StorageEntryRecord;
  category: StorageCategoryRecord;
  messages: StorageEntryMessageRecord[];
  uploader?: StorageEntryUploaderRecord | null;
}

export interface StorageCategoryRepository {
  createCategory(input: {
    slug: string;
    displayName: string;
    parentCategoryId: number | null;
    description: string | null;
    storageChatId: number;
    storageThreadId: number;
    categoryPurpose?: StorageCategoryPurpose;
  }): Promise<StorageCategoryRecord>;
  updateCategoryLifecycleStatus(input: {
    categoryId: number;
    lifecycleStatus: StorageCategoryLifecycleStatus;
  }): Promise<StorageCategoryRecord>;
  updateCategoryMetadata(input: {
    categoryId: number;
    displayName: string;
  }): Promise<StorageCategoryRecord>;
  updateCategoryParent(input: {
    categoryId: number;
    parentCategoryId: number | null;
  }): Promise<StorageCategoryRecord>;
  findCategoryById(categoryId: number): Promise<StorageCategoryRecord | null>;
  findCategoryByStorageThread(storageChatId: number, storageThreadId: number): Promise<StorageCategoryRecord | null>;
  listCategories(): Promise<StorageCategoryRecord[]>;
  createEntry(input: {
    categoryId: number;
    createdByTelegramUserId: number;
    sourceKind: StorageEntrySourceKind;
    description: string | null;
    tags: string[];
    messages: StorageEntryMessageInput[];
  }): Promise<StorageEntryDetailRecord>;
  appendEntryMessages(input: {
    entryId: number;
    messages: StorageEntryMessageInput[];
  }): Promise<StorageEntryDetailRecord>;
  updateEntryMetadata(input: {
    entryId: number;
    description: string | null;
    tags: string[];
  }): Promise<StorageEntryDetailRecord>;
  updateEntryCategory(input: {
    entryId: number;
    categoryId: number;
  }): Promise<StorageEntryDetailRecord>;
  updateEntryLifecycleStatus(input: {
    entryId: number;
    lifecycleStatus: StorageEntryLifecycleStatus;
    deletedByTelegramUserId?: number | null;
  }): Promise<StorageEntryRecord>;
  getEntryDetail(entryId: number): Promise<StorageEntryDetailRecord | null>;
  listEntryDetailsByCategory(categoryId: number): Promise<StorageEntryDetailRecord[]>;
  searchEntryDetails(input: {
    categoryIds: number[];
    query: string;
  }): Promise<StorageEntryDetailRecord[]>;
}

const supportedAttachmentKinds = new Set<StorageAttachmentKind>(['document', 'photo', 'video', 'audio']);

export function parseStorageCaptionMetadata(caption: string | null | undefined): {
  description: string | null;
  tags: string[];
} {
  const normalizedCaption = normalizeOptionalText(caption);
  if (normalizedCaption === null) {
    return { description: null, tags: [] };
  }

  const tags = Array.from(
    new Set(
      Array.from(normalizedCaption.matchAll(/(^|\s)#([A-Za-z0-9_-]+)/g)).map((match) => match[2]?.toLowerCase()).filter(Boolean),
    ),
  ) as string[];
  const description = normalizeOptionalText(normalizedCaption.replace(/(^|\s)#[A-Za-z0-9_-]+/g, ' '));

  return {
    description,
    tags,
  };
}

export async function createStorageCategory({
  repository,
  slug,
  displayName,
  description,
  parentCategoryId,
  storageChatId,
  storageThreadId,
  categoryPurpose = 'user_uploads',
}: {
  repository: StorageCategoryRepository;
  slug: string;
  displayName: string;
  parentCategoryId?: number | null;
  description?: string | null;
  storageChatId: number;
  storageThreadId: number;
  categoryPurpose?: StorageCategoryPurpose;
}): Promise<StorageCategoryRecord> {
  return repository.createCategory({
    slug: normalizeSlug(slug),
    displayName: normalizeRequiredText(displayName, 'display name'),
    parentCategoryId: normalizeOptionalPositiveInteger(parentCategoryId),
    description: normalizeOptionalText(description),
    storageChatId: normalizeTelegramId(storageChatId, 'storage chat'),
    storageThreadId: normalizePositiveInteger(storageThreadId, 'storage thread'),
    categoryPurpose: normalizeCategoryPurpose(categoryPurpose),
  });
}

export async function setStorageCategoryLifecycleStatus({
  repository,
  categoryId,
  nextStatus,
}: {
  repository: StorageCategoryRepository;
  categoryId: number;
  nextStatus: StorageCategoryLifecycleStatus;
}): Promise<StorageCategoryRecord> {
  await loadCategoryOrThrow(repository, categoryId);
  return repository.updateCategoryLifecycleStatus({
    categoryId: normalizePositiveInteger(categoryId, 'category'),
    lifecycleStatus: nextStatus,
  });
}

export async function moveStorageCategoryParent({
  repository,
  categoryId,
  parentCategoryId,
}: {
  repository: StorageCategoryRepository;
  categoryId: number;
  parentCategoryId: number | null;
}): Promise<StorageCategoryRecord> {
  const category = await loadCategoryOrThrow(repository, categoryId);
  if (category.lifecycleStatus !== 'active') {
    throw new Error(`Storage category ${categoryId} is archived`);
  }

  const normalizedParentCategoryId = normalizeOptionalPositiveInteger(parentCategoryId);
  if (normalizedParentCategoryId === category.id) {
    throw new Error('A storage category cannot be its own parent');
  }

  const categories = await repository.listCategories();
  if (normalizedParentCategoryId !== null) {
    const parent = categories.find((candidate) => candidate.id === normalizedParentCategoryId);
    if (!parent) {
      throw new Error(`Storage category ${normalizedParentCategoryId} not found`);
    }
    if (parent.lifecycleStatus !== 'active') {
      throw new Error(`Storage category ${normalizedParentCategoryId} is archived`);
    }
    if (collectStorageCategoryDescendantIds(category.id, categories).includes(parent.id)) {
      throw new Error('A storage category cannot be moved inside one of its descendants');
    }
  }

  return repository.updateCategoryParent({
    categoryId: category.id,
    parentCategoryId: normalizedParentCategoryId,
  });
}

export async function createStorageEntry({
  repository,
  categoryId,
  createdByTelegramUserId,
  sourceKind,
  description,
  tags,
  messages,
}: {
  repository: StorageCategoryRepository;
  categoryId: number;
  createdByTelegramUserId: number;
  sourceKind: StorageEntrySourceKind;
  description?: string | null;
  tags?: string[];
  messages: StorageEntryMessageInput[];
}): Promise<StorageEntryDetailRecord> {
  const category = await loadCategoryOrThrow(repository, categoryId);
  if (category.lifecycleStatus !== 'active') {
    throw new Error(`Storage category ${categoryId} is archived`);
  }

  const normalizedMessages = normalizeMessages(messages);
  if (normalizedMessages.length === 0) {
    throw new Error('Storage entries require at least one supported message');
  }

  return repository.createEntry({
    categoryId: normalizePositiveInteger(categoryId, 'category'),
    createdByTelegramUserId: normalizePositiveInteger(createdByTelegramUserId, 'creator'),
    sourceKind,
    description: normalizeOptionalText(description),
    tags: normalizeTags(tags ?? []),
    messages: normalizedMessages,
  });
}

export async function updateStorageEntryMetadata({
  repository,
  entryId,
  description,
  tags,
}: {
  repository: StorageCategoryRepository;
  entryId: number;
  description?: string | null;
  tags?: string[];
}): Promise<StorageEntryDetailRecord> {
  const detail = await repository.getEntryDetail(normalizePositiveInteger(entryId, 'entry'));
  if (!detail) {
    throw new Error(`Storage entry ${entryId} not found`);
  }
  if (detail.entry.lifecycleStatus !== 'active') {
    throw new Error(`Storage entry ${entryId} is not active`);
  }

  return repository.updateEntryMetadata({
    entryId: detail.entry.id,
    description: normalizeOptionalText(description),
    tags: normalizeTags(tags ?? []),
  });
}

export async function moveStorageEntryCategory({
  repository,
  entryId,
  categoryId,
}: {
  repository: StorageCategoryRepository;
  entryId: number;
  categoryId: number;
}): Promise<StorageEntryDetailRecord> {
  const detail = await repository.getEntryDetail(normalizePositiveInteger(entryId, 'entry'));
  if (!detail) {
    throw new Error(`Storage entry ${entryId} not found`);
  }
  if (detail.entry.lifecycleStatus !== 'active') {
    throw new Error(`Storage entry ${entryId} is not active`);
  }

  const category = await loadCategoryOrThrow(repository, categoryId);
  if (category.lifecycleStatus !== 'active') {
    throw new Error(`Storage category ${categoryId} is archived`);
  }

  return repository.updateEntryCategory({
    entryId: detail.entry.id,
    categoryId: category.id,
  });
}

async function loadCategoryOrThrow(repository: StorageCategoryRepository, categoryId: number): Promise<StorageCategoryRecord> {
  const category = await repository.findCategoryById(normalizePositiveInteger(categoryId, 'category'));
  if (!category) {
    throw new Error(`Storage category ${categoryId} not found`);
  }
  return category;
}

function normalizeMessages(messages: StorageEntryMessageInput[]): StorageEntryMessageInput[] {
  return messages.map((message) => {
    if (!supportedAttachmentKinds.has(message.attachmentKind)) {
      throw new Error(`Unsupported storage attachment kind: ${message.attachmentKind}`);
    }

    return {
      storageChatId: normalizeTelegramId(message.storageChatId, 'message storage chat'),
      storageMessageId: normalizePositiveInteger(message.storageMessageId, 'message id'),
      storageThreadId: normalizePositiveInteger(message.storageThreadId, 'message thread'),
      telegramFileId: normalizeOptionalText(message.telegramFileId),
      telegramFileUniqueId: normalizeOptionalText(message.telegramFileUniqueId),
      attachmentKind: message.attachmentKind,
      caption: normalizeOptionalText(message.caption),
      originalFileName: normalizeOptionalText(message.originalFileName),
      mimeType: normalizeOptionalText(message.mimeType),
      fileSizeBytes: normalizeOptionalNonNegativeInteger(message.fileSizeBytes),
      mediaGroupId: normalizeOptionalText(message.mediaGroupId),
      sortOrder: normalizeNonNegativeInteger(message.sortOrder, 'message sort order'),
    } satisfies StorageEntryMessageInput;
  });
}

function normalizeSlug(value: string): string {
  const normalized = normalizeRequiredText(value, 'slug').toLowerCase().replace(/\s+/g, '-');
  if (!/^[a-z0-9_-]+$/.test(normalized)) {
    throw new Error('Storage category slug must contain only lowercase letters, numbers, underscores or hyphens');
  }
  return normalized;
}

function normalizeTags(tags: string[]): string[] {
  return Array.from(
    new Set(
      tags
        .map((tag) => normalizeOptionalText(tag)?.toLowerCase())
        .filter((tag): tag is string => Boolean(tag))
        .map((tag) => tag.replace(/^#+/, ''))
        .filter((tag) => tag.length > 0),
    ),
  );
}

function collectStorageCategoryDescendantIds(categoryId: number, categories: StorageCategoryRecord[]): number[] {
  const childrenByParent = new Map<number | null, StorageCategoryRecord[]>();
  for (const category of categories) {
    const siblings = childrenByParent.get(category.parentCategoryId) ?? [];
    siblings.push(category);
    childrenByParent.set(category.parentCategoryId, siblings);
  }

  const ids = new Set<number>();
  const stack = [...(childrenByParent.get(categoryId) ?? []).map((category) => category.id)];
  while (stack.length > 0) {
    const currentId = stack.pop();
    if (currentId === undefined || ids.has(currentId)) {
      continue;
    }
    ids.add(currentId);
    for (const child of childrenByParent.get(currentId) ?? []) {
      stack.push(child.id);
    }
  }
  return [...ids];
}

function normalizeRequiredText(value: string, label: string): string {
  const normalized = normalizeOptionalText(value);
  if (normalized === null) {
    throw new Error(`Storage ${label} is required`);
  }
  return normalized;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length === 0 ? null : normalized;
}

function normalizePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Storage ${label} must be a positive integer`);
  }
  return value;
}

function normalizeNonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Storage ${label} must be a non-negative integer`);
  }
  return value;
}

function normalizeOptionalNonNegativeInteger(value: number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return normalizeNonNegativeInteger(value, 'file size');
}

function normalizeOptionalPositiveInteger(value: number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return normalizePositiveInteger(value, 'optional positive integer');
}

function normalizeTelegramId(value: number, label: string): number {
  if (!Number.isInteger(value) || value === 0) {
    throw new Error(`Storage ${label} id must be a non-zero integer`);
  }
  return value;
}

function normalizeCategoryPurpose(value: StorageCategoryPurpose): StorageCategoryPurpose {
  if (value === 'user_uploads' || value === 'catalog_media') {
    return value;
  }
  throw new Error('Storage category purpose is invalid');
}
