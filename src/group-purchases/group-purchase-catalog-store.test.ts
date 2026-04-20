import test from 'node:test';
import assert from 'node:assert/strict';

import {
  groupPurchaseFields,
  groupPurchaseParticipants,
  groupPurchases,
} from '../infrastructure/database/schema.js';
import { createDatabaseGroupPurchaseRepository } from './group-purchase-catalog-store.js';

const groupPurchasesTable = groupPurchases as unknown;
const groupPurchaseFieldsTable = groupPurchaseFields as unknown;
const groupPurchaseParticipantsTable = groupPurchaseParticipants as unknown;

test('createDatabaseGroupPurchaseRepository creates a purchase and its fields in one transaction', async () => {
  const steps: string[] = [];
  const repository = createDatabaseGroupPurchaseRepository({
    database: {
      transaction: async (handler: (tx: Record<string, unknown>) => Promise<unknown>) =>
        handler({
          insert: (table: { [key: string]: unknown }) => {
            if ((table as unknown) === groupPurchasesTable) {
              steps.push('insert:purchase');
              return {
                values: (values: Record<string, unknown>) => {
                  assert.equal(values.title, 'Pedido de dados');
                  assert.equal(values.purchaseMode, 'per_item');
                  assert.equal(values.createdByTelegramUserId, 42);
                  assert.equal(values.unitPriceCents, 125);
                  assert.equal(values.unitLabel, 'dado');

                  return {
                    returning: async () => [
                      {
                        id: 7,
                        title: 'Pedido de dados',
                        description: 'Compra conjunta',
                        purchaseMode: 'per_item',
                        lifecycleStatus: 'open',
                        createdByTelegramUserId: 42,
                        joinDeadlineAt: null,
                        confirmDeadlineAt: null,
                        totalPriceCents: null,
                        unitPriceCents: 125,
                        unitLabel: 'dado',
                        allocationFieldKey: 'quantity',
                        createdAt: new Date('2026-04-20T10:00:00.000Z'),
                        updatedAt: new Date('2026-04-20T10:00:00.000Z'),
                        cancelledAt: null,
                      },
                    ],
                  };
                },
              };
            }

            if ((table as unknown) === groupPurchaseFieldsTable) {
              steps.push('insert:fields');
              return {
                values: (values: Array<Record<string, unknown>>) => {
                  assert.equal(values.length, 1);
                  assert.equal(values[0]?.purchaseId, 7);
                  assert.equal(values[0]?.fieldKey, 'quantity');
                  assert.equal(values[0]?.affectsQuantity, true);

                  return {
                    returning: async () => [
                      {
                        id: 10,
                        purchaseId: 7,
                        fieldKey: 'quantity',
                        label: 'Cantidad',
                        fieldType: 'integer',
                        isRequired: true,
                        sortOrder: 0,
                        config: { min: 1 },
                        affectsQuantity: true,
                        createdAt: new Date('2026-04-20T10:00:00.000Z'),
                        updatedAt: new Date('2026-04-20T10:00:00.000Z'),
                      },
                    ],
                  };
                },
              };
            }

            throw new Error('unexpected table');
          },
        } as never),
    } as never,
  });

  const detail = await repository.createPurchase({
    title: 'Pedido de dados',
    description: 'Compra conjunta',
    purchaseMode: 'per_item',
    createdByTelegramUserId: 42,
    joinDeadlineAt: null,
    confirmDeadlineAt: null,
    totalPriceCents: null,
    unitPriceCents: 125,
    unitLabel: 'dado',
    allocationFieldKey: 'quantity',
    fields: [
      {
        fieldKey: 'quantity',
        label: 'Cantidad',
        fieldType: 'integer',
        isRequired: true,
        sortOrder: 0,
        config: { min: 1 },
        affectsQuantity: true,
      },
    ],
  });

  assert.deepEqual(steps, ['insert:purchase', 'insert:fields']);
  assert.equal(detail.purchase.id, 7);
  assert.equal(detail.fields[0]?.fieldKey, 'quantity');
});

