import {
  canManageRoleGame,
  canManageRoleGameOperationally,
  type RoleGameActor,
  type RoleGameMemberManagementAction,
  type RoleGameMemberRecord,
  type RoleGameRecord,
} from '../role-games/role-game-catalog.js';
import { createTelegramI18n, type BotLanguage } from './i18n.js';
import { formatTelegramUserLink } from './telegram-user-links.js';

const activeStatuses = new Set<RoleGameMemberRecord['status']>(['requested', 'waitlisted', 'confirmed', 'invited']);
const historyStatuses = new Set<RoleGameMemberRecord['status']>(['left', 'removed', 'rejected']);

export type RoleGameParticipantListKind = 'active' | 'history';

export interface RoleGameParticipantListItem {
  member: RoleGameMemberRecord;
  displayName: string;
  username: string | null;
}

export interface RoleGameParticipantPage {
  items: RoleGameParticipantListItem[];
  page: number;
  pages: number;
  total: number;
  from: number;
  to: number;
}

export function listRoleGameMemberActions({
  actor,
  game,
  actorMembership,
  member,
}: {
  actor: RoleGameActor;
  game: RoleGameRecord;
  actorMembership: RoleGameMemberRecord | null;
  member: RoleGameMemberRecord;
}): RoleGameMemberManagementAction[] {
  if (member.roleGameId !== game.id || member.role === 'primary_gm' || historyStatuses.has(member.status)) {
    return [];
  }
  const actions = memberManagementActionsFor(member);
  if (canManageRoleGame(actor, game, actorMembership)) {
    return actions;
  }
  if (canManageRoleGameOperationally(actor, game, actorMembership) && member.status === 'requested') {
    return actions;
  }
  return [];
}

export function buildRoleGameParticipantPage({
  items,
  kind,
  requestedPage,
  pageSize = 6,
  language = 'ca',
}: {
  items: RoleGameParticipantListItem[];
  kind: RoleGameParticipantListKind;
  requestedPage: number;
  pageSize?: number;
  language?: BotLanguage;
}): RoleGameParticipantPage {
  const matchingStatuses = kind === 'active' ? activeStatuses : historyStatuses;
  const filtered = items
    .filter((item) => matchingStatuses.has(item.member.status))
    .sort((left, right) => compareParticipants(left, right, kind, language));
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pages);
  const from = total === 0 ? 0 : ((page - 1) * pageSize) + 1;
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);

  return {
    items: pageItems,
    page,
    pages,
    total,
    from,
    to: total === 0 ? 0 : from + pageItems.length - 1,
  };
}

export function buildRoleGameParticipantButtonMap(
  items: RoleGameParticipantListItem[],
  { reservedLabels = [] }: { reservedLabels?: string[] } = {},
): Map<string, number> {
  const displayNameCounts = new Map<string, number>();
  for (const item of items) {
    displayNameCounts.set(item.displayName, (displayNameCounts.get(item.displayName) ?? 0) + 1);
  }
  const usedLabels = new Set(reservedLabels);
  const labels = new Map<string, number>();
  for (const item of items) {
    let label = displayNameCounts.get(item.displayName) === 1 && !usedLabels.has(item.displayName)
      ? item.displayName
      : `${item.displayName} · #${item.member.id}`;
    while (usedLabels.has(label)) {
      label = `${label} · #${item.member.id}`;
    }
    usedLabels.add(label);
    labels.set(label, item.member.id);
  }
  return labels;
}

export function formatRoleGameParticipantList({
  page,
  title,
  kind,
  language = 'ca',
}: {
  page: RoleGameParticipantPage;
  title: string;
  kind: RoleGameParticipantListKind;
  language?: BotLanguage;
}): string {
  const texts = createTelegramI18n(language).roleGames;
  const groups = participantGroupDefinitions(kind, texts);
  const lines = [`<b>${escapeHtml(texts.participantsHeader.replace('{title}', title))}</b>`];

  for (const group of groups) {
    const groupItems = page.items.filter(group.matches);
    if (groupItems.length > 0) {
      lines.push('', `<b>${escapeHtml(group.heading)}</b>`, ...groupItems.map((item) => formatParticipantRow(item, texts)));
    }
  }

  if (page.total === 0) {
    lines.push('', texts.noParticipantsForView);
  }
  if (page.pages > 1) {
    lines.push('', texts.participantListFooter
      .replace('{from}', String(page.from))
      .replace('{to}', String(page.to))
      .replace('{total}', String(page.total))
      .replace('{page}', String(page.page))
      .replace('{pages}', String(page.pages)));
  }
  return lines.join('\n');
}

