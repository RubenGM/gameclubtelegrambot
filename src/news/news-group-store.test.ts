import test from 'node:test';
import assert from 'node:assert/strict';

import { newsGroupSubscriptions, newsGroups } from '../infrastructure/database/schema.js';
import { createDatabaseNewsGroupRepository } from './news-group-store.js';

const newsGroupsTable = newsGroups as unknown;
const newsGroupSubscriptionsTable = newsGroupSubscriptions as unknown;

test('createDatabaseNewsGroupRepository persists news groups and resolves enabled status', async () => {
  const repository = createDatabaseNewsGroupRepository({
    database: {
      select: () => ({
        from: (table: { [key: string]: unknown }) => ({
          where: async () => {
            if ((table as unknown) !== newsGroupsTable) {
              throw new Error('unexpected table');
            }

            return [
              {
                chatId: -100,
                isEnabled: true,
                metadata: { scope: 'news' },
                createdAt: new Date('2026-04-04T10:00:00.000Z'),
                updatedAt: new Date('2026-04-04T11:00:00.000Z'),
                enabledAt: new Date('2026-04-04T10:00:00.000Z'),
                disabledAt: null,
              },
            ];
          },
        }),
      }),
      insert: (table: { [key: string]: unknown }) => {
        if ((table as unknown) !== newsGroupsTable) {
          throw new Error('unexpected table');
        }

        return {
          values: (values: Record<string, unknown>) => {
            assert.equal(values.chatId, -100);
            assert.equal(values.isEnabled, true);
            assert.deepEqual(values.metadata, { scope: 'news' });

            return {
              onConflictDoUpdate: () => ({
                returning: async () => [
                  {
                    chatId: -100,
                    isEnabled: true,
                    metadata: { scope: 'news' },
                    createdAt: new Date('2026-04-04T10:00:00.000Z'),
                    updatedAt: new Date('2026-04-04T11:00:00.000Z'),
                    enabledAt: new Date('2026-04-04T10:00:00.000Z'),
                    disabledAt: null,
                  },
                ],
              }),
            };
          },
        };
      },
      delete: () => ({
        where: async () => ({
          returning: async () => [],
        }),
      }),
    } as never,
  });

  const group = await repository.upsertGroup({
    chatId: -100,
    isEnabled: true,
    metadata: { scope: 'news' },
  });

  assert.equal(group.chatId, -100);
  assert.equal(group.isEnabled, true);
  assert.deepEqual(group.metadata, { scope: 'news' });
  assert.equal(await repository.isNewsEnabledGroup(-100), true);
});

test('createDatabaseNewsGroupRepository lists subscribed groups by category', async () => {
  const repository = createDatabaseNewsGroupRepository({
    database: {
      select: (selection: Record<string, unknown> = {}) => ({
        from: (table: { [key: string]: unknown }) => ({
          innerJoin: () => ({
            where: () => ({
              orderBy: async () => {
                if ((table as unknown) !== newsGroupSubscriptionsTable) {
                  throw new Error('unexpected table');
                }

                if ('chatId' in selection) {
                  return [
                    {
                      chatId: -100,
                      categoryKey: 'events',
                      createdAt: new Date('2026-04-04T10:00:00.000Z'),
                      updatedAt: new Date('2026-04-04T10:00:00.000Z'),
                    },
                  ];
                }

                return [
                  {
                    chatId: -100,
                    isEnabled: true,
                    metadata: null,
                    createdAt: new Date('2026-04-04T10:00:00.000Z'),
                    updatedAt: new Date('2026-04-04T10:00:00.000Z'),
                    enabledAt: new Date('2026-04-04T10:00:00.000Z'),
                    disabledAt: null,
                  },
                ];
              },
            }),
          }),
          where: async () => [
            {
              chatId: -100,
              isEnabled: true,
              metadata: null,
              createdAt: new Date('2026-04-04T10:00:00.000Z'),
              updatedAt: new Date('2026-04-04T10:00:00.000Z'),
              enabledAt: new Date('2026-04-04T10:00:00.000Z'),
              disabledAt: null,
            },
          ],
        }),
      }),
      insert: (table: { [key: string]: unknown }) => {
        if ((table as unknown) !== newsGroupSubscriptionsTable) {
          throw new Error('unexpected table');
        }

        return {
          values: (values: Record<string, unknown>) => {
            assert.equal(values.chatId, -100);
            assert.equal(values.categoryKey, 'events');

            return {
              onConflictDoUpdate: () => ({
                returning: async () => [
                  {
                    chatId: -100,
                    categoryKey: 'events',
                    createdAt: new Date('2026-04-04T10:00:00.000Z'),
                    updatedAt: new Date('2026-04-04T10:00:00.000Z'),
                  },
                ],
              }),
            };
          },
        };
      },
      delete: () => ({
        where: async () => ({
          returning: async () => [],
        }),
      }),
    } as never,
  });

  await repository.upsertSubscription({ chatId: -100, categoryKey: 'events' });

  const groups = await repository.listSubscribedGroupsByCategory('events');
  assert.deepEqual(groups.map((group) => group.chatId), [-100]);
});
