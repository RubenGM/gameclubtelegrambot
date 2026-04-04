export interface DrizzleJournalEntry {
  idx: number;
  tag: string;
}

export interface FileSnapshotDiff {
  created: string[];
  updated: string[];
  deleted: string[];
}

export function findMissingDrizzleArtifacts({
  entries,
  filePaths,
}: {
  entries: DrizzleJournalEntry[];
  filePaths: string[];
}): string[] {
  const knownFiles = new Set(filePaths);
  const missing: string[] = [];

  for (const entry of entries) {
    const snapshotPrefix = entry.tag.slice(0, 4);
    const migrationPath = `drizzle/${entry.tag}.sql`;
    const snapshotPath = `drizzle/meta/${snapshotPrefix}_snapshot.json`;

    if (!knownFiles.has(migrationPath)) {
      missing.push(migrationPath);
    }

    if (!knownFiles.has(snapshotPath)) {
      missing.push(snapshotPath);
    }
  }

  return missing;
}

export function diffFileSnapshots({
  before,
  after,
}: {
  before: Map<string, string>;
  after: Map<string, string>;
}): FileSnapshotDiff {
  const created: string[] = [];
  const updated: string[] = [];
  const deleted: string[] = [];

  for (const [path, previousContent] of before.entries()) {
    const nextContent = after.get(path);
    if (nextContent === undefined) {
      deleted.push(path);
      continue;
    }

    if (nextContent !== previousContent) {
      updated.push(path);
    }
  }

  for (const path of after.keys()) {
    if (!before.has(path)) {
      created.push(path);
    }
  }

  return {
    created: created.sort(),
    updated: updated.sort(),
    deleted: deleted.sort(),
  };
}

export function validateGeneratedMigrationArtifacts(diff: FileSnapshotDiff): string[] {
  const issues: string[] = [];
  const createdSql = diff.created.filter((path) => /^drizzle\/\d{4}_.+\.sql$/.test(path));
  const createdSnapshots = diff.created.filter((path) => /^drizzle\/meta\/\d{4}_snapshot\.json$/.test(path));
  const createdUnexpected = diff.created.filter(
    (path) => !createdSql.includes(path) && !createdSnapshots.includes(path),
  );
  const updatedUnexpected = diff.updated.filter((path) => path !== 'drizzle/meta/_journal.json');

  if (diff.deleted.length > 0) {
    issues.push(`No es permet eliminar artefactes de migracio: ${diff.deleted.join(', ')}`);
  }

  if (createdSql.length > 1) {
    issues.push(`S han creat massa fitxers SQL de migracio: ${createdSql.join(', ')}`);
  }

  if (createdSnapshots.length > 1) {
    issues.push(`S han creat massa snapshots Drizzle: ${createdSnapshots.join(', ')}`);
  }

  if (createdSql.length !== createdSnapshots.length) {
    issues.push('Cada nova migracio ha de crear exactament un SQL i un snapshot corresponent');
  }

  if (!diff.updated.includes('drizzle/meta/_journal.json')) {
    issues.push('La generacio d una migracio nova ha d actualitzar drizzle/meta/_journal.json');
  }

  if (updatedUnexpected.length > 0) {
    issues.push(`S han modificat artefactes antics de migracio: ${updatedUnexpected.join(', ')}`);
  }

  if (createdUnexpected.length > 0) {
    issues.push(`S han creat fitxers inesperats durant la generacio: ${createdUnexpected.join(', ')}`);
  }

  return issues;
}
