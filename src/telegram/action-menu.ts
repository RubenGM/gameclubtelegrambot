import type { AuthorizationService } from '../authorization/service.js';
import type { TelegramActor } from './actor-store.js';
import type { TelegramChatContext, TelegramChatContextKind } from './chat-context.js';
import type { ConversationSessionRecord } from './conversation-session.js';

export interface TelegramActionMenuContext {
  actor: TelegramActor;
  authorization: AuthorizationService;
  chat: TelegramChatContext;
  session: ConversationSessionRecord | null;
}

export interface TelegramResolvedActionMenu {
  replyKeyboard: string[][];
  resizeKeyboard: true;
  persistentKeyboard: true;
}

interface TelegramActionDefinition {
  id: string;
  label: string;
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
    label: '/access',
    contexts: ['private'],
    isVisible: (context) => !context.actor.isApproved && !context.actor.isBlocked,
  },
  {
    id: 'schedule',
    label: 'Activitats',
    contexts: ['private'],
    isVisible: (context) => context.actor.isApproved && !context.actor.isBlocked,
  },
  {
    id: 'tables_read',
    label: '/tables',
    contexts: ['private'],
    isVisible: (context) => context.actor.isApproved && !context.actor.isBlocked,
  },
  {
    id: 'elevate_admin',
    label: '/elevate_admin',
    contexts: ['private'],
    isVisible: (context) => context.actor.isApproved && !context.actor.isAdmin,
  },
  {
    id: 'tables',
    label: 'Taules',
    contexts: ['private'],
    isVisible: (context) => context.actor.isAdmin,
  },
  {
    id: 'review_access',
    label: '/review_access',
    contexts: ['private'],
    isVisible: (context) => context.actor.isAdmin,
  },
  {
    id: 'start',
    label: '/start',
    contexts: ['private', 'group', 'group-news'],
    isVisible: () => true,
  },
  {
    id: 'help',
    label: '/help',
    contexts: ['private', 'group', 'group-news'],
    isVisible: () => true,
  },
  {
    id: 'cancel',
    label: '/cancel',
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
    rows: [['schedule', 'tables'], ['review_access', 'start'], ['help']],
  },
  {
    id: 'private-approved-default',
    matches: (context) =>
      context.chat.kind === 'private' &&
      context.session === null &&
      context.actor.isApproved &&
      !context.actor.isAdmin,
    rows: [['schedule', 'tables_read'], ['elevate_admin', 'start'], ['help']],
  },
  {
    id: 'private-pending-default',
    matches: (context) =>
      context.chat.kind === 'private' &&
      context.session === null &&
      !context.actor.isApproved &&
      !context.actor.isBlocked,
    rows: [['access', 'start'], ['help']],
  },
  {
    id: 'default-shared',
    matches: (context) => context.session === null,
    rows: [['start', 'help']],
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
        .map((action) => action.label),
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
