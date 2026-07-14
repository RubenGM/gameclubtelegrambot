import test from 'node:test';
import assert from 'node:assert/strict';

import {
  storageCategories,
  storageEntries,
  storageEntryMessages,
  users,
} from '../infrastructure/database/schema.js';
import { createDatabaseStorageRepository } from './storage-catalog-store.js';

const storageCategoriesTable = storageCategories as unknown;
const storageEntriesTable = storageEntries as unknown;
const storageEntryMessagesTable = storageEntryMessages as unknown;
const usersTable = users as unknown;

test('createDatabaseStorageRepository creates a category', async () => {
  const repository = createDatabaseStorageRepository({
    database: {
      insert: (table: { [key: string]: unknown }) => {
        assert.equal(table as unknown, storageCategoriesTable);
        return {
          values: (values: Record<string, unknown>) => {
            assert.equal(values.slug, 'manuales');
            assert.equal(values.displayName, 'Manuales');
            assert.equal(values.parentCategoryId, null);
            assert.equal(values.storageThreadId, 10);
            return {
              returning: async () => [
                {
                  id: 7,
                  slug: 'manuales',
                  displayName: 'Manuales',
                  parentCategoryId: null,
                  description: 'Documentacion',
                  storageChatId: -100123,
                  storageThreadId: 10,
                  lifecycleStatus: 'active',
                  createdAt: new Date('2026-04-21T10:00:00.000Z'),
                  updatedAt: new Date('2026-04-21T10:00:00.000Z'),
                  archivedAt: null,
                },
              ],
            };
          },
        };
      },
    } as never,
  });

  const category = await repository.createCategory({
    slug: 'manuales',
    displayName: 'Manuales',
    parentCategoryId: null,
    description: 'Documentacion',
    storageChatId: -100123,
    storageThreadId: 10,
  });

  assert.equal(category.id, 7);
  assert.equal(category.lifecycleStatus, 'active');
});

test('createDatabaseStorageRepository creates an entry and its messages in one transaction', async () => {
  const steps: string[] = [];
  const repository = createDatabaseStorageRepository({
    database: {
      transaction: async (handler: (tx: Record<string, unknown>) => Promise<unknown>) =>
        handler({
          insert: (table: { [key: string]: unknown }) => {
            if ((table as unknown) === storageEntriesTable) {
              steps.push('insert:entry');
              return {
                values: (values: Record<string, unknown>) => {
                  assert.equal(values.categoryId, 7);
                  assert.equal(values.createdByTelegramUserId, 42);
                  assert.deepEqual(values.tags, ['pdf', 'rol']);
                  return {
                    returning: async () => [
                      {
                        id: 15,
                        categoryId: 7,
                        createdByTelegramUserId: 42,
                        sourceKind: 'dm_copy',
                        description: 'Manual de campana',
                        tags: ['pdf', 'rol'],
                        lifecycleStatus: 'active',
                        createdAt: new Date('2026-04-21T12:00:00.000Z'),
                        updatedAt: new Date('2026-04-21T12:00:00.000Z'),
                        deletedAt: null,
                        deletedByTelegramUserId: null,
                      },
                    ],
                  };
                },
              };
            }

            if ((table as unknown) === storageEntryMessagesTable) {
              steps.push('insert:messages');
              return {
                values: (values: Array<Record<string, unknown>>) => {
                  assert.equal(values.length, 1);
                  assert.equal(values[0]?.entryId, 15);
                  assert.equal(values[0]?.attachmentKind, 'document');
                  return {
                    returning: async () => [
                      {
                        id: 1,
                        entryId: 15,
                        storageChatId: -100123,
                        storageMessageId: 900,
                        storageThreadId: 10,
                        telegramFileId: 'file-1',
                        telegramFileUniqueId: 'unique-1',
                        attachmentKind: 'document',
                        caption: 'Manual #rol #pdf',
                        originalFileName: 'manual.pdf',
                        mimeType: 'application/pdf',
                        fileSizeBytes: 1024,
                        mediaGroupId: null,
                        sortOrder: 0,
                        createdAt: new Date('2026-04-21T12:00:00.000Z'),
                      },
                    ],
                  };
                },
              };
            }

            throw new Error('unexpected table');
          },
          select: () => ({
            from: (table: { [key: string]: unknown }) => {
              if ((table as unknown) === usersTable) {
                return {
                  where: async () => [
                    {
                      telegramUserId: 42,
                      username: 'ada',
                      displayName: 'Ada Lovelace',
                    },
                  ],
                };
              }
              if ((table as unknown) !== storageCategoriesTable) {
                throw new Error('unexpected table in select');
              }
              return {
                where: async () => [
                  {
                    id: 7,
                    slug: 'manuales',
                    displayName: 'Manuales',
                    parentCategoryId: null,
                    description: 'Documentacion',
                    storageChatId: -100123,
                    storageThreadId: 10,
                    lifecycleStatus: 'active',
                    createdAt: new Date('2026-04-21T10:00:00.000Z'),
                    updatedAt: new Date('2026-04-21T10:00:00.000Z'),
                    archivedAt: null,
                  },
                ],
              };
            },
          }),
        } as never),
    } as never,
  });

  const detail = await repository.createEntry({
    categoryId: 7,
    createdByTelegramUserId: 42,
    sourceKind: 'dm_copy',
    description: 'Manual de campana',
    tags: ['pdf', 'rol'],
    messages: [
      {
        storageChatId: -100123,
        storageMessageId: 900,
        storageThreadId: 10,
        telegramFileId: 'file-1',
        telegramFileUniqueId: 'unique-1',
        attachmentKind: 'document',
        caption: 'Manual #rol #pdf',
        originalFileName: 'manual.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1024,
        mediaGroupId: null,
        sortOrder: 0,
      },
    ],
  });

  assert.deepEqual(steps, ['insert:entry', 'insert:messages']);
  assert.equal(detail.entry.id, 15);
  assert.equal(detail.messages[0]?.originalFileName, 'manual.pdf');
  assert.equal(detail.uploader?.displayName, 'Ada Lovelace');
});

