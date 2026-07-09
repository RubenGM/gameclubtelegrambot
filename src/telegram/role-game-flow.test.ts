import test from 'node:test';
import assert from 'node:assert/strict';

import {
  handleTelegramRoleGameCallback,
  handleTelegramRoleGameStartText,
  handleTelegramRoleGameText,
} from './role-game-flow.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import type {
  CreateRoleGameInput,
  CreateRoleGameSessionLinkInput,
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
  session = {},
  actor = {},
}: {
  messageText: string;
  callbackData?: string;
  roleGameRepository?: RoleGameRepository;
  scheduleRepository?: ScheduleRepository;
  session?: {
    current?: TelegramCommandHandlerContext['runtime']['session']['current'];
  };
  actor?: Partial<TelegramCommandHandlerContext['runtime']['actor']>;
}): TelegramCommandHandlerContext & { roleGameRepository: RoleGameRepository; scheduleRepository: ScheduleRepository; replies: Array<{ message: string; options?: TelegramReplyOptions }> } {
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
      bot: {
        publicName: 'Game Club Bot',
        clubName: 'Game Club',
        language: 'es',
        sendPrivateMessage: async () => {},
      },
    },
  } as unknown as TelegramCommandHandlerContext & { roleGameRepository: RoleGameRepository; scheduleRepository: ScheduleRepository; replies: Array<{ message: string; options?: TelegramReplyOptions }> };
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

function buttonText(button: TelegramReplyKeyboardButton): string {
  return typeof button === 'string' ? button : button.text;
}

function createFakeRoleGameRepository({
  visibleGames = [],
  userGames = [],
  gamesById = [...visibleGames, ...userGames],
  membersByGameId = new Map<number, RoleGameMemberRecord[]>(),
  sessionLinksByGameId = new Map<number, RoleGameSessionRecord[]>(),
  onCreateGame,
  onUpdateGame,
  onRequestSeat,
  onSetMemberStatus,
}: {
  visibleGames?: RoleGameRecord[];
  userGames?: RoleGameRecord[];
  gamesById?: RoleGameRecord[];
  membersByGameId?: Map<number, RoleGameMemberRecord[]>;
  sessionLinksByGameId?: Map<number, RoleGameSessionRecord[]>;
  onCreateGame?: (input: CreateRoleGameInput) => Promise<RoleGameRecord>;
  onUpdateGame?: (input: Parameters<RoleGameRepository['updateGame']>[0]) => Promise<RoleGameRecord>;
  onRequestSeat?: (input: {
    roleGameId: number;
    telegramUserId: number;
    actorTelegramUserId: number;
    isExternal: boolean;
  }) => Promise<RoleGameMemberRecord>;
  onSetMemberStatus?: (input: {
    memberId: number;
    status: RoleGameMemberRecord['status'];
    actorTelegramUserId: number;
  }) => Promise<RoleGameMemberRecord>;
} = {}): FakeRoleGameRepository {
  const createdSessionLinks: RoleGameSessionRecord[] = Array.from(sessionLinksByGameId.values()).flat();
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
    listMembers: async (gameId) => membersByGameId.get(gameId) ?? [],
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
    createMaterial: async () => {
      throw new Error('not implemented in this test');
    },
    findMaterialById: async () => null,
    updateMaterialVisibility: async () => {
      throw new Error('not implemented in this test');
    },
    createMaterialDelivery: async () => {
      throw new Error('not implemented in this test');
    },
    requestSeat: async (input) => {
      if (onRequestSeat) {
        return onRequestSeat(input);
      }
      throw new Error('not implemented in this test');
    },
    setMemberStatus: async (input) => {
      if (onSetMemberStatus) {
        return onSetMemberStatus(input);
      }
      throw new Error('not implemented in this test');
    },
    createdSessionLinks,
  } as FakeRoleGameRepository;
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
