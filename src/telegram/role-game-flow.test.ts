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
  RoleGameMaterialCategoryRecord,
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
import type { NewsGroupRepository } from '../news/news-group-catalog.js';
import type { ClubTableRepository } from '../tables/table-catalog.js';
import type { VenueEventRepository } from '../venue-events/venue-event-catalog.js';
import type { TelegramReplyKeyboardButton } from './runtime-boundary.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import type { AppMetadataSessionStorage } from './conversation-session-store.js';

type FakeRoleGameRepository = RoleGameRepository & { createdSessionLinks: RoleGameSessionRecord[] };

test('handleTelegramRoleGameText opens the user role-game list directly', async () => {
  const context = createRoleGameTestContext({ messageText: '/rol' });
  const handled = await handleTelegramRoleGameText(context);

  assert.equal(handled, true);
  assert.match(lastReply(context).message, /No tienes partidas de rol activas/);
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
    ['Sesiones', 'Personajes', 'Materiales'],
    ['Invitar', 'Configurar'],
    ['Volver a mis partidas'],
    ['Inicio', 'Ayuda'],
  ]);
  assert.deepEqual(getCurrentSession(context)?.data, { gameId: game.id, view: 'dashboard' });
  assert.equal(getCurrentSession(context)?.flowKey, 'role-game-detail');
});

test('role game dashboard shows occupancy, pending requests, and the nearest future linked Agenda session', async () => {
  const game = sampleRoleGame({ id: 310, capacity: 5, primaryGmTelegramUserId: 42 });
  const members = [
    sampleRoleGameMember({ id: 3101, roleGameId: game.id, telegramUserId: 101, role: 'player', status: 'confirmed' }),
    sampleRoleGameMember({ id: 3102, roleGameId: game.id, telegramUserId: 102, role: 'player', status: 'confirmed' }),
    sampleRoleGameMember({ id: 3103, roleGameId: game.id, telegramUserId: 103, role: 'player', status: 'requested' }),
    sampleRoleGameMember({ id: 3104, roleGameId: game.id, telegramUserId: 104, role: 'coorganizer', status: 'confirmed' }),
  ];
  const cancelled = sampleScheduleEvent({ id: 401, startsAt: '2099-01-10T18:00:00.000Z', lifecycleStatus: 'cancelled' });
  const nearest = sampleScheduleEvent({ id: 402, startsAt: '2099-01-15T18:00:00.000Z' });
  const later = sampleScheduleEvent({ id: 403, startsAt: '2099-02-15T18:00:00.000Z' });
  const baseScheduleRepository = createFakeScheduleRepository({ events: [cancelled, nearest, later] });
  let listEventCalls = 0;
  let findEventCalls = 0;
  const scheduleRepository: ScheduleRepository = {
    ...baseScheduleRepository,
    listEvents: async (input) => {
      listEventCalls += 1;
      return baseScheduleRepository.listEvents(input);
    },
    findEventById: async (eventId) => {
      findEventCalls += 1;
      return baseScheduleRepository.findEventById(eventId);
    },
  };
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({
      visibleGames: [game],
      gamesById: [game],
      membersByGameId: new Map([[game.id, members]]),
      sessionLinksByGameId: new Map([[game.id, [cancelled, nearest, later].map((event, index) => sampleSessionLink({
        id: index + 1,
        roleGameId: game.id,
        scheduleEventId: event.id,
      }))]]),
    }),
    scheduleRepository,
  });

  await handleTelegramRoleGameStartText(context);

  assert.match(lastReply(context).message, /Jugadores actuales: 2\/5/);
  assert.match(lastReply(context).message, /Solicitudes pendientes: 1/);
  assert.match(lastReply(context).message, /Próxima sesión: .*schedule_event_402/);
  assert.doesNotMatch(lastReply(context).message, /schedule_event_401|schedule_event_403/);
  assert.equal(listEventCalls, 1);
  assert.equal(findEventCalls, 0);
  assert.ok(lastReply(context).options?.replyKeyboard?.flat().some((button) => buttonText(button) === 'Participantes · 1 pendientes'));
});

test('role game dashboard shows a localized no-session state', async () => {
  const game = sampleRoleGame({ id: 3105 });
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({ visibleGames: [game], gamesById: [game] }),
  });

  await handleTelegramRoleGameStartText(context);

  assert.match(lastReply(context).message, /No hay próximas sesiones programadas/);
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

  await handleTelegramRoleGameStartText(context);
  assert.ok(lastReply(context).options?.replyKeyboard?.flat().some((button) => buttonText(button) === 'Abrir como administrador'));
  assert.ok(!lastReply(context).options?.replyKeyboard?.flat().some((button) => buttonText(button) === 'Participantes'));
  await sendRoleGameText(context, 'Abrir como administrador');
  await sendRoleGameText(context, 'Participantes');
  await sendRoleGameText(context, 'Usuario 101');
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

  await handleTelegramRoleGameStartText(context);
  await sendRoleGameText(context, 'Abrir como administrador');
  await sendRoleGameText(context, 'Participantes');
  await sendRoleGameText(context, 'Usuario 101');
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
    ['Sesiones', 'Personajes'],
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
    ['Sesiones', 'Personajes', 'Materiales'],
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
    ['Crear categoría de material'],
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

test('global admin can request a player seat in a private invite-only game', async () => {
  const game = sampleRoleGame({
    id: 240,
    type: 'one_shot',
    visibility: 'private',
    entryMode: 'invite_only',
    acceptanceMode: 'manual_review',
    primaryGmTelegramUserId: 99,
  });
  let requested = false;
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      onRequestSeat: async (input) => {
        requested = true;
        return sampleRoleGameMember({
          id: 2400,
          roleGameId: input.roleGameId,
          telegramUserId: input.telegramUserId,
          role: 'player',
          status: 'requested',
          isExternal: input.isExternal,
        });
      },
    }),
    actor: { telegramUserId: 100, isAdmin: true, isApproved: true },
  });

  assert.equal(await handleTelegramRoleGameStartText(context), true);
  const normalButtons = lastReply(context).options?.replyKeyboard?.flat().map(buttonText) ?? [];
  assert.ok(normalButtons.includes('Solicitar plaza'));
  assert.ok(normalButtons.includes('Abrir como administrador'));
  assert.ok(!normalButtons.includes('Participantes'));
  assert.ok(!normalButtons.includes('Materiales'));
  assert.ok(!normalButtons.includes('Invitar'));

  await sendRoleGameText(context, 'Abrir como administrador');
  const adminButtons = lastReply(context).options?.replyKeyboard?.flat().map(buttonText) ?? [];
  assert.match(lastReply(context).message, /Modo administrador temporal/);
  assert.ok(adminButtons.includes('Participantes'));
  assert.ok(adminButtons.includes('Materiales'));
  assert.ok(adminButtons.includes('Salir del modo administrador'));
  assert.ok(!adminButtons.includes('Solicitar plaza'));

  await sendRoleGameText(context, 'Salir del modo administrador');
  assert.ok(lastReply(context).options?.replyKeyboard?.flat().map(buttonText).includes('Solicitar plaza'));

  await sendRoleGameText(context, 'Solicitar plaza');

  assert.equal(requested, true);
  assert.match(lastReply(context).message, /Solicitud enviada/);
});