test('createDatabaseStorageRepository lists category entries with their messages', async () => {
  const repository = createDatabaseStorageRepository({
    database: {
      select: () => ({
        from: (table: { [key: string]: unknown }) => {
          if ((table as unknown) === storageEntriesTable) {
            return {
              where: () => ({
                orderBy: async () => [
                  {
                    id: 15,
                    categoryId: 7,
                    createdByTelegramUserId: 42,
                    sourceKind: 'dm_copy',
                    description: 'Manual de campana',
                    tags: ['pdf', 'rol'],
                    lifecycleStatus: 'active',
                    createdAt: new Date('2026-04-21T12:00:00.000Z'),
                    updatedAt: new Date('2026-04-21T12:00:00.000Z'),
                    deletedAt: null,
                    deletedByTelegramUserId: null,
                  },
                ],
              }),
            };
          }

          if ((table as unknown) === storageCategoriesTable) {
            return {
              where: async () => [
                {
                  id: 7,
                  slug: 'manuales',
                  displayName: 'Manuales',
                  parentCategoryId: null,
                  description: 'Documentacion',
                  storageChatId: -100123,
                  storageThreadId: 10,
                  lifecycleStatus: 'active',
                  createdAt: new Date('2026-04-21T10:00:00.000Z'),
                  updatedAt: new Date('2026-04-21T10:00:00.000Z'),
                  archivedAt: null,
                },
              ],
            };
          }

          if ((table as unknown) === storageEntryMessagesTable) {
            return {
              where: () => ({
                orderBy: async () => [
                  {
                    id: 1,
                    entryId: 15,
                    storageChatId: -100123,
                    storageMessageId: 900,
                    storageThreadId: 10,
                    telegramFileId: 'file-1',
                    telegramFileUniqueId: 'unique-1',
                    attachmentKind: 'document',
                    caption: 'Manual #rol #pdf',
                    originalFileName: 'manual.pdf',
                    mimeType: 'application/pdf',
                    fileSizeBytes: 1024,
                    mediaGroupId: null,
                    sortOrder: 0,
                    createdAt: new Date('2026-04-21T12:00:00.000Z'),
                  },
                ],
              }),
            };
          }

          if ((table as unknown) === usersTable) {
            return {
              where: async () => [
                {
                  telegramUserId: 42,
                  username: 'ada',
                  displayName: 'Ada Lovelace',
                },
              ],
            };
          }

          throw new Error('unexpected table');
        },
      }),
    } as never,
  });

  const details = await repository.listEntryDetailsByCategory(7);

  assert.equal(details.length, 1);
  assert.equal(details[0]?.entry.description, 'Manual de campana');
  assert.equal(details[0]?.messages[0]?.originalFileName, 'manual.pdf');
  assert.equal(details[0]?.uploader?.username, 'ada');
});

