import test from 'node:test';
import assert from 'node:assert/strict';

import {
  handleTelegramRoleGameCallback,
  handleTelegramRoleGameMessage,
  handleTelegramRoleGameStartText,
  handleTelegramRoleGameText,
  roleGameCallbackPrefixes,
} from './role-game-flow.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import type {
  CreateRoleGameMaterialDeliveryInput,
  CreateRoleGameMaterialInput,
  CreateRoleGameInput,
  CreateRoleGameSessionLinkInput,
  RoleGameMaterialDeliveryRecord,
  RoleGameMaterialRecord,
  RoleGameMemberRecord,
  RoleGameRecord,
  RoleGameRepository,
  RoleGameSessionRecord,
} from '../role-games/role-game-catalog.js';
import type {
  ScheduleEventRecord,
  ScheduleParticipantRecord,
  ScheduleRepository,
} from '../schedule/schedule-catalog.js';
import type {
  StorageCategoryRecord,
  StorageCategoryRepository,
  StorageEntryDetailRecord,
  StorageEntryMessageInput,
} from '../storage/storage-catalog.js';
import type { MembershipAccessRepository, MembershipUserRecord } from '../membership/access-flow.js';
import type { TelegramReplyKeyboardButton } from './runtime-boundary.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

type FakeRoleGameRepository = RoleGameRepository & { createdSessionLinks: RoleGameSessionRecord[] };

test('handleTelegramRoleGameText opens the role game home menu', async () => {
  const context = createRoleGameTestContext({ messageText: '/rol' });
  const handled = await handleTelegramRoleGameText(context);

  assert.equal(handled, true);
  assert.match(lastReply(context).message, /Rol/);
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.at(0)?.map(buttonText), ['Mis partidas', 'Partidas visibles']);
});

test('handleTelegramRoleGameText shows an empty my-games list', async () => {
  const context = createRoleGameTestContext({ messageText: 'Mis partidas' });
  const handled = await handleTelegramRoleGameText(context);

  assert.equal(handled, true);
  assert.match(lastReply(context).message, /No tienes partidas de rol activas/);
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.flat().map(buttonText), [
    'Mis partidas',
    'Partidas visibles',
    'Crear partida',
    'Cancelar',
    'Inicio',
    'Ayuda',
  ]);
});

test('handleTelegramRoleGameText paginates visible games with deep links', async () => {
  const games = Array.from({ length: 6 }, (_, index) => sampleRoleGame({ id: index + 1, title: `Partida ${index + 1}` }));
  const context = createRoleGameTestContext({
    messageText: 'Partidas visibles',
    roleGameRepository: createFakeRoleGameRepository({ visibleGames: games }),
  });

  const handled = await handleTelegramRoleGameText(context);

  assert.equal(handled, true);
  assert.match(lastReply(context).message, /Partidas visibles/);
  assert.match(lastReply(context).message, /Partida 1/);
  assert.match(lastReply(context).message, /role_game_1/);
  assert.match(lastReply(context).message, /Mostrando 1-5 de 6\. Página 1\/2\./);
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.at(0)?.map(buttonText), ['Siguiente']);
  assert.equal(lastReply(context).options?.parseMode, 'HTML');
});

test('handleTelegramRoleGameText shows the second visible-games page', async () => {
  const games = Array.from({ length: 6 }, (_, index) => sampleRoleGame({ id: index + 1, title: `Partida ${index + 1}` }));
  const context = createRoleGameTestContext({
    messageText: 'Siguiente',
    roleGameRepository: createFakeRoleGameRepository({ visibleGames: games }),
    session: {
      current: {
        key: 'telegram.session:1:42',
        flowKey: 'role-games-list',
        stepKey: 'visible',
        data: { listKind: 'visible', page: 1, totalItems: 6 },
        createdAt: '2026-07-09T10:00:00.000Z',
        updatedAt: '2026-07-09T10:00:00.000Z',
        expiresAt: '2026-07-09T11:00:00.000Z',
      },
    },
  });

  const handled = await handleTelegramRoleGameText(context);

  assert.equal(handled, true);
  assert.match(lastReply(context).message, /Partida 6/);
  assert.match(lastReply(context).message, /Mostrando 6-6 de 6\. Página 2\/2\./);
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.at(0)?.map(buttonText), ['Anterior']);
});

test('handleTelegramRoleGameStartText opens role game details from a deep link', async () => {
  const game = sampleRoleGame({ id: 23, title: 'La crida de Cthulhu', system: 'Call of Cthulhu' });
  const context = createRoleGameTestContext({
    messageText: '/start role_game_23',
    roleGameRepository: createFakeRoleGameRepository({ visibleGames: [game], gamesById: [game] }),
  });

  const handled = await handleTelegramRoleGameStartText(context);

  assert.equal(handled, true);
  assert.match(lastReply(context).message, /La crida de Cthulhu/);
  assert.match(lastReply(context).message, /Call of Cthulhu/);
  assert.equal(lastReply(context).options?.parseMode, 'HTML');
});

test('role game detail uses a persistent section keyboard without inline buttons', async () => {
  const game = sampleRoleGame({ id: 31, primaryGmTelegramUserId: 42, allowPlayerManualScheduling: true });
  const context = createRoleGameTestContext({
    messageText: '/start role_game_31',
    roleGameRepository: createFakeRoleGameRepository({ visibleGames: [game], gamesById: [game] }),
  });

  const handled = await handleTelegramRoleGameStartText(context);

  assert.equal(handled, true);
  assert.equal(lastReply(context).options?.inlineKeyboard, undefined);
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.map((row) => row.map(buttonText)), [
    ['Participantes'],
    ['Sesiones', 'Materiales'],
    ['Invitar', 'Configurar'],
    ['Volver a mis partidas'],
    ['Inicio', 'Ayuda'],
  ]);
  assert.deepEqual(getCurrentSession(context)?.data, { gameId: game.id, view: 'dashboard' });
  assert.equal(getCurrentSession(context)?.flowKey, 'role-game-detail');
});

test('role game participants button renders an identity-aware active list from the pending dashboard label', async () => {
  const game = sampleRoleGame({ id: 311, primaryGmTelegramUserId: 42 });
  const members = [
    sampleRoleGameMember({ id: 3111, roleGameId: game.id, telegramUserId: 101, role: 'player', status: 'requested' }),
    sampleRoleGameMember({ id: 3112, roleGameId: game.id, telegramUserId: 102, role: 'player', status: 'waitlisted' }),
    sampleRoleGameMember({ id: 3113, roleGameId: game.id, telegramUserId: 103, role: 'coorganizer', status: 'confirmed' }),
    sampleRoleGameMember({ id: 3114, roleGameId: game.id, telegramUserId: 104, role: 'player', status: 'confirmed' }),
    sampleRoleGameMember({ id: 3115, roleGameId: game.id, telegramUserId: 105, role: 'player', status: 'invited' }),
  ];
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId: new Map([[game.id, members]]),
    }),
    membershipRepository: createFakeMembershipRepository([
      sampleMembershipUser({ telegramUserId: 101, displayName: 'Solicitud', username: 'solicitud_rpg' }),
      sampleMembershipUser({ telegramUserId: 102, displayName: 'Espera' }),
      sampleMembershipUser({ telegramUserId: 103, displayName: 'Coorg' }),
      sampleMembershipUser({ telegramUserId: 104, displayName: 'Jugadora' }),
      sampleMembershipUser({ telegramUserId: 105, displayName: 'Invitada' }),
    ]),
  });

  assert.equal(await handleTelegramRoleGameStartText(context), true);
  await sendRoleGameText(context, 'Participantes · 1 pendientes');

  assert.match(lastReply(context).message, /Participantes de Partida de prueba/);
  assert.match(lastReply(context).message, /<a href="https:\/\/t\.me\/solicitud_rpg">Solicitud \(@solicitud_rpg\)<\/a>/);
  assert.match(lastReply(context).message, /Solicitudes pendientes/);
  assert.match(lastReply(context).message, /En espera/);
  assert.match(lastReply(context).message, /Coorganizadores/);
  assert.match(lastReply(context).message, /Jugadores confirmados/);
  assert.match(lastReply(context).message, /Invitados/);
  assert.equal(lastReply(context).options?.inlineKeyboard, undefined);
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.map((row) => row.map(buttonText)), [
    ['Solicitud'],
    ['Espera'],
    ['Coorg'],
    ['Jugadora'],
    ['Invitada'],
    ['Historial'],
    ['Volver a la partida'],
    ['Inicio', 'Ayuda'],
  ]);
  assert.deepEqual(getCurrentSession(context)?.data, {
    gameId: game.id,
    view: 'participants',
    page: 1,
    total: 5,
    memberButtons: {
      Solicitud: 3111,
      Espera: 3112,
      Coorg: 3113,
      Jugadora: 3114,
      Invitada: 3115,
    },
  });
});

test('role game dashboard keeps the plain Participantes label when there are zero pending requests', async () => {
  const game = sampleRoleGame({ id: 312, primaryGmTelegramUserId: 42 });
  const members = [sampleRoleGameMember({ id: 3121, roleGameId: game.id, telegramUserId: 101, status: 'confirmed' })];
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId: new Map([[game.id, members]]),
    }),
  });

  assert.equal(await handleTelegramRoleGameStartText(context), true);
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.at(0)?.map(buttonText), ['Participantes']);

  assert.equal(await sendRoleGameText(context, 'Participantes'), true);
  assert.match(lastReply(context).message, /Usuario 101/);
  assert.equal(getCurrentSession(context)?.data?.view, 'participants');
});

test('role game participant pages clamp after active members disappear and only render valid navigation', async () => {
  const game = sampleRoleGame({ id: 313, primaryGmTelegramUserId: 42 });
  const members = Array.from({ length: 7 }, (_, index) => sampleRoleGameMember({
    id: 3130 + index,
    roleGameId: game.id,
    telegramUserId: 110 + index,
    status: 'confirmed',
  }));
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId: new Map([[game.id, members]]),
    }),
  });

  assert.equal(await handleTelegramRoleGameStartText(context), true);
  await sendRoleGameText(context, 'Participantes');
  assert.match(lastReply(context).message, /Mostrando 1-6 de 7\. Página 1\/2\./);
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.at(6)?.map(buttonText), ['Siguiente']);

  await sendRoleGameText(context, 'Siguiente');
  assert.match(lastReply(context).message, /Mostrando 7-7 de 7\. Página 2\/2\./);
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.at(1)?.map(buttonText), ['Anterior']);

  members.pop();
  await sendRoleGameText(context, 'Siguiente');
  assert.doesNotMatch(lastReply(context).message, /Página/);
  assert.equal(getCurrentSession(context)?.data?.page, 1);
  assert.ok(!lastReply(context).options?.replyKeyboard?.flat().some((button) => ['Anterior', 'Siguiente'].includes(buttonText(button))));
});

test('role game history is paginated separately and excludes active participants', async () => {
  const game = sampleRoleGame({ id: 314, primaryGmTelegramUserId: 42 });
  const members = [
    sampleRoleGameMember({ id: 3141, roleGameId: game.id, telegramUserId: 101, status: 'confirmed' }),
    sampleRoleGameMember({ id: 3142, roleGameId: game.id, telegramUserId: 102, status: 'left' }),
    sampleRoleGameMember({ id: 3143, roleGameId: game.id, telegramUserId: 103, status: 'removed' }),
    sampleRoleGameMember({ id: 3144, roleGameId: game.id, telegramUserId: 104, status: 'rejected' }),
  ];
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId: new Map([[game.id, members]]),
    }),
  });

  assert.equal(await handleTelegramRoleGameStartText(context), true);
  await sendRoleGameText(context, 'Participantes');
  await sendRoleGameText(context, 'Historial');

  assert.match(lastReply(context).message, /Han salido/);
  assert.match(lastReply(context).message, /Expulsados/);
  assert.match(lastReply(context).message, /Rechazados/);
  assert.doesNotMatch(lastReply(context).message, /Usuario 101/);
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.map((row) => row.map(buttonText)), [
    ['Usuario 102'],
    ['Usuario 103'],
    ['Usuario 104'],
    ['Participantes actuales'],
    ['Volver a la partida'],
    ['Inicio', 'Ayuda'],
  ]);
  assert.equal(getCurrentSession(context)?.data?.view, 'history');
  assert.equal(getCurrentSession(context)?.data?.total, 3);
});