test('role game dashboard hides seat requests from external visitors to public campaigns', async () => {
  const game = sampleRoleGame({
    id: 241,
    type: 'campaign',
    visibility: 'public',
    publicJoinPolicy: 'members_and_external',
  });
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({ gamesById: [game] }),
    actor: { telegramUserId: 100, isApproved: false, status: 'pending' },
  });

  await handleTelegramRoleGameStartText(context);

  assert.match(lastReply(context).message, /Partida de prueba/);
  assert.ok(!lastReply(context).options?.replyKeyboard?.flat().some((button) => buttonText(button) === 'Solicitar plaza'));
});

test('role game dashboard lets approved members request members-only one-shot seats', async () => {
  const game = sampleRoleGame({
    id: 242,
    type: 'one_shot',
    visibility: 'public',
    publicJoinPolicy: 'members_only',
  });
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({ gamesById: [game] }),
    actor: { telegramUserId: 100, isApproved: true, status: 'approved' },
  });

  await handleTelegramRoleGameStartText(context);

  assert.ok(lastReply(context).options?.replyKeyboard?.flat().some((button) => buttonText(button) === 'Solicitar plaza'));
});

test('historical role game members cannot request again or receive a false success receipt', async (t) => {
  for (const [index, status] of (['left', 'removed', 'rejected'] as const).entries()) {
    await t.test(status, async () => {
      const game = sampleRoleGame({ id: 243 + index, visibility: 'public' });
      const historicalMember = sampleRoleGameMember({
        id: 2431 + index,
        roleGameId: game.id,
        telegramUserId: 100,
        status,
      });
      let requestCalls = 0;
      const context = createRoleGameTestContext({
        messageText: `/start role_game_${game.id}`,
        roleGameRepository: createFakeRoleGameRepository({
          gamesById: [game],
          membersByGameId: new Map([[game.id, [historicalMember]]]),
          onRequestSeat: async () => {
            requestCalls += 1;
            return historicalMember;
          },
        }),
        actor: { telegramUserId: 100, isApproved: true, status: 'approved' },
      });

      await handleTelegramRoleGameStartText(context);
      const dashboardHasRequestButton = lastReply(context).options?.replyKeyboard?.flat()
        .some((button) => buttonText(button) === 'Solicitar plaza') ?? false;
      assert.equal(await sendRoleGameText(context, 'Solicitar plaza'), true);

      assert.equal(dashboardHasRequestButton, false);
      assert.equal(requestCalls, 0);
      assert.match(lastReply(context).message, /La solicitud de plaza ya no está disponible/);
      assert.doesNotMatch(lastReply(context).message, /Plaza confirmada|Solicitud enviada/);
      assert.equal((await context.roleGameRepository.findMemberById(historicalMember.id))?.status, status);
      assert.equal(getCurrentSession(context)?.data?.view, 'dashboard');
    });
  }
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

test('stale request-seat input recovers locally and rerenders the dashboard', async () => {
  const game = sampleRoleGame({ id: 252, visibility: 'public' });
  const membersByGameId = new Map<number, RoleGameMemberRecord[]>([[game.id, []]]);
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: createFakeRoleGameRepository({ gamesById: [game], membersByGameId }),
    actor: { telegramUserId: 100, isApproved: true, status: 'approved' },
  });

  await handleTelegramRoleGameStartText(context);
  membersByGameId.set(game.id, [sampleRoleGameMember({
    id: 2521,
    roleGameId: game.id,
    telegramUserId: 100,
    status: 'confirmed',
  })]);
  assert.equal(await sendRoleGameText(context, 'Solicitar plaza'), true);

  assert.match(lastReply(context).message, /La solicitud de plaza ya no está disponible/);
  assert.equal(getCurrentSession(context)?.data?.view, 'dashboard');
  assert.ok(lastReply(context).options?.replyKeyboard?.flat().some((button) => buttonText(button) === 'Volver a mis partidas'));
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
  const groupMessages: Array<{ chatId: number; message: string; messageThreadId?: number }> = [];
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
    newsGroupRepository: createRoleGameNewsRepository(),
    venueEventRepository: createEmptyVenueEventRepository(),
    tableRepository: createEmptyTableRepository(),
    onSendGroupMessage: async (chatId, message, options) => {
      groupMessages.push({ chatId, message, ...(options?.messageThreadId ? { messageThreadId: options.messageThreadId } : {}) });
    },
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
  assert.equal(groupMessages.length, 1);
  assert.equal(groupMessages[0]?.chatId, -100700);
  assert.equal(groupMessages[0]?.messageThreadId, 77);
  assert.match(groupMessages[0]?.message ?? '', /La partida única/);
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
    actor: { telegramUserId: 100 },
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
    actor: { telegramUserId: 100 },
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

test('legacy request callbacks use hardened management, notify participants, and render the persistent dashboard', async () => {
  const game = sampleRoleGame({ id: 72, primaryGmTelegramUserId: 42 });
  const accepted = sampleRoleGameMember({ id: 10, roleGameId: game.id, telegramUserId: 100, status: 'requested' });
  const rejected = sampleRoleGameMember({ id: 11, roleGameId: game.id, telegramUserId: 101, status: 'requested' });
  const membersByGameId = new Map([[game.id, [accepted, rejected]]]);
  const notifications: Array<{ telegramUserId: number; message: string }> = [];
  const context = createRoleGameTestContext({
    messageText: '',
    callbackData: 'role_game:accept:10',
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId,
    }),
    onSendPrivateMessage: async (telegramUserId, message) => {
      notifications.push({ telegramUserId, message });
    },
  });

  assert.equal(await handleTelegramRoleGameCallback(context), true);
  assert.equal((await context.roleGameRepository.findMemberById(accepted.id))?.status, 'confirmed');
  assert.match(lastReply(context).message, /Solicitud aceptada/i);

  context.callbackData = 'role_game:reject:11';
  assert.equal(await handleTelegramRoleGameCallback(context), true);
  assert.equal((await context.roleGameRepository.findMemberById(rejected.id))?.status, 'rejected');
  assert.match(lastReply(context).message, /Solicitud rechazada/i);
  assert.deepEqual(notifications, [
    { telegramUserId: 100, message: 'Tu plaza en Partida de prueba se ha confirmado.' },
    { telegramUserId: 101, message: 'Tu solicitud para Partida de prueba ha sido rechazada.' },
  ]);
  assert.equal(getCurrentSession(context)?.data?.view, 'dashboard');
  assert.ok(lastReply(context).options?.replyKeyboard?.flat().some((button) => buttonText(button).startsWith('Participantes')));
});

