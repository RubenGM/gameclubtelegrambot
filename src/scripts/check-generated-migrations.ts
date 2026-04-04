import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

import { diffFileSnapshots } from './drizzle-guard.js';
import { assertDrizzleArtifactsAreComplete } from './check-drizzle-state.js';

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  await assertDrizzleArtifactsAreComplete({ projectRoot });

  const before = await snapshotDrizzleFiles(projectRoot);

  try {
    await runDrizzleGenerate(projectRoot);
    const after = await snapshotDrizzleFiles(projectRoot);
    const diff = diffFileSnapshots({ before, after });

    if (diff.created.length === 0 && diff.updated.length === 0 && diff.deleted.length === 0) {
      console.log('L estat de migracions Drizzle esta sincronitzat amb schema.ts.');
      return;
    }

    throw new Error(
      `Hi ha drift entre schema.ts i les migracions versionades. Canvis detectats: creats [${diff.created.join(', ')}], modificats [${diff.updated.join(', ')}], eliminats [${diff.deleted.join(', ')}]`,
    );
  } finally {
    await restoreDrizzleFiles(projectRoot, before);
  }
}

async function snapshotDrizzleFiles(projectRoot: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  const drizzleDir = path.join(projectRoot, 'drizzle');
  const metaDir = path.join(drizzleDir, 'meta');

  for (const entry of await readdir(drizzleDir)) {
    if (!entry.endsWith('.sql')) {
      continue;
    }

    const relativePath = `drizzle/${entry}`;
    snapshot.set(relativePath, await readFile(path.join(projectRoot, relativePath), 'utf8'));
  }

  for (const entry of await readdir(metaDir)) {
    const relativePath = `drizzle/meta/${entry}`;
    snapshot.set(relativePath, await readFile(path.join(projectRoot, relativePath), 'utf8'));
  }

  return snapshot;
}

async function restoreDrizzleFiles(projectRoot: string, snapshot: Map<string, string>): Promise<void> {
  const current = await snapshotDrizzleFiles(projectRoot);

  for (const pathToDelete of current.keys()) {
    if (!snapshot.has(pathToDelete)) {
      await rm(path.join(projectRoot, pathToDelete));
    }
  }

  for (const [relativePath, content] of snapshot.entries()) {
    await writeFile(path.join(projectRoot, relativePath), content);
  }
}

async function runDrizzleGenerate(projectRoot: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('npx', ['drizzle-kit', 'generate'], {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: false,
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`drizzle-kit generate ha fallat amb codi ${code ?? 'desconegut'}`));
    });
    child.on('error', reject);
  });
}

try {
  await main();
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