test('role game participant list rejects forged labels outside the current member button map', async () => {
  const game = sampleRoleGame({ id: 315, primaryGmTelegramUserId: 42 });
  const members = [sampleRoleGameMember({ id: 3151, roleGameId: game.id, telegramUserId: 101, status: 'confirmed' })];
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId: new Map([[game.id, members]]),
    }),
  });

  assert.equal(await handleTelegramRoleGameStartText(context), true);
  await sendRoleGameText(context, 'Participantes');
  const replyCount = context.replies.length;

  assert.equal(await sendRoleGameText(context, 'Persona forjada'), false);
  assert.equal(context.replies.length, replyCount);
  assert.equal(getCurrentSession(context)?.data?.selectedMemberId, undefined);
});

test('role game participant list selects only a rendered member button for the read-only detail view', async () => {
  const game = sampleRoleGame({ id: 316, primaryGmTelegramUserId: 42 });
  const member = sampleRoleGameMember({ id: 3161, roleGameId: game.id, telegramUserId: 101, status: 'confirmed' });
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId: new Map([[game.id, [member]]]),
    }),
  });

  assert.equal(await handleTelegramRoleGameStartText(context), true);
  await sendRoleGameText(context, 'Participantes');

  assert.equal(await sendRoleGameText(context, 'Usuario 101'), true);
  assert.match(lastReply(context).message, /Participante/);
  assert.match(lastReply(context).message, /Usuario 101/);
  assert.deepEqual(getCurrentSession(context)?.data, {
    gameId: game.id,
    view: 'participant-detail',
    page: 1,
    total: 1,
    memberButtons: { 'Usuario 101': member.id },
    selectedMemberId: member.id,
  });
});

test('primary GM can promote a confirmed player after confirmation and sends a notification', async () => {
  const game = sampleRoleGame({ id: 317, primaryGmTelegramUserId: 42 });
  const player = sampleRoleGameMember({ id: 3171, roleGameId: game.id, telegramUserId: 101, status: 'confirmed' });
  const sentMessages: Array<{ telegramUserId: number; message: string }> = [];
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({ gamesById: [game], membersByGameId: new Map([[game.id, [player]]]) }),
    onSendPrivateMessage: async (telegramUserId, message) => {
      sentMessages.push({ telegramUserId, message });
    },
  });

  await openRoleGameParticipant(context, 'Usuario 101');
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.at(0)?.map(buttonText), ['Hacer coorganizador', 'Eliminar']);
  await sendRoleGameText(context, 'Hacer coorganizador');
  assert.match(lastReply(context).message, /confirma/i);
  await sendRoleGameText(context, 'Confirmar');

  assert.equal((await context.roleGameRepository.findMemberById(player.id))?.role, 'coorganizer');
  assert.deepEqual(sentMessages, [{ telegramUserId: player.telegramUserId, message: 'Ahora eres coorganizador de Partida de prueba.' }]);
  assert.equal(getCurrentSession(context)?.data?.view, 'participants');
});

test('coorganizer can only confirm or reject requested participants', async () => {
  const game = sampleRoleGame({ id: 318, primaryGmTelegramUserId: 42 });
  const coorganizer = sampleRoleGameMember({ id: 3180, roleGameId: game.id, telegramUserId: 99, role: 'coorganizer', status: 'confirmed' });
  const requested = sampleRoleGameMember({ id: 3181, roleGameId: game.id, telegramUserId: 101, status: 'requested' });
  const confirmed = sampleRoleGameMember({ id: 3182, roleGameId: game.id, telegramUserId: 102, status: 'confirmed' });
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    actor: { telegramUserId: coorganizer.telegramUserId },
    roleGameRepository: createFakeRoleGameRepository({ gamesById: [game], membersByGameId: new Map([[game.id, [coorganizer, requested, confirmed]]]) }),
  });

  await openRoleGameParticipant(context, 'Usuario 101');
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.slice(0, 2).map((row) => row.map(buttonText)), [
    ['Confirmar', 'Rechazar'],
    ['Volver a la partida'],
  ]);
  await sendRoleGameText(context, 'Rechazar');
  await sendRoleGameText(context, 'Confirmar');
  assert.equal((await context.roleGameRepository.findMemberById(requested.id))?.status, 'rejected');

  await sendRoleGameText(context, 'Participantes');
  await sendRoleGameText(context, 'Usuario 102');
  assert.ok(!lastReply(context).options?.replyKeyboard?.flat().some((button) => buttonText(button) === 'Hacer coorganizador'));
  assert.ok(!lastReply(context).options?.replyKeyboard?.flat().some((button) => buttonText(button) === 'Eliminar'));
});

test('admin has full participant management without a membership', async () => {
  const game = sampleRoleGame({ id: 319, primaryGmTelegramUserId: 42 });
  const player = sampleRoleGameMember({ id: 3191, roleGameId: game.id, telegramUserId: 101, status: 'confirmed' });
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    actor: { telegramUserId: 7, isAdmin: true },
    roleGameRepository: createFakeRoleGameRepository({ gamesById: [game], membersByGameId: new Map([[game.id, [player]]]) }),
  });

  await openRoleGameParticipant(context, 'Usuario 101');
  await sendRoleGameText(context, 'Hacer coorganizador');
  await sendRoleGameText(context, 'Confirmar');

  assert.equal((await context.roleGameRepository.findMemberById(player.id))?.role, 'coorganizer');
});

test('participant detail protects the primary GM and keeps history read-only', async () => {
  const game = sampleRoleGame({ id: 320, primaryGmTelegramUserId: 42 });
  const primaryGm = sampleRoleGameMember({ id: 3200, roleGameId: game.id, telegramUserId: 42, role: 'primary_gm', status: 'confirmed' });
  const formerPlayer = sampleRoleGameMember({ id: 3201, roleGameId: game.id, telegramUserId: 101, status: 'removed' });
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({ gamesById: [game], membersByGameId: new Map([[game.id, [primaryGm, formerPlayer]]]) }),
  });

  await openRoleGameParticipant(context, 'Usuario 42');
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.map((row) => row.map(buttonText)), [
    ['Volver a la partida'],
    ['Inicio', 'Ayuda'],
  ]);

  await sendRoleGameText(context, 'Volver a la partida');
  await sendRoleGameText(context, 'Participantes');
  await sendRoleGameText(context, 'Historial');
  assert.equal(getCurrentSession(context)?.data?.view, 'history');
  await sendRoleGameText(context, 'Usuario 101');
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.map((row) => row.map(buttonText)), [
    ['Volver a la partida'],
    ['Inicio', 'Ayuda'],
  ]);
});

test('confirmation recovers from stale participant state without changing it', async () => {
  const game = sampleRoleGame({ id: 321, primaryGmTelegramUserId: 42 });
  const requested = sampleRoleGameMember({ id: 3211, roleGameId: game.id, telegramUserId: 101, status: 'requested' });
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({ gamesById: [game], membersByGameId: new Map([[game.id, [requested]]]) }),
  });

  await openRoleGameParticipant(context, 'Usuario 101');
  await sendRoleGameText(context, 'Confirmar');
  requested.status = 'confirmed';
  await sendRoleGameText(context, 'Confirmar');

  assert.ok(context.replies.some((reply) => /ha cambiado/i.test(reply.message)));
  assert.equal((await context.roleGameRepository.findMemberById(requested.id))?.status, 'confirmed');
  assert.equal(getCurrentSession(context)?.data?.view, 'participants');
});

test('confirmation reports a full game without changing the selected request', async () => {
  const game = sampleRoleGame({ id: 322, primaryGmTelegramUserId: 42, capacity: 1 });
  const requested = sampleRoleGameMember({ id: 3221, roleGameId: game.id, telegramUserId: 101, status: 'requested' });
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId: new Map([[game.id, [requested]]]),
      onConfirmMemberSeat: async () => { throw new Error(`Role game ${game.id} is full`); },
    }),
  });

  await openRoleGameParticipant(context, 'Usuario 101');
  await sendRoleGameText(context, 'Confirmar');
  await sendRoleGameText(context, 'Confirmar');

  assert.ok(context.replies.some((reply) => /completa/i.test(reply.message)));
  assert.equal((await context.roleGameRepository.findMemberById(requested.id))?.status, 'requested');
});

test('primary GM can cancel an invitation and remove waitlisted and confirmed players', async () => {
  const game = sampleRoleGame({ id: 323, primaryGmTelegramUserId: 42 });
  const invited = sampleRoleGameMember({ id: 3231, roleGameId: game.id, telegramUserId: 101, status: 'invited' });
  const waitlisted = sampleRoleGameMember({ id: 3232, roleGameId: game.id, telegramUserId: 102, status: 'waitlisted' });
  const confirmed = sampleRoleGameMember({ id: 3233, roleGameId: game.id, telegramUserId: 103, status: 'confirmed' });
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({ gamesById: [game], membersByGameId: new Map([[game.id, [invited, waitlisted, confirmed]]]) }),
  });

  await openRoleGameParticipant(context, 'Usuario 101');
  await sendRoleGameText(context, 'Cancelar invitación');
  await sendRoleGameText(context, 'Confirmar');
  assert.equal((await context.roleGameRepository.findMemberById(invited.id))?.status, 'removed');

  await sendRoleGameText(context, 'Participantes');
  await sendRoleGameText(context, 'Usuario 102');
  await sendRoleGameText(context, 'Eliminar');
  await sendRoleGameText(context, 'Confirmar');
  assert.equal((await context.roleGameRepository.findMemberById(waitlisted.id))?.status, 'removed');

  await sendRoleGameText(context, 'Participantes');
  await sendRoleGameText(context, 'Usuario 103');
  await sendRoleGameText(context, 'Eliminar');
  await sendRoleGameText(context, 'Confirmar');
  assert.equal((await context.roleGameRepository.findMemberById(confirmed.id))?.status, 'removed');
});

test('primary GM can demote a confirmed coorganizer', async () => {
  const game = sampleRoleGame({ id: 324, primaryGmTelegramUserId: 42 });
  const coorganizer = sampleRoleGameMember({ id: 3241, roleGameId: game.id, telegramUserId: 101, role: 'coorganizer', status: 'confirmed' });
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({ gamesById: [game], membersByGameId: new Map([[game.id, [coorganizer]]]) }),
  });

  await openRoleGameParticipant(context, 'Usuario 101');
  await sendRoleGameText(context, 'Quitar coorganizador');
  await sendRoleGameText(context, 'Confirmar');

  assert.equal((await context.roleGameRepository.findMemberById(coorganizer.id))?.role, 'player');
});

test('notification failure does not roll back a confirmed participant change', async () => {
  const game = sampleRoleGame({ id: 325, primaryGmTelegramUserId: 42 });
  const requested = sampleRoleGameMember({ id: 3251, roleGameId: game.id, telegramUserId: 101, status: 'requested' });
  const warnings: Array<{ bindings: object; message: string }> = [];
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({ gamesById: [game], membersByGameId: new Map([[game.id, [requested]]]) }),
    onSendPrivateMessage: async () => { throw new Error('Forbidden'); },
    onWarning: (bindings, message) => warnings.push({ bindings, message }),
  });

  await openRoleGameParticipant(context, 'Usuario 101');
  await sendRoleGameText(context, 'Confirmar');
  await sendRoleGameText(context, 'Confirmar');

  assert.equal((await context.roleGameRepository.findMemberById(requested.id))?.status, 'confirmed');
  assert.equal(getCurrentSession(context)?.data?.view, 'participants');
  assert.deepEqual(warnings, [{
    bindings: {
      gameId: game.id,
      memberId: requested.id,
      recipientTelegramUserId: requested.telegramUserId,
      action: 'confirm',
      error: 'Forbidden',
    },
    message: 'role-game.participant-notification.failed',
  }]);
});

test('clears the pending participant action before refreshed-list reconstruction can fail', async () => {
  const game = sampleRoleGame({ id: 326, primaryGmTelegramUserId: 42 });
  const requested = sampleRoleGameMember({ id: 3261, roleGameId: game.id, telegramUserId: 101, status: 'requested' });
  const membersByGameId = new Map([[game.id, [requested]]]);
  let failListReconstruction = false;
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId,
      onListMembers: async (gameId) => {
        if (failListReconstruction) {
          throw new Error('participant list reconstruction failed');
        }
        return membersByGameId.get(gameId) ?? [];
      },
    }),
  });

  await openRoleGameParticipant(context, 'Usuario 101');
  await sendRoleGameText(context, 'Confirmar');
  failListReconstruction = true;

  await assert.rejects(sendRoleGameText(context, 'Confirmar'), /participant list reconstruction failed/);
  assert.equal((await context.roleGameRepository.findMemberById(requested.id))?.status, 'confirmed');
  assert.notEqual(getCurrentSession(context)?.data?.view, 'confirm-action');
  assert.equal(getCurrentSession(context)?.data?.pendingAction, undefined);
});

