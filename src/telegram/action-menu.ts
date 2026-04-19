import type { AuthorizationService } from '../authorization/service.js';
import type { TelegramActor } from './actor-store.js';
import type { TelegramChatContext, TelegramChatContextKind } from './chat-context.js';
import type { ConversationSessionRecord } from './conversation-session.js';
import { createTelegramI18n, type BotLanguage } from './i18n.js';

export interface TelegramActionMenuContext {
  actor: TelegramActor;
  authorization: AuthorizationService;
  chat: TelegramChatContext;
  session: ConversationSessionRecord | null;
  language: BotLanguage;
}

export interface TelegramResolvedActionMenu {
  replyKeyboard: string[][];
  resizeKeyboard: true;
  persistentKeyboard: true;
}

interface TelegramActionDefinition {
  id: string;
  label(language: BotLanguage): string;
  contexts: TelegramChatContextKind[];
  isVisible(context: TelegramActionMenuContext): boolean;
}

interface TelegramActionMenuDefinition {
  id: string;
  matches(context: TelegramActionMenuContext): boolean;
  rows: string[][];
}

const actionDefinitions: TelegramActionDefinition[] = [
  {
    id: 'access',
    label: (language) => createTelegramI18n(language).actionMenu.access,
    contexts: ['private'],
    isVisible: (context) => !context.actor.isApproved && !context.actor.isBlocked,
  },
  {
    id: 'schedule',
    label: (language) => createTelegramI18n(language).actionMenu.schedule,
    contexts: ['private'],
    isVisible: (context) => context.actor.isApproved && !context.actor.isBlocked,
  },
  {
    id: 'calendar',
    label: (language) => createTelegramI18n(language).actionMenu.calendar,
    contexts: ['private'],
    isVisible: () => false,
  },
  {
    id: 'tables_read',
    label: (language) => createTelegramI18n(language).actionMenu.tablesRead,
    contexts: ['private'],
    isVisible: (context) => context.actor.isApproved && !context.actor.isBlocked,
  },
  {
    id: 'elevate_admin',
    label: (language) => createTelegramI18n(language).actionMenu.elevateAdmin,
    contexts: ['private'],
    isVisible: (context) => context.actor.isApproved && !context.actor.isAdmin,
  },
  {
    id: 'catalog',
    label: (language) => createTelegramI18n(language).actionMenu.catalog,
    contexts: ['private'],
    isVisible: (context) => context.actor.isApproved && !context.actor.isBlocked,
  },
  {
    id: 'member_debug',
    label: (language) => createTelegramI18n(language).actionMenu.memberDebug,
    contexts: ['private'],
    isVisible: (context) => context.actor.isAdmin,
  },
  {
    id: 'tables',
    label: (language) => createTelegramI18n(language).actionMenu.tables,
    contexts: ['private'],
    isVisible: (context) => context.actor.isAdmin,
  },
  {
    id: 'review_access',
    label: (language) => createTelegramI18n(language).actionMenu.reviewAccess,
    contexts: ['private'],
    isVisible: (context) => context.actor.isAdmin,
  },
  {
    id: 'manage_users',
    label: (language) => createTelegramI18n(language).actionMenu.manageUsers,
    contexts: ['private'],
    isVisible: (context) => context.actor.isAdmin,
  },
  {
    id: 'venue_events',
    label: (language) => createTelegramI18n(language).actionMenu.venueEvents,
    contexts: ['private'],
    isVisible: () => false,
  },
  {
    id: 'language',
    label: (language) => createTelegramI18n(language).actionMenu.language,
    contexts: ['private', 'group', 'group-news'],
    isVisible: () => true,
  },
  {
    id: 'start',
    label: (language) => createTelegramI18n(language).actionMenu.start,
    contexts: ['private', 'group', 'group-news'],
    isVisible: () => true,
  },
  {
    id: 'help',
    label: (language) => createTelegramI18n(language).actionMenu.help,
    contexts: ['private', 'group', 'group-news'],
    isVisible: () => true,
  },
  {
    id: 'cancel',
    label: (language) => createTelegramI18n(language).actionMenu.cancel,
    contexts: ['private', 'group', 'group-news'],
    isVisible: (context) => context.session !== null,
  },
];

const menuDefinitions: TelegramActionMenuDefinition[] = [
  {
    id: 'active-flow',
    matches: (context) => context.session !== null,
    rows: [['cancel']],
  },
  {
    id: 'private-admin-default',
    matches: (context) => context.chat.kind === 'private' && context.session === null && context.actor.isAdmin,
    rows: [['schedule'], ['tables', 'catalog'], ['member_debug'], ['review_access'], ['manage_users'], ['language'], ['start', 'help']],
  },
  {
    id: 'private-approved-default',
    matches: (context) =>
      context.chat.kind === 'private' &&
      context.session === null &&
      context.actor.isApproved &&
      !context.actor.isAdmin,
    rows: [['schedule'], ['catalog'], ['elevate_admin'], ['language'], ['start', 'help']],
  },
  {
    id: 'private-pending-default',
    matches: (context) =>
      context.chat.kind === 'private' &&
      context.session === null &&
      !context.actor.isApproved &&
      !context.actor.isBlocked,
    rows: [['access', 'language', 'start'], ['help']],
  },
  {
    id: 'default-shared',
    matches: (context) => context.session === null,
    rows: [['language', 'start', 'help']],
  },
];

export function resolveTelegramActionMenu({
  context,
}: {
  context: TelegramActionMenuContext;
}): TelegramResolvedActionMenu | undefined {
  const menu = menuDefinitions.find((candidate) => candidate.matches(context));
  if (!menu) {
    return undefined;
  }

  const replyKeyboard = menu.rows
    .map((row) =>
      row
        .map((actionId) => actionDefinitions.find((candidate) => candidate.id === actionId))
        .filter((action): action is TelegramActionDefinition => action !== undefined)
        .filter(
          (action) => action.contexts.includes(context.chat.kind) && action.isVisible(context),
        )
        .map((action) => action.label(context.language)),
    )
    .filter((row) => row.length > 0);

  if (replyKeyboard.length === 0) {
    return undefined;
  }

  return {
    replyKeyboard,
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}
