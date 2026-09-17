import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildScheduleDetailActionOptions,
  formatScheduleDescriptionSummary,
  formatTimestamp,
  truncateScheduleDescription,
} from './schedule-presentation.js';

test('formatTimestamp displays schedule timestamps in local time', () => {
  const localInstant = new Date(2026, 3, 27, 22, 15, 0, 0).toISOString();

  assert.equal(formatTimestamp(localInstant), '27/04/2026 22:15');
});

test('truncateScheduleDescription limits summaries to 30 characters including ellipsis', () => {
  assert.equal(truncateScheduleDescription('123456789012345678901234567890'), '123456789012345678901234567890');
  assert.equal(truncateScheduleDescription('1234567890123456789012345678901'), '123456789012345678901234567...');
  assert.equal(Array.from(truncateScheduleDescription('🎲'.repeat(31))).length, 30);
});

test('formatScheduleDescriptionSummary links only shortened descriptions to the activity detail', () => {
  assert.equal(
    formatScheduleDescriptionSummary({ description: 'Descripción breve', eventId: 7, language: 'es' }),
    '<i>Descripción breve</i>',
  );
  assert.match(
    formatScheduleDescriptionSummary({ description: '1234567890123456789012345678901', eventId: 7, language: 'es' }),
    /^<i>123456789012345678901234567\.\.\.<\/i> · <a href=".+schedule_event_7">Ver descripción<\/a>$/,
  );
});

test('buildScheduleDetailActionOptions provides player and spectator buttons when spots are available', () => {
  const actor = { telegramUserId: 10, username: 'player1', displayName: 'Player 1', isApproved: true, isAdmin: false };
  const event = {
    id: 1,
    title: 'Partida',
    description: null,
    detailsMessageChatId: null,
    detailsMessageId: null,
    startsAt: '2026-04-05T16:00:00.000Z',
    durationMinutes: 180,
    organizerTelegramUserId: 99,
    createdByTelegramUserId: 99,
    tableId: null,
    attendanceMode: 'open' as const,
    isPublic: false,
    initialOccupiedSeats: 0,
    capacity: 4,
    lifecycleStatus: 'scheduled' as const,
    createdAt: '2026-04-04T10:00:00.000Z',
    updatedAt: '2026-04-04T10:00:00.000Z',
    cancelledAt: null,
    cancelledByTelegramUserId: null,
    cancellationReason: null,
  };
  const prefixes = {
    join: 'schedule:join:',
    leave: 'schedule:leave:',
    selectEdit: 'schedule:edit:',
    selectCancel: 'schedule:cancel:',
    promote: 'schedule:promote:',
    joinSpectator: 'schedule:join_spec:',
    manageGuests: 'schedule:guests:',
    switchRole: 'schedule:switch:',
  };

  const options = buildScheduleDetailActionOptions({
    actor,
    event,
    isAttending: false,
    availableSeats: 2,
    language: 'es',
    callbackPrefixes: prefixes,
  });

  const buttons = options.inlineKeyboard?.flat().map((btn) => btn.text) ?? [];
  assert.ok(buttons.includes('🎮 Apuntarme a jugar'));
  assert.ok(buttons.includes('👀 Apuntarme de espectador'));
});

test('buildScheduleDetailActionOptions offers only spectator when game is full', () => {
  const actor = { telegramUserId: 10, username: 'player1', displayName: 'Player 1', isApproved: true, isAdmin: false };
  const event = {
    id: 1,
    title: 'Partida',
    description: null,
    detailsMessageChatId: null,
    detailsMessageId: null,
    startsAt: '2026-04-05T16:00:00.000Z',
    durationMinutes: 180,
    organizerTelegramUserId: 99,
    createdByTelegramUserId: 99,
    tableId: null,
    attendanceMode: 'open' as const,
    isPublic: false,
    initialOccupiedSeats: 0,
    capacity: 4,
    lifecycleStatus: 'scheduled' as const,
    createdAt: '2026-04-04T10:00:00.000Z',
    updatedAt: '2026-04-04T10:00:00.000Z',
    cancelledAt: null,
    cancelledByTelegramUserId: null,
    cancellationReason: null,
  };
  const prefixes = {
    join: 'schedule:join:',
    leave: 'schedule:leave:',
    selectEdit: 'schedule:edit:',
    selectCancel: 'schedule:cancel:',
    promote: 'schedule:promote:',
    joinSpectator: 'schedule:join_spec:',
    manageGuests: 'schedule:guests:',
    switchRole: 'schedule:switch:',
  };

  const options = buildScheduleDetailActionOptions({
    actor,
    event,
    isAttending: false,
    availableSeats: 0,
    language: 'es',
    callbackPrefixes: prefixes,
  });

  const buttons = options.inlineKeyboard?.flat().map((btn) => btn.text) ?? [];
  assert.ok(!buttons.includes('🎮 Apuntarme a jugar'));
  assert.ok(buttons.includes('👀 Apuntarme de espectador (mesa llena)'));
});

