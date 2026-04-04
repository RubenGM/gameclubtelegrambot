import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendAuditEvent,
  type AuditLogEventRecord,
  type AuditLogRepository,
} from './audit-log.js';

function createRepository(): AuditLogRepository & { __events: AuditLogEventRecord[] } {
  const events: AuditLogEventRecord[] = [];

  return {
    async appendEvent(input) {
      events.push({
        actorTelegramUserId: input.actorTelegramUserId,
        actionKey: input.actionKey,
        targetType: input.targetType,
        targetId: input.targetId,
        summary: input.summary,
        details: input.details ?? null,
        createdAt: '2026-04-04T10:00:00.000Z',
      });
    },
    __events: events,
  };
}

test('appendAuditEvent normalizes and persists a structured audit entry', async () => {
  const repository = createRepository();

  await appendAuditEvent({
    repository,
    actorTelegramUserId: 99,
    actionKey: 'table.created',
    targetType: 'club-table',
    targetId: '7',
    summary: 'Taula creada correctament',
    details: { displayName: 'Mesa TV', recommendedCapacity: 6 },
  });

  assert.deepEqual(repository.__events, [
    {
      actorTelegramUserId: 99,
      actionKey: 'table.created',
      targetType: 'club-table',
      targetId: '7',
      summary: 'Taula creada correctament',
      details: { displayName: 'Mesa TV', recommendedCapacity: 6 },
      createdAt: '2026-04-04T10:00:00.000Z',
    },
  ]);
});