test('handleTelegramRoleGameCallback blocks non-managers from accepting requests', async () => {
  const game = sampleRoleGame({ id: 73, primaryGmTelegramUserId: 99 });
  const requested = sampleRoleGameMember({ id: 11, roleGameId: game.id, telegramUserId: 100, status: 'requested' });
  let confirmCalls = 0;
  const context = createRoleGameTestContext({
    messageText: '',
    callbackData: 'role_game:accept:11',
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId: new Map([[game.id, [requested]]]),
      onConfirmMemberSeat: async () => {
        confirmCalls += 1;
        return { ...requested, status: 'confirmed' };
      },
    }),
  });

  const handled = await handleTelegramRoleGameCallback(context);

  assert.equal(handled, true);
  assert.equal(confirmCalls, 0);
  assert.match(lastReply(context).message, /No tienes permisos/);
});

test('handleTelegramRoleGameCallback lets a manager schedule the next manual session', async () => {
  const game = sampleRoleGame({ id: 82, primaryGmTelegramUserId: 42, allowPlayerManualScheduling: false });
  const groupMessages: Array<{ chatId: number; message: string; messageThreadId?: number }> = [];
  const scheduleRepository = createFakeScheduleRepository();
  const roleGameRepository = createFakeRoleGameRepository({ gamesById: [game], membersByGameId: new Map([[game.id, []]]) });
  const context = createRoleGameTestContext({
    messageText: '',
    callbackData: 'role_game:schedule:82',
    roleGameRepository,
    scheduleRepository,
    newsGroupRepository: createRoleGameNewsRepository(),
    venueEventRepository: createEmptyVenueEventRepository(),
    tableRepository: createEmptyTableRepository(),
    onSendGroupMessage: async (chatId, message, options) => {
      groupMessages.push({ chatId, message, ...(options?.messageThreadId ? { messageThreadId: options.messageThreadId } : {}) });
    },
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
  assert.equal(groupMessages.length, 1);
  assert.equal(groupMessages[0]?.messageThreadId, 77);
  assert.match(groupMessages[0]?.message ?? '', /Partida de prueba/);
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
    }),
  });

  const handled = await handleTelegramRoleGameCallback(context);

  assert.equal(handled, true);
  assert.equal((await context.roleGameRepository.findMemberById(requested.id))?.status, 'requested');
  assert.match(lastReply(context).message, /ya está completa/i);
  assert.equal(getCurrentSession(context)?.data?.view, 'dashboard');
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
    ['Cancelar partida'],
    ['Eliminar partida'],
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

test('primary GM can cancel a campaign from configuration after explicit confirmation', async () => {
  const game = sampleRoleGame({ id: 340, title: 'Campaña terminada', primaryGmTelegramUserId: 42 });
  const repository = createFakeRoleGameRepository({
    gamesById: [game],
    userGames: [game],
    onUpdateGame: async (input) => {
      Object.assign(game, input, { id: game.id });
      return game;
    },
  });
  const context = createRoleGameTestContext({
    messageText: '',
    callbackData: `role_game:edit:${game.id}`,
    roleGameRepository: repository,
  });

  assert.equal(await handleTelegramRoleGameCallback(context), true);
  delete context.callbackData;
  await sendRoleGameText(context, 'Cancelar partida');
  assert.equal(game.status, 'active');
  assert.match(lastReply(context).message, /¿Quieres cancelar definitivamente «Campaña terminada»\?/);
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.at(0)?.map(buttonText), ['Confirmar cancelación']);

  await sendRoleGameText(context, 'Confirmar cancelación');

  assert.equal(game.status, 'cancelled');
  assert.ok(game.closedAt);
  assert.equal(context.replies.at(-2)?.message, 'Partida cancelada.');
  assert.match(lastReply(context).message, /No tienes partidas de rol activas/);
});

test('primary GM can permanently delete a one-shot after typing its exact title and confirming', async () => {
  const game = sampleRoleGame({
    id: 3410,
    title: 'One-shot de prueba',
    type: 'one_shot',
    primaryGmTelegramUserId: 42,
  });
  const repository = createFakeRoleGameRepository({ gamesById: [game], userGames: [game] });
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: repository,
  });

  assert.equal(await handleTelegramRoleGameStartText(context), true);
  assert.ok(lastReply(context).options?.replyKeyboard?.flat().map(buttonText).includes('Configurar'));

  await sendRoleGameText(context, 'Configurar');
  assert.ok(lastReply(context).options?.replyKeyboard?.flat().map(buttonText).includes('Eliminar partida'));
  await sendRoleGameText(context, 'Eliminar partida');
  assert.match(lastReply(context).message, /escribe exactamente el título/i);

  await sendRoleGameText(context, 'Título incorrecto');
  assert.ok(await repository.findGameById(game.id));
  assert.match(lastReply(context).message, /no coincide/i);

  await sendRoleGameText(context, game.title);
  assert.ok(await repository.findGameById(game.id));
  assert.match(lastReply(context).message, /Esta acción no se puede deshacer/);
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.at(0)?.map(buttonText), ['Confirmar eliminación definitiva']);

  await sendRoleGameText(context, 'Confirmar eliminación definitiva');

  assert.equal(await repository.findGameById(game.id), null);
  assert.equal(context.replies.at(-2)?.message, 'Partida eliminada definitivamente.');
  assert.match(lastReply(context).message, /No tienes partidas de rol activas/);
});

