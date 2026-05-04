import type { AuthorizationService } from '../authorization/service.js';
import type { TelegramActor } from './actor-store.js';
import type { TelegramChatContext, TelegramChatContextKind } from './chat-context.js';
import type { ConversationSessionRecord } from './conversation-session.js';
import { createTelegramI18n, type BotLanguage } from './i18n.js';
import type { TelegramButtonSemanticRole, TelegramReplyButton } from './runtime-boundary.js';

export interface TelegramActionMenuContext {
  actor: TelegramActor;
  authorization: AuthorizationService;
  chat: TelegramChatContext;
  session: ConversationSessionRecord | null;
  language: BotLanguage;
}

export interface TelegramResolvedActionMenu {
  menuId: string;
  replyKeyboard: TelegramReplyButton[][];
  actionRows: string[][];
  actions: TelegramResolvedActionMenuAction[];
  resizeKeyboard: true;
  persistentKeyboard: true;
}

export type TelegramActionUxSection = 'access' | 'primary' | 'admin' | 'utility' | 'flow';

export interface TelegramResolvedActionMenuAction {
  id: string;
  label: string;
  telemetryActionKey: string;
  uxSection: TelegramActionUxSection;
}

export interface TelegramResolvedMenuSelection {
  menuId: string;
  actionId: string;
  label: string;
  telemetryActionKey: string;
  uxSection: TelegramActionUxSection;
}