test('createDatabaseStorageRepository hides role game handout categories and entries from normal lists and searches', async () => {
  const categoryRows = [
    {
      id: 7,
      slug: 'manuales',
      displayName: 'Manuales',
      parentCategoryId: null,
      description: 'Documentacion',
      storageChatId: -100123,
      storageThreadId: 10,
      categoryPurpose: 'user_uploads',
      lifecycleStatus: 'active',
      createdAt: new Date('2026-04-21T10:00:00.000Z'),
      updatedAt: new Date('2026-04-21T10:00:00.000Z'),
      archivedAt: null,
    },
    {
      id: 8,
      slug: 'handouts',
      displayName: 'Handouts de rol',
      parentCategoryId: null,
      description: 'Material interno de partidas',
      storageChatId: -100123,
      storageThreadId: 11,
      categoryPurpose: 'role_game_handouts',
      lifecycleStatus: 'active',
      createdAt: new Date('2026-04-21T10:00:00.000Z'),
      updatedAt: new Date('2026-04-21T10:00:00.000Z'),
      archivedAt: null,
    },
  ];
  const entryRows = [
    {
      id: 15,
      categoryId: 8,
      createdByTelegramUserId: 42,
      sourceKind: 'dm_copy',
      description: 'Secreto del villano',
      tags: ['rol'],
      lifecycleStatus: 'active',
      createdAt: new Date('2026-04-21T12:00:00.000Z'),
      updatedAt: new Date('2026-04-21T12:00:00.000Z'),
      deletedAt: null,
      deletedByTelegramUserId: null,
    },
  ];
  const messageRows = [
    {
      id: 1,
      entryId: 15,
      storageChatId: -100123,
      storageMessageId: 900,
      storageThreadId: 11,
      telegramFileId: 'file-1',
      telegramFileUniqueId: 'unique-1',
      attachmentKind: 'document',
      caption: null,
      originalFileName: 'secreto-villano.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 1024,
      mediaGroupId: null,
      sortOrder: 0,
      createdAt: new Date('2026-04-21T12:00:00.000Z'),
    },
  ];
  const repository = createDatabaseStorageRepository({
    database: {
      select: () => ({
        from: (table: { [key: string]: unknown }) => {
          if ((table as unknown) === storageCategoriesTable) {
            return {
              orderBy: async () => categoryRows,
              where: async () => categoryRows,
            };
          }
          if ((table as unknown) === storageEntriesTable) {
            return {
              where: () => ({
                orderBy: async () => entryRows,
              }),
            };
          }
          if ((table as unknown) === storageEntryMessagesTable) {
            return {
              where: () => ({
                orderBy: async () => messageRows,
              }),
            };
          }
          if ((table as unknown) === usersTable) {
            return {
              where: async () => [],
            };
          }
          throw new Error('unexpected table');
        },
      }),
    } as never,
  });

  const listedCategories = await repository.listCategories();
  const searchResults = await repository.searchEntryDetails({ categoryIds: [7, 8], query: 'villano' });

  assert.equal(listedCategories.some((category) => category.categoryPurpose === 'role_game_handouts'), false);
  assert.equal(searchResults.some((detail) => detail.entry.id === 15), false);
});
