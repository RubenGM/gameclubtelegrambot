import test from 'node:test';
import assert from 'node:assert/strict';

import { formatTimestamp } from './schedule-presentation.js';

test('formatTimestamp displays schedule timestamps in local time', () => {
  const localInstant = new Date(2026, 3, 27, 22, 15, 0, 0).toISOString();

  assert.equal(formatTimestamp(localInstant), '27/04/2026 22:15');
});
