import type { MembershipUserRecord } from '../membership/access-flow.js';
import { escapeHtml } from './catalog-presentation.js';

export function formatTelegramUserLink(
  user: Pick<MembershipUserRecord, 'displayName' | 'username' | 'telegramUserId'>,
  { bold = false }: { bold?: boolean } = {},
): string {
  const normalizedUsername = user.username?.trim().replace(/^@/, '');
  const visibleText = normalizedUsername ? `${user.displayName} (@${normalizedUsername})` : user.displayName;
  const escapedText = bold ? `<b>${escapeHtml(visibleText)}</b>` : escapeHtml(visibleText);

  if (normalizedUsername && /^[A-Za-z0-9_]{5,32}$/.test(normalizedUsername)) {
    return `<a href="https://t.me/${escapeHtml(normalizedUsername)}">${escapedText}</a>`;
  }

  return `<a href="tg://user?id=${user.telegramUserId}">${escapedText}</a>`;
}
