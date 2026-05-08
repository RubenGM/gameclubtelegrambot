import test from 'node:test';
import assert from 'node:assert/strict';

import {
  storageCategories,
  storageCategorySubscriptions,
} from '../infrastructure/database/schema.js';
import { createDatabaseStorageCategorySubscriptionRepository } from './storage-category-subscription-store.js';

test('storage category subscriptions match direct categories and opted-in ancestors only once per user', async () => {
  const repository = createDatabaseStorageCategorySubscriptionRepository({
    database: createStorageCategorySubscriptionDatabaseDouble({
      categories: [
        { id: 1, parentCategoryId: null },
        { id: 2, parentCategoryId: 1 },
        { id: 3, parentCategoryId: 2 },
        { id: 4, parentCategoryId: 1 },
      ],
      subscriptions: [
        createSubscription({ telegramUserId: 10, categoryId: 1, includeSubcategories: true }),
        createSubscription({ telegramUserId: 11, categoryId: 1, includeSubcategories: false }),
        createSubscription({ telegramUserId: 12, categoryId: 2, includeSubcategories: true }),
        createSubscription({ telegramUserId: 13, categoryId: 3, includeSubcategories: false }),
        createSubscription({ telegramUserId: 10, categoryId: 3, includeSubcategories: false }),
        createSubscription({ telegramUserId: 14, categoryId: 4, includeSubcategories: true }),
      ],
    }) as never,
  });

  const matches = await repository.listSubscriptionsForEntryCategory(3);

  assert.deepEqual(matches.map((subscription) => ({
    telegramUserId: subscription.telegramUserId,
    categoryId: subscription.categoryId,
    includeSubcategories: subscription.includeSubcategories,
  })), [
    { telegramUserId: 10, categoryId: 1, includeSubcategories: true },
    { telegramUserId: 12, categoryId: 2, includeSubcategories: true },
    { telegramUserId: 13, categoryId: 3, includeSubcategories: false },
  ]);
});

function createSubscription(overrides: {
  telegramUserId: number;
  categoryId: number;
  includeSubcategories: boolean;
}) {
  return {
    ...overrides,
    createdAt: new Date('2026-04-21T12:00:00.000Z'),
    updatedAt: new Date('2026-04-21T12:00:00.000Z'),
  };
}

function createStorageCategorySubscriptionDatabaseDouble(state: {
  categories: Array<{ id: number; parentCategoryId: number | null }>;
  subscriptions: Array<{
    telegramUserId: number;
    categoryId: number;
    includeSubcategories: boolean;
    createdAt: Date;
    updatedAt: Date;
  }>;
}) {
  return {
    select() {
      return {
        from(table: unknown) {
          const rows = table === storageCategories
            ? state.categories
            : table === storageCategorySubscriptions
              ? state.subscriptions
              : [];
          return {
            where() {
              return {
                orderBy() {
                  return Promise.resolve(rows);
                },
              };
            },
            then(resolve: (value: unknown[]) => void) {
              resolve(rows);
            },
          };
        },
      };
    },
  };
}
