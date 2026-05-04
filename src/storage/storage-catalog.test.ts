import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createStorageCategory,
  createStorageEntry,
  parseStorageCaptionMetadata,
  setStorageCategoryLifecycleStatus,
  type StorageCategoryRecord,
  type StorageCategoryRepository,
  type StorageEntryDetailRecord,
  type StorageEntryMessageRecord,
  type StorageEntryRecord,
} from './storage-catalog.js';

function createRepository(initialCategories: StorageCategoryRecord[] = []): StorageCategoryRepository {
  const categories = new Map<number, StorageCategoryRecord>(initialCategories.map((category) => [category.id, category]));
  const entries = new Map<number, StorageEntryDetailRecord>();
  let nextCategoryId = Math.max(0, ...initialCategories.map((category) => category.id)) + 1;
  let nextEntryId = 1;

  return {
    async createCategory(input) {
      const now = '2026-04-21T10:00:00.000Z';
      const category: StorageCategoryRecord = {
        id: nextCategoryId,
        slug: input.slug,
        displayName: input.displayName,
        description: input.description,
        storageChatId: input.storageChatId,
        storageThreadId: input.storageThreadId,
        lifecycleStatus: 'active',
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      };
      categories.set(nextCategoryId, category);
      nextCategoryId += 1;
      return category;
    },
    async updateCategoryLifecycleStatus(input) {
      const existing = categories.get(input.categoryId);
      if (!existing) {
        throw new Error(`Storage category ${input.categoryId} not found`);
      }
      const updated: StorageCategoryRecord = {
        ...existing,
        lifecycleStatus: input.lifecycleStatus,
        updatedAt: '2026-04-21T11:00:00.000Z',
        archivedAt: input.lifecycleStatus === 'archived' ? '2026-04-21T11:00:00.000Z' : null,
      };
      categories.set(updated.id, updated);
      return updated;
    },
    async findCategoryById(categoryId) {
      return categories.get(categoryId) ?? null;
    },
    async findCategoryByStorageThread(storageChatId, storageThreadId) {
      return Array.from(categories.values()).find(
        (category) => category.storageChatId === storageChatId && category.storageThreadId === storageThreadId,
      ) ?? null;
    },
    async listCategories() {
      return Array.from(categories.values());
    },
    async createEntry(input) {
      const now = '2026-04-21T12:00:00.000Z';
      const entry: StorageEntryRecord = {
        id: nextEntryId,
        categoryId: input.categoryId,
        createdByTelegramUserId: input.createdByTelegramUserId,
        sourceKind: input.sourceKind,
        description: input.description,
        tags: input.tags,
        lifecycleStatus: 'active',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        deletedByTelegramUserId: null,
      };
      const messages: StorageEntryMessageRecord[] = input.messages.map((message, index) => ({
        id: index + 1,
        entryId: nextEntryId,
        storageChatId: message.storageChatId,
        storageMessageId: message.storageMessageId,
        storageThreadId: message.storageThreadId,
        telegramFileId: message.telegramFileId ?? null,
        telegramFileUniqueId: message.telegramFileUniqueId ?? null,
        attachmentKind: message.attachmentKind,
        caption: message.caption ?? null,
        originalFileName: message.originalFileName ?? null,
        mimeType: message.mimeType ?? null,
        fileSizeBytes: message.fileSizeBytes ?? null,
        mediaGroupId: message.mediaGroupId ?? null,
        sortOrder: message.sortOrder,
        createdAt: now,
      }));
      const category = categories.get(input.categoryId);
      if (!category) {
        throw new Error(`Storage category ${input.categoryId} not found`);
      }
      entries.set(nextEntryId, { entry, category, messages });
      nextEntryId += 1;
      return { entry, category, messages };
    },
    async updateEntryLifecycleStatus(input) {
      const existing = entries.get(input.entryId);
      if (!existing) {
        throw new Error(`Storage entry ${input.entryId} not found`);
      }
      const updatedEntry: StorageEntryRecord = {
        ...existing.entry,
        lifecycleStatus: input.lifecycleStatus,
        updatedAt: '2026-04-21T13:00:00.000Z',
        deletedAt: input.lifecycleStatus === 'deleted' ? '2026-04-21T13:00:00.000Z' : null,
        deletedByTelegramUserId: input.deletedByTelegramUserId ?? null,
      };
      const detail = { ...existing, entry: updatedEntry };
      entries.set(input.entryId, detail);
      return updatedEntry;
    },
    async getEntryDetail(entryId) {
      return entries.get(entryId) ?? null;
    },
    async listEntryDetailsByCategory(categoryId) {
      return Array.from(entries.values()).filter(
        (entry) => entry.entry.categoryId === categoryId && entry.entry.lifecycleStatus === 'active',
      );
    },
    async searchEntryDetails({ categoryIds, query }) {
      const normalizedQuery = query.trim().toLowerCase();
      return Array.from(entries.values()).filter((entry) =>
        categoryIds.includes(entry.entry.categoryId) &&
        entry.entry.lifecycleStatus === 'active' &&
        (
          entry.entry.description?.toLowerCase().includes(normalizedQuery) ||
          entry.entry.tags.some((tag) => tag.includes(normalizedQuery)) ||
          entry.messages.some((message) => message.originalFileName?.toLowerCase().includes(normalizedQuery))
        ),
      );
    },
  };
}

