import type { AuthorizationService } from '../authorization/service.js';
import type { TelegramActor } from './actor-store.js';
import type { InfrastructureRuntimeServices } from '../infrastructure/runtime-boundary.js';
import type { TelegramChatContext, TelegramChatContextKind } from './chat-context.js';
import type { ConversationSessionRuntime } from './conversation-session.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import { createTelegramI18n, type BotLanguage } from './i18n.js';

export class TelegramInteractionError extends Error {
  cancelSession: boolean;

  constructor(message: string, options: { cancelSession?: boolean } = {}) {
    super(message);
    this.name = 'TelegramInteractionError';
    this.cancelSession = options.cancelSession ?? false;
  }
}

export type TelegramCommandAccess = 'public' | 'approved' | 'admin';

export interface TelegramCommandRuntime {
  bot: {
    publicName: string;
    clubName: string;
    language?: BotLanguage;
    username?: string | undefined;
    sendPrivateMessage(telegramUserId: number, message: string, options?: TelegramReplyOptions): Promise<void>;
    sendGroupMessage?(chatId: number, message: string, options?: TelegramReplyOptions): Promise<void>;
  };
  services: InfrastructureRuntimeServices;
  chat: TelegramChatContext;
  actor: TelegramActor;
  authorization: AuthorizationService;
  session: ConversationSessionRuntime;
}

export interface TelegramCommandHandlerContext {
  from?: {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  messageText?: string;
  callbackData?: string;
  reply(message: string, options?: TelegramReplyOptions): Promise<unknown>;
  runtime: TelegramCommandRuntime;
  __replies?: string[];
}

export type TelegramCommandHandler = (
  context: TelegramCommandHandlerContext,
) => Promise<unknown> | unknown;

export interface TelegramCommandDefinition {
  command: string;
  contexts: TelegramChatContextKind[];
  access?: TelegramCommandAccess;
  description?: string;
  descriptionByLanguage?: Partial<Record<BotLanguage, string>>;
  handle: TelegramCommandHandler;
}

export interface TelegramCommandRegistrar {
  onCommand(command: string, handler: TelegramCommandHandler): void;
}

export function registerTelegramCommands({
  bot,
  commands,
}: {
  bot: TelegramCommandRegistrar;
  commands: TelegramCommandDefinition[];
}): void {
  for (const command of commands) {
    bot.onCommand(command.command, async (context) => {
      const language = context.runtime.bot.language ?? 'ca';
      if (!command.contexts.includes(context.runtime.chat.kind)) {
        await context.reply(restrictionMessageFor(command.contexts, language));
        return;
      }

      const access = command.access ?? 'public';
      if (!hasRequiredAccess(context, access)) {
        await context.reply(accessDeniedMessageFor(access, language));
        return;
      }

      try {
        await command.handle(context);
      } catch (error) {
        if (error instanceof TelegramInteractionError) {
          if (error.cancelSession) {
            await context.runtime.session.cancel();
          }

          await context.reply(error.message);
          return;
        }

        throw error;
      }
    });
  }
}

export function renderTelegramHelpMessage({
  commands,
  context,
}: {
  commands: TelegramCommandDefinition[];
  context: TelegramCommandHandlerContext;
}): string {
  const language = context.runtime.bot.language ?? 'ca';
  const i18n = createTelegramI18n(language);
  const visibleCommands = commands.filter((command) => {
    const access = command.access ?? 'public';
    return (
      (command.description || command.descriptionByLanguage) &&
      command.contexts.includes(context.runtime.chat.kind) &&
      hasRequiredAccess(context, access)
    );
  });

  const lines: string[] = [i18n.common.helpHeader];

  for (const command of visibleCommands) {
    const description = command.descriptionByLanguage?.[language] ?? command.description;
    if (description) {
      lines.push(`/${command.command} - ${description}`);
    }
  }

  if (context.runtime.chat.kind !== 'private') {
    lines.push('');
    lines.push(i18n.common.helpFooterPrivate);
  }

  if (context.runtime.chat.kind === 'private' && !context.runtime.actor.isApproved) {
    lines.push('');
    lines.push(i18n.common.helpPendingApproval);
  }

  return lines.join('\n');
}

function hasRequiredAccess(
  context: TelegramCommandHandlerContext,
  access: TelegramCommandAccess,
): boolean {
  if (access === 'public') {
    return true;
  }

  if (access === 'approved') {
    return context.runtime.actor.isApproved;
  }

  return context.runtime.actor.isAdmin;
}

function accessDeniedMessageFor(access: TelegramCommandAccess, language: BotLanguage): string {
  const i18n = createTelegramI18n(language);
  if (access === 'approved') {
    return i18n.common.accessDeniedApproved;
  }

  if (access === 'admin') {
    return i18n.common.accessDeniedAdmin;
  }

  return i18n.common.accessDeniedGeneric;
}

function restrictionMessageFor(contexts: TelegramChatContextKind[], language: BotLanguage): string {
  const i18n = createTelegramI18n(language);
  if (contexts.length === 1 && contexts[0] === 'private') {
    return i18n.common.privateOnly;
  }

  return i18n.common.contextRestricted;
}