test('coorganizer can confirm a requested participant after confirmation', async () => {
  const game = sampleRoleGame({ id: 327, primaryGmTelegramUserId: 42 });
  const coorganizer = sampleRoleGameMember({ id: 3270, roleGameId: game.id, telegramUserId: 99, role: 'coorganizer', status: 'confirmed' });
  const requested = sampleRoleGameMember({ id: 3271, roleGameId: game.id, telegramUserId: 101, status: 'requested' });
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    actor: { telegramUserId: coorganizer.telegramUserId },
    roleGameRepository: createFakeRoleGameRepository({ gamesById: [game], membersByGameId: new Map([[game.id, [coorganizer, requested]]]) }),
  });

  await openRoleGameParticipant(context, 'Usuario 101');
  await sendRoleGameText(context, 'Confirmar');
  await sendRoleGameText(context, 'Confirmar');

  assert.equal((await context.roleGameRepository.findMemberById(requested.id))?.status, 'confirmed');
});

test('primary GM can confirm an invited participant after confirmation', async () => {
  const game = sampleRoleGame({ id: 328, primaryGmTelegramUserId: 42 });
  const invited = sampleRoleGameMember({ id: 3281, roleGameId: game.id, telegramUserId: 101, status: 'invited' });
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({ gamesById: [game], membersByGameId: new Map([[game.id, [invited]]]) }),
  });

  await openRoleGameParticipant(context, 'Usuario 101');
  await sendRoleGameText(context, 'Confirmar');
  await sendRoleGameText(context, 'Confirmar');

  assert.equal((await context.roleGameRepository.findMemberById(invited.id))?.status, 'confirmed');
});

test('primary GM can confirm a waitlisted participant after confirmation', async () => {
  const game = sampleRoleGame({ id: 329, primaryGmTelegramUserId: 42 });
  const waitlisted = sampleRoleGameMember({ id: 3291, roleGameId: game.id, telegramUserId: 101, status: 'waitlisted' });
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({ gamesById: [game], membersByGameId: new Map([[game.id, [waitlisted]]]) }),
  });

  await openRoleGameParticipant(context, 'Usuario 101');
  await sendRoleGameText(context, 'Confirmar');
  await sendRoleGameText(context, 'Confirmar');

  assert.equal((await context.roleGameRepository.findMemberById(waitlisted.id))?.status, 'confirmed');
});

test('primary GM can remove a confirmed coorganizer after confirmation', async () => {
  const game = sampleRoleGame({ id: 330, primaryGmTelegramUserId: 42 });
  const coorganizer = sampleRoleGameMember({ id: 3301, roleGameId: game.id, telegramUserId: 101, role: 'coorganizer', status: 'confirmed' });
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({ gamesById: [game], membersByGameId: new Map([[game.id, [coorganizer]]]) }),
  });

  await openRoleGameParticipant(context, 'Usuario 101');
  await sendRoleGameText(context, 'Eliminar');
  await sendRoleGameText(context, 'Confirmar');

  assert.equal((await context.roleGameRepository.findMemberById(coorganizer.id))?.status, 'removed');
});

test('admin can cancel an invitation beyond promotion', async () => {
  const game = sampleRoleGame({ id: 331, primaryGmTelegramUserId: 42 });
  const invited = sampleRoleGameMember({ id: 3311, roleGameId: game.id, telegramUserId: 101, status: 'invited' });
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    actor: { telegramUserId: 7, isAdmin: true },
    roleGameRepository: createFakeRoleGameRepository({ gamesById: [game], membersByGameId: new Map([[game.id, [invited]]]) }),
  });

  await openRoleGameParticipant(context, 'Usuario 101');
  await sendRoleGameText(context, 'Cancelar invitación');
  await sendRoleGameText(context, 'Confirmar');

  assert.equal((await context.roleGameRepository.findMemberById(invited.id))?.status, 'removed');
});

test('role game dashboard limits a confirmed player to sessions they may schedule', async () => {
  const game = sampleRoleGame({ id: 32, allowPlayerManualScheduling: true });
  const player = sampleRoleGameMember({
    id: 320,
    roleGameId: game.id,
    telegramUserId: 99,
    role: 'player',
    status: 'confirmed',
  });
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId: new Map([[game.id, [player]]]),
    }),
    actor: { telegramUserId: player.telegramUserId },
  });

  assert.equal(await handleTelegramRoleGameStartText(context), true);

  assert.deepEqual(lastReply(context).options?.replyKeyboard?.map((row) => row.map(buttonText)), [
    ['Sesiones'],
    ['Volver a mis partidas'],
    ['Inicio', 'Ayuda'],
  ]);
});

test('role game dashboard lets a visible visitor request a seat with a reply button', async () => {
  const game = sampleRoleGame({ id: 33, visibility: 'members' });
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({ gamesById: [game] }),
    actor: { telegramUserId: 99 },
  });

  assert.equal(await handleTelegramRoleGameStartText(context), true);

  assert.equal(lastReply(context).options?.inlineKeyboard, undefined);
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.map((row) => row.map(buttonText)), [
    ['Sesiones'],
    ['Solicitar plaza'],
    ['Volver a mis partidas'],
    ['Inicio', 'Ayuda'],
  ]);
});

test('role game dashboard keeps coorganizer operations and hides full configuration', async () => {
  const game = sampleRoleGame({ id: 34, primaryGmTelegramUserId: 42 });
  const coorganizer = sampleRoleGameMember({
    id: 340,
    roleGameId: game.id,
    telegramUserId: 77,
    role: 'coorganizer',
    status: 'confirmed',
  });
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId: new Map([[game.id, [coorganizer]]]),
    }),
    actor: { telegramUserId: coorganizer.telegramUserId },
  });

  assert.equal(await handleTelegramRoleGameStartText(context), true);
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.map((row) => row.map(buttonText)), [
    ['Participantes'],
    ['Sesiones', 'Materiales'],
    ['Invitar', 'Configurar'],
    ['Volver a mis partidas'],
    ['Inicio', 'Ayuda'],
  ]);

  await sendRoleGameText(context, 'Configurar');
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.map((row) => row.map(buttonText)), [
    ['Configurar recurrencia'],
    ['Volver a la partida'],
    ['Inicio', 'Ayuda'],
  ]);
});

test('role game sessions hide manual scheduling for recurring campaigns', async () => {
  const game = sampleRoleGame({
    id: 341,
    schedulingMode: 'recurring',
    recurrenceRule: { intervalWeeks: 2, weekday: 4, time: '19:00' },
    recurrenceWindowCount: 4,
  });
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({ gamesById: [game] }),
  });

  assert.equal(await handleTelegramRoleGameStartText(context), true);
  await sendRoleGameText(context, 'Sesiones');

  assert.deepEqual(lastReply(context).options?.replyKeyboard?.map((row) => row.map(buttonText)), [
    ['Volver a la partida'],
    ['Inicio', 'Ayuda'],
  ]);
});

test('role game sections render sessions and materials through persistent keyboards', async () => {
  const game = sampleRoleGame({ id: 35 });
  const sessionLink = sampleSessionLink({ roleGameId: game.id, scheduleEventId: 350 });
  const material = sampleRoleGameMaterial({ id: 351, roleGameId: game.id, title: 'Mapa de campaña' });
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      sessionLinksByGameId: new Map([[game.id, [sessionLink]]]),
      materialsById: [material],
    }),
    scheduleRepository: createFakeScheduleRepository({
      events: [sampleScheduleEvent({ id: sessionLink.scheduleEventId })],
    }),
  });

  assert.equal(await handleTelegramRoleGameStartText(context), true);
  await sendRoleGameText(context, 'Sesiones');
  assert.match(lastReply(context).message, /Agenda/);
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.map((row) => row.map(buttonText)), [
    ['Programar siguiente sesión'],
    ['Volver a la partida'],
    ['Inicio', 'Ayuda'],
  ]);

  await sendRoleGameText(context, 'Volver a la partida');
  await sendRoleGameText(context, 'Materiales');
  assert.match(lastReply(context).message, /role_material_351/);
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.map((row) => row.map(buttonText)), [
    ['Subir material'],
    ['Volver a la partida'],
    ['Inicio', 'Ayuda'],
  ]);

  await sendRoleGameText(context, 'Subir material');
  assert.equal(getCurrentSession(context)?.flowKey, 'role-game-material-upload');
  assert.match(lastReply(context).message, /Envía el archivo o imagen/);
});

test('handleTelegramRoleGameStartText blocks member-only deep links for unapproved actors', async () => {
  const game = sampleRoleGame({ id: 23, title: 'Mesa privada', visibility: 'members' });
  const context = createRoleGameTestContext({
    messageText: '/start role_game_23',
    roleGameRepository: createFakeRoleGameRepository({ gamesById: [game] }),
    actor: { telegramUserId: 100, isApproved: false, status: 'pending' },
  });

  const handled = await handleTelegramRoleGameStartText(context);

  assert.equal(handled, true);
  assert.doesNotMatch(lastReply(context).message, /Mesa privada/);
  assert.match(lastReply(context).message, /No se ha encontrado/);
});

test('handleTelegramRoleGameStartText opens public external one-shot links for unapproved actors', async () => {
  const game = sampleRoleGame({
    id: 24,
    type: 'one_shot',
    title: 'Jornada abierta',
    visibility: 'public',
    publicJoinPolicy: 'members_and_external',
  });
  const context = createRoleGameTestContext({
    messageText: '/start role_game_24',
    roleGameRepository: createFakeRoleGameRepository({ gamesById: [game] }),
    actor: { telegramUserId: 100, isApproved: false, status: 'pending' },
  });

  const handled = await handleTelegramRoleGameStartText(context);

  assert.equal(handled, true);
  assert.match(lastReply(context).message, /Jornada abierta/);
  assert.equal(lastReply(context).options?.inlineKeyboard, undefined);
  assert.ok(lastReply(context).options?.replyKeyboard?.flat().some((button) => buttonText(button) === 'Solicitar plaza'));
});

test('handleTelegramRoleGameCallback lets unapproved external users request public one-shot seats without approving membership', async () => {
  const game = sampleRoleGame({
    id: 25,
    type: 'one_shot',
    visibility: 'public',
    publicJoinPolicy: 'members_and_external',
    acceptanceMode: 'auto_until_full',
  });
  let requestedExternal: boolean | null = null;
  const context = createRoleGameTestContext({
    messageText: '',
    callbackData: 'role_game:request:25',
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId: new Map([[game.id, []]]),
      onRequestSeat: async (input) => {
        requestedExternal = input.isExternal;
        return sampleRoleGameMember({
          roleGameId: game.id,
          telegramUserId: input.telegramUserId,
          status: 'confirmed',
          isExternal: input.isExternal,
        });
      },
    }),
    actor: { telegramUserId: 100, isApproved: false, status: 'pending' },
  });

  const handled = await handleTelegramRoleGameCallback(context);

  assert.equal(handled, true);
  assert.equal(requestedExternal, true);
  assert.equal(context.runtime.actor.status, 'pending');
  assert.match(lastReply(context).message, /Plaza confirmada/);
});

test('handleTelegramRoleGameText lets unapproved external users request public one-shot seats from the reply keyboard', async () => {
  const game = sampleRoleGame({
    id: 251,
    type: 'one_shot',
    visibility: 'public',
    publicJoinPolicy: 'members_and_external',
    acceptanceMode: 'auto_until_full',
  });
  let requestedExternal: boolean | null = null;
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId: new Map([[game.id, []]]),
      onRequestSeat: async (input) => {
        requestedExternal = input.isExternal;
        return sampleRoleGameMember({
          roleGameId: game.id,
          telegramUserId: input.telegramUserId,
          status: 'confirmed',
          isExternal: input.isExternal,
        });
      },
    }),
    actor: { telegramUserId: 100, isApproved: false, status: 'pending' },
  });

  assert.equal(await handleTelegramRoleGameStartText(context), true);
  await sendRoleGameText(context, 'Solicitar plaza');

  assert.equal(requestedExternal, true);
  assert.equal(context.runtime.actor.status, 'pending');
  assert.match(lastReply(context).message, /Plaza confirmada/);
});

