import { readFileSync } from 'node:fs';

interface PackageJsonLike {
  version?: string;
}

interface ReadAppVersionOptions {
  buildVersionFileUrl?: URL;
  packageJsonFileUrl?: URL;
}

export const APP_VERSION = readAppVersion();

export function readAppVersion({
  buildVersionFileUrl = new URL('./app-version.json', import.meta.url),
  packageJsonFileUrl = new URL('../package.json', import.meta.url),
}: ReadAppVersionOptions = {}): string {
  return readVersionFromFile(buildVersionFileUrl) ?? readVersionFromFile(packageJsonFileUrl) ?? '0.0.0';
}

function readVersionFromFile(fileUrl: URL): string | null {
  try {
    const raw = readFileSync(fileUrl, 'utf8');
    const parsed = JSON.parse(raw) as PackageJsonLike;
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}
