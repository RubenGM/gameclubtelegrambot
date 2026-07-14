import assert from 'node:assert/strict';
import test from 'node:test';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { applyMigrations } from '../infrastructure/database/apply-migrations.js';
import {
  connectPostgresDatabase,
  createPostgresConnectionString,
} from '../infrastructure/database/connection.js';
import {
  roleGameCharacterAttachments,
  roleGameCharacterClaimRequests,
  roleGameCharacters,
  roleGameMembers,
  roleGames,
  users,
} from '../infrastructure/database/schema.js';
import { loadIntegrationRuntimeConfig } from '../test/integration-runtime.js';
import { createDatabaseRoleGameRepository } from './role-game-catalog-store.js';
import { createDatabaseRoleGameCharacterRepository } from './role-game-character-store.js';

const integrationConfig = await loadIntegrationRuntimeConfig();
const integrationTest = integrationConfig ? test : test.skip;

integrationTest('PostgreSQL transfers ownership atomically and approves only one rival claim', async () => {
  if (!integrationConfig) throw new Error('Integration runtime config is not available');
  await applyMigrations({ config: integrationConfig });
  const connection = await connectPostgresDatabase({
    connectionString: createPostgresConnectionString(integrationConfig.database),
    ssl: integrationConfig.database.ssl,
    logger: { error: () => {} },
  });
  const seed = createSeed();
  let gameId: number | null = null;
  try {
    await connection.db.insert(users).values([
      approvedUser(seed.gmTelegramUserId, 'GM integration'),
      approvedUser(seed.playerTelegramUserId, 'Player integration'),
      approvedUser(seed.coorganizerTelegramUserId, 'Coorganizer integration'),
    ]);
    const roleGameRepository = createDatabaseRoleGameRepository({ database: connection.db });
    const characterRepository = createDatabaseRoleGameCharacterRepository({ database: connection.db });
    const game = await roleGameRepository.createGame({
      type: 'campaign',
      title: `Characters ${seed.suffix}`,
      system: 'D20',
      description: null,
      visibility: 'members',
      publicJoinPolicy: 'members_only',
      entryMode: 'request',
      acceptanceMode: 'manual_review',
      capacity: 6,
      primaryGmTelegramUserId: seed.gmTelegramUserId,
      createdByTelegramUserId: seed.gmTelegramUserId,
      defaultDurationMinutes: 180,
      defaultTableId: null,
      defaultAttendanceMode: 'closed',
      defaultIsPublicScheduleEvent: false,
      autoAddConfirmedPlayers: false,
      allowPlayerManualScheduling: false,
      schedulingMode: 'manual',
      recurrenceRule: null,
      recurrenceWindowCount: 0,
    });
    gameId = game.id;
    assert.ok(roleGameRepository.createMaterialCategory);
    assert.ok(roleGameRepository.listMaterialCategories);
    const materialCategory = await roleGameRepository.createMaterialCategory({
      roleGameId: game.id,
      parentCategoryId: null,
      name: `Lore ${seed.suffix}`,
      createdByTelegramUserId: seed.gmTelegramUserId,
    });
    const materialSubcategory = await roleGameRepository.createMaterialCategory({
      roleGameId: game.id,
      parentCategoryId: materialCategory.id,
      name: `NPC ${seed.suffix}`,
      createdByTelegramUserId: seed.gmTelegramUserId,
    });
    assert.equal(materialSubcategory.parentCategoryId, materialCategory.id);
    assert.deepEqual(
      (await roleGameRepository.listMaterialCategories(game.id)).map((category) => category.id).sort((left, right) => left - right),
      [materialCategory.id, materialSubcategory.id].sort((left, right) => left - right),
    );
    const player = await roleGameRepository.createMember({
      roleGameId: game.id,
      telegramUserId: seed.playerTelegramUserId,
      role: 'player',
      status: 'confirmed',
      isExternal: false,
      playerNote: null,
      requestedByTelegramUserId: seed.gmTelegramUserId,
    });
    const coorganizer = await roleGameRepository.createMember({
      roleGameId: game.id,
      telegramUserId: seed.coorganizerTelegramUserId,
      role: 'coorganizer',
      status: 'confirmed',
      isExternal: false,
      playerNote: null,
      requestedByTelegramUserId: seed.gmTelegramUserId,
    });
    const character = await characterRepository.createCharacter({
      roleGameId: game.id,
      assignedMemberId: player.id,
      name: 'Nyra',
      description: null,
      externalUrl: null,
      visibility: 'players',
      createdByTelegramUserId: seed.playerTelegramUserId,
    });

    const renamed = await characterRepository.updateCharacter({
      characterId: character.id,
      expectedUpdatedAt: character.updatedAt,
      name: 'Nyra renamed',
      description: null,
      externalUrl: null,
      visibility: 'players',
      actorTelegramUserId: seed.playerTelegramUserId,
    });
    assert.equal(renamed.name, 'Nyra renamed');

    const transferred = await characterRepository.transferCharacter({
      characterId: character.id,
      expectedAssignedMemberId: player.id,
      assignedMemberId: coorganizer.id,
      actorTelegramUserId: seed.gmTelegramUserId,
    });
    assert.equal(transferred.assignedMemberId, coorganizer.id);

    const free = await characterRepository.unassignCharacter({
      characterId: character.id,
      expectedAssignedMemberId: coorganizer.id,
      actorTelegramUserId: seed.gmTelegramUserId,
    });
    assert.equal(free.assignedMemberId, null);

    const playerRequest = await characterRepository.createClaimRequest({
      characterId: character.id,
      requestedByMemberId: player.id,
    });
    const coorganizerRequest = await characterRepository.createClaimRequest({
      characterId: character.id,
      requestedByMemberId: coorganizer.id,
    });
    const results = await Promise.allSettled([
      characterRepository.resolveClaimRequest({
        requestId: playerRequest.id,
        status: 'approved',
        expectedStatus: 'requested',
        actorTelegramUserId: seed.gmTelegramUserId,
      }),
      characterRepository.resolveClaimRequest({
        requestId: coorganizerRequest.id,
        status: 'approved',
        expectedStatus: 'requested',
        actorTelegramUserId: seed.gmTelegramUserId,
      }),
    ]);

    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    const claims = await characterRepository.listClaimRequests({ roleGameId: game.id });
    assert.deepEqual(claims.map((claim) => claim.status).sort(), ['approved', 'cancelled']);
    const current = await characterRepository.findCharacterById(character.id);
    assert.ok(current?.assignedMemberId === player.id || current?.assignedMemberId === coorganizer.id);

    const lifecycleCharacter = await characterRepository.createCharacter({
      roleGameId: game.id,
      assignedMemberId: player.id,
      name: 'Lifecycle',
      description: null,
      externalUrl: null,
      visibility: 'private',
      createdByTelegramUserId: seed.playerTelegramUserId,
    });
    await roleGameRepository.setMemberRole({
      memberId: player.id,
      role: 'coorganizer',
      expectedRole: 'player',
      expectedStatus: 'confirmed',
      actorTelegramUserId: seed.gmTelegramUserId,
    });
    assert.equal(
      (await characterRepository.findCharacterById(lifecycleCharacter.id))?.assignedMemberId,
      player.id,
    );
    await roleGameRepository.setMemberStatus({
      memberId: player.id,
      status: 'removed',
      expectedStatus: 'confirmed',
      expectedRole: 'coorganizer',
      actorTelegramUserId: seed.gmTelegramUserId,
    });
    assert.equal(
      (await characterRepository.findCharacterById(lifecycleCharacter.id))?.assignedMemberId,
      null,
    );
    assert.ok(roleGameRepository.deleteGame);
    await roleGameRepository.deleteGame({
      gameId: game.id,
      deletedByTelegramUserId: seed.gmTelegramUserId,
    });
    assert.equal(await roleGameRepository.findGameById(game.id), null);
    assert.equal(await characterRepository.findCharacterById(character.id), null);
    gameId = null;
  } finally {
    if (gameId !== null) {
      const characterRows = await connection.db
        .select({ id: roleGameCharacters.id })
        .from(roleGameCharacters)
        .where(eq(roleGameCharacters.roleGameId, gameId));
      const characterIds = characterRows.map((row) => row.id);
      if (characterIds.length > 0) {
        await connection.db.delete(roleGameCharacterClaimRequests)
          .where(inArray(roleGameCharacterClaimRequests.characterId, characterIds));
        await connection.db.delete(roleGameCharacterAttachments)
          .where(inArray(roleGameCharacterAttachments.characterId, characterIds));
        await connection.db.delete(roleGameCharacters).where(eq(roleGameCharacters.roleGameId, gameId));
      }
      await connection.db.delete(roleGameMembers).where(eq(roleGameMembers.roleGameId, gameId));
      await connection.db.delete(roleGames).where(eq(roleGames.id, gameId));
    }
    await connection.db.delete(users).where(and(
      inArray(users.telegramUserId, [
        seed.gmTelegramUserId,
        seed.playerTelegramUserId,
        seed.coorganizerTelegramUserId,
      ]),
      sql`${users.displayName} like ${'%integration'}`,
    ));
    await connection.close();
  }
});

function approvedUser(telegramUserId: number, displayName: string) {
  return {
    telegramUserId,
    displayName,
    username: null,
    isApproved: true,
    status: 'approved',
    isAdmin: false,
  };
}

function createSeed() {
  const suffix = `${Date.now()}_${process.pid}_${Math.floor(Math.random() * 100000)}`;
  const base = Number(`8${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 100)}`);
  return {
    suffix,
    gmTelegramUserId: base,
    playerTelegramUserId: base + 1,
    coorganizerTelegramUserId: base + 2,
  };
}