interface TelegramActionDefinition {
  id: string;
  label(language: BotLanguage): string;
  telemetryActionKey: string;
  uxSection: TelegramActionUxSection;
  buttonRole: TelegramButtonSemanticRole;
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
    telemetryActionKey: 'menu.access',
    uxSection: 'access',
    buttonRole: 'primary',
    contexts: ['private'],
    isVisible: (context) => !context.actor.isApproved && !context.actor.isBlocked,
  },
  {
    id: 'schedule',
    label: (language) => createTelegramI18n(language).actionMenu.schedule,
    telemetryActionKey: 'menu.schedule',
    uxSection: 'primary',
    buttonRole: 'primary',
    contexts: ['private'],
    isVisible: (context) => context.actor.isApproved && !context.actor.isBlocked,
  },
  {
    id: 'calendar',
    label: (language) => createTelegramI18n(language).actionMenu.calendar,
    telemetryActionKey: 'menu.calendar',
    uxSection: 'primary',
    buttonRole: 'primary',
    contexts: ['private'],
    isVisible: () => false,
  },
  {
    id: 'tables_read',
    label: (language) => createTelegramI18n(language).actionMenu.tablesRead,
    telemetryActionKey: 'menu.tables',
    uxSection: 'primary',
    buttonRole: 'primary',
    contexts: ['private'],
    isVisible: (context) => context.actor.isApproved && !context.actor.isBlocked,
  },
  {
    id: 'elevate_admin',
    label: (language) => createTelegramI18n(language).actionMenu.elevateAdmin,
    telemetryActionKey: 'menu.elevate_admin',
    uxSection: 'utility',
    buttonRole: 'secondary',
    contexts: ['private'],
    isVisible: (context) => context.actor.isApproved && !context.actor.isAdmin,
  },
  {
    id: 'catalog',
    label: (language) => createTelegramI18n(language).actionMenu.catalog,
    telemetryActionKey: 'menu.catalog',
    uxSection: 'primary',
    buttonRole: 'primary',
    contexts: ['private'],
    isVisible: (context) => context.actor.isApproved && !context.actor.isBlocked,
  },
  {
    id: 'storage',
    label: (language) => createTelegramI18n(language).actionMenu.storage,
    telemetryActionKey: 'menu.storage',
    uxSection: 'primary',
    buttonRole: 'primary',
    contexts: ['private'],
    isVisible: (context) => context.actor.isApproved && !context.actor.isBlocked,
  },
  {
    id: 'group_purchases',
    label: (language) => createTelegramI18n(language).actionMenu.groupPurchases,
    telemetryActionKey: 'menu.group_purchases',
    uxSection: 'primary',
    buttonRole: 'primary',
    contexts: ['private'],
    isVisible: (context) => context.actor.isApproved && !context.actor.isBlocked,
  },
  {
    id: 'member_debug',
    label: (language) => createTelegramI18n(language).actionMenu.memberDebug,
    telemetryActionKey: 'menu.member_debug',
    uxSection: 'utility',
    buttonRole: 'secondary',
    contexts: ['private'],
    isVisible: (context) => context.actor.isAdmin,
  },
  {
    id: 'tables',
    label: (language) => createTelegramI18n(language).actionMenu.tables,
    telemetryActionKey: 'menu.tables_admin',
    uxSection: 'admin',
    buttonRole: 'primary',
    contexts: ['private'],
    isVisible: (context) => context.actor.isAdmin,
  },
  {
    id: 'review_access',
    label: (language) => createTelegramI18n(language).actionMenu.reviewAccess,
    telemetryActionKey: 'menu.review_access',
    uxSection: 'admin',
    buttonRole: 'secondary',
    contexts: ['private'],
    isVisible: (context) => context.actor.isAdmin,
  },
  {
    id: 'manage_users',
    label: (language) => createTelegramI18n(language).actionMenu.manageUsers,
    telemetryActionKey: 'menu.manage_users',
    uxSection: 'admin',
    buttonRole: 'secondary',
    contexts: ['private'],
    isVisible: (context) => context.actor.isAdmin,
  },
  {
    id: 'venue_events',
    label: (language) => createTelegramI18n(language).actionMenu.venueEvents,
    telemetryActionKey: 'menu.venue_events',
    uxSection: 'admin',
    buttonRole: 'secondary',
    contexts: ['private'],
    isVisible: () => false,
  },
  {
    id: 'language',
    label: (language) => createTelegramI18n(language).actionMenu.language,
    telemetryActionKey: 'menu.language',
    uxSection: 'utility',
    buttonRole: 'secondary',
    contexts: ['private', 'group', 'group-news'],
    isVisible: () => true,
  },
  {
    id: 'start',
    label: (language) => createTelegramI18n(language).actionMenu.start,
    telemetryActionKey: 'menu.start',
    uxSection: 'utility',
    buttonRole: 'navigation',
    contexts: ['private', 'group', 'group-news'],
    isVisible: () => true,
  },
  {
    id: 'help',
    label: (language) => createTelegramI18n(language).actionMenu.help,
    telemetryActionKey: 'menu.help',
    uxSection: 'utility',
    buttonRole: 'help',
    contexts: ['private', 'group', 'group-news'],
    isVisible: () => true,
  },
  {
    id: 'cancel',
    label: (language) => createTelegramI18n(language).actionMenu.cancel,
    telemetryActionKey: 'menu.cancel',
    uxSection: 'flow',
    buttonRole: 'danger',
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
    rows: [['review_access', 'manage_users'], ['schedule', 'tables'], ['catalog', 'storage'], ['group_purchases'], ['language', 'help']],
  },
  {
    id: 'private-approved-default',
    matches: (context) =>
      context.chat.kind === 'private' &&
      context.session === null &&
      context.actor.isApproved &&
      !context.actor.isAdmin,
    rows: [['schedule', 'tables_read'], ['catalog', 'storage'], ['group_purchases'], ['language', 'help']],
  },
  {
    id: 'private-pending-default',
    matches: (context) =>
      context.chat.kind === 'private' &&
      context.session === null &&
      !context.actor.isApproved &&
      !context.actor.isBlocked,
    rows: [['access'], ['language', 'help']],
  },
  {
    id: 'default-shared',
    matches: (context) => context.session === null,
    rows: [['language', 'help']],
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

  const visibleRows = menu.rows
    .map((row) =>
      row
        .map((actionId) => actionDefinitions.find((candidate) => candidate.id === actionId))
        .filter((action): action is TelegramActionDefinition => action !== undefined)
        .filter(
          (action) => action.contexts.includes(context.chat.kind) && action.isVisible(context),
        )
    )
    .filter((row) => row.length > 0);

  const replyKeyboard = visibleRows.map((row) =>
    row.map((action) => ({
      text: action.label(context.language),
      semanticRole: action.buttonRole,
    })),
  );

  if (replyKeyboard.length === 0) {
    return undefined;
  }

  return {
    menuId: menu.id,
    replyKeyboard,
    actionRows: visibleRows.map((row) => row.map((action) => action.id)),
    actions: visibleRows.flat().map((action) => ({
      id: action.id,
      label: action.label(context.language),
      telemetryActionKey: action.telemetryActionKey,
      uxSection: action.uxSection,
    })),
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

export function resolveTelegramMenuSelection({
  context,
  text,
}: {
  context: TelegramActionMenuContext;
  text: string;
}): TelegramResolvedMenuSelection | undefined {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return undefined;
  }

  const menu = resolveTelegramActionMenu({ context });
  if (!menu) {
    return undefined;
  }

  const action = menu.actions.find((candidate) => candidate.label === normalizedText);
  if (!action) {
    return undefined;
  }

  return {
    menuId: menu.menuId,
    actionId: action.id,
    label: action.label,
    telemetryActionKey: action.telemetryActionKey,
    uxSection: action.uxSection,
  };
}
