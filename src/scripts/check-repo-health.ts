import { readFile } from 'node:fs/promises';

import { validateRepoHealth, type RepoHealthFile } from './repo-health.js';

const filePaths = process.argv.slice(2)
  .map((value) => value.trim())
  .filter((value) => value.length > 0 && value.endsWith('.ts'));

if (filePaths.length === 0) {
  throw new Error('Repo health check requires one or more TypeScript file paths.');
}

const files: RepoHealthFile[] = await Promise.all(
  filePaths.map(async (path) => ({
    path,
    content: await readFile(path, 'utf8'),
  })),
);

const issues = validateRepoHealth({ files });
if (issues.length > 0) {
  throw new Error(`Repository health checks failed:\n- ${issues.join('\n- ')}`);
}
