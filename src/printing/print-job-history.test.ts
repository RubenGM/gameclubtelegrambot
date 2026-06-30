import assert from 'node:assert/strict';
import test from 'node:test';

import { createMemoryPrintJobHistoryRepository } from './print-job-history.js';

test('print job history records and lists submitted jobs', async () => {
  const repository = createMemoryPrintJobHistoryRepository();

  const job = await repository.createJob({
    requestedByTelegramUserId: 7,
    requestedByDisplayName: 'Ruben',
    origin: 'telegram_attachment',
    storageEntryId: null,
    storageMessageId: null,
    originalFileName: 'fichas.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    detectedType: 'office',
    normalizedPageCount: 4,
    selectedPagesLabel: '1-4',
    selectedPageCount: 4,
    copies: 7,
    estimatedPhysicalPages: 28,
    sides: 'two-sided-long-edge',
    cupsQueue: 'Virtual-PDF',
  });

  await repository.markSubmitted(job.id, {
    cupsJobId: 'Virtual-PDF-42',
    submittedAt: '2026-06-30T10:00:00.000Z',
  });

  assert.deepEqual(await repository.listRecent({ limit: 5 }), [{
    ...job,
    status: 'submitted',
    cupsJobId: 'Virtual-PDF-42',
    errorMessage: null,
    submittedAt: '2026-06-30T10:00:00.000Z',
    completedAt: null,
  }]);
});

test('print job history records safe failures', async () => {
  const repository = createMemoryPrintJobHistoryRepository();
  const job = await repository.createJob({
    requestedByTelegramUserId: 8,
    requestedByDisplayName: 'Marina',
    origin: 'storage_entry',
    storageEntryId: 123,
    storageMessageId: 456,
    originalFileName: 'personaje.pdf',
    mimeType: 'application/pdf',
    detectedType: 'pdf',
    normalizedPageCount: 12,
    selectedPagesLabel: '1-12',
    selectedPageCount: 12,
    copies: 1,
    estimatedPhysicalPages: 12,
    sides: 'one-sided',
    cupsQueue: 'Virtual-PDF',
  });

  await repository.markFailed(job.id, {
    errorMessage: 'lp exited with code 1',
    completedAt: '2026-06-30T10:05:00.000Z',
  });

  const recent = await repository.listRecent({ limit: 1 });
  assert.equal(recent[0]?.status, 'failed');
  assert.equal(recent[0]?.errorMessage, 'lp exited with code 1');
  assert.equal(recent[0]?.completedAt, '2026-06-30T10:05:00.000Z');
});