test('global admin can permanently delete a game after opening temporary admin mode', async () => {
  const game = sampleRoleGame({
    id: 3411,
    title: 'Campaña administrativa de prueba',
    visibility: 'private',
    primaryGmTelegramUserId: 42,
  });
  const repository = createFakeRoleGameRepository({ gamesById: [game] });
  const context = createRoleGameTestContext({
    messageText: `/start role_game_${game.id}`,
    roleGameRepository: repository,
    actor: { telegramUserId: 7, isAdmin: true },
  });

  assert.equal(await handleTelegramRoleGameStartText(context), true);
  assert.ok(!lastReply(context).options?.replyKeyboard?.flat().map(buttonText).includes('Configurar'));
  await sendRoleGameText(context, 'Abrir como administrador');
  await sendRoleGameText(context, 'Configurar');
  await sendRoleGameText(context, 'Eliminar partida');
  await sendRoleGameText(context, game.title);
  await sendRoleGameText(context, 'Confirmar eliminación definitiva');

  assert.equal(await repository.findGameById(game.id), null);
  assert.equal(context.replies.at(-2)?.message, 'Partida eliminada definitivamente.');
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
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.at(2)?.map(buttonText), ['Anterior']);
});

test('role game handout categories support nested navigation, creation, and recursive reveal', async () => {
  const game = sampleRoleGame({ id: 138, primaryGmTelegramUserId: 42 });
  const root = sampleRoleGameMaterialCategory({ id: 1, roleGameId: game.id, name: 'Mundo' });
  const child = sampleRoleGameMaterialCategory({ id: 2, roleGameId: game.id, parentCategoryId: root.id, name: 'PNJ' });
  const materials = [
    sampleRoleGameMaterial({ id: 20, roleGameId: game.id, categoryId: root.id, title: 'Historia' }),
    sampleRoleGameMaterial({ id: 21, roleGameId: game.id, categoryId: child.id, title: 'Ireena' }),
  ];
  const revealed: number[] = [];
  const repository = createFakeRoleGameRepository({
    gamesById: [game],
    materialCategories: [root, child],
    materialsById: materials,
    onUpdateMaterialVisibility: async (input) => {
      revealed.push(input.materialId);
      const material = materials.find((item) => item.id === input.materialId)!;
      return { ...material, visibility: input.visibility, deliveryState: input.deliveryState };
    },
  });
  const context = createRoleGameTestContext({
    messageText: '/start role_material_category_1',
    roleGameRepository: repository,
  });

  assert.equal(await handleTelegramRoleGameStartText(context), true);
  assert.match(lastReply(context).message, /Mundo/);
  assert.match(lastReply(context).message, /role_material_category_2/);
  assert.match(lastReply(context).message, /Historia/);
  assert.doesNotMatch(lastReply(context).message, /Ireena/);

  await sendRoleGameText(context, 'Crear categoría de material');
  await sendRoleGameText(context, 'Secretos');
  assert.match(lastReply(context).message, /Secretos/);

  await sendRoleGameText(context, 'Revelar toda la categoría');
  assert.deepEqual(revealed.sort((left, right) => left - right), [20, 21]);
  assert.match(context.replies.at(-2)?.message ?? '', /2 materiales/);
});

test('role game material upload collects a pack, asks for its name, and stores one named material', async () => {
  const game = sampleRoleGame({ id: 90, primaryGmTelegramUserId: 42 });
  const createdMaterials: CreateRoleGameMaterialInput[] = [];
  const storageRepository = createFakeStorageRepository();
  const copiedMessages: Array<{ fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }> = [];
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
    onCopyMessage: async (input) => {
      copiedMessages.push(input);
      return { messageId: 900 + copiedMessages.length };
    },
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

  assert.equal(await handleTelegramRoleGameMessage(context), true);
  assert.equal(createdMaterials.length, 0);
  assert.equal(storageRepository.createdEntries.length, 0);
  assert.equal(getCurrentSession(context)?.stepKey, 'attachments');
  assert.equal((getCurrentSession(context)?.data.messages as unknown[])?.length, 1);
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.at(0)?.map(buttonText), ['Añadir más archivos', 'Terminar adjuntos']);

  context.messageMedia = {
    attachmentKind: 'photo',
    fileId: 'file-image',
    fileUniqueId: 'unique-image',
    caption: null,
    originalFileName: null,
    mimeType: 'image/jpeg',
    fileSizeBytes: 512,
    mediaGroupId: 'album-1',
    messageId: 78,
  };
  assert.equal(await handleTelegramRoleGameMessage(context), true);
  assert.equal((getCurrentSession(context)?.data.messages as unknown[])?.length, 2);

  delete context.messageMedia;
  context.messageText = 'Terminar adjuntos';
  assert.equal(await handleTelegramRoleGameText(context), true);
  assert.equal(getCurrentSession(context)?.stepKey, 'name');
  assert.match(lastReply(context).message, /nombre.*material/i);

  context.messageText = 'Mapa del templo';
  assert.equal(await handleTelegramRoleGameText(context), true);

  assert.equal(getCurrentSession(context)?.flowKey, 'role-game-detail');
  assert.deepEqual(getCurrentSession(context)?.data, { gameId: game.id, view: 'materials', page: 1, materialCategoryId: null });
  assert.equal(storageRepository.createdEntries[0]?.categoryId, 8);
  assert.equal(storageRepository.createdEntries[0]?.messages.length, 2);
  assert.deepEqual(copiedMessages.map((message) => message.messageId), [77, 78]);
  assert.equal(createdMaterials[0]?.title, 'Mapa del templo');
  assert.equal(createdMaterials[0]?.visibility, 'gm_only');
  assert.equal(createdMaterials[0]?.internalStorageEntryId, 1);
  assert.match(lastReply(context).message, /Material guardado/);
  assert.match(lastReply(context).message, /role_material_5/);
  assert.doesNotMatch(lastReply(context).message, /storage_entry_/);

  assert.equal(await sendRoleGameText(context, 'Volver a la partida'), true);
  assert.equal(getCurrentSession(context)?.data.view, 'dashboard');
  assert.match(lastReply(context).message, /Partida de prueba/);
});

