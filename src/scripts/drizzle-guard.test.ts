import test from 'node:test';
import assert from 'node:assert/strict';

import {
  diffFileSnapshots,
  findMissingDrizzleArtifacts,
  validateGeneratedMigrationArtifacts,
} from './drizzle-guard.js';

test('findMissingDrizzleArtifacts reports missing snapshots and sql files from the journal', async () => {
  const missing = findMissingDrizzleArtifacts({
    entries: [
      { idx: 0, tag: '0000_young_lady_bullseye' },
      { idx: 1, tag: '0001_hesitant_war_machine' },
      { idx: 2, tag: '0002_watery_mojo' },
    ],
    filePaths: [
      'drizzle/0000_young_lady_bullseye.sql',
      'drizzle/0001_hesitant_war_machine.sql',
      'drizzle/0002_watery_mojo.sql',
      'drizzle/meta/0000_snapshot.json',
      'drizzle/meta/0001_snapshot.json',
    ],
  });

  assert.deepEqual(missing, ['drizzle/meta/0002_snapshot.json']);
});

test('diffFileSnapshots classifies created updated and deleted files deterministically', async () => {
  const diff = diffFileSnapshots({
    before: new Map([
      ['drizzle/meta/_journal.json', 'old'],
      ['drizzle/0001_first.sql', 'sql-a'],
      ['drizzle/0002_second.sql', 'sql-b'],
    ]),
    after: new Map([
      ['drizzle/meta/_journal.json', 'new'],
      ['drizzle/0001_first.sql', 'sql-a'],
      ['drizzle/0003_third.sql', 'sql-c'],
    ]),
  });

  assert.deepEqual(diff, {
    created: ['drizzle/0003_third.sql'],
    updated: ['drizzle/meta/_journal.json'],
    deleted: ['drizzle/0002_second.sql'],
  });
});

test('validateGeneratedMigrationArtifacts accepts one new sql one new snapshot and a journal update', async () => {
  const issues = validateGeneratedMigrationArtifacts({
    created: ['drizzle/0005_new_change.sql', 'drizzle/meta/0005_snapshot.json'],
    updated: ['drizzle/meta/_journal.json'],
    deleted: [],
  });

  assert.deepEqual(issues, []);
});

test('validateGeneratedMigrationArtifacts rejects unexpected edits to historical migration files', async () => {
  const issues = validateGeneratedMigrationArtifacts({
    created: ['drizzle/0005_new_change.sql'],
    updated: ['drizzle/0004_previous.sql'],
    deleted: [],
  });

  assert.equal(issues.some((issue) => issue.includes('exactament un SQL i un snapshot')), true);
  assert.equal(issues.some((issue) => issue.includes('artefactes antics de migracio')), true);
  assert.equal(issues.some((issue) => issue.includes('drizzle/meta/_journal.json')), true);
});