test('role game callback prefix registry retains all legacy adapters', () => {
  assert.deepEqual(roleGameCallbackPrefixes, {
    detail: 'role_game:detail:',
    listMine: 'role_game:list:mine:',
    listVisible: 'role_game:list:visible:',
    requestSeat: 'role_game:request:',
    acceptRequest: 'role_game:accept:',
    rejectRequest: 'role_game:reject:',
    scheduleSession: 'role_game:schedule:',
    configureRecurrence: 'role_game:configure_recurrence:',
    materialUpload: 'role_game:material_upload:',
    materials: 'role_game:materials:',
    edit: 'role_game:edit:',
    invite: 'role_game:invite:',
    material: 'role_game:material:',
  });
});

test('handleTelegramRoleGameCallback blocks fabricated private-game details for non-members', async () => {
  const game = sampleRoleGame({ id: 23, title: 'Mesa privada', visibility: 'private', primaryGmTelegramUserId: 99 });
  const context = createRoleGameTestContext({
    messageText: '',
    callbackData: 'role_game:detail:23',
    roleGameRepository: createFakeRoleGameRepository({ gamesById: [game] }),
  });

  const handled = await handleTelegramRoleGameCallback(context);

  assert.equal(handled, true);
  assert.doesNotMatch(lastReply(context).message, /Mesa privada/);
  assert.match(lastReply(context).message, /No se ha encontrado/);
});

test('handleTelegramRoleGameText creates a role game with guided prompts', async () => {
  let createdGame: RoleGameRecord | null = null;
  const context = createRoleGameTestContext({
    messageText: 'Crear partida',
    roleGameRepository: createFakeRoleGameRepository({
      onCreateGame: async (input) => {
        createdGame = sampleRoleGame({ ...input, id: 50 });
        return createdGame;
      },
    }),
  });

  assert.equal(await handleTelegramRoleGameText(context), true);
  assert.equal(getCurrentSession(context)?.flowKey, 'role-game-create');
  assert.match(lastReply(context).message, /tipo/i);
  assert.ok(lastReply(context).options?.replyKeyboard?.flat().some((button) => buttonText(button) === 'Cancelar'));

  await sendRoleGameText(context, 'Campaña');
  await sendRoleGameText(context, 'La campaña de prueba');
  await sendRoleGameText(context, 'D&D 5e');
  await sendRoleGameText(context, 'Una campaña para probar el flujo');
  await sendRoleGameText(context, '5');
  await sendRoleGameText(context, 'Socios');
  await sendRoleGameText(context, 'Solicitud');
  await sendRoleGameText(context, 'Revisión manual');
  await sendRoleGameText(context, 'Manual');

  assert.match(lastReply(context).message, /Confirmar/i);
  assert.ok(
    lastReply(context).options?.replyKeyboard
      ?.flat()
      .some((button) => typeof button !== 'string' && button.text === 'Confirmar' && button.semanticRole === 'success'),
  );

  await sendRoleGameText(context, 'Confirmar');

  const created = assertRoleGame(createdGame);
  assert.equal(created.title, 'La campaña de prueba');
  assert.equal(created.primaryGmTelegramUserId, context.runtime.actor.telegramUserId);
  assert.equal(created.type, 'campaign');
  assert.equal(created.visibility, 'members');
  assert.equal(created.entryMode, 'request');
  assert.equal(created.acceptanceMode, 'manual_review');
  assert.equal(created.schedulingMode, 'manual');
  assert.match(lastReply(context).message, /Partida creada/);
});

test('handleTelegramRoleGameText creates a recurring campaign with recurrence settings', async () => {
  let createdGame: RoleGameRecord | null = null;
  const context = createRoleGameTestContext({
    messageText: 'Crear partida',
    roleGameRepository: createFakeRoleGameRepository({
      onCreateGame: async (input) => {
        createdGame = sampleRoleGame({ ...input, id: 52 });
        return createdGame;
      },
    }),
  });

  assert.equal(await handleTelegramRoleGameText(context), true);
  await sendRoleGameText(context, 'Campaña');
  await sendRoleGameText(context, 'La campaña semanal');
  await sendRoleGameText(context, 'Pathfinder 2e');
  await sendRoleGameText(context, 'Una campaña recurrente');
  await sendRoleGameText(context, '5');
  await sendRoleGameText(context, 'Socios');
  await sendRoleGameText(context, 'Solicitud');
  await sendRoleGameText(context, 'Revisión manual');
  await sendRoleGameText(context, 'Recurrente');

  assert.match(lastReply(context).message, /cada cuántas semanas/i);
  await sendRoleGameText(context, '2');
  assert.match(lastReply(context).message, /día de la semana/i);
  await sendRoleGameText(context, 'Miércoles');
  assert.match(lastReply(context).message, /hora/i);
  await sendRoleGameText(context, '18:30');
  assert.match(lastReply(context).message, /sesiones futuras/i);
  await sendRoleGameText(context, '3');
  assert.match(lastReply(context).message, /Confirmar/i);
  await sendRoleGameText(context, 'Confirmar');

  const created = assertRoleGame(createdGame);
  assert.equal(created.schedulingMode, 'recurring');
  assert.deepEqual(created.recurrenceRule, { intervalWeeks: 2, weekday: 3, time: '18:30' });
  assert.equal(created.recurrenceWindowCount, 3);
  assert.match(lastReply(context).message, /Partida creada/);
});

test('handleTelegramRoleGameText creates a one-shot with an initial Agenda event', async () => {
  let createdGame: RoleGameRecord | null = null;
  const scheduleRepository = createFakeScheduleRepository();
  const roleGameRepository = createFakeRoleGameRepository({
    onCreateGame: async (input) => {
      createdGame = sampleRoleGame({ ...input, id: 51, type: 'one_shot' });
      return createdGame;
    },
  });
  const context = createRoleGameTestContext({
    messageText: 'Crear partida',
    roleGameRepository,
    scheduleRepository,
  });

  assert.equal(await handleTelegramRoleGameText(context), true);
  await sendRoleGameText(context, 'One-shot');
  await sendRoleGameText(context, 'La partida única');
  await sendRoleGameText(context, 'Mothership');
  await sendRoleGameText(context, 'Una noche en el espacio');
  await sendRoleGameText(context, '4');
  await sendRoleGameText(context, 'Socios');
  await sendRoleGameText(context, 'Solicitud');
  await sendRoleGameText(context, 'Revisión manual');
  await sendRoleGameText(context, 'Manual');

  assert.match(lastReply(context).message, /fecha/i);
  assert.ok(lastReply(context).options?.replyKeyboard?.flat().some((button) => buttonText(button) === 'Cancelar'));

  await sendRoleGameText(context, '06/08/2026');
  assert.match(lastReply(context).message, /hora/i);
  assert.ok(lastReply(context).options?.replyKeyboard?.flat().some((button) => buttonText(button) === 'Cancelar'));

  await sendRoleGameText(context, '18:00');
  assert.match(lastReply(context).message, /Confirmar/i);
  await sendRoleGameText(context, 'Confirmar');

  const created = assertRoleGame(createdGame);
  const event = await scheduleRepository.findEventById(1);
  assert.equal(event?.title, created.title);
  assert.equal(event?.startsAt, new Date(2026, 7, 6, 18, 0).toISOString());
  assert.equal(roleGameRepository.createdSessionLinks.at(0)?.source, 'one_shot_initial');
  assert.equal(roleGameRepository.createdSessionLinks.at(0)?.roleGameId, created.id);
  assert.match(lastReply(context).message, /schedule_event_1/);
});

test('handleTelegramRoleGameText cancels role game creation without orphan keyboard', async () => {
  let createCalls = 0;
  const context = createRoleGameTestContext({
    messageText: 'Crear partida',
    roleGameRepository: createFakeRoleGameRepository({
      onCreateGame: async (input) => {
        createCalls += 1;
        return sampleRoleGame({ ...input, id: 50 });
      },
    }),
  });

  assert.equal(await handleTelegramRoleGameText(context), true);
  assert.equal(getCurrentSession(context)?.flowKey, 'role-game-create');

  await sendRoleGameText(context, 'Cancelar');

  assert.equal(getCurrentSession(context), null);
  assert.equal(createCalls, 0);
  assert.match(lastReply(context).message, /cancelado/i);
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.flat().map(buttonText), [
    'Mis partidas',
    'Partidas visibles',
    'Crear partida',
    'Cancelar',
    'Inicio',
    'Ayuda',
  ]);
});

test('handleTelegramRoleGameCallback auto-confirms seat requests while capacity remains', async () => {
  const game = sampleRoleGame({ id: 70, acceptanceMode: 'auto_until_full' });
  let requestedMember: RoleGameMemberRecord | null = null;
  const context = createRoleGameTestContext({
    messageText: '',
    callbackData: 'role_game:request:70',
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      onRequestSeat: async (input) => {
        requestedMember = sampleRoleGameMember({
          id: 8,
          roleGameId: input.roleGameId,
          telegramUserId: input.telegramUserId,
          status: 'confirmed',
        });
        return requestedMember;
      },
    }),
  });

  const handled = await handleTelegramRoleGameCallback(context);

  assert.equal(handled, true);
  assert.equal(assertRoleGameMember(requestedMember).status, 'confirmed');
  assert.match(lastReply(context).message, /plaza confirmada/i);
});

test('handleTelegramRoleGameCallback creates manual review requests', async () => {
  const game = sampleRoleGame({ id: 71, acceptanceMode: 'manual_review' });
  let requestedMember: RoleGameMemberRecord | null = null;
  const context = createRoleGameTestContext({
    messageText: '',
    callbackData: 'role_game:request:71',
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      onRequestSeat: async (input) => {
        requestedMember = sampleRoleGameMember({
          id: 9,
          roleGameId: input.roleGameId,
          telegramUserId: input.telegramUserId,
          status: 'requested',
        });
        return requestedMember;
      },
    }),
  });

  const handled = await handleTelegramRoleGameCallback(context);

  assert.equal(handled, true);
  assert.equal(assertRoleGameMember(requestedMember).status, 'requested');
  assert.match(lastReply(context).message, /solicitud enviada/i);
});

test('handleTelegramRoleGameCallback lets managers accept and reject requests', async () => {
  const game = sampleRoleGame({ id: 72, primaryGmTelegramUserId: 42 });
  const requested = sampleRoleGameMember({ id: 10, roleGameId: game.id, telegramUserId: 100, status: 'requested' });
  const statuses: string[] = [];
  const context = createRoleGameTestContext({
    messageText: '',
    callbackData: 'role_game:accept:10',
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId: new Map([[game.id, [requested]]]),
      onSetMemberStatus: async (input) => {
        statuses.push(input.status);
        return { ...requested, status: input.status };
      },
    }),
  });

  assert.equal(await handleTelegramRoleGameCallback(context), true);
  assert.deepEqual(statuses, ['confirmed']);
  assert.match(lastReply(context).message, /Solicitud aceptada/i);

  context.callbackData = 'role_game:reject:10';
  assert.equal(await handleTelegramRoleGameCallback(context), true);
  assert.deepEqual(statuses, ['confirmed', 'rejected']);
  assert.match(lastReply(context).message, /Solicitud rechazada/i);
});

test('handleTelegramRoleGameCallback blocks non-managers from accepting requests', async () => {
  const game = sampleRoleGame({ id: 73, primaryGmTelegramUserId: 99 });
  const requested = sampleRoleGameMember({ id: 11, roleGameId: game.id, telegramUserId: 100, status: 'requested' });
  let setCalls = 0;
  const context = createRoleGameTestContext({
    messageText: '',
    callbackData: 'role_game:accept:11',
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId: new Map([[game.id, [requested]]]),
      onSetMemberStatus: async (input) => {
        setCalls += 1;
        return { ...requested, status: input.status };
      },
    }),
  });

  const handled = await handleTelegramRoleGameCallback(context);

  assert.equal(handled, true);
  assert.equal(setCalls, 0);
  assert.match(lastReply(context).message, /No tienes permisos/);
});

