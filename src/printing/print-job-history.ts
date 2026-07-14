import { desc, eq, sql } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { printJobs } from '../infrastructure/database/schema.js';

export type PrintJobOrigin = 'telegram_attachment' | 'storage_entry';
export type PrintJobDetectedType = 'pdf' | 'office' | 'image';
export type PrintJobSides = 'one-sided' | 'two-sided-long-edge';
export type PrintJobStatus = 'prepared' | 'submitted' | 'failed' | 'cancelled';
export type PrintJobPagesPerSheet = 1 | 2 | 4;

export interface PrintJobHistoryRecord {
  id: number;
  requestedByTelegramUserId: number;
  requestedByDisplayName: string;
  origin: PrintJobOrigin;
  storageEntryId: number | null;
  storageMessageId: number | null;
  originalFileName: string;
  mimeType: string | null;
  detectedType: PrintJobDetectedType;
  normalizedPageCount: number;
  selectedPagesLabel: string;
  selectedPageCount: number;
  copies: number;
  pagesPerSheet: PrintJobPagesPerSheet;
  estimatedPhysicalPages: number;
  sides: PrintJobSides;
  cupsQueue: string;
  status: PrintJobStatus;
  cupsJobId: string | null;
  errorMessage: string | null;
  createdAt: string;
  submittedAt: string | null;
  completedAt: string | null;
}

export type NewPrintJobHistoryRecord = Omit<
  PrintJobHistoryRecord,
  'id' | 'status' | 'cupsJobId' | 'errorMessage' | 'createdAt' | 'submittedAt' | 'completedAt' | 'pagesPerSheet'
> & { pagesPerSheet?: PrintJobPagesPerSheet };

export interface PrintJobHistoryRepository {
  createJob(input: NewPrintJobHistoryRecord): Promise<PrintJobHistoryRecord>;
  markSubmitted(id: number, input: { cupsJobId: string; submittedAt: string }): Promise<void>;
  markFailed(id: number, input: { errorMessage: string; completedAt: string }): Promise<void>;
  markCancelled(id: number, input: { completedAt: string }): Promise<void>;
  listRecent(input: { limit: number }): Promise<PrintJobHistoryRecord[]>;
}

export function createMemoryPrintJobHistoryRepository(): PrintJobHistoryRepository {
  const records: PrintJobHistoryRecord[] = [];
  let nextId = 1;

  return {
    async createJob(input) {
      const record: PrintJobHistoryRecord = {
        ...input,
        pagesPerSheet: input.pagesPerSheet ?? 1,
        id: nextId++,
        status: 'prepared',
        cupsJobId: null,
        errorMessage: null,
        createdAt: '2026-06-30T00:00:00.000Z',
        submittedAt: null,
        completedAt: null,
      };
      records.unshift(record);
      return record;
    },
    async markSubmitted(id, input) {
      updateMemoryRecord(records, id, {
        status: 'submitted',
        cupsJobId: input.cupsJobId,
        submittedAt: input.submittedAt,
        errorMessage: null,
      });
    },
    async markFailed(id, input) {
      updateMemoryRecord(records, id, {
        status: 'failed',
        errorMessage: input.errorMessage,
        completedAt: input.completedAt,
      });
    },
    async markCancelled(id, input) {
      updateMemoryRecord(records, id, {
        status: 'cancelled',
        completedAt: input.completedAt,
      });
    },
    async listRecent({ limit }) {
      return records.slice(0, Math.max(0, limit));
    },
  };
}

export function createDatabasePrintJobHistoryRepository({
  database,
}: {
  database: DatabaseConnection['db'];
}): PrintJobHistoryRepository {
  return {
    async createJob(input) {
      const [record] = await database
        .insert(printJobs)
        .values({
          requestedByTelegramUserId: input.requestedByTelegramUserId,
          requestedByDisplayName: input.requestedByDisplayName,
          origin: input.origin,
          storageEntryId: input.storageEntryId,
          storageMessageId: input.storageMessageId,
          originalFileName: input.originalFileName,
          mimeType: input.mimeType,
          detectedType: input.detectedType,
          normalizedPageCount: input.normalizedPageCount,
          selectedPagesLabel: input.selectedPagesLabel,
          selectedPageCount: input.selectedPageCount,
          copies: input.copies,
          pagesPerSheet: input.pagesPerSheet ?? 1,
          estimatedPhysicalPages: input.estimatedPhysicalPages,
          sides: input.sides,
          cupsQueue: input.cupsQueue,
        })
        .returning();

      if (!record) {
        throw new Error('Print job history insert returned no row');
      }

      return mapPrintJobRow(record);
    },
    async markSubmitted(id, input) {
      await database
        .update(printJobs)
        .set({
          status: 'submitted',
          cupsJobId: input.cupsJobId,
          submittedAt: new Date(input.submittedAt),
          errorMessage: null,
        })
        .where(eq(printJobs.id, id));
    },
    async markFailed(id, input) {
      await database
        .update(printJobs)
        .set({
          status: 'failed',
          errorMessage: input.errorMessage,
          completedAt: new Date(input.completedAt),
        })
        .where(eq(printJobs.id, id));
    },
    async markCancelled(id, input) {
      await database
        .update(printJobs)
        .set({
          status: 'cancelled',
          completedAt: new Date(input.completedAt),
        })
        .where(eq(printJobs.id, id));
    },
    async listRecent({ limit }) {
      const rows = await database
        .select()
        .from(printJobs)
        .orderBy(desc(printJobs.createdAt))
        .limit(limit);

      return rows.map(mapPrintJobRow);
    },
  };
}

function updateMemoryRecord(
  records: PrintJobHistoryRecord[],
  id: number,
  patch: Partial<PrintJobHistoryRecord>,
): void {
  const record = records.find((candidate) => candidate.id === id);
  if (!record) {
    throw new Error(`Print job ${id} was not found`);
  }
  Object.assign(record, patch);
}

function mapPrintJobRow(row: typeof printJobs.$inferSelect): PrintJobHistoryRecord {
  return {
    id: row.id,
    requestedByTelegramUserId: row.requestedByTelegramUserId,
    requestedByDisplayName: row.requestedByDisplayName,
    origin: row.origin as PrintJobOrigin,
    storageEntryId: row.storageEntryId,
    storageMessageId: row.storageMessageId,
    originalFileName: row.originalFileName,
    mimeType: row.mimeType,
    detectedType: row.detectedType as PrintJobDetectedType,
    normalizedPageCount: row.normalizedPageCount,
    selectedPagesLabel: row.selectedPagesLabel,
    selectedPageCount: row.selectedPageCount,
    copies: row.copies,
    pagesPerSheet: row.pagesPerSheet as PrintJobPagesPerSheet,
    estimatedPhysicalPages: row.estimatedPhysicalPages,
    sides: row.sides as PrintJobSides,
    cupsQueue: row.cupsQueue,
    status: row.status as PrintJobStatus,
    cupsJobId: row.cupsJobId,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}
