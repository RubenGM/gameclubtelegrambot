import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStartsAt } from './schedule-parsing.js';

test('buildStartsAt interprets schedule input as local time', () => {
  assert.equal(buildStartsAt('2026-04-27', '22:15'), new Date(2026, 3, 27, 22, 15, 0, 0).toISOString());
});