test('handleTelegramRoleGameCallback lets a manager schedule the next manual session', async () => {
  const game = sampleRoleGame({ id: 82, primaryGmTelegramUserId: 42, allowPlayerManualScheduling: false });
  const scheduleRepository = createFakeScheduleRepository();
  const roleGameRepository = createFakeRoleGameRepository({ gamesById: [game], membersByGameId: new Map([[game.id, []]]) });
  const context = createRoleGameTestContext({
    messageText: '',
    callbackData: 'role_game:schedule:82',
    roleGameRepository,
    scheduleRepository,
  });

  assert.equal(await handleTelegramRoleGameCallback(context), true);
  assert.equal(getCurrentSession(context)?.flowKey, 'role-game-manual-session');
  assert.match(lastReply(context).message, /fecha/i);
  assert.ok(lastReply(context).options?.replyKeyboard?.flat().some((button) => buttonText(button) === 'Cancelar'));

  delete context.callbackData;
  await sendRoleGameText(context, '06/08/2026');
  assert.match(lastReply(context).message, /hora/i);

  await sendRoleGameText(context, '18:00');
  const event = await scheduleRepository.findEventById(1);
  assert.equal(event?.title, game.title);
  assert.equal(roleGameRepository.createdSessionLinks.at(0)?.source, 'manual');
  assert.equal(getCurrentSession(context), null);
  assert.match(lastReply(context).message, /Sesión programada/i);
  assert.match(lastReply(context).message, /schedule_event_1/);
});

test('handleTelegramRoleGameCallback hides manual scheduling for non-manual games', async () => {
  const games = [
    sampleRoleGame({ id: 85, title: 'One-shot', type: 'one_shot', schedulingMode: 'manual' }),
    sampleRoleGame({ id: 86, title: 'Pausada', status: 'paused', schedulingMode: 'manual' }),
    sampleRoleGame({ id: 87, title: 'Recurrente', type: 'campaign', schedulingMode: 'recurring', recurrenceRule: { intervalWeeks: 1, weekday: 4, time: '18:00' }, recurrenceWindowCount: 3 }),
  ];

  for (const game of games) {
    const roleGameRepository = createFakeRoleGameRepository({ gamesById: [game], membersByGameId: new Map([[game.id, []]]) });
    const scheduleRepository = createFakeScheduleRepository();
    const detailContext = createRoleGameTestContext({
      messageText: '',
      callbackData: `role_game:detail:${game.id}`,
      roleGameRepository,
      scheduleRepository,
    });

    assert.equal(await handleTelegramRoleGameCallback(detailContext), true);
    assert.equal(lastReply(detailContext).options?.inlineKeyboard?.flat().some((button) => button.text === 'Programar siguiente sesión') ?? false, false);

    const scheduleContext = createRoleGameTestContext({
      messageText: '',
      callbackData: `role_game:schedule:${game.id}`,
      roleGameRepository,
      scheduleRepository,
    });

    assert.equal(await handleTelegramRoleGameCallback(scheduleContext), true);
    assert.equal(getCurrentSession(scheduleContext), null);
    assert.equal(await scheduleRepository.findEventById(1), null);
    assert.match(lastReply(scheduleContext).message, /No tienes permisos/);
  }
});

test('handleTelegramRoleGameCallback lets managers configure recurrence with confirmation', async () => {
  let updatedGame: RoleGameRecord | null = null;
  const game = sampleRoleGame({ id: 88, primaryGmTelegramUserId: 42, schedulingMode: 'manual' });
  const futureEvent = sampleScheduleEvent({ id: 1, startsAt: new Date(2026, 7, 6, 18, 0).toISOString() });
  const roleGameRepository = createFakeRoleGameRepository({
    gamesById: [game],
    membersByGameId: new Map([[game.id, []]]),
    sessionLinksByGameId: new Map([[game.id, [sampleSessionLink({ roleGameId: game.id, scheduleEventId: futureEvent.id })]]]),
    onUpdateGame: async (input) => {
      updatedGame = sampleRoleGame({ ...game, ...input, id: game.id });
      return updatedGame;
    },
  });
  const context = createRoleGameTestContext({
    messageText: '',
    callbackData: 'role_game:configure_recurrence:88',
    roleGameRepository,
    scheduleRepository: createFakeScheduleRepository({ events: [futureEvent] }),
  });

  assert.equal(await handleTelegramRoleGameCallback(context), true);
  assert.equal(getCurrentSession(context)?.flowKey, 'role-game-recurrence-config');
  assert.match(lastReply(context).message, /cada cuántas semanas/i);

  delete context.callbackData;
  await sendRoleGameText(context, '1');
  await sendRoleGameText(context, 'Jueves');
  await sendRoleGameText(context, '18:00');
  await sendRoleGameText(context, '3');

  assert.match(lastReply(context).message, /sesiones futuras existentes/i);
  assert.ok(lastReply(context).options?.replyKeyboard?.flat().some((button) => buttonText(button) === 'Confirmar'));

  await sendRoleGameText(context, 'Confirmar');

  const updated = assertRoleGame(updatedGame);
  assert.equal(updated.schedulingMode, 'recurring');
  assert.deepEqual(updated.recurrenceRule, { intervalWeeks: 1, weekday: 4, time: '18:00' });
  assert.equal(updated.recurrenceWindowCount, 3);
  assert.match(lastReply(context).message, /Recurrencia guardada/i);
});

test('handleTelegramRoleGameCallback lets confirmed players schedule when the game allows it', async () => {
  const game = sampleRoleGame({
    id: 83,
    primaryGmTelegramUserId: 42,
    allowPlayerManualScheduling: true,
  });
  const player = sampleRoleGameMember({ roleGameId: game.id, telegramUserId: 77, role: 'player', status: 'confirmed' });
  const scheduleRepository = createFakeScheduleRepository();
  const roleGameRepository = createFakeRoleGameRepository({
    gamesById: [game],
    membersByGameId: new Map([[game.id, [player]]]),
  });
  const context = createRoleGameTestContext({
    messageText: '',
    callbackData: 'role_game:schedule:83',
    roleGameRepository,
    scheduleRepository,
    actor: { telegramUserId: 77 },
  });

  assert.equal(await handleTelegramRoleGameCallback(context), true);
  await sendRoleGameText(context, '06/08/2026');
  await sendRoleGameText(context, '18:00');

  assert.equal((await scheduleRepository.findEventById(1))?.createdByTelegramUserId, 77);
  assert.equal(roleGameRepository.createdSessionLinks.at(0)?.createdByTelegramUserId, 77);
});

test('handleTelegramRoleGameCallback blocks confirmed players from manual scheduling when disabled', async () => {
  const game = sampleRoleGame({
    id: 84,
    primaryGmTelegramUserId: 42,
    allowPlayerManualScheduling: false,
  });
  const player = sampleRoleGameMember({ roleGameId: game.id, telegramUserId: 77, role: 'player', status: 'confirmed' });
  const scheduleRepository = createFakeScheduleRepository();
  const roleGameRepository = createFakeRoleGameRepository({
    gamesById: [game],
    membersByGameId: new Map([[game.id, [player]]]),
  });
  const context = createRoleGameTestContext({
    messageText: '',
    callbackData: 'role_game:schedule:84',
    roleGameRepository,
    scheduleRepository,
    actor: { telegramUserId: 77 },
  });

  assert.equal(await handleTelegramRoleGameCallback(context), true);
  assert.equal(getCurrentSession(context), null);
  assert.equal(await scheduleRepository.findEventById(1), null);
  assert.match(lastReply(context).message, /No tienes permisos/);
});

test('handleTelegramRoleGameCallback does not accept when the game is full', async () => {
  const game = sampleRoleGame({ id: 74, primaryGmTelegramUserId: 42, capacity: 1 });
  const confirmed = sampleRoleGameMember({ id: 12, roleGameId: game.id, telegramUserId: 101, status: 'confirmed' });
  const requested = sampleRoleGameMember({ id: 13, roleGameId: game.id, telegramUserId: 100, status: 'requested' });
  let setCalls = 0;
  const context = createRoleGameTestContext({
    messageText: '',
    callbackData: 'role_game:accept:13',
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId: new Map([[game.id, [confirmed, requested]]]),
      onSetMemberStatus: async (input) => {
        setCalls += 1;
        return { ...requested, status: input.status };
      },
    }),
  });

  const handled = await handleTelegramRoleGameCallback(context);

  assert.equal(handled, true);
  assert.equal(setCalls, 0);
  assert.match(lastReply(context).message, /No se ha encontrado/);
});

test('handleTelegramRoleGameCallback starts gm-only material upload for managers', async () => {
  const game = sampleRoleGame({ id: 89, primaryGmTelegramUserId: 42 });
  const context = createRoleGameTestContext({
    messageText: '',
    callbackData: 'role_game:material_upload:89',
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId: new Map([[game.id, []]]),
    }),
  });

  const handled = await handleTelegramRoleGameCallback(context);

  assert.equal(handled, true);
  assert.equal(getCurrentSession(context)?.flowKey, 'role-game-material-upload');
  assert.equal(getCurrentSession(context)?.data.gameId, 89);
  assert.match(lastReply(context).message, /Envía el archivo/);
});

test('handleTelegramRoleGameCallback returns a manager invitation link', async () => {
  const game = sampleRoleGame({ id: 32, title: 'Misterios del Delta', primaryGmTelegramUserId: 42 });
  const players = [
    sampleRoleGameMember({ id: 4, roleGameId: game.id, telegramUserId: 100, role: 'player', status: 'confirmed' }),
    sampleRoleGameMember({ id: 5, roleGameId: game.id, telegramUserId: 101, role: 'player', status: 'requested' }),
  ];
  const context = createRoleGameTestContext({
    messageText: '',
    callbackData: 'role_game:invite:32',
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId: new Map([[game.id, players]]),
    }),
  });

  const handled = await handleTelegramRoleGameCallback(context);

  assert.equal(handled, true);
  assert.match(lastReply(context).message, /Misterios del Delta/);
  assert.match(lastReply(context).message, /role_game_32/);
  assert.match(lastReply(context).message, /Jugadores actuales: 1\/5/);
  assert.equal(lastReply(context).options?.parseMode, 'HTML');
});

test('handleTelegramRoleGameCallback adapts old edit callbacks to the configuration section', async () => {
  const game = sampleRoleGame({ id: 34, title: 'Título viejo', primaryGmTelegramUserId: 42 });
  let updatedGame: RoleGameRecord | null = null;
  const context = createRoleGameTestContext({
    messageText: '',
    callbackData: 'role_game:edit:34',
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      onUpdateGame: async (input) => {
        updatedGame = { ...game, ...input, id: game.id, title: input.title ?? game.title };
        return updatedGame;
      },
    }),
  });

  assert.equal(await handleTelegramRoleGameCallback(context), true);
  assert.equal(getCurrentSession(context)?.flowKey, 'role-game-detail');
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.map((row) => row.map(buttonText)), [
    ['Editar partida'],
    ['Configurar recurrencia'],
    ['Volver a la partida'],
    ['Inicio', 'Ayuda'],
  ]);

  await sendRoleGameText(context, 'Editar partida');
  await sendRoleGameText(context, 'Título');
  assert.match(lastReply(context).message, /nuevo título/i);

  await sendRoleGameText(context, 'Título nuevo');

  assert.equal(assertRoleGame(updatedGame).title, 'Título nuevo');
  assert.equal(getCurrentSession(context), null);
  assert.match(lastReply(context).message, /Partida actualizada/);
  assert.match(lastReply(context).message, /Título nuevo/);
});

test('handleTelegramRoleGameCallback keeps full editing hidden from coorganizers', async () => {
  const game = sampleRoleGame({ id: 35, primaryGmTelegramUserId: 42 });
  const coorganizer = sampleRoleGameMember({
    id: 20,
    roleGameId: game.id,
    telegramUserId: 77,
    role: 'coorganizer',
    status: 'confirmed',
  });
  const context = createRoleGameTestContext({
    messageText: '',
    callbackData: 'role_game:edit:35',
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId: new Map([[game.id, [coorganizer]]]),
    }),
    actor: { telegramUserId: 77 },
  });

  const handled = await handleTelegramRoleGameCallback(context);

  assert.equal(handled, true);
  assert.equal(getCurrentSession(context)?.flowKey, 'role-game-detail');
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.map((row) => row.map(buttonText)), [
    ['Configurar recurrencia'],
    ['Volver a la partida'],
    ['Inicio', 'Ayuda'],
  ]);
});

test('handleTelegramRoleGameText keeps edit option buttons after invalid option values', async () => {
  const game = sampleRoleGame({ id: 36, primaryGmTelegramUserId: 42 });
  const context = createRoleGameTestContext({
    messageText: '',
    callbackData: 'role_game:edit:36',
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      onUpdateGame: async (input) => ({ ...game, ...input, id: game.id }),
    }),
  });

  assert.equal(await handleTelegramRoleGameCallback(context), true);
  delete context.callbackData;
  await sendRoleGameText(context, 'Editar partida');
  await sendRoleGameText(context, 'Visibilidad');
  await sendRoleGameText(context, 'cualquier cosa');

  assert.match(lastReply(context).message, /No he podido entender/);
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.at(0)?.map(buttonText), ['Privada', 'Socios', 'Pública']);
});

