import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { findMissingDrizzleArtifacts, type DrizzleJournalEntry } from './drizzle-guard.js';

export async function assertDrizzleArtifactsAreComplete({
  projectRoot = process.cwd(),
}: {
  projectRoot?: string;
} = {}): Promise<void> {
  const journalPath = path.join(projectRoot, 'drizzle/meta/_journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
    entries?: DrizzleJournalEntry[];
  };

  const drizzleFiles = (await readdir(path.join(projectRoot, 'drizzle')))
    .filter((entry) => entry.endsWith('.sql'))
    .map((entry) => `drizzle/${entry}`);
  const metaFiles = (await readdir(path.join(projectRoot, 'drizzle/meta'))).map(
    (entry) => `drizzle/meta/${entry}`,
  );

  const missing = findMissingDrizzleArtifacts({
    entries: journal.entries ?? [],
    filePaths: drizzleFiles.concat(metaFiles),
  });

  if (missing.length > 0) {
    throw new Error(
      `L historial de Drizzle no esta complet. Falten aquests artefactes: ${missing.join(', ')}`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await assertDrizzleArtifactsAreComplete();
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
