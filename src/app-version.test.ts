import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

import { readAppVersion } from './app-version.js';

test('readAppVersion prefers the generated build version when it exists', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'gameclub-app-version-'));
  const buildVersionPath = join(tempDir, 'app-version.json');
  const packageJsonPath = join(tempDir, 'package.json');

  writeFileSync(buildVersionPath, JSON.stringify({ version: '0.3.20260420112233' }));
  writeFileSync(packageJsonPath, JSON.stringify({ version: '0.4.0' }));

  assert.equal(
    readAppVersion({
      buildVersionFileUrl: pathToFileURL(buildVersionPath),
      packageJsonFileUrl: pathToFileURL(packageJsonPath),
    }),
    '0.3.20260420112233',
  );
});

test('readAppVersion falls back to package.json when there is no generated build version', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'gameclub-app-version-'));
  const buildVersionPath = join(tempDir, 'missing-app-version.json');
  const packageJsonPath = join(tempDir, 'package.json');

  writeFileSync(packageJsonPath, JSON.stringify({ version: '0.4.0' }));

  assert.equal(
    readAppVersion({
      buildVersionFileUrl: pathToFileURL(buildVersionPath),
      packageJsonFileUrl: pathToFileURL(packageJsonPath),
    }),
    '0.4.0',
  );
});