test('createDatabaseGroupPurchaseRepository loads purchase detail with fields and participants', async () => {
  const repository = createDatabaseGroupPurchaseRepository({
    database: {
      select: (selection?: Record<string, unknown>) => ({
        from: (table: { [key: string]: unknown }) => {
          if ((table as unknown) === groupPurchasesTable) {
            return {
              where: async () => [
                {
                  id: 7,
                  title: 'Pedido de dados',
                  description: 'Compra conjunta',
                  purchaseMode: 'per_item',
                  lifecycleStatus: 'open',
                  createdByTelegramUserId: 42,
                  joinDeadlineAt: null,
                  confirmDeadlineAt: null,
                  totalPriceCents: null,
                  unitPriceCents: 125,
                  unitLabel: 'dado',
                  allocationFieldKey: 'quantity',
                  createdAt: new Date('2026-04-20T10:00:00.000Z'),
                  updatedAt: new Date('2026-04-20T10:00:00.000Z'),
                  cancelledAt: null,
                },
              ],
            };
          }

          if ((table as unknown) === groupPurchaseFieldsTable) {
            return {
              where: () => ({
                orderBy: async () => [
                  {
                    id: 10,
                    purchaseId: 7,
                    fieldKey: 'quantity',
                    label: 'Cantidad',
                    fieldType: 'integer',
                    isRequired: true,
                    sortOrder: 0,
                    config: { min: 1 },
                    affectsQuantity: true,
                    createdAt: new Date('2026-04-20T10:00:00.000Z'),
                    updatedAt: new Date('2026-04-20T10:00:00.000Z'),
                  },
                ],
              }),
            };
          }

          if ((table as unknown) === groupPurchaseParticipantsTable) {
            return {
              where: () => ({
                orderBy: async () => [
                  {
                    purchaseId: 7,
                    participantTelegramUserId: 77,
                    status: 'interested',
                    joinedAt: new Date('2026-04-20T12:00:00.000Z'),
                    updatedAt: new Date('2026-04-20T12:00:00.000Z'),
                    removedAt: null,
                    confirmedAt: null,
                    paidAt: null,
                    deliveredAt: null,
                  },
                ],
              }),
            };
          }

          throw new Error(`unexpected table for selection ${String(selection)}`);
        },
      }),
    } as never,
  });

  const detail = await repository.getPurchaseDetail(7);

  assert.ok(detail);
  assert.equal(detail?.purchase.title, 'Pedido de dados');
  assert.equal(detail?.fields[0]?.label, 'Cantidad');
  assert.equal(detail?.participants[0]?.participantTelegramUserId, 77);
});

test('createDatabaseGroupPurchaseRepository upserts participant status and timestamps', async () => {
  const repository = createDatabaseGroupPurchaseRepository({
    database: {
      insert: (table: { [key: string]: unknown }) => {
        if ((table as unknown) !== groupPurchaseParticipantsTable) {
          throw new Error('unexpected table');
        }

        return {
          values: (values: Record<string, unknown>) => {
            assert.equal(values.purchaseId, 7);
            assert.equal(values.participantTelegramUserId, 77);
            assert.equal(values.status, 'confirmed');
            assert.ok(values.confirmedAt instanceof Date);
            assert.ok(values.updatedAt instanceof Date);

            return {
              onConflictDoUpdate: () => ({
                returning: async () => [
                  {
                    purchaseId: 7,
                    participantTelegramUserId: 77,
                    status: 'confirmed',
                    joinedAt: new Date('2026-04-20T12:00:00.000Z'),
                    updatedAt: new Date('2026-04-20T13:00:00.000Z'),
                    removedAt: null,
                    confirmedAt: new Date('2026-04-20T13:00:00.000Z'),
                    paidAt: null,
                    deliveredAt: null,
                  },
                ],
              }),
            };
          },
        };
      },
    } as never,
  });

  const participant = await repository.upsertParticipant({
    purchaseId: 7,
    participantTelegramUserId: 77,
    status: 'confirmed',
  });

  assert.equal(participant.status, 'confirmed');
  assert.equal(participant.confirmedAt, '2026-04-20T13:00:00.000Z');
});
