import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRoleGameParticipantButtonMap,
  buildRoleGameParticipantPage,
  formatRoleGameParticipantDetail,
  formatRoleGameParticipantList,
  listRoleGameMemberActions,
  type RoleGameParticipantListItem,
} from './role-game-participants.js';
import type { RoleGameMemberRecord, RoleGameRecord } from '../role-games/role-game-catalog.js';

function sampleRoleGame(): RoleGameRecord {
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
  };
}

function participant({
  memberId,
  telegramUserId = memberId + 100,
  role = 'player',
  status = 'requested',
  displayName = `Usuario ${telegramUserId}`,
  username = null,
}: {
  memberId: number;
  telegramUserId?: number;
  role?: RoleGameMemberRecord['role'];
  status?: RoleGameMemberRecord['status'];
  displayName?: string;
  username?: string | null;
}): RoleGameParticipantListItem {
  return {
    member: {
      id: memberId,
      roleGameId: 1,
      telegramUserId,
      role,
      status,
      isExternal: false,
      playerNote: null,
      requestedByTelegramUserId: null,
      createdAt: '2026-07-13T10:00:00.000Z',
      updatedAt: '2026-07-13T10:00:00.000Z',
    },
    displayName,
    username,
  };
}

test('participant page orders requests, waitlist, coorganizers, players and invited', () => {
  const items = [
    participant({ memberId: 1, status: 'invited', displayName: 'Invitada' }),
    participant({ memberId: 2, role: 'player', status: 'confirmed', displayName: 'Zoe' }),
    participant({ memberId: 3, role: 'coorganizer', status: 'confirmed', displayName: 'Coorg' }),
    participant({ memberId: 4, status: 'waitlisted', displayName: 'Espera' }),
    participant({ memberId: 5, status: 'requested', displayName: 'Solicitud' }),
  ];

  const page = buildRoleGameParticipantPage({ items, kind: 'active', requestedPage: 1, pageSize: 6 });

  assert.deepEqual(page.items.map((item) => item.member.status), [
    'requested', 'waitlisted', 'confirmed', 'confirmed', 'invited',
  ]);
  assert.deepEqual(page.items.map((item) => item.member.role), [
    'player', 'player', 'coorganizer', 'player', 'player',
  ]);
});

test('participant page splits history from active members and paginates with bounded pages', () => {
  const items = [
    participant({ memberId: 1, status: 'requested' }),
    participant({ memberId: 2, status: 'left' }),
    participant({ memberId: 3, status: 'removed' }),
    participant({ memberId: 4, status: 'rejected' }),
    ...Array.from({ length: 6 }, (_, index) => participant({
      memberId: index + 5,
      status: 'confirmed',
      displayName: `Jugador ${index + 1}`,
    })),
  ];

  const active = buildRoleGameParticipantPage({ items, kind: 'active', requestedPage: 9, pageSize: 6 });
  const history = buildRoleGameParticipantPage({ items, kind: 'history', requestedPage: 1, pageSize: 6 });

  assert.equal(active.page, 2);
  assert.equal(active.pages, 2);
  assert.equal(active.total, 7);
  assert.equal(active.from, 7);
  assert.equal(active.to, 7);
  assert.deepEqual(active.items.map((item) => item.member.id), [10]);
  assert.deepEqual(history.items.map((item) => item.member.status), ['left', 'removed', 'rejected']);
});

test('participant buttons disambiguate duplicate display names', () => {
  const labels = buildRoleGameParticipantButtonMap([
    participant({ memberId: 4, displayName: 'Alex', username: null }),
    participant({ memberId: 9, displayName: 'Alex', username: null }),
  ]);

  assert.deepEqual([...labels.keys()], ['Alex · #4', 'Alex · #9']);
  assert.deepEqual(Object.fromEntries(labels), { 'Alex · #4': 4, 'Alex · #9': 9 });
});

test('participant buttons disambiguate names reserved for list navigation', () => {
  const labels = buildRoleGameParticipantButtonMap([
    participant({ memberId: 4, displayName: 'Historial', username: null }),
  ], { reservedLabels: ['Historial'] });

  assert.deepEqual([...labels.keys()], ['Historial · #4']);
});

test('participant presentation falls back to the supplied localized identity and formats username links', () => {
  const items = [
    participant({ memberId: 1, telegramUserId: 51, displayName: 'Usuario 51', username: null }),
    participant({ memberId: 2, telegramUserId: 52, status: 'confirmed', displayName: 'Ana', username: 'ana_rpg' }),
  ];
  const page = buildRoleGameParticipantPage({ items, kind: 'active', requestedPage: 1, pageSize: 6 });
  const message = formatRoleGameParticipantList({
    page,
    title: 'Partida de prueba',
    kind: 'active',
    language: 'es',
  });

  assert.match(message, /Usuario 51/);
  assert.match(message, /<a href="https:\/\/t\.me\/ana_rpg">Ana \(@ana_rpg\)<\/a>/);
  assert.match(message, /Solicitudes pendientes/);
  assert.match(message, /Jugadores confirmados/);
});

test('participant actions hide self-promotion even from a global admin', () => {
  const game = sampleRoleGame();
  const member = participant({
    memberId: 8,
    telegramUserId: 100,
    role: 'player',
    status: 'confirmed',
    displayName: 'Admin',
  }).member;

  assert.deepEqual(listRoleGameMemberActions({
    actor: { telegramUserId: 100, isAdmin: true, isApproved: true },
    game,
    actorMembership: member,
    member,
  }), ['remove']);
});

test('participant presentation gives the primary GM a separate group and shows a relevant date in detail', () => {
  const primaryGm = participant({
    memberId: 1,
    telegramUserId: 42,
    role: 'primary_gm',
    status: 'confirmed',
    displayName: 'Máster principal',
  });
  primaryGm.member.updatedAt = '2026-07-13T10:00:00.000Z';
  const player = participant({ memberId: 2, role: 'player', status: 'confirmed', displayName: 'Jugadora' });
  const page = buildRoleGameParticipantPage({ items: [primaryGm, player], kind: 'active', requestedPage: 1, language: 'es' });
  const list = formatRoleGameParticipantList({ page, title: 'Partida', kind: 'active', language: 'es' });
  const detail = formatRoleGameParticipantDetail({ item: primaryGm, language: 'es' });

  assert.match(list, /<b>Máster principal<\/b>\n- .*Máster principal/);
  const confirmedPlayersSection = list.split('<b>Jugadores confirmados</b>')[1] ?? '';
  assert.doesNotMatch(confirmedPlayersSection, /Máster principal/);
  assert.match(detail, /Fecha relevante: .*13\/07\/2026/);
});