test('handleTelegramRoleGameCallback lists uploaded materials for managers', async () => {
  const game = sampleRoleGame({ id: 33, primaryGmTelegramUserId: 42 });
  const material = sampleRoleGameMaterial({
    id: 7,
    roleGameId: game.id,
    title: 'Libro secreto',
    description: 'PDF preparado para revelar en mesa',
  });
  const context = createRoleGameTestContext({
    messageText: '',
    callbackData: 'role_game:materials:33',
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      materialsById: [material],
    }),
  });

  const handled = await handleTelegramRoleGameCallback(context);

  assert.equal(handled, true);
  assert.match(lastReply(context).message, /Materiales de Libro secreto|Materiales de Partida de prueba/);
  assert.match(lastReply(context).message, /Libro secreto/);
  assert.match(lastReply(context).message, /role_material_7/);
  assert.doesNotMatch(lastReply(context).message, /storage_entry_/);
  assert.equal(lastReply(context).options?.parseMode, 'HTML');
});

test('handleTelegramRoleGameCallback paginates uploaded materials for managers', async () => {
  const game = sampleRoleGame({ id: 37, primaryGmTelegramUserId: 42 });
  const materials = Array.from({ length: 6 }, (_, index) => sampleRoleGameMaterial({
    id: index + 1,
    roleGameId: game.id,
    title: `Material ${index + 1}`,
    visibility: index === 5 ? 'players' : 'gm_only',
  }));
  const context = createRoleGameTestContext({
    messageText: '',
    callbackData: 'role_game:materials:37:99',
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      materialsById: materials,
    }),
  });

  const handled = await handleTelegramRoleGameCallback(context);

  assert.equal(handled, true);
  assert.match(lastReply(context).message, /Material 6/);
  assert.doesNotMatch(lastReply(context).message, /Material 1/);
  assert.match(lastReply(context).message, /Mostrando 6-6 de 6\. Página 2\/2\./);
  assert.equal(lastReply(context).options?.inlineKeyboard, undefined);
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.at(1)?.map(buttonText), ['Anterior']);
});

test('handleTelegramRoleGameMessage stores uploaded material in hidden Storage and creates gm-only material', async () => {
  const game = sampleRoleGame({ id: 90, primaryGmTelegramUserId: 42 });
  const createdMaterials: CreateRoleGameMaterialInput[] = [];
  const storageRepository = createFakeStorageRepository();
  const context = createRoleGameTestContext({
    messageText: '',
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId: new Map([[game.id, []]]),
      onCreateMaterial: async (input) => {
        createdMaterials.push(input);
        return sampleRoleGameMaterial({ ...input, id: 5 });
      },
    }),
    storageRepository,
    session: {
      current: {
        key: 'telegram.session:1:42',
        flowKey: 'role-game-material-upload',
        stepKey: 'media',
        data: { gameId: game.id },
        createdAt: '2026-07-09T10:00:00.000Z',
        updatedAt: '2026-07-09T10:00:00.000Z',
        expiresAt: '2026-07-09T11:00:00.000Z',
      },
    },
  });
  context.messageMedia = {
    attachmentKind: 'document',
    fileId: 'file-map',
    fileUniqueId: 'unique-map',
    caption: 'Mapa secreto del templo',
    originalFileName: 'mapa.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 1024,
    mediaGroupId: null,
    messageId: 77,
  };

  const handled = await handleTelegramRoleGameMessage(context);

  assert.equal(handled, true);
  assert.equal(getCurrentSession(context), null);
  assert.equal(storageRepository.createdEntries[0]?.categoryId, 8);
  assert.equal(storageRepository.createdEntries[0]?.messages[0]?.storageChatId, -1008);
  assert.equal(createdMaterials[0]?.visibility, 'gm_only');
  assert.equal(createdMaterials[0]?.internalStorageEntryId, 1);
  assert.match(lastReply(context).message, /Material guardado/);
  assert.match(lastReply(context).message, /role_material_5/);
  assert.doesNotMatch(lastReply(context).message, /storage_entry_/);
});

test('handleTelegramRoleGameStartText hides gm-only role material from confirmed players', async () => {
  const game = sampleRoleGame({ id: 90, primaryGmTelegramUserId: 42 });
  const player = sampleRoleGameMember({ roleGameId: game.id, telegramUserId: 100, role: 'player', status: 'confirmed' });
  const material = sampleRoleGameMaterial({ id: 5, roleGameId: game.id, visibility: 'gm_only', title: 'Mapa secreto' });
  const context = createRoleGameTestContext({
    messageText: '/start role_material_5',
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId: new Map([[game.id, [player]]]),
      materialsById: [material],
    }),
    actor: { telegramUserId: 100 },
  });

  const handled = await handleTelegramRoleGameStartText(context);

  assert.equal(handled, true);
  assert.doesNotMatch(lastReply(context).message, /Mapa secreto/);
  assert.match(lastReply(context).message, /No se ha encontrado/);
});

test('handleTelegramRoleGameStartText shows gm-only role material to the GM with role_material deep link only', async () => {
  const game = sampleRoleGame({ id: 91, primaryGmTelegramUserId: 42 });
  const material = sampleRoleGameMaterial({ id: 6, roleGameId: game.id, internalStorageEntryId: 44, visibility: 'gm_only', title: 'Mapa secreto' });
  const context = createRoleGameTestContext({
    messageText: '/start role_material_6',
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId: new Map([[game.id, []]]),
      materialsById: [material],
    }),
  });

  const handled = await handleTelegramRoleGameStartText(context);

  assert.equal(handled, true);
  assert.match(lastReply(context).message, /Mapa secreto/);
  assert.match(lastReply(context).message, /role_material_6/);
  assert.doesNotMatch(lastReply(context).message, /storage_entry_44/);
});

test('handleTelegramRoleGameCallback sends material only this time without revealing it', async () => {
  const game = sampleRoleGame({ id: 92, primaryGmTelegramUserId: 42 });
  const storageRepository = createFakeStorageRepository();
  await createStoredRoleGameMaterialEntry(storageRepository);
  const players = [
    sampleRoleGameMember({ id: 1, roleGameId: game.id, telegramUserId: 100, role: 'player', status: 'confirmed' }),
    sampleRoleGameMember({ id: 2, roleGameId: game.id, telegramUserId: 101, role: 'player', status: 'confirmed' }),
    sampleRoleGameMember({ id: 3, roleGameId: game.id, telegramUserId: 102, role: 'player', status: 'requested' }),
  ];
  const material = sampleRoleGameMaterial({ id: 7, roleGameId: game.id, internalStorageEntryId: 1, visibility: 'gm_only', deliveryState: 'not_sent' });
  const deliveries: CreateRoleGameMaterialDeliveryInput[] = [];
  const sentMessages: Array<{ telegramUserId: number; message: string }> = [];
  const copiedMessages: Array<{ fromChatId: number; messageId: number; toChatId: number }> = [];
  const context = createRoleGameTestContext({
    messageText: '',
    callbackData: 'role_game:material:send_only:7',
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId: new Map([[game.id, players]]),
      materialsById: [material],
      onCreateMaterialDelivery: async (input) => {
        deliveries.push(input);
        return sampleRoleGameMaterialDelivery({ ...input, id: deliveries.length });
      },
    }),
    storageRepository,
    onSendPrivateMessage: async (telegramUserId, message) => {
      sentMessages.push({ telegramUserId, message });
    },
    onCopyMessage: async (input) => {
      copiedMessages.push(input);
      return { messageId: copiedMessages.length };
    },
  });

  const handled = await handleTelegramRoleGameCallback(context);

  assert.equal(handled, true);
  assert.deepEqual(sentMessages.map((message) => message.telegramUserId), [100, 101]);
  assert.deepEqual(copiedMessages.map((message) => message.toChatId), [100, 101]);
  assert.deepEqual(deliveries.map((delivery) => delivery.status), ['sent', 'sent']);
  assert.equal(material.visibility, 'gm_only');
  assert.match(lastReply(context).message, /Enviado a 2\/2 jugadores/);
});

test('handleTelegramRoleGameCallback sends and reveals material to confirmed players', async () => {
  const game = sampleRoleGame({ id: 93, primaryGmTelegramUserId: 42 });
  const storageRepository = createFakeStorageRepository();
  await createStoredRoleGameMaterialEntry(storageRepository);
  const player = sampleRoleGameMember({ roleGameId: game.id, telegramUserId: 100, role: 'player', status: 'confirmed' });
  const material = sampleRoleGameMaterial({ id: 8, roleGameId: game.id, internalStorageEntryId: 1, visibility: 'gm_only', deliveryState: 'not_sent' });
  let updatedVisibility: RoleGameMaterialRecord | null = null;
  const context = createRoleGameTestContext({
    messageText: '',
    callbackData: 'role_game:material:send_and_reveal:8',
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId: new Map([[game.id, [player]]]),
      materialsById: [material],
      onUpdateMaterialVisibility: async (input) => {
        updatedVisibility = { ...material, visibility: input.visibility, deliveryState: input.deliveryState, revealedAt: '2026-07-09T12:10:00.000Z' };
        return updatedVisibility;
      },
      onCreateMaterialDelivery: async (input) => sampleRoleGameMaterialDelivery(input),
    }),
    storageRepository,
  });

  const handled = await handleTelegramRoleGameCallback(context);

  assert.equal(handled, true);
  assert.equal(assertRoleGameMaterial(updatedVisibility).visibility, 'players');
  assert.equal(assertRoleGameMaterial(updatedVisibility).deliveryState, 'revealed');
  assert.match(lastReply(context).message, /Enviado a 1\/1 jugadores/);
  assert.match(lastReply(context).message, /revelado/i);
});

test('handleTelegramRoleGameCallback reveals material without sending it', async () => {
  const game = sampleRoleGame({ id: 94, primaryGmTelegramUserId: 42 });
  const material = sampleRoleGameMaterial({ id: 9, roleGameId: game.id, visibility: 'gm_only', deliveryState: 'not_sent' });
  let deliveryCalls = 0;
  let updatedVisibility: RoleGameMaterialRecord | null = null;
  const context = createRoleGameTestContext({
    messageText: '',
    callbackData: 'role_game:material:reveal_only:9',
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId: new Map([[game.id, []]]),
      materialsById: [material],
      onUpdateMaterialVisibility: async (input) => {
        updatedVisibility = { ...material, visibility: input.visibility, deliveryState: input.deliveryState, revealedAt: '2026-07-09T12:10:00.000Z' };
        return updatedVisibility;
      },
      onCreateMaterialDelivery: async (input) => {
        deliveryCalls += 1;
        return sampleRoleGameMaterialDelivery(input);
      },
    }),
  });

  const handled = await handleTelegramRoleGameCallback(context);

  assert.equal(handled, true);
  assert.equal(deliveryCalls, 0);
  assert.equal(assertRoleGameMaterial(updatedVisibility).visibility, 'players');
  assert.match(lastReply(context).message, /Material revelado/);
});

test('handleTelegramRoleGameCallback reports partial material delivery failures', async () => {
  const game = sampleRoleGame({ id: 95, primaryGmTelegramUserId: 42 });
  const storageRepository = createFakeStorageRepository();
  await createStoredRoleGameMaterialEntry(storageRepository);
  const players = [
    sampleRoleGameMember({ roleGameId: game.id, telegramUserId: 100, role: 'player', status: 'confirmed' }),
    sampleRoleGameMember({ roleGameId: game.id, telegramUserId: 101, role: 'player', status: 'confirmed' }),
  ];
  const material = sampleRoleGameMaterial({ id: 10, roleGameId: game.id, internalStorageEntryId: 1, visibility: 'gm_only', deliveryState: 'not_sent' });
  const deliveries: CreateRoleGameMaterialDeliveryInput[] = [];
  const context = createRoleGameTestContext({
    messageText: '',
    callbackData: 'role_game:material:send_only:10',
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId: new Map([[game.id, players]]),
      materialsById: [material],
      onCreateMaterialDelivery: async (input) => {
        deliveries.push(input);
        return sampleRoleGameMaterialDelivery({ ...input, id: deliveries.length });
      },
    }),
    storageRepository,
    onSendPrivateMessage: async (telegramUserId) => {
      if (telegramUserId === 101) {
        throw new Error('Forbidden');
      }
    },
  });

  const handled = await handleTelegramRoleGameCallback(context);

  assert.equal(handled, true);
  assert.deepEqual(deliveries.map((delivery) => [delivery.recipientTelegramUserId, delivery.status]), [
    [100, 'sent'],
    [101, 'failed'],
  ]);
  assert.match(lastReply(context).message, /Enviado a 1\/2 jugadores/);
  assert.match(lastReply(context).message, /Fallos: 1/);
});

