import test from 'node:test';
import assert from 'node:assert/strict';

import { venueEvents } from '../infrastructure/database/schema.js';
import { createDatabaseVenueEventRepository } from './venue-event-catalog-store.js';

const venueEventsTable = venueEvents as unknown;

test('createDatabaseVenueEventRepository lists scheduled venue events by default', async () => {
  const operations: string[] = [];
  const repository = createDatabaseVenueEventRepository({
    database: {
      select: () => ({
        from: (table: { [key: string]: unknown }) => ({
          where: async () => {
            if ((table as unknown) !== venueEventsTable) {
              throw new Error('unexpected table');
            }

            operations.push('list:scheduled');
            return [
              {
                id: 1,
                name: 'Campionat regional',
                description: null,
                startsAt: new Date('2026-04-10T15:00:00.000Z'),
                endsAt: new Date('2026-04-10T21:00:00.000Z'),
                occupancyScope: 'full',
                impactLevel: 'high',
                lifecycleStatus: 'scheduled',
                createdAt: new Date('2026-04-04T10:00:00.000Z'),
                updatedAt: new Date('2026-04-04T10:00:00.000Z'),
                cancelledAt: null,
                cancellationReason: null,
              },
            ];
          },
          orderBy: async () => {
            throw new Error('expected filtered listing to go through where()');
          },
        }),
      }),
    } as never,
  });

  const result = await repository.listVenueEvents({ includeCancelled: false });

  assert.deepEqual(operations, ['list:scheduled']);
  assert.deepEqual(result.map((event) => event.id), [1]);
});

test('createDatabaseVenueEventRepository persists end range and occupancy metadata', async () => {
  const repository = createDatabaseVenueEventRepository({
    database: {
      insert: (table: { [key: string]: unknown }) => {
        if ((table as unknown) !== venueEventsTable) {
          throw new Error('unexpected table');
        }

        return {
          values: (values: Record<string, unknown>) => {
            assert.equal(values.name, 'Campionat regional');
            assert.ok(values.startsAt instanceof Date);
            assert.ok(values.endsAt instanceof Date);
            assert.equal(values.occupancyScope, 'full');
            assert.equal(values.impactLevel, 'high');

            return {
              returning: async () => [
                {
                  id: 2,
                  name: 'Campionat regional',
                  description: null,
                  startsAt: new Date('2026-04-10T15:00:00.000Z'),
                  endsAt: new Date('2026-04-10T21:00:00.000Z'),
                  occupancyScope: 'full',
                  impactLevel: 'high',
                  lifecycleStatus: 'scheduled',
                  createdAt: new Date('2026-04-04T10:00:00.000Z'),
                  updatedAt: new Date('2026-04-04T10:00:00.000Z'),
                  cancelledAt: null,
                  cancellationReason: null,
                },
              ],
            };
          },
        };
      },
    } as never,
  });

  const event = await repository.createVenueEvent({
    name: 'Campionat regional',
    description: null,
    startsAt: '2026-04-10T15:00:00.000Z',
    endsAt: '2026-04-10T21:00:00.000Z',
    occupancyScope: 'full',
    impactLevel: 'high',
  });

  assert.equal(event.id, 2);
  assert.equal(event.endsAt, '2026-04-10T21:00:00.000Z');
  assert.equal(event.impactLevel, 'high');
});
