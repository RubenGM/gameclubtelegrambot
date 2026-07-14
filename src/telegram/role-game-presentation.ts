import type { RoleGameRecord } from '../role-games/role-game-catalog.js';
import { buildTelegramStartUrl } from './deep-links.js';
import { createTelegramI18n, type BotLanguage } from './i18n.js';
import { escapeHtml, formatHtmlField } from './schedule-presentation.js';

export const roleGameListPageSize = 5;

export function formatRoleGameListMessage({
  games,
  language,
  page,
  total,
  header,
}: {
  games: RoleGameRecord[];
  language: BotLanguage;
  page: number;
  total: number;
  header: string;
}): string {
  const lines: string[] = [`<b>${escapeHtml(header)}</b>`];
  for (const game of games) {
    const url = escapeHtml(buildTelegramStartUrl(`role_game_${game.id}`));
    lines.push(`- <a href="${url}">${escapeHtml(game.title)}</a> · ${escapeHtml(game.system)} · ${escapeHtml(formatRoleGameType(game, language))}`);
  }

  const totalPages = calculateRoleGameListTotalPages(total);
  if (totalPages > 1) {
    lines.push('');
    lines.push(escapeHtml(formatRoleGameListPageFooter({
      language,
      page,
      total,
      shownFrom: (page - 1) * roleGameListPageSize + 1,
      shownTo: Math.min(page * roleGameListPageSize, total),
      totalPages,
    })));
  }

  return lines.join('\n');
}

export function formatRoleGameDetailMessage({
  game,
  language,
}: {
  game: RoleGameRecord;
  language: BotLanguage;
}): string {
  const texts = createTelegramI18n(language).roleGames;
  return [
    `<b>${escapeHtml(game.title)}</b>`,
    formatHtmlField(texts.systemLabel, escapeHtml(game.system)),
    formatHtmlField(texts.typeLabel, escapeHtml(formatRoleGameType(game, language))),
    formatHtmlField(texts.statusLabel, escapeHtml(formatRoleGameStatus(game, language))),
    formatHtmlField(texts.visibilityLabel, escapeHtml(formatRoleGameVisibility(game, language))),
    formatHtmlField(texts.capacityLabel, String(game.capacity)),
    formatHtmlField(texts.descriptionLabel, escapeHtml(game.description ?? texts.noDescription)),
  ].join('\n');
}

export function calculateRoleGameListTotalPages(totalItems: number): number {
  return Math.max(1, Math.ceil(totalItems / roleGameListPageSize));
}

export function clampRoleGameListPage(page: number, totalItems: number): number {
  return Math.min(Math.max(1, page), calculateRoleGameListTotalPages(totalItems));
}

function formatRoleGameListPageFooter({
  language,
  shownFrom,
  shownTo,
  total,
  page,
  totalPages,
}: {
  language: BotLanguage;
  shownFrom: number;
  shownTo: number;
  total: number;
  page: number;
  totalPages: number;
}): string {
  return createTelegramI18n(language).roleGames.listPageFooter
    .replace('{from}', String(shownFrom))
    .replace('{to}', String(shownTo))
    .replace('{total}', String(total))
    .replace('{page}', String(page))
    .replace('{pages}', String(totalPages));
}

function formatRoleGameType(game: RoleGameRecord, language: BotLanguage): string {
  const texts = createTelegramI18n(language).roleGames;
  return game.type === 'campaign' ? texts.typeCampaign : texts.typeOneShot;
}

function formatRoleGameStatus(game: RoleGameRecord, language: BotLanguage): string {
  const texts = createTelegramI18n(language).roleGames;
  return texts[`status${capitalizeCamel(game.status)}` as keyof typeof texts] ?? game.status;
}

function formatRoleGameVisibility(game: RoleGameRecord, language: BotLanguage): string {
  const texts = createTelegramI18n(language).roleGames;
  if (game.visibility === 'private') return texts.visibilityPrivate;
  if (game.visibility === 'members') return texts.visibilityMembers;
  return texts.visibilityPublic;
}

function capitalizeCamel(value: string): string {
  return value.split('_').map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join('');
}