test('buildScheduleDetailActionOptions allows attending user to manage companions and switch roles', () => {
  const actor = { telegramUserId: 10, username: 'player1', displayName: 'Player 1', isApproved: true, isAdmin: false };
  const event = {
    id: 1,
    title: 'Partida',
    description: null,
    detailsMessageChatId: null,
    detailsMessageId: null,
    startsAt: '2026-04-05T16:00:00.000Z',
    durationMinutes: 180,
    organizerTelegramUserId: 99,
    createdByTelegramUserId: 99,
    tableId: null,
    attendanceMode: 'open' as const,
    isPublic: false,
    initialOccupiedSeats: 0,
    capacity: 4,
    lifecycleStatus: 'scheduled' as const,
    createdAt: '2026-04-04T10:00:00.000Z',
    updatedAt: '2026-04-04T10:00:00.000Z',
    cancelledAt: null,
    cancelledByTelegramUserId: null,
    cancellationReason: null,
  };
  const prefixes = {
    join: 'schedule:join:',
    leave: 'schedule:leave:',
    selectEdit: 'schedule:edit:',
    selectCancel: 'schedule:cancel:',
    promote: 'schedule:promote:',
    joinSpectator: 'schedule:join_spec:',
    manageGuests: 'schedule:guests:',
    switchRole: 'schedule:switch:',
  };

  // Attending as player with 2 companions and 1 spectator
  const playerOptions = buildScheduleDetailActionOptions({
    actor,
    event,
    isAttending: true,
    participationRole: 'player',
    companionCount: 2,
    spectatorCount: 1,
    availableSeats: 1,
    language: 'es',
    callbackPrefixes: prefixes,
  });

  const playerButtons = playerOptions.inlineKeyboard?.flat().map((btn) => btn.text) ?? [];
  assert.ok(playerButtons.includes('👥 Acompañantes a jugar (+2)'));
  assert.ok(playerButtons.includes('👀 Espectadores (+1)'));
  assert.ok(playerButtons.includes('👀 Pasar a espectador'));
  assert.ok(playerButtons.includes('Salir'));

  // Attending as spectator with 0 spectators when seats are available
  const spectatorOptions = buildScheduleDetailActionOptions({
    actor,
    event,
    isAttending: true,
    participationRole: 'spectator',
    companionCount: 0,
    spectatorCount: 0,
    availableSeats: 1,
    language: 'es',
    callbackPrefixes: prefixes,
  });
  const spectatorButtons = spectatorOptions.inlineKeyboard?.flat().map((btn) => btn.text) ?? [];
  assert.ok(!spectatorButtons.some((b) => b.includes('Acompañantes a jugar')));
  assert.ok(spectatorButtons.includes('👀 Espectadores (+0)'));
  assert.ok(spectatorButtons.includes('🎮 Pasar a jugar'));
  assert.ok(spectatorButtons.includes('Salir'));

  // Attending as spectator when table is full
  const fullSpectatorOptions = buildScheduleDetailActionOptions({
    actor,
    event,
    isAttending: true,
    participationRole: 'spectator',
    companionCount: 0,
    spectatorCount: 0,
    availableSeats: 0,
    language: 'es',
    callbackPrefixes: prefixes,
  });
  const fullSpectatorButtons = fullSpectatorOptions.inlineKeyboard?.flat().map((btn) => btn.text) ?? [];
  assert.ok(!fullSpectatorButtons.some((b) => b.includes('Acompañantes a jugar')));
  assert.ok(fullSpectatorButtons.includes('👀 Espectadores (+0)'));
  assert.ok(!fullSpectatorButtons.includes('🎮 Pasar a jugar'));
  assert.ok(fullSpectatorButtons.includes('Salir'));
});

