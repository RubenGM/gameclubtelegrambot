import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTelegramStartUrl, configureTelegramDeepLinks } from './deep-links.js';

test('buildTelegramStartUrl falls back to the production management bot username', () => {
  configureTelegramDeepLinks({ botUsername: null });

  assert.equal(
    buildTelegramStartUrl('storage_category_7'),
    'https://t.me/cawa_management_bot?start=storage_category_7',
  );
});

test('buildTelegramStartUrl uses the configured bot username', () => {
  configureTelegramDeepLinks({ botUsername: '@gameclub_test_bot' });

  assert.equal(
    buildTelegramStartUrl('storage_category_7'),
    'https://t.me/gameclub_test_bot?start=storage_category_7',
  );
});
