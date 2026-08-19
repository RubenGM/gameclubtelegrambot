import {
  catalogLoanNewsDebounceMs,
  type CatalogLoanNewsEventRecord,
  type CatalogLoanNewsEventRepository,
} from '../catalog/catalog-loan-news-event.js';
import type { NewsGroupDeliveryTarget, NewsGroupRepository } from '../news/news-group-catalog.js';
import { escapeHtml } from './catalog-presentation.js';
import { buildTelegramStartUrl } from './deep-links.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

export interface CatalogLoanNewsFlushResult {
  pendingEvents: number;
  deliveredTargets: number;
  failedTargets: number;
}

export async function flushDueCatalogLoanNewsEvents({
  eventRepository,
  newsGroupRepository,
  sendGroupMessage,
  language,
  now = new Date(),
  debounceMs = catalogLoanNewsDebounceMs,
  logger,
}: {
  eventRepository: CatalogLoanNewsEventRepository;
  newsGroupRepository: NewsGroupRepository;
  sendGroupMessage: (chatId: number, message: string, options?: TelegramReplyOptions) => Promise<unknown>;
  language: string;
  now?: Date;
  debounceMs?: number;
  logger?: { error(bindings: object, message: string): void };
}): Promise<CatalogLoanNewsFlushResult> {
  const readyBefore = new Date(now.getTime() - debounceMs).toISOString();
  const events = await eventRepository.listPendingBatchReadyBefore(readyBefore);
  const result: CatalogLoanNewsFlushResult = {
    pendingEvents: events.length,
    deliveredTargets: 0,
    failedTargets: 0,
  };
  if (events.length === 0) {
    return result;
  }

  const targetsByCategory = new Map<string, NewsGroupDeliveryTarget[]>();
  await Promise.all(Array.from(new Set(events.map((event) => event.categoryKey))).map(async (categoryKey) => {
    targetsByCategory.set(categoryKey, await newsGroupRepository.listSubscribedGroupsByCategory(categoryKey));
  }));

  const deliveries = new Map<string, { target: NewsGroupDeliveryTarget; events: CatalogLoanNewsEventRecord[] }>();
  for (const event of events) {
    for (const target of targetsByCategory.get(event.categoryKey) ?? []) {
      const key = `${target.chatId}:${target.messageThreadId ?? 0}`;
      const delivery = deliveries.get(key) ?? { target, events: [] };
      delivery.events.push(event);
      deliveries.set(key, delivery);
    }
  }

  await Promise.all(Array.from(deliveries.values()).map(async ({ target, events: targetEvents }) => {
    try {
      await sendGroupMessage(target.chatId, formatCatalogLoanNewsBatch(targetEvents, language), {
        parseMode: 'HTML',
        ...(target.messageThreadId ? { messageThreadId: target.messageThreadId } : {}),
      });
      result.deliveredTargets += 1;
    } catch (error) {
      result.failedTargets += 1;
      logger?.error({
        error: error instanceof Error ? error.message : String(error),
        chatId: target.chatId,
        messageThreadId: target.messageThreadId,
        eventIds: targetEvents.map((event) => event.id),
      }, 'Catalog loan news batch delivery failed');
    }
  }));

  await eventRepository.markPublished({
    eventIds: events.map((event) => event.id),
    publishedAt: now.toISOString(),
  });
  return result;
}

export function formatCatalogLoanNewsBatch(
  events: CatalogLoanNewsEventRecord[],
  language: string,
): string {
  const texts = createTelegramI18n(normalizeBotLanguage(language, 'ca')).catalogLoan;
  return [
    `<b>${escapeHtml(texts.groupBatchHeader)}</b>`,
    '',
    ...events.map((event) => {
      const itemLink = `<a href="${escapeHtml(buildTelegramStartUrl(`catalog_read_item_${event.itemId}`))}">${escapeHtml(event.itemDisplayName)}</a>`;
      const line = event.action === 'borrowed'
        ? texts.groupBorrowed.replace('{user}', escapeHtml(event.userName)).replace('{item}', itemLink)
        : texts.groupReturned.replace('{user}', escapeHtml(event.userName)).replace('{item}', itemLink);
      return `• ${line}`;
    }),
  ].join('\n');
}