test('role game material detail sends every attachment and uses a persistent manager keyboard', async () => {
  const game = sampleRoleGame({ id: 92, primaryGmTelegramUserId: 42 });
  const material = sampleRoleGameMaterial({ id: 8, roleGameId: game.id, internalStorageEntryId: 1, title: 'Pack visual' });
  const storageRepository = createFakeStorageRepository();
  await storageRepository.createEntry({
    categoryId: 8,
    createdByTelegramUserId: 42,
    sourceKind: 'dm_copy',
    description: 'Pack visual',
    tags: ['rol'],
    messages: [
      {
        storageChatId: -1008,
        storageMessageId: 901,
        storageThreadId: 18,
        attachmentKind: 'photo',
        sortOrder: 0,
      },
      {
        storageChatId: -1008,
        storageMessageId: 902,
        storageThreadId: 18,
        attachmentKind: 'document',
        sortOrder: 1,
      },
    ],
  });
  const copiedMessages: Array<{ fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }> = [];
  const category = sampleRoleGameMaterialCategory({ id: 14, roleGameId: game.id, name: 'Mapas' });
  const roleGameRepository = createFakeRoleGameRepository({
    gamesById: [game],
    materialCategories: [category],
    materialsById: [material],
  });
  const context = createRoleGameTestContext({
    messageText: '/start role_material_8',
    roleGameRepository,
    storageRepository,
    onCopyMessage: async (input) => {
      copiedMessages.push(input);
      return { messageId: 1000 + copiedMessages.length };
    },
  });

  assert.equal(await handleTelegramRoleGameStartText(context), true);

  assert.deepEqual(copiedMessages.map((message) => message.messageId), [901, 902]);
  assert.equal(lastReply(context).options?.inlineKeyboard, undefined);
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.slice(0, 4).map((row) => row.map(buttonText)), [
    ['Mover a categoría'],
    ['Enviar a jugadores'],
    ['Enviar y revelar'],
    ['Revelar sin enviar'],
  ]);
  assert.equal(getCurrentSession(context)?.data.materialId, 8);

  context.messageText = 'Mover a categoría';
  assert.equal(await handleTelegramRoleGameText(context), true);
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.slice(0, 2).map((row) => row.map(buttonText)), [
    ['Sin categoría'],
    ['Mapas'],
  ]);
  context.messageText = 'Mapas';
  assert.equal(await handleTelegramRoleGameText(context), true);
  assert.equal((await roleGameRepository.findMaterialById(8))?.categoryId, category.id);

  context.messageText = 'Enviar a jugadores';
  assert.equal(await handleTelegramRoleGameText(context), true);
  assert.match(lastReply(context).message, /0\/0/);
  assert.equal(lastReply(context).options?.inlineKeyboard, undefined);
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.at(0)?.map(buttonText), ['Mover a categoría']);

  context.messageText = 'Eliminar material';
  assert.equal(await handleTelegramRoleGameText(context), true);
  assert.match(lastReply(context).message, /¿Eliminar definitivamente «Pack visual»\?/);
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.at(0)?.map(buttonText), ['Confirmar eliminación']);
  context.messageText = 'Confirmar eliminación';
  assert.equal(await handleTelegramRoleGameText(context), true);
  assert.equal(await roleGameRepository.findMaterialById(material.id), null);
  assert.equal(context.replies.at(-2)?.message, 'Material eliminado.');
  assert.doesNotMatch(lastReply(context).message, /Pack visual/);
});

test('finishing a named upload provisions the missing handout category and continues the upload', async () => {
  const game = sampleRoleGame({ id: 91, primaryGmTelegramUserId: 42 });
  const createdMaterials: CreateRoleGameMaterialInput[] = [];
  const storageRepository = createFakeStorageRepository({ includeHandoutCategory: false });
  const storageDefaultChatStore = createMemoryMetadataStore({
    'storage.default_chat': JSON.stringify({
      chatId: -100555,
      chatTitle: 'Storage Club',
      updatedAt: '2026-07-14T08:00:00.000Z',
    }),
  });
  const createdTopics: Array<{ chatId: number; name: string }> = [];
  const context = createRoleGameTestContext({
    messageText: '',
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId: new Map([[game.id, []]]),
      onCreateMaterial: async (input) => {
        createdMaterials.push(input);
        return sampleRoleGameMaterial({ ...input, id: 6 });
      },
    }),
    storageRepository,
    storageDefaultChatStore,
    onCreateForumTopic: async (input) => {
      createdTopics.push(input);
      return { chatId: input.chatId, name: input.name, messageThreadId: 31 };
    },
    session: {
      current: {
        key: 'telegram.session:1:42',
        flowKey: 'role-game-material-upload',
        stepKey: 'media',
        data: { gameId: game.id },
        createdAt: '2026-07-14T08:00:00.000Z',
        updatedAt: '2026-07-14T08:00:00.000Z',
        expiresAt: '2026-07-14T09:00:00.000Z',
      },
    },
  });
  context.messageMedia = {
    attachmentKind: 'document',
    fileId: 'file-guide',
    fileUniqueId: 'unique-guide',
    caption: 'Guía de la campaña',
    originalFileName: 'guia.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 2048,
    mediaGroupId: null,
    messageId: 78,
  };

  assert.equal(await handleTelegramRoleGameMessage(context), true);
  assert.deepEqual(createdTopics, []);

  context.messageText = 'Terminar adjuntos';
  assert.equal(await handleTelegramRoleGameText(context), true);
  context.messageText = 'Guía para jugadores';
  const handled = await handleTelegramRoleGameText(context);

  assert.equal(handled, true);
  assert.deepEqual(createdTopics, [{ chatId: -100555, name: 'Handouts de rol' }]);
  assert.equal(storageRepository.createdCategories[0]?.categoryPurpose, 'role_game_handouts');
  assert.equal(storageRepository.createdCategories[0]?.storageChatId, -100555);
  assert.equal(storageRepository.createdCategories[0]?.storageThreadId, 31);
  assert.equal(storageRepository.createdEntries[0]?.categoryId, storageRepository.createdCategories[0]?.id);
  assert.equal(storageRepository.createdEntries[0]?.messages.length, 1);
  assert.equal(createdMaterials[0]?.visibility, 'gm_only');
  assert.equal(getCurrentSession(context)?.flowKey, 'role-game-detail');
  assert.deepEqual(getCurrentSession(context)?.data, { gameId: game.id, view: 'materials', page: 1, materialCategoryId: null });
  assert.match(lastReply(context).message, /Material guardado/);
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
  const storageRepository = createFakeStorageRepository();
  const storedEntry = await createStoredRoleGameMaterialEntry(storageRepository);
  const material = sampleRoleGameMaterial({ id: 6, roleGameId: game.id, internalStorageEntryId: storedEntry.entry.id, visibility: 'gm_only', title: 'Mapa secreto' });
  const copiedMessages: number[] = [];
  const context = createRoleGameTestContext({
    messageText: '/start role_material_6',
    roleGameRepository: createFakeRoleGameRepository({
      gamesById: [game],
      membersByGameId: new Map([[game.id, []]]),
      materialsById: [material],
    }),
    storageRepository,
    onCopyMessage: async ({ messageId }) => {
      copiedMessages.push(messageId);
      return { messageId: 1000 + copiedMessages.length };
    },
  });

  const handled = await handleTelegramRoleGameStartText(context);

  assert.equal(handled, true);
  assert.match(lastReply(context).message, /Mapa secreto/);
  assert.match(lastReply(context).message, /role_material_6/);
  assert.doesNotMatch(lastReply(context).message, /storage_entry_/);
  assert.deepEqual(copiedMessages, [900]);
  assert.equal(lastReply(context).options?.inlineKeyboard, undefined);
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

