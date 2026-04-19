import {
  ensureBackupDependencies,
  parseRequestedDependencyCommands,
  readBackupDependencyStatus,
} from '../operations/backup-dependencies.js';

const rawArgs = process.argv.slice(2);
const checkOnly = rawArgs.includes('--check-only');
const dependencyArgs = rawArgs.filter((value) => value !== '--check-only');

try {
  const commands = parseRequestedDependencyCommands(
    dependencyArgs.length > 0 ? dependencyArgs : ['pg_dump', 'psql', 'python3'],
  );
  const statuses = checkOnly
    ? await readBackupDependencyStatus(commands)
    : await ensureBackupDependencies({ commands });

  process.stdout.write(`${statuses.map((status) => `${status.command}:${status.state}`).join('\n')}\n`);

  if (statuses.some((status) => status.state !== 'installed')) {
    process.exitCode = 1;
  }
} catch (error) {
  if (error instanceof Error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
