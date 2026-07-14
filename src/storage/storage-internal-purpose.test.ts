import test from 'node:test';
import assert from 'node:assert/strict';

import {
  internalRoleGameHandoutPurpose,
  isUserVisibleStorageCategoryPurpose,
} from './storage-internal-purpose.js';

test('isUserVisibleStorageCategoryPurpose keeps internal storage purposes hidden', () => {
  assert.equal(internalRoleGameHandoutPurpose, 'role_game_handouts');
  assert.equal(isUserVisibleStorageCategoryPurpose('user_uploads'), true);
  assert.equal(isUserVisibleStorageCategoryPurpose('catalog_media'), false);
  assert.equal(isUserVisibleStorageCategoryPurpose('role_game_handouts'), false);
});
