import type { NewsGroupCategoryKey } from '../news/news-group-catalog.js';

export const catalogLoanNewsDebounceMs = 5 * 60 * 1000;

export type CatalogLoanNewsAction = 'borrowed' | 'returned';

export interface CatalogLoanNewsEventRecord {
  id: number;
  categoryKey: NewsGroupCategoryKey;
  action: CatalogLoanNewsAction;
  itemId: number;
  itemDisplayName: string;
  userName: string;
  occurredAt: string;
  publishedAt: string | null;
}

export interface CatalogLoanNewsEventRepository {
  enqueue(input: {
    categoryKey: NewsGroupCategoryKey;
    action: CatalogLoanNewsAction;
    itemId: number;
    itemDisplayName: string;
    userName: string;
    occurredAt?: string;
  }): Promise<CatalogLoanNewsEventRecord>;
  listPendingBatchReadyBefore(readyBefore: string): Promise<CatalogLoanNewsEventRecord[]>;
  markPublished(input: { eventIds: number[]; publishedAt: string }): Promise<void>;
}
