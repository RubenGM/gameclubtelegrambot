import test from 'node:test';
import assert from 'node:assert/strict';

import { findDuplicateExports, validateRepoHealth } from './repo-health.js';

test('findDuplicateExports reports repeated exported interfaces in the same file', async () => {
  const duplicates = findDuplicateExports({
    filePath: 'src/catalog/catalog-model.ts',
    content: [
      'export interface CatalogLoanRepository {',
      '  findLoanById(loanId: number): Promise<unknown>;',
      '}',
      '',
      'export interface CatalogLoanRepository {',
      '  closeLoan(input: { loanId: number }): Promise<unknown>;',
      '}',
    ].join('\n'),
  });

  assert.deepEqual(duplicates, [
    'src/catalog/catalog-model.ts: duplicate exported interface "CatalogLoanRepository" declared 2 times',
  ]);
});

test('validateRepoHealth aggregates duplicate exported declarations across files', async () => {
  const issues = validateRepoHealth({
    files: [
      {
        path: 'src/catalog/catalog-model.ts',
        content: [
          'export interface CatalogLoanRepository {',
          '  findLoanById(loanId: number): Promise<unknown>;',
          '}',
          '',
          'export interface CatalogLoanRepository {',
          '  closeLoan(input: { loanId: number }): Promise<unknown>;',
          '}',
        ].join('\n'),
      },
      {
        path: 'src/catalog/catalog-store.ts',
        content: 'export interface CatalogRepository {}\n',
      },
    ],
  });

  assert.deepEqual(issues, [
    'src/catalog/catalog-model.ts: duplicate exported interface "CatalogLoanRepository" declared 2 times',
  ]);
});

test('validateRepoHealth ignores distinct export names', async () => {
  const issues = validateRepoHealth({
    files: [
      {
        path: 'src/catalog/catalog-model.ts',
        content: [
          'export interface CatalogLoanRepository {',
          '  findLoanById(loanId: number): Promise<unknown>;',
          '}',
          'export interface CatalogRepository {',
          '  listItems(): Promise<unknown[]>;',
          '}',
          'export type CatalogLoanRecord = { id: number };',
        ].join('\n'),
      },
    ],
  });

  assert.deepEqual(issues, []);
});
