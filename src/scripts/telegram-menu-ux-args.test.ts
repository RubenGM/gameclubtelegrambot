import test from 'node:test';
import assert from 'node:assert/strict';

import { parseTelegramMenuUxArgs } from './telegram-menu-ux-args.js';

test('parseTelegramMenuUxArgs defaults to seven days', () => {
  assert.deepEqual(parseTelegramMenuUxArgs([]), { windowDays: 7 });
});

test('parseTelegramMenuUxArgs accepts an explicit --days value', () => {
  assert.deepEqual(parseTelegramMenuUxArgs(['--days', '30']), { windowDays: 30 });
});

test('parseTelegramMenuUxArgs rejects invalid day values', () => {
  assert.throws(() => parseTelegramMenuUxArgs(['--days', '0']), /--days/);
  assert.throws(() => parseTelegramMenuUxArgs(['--days', 'abc']), /--days/);
});
