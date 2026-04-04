import test from 'node:test';
import assert from 'node:assert/strict';

import {
  loadConversationSessionRuntime,
  type ConversationSessionRecord,
  type ConversationSessionStore,
} from './conversation-session.js';

function createMemoryStore(initialSessions: ConversationSessionRecord[] = []): ConversationSessionStore {
  const sessions = new Map(initialSessions.map((session) => [session.key, session]));

  return {
    async loadSession(key) {
      return sessions.get(key) ?? null;
    },
    async saveSession(session) {
      sessions.set(session.key, session);
    },
    async deleteSession(key) {
      return sessions.delete(key);
    },
    async deleteExpiredSessions(nowIso) {
      let deleted = 0;

      for (const [key, session] of sessions.entries()) {
        if (session.expiresAt <= nowIso) {
          sessions.delete(key);
          deleted += 1;
        }
      }

      return deleted;
    },
  };
}

test('loadConversationSessionRuntime starts, advances and cancels a flow', async () => {
  const store = createMemoryStore();
  const now = new Date('2026-04-04T10:00:00.000Z');
  const runtime = await loadConversationSessionRuntime({
    scope: {
      chatId: 100,
      userId: 200,
    },
    store,
    now: () => now,
  });

  assert.equal(runtime.current, null);

  const started = await runtime.start({
    flowKey: 'schedule-create',
    stepKey: 'title',
    data: {
      visibility: 'private',
    },
  });

  assert.equal(started.flowKey, 'schedule-create');
  const currentAfterStart = runtime.current as ConversationSessionRecord | null;
  assert.equal(currentAfterStart?.stepKey, 'title');

  const advanced = await runtime.advance({
    stepKey: 'date',
    data: {
      visibility: 'private',
      title: 'Partida de prova',
    },
  });

  assert.equal(advanced.stepKey, 'date');
  const currentAfterAdvance = runtime.current as ConversationSessionRecord | null;
  assert.deepEqual(currentAfterAdvance?.data, {
    visibility: 'private',
    title: 'Partida de prova',
  });

  const cancelled = await runtime.cancel();

  assert.equal(cancelled, true);
  assert.equal(runtime.current, null);
});

test('loadConversationSessionRuntime clears stale sessions before exposing them', async () => {
  const store = createMemoryStore([
    {
      key: 'telegram.session:100:200',
      flowKey: 'loan-request',
      stepKey: 'confirm',
      data: {},
      createdAt: '2026-04-03T09:00:00.000Z',
      updatedAt: '2026-04-03T09:10:00.000Z',
      expiresAt: '2026-04-03T10:00:00.000Z',
    },
  ]);

  const runtime = await loadConversationSessionRuntime({
    scope: {
      chatId: 100,
      userId: 200,
    },
    store,
    now: () => new Date('2026-04-04T10:00:00.000Z'),
  });

  assert.equal(runtime.current, null);
});

test('loadConversationSessionRuntime restores an active persisted session', async () => {
  const store = createMemoryStore([
    {
      key: 'telegram.session:100:200',
      flowKey: 'admin-review',
      stepKey: 'decision',
      data: {
        applicantUserId: 99,
      },
      createdAt: '2026-04-04T09:00:00.000Z',
      updatedAt: '2026-04-04T09:05:00.000Z',
      expiresAt: '2026-04-04T11:00:00.000Z',
    },
  ]);

  const runtime = await loadConversationSessionRuntime({
    scope: {
      chatId: 100,
      userId: 200,
    },
    store,
    now: () => new Date('2026-04-04T10:00:00.000Z'),
  });

  assert.equal(runtime.current?.flowKey, 'admin-review');
  assert.equal(runtime.current?.stepKey, 'decision');
});