test('GM can send and reveal a material to one confirmed player without exposing it to the rest', async () => {
  const game = sampleRoleGame({ id: 941, primaryGmTelegramUserId: 42 });
  const storageRepository = createFakeStorageRepository();
  const storedEntry = await createStoredRoleGameMaterialEntry(storageRepository);
  const selectedPlayer = sampleRoleGameMember({
    id: 9411,
    roleGameId: game.id,
    telegramUserId: 100,
    role: 'player',
    status: 'confirmed',
  });
  const otherPlayer = sampleRoleGameMember({
    id: 9412,
    roleGameId: game.id,
    telegramUserId: 101,
    role: 'player',
    status: 'confirmed',
  });
  const material = sampleRoleGameMaterial({
    id: 9413,
    roleGameId: game.id,
    internalStorageEntryId: storedEntry.entry.id,
    visibility: 'gm_only',
    deliveryState: 'not_sent',
    title: 'Carta secreta',
  });
  const repository = createFakeRoleGameRepository({
    gamesById: [game],
    membersByGameId: new Map([[game.id, [selectedPlayer, otherPlayer]]]),
    materialsById: [material],
  });
  const privateMessages: number[] = [];
  const copiedToChats: number[] = [];
  const gmContext = createRoleGameTestContext({
    messageText: `/start role_material_${material.id}`,
    roleGameRepository: repository,
    storageRepository,
    onSendPrivateMessage: async (telegramUserId) => {
      privateMessages.push(telegramUserId);
    },
    onCopyMessage: async ({ toChatId }) => {
      copiedToChats.push(toChatId);
      return { messageId: copiedToChats.length };
    },
  });

  assert.equal(await handleTelegramRoleGameStartText(gmContext), true);
  copiedToChats.length = 0;
  await sendRoleGameText(gmContext, 'Entregar a un jugador');
  assert.match(lastReply(gmContext).message, /Elige el jugador/);
  assert.deepEqual(lastReply(gmContext).options?.replyKeyboard?.slice(0, 2).map((row) => row.map(buttonText)), [
    ['Usuario 100'],
    ['Usuario 101'],
  ]);
  await sendRoleGameText(gmContext, 'Usuario 100');
  await sendRoleGameText(gmContext, 'Enviar y revelar a este jugador');

  assert.deepEqual(privateMessages, [100]);
  assert.deepEqual(copiedToChats, [100]);
  assert.equal((await repository.findMaterialById(material.id))?.visibility, 'gm_only');
  assert.equal(await repository.hasMaterialRecipientAccess?.(material.id, 100), true);
  assert.equal(await repository.hasMaterialRecipientAccess?.(material.id, 101), false);
  assert.match(lastReply(gmContext).message, /únicamente a Usuario 100/);

  const selectedPlayerCopies: number[] = [];
  const selectedPlayerContext = createRoleGameTestContext({
    messageText: `/start role_material_${material.id}`,
    roleGameRepository: repository,
    storageRepository,
    actor: { telegramUserId: 100 },
    onCopyMessage: async ({ toChatId }) => {
      selectedPlayerCopies.push(toChatId);
      return { messageId: selectedPlayerCopies.length };
    },
  });
  assert.equal(await handleTelegramRoleGameStartText(selectedPlayerContext), true);
  assert.match(lastReply(selectedPlayerContext).message, /Carta secreta/);
  assert.deepEqual(selectedPlayerCopies, [100]);

  const otherPlayerContext = createRoleGameTestContext({
    messageText: `/start role_material_${material.id}`,
    roleGameRepository: repository,
    storageRepository,
    actor: { telegramUserId: 101 },
  });
  assert.equal(await handleTelegramRoleGameStartText(otherPlayerContext), true);
  assert.doesNotMatch(lastReply(otherPlayerContext).message, /Carta secreta/);
  assert.match(lastReply(otherPlayerContext).message, /No se ha encontrado/);
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

test('handleTelegramRoleGameCallback recovers stale request callbacks on the persistent dashboard', async () => {
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
  assert.match(lastReply(context).message, /ha cambiado/i);
  assert.equal(getCurrentSession(context)?.data?.view, 'dashboard');
  assert.ok(lastReply(context).options?.replyKeyboard?.flat().some((button) => buttonText(button).startsWith('Participantes')));
});

function createRoleGameTestContext({
  messageText,
  callbackData,
  roleGameRepository = createFakeRoleGameRepository(),
  scheduleRepository = createFakeScheduleRepository(),
  storageRepository,
  storageDefaultChatStore,
  membershipRepository = createFakeMembershipRepository(),
  newsGroupRepository,
  venueEventRepository,
  tableRepository,
  session = {},
  actor = {},
  onSendPrivateMessage,
  onCopyMessage,
  onCreateForumTopic,
  onSendGroupMessage,
  onWarning,
}: {
  messageText: string;
  callbackData?: string;
  roleGameRepository?: RoleGameRepository;
  scheduleRepository?: ScheduleRepository;
  storageRepository?: StorageCategoryRepository;
  storageDefaultChatStore?: AppMetadataSessionStorage;
  membershipRepository?: MembershipAccessRepository;
  newsGroupRepository?: NewsGroupRepository;
  venueEventRepository?: VenueEventRepository;
  tableRepository?: ClubTableRepository;
  session?: {
    current?: TelegramCommandHandlerContext['runtime']['session']['current'];
  };
  actor?: Partial<TelegramCommandHandlerContext['runtime']['actor']>;
  onSendPrivateMessage?: (telegramUserId: number, message: string) => Promise<void>;
  onCopyMessage?: (input: { fromChatId: number; messageId: number; toChatId: number }) => Promise<{ messageId: number }>;
  onCreateForumTopic?: (input: { chatId: number; name: string }) => Promise<{ chatId: number; name: string; messageThreadId: number }>;
  onSendGroupMessage?: (chatId: number, message: string, options?: TelegramReplyOptions) => Promise<void>;
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
    ...(storageDefaultChatStore ? { storageDefaultChatStore } : {}),
    ...(membershipRepository ? { membershipRepository } : {}),
    ...(newsGroupRepository ? { newsGroupRepository } : {}),
    ...(venueEventRepository ? { venueEventRepository } : {}),
    ...(tableRepository ? { tableRepository } : {}),
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
        ...(onSendGroupMessage ? { sendGroupMessage: onSendGroupMessage } : {}),
        copyMessage: onCopyMessage ?? (async () => ({ messageId: 900 })),
        ...(onCreateForumTopic ? { createForumTopic: onCreateForumTopic } : {}),
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

function createRoleGameNewsRepository(): NewsGroupRepository {
  const target = {
    chatId: -100700,
    messageThreadId: 77,
    isEnabled: true,
    metadata: null,
    createdAt: '2026-07-09T10:00:00.000Z',
    updatedAt: '2026-07-09T10:00:00.000Z',
    enabledAt: '2026-07-09T10:00:00.000Z',
    disabledAt: null,
  };
  return {
    findGroupByChatId: async () => null,
    listGroups: async () => [],
    upsertGroup: async () => { throw new Error('not implemented in this test'); },
    listSubscriptionsByChatId: async () => [],
    upsertSubscription: async () => { throw new Error('not implemented in this test'); },
    deleteSubscription: async () => false,
    listSubscribedGroupsByCategory: async (categoryKey) => categoryKey === 'events' ? [target] : [],
    isNewsEnabledGroup: async () => true,
  };
}

function createEmptyVenueEventRepository(): VenueEventRepository {
  return {
    createVenueEvent: async () => { throw new Error('not implemented in this test'); },
    findVenueEventById: async () => null,
    listVenueEvents: async () => [],
    updateVenueEvent: async () => { throw new Error('not implemented in this test'); },
    cancelVenueEvent: async () => { throw new Error('not implemented in this test'); },
  };
}

function createEmptyTableRepository(): ClubTableRepository {
  return {
    createTable: async () => { throw new Error('not implemented in this test'); },
    findTableById: async () => null,
    listTables: async () => [],
    updateTable: async () => { throw new Error('not implemented in this test'); },
    deactivateTable: async () => { throw new Error('not implemented in this test'); },
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
  materialCategories = [],
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
  materialCategories?: RoleGameMaterialCategoryRecord[];
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
  onSetMemberStatus?: (input: Parameters<RoleGameRepository['setMemberStatus']>[0]) => Promise<RoleGameMemberRecord>;
  onListMembers?: (gameId: number) => Promise<RoleGameMemberRecord[]>;
  onCreateMaterial?: (input: CreateRoleGameMaterialInput) => Promise<RoleGameMaterialRecord>;
  onUpdateMaterialVisibility?: (input: Parameters<RoleGameRepository['updateMaterialVisibility']>[0]) => Promise<RoleGameMaterialRecord>;
  onCreateMaterialDelivery?: (input: CreateRoleGameMaterialDeliveryInput) => Promise<RoleGameMaterialDeliveryRecord>;
} = {}): FakeRoleGameRepository {
  const createdSessionLinks: RoleGameSessionRecord[] = Array.from(sessionLinksByGameId.values()).flat();
  const materials = new Map<number, RoleGameMaterialRecord>(materialsById.map((material) => [material.id, material]));
  const categories = new Map<number, RoleGameMaterialCategoryRecord>(materialCategories.map((category) => [category.id, category]));
  const materialDeliveries: RoleGameMaterialDeliveryRecord[] = [];
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
    createMaterialCategory: async (input) => {
      const created: RoleGameMaterialCategoryRecord = {
        id: Math.max(0, ...categories.keys()) + 1,
        ...input,
        createdAt: '2026-07-09T10:00:00.000Z',
        updatedAt: '2026-07-09T10:00:00.000Z',
      };
      categories.set(created.id, created);
      return created;
    },
    findMaterialCategoryById: async (categoryId) => categories.get(categoryId) ?? null,
    listMaterialCategories: async (gameId) => Array.from(categories.values()).filter((category) => category.roleGameId === gameId),
    moveMaterialToCategory: async (input) => {
      const material = materials.get(input.materialId);
      if (!material) throw new Error('Role game material not found');
      const category = input.categoryId === null ? null : categories.get(input.categoryId);
      if (category && category.roleGameId !== material.roleGameId) throw new Error('Material category does not belong to the role game');
      if (input.categoryId !== null && !category) throw new Error('Material category not found');
      const updated = { ...material, categoryId: input.categoryId };
      materials.set(updated.id, updated);
      return updated;
    },
    deleteMaterial: async (input) => {
      const material = materials.get(input.materialId);
      if (!material || material.roleGameId !== input.roleGameId) throw new Error('Role game material not found');
      materials.delete(material.id);
      return material;
    },
    deleteGame: async (input) => {
      const game = gamesById.find((candidate) => candidate.id === input.gameId);
      if (!game) throw new Error('Role game not found');
      for (const collection of new Set([gamesById, visibleGames, userGames])) {
        const index = collection.findIndex((candidate) => candidate.id === game.id);
        if (index >= 0) collection.splice(index, 1);
      }
      membersByGameId.delete(game.id);
      for (let index = createdSessionLinks.length - 1; index >= 0; index -= 1) {
        if (createdSessionLinks[index]?.roleGameId === game.id) createdSessionLinks.splice(index, 1);
      }
      for (const material of materials.values()) {
        if (material.roleGameId === game.id) materials.delete(material.id);
      }
      for (const category of categories.values()) {
        if (category.roleGameId === game.id) categories.delete(category.id);
      }
      return game;
    },
    updateMaterialVisibility: async (input) => {
      if (onUpdateMaterialVisibility) {
        const updated = await onUpdateMaterialVisibility(input);
        materials.set(updated.id, updated);
        return updated;
      }
      throw new Error('not implemented in this test');
    },
    createMaterialDelivery: async (input) => {
      const delivery = onCreateMaterialDelivery
        ? await onCreateMaterialDelivery(input)
        : sampleRoleGameMaterialDelivery({ ...input, id: materialDeliveries.length + 1 });
      materialDeliveries.push(delivery);
      return delivery;
    },
    hasMaterialRecipientAccess: async (materialId, recipientTelegramUserId) => materialDeliveries.some((delivery) =>
      delivery.roleGameMaterialId === materialId &&
      delivery.recipientTelegramUserId === recipientTelegramUserId &&
      delivery.status === 'sent' &&
      (delivery.deliveryMode === 'send_and_reveal' || delivery.deliveryMode === 'reveal_only')),
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
      return updateFakeRoleGameMember(membersByGameId, input.memberId, (member) => {
        if (member.role !== 'player' || !input.expectedStatuses.includes(member.status as 'requested' | 'invited' | 'waitlisted')) {
          throw new Error(`Role game member ${input.memberId} has stale status`);
        }
        const game = gamesById.find((candidate) => candidate.id === member.roleGameId);
        if (!game) {
          throw new Error(`Role game ${member.roleGameId} not found`);
        }
        const confirmedPlayers = (membersByGameId.get(game.id) ?? []).filter(
          (candidate) => candidate.role === 'player' && candidate.status === 'confirmed',
        ).length;
        if (confirmedPlayers >= game.capacity) {
          throw new Error(`Role game ${game.id} is full`);
        }
        return { ...member, status: 'confirmed' };
      });
    },
    setMemberRole: async (input) => {
      if (onSetMemberRole) {
        return onSetMemberRole(input);
      }
      return updateFakeRoleGameMember(membersByGameId, input.memberId, (member) => {
        if (member.status !== input.expectedStatus || member.role !== input.expectedRole) {
          throw new Error(`Role game member ${input.memberId} has stale status`);
        }
        if (input.role === 'player' && member.role !== 'player') {
          const game = gamesById.find((candidate) => candidate.id === member.roleGameId);
          if (!game) {
            throw new Error(`Role game ${member.roleGameId} not found`);
          }
          const confirmedPlayers = (membersByGameId.get(game.id) ?? []).filter(
            (candidate) => candidate.role === 'player' && candidate.status === 'confirmed',
          ).length;
          if (confirmedPlayers >= game.capacity) {
            throw new Error(`Role game ${game.id} is full`);
          }
        }
        return { ...member, role: input.role };
      });
    },
    setMemberStatus: async (input) => {
      if (onSetMemberStatus) {
        return onSetMemberStatus(input);
      }
      return updateFakeRoleGameMember(membersByGameId, input.memberId, (member) => {
        if (member.status !== input.expectedStatus || member.role !== input.expectedRole) {
          throw new Error(`Role game member ${input.memberId} has stale status`);
        }
        return { ...member, status: input.status };
      });
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
      Array.from(events.values()).filter((event) =>
        (input.includeCancelled || event.lifecycleStatus !== 'cancelled') &&
        (!input.startsAtFrom || event.startsAt >= input.startsAtFrom) &&
        (!input.startsAtTo || event.startsAt <= input.startsAtTo)),
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
  createdCategories: StorageCategoryRecord[];
  createdEntries: Array<{
    categoryId: number;
    messages: StorageEntryMessageInput[];
  }>;
};

function createFakeStorageRepository({
  includeHandoutCategory = true,
}: {
  includeHandoutCategory?: boolean;
} = {}): FakeStorageRepository {
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
  const categories = new Map<number, StorageCategoryRecord>(includeHandoutCategory ? [[category.id, category]] : []);
  const createdCategories: StorageCategoryRecord[] = [];
  const createdEntries: FakeStorageRepository['createdEntries'] = [];
  return {
    createdCategories,
    createdEntries,
    createCategory: async (input) => {
      const created: StorageCategoryRecord = {
        id: Math.max(0, ...categories.keys()) + 1,
        ...input,
        categoryPurpose: input.categoryPurpose ?? 'user_uploads',
        lifecycleStatus: 'active',
        createdAt: '2026-07-14T08:00:00.000Z',
        updatedAt: '2026-07-14T08:00:00.000Z',
        archivedAt: null,
      };
      categories.set(created.id, created);
      createdCategories.push(created);
      return created;
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
    findCategoryById: async (categoryId) => categories.get(categoryId) ?? null,
    findCategoryByStorageThread: async () => null,
    listAllCategoriesForInternalUse: async () => Array.from(categories.values()),
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

function createMemoryMetadataStore(initial: Record<string, string> = {}): AppMetadataSessionStorage {
  const values = new Map(Object.entries(initial));
  return {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value);
    },
    delete: async (key) => values.delete(key),
    listByPrefix: async (prefix) => Array.from(values.entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, value })),
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

function sampleRoleGameMaterialCategory(overrides: Partial<RoleGameMaterialCategoryRecord> = {}): RoleGameMaterialCategoryRecord {
  return {
    id: 1,
    roleGameId: 1,
    parentCategoryId: null,
    name: 'Categoría',
    createdByTelegramUserId: 42,
    createdAt: '2026-07-09T10:00:00.000Z',
    updatedAt: '2026-07-09T10:00:00.000Z',
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
