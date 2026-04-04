import { readFileSync } from 'node:fs';

interface PackageJsonLike {
  version?: string;
}

export const APP_VERSION = readAppVersion();

function readAppVersion(): string {
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw) as PackageJsonLike;
    return parsed.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
