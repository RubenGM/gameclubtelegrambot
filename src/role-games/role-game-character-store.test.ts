import assert from 'node:assert/strict';
import test from 'node:test';
import { getTableColumns, getTableName } from 'drizzle-orm';

import {
  roleGameCharacterAttachments,
  roleGameCharacterClaimRequests,
  roleGameCharacters,
  roleGameMembers,
} from '../infrastructure/database/schema.js';

test('role game character tables expose normalized ownership, attachment, and claim columns', () => {
  assert.equal(getTableName(roleGameCharacters), 'role_game_characters');
  assert.deepEqual(Object.keys(getTableColumns(roleGameCharacters)), [
    'id',
    'roleGameId',
    'assignedMemberId',
    'name',
    'description',
    'externalUrl',
    'visibility',
    'createdByTelegramUserId',
    'createdAt',
    'updatedAt',
    'assignedAt',
    'unassignedAt',
  ]);
  assert.equal(getTableName(roleGameCharacterAttachments), 'role_game_character_attachments');
  assert.equal(getTableName(roleGameCharacterClaimRequests), 'role_game_character_claim_requests');
  assert.equal('characterName' in getTableColumns(roleGameMembers), false);
  assert.equal('playerNote' in getTableColumns(roleGameMembers), true);
});