function createCategory(overrides: Partial<StorageCategoryRecord> = {}): StorageCategoryRecord {
  return {
    id: 7,
    slug: 'manuales',
    displayName: 'Manuales',
    description: 'Documentacion del club',
    storageChatId: -100123,
    storageThreadId: 10,
    lifecycleStatus: 'active',
    createdAt: '2026-04-21T10:00:00.000Z',
    updatedAt: '2026-04-21T10:00:00.000Z',
    archivedAt: null,
    ...overrides,
  };
}

test('parseStorageCaptionMetadata extracts normalized tags and description', () => {
  assert.deepEqual(parseStorageCaptionMetadata('  Manual revisado #Rol #fantasy #pdf  '), {
    description: 'Manual revisado',
    tags: ['rol', 'fantasy', 'pdf'],
  });
});

test('createStorageCategory trims text fields and keeps topic mapping', async () => {
  const repository = createRepository();

  const category = await createStorageCategory({
    repository,
    slug: '  manuales  ',
    displayName: '  Manuales  ',
    description: '  Documentacion del club  ',
    storageChatId: -100123,
    storageThreadId: 10,
  });

  assert.equal(category.slug, 'manuales');
  assert.equal(category.displayName, 'Manuales');
  assert.equal(category.description, 'Documentacion del club');
  assert.equal(category.storageThreadId, 10);
});

test('createStorageEntry normalizes description and tags and requires at least one supported message', async () => {
  const repository = createRepository([createCategory()]);

  const detail = await createStorageEntry({
    repository,
    categoryId: 7,
    createdByTelegramUserId: 42,
    sourceKind: 'dm_copy',
    description: '  Manual de campana  ',
    tags: ['Pdf', 'rol', 'rol'],
    messages: [
      {
        storageChatId: -100123,
        storageMessageId: 900,
        storageThreadId: 10,
        telegramFileId: 'file-1',
        telegramFileUniqueId: 'unique-1',
        attachmentKind: 'document',
        caption: 'Manual de campana #rol #pdf',
        originalFileName: 'manual.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1024,
        mediaGroupId: null,
        sortOrder: 0,
      },
    ],
  });

  assert.equal(detail.entry.description, 'Manual de campana');
  assert.deepEqual(detail.entry.tags, ['pdf', 'rol']);
  assert.equal(detail.messages[0]?.attachmentKind, 'document');
});

test('createStorageEntry rejects archived categories', async () => {
  const repository = createRepository([createCategory({ lifecycleStatus: 'archived', archivedAt: '2026-04-21T11:00:00.000Z' })]);

  await assert.rejects(
    () =>
      createStorageEntry({
        repository,
        categoryId: 7,
        createdByTelegramUserId: 42,
        sourceKind: 'topic_direct',
        messages: [
          {
            storageChatId: -100123,
            storageMessageId: 900,
            storageThreadId: 10,
            telegramFileId: 'file-1',
            telegramFileUniqueId: 'unique-1',
            attachmentKind: 'document',
            caption: null,
            originalFileName: 'manual.pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 1024,
            mediaGroupId: null,
            sortOrder: 0,
          },
        ],
      }),
    /Storage category 7 is archived/,
  );
});

test('setStorageCategoryLifecycleStatus reactivates archived categories', async () => {
  const repository = createRepository([createCategory({ lifecycleStatus: 'archived', archivedAt: '2026-04-21T11:00:00.000Z' })]);

  const category = await setStorageCategoryLifecycleStatus({
    repository,
    categoryId: 7,
    nextStatus: 'active',
  });

  assert.equal(category.lifecycleStatus, 'active');
  assert.equal(category.archivedAt, null);
});