export function formatRoleGameParticipantDetail({
  item,
  language = 'ca',
}: {
  item: RoleGameParticipantListItem;
  language?: BotLanguage;
}): string {
  const texts = createTelegramI18n(language).roleGames;
  return [
    `<b>${escapeHtml(texts.participantDetailHeader)}</b>`,
    formatParticipantRow(item, texts).replace(/^- /, ''),
  ].join('\n');
}

function compareParticipants(
  left: RoleGameParticipantListItem,
  right: RoleGameParticipantListItem,
  kind: RoleGameParticipantListKind,
  language: BotLanguage,
): number {
  const rankDifference = participantRank(left.member, kind) - participantRank(right.member, kind);
  if (rankDifference !== 0) {
    return rankDifference;
  }
  const nameDifference = new Intl.Collator(language).compare(left.displayName, right.displayName);
  return nameDifference !== 0 ? nameDifference : left.member.id - right.member.id;
}

function participantRank(member: RoleGameMemberRecord, kind: RoleGameParticipantListKind): number {
  if (kind === 'history') {
    return ({ left: 0, removed: 1, rejected: 2 } as const)[member.status as 'left' | 'removed' | 'rejected'] ?? 3;
  }
  if (member.status === 'requested') return 0;
  if (member.status === 'waitlisted') return 1;
  if (member.status === 'confirmed' && member.role === 'coorganizer') return 2;
  if (member.status === 'confirmed') return 3;
  if (member.status === 'invited') return 4;
  return 5;
}

function participantGroupDefinitions(
  kind: RoleGameParticipantListKind,
  texts: ReturnType<typeof createTelegramI18n>['roleGames'],
) {
  if (kind === 'history') {
    return [
      { heading: texts.participantLeft, matches: (item: RoleGameParticipantListItem) => item.member.status === 'left' },
      { heading: texts.participantRemoved, matches: (item: RoleGameParticipantListItem) => item.member.status === 'removed' },
      { heading: texts.participantRejected, matches: (item: RoleGameParticipantListItem) => item.member.status === 'rejected' },
    ];
  }
  return [
    { heading: texts.participantRequests, matches: (item: RoleGameParticipantListItem) => item.member.status === 'requested' },
    { heading: texts.participantWaitlist, matches: (item: RoleGameParticipantListItem) => item.member.status === 'waitlisted' },
    { heading: texts.participantCoorganizers, matches: (item: RoleGameParticipantListItem) => item.member.status === 'confirmed' && item.member.role === 'coorganizer' },
    { heading: texts.participantConfirmedPlayers, matches: (item: RoleGameParticipantListItem) => item.member.status === 'confirmed' && item.member.role !== 'coorganizer' },
    { heading: texts.participantInvited, matches: (item: RoleGameParticipantListItem) => item.member.status === 'invited' },
  ];
}

function formatParticipantRow(
  item: RoleGameParticipantListItem,
  texts: ReturnType<typeof createTelegramI18n>['roleGames'],
): string {
  return `- ${formatTelegramUserLink({
    telegramUserId: item.member.telegramUserId,
    displayName: item.displayName,
    username: item.username,
  })} · ${escapeHtml(participantRoleLabel(item.member, texts))} · ${escapeHtml(participantStatusLabel(item.member.status, texts))}`;
}

function participantRoleLabel(
  member: RoleGameMemberRecord,
  texts: ReturnType<typeof createTelegramI18n>['roleGames'],
): string {
  if (member.role === 'coorganizer') return texts.participantRoleCoorganizer;
  if (member.role === 'primary_gm') return texts.participantRolePrimaryGm;
  return texts.participantRolePlayer;
}

function participantStatusLabel(
  status: RoleGameMemberRecord['status'],
  texts: ReturnType<typeof createTelegramI18n>['roleGames'],
): string {
  return {
    invited: texts.participantStatusInvited,
    requested: texts.participantStatusRequested,
    confirmed: texts.participantStatusConfirmed,
    waitlisted: texts.participantStatusWaitlisted,
    left: texts.participantStatusLeft,
    removed: texts.participantStatusRemoved,
    rejected: texts.participantStatusRejected,
  }[status];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

function memberManagementActionsFor(member: RoleGameMemberRecord): RoleGameMemberManagementAction[] {
  if (member.status === 'requested') return ['confirm', 'reject'];
  if (member.status === 'waitlisted') return ['confirm', 'remove'];
  if (member.status === 'invited') return ['confirm', 'cancel_invitation'];
  if (member.status === 'confirmed' && member.role === 'player') return ['promote', 'remove'];
  if (member.status === 'confirmed' && member.role === 'coorganizer') return ['demote', 'remove'];
  return [];
}
