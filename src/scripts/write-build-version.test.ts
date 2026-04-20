import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTimestampVersion, formatBuildTimestamp } from './write-build-version.js';

test('formatBuildTimestamp renders build time as yyyyMMddHHmmss', () => {
  assert.equal(formatBuildTimestamp(new Date('2026-04-20T11:22:33Z')), '20260420112233');
});

test('buildTimestampVersion replaces the patch segment with the build timestamp', () => {
  assert.equal(buildTimestampVersion('0.3.0', new Date('2026-04-20T11:22:33Z')), '0.3.20260420112233');
});
