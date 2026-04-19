export function normalizeDisplayName(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function isGenericDisplayName(value: string | null | undefined): boolean {
  const normalized = normalizeDisplayName(value)?.toLowerCase();
  return normalized === 'usuari' || normalized === 'usuario' || normalized === 'user';
}

export function resolveTelegramDisplayName(input: {
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
} | null | undefined): string {
  const firstName = normalizeDisplayName(input?.first_name);
  const lastName = normalizeDisplayName(input?.last_name);
  const username = normalizeDisplayName(input?.username);
  const fullName = [firstName, lastName].filter((part): part is string => Boolean(part)).join(' ');

  if (fullName) {
    return fullName;
  }

  if (username) {
    return `@${username.replace(/^@/, '')}`;
  }

  return 'Usuari';
}

export function resolveMembershipDisplayName(input: {
  displayName?: string | null;
  username?: string | null;
  fallbackLabel?: string;
}): string {
  const displayName = normalizeDisplayName(input.displayName);
  const username = normalizeDisplayName(input.username);

  if (displayName && !isGenericDisplayName(displayName)) {
    return displayName;
  }

  if (username) {
    return `@${username.replace(/^@/, '')}`;
  }

  return input.fallbackLabel ?? 'Usuari';
}

export function formatMembershipDisplayName(
  user: { displayName: string; username?: string | null },
  fallbackLabel = 'Usuari',
): string {
  const displayName = normalizeDisplayName(user.displayName);
  const username = normalizeDisplayName(user.username);

  if (displayName && username) {
    return `${displayName} (@${username.replace(/^@/, '')})`;
  }

  if (displayName) {
    return displayName;
  }

  if (username) {
    return `@${username.replace(/^@/, '')}`;
  }

  return fallbackLabel;
}