test('handleTelegramRoleGameCallback ignores stale accept callbacks for non-requested members', async () => {
  const game = sampleRoleGame({ id: 75, primaryGmTelegramUserId: 42 });
  const confirmed = sampleRoleGameMember({ id: 14, roleGameId: game.id, telegramUserId: 100, status: 'confirmed' });
  let setCalls = 0;
  const context = createRoleGameTestContext({
    messageText: '',
    callbackData: 'role_game:reject:14',
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId: new Map([[game.id, [confirmed]]]),
      onSetMemberStatus: async (input) => {
        setCalls += 1;
        return { ...confirmed, status: input.status };
      },
    }),
  });

  const handled = await handleTelegramRoleGameCallback(context);

  assert.equal(handled, true);
  assert.equal(setCalls, 0);
  assert.match(lastReply(context).message, /No se ha encontrado/);
});

function createRoleGameTestContext({
  messageText,
  callbackData,
  roleGameRepository = createFakeRoleGameRepository(),
  scheduleRepository = createFakeScheduleRepository(),
  storageRepository,
  membershipRepository = createFakeMembershipRepository(),
  session = {},
  actor = {},
  onSendPrivateMessage,
  onCopyMessage,
  onWarning,
}: {
  messageText: string;
  callbackData?: string;
  roleGameRepository?: RoleGameRepository;
  scheduleRepository?: ScheduleRepository;
  storageRepository?: StorageCategoryRepository;
  membershipRepository?: MembershipAccessRepository;
  session?: {
    current?: TelegramCommandHandlerContext['runtime']['session']['current'];
  };
  actor?: Partial<TelegramCommandHandlerContext['runtime']['actor']>;
  onSendPrivateMessage?: (telegramUserId: number, message: string) => Promise<void>;
  onCopyMessage?: (input: { fromChatId: number; messageId: number; toChatId: number }) => Promise<{ messageId: number }>;
  onWarning?: (bindings: object, message: string) => void;
}): TelegramCommandHandlerContext & {
  roleGameRepository: RoleGameRepository;
  scheduleRepository: ScheduleRepository;
  storageRepository?: StorageCategoryRepository;
  membershipRepository?: MembershipAccessRepository;
  replies: Array<{ message: string; options?: TelegramReplyOptions }>;
} {
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const runtimeSession = {
    current: session.current ?? null,
    start: async (nextSession: { flowKey: string; stepKey: string; data: Record<string, unknown> }) => {
      runtimeSession.current = {
        key: 'telegram.session:1:42',
        flowKey: nextSession.flowKey,
        stepKey: nextSession.stepKey,
        data: nextSession.data,
        createdAt: '2026-07-09T10:00:00.000Z',
        updatedAt: '2026-07-09T10:00:00.000Z',
        expiresAt: '2026-07-09T11:00:00.000Z',
      };
    },
    advance: async (nextSession: { stepKey: string; data: Record<string, unknown> }) => {
      if (!runtimeSession.current) {
        return;
      }
      runtimeSession.current = {
        ...runtimeSession.current,
        stepKey: nextSession.stepKey,
        data: nextSession.data,
      };
    },
    cancel: async () => {
      const hadSession = runtimeSession.current !== null;
      runtimeSession.current = null;
      return hadSession;
    },
  };

  return {
    messageText,
    callbackData,
    roleGameRepository,
    scheduleRepository,
    ...(storageRepository ? { storageRepository } : {}),
    ...(membershipRepository ? { membershipRepository } : {}),
    replies,
    reply: async (message: string, options?: TelegramReplyOptions) => {
      replies.push(options ? { message, options } : { message });
    },
    runtime: {
      actor: {
        telegramUserId: 42,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin: false,
        permissions: [],
        ...actor,
      },
      authorization: {
        authorize: (permissionKey: string) => ({ allowed: true, permissionKey, reason: 'test' }),
        can: () => true,
      },
      chat: { kind: 'private', chatId: 1 },
      services: { database: { pool: undefined as never, db: {}, close: async () => {} } },
      session: runtimeSession,
      logger: { warn: onWarning ?? (() => {}) },
      bot: {
        publicName: 'Game Club Bot',
        clubName: 'Game Club',
        language: 'es',
        sendPrivateMessage: onSendPrivateMessage ?? (async () => {}),
        copyMessage: onCopyMessage ?? (async () => ({ messageId: 900 })),
      },
    },
  } as unknown as TelegramCommandHandlerContext & {
    roleGameRepository: RoleGameRepository;
    scheduleRepository: ScheduleRepository;
    storageRepository?: StorageCategoryRepository;
    membershipRepository?: MembershipAccessRepository;
    replies: Array<{ message: string; options?: TelegramReplyOptions }>;
  };
}

function lastReply(context: { replies: Array<{ message: string; options?: TelegramReplyOptions }> }) {
  const reply = context.replies.at(-1);
  assert.ok(reply);
  return reply;
}

async function sendRoleGameText(
  context: TelegramCommandHandlerContext & { roleGameRepository: RoleGameRepository; replies: Array<{ message: string; options?: TelegramReplyOptions }> },
  messageText: string,
): Promise<boolean> {
  context.messageText = messageText;
  return handleTelegramRoleGameText(context);
}

async function openRoleGameParticipant(
  context: TelegramCommandHandlerContext & { roleGameRepository: RoleGameRepository; replies: Array<{ message: string; options?: TelegramReplyOptions }> },
  label: string,
): Promise<void> {
  await handleTelegramRoleGameStartText(context);
  await sendRoleGameText(context, 'Participantes');
  await sendRoleGameText(context, label);
}

function getCurrentSession(context: TelegramCommandHandlerContext & { roleGameRepository: RoleGameRepository }) {
  return context.runtime.session.current;
}

function assertRoleGame(game: RoleGameRecord | null): RoleGameRecord {
  assert.ok(game);
  return game;
}

function assertRoleGameMember(member: RoleGameMemberRecord | null): RoleGameMemberRecord {
  assert.ok(member);
  return member;
}

function assertRoleGameMaterial(material: RoleGameMaterialRecord | null): RoleGameMaterialRecord {
  assert.ok(material);
  return material;
}

function buttonText(button: TelegramReplyKeyboardButton): string {
  return typeof button === 'string' ? button : button.text;
}

function createFakeRoleGameRepository({
  visibleGames = [],
  userGames = [],
  gamesById = [...visibleGames, ...userGames],
  membersByGameId = new Map<number, RoleGameMemberRecord[]>(),
  sessionLinksByGameId = new Map<number, RoleGameSessionRecord[]>(),
  materialsById = [],
  onCreateGame,
  onUpdateGame,
  onRequestSeat,
  onConfirmMemberSeat,
  onSetMemberRole,
  onSetMemberStatus,
  onListMembers,
  onCreateMaterial,
  onUpdateMaterialVisibility,
  onCreateMaterialDelivery,
}: {
  visibleGames?: RoleGameRecord[];
  userGames?: RoleGameRecord[];
  gamesById?: RoleGameRecord[];
  membersByGameId?: Map<number, RoleGameMemberRecord[]>;
  sessionLinksByGameId?: Map<number, RoleGameSessionRecord[]>;
  materialsById?: RoleGameMaterialRecord[];
  onCreateGame?: (input: CreateRoleGameInput) => Promise<RoleGameRecord>;
  onUpdateGame?: (input: Parameters<RoleGameRepository['updateGame']>[0]) => Promise<RoleGameRecord>;
  onRequestSeat?: (input: {
    roleGameId: number;
    telegramUserId: number;
    actorTelegramUserId: number;
    isExternal: boolean;
  }) => Promise<RoleGameMemberRecord>;
  onConfirmMemberSeat?: (input: Parameters<RoleGameRepository['confirmMemberSeat']>[0]) => Promise<RoleGameMemberRecord>;
  onSetMemberRole?: (input: Parameters<RoleGameRepository['setMemberRole']>[0]) => Promise<RoleGameMemberRecord>;
  onSetMemberStatus?: (input: {
    memberId: number;
    status: RoleGameMemberRecord['status'];
    actorTelegramUserId: number;
  }) => Promise<RoleGameMemberRecord>;
  onListMembers?: (gameId: number) => Promise<RoleGameMemberRecord[]>;
  onCreateMaterial?: (input: CreateRoleGameMaterialInput) => Promise<RoleGameMaterialRecord>;
  onUpdateMaterialVisibility?: (input: Parameters<RoleGameRepository['updateMaterialVisibility']>[0]) => Promise<RoleGameMaterialRecord>;
  onCreateMaterialDelivery?: (input: CreateRoleGameMaterialDeliveryInput) => Promise<RoleGameMaterialDeliveryRecord>;
} = {}): FakeRoleGameRepository {
  const createdSessionLinks: RoleGameSessionRecord[] = Array.from(sessionLinksByGameId.values()).flat();
  const materials = new Map<number, RoleGameMaterialRecord>(materialsById.map((material) => [material.id, material]));
  return {
    createGame: async (input) => {
      if (onCreateGame) {
        return onCreateGame(input);
      }
      throw new Error('not implemented in this test');
    },
    findGameById: async (gameId) => gamesById.find((game) => game.id === gameId) ?? null,
    updateGame: async (input) => {
      if (onUpdateGame) {
        return onUpdateGame(input);
      }
      throw new Error('not implemented in this test');
    },
    listVisibleGames: async () => visibleGames,
    listGamesForUser: async () => userGames,
    createOrUpdateMember: async () => {
      throw new Error('not implemented in this test');
    },
    findMember: async (gameId, telegramUserId) =>
      membersByGameId.get(gameId)?.find((member) => member.telegramUserId === telegramUserId) ?? null,
    findMemberByTelegramUserId: async (gameId, telegramUserId) =>
      membersByGameId.get(gameId)?.find((member) => member.telegramUserId === telegramUserId) ?? null,
    findMemberById: async (memberId) => {
      for (const members of membersByGameId.values()) {
        const member = members.find((candidate) => candidate.id === memberId);
        if (member) {
          return member;
        }
      }
      return null;
    },
    listMembers: async (gameId) => onListMembers ? onListMembers(gameId) : membersByGameId.get(gameId) ?? [],
    countConfirmedPlayers: async (gameId) =>
      (membersByGameId.get(gameId) ?? []).filter((member) => member.role === 'player' && member.status === 'confirmed').length,
    createMember: async () => {
      throw new Error('not implemented in this test');
    },
    createSessionLink: async (input: CreateRoleGameSessionLinkInput) => {
      const link: RoleGameSessionRecord = {
        id: createdSessionLinks.length + 1,
        ...input,
        createdAt: '2026-07-09T10:00:00.000Z',
      };
      createdSessionLinks.push(link);
      return link;
    },
    listSessionLinks: async (gameId) => createdSessionLinks.filter((link) => link.roleGameId === gameId),
    createMaterial: async (input) => {
      if (onCreateMaterial) {
        return onCreateMaterial(input);
      }
      throw new Error('not implemented in this test');
    },
    findMaterialById: async (materialId) => materials.get(materialId) ?? null,
    listMaterials: async (gameId) =>
      Array.from(materials.values())
        .filter((material) => material.roleGameId === gameId)
        .sort((left, right) => left.id - right.id),
    updateMaterialVisibility: async (input) => {
      if (onUpdateMaterialVisibility) {
        const updated = await onUpdateMaterialVisibility(input);
        materials.set(updated.id, updated);
        return updated;
      }
      throw new Error('not implemented in this test');
    },
    createMaterialDelivery: async (input) => {
      if (onCreateMaterialDelivery) {
        return onCreateMaterialDelivery(input);
      }
      throw new Error('not implemented in this test');
    },
    requestSeat: async (input) => {
      if (onRequestSeat) {
        return onRequestSeat(input);
      }
      throw new Error('not implemented in this test');
    },
    confirmMemberSeat: async (input) => {
      if (onConfirmMemberSeat) {
        return onConfirmMemberSeat(input);
      }
      return updateFakeRoleGameMember(membersByGameId, input.memberId, (member) => ({ ...member, status: 'confirmed' }));
    },
    setMemberRole: async (input) => {
      if (onSetMemberRole) {
        return onSetMemberRole(input);
      }
      return updateFakeRoleGameMember(membersByGameId, input.memberId, (member) => ({ ...member, role: input.role }));
    },
    setMemberStatus: async (input) => {
      if (onSetMemberStatus) {
        return onSetMemberStatus(input);
      }
      return updateFakeRoleGameMember(membersByGameId, input.memberId, (member) => ({ ...member, status: input.status }));
    },
    createdSessionLinks,
  } as FakeRoleGameRepository;
}

