import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface PackageJsonLike {
  version?: string;
}

interface WriteBuildVersionOptions {
  packageJsonUrl?: URL;
  outputUrl?: URL;
  now?: Date;
}

export function formatBuildTimestamp(date: Date): string {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');

  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

export function buildTimestampVersion(packageVersion: string, now: Date): string {
  const match = packageVersion.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) {
    throw new Error(`Unsupported package version for build timestamping: ${packageVersion}`);
  }

  const [, major, minor] = match;
  return `${major}.${minor}.${formatBuildTimestamp(now)}`;
}

export async function writeBuildVersion({
  packageJsonUrl = new URL('../../package.json', import.meta.url),
  outputUrl = new URL('../../dist/app-version.json', import.meta.url),
  now = new Date(),
}: WriteBuildVersionOptions = {}): Promise<string> {
  const rawPackageJson = await readFile(packageJsonUrl, 'utf8');
  const parsedPackageJson = JSON.parse(rawPackageJson) as PackageJsonLike;

  if (typeof parsedPackageJson.version !== 'string') {
    throw new Error('package.json does not contain a valid version string');
  }

  const version = buildTimestampVersion(parsedPackageJson.version, now);
  await mkdir(dirname(fileURLToPath(outputUrl)), { recursive: true });
  await writeFile(outputUrl, `${JSON.stringify({ version }, null, 2)}\n`);

  return version;
}

const isEntrypoint = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isEntrypoint) {
  try {
    const version = await writeBuildVersion();
    console.log(version);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
