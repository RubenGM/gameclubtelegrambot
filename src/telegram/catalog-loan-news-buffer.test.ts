import test from 'node:test';
import assert from 'node:assert/strict';

import type { CatalogLoanNewsEventRecord, CatalogLoanNewsEventRepository } from '../catalog/catalog-loan-news-event.js';
import type { NewsGroupRepository } from '../news/news-group-catalog.js';
import { flushDueCatalogLoanNewsEvents, formatCatalogLoanNewsBatch } from './catalog-loan-news-buffer.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

test('catalog loan news waits five minutes after the newest event and then sends one grouped message', async () => {
  const events: CatalogLoanNewsEventRecord[] = [
    event(1, 'borrowed', 10, 'Catan', 'Anna', '2026-08-19T10:00:00.000Z'),
    event(2, 'returned', 11, 'Pandemic', 'Rubén', '2026-08-19T10:01:00.000Z'),
    event(3, 'returned', 12, 'Secret Hitler', 'Rubén', '2026-08-19T10:02:00.000Z'),
  ];
  const repository = createEventRepository(events);
  const messages: Array<{ chatId: number; message: string; options?: TelegramReplyOptions }> = [];
  const newsGroupRepository = createNewsRepository();

  const tooSoon = await flushDueCatalogLoanNewsEvents({
    eventRepository: repository,
    newsGroupRepository,
    language: 'es',
    now: new Date('2026-08-19T10:06:59.000Z'),
    sendGroupMessage: async (chatId, message, options) => {
      messages.push({ chatId, message, ...(options ? { options } : {}) });
    },
  });
  assert.deepEqual(tooSoon, { pendingEvents: 0, deliveredTargets: 0, failedTargets: 0 });
  assert.equal(messages.length, 0);

  const flushed = await flushDueCatalogLoanNewsEvents({
    eventRepository: repository,
    newsGroupRepository,
    language: 'es',
    now: new Date('2026-08-19T10:07:00.000Z'),
    sendGroupMessage: async (chatId, message, options) => {
      messages.push({ chatId, message, ...(options ? { options } : {}) });
    },
  });

  assert.deepEqual(flushed, { pendingEvents: 3, deliveredTargets: 1, failedTargets: 0 });
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.chatId, -200);
  assert.equal(messages[0]?.options?.messageThreadId, 7);
  assert.equal(messages[0]?.options?.parseMode, 'HTML');
  assert.match(messages[0]?.message ?? '', /<b>Movimientos de préstamos<\/b>/);
  assert.match(messages[0]?.message ?? '', /Anna ha tomado prestado .*Catan<\/a>\./);
  assert.match(messages[0]?.message ?? '', /Rubén ha devuelto .*Pandemic<\/a>\./);
  assert.match(messages[0]?.message ?? '', /Rubén ha devuelto .*Secret Hitler<\/a>\./);
  assert.equal(events.every((pendingEvent) => pendingEvent.publishedAt === '2026-08-19T10:07:00.000Z'), true);
});

function event(
  id: number,
  action: CatalogLoanNewsEventRecord['action'],
  itemId: number,
  itemDisplayName: string,
  userName: string,
  occurredAt: string,
): CatalogLoanNewsEventRecord {
  return {
    id,
    categoryKey: 'catalog-loans:board-game',
    action,
    itemId,
    itemDisplayName,
    userName,
    occurredAt,
    publishedAt: null,
  };
}

test('cession news describes lending to the club, escapes names and reaches its subscribed topic', async () => {
  const events = [event(1, 'ceded', 10, 'Catan <Club> & Amigos', 'María <socia> & Ana', '2026-10-18T10:00:00.000Z')];
  const formatted = formatCatalogLoanNewsBatch(events, 'es');
  assert.match(formatted, /María &lt;socia&gt; &amp; Ana ha dejado/);
  assert.match(formatted, /Catan &lt;Club&gt; &amp; Amigos<\/a> cedido en la ludoteca y sigue siendo su propietario/);
  assert.doesNotMatch(formatted, /ha devuelto|ha tomado prestado/);
  const messages: Array<{ chatId: number; message: string; options?: TelegramReplyOptions }> = [];
  const result = await flushDueCatalogLoanNewsEvents({
    eventRepository: createEventRepository(events), newsGroupRepository: createNewsRepository(), language: 'es',
    now: new Date('2026-10-18T10:05:00.000Z'),
    async sendGroupMessage(chatId, message, options) { messages.push({ chatId, message, ...(options ? { options } : {}) }); },
  });
  assert.deepEqual(result, { pendingEvents: 1, deliveredTargets: 1, failedTargets: 0 });
  assert.equal(messages[0]?.chatId, -200);
  assert.equal(messages[0]?.options?.messageThreadId, 7);
  assert.equal(messages[0]?.message, formatted);
  assert.equal(events[0]?.publishedAt, '2026-10-18T10:05:00.000Z');
});

function createEventRepository(events: CatalogLoanNewsEventRecord[]): CatalogLoanNewsEventRepository {
  return {
    async enqueue() { throw new Error('not used'); },
    async listPendingBatchReadyBefore(readyBefore) {
      const pending = events.filter((pendingEvent) => pendingEvent.publishedAt === null);
      const newest = [...pending].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0];
      return newest && newest.occurredAt <= readyBefore ? pending : [];
    },
    async markPublished({ eventIds, publishedAt }) {
      for (const pendingEvent of events) {
        if (eventIds.includes(pendingEvent.id)) {
          pendingEvent.publishedAt = publishedAt;
        }
      }
    },
  };
}

function createNewsRepository(): NewsGroupRepository {
  return {
    async listSubscribedGroupsByCategory() {
      return [{
        chatId: -200,
        messageThreadId: 7,
        isDefault: false,
        isEnabled: true,
        metadata: null,
        createdAt: '2026-08-19T09:00:00.000Z',
        updatedAt: '2026-08-19T09:00:00.000Z',
        enabledAt: '2026-08-19T09:00:00.000Z',
        disabledAt: null,
      }];
    },
  } as unknown as NewsGroupRepository;
}