function updateFakeRoleGameMember(
  membersByGameId: Map<number, RoleGameMemberRecord[]>,
  memberId: number,
  update: (member: RoleGameMemberRecord) => RoleGameMemberRecord,
): RoleGameMemberRecord {
  for (const [gameId, members] of membersByGameId) {
    const index = members.findIndex((member) => member.id === memberId);
    if (index >= 0) {
      const member = members[index];
      if (!member) {
        throw new Error(`Role game member ${memberId} not found`);
      }
      const updated = update(member);
      const nextMembers = [...members];
      nextMembers[index] = updated;
      membersByGameId.set(gameId, nextMembers);
      return updated;
    }
  }
  throw new Error(`Role game member ${memberId} not found`);
}

function createFakeScheduleRepository({
  events: initialEvents = [],
}: {
  events?: ScheduleEventRecord[];
} = {}): ScheduleRepository {
  const events = new Map<number, ScheduleEventRecord>(initialEvents.map((event) => [event.id, event]));
  const participants = new Map<string, ScheduleParticipantRecord>();
  let nextEventId = Math.max(0, ...initialEvents.map((event) => event.id)) + 1;
  return {
    createEvent: async (input) => {
      const createdAt = '2026-07-09T10:00:00.000Z';
      const event: ScheduleEventRecord = {
        id: nextEventId,
        ...input,
        detailsMessageChatId: input.detailsMessageChatId ?? null,
        detailsMessageId: input.detailsMessageId ?? null,
        catalogItemId: input.catalogItemId ?? null,
        lifecycleStatus: 'scheduled',
        createdAt,
        updatedAt: createdAt,
        cancelledAt: null,
        cancelledByTelegramUserId: null,
        cancellationReason: null,
      };
      nextEventId += 1;
      events.set(event.id, event);
      return event;
    },
    findEventById: async (eventId) => events.get(eventId) ?? null,
    listEvents: async (input) =>
      Array.from(events.values()).filter((event) => input.includeCancelled || event.lifecycleStatus !== 'cancelled'),
    updateEvent: async () => {
      throw new Error('not implemented in this test');
    },
    cancelEvent: async () => {
      throw new Error('not implemented in this test');
    },
    findParticipant: async (eventId, participantTelegramUserId) => participants.get(`${eventId}:${participantTelegramUserId}`) ?? null,
    listParticipants: async (eventId) =>
      Array.from(participants.values()).filter((participant) => participant.scheduleEventId === eventId),
    upsertParticipant: async (input) => {
      const existing = participants.get(`${input.eventId}:${input.participantTelegramUserId}`);
      const participant: ScheduleParticipantRecord = {
        scheduleEventId: input.eventId,
        participantTelegramUserId: input.participantTelegramUserId,
        status: input.status,
        addedByTelegramUserId: existing?.addedByTelegramUserId ?? input.actorTelegramUserId,
        removedByTelegramUserId: input.status === 'removed' ? input.actorTelegramUserId : null,
        joinedAt: existing?.joinedAt ?? '2026-07-09T10:00:00.000Z',
        updatedAt: '2026-07-09T10:00:00.000Z',
        leftAt: input.status === 'removed' ? '2026-07-09T10:00:00.000Z' : null,
      };
      participants.set(`${input.eventId}:${input.participantTelegramUserId}`, participant);
      return participant;
    },
  };
}

type FakeStorageRepository = StorageCategoryRepository & {
  createdEntries: Array<{
    categoryId: number;
    messages: StorageEntryMessageInput[];
  }>;
};

function createFakeStorageRepository(): FakeStorageRepository {
  const category: StorageCategoryRecord = {
    id: 8,
    slug: 'role-handouts',
    displayName: 'Handouts de rol',
    parentCategoryId: null,
    description: null,
    storageChatId: -1008,
    storageThreadId: 18,
    categoryPurpose: 'role_game_handouts',
    lifecycleStatus: 'active',
    createdAt: '2026-07-09T10:00:00.000Z',
    updatedAt: '2026-07-09T10:00:00.000Z',
    archivedAt: null,
  };
  const entries = new Map<number, StorageEntryDetailRecord>();
  const createdEntries: FakeStorageRepository['createdEntries'] = [];
  return {
    createdEntries,
    createCategory: async () => {
      throw new Error('not implemented in this test');
    },
    updateCategoryLifecycleStatus: async () => {
      throw new Error('not implemented in this test');
    },
    updateCategoryMetadata: async () => {
      throw new Error('not implemented in this test');
    },
    updateCategoryParent: async () => {
      throw new Error('not implemented in this test');
    },
    findCategoryById: async (categoryId) => (categoryId === category.id ? category : null),
    findCategoryByStorageThread: async () => null,
    listAllCategoriesForInternalUse: async () => [category],
    listCategories: async () => [],
    createEntry: async (input) => {
      createdEntries.push({ categoryId: input.categoryId, messages: input.messages });
      const detail: StorageEntryDetailRecord = {
        category,
        entry: {
          id: entries.size + 1,
          categoryId: input.categoryId,
          createdByTelegramUserId: input.createdByTelegramUserId,
          sourceKind: input.sourceKind,
          description: input.description,
          tags: input.tags,
          lifecycleStatus: 'active',
          deletedByTelegramUserId: null,
          createdAt: '2026-07-09T10:00:00.000Z',
          updatedAt: '2026-07-09T10:00:00.000Z',
          deletedAt: null,
        },
        messages: input.messages.map((message, index) => ({
          id: index + 1,
          entryId: entries.size + 1,
          storageChatId: message.storageChatId,
          storageMessageId: message.storageMessageId,
          storageThreadId: message.storageThreadId,
          telegramFileId: message.telegramFileId ?? null,
          telegramFileUniqueId: message.telegramFileUniqueId ?? null,
          attachmentKind: message.attachmentKind,
          caption: message.caption ?? null,
          originalFileName: message.originalFileName ?? null,
          mimeType: message.mimeType ?? null,
          fileSizeBytes: message.fileSizeBytes ?? null,
          mediaGroupId: message.mediaGroupId ?? null,
          sortOrder: message.sortOrder,
          createdAt: '2026-07-09T10:00:00.000Z',
        })),
        uploader: null,
      };
      entries.set(detail.entry.id, detail);
      return detail;
    },
    appendEntryMessages: async () => {
      throw new Error('not implemented in this test');
    },
    updateEntryMetadata: async () => {
      throw new Error('not implemented in this test');
    },
    updateEntryCategory: async () => {
      throw new Error('not implemented in this test');
    },
    updateEntryLifecycleStatus: async () => {
      throw new Error('not implemented in this test');
    },
    getEntryDetail: async (entryId) => entries.get(entryId) ?? null,
    listEntryDetailsByCategory: async () => [],
    searchEntryDetails: async () => [],
  };
}

async function createStoredRoleGameMaterialEntry(repository: FakeStorageRepository): Promise<StorageEntryDetailRecord> {
  return repository.createEntry({
    categoryId: 8,
    createdByTelegramUserId: 42,
    sourceKind: 'dm_copy',
    description: 'Mapa secreto',
    tags: ['rol'],
    messages: [{
      storageChatId: -1008,
      storageMessageId: 900,
      storageThreadId: 18,
      telegramFileId: 'file-map',
      telegramFileUniqueId: 'unique-map',
      attachmentKind: 'document',
      caption: null,
      originalFileName: 'mapa.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 1024,
      mediaGroupId: null,
      sortOrder: 0,
    }],
  });
}

function sampleRoleGame(overrides: Partial<RoleGameRecord> = {}): RoleGameRecord {
  return {
    id: 1,
    type: 'campaign',
    status: 'active',
    title: 'Partida de prueba',
    system: 'Dungeons & Dragons',
    description: 'Una partida lista para jugar.',
    visibility: 'members',
    publicJoinPolicy: 'members_only',
    entryMode: 'request',
    acceptanceMode: 'manual_review',
    capacity: 5,
    primaryGmTelegramUserId: 42,
    defaultDurationMinutes: 180,
    defaultTableId: null,
    defaultAttendanceMode: 'closed',
    defaultIsPublicScheduleEvent: false,
    autoAddConfirmedPlayers: true,
    allowPlayerManualScheduling: false,
    schedulingMode: 'manual',
    recurrenceRule: null,
    recurrenceWindowCount: 0,
    createdByTelegramUserId: 42,
    createdAt: '2026-07-09T10:00:00.000Z',
    updatedAt: '2026-07-09T10:00:00.000Z',
    closedAt: null,
    ...overrides,
  };
}

function sampleRoleGameMember(overrides: Partial<RoleGameMemberRecord> = {}): RoleGameMemberRecord {
  return {
    id: 1,
    roleGameId: 1,
    telegramUserId: 42,
    role: 'player',
    status: 'requested',
    isExternal: false,
    characterName: null,
    playerNote: null,
    requestedByTelegramUserId: 42,
    createdAt: '2026-07-09T10:00:00.000Z',
    updatedAt: '2026-07-09T10:00:00.000Z',
    ...overrides,
  };
}

function sampleMembershipUser(overrides: Partial<MembershipUserRecord> = {}): MembershipUserRecord {
  return {
    telegramUserId: 101,
    username: null,
    displayName: 'Usuario 101',
    status: 'approved',
    isAdmin: false,
    ...overrides,
  };
}

function createFakeMembershipRepository(users: MembershipUserRecord[] = []): MembershipAccessRepository {
  const usersByTelegramId = new Map(users.map((user) => [user.telegramUserId, user]));
  return {
    findUserByTelegramUserId: async (telegramUserId) => usersByTelegramId.get(telegramUserId) ?? null,
  } as MembershipAccessRepository;
}

function sampleSessionLink(overrides: Partial<RoleGameSessionRecord> = {}): RoleGameSessionRecord {
  return {
    id: 1,
    roleGameId: 1,
    scheduleEventId: 1,
    source: 'manual',
    generatedForStartsAt: null,
    createdByTelegramUserId: 42,
    createdAt: '2026-07-09T10:00:00.000Z',
    ...overrides,
  };
}

function sampleRoleGameMaterial(overrides: Partial<RoleGameMaterialRecord> = {}): RoleGameMaterialRecord {
  return {
    id: 1,
    roleGameId: 1,
    internalStorageEntryId: 33,
    title: 'Mapa secreto',
    description: null,
    visibility: 'gm_only',
    deliveryState: 'not_sent',
    uploadedByTelegramUserId: 42,
    createdAt: '2026-07-09T10:00:00.000Z',
    updatedAt: '2026-07-09T10:00:00.000Z',
    revealedAt: null,
    ...overrides,
  };
}

function sampleRoleGameMaterialDelivery(overrides: Partial<RoleGameMaterialDeliveryRecord> = {}): RoleGameMaterialDeliveryRecord {
  return {
    id: 1,
    roleGameMaterialId: 1,
    recipientTelegramUserId: 100,
    sentByTelegramUserId: 42,
    deliveryMode: 'send_only',
    status: 'sent',
    errorCode: null,
    sentAt: '2026-07-09T10:00:00.000Z',
    ...overrides,
  };
}

function sampleScheduleEvent(overrides: Partial<ScheduleEventRecord> = {}): ScheduleEventRecord {
  return {
    id: 1,
    title: 'Partida de prueba',
    description: 'Una partida lista para jugar.',
    detailsMessageChatId: null,
    detailsMessageId: null,
    startsAt: '2026-08-06T16:00:00.000Z',
    durationMinutes: 180,
    organizerTelegramUserId: 42,
    createdByTelegramUserId: 42,
    tableId: null,
    attendanceMode: 'closed',
    isPublic: false,
    initialOccupiedSeats: 0,
    capacity: 5,
    lifecycleStatus: 'scheduled',
    createdAt: '2026-07-09T10:00:00.000Z',
    updatedAt: '2026-07-09T10:00:00.000Z',
    cancelledAt: null,
    cancelledByTelegramUserId: null,
    cancellationReason: null,
    ...overrides,
  };
}
